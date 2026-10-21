#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Pinned release with prebuilt CPU binaries. Override with LLAMA_VERSION=b####.
VERSION="${LLAMA_VERSION:-b11796}"
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS/$ARCH" in
  Linux/x86_64)  ASSET="llama-${VERSION}-bin-ubuntu-x64.tar.gz" ;;
  Darwin/arm64)  ASSET="llama-${VERSION}-bin-macos-arm64.tar.gz" ;;
  Darwin/x86_64) ASSET="llama-${VERSION}-bin-macos-x64.tar.gz" ;;
  *) echo "No prebuilt asset mapping for $OS/$ARCH. Install llama.cpp manually and set VANTARA_LLAMA_SERVER." >&2; exit 1 ;;
esac

mkdir -p vendor/llama.cpp
URL="https://github.com/ggml-org/llama.cpp/releases/download/${VERSION}/${ASSET}"
echo "Downloading $URL"
TMP="$(mktemp -d)"
curl -fL "$URL" -o "$TMP/llama.tar.gz"
tar -xzf "$TMP/llama.tar.gz" -C vendor/llama.cpp --strip-components=1
rm -rf "$TMP"
chmod +x vendor/llama.cpp/llama-server
./vendor/llama.cpp/llama-server --version | head -1
echo "Installed vendor/llama.cpp/llama-server"
echo "Set VANTARA_LLAMA_SERVER if you keep the binary elsewhere."
