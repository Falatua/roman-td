#!/usr/bin/env node
// One-shot sprite compressor — run via `node scripts/compress-sprites.mjs`.
//
// Walks public/assets/sprites/ and rewrites every PNG in-place using
// sharp's palette + adaptive-quantization mode. Game sprites typically
// have ≤256 distinct colors, so palette mode is effectively LOSSLESS
// while shrinking the file 70-90%. The few sprites that have more
// colors get adaptive quantization which is visually identical at the
// 48×48 in-game render size.
//
// The build/dist folder gets these compressed versions automatically on
// the next `npm run build` because Vite copies from public/ verbatim.
//
// Originals are stored in git history if anything looks off after a
// pass — `git checkout HEAD~1 -- public/assets/sprites/foo.png` brings
// any single file back.
//
// Safety:
//   • Compares before/after byte counts. If sharp's output is LARGER
//     than the original (rare but possible for already-tiny files),
//     keep the original.
//   • Preserves the alpha channel (essential for transparent sprites).
//   • Skips non-PNG files in case the folder grows in scope later.

import { readdir, stat, readFile, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// fileURLToPath decodes URL-encoded spaces (`%20` → ` `) so the script
// works regardless of where the project lives on disk.
const SPRITES_DIR = fileURLToPath(new URL('../public/assets/sprites/', import.meta.url));

// Walk recursively to handle the loading/ + sfx/ subfolders (the script
// only touches PNGs so non-image folders are untouched).
async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

const TARGET_EXT = new Set(['.png']);

const opts = {
  // Palette mode — uses indexed PNG with adaptive quantization. Lossless
  // when ≤256 unique colors; near-lossless otherwise. The compression
  // ratio is huge (often 80%+ for game art) because game sprites are
  // limited-palette by nature.
  palette: true,
  quality: 95,
  // Maximum zlib compression — slower at encode but smaller output.
  // Encode happens once during this script; decode is the same speed
  // regardless of compressionLevel, so cranking it costs nothing at
  // runtime.
  compressionLevel: 9,
  // Adaptive filtering picks the best PNG filter per scanline. Costs
  // ~10% encode time, saves ~5-15% on output size.
  adaptiveFiltering: true
};

let totalBefore = 0;
let totalAfter = 0;
let filesProcessed = 0;
let filesSkipped = 0;

const startedAt = Date.now();

for await (const file of walk(SPRITES_DIR)) {
  if (!TARGET_EXT.has(extname(file).toLowerCase())) continue;
  const before = (await stat(file)).size;
  const buf = await readFile(file);
  let compressed;
  try {
    compressed = await sharp(buf).png(opts).toBuffer();
  } catch (err) {
    console.warn(`✗ ${file}: ${err.message}`);
    filesSkipped++;
    continue;
  }
  // Only overwrite if the new file is actually smaller.
  if (compressed.length < before) {
    await writeFile(file, compressed);
    totalBefore += before;
    totalAfter += compressed.length;
    filesProcessed++;
    const pct = Math.round((1 - compressed.length / before) * 100);
    if (pct >= 50 || before > 500_000) {
      console.log(`  ${file.split('/').pop().padEnd(40)} ${(before/1024).toFixed(0).padStart(6)} KB → ${(compressed.length/1024).toFixed(0).padStart(6)} KB  (-${pct}%)`);
    }
  } else {
    filesSkipped++;
  }
}

const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
const beforeMB = (totalBefore / 1024 / 1024).toFixed(1);
const afterMB = (totalAfter / 1024 / 1024).toFixed(1);
const savedMB = ((totalBefore - totalAfter) / 1024 / 1024).toFixed(1);
const pct = totalBefore > 0 ? Math.round((1 - totalAfter / totalBefore) * 100) : 0;

console.log('');
console.log(`Done in ${elapsedSec}s. Compressed ${filesProcessed} sprites.`);
console.log(`Total: ${beforeMB} MB → ${afterMB} MB  (saved ${savedMB} MB, -${pct}%)`);
if (filesSkipped > 0) console.log(`Skipped ${filesSkipped} files (already optimal or unreadable).`);
