// One-off cleanup for t_new_evocatus.png — the source sheet leaked
// chromakey residue: a salmon-pink rectangle floating above the head
// (~210, 154, 130) and a strip of pure-magenta noise (~105, 8, 103).
// Both are obviously not part of the legionary figure. Strategy:
// classify each pixel; if it matches the residue color profile and
// it isn't inside the figure's silhouette, zero its alpha.
//
// The figure itself has warm bronze armor, gray/silver helmet/sword,
// red cape, light skin. None of those overlap with the salmon-pink
// or pure-magenta colors so a per-pixel color test is safe (no
// flood-fill needed). After the alpha mask, palette-recompress.

import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..', 'public', 'assets', 'sprites', 't_new_evocatus.png');

// The "salmon-pink rectangle" is actually a semi-transparent dark-red
// band at the top of the sheet. The actual pixel color is roughly
// (175, 35, 35) at alpha ~140 — which blends against white in the
// viewer to look pinkish, hence the original misdiagnosis. Pattern:
// R is dominant (150-200), G and B both very low (under 60), R - G
// gap is large (over 100). The figure's red cape is solid alpha=255
// and the chest cuirass red is closer to (180, 80, 60). Both of
// those have G or B well above 60 so they survive this filter.
function isRedChromaResidue(r, g, b, a) {
  if (g > 60 || b > 60) return false;
  if (r < 130 || r > 220) return false;
  if (r - g < 100 || r - b < 100) return false;
  // Crucial discriminator: the residue band is at alpha ~140 (semi-
  // transparent), the figure's red cape is at alpha 255 (solid). Same
  // RGB profile, different alpha. Kill only semi-transparent pixels.
  return a > 30 && a < 200;
}

// Pure-magenta chromakey: R 80-200, G 0-30, B 80-200. R≈B with very low G.
function isMagentaResidue(r, g, b) {
  if (g >= 40) return false;
  if (r < 60 || b < 60) return false;
  if (Math.abs(r - b) > 50) return false;
  return true;
}

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const out = Buffer.from(data);
let killed = 0;
for (let i = 0; i < data.length; i += 4) {
  const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
  if (a < 30) continue;
  if (isRedChromaResidue(r, g, b, a) || isMagentaResidue(r, g, b)) {
    out[i + 3] = 0;
    killed++;
  }
}
console.log('Pixels masked:', killed);

await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
  .png({
    palette: true,
    quality: 95,
    compressionLevel: 9,
    adaptiveFiltering: true,
    effort: 10
  })
  .toFile(SRC);
const final = await fs.stat(SRC);
console.log('Output: t_new_evocatus.png (' + (final.size / 1024).toFixed(1) + ' KB)');
