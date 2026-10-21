"""Remote OpenAI-compatible provider adapter (explicit opt-in only)."""

from __future__ import annotations

import json
from typing import AsyncIterator

import httpx

from ..security import SecretBox, tls_verify
from .base import (
    ChatMessage,
    GenerationOptions,
    RuntimeModel,
    RuntimeStatus,
    RuntimeUnavailable,
)


class RemoteProviderRuntime:
    id = "remote"
    label = "Remote provider"

    def __init__(self, db, secret_box: SecretBox, provider_id: str):
        self.db = db
        self.secret_box = secret_box
        row = db.query_one("SELECT * FROM providers WHERE id = ?", (provider_id,))
        if not row:
            raise RuntimeUnavailable("Provider configuration not found")
        self.row = row
        self.provider_id = provider_id
        self.name = row["name"]
        self.base_url = row["base_url"].rstrip("/")
        self.enabled = bool(row["enabled"])
        self.api_key = secret_box.decrypt(row["api_key_enc"])

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _models(self) -> list[RuntimeModel]:
        try:
            resp = httpx.get(
                f"{self.base_url}/models", headers=self._headers(), timeout=6.0,
                verify=tls_verify(),
            )
            resp.raise_for_status()
            data = resp.json()
            entries = data.get("data") if isinstance(data, dict) else data
            return [
                RuntimeModel(
                    id=str(entry.get("id")),
                    name=str(entry.get("id")),
                    runtime=self.id,
                    task="text-generation",
                    metadata={"provider": self.name, "provider_id": self.provider_id},
                )
                for entry in (entries or [])
                if isinstance(entry, dict) and entry.get("id")
            ]
        except (httpx.HTTPError, ValueError):
            return []

    async def status(self) -> RuntimeStatus:
        if not self.enabled:
            return RuntimeStatus(
                id=self.id,
                label=f"{self.name} (remote)",
                available=False,
                configured=True,
                detail="Provider is disabled.",
                local=False,
                hint="Enable this provider in Settings → Providers after reviewing data-sharing implications.",
            )
        models = self._models()
        return RuntimeStatus(
            id=self.id,
            label=f"{self.name} (remote)",
            available=bool(models),
            configured=True,
            detail=f"{len(models)} model(s) listed by {self.base_url}." if models else "No models returned.",
            error=None if models else "Could not list remote models. Check the base URL and API key.",
            capabilities=["chat", "text-generation"],
            models=models,
            local=False,
        )

    async def list_models(self) -> list[RuntimeModel]:
        return self._models() if self.enabled else []

    async def chat_stream(
        self,
        model: RuntimeModel,
        messages: list[ChatMessage],
        options: GenerationOptions,
    ) -> AsyncIterator[str]:
        if not self.enabled:
            raise RuntimeUnavailable("This remote provider is disabled.")
        payload = {
            "model": model.id,
            "messages": [m.as_dict() for m in messages],
            "temperature": options.temperature,
            "max_tokens": options.max_tokens,
            "stream": True,
        }
        timeout = httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=30.0)
        async with httpx.AsyncClient(timeout=timeout, verify=tls_verify()) as client:
            async with client.stream(
                "POST", f"{self.base_url}/chat/completions", json=payload, headers=self._headers()
            ) as response:
                if response.status_code != 200:
                    body = (await response.aread()).decode("utf-8", "replace")[:500]
                    raise RuntimeUnavailable(
                        f"Remote provider returned HTTP {response.status_code}: {body}"
                    )
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                        delta = chunk["choices"][0].get("delta", {}).get("content")
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue
                    if delta:
                        yield delta
