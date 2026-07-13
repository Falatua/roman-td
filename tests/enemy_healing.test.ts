import { describe, expect, it } from 'vitest';
import { ENEMY_HEALTH_REGEN_MULT, scaledEnemyRegenRate } from '../src/systems/EnemyHealing';

describe('global enemy regeneration balance', () => {
  it('reduces authored enemy and boss regeneration rates by exactly 20 percent', () => {
    expect(ENEMY_HEALTH_REGEN_MULT).toBe(0.80);
    expect(scaledEnemyRegenRate(0.05)).toBeCloseTo(0.04, 8);
    expect(scaledEnemyRegenRate(0.004)).toBeCloseTo(0.0032, 8);
  });

  it('never turns missing or invalid regeneration into healing', () => {
    expect(scaledEnemyRegenRate(undefined)).toBe(0);
    expect(scaledEnemyRegenRate(null)).toBe(0);
    expect(scaledEnemyRegenRate(-0.10)).toBe(0);
  });
});
