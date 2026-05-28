// Phase 2 — session config + difficulty scaling.
import { describe, it, expect } from 'vitest';
import { resolveSessionConfig, canStartLegion, MIN_PLAYERS, MAX_PLAYERS } from '../src/coop/LegionSession';
import {
  scaledEnemyHp, scaledEnemySpeed, romeStartingHp, totalWaveCount, distributeAcrossCorners,
} from '../src/coop/LegionScaling';

describe('Session config (Section 8.4)', () => {
  it('requires 2-4 players', () => {
    expect(canStartLegion(1)).toBe(false);
    expect(canStartLegion(2)).toBe(true);
    expect(canStartLegion(4)).toBe(true);
    expect(canStartLegion(5)).toBe(false);
    expect(MIN_PLAYERS).toBe(2);
    expect(MAX_PLAYERS).toBe(4);
  });

  it('resolves the full layout per player count', () => {
    const c2 = resolveSessionConfig(2);
    expect(c2.active.sort()).toEqual(['NW', 'SE']);
    expect(c2.romeStartHp).toBe(500);
    const c4 = resolveSessionConfig(4);
    expect(c4.active.length).toBe(4);
    expect(c4.romeStartHp).toBe(1000);
    expect(c4.difficulty.waveHpMult).toBe(1.7);
  });

  it('clamps out-of-range counts to the nearest valid', () => {
    expect(resolveSessionConfig(1).players).toBe(2);
    expect(resolveSessionConfig(9).players).toBe(4);
  });
});

describe('Difficulty scaling (Section 5)', () => {
  it('scales enemy HP by the player-count multiplier', () => {
    expect(scaledEnemyHp(100, 2)).toBe(130); // 1.3×
    expect(scaledEnemyHp(100, 4)).toBe(170); // 1.7×
  });

  it('scales enemy speed', () => {
    expect(scaledEnemySpeed(1, 2)).toBeCloseTo(1.0);
    expect(scaledEnemySpeed(1, 4)).toBeCloseTo(1.1);
  });

  it('returns Rome starting HP per player count', () => {
    expect(romeStartingHp(2)).toBe(500);
    expect(romeStartingHp(3)).toBe(750);
    expect(romeStartingHp(4)).toBe(1000);
  });
});

describe('Wave volume scaling (Section 5.3 aggregate-pool model)', () => {
  it('scales the TOTAL pool, not per-lane', () => {
    // base 40 units, 4 players at 1.2× → 48 total across all four lanes
    expect(totalWaveCount(40, 4)).toBe(48);
    expect(totalWaveCount(40, 2)).toBe(40); // 2P count mult is 1.0
  });

  it('distributes the pool evenly across active corners with balanced remainder', () => {
    expect(distributeAcrossCorners(48, 4)).toEqual([12, 12, 12, 12]);
    expect(distributeAcrossCorners(14, 4)).toEqual([4, 4, 3, 3]);
    expect(distributeAcrossCorners(40, 2)).toEqual([20, 20]);
    expect(distributeAcrossCorners(0, 4)).toEqual([0, 0, 0, 0]);
    // sum is conserved
    const split = distributeAcrossCorners(47, 3);
    expect(split.reduce((a, b) => a + b, 0)).toBe(47);
  });
});
