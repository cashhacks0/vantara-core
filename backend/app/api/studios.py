"""Image, audio, and video studio endpoints with honest capability gating."""

from __future__ import annotations

import json

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from ..core.db import new_id, utc_now
from ..services import studios as studio_service
from ..services.uploads import save_upload

router = APIRouter(prefix="/studios", tags=["studios"])


@router.get("/capabilities")
def capabilities(request: Request):
    settings = request.app.state.settings
    return studio_service.capabilities(settings.models_dir, settings.outputs_dir)


class ImageRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    negative_prompt: str = Field(default="", max_length=2000)
    model: str = ""
    width: int = Field(default=512, ge=64, le=2048)
    height: int = Field(default=512, ge=64, le=2048)
    steps: int = Field(default=24, ge=1, le=100)
    seed: int = -1


@router.post("/image/generate")
async def generate_image(payload: ImageRequest, request: Request):
    settings = request.app.state.settings
    caps = studio_service.capabilities(settings.models_dir, settings.outputs_dir)
    if not caps["image"]["available"]:
        raise HTTPException(503, {
            "error": caps["image"]["reason"],
            "hint": caps["image"]["hint"],
            "capability": "image",
        })
    try:
        result = await studio_service.generate_image(
            prompt=payload.prompt, negative_prompt=payload.negative_prompt,
            model=payload.model or caps["image"]["models"][0]["path"],
            width=payload.width, height=payload.height, steps=payload.steps,
            seed=payload.seed, outputs_dir=settings.outputs_dir,
        )
    except studio_service.StudioUnavailable as exc:
        raise HTTPException(503, {"error": str(exc), "hint": exc.hint}) from exc
    db = request.app.state.db
    db.insert(
        "outputs",
        {"id": result["output_id"], "kind": "image", "name": result["name"],
         "path": result["path"], "mime": "image/png",
         "meta_json": json.dumps({"prompt": result["prompt"], "seed": result["seed"],
                                   "model": result["model"], "studio": "image"}),
         "created_at": utc_now()},
    )
    result["url"] = f"/api/outputs/{result['output_id']}/file"
    return result


@router.post("/audio/transcribe")
async def transcribe_audio(request: Request, file: UploadFile = File(...)):
    settings = request.app.state.settings
    if file.filename and not file.filename.lower().endswith((".wav", ".mp3", ".m4a", ".ogg", ".flac", ".webm")):
        raise HTTPException(400, "Unsupported audio format.")
    try:
        metadata = await save_upload(file, settings.uploads_dir, max_bytes=50 * 1024 * 1024)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    from pathlib import Path

    try:
        result = await studio_service.transcribe(settings.uploads_dir / metadata["stored_name"])
    except studio_service.StudioUnavailable as exc:
        raise HTTPException(503, {"error": str(exc), "hint": exc.hint}) from exc
    return {**result, "file": metadata["name"]}


@router.post("/video/generate", status_code=501)
def generate_video(request: Request):
    raise HTTPException(501, {
        "error": "No local video generation backend is installed.",
        "hint": "The Video Studio interface and capability registry are ready; generation remains disabled until a backend adapter is implemented and tested.",
    })
