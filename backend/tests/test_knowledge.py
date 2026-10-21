from app.services.documents import chunk_text, extract_text


def test_chunking_respects_boundaries():
    text = "\n\n".join([f"Paragraph {index} " + "word " * 60 for index in range(12)])
    chunks = chunk_text(text, chunk_size=500, overlap=50)
    assert len(chunks) > 1
    assert all(chunk["content"] for chunk in chunks)
    assert [chunk["ordinal"] for chunk in chunks] == list(range(len(chunks)))


def test_extraction_rejects_unsupported(tmp_path):
    path = tmp_path / "binary.exe"
    path.write_bytes(b"MZ")
    try:
        extract_text(path)
        raise AssertionError("expected ValueError")
    except ValueError as exc:
        assert "Unsupported" in str(exc)


def test_knowledge_base_ingest_search_and_ask(client, app, fake_runtime):
    kb = client.post("/api/knowledge-bases", json={"name": "Docs", "description": "Test KB"}).json()
    assert kb["name"] == "Docs"
    files = {"file": ("guide.md", b"# Local AI\n\nVANTARA runs models locally and keeps prompts private. \n\nQuantization reduces memory usage.", "text/markdown")}
    response = client.post(f"/api/knowledge-bases/{kb['id']}/documents", files=files)
    assert response.status_code == 201
    document = response.json()
    assert document["status"] == "indexed"
    assert document["chunk_count"] >= 1

    search = client.post(f"/api/knowledge-bases/{kb['id']}/search", json={"query": "quantization memory", "top_k": 3}).json()
    assert search["mode"] == "lexical"
    assert search["results"]
    assert "guide.md" in search["results"][0]["citation"]

    answer = client.post(f"/api/knowledge-bases/{kb['id']}/ask", json={"question": "What does quantization do?", "model_id": "auto"}).json()
    assert answer["answer"].startswith("Local ")
    assert answer["sources"]
    assert answer["mode"] == "lexical"

    detail = client.get(f"/api/knowledge-bases/{kb['id']}").json()
    assert len(detail["documents"]) == 1
    assert client.delete(f"/api/knowledge-bases/{kb['id']}/documents/{document['id']}").status_code == 204
    assert client.delete(f"/api/knowledge-bases/{kb['id']}").status_code == 204


def test_failed_extraction_is_recorded(client):
    kb = client.post("/api/knowledge-bases", json={"name": "Broken"}).json()
    files = {"file": ("archive.bin", b"\x00\x01\x02", "application/octet-stream")}
    document = client.post(f"/api/knowledge-bases/{kb['id']}/documents", files=files).json()
    assert document["status"] == "failed"
    assert "Unsupported" in document["error"]


def test_search_empty_kb(client):
    kb = client.post("/api/knowledge-bases", json={"name": "Empty"}).json()
    result = client.post(f"/api/knowledge-bases/{kb['id']}/search", json={"query": "anything"}).json()
    assert result["results"] == []
    assert result["mode"] == "empty"
