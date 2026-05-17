// Tests for the gold/pool/hero economy. Pure logic — no DOM, no renderer.
import { describe, it, expect, beforeEach } from 'vitest';
import { canAfford, spendGold, earnGold, effectivePoolLevel, poolUpgradeCost, bumpHeroXP } from '../src/systems/EconomySystem';
import { createGameState } from '../src/GameState';
import { ECONOMY, HERO_XP_THRESHOLDS } from '../src/constants';

describe('Economy — gold spend/earn', () => {
  let state: ReturnType<typeof createGameState>;
  beforeEach(() => { state = createGameState(); state.denarii = 10; });

  it('canAfford returns true when gold is sufficient and false otherwise', () => {
    expect(canAfford(state, 5)).toBe(true);
    expect(canAfford(state, 10)).toBe(true);
    expect(canAfford(state, 11)).toBe(false);
  });

  it('spendGold deducts when affordable and returns true', () => {
    const ok = spendGold(state, 7);
    expect(ok).toBe(true);
    expect(state.denarii).toBe(3);
  });

  it('spendGold returns false and does NOT mutate gold when unaffordable', () => {
    const ok = spendGold(state, 20);
    expect(ok).toBe(false);
    expect(state.denarii).toBe(10);
  });

  it('earnGold increases gold by the given amount', () => {
    earnGold(state, 5);
    expect(state.denarii).toBe(15);
  });

  it('earnGold tolerates 0 and does not throw on negative amounts', () => {
    earnGold(state, 0);
    expect(state.denarii).toBe(10);
    earnGold(state, -3);
    expect(state.denarii).toBe(7);
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
  });

  it('returns -1 once pool reaches max', () => {
    const state = createGameState();
    state.poolLevel = ECONOMY.POOL_MAX_LEVEL;
    expect(poolUpgradeCost(state)).toBe(-1);
  });

  it('costs are strictly monotonic and 8 levels long', () => {
    const c = ECONOMY.POOL_UPGRADE_COSTS;
    expect(c.length).toBe(8);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThan(c[i - 1]);
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
    state.poolLevel = 7;
    state.heroLevel = 5;
    expect(effectivePoolLevel(state)).toBe(7);
  });
});
