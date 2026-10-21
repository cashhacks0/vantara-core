from app.core.db import DEFAULT_SETTINGS


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"


def test_root(client):
    response = client.get("/api")
    assert response.status_code == 200
    assert response.json()["name"] == "VANTARA AI"


def test_dashboard_and_seeded_data(client):
    response = client.get("/api/dashboard")
    assert response.status_code == 200
    data = response.json()
    assert data["counts"]["workflows"] >= 2
    assert data["counts"]["agents"] >= 1
    assert any(runtime["id"] == "llama.cpp" for runtime in data["runtimes"])


def test_settings_roundtrip_and_validation(client):
    current = client.get("/api/settings").json()
    assert current["telemetry_enabled"] is False
    response = client.put("/api/settings", json={"values": {"theme": "dark", "llama_context": 2048, "telemetry_enabled": False}})
    assert response.status_code == 200
    assert response.json()["llama_context"] == 2048
    bad = client.put("/api/settings", json={"values": {"unsafe_secret": "x"}})
    assert bad.status_code == 400
    clamped = client.put("/api/settings", json={"values": {"llama_context": 999999}})
    assert clamped.json()["llama_context"] == 32768


def test_workflow_node_catalog(client):
    response = client.get("/api/workflows/nodes")
    assert response.status_code == 200
    nodes = response.json()["nodes"]
    types = {node["type"] for node in nodes}
    assert {"text_input", "prompt_template", "llm", "text_output", "image_input", "image_output"} <= types
    assert len(nodes) >= 18
    http_node = next(node for node in nodes if node["type"] == "http_request")
    assert http_node["config"][0]["key"] == "enabled"


def test_seeded_workflows(client):
    workflows = client.get("/api/workflows").json()["workflows"]
    assert len(workflows) >= 2
    assert any("LLM" in workflow["name"] for workflow in workflows)


def test_storage_and_system_info(client):
    assert client.get("/api/system/info").status_code == 200
    storage = client.get("/api/system/storage")
    assert storage.status_code == 200
    assert "disk" in storage.json()
    logs = client.get("/api/system/logs")
    assert logs.status_code == 200
