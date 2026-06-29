#!/usr/bin/env node
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT_DIR = join(ROOT, 'public/assets/heroes/attacks');
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };

function svgMeteor(frame, size = 96) {
  const t = frame / 5;
  const core = 15 + t * 3;
  const flame = 34 + t * 8;
  const tail = 24 + t * 9;
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <g transform="rotate(-35 ${size / 2} ${size / 2})">
        <ellipse cx="${size / 2 - tail * 0.55}" cy="${size / 2}" rx="${flame}" ry="${18 + t * 3}" fill="#ff4a10" opacity="0.30"/>
        <ellipse cx="${size / 2 - tail * 0.28}" cy="${size / 2}" rx="${flame * 0.72}" ry="${13 + t * 3}" fill="#ff9b24" opacity="0.52"/>
        <ellipse cx="${size / 2 - tail * 0.08}" cy="${size / 2}" rx="${flame * 0.42}" ry="${8 + t * 2}" fill="#ffd34d" opacity="0.68"/>
        <circle cx="${size / 2 + 16}" cy="${size / 2}" r="${core + 7}" fill="#6b1508" opacity="0.95"/>
        <circle cx="${size / 2 + 14}" cy="${size / 2 - 1}" r="${core}" fill="#c33b13" opacity="0.95"/>
        <circle cx="${size / 2 + 8}" cy="${size / 2 - 5}" r="${core * 0.45}" fill="#fff0a8" opacity="0.90"/>
        <circle cx="${size / 2 + 21}" cy="${size / 2 + 8}" r="${core * 0.28}" fill="#230807" opacity="0.62"/>
      </g>
    </svg>`);
}

function svgImpact(frame, size = 128) {
  const t = frame / 5;
  const ring = 18 + t * 45;
  const fire = Math.max(0, 1 - t * 0.25);
  const spike = 18 + t * 24;
  let sparks = '';
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + t * 0.8;
    const r1 = 13 + t * 10;
    const r2 = spike + (i % 3) * 6;
    sparks += `<line x1="${64 + Math.cos(a) * r1}" y1="${64 + Math.sin(a) * r1}" x2="${64 + Math.cos(a) * r2}" y2="${64 + Math.sin(a) * r2}" stroke="${i % 2 ? '#ffd34d' : '#ff5a1f'}" stroke-width="${4 - t * 1.5}" stroke-linecap="round" opacity="${0.75 * (1 - t * 0.35)}"/>`;
  }
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="64" cy="64" r="${ring}" fill="#ff3b12" opacity="${0.16 * (1 - t)}"/>
      <circle cx="64" cy="64" r="${ring * 0.72}" fill="#ff8a22" opacity="${0.24 * (1 - t * 0.5)}"/>
      <circle cx="64" cy="64" r="${12 + t * 10}" fill="#fff1a6" opacity="${0.84 * fire}"/>
      <circle cx="64" cy="64" r="${23 + t * 12}" fill="none" stroke="#ffae33" stroke-width="${8 - t * 4}" opacity="${0.72 * (1 - t * 0.35)}"/>
      ${sparks}
      <ellipse cx="64" cy="${76 + t * 5}" rx="${22 + t * 36}" ry="${8 + t * 8}" fill="#3a1308" opacity="${0.42 * (1 - t * 0.2)}"/>
    </svg>`);
}

async function buildSheet(name, frameSize, svgFn) {
  const frames = [];
  for (let i = 0; i < 6; i++) {
    frames.push(await sharp({ create: { width: frameSize, height: frameSize, channels: 4, background: transparent } })
      .composite([{ input: svgFn(i, frameSize), left: 0, top: 0 }])
      .png({ palette: true, quality: 95, compressionLevel: 9 })
      .toBuffer());
  }
  await sharp({ create: { width: frameSize * 6, height: frameSize, channels: 4, background: transparent } })
    .composite(frames.map((input, i) => ({ input, left: i * frameSize, top: 0 })))
    .png({ palette: true, quality: 95, compressionLevel: 9 })
    .toFile(join(OUT_DIR, name));
}

await mkdir(OUT_DIR, { recursive: true });
await buildSheet('sulla_meteor_projectile_sheet.png', 96, svgMeteor);
await buildSheet('sulla_meteor_impact_sheet.png', 128, svgImpact);
await sharp({ create: { width: 96, height: 96, channels: 4, background: transparent } })
  .composite([{ input: svgMeteor(3, 96), left: 0, top: 0 }])
  .png({ palette: true, quality: 95, compressionLevel: 9 })
  .toFile(join(OUT_DIR, 'sulla_meteor_projectile.png'));
console.log(`Wrote Sulla meteor sheets to ${OUT_DIR}`);
