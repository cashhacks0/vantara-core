"""Workflow node contracts and registry."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable

from ..core.config import Settings
from ..core.db import Database
from ..knowledge.service import KnowledgeService
from ..runtimes.registry import RuntimeManager


class NodeError(RuntimeError):
    def __init__(self, message: str, hint: str | None = None):
        super().__init__(message)
        self.hint = hint


@dataclass
class PortSpec:
    name: str
    type: str = "any"
    required: bool = False
    description: str = ""

    def public(self) -> dict[str, Any]:
        return {"name": self.name, "type": self.type, "required": self.required, "description": self.description}


@dataclass
class ConfigField:
    key: str
    label: str
    type: str = "text"
    default: Any = None
    options: list[str] = field(default_factory=list)
    help: str = ""
    required: bool = False

    def public(self) -> dict[str, Any]:
        return {
            "key": self.key, "label": self.label, "type": self.type, "default": self.default,
            "options": self.options, "help": self.help, "required": self.required,
        }


@dataclass
class NodeSpec:
    type: str
    label: str
    category: str
    description: str
    inputs: list[PortSpec] = field(default_factory=list)
    outputs: list[PortSpec] = field(default_factory=list)
    config: list[ConfigField] = field(default_factory=list)
    requires: list[str] = field(default_factory=list)
    disabled: bool = False

    def public(self) -> dict[str, Any]:
        return {
            "type": self.type, "label": self.label, "category": self.category,
            "description": self.description,
            "inputs": [i.public() for i in self.inputs],
            "outputs": [o.public() for o in self.outputs],
            "config": [c.public() for c in self.config],
            "requires": self.requires, "disabled": self.disabled,
        }


@dataclass
class NodeContext:
    db: Database
    runtimes: RuntimeManager
    knowledge: KnowledgeService
    settings: Settings
    run_id: str
    workflow_id: str | None
    cancel: asyncio.Event
    emit: Callable[[dict[str, Any]], Awaitable[None]]
    uploads_dir: Path
    outputs_dir: Path
    node_id: str = ""

    def check_cancelled(self) -> None:
        if self.cancel.is_set():
            raise asyncio.CancelledError("Workflow cancelled")


class Node:
    spec: NodeSpec

    async def execute(self, ctx: NodeContext, inputs: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    def validate(self, config: dict[str, Any]) -> list[str]:
        errors: list[str] = []
        for field_spec in self.spec.config:
            if field_spec.required and not config.get(field_spec.key):
                errors.append(f"'{field_spec.label}' is required")
        return errors


NODE_REGISTRY: dict[str, Node] = {}


def register(node_class: type[Node]) -> type[Node]:
    instance = node_class()
    NODE_REGISTRY[instance.spec.type] = instance
    return node_class


def node_specs() -> list[dict[str, Any]]:
    return [node.spec.public() for node in sorted(NODE_REGISTRY.values(), key=lambda n: (n.spec.category, n.spec.label))]
