"""Aggregated dashboard data for the home screen."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Request

from ..core.logging import recent_logs
from ..services.hardware import hardware_report

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard")
async def dashboard(request: Request):
    db = request.app.state.db
    settings = request.app.state.settings
    statuses = await request.app.state.runtimes.statuses(
        include_remote=bool(db.get_setting("remote_providers_enabled", False))
    )
    counts = {
        row["name"]: row["count"]
        for row in db.query(
            "SELECT 'conversations' AS name, COUNT(*) AS count FROM conversations "
            "UNION ALL SELECT 'workflows', COUNT(*) FROM workflows "
            "UNION ALL SELECT 'agents', COUNT(*) FROM agents "
            "UNION ALL SELECT 'knowledge_bases', COUNT(*) FROM knowledge_bases "
            "UNION ALL SELECT 'outputs', COUNT(*) FROM outputs "
            "UNION ALL SELECT 'installed_models', COUNT(*) FROM installed_models"
        )
    }
    recent_runs = db.query(
        "SELECT id, workflow_name AS name, 'workflow' AS kind, status, started_at, finished_at, error "
        "FROM workflow_runs UNION ALL "
        "SELECT id, agent_name AS name, 'agent' AS kind, status, started_at, finished_at, error "
        "FROM agent_runs ORDER BY started_at DESC LIMIT 8"
    )
    conversations = db.query(
        "SELECT id, title, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 5"
    )
    recent_outputs = db.query("SELECT * FROM outputs ORDER BY created_at DESC LIMIT 6")
    for output in recent_outputs:
        output["meta"] = json.loads(output.pop("meta_json") or "{}")
        output["url"] = f"/api/outputs/{output['id']}/file"
    downloads = request.app.state.downloads.list_downloads()
    active_downloads = [d for d in downloads if d["status"] in {"queued", "downloading"}]
    hardware = hardware_report(settings.data_dir, settings.models_dir)
    local_models = sum(len(status.models) for status in statuses if status.local)
    return {
        "counts": {
            **counts,
            "local_models": local_models,
            "active_runs": sum(1 for run in recent_runs if run["status"] == "running"),
        },
        "runtimes": [status.public() for status in statuses],
        "recent_runs": recent_runs,
        "conversations": conversations,
        "recent_outputs": recent_outputs,
        "downloads": downloads[:6],
        "active_downloads": len(active_downloads),
        "hardware": hardware,
        "logs": recent_logs(8),
        "local_only": settings.host in {"127.0.0.1", "localhost", "::1"},
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
