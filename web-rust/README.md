# Flappy Nerd WebGPU (Rust) port

This directory contains a high-performance WebGPU rewrite of Flappy Nerd built with Rust and `wgpu`, compiled to WebAssembly.

## Prerequisites

- Rust toolchain (1.75+ recommended)
- [`wasm-pack`](https://rustwasm.github.io/wasm-pack/installer/) for building the WebAssembly package
- A WebGPU-capable browser (Chrome 113+, Edge 113+, Safari 18+ on macOS, or iOS/iPadOS Safari 16.4+ / visionOS Safari 26 beta)

## Build

```bash
./build.sh
```

This runs `wasm-pack build --target web --release` and places the generated JS bindings and `wasm` binary in `pkg/`.

## Run locally

1. Build the project (above).
2. Serve the folder with a static file server from the repository root or `web-rust/` directory:

   ```bash
   cd web-rust
   python3 -m http.server 8080
   ```

3. Visit `http://localhost:8080/index.html` in a WebGPU-enabled browser.

## Controls

- Spacebar
- Mouse/touch (pointer or touch start on the canvas)
- Programmatic: call `window.triggerJump()` from JavaScript to trigger the same jump action (used by the ML blink detector).

## Game loop & performance

- Fixed-step update at 120 Hz with vsynced rendering (WebGPU `PresentMode::Fifo` by default).
- Instanced quad renderer keeps per-frame allocations minimal.
- HUD overlay shows FPS and score; error messages surface via the same DOM overlay.

## Configuration via query parameters

- `?uncapped=1` – attempts to use `PresentMode::Immediate` if the adapter supports it (falls back to vsync otherwise).
- `?bg=RRGGBB` – overrides the background color (hex, e.g. `?bg=223344`).

## Safari / iOS notes

- iOS/iPadOS Safari 16.4+ exposes WebGPU behind the `Develop → Experimental Features → WebGPU` toggle prior to Safari 18. From visionOS 2 / iOS 18 onward WebGPU is enabled by default (Safari 26 build).
- On unsupported browsers the HUD displays a “WebGPU not available” message without crashing.

## Project structure

- `src/lib.rs` – WASM entry point, WGPU setup, input management, rendering loop
- `src/game.rs` – deterministic game logic (physics, collision, scoring)
- `src/hud.rs` – lightweight DOM overlay for HUD
- `src/shaders/quad.wgsl` – instanced quad vertex/fragment shader
- `index.html` – bootstrap page loading the WASM bundle and exposing `window.triggerJump`
- `build.sh` – helper for building the release bundle
