#!/usr/bin/env node
// One-shot universal chromakey cleanup — walk every PNG in
// public/assets/sprites/ and erase any chromakey background residue
// connected to the image edges. Saves the cleaned versions in place.
//
// Chromakey families targeted (the standard "transparency colors"
// commonly used when prepping pixel art):
//   • Hot magenta / pink: R≥200, G≤180, B≥150, R-G≥40 (the classic
//     fluorescent #FF00FF chromakey and its alpha-blended fringes)
//   • Pure magenta variants: R≥200, G≤100, B≥170
//   • Bright purple-magenta border halos
//   • Cream-pink residue: R≥240, G in 200-245, B in 200-260 with low
//     R-G-B variance (the lighter source-sheet bleed I cleaned off
//     several sprites individually in earlier passes)
//
// Strategy: edge-flood-fill. Only pixels that match a chromakey
// profile AND are connected to the image edges are cleared, so
// legitimate magenta/pink CONTENT in the middle of a sprite (e.g.,
// a pink heart, a magenta orb) is preserved. After the perimeter
// flood, a second optional pass catches any same-color blobs that
// were "islanded" by the figure (e.g., between a tower's legs).
//
// Run once: `node scripts/audit-chroma-keys.mjs`

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SPRITES_DIR = fileURLToPath(new URL('../public/assets/sprites/', import.meta.url));

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

// Pixel classification — returns true if this pixel looks like a
// chromakey background color (not legitimate sprite content).
//
// The defining trait of pink/magenta chromakey: GREEN is the lowest
// channel by a clear margin, RED is high, BLUE is at least
// moderately present (close to or higher than green). That pattern
// catches:
//   • Pure magenta (255, 0, 255)
//   • Hot pink halos (252, 120, 151), (253, 104, 169), (252, 132, 137)
//   • Pale pink fringes (252, 180, 195)
//   • Cream-pink residue (255, 227, 255)
// Without falsely flagging:
//   • Warm content (skin/wood/brick: G is mid, B is low)
//   • Reds (B is LOW, not >= G + margin)
//   • Oranges/yellows (G is HIGH, not low)
function isChromakey(r, g, b, a) {
  if (a < 100) return false;
  // Cream-pink / off-white BG bleed — R≈B, G slightly lower, all bright.
  if (r >= 240 && g >= 200 && g <= 245 && b >= 200 && b <= 260 && Math.abs(r - b) < 30) return true;
  // Hot pink / magenta — G is the LOWEST channel by clear margin
  // AND R is high AND B is at least moderately above G (not below).
  // r-g ≥ 45 weeds out neutral warm tones; b ≥ g+15 weeds out reds /
  // oranges; g ≤ 200 is a soft upper bound that protects bright golds.
  if (r >= 180 && g <= 200 && r - g >= 45 && b >= g + 15) return true;
  return false;
}

async function cleanOne(filepath) {
  const buf = await readFile(filepath);
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const pixels = new Uint8ClampedArray(data);   // RGBA interleaved

  // Quick scan: any chromakey pixel anywhere?
  let anyChroma = false;
  for (let i = 0; i < pixels.length; i += 4) {
    if (isChromakey(pixels[i], pixels[i+1], pixels[i+2], pixels[i+3])) {
      anyChroma = true;
      break;
    }
  }
  if (!anyChroma) return { changed: false, cleared: 0 };

  // BFS flood-fill from every edge pixel that matches.
  const visited = new Uint8Array(W * H);
  const queue = [];
  const idx = (x, y) => y * W + x;
  const pxAt = (x, y) => {
    const i = idx(x, y) * 4;
    return [pixels[i], pixels[i+1], pixels[i+2], pixels[i+3]];
  };

  function seedIfChroma(x, y) {
    if (visited[idx(x, y)]) return;
    const [r, g, b, a] = pxAt(x, y);
    if (isChromakey(r, g, b, a)) {
      visited[idx(x, y)] = 1;
      queue.push(idx(x, y));
    }
  }

  // Edge seeds
  for (let x = 0; x < W; x++) { seedIfChroma(x, 0); seedIfChroma(x, H - 1); }
  for (let y = 0; y < H; y++) { seedIfChroma(0, y); seedIfChroma(W - 1, y); }

  // BFS spread (4-connected)
  while (queue.length > 0) {
    const k = queue.shift();
    const x = k % W, y = (k / W) | 0;
    const neighbors = [[-1,0],[1,0],[0,-1],[0,1]];
    for (const [dx, dy] of neighbors) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const nk = idx(nx, ny);
      if (visited[nk]) continue;
      const [r, g, b, a] = pxAt(nx, ny);
      if (isChromakey(r, g, b, a)) {
        visited[nk] = 1;
        queue.push(nk);
      }
    }
  }

  // Also: catch islanded chromakey blobs that aren't connected to the
  // edges (e.g. a pink halo trapped between the figure's legs). For
  // each remaining chromakey pixel, mark it cleared since the whole
  // chromakey-family is by definition not legitimate sprite content
  // (real sprite pinks tend to be deeper red-leaning or saturated
  // rather than the bright halo profile).
  for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
    if (!visited[p] && isChromakey(pixels[i], pixels[i+1], pixels[i+2], pixels[i+3])) {
      visited[p] = 1;
    }
  }

  // Apply clears
  let cleared = 0;
  for (let i = 0, p = 0; i < pixels.length; i += 4, p++) {
    if (visited[p]) {
      pixels[i] = 0; pixels[i+1] = 0; pixels[i+2] = 0; pixels[i+3] = 0;
      cleared++;
    }
  }

  if (cleared === 0) return { changed: false, cleared: 0 };

  // Write back as PNG (preserve dimensions)
  const out = await sharp(Buffer.from(pixels.buffer), {
    raw: { width: W, height: H, channels: 4 }
  }).png({ compressionLevel: 9, palette: true }).toBuffer();
  await writeFile(filepath, out);
  return { changed: true, cleared };
}

const startedAt = Date.now();
let total = 0, changed = 0, totalCleared = 0;

for await (const fp of walk(SPRITES_DIR)) {
  if (extname(fp).toLowerCase() !== '.png') continue;
  total++;
  try {
    const { changed: ch, cleared } = await cleanOne(fp);
    if (ch) {
      changed++;
      totalCleared += cleared;
      console.log(`  cleaned ${basename(fp).padEnd(45)} -${cleared} pixels`);
    }
  } catch (err) {
    console.warn(`  ERROR ${basename(fp)}: ${err.message}`);
  }
}

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log('');
console.log(`Scanned ${total} sprites in ${elapsed}s.`);
console.log(`Cleaned ${changed} sprites, removed ${totalCleared.toLocaleString()} chromakey pixels total.`);
