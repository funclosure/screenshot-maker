# Changelog

All notable changes to screenshot-maker are documented here. Versions follow
[semver](https://semver.org); the CLI surface (`--help` contract, scene state
keys, manifest format) is the public API.

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
