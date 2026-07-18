#!/usr/bin/env node
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  return [
    "Usage:",
    "  node scripts/render-screenshot.mjs --screenshot <png> --output <png> [options]",
    "  node scripts/render-screenshot.mjs --batch <manifest.json> [options]",
    "",
    "Options:",
    "  --url <url>          Existing stage URL. Starts Vite automatically when omitted.",
    "  --state <json-file>  Scene state JSON file (single mode).",
    "  --state-json <json>  Inline scene state JSON (single mode).",
    "  --batch <json-file>  Render many screenshots in one browser session.",
    "                       Manifest: { base?: {state}, items: [{screenshot, output, state?}] }",
    "                       Paths resolve relative to the manifest file; item state",
    "                       shallow-merges over base.",
    "  --headed             Show Chromium while rendering.",
    "",
    "Scene state keys (all optional; unrecognized keys are warned about and ignored):",
    "  title, subtitle             Caption text.",
    "  titleSize (40-140), subtitleSize (24-80), textColor, align (\"center\"|\"left\")",
    "  bgMode                      \"gradient\" | \"solid\" | \"image\"",
    "  gradA, gradB, gradAngle     Gradient colors and angle in degrees.",
    "  solid                       Solid background color.",
    "  bgImage                     Background image data URL (with bgMode \"image\").",
    "  rotation                    {x, y, z} phone angle in radians; {x:0, y:0} = flat-on.",
    "  phoneWidthRatio (0.4-0.9)   Fraction of stage width the phone occupies (default 0.72).",
    "  phoneScale (0.5-1.5)        Extra multiplier on top of phoneWidthRatio.",
    "  phoneOffset                 {x, y} phone pan in output pixels.",
    "  allow2DFallback             Default false: export fails when the 3D model is not",
    "                              ready instead of drawing a flat 2D phone.",
    "",
    "Output: one \"path (WxH)\" line per rendered PNG on stdout; output is always",
    "1290x2796 (App Store 6.7\"/6.9\" slot). Warnings and stage errors go to stderr;",
    "exit code 1 when any item fails. Starter scene: examples/scene.json (see README.md)."
  ].join("\n");
}

const KNOWN_OPTIONS = ["--screenshot", "--output", "--url", "--state", "--state-json", "--batch", "--headed", "--help"];

function editDistance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return rows[a.length][b.length];
}

function closestOption(arg) {
  let best = null;
  let bestDistance = 3;
  for (const option of KNOWN_OPTIONS) {
    const distance = editDistance(arg, option);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = option;
    }
  }
  return best;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--headed") args.headed = true;
    else if (arg.startsWith("--")) {
      if (!KNOWN_OPTIONS.includes(arg)) {
        const hint = closestOption(arg);
        throw new Error(`Unknown option: ${arg}${hint ? ` (did you mean ${hint}?)` : ""}\n\n${usage()}`);
      }
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      args[key] = value;
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function waitForServer(url, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep polling until Vite is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function startServer() {
  const defaultUrl = "http://127.0.0.1:5173/screenshot-stage.html";
  try {
    const response = await fetch(defaultUrl);
    if (response.ok) {
      return { url: defaultUrl, stop() {} };
    }
  } catch {
    // No reusable server on the default port.
  }

  const child = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", "5173"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for Vite to print its local URL")), 15000);
    function read(chunk) {
      const text = chunk.toString();
      process.stderr.write(chunk);
      const match = text.match(/http:\/\/127\.0\.0\.1:\d+\//);
      if (match) {
        clearTimeout(timeout);
        resolve(`${match[0]}screenshot-stage.html`);
      }
    }
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Vite exited before startup with code ${code}`));
    });
  });

  await waitForServer(url);
  return {
    url,
    stop() {
      child.kill("SIGTERM");
    }
  };
}

async function readState(args) {
  if (args.state && args.stateJson) {
    throw new Error("Use either --state or --state-json, not both.");
  }
  if (args.state) {
    return JSON.parse(await readFile(path.resolve(args.state), "utf8"));
  }
  if (args.stateJson) {
    return JSON.parse(args.stateJson);
  }
  return null;
}

async function openStage(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("console", (message) => {
    if (message.type() === "error") process.stderr.write(`[stage] ${message.text()}\n`);
  });
  page.on("pageerror", (error) => {
    process.stderr.write(`[stage] ${error.message}\n`);
  });
  await page.goto(url);
  if (await page.locator("#phoneCanvas").count() === 0) {
    throw new Error(
      `${url} does not look like the screenshot stage (no #phoneCanvas). ` +
      "Point --url at .../screenshot-stage.html, or omit --url to start the bundled stage."
    );
  }
  await page.locator("#phoneCanvas").waitFor({ state: "visible", timeout: 15000 });
  // The 3D model is the point of the tool: always wait for it so exports
  // never silently fall back to the flat 2D-drawn phone.
  try {
    await page.waitForFunction(
      () => document.getElementById("phoneCanvas")?.dataset.modelReady === "true",
      null,
      { timeout: 20000 }
    );
  } catch {
    throw new Error(
      "The 3D iPhone model did not become ready within 20s — " +
      "see [stage] lines above for the cause (model file missing, WebGL unavailable)."
    );
  }
  await page.evaluate(() => document.fonts.ready);
  return page;
}

function pngDimensions(buffer) {
  // PNG IHDR: width/height are big-endian uint32 at offsets 16/20.
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const CANVAS_ASPECT = 1290 / 2796;

function warnOnAspectMismatch(screenshotPath, buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return;
  const { width, height } = pngDimensions(buffer);
  const aspect = width / height;
  if (Math.abs(aspect - CANVAS_ASPECT) / CANVAS_ASPECT > 0.02) {
    console.error(
      `warning: ${screenshotPath} is ${width}x${height} (aspect ${aspect.toFixed(3)}); ` +
      `the 1290x2796 canvas expects ~${CANVAS_ASPECT.toFixed(3)} — the screenshot will be center-cropped to fit.`
    );
  }
}

async function applyState(page, state) {
  // setState returns the effective state; any sent key the stage does not
  // echo back was silently ignored — surface that instead of letting a typo
  // produce a "successful" wrong render.
  const effective = await page.evaluate((next) => window.ScreenshotStage.setState(next), state);
  const ignored = Object.keys(state).filter((key) => !(key in effective));
  if (ignored.length) {
    console.error(
      `warning: state key(s) not recognized by the stage and ignored: ${ignored.join(", ")}.\n` +
      `Known keys: ${Object.keys(effective).join(", ")}`
    );
  }
  if ("displayRect" in state) {
    console.error('warning: state key "displayRect" is derived output and was ignored.');
  }
}

async function renderOne(page, { screenshotPath, outputPath, state }) {
  if (!existsSync(screenshotPath)) {
    throw new Error(`Screenshot not found: ${screenshotPath}`);
  }
  warnOnAspectMismatch(screenshotPath, await readFile(screenshotPath));

  await page.locator("#shotFile").setInputFiles(screenshotPath);
  await page.waitForFunction(() => {
    const img = document.getElementById("screenImg");
    return img && img.complete && img.naturalWidth > 0;
  });

  if (state) {
    await applyState(page, state);
  }

  // Reset the export markers so a stale result from a previous item can
  // never be mistaken for this item's render.
  await page.evaluate(() => {
    window.__lastExportDataUrl = null;
    window.__lastExportError = "";
  });

  // The export button is hidden once the stage is in export mode; only click
  // when it is visible (i.e. we still need to ENTER export mode).
  const exportBtn = page.locator("#exportBtn");
  if (await exportBtn.isVisible()) {
    await exportBtn.click();
  }
  await page.getByRole("button", { name: "Download PNG" }).click();
  try {
    await page.waitForFunction(
      () => (window.__lastExportDataUrl && window.__lastExportDataUrl.startsWith("data:image/png;base64,")) ||
        window.__lastExportError,
      null,
      { timeout: 30000 }
    );
  } catch {
    throw new Error(
      "Export did not finish within 30s and the stage reported no error — " +
      "see [stage] lines above, or rerun with --headed to inspect the stage."
    );
  }
  const exportError = await page.evaluate(() => window.__lastExportError);
  if (exportError) {
    throw new Error(`Stage export failed: ${exportError}`);
  }

  const dataUrl = await page.evaluate(() => window.__lastExportDataUrl);
  const png = Buffer.from(dataUrl.split(",")[1], "base64");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, png);
  const { width, height } = pngDimensions(png);
  console.log(`${outputPath} (${width}x${height})`);
}

async function readBatch(manifestPath) {
  const resolved = path.resolve(manifestPath);
  const manifest = JSON.parse(await readFile(resolved, "utf8"));
  const baseDir = path.dirname(resolved);
  if (!Array.isArray(manifest.items) || manifest.items.length === 0) {
    throw new Error("Batch manifest needs a non-empty items array.");
  }
  return manifest.items.map((item, index) => {
    if (!item.screenshot || !item.output) {
      throw new Error(`Batch item ${index} needs screenshot and output paths.`);
    }
    return {
      screenshotPath: path.resolve(baseDir, item.screenshot),
      outputPath: path.resolve(baseDir, item.output),
      // Shallow merge: item state wins over manifest base. Give every item a
      // complete title/subtitle; only shared styling belongs in base.
      state: { ...(manifest.base || {}), ...(item.state || {}) }
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  let jobs;
  if (args.batch) {
    jobs = await readBatch(args.batch);
  } else {
    if (!args.screenshot || !args.output) {
      throw new Error(`${usage()}\n\n--screenshot and --output are required (or use --batch).`);
    }
    jobs = [{
      screenshotPath: path.resolve(args.screenshot),
      outputPath: path.resolve(args.output),
      state: await readState(args)
    }];
  }

  let server = null;
  const browser = await chromium.launch({ headless: !args.headed });
  try {
    const url = args.url || (server = await startServer()).url;
    const page = await openStage(browser, url);
    let failed = 0;
    for (const [index, job] of jobs.entries()) {
      try {
        await renderOne(page, job);
      } catch (error) {
        if (jobs.length === 1) throw error;
        failed += 1;
        console.error(`FAILED item ${index + 1}/${jobs.length} (${job.screenshotPath} -> ${job.outputPath}): ${error.message}`);
      }
    }
    if (failed) {
      throw new Error(`${failed}/${jobs.length} items failed; the rendered items listed on stdout are complete.`);
    }
  } finally {
    await browser.close();
    if (server) server.stop();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
