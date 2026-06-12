# Screenshot Maker

Browser-based App Store screenshot composer with a 3D iPhone stage.

## Run

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:5173/screenshot-stage.html`.

## Scriptable Scene API

The page exposes `window.ScreenshotStage` after load:

```js
await window.ScreenshotStage.setState({
  title: "Made by an LLM",
  subtitle: "Deterministic scene control",
  bgMode: "solid",
  solid: "#123456",
  textColor: "#f4f6fb",
  rotation: { x: -0.14, y: 0.17 },
  phoneOffset: { x: 0, y: 0 },
  phoneScale: 1
});

const state = window.ScreenshotStage.getState();
```

`state.displayRect` is computed from the iPhone model screen aspect and the
1290 × 2796 screenshot aspect, so screenshots fit the usable display area
without manual inset tuning.

Use `examples/scene.json` as the stable JSON shape for LLM-generated presets.

## Agent CLI

Other agents can render a final App Store screenshot from any local PNG:

```sh
npm run render -- \
  --screenshot /Users/victor/Documents/Workspace/Projects/Inkput/screenshots/iphone-04b-capsule-seal.png \
  --output /Users/victor/Documents/Workspace/Projects/Inkput/screenshots/app-store-shot-1290x2796.png \
  --state examples/scene.json
```

The command starts the local Vite stage when `--url` is omitted. If an agent
already has the stage open, pass `--url http://127.0.0.1:5173/screenshot-stage.html`.

Scene JSON can control:

- `rotation.x` / `rotation.y`: iPhone model angle in radians.
- `phoneOffset.x` / `phoneOffset.y`: phone pan in final 1290 × 2796 pixels.
- `phoneScale`: phone size multiplier, clamped to `0.75...1.25`.
- `bgMode`, `solid`, `gradA`, `gradB`, `gradAngle`: background.
- `title`, `subtitle`, `titleSize`, `subtitleSize`, `textColor`, `align`: text.

In the browser preview, drag the phone to rotate it. Hold Space while dragging
to pan the phone placement.

## Test

```sh
npm test
```
