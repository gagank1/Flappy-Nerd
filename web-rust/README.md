# Flappy Nerd (WebGPU)

This folder hosts a WebGPU rewrite of Flappy Nerd written in Rust and targeting WebAssembly. It aims for a steady 60 FPS render cadence with minimal GPU overhead so external ML detectors can run alongside the game.

## Features

- Physics/logic matches the original Java version with fixed 120 Hz updates and vsynced rendering.
- Instanced quad renderer (no textures) for ultra-low GPU overhead.
- Responsive canvas that scales to any screen size.
- FPS/score HUD overlay and DOM-based messaging for fallbacks.
- Unified jump handler for keyboard, mouse/touch, and the global `window.triggerJump()` hook for external controllers.
- Optional query parameters:
  - `?uncapped=1` attempts to use `PresentMode::Immediate` when the platform supports it.
  - `?bg=RRGGBB` overrides the background clear colour.

## Prerequisites

- Rust toolchain (1.75+ recommended)
- [`wasm-pack`](https://rustwasm.github.io/wasm-pack/installer/)
- Node-compatible HTTP server for local testing (e.g. `basic-http-server`, `python -m http.server`, etc.)

## Building

```bash
./build.sh
```

This runs `wasm-pack build --target web --release` and writes the bundle to `pkg/`.

## Running locally

After building, serve the `web-rust/` directory:

```bash
cd web-rust
python -m http.server 8080
```

Then open `http://localhost:8080/` in a WebGPU-capable browser (Chrome 113+, Edge 113+, Safari 17.4+/iOS 17.4+).

If WebGPU is unavailable the HUD will display a fallback message.

## Triggering jumps from JavaScript

External scripts (such as ML blink detectors) can trigger jumps via:

```js
window.triggerJump();
```

The call is debounced within the physics step, so inputs are never dropped even if frames arrive early.

## iOS Safari notes

- Requires iOS 17.4+ (Safari 17.4+) with WebGPU enabled (default on iOS 18 / Safari 18).
- The game automatically adapts to device pixel ratios and touch input.

## License

MIT
