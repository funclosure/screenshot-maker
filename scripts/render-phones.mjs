// Renders transparent 3D phone PNGs for the Inkput App Store panels.
// Output goes to /tmp/phones; compose with Inkput/screenshots/compose-panels.py.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const SHOTS = "/Users/victor/Documents/Workspace/Projects/Inkput/screenshots";
const OUT = "/tmp/phones";
const panels = [
  ["iphone-01-writing-curl.png",      "phone-01.png", { x: -0.05, y: 0.14,  z: -0.07 }],
  ["iphone-02-carousel.png",          "phone-02.png", { x: -0.05, y: -0.18, z: 0.07 }],
  ["iphone-03b-gratitude-prompts.png","phone-03.png", { x: -0.06, y: 0.16,  z: 0.06 }],
  ["iphone-04b-capsule-seal.png",     "phone-04.png", { x: -0.04, y: -0.13, z: -0.055 }],
  ["iphone-05-calendar.png",          "phone-05.png", { x: -0.05, y: 0.16,  z: 0.055 }],
  ["iphone-06-customize.png",         "phone-06.png", { x: -0.05, y: -0.18, z: -0.07 }]
];

mkdirSync(OUT, { recursive: true });
const child = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", "5199"], { cwd: process.cwd(), stdio: "ignore" });
await new Promise(r => setTimeout(r, 3000));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto("http://127.0.0.1:5199/screenshot-stage.html");
await page.waitForFunction(() => document.getElementById("phoneCanvas")?.dataset.modelReady === "true");

for (const [capture, out, rot] of panels) {
  await page.locator("#shotFile").setInputFiles(`${SHOTS}/${capture}`);
  await page.waitForTimeout(900);
  await page.evaluate((r) => window.ScreenshotStage.setRotation(r), rot);
  await page.waitForTimeout(300);
  const dataUrl = await page.evaluate(async () => {
    const c = await window.ScreenshotStage.renderPhone({ width: 2300, height: 2400 });
    return c.toDataURL("image/png");
  });
  writeFileSync(`${OUT}/${out}`, Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log(out);
}
await browser.close();
child.kill();
