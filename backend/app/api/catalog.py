"""Hugging Face catalog, downloads, and installed models."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from ..services.catalog import CatalogError, TASK_FILTERS
from ..services.downloads import DownloadError
from ..services.hardware import hardware_report, recommend_quantization

router = APIRouter(tags=["catalog"])


@router.get("/catalog/tasks")
def tasks():
    return {
        "tasks": TASK_FILTERS,
        "sort_options": ["downloads", "likes", "lastModified", "createdAt", "trendingScore"],
        "libraries": ["gguf", "transformers", "diffusers", "sentence-transformers", "timm", "peft"],
    }


@router.get("/catalog/search")
async def search(
    request: Request,
    q: str = "",
    task: str | None = None,
    library: str | None = None,
    author: str | None = None,
    sort: str = "downloads",
    direction: str = "-1",
    cursor: str | None = None,
    limit: int = Query(default=30, ge=1, le=100),
    tag: str | None = None,
    license: str | None = None,
):
    try:
        return await request.app.state.catalog.search(
            query=q[:200], task=task, library=library, author=author,
            sort=sort, direction=direction, cursor=cursor, limit=limit,
            tag=tag, license_filter=license,
        )
    except CatalogError as exc:
        raise HTTPException(502, str(exc)) from exc


@router.get("/catalog/models/{repo_id:path}")
async def model_detail(repo_id: str, request: Request):
    try:
        detail = await request.app.state.catalog.model_detail(repo_id)
    except (CatalogError, ValueError) as exc:
        raise HTTPException(404, str(exc)) from exc
    settings = request.app.state.settings
    report = hardware_report(settings.data_dir, settings.models_dir)
    installed = request.app.state.downloads.installed()
    installed_files = {item["filename"] for item in installed if item["repo_id"] == repo_id}
    for file in detail["gguf_files"]:
        file["installed"] = file["filename"] in installed_files
        file["recommendation"] = recommend_quantization(
            report["memory"]["available_bytes"], file["size_bytes"]
        )
        file["runtime"] = "llama.cpp"
    detail["readme"] = await request.app.state.catalog.readme(repo_id)
    detail["hardware"] = {
        "memory_available_bytes": report["memory"]["available_bytes"],
        "gpus": report["gpus"],
    }
    detail["installed_files"] = sorted(installed_files)
    return detail


class DownloadCreate(BaseModel):
    repo_id: str
    filename: str


@router.post("/downloads", status_code=202)
def start_download(payload: DownloadCreate, request: Request):
    try:
        return request.app.state.downloads.start(payload.repo_id, payload.filename)
    except (DownloadError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/downloads")
def list_downloads(request: Request):
    return {"downloads": request.app.state.downloads.list_downloads()}


@router.post("/downloads/{download_id}/cancel")
def cancel_download(download_id: str, request: Request):
    try:
        return request.app.state.downloads.cancel(download_id)
    except DownloadError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/downloads/{download_id}/retry")
def retry_download(download_id: str, request: Request):
    downloads = request.app.state.downloads
    record = downloads.get(download_id)
    if not record:
        raise HTTPException(404, "Download not found")
    try:
        return downloads.start(record["repo_id"], record["filename"])
    except (DownloadError, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/models/installed")
def installed(request: Request):
    return {"models": request.app.state.downloads.installed()}


@router.delete("/models/installed/{model_id}", status_code=200)
def remove_model(model_id: str, request: Request):
    try:
        request.app.state.downloads.remove_installed(model_id)
    except DownloadError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"removed": model_id}
