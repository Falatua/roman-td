import { beforeAll, describe, expect, it } from 'vitest';
import { createGameState } from '../src/GameState';
import {
  applyDamageAndStatus,
  EPIC_ITEM_REGEN_DENIAL_SEC
} from '../src/systems/CombatResolver';
import { tickEnemies } from '../src/systems/EnemySystem';
import { createTower } from '../src/systems/TowerSystem';
import {
  Enemy,
  EnemyFaction,
  EnemyType,
  TowerType
} from '../src/types';

beforeAll(() => {
  if (typeof (globalThis as any).window === 'undefined') {
    (globalThis as any).window = {};
  }
});

function regeneratingEnemy(id: string): Enemy {
  return {
    id,
    type: EnemyType.WAR_ELEPHANT,
    faction: EnemyFaction.CARTHAGE,
    hp: 500,
    maxHp: 1000,
    baseSpeed: 0,
    currentSpeed: 0,
    isFlyer: false,
    x: 320,
    y: 320,
    pathIndex: 0,
    pathProgress: 0,
    statusEffects: [],
    hasFeared: false,
    livesCost: 1,
    isBoss: false,
    reward: 0,
    archetype: 'SWARM',
    hpFlashTimer: 0,
    lastDamagedTick: -999
  };
}

function hitWithEpicItem(itemId: string, hitCount: number): {
  state: ReturnType<typeof createGameState>;
  enemy: Enemy;
} {
  const state = createGameState();
  state.wave = 30;
  state.tick = 20;
  const tower = createTower(TowerType.MILITES, 1, 5, 5, state.wave);
  tower.equippedItems.push(itemId);
  (tower as any).__hitCount = hitCount;
  const enemy = regeneratingEnemy(`${itemId}-target`);
  state.enemies.set(enemy.id, enemy);

  applyDamageAndStatus(state, tower, enemy, 1, {
    onKill: () => {},
    onHit: () => {},
    onMeleeSwing: () => {},
    onProjectileFire: () => {}
  });

  return { state, enemy };
}

describe('Epic item regeneration denial', () => {
  it('makes Necrotic Longsword suppress live wave regeneration while hits continue', () => {
    const { state, enemy } = hitWithEpicItem('NECROTIC_LONGSWORD', 1);
    const hpAfterHit = enemy.hp;
    const control = regeneratingEnemy('necrotic-unblocked-control');
    control.hp = hpAfterHit;
    control.lastDamagedTick = enemy.lastDamagedTick;
    state.enemies.set(control.id, control);

    expect((enemy as any).__healingBlockedUntil).toBe(
      state.tick + EPIC_ITEM_REGEN_DENIAL_SEC.NECROTIC_LONGSWORD
    );
    tickEnemies(state, 1, () => {}, () => {});
    expect(enemy.hp).toBe(hpAfterHit);
    expect(control.hp).toBeGreaterThan(hpAfterHit);
  });

  it('makes Gallic Shield Boss create a stronger fourth-hit suppression window', () => {
    const { state, enemy } = hitWithEpicItem('GALLIC_SHIELD_BOSS', 4);
    const hpAfterHit = enemy.hp;
    const control = regeneratingEnemy('shield-unblocked-control');
    control.hp = hpAfterHit;
    control.lastDamagedTick = enemy.lastDamagedTick;
    state.enemies.set(control.id, control);

    expect((enemy as any).__healingBlockedUntil).toBe(
      state.tick + EPIC_ITEM_REGEN_DENIAL_SEC.GALLIC_SHIELD_BOSS
    );
    tickEnemies(state, 1, () => {}, () => {});
    expect(enemy.hp).toBe(hpAfterHit);
    expect(control.hp).toBeGreaterThan(hpAfterHit);
  });
});
