"""Hardware, storage, diagnostics, and log endpoints."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request

from ..core.logging import recent_logs
from ..security import mask_home
from ..services.hardware import disk_info, hardware_report

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/info")
def system_info(request: Request):
    settings = request.app.state.settings
    report = hardware_report(settings.data_dir, settings.models_dir)
    report["paths"] = {
        "data": mask_home(str(settings.data_dir)),
        "models": mask_home(str(settings.models_dir)),
        "uploads": mask_home(str(settings.uploads_dir)),
        "outputs": mask_home(str(settings.outputs_dir)),
    }
    return report


@router.get("/storage")
def storage(request: Request):
    settings = request.app.state.settings
    db = request.app.state.db

    def directory_size(path: Path) -> int:
        total = 0
        if path.exists():
            for item in path.rglob("*"):
                try:
                    if item.is_file():
                        total += item.stat().st_size
                except OSError:
                    continue
        return total

    models = db.query("SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes),0) AS bytes FROM installed_models")
    conversations = db.query("SELECT COUNT(*) AS n FROM conversations")
    messages = db.query("SELECT COUNT(*) AS n FROM messages")
    workflows = db.query("SELECT COUNT(*) AS n FROM workflows")
    return {
        "disk": disk_info(settings.data_dir),
        "models_disk": disk_info(settings.models_dir),
        "models": {"count": models[0]["n"], "tracked_bytes": models[0]["bytes"],
                    "directory_bytes": directory_size(settings.models_dir)},
        "uploads": {"directory_bytes": directory_size(settings.uploads_dir),
                     "count": len(list(settings.uploads_dir.glob("*"))) if settings.uploads_dir.exists() else 0},
        "outputs": {"directory_bytes": directory_size(settings.outputs_dir),
                     "count": len(list(settings.outputs_dir.glob("*"))) if settings.outputs_dir.exists() else 0},
        "conversations": conversations[0]["n"],
        "messages": messages[0]["n"],
        "workflows": workflows[0]["n"],
        "database_bytes": settings.db_path.stat().st_size if settings.db_path.exists() else 0,
        "paths": {"models": mask_home(str(settings.models_dir)), "outputs": mask_home(str(settings.outputs_dir))},
    }


@router.get("/logs")
def logs(limit: int = 100):
    return {"logs": recent_logs(max(1, min(limit, 500)))}


@router.get("/diagnostics")
async def diagnostics(request: Request):
    runtimes = request.app.state.runtimes
    statuses = await runtimes.statuses(include_remote=True)
    settings = request.app.state.settings
    return {
        "app": {"version": settings.version, "data_dir": mask_home(str(settings.data_dir))},
        "runtimes": [status.public() for status in statuses],
        "llama_server_log": _tail(settings.logs_dir / "llama-server.log"),
        "config": {
            "host": settings.host,
            "port": settings.port,
            "hf_token_configured": bool(settings.hf_token),
            "allow_workflow_http": settings.allow_workflow_http,
            "allow_remote_providers": settings.allow_remote_providers,
        },
    }


def _tail(path: Path, lines: int = 40) -> str:
    try:
        return "\n".join(path.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:])
    except OSError:
        return ""
