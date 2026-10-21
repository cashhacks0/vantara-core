# VANTARA AI — Build Status

Last updated: 2026-10-21
Version: 0.1.0

## Verified working

| Area | Status | Verification |
| --- | --- | --- |
| Backend startup & health | ✅ | `GET /api/health` → `{"status":"ok","database":"ok"}` |
| Frontend build | ✅ | `tsc -b` clean, `vite build` succeeds |
| Real local chat streaming | ✅ | llama.cpp b11796 + Qwen2.5-0.5B-Instruct Q4_K_M; SSE deltas + `done` |
| Conversation persistence | ✅ | SQLite messages reload via `GET /api/conversations/{id}`; covered by tests |
| Stop / cancel | ✅ implemented | AbortController closes SSE; server stores `cancelled` message status. No dedicated automated cancellation test yet. |
| Regenerate / edit & resend | ✅ | Automated tests cover both `regenerate_message_id` and `replace_message_id`; UI wired |
| Hugging Face catalog | ✅ | Live `/api/catalog/search` against huggingface.co, cursor pagination |
| Model detail + GGUF sizes | ✅ | Live `Qwen/Qwen2.5-0.5B-Instruct-GGUF` detail, license + 9 GGUF files |
| Downloads | ✅ | Live tiny Hub download completed at 453,864 bytes / 100%; validation, duplicate blocking, disk checks covered by tests |
| Installed model tracking | ✅ | `installed_models` records, delete with path containment |
| Workflow editor | ✅ | React Flow, 20-node palette, config inspector, save/load/import/export |
| Workflow execution | ✅ | Real text→template→local LLM→output run completed; events + outputs persisted |
| Invalid workflow handling | ✅ | 422 with structured errors; cycle/port/type tests |
| Run history | ✅ | Workflow and agent runs stored with event logs |
| Agents | ✅ | Tool loop with calculator verified under fake runtime; approval gate verified |
| Knowledge ingestion & RAG | ✅ | TXT upload, lexical search, real local model answer with citation |
| Image/Audio/Video gating | ✅ | Unavailable backends return explicit 503/501 and UI stays disabled |
| Security controls | ✅ | Path traversal, SSRF, secret encryption, rate limiting, optional access-token gate, project path + command allowlist tests |
| Creator Studio | ✅ | One prompt creates a typed project (website/game/python/node/blank) and opens the AI Terminal |
| AI Terminal file editing | ✅ | Real local-model build wrote index.html (1,023 B) and passed a real HTML structure check |
| AI Terminal commands | ✅ | `node --check app.js` executed via the allowlist and recorded with exit code |
| Project preview | ✅ | Sandboxed iframe route serves generated files with a restrictive CSP |
| Checkpoints + diff | ✅ | Zip snapshots, restore, unified diffs, per-task history |
| Project memory | ✅ | Per-project requirements/notes injected into AI context, editable and deletable |
| Workflow factory | ✅ | Prompt → validated graph (document, knowledge, image, text) with explanations |
| Remote provider opt-in | ✅ | Encrypted providers, explicit setting gate, explicit model ids only |

## Test matrix (executed)

```text
backend: 59 passed  (pytest)
frontend: 7 passed  (vitest, includes dashboard + AI Terminal smoke renders)
frontend build: successful
typescript strict check: successful
```

Manual live checks performed against a real llama.cpp server:

```text
POST /api/conversations/{id}/stream → streamed "VANTARA local inference works…"
POST /api/workflows/{id}/run → completed, text output stored
POST /api/knowledge-bases/{id}/ask → "Quantization reduces model memory." + citation
GET  /api/catalog/search → real Hub results
GET  / (built SPA) → 200 text/html; JS asset 200
```

## Environment used for validation

- Python 3.11.2, Node 24.15.0
- Linux x86_64, CPU-only inference
- llama.cpp b11796 managed server, loopback only
- Qwen2.5-0.5B-Instruct Q4_K_M GGUF (`data/models/gguf`, not committed)
- Ollama not installed; Transformers/PyTorch not installed; no GPU

## Known issues / not implemented

1. **Transformers adapter** is coded but unexercised here (PyTorch absent). Only local directories; no snapshot downloader.
2. **Image Studio** requires a manually installed Diffusers pipeline; none present. No placeholder generation is shown.
3. **Audio** ships transcription only when faster-whisper is installed. TTS detection is informational; no synthesis endpoint yet.
4. **Video Studio** is an interface + capability contract; generation is disabled (HTTP 501).
5. **Workflow HTTP** is off by default. DNS rebinding is not mitigated; no URL allowlist UI yet.
6. **ComfyUI import** not implemented; no compatibility claim.
7. **Agent JSON adherence** varies with tiny models; malformed output is logged as a final raw answer, never executed.
8. **Authentication** is absent. Do not expose the API to a network without an authenticated reverse proxy.
9. **Downloads** integrity is size-based only; optional SHA-256 verification is stored in metadata but not computed during transfer.
10. **Studio output → workflow** round-trip is not wired (future).
11. **Scheduled automation** does not exist; no background scheduler is claimed.
12. Model cards are rendered from README text; embedded HTML is sanitized by React Markdown defaults (no raw HTML).
13. Image Studio exposes batch size = 1 in this release; sequential multi-image batching is not wired yet.

## Next concrete development step

Per the new upgrade directive, the next step is **Phase 1 of the browser-based AI game engine**: a Projects page, a React Three Fiber editor shell (toolbar, outliner, 3D viewport, details panel, content browser), a typed JSON "game spec" with undo/redo, and IndexedDB project storage. A Diffusers image runtime adapter remains queued after that.

Add a **Diffusers image runtime adapter** with capability discovery, a model-directory picker, real progress callbacks, image-to-image support, and tests using a tiny local pipeline stub. This would make Image Studio and the `image_model` workflow node functional on GPU and CPU, and complete the second example workflow without relying on the resize-only fallback.

Secondary next steps:
- SHA-256 verification during downloads.
- Cross-platform llama.cpp installer for Windows and ROCm/Vulkan builds.
- Authenticated reverse-proxy profile (`VANTARA_API_TOKEN`) for LAN deployments.
- Playwright smoke test for the chat and workflow editor UIs.
