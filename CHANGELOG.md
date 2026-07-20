# Changelog

All notable changes to screenshot-maker are documented here. Versions follow
[semver](https://semver.org); the CLI surface (`--help` contract, scene state
keys, manifest format) is the public API.

## 1.1.0 — 2026-07-20

Typography for CJK sets, finer caption control, and an optional Gemini
enhancement layer for hand-crafted-looking panels.

### Captions

- CJK text wraps naturally without injected spaces; `\n` in `title` /
  `subtitle` forces a line break for stacked editorial captions. The live
  preview matches.
- New scene keys: `captionTop` (caption block position, default 0.11) and
  `subtitleColor` (accent color for the subtitle, defaults to `textColor`).
- Caption fonts documented: EB Garamond titles (Google Fonts, network
  needed; Georgia fallback offline), system sans subtitles.

### Render CLI

- `bgImage` accepts a file path (resolved against the manifest, or the
  working directory in single mode) in addition to a data URL.

### AI enhancement layer (optional, new)

- `scripts/enhance-screenshot.mjs`: runs rendered panels through a Gemini
  image model (`GEMINI_API_KEY`/`GOOGLE_API_KEY`; REST via fetch, no new
  dependency; stubbable via `GEMINI_API_BASE`).
- Modes: `enhance` (background texture + device pop), `background`
  (generate only a backdrop to feed back via `bgImage`, keeping text
  deterministic), `popout` (the presented sheet breaks out of the device
  frame, enlarged like a photographic zoom so its text scales with it).
- Guard rails: far-off-aspect model output is rejected and retried instead
  of cropped into content; near-aspect output is cover-cropped; non-PNG
  output converted; results always restored to the source's exact slot
  size. Same agent-friendly CLI contract as the renderer.

### Project

- `bump-version` release skill; `.env` gitignored.

## 1.0.0 — 2026-07-19

First complete release: one batch manifest can produce a full App Store
Connect upload set — framed iPhone + iPad slots, all locales, plus a review
gallery.

### Stage

- 3D iPhone 17 Pro stage (Ibrahim.Bhl, CC-BY) with drag rotation, Space-drag
  pan, scriptable `window.ScreenshotStage` API, and JSON scene panel.
- 3D iPad Pro 13" M4 (polyman Studio, CC-BY) with on-demand device swapping
  per canvas preset; no synthetic Dynamic Island, per-device screen corner
  radius.
- Canvas presets: `iphone-6.9` (1290×2796, default), `iphone-6.9-alt`
  (1320×2868), `ipad-13` (2064×2752). Text sizes are 1290-reference and
  scale with canvas width.
- Plain mode (`frame: "none"`): rounded screenshot with soft shadow, no
  device body or model needed.
- Export always uses the 3D model and fails loudly when it isn't ready;
  the flat 2D fallback is opt-in (`allow2DFallback: true`).
- `phoneWidthRatio` as the primary size knob; `bgImage` backgrounds
  settable via state.

### Agent CLI (`npm run render`)

- Single and `--batch` manifest rendering in one browser session; per-item
  `locales` expansion (`{locale}` output placeholder); `--gallery` HTML
  contact sheet; `--canvas` preset flag.
- Self-explanatory contract: `--help` documents the full scene schema;
  unknown options get did-you-mean suggestions; unrecognized scene keys are
  warned; stage console errors stream to stderr as `[stage]` lines; export
  failures surface immediately with their real cause; batch continues past
  failed items and exits 1 with a summary; input aspect mismatches warn.

### Model pipelines

- `scripts/create-clean-iphone-model.mjs` and
  `scripts/create-clean-ipad-model.mjs` reproduce the committed clean GLBs
  from the raw Sketchfab downloads.
