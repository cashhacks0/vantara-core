import time
import pytest

from app.services.projects import validate_command


def test_project_create_files_and_path_safety(client):
    project = client.post("/api/projects", json={"name": "Test site", "description": "A landing page", "kind": "static"}).json()
    assert project["kind"] == "static"
    assert project["preview_entry"] == "index.html"
    paths = {entry["path"] for entry in project["files"]}
    assert {"index.html", "styles.css", "app.js", "README.md"} <= paths
    assert client.get(f"/api/projects/{project['id']}/file?path=index.html").status_code == 200
    traversal = client.get(f"/api/projects/{project['id']}/file?path=../../etc/passwd")
    assert traversal.status_code == 400
    absolute = client.get(f"/api/projects/{project['id']}/file?path=/etc/passwd")
    assert absolute.status_code in {400, 404}
    assert client.get(f"/api/projects/{project['id']}/file?path=node_modules/x.js").status_code == 400


def test_project_write_diff_checkpoint_restore(client):
    project = client.post("/api/projects", json={"name": "Edit me", "description": "", "kind": "blank"}).json()
    project_id = project["id"]
    checkpoints = client.get(f"/api/projects/{project_id}/checkpoints").json()["checkpoints"]
    assert checkpoints
    original = client.get(f"/api/projects/{project_id}/file?path=README.md").json()["content"]
    write = client.put(f"/api/projects/{project_id}/file", json={"path": "notes.md", "content": "# Notes\n", "checkpoint": True})
    assert write.status_code == 200
    diff = client.get(f"/api/projects/{project_id}/diff").json()
    assert diff["summary"]["added"] >= 1
    restore = client.post(f"/api/projects/{project_id}/checkpoints/{checkpoints[-1]['id']}/restore")
    assert restore.status_code == 200
    assert client.get(f"/api/projects/{project_id}/file?path=notes.md").status_code == 404
    assert client.get(f"/api/projects/{project_id}/file?path=README.md").json()["content"] == original


def test_memory_roundtrip(client):
    project = client.post("/api/projects", json={"name": "Memory", "kind": "blank"}).json()
    created = client.post(f"/api/projects/{project['id']}/memory", json={"kind": "requirement", "content": "Must stay local", "verified": True}).json()
    memory = client.get(f"/api/projects/{project['id']}/memory").json()["memory"]
    assert memory[0]["content"] == "Must stay local"
    assert memory[0]["verified"] is True
    assert client.delete(f"/api/projects/{project['id']}/memory/{created['id']}").status_code == 204


def test_command_allowlist_blocks_dangerous_commands(client):
    project = client.post("/api/projects", json={"name": "Commands", "kind": "blank"}).json()
    result = client.post(f"/api/projects/{project['id']}/commands", json={"command": "ls", "approved": True})
    assert result.status_code == 200 and result.json()["exit_code"] == 0
    for bad in ["rm -rf .", "cat /etc/passwd", "echo hello", "npm install left-pad", "sh -c ls", "ls; rm -rf .", "find . -delete"]:
        response = client.post(f"/api/projects/{project['id']}/commands", json={"command": bad, "approved": True})
        assert response.status_code == 400, bad
    unapproved = client.post(f"/api/projects/{project['id']}/commands", json={"command": "ls", "approved": False})
    assert unapproved.status_code == 400


def test_validate_command_unit():
    assert validate_command("ls -la") == ["ls", "-la"]
    assert validate_command("python -m py_compile main.py")
    for bad in ["curl https://example.com", "python -c 'print(1)'", "node -e console.log(1)", "git push"]:
        with pytest.raises(ValueError):
            validate_command(bad)


def test_preview_security_headers(client):
    project = client.post("/api/projects", json={"name": "Preview", "kind": "static"}).json()
    response = client.get(f"/api/projects/{project['id']}/preview/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "sandbox" not in response.headers.get("content-security-policy", "")
    assert "connect-src 'none'" in response.headers["content-security-policy"]


def test_project_delete(client):
    project = client.post("/api/projects", json={"name": "Temp", "kind": "blank"}).json()
    assert client.delete(f"/api/projects/{project['id']}").status_code == 204
    assert client.get(f"/api/projects/{project['id']}").status_code == 404
