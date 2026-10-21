"""Settings and provider configuration endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..security import reveal_secret

router = APIRouter(tags=["settings"])

ALLOWED_SETTINGS = {
    "theme", "default_model", "default_assistant", "assistant_name",
    "assistant_system_prompt", "send_on_enter", "stream_responses",
    "telemetry_enabled", "retain_chat_history", "remote_providers_enabled",
    "llama_context", "llama_threads", "auto_start_llama", "active_llama_model",
    "max_concurrent_generations",
}


def _public_settings(request: Request) -> dict[str, Any]:
    settings = request.app.state.settings
    values = request.app.state.db.get_settings()
    values["hf_token_configured"] = bool(settings.hf_token)
    values["llama_server_configured"] = bool(settings.llama_server_path and settings.llama_server_path.exists())
    values["llama_server_path"] = str(settings.llama_server_path) if settings.llama_server_path else None
    values["workflow_http_allowed"] = settings.allow_workflow_http
    values["bind_host"] = settings.host
    values["version"] = settings.version
    return values


@router.get("/settings")
def get_settings(request: Request):
    return _public_settings(request)


class SettingsUpdate(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict)


@router.put("/settings")
def update_settings(payload: SettingsUpdate, request: Request):
    db = request.app.state.db
    unknown = set(payload.values) - ALLOWED_SETTINGS
    if unknown:
        raise HTTPException(400, f"Unknown settings: {', '.join(sorted(unknown))}")
    cleaned: dict[str, Any] = {}
    for key, value in payload.values.items():
        if key == "llama_context":
            value = max(512, min(int(value), 32768))
        elif key == "llama_threads":
            value = max(1, min(int(value), 64))
        elif key == "max_concurrent_generations":
            value = max(1, min(int(value), 4))
        elif key in {"telemetry_enabled", "retain_chat_history", "remote_providers_enabled", "send_on_enter", "stream_responses", "auto_start_llama"}:
            value = bool(value)
        elif key in {"theme", "default_model", "default_assistant", "assistant_name", "active_llama_model"}:
            value = None if value is None else str(value)[:500]
        elif key == "assistant_system_prompt":
            value = str(value)[:20000]
        cleaned[key] = value
    db.set_settings(cleaned)
    if "remote_providers_enabled" in cleaned:
        request.app.state.runtimes.invalidate_provider()
    if "llama_context" in cleaned:
        request.app.state.runtimes.llama.context = int(cleaned["llama_context"])
    if "llama_threads" in cleaned:
        request.app.state.runtimes.llama.threads = int(cleaned["llama_threads"])
    if "max_concurrent_generations" in cleaned:
        request.app.state.chat_semaphore = __import__("asyncio").Semaphore(int(cleaned["max_concurrent_generations"]))
    db.audit("settings.updated", ", ".join(sorted(cleaned)))
    return _public_settings(request)


class ProviderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    base_url: str = Field(min_length=4, max_length=500)
    api_key: str | None = Field(default=None, max_length=1000)
    kind: str = "openai-compatible"
    enabled: bool = False


class ProviderUpdate(BaseModel):
    name: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    enabled: bool | None = None


def _validate_base_url(url: str) -> str:
    from urllib.parse import urlparse

    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(400, "Provider base URL must be a valid http(s) URL.")
    if parsed.username or parsed.password:
        raise HTTPException(400, "Do not embed credentials in the base URL.")
    return url.rstrip("/")


def _provider_public(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"], "name": row["name"], "kind": row["kind"],
        "base_url": row["base_url"], "enabled": bool(row["enabled"]),
        "has_key": bool(row["api_key_enc"]),
        "key_hint": "configured" if row["api_key_enc"] else None,
        "created_at": row["created_at"],
    }


@router.get("/providers")
def list_providers(request: Request):
    rows = request.app.state.db.query("SELECT * FROM providers ORDER BY created_at")
    return {
        "providers": [_provider_public(row) for row in rows],
        "remote_allowed_by_env": request.app.state.settings.allow_remote_providers,
    }


@router.post("/providers", status_code=201)
def create_provider(payload: ProviderCreate, request: Request):
    from ..core.db import new_id, utc_now

    db = request.app.state.db
    secrets = request.app.state.secrets
    now = utc_now()
    provider_id = new_id("prov_")
    db.insert(
        "providers",
        {
            "id": provider_id, "name": payload.name.strip()[:100], "kind": payload.kind,
            "base_url": _validate_base_url(payload.base_url),
            "api_key_enc": secrets.encrypt(payload.api_key) if payload.api_key else None,
            "enabled": 1 if payload.enabled else 0, "created_at": now, "updated_at": now,
        },
    )
    request.app.state.runtimes.invalidate_provider(provider_id)
    db.audit("provider.created", provider_id)
    row = db.query_one("SELECT * FROM providers WHERE id = ?", (provider_id,))
    return _provider_public(row)


@router.put("/providers/{provider_id}")
def update_provider(provider_id: str, payload: ProviderUpdate, request: Request):
    from ..core.db import utc_now

    db = request.app.state.db
    secrets = request.app.state.secrets
    if not db.query_one("SELECT id FROM providers WHERE id = ?", (provider_id,)):
        raise HTTPException(404, "Provider not found")
    update: dict[str, Any] = {"updated_at": utc_now()}
    if payload.name is not None:
        update["name"] = payload.name.strip()[:100]
    if payload.base_url is not None:
        update["base_url"] = _validate_base_url(payload.base_url)
    if payload.api_key is not None:
        update["api_key_enc"] = secrets.encrypt(payload.api_key) if payload.api_key else None
    if payload.enabled is not None:
        update["enabled"] = 1 if payload.enabled else 0
    db.update("providers", provider_id, update)
    request.app.state.runtimes.invalidate_provider(provider_id)
    db.audit("provider.updated", provider_id)
    row = db.query_one("SELECT * FROM providers WHERE id = ?", (provider_id,))
    return _provider_public(row)


@router.delete("/providers/{provider_id}", status_code=204)
def delete_provider(provider_id: str, request: Request):
    request.app.state.db.execute("DELETE FROM providers WHERE id = ?", (provider_id,))
    request.app.state.runtimes.invalidate_provider(provider_id)
    request.app.state.db.audit("provider.deleted", provider_id)


@router.post("/providers/{provider_id}/test")
async def test_provider(provider_id: str, request: Request):
    runtime = next((p for p in request.app.state.runtimes.remote_providers() if p.provider_id == provider_id), None)
    if not runtime:
        raise HTTPException(404, "Provider not found")
    status = await runtime.status()
    return status.public()
