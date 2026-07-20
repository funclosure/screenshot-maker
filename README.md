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
      "state": { "title": "Turn moments into cards", "subtitle": "Style any quote" } },
    { "screenshot": "raw/capsule.png", "output": "framed/{locale}/02-capsule.png",
      "locales": {
        "en-US":   { "title": "Seal it in a capsule", "subtitle": "Open it later" },
        "zh-Hant": { "title": "封存進時光膠囊", "subtitle": "留待日後開啟" }
      } }
  ]
}
```

`base` is shared state, each item's `state` shallow-merges over it; paths
resolve relative to the manifest file. An item with `locales` renders once
per locale from the same raw screenshot — its `output` must contain a
`{locale}` placeholder, and each locale's state merges last so per-locale
captions win. Add `--gallery out/index.html` to also write an HTML contact
sheet of the whole set, grouped by locale, for quick visual review.

CLI contract (agent-facing): every rendered output prints one `path (WxH)`
line on stdout; warnings and `[stage]` browser errors go to stderr. A failed
batch item does not stop the remaining items — each failure is reported as
`FAILED item N/M (...): reason` and the exit code is 1 when anything failed.
Unknown CLI options and unrecognized scene keys are called out explicitly
(scene typos warn but don't fail). `--help` documents the full scene schema.

The command starts the local Vite stage when `--url` is omitted. If an agent
already has the stage open, pass `--url http://127.0.0.1:5173/screenshot-stage.html`.

Scene JSON can control:

- `rotation.x` / `rotation.y`: iPhone model angle in radians (`{x: 0, y: 0}` = flat-on).
- `phoneOffset.x` / `phoneOffset.y`: phone pan in final 1290 × 2796 pixels.
- `phoneWidthRatio`: fraction of stage width the phone body occupies
  (default `0.72`, clamped `0.4...0.9`). This is the primary size knob.
- `phoneScale`: multiplier on top of `phoneWidthRatio`, clamped `0.5...1.5`.
- `captionTop`: caption block top as a fraction of canvas height
  (default `0.11`, clamped `0.02...0.35`); smaller starts the title higher.
- `bgMode`, `solid`, `gradA`, `gradB`, `gradAngle`: background;
  `bgImage` (data URL) with `bgMode: "image"`.
- `title`, `subtitle`, `titleSize`, `subtitleSize`, `textColor`, `align`: text.
  `subtitleColor` styles the subtitle as an accent (default: `textColor`).
  `\n` in a caption forces a line break (stacked editorial titles); CJK text
  wraps naturally without injected spaces.
- `allow2DFallback`: default `false` — the export always uses the 3D model
  and fails loudly when it isn't ready. Set `true` to allow the flat
  2D-drawn phone as a fallback.

- `frame`: `"iphone-3d"` (default) or `"none"` — plain rounded screenshot
  with a soft shadow, no device frame or 3D model (works for iPad captures).
- `canvas`: App Store slot preset — `iphone-6.9` (1290 × 2796, default; also
  the 6.7" slot), `iphone-6.9-alt` (1320 × 2868), `ipad-13` (2064 × 2752,
  framed with a 3D iPad Pro 13" model; `frame: "none"` also works). Also
  available as the CLI flag `--canvas <preset>`, which overrides scene
  state. Device models load on demand, so one batch can mix iPhone and
  iPad items.

Sizing note: the export **re-renders the 3D model** at the target pixel size,
so large `phoneWidthRatio`/`phoneScale` values stay crisp — only the live
preview uses a CSS transform. Input PNGs can be any portrait capture
(e.g. 1206 × 2622 iPhone, 2048 × 2732 iPad); output size follows the canvas
preset. `titleSize`/`subtitleSize` are defined at a 1290-wide reference and
scale with canvas width, so the same state renders proportionally everywhere.

Fonts: captions use two typefaces — the title renders in **EB Garamond**
(loaded from Google Fonts, so rendering needs network access; offline it
silently falls back to Georgia) and the subtitle uses the system sans-serif
stack (`-apple-system, …`). Fonts are not yet configurable via scene state.

Known gaps and next improvements live in `docs/agent-backlog.md`.

In the browser preview, drag the phone to rotate it. Hold Space while dragging
to pan the phone placement.

## AI enhancement layer (optional)

With a Gemini API key, rendered screenshots can go through one more pass
that enriches the flat background (paper texture, light, tasteful garnish)
and makes the device pop — while keeping captions, layout, and exact
dimensions:

```sh
export GOOGLE_API_KEY=...   # or GEMINI_API_KEY; https://aistudio.google.com/apikey
node scripts/enhance-screenshot.mjs --input framed/en-US        # whole folder
node scripts/enhance-screenshot.mjs --input shot.png --output shot-final.png
```

Defaults: `gemini-3-pro-image-preview` at 2K (use `--model flash` for the
cheaper `gemini-2.5-flash-image`); custom art direction via `--prompt` /
`--prompt-file`. Non-PNG or slightly off-size model output is converted and
cover-cropped/resized back to the source's exact slot size; far-off-aspect
output is rejected and retried rather than cropped into the content.
Enhancement is generative — always review the output before uploading. See
`node scripts/enhance-screenshot.mjs --help` for the full contract.

Two focused modes compose into a text-safe pipeline:

```sh
# 1. Generate ONLY a background in the panel's style…
node scripts/enhance-screenshot.mjs --mode background --input framed/en-US/03.png --output backgrounds/03-bg.png
# 2. …re-render deterministically on it (captions never touch the model):
#    manifest state: { "bgMode": "image", "bgImage": "backgrounds/03-bg.png" }
# 3. Optionally make the presented sheet break out of the device frame:
node scripts/enhance-screenshot.mjs --mode popout --input framed/en-US/03.png --output framed/en-US/03-popout.png
```

`bgImage` accepts a file path (resolved relative to the manifest) as well as
a data URL, so generated backgrounds drop straight into batch manifests.

## Test

```sh
npm test
```

## Model credits

- iPhone 17 Pro: ["Iphone 17 pro"](https://sketchfab.com/3d-models/iphone-17-pro-4aeeeb41f9d14f96bb3f2589edc3edac)
  by [Ibrahim.Bhl](https://sketchfab.com/Ibrahim.Bhl), licensed under
  [CC Attribution](https://creativecommons.org/licenses/by/4.0/). Committed
  as the raw download (`iphone-17-pro/source/iphone 17_4.glb`) and a
  derivative (`iphone-17-pro-clean.glb`, via
  `scripts/create-clean-iphone-model.mjs`) with a few internal meshes
  removed.
- iPad Pro 13" M4: ["Ipad pro 13in silver m4"](https://sketchfab.com/3d-models/ipad-pro-13in-silver-m4-8a113340443e49d3b905ab9f0b45efd6)
  by [polyman Studio](https://sketchfab.com/Polyman_3D), licensed under
  [CC Attribution](https://creativecommons.org/licenses/by/4.0/). The
  committed files are the raw download (`ipad-pro-13/source/ipad-pro-13-raw.glb`)
  and a derivative (`ipad-pro-13-clean.glb`, via
  `scripts/create-clean-ipad-model.mjs`) that extracts the standalone iPad,
  straightens it, and renames its display material.
