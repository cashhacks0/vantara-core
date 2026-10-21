import time


def graph_chain(llm_config=None):
    return {
        "nodes": [
            {"id": "in", "type": "text_input", "position": {"x": 0, "y": 0}, "config": {"text": "Hello"}},
            {"id": "tpl", "type": "prompt_template", "position": {"x": 200, "y": 0}, "config": {"template": "{{input}} world"}},
            {"id": "llm", "type": "llm", "position": {"x": 400, "y": 0}, "config": llm_config or {"model": "auto", "max_tokens": 64}},
            {"id": "out", "type": "text_output", "position": {"x": 600, "y": 0}, "config": {"label": "Answer"}},
        ],
        "edges": [
            {"id": "e1", "source": "in", "target": "tpl", "sourceHandle": "text", "targetHandle": "input"},
            {"id": "e2", "source": "tpl", "target": "llm", "sourceHandle": "prompt", "targetHandle": "prompt"},
            {"id": "e3", "source": "llm", "target": "out", "sourceHandle": "text", "targetHandle": "text"},
        ],
    }


def test_validate_valid_graph(client):
    response = client.post("/api/workflows/validate", json={"graph": graph_chain()})
    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is True
    assert body["errors"] == []


def test_validate_rejects_cycle_and_unknown_nodes(client):
    graph = graph_chain()
    graph["edges"].append({"id": "cycle", "source": "out", "target": "in", "sourceHandle": None, "targetHandle": None})
    result = client.post("/api/workflows/validate", json={"graph": graph}).json()
    assert result["valid"] is False
    assert any("cycle" in error.lower() for error in result["errors"])
    unknown = {"nodes": [{"id": "x", "type": "not_a_node", "position": {"x": 0, "y": 0}, "config": {}}], "edges": []}
    result = client.post("/api/workflows/validate", json={"graph": unknown}).json()
    assert result["valid"] is False
    assert any("unknown node" in error.lower() for error in result["errors"])


def test_validate_requires_connected_ports(client):
    graph = {"nodes": [{"id": "llm", "type": "llm", "position": {"x": 0, "y": 0}, "config": {}}], "edges": []}
    result = client.post("/api/workflows/validate", json={"graph": graph}).json()
    assert result["valid"] is False
    assert any("requires input" in error for error in result["errors"])


def test_run_rejects_invalid_workflow(client):
    response = client.post("/api/workflows/run", json={"graph": {"nodes": [], "edges": []}})
    assert response.status_code == 422


def test_execute_real_dag_with_fake_runtime(client, app, fake_runtime):
    created = client.post("/api/workflows", json={"name": "Test chain", "graph": graph_chain()}).json()
    response = client.post(f"/api/workflows/{created['id']}/run", json={})
    assert response.status_code == 202
    run_id = response.json()["run_id"]
    status = "running"
    for _ in range(80):
        run = client.get(f"/api/workflow-runs/{run_id}").json()
        status = run["status"]
        if status != "running":
            break
        time.sleep(0.05)
    assert status == "completed", run.get("error")
    assert run["outputs"]["out"]["text"].startswith("Local ")
    assert any(event["type"] == "node_delta" for event in run["events"])
    assert any(event["type"] == "run_completed" for event in run["events"])
    assert fake_runtime.calls == 1


def test_conditional_skips_inactive_branch(client, fake_runtime):
    graph = {
        "nodes": [
            {"id": "in", "type": "text_input", "position": {"x": 0, "y": 0}, "config": {"text": "hello"}},
            {"id": "cond", "type": "conditional", "position": {"x": 200, "y": 0}, "config": {"operator": "contains", "compare": "nope"}},
            {"id": "out", "type": "text_output", "position": {"x": 400, "y": 0}, "config": {}},
        ],
        "edges": [
            {"id": "e1", "source": "in", "target": "cond", "sourceHandle": "text", "targetHandle": "value"},
            {"id": "e2", "source": "cond", "target": "out", "sourceHandle": "true", "targetHandle": "text"},
        ],
    }
    run_id = client.post("/api/workflows/run", json={"graph": graph}).json()["run_id"]
    for _ in range(60):
        run = client.get(f"/api/workflow-runs/{run_id}").json()
        if run["status"] != "running": break
        time.sleep(0.05)
    assert run["status"] == "completed"
    assert any(event["type"] == "node_skipped" for event in run["events"])


def test_workflow_crud(client):
    created = client.post("/api/workflows", json={"name": "CRUD flow", "graph": graph_chain()}).json()
    fetched = client.get(f"/api/workflows/{created['id']}").json()
    assert fetched["name"] == "CRUD flow"
    updated = client.put(f"/api/workflows/{created['id']}", json={"name": "Renamed flow", "graph": graph_chain()}).json()
    assert updated["name"] == "Renamed flow"
    assert client.delete(f"/api/workflows/{created['id']}").status_code == 204
    assert client.get(f"/api/workflows/{created['id']}").status_code == 404


def test_generate_workflow_from_prompt(client):
    # Without an upload the planner falls back to a valid text workflow.
    response = client.post("/api/workflows/generate", json={"prompt": "Summarize a document and report the key points"})
    assert response.status_code == 200
    data = response.json()
    assert data["validation"]["valid"] is True
    types = [node["type"] for node in data["graph"]["nodes"]]
    assert "llm" in types and "text_output" in types and "text_input" in types
    saved = client.post("/api/workflows", json={"name": data["name"], "description": data["description"], "graph": data["graph"]})
    assert saved.status_code == 201

    # With an uploaded document the planner uses the file reader nodes.
    client.post("/api/uploads", files={"file": ("brief.txt", b"notes", "text/plain")})
    document = client.post("/api/workflows/generate", json={"prompt": "Summarize a document and report the key points"}).json()
    document_types = [node["type"] for node in document["graph"]["nodes"]]
    assert "file_input" in document_types and "file_reader" in document_types
    assert document["validation"]["valid"] is True

    text = client.post("/api/workflows/generate", json={"prompt": "Explain the idea of local-first AI"}).json()
    assert "llm" in [node["type"] for node in text["graph"]["nodes"]]
    assert text["validation"]["valid"] is True
