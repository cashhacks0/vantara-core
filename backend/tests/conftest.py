import sys
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import Settings
from app.main import create_app
from app.runtimes.base import RuntimeModel, RuntimeStatus
from app.runtimes.registry import ResolvedModel


class FakeRuntime:
    id = "fake"
    label = "Fake runtime"

    def __init__(self, replies=None, embed_vector=None):
        self.replies = list(replies or ["Local ", "answer"])
        self.calls = 0
        self.embed_vector = embed_vector or [0.1, 0.2, 0.3]

    async def status(self):
        return RuntimeStatus(
            id=self.id, label=self.label, available=True,
            detail="Fake runtime for tests", capabilities=["chat"],
            models=[RuntimeModel(id="fake-model", name="Fake model", runtime=self.id)],
        )

    async def list_models(self):
        return [RuntimeModel(id="fake-model", name="Fake model", runtime=self.id)]

    async def chat_stream(self, model, messages, options):
        self.calls += 1
        reply = self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]
        for chunk in [reply[i:i + 6] for i in range(0, len(reply), 6)]:
            yield chunk

    async def embed(self, model, texts):
        return [self.embed_vector for _ in texts]


def make_settings(tmp_path: Path) -> Settings:
    base = Settings.from_env()
    data = tmp_path / "data"
    return replace(
        base,
        data_dir=data,
        db_path=data / "test.db",
        models_dir=data / "models",
        uploads_dir=data / "uploads",
        outputs_dir=data / "outputs",
        cache_dir=data / "cache",
        logs_dir=data / "logs",
        projects_dir=data / "projects",
        hf_token=None,
        allow_workflow_http=False,
        llama_server_path=None,
        rate_limit_per_minute=10_000,
    )


@pytest.fixture()
def app(tmp_path):
    application = create_app(make_settings(tmp_path))
    return application


@pytest.fixture()
def client(app):
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def fake_runtime(app):
    runtime = FakeRuntime()

    async def resolve(model_id=None, task="text-generation"):
        return ResolvedModel(
            model=RuntimeModel(id="fake-model", name="Fake model", runtime="fake"),
            runtime=runtime, local=True, runtime_id="fake",
        )

    app.state.runtimes.resolve = resolve
    return runtime
