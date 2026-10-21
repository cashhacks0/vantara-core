#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> VANTARA AI setup"
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt
(cd frontend && npm install)

mkdir -p data/models/gguf data/uploads data/outputs data/logs data/cache
[ -f .env ] || cp .env.example .env

echo
 echo "Dependencies installed."
echo "Next steps:"
echo "  1. Install a llama.cpp server binary:  ./scripts/install_llama_cpp.sh"
echo "  2. (Optional) Download a tiny test model: ./scripts/download_sample_model.sh"
echo "  3. Start development:                    ./scripts/dev.sh"
echo "  4. Or build + serve production:          ./scripts/run.sh"
