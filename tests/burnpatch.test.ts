// Tests for the burning ground mechanic.
import { describe, it, expect } from 'vitest';
import { createGameState } from '../src/GameState';
import { tickBurnPatches } from '../src/systems/EnemySystem';
import {
  DOT_DURATION_MULT,
  TOWER_STUN_DURATION_MULT,
  extendedDotDuration,
  extendedTowerStunDuration,
  pushStatus,
  spawnBurnPatch
} from '../src/systems/CombatResolver';
import { Enemy, EnemyFaction, EnemyType, StatusEffectKind } from '../src/types';

function makeEnemy(x: number, y: number): Enemy {
  return {
    id: 'e1', type: EnemyType.FERAL_DOG, faction: EnemyFaction.DOGS,
    hp: 1000, maxHp: 1000, baseSpeed: 1, currentSpeed: 1, isFlyer: false,
    x, y, pathIndex: 0, pathProgress: 0, statusEffects: [],
    hasFeared: false, livesCost: 1, isBoss: false, reward: 0,
    archetype: 'SWARM', hpFlashTimer: 0
  };
}

describe('Burning Ground patches', () => {
  it('extends finite DoTs by 10% without changing control or permanent effects', () => {
    expect(DOT_DURATION_MULT).toBe(1.10);
    expect(extendedDotDuration(StatusEffectKind.BURN, 4)).toBeCloseTo(4.4, 6);
    expect(extendedDotDuration(StatusEffectKind.POISON, 5)).toBeCloseTo(5.5, 6);
    expect(extendedDotDuration(StatusEffectKind.BLEED, 8)).toBeCloseTo(8.8, 6);
    expect(extendedDotDuration(StatusEffectKind.SLOW, 4)).toBe(4);
    expect(extendedDotDuration(StatusEffectKind.HELLFIRE, 999)).toBe(999);

    const enemy = makeEnemy(100, 100);
    pushStatus(enemy, StatusEffectKind.POISON, 5, 0.05, 1);
    pushStatus(enemy, StatusEffectKind.SLOW, 5, 0.50, 1);
    expect(enemy.statusEffects.find(s => s.kind === StatusEffectKind.POISON)?.remaining).toBeCloseTo(5.5, 6);
    expect(enemy.statusEffects.find(s => s.kind === StatusEffectKind.SLOW)?.remaining).toBe(5);
  });

  it('extends newly spawned burning ground by the same 10%', () => {
    const state = createGameState();
    spawnBurnPatch(state, 100, 100, 3, 4);
    expect(state.burnPatches?.[0]?.life).toBeCloseTo(4.4, 6);
  });

  it('decays patches over time and removes them when life <= 0', () => {
    const s = createGameState();
    s.burnPatches = [{ id: 'p1', x: 50, y: 50, born: 0, life: 0.5, sourceTier: 1 }];
    tickBurnPatches(s, 0.6);     // overshoot
    expect(s.burnPatches.length).toBe(0);
  });

  it('burns enemies standing inside a patch', () => {
    const s = createGameState();
    const e = makeEnemy(100, 100);
    s.enemies.set(e.id, e);
    s.burnPatches = [{ id: 'p1', x: 100, y: 100, born: 0, life: 3, sourceTier: 1 }];
    const startHp = e.hp;
    tickBurnPatches(s, 0.5);     // half a second
    expect(e.hp).toBeLessThan(startHp);
  });

  it('does NOT burn enemies outside a patch', () => {
    const s = createGameState();
    const e = makeEnemy(500, 500);    // far from patch
    s.enemies.set(e.id, e);
    s.burnPatches = [{ id: 'p1', x: 100, y: 100, born: 0, life: 3, sourceTier: 1 }];
    const startHp = e.hp;
    tickBurnPatches(s, 0.5);
    expect(e.hp).toBe(startHp);
  });

  it('higher source tier deals more burn damage', () => {
    const s1 = createGameState();
    const e1 = makeEnemy(100, 100);
    s1.enemies.set(e1.id, e1);
    s1.burnPatches = [{ id: 'p1', x: 100, y: 100, born: 0, life: 3, sourceTier: 1 }];
    tickBurnPatches(s1, 0.5);
    const dmgT1 = 1000 - e1.hp;

    const s5 = createGameState();
    const e5 = makeEnemy(100, 100);
    s5.enemies.set(e5.id, e5);
    s5.burnPatches = [{ id: 'p5', x: 100, y: 100, born: 0, life: 3, sourceTier: 5 }];
    tickBurnPatches(s5, 0.5);
    const dmgT5 = 1000 - e5.hp;

    expect(dmgT5).toBeGreaterThan(dmgT1);
  });

  it('handles missing burnPatches array gracefully', () => {
    const s = createGameState();
    s.burnPatches = undefined;
    expect(() => tickBurnPatches(s, 0.1)).not.toThrow();
  });
});

describe('Tower stun duration', () => {
  it('extends tower-origin stuns by 20% without changing other control effects', () => {
    expect(TOWER_STUN_DURATION_MULT).toBe(1.20);
    expect(extendedTowerStunDuration(StatusEffectKind.STUN, 1)).toBeCloseTo(1.2, 6);
    expect(extendedTowerStunDuration(StatusEffectKind.FREEZE, 1)).toBe(1);
    expect(extendedTowerStunDuration(StatusEffectKind.SLOW, 1)).toBe(1);
  });

  it('applies the longer stun through the shared status pipeline', () => {
    delete (globalThis as any).__game;
    delete (globalThis as any).__lastState;
    const enemy = makeEnemy(100, 100);

    pushStatus(enemy, StatusEffectKind.STUN, 1, 0, 1);

    expect(enemy.statusEffects.find(s => s.kind === StatusEffectKind.STUN)?.remaining).toBeCloseTo(1.2, 6);
  });

  it('keeps bosses and stun-immune enemies immune', () => {
    delete (globalThis as any).__game;
    delete (globalThis as any).__lastState;
    const boss = makeEnemy(100, 100);
    boss.isBoss = true;
    pushStatus(boss, StatusEffectKind.STUN, 1, 0, 1);
    expect(boss.statusEffects).toHaveLength(0);

    const immune = makeEnemy(100, 100);
    immune.type = EnemyType.UNDEAD_BERSERKER;
    pushStatus(immune, StatusEffectKind.STUN, 1, 0, 1);
    expect(immune.statusEffects).toHaveLength(0);
  });
});
