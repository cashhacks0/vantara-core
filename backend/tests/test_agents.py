import pytest

from app.agents.tools import safe_calculate


def test_calculator_is_sandboxed():
    assert safe_calculate("2 + 3 * 4") == 14
    assert safe_calculate("-(2 ** 3)") == -8
    for expression in ["__import__('os').system('echo pwned')", "open('/etc/passwd').read()", "2 ** 100", "'a' * 4"]:
        with pytest.raises(ValueError):
            safe_calculate(expression)


def test_agent_crud_and_approval_gate(client):
    created = client.post("/api/agents", json={
        "name": "Writer", "description": "Writes files", "system_prompt": "Be careful",
        "tools": ["calculator", "write_output"], "max_steps": 3, "require_approval": True,
    })
    assert created.status_code == 201
    agent = created.json()
    assert agent["require_approval"] is True
    result = client.post(f"/api/agents/{agent['id']}/run", json={"input": "Write a report"}).json()
    assert result["status"] == "requires_approval"
    assert "write_output" in result["tools"]
    updated = client.put(f"/api/agents/{agent['id']}", json={"name": "Renamed"}).json()
    assert updated["name"] == "Renamed"
    assert client.delete(f"/api/agents/{agent['id']}").status_code == 204


def test_agent_tool_loop(client, app):
    from tests.conftest import FakeRuntime

    runtime = FakeRuntime(replies=[
        '{"tool": "calculator", "arguments": {"expression": "6 * 7"}}',
        '{"answer": "The answer is 42."}',
    ])

    async def resolve(model_id=None, task="text-generation"):
        from app.runtimes.base import RuntimeModel
        from app.runtimes.registry import ResolvedModel
        return ResolvedModel(model=RuntimeModel(id="fake-model", name="Fake", runtime="fake"), runtime=runtime, local=True, runtime_id="fake")

    app.state.runtimes.resolve = resolve
    agent = client.post("/api/agents", json={
        "name": "Calculator agent", "system_prompt": "Use tools", "tools": ["calculator"],
        "max_steps": 3, "require_approval": False,
    }).json()
    run = client.post(f"/api/agents/{agent['id']}/run", json={"input": "What is 6 * 7?"}).json()
    assert run["status"] == "completed"
    assert run["output"] == "The answer is 42."
    tool_steps = [step for step in run["steps"] if step["type"] == "tool"]
    assert tool_steps and tool_steps[0]["tool"] == "calculator"
    assert tool_steps[0]["observation"]["result"]["value"] == 42
    assert any(step["type"] == "final" for step in run["steps"])


def test_unapproved_tool_is_rejected(client, app):
    from tests.conftest import FakeRuntime

    runtime = FakeRuntime(replies=[
        '{"tool": "write_output", "arguments": {"name": "x", "content": "x"}}',
        '{"answer": "stopped"}',
    ])

    async def resolve(model_id=None, task="text-generation"):
        from app.runtimes.base import RuntimeModel
        from app.runtimes.registry import ResolvedModel
        return ResolvedModel(model=RuntimeModel(id="fake-model", name="Fake", runtime="fake"), runtime=runtime, local=True, runtime_id="fake")

    app.state.runtimes.resolve = resolve
    agent = client.post("/api/agents", json={
        "name": "Restricted", "system_prompt": "x", "tools": ["calculator"], "require_approval": False,
    }).json()
    run = client.post(f"/api/agents/{agent['id']}/run", json={"input": "write"}).json()
    assert run["status"] == "completed"
    observation = next(step for step in run["steps"] if step["type"] == "tool")["observation"]
    assert "not approved" in observation["error"]


def test_tool_listing(client):
    tools = client.get("/api/agents/tools").json()["tools"]
    names = {tool["name"] for tool in tools}
    assert {"calculator", "read_file", "search_knowledge", "write_output", "run_workflow"} <= names
    assert next(tool for tool in tools if tool["name"] == "write_output")["modifies"] is True
