import { describe, expect, it, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import enemiesData from '../src/data/enemies.json';
import { createGameState } from '../src/GameState';
import { initializeGrid } from '../src/systems/GridManager';
import { buildFlyerPath, buildGroundPath, buildGroundPathB } from '../src/systems/PathFinder';
import { enemyDamageMultiplier, statusEffectiveness } from '../src/systems/EnemyResistances';
import { spawnEnemy, tickEnemies } from '../src/systems/EnemySystem';
import { DamageType, EnemyType, StatusEffectKind } from '../src/types';

function bootstrapState() {
  const state = createGameState();
  initializeGrid(state);
  const path = buildGroundPath(state);
  if (path) state.groundPath = path;
  const pathB = buildGroundPathB(state);
  if (pathB) state.groundPathB = pathB;
  state.flyerPath = buildFlyerPath();
  state.wave = 23;
  return state;
}

describe('late-campaign variety roster', () => {
  beforeEach(() => {
    (globalThis as any).window = (globalThis as any).window ?? {};
    (globalThis as any).window.__renderer = { triggerSpawnPuff: () => {} };
  });

  it('has real data and sprite files for the new enemy trio', () => {
    const expected = [
      ['SIEGE_WAGON', 'e3_siege_wagon.png'],
      ['DUNE_STALKER', 'e3_dune_stalker.png'],
      ['STONE_JUGGERNAUT', 'e3_stone_juggernaut.png']
    ] as const;

    for (const [type, file] of expected) {
      expect((enemiesData as any)[type], `${type} data missing`).toBeTruthy();
      expect(existsSync(path.join(process.cwd(), 'public/assets/sprites', file)), `${file} missing`).toBe(true);
    }
    expect((enemiesData as any).DUNE_STALKER.lowHpSpeedBoost).toBeGreaterThan(1);
    expect((enemiesData as any).SIEGE_WAGON.deathBurst).toMatchObject({
      type: 'DUNE_STALKER',
      count: 30,
      hpFrac: 0.4
    });
  });

  it('wires the intended counters for the new enemy trio', () => {
    const state = bootstrapState();
    const wagon = spawnEnemy(state, EnemyType.SIEGE_WAGON, 1);
    const stalker = spawnEnemy(state, EnemyType.DUNE_STALKER, 1);
    const juggernaut = spawnEnemy(state, EnemyType.STONE_JUGGERNAUT, 1);

    expect(enemyDamageMultiplier(wagon, DamageType.SIEGE)).toBeGreaterThan(1);
    expect(enemyDamageMultiplier(juggernaut, DamageType.DIVINE)).toBeGreaterThan(1);
    expect(statusEffectiveness(stalker, StatusEffectKind.SLOW)).toBeLessThan(1);
  });

  it('cracks Siege Wagons into thirty non-chaining Dune Stalkers', () => {
    const state = bootstrapState();
    const wagon = spawnEnemy(state, EnemyType.SIEGE_WAGON, 1);
    wagon.pathIndex = 3;
    wagon.pathProgress = 0.4;
    wagon.hp = 0;

    const deaths: EnemyType[] = [];
    tickEnemies(state, 0.016, () => {}, enemy => { deaths.push(enemy.type); });

    const stalkers = Array.from(state.enemies.values()).filter(e => e.type === EnemyType.DUNE_STALKER);
    expect(deaths).toEqual([EnemyType.SIEGE_WAGON]);
    expect(stalkers).toHaveLength(30);
    expect(stalkers.every(e => e.__reanimated)).toBe(true);
    expect(stalkers.every(e => e.pathIndex === 3 && e.pathProgress === 0.4)).toBe(true);
    expect(state.hint).toContain('30 skirmishers');
  });
});
