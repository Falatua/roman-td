// Phase 6 — Rome HP system.
import { describe, it, expect } from 'vitest';
import {
  createRome, romeDamageFor, queueRomeDamage, flushPendingDamage, applyRomeDamage,
  isRomeFallen, romeHpFraction, rebuildFromGold, restoreRome, romeBarColor, isRomeCritical,
} from '../src/coop/LegionRome';
import type { LeakUnit } from '../src/coop/LegionTypes';

function leak(hp: number, opts: Partial<LeakUnit> = {}): LeakUnit {
  return { enemyType: 'X', hp, maxHp: 100, faction: 'F', isBoss: false, isImmune: false, fromQuadrant: 'NW', underReqCheckpoints: false, ...opts };
}

describe('Rome HP pool (Section 5.4)', () => {
  it('starts at the player-count HP', () => {
    expect(createRome(2).maxHp).toBe(500);
    expect(createRome(3).maxHp).toBe(750);
    expect(createRome(4).maxHp).toBe(1000);
  });
});

describe('Rome damage (Section 3.4)', () => {
  it('base damage = current HP at impact', () => {
    expect(romeDamageFor(leak(80))).toBe(80);
  });
  it('boss deals 3x', () => {
    expect(romeDamageFor(leak(100, { isBoss: true }))).toBe(300);
  });
  it('immune creep deals 1.5x', () => {
    expect(romeDamageFor(leak(100, { isImmune: true }))).toBe(150);
  });
  it('boss precedence over immune', () => {
    expect(romeDamageFor(leak(100, { isBoss: true, isImmune: true }))).toBe(300);
  });
});

describe('Damage application + animation-delay queue (Q6 default B)', () => {
  it('queues then flushes pending damage', () => {
    let rome = createRome(4); // 1000
    rome = queueRomeDamage(rome, 120);
    rome = queueRomeDamage(rome, 80);
    expect(rome.hp).toBe(1000);          // not applied yet
    expect(rome.pendingDamage).toBe(200);
    rome = flushPendingDamage(rome);
    expect(rome.hp).toBe(800);
    expect(rome.pendingDamage).toBe(0);
  });
  it('clamps at zero and reports fallen', () => {
    let rome = createRome(2); // 500
    rome = applyRomeDamage(rome, 9999);
    expect(rome.hp).toBe(0);
    expect(isRomeFallen(rome)).toBe(true);
  });
});

describe('Rome rebuild (Section 6.4)', () => {
  it('50 gold restores 25 HP per step', () => {
    expect(rebuildFromGold(50)).toEqual({ hpRestored: 25, goldSpent: 50 });
    expect(rebuildFromGold(49)).toEqual({ hpRestored: 0, goldSpent: 0 });
  });
  it('restore clamps at maxHp', () => {
    let rome = applyRomeDamage(createRome(4), 100); // 900/1000
    rome = restoreRome(rome, 250);
    expect(rome.hp).toBe(1000); // clamped
  });
});

describe('HUD helpers (Section 11.2)', () => {
  it('gradient color by HP fraction', () => {
    expect(romeBarColor(createRome(4))).toBe('#66ff88');           // full green
    let rome = applyRomeDamage(createRome(4), 600); // 40%
    expect(romeBarColor(rome)).toBe('#ffd34d');                    // yellow
    rome = applyRomeDamage(createRome(4), 950); // 5%
    expect(romeBarColor(rome)).toBe('#ff3030');                    // flashing red
    expect(isRomeCritical(rome)).toBe(true);
  });
  it('hp fraction is clamped 0..1', () => {
    expect(romeHpFraction(createRome(4))).toBe(1);
    expect(romeHpFraction(applyRomeDamage(createRome(4), 9999))).toBe(0);
  });
});
