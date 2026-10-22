# VANTARA LOCAL AI

Local-first AI studio (FastAPI backend + React frontend, Ollama runtime). No subscription, API key, telemetry or cloud inference. Model licenses and hardware requirements vary per model.

## Status
Milestone 1 (foundation) done: FastAPI backend, provider interface, Ollama provider, `/api/health`, `/api/system`, `/api/models` (list), tests.
Not yet built: chat, SQLite persistence, frontend UI, downloads, Hugging Face. Nothing unbuilt is presented as working.

## Run the backend (Windows PowerShell)
```
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8787
```
On Linux/macOS use `.venv/bin/...`. Then open http://127.0.0.1:8787/api/health (docs at /docs).

## Tests
```
cd backend
.venv\Scripts\python -m pytest -q   # set PYTHONPATH=. if imports fail
```

## Configuration (env vars)
`VANTARA_HOST` (127.0.0.1), `VANTARA_PORT` (8787), `VANTARA_RUNTIME_URL` (http://127.0.0.1:11434), `VANTARA_DATA_DIR`, `VANTARA_CORS_ORIGINS`.

The backend binds to 127.0.0.1 by default. Install Ollama from https://ollama.com separately.
