// Tower placement, removal, upgrade math, and downgrade tests.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { createTower, towerEffectiveStats, towerPerAttackDamageBase, towerStatBreakdown, placeCost, BASE_TOWER_TYPES } from '../src/systems/TowerSystem';
import { applyDamageAndStatus, CAPITOLINE_AEGIS_DIVINE_RIDER_PCT, FINAL_FIVE_APEX_WAVE, finalFiveApexDamageMult, SIEGE_FLYER_MISS_CHANCE, STORMCALLER_OCEAN_THREAT_DAMAGE_MULT, tickCombat } from '../src/systems/CombatResolver';
import { canDowngrade, downgradeTower } from '../src/systems/DowngradeSystem';
import { itemFamily } from '../src/systems/ItemRules';
import { spawnProjectile } from '../src/systems/ProjectileSystem';
import { TowerType, DamageType, Enemy, EnemyFaction, EnemyType, StatusEffectKind, TargetingMode } from '../src/types';
import { TIER_MULTS, ECONOMY, AURA_TILES, AURA_TILE_EFFECTS, GRID } from '../src/constants';
import { createGameState } from '../src/GameState';
import { initializeGrid, isBuildable } from '../src/systems/GridManager';
import towersData from '../src/data/towers.json';
import wavesData from '../src/data/waves.json';

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

function flyerEnemy(id: string, x = 160, y = 160): Enemy {
  const enemy = testEnemy(id, x, y);
  enemy.isFlyer = true;
  return enemy;
}

function noopCombatHooks() {
  return {
    onKill: () => {},
    onHit: () => {},
    onMeleeSwing: () => {},
    onProjectileFire: () => {}
  };
}

function towerCenter(tower: { tileX: number; tileY: number }) {
  return {
    x: tower.tileX * GRID.TILE + GRID.TILE / 2,
    y: tower.tileY * GRID.TILE + GRID.TILE / 2
  };
}

function displayedDpsFromBreakdown(tower: ReturnType<typeof createTower>, state: ReturnType<typeof createGameState>) {
  const breakdown = towerStatBreakdown(tower, state);
  return breakdown.damageFinal * (breakdown.speedFinal / Math.max(0.05, breakdown.speedBase));
}

function singleSwingDamage(opts: {
  support?: Array<{ type: TowerType; x: number; y: number; tier?: 1|2|3|4|5; items?: string[] }>;
  nullifierAt?: { x: number; y: number };
  targetOffsetPx?: { x: number; y: number };
} = {}) {
  const state = createGameState();
  (globalThis as any).__lastState = state;
  const attacker = createTower(TowerType.DECURION, 1, 10, 10, 0);
  attacker.attackCooldown = 0;
  state.towers.set(attacker.id, attacker);

  for (const s of opts.support ?? []) {
    const support = createTower(s.type, s.tier ?? 5, s.x, s.y, 0);
    support.attackCooldown = 999;
    support.equippedItems.push(...(s.items ?? []));
    state.towers.set(support.id, support);
  }

  const c = towerCenter(attacker);
  const target = testEnemy(
    'aura-target',
    c.x + (opts.targetOffsetPx?.x ?? 0),
    c.y + (opts.targetOffsetPx?.y ?? 0)
  );
  target.hp = 100000;
  target.maxHp = 100000;
  state.enemies.set(target.id, target);

  if (opts.nullifierAt) {
    const nullifier = testEnemy('aura-nullifier', opts.nullifierAt.x, opts.nullifierAt.y);
    nullifier.type = EnemyType.ARCHITECTUS;
    nullifier.hp = 100000;
    nullifier.maxHp = 100000;
    state.enemies.set(nullifier.id, nullifier);
  }

  const before = target.hp;
  tickCombat(state, 0.016, noopCombatHooks());
  return {
    damage: before - target.hp,
    cooldown: attacker.attackCooldown,
    attacker
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
      [TowerType.NUMIDIAN_CAVALRY]: 285.0,
      [TowerType.NEMESIS_ENGINE]: 235.0,
      [TowerType.BEASTLORD_CHAMPION]: 144.0,
      [TowerType.SKYREAPER_BATTERY]: 190.0
    };
    for (const [type, expectedDps] of Object.entries(expectedAntiAirDps)) {
      expect((towersData as any)[type].baseDps).toBe(expectedDps);
    }
    expect((towersData as any)[TowerType.HANNIBALS_NIGHTMARE].baseDps).toBe(235.0);
  });

  it('marks Sagittarius, Aquila Venator, and Skyreaper Battery as flyer-only targeting towers', () => {
    for (const type of [TowerType.SAGITTARIUS, TowerType.AQUILA_VENATOR, TowerType.SKYREAPER_BATTERY]) {
      expect((towersData as any)[type].antiAirOnly).toBe(true);
      const tier = type === TowerType.AQUILA_VENATOR ? 3 : type === TowerType.SKYREAPER_BATTERY ? 4 : 1;
      expect(createTower(type, tier, 0, 0, 1).targetingMode).toBe(TargetingMode.FLYERS);
    }
  });

  it('makes Stormcaller a lightning specialist against ocean threats', () => {
    const stormDamage = (oceanSpawn: boolean) => {
      const state = createGameState();
      const stormcaller = createTower(TowerType.STORMCALLER, 3, 5, 5, 0);
      stormcaller.attackCooldown = 0;
      state.towers.set(stormcaller.id, stormcaller);

      const c = towerCenter(stormcaller);
      const target = testEnemy(oceanSpawn ? 'drenched-target' : 'dry-target', c.x + GRID.TILE, c.y);
      target.hp = 100000;
      target.maxHp = 100000;
      if (oceanSpawn) (target as any).__oceanSpawn = true;
      state.enemies.set(target.id, target);

      let firedDamage = 0;
      const oldRandom = Math.random;
      Math.random = () => 0.99;
      try {
        tickCombat(state, 0.016, {
          ...noopCombatHooks(),
          onProjectileFire: (_tower, _enemy, damage) => { firedDamage = damage; }
        });
      } finally {
        Math.random = oldRandom;
      }
      return firedDamage;
    };

    const ability = String((towersData as any)[TowerType.STORMCALLER].ability);
    expect(ability).toContain('+100% damage vs ocean / sea-based enemies');
    expect(ability).toContain('Fire, burn, and hellfire still do zero damage');
    expect(stormDamage(true)).toBeCloseTo(stormDamage(false) * STORMCALLER_OCEAN_THREAT_DAMAGE_MULT, 4);
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

  it('includes mixed damage and speed items in the displayed DPS calculation', () => {
    const state = createGameState();
    const tower = createTower(TowerType.SAGITTARIUS, 1, 0, 0, 0);
    const baseDisplayedDps = displayedDpsFromBreakdown(tower, state);
    tower.equippedItems.push('TRAINING_SCROLL');

    expect(displayedDpsFromBreakdown(tower, state)).toBeCloseTo(baseDisplayedDps * 1.05 * 1.08, 4);
  });

  it('includes unconditional late-combat item damage in displayed DPS', () => {
    const state = createGameState();
    const tower = createTower(TowerType.SAGITTARIUS, 1, 0, 0, 0);
    const baseDisplayedDps = displayedDpsFromBreakdown(tower, state);
    tower.equippedItems.push('PERIMETER_TORCH');

    expect(displayedDpsFromBreakdown(tower, state)).toBeCloseTo(baseDisplayedDps * 1.50 * 1.50, 4);
  });

  it('shows Capitoline Aegis as an additive divine damage rider', () => {
    const state = createGameState();
    const tower = createTower(TowerType.SAGITTARIUS, 1, 0, 0, 0);
    const baseDisplayedDps = displayedDpsFromBreakdown(tower, state);
    tower.equippedItems.push('CAPITOLINE_AEGIS');
    const breakdown = towerStatBreakdown(tower, state);

    expect(itemFamily('CAPITOLINE_AEGIS')).toBe('SPECIAL');
    expect(breakdown.damageMods.some(m => m.source === 'Capitoline Aegis divine rider')).toBe(true);
    expect(displayedDpsFromBreakdown(tower, state)).toBeCloseTo(baseDisplayedDps * 1.35, 4);
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

  it('keeps all melee towers at a minimum 2-tile attack range', () => {
    for (const [type, def] of Object.entries(towersData as any)) {
      if (def.damageType !== 'PHYS_MELEE' && def.melee !== true) continue;
      expect(def.range, `${type} raw melee range`).toBeGreaterThanOrEqual(2);
      const tower = createTower(type as TowerType, 1, 0, 0, 0);
      tower.range = Math.min(tower.range, 0.5);
      expect(towerEffectiveStats(tower).range, `${type} effective melee range`).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps Decurion as a close-order melee tower with the melee range floor', () => {
    const decurion = createTower(TowerType.DECURION, 1, 0, 0, 0);
    expect(decurion.damageType).toBe(DamageType.PHYS_MELEE);
    expect((towersData as any)[TowerType.DECURION].melee).toBe(true);
    expect(decurion.range).toBe(2);
    expect(towerEffectiveStats(decurion).range).toBe(2);
    expect(towerEffectiveStats(decurion).attackSpeed).toBeCloseTo(decurion.attackSpeed * 1.06, 4);
  });

  it('keeps a visible Common to Legendary attack-speed ladder', () => {
    const multiplier = (item: string) => {
      const tower = createTower(TowerType.SAGITTARIUS, 1, 0, 0, 0);
      const before = towerEffectiveStats(tower).attackSpeed;
      tower.equippedItems.push(item as any);
      return towerEffectiveStats(tower).attackSpeed / before;
    };
    expect(multiplier('TRAINING_SCROLL')).toBeCloseTo(1.08, 4);
    expect(multiplier('QUICKDRAW_GLOVES')).toBeCloseTo(1.22, 4);
    expect(multiplier('MERCURY_FEATHER')).toBeCloseTo(1.25, 4);
    expect(multiplier('HOURGLASS_OF_SATURN')).toBeCloseTo(1.40, 4);
    expect(multiplier('FALCONERS_WATCHPOST')).toBeCloseTo(1.40, 4);
    expect(multiplier('NUMIDIAN_SADDLE')).toBeCloseTo(1.60, 4);
  });

  it('makes Quickdraw Gloves a ranged-only tempo and reach item', () => {
    const ranged = createTower(TowerType.SAGITTARIUS, 1, 0, 0, 0);
    const melee = createTower(TowerType.MILITES, 1, 0, 0, 0);
    const rangedBefore = towerEffectiveStats(ranged);
    const meleeBefore = towerEffectiveStats(melee);

    ranged.equippedItems.push('QUICKDRAW_GLOVES');
    melee.equippedItems.push('QUICKDRAW_GLOVES');

    const rangedAfter = towerEffectiveStats(ranged);
    const meleeAfter = towerEffectiveStats(melee);
    expect(rangedAfter.attackSpeed).toBeCloseTo(rangedBefore.attackSpeed * 1.22, 4);
    expect(rangedAfter.range).toBeCloseTo(rangedBefore.range + 0.5, 4);
    expect(meleeAfter.attackSpeed).toBeCloseTo(meleeBefore.attackSpeed, 4);
    expect(meleeAfter.range).toBeCloseTo(meleeBefore.range, 4);
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

describe('Anti-air tower signatures', () => {
  function hitFlyer(type: TowerType) {
    const state = createGameState();
    (globalThis as any).__lastState = state;
    const tower = createTower(type, 3, 4, 4, 0);
    const target = flyerEnemy(`${type}-flyer`);
    state.enemies.set(target.id, target);
    const originalRandom = Math.random;
    Math.random = () => 0.99;
    try {
      applyDamageAndStatus(state, tower, target, 1, noopCombatHooks());
    } finally {
      Math.random = originalRandom;
    }
    return target;
  }

  it('Sagittarius clips flyer speed so early air leaks are catchable', () => {
    const target = hitFlyer(TowerType.SAGITTARIUS);
    const slow = target.statusEffects.find(s => s.kind === StatusEffectKind.SLOW);
    expect(slow?.magnitude).toBeCloseTo(0.35, 4);
  });

  it('Venator turns flyers into marked prey for the whole maze', () => {
    const target = hitFlyer(TowerType.VENATOR);
    const mark = target.statusEffects.find(s => s.kind === StatusEffectKind.MARK);
    expect(mark?.magnitude).toBeCloseTo(0.35, 4);
    expect(target.statusEffects.some(s => s.kind === StatusEffectKind.SLOW)).toBe(true);
  });

  it('Aquila Venator snares and marks flyers as the mid-game air anchor', () => {
    const target = hitFlyer(TowerType.AQUILA_VENATOR);
    expect(target.statusEffects.some(s => s.kind === StatusEffectKind.SLOW && s.magnitude === 0.45)).toBe(true);
    expect(target.statusEffects.some(s => s.kind === StatusEffectKind.MARK && s.magnitude === 0.25)).toBe(true);
  });

  it('Scorpio and Scorpion Bolt shred flyer armor with siege control', () => {
    const scorpioTarget = hitFlyer(TowerType.SCORPIO);
    const boltTarget = hitFlyer(TowerType.SCORPION_BOLT);

    expect(scorpioTarget.statusEffects.some(s => s.kind === StatusEffectKind.ARMOR_SHRED)).toBe(true);
    expect(scorpioTarget.statusEffects.some(s => s.kind === StatusEffectKind.SLOW)).toBe(true);
    expect(boltTarget.statusEffects.some(s => s.kind === StatusEffectKind.ARMOR_SHRED)).toBe(true);
    expect(boltTarget.statusEffects.some(s => s.kind === StatusEffectKind.STUN)).toBe(true);
  });

  it('late anti-air combos add distinct flyer control, not only DPS', () => {
    const numidian = hitFlyer(TowerType.NUMIDIAN_CAVALRY);
    const beastlord = hitFlyer(TowerType.BEASTLORD_CHAMPION);
    const skyreaper = hitFlyer(TowerType.SKYREAPER_BATTERY);
    const dominion = hitFlyer(TowerType.SKY_DOMINION);
    const nemesis = hitFlyer(TowerType.NEMESIS_ENGINE);

    expect(numidian.statusEffects.some(s => s.kind === StatusEffectKind.SLOW && s.magnitude === 0.45)).toBe(true);
    expect(numidian.statusEffects.some(s => s.kind === StatusEffectKind.MARK && s.magnitude === 0.25)).toBe(true);
    expect(beastlord.statusEffects.some(s => s.kind === StatusEffectKind.STUN)).toBe(true);
    expect(beastlord.statusEffects.some(s => s.kind === StatusEffectKind.MARK && s.magnitude === 0.20)).toBe(true);
    expect(skyreaper.statusEffects.some(s => s.kind === StatusEffectKind.SLOW && s.magnitude === 0.55)).toBe(true);
    expect(skyreaper.statusEffects.some(s => s.kind === StatusEffectKind.ARMOR_SHRED)).toBe(true);
    expect(dominion.statusEffects.some(s => s.kind === StatusEffectKind.SLOW && s.magnitude === 0.60)).toBe(true);
    expect(dominion.statusEffects.some(s => s.kind === StatusEffectKind.MARK && s.magnitude === 0.20)).toBe(true);
    expect(dominion.statusEffects.some(s => s.kind === StatusEffectKind.ARMOR_SHRED)).toBe(true);
    expect(nemesis.statusEffects.some(s => s.kind === StatusEffectKind.STUN)).toBe(true);
    expect(nemesis.statusEffects.some(s => s.kind === StatusEffectKind.MARK && s.magnitude === 0.35)).toBe(true);
    expect(nemesis.statusEffects.some(s => s.kind === StatusEffectKind.ARMOR_SHRED)).toBe(true);
  });

  it('late aerial plating punishes plain anti-air but lets combo anti-air pierce', () => {
    const state = createGameState();
    state.wave = 18;
    const armor = (wavesData as any[])[17].comboAntiAirArmorPct;
    expect(armor).toBeGreaterThan(0);

    const plain = createTower(TowerType.SAGITTARIUS, 5, 0, 0, 0);
    const combo = createTower(TowerType.SCORPION_BOLT, 4, 0, 0, 0);
    const storm = createTower(TowerType.STORM_BALLISTA, 4, 0, 0, 0);

    const plainTarget = flyerEnemy('plated-plain');
    const comboTarget = flyerEnemy('plated-combo');
    const stormTarget = flyerEnemy('plated-storm');

    const originalRandom = Math.random;
    Math.random = () => 0.99;
    try {
      applyDamageAndStatus(state, plain, plainTarget, 100, noopCombatHooks());
      applyDamageAndStatus(state, combo, comboTarget, 100, noopCombatHooks());
      applyDamageAndStatus(state, storm, stormTarget, 100, noopCombatHooks());
    } finally {
      Math.random = originalRandom;
    }

    expect(1000 - plainTarget.hp).toBeCloseTo(100 * (1 - armor), 4);
    expect(1000 - comboTarget.hp).toBeCloseTo(100, 4);
    expect(1000 - stormTarget.hp).toBeCloseTo(100, 4);
  });

  it('early flyer teaching waves do not carry combo anti-air plating', () => {
    const state = createGameState();
    state.wave = 6;
    const tower = createTower(TowerType.SAGITTARIUS, 3, 0, 0, 0);
    const target = flyerEnemy('unplated-w6');

    applyDamageAndStatus(state, tower, target, 100, noopCombatHooks());

    expect((wavesData as any[])[5].comboAntiAirArmorPct).toBeUndefined();
    expect(1000 - target.hp).toBeCloseTo(100, 4);
  });

  it('makes W26-W30 an apex craft check instead of a regular-tower DPS race', () => {
    const state = createGameState();
    state.wave = FINAL_FIVE_APEX_WAVE;
    const base = createTower(TowerType.SCORPIO, 5, 0, 0, 0);
    const combo = createTower(TowerType.SCORPION_BOLT, 5, 0, 0, 0);
    const superCombo = createTower(TowerType.JULIUS_CAESAR, 5, 0, 0, 0);
    const omega = createTower(TowerType.ROMAN_TRANSFORMER, 5, 0, 0, 0);

    expect(finalFiveApexDamageMult(state, base)).toBeCloseTo(0.50, 4);
    expect(finalFiveApexDamageMult(state, combo)).toBeCloseTo(0.65, 4);
    expect(finalFiveApexDamageMult(state, superCombo)).toBeCloseTo(1.00, 4);
    expect(finalFiveApexDamageMult(state, omega)).toBeCloseTo(1.10, 4);

    state.wave = 30;
    expect(finalFiveApexDamageMult(state, base)).toBeCloseTo(0.30, 4);
    expect(finalFiveApexDamageMult(state, combo)).toBeCloseTo(0.45, 4);
    expect(finalFiveApexDamageMult(state, superCombo)).toBeCloseTo(1.00, 4);
    expect(finalFiveApexDamageMult(state, omega)).toBeCloseTo(1.10, 4);
  });

  it('applies final-five apex pressure to direct projectile damage', () => {
    const state = createGameState();
    state.wave = 30;
    const waveDmgReduct = ((wavesData as any[]).find(w => w.wave === 30) as any).enemyDamageReductPct;
    const base = createTower(TowerType.SCORPIO, 5, 0, 0, 0);
    const superCombo = createTower(TowerType.JULIUS_CAESAR, 5, 0, 0, 0);
    const omega = createTower(TowerType.ROMAN_TRANSFORMER, 5, 0, 0, 0);
    const baseTarget = testEnemy('w30-base');
    const superTarget = testEnemy('w30-super');
    const omegaTarget = testEnemy('w30-omega');

    const originalRandom = Math.random;
    Math.random = () => 0.99;
    try {
      applyDamageAndStatus(state, base, baseTarget, 100, noopCombatHooks());
      applyDamageAndStatus(state, superCombo, superTarget, 100, noopCombatHooks());
      applyDamageAndStatus(state, omega, omegaTarget, 100, noopCombatHooks());
    } finally {
      Math.random = originalRandom;
    }

    expect(1000 - baseTarget.hp).toBeCloseTo(100 * 0.30 * (1 - waveDmgReduct), 4);
    expect(1000 - superTarget.hp).toBeCloseTo(100 * 1.00 * (1 - waveDmgReduct), 4);
    expect(1000 - omegaTarget.hp).toBeCloseTo(100 * 1.10 * (1 - waveDmgReduct), 4);
  });

  it('gives siege attacks a separate miss chance against flyers only', () => {
    expect(SIEGE_FLYER_MISS_CHANCE).toBeCloseTo(0.20, 4);
    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
      const state = createGameState();
      const siegeFlyer = flyerEnemy('siege-flyer-miss');
      const siegeGround = testEnemy('siege-ground-hit');
      const rangedFlyer = flyerEnemy('ranged-flyer-hit');
      const siegeTower = createTower(TowerType.SCORPIO, 3, 0, 0, 0);
      const rangedTower = createTower(TowerType.SAGITTARIUS, 3, 0, 0, 0);

      applyDamageAndStatus(state, siegeTower, siegeFlyer, 100, noopCombatHooks());
      applyDamageAndStatus(state, siegeTower, siegeGround, 100, noopCombatHooks());
      applyDamageAndStatus(state, rangedTower, rangedFlyer, 100, noopCombatHooks());

      expect(siegeFlyer.hp).toBe(1000);
      expect((siegeFlyer as any).__weatherMissTick).toBe(state.tick);
      expect(siegeGround.hp).toBe(900);
      expect(rangedFlyer.hp).toBe(900);
    } finally {
      Math.random = originalRandom;
    }
  });

  it('zeros the fired projectile payload when a primary siege shot misses a flyer', () => {
    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
      const state = createGameState();
      (globalThis as any).__lastState = state;
      const tower = createTower(TowerType.SCORPIO, 3, 4, 4, 0);
      tower.attackCooldown = 0;
      tower.critChance = 0;
      state.towers.set(tower.id, tower);
      const center = towerCenter(tower);
      const target = flyerEnemy('primary-siege-flyer-miss', center.x + GRID.TILE * 2, center.y);
      state.enemies.set(target.id, target);
      let firedDamage: number | null = null;

      tickCombat(state, 0.016, {
        ...noopCombatHooks(),
        onProjectileFire: (_tower, _enemy, damage) => { firedDamage = damage; }
      });

      expect(firedDamage).toBe(0);
      expect((target as any).__weatherMissTick).toBe(state.tick);
    } finally {
      Math.random = originalRandom;
    }
  });
});

describe('Sacred Band combat wiring', () => {
  it('routes through the melee attack branch and damages enemies', () => {
    const state = createGameState();
    (globalThis as any).__lastState = state;
    const tower = createTower(TowerType.SACRED_BAND, 4, 4, 4, 0);
    tower.attackCooldown = 0;
    state.towers.set(tower.id, tower);
    const target = testEnemy('sacred-band-target');
    state.enemies.set(target.id, target);
    const before = target.hp;
    let meleeSwings = 0;
    let hits = 0;

    tickCombat(state, 0.016, {
      onKill: () => {},
      onHit: () => { hits++; },
      onMeleeSwing: () => { meleeSwings++; },
      onProjectileFire: () => {}
    });

    expect(target.hp).toBeLessThan(before);
    expect(hits).toBeGreaterThan(0);
    expect(meleeSwings).toBeGreaterThan(0);
    expect((tower as any).__hitCount).toBe(1);
  });

  it('fires Aegis Nova on its fourth melee strike', () => {
    const state = createGameState();
    (globalThis as any).__lastState = state;
    const tower = createTower(TowerType.SACRED_BAND, 4, 4, 4, 0);
    tower.attackCooldown = 0;
    (tower as any).__hitCount = 3;
    state.towers.set(tower.id, tower);
    const primary = testEnemy('sacred-primary');
    const nearby = testEnemy('sacred-nearby', primary.x + 16, primary.y);
    state.enemies.set(primary.id, primary);
    state.enemies.set(nearby.id, nearby);
    const before = nearby.hp;

    tickCombat(state, 0.016, {
      onKill: () => {},
      onHit: () => {},
      onMeleeSwing: () => {},
      onProjectileFire: () => {}
    });

    expect((tower as any).__hitCount).toBe(4);
    expect(nearby.hp).toBeLessThan(before);
    expect(nearby.statusEffects.some(s => s.kind === StatusEffectKind.STUN)).toBe(true);
  });
});

describe('Roman Transformer omega combat wiring', () => {
  it('applies its omega on-hit pressure package', () => {
    const state = createGameState();
    (globalThis as any).__lastState = state;
    const tower = createTower(TowerType.ROMAN_TRANSFORMER, 5, 4, 4, 0);
    const target = testEnemy('roman-transformer-target');
    state.enemies.set(target.id, target);

    applyDamageAndStatus(state, tower, target, 1, noopCombatHooks());

    expect(target.statusEffects.some(s => s.kind === StatusEffectKind.MARK && s.magnitude === 0.35)).toBe(true);
    expect(target.statusEffects.some(s => s.kind === StatusEffectKind.ARMOR_SHRED)).toBe(true);
    expect(target.statusEffects.some(s => s.kind === StatusEffectKind.STUN)).toBe(true);
    expect(target.statusEffects.some(s => s.kind === StatusEffectKind.BURN && s.magnitude === 0.08)).toBe(true);
    expect(target.statusEffects.some(s => s.kind === StatusEffectKind.HELLFIRE && s.magnitude === 0.012)).toBe(true);
  });

  it('burns nearby enemies with immolation aura and slashes all enemies after two active minutes', () => {
    const state = createGameState();
    (globalThis as any).__lastState = state;
    state.wave = 18;
    state.tick = 120;
    const tower = createTower(TowerType.ROMAN_TRANSFORMER, 5, 4, 4, 0);
    tower.attackCooldown = 999;
    (tower as any).__omegaWave = 18;
    (tower as any).__nextOmegaSlashTick = 120;
    state.towers.set(tower.id, tower);
    const near = testEnemy('omega-near', 150, 150);
    near.hp = 800; near.maxHp = 1000;
    const far = testEnemy('omega-far', 900, 700);
    far.hp = 400; far.maxHp = 1000;
    state.enemies.set(near.id, near);
    state.enemies.set(far.id, far);

    tickCombat(state, 0.016, noopCombatHooks());

    expect(near.hp).toBeCloseTo(600, 4);
    expect(far.hp).toBeCloseTo(300, 4);
    expect(near.statusEffects.some(s => s.kind === StatusEffectKind.BURN && s.magnitude === 0.08)).toBe(true);
    expect(far.statusEffects.some(s => s.kind === StatusEffectKind.MARK && s.magnitude === 0.35)).toBe(true);
    expect((tower as any).__nextOmegaSlashTick).toBe(240);
  });
});

describe('Neptune\'s Leviathan omega combat wiring', () => {
  it('applies its water-only omega on-hit pressure package', () => {
    const state = createGameState();
    (globalThis as any).__lastState = state;
    const tower = createTower(TowerType.NEPTUNES_LEVIATHAN, 5, 4, 4, 0);
    tower.placedOnWater = true;
    const target = testEnemy('neptunes-leviathan-target');
    state.enemies.set(target.id, target);

    applyDamageAndStatus(state, tower, target, 1, noopCombatHooks());

    expect(target.statusEffects.some(s => s.kind === StatusEffectKind.MARK && s.magnitude === 0.30)).toBe(true);
    expect(target.statusEffects.some(s => s.kind === StatusEffectKind.ARMOR_SHRED)).toBe(true);
    expect(target.statusEffects.some(s => s.kind === StatusEffectKind.SLOW && s.magnitude === 0.50)).toBe(true);
    expect(target.statusEffects.some(s => s.kind === StatusEffectKind.STUN)).toBe(true);
    expect(target.statusEffects.some(s => s.kind === StatusEffectKind.POISON && s.magnitude === 0.05)).toBe(true);
  });

  it('churns nearby enemies with undertow and judges only enemies in its short coastal radius', () => {
    const state = createGameState();
    (globalThis as any).__lastState = state;
    state.wave = 24;
    state.tick = 35;
    const tower = createTower(TowerType.NEPTUNES_LEVIATHAN, 5, 4, 4, 0);
    tower.placedOnWater = true;
    tower.attackCooldown = 999;
    (tower as any).__leviathanWave = 24;
    (tower as any).__nextAbyssalJudgmentTick = 35;
    state.towers.set(tower.id, tower);
    const near = testEnemy('leviathan-near', 150, 150);
    near.hp = 900; near.maxHp = 1000;
    const far = testEnemy('leviathan-far', 900, 700);
    far.hp = 900; far.maxHp = 1000;
    state.enemies.set(near.id, near);
    state.enemies.set(far.id, far);

    tickCombat(state, 0.016, noopCombatHooks());

    expect(near.hp).toBeCloseTo(738, 4);
    expect(far.hp).toBeCloseTo(900, 4);
    expect(near.statusEffects.some(s => s.kind === StatusEffectKind.SLOW && s.magnitude === 0.35)).toBe(true);
    expect(near.statusEffects.some(s => s.kind === StatusEffectKind.POISON && s.magnitude === 0.012)).toBe(true);
    expect(near.statusEffects.some(s => s.kind === StatusEffectKind.MARK && s.magnitude === 0.28)).toBe(true);
    expect(far.statusEffects.length).toBe(0);
    expect((tower as any).__nextAbyssalJudgmentTick).toBe(70);
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

  it('Watchtower tile sits three tiles left and three tiles down and remains buildable', () => {
    const state = createGameState();
    initializeGrid(state);
    const emerald = AURA_TILES.find(t => t.kind === 'EMERALD')!;
    expect(emerald).toMatchObject({ col: 17, row: 7 });
    expect(isBuildable(state, emerald.col, emerald.row)).toBe(true);
  });

  it('Tyrant tile sits one tile up and two tiles left and remains buildable', () => {
    const state = createGameState();
    initializeGrid(state);
    const tyrant = AURA_TILES.find(t => t.kind === 'RED')!;
    expect(tyrant).toMatchObject({ col: 26, row: 9 });
    expect(isBuildable(state, tyrant.col, tyrant.row)).toBe(true);
  });

  it('Divine tile sits one tile left and remains buildable', () => {
    const state = createGameState();
    initializeGrid(state);
    const divine = AURA_TILES.find(t => t.kind === 'IVORY')!;
    expect(divine).toMatchObject({ col: 31, row: 5 });
    expect(isBuildable(state, divine.col, divine.row)).toBe(true);
  });

  it('the 6 spread tiles stay distinct and non-clustered (>=4 manhattan)', () => {
    // 2026-06-27 — the IVORY (divine) + AMBER (blast) tiles are
    // DELIBERATELY clustered on the WP3<->WP4 gauntlet (per user), so
    // they're exempt from the spacing rule that keeps the original six
    // anchors spread across the map.
    // 2026-07-05 — Treasury was moved two tiles right to (15,16), making
    // Treasury<->War the tightest pair at manhattan 4.
    const spread = AURA_TILES.filter(t => t.kind !== 'IVORY' && t.kind !== 'AMBER');
    expect(spread.length).toBe(6);
    for (let i = 0; i < spread.length; i++) {
      for (let j = i + 1; j < spread.length; j++) {
        const d = Math.abs(spread[i].col - spread[j].col) + Math.abs(spread[i].row - spread[j].row);
        expect(d).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('Treasury tile sits two tiles farther right and remains buildable', () => {
    const state = createGameState();
    initializeGrid(state);
    const treasury = AURA_TILES.find(t => t.kind === 'GOLD')!;
    expect(treasury).toMatchObject({ col: 15, row: 16 });
    expect(isBuildable(state, treasury.col, treasury.row)).toBe(true);
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
    expect(ivory.col).toBe(31);
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

describe('Aura mechanics and visibility', () => {
  it('applies global damage auras additively before the combat aura cap', () => {
    const base = singleSwingDamage();
    const withGlobal = singleSwingDamage({
      support: [
        { type: TowerType.EAGLE_STANDARD, x: 1, y: 1, tier: 1 },
        { type: TowerType.TRIARIUS, x: 2, y: 1, tier: 1 }
      ]
    });

    expect(withGlobal.damage / base.damage).toBeCloseTo(1.30, 4);
  });

  it('caps extreme global aura stacking at 2x damage and 2x attack speed', () => {
    const base = singleSwingDamage();
    const capped = singleSwingDamage({
      support: [
        { type: TowerType.EAGLE_STANDARD, x: 1, y: 1, tier: 5 },
        { type: TowerType.JULIUS_CAESAR, x: 2, y: 1, tier: 5 },
        { type: TowerType.CONSULAR_FATEBINDER, x: 3, y: 1, tier: 5 },
        { type: TowerType.MARS_VICTOR, x: 4, y: 1, tier: 5 },
        { type: TowerType.IMPERIUM_ETERNUM, x: 5, y: 1, tier: 5 },
        { type: TowerType.AUREATE_TRIBUNAL, x: 6, y: 1, tier: 5 }
      ]
    });

    expect(capped.damage / base.damage).toBeCloseTo(2.0, 4);
    expect(base.cooldown / capped.cooldown).toBeCloseTo(2.0, 4);
  });

  it('shows capped live aura stacks in the tower stat breakdown', () => {
    const state = createGameState();
    const attacker = createTower(TowerType.DECURION, 1, 10, 10, 0);
    state.towers.set(attacker.id, attacker);
    for (const [index, type] of [
      TowerType.EAGLE_STANDARD,
      TowerType.JULIUS_CAESAR,
      TowerType.CONSULAR_FATEBINDER,
      TowerType.MARS_VICTOR,
      TowerType.IMPERIUM_ETERNUM,
      TowerType.AUREATE_TRIBUNAL
    ].entries()) {
      const support = createTower(type, 5, index + 1, 1, 0);
      state.towers.set(support.id, support);
    }

    const breakdown = towerStatBreakdown(attacker, state);
    const damageAura = breakdown.damageMods.find(m => m.source.startsWith('Aura stack'));
    const speedAura = breakdown.speedMods.find(m => m.source.startsWith('Aura stack'));

    expect(damageAura?.multiplier).toBeCloseTo(2.0, 4);
    expect(speedAura?.multiplier).toBeCloseTo(2.0, 4);
    expect(damageAura?.source).toContain('capped');
    expect(speedAura?.source).toContain('capped');
  });

  it('applies local ally item auras to damage and attack speed', () => {
    const base = singleSwingDamage();
    const withBattleStandard = singleSwingDamage({
      support: [{ type: TowerType.MILITES, x: 8, y: 10, items: ['BATTLE_STANDARD'] }]
    });
    const withTrumpet = singleSwingDamage({
      support: [{ type: TowerType.MILITES, x: 8, y: 10, items: ['CENTURIONS_TRUMPET'] }]
    });

    expect(withBattleStandard.damage / base.damage).toBeCloseTo(1.18, 4);
    expect(base.cooldown / withTrumpet.cooldown).toBeCloseTo(1.18, 4);
  });

  it('Capitoline Aegis adds divine damage without replacing native damage', () => {
    const state = createGameState();
    const attacker = createTower(TowerType.DECURION, 1, 10, 10, 0);
    attacker.attackCooldown = 0;
    attacker.equippedItems.push('CAPITOLINE_AEGIS');
    state.towers.set(attacker.id, attacker);
    const c = towerCenter(attacker);
    const target = testEnemy('capitoline-target', c.x + GRID.TILE, c.y);
    target.faction = EnemyFaction.CARTHAGE;
    target.hp = 100000;
    target.maxHp = 100000;
    state.enemies.set(target.id, target);
    let hitDamage = 0;

    tickCombat(state, 0.016, {
      ...noopCombatHooks(),
      onHit: (_tower, _enemy, damage) => { hitDamage = damage; }
    });

    const nativeResist = 0.70;
    const expected = towerPerAttackDamageBase(attacker) * (nativeResist + CAPITOLINE_AEGIS_DIVINE_RIDER_PCT);
    expect(attacker.damageType).toBe(DamageType.PHYS_MELEE);
    expect(hitDamage).toBeCloseTo(expected, 4);
    expect(100000 - target.hp).toBeCloseTo(expected, 4);
  });

  it('applies enemy vulnerability item auras to enemies inside the ring', () => {
    const base = singleSwingDamage();
    const cursed = singleSwingDamage({
      support: [{ type: TowerType.MILITES, x: 8, y: 10, items: ['CURSED_TORC'] }]
    });
    const lantern = singleSwingDamage({
      support: [{ type: TowerType.MILITES, x: 8, y: 10, items: ['NECROMANCERS_LANTERN'] }]
    });

    expect(cursed.damage / base.damage).toBeCloseTo(1.35, 4);
    expect(lantern.damage / base.damage).toBeCloseTo(1.45, 4);
  });

  it('suppresses tower and item auras when an aura nullifier reaches the emitter', () => {
    const base = singleSwingDamage();
    const active = singleSwingDamage({
      support: [{ type: TowerType.MILITES, x: 8, y: 10, items: ['BATTLE_STANDARD'] }]
    });
    const supportCenter = towerCenter({ tileX: 8, tileY: 10 });
    const nullified = singleSwingDamage({
      support: [{ type: TowerType.MILITES, x: 8, y: 10, items: ['BATTLE_STANDARD'] }],
      nullifierAt: supportCenter
    });

    expect(active.damage / base.damage).toBeCloseTo(1.18, 4);
    expect(nullified.damage).toBeCloseTo(base.damage, 4);
  });

  it('draws visible rings for every local tower aura and item aura source', () => {
    const source = fs.readFileSync('src/render/RenderEngine.ts', 'utf8');
    const visibleAuraSources = [
      'EAGLE_STANDARD',
      'AQUILIFER_TITAN',
      'PRAETORIAN_WALL',
      'COHORT_GUARD',
      'TRIPLEX_ACIES',
      'LEGION_PRIME',
      'SACER_VESTAL',
      'AUREATE_TRIBUNAL',
      'GLACIAL_PALISADE',
      'ROMAN_TRANSFORMER',
      'NEPTUNES_LEVIATHAN',
      'CENTURIONS_TRUMPET',
      'BATTLE_STANDARD',
      'WAR_HOUND_COLLAR',
      'DRUIDS_TORC',
      'BARCA_WAR_HORN',
      'LICH_GENERALS_SEAL',
      'AQUILIFER_BANNER',
      'OPTIO_WHISTLE',
      'INFERNO_STANDARD',
      'CURSED_TORC',
      'NECROMANCERS_LANTERN'
    ];

    for (const key of visibleAuraSources) {
      expect(source, `${key} should have a visible aura ring in RenderEngine.drawAuras`).toContain(key);
    }
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
