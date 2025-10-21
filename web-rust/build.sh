#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$SCRIPT_DIR"

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "wasm-pack is required. Install from https://rustwasm.github.io/wasm-pack/installer/" >&2
  exit 1
fi

wasm-pack build --target web --release
