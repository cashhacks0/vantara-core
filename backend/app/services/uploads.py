"""Safe upload storage and attachment extraction."""

from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import UploadFile

from ..core.logging import get_logger
from ..security import safe_filename, safe_join
from .documents import extract_text

log = get_logger(__name__)
MAX_UPLOAD_BYTES = 25 * 1024 * 1024


async def save_upload(file: UploadFile, uploads_dir: Path, max_bytes: int = MAX_UPLOAD_BYTES) -> dict:
    original_name = safe_filename(file.filename or "upload")
    data = await file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise ValueError(f"Upload exceeds the {max_bytes // (1024 * 1024)} MB limit.")
    if not data:
        raise ValueError("Uploaded file is empty.")
    stored_name = f"{uuid.uuid4().hex[:10]}-{original_name}"
    target = safe_join(uploads_dir, stored_name)
    target.write_bytes(data)
    extracted_text = None
    extraction_error = None
    document_suffixes = {
        ".txt", ".md", ".markdown", ".csv", ".json", ".log", ".py", ".ts", ".tsx",
        ".js", ".jsx", ".html", ".css", ".yaml", ".yml", ".toml", ".ini", ".sql",
        ".pdf", ".docx",
    }
    if target.suffix.lower() in document_suffixes:
        try:
            extracted_text = extract_text(target)[:16000]
        except ValueError as exc:
            extraction_error = str(exc)[:300]
    return {
        "name": original_name,
        "stored_name": stored_name,
        "path": stored_name,
        "size_bytes": len(data),
        "mime": file.content_type,
        "extracted_text": extracted_text,
        "extraction_error": extraction_error,
    }


def list_uploads(uploads_dir: Path) -> list[dict]:
    items = []
    if not uploads_dir.exists():
        return items
    for path in sorted(uploads_dir.glob("*"), key=lambda p: p.stat().st_mtime, reverse=True)[:200]:
        if not path.is_file():
            continue
        display = path.name.split("-", 1)[1] if "-" in path.name else path.name
        items.append({
            "name": display,
            "stored_name": path.name,
            "size_bytes": path.stat().st_size,
            "modified_at": path.stat().st_mtime,
        })
    return items
