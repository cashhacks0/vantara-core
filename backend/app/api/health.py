"""Health and readiness endpoints."""

from __future__ import annotations

import time
from fastapi import APIRouter, Request

router = APIRouter(tags=["system"])


@router.get("/health")
def health(request: Request):
    settings = request.app.state.settings
    db_ok = True
    try:
        request.app.state.db.query_one("SELECT 1 AS ok")
    except Exception:
        db_ok = False
    return {
        "status": "ok" if db_ok else "degraded",
        "version": settings.version,
        "database": "ok" if db_ok else "error",
        "uptime_seconds": round(time.monotonic() - request.app.state.started_at, 1),
        "local_only": settings.host in {"127.0.0.1", "localhost", "::1"},
    }


@router.get("/ready")
def ready(request: Request):
    return {"ready": True}
