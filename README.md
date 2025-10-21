# Flappy-Nerd

Flappy Bird but nerdier.

## WebGPU (Rust) build

A high-performance WebGPU rewrite lives under [`web-rust/`](web-rust/). It targets browsers with WebGPU support (Chrome/Edge 113+, Safari 18+ on macOS, iOS/iPadOS 16.4+ with WebGPU enabled, and Safari 26 betas).

### Build & run

```bash
cd web-rust
./build.sh
python3 -m http.server 8080
```

Then open [`http://localhost:8080/index.html`](http://localhost:8080/index.html) in a compatible browser. The WASM module exposes `window.triggerJump()` so external scripts (e.g. ML blink detectors) can trigger the jump action.
