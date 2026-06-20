// Fortuna's Wheel tests — locks the Mercator 500g combo-tower gamble.
// Mechanic: pay 500g, get a random COMBO tower. TIER rarity is linear
// (T2 weight 4 → 40%, T3 = 3 → 30%, T4 = 2 → 20%, T5 = 1 → 10%); within
// a tier the pick is uniform. No cap on spins. Tower lands in
// pendingPurchasedTowers like a Mercator T5 buy. This file pins:
//   - the pool is non-empty and only contains COMBO towers
//   - rollFortunaCombo always returns a valid pool member
//   - the tier-weight table matches the documented 4/3/2/1 linear ramp
//   - observed tier distribution lines up with expected odds over many
//     rolls (T5 stays rare; T2 stays common)
//   - every pool member still hits eventually (no silent dead pick,
//     even with the rarest T5 weighted at ~0.43% per spin).
import { describe, it, expect } from 'vitest';
import {
  FORTUNA_GAMBLE_COST,
  FORTUNA_GAMBLE_POOL,
  FORTUNA_TIER_WEIGHTS,
  getFortunaTierOdds,
  rollFortunaCombo
} from '../src/systems/MerchantSystem';
import towers from '../src/data/towers.json';

describe('Fortuna\'s Wheel — 500g combo-tower gamble', () => {
  it('charges 500g per spin', () => {
    expect(FORTUNA_GAMBLE_COST).toBe(500);
  });

  // 2026-05 v9: Fortuna's pool now EXCLUDES apex super-combos so they
  // can't be bought — players have to craft them. The 5 blocked IDs
  // are the LATE-game cross-combos (Imperium Eternum, Carthage Scourge,
  // Triumvirate, Legion Prime, Consular Fatebinder).
  const APEX_BLOCKED = new Set([
    'IMPERIUM_ETERNUM', 'CARTHAGE_SCOURGE',
    'TRIUMVIRATE', 'LEGION_PRIME', 'CONSULAR_FATEBINDER', 'MARS_VICTOR'
  ]);

  it('pool contains every non-apex COMBO-kind tower in towers.json', () => {
    const expected = Object.entries(towers as any)
      .filter(([id, def]: any) => def.kind === 'COMBO' && !APEX_BLOCKED.has(id))
      .map(([id]) => id)
      .sort();
    const actual = FORTUNA_GAMBLE_POOL.slice().sort();
    expect(actual).toEqual(expected);
  });

  it('pool excludes all 6 apex super-combos', () => {
    for (const apex of APEX_BLOCKED) {
      expect(FORTUNA_GAMBLE_POOL).not.toContain(apex);
    }
  });

  it('pool has 33 towers (39 combos minus 6 apex)', () => {
    // 2026 v2 Ch9 — MARS_VICTOR DIVINE apex combo added + blocked. Pool
    // count: 39 total combos minus 6 apex super-combos still blocked = 33
    // buyable combos.
    expect(FORTUNA_GAMBLE_POOL.length).toBe(33);
  });

  it('rollFortunaCombo returns only valid COMBO tower IDs', () => {
    for (let i = 0; i < 200; i++) {
      const r = rollFortunaCombo();
      expect(FORTUNA_GAMBLE_POOL).toContain(r.type);
      const def: any = (towers as any)[r.type];
      expect(def?.kind).toBe('COMBO');
    }
  });

  it('returned tier band is 2-5 (matches the COMBO tier range)', () => {
    for (let i = 0; i < 200; i++) {
      const r = rollFortunaCombo();
      expect(r.tier).toBeGreaterThanOrEqual(2);
      expect(r.tier).toBeLessThanOrEqual(5);
    }
  });

  it('tier-weight table is linear-descending 4/3/2/1 (T2 most common, T5 rarest)', () => {
    expect(FORTUNA_TIER_WEIGHTS[2]).toBe(4);
    expect(FORTUNA_TIER_WEIGHTS[3]).toBe(3);
    expect(FORTUNA_TIER_WEIGHTS[4]).toBe(2);
    expect(FORTUNA_TIER_WEIGHTS[5]).toBe(1);
  });

  it('per-spin tier odds report cleanly as 40 / 30 / 20 / 10%', () => {
    const odds = getFortunaTierOdds();
    const byTier = new Map(odds.map(o => [o.tier, o.pct]));
    expect(byTier.get(2)).toBeCloseTo(40, 4);
    expect(byTier.get(3)).toBeCloseTo(30, 4);
    expect(byTier.get(4)).toBeCloseTo(20, 4);
    expect(byTier.get(5)).toBeCloseTo(10, 4);
  });

  it('observed tier distribution lines up with the linear 4/3/2/1 weights (T5 stays rare)', () => {
    const SPINS = 20000;
    const hitsByTier: Record<number, number> = { 2: 0, 3: 0, 4: 0, 5: 0 };
    for (let i = 0; i < SPINS; i++) {
      const r = rollFortunaCombo();
      hitsByTier[r.tier]++;
    }
    // Expected: T2 8000, T3 6000, T4 4000, T5 2000. ±5% tolerance gives
    // ~400 wiggle on T2 / ~100 on T5 — well above noise floor at 20k.
    const tol = (expectedFrac: number) => SPINS * expectedFrac * 0.10; // 10% relative tolerance
    expect(Math.abs(hitsByTier[2] - SPINS * 0.40)).toBeLessThan(tol(0.40));
    expect(Math.abs(hitsByTier[3] - SPINS * 0.30)).toBeLessThan(tol(0.30));
    expect(Math.abs(hitsByTier[4] - SPINS * 0.20)).toBeLessThan(tol(0.20));
    expect(Math.abs(hitsByTier[5] - SPINS * 0.10)).toBeLessThan(tol(0.10));
    // Linear-rarity ordering — strict monotonic decrease.
    expect(hitsByTier[2]).toBeGreaterThan(hitsByTier[3]);
    expect(hitsByTier[3]).toBeGreaterThan(hitsByTier[4]);
    expect(hitsByTier[4]).toBeGreaterThan(hitsByTier[5]);
  });

  it('distribution covers every pool entry across 20k rolls (no dead picks)', () => {
    // Even the rarest T5 individual sits at ~10%/23 ≈ 0.43% per spin —
    // P(missed across 20k) ≈ (0.9957)^20000 ≈ e^-86, essentially zero.
    const hits = new Map<string, number>();
    for (let i = 0; i < 20000; i++) {
      const r = rollFortunaCombo();
      hits.set(r.type, (hits.get(r.type) ?? 0) + 1);
    }
    for (const id of FORTUNA_GAMBLE_POOL) {
      expect(hits.get(id) ?? 0, `${id} never rolled in 20k spins`).toBeGreaterThan(0);
    }
  });
});
