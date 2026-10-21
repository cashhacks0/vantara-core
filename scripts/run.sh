#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
if [ ! -x .venv/bin/uvicorn ]; then echo "Run ./scripts/setup.sh first." >&2; exit 1; fi

(cd frontend && npm run build)
cd backend
exec ../.venv/bin/uvicorn app.main:app --host "${VANTARA_HOST:-127.0.0.1}" --port "${VANTARA_PORT:-8756}"
