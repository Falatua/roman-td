// Fortuna's Wheel tests — locks the Mercator 925g regular combo-tower gamble.
// Mechanic: pay 925g, get a random regular COMBO tower. TIER rarity is linear
// (T2 weight 4 → 40%, T3 = 3 → 30%, T4 = 2 → 20%, T5 = 1 → 10%); within
// a tier the pick is uniform. No cap on spins. Tower lands in
// pendingPurchasedTowers like a Mercator T5 buy. This file pins:
//   - the pool is non-empty and only contains regular COMBO towers
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
  isFortunaRegularCombo,
  rollFortunaCombo
} from '../src/systems/MerchantSystem';
import towers from '../src/data/towers.json';
import combinations from '../src/data/towerCombinations.json';

describe('Fortuna\'s Wheel — 925g combo-tower gamble', () => {
  it('charges 925g per spin', () => {
    expect(FORTUNA_GAMBLE_COST).toBe(925);
  });

  it('pool contains every regular COMBO-kind tower in towers.json', () => {
    const expected = Object.entries(towers as any)
      .filter(([id, def]: any) => isFortunaRegularCombo(id, def))
      .map(([id]) => id)
      .sort();
    const actual = FORTUNA_GAMBLE_POOL.slice().sort();
    expect(actual).toEqual(expected);
  });

  it('pool excludes Supercombo, Omega, Champion, and combo-of-combo results', () => {
    const recipeByResult = new Map((combinations as any[]).map(recipe => [recipe.result, recipe]));
    const comboIds = new Set(Object.entries(towers as any)
      .filter(([, def]: any) => def.kind === 'COMBO')
      .map(([id]) => id));
    const forbiddenExamples = [
      'ROMAN_TRANSFORMER',
      'JULIUS_CAESAR',
      'HANNIBALS_NIGHTMARE',
      'TRIPLEX_ACIES',
      'LEGION_PRIME',
      'VANGUARD_WING',
      'VULCAN_COLOSSUS',
      'SKY_DOMINION',
      'AUREATE_TRIBUNAL',
      'GLACIAL_PALISADE',
      'INFERNAL_COLOSSUS',
      'CHAMPION_MARIUS'
    ];

    for (const id of forbiddenExamples) {
      expect(FORTUNA_GAMBLE_POOL).not.toContain(id);
    }

    for (const id of FORTUNA_GAMBLE_POOL) {
      const def: any = (towers as any)[id];
      const ability = String(def?.ability ?? '').toUpperCase();
      const recipe: any = recipeByResult.get(id);
      const consumesCombo = (recipe?.ingredients ?? []).some((ing: any) => comboIds.has(String(ing.type)));
      expect(id.startsWith('CHAMPION_'), `${id} is a Champion`).toBe(false);
      expect(def?.omega === true, `${id} is an Omega tower`).toBe(false);
      expect(ability.includes('SUPERCOMBO') || ability.includes('SUPER COMBO'), `${id} is a Supercombo`).toBe(false);
      expect(ability.includes('OMEGA'), `${id} has Omega copy`).toBe(false);
      expect(ability.includes('COMBO-OF-COMBO'), `${id} is a combo-of-combo`).toBe(false);
      expect(consumesCombo, `${id} consumes another combo tower`).toBe(false);
    }
  });

  it('pool has no duplicate entries and stays meaningfully stocked', () => {
    expect(FORTUNA_GAMBLE_POOL.length).toBeGreaterThanOrEqual(30);
    expect(new Set(FORTUNA_GAMBLE_POOL).size).toBe(FORTUNA_GAMBLE_POOL.length);
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

  it('per-spin tier odds report cleanly from the active 4 / 3 / 2 / 1 tier weights', () => {
    const odds = getFortunaTierOdds();
    const totalWeight = odds.reduce((sum, o) => sum + (FORTUNA_TIER_WEIGHTS[o.tier] ?? 0), 0);
    for (const o of odds) {
      expect(o.pct).toBeCloseTo(((FORTUNA_TIER_WEIGHTS[o.tier] ?? 0) / totalWeight) * 100, 4);
      expect(o.count).toBeGreaterThan(0);
    }
  });

  it('observed tier distribution lines up with the linear 4/3/2/1 weights (T5 stays rare)', () => {
    const SPINS = 20000;
    const hitsByTier: Record<number, number> = { 2: 0, 3: 0, 4: 0, 5: 0 };
    for (let i = 0; i < SPINS; i++) {
      const r = rollFortunaCombo();
      hitsByTier[r.tier]++;
    }
    const odds = getFortunaTierOdds();
    const tol = (expectedFrac: number) => SPINS * expectedFrac * 0.10; // 10% relative tolerance
    for (const o of odds) {
      const frac = o.pct / 100;
      expect(Math.abs(hitsByTier[o.tier] - SPINS * frac)).toBeLessThan(tol(frac));
    }
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
