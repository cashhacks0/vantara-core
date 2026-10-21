"""Deterministic text/file/image nodes."""

from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any

from ..core.db import new_id, utc_now
from ..security import safe_filename, safe_join
from ..services.documents import extract_text
from ..workflow_engine.base import ConfigField, Node, NodeContext, NodeError, NodeSpec, PortSpec, register


@register
class TextInputNode(Node):
    spec = NodeSpec(
        type="text_input", label="Text Input", category="Input",
        description="Static text or prompt seed.",
        outputs=[PortSpec("text", "text")],
        config=[ConfigField("text", "Text", "textarea", "", required=True)],
    )

    async def execute(self, ctx, inputs, config):
        return {"text": str(config.get("text") or "")}


@register
class PromptTemplateNode(Node):
    spec = NodeSpec(
        type="prompt_template", label="Prompt Template", category="Text",
        description="Compose a prompt with {{input}} and {{context}} placeholders.",
        inputs=[PortSpec("input", "text", False), PortSpec("context", "text", False)],
        outputs=[PortSpec("prompt", "text")],
        config=[ConfigField("template", "Template", "textarea", "{{input}}", required=True)],
    )

    async def execute(self, ctx, inputs, config):
        template = str(config.get("template") or "")
        values = {"input": inputs.get("input", ""), "context": inputs.get("context", "")}
        text = template
        for key, value in values.items():
            if isinstance(value, list):
                value = "\n".join(str(v) for v in value)
            text = text.replace("{{" + key + "}}", str(value))
        missing = re.findall(r"\{\{(\w+)\}\}", text)
        if missing:
            raise NodeError(f"Unresolved template variables: {', '.join(sorted(set(missing)))}.")
        return {"prompt": text}


@register
class TextProcessorNode(Node):
    spec = NodeSpec(
        type="text_processor", label="Text Processor", category="Text",
        description="Apply deterministic text operations (no code execution).",
        inputs=[PortSpec("text", "text", True)],
        outputs=[PortSpec("text", "text")],
        config=[
            ConfigField("operation", "Operation", "select", "trim", options=["trim", "lowercase", "uppercase", "collapse_whitespace", "regex_replace", "split_lines", "truncate"]),
            ConfigField("pattern", "Regex pattern", "text", "", help="Used by regex_replace"),
            ConfigField("replacement", "Replacement", "text", ""),
            ConfigField("limit", "Limit (characters)", "number", 2000),
        ],
    )

    async def execute(self, ctx, inputs, config):
        text = str(inputs.get("text") or "")
        operation = config.get("operation") or "trim"
        if operation == "trim":
            result = text.strip()
        elif operation == "lowercase":
            result = text.lower()
        elif operation == "uppercase":
            result = text.upper()
        elif operation == "collapse_whitespace":
            result = re.sub(r"\s+", " ", text).strip()
        elif operation == "regex_replace":
            pattern = str(config.get("pattern") or "")
            if not pattern:
                raise NodeError("Regex replacement requires a pattern.")
            try:
                result = re.sub(pattern, str(config.get("replacement") or ""), text)
            except re.error as exc:
                raise NodeError(f"Invalid regex: {exc}") from exc
        elif operation == "split_lines":
            result = [line.strip() for line in text.splitlines() if line.strip()]
            return {"text": result}
        elif operation == "truncate":
            limit = int(config.get("limit") or 2000)
            result = text[: max(0, min(limit, 100000))]
        else:
            raise NodeError(f"Unknown text operation '{operation}'.")
        return {"text": result}


@register
class ConditionalNode(Node):
    spec = NodeSpec(
        type="conditional", label="Conditional Branch", category="Logic",
        description="Route a value to true or false based on a deterministic test.",
        inputs=[PortSpec("value", "any", True)],
        outputs=[PortSpec("true", "any"), PortSpec("false", "any")],
        config=[
            ConfigField("operator", "Operator", "select", "not_empty", options=["not_empty", "equals", "contains", "regex", "greater_than"]),
            ConfigField("compare", "Compare value", "text", ""),
        ],
    )

    async def execute(self, ctx, inputs, config):
        value = inputs.get("value")
        text = value if isinstance(value, str) else json.dumps(value) if value is not None else ""
        operator = config.get("operator") or "not_empty"
        compare = str(config.get("compare") or "")
        if operator == "not_empty":
            passed = bool(text.strip())
        elif operator == "equals":
            passed = text == compare
        elif operator == "contains":
            passed = compare in text
        elif operator == "regex":
            try:
                passed = re.search(compare, text) is not None
            except re.error as exc:
                raise NodeError(f"Invalid regex: {exc}") from exc
        elif operator == "greater_than":
            try:
                passed = float(text) > float(compare)
            except ValueError as exc:
                raise NodeError("greater_than requires numeric values.") from exc
        else:
            raise NodeError(f"Unknown operator '{operator}'.")
        return {"true": value if passed else None, "false": None if passed else value, "_branch": passed}


@register
class DataTransformNode(Node):
    spec = NodeSpec(
        type="data_transform", label="Data Transform", category="Logic",
        description="Parse JSON, stringify structured data, or fill a text template.",
        inputs=[PortSpec("value", "any", True)],
        outputs=[PortSpec("result", "any")],
        config=[ConfigField("mode", "Mode", "select", "to_text", options=["to_text", "parse_json", "template"])],
    )

    async def execute(self, ctx, inputs, config):
        value = inputs.get("value")
        mode = config.get("mode") or "to_text"
        if mode == "parse_json":
            if isinstance(value, (dict, list)):
                return {"result": value}
            try:
                return {"result": json.loads(str(value))}
            except json.JSONDecodeError as exc:
                raise NodeError(f"Invalid JSON: {exc}") from exc
        if mode == "template":
            template = str(config.get("template") or "{{value}}")
            return {"result": template.replace("{{value}}", str(value))}
        return {"result": value if isinstance(value, str) else json.dumps(value, indent=2)}


@register
class BatchNode(Node):
    spec = NodeSpec(
        type="batch", label="Batch / Loop", category="Logic",
        description="Split text into a list. LLM nodes process list items sequentially.",
        inputs=[PortSpec("text", "text", True)],
        outputs=[PortSpec("items", "list")],
        config=[
            ConfigField("separator", "Separator", "text", "\\n", help="Literal separator; \\n means newline"),
            ConfigField("max_items", "Maximum items", "number", 20),
        ],
    )

    async def execute(self, ctx, inputs, config):
        text = str(inputs.get("text") or "")
        separator = str(config.get("separator") or "\n").replace("\\n", "\n")
        items = [part.strip() for part in text.split(separator) if part.strip()]
        limit = max(1, min(int(config.get("max_items") or 20), 50))
        return {"items": items[:limit]}


@register
class FileInputNode(Node):
    spec = NodeSpec(
        type="file_input", label="File Input", category="Input",
        description="Reference a file previously uploaded to VANTARA.",
        outputs=[PortSpec("file", "file")],
        config=[ConfigField("path", "Uploaded file", "file", "", help="Choose from uploaded files", required=True)],
    )

    async def execute(self, ctx, inputs, config):
        raw = str(config.get("path") or "")
        path = safe_join(ctx.uploads_dir, Path(raw).name).resolve()
        if not path.exists():
            raise NodeError(f"Uploaded file not found: {Path(raw).name}")
        return {"file": {"path": str(path), "name": path.name, "size_bytes": path.stat().st_size}}


@register
class FileReaderNode(Node):
    spec = NodeSpec(
        type="file_reader", label="File Reader", category="Files",
        description="Extract text from an uploaded TXT, MD, PDF, or DOCX file.",
        inputs=[PortSpec("file", "file", True)],
        outputs=[PortSpec("text", "text")],
        config=[ConfigField("max_chars", "Maximum characters", "number", 20000)],
    )

    async def execute(self, ctx, inputs, config):
        file = inputs.get("file") or {}
        path = Path(str(file.get("path") or "")).resolve()
        if ctx.uploads_dir.resolve() not in path.parents:
            raise NodeError("File is outside the uploads directory.")
        try:
            text = extract_text(path)
        except ValueError as exc:
            raise NodeError(str(exc)) from exc
        limit = max(100, min(int(config.get("max_chars") or 20000), 200000))
        return {"text": text[:limit]}


@register
class ImageInputNode(Node):
    spec = NodeSpec(
        type="image_input", label="Image Input", category="Input",
        description="Reference an uploaded image.",
        outputs=[PortSpec("image", "image")],
        config=[ConfigField("path", "Uploaded image", "file", "", required=True)],
    )

    async def execute(self, ctx, inputs, config):
        path = safe_join(ctx.uploads_dir, Path(str(config.get("path") or "")).name).resolve()
        if not path.exists():
            raise NodeError(f"Image not found: {path.name}")
        if path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}:
            raise NodeError("Unsupported image format.")
        return {"image": {"path": str(path), "name": path.name, "mime": f"image/{path.suffix.lstrip('.').lower()}"}}


@register
class ImageOutputNode(Node):
    spec = NodeSpec(
        type="image_output", label="Image Output", category="Output",
        description="Copy an image into the VANTARA output gallery.",
        inputs=[PortSpec("image", "image", True)],
        outputs=[PortSpec("image", "image")],
        config=[ConfigField("name", "Output name", "text", "workflow-image")],
    )

    async def execute(self, ctx, inputs, config):
        image = inputs.get("image") or {}
        source = Path(str(image.get("path") or ""))
        if not source.exists():
            raise NodeError("No image available to write.")
        ctx.check_cancelled()
        name = safe_filename(str(config.get("name") or "workflow-image"))
        suffix = source.suffix or ".png"
        target = safe_join(ctx.outputs_dir, f"{name}-{new_id()[:8]}{suffix}")
        shutil.copyfile(source, target)
        output_id = new_id("out_")
        ctx.db.insert(
            "outputs",
            {
                "id": output_id, "kind": "image", "name": target.name, "path": str(target),
                "mime": image.get("mime"), "meta_json": json.dumps({"run_id": ctx.run_id}),
                "created_at": utc_now(),
            },
        )
        return {"image": {**image, "path": str(target), "output_id": output_id}}
