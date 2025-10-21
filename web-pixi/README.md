# Flappy Nerd (PixiJS)

A WebGPU-first PixiJS port of the original Java Flappy Nerd prototype. The game keeps the same physics constants and gameplay feel while running directly in the browser.

## Getting started

```bash
cd web-pixi
npm install
npm run dev
```

Open <http://localhost:5173> in your browser. PixiJS will try to use WebGPU automatically and fall back to WebGL2 if WebGPU is unavailable.

## Building

```bash
npm run build
```

The production bundle is emitted to `dist/`.

## Previewing the production build

```bash
npm run preview
```

Then open the displayed local URL.

## Debug flags

- Append `?debug=1` to highlight collision rectangles.
- Append `?fps=uncapped` to allow the render loop to run without requestAnimationFrame clamping (still uses a fixed-step simulation under the hood).

## Blink-tap hook

The global function `window.triggerJump()` is available and will trigger the same flap action as keyboard, mouse, or touch input. This hook is defined in `index.html` and re-bound in `src/main.ts` once the PixiJS game initializes.
