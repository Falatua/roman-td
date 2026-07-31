import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function towerAssetMap(): Record<string, string> {
  const source = readFileSync(path.join(process.cwd(), 'src/render/Assets.ts'), 'utf8');
  const out: Record<string, string> = {};
  for (const match of source.matchAll(/\b([A-Z0-9_]+):\s*'([^']+\.png)'/g)) {
    out[match[1]] = match[2];
  }
  return out;
}

async function silhouetteMask(file: string) {
  const sharp = (await import('sharp')).default;
  const { data } = await sharp(file)
    .resize(64, 64, { fit: 'contain' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mask: number[] = [];
  for (let i = 3; i < data.length; i += 4) mask.push(data[i] > 24 ? 1 : 0);
  return mask;
}

async function alphaBounds(file: string) {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[((y * info.width + x) * 4) + 3] <= 8) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX + 1),
    height: Math.max(0, maxY - minY + 1)
  };
}

function silhouetteOverlap(a: number[], b: number[]) {
  let shared = 0;
  let combined = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] || b[i]) combined++;
    if (a[i] && b[i]) shared++;
  }
  return combined > 0 ? shared / combined : 0;
}

describe('cavalry tower sprite distinction', () => {
  it('keeps Clibanarius visually distinct from Cataphract with a clean transparent asset', async () => {
    const sharp = (await import('sharp')).default;
    const assets = towerAssetMap();
    const spriteDir = path.join(process.cwd(), 'public/assets/sprites');
    const cataphractFile = path.join(spriteDir, assets.CATAPHRACT);
    const clibanariusFile = path.join(spriteDir, assets.CLIBANARIUS);

    expect(assets.CATAPHRACT).toBe('t_new_cataphract.png');
    expect(assets.CLIBANARIUS).toBe('t_new_clibanarius_v3.png');

    const meta = await sharp(clibanariusFile).metadata();
    const { data, info } = await sharp(clibanariusFile)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let visible = 0;
    let tinyAlpha = 0;
    let chromaMagenta = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha > 0 && alpha <= 4) tinyAlpha++;
      if (alpha > 16) {
        visible++;
        if (data[i] > 150 && data[i + 2] > 150
          && data[i] > data[i + 1] * 1.45
          && data[i + 2] > data[i + 1] * 1.45) {
          chromaMagenta++;
        }
      }
    }

    const corners = [
      data[3],
      data[((info.width - 1) * 4) + 3],
      data[(((info.height - 1) * info.width) * 4) + 3],
      data[(((info.width * info.height) - 1) * 4) + 3]
    ];
    const cataphractMask = await silhouetteMask(cataphractFile);
    const clibanariusMask = await silhouetteMask(clibanariusFile);
    const clibanariusBounds = await alphaBounds(clibanariusFile);
    const cavalryBounds = await Promise.all([
      alphaBounds(path.join(spriteDir, assets.CATAPHRACT)),
      alphaBounds(path.join(spriteDir, assets.HORSEMAN)),
      alphaBounds(path.join(spriteDir, assets.RORARIUS)),
      alphaBounds(path.join(spriteDir, assets.NUMIDIAN_CAVALRY))
    ]);

    expect(meta).toMatchObject({ width: 256, height: 214, hasAlpha: true });
    expect(Math.max(...corners), 'Clibanarius corners should remain transparent').toBe(0);
    expect(visible / (info.width * info.height), 'Clibanarius should remain readable at board scale').toBeGreaterThan(0.25);
    expect(tinyAlpha, 'Clibanarius should not leave alpha dust around the silhouette').toBe(0);
    expect(chromaMagenta, 'Clibanarius should not retain its generation background').toBe(0);
    expect(
      silhouetteOverlap(cataphractMask, clibanariusMask),
      'Clibanarius should not reuse the Cataphract silhouette'
    ).toBeLessThan(0.75);
    expect(
      clibanariusBounds.width / clibanariusBounds.height,
      'Clibanarius should keep its compact upright armored-fortress silhouette'
    ).toBeLessThan(0.9);
    for (const bounds of cavalryBounds) {
      expect(
        bounds.width / bounds.height - clibanariusBounds.width / clibanariusBounds.height,
        'Clibanarius should remain substantially taller and more compact than ordinary cavalry'
      ).toBeGreaterThan(0.18);
    }
    expect(clibanariusBounds.minY, 'The upright kontos should remain visible above the rider').toBeLessThanOrEqual(8);
    expect(clibanariusBounds.height, 'The complete rider, horse, lance, and hooves should remain visible').toBeGreaterThan(195);
  });
});

describe('Vulcan Bombard sprite distinction', () => {
  it('uses a clean compact forge-mortar silhouette below the Vulcan Colossus', async () => {
    const sharp = (await import('sharp')).default;
    const assets = towerAssetMap();
    const spriteDir = path.join(process.cwd(), 'public/assets/sprites');
    const bombardFile = path.join(spriteDir, assets.VULCAN_BOMBARD);
    const oldBombardFile = path.join(spriteDir, 'tc_vulcan_bombard.png');
    const colossusFile = path.join(spriteDir, assets.VULCAN_COLOSSUS);

    expect(assets.VULCAN_BOMBARD).toBe('tc_vulcan_bombard_v2.png');

    const meta = await sharp(bombardFile).metadata();
    const { data, info } = await sharp(bombardFile)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let visible = 0;
    let tinyAlpha = 0;
    let chromaMagenta = 0;
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha > 0 && alpha <= 4) tinyAlpha++;
      if (alpha > 16) {
        visible++;
        if (data[i] > 150 && data[i + 2] > 150
          && data[i] > data[i + 1] * 1.45
          && data[i + 2] > data[i + 1] * 1.45) {
          chromaMagenta++;
        }
      }
    }

    const corners = [
      data[3],
      data[((info.width - 1) * 4) + 3],
      data[(((info.height - 1) * info.width) * 4) + 3],
      data[(((info.width * info.height) - 1) * 4) + 3]
    ];
    const bombardMask = await silhouetteMask(bombardFile);
    const oldBombardMask = await silhouetteMask(oldBombardFile);
    const colossusMask = await silhouetteMask(colossusFile);
    const bounds = await alphaBounds(bombardFile);

    expect(meta).toMatchObject({ width: 512, height: 512, hasAlpha: true });
    expect(Math.max(...corners), 'Vulcan Bombard corners should remain transparent').toBe(0);
    expect(visible / (info.width * info.height), 'Vulcan Bombard should remain readable at board scale')
      .toBeGreaterThan(0.35);
    expect(visible / (info.width * info.height), 'Vulcan Bombard should retain transparent breathing room')
      .toBeLessThan(0.55);
    expect(tinyAlpha, 'Vulcan Bombard should not leave alpha dust around the silhouette').toBe(0);
    expect(chromaMagenta, 'Vulcan Bombard should not retain its generation background').toBe(0);
    expect(silhouetteOverlap(bombardMask, oldBombardMask), 'The replacement should not reuse the old catapult silhouette')
      .toBeLessThan(0.70);
    expect(silhouetteOverlap(bombardMask, colossusMask), 'The Tier 3 Bombard should remain distinct from Vulcan Colossus')
      .toBeLessThan(0.68);
    expect(bounds.minX).toBeGreaterThanOrEqual(35);
    expect(bounds.minY).toBeGreaterThanOrEqual(12);
    expect(bounds.maxX).toBeLessThanOrEqual(476);
    expect(bounds.maxY).toBeLessThanOrEqual(496);
  });
});
