import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { EnemyType } from '../src/types';
import {
  advanceEnemyMovementPhase,
  enemyMovementAnimation,
  enemyMovementFps,
  enemyMovementFrame
} from '../src/render/EnemyMovementAnimations';

const SHEET_PATH = path.resolve('public/assets/sprites/e1_alpha_dog_run_sheet.png');

async function frameAlphaBounds(frame: number) {
  const cell = 256;
  const { data } = await sharp(SHEET_PATH)
    .extract({ left: (frame % 3) * cell, top: Math.floor(frame / 3) * cell, width: cell, height: cell })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = cell;
  let minY = cell;
  let maxX = -1;
  let maxY = -1;
  let greenResidue = 0;
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < cell; x++) {
      const offset = (y * cell + x) * 4;
      const [r, g, b, a] = data.subarray(offset, offset + 4);
      if (a >= 32) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        if (g > 235 && r < 45 && b < 45) greenResidue++;
      }
    }
  }
  return {
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    centerX: (minX + maxX) / 2,
    bottom: maxY,
    greenResidue
  };
}

describe('Alpha Dog authored movement animation', () => {
  it('uses an eight-frame speed-scaled run loop and preserves the idle fallback', () => {
    const spec = enemyMovementAnimation(EnemyType.ALPHA_DOG);
    expect(spec).not.toBeNull();
    expect(spec).toMatchObject({
      sheetKey: 'ALPHA_DOG_RUN_SHEET',
      frameWidth: 256,
      frameHeight: 256,
      columns: 3,
      runFrames: 8,
      replacesProceduralStride: true
    });
    expect(enemyMovementFps(spec!, 2)).toBe(10);
    expect(enemyMovementFps(spec!, 0.5)).toBe(6);
    expect(enemyMovementFps(spec!, 4)).toBe(14);
    expect(advanceEnemyMovementPhase(spec!, 7.8, 0.1, 2)).toBeCloseTo(0.8, 6);
    expect(advanceEnemyMovementPhase(spec!, 3.2, 0.2, 0)).toBe(0);
    expect(enemyMovementFrame(spec!, 7.99)).toBe(7);
  });

  it('ships a clean 3x3 transparent sheet with stable scale and anchors', async () => {
    expect(fs.existsSync(SHEET_PATH)).toBe(true);
    const metadata = await sharp(SHEET_PATH).metadata();
    expect(metadata).toMatchObject({ width: 768, height: 768, channels: 4, hasAlpha: true });

    const bounds = await Promise.all(Array.from({ length: 9 }, (_, frame) => frameAlphaBounds(frame)));
    for (const [index, box] of bounds.entries()) {
      expect(box.width, `frame ${index + 1} width`).toBeGreaterThanOrEqual(180);
      expect(box.height, `frame ${index + 1} height`).toBeGreaterThanOrEqual(125);
      expect(box.centerX, `frame ${index + 1} horizontal anchor`).toBeGreaterThanOrEqual(126);
      expect(box.centerX, `frame ${index + 1} horizontal anchor`).toBeLessThanOrEqual(130);
      expect(box.greenResidue, `frame ${index + 1} chroma residue`).toBe(0);
    }

    const groundedFrames = [0, 1, 4, 6, 8];
    for (const frame of groundedFrames) {
      expect(bounds[frame].bottom, `frame ${frame + 1} ground anchor`).toBeGreaterThanOrEqual(219);
      expect(bounds[frame].bottom, `frame ${frame + 1} ground anchor`).toBeLessThanOrEqual(223);
    }
    expect(bounds[3].bottom).toBeLessThan(bounds[0].bottom - 15);
    expect(bounds[7].bottom).toBeLessThan(bounds[0].bottom - 15);
  });
});
