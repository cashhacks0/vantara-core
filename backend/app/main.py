"""VANTARA AI FastAPI application."""

from __future__ import annotations

import asyncio
import json
import secrets
import logging
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from . import nodes as _nodes  # noqa: F401  registers built-in workflow nodes
from .api import agents as agents_api
from .api import catalog as catalog_api
from .api import chat as chat_api
from .api import dashboard as dashboard_api
from .api import health as health_api
from .api import knowledge as knowledge_api
from .api import outputs as outputs_api
from .api import runtimes as runtimes_api
from .api import settings as settings_api
from .api import studios as studios_api
from .api import system as system_api
from .api import workflows as workflows_api
from .agents.service import AgentService
from .core.config import Settings
from .core.db import Database, new_id, utc_now
from .core.logging import configure_logging, get_logger
from .knowledge.service import KnowledgeService
from .runtimes.registry import RuntimeManager
from .security import RateLimiter, SecretBox
from .services.catalog import HuggingFaceCatalog
from .services.chat import ChatService
from .services.downloads import DownloadManager
from .services.hardware import hardware_report
from .workflow_engine.executor import WorkflowEngine
from .workflow_engine.templates import seed_templates

log = get_logger(__name__)


def _seed_default_agent(db: Database) -> None:
    if db.query_one("SELECT id FROM agents LIMIT 1"):
        return
    now = utc_now()
    db.insert(
        "agents",
        {
            "id": new_id("agt_"),
            "name": "VANTARA Research",
            "description": "Answers questions with a local model, optionally using approved tools.",
            "system_prompt": (
                "You are VANTARA Research, a careful local-first assistant. Plan briefly, use "
                "only approved tools, cite knowledge sources when you use them, and be explicit "
                "about missing information."
            ),
            "model_id": "auto",
            "tools_json": json.dumps(["calculator", "search_knowledge", "write_output"]),
            "max_steps": 5,
            "require_approval": 1,
            "created_at": now,
            "updated_at": now,
        },
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    settings.ensure_dirs()
    configure_logging(settings.log_path)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        db = Database(settings.db_path)
        db.init()
        secrets = SecretBox(settings.secret_key_path)
        runtimes = RuntimeManager(db, settings, secrets)
        knowledge = KnowledgeService(db, runtimes, settings.uploads_dir)
        engine = WorkflowEngine(db, runtimes, knowledge, settings)
        agent_service = AgentService(db, runtimes, knowledge, settings, engine)
        chat_service = ChatService(db, runtimes)
        downloads = DownloadManager(db, settings)
        seed_templates(db)
        _seed_default_agent(db)
        # Runs cannot survive a process restart; mark them interrupted instead of
        # leaving permanently "running" rows in history.
        db.execute(
            "UPDATE workflow_runs SET status = 'failed', finished_at = ?, "
            "error = COALESCE(error, 'Interrupted: backend restarted before completion') "
            "WHERE status = 'running'",
            (utc_now(),),
        )
        db.execute(
            "UPDATE agent_runs SET status = 'failed', finished_at = ?, "
            "error = COALESCE(error, 'Interrupted: backend restarted before completion') "
            "WHERE status = 'running'",
            (utc_now(),),
        )

        app.state.settings = settings
        app.state.db = db
        app.state.secrets = secrets
        app.state.runtimes = runtimes
        app.state.knowledge = knowledge
        app.state.engine = engine
        app.state.agents = agent_service
        app.state.chat = chat_service
        app.state.catalog = HuggingFaceCatalog(settings)
        app.state.downloads = downloads
        app.state.rate_limiter = RateLimiter(settings.rate_limit_per_minute)
        app.state.started_at = time.monotonic()
        active = db.get_settings()
        app.state.chat_semaphore = asyncio.Semaphore(int(active.get("max_concurrent_generations") or 1))
        log.info("VANTARA AI started", extra={"extra_fields": {"version": __version__, "data_dir": str(settings.data_dir)}})
        try:
            yield
        finally:
            await runtimes.shutdown()
            log.info("VANTARA AI stopped")

    app = FastAPI(
        title="VANTARA AI", version=__version__, lifespan=lifespan,
        docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-Request-ID"],
    )

    @app.middleware("http")
    async def security_middleware(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        started = time.monotonic()
        if settings.access_token:
            supplied = request.cookies.get("vantara_access")
            query_token = request.query_params.get("access")
            authorized = bool(supplied) and secrets.compare_digest(supplied or "", settings.access_token)
            if query_token and secrets.compare_digest(query_token, settings.access_token):
                response = RedirectResponse(url="/", status_code=303)
                response.set_cookie(
                    "vantara_access", settings.access_token, max_age=7 * 24 * 3600,
                    httponly=True, samesite="lax", path="/",
                )
                return response
            if not authorized:
                if request.url.path.startswith("/api"):
                    return JSONResponse(
                        {"detail": "Access token required for this deployment."},
                        status_code=401,
                    )
                login = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>VANTARA AI — Access</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#09090b;color:#f4f4f5;font-family:system-ui,sans-serif}main{width:min(360px,90vw);padding:28px;border:1px solid #26262e;border-radius:14px;background:#101014}input{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #33333d;background:#0b0b0e;color:#fff;margin-top:10px}button{margin-top:12px;width:100%;padding:10px;border:0;border-radius:8px;background:#8b5cf6;color:#fff;font-weight:600;cursor:pointer}p{color:#8d8d99;font-size:13px;line-height:1.5}h1{font-size:15px;letter-spacing:.12em}</style>
</head><body><main><h1>VANTARA AI</h1><p>This deployment requires an access token. Open the full link provided by the operator to continue.</p><form method="get" action="/"><input name="access" type="password" placeholder="Access token" autocomplete="current-password"><button>Open workspace</button></form></main></body></html>"""
                return HTMLResponse(login, status_code=401)
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            length = request.headers.get("content-length")
            if length and int(length) > settings.request_max_bytes:
                return JSONResponse(
                    {"detail": f"Request body exceeds {settings.request_max_bytes // (1024 * 1024)} MB."},
                    status_code=413, headers={"X-Request-ID": request_id},
                )
        client = request.client.host if request.client else "local"
        if request.url.path.startswith("/api"):
            allowed, retry = request.app.state.rate_limiter.check(client)
            if not allowed:
                return JSONResponse(
                    {"detail": "Rate limit exceeded. Slow down and retry."},
                    status_code=429, headers={"Retry-After": str(retry), "X-Request-ID": request_id},
                )
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Process-Time-Ms"] = str(int((time.monotonic() - started) * 1000))
        return response

    @app.exception_handler(Exception)
    async def unhandled_exception(request: Request, exc: Exception):
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(
            {"detail": "Internal server error. Check the application logs.", "request_id": request.headers.get("x-request-id")},
            status_code=500,
        )

    for router in (
        health_api.router, dashboard_api.router, system_api.router, settings_api.router,
        chat_api.router, catalog_api.router, runtimes_api.router, workflows_api.router,
        agents_api.router, knowledge_api.router, studios_api.router, outputs_api.router,
    ):
        app.include_router(router, prefix="/api")

    @app.get("/api")
    def api_root():
        return {
            "name": "VANTARA AI", "version": __version__, "docs": "/api/docs",
            "local_first": True,
        }

    frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if frontend_dist.exists():
        assets = frontend_dist / "assets"
        if assets.exists():
            app.mount("/assets", StaticFiles(directory=assets), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        def spa(full_path: str):
            if full_path.startswith(("api/", "docs")):
                return JSONResponse({"detail": "Not found"}, status_code=404)
            candidate = (frontend_dist / full_path).resolve()
            if frontend_dist.resolve() in candidate.parents and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(frontend_dist / "index.html")

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    cfg = Settings.from_env()
    uvicorn.run("app.main:app", host=cfg.host, port=cfg.port, reload=False)
