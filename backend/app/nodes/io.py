"""I/O, preview, and HTTP nodes."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx

from ..core.db import new_id, utc_now
from ..security import safe_filename, safe_join, validate_outbound_url
from ..workflow_engine.base import ConfigField, Node, NodeContext, NodeError, NodeSpec, PortSpec, register


@register
class TextOutputNode(Node):
    spec = NodeSpec(
        type="text_output", label="Text Output", category="Output",
        description="Final text result for this run.",
        inputs=[PortSpec("text", "text", True)],
        outputs=[],
        config=[ConfigField("label", "Label", "text", "Result")],
    )

    async def execute(self, ctx, inputs, config):
        text = inputs.get("text")
        if isinstance(text, list):
            text = "\n\n".join(str(item) for item in text)
        text = str(text or "")
        await ctx.emit({"type": "preview", "node_id": ctx.node_id, "preview": {"kind": "text", "text": text[:12000], "label": config.get("label") or "Result"}})
        return {}


@register
class OutputPreviewNode(Node):
    spec = NodeSpec(
        type="output_preview", label="Output Preview", category="Output",
        description="Inspect an intermediate value in the run panel.",
        inputs=[PortSpec("value", "any", True)],
        outputs=[PortSpec("value", "any")],
        config=[],
    )

    async def execute(self, ctx, inputs, config):
        value = inputs.get("value")
        kind = "json"
        preview: Any = value
        if isinstance(value, str):
            kind = "text"
            preview = value[:4000]
        elif isinstance(value, dict) and value.get("path"):
            kind = "image" if str(value.get("mime", "")).startswith("image") else "file"
            preview = value
        await ctx.emit({"type": "preview", "node_id": ctx.node_id, "preview": {"kind": kind, "value": preview}})
        return {"value": value}


@register
class SaveOutputNode(Node):
    spec = NodeSpec(
        type="save_output", label="Save Output", category="Output",
        description="Persist text or structured output to the local outputs folder.",
        inputs=[PortSpec("value", "any", True)],
        outputs=[PortSpec("path", "text")],
        config=[
            ConfigField("name", "File name", "text", "workflow-output"),
            ConfigField("format", "Format", "select", "auto", options=["auto", "txt", "json", "md"]),
        ],
    )

    async def execute(self, ctx, inputs, config):
        value = inputs.get("value")
        if isinstance(value, dict) and value.get("path") and Path(str(value["path"])).exists():
            source = Path(str(value["path"]))
            target = safe_join(ctx.outputs_dir, f"{safe_filename(str(config.get('name') or 'workflow-output'))}-{new_id()[:8]}{source.suffix}")
            target.write_bytes(source.read_bytes())
            kind = "image" if source.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"} else "file"
            mime = value.get("mime")
        else:
            fmt = config.get("format") or "auto"
            if fmt == "auto":
                fmt = "json" if isinstance(value, (dict, list)) else "txt"
            text = json.dumps(value, indent=2) if fmt == "json" else str(value or "")
            target = safe_join(ctx.outputs_dir, f"{safe_filename(str(config.get('name') or 'workflow-output'))}-{new_id()[:8]}.{fmt}")
            target.write_text(text, encoding="utf-8")
            kind = "text"
            mime = "text/plain"
        output_id = new_id("out_")
        ctx.db.insert(
            "outputs",
            {
                "id": output_id, "kind": kind, "name": target.name, "path": str(target),
                "mime": mime, "meta_json": json.dumps({"run_id": ctx.run_id}), "created_at": utc_now(),
            },
        )
        return {"path": str(target), "output_id": output_id}


@register
class ImageResizeNode(Node):
    spec = NodeSpec(
        type="image_resize", label="Image Resize", category="Image",
        description="Resize or convert an image locally (requires Pillow).",
        inputs=[PortSpec("image", "image", True)],
        outputs=[PortSpec("image", "image")],
        config=[
            ConfigField("width", "Width", "number", 512),
            ConfigField("height", "Height", "number", 512),
            ConfigField("mode", "Fit mode", "select", "cover", options=["cover", "contain", "stretch"]),
        ],
        requires=["Pillow"],
    )

    async def execute(self, ctx, inputs, config):
        try:
            from PIL import Image, ImageOps
        except ImportError as exc:
            raise NodeError("Pillow is not installed, so image processing is unavailable.", hint="pip install Pillow") from exc
        image = inputs.get("image") or {}
        source = Path(str(image.get("path") or ""))
        if not source.exists():
            raise NodeError("No input image provided.")
        width = max(16, min(int(config.get("width") or 512), 4096))
        height = max(16, min(int(config.get("height") or 512), 4096))
        try:
            with Image.open(source) as opened:
                converted = opened.convert("RGB")
                mode = config.get("mode") or "cover"
                if mode == "cover":
                    processed = ImageOps.fit(converted, (width, height))
                elif mode == "contain":
                    processed = ImageOps.contain(converted, (width, height))
                else:
                    processed = converted.resize((width, height))
                target = safe_join(ctx.outputs_dir, f"resized-{new_id()[:8]}.png")
                processed.save(target, format="PNG")
        except OSError as exc:
            raise NodeError(f"Image processing failed: {exc}") from exc
        return {"image": {"path": str(target), "name": target.name, "mime": "image/png", "width": width, "height": height}}


@register
class HttpRequestNode(Node):
    spec = NodeSpec(
        type="http_request", label="HTTP Request", category="Network",
        description="Call an external HTTP API. Disabled unless the server enables workflow HTTP and the node is explicitly enabled.",
        inputs=[PortSpec("body", "text", False)],
        outputs=[PortSpec("text", "text"), PortSpec("json", "json")],
        config=[
            ConfigField("enabled", "Enable network access", "boolean", False, help="Requires VANTARA_ALLOW_WORKFLOW_HTTP=true on the server"),
            ConfigField("url", "URL", "text", ""),
            ConfigField("method", "Method", "select", "GET", options=["GET", "POST"]),
            ConfigField("headers_json", "Headers (JSON)", "textarea", "{}"),
            ConfigField("timeout", "Timeout seconds", "number", 15),
        ],
        requires=["network permission"],
    )

    def validate(self, config):
        errors = super().validate(config)
        if config.get("enabled") and not config.get("url"):
            errors.append("URL is required when network access is enabled")
        return errors

    async def execute(self, ctx, inputs, config):
        if not config.get("enabled"):
            raise NodeError("HTTP Request is disabled. Enable it in the node configuration first.")
        if not ctx.settings.allow_workflow_http:
            raise NodeError(
                "Workflow HTTP access is disabled on the server.",
                hint="Set VANTARA_ALLOW_WORKFLOW_HTTP=true only if you trust workflows you run.",
            )
        url = str(config.get("url") or "")
        try:
            validate_outbound_url(url)
        except ValueError as exc:
            raise NodeError(f"Blocked URL: {exc}") from exc
        try:
            headers = json.loads(config.get("headers_json") or "{}")
            if not isinstance(headers, dict):
                raise ValueError("Headers must be a JSON object")
        except (json.JSONDecodeError, ValueError) as exc:
            raise NodeError(f"Invalid headers JSON: {exc}") from exc
        method = str(config.get("method") or "GET").upper()
        body = inputs.get("body")
        kwargs: dict[str, Any] = {"headers": headers, "timeout": max(1, min(int(config.get("timeout") or 15), 60))}
        if method == "POST" and body is not None:
            kwargs["content"] = body if isinstance(body, str) else json.dumps(body)
        try:
            async with httpx.AsyncClient(follow_redirects=False) as client:
                response = await client.request(method, url, **kwargs)
        except httpx.HTTPError as exc:
            raise NodeError(f"HTTP request failed: {exc}") from exc
        text = response.text[:50000]
        try:
            parsed = response.json()
        except ValueError:
            parsed = None
        return {"text": text, "json": parsed, "status": response.status_code}
