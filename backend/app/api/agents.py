"""Agent CRUD and bounded execution endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

router = APIRouter(tags=["agents"])


def _service(request: Request):
    return request.app.state.agents


@router.get("/agents/tools")
def tools(request: Request):
    return {"tools": _service(request).tools.available()}


@router.get("/agents")
def list_agents(request: Request):
    return {"agents": _service(request).list_agents()}


class AgentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = ""
    system_prompt: str = ""
    model_id: str | None = None
    tools: list[str] = Field(default_factory=lambda: ["calculator"])
    max_steps: int = Field(default=5, ge=1, le=10)
    require_approval: bool = True


class AgentUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    system_prompt: str | None = None
    model_id: str | None = None
    tools: list[str] | None = None
    max_steps: int | None = Field(default=None, ge=1, le=10)
    require_approval: bool | None = None


@router.post("/agents", status_code=201)
def create_agent(payload: AgentCreate, request: Request):
    return _service(request).create_agent(payload.model_dump())


@router.get("/agents/{agent_id}")
def get_agent(agent_id: str, request: Request):
    try:
        return _service(request).get_agent(agent_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.put("/agents/{agent_id}")
def update_agent(agent_id: str, payload: AgentUpdate, request: Request):
    try:
        return _service(request).update_agent(agent_id, payload.model_dump(exclude_none=True))
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.delete("/agents/{agent_id}", status_code=204)
def delete_agent(agent_id: str, request: Request):
    _service(request).delete_agent(agent_id)


class AgentRunRequest(BaseModel):
    input: str = Field(min_length=1, max_length=20000)
    approved: bool = False


@router.post("/agents/{agent_id}/run")
async def run_agent(agent_id: str, payload: AgentRunRequest, request: Request):
    try:
        return await _service(request).run(agent_id, payload.input, approved=payload.approved)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.get("/agent-runs")
def list_agent_runs(request: Request, limit: int = 50):
    return {"runs": _service(request).list_runs(max(1, min(limit, 200)))}
