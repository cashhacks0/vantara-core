import json


def _create(client, title="Test conversation"):
    response = client.post("/api/conversations", json={"title": title})
    assert response.status_code == 201
    return response.json()["id"]


def test_conversation_crud(client):
    conversation_id = _create(client)
    listing = client.get("/api/conversations").json()["conversations"]
    assert any(item["id"] == conversation_id for item in listing)
    updated = client.put(f"/api/conversations/{conversation_id}", json={"title": "Renamed", "temperature": 0.3})
    assert updated.status_code == 200 and updated.json()["title"] == "Renamed"
    exported = client.get(f"/api/conversations/{conversation_id}/export?format=markdown")
    assert exported.status_code == 200 and "Renamed" in exported.text
    assert client.delete(f"/api/conversations/{conversation_id}").status_code == 204
    assert client.get(f"/api/conversations/{conversation_id}").status_code == 404


def test_streaming_chat_persists_history(client, fake_runtime):
    conversation_id = _create(client)
    events = []
    with client.stream(
        "POST", f"/api/conversations/{conversation_id}/stream",
        json={"message": "Hello local model", "model_id": "auto"},
    ) as response:
        assert response.status_code == 200
        for line in response.iter_lines():
            if line.startswith("data: ") and line != "data: [DONE]":
                events.append(json.loads(line[6:]))
    types = [event["type"] for event in events]
    assert "delta" in types and "done" in types
    assert "Local " in "".join(event.get("content", "") for event in events if event["type"] == "delta")
    conversation = client.get(f"/api/conversations/{conversation_id}").json()
    assert [message["role"] for message in conversation["messages"]] == ["user", "assistant"]
    assert conversation["messages"][1]["status"] == "complete"
    assert conversation["title"] == "Test conversation"


def test_regenerate_replaces_assistant(client, fake_runtime):
    conversation_id = _create(client)
    with client.stream("POST", f"/api/conversations/{conversation_id}/stream", json={"message": "Hi", "model_id": "auto"}) as response:
        list(response.iter_lines())
    conversation = client.get(f"/api/conversations/{conversation_id}").json()
    assistant_id = conversation["messages"][-1]["id"]
    with client.stream("POST", f"/api/conversations/{conversation_id}/stream", json={"model_id": "auto", "regenerate_message_id": assistant_id}) as response:
        list(response.iter_lines())
    updated = client.get(f"/api/conversations/{conversation_id}").json()
    assistant_messages = [message for message in updated["messages"] if message["role"] == "assistant"]
    assert len(assistant_messages) == 1
    assert assistant_messages[0]["id"] != assistant_id


def test_stream_error_when_no_runtime(client, app):
    async def unavailable(model_id=None, task="text-generation"):
        from app.runtimes.base import RuntimeUnavailable
        raise RuntimeUnavailable("No local model is installed.", hint="Install a GGUF model.")

    app.state.runtimes.resolve = unavailable
    conversation_id = _create(client)
    events = []
    with client.stream("POST", f"/api/conversations/{conversation_id}/stream", json={"message": "Hi", "model_id": "auto"}) as response:
        for line in response.iter_lines():
            if line.startswith("data: ") and line != "data: [DONE]":
                events.append(json.loads(line[6:]))
    error = next(event for event in events if event["type"] == "error")
    assert error["hint"] == "Install a GGUF model."
    conversation = client.get(f"/api/conversations/{conversation_id}").json()
    assert conversation["messages"][-1]["status"] == "error"


def test_upload_and_attachment_metadata(client):
    files = {"file": ("notes.txt", b"VANTARA local notes", "text/plain")}
    response = client.post("/api/uploads", files=files)
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "notes.txt"
    assert "VANTARA" in data["extracted_text"]
    listing = client.get("/api/uploads").json()["uploads"]
    assert any(item["stored_name"] == data["stored_name"] for item in listing)


def test_edit_and_resend_truncates_following_messages(client, fake_runtime):
    conversation_id = _create(client)
    with client.stream("POST", f"/api/conversations/{conversation_id}/stream", json={"message": "Original prompt", "model_id": "auto"}) as response:
        list(response.iter_lines())
    conversation = client.get(f"/api/conversations/{conversation_id}").json()
    user_message = next(message for message in conversation["messages"] if message["role"] == "user")
    with client.stream("POST", f"/api/conversations/{conversation_id}/stream", json={
        "message": "Edited prompt", "model_id": "auto", "replace_message_id": user_message["id"],
    }) as response:
        list(response.iter_lines())
    updated = client.get(f"/api/conversations/{conversation_id}").json()
    assert [message["role"] for message in updated["messages"]] == ["user", "assistant"]
    assert updated["messages"][0]["content"] == "Edited prompt"
    assert updated["messages"][1]["status"] == "complete"


def test_image_upload_has_no_false_extraction_error(client):
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 64
    response = client.post("/api/uploads", files={"file": ("picture.png", png, "image/png")})
    assert response.status_code == 201
    payload = response.json()
    assert payload["extraction_error"] is None
    assert payload["extracted_text"] is None
