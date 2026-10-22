import httpx
from fastapi.testclient import TestClient

from app.main import create_app
from app.providers.ollama import OllamaProvider


def client(handler):
    p = OllamaProvider("http://mock", transport=httpx.MockTransport(handler))
    return TestClient(create_app(p))


def test_health_connected():
    c = client(lambda r: httpx.Response(200, json={"version": "0.5.0"}))
    body = c.get("/api/health").json()
    assert body["status"] == "ok" and body["runtime"]["connected"] is True


def test_health_runtime_down():
    def h(r):
        raise httpx.ConnectError("refused")
    r = client(h).get("/api/health")
    assert r.status_code == 200 and r.json()["runtime"]["connected"] is False


def test_models_list_and_unavailable():
    c = client(lambda r: httpx.Response(200, json={"models": [{"name": "llama3.2:1b"}]}))
    assert c.get("/api/models").json()["models"][0]["name"] == "llama3.2:1b"
    def h(r):
        raise httpx.ConnectError("x")
    assert client(h).get("/api/models").status_code == 503


def test_malformed_runtime_response():
    c = client(lambda r: httpx.Response(200, text="not json"))
    assert c.get("/api/models").status_code == 503


def test_system():
    c = client(lambda r: httpx.Response(200, json={}))
    assert "os" in c.get("/api/system").json()
