"""Runtime discovery and model resolution."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..core.config import Settings
from ..core.db import Database
from ..security import SecretBox
from .base import RuntimeModel, RuntimeStatus, RuntimeUnavailable
from .llamacpp import LlamaCppRuntime
from .ollama import OllamaRuntime
from .remote import RemoteProviderRuntime
from .transformers_adapter import TransformersRuntime


@dataclass
class ResolvedModel:
    model: RuntimeModel
    runtime: Any
    local: bool
    runtime_id: str
    provider_id: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def public(self) -> dict[str, Any]:
        return {
            "model": self.model.public(),
            "runtime_id": self.runtime_id,
            "local": self.local,
            "provider_id": self.provider_id,
        }


class RuntimeManager:
    def __init__(self, db: Database, settings: Settings, secrets: SecretBox):
        self.db = db
        self.settings = settings
        self.secrets = secrets
        active = db.get_settings()
        self.llama = LlamaCppRuntime(
            db=db,
            binary=settings.llama_server_path,
            port=settings.llama_server_port,
            models_dir=settings.models_dir,
            context=int(active.get("llama_context") or settings.llama_cpp_context),
            threads=int(active.get("llama_threads") or settings.llama_cpp_threads),
            logs_dir=settings.logs_dir,
        )
        self.ollama = OllamaRuntime(settings.ollama_base_url)
        self.transformers = TransformersRuntime(db, settings.models_dir)
        self._remote_cache: dict[str, RemoteProviderRuntime] = {}

    def remote_providers(self) -> list[RemoteProviderRuntime]:
        runtimes: list[RemoteProviderRuntime] = []
        for row in self.db.query("SELECT id FROM providers"):
            provider_id = row["id"]
            if provider_id in self._remote_cache:
                runtimes.append(self._remote_cache[provider_id])
                continue
            try:
                runtime = RemoteProviderRuntime(self.db, self.secrets, provider_id)
            except RuntimeUnavailable:
                continue
            self._remote_cache[provider_id] = runtime
            runtimes.append(runtime)
        return runtimes

    def invalidate_provider(self, provider_id: str | None = None) -> None:
        if provider_id:
            self._remote_cache.pop(provider_id, None)
        else:
            self._remote_cache.clear()

    def _primary_runtimes(self) -> list[Any]:
        return [self.llama, self.ollama, self.transformers]

    async def statuses(self, include_remote: bool = False) -> list[RuntimeStatus]:
        local = await asyncio.gather(
            *(runtime.status() for runtime in self._primary_runtimes()),
            return_exceptions=True,
        )
        results: list[RuntimeStatus] = []
        for runtime, status in zip(self._primary_runtimes(), local):
            if isinstance(status, Exception):
                results.append(
                    RuntimeStatus(
                        id=runtime.id,
                        label=getattr(runtime, "label", runtime.id),
                        available=False,
                        detail="Runtime check failed.",
                        error=str(status)[:300],
                    )
                )
            else:
                results.append(status)
        if include_remote:
            remotes = await asyncio.gather(
                *(runtime.status() for runtime in self.remote_providers()),
                return_exceptions=True,
            )
            for status in remotes:
                if isinstance(status, RuntimeStatus):
                    results.append(status)
        return results

    async def all_models(self, include_remote: bool = False) -> list[RuntimeModel]:
        statuses = await self.statuses(include_remote=include_remote)
        models: list[RuntimeModel] = []
        for status in statuses:
            models.extend(status.models)
        return models

    async def resolve(self, model_id: str | None, task: str = "text-generation") -> ResolvedModel:
        """Resolve `runtime::model` to a live adapter.

        Remote providers are never selected implicitly.
        """
        requested = (model_id or "auto").strip()
        if requested in {"", "auto"}:
            return await self._auto(task)

        if requested.startswith("remote::"):
            if not self.db.get_setting("remote_providers_enabled", False):
                raise RuntimeUnavailable(
                    "Remote providers are disabled.",
                    hint="Enable remote providers explicitly in Settings → Privacy.",
                )
            provider_id, _, remote_model = requested[len("remote::"):].partition("/")
            provider = next(
                (p for p in self.remote_providers() if p.provider_id == provider_id), None
            )
            if not provider:
                raise RuntimeUnavailable("Remote provider not found.")
            if not provider.enabled:
                raise RuntimeUnavailable("Remote provider is disabled.")
            models = await provider.list_models()
            match = next((m for m in models if m.id == remote_model), None)
            if not match:
                raise RuntimeUnavailable(
                    f"Model '{remote_model}' is not listed by {provider.name}."
                )
            return ResolvedModel(
                model=match,
                runtime=provider,
                local=False,
                runtime_id="remote",
                provider_id=provider_id,
            )

        runtime_id, separator, name = requested.partition("::")
        if separator:
            if runtime_id == "llama.cpp":
                return await self._resolve_llama(name)
            if runtime_id == "ollama":
                return await self._resolve_ollama(name)
            if runtime_id == "transformers":
                return await self._resolve_transformers(name)
            raise RuntimeUnavailable(f"Unknown runtime '{runtime_id}'.")

        for model in await self._local_models():
            if requested in {model.id, model.name, model.path, model.repo_id}:
                return await self.resolve(f"{model.runtime}::{model.id}", task)
        raise RuntimeUnavailable(
            f"No installed model matches '{requested}'.",
            hint="Install a model in Model Library or pick one in the model selector.",
        )

    async def _auto(self, task: str) -> ResolvedModel:
        statuses = await self.statuses()
        for runtime_id in ("llama.cpp", "ollama", "transformers"):
            status = next((s for s in statuses if s.id == runtime_id), None)
            if not status or not status.available:
                continue
            for model in status.models:
                if model.task == task:
                    return await self.resolve(f"{runtime_id}::{model.id}", task)
        raise RuntimeUnavailable(
            "No local text model is installed.",
            hint="Install a GGUF model from the Model Library, or start Ollama.",
        )

        statuses = await self.statuses(include_remote=include_remote)
        models: list[RuntimeModel] = []
        for status in statuses:
            models.extend(status.models)
        return models


    async def _resolve_llama(self, name: str) -> ResolvedModel:
        models = await self.llama.list_models()
        match = next((m for m in models if name in {m.id, m.name, Path(m.path or "").name}), None)
        if not match:
            raise RuntimeUnavailable(f"GGUF model '{name}' not found.")
        return ResolvedModel(
            model=match,
            runtime=self.llama,
            local=True,
            runtime_id="llama.cpp",
            extra={"port": self.llama.port},
        )

    async def _resolve_ollama(self, name: str) -> ResolvedModel:
        models = await self.ollama.list_models()
        match = next((m for m in models if name in {m.id, m.name}), None)
        if not match:
            raise RuntimeUnavailable(
                f"Ollama model '{name}' not found.",
                hint="Run `ollama pull <model>` or choose another model.",
            )
        return ResolvedModel(model=match, runtime=self.ollama, local=True, runtime_id="ollama")

    async def _resolve_transformers(self, name: str) -> ResolvedModel:
        models = await self.transformers.list_models()
        match = next((m for m in models if name in {m.id, m.name, m.path}), None)
        if not match:
            raise RuntimeUnavailable(f"Transformers model '{name}' not found locally.")
        return ResolvedModel(
            model=match, runtime=self.transformers, local=True, runtime_id="transformers"
        )

    async def _local_models(self) -> list[RuntimeModel]:
        models: list[RuntimeModel] = []
        for runtime in self._primary_runtimes():
            try:
                models.extend(await runtime.list_models())
            except Exception:
                continue
        return models

    async def shutdown(self) -> None:
        await self.llama.stop()
