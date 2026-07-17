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
    "                       Paths resolve relative to the manifest file.",
    "  --headed             Show Chromium while rendering."
  ].join("\n");
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--headed") args.headed = true;
    else if (arg.startsWith("--")) {
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
  await page.goto(url);
  await page.locator("#phoneCanvas").waitFor({ state: "visible", timeout: 15000 });
  // The 3D model is the point of the tool: always wait for it so exports
  // never silently fall back to the flat 2D-drawn phone.
  await page.waitForFunction(() => document.getElementById("phoneCanvas")?.dataset.modelReady === "true");
  await page.evaluate(() => document.fonts.ready);
  return page;
}

function pngDimensions(buffer) {
  // PNG IHDR: width/height are big-endian uint32 at offsets 16/20.
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function renderOne(page, { screenshotPath, outputPath, state }) {
  if (!existsSync(screenshotPath)) {
    throw new Error(`Screenshot not found: ${screenshotPath}`);
  }

  await page.locator("#shotFile").setInputFiles(screenshotPath);
  await page.waitForFunction(() => {
    const img = document.getElementById("screenImg");
    return img && img.complete && img.naturalWidth > 0;
  });

  if (state) {
    await page.evaluate((next) => window.ScreenshotStage.setState(next), state);
  }

  // Reset the export marker so a stale data URL from a previous item can
  // never be mistaken for this item's render.
  await page.evaluate(() => { window.__lastExportDataUrl = null; });

  // The export button is hidden once the stage is in export mode; only click
  // when it is visible (i.e. we still need to ENTER export mode).
  const exportBtn = page.locator("#exportBtn");
  if (await exportBtn.isVisible()) {
    await exportBtn.click();
  }
  await page.getByRole("button", { name: "Download PNG" }).click();
  await page.waitForFunction(() => window.__lastExportDataUrl?.startsWith("data:image/png;base64,"), null, {
    timeout: 30000
  });

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
    for (const job of jobs) {
      await renderOne(page, job);
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
