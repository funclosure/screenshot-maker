#!/usr/bin/env node
// Optional AI enhancement layer: runs a rendered App Store screenshot through
// a Gemini image-generation model to enrich the background and make the app
// UI pop, while preserving captions, device frame, and exact pixel size.
// Requires a GEMINI_API_KEY (or GOOGLE_API_KEY); uses the REST API directly
// so there is no extra dependency.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

function usage() {
  return [
    "Usage:",
    "  node scripts/enhance-screenshot.mjs --input <png|dir> [options]",
    "",
    "Runs rendered screenshots through a Gemini image model to enrich the",
    "background and make the UI pop, preserving text and exact dimensions.",
    "",
    "Options:",
    "  --input <png|dir>    A rendered screenshot, or a directory of PNGs.",
    "  --output <png|dir>   Output file (single) or directory (batch).",
    "                       Default: alongside the input with an -enhanced suffix.",
    "  --model <name>       flash = gemini-2.5-flash-image (cheaper),",
    "                       pro = gemini-3-pro-image-preview (default), or any",
    "                       full Gemini image-generation model id.",
    "  --prompt <text>      Replace the default enhancement prompt.",
    "  --prompt-file <txt>  Read the prompt from a file.",
    "  --size <1K|2K|4K>    Requested model output resolution (default 2K;",
    "                       gemini-3 models only). Higher = crisper text after",
    "                       the resize back to the App Store slot.",
    "  --force              Re-enhance even when the output already exists.",
    "",
    "Environment:",
    "  GEMINI_API_KEY (or GOOGLE_API_KEY)  Required. Get one at",
    "                                      https://aistudio.google.com/apikey",
    "",
    "Output: one \"path (WxH)\" line per enhanced PNG on stdout. If the model",
    "returns different dimensions, the image is resized back to the input's",
    "exact size (macOS sips). Warnings and failures go to stderr; exit 1 when",
    "any item fails. Enhancement is generative — always review the results."
  ].join("\n");
}

const KNOWN_OPTIONS = ["--input", "--output", "--model", "--prompt", "--prompt-file", "--size", "--force", "--help"];
const IMAGE_SIZES = ["1K", "2K", "4K"];

const MODEL_ALIASES = {
  flash: "gemini-2.5-flash-image",
  pro: "gemini-3-pro-image-preview"
};
const DEFAULT_MODEL = MODEL_ALIASES.pro;

const DEFAULT_PROMPT = `Enhance this App Store marketing screenshot. It shows a phone or tablet with an app screen, over a background with a title.

STRICT REQUIREMENTS:
- Keep the output dimensions EXACTLY the same as the input image.
- Keep every piece of text EXACTLY as it is: same words, same font look, same position, no new text anywhere.
- Keep the device frame and the app's screen content recognizable and unchanged in layout.

ENHANCE (subtle, premium, editorial):
- Give the flat background gentle depth: soft paper or fabric texture, a hint of natural light, or a faint colour wash that matches the existing palette.
- Add soft, realistic shadow and a touch of ambient light around the device so it pops from the background.
- You may add small tasteful garnish elements in empty background areas (paper scraps, subtle shapes) matching the existing style — never overlapping text or the device screen.

The result must read as the same screenshot, art-directed by a professional — not a different design.`;

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
    else if (arg === "--force") args.force = true;
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

function pngDimensions(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;

async function callGemini({ apiBase, apiKey, model, prompt, imageBase64, imageSize }) {
  const url = `${apiBase}/v1beta/models/${model}:generateContent`;
  const generationConfig = { responseModalities: ["IMAGE", "TEXT"] };
  // imageConfig is a gemini-3 image API feature; older models reject it.
  if (imageSize && model.startsWith("gemini-3")) {
    generationConfig.imageConfig = { imageSize };
  }
  const body = {
    contents: [{
      parts: [
        { inline_data: { mime_type: "image/png", data: imageBase64 } },
        { text: prompt }
      ]
    }],
    generationConfig
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    throw new Error(`Gemini API ${response.status}: ${detail}`);
  }
  const payload = await response.json();
  const parts = payload.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    const inline = part.inlineData || part.inline_data;
    if (inline && inline.data) return Buffer.from(inline.data, "base64");
  }
  const text = parts.find((part) => part.text)?.text;
  throw new Error(text ? `No image in response: ${text.slice(0, 300)}` : "No image in response.");
}

function resizeToMatch(outputPath, target, current) {
  try {
    // Crop to the target aspect first (centered) so off-aspect model output
    // is cover-fitted instead of squished.
    const targetAspect = target.width / target.height;
    const currentAspect = current.width / current.height;
    if (Math.abs(currentAspect - targetAspect) / targetAspect > 0.005) {
      let cropW = current.width;
      let cropH = current.height;
      if (currentAspect > targetAspect) cropW = Math.round(current.height * targetAspect);
      else cropH = Math.round(current.width / targetAspect);
      execFileSync("sips", ["-c", String(cropH), String(cropW), outputPath], { stdio: "pipe" });
    }
    execFileSync("sips", ["-z", String(target.height), String(target.width), outputPath], { stdio: "pipe" });
    return true;
  } catch (error) {
    console.error(`warning: could not resize ${outputPath} back to ${target.width}x${target.height} (sips unavailable?): ${error.message}`);
    return false;
  }
}

async function enhanceOne({ inputPath, outputPath, apiBase, apiKey, model, prompt, imageSize }) {
  const source = await readFile(inputPath);
  const sourceDims = source.toString("ascii", 1, 4) === "PNG" ? pngDimensions(source) : null;

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const enhanced = await callGemini({
        apiBase,
        apiKey,
        model,
        prompt,
        imageSize,
        imageBase64: source.toString("base64")
      });
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, enhanced);

      // Models often return JPEG and/or different dimensions; normalize back
      // to a PNG at the source's exact size (App Store slots are strict).
      if (enhanced.toString("ascii", 1, 4) !== "PNG") {
        console.error(`warning: model returned non-PNG for ${path.basename(inputPath)}; converting to PNG.`);
        execFileSync("sips", ["-s", "format", "png", outputPath, "--out", outputPath], { stdio: "pipe" });
      }
      let dims = pngDimensions(await readFile(outputPath));
      if (sourceDims && (dims.width !== sourceDims.width || dims.height !== sourceDims.height)) {
        console.error(
          `warning: model returned ${dims.width}x${dims.height} for ${path.basename(inputPath)}; ` +
          `resizing back to ${sourceDims.width}x${sourceDims.height}.`
        );
        if (resizeToMatch(outputPath, sourceDims, dims)) {
          dims = pngDimensions(await readFile(outputPath));
        }
      }
      console.log(`${outputPath} (${dims.width}x${dims.height})`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        const backoff = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
        console.error(`retry ${attempt}/${MAX_RETRIES - 1} for ${path.basename(inputPath)} in ${backoff / 1000}s: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }
  throw lastError;
}

async function collectJobs(args) {
  const input = path.resolve(args.input);
  if (!existsSync(input)) {
    throw new Error(`Input not found: ${args.input}`);
  }
  const info = await stat(input);
  if (info.isFile()) {
    const output = args.output
      ? path.resolve(args.output)
      : input.replace(/\.png$/i, "-enhanced.png");
    return [{ inputPath: input, outputPath: output }];
  }
  const files = (await readdir(input)).filter((f) => /\.png$/i.test(f) && !/-enhanced\.png$/i.test(f));
  if (!files.length) {
    throw new Error(`No PNGs found in ${args.input}`);
  }
  const outDir = args.output ? path.resolve(args.output) : input;
  return files.map((file) => ({
    inputPath: path.join(input, file),
    outputPath: args.output
      ? path.join(outDir, file)
      : path.join(outDir, file.replace(/\.png$/i, "-enhanced.png"))
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.input) {
    throw new Error(`${usage()}\n\n--input is required.`);
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY (or GOOGLE_API_KEY) is required. Get one at https://aistudio.google.com/apikey " +
      "and export it, e.g.: export GEMINI_API_KEY=your-key"
    );
  }
  const apiBase = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com";
  const model = MODEL_ALIASES[args.model] || args.model || DEFAULT_MODEL;
  const prompt = args.prompt || (args.promptFile ? await readFile(path.resolve(args.promptFile), "utf8") : DEFAULT_PROMPT);
  const imageSize = (args.size || "2K").toUpperCase();
  if (!IMAGE_SIZES.includes(imageSize)) {
    throw new Error(`Unknown --size: ${args.size}. Valid sizes: ${IMAGE_SIZES.join(", ")}.`);
  }

  const jobs = await collectJobs(args);
  let failed = 0;
  for (const [index, job] of jobs.entries()) {
    if (!args.force && existsSync(job.outputPath) && job.outputPath !== job.inputPath) {
      console.error(`skipping ${path.basename(job.outputPath)} (exists; use --force to redo)`);
      continue;
    }
    try {
      await enhanceOne({ ...job, apiBase, apiKey, model, prompt, imageSize });
    } catch (error) {
      if (jobs.length === 1) throw error;
      failed += 1;
      console.error(`FAILED item ${index + 1}/${jobs.length} (${job.inputPath}): ${error.message}`);
    }
  }
  if (failed) {
    throw new Error(`${failed}/${jobs.length} items failed; the enhanced items listed on stdout are complete.`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
