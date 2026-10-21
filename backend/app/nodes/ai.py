"""Model-backed workflow nodes."""

from __future__ import annotations

import json
from typing import Any

from ..runtimes.base import ChatMessage, GenerationOptions
from ..workflow_engine.base import ConfigField, Node, NodeContext, NodeError, NodeSpec, PortSpec, register


async def _run_llm(ctx: NodeContext, prompt: str, config: dict[str, Any], node_id: str) -> str:
    resolved = await ctx.runtimes.resolve(config.get("model") or "auto")
    messages = []
    system_prompt = str(config.get("system_prompt") or "").strip()
    if system_prompt:
        messages.append(ChatMessage(role="system", content=system_prompt))
    messages.append(ChatMessage(role="user", content=prompt))
    options = GenerationOptions(
        temperature=float(config.get("temperature", 0.7)),
        max_tokens=int(config.get("max_tokens", 512)),
    )
    parts: list[str] = []
    await ctx.emit({"type": "node_started", "node_id": node_id, "model": resolved.model.public(), "runtime": resolved.runtime_id})
    try:
        async for delta in resolved.runtime.chat_stream(resolved.model, messages, options):
            ctx.check_cancelled()
            parts.append(delta)
            await ctx.emit({"type": "node_delta", "node_id": node_id, "content": delta})
    except Exception as exc:
        hint = getattr(exc, "hint", None)
        raise NodeError(f"Model generation failed: {exc}", hint=hint) from exc
    return "".join(parts)


@register
class LLMNode(Node):
    spec = NodeSpec(
        type="llm", label="Local LLM", category="AI",
        description="Generate text through an installed local model. Never calls a remote provider implicitly.",
        inputs=[PortSpec("prompt", "text", True)],
        outputs=[PortSpec("text", "text")],
        config=[
            ConfigField("model", "Model", "model", "auto", help="Use 'auto' or pick an installed model"),
            ConfigField("system_prompt", "System prompt", "textarea", ""),
            ConfigField("temperature", "Temperature", "number", 0.7),
            ConfigField("max_tokens", "Max tokens", "number", 512),
        ],
        requires=["llama.cpp|ollama|transformers"],
    )

    async def execute(self, ctx, inputs, config):
        prompt = inputs.get("prompt")
        if isinstance(prompt, list):
            outputs = []
            for index, item in enumerate(prompt):
                await ctx.emit({"type": "node_progress", "node_id": "llm", "message": f"Processing item {index + 1}/{len(prompt)}"})
                outputs.append(await _run_llm(ctx, str(item), config, ctx.node_id))
            return {"text": "\n\n".join(outputs), "items": outputs}
        if prompt is None:
            return {"text": ""}
        return {"text": await _run_llm(ctx, str(prompt), config, ctx.node_id)}


@register
class ChatModelNode(Node):
    spec = NodeSpec(
        type="chat_model", label="Chat Model", category="AI",
        description="Conversational generation with an optional system instruction.",
        inputs=[PortSpec("prompt", "text", True), PortSpec("context", "text", False)],
        outputs=[PortSpec("text", "text")],
        config=[
            ConfigField("model", "Model", "model", "auto"),
            ConfigField("system_prompt", "System prompt", "textarea", "You are a concise assistant."),
            ConfigField("max_tokens", "Max tokens", "number", 512),
        ],
    )

    async def execute(self, ctx, inputs, config):
        prompt = str(inputs.get("prompt") or "")
        context = inputs.get("context")
        if context:
            prompt = f"Context:\n{context}\n\nQuestion: {prompt}"
        return {"text": await _run_llm(ctx, prompt, config, ctx.node_id)}


@register
class EmbeddingsNode(Node):
    spec = NodeSpec(
        type="embeddings", label="Embeddings", category="AI",
        description="Create vectors with a local embedding-capable model.",
        inputs=[PortSpec("text", "text", True)],
        outputs=[PortSpec("embedding", "embedding")],
        config=[ConfigField("model", "Embedding model", "model", "auto", required=True)],
        requires=["ollama|llama.cpp"],
    )

    async def execute(self, ctx, inputs, config):
        text = inputs.get("text")
        texts = [str(t) for t in text] if isinstance(text, list) else [str(text or "")]
        try:
            resolved = await ctx.runtimes.resolve(config.get("model") or "auto", task="embeddings")
        except Exception as exc:
            raise NodeError(
                f"No embedding model available: {exc}",
                hint="Install an embedding model (for example an Ollama embedding model) and select it here.",
            ) from exc
        embed = getattr(resolved.runtime, "embed", None)
        if not embed:
            raise NodeError("The selected runtime does not support embeddings.")
        vectors = await embed(resolved.model, texts)
        return {"embedding": vectors[0] if len(vectors) == 1 else vectors}


@register
class VectorSearchNode(Node):
    spec = NodeSpec(
        type="vector_search", label="Vector Search", category="Knowledge",
        description="Retrieve passages from a local knowledge base (vector or lexical fallback).",
        inputs=[PortSpec("query", "text", True)],
        outputs=[PortSpec("text", "text"), PortSpec("sources", "json")],
        config=[
            ConfigField("kb_id", "Knowledge base", "text", "", required=True),
            ConfigField("top_k", "Top results", "number", 6),
        ],
    )

    async def execute(self, ctx, inputs, config):
        kb_id = str(config.get("kb_id") or "")
        query = str(inputs.get("query") or "")
        try:
            import asyncio

            result = await asyncio.to_thread(ctx.knowledge.search, kb_id, query, int(config.get("top_k") or 6))
        except KeyError as exc:
            raise NodeError(str(exc)) from exc
        if not result["results"]:
            return {"text": "", "sources": []}
        text = "\n\n".join(f"[{i + 1}] {r['citation']}\n{r['content']}" for i, r in enumerate(result["results"]))
        return {"text": text, "sources": result["results"]}


@register
class ImageModelNode(Node):
    spec = NodeSpec(
        type="image_model", label="Image Model", category="AI",
        description="Generate an image with a local Diffusers pipeline when installed.",
        inputs=[PortSpec("prompt", "text", True), PortSpec("image", "image", False)],
        outputs=[PortSpec("image", "image")],
        config=[
            ConfigField("model", "Pipeline path or repo", "text", ""),
            ConfigField("negative_prompt", "Negative prompt", "text", ""),
            ConfigField("width", "Width", "number", 512),
            ConfigField("height", "Height", "number", 512),
            ConfigField("steps", "Steps", "number", 24),
            ConfigField("seed", "Seed (-1 = random)", "number", -1),
        ],
        requires=["diffusers", "torch"],
    )

    async def execute(self, ctx, inputs, config):
        from ..services.studios import generate_image

        prompt = inputs.get("prompt")
        if isinstance(prompt, list):
            prompt = "\n".join(str(p) for p in prompt)
        try:
            result = await generate_image(
                prompt=str(prompt or ""),
                negative_prompt=str(config.get("negative_prompt") or ""),
                model=str(config.get("model") or ""),
                width=int(config.get("width") or 512),
                height=int(config.get("height") or 512),
                steps=int(config.get("steps") or 24),
                seed=int(config.get("seed") if config.get("seed") is not None else -1),
                outputs_dir=ctx.outputs_dir,
                init_image=(inputs.get("image") or {}).get("path"),
            )
        except RuntimeError as exc:
            raise NodeError(str(exc), hint=getattr(exc, "hint", None)) from exc
        ctx.db.insert(
            "outputs",
            {"id": result["output_id"], "kind": "image", "name": result["name"],
             "path": result["path"], "mime": "image/png",
             "meta_json": json.dumps({"run_id": ctx.run_id}), "created_at": __import__("datetime").datetime.utcnow().isoformat()},
        )
        return {"image": result}
