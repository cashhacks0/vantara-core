"""Document text extraction and chunking shared by chat, workflows, and knowledge."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

MAX_EXTRACT_CHARS = 400_000


def extract_text(path: Path) -> str:
    """Extract text from TXT/MD/PDF/DOCX. Raises ValueError with a clear message."""
    suffix = path.suffix.lower()
    if suffix in {".txt", ".md", ".markdown", ".csv", ".json", ".log", ".py", ".ts", ".tsx",
                  ".js", ".jsx", ".html", ".css", ".yaml", ".yml", ".toml", ".ini", ".sql"}:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            raise ValueError(f"Could not read file: {exc}") from exc
        return text[:MAX_EXTRACT_CHARS]
    if suffix == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError as exc:
            raise ValueError("PDF extraction requires the pypdf package.") from exc
        try:
            reader = PdfReader(str(path))
            pages = []
            for index, page in enumerate(reader.pages):
                content = page.extract_text() or ""
                if content.strip():
                    pages.append(f"[page {index + 1}]\n{content}")
            text = "\n\n".join(pages)
        except Exception as exc:  # pypdf raises many low-level exceptions
            raise ValueError(f"PDF extraction failed: {exc}") from exc
        if not text.strip():
            raise ValueError("No extractable text found in PDF (it may be scanned images).")
        return text[:MAX_EXTRACT_CHARS]
    if suffix == ".docx":
        try:
            import docx
        except ImportError as exc:
            raise ValueError("DOCX extraction requires the python-docx package.") from exc
        try:
            document = docx.Document(str(path))
        except Exception as exc:
            raise ValueError(f"DOCX extraction failed: {exc}") from exc
        text = "\n".join(paragraph.text for paragraph in document.paragraphs)
        return text[:MAX_EXTRACT_CHARS]
    raise ValueError(
        f"Unsupported file type '{suffix or 'none'}'. Supported: txt, md, pdf, docx, "
        "and common plain-text formats."
    )


def chunk_text(text: str, chunk_size: int = 1200, overlap: int = 150) -> list[dict[str, Any]]:
    """Split on paragraph/sentence boundaries with a small overlap."""
    cleaned = re.sub(r"\r\n", "\n", text).strip()
    if not cleaned:
        return []
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", cleaned) if p.strip()]
    chunks: list[dict[str, Any]] = []
    buffer = ""
    page = None
    for paragraph in paragraphs:
        page_match = re.match(r"\[page (\d+)\]", paragraph)
        if page_match:
            page = int(page_match.group(1))
        if len(buffer) + len(paragraph) + 2 <= chunk_size:
            buffer = f"{buffer}\n\n{paragraph}".strip()
            continue
        if buffer:
            chunks.append({"content": buffer, "page": page})
        if len(paragraph) > chunk_size:
            sentences = re.split(r"(?<=[.!?])\s+", paragraph)
            piece = ""
            for sentence in sentences:
                if len(piece) + len(sentence) + 1 > chunk_size and piece:
                    chunks.append({"content": piece.strip(), "page": page})
                    piece = piece[-overlap:] if overlap else ""
                piece = f"{piece} {sentence}".strip()
            buffer = piece
        else:
            buffer = paragraph
    if buffer.strip():
        chunks.append({"content": buffer.strip(), "page": page})
    return [
        {"content": chunk["content"], "page": chunk["page"], "ordinal": index,
         "tokens": max(1, len(chunk["content"]) // 4)}
        for index, chunk in enumerate(chunks)
    ]


def attachment_excerpt(text: str, limit: int = 12000) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n\n[truncated — {len(text) - limit} more characters]"
