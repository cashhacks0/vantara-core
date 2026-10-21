"""Directed acyclic graph executor with progress, cancellation, and run history."""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Any

from ..core.config import Settings
from ..core.db import Database, new_id, utc_now
from ..core.logging import get_logger
from ..knowledge.service import KnowledgeService
from ..runtimes.registry import RuntimeManager
from .base import NODE_REGISTRY, NodeContext, NodeError
from .validator import execution_order, validate_graph

log = get_logger(__name__)
MAX_NODE_SECONDS = 240
MAX_RUN_SECONDS = 900


class WorkflowValidationError(ValueError):
    def __init__(self, errors: list[str], warnings: list[str] | None = None):
        super().__init__("; ".join(errors))
        self.errors = errors
        self.warnings = warnings or []


@dataclass
class RunState:
    id: str
    status: str = "running"
    events: list[dict[str, Any]] = field(default_factory=list)
    cancel: asyncio.Event = field(default_factory=asyncio.Event)
    task: asyncio.Task | None = None
    started: float = field(default_factory=time.monotonic)


class WorkflowEngine:
    def __init__(self, db: Database, runtimes: RuntimeManager, knowledge: KnowledgeService, settings: Settings):
        self.db = db
        self.runtimes = runtimes
        self.knowledge = knowledge
        self.settings = settings
        self.runs: dict[str, RunState] = {}

    def validate(self, graph: dict[str, Any]) -> dict[str, Any]:
        errors, warnings = validate_graph(graph)
        return {"valid": not errors, "errors": errors, "warnings": warnings}

    def get_run_state(self, run_id: str) -> RunState | None:
        return self.runs.get(run_id)

    def list_runs(self, limit: int = 100) -> list[dict[str, Any]]:
        return self.db.query(
            "SELECT id, workflow_id, workflow_name, status, started_at, finished_at, error "
            "FROM workflow_runs ORDER BY started_at DESC LIMIT ?",
            (max(1, min(limit, 500)),),
        )

    def get_run(self, run_id: str) -> dict[str, Any]:
        row = self.db.query_one("SELECT * FROM workflow_runs WHERE id = ?", (run_id,))
        if not row:
            raise KeyError("Workflow run not found")
        state = self.runs.get(run_id)
        events = state.events if state else json.loads(row["events_json"] or "[]")
        return {
            **row,
            "outputs": json.loads(row["outputs_json"] or "{}"),
            "graph": json.loads(row["graph_json"] or "{}"),
            "events": events,
        }

    def start(self, graph: dict[str, Any], workflow_id: str | None, name: str | None = None) -> str:
        run_id = new_id("run_")
        validation = self.validate(graph)
        workflow_name = name or (graph.get("name") if isinstance(graph.get("name"), str) else None) or "Untitled workflow"
        started = utc_now()
        if not validation["valid"]:
            self.db.insert(
                "workflow_runs",
                {
                    "id": run_id, "workflow_id": workflow_id, "workflow_name": workflow_name,
                    "status": "failed", "started_at": started, "finished_at": utc_now(),
                    "error": "; ".join(validation["errors"])[:1500],
                    "outputs_json": "{}", "events_json": json.dumps([{"type": "validation_failed", "errors": validation["errors"], "warnings": validation["warnings"]}]),
                    "graph_json": json.dumps(graph),
                },
            )
            raise WorkflowValidationError(validation["errors"], validation["warnings"])
        self.db.insert(
            "workflow_runs",
            {
                "id": run_id, "workflow_id": workflow_id, "workflow_name": workflow_name,
                "status": "running", "started_at": started, "finished_at": None, "error": None,
                "outputs_json": "{}", "events_json": "[]", "graph_json": json.dumps(graph),
            },
        )
        state = RunState(id=run_id)
        self.runs[run_id] = state
        state.task = asyncio.create_task(self._execute(graph, state, workflow_name))
        return run_id

    def cancel(self, run_id: str) -> bool:
        state = self.runs.get(run_id)
        if not state or state.status != "running":
            return False
        state.cancel.set()
        if state.task and not state.task.done():
            state.task.cancel()
        return True

    async def execute_sync(self, graph: dict[str, Any], name: str = "Test workflow") -> dict[str, Any]:
        run_id = self.start(graph, None, name)
        state = self.runs[run_id]
        assert state.task is not None
        await state.task
        return self.get_run(run_id)

    async def _emit(self, state: RunState, event: dict[str, Any]) -> None:
        event = {**event, "ts": utc_now(), "run_id": state.id}
        state.events.append(event)

    async def _execute(self, graph: dict[str, Any], state: RunState, workflow_name: str) -> None:
        outputs: dict[str, Any] = {}
        values: dict[str, dict[str, Any]] = {}
        errors: list[str] = []
        started = time.monotonic()
        await self._emit(state, {"type": "run_started", "workflow": workflow_name})
        try:
            order = execution_order(graph)
            nodes = {str(n["id"]): n for n in graph.get("nodes") or []}
            edges = graph.get("edges") or []
            await self._emit(state, {"type": "plan", "order": order})
            for node_id in order:
                if state.cancel.is_set():
                    raise asyncio.CancelledError()
                if time.monotonic() - started > MAX_RUN_SECONDS:
                    raise NodeError(f"Workflow exceeded the {MAX_RUN_SECONDS}s run limit.")
                node_data = nodes.get(node_id)
                if not node_data:
                    continue
                node_type = node_data.get("type")
                node = NODE_REGISTRY.get(node_type)
                if not node:
                    raise NodeError(f"Unknown node type '{node_type}'.")
                inputs = self._gather_inputs(node_id, edges, values)
                missing = [p.name for p in node.spec.inputs if p.required and inputs.get(p.name) is None]
                if missing:
                    await self._emit(state, {
                        "type": "node_skipped", "node_id": node_id,
                        "reason": f"Inactive branch or missing input: {', '.join(missing)}",
                    })
                    continue
                await self._emit(state, {"type": "node_started", "node_id": node_id, "node_type": node_type, "label": node.spec.label})
                ctx = NodeContext(
                    db=self.db, runtimes=self.runtimes, knowledge=self.knowledge, settings=self.settings,
                    run_id=state.id, workflow_id=graph.get("workflow_id"), cancel=state.cancel,
                    emit=lambda event: self._emit(state, event), uploads_dir=self.settings.uploads_dir,
                    outputs_dir=self.settings.outputs_dir, node_id=node_id,
                )
                node_started = time.monotonic()
                try:
                    result = await asyncio.wait_for(
                        node.execute(ctx, inputs, node_data.get("config") or {}),
                        timeout=MAX_NODE_SECONDS,
                    )
                except asyncio.TimeoutError as exc:
                    raise NodeError(f"{node.spec.label} timed out after {MAX_NODE_SECONDS}s.") from exc
                values[node_id] = {key: result.get(key) for key in [p.name for p in node.spec.outputs]}
                duration = round((time.monotonic() - node_started) * 1000)
                if node_type == "text_output":
                    outputs[node_id] = {"type": "text", "label": node_data.get("config", {}).get("label", "Result"), "text": inputs.get("text")}
                elif result:
                    outputs[node_id] = {"type": node_type, **result}
                await self._emit(state, {
                    "type": "node_completed", "node_id": node_id, "node_type": node_type,
                    "duration_ms": duration, "outputs": self._preview(result),
                })
            state.status = "completed"
            await self._emit(state, {"type": "run_completed", "duration_ms": round((time.monotonic() - started) * 1000)})
        except asyncio.CancelledError:
            state.status = "cancelled"
            await self._emit(state, {"type": "run_cancelled", "message": "Run cancelled."})
        except NodeError as exc:
            state.status = "failed"
            errors.append(str(exc))
            await self._emit(state, {"type": "run_failed", "error": str(exc), "hint": exc.hint})
        except Exception as exc:
            state.status = "failed"
            errors.append(str(exc) or type(exc).__name__)
            log.exception("Workflow execution failed")
            await self._emit(state, {"type": "run_failed", "error": str(exc)[:800]})
        finally:
            self.db.update(
                "workflow_runs",
                state.id,
                {
                    "status": state.status,
                    "finished_at": utc_now(),
                    "error": "; ".join(errors)[:1500] or None,
                    "outputs_json": json.dumps(outputs, default=str),
                    "events_json": json.dumps(state.events, default=str)[:2_000_000],
                },
            )

    def _gather_inputs(self, node_id: str, edges: list[dict], values: dict[str, dict[str, Any]]) -> dict[str, Any]:
        inputs: dict[str, Any] = {}
        for edge in edges:
            if str(edge.get("target")) != node_id:
                continue
            source = str(edge.get("source"))
            source_handle = edge.get("sourceHandle") or edge.get("source_handle")
            target_handle = edge.get("targetHandle") or edge.get("target_handle")
            source_values = values.get(source) or {}
            if source_handle and source_handle in source_values:
                value = source_values[source_handle]
            else:
                value = next(iter(source_values.values()), None)
            if target_handle:
                inputs[target_handle] = value
        return inputs

    @staticmethod
    def _preview(result: dict[str, Any]) -> dict[str, Any]:
        preview: dict[str, Any] = {}
        for key, value in (result or {}).items():
            if isinstance(value, str):
                preview[key] = value[:700]
            elif isinstance(value, (int, float, bool)) or value is None:
                preview[key] = value
            elif isinstance(value, list):
                preview[key] = value[:10]
            else:
                preview[key] = str(value)[:400]
        return preview
