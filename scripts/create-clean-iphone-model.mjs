import { readFileSync, writeFileSync } from "node:fs";

const inputPath = "iphone-17-pro/source/iphone 17_4.glb";
const outputPath = "iphone-17-pro/source/iphone-17-pro-clean.glb";

const removeNodeNames = new Set([
  "Cylinder",
  "Cylinder.001",
  "Cylinder.002",
  "defaultMaterial.002",
  "defaultMaterial.006",
  "defaultMaterial.007",
  "defaultMaterial.010",
  "defaultMaterial.011",
  "defaultMaterial.015",
  "defaultMaterial.016",
  "defaultMaterial.018",
  "defaultMaterial.019",
  "defaultMaterial.022",
  "defaultMaterial.023"
]);

const input = readFileSync(inputPath);
if (input.toString("utf8", 0, 4) !== "glTF") {
  throw new Error(`${inputPath} is not a binary glTF file`);
}

const version = input.readUInt32LE(4);
if (version !== 2) {
  throw new Error(`Unsupported GLB version ${version}`);
}

let offset = 12;
let jsonChunk = null;
let binaryChunk = null;

while (offset < input.length) {
  const length = input.readUInt32LE(offset);
  const type = input.toString("utf8", offset + 4, offset + 8);
  const start = offset + 8;
  const end = start + length;

  if (type === "JSON") {
    jsonChunk = JSON.parse(input.toString("utf8", start, end).trim());
  } else if (type === "BIN\u0000") {
    binaryChunk = input.subarray(start, end);
  }

  offset = end;
}

if (!jsonChunk || !binaryChunk) {
  throw new Error("Expected JSON and BIN chunks in GLB");
}

const removeNodeIndexes = new Set();
jsonChunk.nodes.forEach((node, index) => {
  if (removeNodeNames.has(node.name)) removeNodeIndexes.add(index);
});

jsonChunk.nodes.forEach((node) => {
  if (node.children) {
    node.children = node.children.filter((childIndex) => !removeNodeIndexes.has(childIndex));
  }
});
jsonChunk.scenes.forEach((scene) => {
  if (scene.nodes) {
    scene.nodes = scene.nodes.filter((nodeIndex) => !removeNodeIndexes.has(nodeIndex));
  }
});

jsonChunk.asset = {
  ...jsonChunk.asset,
  generator: "screenshot-maker clean model script"
};
jsonChunk.extras = {
  ...(jsonChunk.extras || {}),
  removedNodes: [...removeNodeNames].sort()
};

const jsonText = JSON.stringify(jsonChunk);
const jsonPadding = (4 - (Buffer.byteLength(jsonText) % 4)) % 4;
const jsonBuffer = Buffer.from(jsonText + " ".repeat(jsonPadding), "utf8");
const binaryPadding = (4 - (binaryChunk.length % 4)) % 4;
const binaryBuffer = binaryPadding
  ? Buffer.concat([binaryChunk, Buffer.alloc(binaryPadding)])
  : Buffer.from(binaryChunk);

const totalLength = 12 + 8 + jsonBuffer.length + 8 + binaryBuffer.length;
const output = Buffer.alloc(12);
output.write("glTF", 0, "utf8");
output.writeUInt32LE(2, 4);
output.writeUInt32LE(totalLength, 8);

const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(jsonBuffer.length, 0);
jsonHeader.write("JSON", 4, "utf8");

const binaryHeader = Buffer.alloc(8);
binaryHeader.writeUInt32LE(binaryBuffer.length, 0);
binaryHeader.write("BIN\u0000", 4, "utf8");

writeFileSync(outputPath, Buffer.concat([output, jsonHeader, jsonBuffer, binaryHeader, binaryBuffer]));
console.log(`Wrote ${outputPath}`);
console.log(`Removed ${removeNodeIndexes.size} nodes: ${[...removeNodeIndexes].map((i) => jsonChunk.nodes[i].name).join(", ")}`);
