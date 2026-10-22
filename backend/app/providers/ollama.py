"""Ollama provider using its documented HTTP API."""
import json
from typing import Any, AsyncIterator

import httpx

from .base import InferenceProvider, ProviderError


class OllamaProvider(InferenceProvider):
    name = "ollama"

    def __init__(self, base_url: str, transport: httpx.AsyncBaseTransport | None = None):
        self.base_url = base_url.rstrip("/")
        self._transport = transport

    def _client(self, timeout: float | None = 10.0) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=self.base_url, timeout=timeout, transport=self._transport)

    async def _json(self, method: str, path: str, **kw: Any) -> dict[str, Any]:
        try:
            async with self._client() as c:
                r = await c.request(method, path, **kw)
                r.raise_for_status()
                data = r.json()
        except httpx.HTTPStatusError as e:
            raise ProviderError(f"Runtime returned HTTP {e.response.status_code}") from e
        except httpx.HTTPError as e:
            raise ProviderError(f"Cannot reach runtime at {self.base_url}") from e
        except ValueError as e:
            raise ProviderError("Runtime returned malformed JSON") from e
        if not isinstance(data, dict):
            raise ProviderError("Runtime returned an unexpected response")
        return data

    async def health_check(self) -> dict[str, Any]:
        data = await self._json("GET", "/api/version")
        return {"version": data.get("version")}

    async def list_models(self) -> list[dict[str, Any]]:
        data = await self._json("GET", "/api/tags")
        models = data.get("models", [])
        if not isinstance(models, list):
            raise ProviderError("Runtime returned malformed model list")
        return models

    async def show_model(self, name: str) -> dict[str, Any]:
        return await self._json("POST", "/api/show", json={"model": name})

    async def _stream(self, path: str, body: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
        try:
            async with self._client(timeout=None) as c:
                async with c.stream("POST", path, json=body) as r:
                    if r.status_code >= 400:
                        raise ProviderError(f"Runtime returned HTTP {r.status_code}")
                    async for line in r.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            yield json.loads(line)
                        except ValueError as e:
                            raise ProviderError("Malformed stream chunk") from e
        except httpx.HTTPError as e:
            raise ProviderError("Stream interrupted or runtime unreachable") from e

    def chat_stream(self, model: str, messages: list[dict[str, str]]) -> AsyncIterator[dict[str, Any]]:
        return self._stream("/api/chat", {"model": model, "messages": messages, "stream": True})

    async def generate(self, model: str, prompt: str) -> str:
        data = await self._json("POST", "/api/generate", json={"model": model, "prompt": prompt, "stream": False})
        return str(data.get("response", ""))

    def pull_model(self, name: str) -> AsyncIterator[dict[str, Any]]:
        return self._stream("/api/pull", {"model": name, "stream": True})

    async def delete_model(self, name: str, confirm: bool = False) -> None:
        if not confirm:
            raise ProviderError("Deletion requires explicit confirmation")
        try:
            async with self._client() as c:
                r = await c.request("DELETE", "/api/delete", json={"model": name})
                r.raise_for_status()
        except httpx.HTTPError as e:
            raise ProviderError("Could not delete model") from e
