"""Managed llama.cpp (GGUF) runtime.

VANTARA launches a loopback-only `llama-server` child process for the selected
GGUF file and talks to it over its OpenAI-compatible HTTP API.  No binaries or
weights are bundled in source control; users install them explicitly.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import time
from pathlib import Path
from typing import AsyncIterator

import httpx

from ..core.db import Database
from ..core.logging import get_logger
from .base import (
    ChatMessage,
    GenerationOptions,
    RuntimeModel,
    RuntimeStatus,
    RuntimeUnavailable,
)

log = get_logger(__name__)
_QUANT = re.compile(r"(?i)(q\d[_a-z0-9]*|f16|f32|bf16|iq\d[_a-z0-9]*)")


def _quantization(filename: str) -> str | None:
    match = _QUANT.search(filename)
    return match.group(1).upper() if match else None


class LlamaCppRuntime:
    id = "llama.cpp"
    label = "llama.cpp (GGUF)"

    def __init__(self, db: Database, binary: Path | None, port: int, models_dir: Path,
                 context: int = 4096, threads: int = 4, logs_dir: Path | None = None):
        self.db = db
        self.binary = binary
        self.port = port
        self.models_dir = models_dir
        self.context = context
        self.threads = threads
        self.logs_dir = logs_dir or models_dir.parent / "logs"
        self._process: subprocess.Popen[bytes] | None = None
        self._loaded_path: str | None = None
        self._lock = asyncio.Lock()
        self._startup_error: str | None = None
        self._log_handle = None

    def _installed_rows(self) -> list[dict]:
        return self.db.query(
            "SELECT * FROM installed_models WHERE runtime = ? AND status = 'installed'",
            (self.id,),
        )

    def _scan(self) -> list[RuntimeModel]:
        models: list[RuntimeModel] = []
        seen: set[str] = set()
        if self.models_dir.exists():
            for path in sorted(self.models_dir.rglob("*.gguf")):
                if not path.is_file():
                    continue
                key = str(path.resolve())
                if key in seen:
                    continue
                seen.add(key)
                models.append(
                    RuntimeModel(
                        id=path.name,
                        name=path.stem,
                        runtime=self.id,
                        task="text-generation",
                        size_bytes=path.stat().st_size,
                        quantization=_quantization(path.name),
                        path=key,
                        metadata={"source": "filesystem"},
                    )
                )
        for row in self._installed_rows():
            key = str(Path(row["path"]).resolve())
            if key in seen:
                for model in models:
                    if model.path == key:
                        model.repo_id = model.repo_id or row["repo_id"]
                        model.quantization = model.quantization or row["quantization"]
                continue
            seen.add(key)
            if Path(row["path"]).exists():
                models.append(
                    RuntimeModel(
                        id=Path(row["path"]).name,
                        name=row["display_name"],
                        runtime=self.id,
                        task=row["task"] or "text-generation",
                        size_bytes=row["size_bytes"],
                        quantization=row["quantization"],
                        path=key,
                        repo_id=row["repo_id"],
                    )
                )
        return models

    async def list_models(self) -> list[RuntimeModel]:
        return self._scan()

    def _resolve(self, model: RuntimeModel) -> Path:
        path = Path(model.path).resolve() if model.path else (self.models_dir / model.id).resolve()
        allowed_root = self.models_dir.resolve()
        if allowed_root not in path.parents and path != allowed_root:
            raise RuntimeUnavailable("Model path is outside the configured models directory")
        if not path.exists():
            raise RuntimeUnavailable(f"Model file not found: {path.name}")
        return path


    def _running(self) -> bool:
        return self._process is not None and self._process.poll() is None

    async def _healthy(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(f"http://127.0.0.1:{self.port}/health")
                return resp.status_code == 200
        except httpx.HTTPError:
            return False

    def _stop_unlocked(self) -> None:
        if self._process is not None:
            try:
                self._process.terminate()
                self._process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                self._process.kill()
            except OSError:
                pass
            self._process = None
        self._loaded_path = None
        if self._log_handle is not None:
            try:
                self._log_handle.close()
            except OSError:
                pass
            self._log_handle = None

    async def stop(self) -> None:
        async with self._lock:
            self._stop_unlocked()

    async def ensure_loaded(self, model: RuntimeModel) -> Path:
        path = self._resolve(model)
        if not self.binary or not self.binary.exists():
            raise RuntimeUnavailable(
                "llama.cpp server binary is not installed.",
                hint="Place a llama-server build in vendor/llama.cpp/ or set VANTARA_LLAMA_SERVER.",
            )
        async with self._lock:
            if self._running() and self._loaded_path == str(path) and await self._healthy():
                return path
            self._stop_unlocked()

            self.logs_dir.mkdir(parents=True, exist_ok=True)
            self._log_handle = open(self.logs_dir / "llama-server.log", "ab", buffering=0)
            env = os.environ.copy()
            env["LD_LIBRARY_PATH"] = (
                f"{self.binary.parent}:{env.get('LD_LIBRARY_PATH', '')}".rstrip(":")
            )
            cmd = [
                str(self.binary),
                "-m", str(path),
                "--host", "127.0.0.1",
                "--port", str(self.port),
                "-c", str(self.context),
                "-t", str(self.threads),
                "--no-webui",
            ]
            log.info("Starting llama-server", extra={"extra_fields": {"model": path.name}})
            try:
                self._process = subprocess.Popen(
                    cmd,
                    stdout=self._log_handle,
                    stderr=subprocess.STDOUT,
                    env=env,
                    start_new_session=True,
                )
            except OSError as exc:
                self._startup_error = str(exc)
                raise RuntimeUnavailable(f"Could not start llama-server: {exc}") from exc

            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                if self._process.poll() is not None:
                    self._startup_error = self._tail_log()
                    self._stop_unlocked()
                    raise RuntimeUnavailable(
                        "llama-server exited during startup.",
                        hint=self._startup_error[-500:] if self._startup_error else None,
                    )
                if await self._healthy():
                    self._loaded_path = str(path)
                    self._startup_error = None
                    log.info("llama-server ready", extra={"extra_fields": {"model": path.name}})
                    return path
                await asyncio.sleep(0.5)
            self._stop_unlocked()
            raise RuntimeUnavailable(
                "Timed out waiting for llama-server to load the model.",
                hint="The model may be too large for available RAM. Try a smaller quantization.",
            )

    def _tail_log(self, lines: int = 40) -> str:
        try:
            content = (self.logs_dir / "llama-server.log").read_text(
                encoding="utf-8", errors="replace"
            ).splitlines()
            return "\n".join(content[-lines:])
        except OSError:
            return ""


    async def status(self) -> RuntimeStatus:
        binary_ok = bool(self.binary and self.binary.exists())
        models = await self.list_models() if binary_ok else []
        running = self._running()
        healthy = await self._healthy() if running else False
        detail = (
            f"Server {'running' if healthy else 'idle'} on 127.0.0.1:{self.port}. "
            f"{len(models)} GGUF model(s) found."
            if binary_ok
            else "Managed llama.cpp server binary not found."
        )
        return RuntimeStatus(
            id=self.id,
            label=self.label,
            available=binary_ok,
            configured=binary_ok,
            version="managed" if binary_ok else None,
            detail=detail,
            error=self._startup_error,
            hint=None if binary_ok else "Set VANTARA_LLAMA_SERVER or install llama.cpp in vendor/llama.cpp.",
            capabilities=["chat", "text-generation", "embeddings"] if binary_ok else [],
            models=models,
        )

    async def chat_stream(
        self,
        model: RuntimeModel,
        messages: list[ChatMessage],
        options: GenerationOptions,
    ) -> AsyncIterator[str]:
        await self.ensure_loaded(model)
        payload = {
            "model": model.id,
            "messages": [m.as_dict() for m in messages],
            "temperature": options.temperature,
            "max_tokens": options.max_tokens,
            "top_p": options.top_p,
            "stream": True,
        }
        if options.stop:
            payload["stop"] = options.stop
        timeout = httpx.Timeout(connect=10.0, read=600.0, write=30.0, pool=30.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                async with client.stream(
                    "POST",
                    f"http://127.0.0.1:{self.port}/v1/chat/completions",
                    json=payload,
                ) as response:
                    if response.status_code != 200:
                        body = (await response.aread()).decode("utf-8", "replace")[:800]
                        raise RuntimeUnavailable(
                            f"llama.cpp returned HTTP {response.status_code}: {body}"
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
            except httpx.ConnectError as exc:
                raise RuntimeUnavailable(
                    "Lost connection to the local llama.cpp server. It may have run out of memory."
                ) from exc

    async def embed(self, model: RuntimeModel, texts: list[str]) -> list[list[float]]:
        await self.ensure_loaded(model)
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"http://127.0.0.1:{self.port}/v1/embeddings",
                json={"model": model.id, "input": texts},
            )
            if resp.status_code != 200:
                raise RuntimeUnavailable(
                    "This llama.cpp server build cannot produce embeddings for the loaded model. "
                    "Start a dedicated embedding model instead."
                )
            data = resp.json()
            return [item["embedding"] for item in data.get("data", [])]
