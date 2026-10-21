"""Runtime discovery, diagnostics, and local model listing."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..runtimes.base import RuntimeUnavailable
from ..services.hardware import recommend_quantization, hardware_report

router = APIRouter(tags=["runtimes"])


@router.get("/runtimes")
async def list_runtimes(request: Request):
    runtimes = request.app.state.runtimes
    db = request.app.state.db
    include_remote = bool(db.get_setting("remote_providers_enabled", False))
    statuses = await runtimes.statuses(include_remote=include_remote)
    return {"runtimes": [status.public() for status in statuses]}


@router.post("/runtimes/{runtime_id}/test")
async def test_runtime(runtime_id: str, request: Request):
    runtimes = request.app.state.runtimes
    mapping = {"llama.cpp": runtimes.llama, "ollama": runtimes.ollama, "transformers": runtimes.transformers}
    runtime = mapping.get(runtime_id)
    if not runtime:
        raise HTTPException(404, "Unknown runtime")
    return (await runtime.status()).public()


class LoadModel(BaseModel):
    model: str


@router.post("/runtimes/llama/load")
async def load_llama_model(payload: LoadModel, request: Request):
    runtimes = request.app.state.runtimes
    try:
        resolved = await runtimes.resolve(f"llama.cpp::{payload.model}")
        await runtimes.llama.ensure_loaded(resolved.model)
    except RuntimeUnavailable as exc:
        raise HTTPException(400, {"error": str(exc), "hint": exc.hint}) from exc
    return {"loaded": resolved.model.public(), "port": runtimes.llama.port}


@router.post("/runtimes/llama/stop")
async def stop_llama(request: Request):
    await request.app.state.runtimes.llama.stop()
    return {"stopped": True}


@router.get("/models/local")
async def local_models(request: Request):
    runtimes = request.app.state.runtimes
    downloads = request.app.state.downloads
    settings = request.app.state.settings
    statuses = await runtimes.statuses()
    report = hardware_report(settings.data_dir, settings.models_dir)
    models = []
    for status in statuses:
        for model in status.models:
            models.append({
                **model.public(), "runtime_available": status.available,
                "recommendation": recommend_quantization(report["memory"]["available_bytes"], model.size_bytes),
            })
    return {
        "models": models,
        "installed": downloads.installed(),
        "runtimes": [status.public() for status in statuses],
        "hardware": report,
    }
