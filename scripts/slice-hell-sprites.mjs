// One-off slicer for the Hell gate + Fire Giant sprite drop.
// Source: ../sprites/Hell/ (two PNGs the user dropped 2026-05-17).
//   1) Gate single sprite (1364×1180, black BG, demonic stone arch).
//   2) Fire-giant 3×3 grid (1761×1837, black BG, 9 demon variants).
//
// Process:
//   • Remove the black/near-black background → alpha (flood-fill style
//     threshold: any pixel where max(R,G,B) < 35 becomes transparent).
//   • Trim transparent border (sharp's .trim() with threshold).
//   • Resize the gate to a uniform max dimension matching peer enemy
//     sprites (~1333×1115).
//   • For the grid, slice cell (row=2, col=1) — the stone-bodied
//     lava-cracked giant. Bulky silhouette reads best at game size.
//   • Compress with palette mode for ~80% file-size win.
//
// Output:
//   public/assets/sprites/e3_hell_gate.png
//   public/assets/sprites/e3_fire_giant.png

import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(__dirname, '..');
const SRC_DIR = path.resolve(PROJECT, '..', '..', '..', 'Rome TD VF', 'sprites', 'Hell');
const OUT = path.resolve(PROJECT, 'public', 'assets', 'sprites');

const GATE_SRC = path.join(SRC_DIR, 'Untitled Project - illustrationImage.png');
const GIANT_GRID_SRC = path.join(SRC_DIR, 'Untitled Project - illustrationImage (1).png');

// Detect near-black pixel for background removal. The user's source PNGs
// have pixel-pure (0,0,0) background, so we use a max-channel check at
// threshold 12 — this catches pure black + any zlib compression noise
// without eating the dark-iron / dark-stone interior pixels (which have
// at least one channel in the 15-40 range) and without eating
// anti-aliasing fringe pixels at the sprite's silhouette (typically
// max-channel 20+ where the dark color blends to the warm content).
function isBackground(r, g, b) {
  return Math.max(r, g, b) < 12;
}

// Edge-flood-fill: returns a Set of pixel indices that are connected to
// the image's outer edge AND classify as background. Pixels with the
// same color in the interior (dark iron, dark stone, demon shadows)
// stay opaque. Mirrors the strategy in audit-chroma-keys.mjs.
function floodFillFromEdges(data, width, height) {
  const visited = new Uint8Array(width * height);
  const queue = [];
  const idx = (x, y) => y * width + x;
  // Seed from every edge pixel that classifies as background.
  for (let x = 0; x < width; x++) {
    for (const y of [0, height - 1]) {
      const i = idx(x, y);
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      if (isBackground(r, g, b) && !visited[i]) { visited[i] = 1; queue.push(i); }
    }
  }
  for (let y = 0; y < height; y++) {
    for (const x of [0, width - 1]) {
      const i = idx(x, y);
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      if (isBackground(r, g, b) && !visited[i]) { visited[i] = 1; queue.push(i); }
    }
  }
  // BFS — expand to any neighbor that also classifies as background.
  while (queue.length) {
    const i = queue.shift();
    const x = i % width, y = (i - x) / width;
    const neighbors = [
      [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const ni = idx(nx, ny);
      if (visited[ni]) continue;
      const r = data[ni * 4], g = data[ni * 4 + 1], b = data[ni * 4 + 2];
      if (!isBackground(r, g, b)) continue;
      visited[ni] = 1;
      queue.push(ni);
    }
  }
  return visited;
}

async function blackBgToAlpha(input) {
  // Read raw RGBA pixels, flood-fill from the image edges to identify
  // background pixels, then zero their alpha. Interior dark-iron and
  // dark-stone pixels (which would otherwise match the threshold)
  // survive because they're not connected to the edge. Returns a PNG
  // buffer for downstream chain operations.
  const img = sharp(input).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const mask = floodFillFromEdges(data, info.width, info.height);
  const out = Buffer.from(data);
  for (let p = 0; p < mask.length; p++) {
    if (mask[p]) out[p * 4 + 3] = 0;
  }
  return await sharp(out, {
    raw: { width: info.width, height: info.height, channels: 4 }
  }).png().toBuffer();
}

async function processGate() {
  console.log('Processing Hell Gate...');
  const meta = await sharp(GATE_SRC).metadata();
  console.log(`  Source: ${meta.width}×${meta.height}`);
  const transparentBuf = await blackBgToAlpha(GATE_SRC);
  // Trim transparent border so the gate's centroid sits at the sprite
  // center (matters when the renderer anchors to (0.5, 1.0)).
  const trimmed = await sharp(transparentBuf)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 4 })
    .toBuffer();
  const trimMeta = await sharp(trimmed).metadata();
  console.log(`  Trimmed: ${trimMeta.width}×${trimMeta.height}`);
  // Resize so the longer edge maxes out at ~800px (matches peer enemy
  // sprites — daemon_imperator is 1333×1115 but in-game renders at
  // GRID.TILE * 2-3 ≈ 64-96px, so 800px is more than enough resolution
  // and keeps the file size down).
  const MAX_EDGE = 800;
  const resizeOpts = trimMeta.width >= trimMeta.height
    ? { width: MAX_EDGE }
    : { height: MAX_EDGE };
  // Compress to palette PNG. With ≤256 colors palette mode is near-
  // lossless and shrinks the file 70-90% vs RGBA.
  await sharp(trimmed)
    .resize(resizeOpts)
    .png({
      palette: true,
      quality: 90,
      colors: 128,           // tighter palette for further size shrink
      compressionLevel: 9,
      adaptiveFiltering: true,
      effort: 10
    })
    .toFile(path.join(OUT, 'e3_hell_gate.png'));
  const final = await fs.stat(path.join(OUT, 'e3_hell_gate.png'));
  console.log(`  Output: e3_hell_gate.png (${(final.size / 1024).toFixed(1)} KB)`);
}

async function processGiant() {
  console.log('Processing Fire Giant (cell 0,1 from 3×3 grid)...');
  const meta = await sharp(GIANT_GRID_SRC).metadata();
  console.log(`  Grid source: ${meta.width}×${meta.height}`);
  // 3×3 grid. We want cell (row=0, col=1) — the tall horned demon with
  // the flaming mace. Best "fire giant warrior" silhouette in the sheet:
  // big horns, flames crowning the head, war hammer/mace in fist.
  // (User can swap to a different cell later by re-running this script
  //  with different row/col constants.)
  const cellW = Math.floor(meta.width / 3);
  const cellH = Math.floor(meta.height / 3);
  const row = 0, col = 1;
  const left = col * cellW;
  const top = row * cellH;
  console.log(`  Cell (${row},${col}): ${left},${top} ${cellW}×${cellH}`);
  // Extract the cell as raw RGBA, then flood-fill from the edges to
  // mask out the black background while preserving dark interior
  // pixels (armor shadows, weapon shaft, etc.).
  const cellRaw = await sharp(GIANT_GRID_SRC)
    .extract({ left, top, width: cellW, height: cellH })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const buf = Buffer.from(cellRaw.data);
  const mask = floodFillFromEdges(buf, cellRaw.info.width, cellRaw.info.height);
  for (let p = 0; p < mask.length; p++) {
    if (mask[p]) buf[p * 4 + 3] = 0;
  }
  // PNG-encode the alpha-masked raw bytes first so the trim step has a
  // known-good format to decode from.
  const cellPng = await sharp(buf, {
    raw: { width: cellRaw.info.width, height: cellRaw.info.height, channels: 4 }
  }).png().toBuffer();
  const trimmed = await sharp(cellPng)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 4 })
    .toBuffer();
  const trimMeta = await sharp(trimmed).metadata();
  console.log(`  Trimmed: ${trimMeta.width}×${trimMeta.height}`);
  // Resize so the longer edge maxes out at ~500px — fire giant only
  // renders at ~64-80px in game, smaller source dimension keeps the
  // file under 100 KB without visible quality loss.
  const MAX_EDGE = 500;
  const resizeOpts = trimMeta.width >= trimMeta.height
    ? { width: MAX_EDGE }
    : { height: MAX_EDGE };
  await sharp(trimmed)
    .resize(resizeOpts)
    .png({
      palette: true,
      quality: 90,
      colors: 128,
      compressionLevel: 9,
      adaptiveFiltering: true,
      effort: 10
    })
    .toFile(path.join(OUT, 'e3_fire_giant.png'));
  const final = await fs.stat(path.join(OUT, 'e3_fire_giant.png'));
  console.log(`  Output: e3_fire_giant.png (${(final.size / 1024).toFixed(1)} KB)`);
}

await processGate();
await processGiant();
console.log('Done.');
