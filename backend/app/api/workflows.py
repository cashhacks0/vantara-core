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


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=3, max_length=4000)
    kb_id: str | None = None


@router.post("/workflows/generate")
def generate_workflow(payload: GenerateRequest, request: Request):
    """Map a natural-language request to a validated, runnable starter graph.

    This is a deterministic capability-aware planner (not a fabricated model
    claim).  It returns the graph plus the assumptions a user can inspect.
    """
    db = request.app.state.db
    prompt = payload.prompt.strip()
    lowered = prompt.lower()
    notes: list[str] = []
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []

    def add(node_id: str, node_type: str, x: int, config: dict[str, Any]) -> None:
        nodes.append({"id": node_id, "type": node_type, "position": {"x": x, "y": 160}, "config": config})

    def connect(a: str, b: str, source: str, target: str) -> None:
        edges.append({"id": f"e{len(edges) + 1}", "source": a, "target": b, "sourceHandle": source, "targetHandle": target})

    name = prompt.splitlines()[0][:80]
    if any(word in lowered for word in ("file", "document", "pdf", "summar", "report")) and "knowledge" not in lowered:
        uploads = sorted(request.app.state.settings.uploads_dir.glob("*")) if request.app.state.settings.uploads_dir.exists() else []
        upload = uploads[-1].name if uploads else ""
        if upload:
            add("file", "file_input", 40, {"path": upload})
            add("reader", "file_reader", 320, {"max_chars": 20000})
            add("template", "prompt_template", 600, {"template": f"Task: {prompt}\n\nDocument:\n{{context}}"})
            add("llm", "llm", 880, {"model": "auto", "temperature": 0.4, "max_tokens": 700, "system_prompt": "Summarize accurately and cite limitations from the supplied document."})
            add("out", "text_output", 1160, {"label": "Document result"})
            connect("file", "reader", "file", "file")
            connect("reader", "template", "text", "context")
            connect("template", "llm", "prompt", "prompt")
            connect("llm", "out", "text", "text")
            notes.append(f"Using the most recent upload: {upload}")
        else:
            add("input", "text_input", 40, {"text": "Paste the document text here, then run this workflow."})
            add("template", "prompt_template", 340, {"template": f"Task: {prompt}\n\nDocument:\n{{input}}"})
            add("llm", "llm", 640, {"model": "auto", "temperature": 0.4, "max_tokens": 700, "system_prompt": "Summarize accurately and cite limitations from the supplied document."})
            add("out", "text_output", 940, {"label": "Document result"})
            connect("input", "template", "text", "input")
            connect("template", "llm", "prompt", "prompt")
            connect("llm", "out", "text", "text")
            notes.append("No uploaded file was found, so a valid Text Input workflow was generated instead. Upload a document and regenerate for a File Reader graph.")
        kind = "document"
    elif "knowledge" in lowered or "search" in lowered and "web" not in lowered:
        kb_id = payload.kb_id
        if not kb_id:
            row = db.query_one("SELECT id FROM knowledge_bases ORDER BY updated_at DESC LIMIT 1")
            kb_id = row["id"] if row else ""
        add("input", "text_input", 40, {"text": "What are the key points in my knowledge base?"})
        add("search", "vector_search", 320, {"kb_id": kb_id, "top_k": 6})
        add("template", "prompt_template", 600, {"template": f"Task: {prompt}\n\nRetrieved context:\n{{context}}\n\nCite passages by their bracketed numbers."})
        add("llm", "llm", 880, {"model": "auto", "temperature": 0.3, "max_tokens": 700, "system_prompt": "Answer only from the retrieved context and cite sources."})
        add("out", "text_output", 1160, {"label": "Cited answer"})
        connect("input", "search", "text", "query")
        connect("search", "template", "text", "context")
        connect("template", "llm", "prompt", "prompt")
        connect("llm", "out", "text", "text")
        notes.append("Using this knowledge base: " + kb_id if kb_id else "No knowledge base exists. Create one before running this graph.")
        kind = "knowledge"
    elif "image" in lowered or "photo" in lowered or "picture" in lowered:
        images = [item for item in sorted(request.app.state.settings.uploads_dir.glob("*")) if item.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}] if request.app.state.settings.uploads_dir.exists() else []
        image = images[-1].name if images else ""
        add("image", "image_input", 40, {"path": image})
        add("resize", "image_resize", 340, {"width": 1024, "height": 1024, "mode": "contain"})
        add("out", "image_output", 640, {"name": "processed-image"})
        connect("image", "resize", "image", "image")
        connect("resize", "out", "image", "image")
        notes.append("Select an uploaded image before running." if not image else f"Using the most recent image upload: {image}")
        kind = "image"
    else:
        add("input", "text_input", 40, {"text": "Explain local-first AI in three concise sentences."})
        add("template", "prompt_template", 340, {"template": f"Task: {prompt}\n\nInput:\n{{input}}"})
        add("llm", "llm", 640, {"model": "auto", "temperature": 0.6, "max_tokens": 700, "system_prompt": "Follow the task and be precise. State uncertainty."})
        add("out", "text_output", 940, {"label": "Result"})
        connect("input", "template", "text", "input")
        connect("template", "llm", "prompt", "prompt")
        connect("llm", "out", "text", "text")
        kind = "text"

    graph = {"nodes": nodes, "edges": edges}
    validation = request.app.state.engine.validate(graph)
    if not validation["valid"]:
        notes.extend(validation["errors"])
    notes.append("Generated by VANTARA's capability-aware planner. Inspect and edit every node before running.")
    return {
        "name": name, "description": f"Generated {kind} workflow from: {prompt[:200]}",
        "graph": graph, "explanation": notes, "validation": validation,
        "kind": kind,
    }
