import pytest
from pathlib import Path

from app.security import (
    RateLimiter, SecretBox, UnsafePathError, safe_filename, safe_join,
    tls_verify, validate_outbound_url, validate_relative_repo_path, validate_repo_id,
)


def test_safe_filename_strips_traversal():
    assert safe_filename("../../etc/passwd") == "passwd"
    assert safe_filename("..\\..\\windows\\system32") == "system32"
    assert safe_filename("") == "file"
    assert safe_filename("...") == "file"


def test_safe_join_blocks_escape(tmp_path):
    with pytest.raises(UnsafePathError):
        safe_join(tmp_path, "../outside.txt")
    with pytest.raises(UnsafePathError):
        safe_join(tmp_path, "/etc/passwd")
    assert safe_join(tmp_path, "inside.txt").parent == tmp_path.resolve()


def test_repo_validation():
    assert validate_repo_id("Qwen/Qwen2.5-0.5B-Instruct-GGUF")
    for bad in ["../evil", "a/b/c", "no spaces", ""]:
        with pytest.raises(ValueError):
            validate_repo_id(bad)
    with pytest.raises(ValueError):
        validate_relative_repo_path("../../weights.gguf")
    with pytest.raises(ValueError):
        validate_relative_repo_path("/absolute.gguf")


def test_secret_box_roundtrip(tmp_path):
    box = SecretBox(tmp_path / ".secret_key")
    token = box.encrypt("sk-test-secret")
    assert "sk-test-secret" not in token
    assert box.decrypt(token) == "sk-test-secret"
    assert box.decrypt("garbage") is None


def test_ssrf_guard_blocks_private_addresses():
    with pytest.raises(ValueError):
        validate_outbound_url("http://127.0.0.1:8080/admin")
    with pytest.raises(ValueError):
        validate_outbound_url("http://169.254.169.254/latest/meta-data")
    with pytest.raises(ValueError):
        validate_outbound_url("file:///etc/passwd")
    with pytest.raises(ValueError):
        validate_outbound_url("https://user:pass@example.com/")


def test_rate_limiter_window():
    limiter = RateLimiter(limit=2)
    assert limiter.check("a")[0]
    assert limiter.check("a")[0]
    allowed, retry = limiter.check("a")
    assert allowed is False and retry >= 1
    assert limiter.check("b")[0]


def test_tls_context_is_constructible():
    verify = tls_verify()
    assert verify is not None
