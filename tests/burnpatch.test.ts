// Tests for the burning ground mechanic.
import { describe, it, expect } from 'vitest';
import { createGameState } from '../src/GameState';
import { tickBurnPatches } from '../src/systems/EnemySystem';
import { Enemy, EnemyFaction, EnemyType } from '../src/types';

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
