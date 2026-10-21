"""Ollama runtime adapter (optional, auto-detected)."""

from __future__ import annotations

import json
from typing import AsyncIterator

import httpx

from ..core.logging import get_logger
from .base import (
    ChatMessage,
    GenerationOptions,
    RuntimeModel,
    RuntimeStatus,
    RuntimeUnavailable,
)

log = get_logger(__name__)


class OllamaRuntime:
    id = "ollama"
    label = "Ollama"

    def __init__(self, base_url: str = "http://127.0.0.1:11434"):
        self.base_url = base_url.rstrip("/")

    async def _client(self, timeout: float = 3.0) -> httpx.AsyncClient:
        return httpx.AsyncClient(base_url=self.base_url, timeout=timeout)

    async def status(self) -> RuntimeStatus:
        try:
            async with await self._client(2.0) as client:
                version_resp = await client.get("/api/version")
                tags_resp = await client.get("/api/tags")
            if version_resp.status_code != 200 or tags_resp.status_code != 200:
                raise RuntimeUnavailable(f"Ollama returned HTTP {version_resp.status_code}")
            raw_models = tags_resp.json().get("models", [])
            models = [self._map_model(item) for item in raw_models]
            return RuntimeStatus(
                id=self.id,
                label=self.label,
                available=True,
                configured=True,
                version=version_resp.json().get("version", "unknown"),
                detail=f"Connected at {self.base_url}. {len(models)} model(s) available.",
                capabilities=["chat", "text-generation", "embeddings"],
                models=models,
            )
        except (httpx.HTTPError, RuntimeUnavailable, ValueError) as exc:
            return RuntimeStatus(
                id=self.id,
                label=self.label,
                available=False,
                configured=True,
                detail="Ollama is not reachable.",
                error=str(exc)[:300],
                hint="Install Ollama from ollama.com, start it, then refresh runtimes.",
                capabilities=[],
                models=[],
            )

    def _map_model(self, item: dict) -> RuntimeModel:
        name = item.get("name") or item.get("model") or "unknown"
        details = item.get("details") or {}
        lowered = name.lower()
        task = "text-generation"
        if "embed" in lowered or "bge" in lowered or "nomic" in lowered:
            task = "embeddings"
        return RuntimeModel(
            id=name,
            name=name,
            runtime=self.id,
            task=task,
            size_bytes=int(item.get("size") or 0),
            quantization=details.get("quantization_level"),
            metadata={
                "family": details.get("family"),
                "parameter_size": details.get("parameter_size"),
                "modified_at": item.get("modified_at"),
            },
        )

    async def list_models(self) -> list[RuntimeModel]:
        try:
            async with await self._client(3.0) as client:
                resp = await client.get("/api/tags")
                resp.raise_for_status()
                return [self._map_model(m) for m in resp.json().get("models", [])]
        except (httpx.HTTPError, ValueError) as exc:
            log.debug("Ollama model listing failed: %s", exc)
            return []


    async def chat_stream(
        self,
        model: RuntimeModel,
        messages: list[ChatMessage],
        options: GenerationOptions,
    ) -> AsyncIterator[str]:
        payload = {
            "model": model.id,
            "messages": [m.as_dict() for m in messages],
            "stream": True,
            "options": {
                "temperature": options.temperature,
                "num_predict": options.max_tokens,
                "top_p": options.top_p,
                **({"stop": options.stop} if options.stop else {}),
            },
        }
        timeout = httpx.Timeout(connect=5.0, read=600.0, write=30.0, pool=30.0)
        try:
            async with httpx.AsyncClient(base_url=self.base_url, timeout=timeout) as client:
                async with client.stream("POST", "/api/chat", json=payload) as response:
                    if response.status_code != 200:
                        body = (await response.aread()).decode("utf-8", "replace")[:500]
                        raise RuntimeUnavailable(f"Ollama error {response.status_code}: {body}")
                    async for line in response.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            chunk = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if chunk.get("error"):
                            raise RuntimeUnavailable(f"Ollama: {chunk['error']}")
                        content = (chunk.get("message") or {}).get("content")
                        if content:
                            yield content
                        if chunk.get("done"):
                            break
        except httpx.ConnectError as exc:
            raise RuntimeUnavailable(
                "Ollama stopped responding. Is the service still running?", hint=self.base_url
            ) from exc

    async def embed(self, model: RuntimeModel, texts: list[str]) -> list[list[float]]:
        async with httpx.AsyncClient(base_url=self.base_url, timeout=120.0) as client:
            try:
                resp = await client.post("/api/embed", json={"model": model.id, "input": texts})
                if resp.status_code == 200:
                    return resp.json().get("embeddings", [])
            except httpx.HTTPError:
                pass
            vectors: list[list[float]] = []
            for text in texts:
                resp = await client.post(
                    "/api/embeddings", json={"model": model.id, "prompt": text}
                )
                resp.raise_for_status()
                vectors.append(resp.json()["embedding"])
            return vectors
