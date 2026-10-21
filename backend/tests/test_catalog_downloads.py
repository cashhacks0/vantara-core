from pathlib import Path

from app.services.catalog import HuggingFaceCatalog


def test_catalog_metadata_normalization(client, app):
    catalog = HuggingFaceCatalog(app.state.settings)
    item = catalog._normalize({
        "id": "acme/model-gguf", "downloads": 1200, "likes": 8,
        "pipeline_tag": "text-generation", "library_name": "gguf",
        "tags": ["gguf", "license:apache-2.0", "region:us"],
        "gated": False, "private": False,
    })
    assert item["author"] == "acme"
    assert item["license"] == "apache-2.0"
    assert item["gguf"] is True
    assert item["task"] == "text-generation"


def test_catalog_search_route(client, app):
    async def fake_search(**kwargs):
        return {"items": [{"id": "acme/fake", "task": "text-generation"}], "next_cursor": None, "count": 1}

    app.state.catalog.search = fake_search
    response = client.get("/api/catalog/search?q=test&task=text-generation&limit=5")
    assert response.status_code == 200
    assert response.json()["items"][0]["id"] == "acme/fake"


def test_catalog_invalid_repo_is_rejected(client):
    response = client.get("/api/catalog/models/..%2F..%2Fetc")
    assert response.status_code == 404
    tasks = client.get("/api/catalog/tasks").json()
    assert "text-generation" in tasks["tasks"]


def test_download_validation(client):
    bad = client.post("/api/downloads", json={"repo_id": "acme/model", "filename": "README.md"})
    assert bad.status_code == 400
    traversal = client.post("/api/downloads", json={"repo_id": "../../etc", "filename": "model.gguf"})
    assert traversal.status_code == 400


def test_duplicate_install_is_blocked(client, app):
    app.state.db.insert("installed_models", {
        "id": "mdl_test", "repo_id": "acme/model", "display_name": "model", "filename": "model.gguf",
        "path": str(app.state.settings.models_dir / "model.gguf"), "size_bytes": 10,
        "runtime": "llama.cpp", "task": "text-generation", "quantization": "Q4_K_M",
        "license": "mit", "status": "installed", "metadata_json": "{}", "created_at": "2026-01-01T00:00:00+00:00",
    })
    response = client.post("/api/downloads", json={"repo_id": "acme/model", "filename": "model.gguf"})
    assert response.status_code == 400
    assert "already installed" in response.json()["detail"]


def test_remove_installed_does_not_delete_outside_models_dir(client, app, tmp_path):
    outside = tmp_path / "outside.gguf"
    outside.write_bytes(b"weights")
    app.state.db.insert("installed_models", {
        "id": "mdl_outside", "repo_id": "acme/outside", "display_name": "outside", "filename": "outside.gguf",
        "path": str(outside), "size_bytes": 7, "runtime": "llama.cpp", "task": "text-generation",
        "quantization": None, "license": None, "status": "installed", "metadata_json": "{}",
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    assert client.delete("/api/models/installed/mdl_outside").status_code == 200
    assert outside.exists()
    assert client.get("/api/models/installed").json()["models"] == []


def test_installed_listing_flags_runnable(client, app):
    path = Path(app.state.settings.models_dir) / "test.gguf"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * 32)
    app.state.db.insert("installed_models", {
        "id": "mdl_ok", "repo_id": "acme/ok", "display_name": "ok", "filename": "test.gguf",
        "path": str(path), "size_bytes": 32, "runtime": "llama.cpp", "task": "text-generation",
        "quantization": "Q4", "license": None, "status": "installed", "metadata_json": "{}",
        "created_at": "2026-01-01T00:00:00+00:00",
    })
    models = client.get("/api/models/installed").json()["models"]
    assert models[0]["runnable"] is True
    assert models[0]["exists"] is True
