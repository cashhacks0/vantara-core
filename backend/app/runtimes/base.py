"""Shared runtime contracts.

Every local or remote inference backend implements the same small surface so
chat, workflows, studios, and agents never need backend-specific code.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Protocol


class RuntimeUnavailable(RuntimeError):
    """Raised when a runtime is not installed/configured or cannot start."""

    def __init__(self, message: str, hint: str | None = None):
        super().__init__(message)
        self.hint = hint


@dataclass
class RuntimeModel:
    id: str
    name: str
    runtime: str
    task: str = "text-generation"
    size_bytes: int = 0
    context_length: int | None = None
    quantization: str | None = None
    path: str | None = None
    repo_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "qualified_id": f"{self.runtime}::{self.id}",
            "name": self.name,
            "runtime": self.runtime,
            "task": self.task,
            "size_bytes": self.size_bytes,
            "context_length": self.context_length,
            "quantization": self.quantization,
            "path": self.path,
            "repo_id": self.repo_id,
            "metadata": self.metadata,
        }


@dataclass
class RuntimeStatus:
    id: str
    label: str
    available: bool
    configured: bool = True
    version: str | None = None
    detail: str = ""
    error: str | None = None
    hint: str | None = None
    capabilities: list[str] = field(default_factory=list)
    models: list[RuntimeModel] = field(default_factory=list)
    local: bool = True

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "available": self.available,
            "configured": self.configured,
            "version": self.version,
            "detail": self.detail,
            "error": self.error,
            "hint": self.hint,
            "capabilities": self.capabilities,
            "models": [m.public() for m in self.models],
            "local": self.local,
        }


@dataclass
class GenerationOptions:
    temperature: float = 0.7
    max_tokens: int = 1024
    top_p: float = 0.95
    stop: list[str] = field(default_factory=list)


@dataclass
class ChatMessage:
    role: str
    content: str

    def as_dict(self) -> dict[str, str]:
        return {"role": self.role, "content": self.content}


class ChatRuntime(Protocol):
    id: str

    async def status(self) -> RuntimeStatus: ...

    async def list_models(self) -> list[RuntimeModel]: ...

    async def chat_stream(
        self,
        model: RuntimeModel,
        messages: list[ChatMessage],
        options: GenerationOptions,
    ) -> AsyncIterator[str]: ...


class EmbeddingRuntime(Protocol):
    async def embed(self, model: RuntimeModel, texts: list[str]) -> list[list[float]]: ...
