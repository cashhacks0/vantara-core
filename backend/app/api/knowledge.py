"""Knowledge base management, document ingestion, search, and RAG answers."""

from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from ..runtimes.base import RuntimeUnavailable
from ..security import safe_filename, safe_join

router = APIRouter(tags=["knowledge"])


@router.get("/knowledge-bases")
def list_kbs(request: Request):
    return {"knowledge_bases": request.app.state.knowledge.list_kbs()}


class KBCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    embedding_model: str | None = None


class KBUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    embedding_model: str | None = None


@router.post("/knowledge-bases", status_code=201)
def create_kb(payload: KBCreate, request: Request):
    return request.app.state.knowledge.create_kb(payload.name, payload.description, payload.embedding_model)


@router.get("/knowledge-bases/{kb_id}")
def get_kb(kb_id: str, request: Request):
    try:
        return request.app.state.knowledge.get_kb(kb_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.put("/knowledge-bases/{kb_id}")
def update_kb(kb_id: str, payload: KBUpdate, request: Request):
    try:
        return request.app.state.knowledge.update_kb(kb_id, payload.model_dump(exclude_none=True))
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.delete("/knowledge-bases/{kb_id}", status_code=204)
def delete_kb(kb_id: str, request: Request):
    request.app.state.knowledge.delete_kb(kb_id)


MAX_KB_FILE = 30 * 1024 * 1024


@router.post("/knowledge-bases/{kb_id}/documents", status_code=201)
async def upload_document(kb_id: str, request: Request, file: UploadFile = File(...)):
    settings = request.app.state.settings
    knowledge = request.app.state.knowledge
    try:
        knowledge.get_kb(kb_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    data = await file.read(MAX_KB_FILE + 1)
    if len(data) > MAX_KB_FILE:
        raise HTTPException(400, "Document exceeds the 30 MB limit.")
    if not data:
        raise HTTPException(400, "Document is empty.")
    original = safe_filename(file.filename or "document")
    stored = safe_join(settings.uploads_dir, f"{uuid.uuid4().hex[:10]}-{original}")
    stored.write_bytes(data)
    import asyncio

    document = await asyncio.to_thread(
        knowledge.ingest_file, kb_id, original, stored, file.content_type
    )
    return document


@router.delete("/knowledge-bases/{kb_id}/documents/{document_id}", status_code=204)
def delete_document(kb_id: str, document_id: str, request: Request):
    try:
        request.app.state.knowledge.delete_document(document_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    top_k: int = Field(default=6, ge=1, le=20)


@router.post("/knowledge-bases/{kb_id}/search")
def search_kb(kb_id: str, payload: SearchRequest, request: Request):
    try:
        return request.app.state.knowledge.search(kb_id, payload.query, payload.top_k)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    model_id: str = "auto"
    top_k: int = Field(default=6, ge=1, le=20)


@router.post("/knowledge-bases/{kb_id}/ask")
async def ask_kb(kb_id: str, payload: AskRequest, request: Request):
    try:
        return await request.app.state.knowledge.ask(kb_id, payload.question, payload.model_id, payload.top_k)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except RuntimeUnavailable as exc:
        raise HTTPException(400, {"error": str(exc), "hint": exc.hint}) from exc
