// ─────────────────────────────────────────────────────────────────────
// cropSheet.ts — Slice a Higgsfield sprite-sheet into per-cell PNGs.
//
// 2026-05-21 — Visual overhaul tooling. Sprite-sheet batching reduces
// Higgsfield generation calls by ~8× (109 → ~18) at the cost of needing
// to slice the sheet into individual cell sprites post-generation.
//
// This is a small Node CLI (uses `sharp` already in package.json) that
// takes an arbitrary grid layout, slices, and writes per-cell PNGs.
// Unlike tools/slice_sprite_sheet.py (3×3 magenta-keyed, sprite-specific)
// this works for any rows/cols and assumes the Higgsfield output is
// already transparent (we prompt for transparent backgrounds, not
// magenta backdrops, for map assets).
//
// Usage:
//   npx tsx tools/cropSheet.ts <input.png> <output_dir> <rows>x<cols> <name_prefix> [--inset N]
//
// Example:
//   npx tsx tools/cropSheet.ts maps_raw/path_sunny_sheet.png \
//       public/assets/map 4x4 path_sunny
//
//   → writes path_sunny_0.png ... path_sunny_15.png (top-left first,
//     row-major: cells [0,0], [0,1], [0,2], [0,3], [1,0], [1,1], ...)
//
// Optional --inset N (default 4) strips N pixels from each cell border
// to kill any grid-line artifacts from the Higgsfield generation.
// ─────────────────────────────────────────────────────────────────────
//
// Run with: npx tsx tools/cropSheet.ts ...

import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';

interface Args {
  input: string;
  outputDir: string;
  rows: number;
  cols: number;
  prefix: string;
  inset: number;
}

function parseArgs(argv: string[]): Args {
  if (argv.length < 4) {
    console.error('Usage: cropSheet <input.png> <output_dir> <rows>x<cols> <name_prefix> [--inset N]');
    console.error('Example: cropSheet maps_raw/path_sunny.png public/assets/map 4x4 path_sunny');
    process.exit(1);
  }
  const [input, outputDir, gridSpec, prefix] = argv;
  const m = gridSpec.match(/^(\d+)x(\d+)$/);
  if (!m) {
    console.error(`Bad grid spec "${gridSpec}". Expected NxM (e.g. 4x4, 3x3, 4x3).`);
    process.exit(1);
  }
  const rows = parseInt(m[1], 10);
  const cols = parseInt(m[2], 10);
  let inset = 4;
  const insetIdx = argv.indexOf('--inset');
  if (insetIdx >= 0 && argv[insetIdx + 1]) {
    inset = parseInt(argv[insetIdx + 1], 10);
    if (isNaN(inset) || inset < 0) inset = 0;
  }
  return { input, outputDir, rows, cols, prefix, inset };
}

async function cropSheet(args: Args): Promise<void> {
  // Read input
  const buffer = await fs.readFile(args.input);
  const meta = await sharp(buffer).metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`Could not read dimensions from ${args.input}`);
  }
  const sheetW = meta.width;
  const sheetH = meta.height;
  const cellW = Math.floor(sheetW / args.cols);
  const cellH = Math.floor(sheetH / args.rows);
  console.log(`Sheet: ${sheetW}×${sheetH}, grid ${args.rows}×${args.cols} → cells ${cellW}×${cellH}, inset ${args.inset}px`);

  // Ensure output dir
  await fs.mkdir(args.outputDir, { recursive: true });

  // Slice each cell row-major (top-left first). The cell index reads
  // 0..(rows*cols-1) so callers can map cell index → asset name 1:1
  // with their sheet layout description in MAP_OVERHAUL_PROMPTS.md.
  let idx = 0;
  for (let r = 0; r < args.rows; r++) {
    for (let c = 0; c < args.cols; c++) {
      const left = c * cellW + args.inset;
      const top = r * cellH + args.inset;
      const width = cellW - args.inset * 2;
      const height = cellH - args.inset * 2;
      if (width <= 0 || height <= 0) {
        console.warn(`Cell ${idx} (${r},${c}) has non-positive size after inset — skipped.`);
        idx++;
        continue;
      }
      const outPath = path.join(args.outputDir, `${args.prefix}_${idx}.png`);
      await sharp(buffer)
        .extract({ left, top, width, height })
        // Ensure PNG output with alpha preserved
        .png({ compressionLevel: 9 })
        .toFile(outPath);
      console.log(`  cell ${idx} (row ${r}, col ${c}) → ${outPath}`);
      idx++;
    }
  }
  console.log(`Done. Wrote ${args.rows * args.cols} cells to ${args.outputDir}/`);
}

// Entry point
const args = parseArgs(process.argv.slice(2));
cropSheet(args).catch((err) => {
  console.error('cropSheet failed:', err);
  process.exit(1);
});
