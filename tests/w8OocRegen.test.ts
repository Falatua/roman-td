// W8 out-of-combat regen cut (2026-05-29).
// Per user request: "decrease the out-of-combat health regen on Wave 8 by
// 1.5%." Implemented as a wave-scoped, subtractive cut (__w8OocRegenCut =
// 0.015) stamped at spawn for wave 8 only, applied in tickEnemies and
// floored at 0 so enemies with no OOC regen are never granted any.
//
// These tests drive the real EnemySystem.tickEnemies regen path (same
// harness as dotCap.test.ts) and assert the cut math + the zero-floor.
import { describe, it, expect, beforeAll } from 'vitest';
import { createGameState } from '../src/GameState';
import { tickEnemies } from '../src/systems/EnemySystem';
import { Enemy, EnemyFaction, EnemyType } from '../src/types';

// tickEnemies' DoT floating-number block touches `window`; stub it in node.
beforeAll(() => {
  if (typeof (globalThis as any).window === 'undefined') (globalThis as any).window = {};
});

function makeEnemy(maxHp: number, type: EnemyType = EnemyType.CARTHAGE_ELITE_GUARD): Enemy {
  return {
    id: 't' + Math.random().toString(36).slice(2, 7),
    type, faction: EnemyFaction.CARTHAGE,
    hp: maxHp, maxHp,
    baseSpeed: 0, currentSpeed: 0,
    isFlyer: false, x: 320, y: 320,
    pathIndex: 0, pathProgress: 0,
    statusEffects: [],
    hasFeared: false, livesCost: 1, isBoss: false, reward: 0,
    archetype: 'SWARM', hpFlashTimer: 0,
    lastDamagedTick: -999,   // OOC quiet-window already passed
  } as Enemy;
}

describe('W8 out-of-combat regen cut', () => {
  it('subtracts 1.5 percentage points from a regenerating enemy', () => {
    const s = createGameState();
    const e = makeEnemy(1000);
    e.hp = 500;                               // damaged so regen has headroom
    (e as any).outOfCombatRegen = 0.05;       // 5%/sec synthetic OOC regen
    (e as any).__w8OocRegenCut = 0.015;       // the W8 stamp
    s.enemies.set(e.id, e);
    tickEnemies(s, 1.0, () => {}, () => {});
    // 5% - 1.5% = 3.5%/sec → +35 HP over 1s on a 1000-maxHp enemy.
    expect(e.hp).toBeGreaterThan(500 + 34);
    expect(e.hp).toBeLessThan(500 + 36);
  });

  it('regens MORE without the cut (baseline check, same enemy)', () => {
    const s = createGameState();
    const e = makeEnemy(1000);
    e.hp = 500;
    (e as any).outOfCombatRegen = 0.05;       // no __w8OocRegenCut stamp
    s.enemies.set(e.id, e);
    tickEnemies(s, 1.0, () => {}, () => {});
    // Full 5%/sec → +50 HP. Confirms the cut above is what reduced it.
    expect(e.hp).toBeGreaterThan(500 + 49);
    expect(e.hp).toBeLessThan(500 + 51);
  });

  it('never grants regen to an enemy that has none (floored at 0)', () => {
    const s = createGameState();
    // Carthage Spearman has no def OOC regen (unlike the Elite Guard) —
    // exactly the W8 case the floor protects.
    const e = makeEnemy(1000, EnemyType.CARTHAGE_SPEARMAN);
    e.hp = 500;
    (e as any).__w8OocRegenCut = 0.015;
    s.enemies.set(e.id, e);
    tickEnemies(s, 1.0, () => {}, () => {});
    expect(e.hp).toBe(500);                   // unchanged — no regen granted
  });

  it('models the live Elite Guard: 4.9%/sec → 3.4%/sec', () => {
    const s = createGameState();
    const e = makeEnemy(1000);
    e.hp = 500;
    (e as any).outOfCombatRegen = 0.049;      // Carthage Elite Guard base
    (e as any).__w8OocRegenCut = 0.015;
    s.enemies.set(e.id, e);
    tickEnemies(s, 1.0, () => {}, () => {});
    // 4.9% - 1.5% = 3.4%/sec → +34 HP.
    expect(e.hp).toBeGreaterThan(500 + 33);
    expect(e.hp).toBeLessThan(500 + 35);
  });
});
