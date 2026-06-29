#!/usr/bin/env node
import sharp from 'sharp';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SPRITES_DIR = join(ROOT, 'public/assets/sprites');
const OUT_DIR = join(SPRITES_DIR, 'attacks');
const FRAME = 128;
const FRAMES = 6;
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

const towers = JSON.parse(await readFile(join(ROOT, 'src/data/towers.json'), 'utf8'));
const assetsSource = await readFile(join(ROOT, 'src/render/Assets.ts'), 'utf8');
const manifest = {};
for (const match of assetsSource.matchAll(/\b([A-Z0-9_]+):\s*'([^']+)'/g)) {
  manifest[match[1]] = match[2];
}

const baseTowerIds = Object.entries(towers)
  .filter(([, def]) => def.kind === 'BASE' && !def.isHero)
  .map(([id]) => id);

const MELEE_FAST = new Set(['MILITES', 'AUXILIA', 'ACCENSUS', 'PUGIO_ASSASSIN', 'EVOCATUS', 'BEAST_HUNTER', 'BEAST_SLAYER']);
const SPEAR_MELEE = new Set(['HASTATI', 'TRIARIUS', 'LIBRITOR', 'RETIARIUS', 'CATAPHRACT']);
const COMMANDERS = new Set(['DECURION', 'CENTURION', 'PRIMUS_PILUS', 'OPTIO', 'PRAEFECTUS']);
const SIEGE = new Set(['SCORPIO', 'BALLISTARIUS', 'CARROBALLISTA', 'VULCAN_ENGINEER', 'COLOSSUS_ONAGER']);
const FIRE = new Set(['IGNIFER']);
const DIVINE = new Set(['LEGATE', 'FLAMEN', 'AUGUR', 'HARUSPEX', 'SOLAR_PRIEST']);
const ARCHERS = new Set(['SAGITTARIUS', 'VENATOR', 'AQUILA_VENATOR', 'ARCUBALLISTA']);
const THROWERS = new Set(['VELITES', 'RORARIUS', 'SPECULATOR', 'FUNDIBULUS']);

function familyFor(id, def) {
  if (FIRE.has(id) || def.damageType === 'ELEMENTAL_FIRE') return 'fire';
  if (DIVINE.has(id) || def.damageType === 'DIVINE') return 'divine';
  if (SIEGE.has(id) || def.damageType === 'SIEGE') return 'siege';
  if (ARCHERS.has(id)) return 'archer';
  if (THROWERS.has(id)) return 'thrower';
  if (SPEAR_MELEE.has(id)) return 'spear';
  if (COMMANDERS.has(id)) return 'command';
  if (MELEE_FAST.has(id) || def.melee) return 'melee';
  return 'thrower';
}

function svgOverlay(family, frame, tint) {
  const t = frame / (FRAMES - 1);
  const active = frame === 0 || frame === FRAMES - 1 ? 0 : 1;
  const power = active * (frame === 2 ? 1 : frame === 3 ? 0.72 : 0.42);
  const cx = FRAME / 2;
  const cy = FRAME / 2;
  const color = tint;
  let body = '';

  if (family === 'melee' || family === 'spear') {
    const arc = family === 'spear'
      ? `<line x1="38" y1="78" x2="105" y2="42" stroke="${color}" stroke-width="9" stroke-linecap="round" opacity="${0.25 * power}"/>
         <line x1="44" y1="75" x2="104" y2="43" stroke="#fff4d0" stroke-width="4" stroke-linecap="round" opacity="${0.78 * power}"/>
         <circle cx="106" cy="42" r="${4 + t * 5}" fill="#fff4d0" opacity="${0.60 * power}"/>`
      : `<path d="M34 48 C65 24 104 42 111 78" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="round" opacity="${0.22 * power}"/>
         <path d="M39 51 C67 32 96 45 105 77" fill="none" stroke="#fff4d0" stroke-width="5" stroke-linecap="round" opacity="${0.78 * power}"/>
         <path d="M49 63 C67 52 88 56 97 78" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" opacity="${0.92 * power}"/>`;
    body = `${arc}<circle cx="${cx}" cy="${cy + 6}" r="${38 + t * 3}" fill="${color}" opacity="${0.06 * power}"/>`;
  } else if (family === 'archer') {
    body = `<path d="M34 82 C58 44 88 36 111 47" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" opacity="${0.18 * power}"/>
            <path d="M39 79 C61 54 87 47 106 50" fill="none" stroke="#fff7d4" stroke-width="4" stroke-linecap="round" opacity="${0.75 * power}"/>
            <line x1="55" y1="74" x2="113" y2="45" stroke="#fff7d4" stroke-width="2.5" stroke-linecap="round" opacity="${0.85 * power}"/>
            <polygon points="113,45 121,41 117,50" fill="#fff7d4" opacity="${0.80 * power}"/>`;
  } else if (family === 'thrower' || family === 'command') {
    body = `<line x1="39" y1="81" x2="111" y2="45" stroke="${color}" stroke-width="9" stroke-linecap="round" opacity="${0.18 * power}"/>
            <line x1="47" y1="76" x2="108" y2="47" stroke="#ffe9ad" stroke-width="4" stroke-linecap="round" opacity="${0.82 * power}"/>
            <polygon points="109,47 120,41 115,53" fill="#ffe9ad" opacity="${0.86 * power}"/>
            <circle cx="${cx}" cy="${cy}" r="${32 + t * 4}" fill="${color}" opacity="${0.06 * power}"/>`;
  } else if (family === 'siege') {
    body = `<line x1="25" y1="72" x2="112" y2="50" stroke="#7a4a24" stroke-width="12" stroke-linecap="round" opacity="${0.22 * power}"/>
            <line x1="35" y1="69" x2="108" y2="51" stroke="${color}" stroke-width="5" stroke-linecap="round" opacity="${0.76 * power}"/>
            <circle cx="42" cy="76" r="${10 + t * 4}" fill="#4c2b16" opacity="${0.20 * power}"/>
            <circle cx="${cx - 2}" cy="${cy + 8}" r="${38 + t * 7}" fill="none" stroke="#b88a4a" stroke-width="4" opacity="${0.24 * power}"/>`;
  } else if (family === 'fire') {
    body = `<ellipse cx="79" cy="57" rx="${26 + t * 8}" ry="${15 + t * 3}" fill="#ff4a10" opacity="${0.24 * power}"/>
            <ellipse cx="77" cy="57" rx="${17 + t * 6}" ry="${10 + t * 2}" fill="#ff9b24" opacity="${0.48 * power}"/>
            <circle cx="94" cy="50" r="${8 + t * 4}" fill="#ffd34d" opacity="${0.70 * power}"/>
            <circle cx="${cx}" cy="${cy + 8}" r="${36 + t * 8}" fill="none" stroke="#ff7733" stroke-width="5" opacity="${0.24 * power}"/>`;
  } else {
    body = `<circle cx="${cx + 18}" cy="${cy - 15}" r="${16 + t * 6}" fill="#fff4a8" opacity="${0.28 * power}"/>
            <circle cx="${cx + 18}" cy="${cy - 15}" r="${9 + t * 4}" fill="#ffffff" opacity="${0.55 * power}"/>
            <path d="M44 77 C67 43 94 42 110 65" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" opacity="${0.20 * power}"/>
            <path d="M51 76 C70 55 92 54 105 67" fill="none" stroke="#fff4a8" stroke-width="4" stroke-linecap="round" opacity="${0.75 * power}"/>`;
  }

  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${FRAME}" height="${FRAME}" viewBox="0 0 ${FRAME} ${FRAME}">
      ${body}
    </svg>`);
}

function tintFor(family, def) {
  if (def.damageType === 'DIVINE' || family === 'divine') return '#fff4a8';
  if (def.damageType === 'ELEMENTAL_FIRE' || family === 'fire') return '#ff7733';
  if (def.damageType === 'SIEGE' || family === 'siege') return '#b88a4a';
  if (family === 'archer') return '#d8e8ff';
  if (family === 'thrower' || family === 'command') return '#ffe6a8';
  return '#f2f2f2';
}

async function makeFrame(source, family, def, frame) {
  const p = [
    { dx: 0, dy: 0, scale: 0.88 },
    { dx: -2, dy: 1, scale: 0.88 },
    { dx: 4, dy: -1, scale: 0.88 },
    { dx: 5, dy: -1, scale: 0.88 },
    { dx: 2, dy: 0, scale: 0.88 },
    { dx: 0, dy: 0, scale: 0.88 }
  ][frame];
  const spriteSize = Math.round(FRAME * p.scale);
  const sprite = await sharp(source)
    .ensureAlpha()
    .resize(spriteSize, spriteSize, { fit: 'contain', kernel: sharp.kernel.nearest })
    .png()
    .toBuffer();
  const meta = await sharp(sprite).metadata();
  const left = Math.round((FRAME - (meta.width ?? spriteSize)) / 2 + p.dx);
  const top = Math.round((FRAME - (meta.height ?? spriteSize)) / 2 + p.dy);
  const overlay = svgOverlay(family, frame, tintFor(family, def));
  return sharp({ create: { width: FRAME, height: FRAME, channels: 4, background: transparent } })
    .composite([
      { input: sprite, left, top },
      { input: overlay, left: 0, top: 0 }
    ])
    .png({ palette: true, quality: 95, compressionLevel: 9 })
    .toBuffer();
}

await mkdir(OUT_DIR, { recursive: true });

let wrote = 0;
for (const id of baseTowerIds) {
  const file = manifest[id];
  if (!file) throw new Error(`Missing asset manifest entry for ${id}`);
  const source = join(SPRITES_DIR, file);
  const def = towers[id];
  const family = familyFor(id, def);
  const frames = [];
  for (let i = 0; i < FRAMES; i++) frames.push(await makeFrame(source, family, def, i));
  await sharp({ create: { width: FRAME * FRAMES, height: FRAME, channels: 4, background: transparent } })
    .composite(frames.map((input, i) => ({ input, left: i * FRAME, top: 0 })))
    .png({ palette: true, quality: 95, compressionLevel: 9 })
    .toFile(join(OUT_DIR, `atk_${id.toLowerCase()}.png`));
  wrote++;
}

console.log(`Wrote ${wrote} base tower attack sheets to ${OUT_DIR}`);
