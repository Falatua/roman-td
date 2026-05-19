// Tower placement, removal, upgrade math, and downgrade tests.
import { describe, it, expect } from 'vitest';
import { createTower, towerEffectiveStats, towerPerAttackDamageBase, placeCost, BASE_TOWER_TYPES } from '../src/systems/TowerSystem';
import { canDowngrade, downgradeTower } from '../src/systems/DowngradeSystem';
import { TowerType, DamageType } from '../src/types';
import { TIER_MULTS, ECONOMY } from '../src/constants';
import { createGameState } from '../src/GameState';

describe('Tower creation', () => {
  it('creates a tower with correct base fields', () => {
    const t = createTower(TowerType.MILITES, 1, 5, 5, 0);
    expect(t.type).toBe(TowerType.MILITES);
    expect(t.qualityTier).toBe(1);
    expect(t.tileX).toBe(5);
    expect(t.tileY).toBe(5);
    expect(t.killCount).toBe(0);
    expect(t.hasBeenDowngraded).toBe(false);
    expect(t.equippedItems).toEqual([]);
    expect(t.pending).toBe(false);
  });

  it('marks Aerarium with isAerarium flag', () => {
    const t = createTower(TowerType.AERARIUM, 3, 0, 0, 0);
    expect(t.isAerarium).toBe(true);
  });

  it('records costPaid based on tier', () => {
    const t1 = createTower(TowerType.MILITES, 1, 0, 0, 0);
    const t5 = createTower(TowerType.SCORPIO, 5, 0, 0, 0);
    expect(t1.costPaid).toBe(ECONOMY.TIER_PLACE_COST[1]);
    expect(t5.costPaid).toBe(ECONOMY.TIER_PLACE_COST[5]);
  });

  it('generates unique IDs for sequential towers', () => {
    const a = createTower(TowerType.MILITES, 1, 0, 0, 0);
    const b = createTower(TowerType.MILITES, 1, 0, 1, 0);
    expect(a.id).not.toBe(b.id);
  });
});

describe('Tower effective stats', () => {
  it('applies a linear tier damage ramp (T5 hits 2.5x T1)', () => {
    const t1 = createTower(TowerType.MILITES, 1, 0, 0, 0);
    const t5 = createTower(TowerType.MILITES, 5, 0, 0, 0);
    const s1 = towerEffectiveStats(t1);
    const s5 = towerEffectiveStats(t5);
    // T5 / T1 damage ratio matches TIER_MULTS.damage (2.50).
    expect(s5.dps / s1.dps).toBeCloseTo(TIER_MULTS.damage[5], 2);
    expect(TIER_MULTS.damage[5]).toBe(2.5);
  });

  it('applies item damage multipliers (Sharpened Blade +12%)', () => {
    const t = createTower(TowerType.MILITES, 1, 0, 0, 0);
    const before = towerEffectiveStats(t).dps;
    t.equippedItems.push('SHARPENED_BLADE');
    const after = towerEffectiveStats(t).dps;
    expect(after).toBeCloseTo(before * 1.12, 4);
  });

  it('Watchtower Lens adds +1 tile range', () => {
    const t = createTower(TowerType.SAGITTARIUS, 1, 0, 0, 0);
    const before = towerEffectiveStats(t).range;
    t.equippedItems.push('WATCHTOWER_LENS');
    const after = towerEffectiveStats(t).range;
    expect(after).toBe(before + 1);
  });

  it('multiplies attack speed via Mercury Feather (+22%)', () => {
    const t = createTower(TowerType.SAGITTARIUS, 1, 0, 0, 0);
    const before = towerEffectiveStats(t).attackSpeed;
    t.equippedItems.push('MERCURY_FEATHER');
    const after = towerEffectiveStats(t).attackSpeed;
    expect(after).toBeCloseTo(before * 1.22, 4);
  });

  it('Cavalry Spur (2026-05 v6 — MELEE only) buffs only melee towers', () => {
    // CAVALRY_SPUR was reclassified from "cavalry-only archetype" to
    // "MELEE-only" so a ranged Decurion no longer gets the speed buff;
    // a melee Milites does. Spec change tracked in items_permanent.json
    // and ItemRules.EQUIP_MODE = 'MELEE'.
    const ranged = createTower(TowerType.DECURION, 1, 0, 0, 0);
    const melee = createTower(TowerType.MILITES, 1, 0, 0, 0);
    const rangedBefore = towerEffectiveStats(ranged).attackSpeed;
    const meleeBefore = towerEffectiveStats(melee).attackSpeed;
    ranged.equippedItems.push('CAVALRY_SPUR');
    melee.equippedItems.push('CAVALRY_SPUR');
    expect(towerEffectiveStats(ranged).attackSpeed).toBeCloseTo(rangedBefore, 4);  // ranged: no effect
    // 2026-05-19 rarity rebalance: Cavalry Spur tuned 1.30 → 1.22 so it
    // fits the UNCOMMON tier next to Mercury Feather (+22%).
    expect(towerEffectiveStats(melee).attackSpeed).toBeCloseTo(meleeBefore * 1.22, 4);
  });
});

describe('Tower per-attack damage', () => {
  it('returns dps / attackSpeed (sane units)', () => {
    const t = createTower(TowerType.MILITES, 1, 0, 0, 0);
    const stats = towerEffectiveStats(t);
    const perAtk = towerPerAttackDamageBase(t);
    expect(perAtk).toBeGreaterThan(0);
    // perAttack × attacksPerSec ≈ dps (allow 5% slack for floor effects)
    expect(perAtk * stats.attackSpeed).toBeCloseTo(stats.dps, 0);
  });

  it('does not divide by zero on towers with attackSpeed=0', () => {
    const t = createTower(TowerType.EAGLE_STANDARD, 3, 0, 0, 0); // pure support, attackSpeed=0
    const result = towerPerAttackDamageBase(t);
    expect(Number.isFinite(result)).toBe(true);
  });
});

describe('Place cost lookup', () => {
  it('returns the right cost per tier', () => {
    expect(placeCost(1)).toBe(ECONOMY.TIER_PLACE_COST[1]);
    expect(placeCost(3)).toBe(ECONOMY.TIER_PLACE_COST[3]);
    expect(placeCost(5)).toBe(ECONOMY.TIER_PLACE_COST[5]);
  });

  it('returns 0 for invalid tiers (defensive)', () => {
    expect(placeCost(0)).toBe(0);
    expect(placeCost(99)).toBe(0);
  });
});

describe('Tower downgrade logic', () => {
  it('canDowngrade returns true for tier > 1, never-downgraded towers', () => {
    const t = createTower(TowerType.MILITES, 3, 0, 0, 0);
    expect(canDowngrade(t)).toBe(true);
  });

  it('canDowngrade returns false for tier 1 towers', () => {
    const t = createTower(TowerType.MILITES, 1, 0, 0, 0);
    expect(canDowngrade(t)).toBe(false);
  });

  it('canDowngrade returns false once a tower is already downgraded', () => {
    const t = createTower(TowerType.MILITES, 3, 0, 0, 0);
    t.hasBeenDowngraded = true;
    expect(canDowngrade(t)).toBe(false);
  });

  it('downgradeTower lowers tier and marks hasBeenDowngraded, charges 2g', () => {
    const state = createGameState();
    state.gold = 10;
    const t = createTower(TowerType.MILITES, 3, 0, 0, 0);
    state.towers.set(t.id, t);
    const ok = downgradeTower(state, t, () => {});
    expect(ok).toBe(true);
    expect(t.qualityTier).toBe(2);
    expect(t.hasBeenDowngraded).toBe(true);
    expect(state.gold).toBe(10 - ECONOMY.DOWNGRADE_COST);
  });

  it('downgradeTower fails on tier-1 tower', () => {
    const state = createGameState();
    state.gold = 10;
    const t = createTower(TowerType.MILITES, 1, 0, 0, 0);
    const ok = downgradeTower(state, t, () => {});
    expect(ok).toBe(false);
    expect(t.qualityTier).toBe(1);
  });
});

describe('Pool draw — base tower types', () => {
  it('BASE_TOWER_TYPES includes the 10 spec tier-1 towers', () => {
    expect(BASE_TOWER_TYPES.length).toBeGreaterThanOrEqual(10);
    expect(BASE_TOWER_TYPES).toContain(TowerType.MILITES);
    expect(BASE_TOWER_TYPES).toContain(TowerType.SCORPIO);
    expect(BASE_TOWER_TYPES).toContain(TowerType.LEGATE);
  });
});
