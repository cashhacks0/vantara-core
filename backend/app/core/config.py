"""Application configuration for VANTARA AI.

All paths and runtime locations are resolved once at process start.  Values can
be overridden with environment variables so deployments never have to edit
source code.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_path(name: str, default: Path) -> Path:
    raw = os.environ.get(name)
    return Path(raw).expanduser().resolve() if raw else default


@dataclass(frozen=True)
class Settings:
    """Runtime settings.  Immutable so accidental mutation cannot drift state."""

    root_dir: Path
    data_dir: Path
    db_path: Path
    models_dir: Path
    uploads_dir: Path
    outputs_dir: Path
    cache_dir: Path
    logs_dir: Path
    host: str = "127.0.0.1"
    port: int = 8756
    cors_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")
    allow_remote_providers: bool = False
    allow_workflow_http: bool = False
    hf_token: str | None = field(default=None, repr=False)
    hf_api_base: str = "https://huggingface.co"
    llama_server_path: Path | None = None
    llama_server_port: int = 8199
    ollama_base_url: str = "http://127.0.0.1:11434"
    llama_cpp_context: int = 4096
    llama_cpp_threads: int = 4
    request_max_bytes: int = 32 * 1024 * 1024
    rate_limit_per_minute: int = 600
    version: str = "0.1.0"

    @property
    def secret_key_path(self) -> Path:
        return self.data_dir / ".secret_key"

    @property
    def log_path(self) -> Path:
        return self.logs_dir / "vantara.log"

    @classmethod
    def from_env(cls) -> "Settings":
        root = Path(__file__).resolve().parents[3]
        data_dir = _env_path("VANTARA_DATA_DIR", root / "data")
        models_dir = _env_path("VANTARA_MODELS_DIR", data_dir / "models")
        llama_path_raw = os.environ.get("VANTARA_LLAMA_SERVER")
        if llama_path_raw:
            llama_path: Path | None = Path(llama_path_raw).expanduser().resolve()
        else:
            bundled = root / "vendor" / "llama.cpp" / "llama-server"
            llama_path = bundled if bundled.exists() else None
        origins = os.environ.get(
            "VANTARA_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        )
        return cls(
            root_dir=root,
            data_dir=data_dir,
            db_path=_env_path("VANTARA_DB_PATH", data_dir / "vantara.db"),
            models_dir=models_dir,
            uploads_dir=_env_path("VANTARA_UPLOADS_DIR", data_dir / "uploads"),
            outputs_dir=_env_path("VANTARA_OUTPUTS_DIR", data_dir / "outputs"),
            cache_dir=_env_path("VANTARA_CACHE_DIR", data_dir / "cache"),
            logs_dir=_env_path("VANTARA_LOGS_DIR", data_dir / "logs"),
            host=os.environ.get("VANTARA_HOST", "127.0.0.1"),
            port=int(os.environ.get("VANTARA_PORT", "8756")),
            cors_origins=tuple(o.strip() for o in origins.split(",") if o.strip()),
            allow_remote_providers=_env_bool("VANTARA_ALLOW_REMOTE_PROVIDERS", False),
            allow_workflow_http=_env_bool("VANTARA_ALLOW_WORKFLOW_HTTP", False),
            hf_token=os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN"),
            hf_api_base=os.environ.get("VANTARA_HF_API_BASE", "https://huggingface.co"),
            llama_server_path=llama_path,
            llama_server_port=int(os.environ.get("VANTARA_LLAMA_PORT", "8199")),
            ollama_base_url=os.environ.get(
                "VANTARA_OLLAMA_URL", "http://127.0.0.1:11434"
            ),
            llama_cpp_context=int(os.environ.get("VANTARA_LLAMA_CONTEXT", "4096")),
            llama_cpp_threads=int(os.environ.get("VANTARA_LLAMA_THREADS", "4")),
            request_max_bytes=int(
                os.environ.get("VANTARA_REQUEST_MAX_BYTES", str(32 * 1024 * 1024))
            ),
            rate_limit_per_minute=int(
                os.environ.get("VANTARA_RATE_LIMIT", "600")
            ),
        )

    def ensure_dirs(self) -> None:
        for path in (
            self.data_dir,
            self.models_dir,
            self.uploads_dir,
            self.outputs_dir,
            self.cache_dir,
            self.logs_dir,
            self.models_dir / "gguf",
        ):
            path.mkdir(parents=True, exist_ok=True)
