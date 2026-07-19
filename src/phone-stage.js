import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const MODEL_URL = "/iphone-17-pro/source/iphone-17-pro-clean.glb";
const SCREEN_MATERIAL_NAME = "Screen_BG";
const SCREEN_GLASS_MATERIAL_NAME = "Screen_Glass";
const SCREEN_SOURCE_SIZE = { width: 1290, height: 2796 };
const MODEL_SCREEN_ASPECT = 1.9237 / 4.0158;
const DISPLAY_ASPECT = SCREEN_SOURCE_SIZE.width / SCREEN_SOURCE_SIZE.height;
const DISPLAY_RECT = makeCenteredDisplayRect(DISPLAY_ASPECT / MODEL_SCREEN_ASPECT);
// Screenshot plane: the screenshot is rendered on a dedicated plane instead of
// the model's Screen_BG mesh, so placement no longer depends on model UVs.
const SCREEN_PLANE_APERTURE_FIT = 0.972; // inset from Screen_BG bounds to the visible aperture
const SCREEN_PLANE_LIFT = 0.002;         // world-space lift above the Screen_BG surface, below island geometry
const SCREEN_CORNER_RADIUS = 0.115;      // display corner radius as a fraction of plane width
// Synthetic Dynamic Island drawn over the screenshot plane (real iPhone proportions).
const ISLAND_WIDTH_RATIO = 0.3;          // of plane width
const ISLAND_HEIGHT_RATIO = 0.0427;      // of plane height
const ISLAND_CENTER_Y_RATIO = 0.0341;    // island center below the plane top, of plane height
const DEFAULT_MODEL_APPEARANCE = {
  showFrontCamera: false,
  reflection: 0.08
};
// Device models per canvas family. Each clean GLB is portrait, centered,
// facing +Z, with its display material named Screen_BG.
const DEVICE_MODELS = {
  iphone: { url: MODEL_URL, island: true, screenCornerRadius: SCREEN_CORNER_RADIUS },
  ipad: { url: "/ipad-pro-13/source/ipad-pro-13-clean.glb", island: false, screenCornerRadius: 0.045 }
};
let currentScreenCornerRadius = SCREEN_CORNER_RADIUS;

let screenPlaneRig = null;

const canvas = document.getElementById("phoneCanvas");
const screenImg = document.getElementById("screenImg");
const shotFile = document.getElementById("shotFile");

if (canvas) {
  initPhoneStage().catch((error) => {
    console.warn("3D iPhone model failed to load; keeping CSS fallback.", error);
    canvas.dataset.modelReady = "false";
  });
}

async function initPhoneStage() {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  camera.position.set(0, 0.2, 22);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x2b2b31, 3.2));
  const key = new THREE.DirectionalLight(0xffffff, 3.5);
  key.position.set(4, 5, 8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xd9e8ff, 2.1);
  rim.position.set(-5, 3, -5);
  scene.add(rim);

  const group = new THREE.Group();
  scene.add(group);

  const loader = new GLTFLoader();
  const rotation = {
    x: THREE.MathUtils.degToRad(-8),
    y: THREE.MathUtils.degToRad(10),
    z: 0
  };
  const modelAppearance = { ...DEFAULT_MODEL_APPEARANCE };
  const stage = { renderer, scene, camera, group, model: null, rotation, modelAppearance, modelParts: null, resize };
  const deviceCache = new Map();
  let currentEntry = null;
  let currentDeviceKind = null;

  async function loadDevice(kind) {
    if (kind === currentDeviceKind) return;
    const config = DEVICE_MODELS[kind];
    if (!config) throw new Error(`Unknown device model: ${kind}`);
    canvas.dataset.modelReady = "false";
    document.body.classList.remove("model-ready");
    currentScreenCornerRadius = config.screenCornerRadius;
    let entry = deviceCache.get(kind);
    if (!entry) {
      const gltf = await loader.loadAsync(config.url);
      const model = gltf.scene;
      normalizeModel(model);
      applyScreenMaterials(model);
      group.add(model);
      // The rig's position is computed in world space and the mesh is added
      // to the (user-rotated) group, so level the group while measuring.
      const prevRotation = [group.rotation.x, group.rotation.y, group.rotation.z];
      group.rotation.set(0, 0, 0);
      group.updateMatrixWorld(true);
      const rig = createScreenPlane(model);
      rig.islandEnabled = config.island;
      rig.island.visible = config.island;
      group.rotation.set(prevRotation[0], prevRotation[1], prevRotation[2]);
      group.add(rig.mesh);
      entry = { model, rig, parts: collectModelParts(model) };
      deviceCache.set(kind, entry);
    } else {
      group.add(entry.model);
      group.add(entry.rig.mesh);
    }
    if (currentEntry && currentEntry !== entry) {
      group.remove(currentEntry.model);
      group.remove(currentEntry.rig.mesh);
    }
    currentEntry = entry;
    currentDeviceKind = kind;
    stage.model = entry.model;
    stage.modelParts = entry.parts;
    screenPlaneRig = entry.rig;
    applyModelAppearance(entry.parts, modelAppearance);
    if (screenImg && screenImg.src && screenImg.naturalWidth > 0) {
      updateScreenFromImage(screenImg);
    }
    canvas.dataset.modelReady = "true";
    document.body.classList.add("model-ready");
  }
  stage.loadDevice = loadDevice;

  await loadDevice("iphone");

  const drag = {
    active: false,
    lastX: 0,
    lastY: 0
  };

  setRotationDataset(rotation);
  exposePhoneApi(stage);

  canvas.addEventListener("pointerdown", (event) => {
    if (window.ScreenshotStage && window.ScreenshotStage.isPanningPhone && window.ScreenshotStage.isPanningPhone()) {
      return;
    }
    drag.active = true;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (window.ScreenshotStage && window.ScreenshotStage.isPanningPhone && window.ScreenshotStage.isPanningPhone()) {
      return;
    }
    if (!drag.active) return;
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;

    rotation.y = clamp(rotation.y + dx * 0.008, -0.65, 0.65);
    rotation.x = clamp(rotation.x + dy * 0.008, -0.55, 0.45);
    setRotationDataset(rotation);
  });

  function stopDrag(event) {
    drag.active = false;
    if (event && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  canvas.addEventListener("pointerup", stopDrag);
  canvas.addEventListener("pointercancel", stopDrag);

  if (shotFile) {
    shotFile.addEventListener("change", () => {
      // screenImg.src is set asynchronously by a FileReader callback, so wait
      // for the image to actually load before uploading it as a texture.
      screenImg.addEventListener(
        "load",
        () => requestAnimationFrame(() => updateScreenFromImage(screenImg)),
        { once: true }
      );
    });
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();
  animate();

  function animate() {
    group.rotation.x += (rotation.x - group.rotation.x) * 0.18;
    group.rotation.y += (rotation.y - group.rotation.y) * 0.18;
    group.rotation.z += (rotation.z - group.rotation.z) * 0.18;
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

function exposePhoneApi(stage) {
  window.ScreenshotStage = Object.assign(window.ScreenshotStage || {}, {
    debugModelNodes() {
      const nodes = [];
      stage.model.traverse((object) => {
  if (!object.isMesh) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        nodes.push({
          name: object.name,
          visible: object.visible,
          materials: materials.map((material) => material && material.name).filter(Boolean)
        });
      });
      return nodes;
    },
    debugSetNodeVisible(name, visible) {
      stage.model.traverse((object) => {
        if (object.name === name) object.visible = visible;
      });
    },
    getRotation() {
      return {
        x: Number(stage.rotation.x.toFixed(4)),
        y: Number(stage.rotation.y.toFixed(4)),
        z: Number(stage.rotation.z.toFixed(4))
      };
    },
    setRotation(next = {}) {
      if (typeof next.x === "number") stage.rotation.x = clamp(next.x, -0.55, 0.45);
      if (typeof next.y === "number") stage.rotation.y = clamp(next.y, -0.65, 0.65);
      if (typeof next.z === "number") stage.rotation.z = clamp(next.z, -0.8, 0.8);
      setRotationDataset(stage.rotation);
    },
    getDisplayRect() {
      return getDisplayRect();
    },
    async setDeviceModel(kind) {
      await stage.loadDevice(kind);
      return kind;
    },
    getScreenPlaneInfo() {
      if (!screenPlaneRig) return null;
      const island = screenPlaneRig.island;
      const islandPositions = island.geometry.getAttribute("position");
      return {
        aspect: Number(screenPlaneRig.aspect.toFixed(4)),
        width: Number(screenPlaneRig.mesh.scale.x.toFixed(4)),
        height: Number(screenPlaneRig.mesh.scale.y.toFixed(4)),
        z: Number(screenPlaneRig.mesh.position.z.toFixed(4)),
        aperture: {
          width: Number(screenPlaneRig.aperture.width.toFixed(4)),
          height: Number(screenPlaneRig.aperture.height.toFixed(4))
        },
        island: {
          visible: island.visible,
          vertexCount: islandPositions ? islandPositions.count : 0,
          localY: Number(island.position.y.toFixed(4)),
          renderOrder: island.renderOrder
        }
      };
    },
    getModelAppearance() {
      return {
        showFrontCamera: stage.modelAppearance.showFrontCamera,
        reflection: Number(stage.modelAppearance.reflection.toFixed(3))
      };
    },
    setModelAppearance(next = {}) {
      if (typeof next.showFrontCamera === "boolean") {
        stage.modelAppearance.showFrontCamera = next.showFrontCamera;
      }
      if (typeof next.reflection === "number") {
        stage.modelAppearance.reflection = clamp(next.reflection, 0, 1);
      }
      applyModelAppearance(stage.modelParts, stage.modelAppearance);
      return window.ScreenshotStage.getModelAppearance();
    },
    async renderPhone({ width, height } = {}) {
      const renderWidth = Math.max(1, Math.round(width || canvas.width));
      const renderHeight = Math.max(1, Math.round(height || canvas.height));
      const output = document.createElement("canvas");
      output.width = renderWidth;
      output.height = renderHeight;

      stage.renderer.setPixelRatio(1);
      stage.renderer.setSize(renderWidth, renderHeight, false);
      stage.camera.aspect = renderWidth / renderHeight;
      stage.camera.updateProjectionMatrix();

      const previousX = stage.group.rotation.x;
      const previousY = stage.group.rotation.y;
      const previousZ = stage.group.rotation.z;
      stage.group.rotation.x = stage.rotation.x;
      stage.group.rotation.y = stage.rotation.y;
      stage.group.rotation.z = stage.rotation.z;
      stage.renderer.render(stage.scene, stage.camera);

      output.getContext("2d").drawImage(canvas, 0, 0, renderWidth, renderHeight);

      stage.group.rotation.x = previousX;
      stage.group.rotation.y = previousY;
      stage.group.rotation.z = previousZ;
      stage.resize();
      stage.renderer.render(stage.scene, stage.camera);

      return output;
    }
  });
}

function collectModelParts(model) {
  model.updateMatrixWorld(true);
  const parts = {
    screenGlassMaterials: [],
    frontCameraObjects: [],
    islandObjects: [],
    screenRimObjects: []
  };

  model.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const materialNames = materials.map((material) => material && material.name).filter(Boolean);

    materials.forEach((material) => {
      if (material && material.name === SCREEN_GLASS_MATERIAL_NAME) {
        parts.screenGlassMaterials.push(material);
      }
    });

    if (isFrontCameraObject(object, materialNames)) {
      parts.frontCameraObjects.push(object);
    }
    if (object.name === "Plane003" || object.name === "Plane004") {
      parts.islandObjects.push(object);
    }
    if (object.name === "Plane006" || object.name === "Plane007") {
      parts.frontCameraObjects.push(object);
    }
    if (materialNames.includes("Screen_Rim")) {
      parts.screenRimObjects.push(object);
    }
  });

  return parts;
}

function isFrontCameraObject(object, materialNames) {
  return materialNames.some((name) => (
    name === "Camera_Pixel_Glass_002" ||
    name === "Camera_Pixel__002" ||
    name === "Glass_Camera_Logo" ||
    name === "Material.004"
  ));
}

function applyModelAppearance(parts, appearance) {
  parts.frontCameraObjects.forEach((object) => {
    object.visible = appearance.showFrontCamera;
  });

  parts.islandObjects.forEach((object) => {
    if (!object.userData.originalMaterial) {
      object.userData.originalMaterial = object.material;
    }
    if (!object.userData.matteIslandMaterial) {
      // depthTest off + late renderOrder so the island silhouette always paints
      // cleanly over the screenshot plane (their depths interleave otherwise).
      object.userData.matteIslandMaterial = new THREE.MeshBasicMaterial({
        color: 0x000000,
        toneMapped: false,
        depthTest: false
      });
    }
    const matte = !appearance.showFrontCamera;
    object.material = matte
      ? object.userData.matteIslandMaterial
      : object.userData.originalMaterial;
    object.renderOrder = matte ? 2 : 0;
    // In matte mode the synthetic DynamicIsland mesh provides the island;
    // hide the model's island planes so they don't double-paint over it.
    object.visible = !matte;
  });

  // The Screen_Rim mesh interleaves unpredictably with the screenshot plane
  // (its island cutout shows or hides depending on view); in matte mode the
  // synthetic island replaces it, so hide it for deterministic output.
  parts.screenRimObjects.forEach((object) => {
    object.visible = appearance.showFrontCamera;
  });

  parts.screenGlassMaterials.forEach((material) => {
    material.transparent = true;
    material.opacity = 0.12 + appearance.reflection * 0.35;
    material.roughness = 0.35 - appearance.reflection * 0.26;
    material.metalness = 0;
    material.needsUpdate = true;
  });
}

function normalizeModel(model) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);

  const longest = Math.max(size.x, size.y, size.z);
  if (longest > 0) model.scale.setScalar(10 / longest);

  model.rotation.set(0, 0, 0);
}

function applyScreenMaterials(model) {
  model.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material, index) => {
      if (!material) return;
      if (material.name === SCREEN_MATERIAL_NAME) {
        // The screenshot now lives on a dedicated plane; the model's own
        // screen mesh becomes a plain black backdrop behind it.
        const replacement = new THREE.MeshBasicMaterial({
          name: SCREEN_MATERIAL_NAME,
          color: 0x000000,
          toneMapped: false
        });
        setMaterial(object, index, replacement);
      }
      if (material.name === "Screen_Rim") {
        material.map = null;
        material.normalMap = null;
        material.roughnessMap = null;
        material.metalnessMap = null;
        material.envMap = null;
        if (material.color) material.color.set(0x000000);
        if (material.emissive) material.emissive.set(0x000000);
        material.transparent = false;
        material.opacity = 1;
        material.roughness = 1;
        material.metalness = 0;
        material.needsUpdate = true;
      }
      if (material.name === SCREEN_GLASS_MATERIAL_NAME) {
        material.transparent = true;
        material.opacity = 0.15;
        material.roughness = 0.32;
        material.metalness = 0;
      }
      if (material.name === "Plastic" || material.name === "Rim_Buttons" || material.name === "Grill_USB") {
        material.map = null;
        if (material.color) material.color.set(0x4b4b4e);
        material.metalness = 0.55;
        material.roughness = 0.42;
        material.needsUpdate = true;
      }
    });
  });
}

function createScreenPlane(model) {
  model.updateMatrixWorld(true);
  let screenMesh = null;
  model.traverse((object) => {
    if (screenMesh || !object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some((material) => material && material.name === SCREEN_MATERIAL_NAME)) {
      screenMesh = object;
    }
  });
  if (!screenMesh) throw new Error(`${SCREEN_MATERIAL_NAME} mesh not found in model`);

  // precise=true measures per-vertex: the iPad model's meshes carry a baked
  // straightening rotation, so corner-transformed local boxes would inflate.
  const box = new THREE.Box3().setFromObject(screenMesh, true);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const aperture = {
    width: size.x * SCREEN_PLANE_APERTURE_FIT,
    height: size.y * SCREEN_PLANE_APERTURE_FIT
  };

  const material = new THREE.MeshBasicMaterial({
    map: makePlaceholderTexture(),
    toneMapped: false,
    transparent: true
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.name = "ScreenshotPlane";
  mesh.position.set(center.x, center.y, box.max.z + SCREEN_PLANE_LIFT);

  // Note: keep depthTest enabled — in WebGL, disabling the depth test also
  // disables depth writes, which would let the transparent screenshot plane
  // paint over the island in the later transparent pass.
  const island = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false })
  );
  island.name = "DynamicIsland";
  island.renderOrder = 3;
  mesh.add(island);

  const rig = { mesh, island, aperture, aspect: DISPLAY_ASPECT };
  fitScreenPlane(rig, DISPLAY_ASPECT);
  return rig;
}

function fitScreenPlane(rig, aspect) {
  let height = rig.aperture.height;
  let width = height * aspect;
  if (width > rig.aperture.width) {
    const shrink = rig.aperture.width / width;
    width *= shrink;
    height *= shrink;
  }
  rig.mesh.scale.set(width, height, 1);
  rig.aspect = aspect;
  fitIsland(rig, width, height);
}

function fitIsland(rig, planeWidth, planeHeight) {
  // The island is a child of the (non-uniformly scaled) plane, so build its
  // capsule geometry in plane-local units to keep the round caps circular.
  const width = ISLAND_WIDTH_RATIO * planeWidth;
  const height = ISLAND_HEIGHT_RATIO * planeHeight;
  rig.island.geometry.dispose();
  rig.island.geometry = makeCapsuleGeometry(width / planeWidth, height / planeHeight, (height / 2) / planeWidth);
  rig.island.position.set(0, 0.5 - ISLAND_CENTER_Y_RATIO, 0.001);
  // Devices without a Dynamic Island (iPad) keep the synthetic island hidden.
  rig.island.visible = rig.islandEnabled !== false;
}

function makeCapsuleGeometry(width, height, radiusX) {
  // Capsule outline in a space where the parent plane is 1x1; radii differ per
  // axis because the parent scales x and y independently.
  const shape = new THREE.Shape();
  const rx = Math.min(radiusX, width / 2);
  const ry = height / 2;
  const segments = 24;
  const points = [];
  for (let i = 0; i <= segments; i += 1) {
    const a = -Math.PI / 2 + (i / segments) * Math.PI;
    points.push([width / 2 - rx + Math.cos(a) * rx, Math.sin(a) * ry]);
  }
  for (let i = 0; i <= segments; i += 1) {
    const a = Math.PI / 2 + (i / segments) * Math.PI;
    points.push([-width / 2 + rx + Math.cos(a) * rx, Math.sin(a) * ry]);
  }
  shape.moveTo(points[0][0], points[0][1]);
  points.slice(1).forEach(([x, y]) => shape.lineTo(x, y));
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function updateScreenFromImage(img) {
  if (!img || !img.src || !screenPlaneRig) return;
  const uploaded = new Image();
  uploaded.onload = () => {
    const material = screenPlaneRig.mesh.material;
    if (material.map && material.map.dispose) material.map.dispose();
    material.map = makePlaneTexture(uploaded);
    material.needsUpdate = true;
    fitScreenPlane(screenPlaneRig, uploaded.naturalWidth / uploaded.naturalHeight);
  };
  uploaded.src = img.src;
}

function makePlaceholderTexture() {
  const c = makeScreenSourceCanvas();
  const ctx = c.getContext("2d");
  roundCanvasClip(ctx, c);
  const g = ctx.createLinearGradient(0, 0, c.width, c.height);
  g.addColorStop(0, "#20242d");
  g.addColorStop(1, "#07080b");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = "#8b8a92";
  ctx.font = "600 84px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Upload a screenshot", c.width / 2, c.height / 2);

  return makeScreenTexture(c);
}

function makePlaneTexture(image) {
  const c = document.createElement("canvas");
  c.width = image.naturalWidth;
  c.height = image.naturalHeight;
  const ctx = c.getContext("2d");
  roundCanvasClip(ctx, c);
  ctx.drawImage(image, 0, 0, c.width, c.height);
  return makeScreenTexture(c);
}

function roundCanvasClip(ctx, c) {
  ctx.beginPath();
  roundedRectPath(ctx, 0, 0, c.width, c.height, c.width * currentScreenCornerRadius);
  ctx.clip();
}

function makeCenteredDisplayRect(width = 1) {
  const clampedWidth = clamp(width, 0.1, 1);
  return {
    x: (1 - clampedWidth) / 2,
    y: 0,
    width: clampedWidth,
    height: 1
  };
}

function getDisplayRect() {
  return {
    x: Number(DISPLAY_RECT.x.toFixed(4)),
    y: Number(DISPLAY_RECT.y.toFixed(4)),
    width: Number(DISPLAY_RECT.width.toFixed(4)),
    height: Number(DISPLAY_RECT.height.toFixed(4))
  };
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function makeScreenSourceCanvas() {
  const c = document.createElement("canvas");
  c.width = SCREEN_SOURCE_SIZE.width;
  c.height = SCREEN_SOURCE_SIZE.height;
  return c;
}

function makeScreenTexture(source) {
  const texture = new THREE.CanvasTexture(source);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function setMaterial(object, index, material) {
  if (Array.isArray(object.material)) {
    object.material[index] = material;
  } else {
    object.material = material;
  }
}

function setRotationDataset(rotation) {
  canvas.dataset.rotation = `${rotation.x.toFixed(4)},${rotation.y.toFixed(4)}`;
  window.dispatchEvent(new CustomEvent("screenshotstage:rotation", {
    detail: {
      x: rotation.x,
      y: rotation.y
    }
  }));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
