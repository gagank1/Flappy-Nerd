# Flappy-Nerd

Flappy Bird but nerdier.

## WebGPU Build (Rust + WebAssembly)

A high-performance WebGPU rewrite lives under [`web-rust/`](web-rust/). It renders with instanced quads, fixed-step physics, and exposes `window.triggerJump()` so external ML controllers can flap. To build the web target:

```bash
cd web-rust
./build.sh
```

Serve the folder via any static server (e.g. `python -m http.server`) and open it in a WebGPU-capable browser (Chrome 113+, Edge 113+, Safari 17.4+/iOS 17.4+).
