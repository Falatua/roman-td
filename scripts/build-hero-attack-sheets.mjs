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

// 3x3 pose language: idle -> anticipation -> deeper anticipation ->
// release -> impact -> follow-through -> recoil -> settle -> idle.
// The eased values keep the action smooth while preserving the compact
// Warcraft III / Green TD readability at in-game scale.
const POSES = [
  { dx: 0, dy: 0, scale: 0.94, rot: 0.0, power: 0.00, arm: 0.00 },
  { dx: -2, dy: 1, scale: 0.94, rot: -2.0, power: 0.08, arm: 0.12 },
  { dx: -5, dy: 1, scale: 0.94, rot: -5.5, power: 0.30, arm: 0.34 },
  { dx: -2, dy: 0, scale: 0.95, rot: -2.0, power: 0.68, arm: 0.70 },
  { dx: 5, dy: -2, scale: 0.96, rot: 7.5, power: 1.00, arm: 1.00 },
  { dx: 8, dy: -2, scale: 0.96, rot: 8.5, power: 0.78, arm: 0.76 },
  { dx: 5, dy: -1, scale: 0.95, rot: 4.0, power: 0.42, arm: 0.42 },
  { dx: 2, dy: 0, scale: 0.94, rot: 1.0, power: 0.14, arm: 0.16 },
  { dx: 0, dy: 0, scale: 0.94, rot: 0.0, power: 0.00, arm: 0.00 }
];

function slashPath(hero, p) {
  const c = hero.color;
  const a = p.power;
  const arm = p.arm;
  const mirror = hero.side < 0 ? 'scale(-1 1) translate(-256 0)' : '';
  return `
    <g transform="${mirror}">
      <path d="M${65 - 8 * arm} ${84 - 6 * arm} C${122 - 10 * arm} ${28 - 8 * arm} ${195 + 4 * arm} ${55 + 8 * arm} ${215 + 5 * arm} ${132 + 5 * arm}" fill="none" stroke="${c}" stroke-width="24" stroke-linecap="round" opacity="${0.16 * a}"/>
      <path d="M${74 - 8 * arm} ${91 - 5 * arm} C${127 - 8 * arm} ${45 - 5 * arm} ${184 + 6 * arm} ${67 + 7 * arm} ${204 + 5 * arm} ${128 + 5 * arm}" fill="none" stroke="#fff8dd" stroke-width="9" stroke-linecap="round" opacity="${0.82 * a}"/>
      <path d="M${104 - 3 * arm} 106 C${140 - 3 * arm} ${82 - 3 * arm} ${172 + 6 * arm} ${91 + 5 * arm} ${194 + 4 * arm} ${132 + 3 * arm}" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round" opacity="${0.74 * a}"/>
      <line x1="114" y1="132" x2="${126 + 62 * arm}" y2="${123 - 54 * arm}" stroke="#d8d8d8" stroke-width="8" stroke-linecap="round" opacity="${0.88 * Math.max(0.10, arm)}"/>
      <line x1="118" y1="130" x2="${129 + 60 * arm}" y2="${121 - 52 * arm}" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="${0.82 * Math.max(0.10, arm)}"/>
    </g>`;
}

function thrustPath(hero, p) {
  const c = hero.color;
  const a = p.power;
  const arm = p.arm;
  return `
    <line x1="86" y1="140" x2="${128 + 86 * arm}" y2="${126 - 50 * arm}" stroke="#ff9f35" stroke-width="18" stroke-linecap="round" opacity="${0.14 * a}"/>
    <line x1="96" y1="135" x2="${128 + 82 * arm}" y2="${125 - 48 * arm}" stroke="${c}" stroke-width="8" stroke-linecap="round" opacity="${0.88 * Math.max(0.10, arm)}"/>
    <line x1="119" y1="124" x2="${128 + 82 * arm}" y2="${125 - 48 * arm}" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="${0.68 * Math.max(0.10, arm)}"/>
    <circle cx="${128 + 84 * arm}" cy="${125 - 49 * arm}" r="${5 + 11 * a}" fill="#fff0c0" opacity="${0.54 * a}"/>`;
}

function bowPath(hero, p) {
  const c = hero.color;
  const a = p.power;
  const draw = Math.min(1, p.arm * 1.25);
  const release = Math.max(0, p.arm - 0.32) / 0.68;
  return `
    <path d="M83 150 C112 ${104 - 22 * draw} 158 ${83 - 7 * draw} 207 ${92 - 4 * draw}" fill="none" stroke="#6fc8ff" stroke-width="18" stroke-linecap="round" opacity="${0.14 * Math.max(a, draw)}"/>
    <path d="M90 145 C119 ${112 - 18 * draw} 158 ${95 - 8 * draw} 200 ${97 - 5 * draw}" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" opacity="${0.78 * Math.max(0.12, draw)}"/>
    <line x1="${110 - 8 * draw}" y1="${135 + 2 * draw}" x2="${138 + 76 * release}" y2="${121 - 40 * release}" stroke="#e8f8ff" stroke-width="4" stroke-linecap="round" opacity="${0.84 * Math.max(0.1, p.arm)}"/>
    <polygon points="${138 + 76 * release},${121 - 40 * release} ${148 + 76 * release},${116 - 40 * release} ${144 + 76 * release},${129 - 40 * release}" fill="#e8f8ff" opacity="${0.82 * a}"/>`;
}

function throwPath(hero, p, meteor = false) {
  const c = meteor ? '#ff7733' : hero.color;
  const a = p.power;
  const arm = p.arm;
  const x2 = 126 + 82 * arm;
  const y2 = 128 - 54 * arm;
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
  const arm = p.arm;
  return `
    <circle cx="${150 + 25 * arm}" cy="${110 - 32 * arm}" r="${14 + 24 * a}" fill="#ff7733" opacity="${0.22 * a}"/>
    <circle cx="${150 + 25 * arm}" cy="${110 - 32 * arm}" r="${7 + 14 * a}" fill="#ffd34d" opacity="${0.44 * a}"/>
    <path d="M78 139 C${113 + 4 * arm} ${88 - 10 * arm} ${176 + 6 * arm} ${84 + 7 * arm} 214 132" fill="none" stroke="#ff5522" stroke-width="18" stroke-linecap="round" opacity="${0.15 * a}"/>
    <path d="M91 137 C${122 + 4 * arm} ${102 - 8 * arm} ${170 + 5 * arm} ${100 + 6 * arm} 199 128" fill="none" stroke="#ffb066" stroke-width="7" stroke-linecap="round" opacity="${0.74 * a}"/>`;
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
  // Keep the hero's body footprint stable through the whole 3x3 cycle.
  // Earlier sheets scaled the source art per pose, which made ranged heroes
  // look like they shrank during attack frames once the renderer fit the
  // whole 256px cell back into the normal hero footprint.
  const size = 222;
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
  frames[FRAMES - 1] = frames[0];
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
