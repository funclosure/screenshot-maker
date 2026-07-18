# Agent Backlog — screenshot-maker

Improvement items collected from real agent-driven production use
(TimeCliper App Store set, July 2026). Each item is anchored to code so a
future session can act without re-discovering context.

## Shipped in that session (baseline for the items below)

- **`phoneWidthRatio` scene param, default 0.72** (was hardcoded `0.56`).
  The phone rendered too small for App Store use; the export re-renders the
  3D model at target size (`renderPhone` in the export path,
  `screenshot-stage.html` ~line 1310), so bigger stays crisp.
- **Preview parity:** preview device CSS width is `56cqw`
  (`screenshot-stage.html` ~line 471); `applyPhonePlacement` now multiplies
  the preview transform by `phoneWidthRatio / 0.56` so preview ≈ export.
- **`phoneScale` clamps widened** to 0.5–1.5 (UI slider 50–150). Export is
  a re-render, not a CSS upscale — the old 1.25 cap was needlessly tight.
- **`--batch <manifest.json>`** in `scripts/render-screenshot.mjs`: one
  Vite + one Chromium for N renders (2 items: ~7s vs ~20s+ each before).
  Manifest: `{ base?: {state}, items: [{screenshot, output, state?}] }`,
  paths relative to the manifest file. Prints `path (WxH)` per output.
  Gotcha fixed there: `#exportBtn` is *hidden* (same label) once in export
  mode — click only when visible.
- **3D is the default export path; 2D fallback is opt-in** (was item 3
  below). Export now throws `"3D model not ready — export refused"` unless
  the scene sets `allow2DFallback: true` (`screenshot-stage.html`, export
  else-branch; state key accepted by `setState`/reported by `getState`).
- **CLI agent-friendliness pass** (July 2026). Goal: an agent using only
  `--help` and CLI output can compose a correct render and learns the exact
  cause on the first failure. Shipped in `scripts/render-screenshot.mjs`:
  - `--help` documents the full scene-key schema + output/exit contract.
  - Unknown `--options` rejected with a did-you-mean suggestion.
  - Unrecognized scene keys warned (CLI diffs sent state vs `getState()`).
  - Page `console.error`/`pageerror` forwarded to stderr as `[stage]` lines;
    export waits race `__lastExportDataUrl` vs `__lastExportError` so stage
    failures surface immediately instead of a generic 30s timeout.
  - Wrong `--url` (no `#phoneCanvas`) and model-never-ready get explicit
    error messages.
  - Batch continues past failed items; `FAILED item N/M (...)` per item plus
    a summary; exit 1 if any failed.
  - Input-aspect warning when the source PNG deviates >2% from 1290:2796.
  - Stage: `bgImage` accepted via `setState`/reported by `getState`; the
    export's image branch awaits the background load so its errors reach
    `__lastExportError` (was an unhandled-async hang).
  - `examples/scene.json` no longer carries output-only keys.

## TODO (priority order)

1. **Device/canvas presets — iPad above all.** `STAGE_W/H` hardcoded
   1290×2796 (`screenshot-stage.html` ~line 860). ASC also wants iPad
   13" sets (2064×2752, device-type `IPAD_PRO_3GEN_129` / display
   `APP_IPAD_PRO_3GEN_129`). Needs a canvas preset switch (`--canvas
   ipad-13` etc.) and either an iPad 3D model or the plain mode of item 2.
   This was the concrete gap that forced a human hand-off mid-session.
2. **Plain (no-3D-frame) mode.** Background + title/subtitle + raw
   screenshot with rounded corners/soft shadow. Unblocks devices without a
   model (iPad) and "clean" sets. Export already draws a flat fallback
   phone (~line 1320-1345) — a variant that draws the screenshot instead of
   the fake phone body is most of the work.
3. **Theme presets.** Agents hand-pick `gradA/gradB/textColor` every run.
   Named palettes (`theme: "warm-light" | "dark" | {brand: "#E4573D"}`)
   deriving gradient + text color would remove the most error-prone knob.
   The warm-light set used in production: `#FDEEE7 → #F6D3C2`, angle 165,
   text `#2B2B2B`, titleSize 82, subtitleSize 40.
4. **Scene validation in the stage itself.** The CLI now warns on
   unrecognized keys (by diffing against `getState()`), but in-browser
   `setState` callers still get silent ignores. Publish a JSON schema next
   to `examples/scene.json` and/or have `applySceneState` return the list
   of ignored keys.
5. **ASC-size awareness in the CLI.** Input-aspect mismatch now warns; also
   warn when the output matches no App Store slot (embed the small size
   table: iPhone 6.9/6.7 = 1290×2796 or 1320×2868; iPad 13 = 2064×2752).
6. **Status-bar hygiene.** Document (or optionally composite) a clean 9:41
   status bar; raw captures often carry real time/battery. Companion note:
   `xcrun simctl status_bar booted override --time "9:41" ...` before
   capture, and the simulator Dynamic Island renders a black pill for ~40s
   after launch — wait before capturing.
7. **Localized batch sugar.** Per-item `locales: {"zh-Hant": {title, subtitle}}`
   expanding to parallel outputs, so one manifest yields en-US + zh-Hant
   sets from the same raw screenshots.
8. **Golden-image test for export.** `npm test` covers the stage; add a
   batch render against a checked-in raw PNG and compare IHDR + a few
   sampled pixels, so refactors of the export path can't silently change
   output geometry.
