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

For a full set, prefer **batch mode** — one Vite + one Chromium for all
renders (~7s for 2 items vs ~20s+ each when spawning per render):

```sh
npm run render -- --batch manifest.json
```

```json
{
  "base": { "bgMode": "gradient", "gradA": "#FDEEE7", "gradB": "#F6D3C2",
            "textColor": "#2B2B2B", "titleSize": 82, "subtitleSize": 40 },
  "items": [
    { "screenshot": "raw/editor.png", "output": "framed/01-editor.png",
      "state": { "title": "Turn moments into cards", "subtitle": "Style any quote" } }
  ]
}
```

`base` is shared state, each item's `state` shallow-merges over it; paths
resolve relative to the manifest file. Every output is printed as
`path (WxH)`.

The command starts the local Vite stage when `--url` is omitted. If an agent
already has the stage open, pass `--url http://127.0.0.1:5173/screenshot-stage.html`.

Scene JSON can control:

- `rotation.x` / `rotation.y`: iPhone model angle in radians (`{x: 0, y: 0}` = flat-on).
- `phoneOffset.x` / `phoneOffset.y`: phone pan in final 1290 × 2796 pixels.
- `phoneWidthRatio`: fraction of stage width the phone body occupies
  (default `0.72`, clamped `0.4...0.9`). This is the primary size knob.
- `phoneScale`: multiplier on top of `phoneWidthRatio`, clamped `0.5...1.5`.
- `bgMode`, `solid`, `gradA`, `gradB`, `gradAngle`: background.
- `title`, `subtitle`, `titleSize`, `subtitleSize`, `textColor`, `align`: text.
- `allow2DFallback`: default `false` — the export always uses the 3D model
  and fails loudly when it isn't ready. Set `true` to allow the flat
  2D-drawn phone as a fallback.

Sizing note: the export **re-renders the 3D model** at the target pixel size,
so large `phoneWidthRatio`/`phoneScale` values stay crisp — only the live
preview uses a CSS transform. Input PNGs can be any iPhone portrait capture
(e.g. 1206 × 2622); output is always 1290 × 2796 (App Store 6.7"/6.9" slot).

Known gaps and next improvements live in `docs/agent-backlog.md`.

In the browser preview, drag the phone to rotate it. Hold Space while dragging
to pan the phone placement.

## Test

```sh
npm test
```
