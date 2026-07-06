#!/usr/bin/env node
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.resolve('public/assets/sprites');
const SIZE = 32;

mkdirSync(OUT_DIR, { recursive: true });

function rgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

function hash(x, y, salt = 0) {
  let v = ((x * 374761393) ^ (y * 668265263) ^ (salt * 2246822519)) >>> 0;
  v = Math.imul(v ^ (v >>> 13), 1274126177) >>> 0;
  return (v ^ (v >>> 16)) >>> 0;
}

function makeCanvas(fill = null) {
  const data = Buffer.alloc(SIZE * SIZE * 4);
  if (fill) {
    const [r, g, b, a = 255] = fill;
    for (let i = 0; i < SIZE * SIZE; i++) {
      const o = i * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = a;
    }
  }
  return data;
}

function setPx(data, x, y, color, alpha = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const o = (Math.floor(y) * SIZE + Math.floor(x)) * 4;
  const [r, g, b] = Array.isArray(color) ? color : rgb(color);
  if (alpha >= 255 || data[o + 3] === 0) {
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = alpha;
    return;
  }
  const a = alpha / 255;
  data[o] = Math.round(r * a + data[o] * (1 - a));
  data[o + 1] = Math.round(g * a + data[o + 1] * (1 - a));
  data[o + 2] = Math.round(b * a + data[o + 2] * (1 - a));
  data[o + 3] = Math.max(data[o + 3], alpha);
}

function rect(data, x, y, w, h, color, alpha = 255) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) setPx(data, xx, yy, color, alpha);
}

function line(data, x0, y0, x1, y1, color, alpha = 255) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    setPx(data, x0, y0, color, alpha);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function cluster(data, x, y, points, color, alpha = 255) {
  for (const [dx, dy] of points) setPx(data, x + dx, y + dy, color, alpha);
}

function waveCrest(data, x, y, len, color, alpha = 210, salt = 0) {
  for (let i = 0; i < len; i++) {
    const yy = y + Math.round(Math.sin((i + salt) * 0.72) * 1.15);
    const fade = i < 2 || i > len - 3 ? 0.55 : 1;
    setPx(data, x + i, yy, color, Math.round(alpha * fade));
    if (i % 3 === 1) setPx(data, x + i, yy + 1, 0x90dce8, Math.round(alpha * 0.36 * fade));
    if (i % 5 === 2) setPx(data, x + i, yy - 1, 0xffffff, Math.round(alpha * 0.42 * fade));
  }
}

function trough(data, x, y, len, color, alpha = 130, salt = 0) {
  for (let i = 0; i < len; i++) {
    const yy = y + Math.round(Math.sin((i + salt) * 0.55) * 1.0);
    setPx(data, x + i, yy, color, alpha);
    if (i % 2 === 0) setPx(data, x + i, yy + 1, color, Math.round(alpha * 0.55));
  }
}

async function save(name, data) {
  await sharp(data, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(path.join(OUT_DIR, name));
}

function waterTile({ name, top, bottom, accent, deep, salt }) {
  const data = makeCanvas();
  const topRgb = rgb(top);
  const bottomRgb = rgb(bottom);
  const accentRgb = rgb(accent);
  const deepRgb = rgb(deep);
  for (let y = 0; y < SIZE; y++) {
    const base = mix(topRgb, bottomRgb, y / (SIZE - 1));
    for (let x = 0; x < SIZE; x++) {
      const lane = Math.sin((x + salt * 0.37) * 0.38 + y * 0.55) * 9;
      const swell = Math.sin((x - y + salt) * 0.18) * 5;
      const n = hash(x >> 2, y >> 1, salt);
      const shift = lane + swell + ((n & 7) - 3) * 1.25;
      setPx(data, x, y, [
        Math.max(0, Math.min(255, base[0] + shift)),
        Math.max(0, Math.min(255, base[1] + shift)),
        Math.max(0, Math.min(255, base[2] + shift))
      ]);
    }
  }
  const bandYs = [5, 12, 19, 27];
  bandYs.forEach((y, idx) => {
    const offset = (hash(idx, salt, 17) % 10) - 5;
    trough(data, -3 + offset, y + (idx % 2), 19, deepRgb, 108, salt + idx);
    trough(data, 15 + offset, y - 1, 21, deepRgb, 94, salt + idx + 9);
  });
  const crestRows = [4, 10, 16, 23, 29];
  crestRows.forEach((y, idx) => {
    const x = -4 + (hash(idx, salt, 31) % 13);
    const len = 11 + (hash(idx, salt, 43) % 11);
    waveCrest(data, x, y, len, accentRgb, 175, salt + idx);
    if (idx % 2 === 0) waveCrest(data, x + 15, y + 2, 13, 0xdffff7, 128, salt + idx + 5);
  });
  for (let i = 0; i < 7; i++) {
    const x = 3 + (hash(i, salt, 71) % 25);
    const y = 3 + (hash(i, salt, 83) % 25);
    const c = i % 3 === 0 ? 0xf2fff8 : accentRgb;
    cluster(data, x, y, [[0, 0], [1, 0], [2, 1], [4, 1]], c, i % 3 === 0 ? 115 : 92);
  }
  return save(name, data);
}

function sandTile({ name, top, bottom, pebble, salt }) {
  const data = makeCanvas();
  const topRgb = rgb(top);
  const bottomRgb = rgb(bottom);
  for (let y = 0; y < SIZE; y++) {
    const base = mix(topRgb, bottomRgb, y / (SIZE - 1));
    for (let x = 0; x < SIZE; x++) {
      const n = hash(x >> 1, y >> 1, salt);
      const shift = ((n & 31) - 15) * 1.1;
      setPx(data, x, y, [
        Math.max(0, Math.min(255, base[0] + shift)),
        Math.max(0, Math.min(255, base[1] + shift)),
        Math.max(0, Math.min(255, base[2] + shift))
      ]);
    }
  }
  for (let i = 0; i < 28; i++) {
    const x = hash(i, salt, 101) % 32;
    const y = hash(i, salt, 113) % 32;
    const c = hash(i, salt, 127) % 4 === 0 ? 0xf5e0a6 : pebble;
    rect(data, x, y, hash(i, salt, 139) % 3 === 0 ? 2 : 1, 1, c, 145);
  }
  for (let i = 0; i < 3; i++) {
    const x = 6 + (hash(i, salt, 151) % 20);
    const y = 7 + (hash(i, salt, 163) % 19);
    setPx(data, x, y, 0xead7a1, 190);
    setPx(data, x + 1, y, 0x8f7243, 120);
    setPx(data, x, y + 1, 0x8f7243, 95);
  }
  return save(name, data);
}

function foamEdge(name, side) {
  const data = makeCanvas();
  const draw = (x, y, w, h, a = 190) => rect(data, x, y, w, h, 0xdffff7, a);
  const drawShadow = (x, y, w, h) => rect(data, x, y, w, h, 0x6eb8b4, 88);
  if (side === 'n' || side === 's') {
    const y = side === 'n' ? 0 : 28;
    waveCrest(data, 1, y + 2, 14, 0xf2fff8, 220, side === 'n' ? 1 : 5);
    waveCrest(data, 15, y + 1, 15, 0xdffff7, 188, side === 'n' ? 3 : 7);
    draw(5, y + 6, 7, 1, 118);
    draw(18, y + 5, 9, 1, 110);
    drawShadow(0, side === 'n' ? 4 : 27, 32, 1);
  } else {
    const x = side === 'w' ? 0 : 28;
    for (let yy = 2; yy < 15; yy++) setPx(data, x + 1 + Math.round(Math.sin(yy * 0.8) * 1), yy, 0xf2fff8, 205);
    for (let yy = 17; yy < 29; yy++) setPx(data, x + Math.round(Math.sin(yy * 0.75) * 1), yy, 0xdffff7, 172);
    draw(x + 5, 6, 1, 8, 118);
    draw(x + 4, 20, 1, 7, 108);
    drawShadow(side === 'w' ? 4 : 27, 0, 1, 32);
  }
  return save(name, data);
}

function overlay(name, kind) {
  const data = makeCanvas();
  if (kind === 'kelp') {
    rect(data, 7, 14, 2, 13, 0x476b2b, 230); rect(data, 11, 9, 2, 18, 0x6f8f38, 240); rect(data, 17, 12, 2, 15, 0x526f2d, 230);
    rect(data, 9, 13, 5, 2, 0x8fac49, 210); rect(data, 15, 17, 6, 2, 0x7fa042, 210); rect(data, 4, 21, 6, 2, 0x78983e, 190);
  } else if (kind === 'coral') {
    rect(data, 11, 18, 3, 8, 0xd05a67, 240); rect(data, 17, 15, 3, 11, 0xf08a62, 238); rect(data, 22, 19, 3, 6, 0xb84c78, 230);
    rect(data, 8, 23, 20, 3, 0x433744, 160); rect(data, 12, 16, 8, 2, 0xffb38a, 200); rect(data, 17, 13, 6, 2, 0xffc49d, 188);
  } else if (kind === 'fish') {
    [[9, 11], [16, 17], [24, 9], [20, 23]].forEach(([x, y], idx) => {
      rect(data, x, y, 4, 2, idx % 2 ? 0xd5ecff : 0xffd27a, 210);
      setPx(data, x - 1, y + 1, idx % 2 ? 0x89bde8 : 0xd89944, 185);
      setPx(data, x + 4, y + 1, 0x091b29, 90);
    });
  } else if (kind === 'rock') {
    rect(data, 8, 19, 16, 7, 0x253346, 250); rect(data, 10, 17, 11, 3, 0x5d7081, 210); rect(data, 14, 15, 6, 2, 0x8798a3, 170);
    rect(data, 5, 25, 22, 2, 0xdffff7, 68);
  } else if (kind === 'shells') {
    rect(data, 6, 16, 5, 3, 0xf3dcc2, 230); rect(data, 8, 15, 2, 1, 0xffffff, 180);
    rect(data, 20, 21, 4, 3, 0xd9a88f, 220); rect(data, 23, 17, 2, 2, 0x7d6545, 170);
    rect(data, 13, 24, 2, 1, 0xf4e6b7, 220);
  } else if (kind === 'starfish') {
    rect(data, 15, 14, 3, 8, 0xe77945, 235); rect(data, 12, 17, 9, 3, 0xe77945, 235);
    line(data, 13, 15, 19, 21, 0xf0a05e, 230); line(data, 20, 15, 13, 21, 0xc9553a, 220);
    setPx(data, 16, 18, 0xffd08a, 190);
  }
  return save(name, data);
}

await Promise.all([
  waterTile({ name: 'm_ocean_deep_a.png', top: 0x0b2239, bottom: 0x06172b, accent: 0x58b7ca, deep: 0x03101e, salt: 10 }),
  waterTile({ name: 'm_ocean_deep_b.png', top: 0x0d2c46, bottom: 0x071d31, accent: 0x69c3d0, deep: 0x041522, salt: 20 }),
  waterTile({ name: 'm_ocean_mid_a.png', top: 0x124969, bottom: 0x0d344f, accent: 0x87dce2, deep: 0x062238, salt: 30 }),
  waterTile({ name: 'm_ocean_mid_b.png', top: 0x1a5a70, bottom: 0x11415a, accent: 0x9de9e8, deep: 0x092a43, salt: 40 }),
  waterTile({ name: 'm_ocean_shallow_a.png', top: 0x2a7d84, bottom: 0x1b6070, accent: 0xc2fff0, deep: 0x0b3a53, salt: 50 }),
  waterTile({ name: 'm_ocean_shallow_b.png', top: 0x3b8f87, bottom: 0x226c78, accent: 0xd7fff4, deep: 0x124b5d, salt: 60 }),
  foamEdge('m_ocean_foam_n.png', 'n'),
  foamEdge('m_ocean_foam_e.png', 'e'),
  foamEdge('m_ocean_foam_s.png', 's'),
  foamEdge('m_ocean_foam_w.png', 'w'),
  overlay('m_ocean_kelp.png', 'kelp'),
  overlay('m_ocean_coral.png', 'coral'),
  overlay('m_ocean_fish.png', 'fish'),
  overlay('m_ocean_rock.png', 'rock')
]);

console.log('Generated ocean terrain tiles in', OUT_DIR);
