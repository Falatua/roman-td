#!/usr/bin/env node
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const HERO_DIR = join(ROOT, 'public/assets/heroes');
const OUT_DIR = join(HERO_DIR, 'attacks');
const FRAME = 256;
const FRAMES = 6;

const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

const HEROES = [
  { id: 'MARIUS', file: 'hero_marius.png', color: '#d8e8ff', kind: 'slash', side: -1 },
  { id: 'AGRIPPA', file: 'hero_agrippa.png', color: '#88bbff', kind: 'pilum', side: 1 },
  { id: 'AGRICOLA', file: 'hero_agricola.png', color: '#aaccff', kind: 'bow', side: -1 },
  { id: 'SCIPIO', file: 'hero_scipio.png', color: '#ffd18a', kind: 'thrust', side: 1 },
  { id: 'CAESAR', file: 'hero_caesar.png', color: '#ffd34d', kind: 'divineSlash', side: 1 },
  { id: 'SULLA', file: 'hero_sulla.png', color: '#ff7733', kind: 'spell', side: -1 }
];

const POSES = [
  { rot: 0, scale: 0.94, dx: 0, dy: 0, alpha: 0.00 },
  { rot: -15, scale: 0.92, dx: -5, dy: 1, alpha: 0.38 },
  { rot: 16, scale: 0.98, dx: 9, dy: -2, alpha: 0.95 },
  { rot: 24, scale: 0.96, dx: 12, dy: -1, alpha: 0.72 },
  { rot: 8, scale: 0.94, dx: 4, dy: 0, alpha: 0.36 },
  { rot: 0, scale: 0.94, dx: 0, dy: 0, alpha: 0.00 }
];

function svgOverlay(hero, frameIndex) {
  const p = POSES[frameIndex];
  const c = hero.color;
  const a = p.alpha;
  const side = hero.side;
  const slashMirror = side < 0 ? 'scale(-1 1) translate(-256 0)' : '';
  const commonGlow = a > 0
    ? `<circle cx="128" cy="132" r="${50 + frameIndex * 3}" fill="${c}" opacity="${0.10 * a}"/>
       <circle cx="128" cy="132" r="${67 + frameIndex * 2}" fill="none" stroke="${c}" stroke-width="5" opacity="${0.20 * a}"/>`
    : '';

  let marks = '';
  if (hero.kind === 'slash') {
    marks = `
      <g transform="${slashMirror}">
        <path d="M73 70 C131 34 190 61 209 126" fill="none" stroke="${c}" stroke-width="18" stroke-linecap="round" opacity="${0.22 * a}"/>
        <path d="M78 75 C134 44 181 66 202 124" fill="none" stroke="#ffffff" stroke-width="8" stroke-linecap="round" opacity="${0.82 * a}"/>
        <path d="M98 93 C136 72 166 85 184 125" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round" opacity="${0.95 * a}"/>
      </g>`;
  } else if (hero.kind === 'divineSlash') {
    marks = `
      <g transform="${slashMirror}">
        <path d="M66 82 C128 24 202 54 216 132" fill="none" stroke="${c}" stroke-width="22" stroke-linecap="round" opacity="${0.25 * a}"/>
        <path d="M74 88 C129 43 188 65 205 130" fill="none" stroke="#fff4a8" stroke-width="9" stroke-linecap="round" opacity="${0.88 * a}"/>
        <circle cx="202" cy="130" r="${11 + frameIndex}" fill="#fff4a8" opacity="${0.54 * a}"/>
        <path d="M128 74 L128 39 M153 83 L174 54 M101 83 L80 54" stroke="#fff4a8" stroke-width="5" stroke-linecap="round" opacity="${0.55 * a}"/>
      </g>`;
  } else if (hero.kind === 'thrust') {
    marks = `
      <line x1="86" y1="136" x2="212" y2="88" stroke="#ff9f35" stroke-width="18" stroke-linecap="round" opacity="${0.18 * a}"/>
      <line x1="94" y1="132" x2="210" y2="88" stroke="${c}" stroke-width="8" stroke-linecap="round" opacity="${0.92 * a}"/>
      <line x1="118" y1="121" x2="211" y2="88" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity="${0.72 * a}"/>
      <circle cx="214" cy="87" r="${8 + frameIndex}" fill="#fff0c0" opacity="${0.66 * a}"/>`;
  } else if (hero.kind === 'pilum') {
    marks = `
      <line x1="83" y1="143" x2="218" y2="73" stroke="#3366ff" stroke-width="18" stroke-linecap="round" opacity="${0.16 * a}"/>
      <line x1="91" y1="138" x2="212" y2="76" stroke="${c}" stroke-width="7" stroke-linecap="round" opacity="${0.88 * a}"/>
      <polygon points="212,76 230,67 220,86" fill="#e8f4ff" opacity="${0.82 * a}"/>
      <circle cx="205" cy="80" r="${10 + frameIndex}" fill="${c}" opacity="${0.14 * a}"/>`;
  } else if (hero.kind === 'bow') {
    marks = `
      <path d="M83 148 C112 94 156 78 205 91" fill="none" stroke="#6fc8ff" stroke-width="18" stroke-linecap="round" opacity="${0.16 * a}"/>
      <path d="M89 143 C119 104 157 91 199 96" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round" opacity="${0.82 * a}"/>
      <line x1="112" y1="132" x2="214" y2="84" stroke="#e8f8ff" stroke-width="4" stroke-linecap="round" opacity="${0.82 * a}"/>
      <polygon points="214,84 226,78 220,91" fill="#e8f8ff" opacity="${0.82 * a}"/>`;
  } else {
    marks = `
      <circle cx="155" cy="105" r="${22 + frameIndex * 4}" fill="#ff7733" opacity="${0.20 * a}"/>
      <circle cx="155" cy="105" r="${12 + frameIndex * 3}" fill="#ffd34d" opacity="${0.30 * a}"/>
      <path d="M80 137 C115 84 173 82 211 130" fill="none" stroke="#ff5522" stroke-width="18" stroke-linecap="round" opacity="${0.18 * a}"/>
      <path d="M92 137 C121 100 170 99 199 129" fill="none" stroke="#ffb066" stroke-width="7" stroke-linecap="round" opacity="${0.84 * a}"/>`;
  }

  return Buffer.from(`
    <svg width="${FRAME}" height="${FRAME}" viewBox="0 0 ${FRAME} ${FRAME}" xmlns="http://www.w3.org/2000/svg">
      ${commonGlow}
      ${marks}
    </svg>`);
}

async function makeFrame(hero, frameIndex) {
  const p = POSES[frameIndex];
  const size = Math.round(238 * p.scale);
  const sprite = await sharp(join(HERO_DIR, hero.file))
    .ensureAlpha()
    .resize(size, size, { fit: 'contain', kernel: sharp.kernel.nearest })
    .rotate(p.rot * hero.side, { background: transparent })
    .resize(246, 246, { fit: 'inside', kernel: sharp.kernel.nearest })
    .png()
    .toBuffer();
  const meta = await sharp(sprite).metadata();
  const left = Math.round((FRAME - (meta.width ?? size)) / 2 + p.dx * hero.side);
  const top = Math.round((FRAME - (meta.height ?? size)) / 2 + p.dy);
  const overlay = svgOverlay(hero, frameIndex);
  return sharp({
    create: { width: FRAME, height: FRAME, channels: 4, background: transparent }
  })
    .composite([
      { input: sprite, left, top },
      { input: overlay, left: 0, top: 0 }
    ])
    .png({ palette: true, quality: 95, compressionLevel: 9 })
    .toBuffer();
}

await mkdir(OUT_DIR, { recursive: true });

for (const hero of HEROES) {
  const frames = [];
  for (let i = 0; i < FRAMES; i++) frames.push(await makeFrame(hero, i));
  const composites = frames.map((input, i) => ({ input, left: i * FRAME, top: 0 }));
  await sharp({
    create: { width: FRAME * FRAMES, height: FRAME, channels: 4, background: transparent }
  })
    .composite(composites)
    .png({ palette: true, quality: 95, compressionLevel: 9 })
    .toFile(join(OUT_DIR, `hero_${hero.id.toLowerCase()}_attack_sheet.png`));
}

console.log(`Wrote ${HEROES.length} hero attack sheets to ${OUT_DIR}`);
