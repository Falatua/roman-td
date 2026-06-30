// Tower placement, removal, upgrade math, and downgrade tests.
import { describe, it, expect } from 'vitest';
import { createTower, towerEffectiveStats, towerPerAttackDamageBase, placeCost, BASE_TOWER_TYPES } from '../src/systems/TowerSystem';
import { applyDamageAndStatus } from '../src/systems/CombatResolver';
import { canDowngrade, downgradeTower } from '../src/systems/DowngradeSystem';
import { spawnProjectile } from '../src/systems/ProjectileSystem';
import { TowerType, DamageType, Enemy, EnemyFaction, EnemyType, StatusEffectKind } from '../src/types';
import { TIER_MULTS, ECONOMY, AURA_TILES, AURA_TILE_EFFECTS } from '../src/constants';
import { createGameState } from '../src/GameState';
import towersData from '../src/data/towers.json';

function testEnemy(id: string, x = 160, y = 160): Enemy {
  return {
    id,
    type: EnemyType.FERAL_DOG,
    faction: EnemyFaction.DOGS,
    hp: 1000,
    maxHp: 1000,
    baseSpeed: 1,
    currentSpeed: 1,
    isFlyer: false,
    x,
    y,
    pathIndex: 0,
    pathProgress: 0,
    statusEffects: [],
    hasFeared: false,
    livesCost: 1,
    isBoss: false,
    reward: 0,
    archetype: 'SWARM',
    hpFlashTimer: 0
  };
}

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
  it('keeps anti-air specialist towers on the boosted DPS line', () => {
    const expectedAntiAirDps: Partial<Record<TowerType, number>> = {
      [TowerType.SAGITTARIUS]: 89.4,
      [TowerType.SCORPIO]: 21.6,
      [TowerType.VENATOR]: 15.9,
      [TowerType.AQUILA_VENATOR]: 154.2,
      [TowerType.SCORPION_BOLT]: 100.6,
      [TowerType.NUMIDIAN_CAVALRY]: 255.0,
      [TowerType.NEMESIS_ENGINE]: 268.3,
      [TowerType.BEASTLORD_CHAMPION]: 144.0,
      [TowerType.SKYREAPER_BATTERY]: 190.0
    };
    for (const [type, expectedDps] of Object.entries(expectedAntiAirDps)) {
      expect((towersData as any)[type].baseDps).toBe(expectedDps);
    }
    expect((towersData as any)[TowerType.HANNIBALS_NIGHTMARE].baseDps).toBe(235.0);
  });

  it('applies a linear tier damage ramp (T5 hits 2.5x T1)', () => {
    const t1 = createTower(TowerType.MILITES, 1, 0, 0, 0);
    const t5 = createTower(TowerType.MILITES, 5, 0, 0, 0);
    const s1 = towerEffectiveStats(t1);
    const s5 = towerEffectiveStats(t5);
    // T5 / T1 damage ratio matches TIER_MULTS.damage (2.50).
    expect(s5.dps / s1.dps).toBeCloseTo(TIER_MULTS.damage[5], 2);
    expect(TIER_MULTS.damage[5]).toBe(2.5);
  });

  it('applies Common item damage multipliers (Sharpened Blade +10%)', () => {
    const t = createTower(TowerType.MILITES, 1, 0, 0, 0);
    const before = towerEffectiveStats(t).dps;
    t.equippedItems.push('SHARPENED_BLADE');
    const after = towerEffectiveStats(t).dps;
    expect(after).toBeCloseTo(before * 1.10, 4);
  });

  it('Watchtower Lens adds +0.75 tile range', () => {
    const t = createTower(TowerType.SAGITTARIUS, 1, 0, 0, 0);
    const before = towerEffectiveStats(t).range;
    t.equippedItems.push('WATCHTOWER_LENS');
    const after = towerEffectiveStats(t).range;
    expect(after).toBe(before + 0.75);
  });

  it('multiplies attack speed via Mercury Feather (+25%)', () => {
    const t = createTower(TowerType.SAGITTARIUS, 1, 0, 0, 0);
    const before = towerEffectiveStats(t).attackSpeed;
    t.equippedItems.push('MERCURY_FEATHER');
    const after = towerEffectiveStats(t).attackSpeed;
    expect(after).toBeCloseTo(before * 1.25, 4);
  });

  it('gives melee towers a small baseline attack-speed lift', () => {
    const melee = createTower(TowerType.MILITES, 1, 0, 0, 0);
    const ranged = createTower(TowerType.VELITES, 1, 0, 0, 0);
    expect(towerEffectiveStats(melee).attackSpeed).toBeCloseTo(melee.attackSpeed * 1.06, 4);
    expect(towerEffectiveStats(ranged).attackSpeed).toBeCloseTo(ranged.attackSpeed, 4);
  });

  it('Cavalry Spur (2026-05 v6 — MELEE only) buffs only melee towers', () => {
    // CAVALRY_SPUR was reclassified from "cavalry-only archetype" to
    // "MELEE-only" so a ranged Velites no longer gets the speed buff;
    // a melee Milites does. Spec change tracked in items_permanent.json
    // and ItemRules.EQUIP_MODE = 'MELEE'.
    const ranged = createTower(TowerType.VELITES, 1, 0, 0, 0);
    const melee = createTower(TowerType.MILITES, 1, 0, 0, 0);
    const rangedBefore = towerEffectiveStats(ranged).attackSpeed;
    const meleeBefore = towerEffectiveStats(melee).attackSpeed;
    ranged.equippedItems.push('CAVALRY_SPUR');
    melee.equippedItems.push('CAVALRY_SPUR');
    expect(towerEffectiveStats(ranged).attackSpeed).toBeCloseTo(rangedBefore, 4);  // ranged: no effect
    expect(towerEffectiveStats(melee).attackSpeed).toBeCloseTo(meleeBefore * 1.25, 4);
  });

  it('keeps all melee towers at a minimum 1.5-tile attack range', () => {
    for (const [type, def] of Object.entries(towersData as any)) {
      if (def.damageType !== 'PHYS_MELEE' && def.melee !== true) continue;
      expect(def.range, `${type} raw melee range`).toBeGreaterThanOrEqual(1.5);
      const tower = createTower(type as TowerType, 1, 0, 0, 0);
      tower.range = Math.min(tower.range, 0.5);
      expect(towerEffectiveStats(tower).range, `${type} effective melee range`).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('keeps Decurion as a close-order melee tower with the melee range floor', () => {
    const decurion = createTower(TowerType.DECURION, 1, 0, 0, 0);
    expect(decurion.damageType).toBe(DamageType.PHYS_MELEE);
    expect((towersData as any)[TowerType.DECURION].melee).toBe(true);
    expect(decurion.range).toBe(1.5);
    expect(towerEffectiveStats(decurion).range).toBe(1.5);
    expect(towerEffectiveStats(decurion).attackSpeed).toBeCloseTo(decurion.attackSpeed * 1.06, 4);
  });

  it('keeps a visible Common to Legendary attack-speed ladder', () => {
    const multiplier = (item: string) => {
      const tower = createTower(TowerType.SAGITTARIUS, 1, 0, 0, 0);
      const before = towerEffectiveStats(tower).attackSpeed;
      tower.equippedItems.push(item as any);
      return towerEffectiveStats(tower).attackSpeed / before;
    };
    expect(multiplier('TRAINING_SCROLL')).toBeCloseTo(1.10, 4);
    expect(multiplier('MERCURY_FEATHER')).toBeCloseTo(1.25, 4);
    expect(multiplier('HOURGLASS_OF_SATURN')).toBeCloseTo(1.40, 4);
    expect(multiplier('FALCONERS_WATCHPOST')).toBeCloseTo(1.40, 4);
    expect(multiplier('NUMIDIAN_SADDLE')).toBeCloseTo(1.60, 4);
  });

  it('Gallic Shield Boss no longer duplicates Lictor damage/range stats', () => {
    const shieldTower = createTower(TowerType.SAGITTARIUS, 1, 0, 0, 0);
    const fascesTower = createTower(TowerType.SAGITTARIUS, 1, 0, 0, 0);
    const before = towerEffectiveStats(shieldTower);
    shieldTower.equippedItems.push('GALLIC_SHIELD_BOSS');
    fascesTower.equippedItems.push('LICTOR_FASCES');

    expect(towerEffectiveStats(shieldTower).dps).toBeCloseTo(before.dps, 4);
    expect(towerEffectiveStats(shieldTower).range).toBeCloseTo(before.range, 4);
    expect(towerEffectiveStats(fascesTower).dps).toBeCloseTo(before.dps * 1.40, 4);
    expect(towerEffectiveStats(fascesTower).range).toBeCloseTo(before.range + 2, 4);
  });

  it('Gallic Shield Boss stuns on every fourth hit', () => {
    const state = createGameState();
    (globalThis as any).__lastState = state;
    const tower = createTower(TowerType.SAGITTARIUS, 1, 4, 4, 0);
    tower.equippedItems.push('GALLIC_SHIELD_BOSS');
    (tower as any).__hitCount = 4;
    const target = testEnemy('shield-bash-target');
    state.enemies.set(target.id, target);

    applyDamageAndStatus(state, tower, target, 1, {
      onKill: () => {},
      onHit: () => {},
      onMeleeSwing: () => {},
      onProjectileFire: () => {}
    });

    expect(target.statusEffects.some(s => s.kind === StatusEffectKind.STUN && s.remaining > 0.9)).toBe(true);
  });
});

describe('Aura tiles (EMERALD watchtower +2 range)', () => {
  // 2026-05-19 — 6th aura tile. EMERALD WATCHTOWER at (2, 22) grants
  // any tower placed on it +2 tiles of range. Stacks additively with
  // Watchtower Lens (+1) and pool-level extras.
  it('AURA_TILE_EFFECTS.EMERALD declares rangeBonus 2', () => {
    // Local import inside the test so this file doesn't grow another
    // top-level import for one assertion.
    expect(AURA_TILE_EFFECTS.EMERALD?.rangeBonus).toBe(2);
    expect(AURA_TILE_EFFECTS.EMERALD?.label).toBe('WATCHTOWER TILE');
    // And there's exactly one EMERALD tile placed on the map.
    const emeraldTiles = AURA_TILES.filter((t: any) => t.kind === 'EMERALD');
    expect(emeraldTiles.length).toBe(1);
  });

  it('tower on the EMERALD tile gains +2 effective range', () => {
    const emerald = AURA_TILES.find(t => t.kind === 'EMERALD')!;
    // Off-tile baseline tower
    const off  = createTower(TowerType.SCORPIO, 1, 0, 0, 0);
    // Same tower placed on the EMERALD aura tile
    const on   = createTower(TowerType.SCORPIO, 1, emerald.col, emerald.row, 0);
    const offRange = towerEffectiveStats(off).range;
    const onRange  = towerEffectiveStats(on).range;
    expect(onRange - offRange).toBeCloseTo(2.0, 4);
  });

  it('EMERALD range stacks additively with Watchtower Lens', () => {
    const emerald = AURA_TILES.find(t => t.kind === 'EMERALD')!;
    const off = createTower(TowerType.SCORPIO, 1, 0, 0, 0);
    off.equippedItems.push('WATCHTOWER_LENS');
    const offRange = towerEffectiveStats(off).range;

    const on = createTower(TowerType.SCORPIO, 1, emerald.col, emerald.row, 0);
    on.equippedItems.push('WATCHTOWER_LENS');
    const onRange = towerEffectiveStats(on).range;
    // Tile +2 stacks on top of Lens +1 → net difference is still 2.
    expect(onRange - offRange).toBeCloseTo(2.0, 4);
  });

  it('the 6 spread tiles stay distinct and non-clustered (>=6 manhattan)', () => {
    // 2026-06-27 — the IVORY (divine) + AMBER (blast) tiles are
    // DELIBERATELY clustered on the WP3<->WP4 gauntlet (per user), so
    // they're exempt from the spacing rule that keeps the original six
    // anchors spread across the map.
    // 2026-06-28 — user hand-moved tempo/tyrant/treasury; tightest pair is
    // now Treasury<->War at manhattan 6, so the dispersal floor is 6.
    const spread = AURA_TILES.filter(t => t.kind !== 'IVORY' && t.kind !== 'AMBER');
    expect(spread.length).toBe(6);
    for (let i = 0; i < spread.length; i++) {
      for (let j = i + 1; j < spread.length; j++) {
        const d = Math.abs(spread[i].col - spread[j].col) + Math.abs(spread[i].row - spread[j].row);
        expect(d).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it('no two aura tiles share the same cell', () => {
    const seen = new Set<string>();
    for (const t of AURA_TILES) {
      const k = `${t.col},${t.row}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
  });

  it('exactly 8 aura tiles on the map (one of each kind)', () => {
    expect(AURA_TILES.length).toBe(8);
    const kinds = new Set(AURA_TILES.map(t => t.kind));
    expect(kinds.size).toBe(8);  // all distinct
    expect(kinds.has('EMERALD')).toBe(true);
    expect(kinds.has('IVORY')).toBe(true);
    expect(kinds.has('AMBER')).toBe(true);
  });

  it('IVORY tile converts a tower\'s damage type to DIVINE', () => {
    const ivory = AURA_TILES.find(t => t.kind === 'IVORY')!;
    expect(AURA_TILE_EFFECTS.IVORY?.divineDamage).toBe(true);
    expect(AURA_TILE_EFFECTS.IVORY?.label).toBe('DIVINE TILE');
    // The tile sits on open buildable terrain (clear of every waypoint).
    expect(ivory.col).toBe(32);
  });

  it('AMBER tile declares a splash blast radius', () => {
    expect(AURA_TILE_EFFECTS.AMBER?.splashBonus).toBeGreaterThan(0);
    expect(AURA_TILE_EFFECTS.AMBER?.label).toBe('BLAST TILE');
  });

  it('all siege projectiles get at least a baseline splash radius', () => {
    const state = createGameState();
    const target = testEnemy('target');
    state.enemies.set(target.id, target);

    const scorpio = createTower(TowerType.SCORPIO, 1, 4, 4, 1);
    spawnProjectile(state, scorpio, target, 100);
    expect(state.projectiles[state.projectiles.length - 1]?.splash).toBeCloseTo(0.8, 5);

    const onager = createTower(TowerType.COLOSSUS_ONAGER, 5, 4, 4, 1);
    spawnProjectile(state, onager, target, 100);
    expect(state.projectiles[state.projectiles.length - 1]?.splash).toBeCloseTo(2.4, 5);
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
