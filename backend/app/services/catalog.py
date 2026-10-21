"""Hugging Face Hub catalog client.

Uses only documented Hub HTTP endpoints; no scraping.  Metadata is cached in
memory for a short TTL and catalog pages are cursor-based so the UI can browse
far beyond the 10,000-listing target without loading everything at once.
"""

from __future__ import annotations

import re
import time
from typing import Any
from urllib.parse import urlencode

import httpx

from ..core.config import Settings
from ..core.logging import get_logger
from ..security import tls_verify, validate_repo_id

log = get_logger(__name__)

TASK_FILTERS = [
    "text-generation",
    "text2text-generation",
    "image-text-to-text",
    "automatic-speech-recognition",
    "text-to-image",
    "text-to-speech",
    "text-to-video",
    "image-to-image",
    "feature-extraction",
    "image-classification",
    "audio-classification",
    "video-classification",
    "sentence-similarity",
]

_CACHE: dict[str, tuple[float, Any]] = {}
_CACHE_TTL = 120.0
_LINK_NEXT = re.compile(r'<([^>]+)>;\s*rel="next"')


class CatalogError(RuntimeError):
    pass


class HuggingFaceCatalog:
    def __init__(self, settings: Settings):
        self.settings = settings

    def _headers(self) -> dict[str, str]:
        headers = {"User-Agent": "VANTARA-AI/0.1 (local-first desktop app)"}
        if self.settings.hf_token:
            headers["Authorization"] = f"Bearer {self.settings.hf_token}"
        return headers

    def _cached(self, key: str) -> Any | None:
        entry = _CACHE.get(key)
        if entry and entry[0] > time.monotonic():
            return entry[1]
        return None

    def _store(self, key: str, value: Any) -> Any:
        _CACHE[key] = (time.monotonic() + _CACHE_TTL, value)
        if len(_CACHE) > 300:
            oldest = min(_CACHE, key=lambda k: _CACHE[k][0])
            _CACHE.pop(oldest, None)
        return value

    async def search(
        self,
        query: str = "",
        task: str | None = None,
        library: str | None = None,
        author: str | None = None,
        sort: str = "downloads",
        direction: str = "-1",
        cursor: str | None = None,
        limit: int = 30,
        tag: str | None = None,
        license_filter: str | None = None,
    ) -> dict[str, Any]:
        limit = max(1, min(limit, 100))
        params: dict[str, Any] = {"limit": limit}
        if query:
            params["search"] = query
        if task:
            params["pipeline_tag"] = task
        if library:
            params["library"] = library
        if author:
            params["author"] = author
        if tag:
            params["filter"] = tag
        if sort:
            params["sort"] = sort
            params["direction"] = direction
        if cursor:
            params["cursor"] = cursor
        url = f"{self.settings.hf_api_base}/api/models?{urlencode(params)}"
        cached = self._cached(url)
        if cached:
            return cached
        try:
            async with httpx.AsyncClient(timeout=20.0, follow_redirects=True, verify=tls_verify()) as client:
                response = await client.get(url, headers=self._headers())
        except httpx.HTTPError as exc:
            raise CatalogError(f"Hugging Face Hub is unreachable: {exc}") from exc
        if response.status_code == 429:
            raise CatalogError("Hugging Face rate limit reached. Try again shortly.")
        if response.status_code >= 400:
            raise CatalogError(
                f"Hugging Face returned HTTP {response.status_code} for model search."
            )
        try:
            raw_items = response.json()
        except ValueError as exc:
            raise CatalogError("Hugging Face returned an unexpected response.") from exc
        items = [self._normalize(item) for item in raw_items if isinstance(item, dict)]
        if license_filter:
            items = [
                item
                for item in items
                if (item.get("license") or "").lower() == license_filter.lower()
            ]
        next_cursor = None
        match = _LINK_NEXT.search(response.headers.get("link", ""))
        if match:
            from urllib.parse import parse_qs, urlparse

            parsed = parse_qs(urlparse(match.group(1)).query)
            next_cursor = (parsed.get("cursor") or [None])[0]
        result = {
            "items": items,
            "next_cursor": next_cursor,
            "count": len(items),
            "catalog": "huggingface",
            "total_is_approximate": True,
        }
        return self._store(url, result)

    def _normalize(self, item: dict[str, Any]) -> dict[str, Any]:
        tags = item.get("tags") or []
        license_tag = next(
            (tag.split(":", 1)[1] for tag in tags if tag.startswith("license:")), None
        )
        pipeline = item.get("pipeline_tag") or "unknown"
        lowered_tags = [str(tag).lower() for tag in tags]
        gguf = "gguf" in lowered_tags or item.get("library_name") == "gguf"
        task = pipeline
        if gguf and pipeline in {"unknown", None, ""}:
            task = "text-generation"
        return {
            "id": item.get("id") or item.get("modelId"),
            "author": (item.get("id") or "").split("/")[0],
            "downloads": item.get("downloads", 0),
            "likes": item.get("likes", 0),
            "trending_score": item.get("trendingScore", 0),
            "pipeline_tag": pipeline,
            "task": task,
            "library": item.get("library_name"),
            "tags": tags[:30],
            "license": license_tag or "unknown",
            "created_at": item.get("createdAt"),
            "updated_at": item.get("lastModified"),
            "gated": item.get("gated", False),
            "private": bool(item.get("private")),
            "gguf": gguf,
        }

    async def model_detail(self, repo_id: str) -> dict[str, Any]:
        validate_repo_id(repo_id)
        cache_key = f"detail:{repo_id}"
        cached = self._cached(cache_key)
        if cached:
            return cached
        url = f"{self.settings.hf_api_base}/api/models/{repo_id}?blobs=true"
        try:
            async with httpx.AsyncClient(timeout=25.0, follow_redirects=True, verify=tls_verify()) as client:
                response = await client.get(url, headers=self._headers())
        except httpx.HTTPError as exc:
            raise CatalogError(f"Hugging Face Hub is unreachable: {exc}") from exc
        if response.status_code == 401:
            raise CatalogError("This repository is gated or private. Configure an HF token.")
        if response.status_code == 404:
            raise CatalogError("Model not found on Hugging Face.")
        if response.status_code >= 400:
            raise CatalogError(f"Hugging Face returned HTTP {response.status_code}.")
        data = response.json()
        normalized = self._normalize(data)
        siblings = []
        for sibling in data.get("siblings") or []:
            name = sibling.get("rfilename")
            if not name:
                continue
            lfs = sibling.get("lfs") or {}
            size = sibling.get("size") or lfs.get("size") or 0
            siblings.append(
                {
                    "filename": name,
                    "size_bytes": int(size or 0),
                    "sha256": lfs.get("sha256"),
                    "is_lfs": bool(lfs),
                }
            )
        siblings.sort(key=lambda entry: entry["size_bytes"])
        gguf_files = [f for f in siblings if f["filename"].lower().endswith(".gguf")]
        card_data = data.get("cardData") or {}
        license_value = normalized["license"]
        if isinstance(card_data, dict) and card_data.get("license"):
            license_value = card_data["license"]
        detail = {
            **normalized,
            "description": data.get("description") or "",
            "siblings": siblings[:200],
            "gguf_files": gguf_files,
            "formats": sorted(
                {
                    f["filename"].rsplit(".", 1)[-1].lower()
                    for f in siblings
                    if "." in f["filename"]
                }
            )[:20],
            "license": license_value,
            "downloads": data.get("downloads", normalized["downloads"]),
            "used_storage": data.get("usedStorage"),
            "card_data": card_data if isinstance(card_data, dict) else {},
        }
        return self._store(cache_key, detail)

    async def readme(self, repo_id: str) -> str:
        validate_repo_id(repo_id)
        url = f"{self.settings.hf_api_base}/{repo_id}/raw/main/README.md"
        try:
            async with httpx.AsyncClient(timeout=20.0, follow_redirects=True, verify=tls_verify()) as client:
                response = await client.get(url, headers=self._headers())
            if response.status_code >= 400:
                return ""
            return response.text[:20000]
        except httpx.HTTPError:
            return ""
