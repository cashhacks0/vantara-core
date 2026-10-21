#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Small Apache-2.0 model for validating local inference. ~491 MB.
MODEL_URL="https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf"
TARGET="data/models/gguf/qwen2.5-0.5b-instruct-q4_k_m.gguf"
mkdir -p "$(dirname "$TARGET")"
if [ -f "$TARGET" ]; then echo "Already present: $TARGET"; exit 0; fi
echo "Downloading Qwen2.5-0.5B-Instruct Q4_K_M (~491 MB) for testing..."
curl -fL "$MODEL_URL" -o "$TARGET"
echo "Installed $TARGET"
echo "Optional: add HF_TOKEN to download gated models."
