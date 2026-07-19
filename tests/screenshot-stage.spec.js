import { expect, test } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("loads the 3D iPhone stage and uses drag pan for orientation", async ({ page }) => {
  await page.goto("/screenshot-stage.html");

  const canvas = page.locator("#phoneCanvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("data-model-ready", "true", { timeout: 10000 });

  const cssDevice = page.locator("#device");
  await expect(cssDevice).toBeHidden();

  const before = await canvas.getAttribute("data-rotation");
  await page.mouse.move(840, 430);
  await page.mouse.move(980, 530);
  await expect(canvas).toHaveAttribute("data-rotation", before);

  await page.mouse.move(840, 430);
  await page.mouse.down();
  await page.mouse.move(980, 530);
  await page.mouse.up();

  await expect.poll(() => canvas.getAttribute("data-rotation")).not.toBe(before);
});

test("exports a 1290 by 2796 PNG", async ({ page }) => {
  await page.goto("/screenshot-stage.html");
  await expect(page.locator("#phoneCanvas")).toHaveAttribute("data-model-ready", "true", { timeout: 10000 });

  await page.getByRole("button", { name: "Enter export mode" }).click();
  await page.getByRole("button", { name: "Download PNG" }).click();

  await expect.poll(
    () => page.evaluate(() => window.__lastExportDataUrl || ""),
    { timeout: 20000 }
  ).toContain("data:image/png;base64,");
  const dataUrl = await page.evaluate(() => window.__lastExportDataUrl);
  const png = Buffer.from(dataUrl.split(",")[1], "base64");
  expect(png.toString("ascii", 1, 4)).toBe("PNG");
  expect(png.readUInt32BE(16)).toBe(1290);
  expect(png.readUInt32BE(20)).toBe(2796);
});

test("does not draw an export floor shadow", async ({ page }) => {
  await page.goto("/screenshot-stage.html");
  await expect(page.locator("#phoneCanvas")).toHaveAttribute("data-model-ready", "true", { timeout: 10000 });

  await page.evaluate(() => {
    window.__ellipseCalls = 0;
    const original = CanvasRenderingContext2D.prototype.ellipse;
    CanvasRenderingContext2D.prototype.ellipse = function (...args) {
      window.__ellipseCalls += 1;
      return original.apply(this, args);
    };
  });

  await page.getByRole("button", { name: "Enter export mode" }).click();
  await page.getByRole("button", { name: "Download PNG" }).click();
  await expect.poll(
    () => page.evaluate(() => window.__lastExportDataUrl || ""),
    { timeout: 20000 }
  ).toContain("data:image/png;base64,");
  await expect.poll(() => page.evaluate(() => window.__ellipseCalls)).toBe(0);
});

test("exports the phone from a high-resolution render pass", async ({ page }) => {
  await page.goto("/screenshot-stage.html");
  await expect(page.locator("#phoneCanvas")).toHaveAttribute("data-model-ready", "true", { timeout: 10000 });

  await page.evaluate(() => {
    const original = window.ScreenshotStage.renderPhone;
    window.__phoneRenderRequest = null;
    window.ScreenshotStage.renderPhone = async (options) => {
      window.__phoneRenderRequest = options;
      return original(options);
    };
  });

  await page.getByRole("button", { name: "Enter export mode" }).click();
  await page.getByRole("button", { name: "Download PNG" }).click();

  // height = 1290 * phoneWidthRatio(0.72) * body aspect (146.6/71.6)
  await expect.poll(() => page.evaluate(() => window.__phoneRenderRequest)).toMatchObject({
    width: 1290,
    height: 1902
  });
});

test("export fails loudly when the 3D model is not ready", async ({ page }) => {
  await page.goto("/screenshot-stage.html");
  await expect(page.locator("#phoneCanvas")).toHaveAttribute("data-model-ready", "true", { timeout: 10000 });

  // Simulate a stage whose 3D model never became ready.
  await page.evaluate(() => document.body.classList.remove("model-ready"));

  await page.getByRole("button", { name: "Enter export mode" }).click();
  await page.getByRole("button", { name: "Download PNG" }).click();

  await expect.poll(
    () => page.evaluate(() => window.__lastExportError || ""),
    { timeout: 10000 }
  ).toContain("3D model");
  expect(await page.evaluate(() => window.__lastExportDataUrl || null)).toBeNull();
});

test("export uses the flat 2D phone only when allow2DFallback is set", async ({ page }) => {
  await page.goto("/screenshot-stage.html");
  await expect(page.locator("#phoneCanvas")).toHaveAttribute("data-model-ready", "true", { timeout: 10000 });

  await page.evaluate(() => {
    document.body.classList.remove("model-ready");
    window.ScreenshotStage.setState({ allow2DFallback: true });
  });

  await page.getByRole("button", { name: "Enter export mode" }).click();
  await page.getByRole("button", { name: "Download PNG" }).click();

  await expect.poll(
    () => page.evaluate(() => window.__lastExportDataUrl || ""),
    { timeout: 20000 }
  ).toContain("data:image/png;base64,");
  expect(await page.evaluate(() => window.__lastExportError || "")).toBe("");
  const png = Buffer.from((await page.evaluate(() => window.__lastExportDataUrl)).split(",")[1], "base64");
  expect(png.readUInt32BE(16)).toBe(1290);
  expect(png.readUInt32BE(20)).toBe(2796);
});

test("exposes a scriptable scene API", async ({ page }) => {
  await page.goto("/screenshot-stage.html");
  await expect(page.locator("#phoneCanvas")).toHaveAttribute("data-model-ready", "true", { timeout: 10000 });

  await page.evaluate(() => window.ScreenshotStage.setState({
    title: "Made by an LLM",
    subtitle: "Deterministic scene control",
    bgMode: "solid",
    solid: "#123456",
    rotation: { x: -0.2, y: 0.3 },
    phoneOffset: { x: 44, y: -28 },
    phoneScale: 1.06
  }));

  await expect(page.locator("#titleEl")).toHaveText("Made by an LLM");
  await expect(page.locator("#subtitleEl")).toHaveText("Deterministic scene control");
  await expect(page.locator("#stage")).toHaveCSS("background-color", "rgb(18, 52, 86)");

  const state = await page.evaluate(() => window.ScreenshotStage.getState());
  expect(state).toMatchObject({
    title: "Made by an LLM",
    subtitle: "Deterministic scene control",
    bgMode: "solid",
    solid: "#123456",
    rotation: { x: -0.2, y: 0.3 },
    phoneOffset: { x: 44, y: -28 },
    phoneScale: 1.06,
    displayRect: { x: 0.0184, y: 0, width: 0.9631, height: 1 }
  });
});

test("uses Space drag to pan the phone preview", async ({ page }) => {
  await page.goto("/screenshot-stage.html");
  await expect(page.locator("#phoneCanvas")).toHaveAttribute("data-model-ready", "true", { timeout: 10000 });

  const before = await page.evaluate(() => window.ScreenshotStage.getState().phoneOffset);
  const stageScale = await page.evaluate(() => document.getElementById("stage").getBoundingClientRect().width / 1290);
  await page.keyboard.down("Space");
  await page.mouse.move(640, 500);
  await page.mouse.down();
  await page.mouse.move(700, 455);
  await page.mouse.up();
  await page.keyboard.up("Space");

  await expect.poll(() => page.evaluate(() => window.ScreenshotStage.getState().phoneOffset)).toMatchObject({
    x: Math.round(before.x + 60 / stageScale),
    y: Math.round(before.y - 45 / stageScale)
  });
});

test("adjusts phone placement from UI controls", async ({ page }) => {
  await page.goto("/screenshot-stage.html");
  await expect(page.locator("#phoneCanvas")).toHaveAttribute("data-model-ready", "true", { timeout: 10000 });

  await page.locator("#phoneScale").fill("112");
  await page.locator("#phoneX").fill("120");
  await page.locator("#phoneY").fill("-90");

  await expect.poll(() => page.evaluate(() => window.ScreenshotStage.getState())).toMatchObject({
    phoneScale: 1.12,
    phoneOffset: { x: 120, y: -90 }
  });
  await expect(page.locator("#phoneScaleVal")).toHaveText("112%");
  await expect(page.locator("#phoneXVal")).toHaveText("120");
  await expect(page.locator("#phoneYVal")).toHaveText("-90");
});

test("hides appearance controls and displays model rotation", async ({ page }) => {
  await page.goto("/screenshot-stage.html");
  await expect(page.locator("#phoneCanvas")).toHaveAttribute("data-model-ready", "true", { timeout: 10000 });

  await expect(page.locator("#showFrontCamera")).toHaveCount(0);
  await expect(page.locator("#reflection")).toHaveCount(0);

  await page.evaluate(() => window.ScreenshotStage.setState({
    rotation: { x: -0.2, y: 0.3, z: 0.4 }
  }));
  const state = await page.evaluate(() => window.ScreenshotStage.getState());
  expect(state.rotation).toMatchObject({ x: -0.2, y: 0.3, z: 0.4 });
  await expect(page.locator("#rotXVal")).toHaveText("-11°");
  await expect(page.locator("#rotYVal")).toHaveText("17°");
  await expect(page.locator("#rotZVal")).toHaveText("23°");
});

test("sets model rotation from the panel sliders", async ({ page }) => {
  await page.goto("/screenshot-stage.html");
  await expect(page.locator("#phoneCanvas")).toHaveAttribute("data-model-ready", "true", { timeout: 10000 });

  await page.locator("#rotZ").fill("30");

  await expect.poll(() => page.evaluate(() => window.ScreenshotStage.getRotation().z)).toBeCloseTo(30 * Math.PI / 180, 2);
  await expect(page.locator("#rotZVal")).toHaveText("30°");
});

test("maps the uploaded screenshot onto a dedicated screen plane", async ({ page }) => {
  await page.goto("/screenshot-stage.html");
  await expect(page.locator("#phoneCanvas")).toHaveAttribute("data-model-ready", "true", { timeout: 10000 });

  const initial = await page.evaluate(() => window.ScreenshotStage.getScreenPlaneInfo());
  expect(initial).not.toBeNull();
  expect(initial.aspect).toBeCloseTo(1290 / 2796, 3);

  const dir = await mkdtemp(path.join(os.tmpdir(), "screenshot-plane-"));
  const source = path.join(dir, "tall.png");
  try {
    // 2x4 PNG: aspect 0.5, clearly different from the App Store canvas aspect.
    await writeFile(source, Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAAECAIAAAArjXluAAAAFElEQVR4nGPUiDrBwMDAxAAGqBQAIXABUqo0eqoAAAAASUVORK5CYII=",
      "base64"
    ));
    await page.locator("#shotFile").setInputFiles(source);

    await expect.poll(
      () => page.evaluate(() => window.ScreenshotStage.getScreenPlaneInfo().aspect),
      { timeout: 10000 }
    ).toBeCloseTo(0.5, 3);

    const info = await page.evaluate(() => window.ScreenshotStage.getScreenPlaneInfo());
    expect(info.width / info.height).toBeCloseTo(0.5, 3);
    expect(info.width).toBeLessThanOrEqual(info.aperture.width + 1e-4);
    expect(info.height).toBeLessThanOrEqual(info.aperture.height + 1e-4);

    expect(info.island).toMatchObject({ visible: true, renderOrder: 3 });
    expect(info.island.vertexCount).toBeGreaterThan(0);
    expect(info.island.localY).toBeCloseTo(0.5 - 0.0341, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("edits the scene from the JSON panel", async ({ page }) => {
  await page.goto("/screenshot-stage.html");
  await expect(page.locator("#phoneCanvas")).toHaveAttribute("data-model-ready", "true", { timeout: 10000 });

  await page.locator("#jsonToggle").click();
  const editor = page.locator("#jsonEditor");
  await expect(editor).toBeVisible();

  const current = JSON.parse(await editor.inputValue());
  expect(current).toMatchObject({ bgMode: "gradient" });

  current.title = "From the JSON panel";
  current.rotation = { x: -0.1, y: 0.1, z: 0.2 };
  current.bgMode = "solid";
  current.solid = "#224466";
  await editor.fill(JSON.stringify(current, null, 2));
  await page.locator("#jsonApply").click();

  await expect(page.locator("#jsonError")).toBeHidden();
  await expect(page.locator("#titleEl")).toHaveText("From the JSON panel");
  await expect(page.locator("#stage")).toHaveCSS("background-color", "rgb(34, 68, 102)");
  const state = await page.evaluate(() => window.ScreenshotStage.getState());
  expect(state.rotation).toMatchObject({ x: -0.1, y: 0.1, z: 0.2 });

  await editor.fill("{ not valid json");
  await page.locator("#jsonApply").click();
  await expect(page.locator("#jsonError")).toBeVisible();
  await expect(page.locator("#titleEl")).toHaveText("From the JSON panel");
});

test("surfaces export errors thrown inside image-background mode", async ({ page }) => {
  await page.goto("/screenshot-stage.html");
  await expect(page.locator("#phoneCanvas")).toHaveAttribute("data-model-ready", "true", { timeout: 10000 });

  // A broken background image must fail the export with a clear error, not hang.
  await page.evaluate(() => window.ScreenshotStage.setState({
    bgMode: "image",
    bgImage: "data:image/png;base64,not-a-real-png"
  }));

  await page.getByRole("button", { name: "Enter export mode" }).click();
  await page.getByRole("button", { name: "Download PNG" }).click();

  await expect.poll(
    () => page.evaluate(() => window.__lastExportError || ""),
    { timeout: 10000 }
  ).toContain("Background image");
});

test("CLI rejects unknown options with a suggestion", async () => {
  const error = await execFileAsync("node", [
    "scripts/render-screenshot.mjs",
    "--uri", "http://127.0.0.1:9/x"
  ], { cwd: process.cwd(), timeout: 15000 }).then(() => null, (e) => e);

  expect(error).not.toBeNull();
  expect(error.code).toBe(1);
  expect(String(error.stderr)).toContain("Unknown option: --uri");
  expect(String(error.stderr)).toContain("--url");
});

test("CLI --help documents the scene state keys", async () => {
  const { stdout } = await execFileAsync("node", [
    "scripts/render-screenshot.mjs", "--help"
  ], { cwd: process.cwd(), timeout: 15000 });

  for (const key of ["phoneWidthRatio", "phoneScale", "rotation", "allow2DFallback", "gradA", "titleSize", "frame"]) {
    expect(stdout).toContain(key);
  }
  expect(stdout).toContain("examples/scene.json");
  expect(stdout).toContain("locales");
  expect(stdout).toContain("--gallery");
  expect(stdout).toContain("--canvas");
  expect(stdout).toContain("ipad-13");
});

test("CLI warns about unrecognized scene state keys", async ({ baseURL }) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "screenshot-maker-"));
  const source = path.join(dir, "source.png");
  const output = path.join(dir, "output.png");

  try {
    await writeFile(source, Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64"
    ));

    const { stderr } = await execFileAsync("node", [
      "scripts/render-screenshot.mjs",
      "--url", `${baseURL}/screenshot-stage.html`,
      "--screenshot", source,
      "--output", output,
      "--state-json", JSON.stringify({ title: "ok", titleColour: "#fff" })
    ], { cwd: process.cwd(), timeout: 30000 });

    expect(stderr).toContain("titleColour");
    expect(stderr.toLowerCase()).toContain("ignored");
    const png = await readFile(output);
    expect(png.toString("ascii", 1, 4)).toBe("PNG");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI batch keeps rendering after a failed item and reports a summary", async ({ baseURL }) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "screenshot-maker-"));
  const source = path.join(dir, "source.png");
  const manifest = path.join(dir, "manifest.json");

  try {
    await writeFile(source, Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64"
    ));
    await writeFile(manifest, JSON.stringify({
      items: [
        { screenshot: "missing.png", output: "out/one.png", state: { title: "a", subtitle: "b" } },
        { screenshot: "source.png", output: "out/two.png", state: { title: "c", subtitle: "d" } }
      ]
    }));

    const error = await execFileAsync("node", [
      "scripts/render-screenshot.mjs",
      "--url", `${baseURL}/screenshot-stage.html`,
      "--batch", manifest
    ], { cwd: process.cwd(), timeout: 60000 }).then(() => null, (e) => e);

    expect(error).not.toBeNull();
    expect(error.code).toBe(1);
    expect(String(error.stderr)).toContain("item 1/2");
    expect(String(error.stderr)).toContain("missing.png");
    expect(String(error.stderr)).toContain("1/2 items failed");
    const png = await readFile(path.join(dir, "out/two.png"));
    expect(png.toString("ascii", 1, 4)).toBe("PNG");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI explains when the URL is not the screenshot stage", async ({ baseURL }) => {
  const error = await execFileAsync("node", [
    "scripts/render-screenshot.mjs",
    "--url", `${baseURL}/does-not-exist.html`,
    "--screenshot", "package.json",
    "--output", "/tmp/never-written.png"
  ], { cwd: process.cwd(), timeout: 30000 }).then(() => null, (e) => e);

  expect(error).not.toBeNull();
  expect(error.code).toBe(1);
  expect(String(error.stderr)).toContain("screenshot stage");
});

test("CLI warns when the input aspect ratio does not match the canvas", async ({ baseURL }) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "screenshot-maker-"));
  const source = path.join(dir, "square.png");
  const output = path.join(dir, "output.png");

  try {
    // 1x1 PNG: aspect 1.0, far from the 1290/2796 canvas aspect.
    await writeFile(source, Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64"
    ));

    const { stderr } = await execFileAsync("node", [
      "scripts/render-screenshot.mjs",
      "--url", `${baseURL}/screenshot-stage.html`,
      "--screenshot", source,
      "--output", output
    ], { cwd: process.cwd(), timeout: 30000 });

    expect(stderr.toLowerCase()).toContain("aspect");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI surfaces stage export errors instead of a generic timeout", async ({ baseURL }) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "screenshot-maker-"));
  const source = path.join(dir, "source.png");
  const output = path.join(dir, "output.png");

  try {
    await writeFile(source, Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64"
    ));

    const error = await execFileAsync("node", [
      "scripts/render-screenshot.mjs",
      "--url", `${baseURL}/screenshot-stage.html`,
      "--screenshot", source,
      "--output", output,
      "--state-json", JSON.stringify({
        bgMode: "image",
        bgImage: "data:image/png;base64,not-a-real-png"
      })
    ], { cwd: process.cwd(), timeout: 30000 }).then(() => null, (e) => e);

    expect(error).not.toBeNull();
    expect(error.code).toBe(1);
    expect(String(error.stderr)).toContain("Background image");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

test("plain mode preview hides the phone chrome", async ({ page }) => {
  await page.goto("/screenshot-stage.html");
  await expect(page.locator("#phoneCanvas")).toHaveAttribute("data-model-ready", "true", { timeout: 10000 });

  await page.evaluate(() => window.ScreenshotStage.setState({ frame: "none" }));
  await expect(page.locator("#phoneCanvas")).toBeHidden();
  await expect(page.locator("#device")).toBeVisible();
  await expect(page.locator("#island")).toBeHidden();

  await page.evaluate(() => window.ScreenshotStage.setState({ frame: "iphone-3d" }));
  await expect(page.locator("#phoneCanvas")).toBeVisible();
  await expect(page.locator("#island")).toBeHidden(); // island only shows in the CSS fallback device
});

test("plain mode exports without touching the 3D model", async ({ page }) => {
  await page.goto("/screenshot-stage.html");
  await expect(page.locator("#phoneCanvas")).toHaveAttribute("data-model-ready", "true", { timeout: 10000 });

  const dir = await mkdtemp(path.join(os.tmpdir(), "screenshot-plain-"));
  const source = path.join(dir, "shot.png");
  try {
    await writeFile(source, Buffer.from(TINY_PNG_BASE64, "base64"));
    await page.locator("#shotFile").setInputFiles(source);
    await page.waitForFunction(() => {
      const img = document.getElementById("screenImg");
      return img && img.complete && img.naturalWidth > 0;
    });

    await page.evaluate(() => {
      window.__phoneRenderCalls = 0;
      const original = window.ScreenshotStage.renderPhone;
      window.ScreenshotStage.renderPhone = async (options) => {
        window.__phoneRenderCalls += 1;
        return original(options);
      };
      // Plain mode must not need the model at all.
      document.body.classList.remove("model-ready");
      window.ScreenshotStage.setState({ frame: "none" });
    });

    await page.getByRole("button", { name: "Enter export mode" }).click();
    await page.getByRole("button", { name: "Download PNG" }).click();

    await expect.poll(
      () => page.evaluate(() => window.__lastExportDataUrl || ""),
      { timeout: 20000 }
    ).toContain("data:image/png;base64,");
    expect(await page.evaluate(() => window.__lastExportError || "")).toBe("");
    expect(await page.evaluate(() => window.__phoneRenderCalls)).toBe(0);
    const png = Buffer.from((await page.evaluate(() => window.__lastExportDataUrl)).split(",")[1], "base64");
    expect(png.readUInt32BE(16)).toBe(1290);
    expect(png.readUInt32BE(20)).toBe(2796);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("plain mode export requires an uploaded screenshot", async ({ page }) => {
  await page.goto("/screenshot-stage.html");
  await expect(page.locator("#phoneCanvas")).toHaveAttribute("data-model-ready", "true", { timeout: 10000 });

  await page.evaluate(() => window.ScreenshotStage.setState({ frame: "none" }));
  await page.getByRole("button", { name: "Enter export mode" }).click();
  await page.getByRole("button", { name: "Download PNG" }).click();

  await expect.poll(
    () => page.evaluate(() => window.__lastExportError || ""),
    { timeout: 10000 }
  ).toContain("screenshot");
});

test("exports an iPad 13-inch canvas in plain mode", async ({ page }) => {
  await page.goto("/screenshot-stage.html");
  await expect(page.locator("#phoneCanvas")).toHaveAttribute("data-model-ready", "true", { timeout: 10000 });

  const dir = await mkdtemp(path.join(os.tmpdir(), "screenshot-ipad-"));
  const source = path.join(dir, "shot.png");
  try {
    await writeFile(source, Buffer.from(TINY_PNG_BASE64, "base64"));
    await page.locator("#shotFile").setInputFiles(source);
    await page.waitForFunction(() => {
      const img = document.getElementById("screenImg");
      return img && img.complete && img.naturalWidth > 0;
    });

    await page.evaluate(() => window.ScreenshotStage.setState({ canvas: "ipad-13", frame: "none" }));

    await page.getByRole("button", { name: "Enter export mode" }).click();
    await page.getByRole("button", { name: "Download PNG" }).click();

    await expect.poll(
      () => page.evaluate(() => window.__lastExportDataUrl || ""),
      { timeout: 20000 }
    ).toContain("data:image/png;base64,");
    const png = Buffer.from((await page.evaluate(() => window.__lastExportDataUrl)).split(",")[1], "base64");
    expect(png.readUInt32BE(16)).toBe(2064);
    expect(png.readUInt32BE(20)).toBe(2752);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("export wraps CJK titles without needing injected spaces", async ({ page }) => {
  await page.goto("/screenshot-stage.html");
  await expect(page.locator("#phoneCanvas")).toHaveAttribute("data-model-ready", "true", { timeout: 10000 });

  await page.evaluate(() => {
    window.__drawnTexts = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
      window.__drawnTexts.push(String(text));
      return original.call(this, text, ...rest);
    };
    window.ScreenshotStage.setState({
      // 24 CJK chars, no spaces: far too wide for one caption line at size 96.
      title: "把每一個瞬間都封存進一顆美麗的時光膠囊裡慢慢回味珍藏",
      subtitle: "sub",
      titleSize: 96
    });
  });

  await page.getByRole("button", { name: "Enter export mode" }).click();
  await page.getByRole("button", { name: "Download PNG" }).click();
  await expect.poll(
    () => page.evaluate(() => window.__lastExportDataUrl || ""),
    { timeout: 20000 }
  ).toContain("data:image/png;base64,");

  const titleLines = await page.evaluate(() =>
    window.__drawnTexts.filter((t) => t.includes("瞬間") || t.includes("膠囊") || t.includes("回味") || t.includes("把每"))
  );
  expect(titleLines.length).toBeGreaterThanOrEqual(2);
  for (const line of titleLines) expect(line).not.toContain(" ");
});

test("export honors manual line breaks in the title", async ({ page }) => {
  await page.goto("/screenshot-stage.html");
  await expect(page.locator("#phoneCanvas")).toHaveAttribute("data-model-ready", "true", { timeout: 10000 });

  await page.evaluate(() => {
    window.__drawnTexts = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
      window.__drawnTexts.push(String(text));
      return original.call(this, text, ...rest);
    };
    window.ScreenshotStage.setState({
      title: "Write it.\nPeel it.\nLet it go.",
      subtitle: "sub"
    });
  });

  await page.getByRole("button", { name: "Enter export mode" }).click();
  await page.getByRole("button", { name: "Download PNG" }).click();
  await expect.poll(
    () => page.evaluate(() => window.__lastExportDataUrl || ""),
    { timeout: 20000 }
  ).toContain("data:image/png;base64,");

  const drawn = await page.evaluate(() => window.__drawnTexts);
  expect(drawn).toContain("Write it.");
  expect(drawn).toContain("Peel it.");
  expect(drawn).toContain("Let it go.");
});

test("exports a framed iPad from the 3D model on the ipad-13 canvas", async ({ page }) => {
  await page.goto("/screenshot-stage.html");
  await expect(page.locator("#phoneCanvas")).toHaveAttribute("data-model-ready", "true", { timeout: 10000 });

  await page.evaluate(() => window.ScreenshotStage.setState({ canvas: "ipad-13" }));
  // The iPad model loads on demand; the stage flags readiness per device.
  await expect(page.locator("#phoneCanvas")).toHaveAttribute("data-model-ready", "true", { timeout: 20000 });

  // The iPad has no Dynamic Island: the synthetic island must be hidden.
  expect(await page.evaluate(() => window.ScreenshotStage.getScreenPlaneInfo().island.visible)).toBe(false);

  await page.evaluate(() => {
    window.__phoneRenderCalls = 0;
    const original = window.ScreenshotStage.renderPhone;
    window.ScreenshotStage.renderPhone = async (options) => {
      window.__phoneRenderCalls += 1;
      return original(options);
    };
  });

  await page.getByRole("button", { name: "Enter export mode" }).click();
  await page.getByRole("button", { name: "Download PNG" }).click();

  await expect.poll(
    () => page.evaluate(() => window.__lastExportDataUrl || ""),
    { timeout: 20000 }
  ).toContain("data:image/png;base64,");
  expect(await page.evaluate(() => window.__lastExportError || "")).toBe("");
  expect(await page.evaluate(() => window.__phoneRenderCalls)).toBe(1);
  const png = Buffer.from((await page.evaluate(() => window.__lastExportDataUrl)).split(",")[1], "base64");
  expect(png.readUInt32BE(16)).toBe(2064);
  expect(png.readUInt32BE(20)).toBe(2752);
});

test("swaps back to the iPhone model after an iPad canvas", async ({ page }) => {
  await page.goto("/screenshot-stage.html");
  await expect(page.locator("#phoneCanvas")).toHaveAttribute("data-model-ready", "true", { timeout: 10000 });

  await page.evaluate(() => window.ScreenshotStage.setState({ canvas: "ipad-13" }));
  await expect(page.locator("#phoneCanvas")).toHaveAttribute("data-model-ready", "true", { timeout: 20000 });
  await page.evaluate(() => window.ScreenshotStage.setState({ canvas: "iphone-6.9" }));
  await expect(page.locator("#phoneCanvas")).toHaveAttribute("data-model-ready", "true", { timeout: 20000 });

  // iPhone rig again: island is back.
  expect(await page.evaluate(() => window.ScreenshotStage.getScreenPlaneInfo().island.visible)).toBe(true);

  await page.getByRole("button", { name: "Enter export mode" }).click();
  await page.getByRole("button", { name: "Download PNG" }).click();
  await expect.poll(
    () => page.evaluate(() => window.__lastExportDataUrl || ""),
    { timeout: 20000 }
  ).toContain("data:image/png;base64,");
  const png = Buffer.from((await page.evaluate(() => window.__lastExportDataUrl)).split(",")[1], "base64");
  expect(png.readUInt32BE(16)).toBe(1290);
  expect(png.readUInt32BE(20)).toBe(2796);
});

test("CLI batch renders framed iPhone and iPad items in one run", async ({ baseURL }) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "screenshot-maker-"));
  const manifest = path.join(dir, "manifest.json");

  try {
    await writeFile(path.join(dir, "source.png"), Buffer.from(TINY_PNG_BASE64, "base64"));
    await writeFile(manifest, JSON.stringify({
      base: { title: "Mixed", subtitle: "Set" },
      items: [
        { screenshot: "source.png", output: "out/iphone.png" },
        { screenshot: "source.png", output: "out/ipad.png", state: { canvas: "ipad-13" } }
      ]
    }));

    await execFileAsync("node", [
      "scripts/render-screenshot.mjs",
      "--url", `${baseURL}/screenshot-stage.html`,
      "--batch", manifest
    ], { cwd: process.cwd(), timeout: 90000 });

    const iphone = await readFile(path.join(dir, "out/iphone.png"));
    expect(iphone.readUInt32BE(16)).toBe(1290);
    expect(iphone.readUInt32BE(20)).toBe(2796);
    const ipad = await readFile(path.join(dir, "out/ipad.png"));
    expect(ipad.readUInt32BE(16)).toBe(2064);
    expect(ipad.readUInt32BE(20)).toBe(2752);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI --canvas ipad-13 renders an iPad-sized PNG", async ({ baseURL }) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "screenshot-maker-"));
  const source = path.join(dir, "source.png");
  const output = path.join(dir, "output.png");

  try {
    await writeFile(source, Buffer.from(TINY_PNG_BASE64, "base64"));

    const { stdout } = await execFileAsync("node", [
      "scripts/render-screenshot.mjs",
      "--url", `${baseURL}/screenshot-stage.html`,
      "--screenshot", source,
      "--output", output,
      "--canvas", "ipad-13",
      "--state-json", JSON.stringify({ title: "iPad", subtitle: "Plain", frame: "none" })
    ], { cwd: process.cwd(), timeout: 30000 });

    expect(stdout).toContain("(2064x2752)");
    const png = await readFile(output);
    expect(png.readUInt32BE(16)).toBe(2064);
    expect(png.readUInt32BE(20)).toBe(2752);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI --canvas rejects unknown presets and lists the valid ones", async () => {
  const error = await execFileAsync("node", [
    "scripts/render-screenshot.mjs",
    "--canvas", "ipad-12.9",
    "--screenshot", "package.json",
    "--output", "/tmp/never.png"
  ], { cwd: process.cwd(), timeout: 15000 }).then(() => null, (e) => e);

  expect(error).not.toBeNull();
  expect(error.code).toBe(1);
  expect(String(error.stderr)).toContain("ipad-12.9");
  expect(String(error.stderr)).toContain("ipad-13");
  expect(String(error.stderr)).toContain("iphone-6.9");
});

test("CLI renders plain mode from scene state", async ({ baseURL }) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "screenshot-maker-"));
  const source = path.join(dir, "source.png");
  const output = path.join(dir, "output.png");

  try {
    await writeFile(source, Buffer.from(TINY_PNG_BASE64, "base64"));

    const { stderr } = await execFileAsync("node", [
      "scripts/render-screenshot.mjs",
      "--url", `${baseURL}/screenshot-stage.html`,
      "--screenshot", source,
      "--output", output,
      "--state-json", JSON.stringify({ title: "Plain", subtitle: "No frame", frame: "none" })
    ], { cwd: process.cwd(), timeout: 30000 });

    expect(stderr).not.toContain("not recognized");
    const png = await readFile(output);
    expect(png.toString("ascii", 1, 4)).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1290);
    expect(png.readUInt32BE(20)).toBe(2796);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI batch expands per-item locales into parallel outputs", async ({ baseURL }) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "screenshot-maker-"));
  const manifest = path.join(dir, "manifest.json");

  try {
    await writeFile(path.join(dir, "source.png"), Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64"
    ));
    await writeFile(manifest, JSON.stringify({
      base: { subtitle: "shared subtitle" },
      items: [{
        screenshot: "source.png",
        output: "out/{locale}/shot.png",
        locales: {
          "en-US": { title: "Hello" },
          "ja": { title: "こんにちは" }
        }
      }]
    }));

    const { stdout } = await execFileAsync("node", [
      "scripts/render-screenshot.mjs",
      "--url", `${baseURL}/screenshot-stage.html`,
      "--batch", manifest
    ], { cwd: process.cwd(), timeout: 60000 });

    expect(stdout).toContain(path.join("out", "en-US", "shot.png"));
    expect(stdout).toContain(path.join("out", "ja", "shot.png"));
    for (const locale of ["en-US", "ja"]) {
      const png = await readFile(path.join(dir, "out", locale, "shot.png"));
      expect(png.toString("ascii", 1, 4)).toBe("PNG");
      expect(png.readUInt32BE(16)).toBe(1290);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI batch requires a {locale} placeholder when locales are used", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "screenshot-maker-"));
  const manifest = path.join(dir, "manifest.json");

  try {
    await writeFile(manifest, JSON.stringify({
      items: [{
        screenshot: "source.png",
        output: "out/shot.png",
        locales: { "en-US": { title: "Hello" }, "ja": { title: "こんにちは" } }
      }]
    }));

    const error = await execFileAsync("node", [
      "scripts/render-screenshot.mjs",
      "--batch", manifest
    ], { cwd: process.cwd(), timeout: 15000 }).then(() => null, (e) => e);

    expect(error).not.toBeNull();
    expect(error.code).toBe(1);
    expect(String(error.stderr)).toContain("{locale}");
    expect(String(error.stderr)).toContain("item 1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI --gallery writes an HTML contact sheet of the rendered set", async ({ baseURL }) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "screenshot-maker-"));
  const manifest = path.join(dir, "manifest.json");
  const gallery = path.join(dir, "out", "index.html");

  try {
    await writeFile(path.join(dir, "source.png"), Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64"
    ));
    await writeFile(manifest, JSON.stringify({
      items: [{
        screenshot: "source.png",
        output: "out/{locale}/shot.png",
        locales: {
          "en-US": { title: "Hello" },
          "ja": { title: "こんにちは" }
        }
      }]
    }));

    await execFileAsync("node", [
      "scripts/render-screenshot.mjs",
      "--url", `${baseURL}/screenshot-stage.html`,
      "--batch", manifest,
      "--gallery", gallery
    ], { cwd: process.cwd(), timeout: 60000 });

    const html = await readFile(gallery, "utf8");
    expect(html).toContain("en-US/shot.png");
    expect(html).toContain("ja/shot.png");
    expect(html).toContain("Hello");
    expect(html).toContain("こんにちは");
    expect(html).toContain("1290");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("renders an App Store PNG from the agent CLI", async ({ baseURL }) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "screenshot-maker-"));
  const source = path.join(dir, "source.png");
  const output = path.join(dir, "output.png");

  try {
    await writeFile(source, Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      "base64"
    ));

    await execFileAsync("node", [
      "scripts/render-screenshot.mjs",
      "--url", `${baseURL}/screenshot-stage.html`,
      "--screenshot", source,
      "--output", output,
      "--state-json", JSON.stringify({
        title: "Agent generated",
        subtitle: "Rendered from CLI",
        bgMode: "solid",
        solid: "#123456",
        rotation: { x: -0.16, y: 0.24 },
        phoneOffset: { x: 36, y: -20 },
        phoneScale: 1.04
      })
    ], { cwd: process.cwd(), timeout: 30000 });

    const png = await readFile(output);
    expect(png.toString("ascii", 1, 4)).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1290);
    expect(png.readUInt32BE(20)).toBe(2796);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
