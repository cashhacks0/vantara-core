"""Safe tool registry. No shell execution and no unrestricted filesystem access."""

from __future__ import annotations

import ast
import asyncio
import json
import operator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from ..core.db import new_id, utc_now
from ..knowledge.service import KnowledgeService
from ..security import safe_filename, safe_join
from ..services.documents import extract_text
from ..workflow_engine.base import NODE_REGISTRY


@dataclass
class Tool:
    name: str
    description: str
    schema: dict[str, Any]
    modifies: bool
    handler: Callable[..., Any]

    def public(self) -> dict[str, Any]:
        return {"name": self.name, "description": self.description, "schema": self.schema, "modifies": self.modifies}


_ALLOWED_BINOPS = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.Div: operator.truediv, ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod, ast.Pow: operator.pow,
}
_ALLOWED_UNARY = {ast.UAdd: operator.pos, ast.USub: operator.neg}


def safe_calculate(expression: str) -> float:
    if len(expression) > 200:
        raise ValueError("Expression is too long")
    tree = ast.parse(expression, mode="eval")
    def evaluate(node):
        if isinstance(node, ast.Expression):
            return evaluate(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return node.value
        if isinstance(node, ast.BinOp) and type(node.op) in _ALLOWED_BINOPS:
            left, right = evaluate(node.left), evaluate(node.right)
            if isinstance(node.op, ast.Pow) and abs(right) > 12:
                raise ValueError("Exponent too large")
            return _ALLOWED_BINOPS[type(node.op)](left, right)
        if isinstance(node, ast.UnaryOp) and type(node.op) in _ALLOWED_UNARY:
            return _ALLOWED_UNARY[type(node.op)](evaluate(node.operand))
        raise ValueError("Only numeric arithmetic is allowed")
    return evaluate(tree)


class ToolRegistry:
    def __init__(self, db, knowledge: KnowledgeService, uploads_dir: Path, outputs_dir: Path):
        self.db = db
        self.knowledge = knowledge
        self.uploads_dir = uploads_dir
        self.outputs_dir = outputs_dir
        self.tools: dict[str, Tool] = {}
        self._register_defaults()

    def _register_defaults(self) -> None:
        self.tools["calculator"] = Tool(
            "calculator", "Evaluate a numeric arithmetic expression.",
            {"expression": "string"}, False, self._calculator,
        )
        self.tools["read_file"] = Tool(
            "read_file", "Read text from a file previously uploaded to VANTARA.",
            {"name": "uploaded file name"}, False, self._read_file,
        )
        self.tools["search_knowledge"] = Tool(
            "search_knowledge", "Search a local knowledge base and return cited passages.",
            {"kb_id": "knowledge base id", "query": "search query"}, False, self._search_knowledge,
        )
        self.tools["write_output"] = Tool(
            "write_output", "Write text to the local outputs folder (requires explicit approval).",
            {"name": "file name", "content": "text"}, True, self._write_output,
        )

    def register(self, tool: Tool) -> None:
        self.tools[tool.name] = tool

    def available(self) -> list[dict[str, Any]]:
        return [tool.public() for tool in self.tools.values()]

    async def call(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        tool = self.tools.get(name)
        if not tool:
            raise ValueError(f"Unknown tool '{name}'")
        result = tool.handler(**arguments)
        if asyncio.iscoroutine(result):
            result = await result
        return {"tool": name, "result": result}

    def _calculator(self, expression: str) -> dict[str, Any]:
        return {"value": safe_calculate(str(expression))}

    def _read_file(self, name: str) -> dict[str, Any]:
        path = safe_join(self.uploads_dir, Path(str(name)).name)
        if not path.exists():
            raise ValueError(f"Uploaded file not found: {Path(str(name)).name}")
        return {"name": path.name, "text": extract_text(path)[:20000]}

    def _search_knowledge(self, kb_id: str, query: str) -> dict[str, Any]:
        return self.knowledge.search(kb_id, query, top_k=5)

    def _write_output(self, name: str, content: str) -> dict[str, Any]:
        target = safe_join(self.outputs_dir, f"{safe_filename(name, 'agent-output')}-{new_id()[:6]}.txt")
        target.write_text(str(content)[:200000], encoding="utf-8")
        output_id = new_id("out_")
        self.db.insert(
            "outputs",
            {"id": output_id, "kind": "text", "name": target.name, "path": str(target),
             "mime": "text/plain", "meta_json": json.dumps({"source": "agent"}), "created_at": utc_now()},
        )
        return {"path": str(target), "output_id": output_id}
