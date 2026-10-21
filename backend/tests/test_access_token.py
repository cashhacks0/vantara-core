from dataclasses import replace

from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import make_settings


def test_access_token_gate(tmp_path):
    settings = replace(make_settings(tmp_path), access_token="test-secret-token")
    app = create_app(settings)
    with TestClient(app, follow_redirects=False) as client:
        assert client.get("/").status_code == 401
        assert client.get("/api/health").status_code == 401
        redirect = client.get("/?access=test-secret-token")
        assert redirect.status_code == 303
        assert "vantara_access" in redirect.headers.get("set-cookie", "")
        client.cookies.set("vantara_access", "test-secret-token")
        assert client.get("/api/health").status_code == 200
        client.cookies.set("vantara_access", "wrong")
        assert client.get("/api/health").status_code == 401
