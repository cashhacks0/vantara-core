import json


HTML = """<!doctype html>
<html><head><title>AI page</title></head><body><h1>Built locally</h1></body></html>"""


def _events(client, project_id, payload):
    events = []
    with client.stream("POST", f"/api/projects/{project_id}/code/stream", json=payload) as response:
        assert response.status_code == 200
        for line in response.iter_lines():
            if line.startswith("data: ") and line != "data: [DONE]":
                events.append(json.loads(line[6:]))
    return events


def test_build_writes_real_file_and_records_task(client, fake_runtime):
    project = client.post("/api/projects", json={"name": "AI site", "description": "Make a hero page", "kind": "static"}).json()
    fake_runtime.replies = [HTML]
    events = _events(client, project["id"], {"prompt": "Build a bold hero page", "mode": "build", "model_id": "auto"})
    types = [event["type"] for event in events]
    assert "delta" in types and "file_changed" in types and "test_result" in types and "done" in types
    done = next(event for event in events if event["type"] == "done")
    assert done["status"] == "completed"
    content = client.get(f"/api/projects/{project['id']}/file?path=index.html").json()["content"]
    assert content == HTML
    diff = client.get(f"/api/projects/{project['id']}/diff").json()
    assert diff["summary"]["changed"] >= 1
    tasks = client.get(f"/api/projects/{project['id']}/tasks").json()["tasks"]
    assert tasks[0]["status"] == "completed"
    assert tasks[0]["checkpoint_id"]
    memory = client.get(f"/api/projects/{project['id']}/memory").json()["memory"]
    assert any(item["kind"] == "decision" for item in memory)


def test_build_rejects_incomplete_html_without_overwriting(client, fake_runtime):
    project = client.post("/api/projects", json={"name": "Safe", "kind": "static"}).json()
    before = client.get(f"/api/projects/{project['id']}/file?path=index.html").json()["content"]
    fake_runtime.replies = ["I cannot build that."]
    events = _events(client, project["id"], {"prompt": "Build something", "mode": "build"})
    assert any(event["type"] == "error" for event in events)
    after = client.get(f"/api/projects/{project['id']}/file?path=index.html").json()["content"]
    assert after == before


def test_agent_writes_file_with_tool_protocol(client, fake_runtime):
    project = client.post("/api/projects", json={"name": "Agent site", "kind": "static"}).json()
    write = json.dumps({"tool": "write_file", "arguments": {"path": "notes.html", "content": HTML}})
    finish = json.dumps({"tool": "finish", "arguments": {"summary": "Created notes.html"}})
    fake_runtime.replies = [write, finish]
    events = _events(client, project["id"], {"prompt": "Create a notes page using tools", "mode": "agent", "max_steps": 3})
    types = [event["type"] for event in events]
    assert "tool_call" in types and "tool_result" in types and "done" in types
    assert client.get(f"/api/projects/{project['id']}/file?path=notes.html").json()["content"] == HTML
    done = next(event for event in events if event["type"] == "done")
    assert done["status"] in {"completed", "needs_attention"}


def test_explain_does_not_change_files(client, fake_runtime):
    project = client.post("/api/projects", json={"name": "Explain", "kind": "static"}).json()
    before = client.get(f"/api/projects/{project['id']}/file?path=index.html").json()["content"]
    fake_runtime.replies = ["This page renders a hero with three feature cards."]
    events = _events(client, project["id"], {"prompt": "Explain this project", "mode": "explain"})
    assert any(event["type"] == "final_text" for event in events)
    after = client.get(f"/api/projects/{project['id']}/file?path=index.html").json()["content"]
    assert after == before
    diff = client.get(f"/api/projects/{project['id']}/diff").json()
    assert diff["summary"]["changed"] == 0


def test_missing_runtime_records_failed_task(client, app):
    project = client.post("/api/projects", json={"name": "No runtime", "kind": "static"}).json()
    from app.runtimes.base import RuntimeUnavailable

    async def unavailable(model_id=None, task="text-generation"):
        raise RuntimeUnavailable("No model installed.", hint="Install a model")

    app.state.runtimes.resolve = unavailable
    events = _events(client, project["id"], {"prompt": "Build", "mode": "build"})
    assert any(event["type"] == "error" for event in events)
    tasks = client.get(f"/api/projects/{project['id']}/tasks").json()["tasks"]
    assert tasks[0]["status"] == "failed"
    assert "No model installed" in tasks[0]["error"]
