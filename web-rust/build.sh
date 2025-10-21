#!/usr/bin/env bash
set -euo pipefail

dir="$(cd "$(dirname "$0")" && pwd)"
cd "$dir"

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "wasm-pack is required. Install from https://rustwasm.github.io/wasm-pack/installer/" >&2
  exit 1
fi

wasm-pack build --target web --release

echo "\nBuild artifacts available in web-rust/pkg. Serve this folder with a static file server (e.g. python3 -m http.server) and open index.html in a WebGPU-enabled browser."
