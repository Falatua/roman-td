import { beforeAll, describe, expect, it } from 'vitest';
import { createGameState } from '../src/GameState';
import { buildFlyerPath, buildGroundPath, buildGroundPathB } from '../src/systems/PathFinder';
import { initializeGrid } from '../src/systems/GridManager';
import { spawnEnemy } from '../src/systems/EnemySystem';
import { campaignPressureResistMult } from '../src/systems/CampaignDifficulty';
import { armorProfileForEnemy, enemyDamageMultiplier, statusEffectiveness } from '../src/systems/EnemyResistances';
import { resistanceModifier } from '../src/systems/DamageTypeSystem';
import { DamageType, EnemyType, StatusEffectKind } from '../src/types';

beforeAll(() => {
  if (typeof (globalThis as any).window === 'undefined') {
    (globalThis as any).window = {};
  }
});

function stateForWave(wave: number) {
  const state = createGameState();
  initializeGrid(state);
  state.groundPath = buildGroundPath(state)!;
  state.groundPathB = buildGroundPathB(state) ?? [];
  state.flyerPath = buildFlyerPath();
  state.wave = wave;
  return state;
}

describe('linear campaign resistance curve', () => {
  it('starts Wave 1 Feral Dogs with no soft resistance', () => {
    const enemy = spawnEnemy(stateForWave(1), EnemyType.FERAL_DOG, 1);

    for (const damageType of [
      DamageType.PHYS_MELEE,
      DamageType.PHYS_RANGED,
      DamageType.SIEGE,
      DamageType.DIVINE
    ]) {
      const finalMult = resistanceModifier(enemy.faction, damageType)
        * enemyDamageMultiplier(enemy, damageType);
      expect(finalMult, DamageType[damageType]).toBeCloseTo(1, 8);
    }
    expect(statusEffectiveness(enemy, StatusEffectKind.POISON)).toBeCloseTo(1, 8);
    expect((enemy as any).__lateResistMult).toBe(1);
  });

  it('gives ground enemies, flyers, bosses, and derived spawns the same wave layer', () => {
    const state = stateForWave(30);
    const expected = campaignPressureResistMult(30);
    const enemies = [
      spawnEnemy(state, EnemyType.FERAL_DOG, 1),
      spawnEnemy(state, EnemyType.OCEAN_FISHLING, 1),
      spawnEnemy(state, EnemyType.ALPHA_DOG, 1),
      spawnEnemy(state, EnemyType.REANIMATED_ZOMBIE, 1, true)
    ];

    expect(expected).toBeCloseTo(0.565, 8);
    for (const enemy of enemies) {
      expect((enemy as any).__lateResistMult, enemy.type).toBeCloseTo(expected, 8);
    }
    expect(
      armorProfileForEnemy(enemies[0]).find(row => row.damageType === 'PHYS_MELEE')?.armorPct
    ).toBe(44);
  });

  it('preserves hard immunities on top of the linear wave layer', () => {
    const enemy = spawnEnemy(stateForWave(30), EnemyType.CELTIC_FIRE_DEMON, 1);

    const finalFireMult = resistanceModifier(enemy.faction, DamageType.ELEMENTAL_FIRE)
      * enemyDamageMultiplier(enemy, DamageType.ELEMENTAL_FIRE);
    expect(finalFireMult).toBe(0);
    expect(statusEffectiveness(enemy, StatusEffectKind.BURN)).toBe(0);
  });
});
