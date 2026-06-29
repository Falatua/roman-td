#!/usr/bin/env node
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const HERO_DIR = join(ROOT, 'public/assets/heroes');
const OUT_DIR = join(HERO_DIR, 'attacks');
const FRAME = 256;
const COLS = 3;
const ROWS = 3;
const FRAMES = COLS * ROWS;
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

const HEROES = [
  { id: 'MARIUS', file: 'hero_marius.png', color: '#d8e8ff', kind: 'slash', side: -1 },
  { id: 'AGRIPPA', file: 'hero_agrippa.png', color: '#88bbff', kind: 'pilum', side: 1 },
  { id: 'AGRICOLA', file: 'hero_agricola.png', color: '#aaccff', kind: 'bow', side: -1 },
  { id: 'SCIPIO', file: 'hero_scipio.png', color: '#ffd18a', kind: 'thrust', side: 1 },
  { id: 'CAESAR', file: 'hero_caesar.png', color: '#ffd34d', kind: 'divineSlash', side: 1 },
  { id: 'SULLA', file: 'hero_sulla.png', color: '#ff7733', kind: 'spell', side: -1 }
];

// 3x3 pose language: idle -> wind-up -> deep wind-up -> release ->
// impact -> follow-through -> recoil -> recover -> idle. This mirrors
// Warcraft III / Green TD readability: compact, repeatable, frame-based.
const POSES = [
  { dx: 0, dy: 0, scale: 0.94, rot: 0.0, power: 0.00, arm: 0.00 },
  { dx: -3, dy: 1, scale: 0.94, rot: -3.0, power: 0.20, arm: 0.20 },
  { dx: -7, dy: 1, scale: 0.94, rot: -7.0, power: 0.42, arm: 0.45 },
  { dx: 4, dy: -2, scale: 0.96, rot: 7.0, power: 1.00, arm: 1.00 },
  { dx: 9, dy: -2, scale: 0.96, rot: 10.0, power: 0.95, arm: 0.88 },
  { dx: 7, dy: -1, scale: 0.95, rot: 5.0, power: 0.64, arm: 0.65 },
  { dx: 3, dy: 0, scale: 0.94, rot: 2.0, power: 0.34, arm: 0.35 },
  { dx: 1, dy: 0, scale: 0.94, rot: -1.0, power: 0.14, arm: 0.15 },
  { dx: 0, dy: 0, scale: 0.94, rot: 0.0, power: 0.00, arm: 0.00 }
];

function slashPath(hero, p) {
  const c = hero.color;
  const a = p.power;
  const mirror = hero.side < 0 ? 'scale(-1 1) translate(-256 0)' : '';
  return `
    <g transform="${mirror}">
      <path d="M58 78 C123 19 205 55 220 139" fill="none" stroke="${c}" stroke-width="24" stroke-linecap="round" opacity="${0.18 * a}"/>
      <path d="M69 86 C127 42 192 66 209 134" fill="none" stroke="#fff8dd" stroke-width="9" stroke-linecap="round" opacity="${0.86 * a}"/>
      <path d="M101 105 C139 78 174 88 195 134" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round" opacity="${0.80 * a}"/>
      <line x1="114" y1="132" x2="${126 + 62 * p.arm}" y2="${123 - 54 * p.arm}" stroke="#d8d8d8" stroke-width="8" stroke-linecap="round" opacity="${0.90 * Math.max(0.15, p.arm)}"/>
      <line x1="118" y1="130" x2="${129 + 60 * p.arm}" y2="${121 - 52 * p.arm}" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="${0.85 * Math.max(0.15, p.arm)}"/>
    </g>`;
}

function thrustPath(hero, p) {
  const c = hero.color;
  const a = p.power;
  return `
    <line x1="86" y1="140" x2="${128 + 92 * p.arm}" y2="${126 - 54 * p.arm}" stroke="#ff9f35" stroke-width="18" stroke-linecap="round" opacity="${0.15 * a}"/>
    <line x1="96" y1="135" x2="${128 + 88 * p.arm}" y2="${125 - 52 * p.arm}" stroke="${c}" stroke-width="8" stroke-linecap="round" opacity="${0.92 * Math.max(0.12, p.arm)}"/>
    <line x1="119" y1="124" x2="${128 + 88 * p.arm}" y2="${125 - 52 * p.arm}" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="${0.72 * Math.max(0.12, p.arm)}"/>
    <circle cx="${128 + 90 * p.arm}" cy="${125 - 53 * p.arm}" r="${5 + 11 * a}" fill="#fff0c0" opacity="${0.58 * a}"/>`;
}

function bowPath(hero, p) {
  const c = hero.color;
  const a = p.power;
  const draw = Math.min(1, p.arm * 1.25);
  return `
    <path d="M83 150 C112 ${104 - 22 * draw} 158 ${83 - 7 * draw} 207 ${92 - 4 * draw}" fill="none" stroke="#6fc8ff" stroke-width="18" stroke-linecap="round" opacity="${0.14 * Math.max(a, draw)}"/>
    <path d="M90 145 C119 ${112 - 18 * draw} 158 ${95 - 8 * draw} 200 ${97 - 5 * draw}" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" opacity="${0.78 * Math.max(0.12, draw)}"/>
    <line x1="${110 - 8 * draw}" y1="${135 + 2 * draw}" x2="${143 + 77 * p.arm}" y2="${118 - 40 * p.arm}" stroke="#e8f8ff" stroke-width="4" stroke-linecap="round" opacity="${0.84 * Math.max(0.1, p.arm)}"/>
    <polygon points="${143 + 77 * p.arm},${118 - 40 * p.arm} ${153 + 77 * p.arm},${113 - 40 * p.arm} ${149 + 77 * p.arm},${126 - 40 * p.arm}" fill="#e8f8ff" opacity="${0.82 * a}"/>`;
}

function throwPath(hero, p, meteor = false) {
  const c = meteor ? '#ff7733' : hero.color;
  const a = p.power;
  const x2 = 126 + 88 * p.arm;
  const y2 = 128 - 58 * p.arm;
  return `
    <line x1="86" y1="145" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="17" stroke-linecap="round" opacity="${0.16 * Math.max(a, p.arm)}"/>
    <line x1="95" y1="140" x2="${x2 - 8}" y2="${y2 + 4}" stroke="${meteor ? '#ffb066' : '#e8f4ff'}" stroke-width="7" stroke-linecap="round" opacity="${0.85 * Math.max(0.12, p.arm)}"/>
    ${meteor
      ? `<circle cx="${x2}" cy="${y2}" r="${10 + 15 * a}" fill="#ff5522" opacity="${0.32 * a}"/>
         <circle cx="${x2}" cy="${y2}" r="${5 + 8 * a}" fill="#ffd34d" opacity="${0.62 * a}"/>`
      : `<polygon points="${x2},${y2} ${x2 + 18},${y2 - 9} ${x2 + 9},${y2 + 10}" fill="#e8f4ff" opacity="${0.84 * a}"/>`}
    <circle cx="${x2 - 6}" cy="${y2 + 4}" r="${8 + 8 * a}" fill="${c}" opacity="${0.12 * a}"/>`;
}

function spellPath(hero, p) {
  const a = p.power;
  return `
    <circle cx="${150 + 25 * p.arm}" cy="${110 - 32 * p.arm}" r="${16 + 22 * a}" fill="#ff7733" opacity="${0.22 * a}"/>
    <circle cx="${150 + 25 * p.arm}" cy="${110 - 32 * p.arm}" r="${8 + 13 * a}" fill="#ffd34d" opacity="${0.44 * a}"/>
    <path d="M78 139 C113 88 176 84 214 132" fill="none" stroke="#ff5522" stroke-width="18" stroke-linecap="round" opacity="${0.16 * a}"/>
    <path d="M91 137 C122 102 170 100 199 128" fill="none" stroke="#ffb066" stroke-width="7" stroke-linecap="round" opacity="${0.78 * a}"/>`;
}

function svgOverlay(hero, frameIndex) {
  const p = POSES[frameIndex];
  const c = hero.color;
  const glow = p.power > 0
    ? `<circle cx="128" cy="132" r="${48 + p.power * 28}" fill="${c}" opacity="${0.09 * p.power}"/>
       <circle cx="128" cy="132" r="${68 + p.power * 18}" fill="none" stroke="${c}" stroke-width="5" opacity="${0.15 * p.power}"/>`
    : '';
  let marks = '';
  if (hero.kind === 'slash') marks = slashPath(hero, p);
  else if (hero.kind === 'divineSlash') marks = slashPath(hero, p) + `<circle cx="204" cy="128" r="${6 + 14 * p.power}" fill="#fff4a8" opacity="${0.45 * p.power}"/>`;
  else if (hero.kind === 'thrust') marks = thrustPath(hero, p);
  else if (hero.kind === 'pilum') marks = throwPath(hero, p, false);
  else if (hero.kind === 'bow') marks = bowPath(hero, p);
  else marks = spellPath(hero, p);

  return Buffer.from(`
    <svg width="${FRAME}" height="${FRAME}" viewBox="0 0 ${FRAME} ${FRAME}" xmlns="http://www.w3.org/2000/svg">
      ${glow}
      ${marks}
    </svg>`);
}

async function makeFrame(hero, frameIndex) {
  const p = POSES[frameIndex];
  const size = Math.round(238 * p.scale);
  let sprite = await sharp(join(HERO_DIR, hero.file))
    .ensureAlpha()
    .resize(size, size, { fit: 'contain', kernel: sharp.kernel.nearest, background: transparent })
    .rotate(p.rot * hero.side, { background: transparent, kernel: sharp.kernel.nearest })
    .png()
    .toBuffer();
  sprite = await cleanTransparentPixels(sprite);
  const meta = await sharp(sprite).metadata();
  const left = Math.round((FRAME - (meta.width ?? size)) / 2 + p.dx * hero.side);
  const top = Math.round((FRAME - (meta.height ?? size)) / 2 + p.dy);
  const overlay = svgOverlay(hero, frameIndex);
  const frame = await sharp({
    create: { width: FRAME, height: FRAME, channels: 4, background: transparent }
  })
    .composite([
      { input: sprite, left, top },
      { input: overlay, left: 0, top: 0 }
    ])
    .png({ quality: 95, compressionLevel: 9 })
    .toBuffer();
  return cleanTransparentPixels(frame);
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

for (const hero of HEROES) {
  const frames = [];
  for (let i = 0; i < FRAMES; i++) frames.push(await makeFrame(hero, i));
  const composites = frames.map((input, i) => ({
    input,
    left: (i % COLS) * FRAME,
    top: Math.floor(i / COLS) * FRAME
  }));
  await sharp({
    create: { width: FRAME * COLS, height: FRAME * ROWS, channels: 4, background: transparent }
  })
    .composite(composites)
    .png({ quality: 95, compressionLevel: 9 })
    .toFile(join(OUT_DIR, `hero_${hero.id.toLowerCase()}_attack_sheet.png`));
}

console.log(`Wrote ${HEROES.length} 3x3 hero attack sheets to ${OUT_DIR}`);
