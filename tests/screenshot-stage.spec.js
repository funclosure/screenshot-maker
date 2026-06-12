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

  await expect.poll(() => page.evaluate(() => window.__phoneRenderRequest)).toMatchObject({
    width: 1290,
    height: 1479
  });
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
