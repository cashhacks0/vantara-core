"""FastAPI dependencies backed by app.state singletons."""

from __future__ import annotations

from fastapi import Request

from ..agents.service import AgentService
from ..core.db import Database
from ..knowledge.service import KnowledgeService
from ..runtimes.registry import RuntimeManager
from ..services.catalog import HuggingFaceCatalog
from ..services.downloads import DownloadManager
from ..workflow_engine.executor import WorkflowEngine


def db(request: Request) -> Database:
    return request.app.state.db


def runtimes(request: Request) -> RuntimeManager:
    return request.app.state.runtimes


def catalog(request: Request) -> HuggingFaceCatalog:
    return request.app.state.catalog


def downloads(request: Request) -> DownloadManager:
    return request.app.state.downloads


def knowledge(request: Request) -> KnowledgeService:
    return request.app.state.knowledge


def engine(request: Request) -> WorkflowEngine:
    return request.app.state.engine


def agents(request: Request) -> AgentService:
    return request.app.state.agents
