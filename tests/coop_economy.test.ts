// Phase 7 — Co-op Legion economy (Section 6).
import { describe, it, expect } from 'vitest';
import {
  ownLaneGold, circuitKillGold, dotFinishGold, LEAK_PLAYER_GOLD,
  recordWaveKill, recordCircuitKill, recordLeak, resetRoundDishonor,
  recordCombo, recordQuest, setTowerCount, recordRomeContribution,
  createRebuildPool, contributeToRebuild, resolveRebuild, resetRebuildPool,
  buildRoundSummary, emptyStats, type RoundSummaryRow,
} from '../src/coop/LegionEconomy';

describe('Kill gold (Section 6.1 / 6.2)', () => {
  it('own-lane kill pays full gold (rounded, clamped ≥0)', () => {
    expect(ownLaneGold(40)).toBe(40);
    expect(ownLaneGold(40.4)).toBe(40);
    expect(ownLaneGold(-10)).toBe(0);
  });
  it('circuit kill in your quadrant pays 60%', () => {
    expect(circuitKillGold(100)).toBe(60);
    expect(circuitKillGold(41)).toBe(25); // 24.6 → 25
  });
  it('residual-DoT finish pays 40%', () => {
    expect(dotFinishGold(100)).toBe(40);
    expect(dotFinishGold(41)).toBe(16); // 16.4 → 16
  });
  it('the original leaker earns nothing', () => {
    expect(LEAK_PLAYER_GOLD).toBe(0);
  });
});

describe('Immutable stat helpers (Section 11.4)', () => {
  it('records wave + circuit kills without mutating the source', () => {
    const s0 = emptyStats();
    const s1 = recordWaveKill(s0, 3);
    const s2 = recordCircuitKill(s1, 2);
    expect(s0.waveKills).toBe(0);           // original untouched
    expect(s1.waveKills).toBe(3);
    expect(s2.circuitKills).toBe(2);
    expect(s2.waveKills).toBe(3);
  });
  it('leaks bump BOTH the round counter and the cumulative total', () => {
    let s = emptyStats();
    s = recordLeak(s, 2);
    s = recordLeak(s);
    expect(s.leaks).toBe(3);
    expect(s.leaksTotal).toBe(3);
  });
  it('resetRoundDishonor clears the round counter but keeps the total', () => {
    let s = recordLeak(emptyStats(), 4);
    s = resetRoundDishonor(s);
    expect(s.leaks).toBe(0);
    expect(s.leaksTotal).toBe(4);
  });
  it('records combos, quests, tower count, and Rome contributions', () => {
    let s = emptyStats();
    s = recordCombo(s, 2);
    s = recordQuest(s);
    s = setTowerCount(s, 9);
    s = recordRomeContribution(s, 50);
    s = recordRomeContribution(s, -5); // clamped to +0
    expect(s.combosBuilt).toBe(2);
    expect(s.questsDone).toBe(1);
    expect(s.towersBuilt).toBe(9);
    expect(s.romeContributed).toBe(50);
  });
  it('setTowerCount never goes negative', () => {
    expect(setTowerCount(emptyStats(), -3).towersBuilt).toBe(0);
  });
});

describe('Rome rebuild shared pool (Section 6.4)', () => {
  it('accumulates per-player contributions visibly', () => {
    let pool = createRebuildPool();
    pool = contributeToRebuild(pool, 'p1', 30);
    pool = contributeToRebuild(pool, 'p2', 25);
    pool = contributeToRebuild(pool, 'p1', 10);
    expect(pool.gold).toBe(65);
    expect(pool.byPlayer.p1).toBe(40);
    expect(pool.byPlayer.p2).toBe(25);
  });
  it('does not resolve below the step threshold', () => {
    let pool = contributeToRebuild(createRebuildPool(), 'p1', 49);
    const { pool: after, hpRestored } = resolveRebuild(pool);
    expect(hpRestored).toBe(0);
    expect(after.usedThisPrep).toBe(false);
  });
  it('resolves +25 HP at the 50-gold threshold and marks used', () => {
    let pool = contributeToRebuild(createRebuildPool(), 'p1', 50);
    const { pool: after, hpRestored } = resolveRebuild(pool);
    expect(hpRestored).toBe(25);
    expect(after.usedThisPrep).toBe(true);
  });
  it('caps at one rebuild per prep phase', () => {
    let pool = contributeToRebuild(createRebuildPool(), 'p1', 200);
    let r = resolveRebuild(pool);
    expect(r.hpRestored).toBe(25);
    // second resolve in the same prep is a no-op even with gold left over
    const r2 = resolveRebuild(r.pool);
    expect(r2.hpRestored).toBe(0);
  });
  it('resets to empty for a new prep phase', () => {
    const fresh = resetRebuildPool();
    expect(fresh.gold).toBe(0);
    expect(fresh.usedThisPrep).toBe(false);
    expect(Object.keys(fresh.byPlayer).length).toBe(0);
  });
});

describe('End-of-round summary (Section 11.4)', () => {
  it('sorts descending by total (wave + circuit) kills', () => {
    const rows: RoundSummaryRow[] = [
      { playerId: 'a', name: 'Aulus', quadrantTitle: 'Hastati', waveKills: 10, circuitKills: 2, leaks: 1, romeContributed: 0 },
      { playerId: 'b', name: 'Brutus', quadrantTitle: 'Principes', waveKills: 20, circuitKills: 5, leaks: 0, romeContributed: 50 },
      { playerId: 'c', name: 'Cato', quadrantTitle: 'Triarii', waveKills: 5, circuitKills: 1, leaks: 3, romeContributed: 0 },
    ];
    const sorted = buildRoundSummary(rows);
    expect(sorted.map((r) => r.playerId)).toEqual(['b', 'a', 'c']);
  });
  it('does not mutate the input array', () => {
    const rows: RoundSummaryRow[] = [
      { playerId: 'a', name: 'A', quadrantTitle: 'Hastati', waveKills: 1, circuitKills: 0, leaks: 0, romeContributed: 0 },
      { playerId: 'b', name: 'B', quadrantTitle: 'Principes', waveKills: 2, circuitKills: 0, leaks: 0, romeContributed: 0 },
    ];
    const first = rows[0];
    buildRoundSummary(rows);
    expect(rows[0]).toBe(first);
  });
});
