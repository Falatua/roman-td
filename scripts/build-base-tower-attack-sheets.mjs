#!/usr/bin/env node
import sharp from 'sharp';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SPRITES_DIR = join(ROOT, 'public/assets/sprites');
const OUT_DIR = join(SPRITES_DIR, 'attacks');
const FRAME = 128;
const COLS = 3;
const ROWS = 3;
const FRAMES = COLS * ROWS;
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
const RELEASE_FRAME = 3;

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

function poseFor(family, frame) {
  const posesByFamily = {
    melee: [
      { dx: 0, dy: 0, scale: 0.88, effect: 0.00 },
      { dx: -3, dy: 1, scale: 0.88, effect: 0.18 },
      { dx: -7, dy: 1, scale: 0.88, effect: 0.42 },
      { dx: 6, dy: -2, scale: 0.90, effect: 1.00 },
      { dx: 8, dy: -2, scale: 0.90, effect: 0.86 },
      { dx: 5, dy: -1, scale: 0.89, effect: 0.62 },
      { dx: 2, dy: 0, scale: 0.88, effect: 0.34 },
      { dx: 1, dy: 0, scale: 0.88, effect: 0.14 },
      { dx: 0, dy: 0, scale: 0.88, effect: 0.00 }
    ],
    spear: [
      { dx: 0, dy: 0, scale: 0.88, effect: 0.00 },
      { dx: -4, dy: 1, scale: 0.88, effect: 0.18 },
      { dx: -8, dy: 1, scale: 0.88, effect: 0.36 },
      { dx: 9, dy: -2, scale: 0.90, effect: 1.00 },
      { dx: 8, dy: -2, scale: 0.90, effect: 0.78 },
      { dx: 5, dy: -1, scale: 0.89, effect: 0.52 },
      { dx: 2, dy: 0, scale: 0.88, effect: 0.24 },
      { dx: 1, dy: 0, scale: 0.88, effect: 0.10 },
      { dx: 0, dy: 0, scale: 0.88, effect: 0.00 }
    ],
    archer: [
      { dx: 0, dy: 0, scale: 0.88, effect: 0.00 },
      { dx: -3, dy: 0, scale: 0.88, effect: 0.34 },
      { dx: -5, dy: 0, scale: 0.88, effect: 0.58 },
      { dx: -6, dy: 0, scale: 0.88, effect: 0.74 },
      { dx: 5, dy: -1, scale: 0.89, effect: 1.00 },
      { dx: 4, dy: -1, scale: 0.88, effect: 0.62 },
      { dx: 2, dy: 0, scale: 0.88, effect: 0.34 },
      { dx: 1, dy: 0, scale: 0.88, effect: 0.12 },
      { dx: 0, dy: 0, scale: 0.88, effect: 0.00 }
    ],
    thrower: [
      { dx: 0, dy: 0, scale: 0.88, effect: 0.00 },
      { dx: -4, dy: 1, scale: 0.88, effect: 0.20 },
      { dx: -8, dy: 1, scale: 0.88, effect: 0.44 },
      { dx: 6, dy: -2, scale: 0.90, effect: 1.00 },
      { dx: 8, dy: -1, scale: 0.89, effect: 0.72 },
      { dx: 5, dy: -1, scale: 0.88, effect: 0.52 },
      { dx: 2, dy: 0, scale: 0.88, effect: 0.18 },
      { dx: 1, dy: 0, scale: 0.88, effect: 0.08 },
      { dx: 0, dy: 0, scale: 0.88, effect: 0.00 }
    ],
    command: [
      { dx: 0, dy: 0, scale: 0.88, effect: 0.00 },
      { dx: -2, dy: 0, scale: 0.88, effect: 0.20 },
      { dx: -4, dy: 0, scale: 0.88, effect: 0.44 },
      { dx: 4, dy: -1, scale: 0.89, effect: 0.86 },
      { dx: 6, dy: -1, scale: 0.89, effect: 1.00 },
      { dx: 5, dy: -1, scale: 0.88, effect: 0.68 },
      { dx: 2, dy: 0, scale: 0.88, effect: 0.30 },
      { dx: 1, dy: 0, scale: 0.88, effect: 0.12 },
      { dx: 0, dy: 0, scale: 0.88, effect: 0.00 }
    ],
    siege: [
      { dx: 0, dy: 0, scale: 0.88, effect: 0.00 },
      { dx: 2, dy: 0, scale: 0.88, effect: 0.18 },
      { dx: 4, dy: 0, scale: 0.88, effect: 0.38 },
      { dx: -8, dy: 1, scale: 0.89, effect: 1.00 },
      { dx: -7, dy: 1, scale: 0.89, effect: 0.82 },
      { dx: -5, dy: 1, scale: 0.88, effect: 0.62 },
      { dx: -2, dy: 0, scale: 0.88, effect: 0.36 },
      { dx: -1, dy: 0, scale: 0.88, effect: 0.14 },
      { dx: 0, dy: 0, scale: 0.88, effect: 0.00 }
    ],
    fire: [
      { dx: 0, dy: 0, scale: 0.88, effect: 0.00 },
      { dx: -1, dy: 0, scale: 0.88, effect: 0.24 },
      { dx: -3, dy: 0, scale: 0.88, effect: 0.52 },
      { dx: 3, dy: -2, scale: 0.90, effect: 1.00 },
      { dx: 5, dy: -1, scale: 0.90, effect: 0.78 },
      { dx: 4, dy: -1, scale: 0.89, effect: 0.48 },
      { dx: 2, dy: 0, scale: 0.88, effect: 0.22 },
      { dx: 1, dy: 0, scale: 0.88, effect: 0.08 },
      { dx: 0, dy: 0, scale: 0.88, effect: 0.00 }
    ],
    divine: [
      { dx: 0, dy: 0, scale: 0.88, effect: 0.00 },
      { dx: -1, dy: 0, scale: 0.88, effect: 0.22 },
      { dx: -2, dy: 0, scale: 0.88, effect: 0.50 },
      { dx: 2, dy: -2, scale: 0.90, effect: 0.96 },
      { dx: 4, dy: -1, scale: 0.90, effect: 0.64 },
      { dx: 3, dy: -1, scale: 0.89, effect: 0.28 },
      { dx: 1, dy: 0, scale: 0.88, effect: 0.06 },
      { dx: 1, dy: 0, scale: 0.88, effect: 0.02 },
      { dx: 0, dy: 0, scale: 0.88, effect: 0.00 }
    ]
  };
  return (posesByFamily[family] ?? posesByFamily.thrower)[frame];
}

function frameSparkles(count, color, opacity, seedX, seedY) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const x = seedX + Math.sin((i + 1) * 1.91) * (8 + i * 2.1);
    const y = seedY + Math.cos((i + 2) * 2.37) * (7 + i * 1.6);
    out += `<path d="M${x - 2} ${y} L${x + 2} ${y} M${x} ${y - 2} L${x} ${y + 2}" stroke="${color}" stroke-width="1.4" stroke-linecap="round" opacity="${opacity}"/>`;
  }
  return out;
}

function svgOverlay(family, frame, tint) {
  const t = frame / (FRAMES - 1);
  const pose = poseFor(family, frame);
  const power = pose.effect;
  const cx = FRAME / 2;
  const cy = FRAME / 2;
  const color = tint;
  let body = '';

  if (family === 'melee') {
    const swing = Math.min(1, power + (frame >= RELEASE_FRAME ? 0.12 : 0));
    body = `<path d="M${26 + swing * 10} ${54 - swing * 8} C${57 + swing * 6} ${19 + swing * 6} ${104 + swing * 4} ${36 + swing * 7} ${116 - swing * 6} ${78 + swing * 3}" fill="none" stroke="${color}" stroke-width="${9 + (frame === RELEASE_FRAME ? 5 : 1)}" stroke-linecap="round" opacity="${0.20 * power}"/>
            <path d="M${35 + swing * 8} ${56 - swing * 7} C${66 + swing * 4} ${31 + swing * 7} ${98 + swing * 5} ${43 + swing * 5} ${108 - swing * 5} ${76 + swing * 3}" fill="none" stroke="#fff4d0" stroke-width="${4 + (frame === RELEASE_FRAME ? 2 : 0)}" stroke-linecap="round" opacity="${0.82 * power}"/>
            <line x1="58" y1="73" x2="${70 + 38 * swing}" y2="${75 - 36 * swing}" stroke="#fff4d0" stroke-width="3.5" stroke-linecap="round" opacity="${0.66 * Math.max(0.1, power)}"/>
            <ellipse cx="${cx}" cy="91" rx="${33 + t * 3}" ry="9" fill="${color}" opacity="${0.055 * power}"/>`;
  } else if (family === 'spear') {
    const reach = 14 + power * 13;
    body = `<line x1="${36 - t * 3}" y1="82" x2="${87 + reach}" y2="${51 - reach * 0.36}" stroke="${color}" stroke-width="${8 + (frame === RELEASE_FRAME ? 4 : 0)}" stroke-linecap="round" opacity="${0.18 * power}"/>
            <line x1="${44 - t * 3}" y1="76" x2="${86 + reach}" y2="${52 - reach * 0.36}" stroke="#fff4d0" stroke-width="${3.5 + (frame === RELEASE_FRAME ? 1.5 : 0)}" stroke-linecap="round" opacity="${0.84 * power}"/>
            <polygon points="${90 + reach},${51 - reach * 0.36} ${100 + reach},${46 - reach * 0.36} ${95 + reach},${58 - reach * 0.36}" fill="#fff4d0" opacity="${0.76 * power}"/>
            <circle cx="${93 + reach}" cy="${51 - reach * 0.36}" r="${3 + t * 4}" fill="#fff4d0" opacity="${0.55 * power}"/>`;
  } else if (family === 'archer') {
    const release = frame >= RELEASE_FRAME ? power : power * 0.35;
    const draw = Math.min(1, frame / RELEASE_FRAME);
    body = `<path d="M36 82 C58 45 88 36 113 47" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" opacity="${0.16 * power}"/>
            <path d="M41 79 C${62 - draw * 6} ${55 + draw * 10} ${89 - draw * 8} ${48 + draw * 7} 108 50" fill="none" stroke="#fff7d4" stroke-width="3.5" stroke-linecap="round" opacity="${0.70 * power}"/>
            <line x1="${frame < RELEASE_FRAME ? 51 - draw * 5 : 60}" y1="${frame < RELEASE_FRAME ? 76 + draw * 2 : 72}" x2="${frame < RELEASE_FRAME ? 100 - draw * 7 : 121}" y2="${frame < RELEASE_FRAME ? 52 + draw * 4 : 38}" stroke="#fff7d4" stroke-width="2.5" stroke-linecap="round" opacity="${0.88 * release}"/>
            <polygon points="${frame < RELEASE_FRAME ? `${100 - draw * 7},${52 + draw * 4} ${108 - draw * 7},${48 + draw * 4} ${105 - draw * 7},${57 + draw * 4}` : '121,38 127,35 125,43'}" fill="#fff7d4" opacity="${0.82 * release}"/>`;
  } else if (family === 'thrower' || family === 'command') {
    const isCommand = family === 'command';
    const throwReach = 18 + power * 18;
    body = `<line x1="${38 - t * 3}" y1="82" x2="${80 + throwReach}" y2="${60 - throwReach * 0.38}" stroke="${color}" stroke-width="${isCommand ? 7 : 9}" stroke-linecap="round" opacity="${0.16 * power}"/>
            <line x1="${47 - t * 3}" y1="77" x2="${78 + throwReach}" y2="${63 - throwReach * 0.38}" stroke="#ffe9ad" stroke-width="${isCommand ? 3 : 4}" stroke-linecap="round" opacity="${0.82 * power}"/>
            <polygon points="${80 + throwReach},${63 - throwReach * 0.38} ${90 + throwReach},${58 - throwReach * 0.38} ${85 + throwReach},${69 - throwReach * 0.38}" fill="#ffe9ad" opacity="${0.84 * power}"/>
            ${isCommand ? frameSparkles(4, '#ffe9ad', 0.42 * power, 85, 51) : ''}
            <circle cx="${cx}" cy="${cy}" r="${28 + t * 4}" fill="${color}" opacity="${0.045 * power}"/>`;
  } else if (family === 'siege') {
    body = `<line x1="22" y1="73" x2="116" y2="49" stroke="#7a4a24" stroke-width="${11 + (frame === RELEASE_FRAME ? 5 : 0)}" stroke-linecap="round" opacity="${0.20 * power}"/>
            <line x1="33" y1="70" x2="111" y2="50" stroke="${color}" stroke-width="${4.5 + (frame === RELEASE_FRAME ? 2 : 0)}" stroke-linecap="round" opacity="${0.76 * power}"/>
            <circle cx="39" cy="76" r="${8 + t * 5}" fill="#4c2b16" opacity="${0.19 * power}"/>
            <circle cx="${cx - 4}" cy="${cy + 8}" r="${34 + t * 9}" fill="none" stroke="#b88a4a" stroke-width="3.5" opacity="${0.20 * power}"/>
            <path d="M22 86 C38 78 52 80 66 88" fill="none" stroke="#6d5436" stroke-width="5" stroke-linecap="round" opacity="${0.22 * power}"/>`;
  } else if (family === 'fire') {
    body = `<ellipse cx="82" cy="57" rx="${22 + t * 11}" ry="${13 + t * 4}" fill="#ff4a10" opacity="${0.24 * power}"/>
            <ellipse cx="79" cy="57" rx="${14 + t * 8}" ry="${8 + t * 3}" fill="#ff9b24" opacity="${0.50 * power}"/>
            <circle cx="98" cy="49" r="${6 + t * 6}" fill="#ffd34d" opacity="${0.70 * power}"/>
            <circle cx="${cx}" cy="${cy + 8}" r="${33 + t * 9}" fill="none" stroke="#ff7733" stroke-width="4" opacity="${0.22 * power}"/>
            ${frameSparkles(5, '#ffd34d', 0.40 * power, 91, 49)}`;
  } else {
    body = `<circle cx="${cx + 18}" cy="${cy - 15}" r="${13 + t * 8}" fill="#fff4a8" opacity="${0.26 * power}"/>
            <circle cx="${cx + 18}" cy="${cy - 15}" r="${7 + t * 5}" fill="#ffffff" opacity="${0.54 * power}"/>
            <path d="M43 78 C67 42 96 43 112 66" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" opacity="${0.18 * power}"/>
            <path d="M51 76 C70 55 93 55 106 67" fill="none" stroke="#fff4a8" stroke-width="3.5" stroke-linecap="round" opacity="${0.72 * power}"/>
            ${frameSparkles(6, '#fff4a8', 0.38 * power, 86, 49)}`;
  }

  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${FRAME}" height="${FRAME}" viewBox="0 0 ${FRAME} ${FRAME}">
      <ellipse cx="${cx}" cy="98" rx="21" ry="5" fill="#000000" opacity="${0.055}"/>
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
  const p = poseFor(family, frame);
  const spriteSize = Math.round(FRAME * p.scale * 0.92);
  const sprite = await sharp(source)
    .ensureAlpha()
    .trim({ background: '#000000', threshold: 8 })
    .resize(spriteSize, spriteSize, { fit: 'contain', kernel: sharp.kernel.nearest, background: transparent })
    .png()
    .toBuffer();
  const meta = await sharp(sprite).metadata();
  const left = Math.round((FRAME - (meta.width ?? spriteSize)) / 2 + p.dx);
  const top = Math.round((FRAME - (meta.height ?? spriteSize)) / 2 + p.dy);
  const overlay = svgOverlay(family, frame, tintFor(family, def));
  const framePng = await sharp({ create: { width: FRAME, height: FRAME, channels: 4, background: transparent } })
    .composite([
      { input: sprite, left, top },
      { input: overlay, left: 0, top: 0 }
    ])
    .png({ quality: 95, compressionLevel: 9 })
    .toBuffer();
  return cleanTransparentPixels(framePng);
}

async function cleanTransparentPixels(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] <= 4) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
    }
  }
  return sharp(data, { raw: info }).png({ quality: 95, compressionLevel: 9 }).toBuffer();
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
  frames[FRAMES - 1] = frames[0];
  const sheet = await sharp({ create: { width: FRAME * COLS, height: FRAME * ROWS, channels: 4, background: transparent } })
    .composite(frames.map((input, i) => ({
      input,
      left: (i % COLS) * FRAME,
      top: Math.floor(i / COLS) * FRAME
    })))
    .png({ quality: 95, compressionLevel: 9 })
    .toBuffer();
  await sharp(await cleanTransparentPixels(sheet))
    .png({ quality: 95, compressionLevel: 9 })
    .toFile(join(OUT_DIR, `atk_${id.toLowerCase()}.png`));
  wrote++;
}

console.log(`Wrote ${wrote} 3x3 base tower attack sheets to ${OUT_DIR}`);
