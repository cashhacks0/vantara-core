# VANTARA AI

A local-first AI operating environment: conversational AI, Hugging Face model discovery and installation, executable visual workflows, agents, knowledge bases, and media studios — built around runtimes you control.

VANTARA does not impose application-level message quotas on supported local inference. Your CPU, RAM, GPU, storage, and electricity are the real constraints.

## What works in this build

- **VANTARA Chat** — streaming responses over SSE, stop/cancel, regenerate, edit and resend, Markdown + syntax highlighting, attachments (TXT/MD/PDF/DOCX extraction), conversation search/rename/delete, export, per-conversation system prompt/temperature/token limits, local/remote indicators.
- **Local inference** — managed [llama.cpp](https://github.com/ggml-org/llama.cpp) GGUF runtime on loopback, optional Ollama auto-detection, optional Transformers adapter, hardware report, model warm-up, graceful OOM/startup errors, runtime diagnostics.
- **Hugging Face Model Library** — live Hub API search with cursor pagination and server-side filtering, model cards, license/task metadata, real GGUF file sizes, hardware-fit guidance, cancellable/resumable downloads with progress, installed-model tracking, disk checks and gated-repository errors.
- **Visual workflows** — React Flow editor with 20 typed nodes, port/type validation, cycle detection, deterministic DAG execution, branch skipping, cancellation, SSE run events, output preview, persisted workflows and run history, JSON import/export, two working templates.
- **Image / Audio / Video Studios** — capability-gated interfaces. Image generation works only with a local Diffusers pipeline; audio transcription works only with `faster-whisper`; video generation is deliberately disabled until a real backend is registered.
- **AI Agents** — bounded tool loops with calculator, uploaded-file reading, knowledge search, workflow execution, and approved output writing. Modifying tools require explicit human approval. No shell execution.
- **Knowledge bases** — TXT/MD/PDF/DOCX ingestion, chunking, lexical retrieval, optional local embeddings, cited passages, RAG answers with source citations and visible extraction errors.
- **Settings** — local runtime controls, privacy toggles, encrypted provider credentials, storage breakdown, logs, diagnostics, remote-provider opt-in.
- **Creator Studio** — one-prompt project creation with inferred project type (website, playable browser game, Python, Node.js, blank).
- **AI Terminal** — pick any installed local model, then build or edit **real files** in a project workspace: plan → generate → write → validate → checkpoint → diff. Includes a sandboxed live preview, project memory, task history, checkpoints with restore, and an allowlisted command runner.
- **Workflow factory** — generate a validated, editable workflow graph from a plain-language request (document, knowledge, image, or text pipeline).
- **Game Editor (Phase 1)** — a browser-based 3D editor: Projects page, Unreal-style shell (toolbar, outliner, 3D viewport, details panel, content browser), transform gizmos with snapping, multi-select and duplicate, 50-step undo/redo, a versioned JSON "game spec" validated with zod, IndexedDB storage in your browser, and zip export/import so you own your games. The AI assistant is docked on the right and already answers questions about your scene with a local model.

See [`docs/BUILD_STATUS.md`](docs/BUILD_STATUS.md) for the verified test matrix and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for module boundaries.

## Requirements

- Python 3.11+
- Node.js 20+ (works with Node 24)
- Linux or macOS (Windows via WSL2)
- A llama.cpp `llama-server` binary and a GGUF model for local chat, **or** an installed Ollama instance
- Optional: NVIDIA/AMD/Apple acceleration, `torch` + `diffusers` for images, `faster-whisper` for audio

No GPU is required for the app to run. Model fit and speed depend on the model and hardware; VANTARA does not promise a specific tokens/second rate.

## Quick start

```bash
# 1. Install application dependencies
./scripts/setup.sh

# 2. Install a llama.cpp CPU server binary (Linux x64 / macOS)
./scripts/install_llama_cpp.sh

# 3. Optional: download a tiny Apache-2.0 test model (~491 MB)
./scripts/download_sample_model.sh

# 4a. Development (Vite on :5173, FastAPI on :8756)
./scripts/dev.sh

# 4b. Or production build served by FastAPI
./scripts/run.sh
```

Open **http://127.0.0.1:5173** in development or **http://127.0.0.1:8756** after `run.sh`.

If you prefer manual commands:

```bash
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt
(cd frontend && npm install)
mkdir -p data/models/gguf data/uploads data/outputs data/logs data/cache
(cd backend && ../.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8756)
(cd frontend && npm run dev)
```

### Using an existing Ollama install

Start Ollama, then open **Local Models → Inference runtimes → Test**. VANTARA detects models from `/api/tags`. No configuration is required for the default `http://127.0.0.1:11434`.

### Using a different llama.cpp binary

```bash
export VANTARA_LLAMA_SERVER=/absolute/path/to/llama-server
```

VANTARA starts the server itself with loopback binding and a single loaded model, and stops/reloads it when you switch models.

### Hugging Face tokens and gated models

Set `HF_TOKEN` in the server environment (never in frontend code). VANTARA does not bypass gated access: if a repository requires license acceptance, the download fails with an explanatory error.

```bash
export HF_TOKEN=hf_...
```

## Testing

```bash
# Backend: 59 tests (API, chat streaming, workflows, agents, knowledge, security)
cd backend && ../.venv/bin/python -m pytest -q

# Frontend: type check, production build, unit + smoke-render tests
cd frontend && npx tsc -b && npm run build && npx vitest run
```

Tests use fake inference adapters and never download weights. Live local inference was validated separately with `llama.cpp b11796` + `Qwen2.5-0.5B-Instruct Q4_K_M`.

## Configuration

Copy `.env.example` to `.env`. Key variables:

| Variable | Purpose | Default |
| --- | --- | --- |
| `VANTARA_DATA_DIR` | SQLite DB, uploads, outputs, logs | `./data` |
| `VANTARA_MODELS_DIR` | GGUF and model directories | `data/models` |
| `VANTARA_PROJECTS_DIR` | Creator/AI Terminal project workspaces | `data/projects` |
| `VANTARA_HOST` / `VANTARA_PORT` | API bind address | `127.0.0.1:8756` |
| `VANTARA_LLAMA_SERVER` | llama-server binary path | `vendor/llama.cpp/llama-server` |
| `VANTARA_LLAMA_CONTEXT` / `VANTARA_LLAMA_THREADS` | Default generation settings | `4096` / `4` |
| `HF_TOKEN` | Gated Hub access / rate limits | unset |
| `VANTARA_ALLOW_WORKFLOW_HTTP` | Enable outbound workflow HTTP nodes | `false` |
| `VANTARA_ALLOW_REMOTE_PROVIDERS` | Deployment-level remote hint | `false` |
| `VANTARA_ACCESS_TOKEN` | Optional single-token gate for tunnels/LAN access | unset |

Remote providers also require **Settings → Privacy → Allow remote providers** and an explicit model selection in chat. There is no automatic remote fallback.

## Security posture

- API binds to loopback by default.
- GGUF model paths are constrained to the configured models directory; uploads and outputs use traversal-safe joins.
- Provider API keys are encrypted at rest with a local `0600` key file and never returned to the browser or logged.
- Workflow HTTP nodes are disabled twice: globally and per node; URLs are SSRF-checked (private/loopback/link-local blocked).
- Graph limits: 50 nodes, 240 s per node, 900 s per run. Cycles are rejected.
- No shell tool exists. Agent file access is limited to uploaded files; writes require approval.
- Retrieved documents and model cards are treated as untrusted data in prompts.
- Rate limiting and request size limits are enabled.

`VANTARA_ACCESS_TOKEN` adds a single shared-secret gate (HTTP-only cookie set via `/?access=TOKEN`). It is suitable for temporary tunnels, **not** a replacement for multi-user authentication.

**Exposing VANTARA beyond localhost is not supported out of the box.** Put it behind an authenticated reverse proxy, set an explicit CORS allowlist, and review the threat model first.

## Project layout

```text
backend/app/
  api/                FastAPI routers (chat, catalog, workflows, agents, knowledge, studios, settings)
  core/               config, SQLite persistence, structured logging
  runtimes/           llama.cpp, Ollama, Transformers, remote OpenAI-compatible adapters
  workflow_engine/    validator, DAG executor, templates
  nodes/              built-in node implementations
  agents/             safe tool registry and bounded agent loop
  knowledge/          ingestion, retrieval, RAG
  services/           catalog, downloads, chat, documents, hardware, studios, uploads
  security/           path guards, credential encryption, SSRF, rate limits
frontend/src/
  components/         design system, layout, model picker, Markdown
  pages/              12 application pages
  lib/                API/SSE client, types, query hooks, formatting, stores
scripts/              setup, llama.cpp install, sample model, dev/run
vendor/llama.cpp/     installed locally, never committed
data/                 local models, DB, uploads, outputs (ignored)
```

## Known limitations (honest list)

- Transformers inference is implemented but untested in this environment because `torch` is not installed; only local directories with `config.json` are supported (no implicit snapshot downloads).
- Image generation requires a manually installed local Diffusers pipeline. Audio TTS detection exists, but no TTS endpoint ships in this release. Video generation has an interface and capability contract only.
- Workflow HTTP is opt-in and does not yet implement DNS-rebinding hardening or an allowlist UI.
- ComfyUI workflow import is **not** implemented. No compatibility is claimed.
- Agent JSON tool protocol can be unreliable with very small models; malformed output is recorded rather than invented into a tool call.
- No authentication layer is included for network-exposed deployments.
- The catalog browses the live Hub; availability and metadata depend on Hugging Face. The "10,000+ models" target refers to discoverable listings, not installed models.
- Lexical retrieval is used when no embedding model is configured; results are labeled accordingly.
- Project AI tasks are sequential (not parallel agents). Small local models can return weak code; VANTARA refuses to overwrite a file with unchanged or invalid output and reports validation honestly.
- The AI Terminal command runner is allowlisted (`ls`, `git status/diff`, `node --check`, `python -m pytest`, `npm test`, …). Shell operators, absolute paths, installs, and network calls are rejected.
- Previews render in a sandboxed iframe with `connect-src 'none'`, so generated pages cannot call the VANTARA API or read cookies.

## License and model usage

VANTARA source is provided as-is for this build. Model weights carry their own licenses. Check each Hugging Face model card before downloading or commercial use.
