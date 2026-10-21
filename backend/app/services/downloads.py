"""Model download manager with progress, cancellation, retry, and disk checks."""

from __future__ import annotations

import os
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

from ..core.config import Settings
from ..core.db import Database, new_id, utc_now
from ..core.logging import get_logger
from ..security import safe_filename, safe_join, tls_verify, validate_relative_repo_path, validate_repo_id

log = get_logger(__name__)


class DownloadError(RuntimeError):
    pass


class DownloadManager:
    def __init__(self, db: Database, settings: Settings):
        self.db = db
        self.settings = settings
        self._cancels: dict[str, threading.Event] = {}
        self._lock = threading.Lock()

    def _headers(self) -> dict[str, str]:
        headers = {"User-Agent": "VANTARA-AI/0.1"}
        if self.settings.hf_token:
            headers["Authorization"] = f"Bearer {self.settings.hf_token}"
        return headers

    def list_downloads(self) -> list[dict[str, Any]]:
        rows = self.db.query("SELECT * FROM downloads ORDER BY created_at DESC LIMIT 100")
        return [self._public(row) for row in rows]

    def _public(self, row: dict[str, Any]) -> dict[str, Any]:
        total = int(row.get("total_bytes") or 0)
        downloaded = int(row.get("downloaded_bytes") or 0)
        percent = round(downloaded / total * 100, 1) if total > 0 else None
        return {
            "id": row["id"],
            "repo_id": row["repo_id"],
            "filename": row["filename"],
            "status": row["status"],
            "total_bytes": total,
            "downloaded_bytes": downloaded,
            "percent": percent,
            "error": row.get("error"),
            "path": row["path"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def get(self, download_id: str) -> dict[str, Any] | None:
        row = self.db.query_one("SELECT * FROM downloads WHERE id = ?", (download_id,))
        return self._public(row) if row else None

    def start(self, repo_id: str, filename: str) -> dict[str, Any]:
        validate_repo_id(repo_id)
        validate_relative_repo_path(filename)
        if not filename.lower().endswith((".gguf", ".safetensors", ".bin", ".onnx", ".pt")):
            raise DownloadError(
                "Only model weight files (.gguf, .safetensors, .bin, .onnx, .pt) can be installed."
            )
        safe_name = safe_filename(Path(filename).name, "model.bin")
        existing = self.db.query_one(
            "SELECT * FROM downloads WHERE repo_id = ? AND filename = ?", (repo_id, filename)
        )
        if existing and existing["status"] in {"queued", "downloading"}:
            raise DownloadError("This file is already downloading.")
        installed = self.db.query_one(
            "SELECT id FROM installed_models WHERE repo_id = ? AND filename = ?",
            (repo_id, filename),
        )
        if installed:
            raise DownloadError("This model file is already installed.")

        subdir = safe_filename(repo_id.replace("/", "--"), "model")
        target_dir = safe_join(self.settings.models_dir, subdir)
        target_dir.mkdir(parents=True, exist_ok=True)
        target = safe_join(target_dir, safe_name)

        record_id = existing["id"] if existing else new_id("dl_")
        data = {
            "repo_id": repo_id,
            "filename": filename,
            "url": f"{self.settings.hf_api_base}/{repo_id}/resolve/main/{quote(filename)}",
            "path": str(target),
            "status": "queued",
            "total_bytes": 0,
            "downloaded_bytes": 0,
            "error": None,
            "updated_at": utc_now(),
        }
        if existing:
            self.db.update("downloads", record_id, data)
        else:
            self.db.insert(
                "downloads",
                {"id": record_id, "created_at": utc_now(), **data},
            )
        cancel = threading.Event()
        with self._lock:
            self._cancels[record_id] = cancel
        thread = threading.Thread(
            target=self._run, args=(record_id, repo_id, filename, target, cancel), daemon=True
        )
        thread.start()
        result = self.get(record_id)
        assert result is not None
        return result

    def cancel(self, download_id: str) -> dict[str, Any]:
        with self._lock:
            event = self._cancels.get(download_id)
        if event:
            event.set()
        row = self.db.query_one("SELECT * FROM downloads WHERE id = ?", (download_id,))
        if not row:
            raise DownloadError("Download not found.")
        if row["status"] in {"queued", "downloading"}:
            self.db.update(
                "downloads",
                download_id,
                {"status": "cancelled", "updated_at": utc_now()},
            )
        result = self.get(download_id)
        assert result is not None

    def _run(
        self,
        download_id: str,
        repo_id: str,
        filename: str,
        target: Path,
        cancel: threading.Event,
    ) -> None:
        partial = target.stat().st_size if target.exists() else 0
        total = 0
        self.db.update(
            "downloads",
            download_id,
            {"status": "downloading", "downloaded_bytes": partial, "updated_at": utc_now()},
        )
        headers = self._headers()
        if partial:
            headers["Range"] = f"bytes={partial}-"
        try:
            with httpx.stream(
                "GET",
                f"{self.settings.hf_api_base}/{repo_id}/resolve/main/{quote(filename)}",
                headers=headers,
                follow_redirects=True,
                timeout=httpx.Timeout(connect=20.0, read=120.0, write=30.0, pool=30.0),
                verify=tls_verify(),
            ) as response:
                if response.status_code == 416:
                    raise DownloadError("The partial file is already complete. Retry the install.")
                if response.status_code in {401, 403}:
                    raise DownloadError(
                        "Access denied. This repository may be gated; accept its license on "
                        "Hugging Face and configure an HF token in the server environment."
                    )
                if response.status_code == 404:
                    raise DownloadError("File not found in the repository.")
                if response.status_code >= 400:
                    raise DownloadError(f"Hugging Face returned HTTP {response.status_code}.")
                resume = response.status_code == 206
                length = int(response.headers.get("content-length") or 0)
                total = partial + length if resume and length else length
                free = __import__("shutil").disk_usage(self.settings.models_dir).free
                if length and length > free:
                    raise DownloadError(
                        f"Not enough disk space: need {length / 1e9:.1f} GB, "
                        f"{free / 1e9:.1f} GB free."
                    )
                mode = "ab" if resume else "wb"
                received = partial if resume else 0
                last_flush = time.monotonic()
                with open(target, mode) as handle:
                    for chunk in response.iter_bytes(1024 * 1024):
                        if cancel.is_set():
                            handle.flush()
                            self.db.update(
                                "downloads",
                                download_id,
                                {
                                    "status": "cancelled",
                                    "downloaded_bytes": received,
                                    "total_bytes": total,
                                    "updated_at": utc_now(),
                                },
                            )
                            return
                        handle.write(chunk)
                        received += len(chunk)
                        if time.monotonic() - last_flush > 0.8:
                            self.db.update(
                                "downloads",
                                download_id,
                                {
                                    "downloaded_bytes": received,
                                    "total_bytes": total,
                                    "updated_at": utc_now(),
                                },
                            )
                            last_flush = time.monotonic()
            if total and received < total:
                raise DownloadError(
                    f"Download incomplete: received {received} of {total} bytes."
                )
            self._register_install(download_id, repo_id, filename, target, received)
        except (httpx.HTTPError, OSError, DownloadError) as exc:
            message = str(exc)
            if isinstance(exc, httpx.HTTPError):
                message = f"Network error: {type(exc).__name__}. Check connectivity and retry."
            log.warning("Download failed: %s", message)
            self.db.update(
                "downloads",
                download_id,
                {"status": "failed", "error": message[:900], "updated_at": utc_now()},
            )
        finally:
            with self._lock:
                self._cancels.pop(download_id, None)


    def _register_install(
        self, download_id: str, repo_id: str, filename: str, target: Path, size: int
    ) -> None:
        is_gguf = filename.lower().endswith(".gguf")
        runtime = "llama.cpp" if is_gguf else "unmanaged"
        status = "installed" if is_gguf else "downloaded"
        quantization = None
        if is_gguf:
            import re

            match = re.search(r"(?i)(q\d[_a-z0-9]*|f16|f32|bf16|iq\d[_a-z0-9]*)", filename)
            quantization = match.group(1).upper() if match else None
        note = (
            "{}"
            if is_gguf
            else '{"note": "Downloaded weight file without a managed runtime. '
            'Place it in a compatible local model directory to use it."}'
        )
        self.db.insert(
            "installed_models",
            {
                "id": new_id("mdl_"),
                "repo_id": repo_id,
                "display_name": Path(filename).stem,
                "filename": filename,
                "path": str(target),
                "size_bytes": size,
                "runtime": runtime,
                "task": "text-generation" if is_gguf else None,
                "quantization": quantization,
                "license": None,
                "status": status,
                "metadata_json": note,
                "created_at": utc_now(),
            },
        )
        self.db.update(
            "downloads",
            download_id,
            {
                "status": "complete",
                "downloaded_bytes": size,
                "total_bytes": size or None,
                "error": None,
                "updated_at": utc_now(),
            },
        )
        self.db.audit("model.installed", f"{repo_id}/{filename}")

    def installed(self) -> list[dict[str, Any]]:
        import json

        rows = self.db.query("SELECT * FROM installed_models ORDER BY created_at DESC")
        result = []
        for row in rows:
            path = Path(row["path"])
            result.append(
                {
                    "id": row["id"],
                    "repo_id": row["repo_id"],
                    "display_name": row["display_name"],
                    "filename": row["filename"],
                    "path": row["path"],
                    "size_bytes": row["size_bytes"],
                    "runtime": row["runtime"],
                    "task": row["task"],
                    "quantization": row["quantization"],
                    "license": row["license"],
                    "status": row["status"],
                    "metadata": json.loads(row["metadata_json"] or "{}"),
                    "created_at": row["created_at"],
                    "exists": path.exists(),
                    "runnable": path.exists() and row["runtime"] == "llama.cpp",
                }
            )
        return result

    def remove_installed(self, model_id: str) -> None:
        row = self.db.query_one("SELECT * FROM installed_models WHERE id = ?", (model_id,))
        if not row:
            raise DownloadError("Installed model not found.")
        path = Path(row["path"]).resolve()
        root = self.settings.models_dir.resolve()
        if root in path.parents and path.exists():
            try:
                path.unlink()
            except OSError as exc:
                raise DownloadError(f"Could not delete model file: {exc}") from exc
        self.db.execute("DELETE FROM installed_models WHERE id = ?", (model_id,))
        self.db.audit("model.removed", f"{row['repo_id']}/{row['filename']}")

        return result
