"""Project workspaces, AI coding tasks, commands, files, checkpoints, and previews."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from ..runtimes.base import RuntimeUnavailable
from ..services.projects import PROJECT_KINDS

router = APIRouter(prefix="/projects", tags=["projects"])


def _service(request: Request):
    return request.app.state.projects


@router.get("/kinds")
def project_kinds():
    return {"kinds": [{"value": key, "label": value} for key, value in PROJECT_KINDS.items()]}


@router.get("")
def list_projects(request: Request):
    return {"projects": _service(request).list_projects()}


class ProjectCreate(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    description: str = Field(default="", max_length=2000)
    kind: str | None = None
    prompt: str = Field(default="", max_length=8000)


@router.post("", status_code=201)
def create_project(payload: ProjectCreate, request: Request):
    try:
        return _service(request).create_project(payload.name, payload.description, payload.kind, payload.prompt)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/{project_id}")
def get_project(project_id: str, request: Request):
    try:
        return _service(request).get_project(project_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str, request: Request):
    try:
        _service(request).delete_project(project_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/{project_id}/tree")
def project_tree(project_id: str, request: Request):
    try:
        return {"files": _service(request).tree(project_id)}
    except (KeyError, FileNotFoundError) as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/{project_id}/file")
def read_project_file(project_id: str, request: Request, path: str):
    try:
        return _service(request).read_file(project_id, path)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


class FileWrite(BaseModel):
    path: str = Field(min_length=1, max_length=500)
    content: str = Field(max_length=512 * 1024)
    checkpoint: bool = True


@router.put("/{project_id}/file")
def write_project_file(project_id: str, payload: FileWrite, request: Request):
    service = _service(request)
    try:
        if payload.checkpoint:
            service.create_checkpoint(project_id, f"Before manual edit: {payload.path}")
        result = service.write_file(project_id, payload.path, payload.content)
        return {**result, "diff": service.diff(project_id)["summary"]}
    except (KeyError, FileNotFoundError) as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.delete("/{project_id}/file", status_code=204)
def delete_project_file(project_id: str, request: Request, path: str):
    try:
        _service(request).delete_file(project_id, path)
    except (KeyError, FileNotFoundError) as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/{project_id}/diff")
def project_diff(project_id: str, request: Request, checkpoint_id: str | None = None):
    try:
        return _service(request).diff(project_id, checkpoint_id)
    except (KeyError, FileNotFoundError) as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/{project_id}/checkpoints")
def list_checkpoints(project_id: str, request: Request):
    return {"checkpoints": _service(request).list_checkpoints(project_id)}


class CheckpointCreate(BaseModel):
    label: str = Field(default="Manual checkpoint", max_length=200)


@router.post("/{project_id}/checkpoints", status_code=201)
def create_checkpoint(project_id: str, payload: CheckpointCreate, request: Request):
    try:
        return _service(request).create_checkpoint(project_id, payload.label)
    except (KeyError, FileNotFoundError) as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/{project_id}/checkpoints/{checkpoint_id}/restore")
def restore_checkpoint(project_id: str, checkpoint_id: str, request: Request):
    try:
        return _service(request).restore_checkpoint(project_id, checkpoint_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc


class CommandRequest(BaseModel):
    command: str = Field(min_length=1, max_length=500)
    approved: bool = True


@router.post("/{project_id}/commands")
async def run_command(project_id: str, payload: CommandRequest, request: Request):
    try:
        return await _service(request).run_command(project_id, payload.command, payload.approved)
    except (KeyError, FileNotFoundError) as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/{project_id}/commands")
def list_commands(project_id: str, request: Request):
    return {"commands": _service(request).list_commands(project_id)}


@router.get("/{project_id}/tasks")
def list_tasks(project_id: str, request: Request):
    return {"tasks": _service(request).list_tasks(project_id)}


@router.get("/{project_id}/tasks/{task_id}")
def get_task(project_id: str, task_id: str, request: Request):
    try:
        return _service(request).get_task(project_id, task_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


class MemoryCreate(BaseModel):
    kind: str = "note"
    content: str = Field(min_length=1, max_length=8000)
    verified: bool = False


@router.get("/{project_id}/memory")
def list_memory(project_id: str, request: Request):
    return {"memory": _service(request).list_memory(project_id)}


@router.post("/{project_id}/memory", status_code=201)
def add_memory(project_id: str, payload: MemoryCreate, request: Request):
    try:
        return _service(request).add_memory(project_id, payload.kind, payload.content, source="user", verified=payload.verified)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.delete("/{project_id}/memory/{memory_id}", status_code=204)
def delete_memory(project_id: str, memory_id: str, request: Request):
    _service(request).delete_memory(project_id, memory_id)


class CodeRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)
    model_id: str = "auto"
    mode: str = "build"
    max_steps: int = Field(default=8, ge=1, le=10)


@router.post("/{project_id}/code/stream")
async def code_stream(project_id: str, payload: CodeRequest, request: Request):
    try:
        _service(request).get_project(project_id)
    except (KeyError, FileNotFoundError) as exc:
        raise HTTPException(404, str(exc)) from exc
    semaphore = request.app.state.chat_semaphore

    async def generate():
        acquired = False
        try:
            try:
                await asyncio.wait_for(semaphore.acquire(), timeout=30)
                acquired = True
            except asyncio.TimeoutError:
                yield "data: " + json.dumps({"type": "error", "error": "The local model queue is busy. Try again shortly."}) + "\n\n"
                return
            async for event in request.app.state.coding.stream_task(
                project_id, payload.prompt, payload.model_id, payload.mode, payload.max_steps,
                is_disconnected=request.is_disconnected,
            ):
                yield "data: " + json.dumps(event, default=str) + "\n\n"
            yield "data: [DONE]\n\n"
        finally:
            if acquired:
                semaphore.release()

    return StreamingResponse(
        generate(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@router.get("/{project_id}/preview")
@router.get("/{project_id}/preview/{path:path}")
def preview(project_id: str, request: Request, path: str = ""):
    try:
        target, mime = _service(request).preview_file(project_id, path or None)
    except (KeyError, FileNotFoundError) as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return FileResponse(
        target, media_type=mime,
        headers={
            "Content-Security-Policy": "default-src http: https: data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; frame-ancestors 'self'",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
        },
    )
