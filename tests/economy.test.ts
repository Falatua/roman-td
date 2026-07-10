// Tests for the gold/pool/hero economy. Pure logic — no DOM, no renderer.
import { describe, it, expect, beforeEach } from 'vitest';
import { canAfford, spendGold, earnGold, effectivePoolLevel, poolUpgradeCost, bumpHeroXP, perfectWaveGoldBonus } from '../src/systems/EconomySystem';
import { createGameState } from '../src/GameState';
import { ECONOMY, HERO_XP_THRESHOLDS, POOL_PROBABILITIES } from '../src/constants';

describe('Economy — gold spend/earn', () => {
  let state: ReturnType<typeof createGameState>;
  beforeEach(() => { state = createGameState(); state.gold = 10; });

  it('canAfford returns true when gold is sufficient and false otherwise', () => {
    expect(canAfford(state, 5)).toBe(true);
    expect(canAfford(state, 10)).toBe(true);
    expect(canAfford(state, 11)).toBe(false);
  });

  it('spendGold deducts when affordable and returns true', () => {
    const ok = spendGold(state, 7);
    expect(ok).toBe(true);
    expect(state.gold).toBe(3);
  });

  it('spendGold returns false and does NOT mutate gold when unaffordable', () => {
    const ok = spendGold(state, 20);
    expect(ok).toBe(false);
    expect(state.gold).toBe(10);
  });

  it('earnGold increases gold by the given amount', () => {
    earnGold(state, 5);
    expect(state.gold).toBe(15);
  });

  it('earnGold tolerates 0 and does not throw on negative amounts', () => {
    earnGold(state, 0);
    expect(state.gold).toBe(10);
    earnGold(state, -3);
    expect(state.gold).toBe(7);
  });

  it('ramps perfect-wave gold so early clean waves do not flood the opener', () => {
    expect(perfectWaveGoldBonus(1)).toBe(10);
    expect(perfectWaveGoldBonus(5)).toBe(10);
    expect(perfectWaveGoldBonus(6)).toBe(20);
    expect(perfectWaveGoldBonus(10)).toBe(20);
    expect(perfectWaveGoldBonus(11)).toBe(35);
    expect(perfectWaveGoldBonus(20)).toBe(35);
    expect(perfectWaveGoldBonus(21)).toBe(50);
    expect(perfectWaveGoldBonus(30)).toBe(50);
  });
});

describe('Economy — pool upgrade cost progression', () => {
  it('returns the correct cost for each pool level', () => {
    const state = createGameState();
    state.poolLevel = 0;
    expect(poolUpgradeCost(state)).toBe(ECONOMY.POOL_UPGRADE_COSTS[0]);
    state.poolLevel = 4;
    expect(poolUpgradeCost(state)).toBe(ECONOMY.POOL_UPGRADE_COSTS[4]);
    state.poolLevel = 7;
    expect(poolUpgradeCost(state)).toBe(ECONOMY.POOL_UPGRADE_COSTS[7]);
    state.poolLevel = 9;
    expect(poolUpgradeCost(state)).toBe(ECONOMY.POOL_UPGRADE_COSTS[9]);
  });

  it('returns -1 once pool reaches max', () => {
    const state = createGameState();
    state.poolLevel = ECONOMY.POOL_MAX_LEVEL;
    expect(poolUpgradeCost(state)).toBe(-1);
  });

  it('costs are strictly monotonic and 10 levels long', () => {
    const c = ECONOMY.POOL_UPGRADE_COSTS;
    expect(c.length).toBe(10);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThan(c[i - 1]);
    expect(ECONOMY.POOL_MAX_LEVEL).toBe(10);
  });

  it('pins the post-ocean economy pool-upgrade price curve', () => {
    expect(ECONOMY.POOL_UPGRADE_COSTS).toEqual([18, 38, 77, 134, 211, 322, 487, 749, 1124, 1686]);
  });

  it('extends prospect odds to 10 levels without nerfing the old level-8 breakpoint', () => {
    expect(POOL_PROBABILITIES).toHaveLength(ECONOMY.POOL_MAX_LEVEL + 1);
    for (const row of POOL_PROBABILITIES) {
      expect(row.reduce((sum, pct) => sum + pct, 0)).toBe(100);
    }
    expect(POOL_PROBABILITIES[8]).toEqual([1, 5, 18, 38, 38]);
    expect(POOL_PROBABILITIES[9]).toEqual([1, 4, 15, 36, 44]);
    expect(POOL_PROBABILITIES[10]).toEqual([0, 3, 12, 35, 50]);
    const t4t5At8 = POOL_PROBABILITIES[8][3] + POOL_PROBABILITIES[8][4];
    const t4t5At10 = POOL_PROBABILITIES[10][3] + POOL_PROBABILITIES[10][4];
    expect(t4t5At8).toBe(76);
    expect(t4t5At10).toBe(85);
    expect(POOL_PROBABILITIES[10][4]).toBeGreaterThan(POOL_PROBABILITIES[8][4]);
  });
});

describe('Economy — hero level XP', () => {
  it('promotes hero level when crossing each threshold', () => {
    const state = createGameState();
    expect(state.heroLevel).toBe(0);
    state.totalKills = HERO_XP_THRESHOLDS[0] - 1;
    expect(bumpHeroXP(state)).toBe(1);     // crossing first threshold
    expect(state.heroLevel).toBe(1);
  });

  it('returns -1 when no level-up occurs', () => {
    const state = createGameState();
    state.totalKills = 0;
    expect(bumpHeroXP(state)).toBe(-1);
    expect(state.heroLevel).toBe(0);
  });

  it('caps hero level at 5', () => {
    const state = createGameState();
    state.heroLevel = 5;
    state.totalKills = 999999;
    expect(bumpHeroXP(state)).toBe(-1);
    expect(state.heroLevel).toBe(5);
  });
});

describe('Economy — effective pool level', () => {
  it('returns the max of pool and hero levels', () => {
    const state = createGameState();
    state.poolLevel = 3;
    state.heroLevel = 0;
    expect(effectivePoolLevel(state)).toBe(3);
    state.poolLevel = 0;
    state.heroLevel = 4;
    expect(effectivePoolLevel(state)).toBe(4);
    state.poolLevel = 10;
    state.heroLevel = 5;
    expect(effectivePoolLevel(state)).toBe(10);
  });
});
