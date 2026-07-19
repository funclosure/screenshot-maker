#!/usr/bin/env node
// Extracts the standalone iPad from the raw Sketchfab GLB (which also carries
// an Apple Pencil and an empty Magic Keyboard pose), straightens it to
// portrait facing +Z, renames its display material to Screen_BG (the name
// phone-stage.js keys on), and re-exports a pruned GLB.
//
// The Sketchfab USDZ->GLB conversion scrambles every node/material name into
// a random hash, so the display mesh is identified geometrically: it is the
// large near-planar mesh whose smallest principal axis (the plane normal) is
// found by PCA over its vertices.
//
// Runs in Chromium via the Vite dev server because three's GLTFExporter needs
// browser APIs; that also prunes the dropped groups' textures automatically.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = process.argv[2] || "ipad-pro-13/source/ipad-pro-13-raw.glb";
const outputPath = process.argv[3] || "ipad-pro-13/source/ipad-pro-13-clean.glb";

if (!existsSync(path.resolve(repoRoot, inputPath))) {
  console.error(`Input model not found: ${inputPath}`);
  process.exit(1);
}

const PAGE_PATH = "tmp/.ipad-clean.html";
const PAGE_HTML = `<!doctype html>
<meta charset="utf-8">
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

try {
  const gltf = await new GLTFLoader().loadAsync(${JSON.stringify("/" + inputPath)});
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  // The iPad group is the USDRoot child with the most meshes.
  const usdRoot = root.getObjectByName("USDRoot");
  const groups = usdRoot.children.map((g) => {
    let meshCount = 0;
    g.traverse((o) => { if (o.isMesh) meshCount += 1; });
    return { g, meshCount };
  });
  groups.sort((a, b) => b.meshCount - a.meshCount);
  const ipad = groups[0].g;

  // The display quad, identified once by inspection of this exact raw file
  // (the Sketchfab hash names are stable because we commit the file):
  // 105-vertex rounded-rect quad exactly covering the active display area.
  const display = ipad.getObjectByName("EjCaatfcGdAQBho");
  if (!display) throw new Error("Display mesh EjCaatfcGdAQBho not found — raw file changed?");

  // PCA over the display's world-space vertices.
  display.updateMatrixWorld(true);
  const pos = display.geometry.getAttribute("position");
  const pts = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i).applyMatrix4(display.matrixWorld);
    pts.push(v.clone());
  }
  const centroid = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(pts.length);
  const cov = [[0,0,0],[0,0,0],[0,0,0]];
  for (const p of pts) {
    const d = p.clone().sub(centroid);
    const arr = [d.x, d.y, d.z];
    for (let r = 0; r < 3; r += 1) for (let c = 0; c < 3; c += 1) cov[r][c] += arr[r] * arr[c];
  }
  function eigenvector(matrix, deflate) {
    let vec = new THREE.Vector3(Math.random(), Math.random(), Math.random());
    for (let i = 0; i < 200; i += 1) {
      let next = new THREE.Vector3(
        matrix[0][0]*vec.x + matrix[0][1]*vec.y + matrix[0][2]*vec.z,
        matrix[1][0]*vec.x + matrix[1][1]*vec.y + matrix[1][2]*vec.z,
        matrix[2][0]*vec.x + matrix[2][1]*vec.y + matrix[2][2]*vec.z
      );
      for (const d of deflate) next.sub(d.clone().multiplyScalar(next.dot(d)));
      if (next.length() < 1e-12) break;
      vec = next.normalize();
    }
    return vec;
  }
  const longAxis = eigenvector(cov, []);            // screen's long edge
  const shortAxis = eigenvector(cov, [longAxis]);   // screen's short edge
  const normal = longAxis.clone().cross(shortAxis).normalize();

  // Point the normal away from the body (outward), long axis up.
  const bodyCenter = new THREE.Box3().setFromObject(ipad).getCenter(new THREE.Vector3());
  if (normal.dot(centroid.clone().sub(bodyCenter)) < 0) normal.negate();
  const yAxis = longAxis.clone();
  const xAxis = yAxis.clone().cross(normal).normalize();
  yAxis.crossVectors(normal, xAxis).normalize();

  // World-basis -> target-basis rotation (screen: x right, y up, z toward viewer).
  const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, normal);
  const wrapper = new THREE.Group();
  wrapper.name = "iPadPro13";
  const scene = new THREE.Scene();
  scene.add(wrapper);
  wrapper.attach(ipad);
  wrapper.quaternion.setFromRotationMatrix(basis.clone().transpose());
  wrapper.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(wrapper);
  wrapper.position.sub(box.getCenter(new THREE.Vector3()));
  wrapper.updateMatrixWorld(true);

  // Canonical names for phone-stage.js.
  display.material = display.material.clone();
  display.material.name = "Screen_BG";
  display.name = "ScreenBG";

  const finalBox = new THREE.Box3().setFromObject(wrapper);
  const finalSize = finalBox.getSize(new THREE.Vector3());
  const screenBox = new THREE.Box3().setFromObject(display);
  const screenSize = screenBox.getSize(new THREE.Vector3());

  const buffer = await new Promise((resolve, reject) =>
    new GLTFExporter().parse(scene, resolve, reject, { binary: true })
  );
  const bytes = new Uint8Array(buffer);
  let base64 = "";
  // Chunk length must be a multiple of 3 so per-chunk base64 concatenates
  // without mid-stream padding.
  for (let i = 0; i < bytes.length; i += 32766) {
    base64 += btoa(String.fromCharCode.apply(null, bytes.subarray(i, i + 32766)));
  }
  window.__cleanGlbBase64 = base64;
  window.__report = {
    displayMesh: display.name,
    bodySize: [finalSize.x, finalSize.y, finalSize.z].map((n) => +n.toFixed(4)),
    screenSize: [screenSize.x, screenSize.y, screenSize.z].map((n) => +n.toFixed(4)),
    screenAspect: +(screenSize.x / screenSize.y).toFixed(4),
    bodyAspect: +(finalSize.y / finalSize.x).toFixed(4)
  };
} catch (error) {
  window.__cleanError = error.message;
}
window.__done = true;
</script>`;

async function waitForServer(url, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  await mkdir(path.resolve(repoRoot, "tmp"), { recursive: true });
  await writeFile(path.resolve(repoRoot, PAGE_PATH), PAGE_HTML);

  const base = "http://127.0.0.1:5173";
  let vite = null;
  try {
    await waitForServer(`${base}/${PAGE_PATH}`, 1500);
  } catch {
    vite = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", "5173"], {
      cwd: repoRoot,
      stdio: "ignore"
    });
    await waitForServer(`${base}/${PAGE_PATH}`);
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => console.error("[page]", error.message));
    await page.goto(`${base}/${PAGE_PATH}`);
    await page.waitForFunction(() => window.__done === true, null, { timeout: 60000 });
    const cleanError = await page.evaluate(() => window.__cleanError || "");
    if (cleanError) throw new Error(`Clean failed in page: ${cleanError}`);
    const report = await page.evaluate(() => window.__report);
    const base64 = await page.evaluate(() => window.__cleanGlbBase64);
    await writeFile(path.resolve(repoRoot, outputPath), Buffer.from(base64, "base64"));
    const size = (await readFile(path.resolve(repoRoot, outputPath))).length;
    console.log(`${outputPath} (${(size / 1024 / 1024).toFixed(1)}MB)`);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
    if (vite) vite.kill("SIGTERM");
    await rm(path.resolve(repoRoot, PAGE_PATH), { force: true });
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
