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
- **Localized batch + gallery** (was item 7; validated by the first
  external user shipping an en-US + ja Slipsee set). Batch items accept
  `locales: {"<tag>": {title, subtitle, ...}}` and render once per locale
  from the same raw screenshot; `output` must contain `{locale}` (checked,
  fails loudly). `--gallery <html>` writes a locale-grouped HTML contact
  sheet of the rendered set.
- **Plain mode + canvas presets** (was items 1–2). `frame: "none"` draws
  the screenshot at its own aspect with rounded corners and a soft shadow —
  no device body, no 3D model needed. `canvas` preset / `--canvas` flag:
  `iphone-6.9` (1290×2796, default), `iphone-6.9-alt` (1320×2868),
  `ipad-13` (2064×2752). Text sizes are 1290-reference and scale with
  canvas width (matching the cqw preview). Presets guarantee valid ASC
  slot sizes, which mostly resolves the old "warn on non-slot output" item.
- **iPad 3D model** (July 2026). `ipad-13` renders framed with a real iPad
  Pro 13" M4 model (CC-BY, credited in README). Pipeline:
  `scripts/create-clean-ipad-model.mjs` extracts the standalone iPad from
  the raw Sketchfab GLB (which also has a Pencil and an empty Magic
  Keyboard), straightens it via PCA on the display quad (hash names from
  the USDZ->GLB conversion are stable, keyed on `EjCaatfcGdAQBho`), and
  renames the display material to `Screen_BG`. `phone-stage.js` gained a
  `DEVICE_MODELS` registry + on-demand `setDeviceModel` swap (cached);
  `createScreenPlane` measures precise (per-vertex) bounds because the
  clean model's straightening rotation lives on a wrapper node; the
  synthetic Dynamic Island and screen corner radius are per-device.
  ASC upload device-type: `IPAD_PRO_3GEN_129` / `APP_IPAD_PRO_3GEN_129`.

- **Gemini enhancement layer** (July 2026, optional — needs
  GEMINI_API_KEY/GOOGLE_API_KEY). `scripts/enhance-screenshot.mjs`, REST
  via fetch, stub-testable via GEMINI_API_BASE. Modes: `enhance` (whole
  panel), `background` (backdrop only → feed back via `bgImage` so text
  stays deterministic), `popout` (sheet breaks out of the device frame).
  Hard-won prompt lessons baked into the defaults: positive scene
  inventories beat prohibitions; "enlarge like zooming into a photograph"
  is what scales sheet text with the card. Aspect guard rejects reframed
  output (>12% deviation) instead of cropping content; near-aspect output
  is cover-cropped; non-PNG converted; always inspect edges at full
  resolution — margins are where models hallucinate.

## TODO (priority order)

1. **Deterministic sheet overlay.** The popout effect via image gen is a
   dice roll per run. With two raw captures (screen without sheet + the
   sheet cropped alone), the stage could composite the sheet as a popped
   layer at exact position/scale/tilt — pixel-perfect padding, preserved
   liquid-glass translucency (the gen-AI popout flattens it to opaque),
   zero roulette. `item.overlay = {screenshot, scale, offset}` in the
   manifest.

   Gap analysis vs Inkput's live listing (the hand-made set still beats
   the tool; https://apps.apple.com/jp/app/inkput-mindful-journaling/id6758570182):
   frosted sheet translucency with content ghosting through (needs the
   overlay above, with real alpha); storytelling garnish placed WITH
   INTENT (a handwritten note peeking from behind the sheet — humans
   direct, models decorate); a small accent underline below titles (easy
   `titleAccent` scene key, pairs with `subtitleColor`); tilt VARIED
   per panel across the set for row rhythm (agents should vary
   `rotation` per item, not inherit one base pose — document in README
   or add a preset).
2. **More theme presets.** `theme: "warm-light" | "cream"` shipped (both
   production palettes; explicit keys override the macro). Still open: a
   dark preset and brand-derived palettes (`{brand: "#E4573D"}` deriving
   gradient + text color). Layout values from the July 20 TimeCliper
   re-shoot (18 outputs, en-US + zh-Hant, iPhone + iPad): titleSize 104,
   subtitleSize 40, captionTop 0.065, phoneWidthRatio 0.88, phoneOffset
   `{x: 0, y: -265}`, rotation varied per item (`y: ±0.13, z: ∓0.012`
   iPhone / `±0.11` iPad, heroes flat-on). Full working example:
   `TimeCliper/AppStore/screenshots/manifest.json`.
3. **Scene validation in the stage itself.** The CLI now warns on
   unrecognized keys (by diffing against `getState()`), but in-browser
   `setState` callers still get silent ignores. Publish a JSON schema next
   to `examples/scene.json` and/or have `applySceneState` return the list
   of ignored keys.
4. **ASC-size awareness in the CLI.** Input-aspect mismatch now warns; also
   warn when the output matches no App Store slot (embed the small size
   table: iPhone 6.9/6.7 = 1290×2796 or 1320×2868; iPad 13 = 2064×2752).
5. **Status-bar hygiene.** Document (or optionally composite) a clean 9:41
   status bar; raw captures often carry real time/battery. Companion note:
   `xcrun simctl status_bar booted override --time "9:41" ...` before
   capture, and the simulator Dynamic Island renders a black pill for ~40s
   after launch — wait before capturing.
6. **Golden-image test for export.** `npm test` covers the stage; add a
   batch render against a checked-in raw PNG and compare IHDR + a few
   sampled pixels, so refactors of the export path can't silently change
   output geometry.

## From the July 20 TimeCliper re-shoot (agent session retro)

New items, ranked by time actually burned:

7. **Caption-anchored device placement.** The #1 friction. The default
   layout left ~450px of empty gradient between the caption block and the
   device; the user flagged it as "huge gap", and closing it took three
   full re-renders of guessed absolute `phoneOffset.y` values (110 → 55 →
   -265). The stage already measures the caption block — add an anchor
   mode (`phoneTop: "captions"` + `gapBelowCaptions: <px|ratio>`) so the
   most common composition is declarative. Absolute px offsets in `base`
   also silently couple iPhone and iPad items (2796 vs 2752 canvases
   happened to tolerate the same -265; that's luck, not design).
8. **Warn on caption wrap (or balance it).** Bumping `subtitleSize` 40→46
   silently wrapped the longer subtitles with single-word orphans
   ("…SHAREABLE / IMAGE"), caught only by opening PNGs at 100%. The CLI
   already warns on unknown keys — add
   `subtitle wrapped to 2 lines (item 01-card, en-US)` to stderr, and/or
   `text-wrap: balance` on captions so a wrap at least lands balanced.
9. **`--only <glob>` batch filter.** Every single-panel tweak re-rendered
   all 18 outputs (~1 min per iteration cycle). `--only "01-*"` /
   `--only "ipad/**"` against the same manifest would make the fix loop
   seconds instead.
10. **CJK title font falls out of brand.** en-US titles render EB Garamond;
    zh-Hant falls back to a system CJK *sans*, so locales differ in type
    voice. Fetch a serif CJK companion (Noto Serif TC) in the same Google
    Fonts request, or accept a `titleFontCJK` key.
11. **Doc micro-gaps.** Two facts learned by experiment, one sentence each
    in `--help`: `phoneOffset.y` positive = down; title/subtitle sizes are
    1290-reference and scale with the canvas preset (it *is* documented for
    canvas — repeat it next to the size keys where an agent looks).

What worked (keep): manifest + `{locale}` placeholder produced 18 outputs
(2 locales × 2 device classes) from one file and one command; the
`path (WxH)` output contract made verification trivial; the locale-grouped
gallery was the review surface the user actually used to approve the set.

Cross-repo note (TimeCliper, not this tool): the `-auto-create-image`
launch arg re-fires on every `TranscriptDetailView.onAppear`, so combined
with `-auto-save-clip` it loops (16 duplicate clips in ~45s; DB cleaned by
hand). Needs a one-shot guard before it's safe to chain automation args.
