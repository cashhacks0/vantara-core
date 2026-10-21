"""Security primitives: safe paths, credential encryption, SSRF guards, limits."""

from __future__ import annotations

import base64
import ipaddress
import os
import re
import socket
import stat
import time
from collections import defaultdict, deque
from pathlib import Path
from urllib.parse import urlparse

from cryptography.fernet import Fernet, InvalidToken

from ..core.logging import get_logger

log = get_logger(__name__)

_UNSAFE_FILENAME = re.compile(r"[^A-Za-z0-9._\- ]+")
_REPO_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-]*(/[A-Za-z0-9][A-Za-z0-9._\-]*)?$")


class UnsafePathError(ValueError):
    pass


def safe_filename(name: str, fallback: str = "file") -> str:
    """Return a single path component with traversal and control chars removed."""
    candidate = os.path.basename(name.replace("\\", "/")).strip()
    candidate = _UNSAFE_FILENAME.sub("_", candidate).strip(". ")
    if not candidate or candidate in {".", ".."}:
        candidate = fallback
    return candidate[:180]


def safe_join(base: Path, *parts: str) -> Path:
    """Join under `base`, rejecting absolute parts and traversal escapes."""
    base = base.resolve()
    for part in parts:
        if not part or Path(part).is_absolute():
            raise UnsafePathError("Absolute paths are not allowed")
    target = base.joinpath(*parts).resolve()
    if target != base and base not in target.parents:
        raise UnsafePathError("Path escapes the allowed directory")
    return target


def validate_repo_id(repo_id: str) -> str:
    if not isinstance(repo_id, str) or not _REPO_ID.match(repo_id) or ".." in repo_id:
        raise ValueError("Invalid Hugging Face repository id")
    return repo_id


def validate_relative_repo_path(path: str) -> str:
    if not path or path.startswith("/") or "\\" in path or ".." in Path(path).parts:
        raise ValueError("Invalid repository file path")
    if len(path) > 512:
        raise ValueError("Repository path too long")
    return path


def reveal_secret(value: str | None) -> str:
    """Return a display-safe hint for a configured credential."""
    if not value:
        return ""
    if len(value) <= 8:
        return "configured"
    return f"{value[:3]}…{value[-2:]} (configured)"


class SecretBox:
    """Encrypt provider credentials at rest with a local 0600 key file.

    This protects against casual disclosure of the SQLite database.  It is not
    a substitute for OS-level disk encryption.
    """

    def __init__(self, key_path: Path):
        self.key_path = key_path
        self._fernet = Fernet(self._load_or_create_key())

    def _load_or_create_key(self) -> bytes:
        self.key_path.parent.mkdir(parents=True, exist_ok=True)
        if self.key_path.exists():
            raw = self.key_path.read_bytes().strip()
            return raw
        key = Fernet.generate_key()
        fd = os.open(self.key_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            os.write(fd, key)
        finally:
            os.close(fd)
        try:
            self.key_path.chmod(stat.S_IRUSR | stat.S_IWUSR)
        except OSError:
            pass
        return key

    def encrypt(self, value: str) -> str:
        return self._fernet.encrypt(value.encode("utf-8")).decode("ascii")

    def decrypt(self, token: str | None) -> str | None:
        if not token:
            return None
        try:
            return self._fernet.decrypt(token.encode("ascii")).decode("utf-8")
        except (InvalidToken, ValueError):
            log.warning("Stored provider credential could not be decrypted")
            return None


class RateLimiter:
    """Simple sliding-window limiter keyed by client identifier."""

    def __init__(self, limit: int, window_seconds: int = 60):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> tuple[bool, int]:
        now = time.monotonic()
        bucket = self._hits[key]
        while bucket and bucket[0] < now - self.window:
            bucket.popleft()
        if len(bucket) >= self.limit:
            retry = max(1, int(self.window - (now - bucket[0])))
            return False, retry
        bucket.append(now)
        return True, 0


def _is_public_ip(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def validate_outbound_url(url: str, allow_private: bool = False) -> str:
    """SSRF guard for the configurable HTTP request workflow node."""
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Only http and https URLs are allowed")
    if not parsed.hostname:
        raise ValueError("URL must include a hostname")
    if parsed.username or parsed.password:
        raise ValueError("URLs with embedded credentials are not allowed")
    if not allow_private:
        try:
            infos = socket.getaddrinfo(parsed.hostname, parsed.port or 80, proto=socket.IPPROTO_TCP)
        except socket.gaierror as exc:
            raise ValueError(f"Cannot resolve host: {exc}") from exc
        for info in infos:
            if not _is_public_ip(info[4][0]):
                raise ValueError("Private, loopback, and link-local addresses are blocked")
    return url


def mask_home(path: str) -> str:
    home = str(Path.home())
    return path.replace(home, "~") if home in path else path


def fingerprint(value: str) -> str:
    """Short stable digest for audit records (never logs the secret)."""
    import hashlib

    return base64.urlsafe_b64encode(hashlib.sha256(value.encode()).digest())[:10].decode()


def tls_verify():
    """Build a CA context from system roots plus an optional custom bundle.

    httpx defaults to certifi, which can miss enterprise roots installed in the
    OS store.  Loading the system default context and then appending any
    SSL_CERT_FILE/REQUESTS_CA_BUNDLE keeps both cases working.
    """
    import ssl

    context = ssl.create_default_context()
    for variable in ("SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE"):
        candidate = os.environ.get(variable)
        if candidate and Path(candidate).is_file():
            try:
                context.load_verify_locations(cafile=candidate)
            except (ssl.SSLError, OSError):
                continue
    return context
