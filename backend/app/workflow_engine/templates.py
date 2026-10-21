"""Built-in example workflows (explicitly marked as templates)."""

from __future__ import annotations

import json

from ..core.db import new_id, utc_now


def text_llm_graph() -> dict:
    return {
        "nodes": [
            {"id": "text-in", "type": "text_input", "position": {"x": 40, "y": 160},
             "config": {"text": "Explain local-first AI in three concise sentences."}},
            {"id": "template", "type": "prompt_template", "position": {"x": 340, "y": 160},
             "config": {"template": "{{input}}"}},
            {"id": "llm", "type": "llm", "position": {"x": 640, "y": 160},
             "config": {"model": "auto", "system_prompt": "You are VANTARA. Be accurate and concise.", "temperature": 0.7, "max_tokens": 256}},
            {"id": "out", "type": "text_output", "position": {"x": 960, "y": 160},
             "config": {"label": "Local model answer"}},
        ],
        "edges": [
            {"id": "e1", "source": "text-in", "target": "template", "sourceHandle": "text", "targetHandle": "input"},
            {"id": "e2", "source": "template", "target": "llm", "sourceHandle": "prompt", "targetHandle": "prompt"},
            {"id": "e3", "source": "llm", "target": "out", "sourceHandle": "text", "targetHandle": "text"},
        ],
    }


def image_graph() -> dict:
    return {
        "nodes": [
            {"id": "img-in", "type": "image_input", "position": {"x": 40, "y": 160},
             "config": {"path": ""}},
            {"id": "resize", "type": "image_resize", "position": {"x": 360, "y": 160},
             "config": {"width": 512, "height": 512, "mode": "cover"}},
            {"id": "img-out", "type": "image_output", "position": {"x": 700, "y": 160},
             "config": {"name": "workflow-image"}},
        ],
        "edges": [
            {"id": "e1", "source": "img-in", "target": "resize", "sourceHandle": "image", "targetHandle": "image"},
            {"id": "e2", "source": "resize", "target": "img-out", "sourceHandle": "image", "targetHandle": "image"},
        ],
    }


def templates() -> list[dict]:
    return [
        {"id": "template-text-llm", "name": "Prompt → Local LLM → Text Output",
         "description": "Runs a prompt through an installed local model. Requires llama.cpp or Ollama.",
         "graph": text_llm_graph()},
        {"id": "template-image-resize", "name": "Image → Resize → Image Output",
         "description": "Local image processing pipeline (requires Pillow and an uploaded image).",
         "graph": image_graph()},
    ]


def seed_templates(db) -> None:
    if db.query_one("SELECT id FROM workflows LIMIT 1"):
        return
    now = utc_now()
    for template in templates():
        db.insert(
            "workflows",
            {"id": new_id("wf_"), "name": template["name"], "description": template["description"],
             "graph_json": json.dumps(template["graph"]), "created_at": now, "updated_at": now},
        )
