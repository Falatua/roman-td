import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const SPRITES = [
  'tcc_vanguard_wing.png',
  'tc_exploratores.png'
] as const;

function largestWhiteIsland(data: Buffer, width: number, height: number): number {
  const white = new Uint8Array(width * height);
  const seen = new Uint8Array(width * height);

  for (let pixel = 0; pixel < white.length; pixel++) {
    const offset = pixel * 4;
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const alpha = data[offset + 3];
    const minimum = Math.min(red, green, blue);
    const maximum = Math.max(red, green, blue);
    if (alpha > 32 && minimum >= 242 && maximum - minimum <= 18) white[pixel] = 1;
  }

  let largest = 0;
  for (let start = 0; start < white.length; start++) {
    if (!white[start] || seen[start]) continue;
    const queue = [start];
    seen[start] = 1;
    let area = 0;

    while (queue.length > 0) {
      const pixel = queue.pop()!;
      area++;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (white[next] && !seen[next]) {
            seen[next] = 1;
            queue.push(next);
          }
        }
      }
    }

    largest = Math.max(largest, area);
  }

  return largest;
}

describe('combo tower sprite transparency', () => {
  it.each(SPRITES)('%s has transparent negative space without generated white islands', async (sprite) => {
    const file = path.join(process.cwd(), 'public/assets/sprites', sprite);
    const image = sharp(file).ensureAlpha();
    const metadata = await image.metadata();
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(512);
    expect(metadata.hasAlpha).toBe(true);

    const cornerAlpha = [
      data[3],
      data[(info.width - 1) * 4 + 3],
      data[((info.height - 1) * info.width) * 4 + 3],
      data[((info.height * info.width) - 1) * 4 + 3]
    ];
    expect(cornerAlpha).toEqual([0, 0, 0, 0]);

    let visiblePixels = 0;
    let brightDetailPixels = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
      const alpha = data[offset + 3];
      if (alpha > 16) visiblePixels++;
      if (alpha > 32 && Math.min(data[offset], data[offset + 1], data[offset + 2]) >= 242) {
        brightDetailPixels++;
      }
    }

    const coverage = visiblePixels / (info.width * info.height);
    expect(coverage).toBeGreaterThan(0.25);
    expect(coverage).toBeLessThan(0.7);
    expect(brightDetailPixels).toBeGreaterThan(20);
    expect(largestWhiteIsland(data, info.width, info.height)).toBeLessThan(100);
  });
});

const TROPHY_SPRITES = [
  'naval/t_tideforged_giant_killer.png',
  't_giants_cohort_guard.png',
  'naval/t_naval_trireme_ballista.png',
  'naval/t_naval_ramming_quinquereme.png',
  'naval/t_tideforged_praetorian_fleet.png',
  'naval/t_tideforged_mars_tidal_bastion.png'
] as const;

describe('giant and sea-beast trophy tower sprites', () => {
  it.each(TROPHY_SPRITES)('%s keeps map-scale art on a clean transparent canvas', async (sprite) => {
    const file = path.join(process.cwd(), 'public/assets/sprites', sprite);
    const image = sharp(file).ensureAlpha();
    const metadata = await image.metadata();
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

    expect(metadata.width).toBe(128);
    expect(metadata.height).toBe(128);
    expect(metadata.hasAlpha).toBe(true);

    const cornerAlpha = [
      data[3],
      data[(info.width - 1) * 4 + 3],
      data[((info.height - 1) * info.width) * 4 + 3],
      data[((info.height * info.width) - 1) * 4 + 3]
    ];
    expect(cornerAlpha).toEqual([0, 0, 0, 0]);

    let visiblePixels = 0;
    let partialAlphaPixels = 0;
    let chromaResiduePixels = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const alpha = data[offset + 3];
      if (alpha > 16) {
        visiblePixels++;
        const greenKey = green > 180 && red < 80 && blue < 80;
        const magentaKey = red > 180 && blue > 180 && green < 80;
        if (greenKey || magentaKey) chromaResiduePixels++;
      }
      if (alpha > 0 && alpha < 255) partialAlphaPixels++;
    }

    const coverage = visiblePixels / (info.width * info.height);
    expect(coverage).toBeGreaterThan(0.30);
    expect(coverage).toBeLessThan(0.62);
    expect(partialAlphaPixels).toBeLessThan(220);
    expect(chromaResiduePixels).toBe(0);
  });
});
