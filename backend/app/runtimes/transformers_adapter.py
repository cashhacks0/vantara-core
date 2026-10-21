"""Optional Transformers runtime for local directories or HF cache snapshots.

Only active when `torch` and `transformers` are installed.  Model weights are
never downloaded implicitly by this adapter; point it at a local directory.
"""

from __future__ import annotations

import asyncio
import importlib.util
import threading
from pathlib import Path
from typing import Any, AsyncIterator

from ..core.logging import get_logger
from .base import (
    ChatMessage,
    GenerationOptions,
    RuntimeModel,
    RuntimeStatus,
    RuntimeUnavailable,
)

log = get_logger(__name__)


class TransformersRuntime:
    id = "transformers"
    label = "Transformers (PyTorch)"

    def __init__(self, db, models_dir: Path):
        self.db = db
        self.models_dir = models_dir
        self._cache: tuple[str, Any, Any] | None = None
        self._lock = asyncio.Lock()

    @staticmethod
    def _deps_available() -> bool:
        return (
            importlib.util.find_spec("torch") is not None
            and importlib.util.find_spec("transformers") is not None
        )

    def _scan(self) -> list[RuntimeModel]:
        models: list[RuntimeModel] = []
        seen: set[str] = set()
        for row in self.db.query("SELECT * FROM installed_models WHERE runtime = ?", (self.id,)):
            path = Path(row["path"])
            if path.exists() and (path / "config.json").exists():
                models.append(
                    RuntimeModel(
                        id=str(path),
                        name=row["display_name"],
                        runtime=self.id,
                        task=row["task"] or "text-generation",
                        size_bytes=row["size_bytes"],
                        path=str(path),
                        repo_id=row["repo_id"],
                    )
                )
                seen.add(str(path.resolve()))
        if self.models_dir.exists():
            for config in self.models_dir.rglob("config.json"):
                parent = config.parent.resolve()
                if str(parent) in seen:
                    continue
                seen.add(str(parent))
                models.append(
                    RuntimeModel(
                        id=str(parent),
                        name=parent.name,
                        runtime=self.id,
                        task="text-generation",
                        path=str(parent),
                        metadata={"source": "filesystem"},
                    )
                )
        return models

    async def list_models(self) -> list[RuntimeModel]:
        return self._scan() if self._deps_available() else []

    async def status(self) -> RuntimeStatus:
        available = self._deps_available()
        models = await self.list_models() if available else []
        detail = (
            f"PyTorch/Transformers detected. {len(models)} local model director(ies)."
            if available
            else "Transformers runtime is not installed."
        )
        return RuntimeStatus(
            id=self.id,
            label=self.label,
            available=available,
            configured=available,
            detail=detail,
            hint=None if available else "pip install torch transformers accelerate to enable this backend.",
            capabilities=["chat", "text-generation"] if available else [],
            models=models,
        )


    def _load(self, model: RuntimeModel):
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        path = Path(model.path or model.id)
        if not path.exists() or not (path / "config.json").exists():
            raise RuntimeUnavailable(
                "Transformers models must be a local directory containing config.json."
            )
        if self._cache and self._cache[0] == str(path) and self._cache[1] is not None:
            return self._cache[1], self._cache[2]
        tokenizer = AutoTokenizer.from_pretrained(str(path), local_files_only=True)
        kwargs: dict[str, Any] = {"local_files_only": True, "torch_dtype": "auto"}
        if torch.cuda.is_available():
            kwargs["device_map"] = "auto"
        loaded = AutoModelForCausalLM.from_pretrained(str(path), **kwargs)
        if not torch.cuda.is_available():
            loaded = loaded.to("cpu")
        self._cache = (str(path), loaded, tokenizer)
        return loaded, tokenizer

    async def chat_stream(
        self,
        model: RuntimeModel,
        messages: list[ChatMessage],
        options: GenerationOptions,
    ) -> AsyncIterator[str]:
        if not self._deps_available():
            raise RuntimeUnavailable("Transformers runtime is not installed.")
        from transformers import TextIteratorStreamer

        async with self._lock:
            loaded, tokenizer = await asyncio.to_thread(self._load, model)
        prompt_messages = [m.as_dict() for m in messages]
        if getattr(tokenizer, "chat_template", None):
            prompt = tokenizer.apply_chat_template(
                prompt_messages, tokenize=False, add_generation_prompt=True
            )
        else:
            prompt = "\n".join(f"{m['role']}: {m['content']}" for m in prompt_messages)
            prompt += "\nassistant:"
        inputs = tokenizer(prompt, return_tensors="pt")
        model_device = next(loaded.parameters()).device
        inputs = {key: value.to(model_device) for key, value in inputs.items()}
        streamer = TextIteratorStreamer(
            tokenizer, skip_prompt=True, skip_special_tokens=True, timeout=600
        )
        kwargs = dict(
            **inputs,
            streamer=streamer,
            max_new_tokens=options.max_tokens,
            do_sample=options.temperature > 0,
            temperature=max(options.temperature, 0.01),
            top_p=options.top_p,
            pad_token_id=tokenizer.eos_token_id,
        )
        thread = threading.Thread(target=loaded.generate, kwargs=kwargs, daemon=True)
        thread.start()
        iterator = iter(streamer)
        while True:
            text = await asyncio.to_thread(next, iterator, None)
            if text is None:
                break
            if text:
                yield text
        await asyncio.to_thread(thread.join, 5)

    async def embed(self, model: RuntimeModel, texts: list[str]) -> list[list[float]]:
        raise RuntimeUnavailable(
            "Use a dedicated embedding model through Ollama or llama.cpp for embeddings."
        )
