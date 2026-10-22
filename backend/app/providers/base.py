"""Inference provider interface. Ollama is first; llama.cpp can implement this later."""
from abc import ABC, abstractmethod
from typing import Any, AsyncIterator


class ProviderError(Exception):
    """Runtime unreachable or returned an unusable response."""


class InferenceProvider(ABC):
    name: str

    @abstractmethod
    async def health_check(self) -> dict[str, Any]: ...

    @abstractmethod
    async def list_models(self) -> list[dict[str, Any]]: ...

    @abstractmethod
    async def show_model(self, name: str) -> dict[str, Any]: ...

    @abstractmethod
    def chat_stream(self, model: str, messages: list[dict[str, str]]) -> AsyncIterator[dict[str, Any]]: ...

    @abstractmethod
    async def generate(self, model: str, prompt: str) -> str: ...

    @abstractmethod
    def pull_model(self, name: str) -> AsyncIterator[dict[str, Any]]: ...

    async def cancel_operation(self, operation_id: str) -> bool:
        """Optional; providers that cannot cancel return False."""
        return False

    @abstractmethod
    async def delete_model(self, name: str, confirm: bool = False) -> None: ...
