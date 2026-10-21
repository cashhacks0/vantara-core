# VANTARA AI — Architecture

## Boundaries

```text
Browser (React 19 + TypeScript + Tailwind + React Flow + Zustand + TanStack Query)
   │ REST + SSE (/api)
   ▼
FastAPI application
   ├── ChatService ──► RuntimeManager ──► llama.cpp / Ollama / Transformers / remote
   ├── WorkflowEngine ──► node registry ──► RuntimeManager + KnowledgeService
   ├── AgentService ──► ToolRegistry ──► knowledge / uploads / outputs / workflow engine
   ├── HuggingFaceCatalog + DownloadManager ──► Hub API + local model directory
   └── SQLite (Database abstraction)
```

The browser never talks to model servers directly. Only the backend holds provider credentials and performs filesystem access.

## Persistence

SQLite through `backend/app/core/db.py`. The schema is created idempotently; writes use short-lived connections, WAL mode, and a process-wide write lock. Tables:

`settings`, `conversations`, `messages`, `installed_models`, `downloads`, `workflows`, `workflow_runs`, `agents`, `agent_runs`, `knowledge_bases`, `documents`, `chunks`, `outputs`, `audit_logs`, `providers`.

A future Postgres migration only needs to reimplement `Database.query/execute/insert/update` and schema bootstrap; services do not issue driver-specific calls.

## Runtime contract

`backend/app/runtimes/base.py` defines `RuntimeModel`, `RuntimeStatus`, `GenerationOptions`, `ChatMessage`, and the `ChatRuntime` / `EmbeddingRuntime` protocols. A model is addressed as `runtime::model-id`:

- `llama.cpp::qwen2.5-0.5b-instruct-q4_k_m.gguf`
- `ollama::llama3.2:3b`
- `transformers::/abs/path/to/model-dir`
- `remote::<provider-id>/<model-name>` (explicit only)

`RuntimeManager.resolve()` never falls back to a remote provider. `auto` iterates available local runtimes (llama.cpp, Ollama, Transformers).

### llama.cpp lifecycle

1. Validate the GGUF path is inside `VANTARA_MODELS_DIR`.
2. Reuse the healthy child server if it already serves the same file.
3. Otherwise terminate the previous child and spawn `llama-server` on `127.0.0.1:8199`, setting `LD_LIBRARY_PATH` to its build directory.
4. Poll `/health` up to 90 s; surface a startup log tail on failure.
5. Stream `/v1/chat/completions`; cancellation closes the request.
6. Keep a single model loaded to avoid duplicate RAM/VRAM use.

## Workflow engine

`validator.py` rejects unknown node types, duplicate ids, missing endpoints, self-edges, duplicate target ports, missing required inputs, type mismatches, >50 nodes, and cycles. It produces a deterministic Kahn topological order.

`executor.py` sequentially evaluates that order, passes typed values per port, marks required inputs that resolve to `None` as `skipped` (conditional branches), emits `run_started`, `plan`, `node_started`, `node_delta`, `node_completed`, `node_skipped`, `preview`, and terminal events, enforces per-node/per-run timeouts, persists events/outputs, and supports cancellation.

Nodes live in `backend/app/nodes/` and are registered by decorator. Adding a node requires a spec, typed ports, config fields, validation, and execution logic. The executor never evaluates user-provided code.

## Knowledge retrieval

- Extraction: plain text, PDF (`pypdf`), DOCX (`python-docx`).
- Chunking: paragraph/sentence boundaries, roughly 1200 characters with overlap.
- Embeddings: optional local model. If the runtime cannot embed, documents are marked `indexed_lexical` and the error is retained.
- Retrieval: cosine over stored vectors when available, else deterministic term-frequency scoring. The UI labels the mode.
- RAG prompts constrain the model to supplied context and treat it as untrusted data.

## Agents

`ToolRegistry` exposes JSON-schema-like descriptors. The agent prompt requires one JSON object per turn:

```json
{"tool": "calculator", "arguments": {"expression": "2+2"}}
{"answer": "4"}
```

Tools are allowlisted per agent. `write_output` is marked `modifies` and triggers an approval gate. No shell tool exists. Tool observations are wrapped as untrusted data. Step count and time are bounded.

## Downloads

- Only weight-like extensions are accepted (`.gguf`, `.safetensors`, `.bin`, `.onnx`, `.pt`).
- Repository ids and relative paths are validated; target names are sanitized.
- A single-instance lock prevents duplicate jobs; installed records block re-downloads.
- HTTP resume via `Range`, disk preflight, size verification, cancellation flags, throttled progress.
- 401/403 produce a gated-repository explanation. Access controls are never bypassed.

## Security

- Loopback default, CORS allowlist, request-size and per-client rate limits.
- `safe_join` for uploads/outputs/model paths; absolute and traversal components rejected.
- Fernet encryption for provider keys with a `0600` key file.
- SSRF guard resolves hostnames and blocks private/loopback/link-local/reserved targets; HTTP nodes need global and per-node opt-in.
- Log redaction for bearer tokens, `api_key`, `hf_*`, and `sk-*` patterns.
- Model cards, documents, tool outputs, and prompts are untrusted content.

## Extension points

- Runtime adapters implementing `ChatRuntime`.
- Postgres storage adapter.
- Video/TTS studio backends implementing the capability contract.
- ComfyUI importer mapping nodes to VANTARA node types (not implemented).
- Scheduler for background automation (not implemented; no claims are made).
