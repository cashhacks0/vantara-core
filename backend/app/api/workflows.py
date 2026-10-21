"""Workflow CRUD, validation, execution, and run event streaming."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..core.db import new_id, utc_now
from ..workflow_engine.executor import WorkflowValidationError
from ..workflow_engine.templates import templates

router = APIRouter(tags=["workflows"])


def _workflow_public(row: dict) -> dict:
    return {
        "id": row["id"], "name": row["name"], "description": row["description"],
        "graph": json.loads(row["graph_json"]), "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


@router.get("/workflows")
def list_workflows(request: Request):
    rows = request.app.state.db.query("SELECT * FROM workflows ORDER BY updated_at DESC")
    result = []
    for row in rows:
        item = _workflow_public(row)
        item["node_count"] = len(item["graph"].get("nodes") or [])
        result.append(item)
    return {"workflows": result}


@router.get("/workflows/templates")
def list_templates():
    return {"templates": templates()}


@router.get("/workflows/nodes")
def node_catalog():
    from ..nodes import ai, basic, io  # noqa: F401  ensure registration
    from ..workflow_engine.base import node_specs

    return {"nodes": node_specs()}


class WorkflowCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    graph: dict[str, Any] = Field(default_factory=lambda: {"nodes": [], "edges": []})


class WorkflowUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    graph: dict[str, Any] | None = None


@router.post("/workflows", status_code=201)
def create_workflow(payload: WorkflowCreate, request: Request):
    db = request.app.state.db
    workflow_id = new_id("wf_")
    now = utc_now()
    db.insert(
        "workflows",
        {"id": workflow_id, "name": payload.name[:120], "description": payload.description[:500],
         "graph_json": json.dumps(payload.graph), "created_at": now, "updated_at": now},
    )
    return _workflow_public(db.query_one("SELECT * FROM workflows WHERE id = ?", (workflow_id,)))


@router.get("/workflows/{workflow_id}")
def get_workflow(workflow_id: str, request: Request):
    row = request.app.state.db.query_one("SELECT * FROM workflows WHERE id = ?", (workflow_id,))
    if not row:
        raise HTTPException(404, "Workflow not found")
    return _workflow_public(row)


@router.put("/workflows/{workflow_id}")
def update_workflow(workflow_id: str, payload: WorkflowUpdate, request: Request):
    db = request.app.state.db
    if not db.query_one("SELECT id FROM workflows WHERE id = ?", (workflow_id,)):
        raise HTTPException(404, "Workflow not found")
    update: dict[str, Any] = {"updated_at": utc_now()}
    if payload.name is not None:
        update["name"] = payload.name[:120]
    if payload.description is not None:
        update["description"] = payload.description[:500]
    if payload.graph is not None:
        update["graph_json"] = json.dumps(payload.graph)
    db.update("workflows", workflow_id, update)
    return _workflow_public(db.query_one("SELECT * FROM workflows WHERE id = ?", (workflow_id,)))


@router.delete("/workflows/{workflow_id}", status_code=204)
def delete_workflow(workflow_id: str, request: Request):
    request.app.state.db.execute("DELETE FROM workflows WHERE id = ?", (workflow_id,))


class GraphPayload(BaseModel):
    graph: dict[str, Any]


@router.post("/workflows/validate")
def validate_workflow(payload: GraphPayload, request: Request):
    return request.app.state.engine.validate(payload.graph)


class RunRequest(BaseModel):
    graph: dict[str, Any] | None = None
    name: str | None = None


@router.post("/workflows/{workflow_id}/run", status_code=202)
async def run_workflow(workflow_id: str, payload: RunRequest, request: Request):
    db = request.app.state.db
    row = db.query_one("SELECT * FROM workflows WHERE id = ?", (workflow_id,))
    if not row:
        raise HTTPException(404, "Workflow not found")
    graph = payload.graph if payload.graph else json.loads(row["graph_json"])
    try:
        run_id = request.app.state.engine.start(graph, workflow_id, payload.name or row["name"])
    except WorkflowValidationError as exc:
        raise HTTPException(422, {"error": "Invalid workflow", "errors": exc.errors, "warnings": exc.warnings}) from exc
    return {"run_id": run_id, "status": "running"}


@router.post("/workflows/run", status_code=202)
async def run_graph(payload: GraphPayload, request: Request):
    try:
        run_id = request.app.state.engine.start(payload.graph, None, "Ad-hoc workflow")
    except WorkflowValidationError as exc:
        raise HTTPException(422, {"error": "Invalid workflow", "errors": exc.errors, "warnings": exc.warnings}) from exc
    return {"run_id": run_id, "status": "running"}


@router.get("/workflow-runs")
def list_runs(request: Request, limit: int = 100):
    return {"runs": request.app.state.engine.list_runs(limit)}


@router.get("/workflow-runs/{run_id}")
def get_run(run_id: str, request: Request):
    try:
        return request.app.state.engine.get_run(run_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/workflow-runs/{run_id}/cancel")
def cancel_run(run_id: str, request: Request):
    if not request.app.state.engine.cancel(run_id):
        raise HTTPException(400, "Run is not active")
    return {"cancelled": True}


@router.get("/workflow-runs/{run_id}/events")
async def run_events(run_id: str, request: Request):
    engine = request.app.state.engine
    try:
        engine.get_run(run_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc

    async def stream():
        sent = 0
        idle = 0
        while True:
            state = engine.get_run_state(run_id)
            if state:
                events = list(state.events)
                status = state.status
            else:
                record = engine.get_run(run_id)
                events = record["events"]
                status = record["status"]
            while sent < len(events):
                yield "data: " + json.dumps(events[sent], default=str) + "\n\n"
                sent += 1
                idle = 0
            if status != "running":
                yield "data: " + json.dumps({"type": "stream_end", "status": status}) + "\n\n"
                break
            idle += 1
            if idle % 20 == 0:
                yield ": keep-alive\n\n"
            await asyncio.sleep(0.3)

    return StreamingResponse(
        stream(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
