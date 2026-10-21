"""Conversation, chat streaming, upload, and export endpoints."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from ..runtimes.base import GenerationOptions
from ..services.uploads import list_uploads, save_upload

router = APIRouter(tags=["chat"])


def _service(request: Request):
    return request.app.state.chat


@router.get("/conversations")
def list_conversations(request: Request, search: str = ""):
    return {"conversations": _service(request).list_conversations(search[:200])}


class ConversationCreate(BaseModel):
    title: str = "New conversation"
    model_id: str | None = None
    system_prompt: str | None = None


@router.post("/conversations", status_code=201)
def create_conversation(payload: ConversationCreate, request: Request):
    return _service(request).create_conversation(payload.title, payload.model_id, payload.system_prompt)


@router.get("/conversations/{conversation_id}")
def get_conversation(conversation_id: str, request: Request):
    try:
        return _service(request).get_conversation(conversation_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


class ConversationUpdate(BaseModel):
    title: str | None = None
    model_id: str | None = None
    system_prompt: str | None = None
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=16, le=8192)
    pinned: bool | None = None


@router.put("/conversations/{conversation_id}")
def update_conversation(conversation_id: str, payload: ConversationUpdate, request: Request):
    try:
        data = payload.model_dump(exclude_none=True)
        if "pinned" in data:
            data["pinned"] = 1 if data["pinned"] else 0
        return _service(request).update_conversation(conversation_id, data)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.delete("/conversations/{conversation_id}", status_code=204)
def delete_conversation(conversation_id: str, request: Request):
    _service(request).delete_conversation(conversation_id)


@router.delete("/conversations", status_code=200)
def delete_all_conversations(request: Request):
    count = _service(request).delete_all_conversations()
    return {"deleted": count}


@router.get("/conversations/{conversation_id}/export")
def export_conversation(conversation_id: str, request: Request, format: str = "markdown"):
    try:
        conversation = _service(request).get_conversation(conversation_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    safe_title = "".join(c if c.isalnum() or c in " -_" else "_" for c in conversation["title"])[:60]
    if format == "json":
        body = json.dumps(conversation, indent=2)
        return Response(
            body, media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{safe_title}.json"'},
        )
    lines = [f"# {conversation['title']}", "", f"Exported from VANTARA AI · {datetime.utcnow().isoformat()}Z", ""]
    for message in conversation["messages"]:
        lines.append(f"## {message['role'].capitalize()}")
        lines.append("")
        lines.append(message["content"])
        lines.append("")
    return Response(
        "\n".join(lines), media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="{safe_title}.md"'},
    )


@router.post("/uploads", status_code=201)
async def upload_file(request: Request, file: UploadFile = File(...)):
    try:
        metadata = await save_upload(file, request.app.state.settings.uploads_dir)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    request.app.state.db.audit("upload.created", metadata["stored_name"])
    return metadata


@router.get("/uploads")
def get_uploads(request: Request):
    return {"uploads": list_uploads(request.app.state.settings.uploads_dir)}


class StreamRequest(BaseModel):
    message: str | None = None
    model_id: str | None = None
    temperature: float = Field(default=0.7, ge=0, le=2)
    max_tokens: int = Field(default=1024, ge=16, le=8192)
    attachments: list[dict] = Field(default_factory=list)
    replace_message_id: str | None = None
    regenerate_message_id: str | None = None


@router.post("/conversations/{conversation_id}/stream")
async def stream_chat(conversation_id: str, payload: StreamRequest, request: Request):
    service = _service(request)
    try:
        service.get_conversation(conversation_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    options = GenerationOptions(temperature=payload.temperature, max_tokens=payload.max_tokens)
    semaphore = request.app.state.chat_semaphore

    async def generate():
        acquired = False
        try:
            try:
                await asyncio.wait_for(semaphore.acquire(), timeout=30)
                acquired = True
            except asyncio.TimeoutError:
                yield "data: " + json.dumps({"type": "error", "error": "The local inference queue is busy. Try again shortly."}) + "\n\n"
                return
            async for event in service.stream_reply(
                conversation_id,
                content=payload.message,
                model_id=payload.model_id,
                options=options,
                attachments=payload.attachments,
                replace_message_id=payload.replace_message_id,
                regenerate_message_id=payload.regenerate_message_id,
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
