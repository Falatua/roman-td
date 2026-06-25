import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { bossWarningPortraitForWave, isVerifiedBossWave } from '../src/render/BossWarning';

const VERIFIED_BOSS_WAVES = [5, 10, 20, 21, 24, 25, 27, 30];

describe('boss warning portraits', () => {
  it('gates the intended Solo boss waves', () => {
    for (const wave of VERIFIED_BOSS_WAVES) {
      expect(isVerifiedBossWave(wave)).toBe(true);
    }
    for (const wave of [1, 4, 6, 15, 22, 29, 31]) {
      expect(isVerifiedBossWave(wave)).toBe(false);
    }
  });

  it('uses dedicated boss portrait art for every verified boss wave', () => {
    for (const wave of VERIFIED_BOSS_WAVES) {
      const portrait = String(bossWarningPortraitForWave(wave) ?? '');
      expect(portrait, `wave ${wave}`).toMatch(/^assets\/bosses\/boss_.*\.png$/);
      expect(existsSync(path.join(process.cwd(), 'public', portrait)), `wave ${wave}`).toBe(true);
    }
  });
});
