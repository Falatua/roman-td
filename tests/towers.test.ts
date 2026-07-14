// Tower placement, removal, upgrade math, and downgrade tests.
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import { boundAwakeningItemForTowerType, canAwakenWithLegendaryItem, canTransformWithGiantsBane, canTransformWithWitchsBrew, createTower, EAGLE_STANDARD_GLOBAL_DAMAGE_BONUS, GIANTS_BANE_ITEM_ID, towerEffectiveStats, towerItemSlotCap, towerPerAttackDamageBase, towerStatBreakdown, placeCost, BASE_TOWER_TYPES, clampQualityTierForTower, maxQualityTierForTower, rollDraw, rollSoloDraw, soloProspectTierPool, soloTowerTypeChance, transformWithGiantsBane, transformWithLegendaryAwakening, transformWithWitchsBrew, WITCHS_BREW_ITEM_ID } from '../src/systems/TowerSystem';
import { applyDamageAndStatus, BEASTLORD_BEAST_DAMAGE_MULT, BEASTLORD_ELEPHANT_DAMAGE_MULT, beastlordPreyDamageMult, CAPITOLINE_AEGIS_DIVINE_RIDER_PCT, damnatioExecuteThreshold, FINAL_FIVE_APEX_WAVE, finalFiveApexDamageMult, GIANT_KILLER_ELEPHANT_DAMAGE_MULT, GIANT_KILLER_GIANT_DAMAGE_MULT, giantKillerPreyDamageMult, GIANTS_COHORT_GUARD_GIANT_DAMAGE_MULT, isBeastEnemyType, MIRMILLO_REAVER_BLEEDING_DAMAGE_MULT, MURMILLO_BEAST_DAMAGE_MULT, murmilloBeastDamageMult, murmilloReaverPressureDamageMult, siegeFlyerMissChanceForTower, SIEGE_FLYER_MISS_CHANCE, STORMCALLER_OCEAN_THREAT_DAMAGE_MULT, tickCombat, UNDEAD_GLADIATOR_KING_SUMMON_COUNT, UNDEAD_GLADIATOR_KING_SUMMON_DAMAGE_SCALAR, UNDEAD_GLADIATOR_KING_SUMMON_INTERVAL, UNDEAD_GLADIATOR_KING_SUMMON_SLOW, UNDEAD_GLADIATOR_KING_SUMMON_TTL } from '../src/systems/CombatResolver';
import { resistanceModifier } from '../src/systems/DamageTypeSystem';
import { enemyDamageMultiplier } from '../src/systems/EnemyResistances';
import { canDowngrade, downgradeTower } from '../src/systems/DowngradeSystem';
import { itemFamily } from '../src/systems/ItemRules';
import { getTowerProjectileProfile, spawnProjectile, tickProjectiles } from '../src/systems/ProjectileSystem';
import { TowerType, DamageType, Enemy, EnemyFaction, EnemyType, StatusEffectKind, TargetingMode } from '../src/types';
import { TIER_MULTS, ECONOMY, AURA_TILES, AURA_TILE_EFFECTS, GRID } from '../src/constants';
import { createGameState } from '../src/GameState';
import { initializeGrid, isBuildable, isWaterZoneTile, canBuildWaterTowerAt } from '../src/systems/GridManager';
import { ASSET_KEYS } from '../src/render/Assets';
import towersData from '../src/data/towers.json';
import wavesData from '../src/data/waves.json';
import { COMBO_FLYER_SPECIALIST_DAMAGE_MULT, GIANT_KILLER_SPLASH_DAMAGE_MULT, comboFlyerSpecialistDamageMult, giantKillerSplashDamage, HANNIBALS_NIGHTMARE_ELEPHANT_DAMAGE_MULT, hannibalsNightmarePreyDamageMult, towerSpecialistDpsRows } from '../src/systems/TowerSpecialization';

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

describe('legendary item-awakened Supercombos', () => {
  const cases = [
    [TowerType.PRAETORIAN_EXECUTIONER, 'DAMNATIO_MEMORIAE', TowerType.IMPERIAL_HEADSMAN],
    [TowerType.WAR_CHARIOT, 'SIGIL_OF_SOL_INVICTUS', TowerType.SOL_INVICTUS_QUADRIGA],
    [TowerType.BEASTLORD_CHAMPION, 'STORM_AQUILA_TALONS', TowerType.JOVIAN_SKY_HUNTER],
    [TowerType.PLAGUE_LOBBER, 'CENSER_OF_MEFITIS', TowerType.MEFITIS_PLAGUE_ENGINE]
  ] as const;

  it.each(cases)('awakens %s with its bound relic', (source, itemId, result) => {
    const low = createTower(source, 3, 2, 2, 1);
    low.equippedItems.push(itemId);
    expect(canAwakenWithLegendaryItem(low, itemId)).toBe(false);
    expect(transformWithLegendaryAwakening(low, itemId)).toBe(false);

    const tower = createTower(source, 4, 2, 2, 1);
    const sourceDps = towerEffectiveStats(tower).dps;
    tower.equippedItems.push(itemId);
    expect(canAwakenWithLegendaryItem(tower, itemId)).toBe(true);
    expect(transformWithLegendaryAwakening(tower, itemId)).toBe(true);
    expect(tower.type).toBe(result);
    expect(towerItemSlotCap(tower)).toBe(4);
    expect(boundAwakeningItemForTowerType(result)).toBe(itemId);
    expect(towerEffectiveStats(tower).dps).toBeGreaterThan(sourceDps * 1.75);
  });

  it('keeps dedicated projectile and anti-air identities wired', () => {
    const sky = createTower(TowerType.JOVIAN_SKY_HUNTER, 5, 2, 2, 1);
    const plague = createTower(TowerType.MEFITIS_PLAGUE_ENGINE, 5, 2, 2, 1);
    expect((towersData as any).JOVIAN_SKY_HUNTER.antiAirOnly).toBe(true);
    expect((spawnProjectile as any)).toBeTypeOf('function');
    expect(ASSET_KEYS.JOVIAN_SKY_HUNTER).toBe('t_super_jovian_sky_hunter.png');
    expect(ASSET_KEYS.MEFITIS_PLAGUE_ENGINE).toBe('t_super_mefitis_plague_engine.png');
    expect(sky.damageType).toBe(DamageType.PHYS_RANGED);
    expect(plague.damageType).toBe(DamageType.SIEGE);
  });

  it('uses distinct Headsman execute thresholds and never executes bosses', () => {
    const headsman = createTower(TowerType.IMPERIAL_HEADSMAN, 5, 2, 2, 1);
    headsman.equippedItems.push('DAMNATIO_MEMORIAE');
    const ordinary = testEnemy('ordinary');
    const elite = testEnemy('elite'); elite.archetype = 'ELITE'; elite.isElite = true;
    const commander = testEnemy('commander'); (commander as any).isCommander = true;
    const boss = testEnemy('boss'); boss.isBoss = true; boss.archetype = 'BOSS';
    expect(damnatioExecuteThreshold(headsman, ordinary)).toBe(0.30);
    expect(damnatioExecuteThreshold(headsman, elite)).toBe(0.18);
    expect(damnatioExecuteThreshold(headsman, commander)).toBe(0.18);
    expect(damnatioExecuteThreshold(headsman, boss)).toBe(0);
  });

  it('executes through the normal damage path and condemns bosses instead', () => {
    const state = createGameState(); state.tick = 10;
    const headsman = createTower(TowerType.IMPERIAL_HEADSMAN, 5, 2, 2, 1);
    headsman.equippedItems.push('DAMNATIO_MEMORIAE');
    const ordinary = testEnemy('ordinary'); ordinary.hp = 305;
    applyDamageAndStatus(state, headsman, ordinary, 10, noopCombatHooks());
    expect(ordinary.hp).toBe(0);

    const boss = testEnemy('boss'); boss.isBoss = true; boss.archetype = 'BOSS';
    applyDamageAndStatus(state, headsman, boss, 10, noopCombatHooks());
    expect(boss.hp).toBe(990);
    expect(boss.statusEffects.some(s => s.kind === StatusEffectKind.MARK && s.magnitude === 0.35)).toBe(true);
  });

  it('Mefitis clouds rotate effects and stamp the shared healing lock', () => {
    const state = createGameState(); state.tick = 20;
    const plague = createTower(TowerType.MEFITIS_PLAGUE_ENGINE, 5, 2, 2, 1);
    const enemy = testEnemy('victim');
    (plague as any).__hitCount = 1;
    applyDamageAndStatus(state, plague, enemy, 10, noopCombatHooks());
    expect((enemy as any).__healingBlockedUntil).toBe(24);
    expect(enemy.statusEffects.some(s => s.kind === StatusEffectKind.BURN)).toBe(true);

    (plague as any).__hitCount = 2;
    applyDamageAndStatus(state, plague, enemy, 10, noopCombatHooks());
    expect(enemy.statusEffects.some(s => s.kind === StatusEffectKind.POISON)).toBe(true);

    (plague as any).__hitCount = 3;
    applyDamageAndStatus(state, plague, enemy, 10, noopCombatHooks());
    expect(enemy.statusEffects.some(s => s.kind === StatusEffectKind.ARMOR_SHRED)).toBe(true);
  });
});

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
    const t5 = createTower(TowerType.LEGATE, 5, 0, 0, 0);
    expect(t1.costPaid).toBe(ECONOMY.TIER_PLACE_COST[1]);
    expect(t5.costPaid).toBe(ECONOMY.TIER_PLACE_COST[5]);
  });

  it('caps Velites and Scorpio at Tier 4 so they no longer consume Tier 5 slots', () => {
    expect(maxQualityTierForTower(TowerType.VELITES)).toBe(4);
    expect(maxQualityTierForTower(TowerType.SCORPIO)).toBe(4);
    expect(maxQualityTierForTower(TowerType.LEGATE)).toBe(5);
    expect(clampQualityTierForTower(TowerType.VELITES, 5)).toBe(4);
    expect(clampQualityTierForTower(TowerType.SCORPIO, 5)).toBe(4);
    expect(createTower(TowerType.VELITES, 5, 0, 0, 0).qualityTier).toBe(4);
    expect(createTower(TowerType.SCORPIO, 5, 0, 0, 0).qualityTier).toBe(4);
  });

  it('generates unique IDs for sequential towers', () => {
    const a = createTower(TowerType.MILITES, 1, 0, 0, 0);
    const b = createTower(TowerType.MILITES, 1, 0, 1, 0);
    expect(a.id).not.toBe(b.id);
  });
});

describe('Tower effective stats', () => {
  it('classifies living and undead elephants as beasts for every shared beast specialist', () => {
    expect(isBeastEnemyType(EnemyType.WAR_ELEPHANT)).toBe(true);
    expect(isBeastEnemyType(EnemyType.UNDEAD_WAR_ELEPHANT)).toBe(true);
    expect(isBeastEnemyType(EnemyType.FERAL_DOG)).toBe(true);
    expect(isBeastEnemyType(EnemyType.DEMON_HELLHOUND)).toBe(true);
    expect(isBeastEnemyType(EnemyType.CELTIC_FOOTMAN)).toBe(false);
  });

  it('keeps anti-air specialist towers on the boosted DPS line', () => {
    const expectedAntiAirDps: Partial<Record<TowerType, number>> = {
      [TowerType.SAGITTARIUS]: 89.4,
      [TowerType.SCORPIO]: 21.6,
      [TowerType.VENATOR]: 31.8,
      [TowerType.AQUILA_VENATOR]: 154.2,
      [TowerType.SCORPION_BOLT]: 100.6,
      [TowerType.NUMIDIAN_CAVALRY]: 285.0,
      [TowerType.NEMESIS_ENGINE]: 235.0,
      [TowerType.BEASTLORD_CHAMPION]: 170.0,
      [TowerType.EXPLORATORES]: 275.0,
      [TowerType.SKYREAPER_BATTERY]: 400.0
    };
    for (const [type, expectedDps] of Object.entries(expectedAntiAirDps)) {
      expect((towersData as any)[type].baseDps).toBe(expectedDps);
    }
    expect((towersData as any)[TowerType.HANNIBALS_NIGHTMARE].baseDps).toBe(235.0);
  });

  it('gives the strengthened standalone combos distinct combat payoffs', () => {
    const beastlordDef = (towersData as any).BEASTLORD_CHAMPION;
    const reaverDef = (towersData as any).MIRMILLO_REAVER;
    const plagueDef = (towersData as any).PLAGUE_LOBBER;
    const tribuneDef = (towersData as any).TRIBUNE_AVENGER;

    expect([beastlordDef.baseDps, beastlordDef.attackSpeed]).toEqual([170, 1.9]);
    expect([reaverDef.baseDps, reaverDef.attackSpeed, reaverDef.range]).toEqual([175, 2.1, 2.5]);
    expect([plagueDef.baseDps, plagueDef.attackSpeed, plagueDef.range]).toEqual([125, 0.9, 5]);
    expect([tribuneDef.baseDps, tribuneDef.attackSpeed, tribuneDef.range]).toEqual([175, 1.4, 2.5]);
    expect((towersData as any).JOVIAN_SKY_HUNTER.baseDps).toBe(340);
    expect(getTowerProjectileProfile(TowerType.PLAGUE_LOBBER)?.splash).toBe(1.5);

    const beast = testEnemy('beast');
    const elephant = testEnemy('elephant');
    const ordinary = testEnemy('ordinary');
    beast.type = EnemyType.FERAL_DOG;
    elephant.type = EnemyType.WAR_ELEPHANT;
    ordinary.type = EnemyType.CELTIC_FOOTMAN;
    expect(beastlordPreyDamageMult(beast)).toBe(BEASTLORD_BEAST_DAMAGE_MULT);
    expect(beastlordPreyDamageMult(elephant)).toBe(BEASTLORD_ELEPHANT_DAMAGE_MULT);
    expect(beastlordPreyDamageMult(ordinary)).toBe(1);

    expect(MURMILLO_BEAST_DAMAGE_MULT).toBe(1.5);
    expect(murmilloBeastDamageMult(beast)).toBe(1.5);
    expect(murmilloBeastDamageMult(elephant)).toBe(1.5);
    expect(murmilloBeastDamageMult(ordinary)).toBe(1);
    expect(reaverDef.ability).toContain('+50% damage to all beasts');
    expect((towersData as any).MURMILLO.ability).toContain('+50% damage to all beasts');
    expect((towersData as any).UNDEAD_GLADIATOR_KING.ability).toContain('+50% damage to all beasts');

    expect(murmilloReaverPressureDamageMult(ordinary)).toBe(1);
    ordinary.statusEffects.push({ kind: StatusEffectKind.BLEED, remaining: 2, magnitude: 0.012, sourceTier: 3 });
    expect(murmilloReaverPressureDamageMult(ordinary)).toBe(MIRMILLO_REAVER_BLEEDING_DAMAGE_MULT);

    const state = createGameState();
    const beastlord = createTower(TowerType.BEASTLORD_CHAMPION, 3, 2, 2, 1);
    applyDamageAndStatus(state, beastlord, beast, 1, noopCombatHooks());
    expect(beast.statusEffects.some(s => s.kind === StatusEffectKind.MARK && s.magnitude === 0.15)).toBe(true);

    const tribune = createTower(TowerType.TRIBUNE_AVENGER, 4, 2, 2, 1);
    (tribune as any).__hitCount = 4;
    applyDamageAndStatus(state, tribune, ordinary, 1, noopCombatHooks());
    expect(ordinary.statusEffects.some(s => s.kind === StatusEffectKind.POISON && s.magnitude === 0.05)).toBe(true);
    expect(ordinary.statusEffects.some(s => s.kind === StatusEffectKind.MARK && s.magnitude === 0.18)).toBe(true);

    const plagueTarget = testEnemy('plague-target');
    const plague = createTower(TowerType.PLAGUE_LOBBER, 3, 2, 2, 1);
    applyDamageAndStatus(state, plague, plagueTarget, 1, noopCombatHooks());
    expect(plagueTarget.statusEffects.some(s => s.kind === StatusEffectKind.POISON && s.magnitude === 0.05)).toBe(true);
  });

  it('applies the Murmillo beast bonus through live combat and preserves Reaver bleed pressure', () => {
    const strike = (towerType: TowerType, targetType: EnemyType, preBleeding = false) => {
      const state = createGameState();
      state.tick = 1;
      const tier = towerType === TowerType.MURMILLO ? 4 : towerType === TowerType.UNDEAD_GLADIATOR_KING ? 5 : 3;
      const tower = createTower(towerType, tier, 5, 5, 0);
      tower.attackCooldown = 0;
      (tower as any).__undeadNextSummonAt = 999;
      state.towers.set(tower.id, tower);
      const center = towerCenter(tower);
      const target = testEnemy(`${towerType}-${targetType}`, center.x + GRID.TILE, center.y);
      target.type = targetType;
      target.faction = EnemyFaction.DOGS;
      target.hp = 100000;
      target.maxHp = 100000;
      if (preBleeding) {
        target.statusEffects.push({ kind: StatusEffectKind.BLEED, remaining: 2, magnitude: 0.012, sourceTier: 3 });
      }
      state.enemies.set(target.id, target);
      const before = target.hp;
      tickCombat(state, 0.016, noopCombatHooks());
      return before - target.hp;
    };

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    try {
      for (const towerType of [TowerType.MURMILLO, TowerType.MIRMILLO_REAVER, TowerType.UNDEAD_GLADIATOR_KING]) {
        const ordinary = strike(towerType, EnemyType.CELTIC_FOOTMAN);
        const beast = strike(towerType, EnemyType.FERAL_DOG);
        // Feral Dogs also carry a small native physical-melee weakness, so
        // live damage lands slightly above the authored 1.50x tower rider.
        expect(beast / ordinary, towerType).toBeGreaterThan(MURMILLO_BEAST_DAMAGE_MULT);
        expect(beast / ordinary, towerType).toBeLessThan(1.7);
      }
      const reaverBeast = strike(TowerType.MIRMILLO_REAVER, EnemyType.FERAL_DOG);
      const bleedingReaverBeast = strike(TowerType.MIRMILLO_REAVER, EnemyType.FERAL_DOG, true);
      expect(bleedingReaverBeast / reaverBeast).toBeCloseTo(MIRMILLO_REAVER_BLEEDING_DAMAGE_MULT, 4);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('marks dedicated anti-air towers as flyer-only targeting towers', () => {
    for (const type of [TowerType.SAGITTARIUS, TowerType.VENATOR, TowerType.AQUILA_VENATOR, TowerType.EXPLORATORES, TowerType.SKYREAPER_BATTERY]) {
      expect((towersData as any)[type].antiAirOnly).toBe(true);
      const tier = type === TowerType.VENATOR || type === TowerType.AQUILA_VENATOR || type === TowerType.EXPLORATORES ? 3 : type === TowerType.SKYREAPER_BATTERY ? 4 : 1;
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
    expect(nemesis.statusEffects.some(s => s.kind === StatusEffectKind.STUN && s.remaining > 2.6)).toBe(true);
    expect(nemesis.statusEffects.some(s => s.kind === StatusEffectKind.MARK && s.magnitude === 0.35)).toBe(true);
    expect(nemesis.statusEffects.some(s => s.kind === StatusEffectKind.ARMOR_SHRED)).toBe(true);
  });

  it('gives dedicated combo anti-air a stronger tiered flyer payoff without changing ground damage', () => {
    const expected = new Map<TowerType, number>([
      [TowerType.SCORPION_BOLT, 2.00],
      [TowerType.NUMIDIAN_CAVALRY, 2.50],
      [TowerType.NEMESIS_ENGINE, 3.20],
      [TowerType.STORM_BALLISTA, 2.10],
      [TowerType.SKYREAPER_BATTERY, 3.50],
      [TowerType.SKY_DOMINION, 4.25],
      [TowerType.JOVIAN_SKY_HUNTER, 1.35]
    ]);

    expect(Object.keys(COMBO_FLYER_SPECIALIST_DAMAGE_MULT)).toHaveLength(expected.size);
    for (const [type, multiplier] of expected) {
      expect(comboFlyerSpecialistDamageMult(type, { isFlyer: true }), type).toBeCloseTo(multiplier, 4);
      expect(comboFlyerSpecialistDamageMult(type, { isFlyer: false }), type).toBe(1);
      const bonusPct = Math.round((multiplier - 1) * 100);
      expect((towersData as any)[type].ability, type).toContain(`+${bonusPct}%`);
    }
    expect(comboFlyerSpecialistDamageMult(TowerType.LEGATE, { isFlyer: true })).toBe(1);
  });

  it('applies every dedicated combo flyer multiplier through live combat', () => {
    const originalRandom = Math.random;
    Math.random = () => 0.99;
    try {
      for (const [typeKey, multiplier] of Object.entries(COMBO_FLYER_SPECIALIST_DAMAGE_MULT)) {
        const type = typeKey as TowerType;
        const state = createGameState();
        const tower = createTower(type, 5, 4, 4, 0);
        tower.critChance = 0;
        tower.attackCooldown = 0;
        state.towers.set(tower.id, tower);
        const center = towerCenter(tower);
        const target = flyerEnemy(`${type}-live-flyer`, center.x + GRID.TILE, center.y);
        state.enemies.set(target.id, target);
        let firedDamage: number | null = null;

        tickCombat(state, 0.016, {
          ...noopCombatHooks(),
          onProjectileFire: (_tower, enemy, damage) => {
            if (enemy.id === target.id && firedDamage === null) firedDamage = damage;
          }
        });

        const basePerAttack = towerPerAttackDamageBase(tower);
        const targetResistance = resistanceModifier(target.faction, tower.damageType, false)
          * enemyDamageMultiplier(target, tower.damageType);
        expect(firedDamage, type).not.toBeNull();
        expect(firedDamage as unknown as number, type).toBeCloseTo(basePerAttack * multiplier! * targetResistance, 4);
      }
    } finally {
      Math.random = originalRandom;
    }
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

  it('keeps ordinary combos at full damage through W26-W30', () => {
    const state = createGameState();
    state.wave = FINAL_FIVE_APEX_WAVE;
    const base = createTower(TowerType.LEGATE, 5, 0, 0, 0);
    const combo = createTower(TowerType.SCORPION_BOLT, 5, 0, 0, 0);
    const superCombo = createTower(TowerType.JULIUS_CAESAR, 5, 0, 0, 0);
    const omega = createTower(TowerType.ROMAN_TRANSFORMER, 5, 0, 0, 0);

    expect(finalFiveApexDamageMult(state, base)).toBeCloseTo(0.50, 4);
    expect(finalFiveApexDamageMult(state, combo)).toBeCloseTo(1.00, 4);
    expect(finalFiveApexDamageMult(state, superCombo)).toBeCloseTo(1.00, 4);
    expect(finalFiveApexDamageMult(state, omega)).toBeCloseTo(1.10, 4);

    state.wave = 30;
    expect(finalFiveApexDamageMult(state, base)).toBeCloseTo(0.30, 4);
    expect(finalFiveApexDamageMult(state, combo)).toBeCloseTo(1.00, 4);
    expect(finalFiveApexDamageMult(state, superCombo)).toBeCloseTo(1.00, 4);
    expect(finalFiveApexDamageMult(state, omega)).toBeCloseTo(1.10, 4);
  });

  it('applies final-five apex pressure to direct projectile damage', () => {
    const state = createGameState();
    state.wave = 30;
    const waveDmgReduct = ((wavesData as any[]).find(w => w.wave === 30) as any).enemyDamageReductPct;
    const base = createTower(TowerType.LEGATE, 5, 0, 0, 0);
    const combo = createTower(TowerType.SCORPION_BOLT, 5, 0, 0, 0);
    const superCombo = createTower(TowerType.JULIUS_CAESAR, 5, 0, 0, 0);
    const omega = createTower(TowerType.ROMAN_TRANSFORMER, 5, 0, 0, 0);
    const baseTarget = testEnemy('w30-base');
    const comboTarget = testEnemy('w30-combo');
    const superTarget = testEnemy('w30-super');
    const omegaTarget = testEnemy('w30-omega');

    const originalRandom = Math.random;
    Math.random = () => 0.99;
    try {
      applyDamageAndStatus(state, base, baseTarget, 100, noopCombatHooks());
      applyDamageAndStatus(state, combo, comboTarget, 100, noopCombatHooks());
      applyDamageAndStatus(state, superCombo, superTarget, 100, noopCombatHooks());
      applyDamageAndStatus(state, omega, omegaTarget, 100, noopCombatHooks());
    } finally {
      Math.random = originalRandom;
    }

    expect(1000 - baseTarget.hp).toBeCloseTo(100 * 0.30 * (1 - waveDmgReduct), 4);
    expect(1000 - comboTarget.hp).toBeCloseTo(100 * 1.00 * (1 - waveDmgReduct), 4);
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

  it('lets Storm Ballista acquire and reliably fire on flyers', () => {
    const state = createGameState();
    (globalThis as any).__lastState = state;
    const tower = createTower(TowerType.STORM_BALLISTA, 4, 4, 4, 0);
    tower.attackCooldown = 0;
    tower.critChance = 0;
    tower.targetingMode = TargetingMode.FLYERS;
    state.towers.set(tower.id, tower);
    const center = towerCenter(tower);
    const target = flyerEnemy('storm-ballista-flyer', center.x + GRID.TILE * 2, center.y);
    state.enemies.set(target.id, target);
    let firedDamage: number | null = null;

    const originalRandom = Math.random;
    Math.random = () => 0;
    try {
      tickCombat(state, 0.016, {
        ...noopCombatHooks(),
        onProjectileFire: (_tower, enemy, damage) => {
          expect(enemy.id).toBe(target.id);
          firedDamage = damage;
        }
      });
    } finally {
      Math.random = originalRandom;
    }

    expect(siegeFlyerMissChanceForTower(tower)).toBe(0);
    expect(firedDamage).not.toBeNull();
    expect(firedDamage as unknown as number).toBeGreaterThan(0);
    expect((target as any).__weatherMissTick).toBeUndefined();
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

  it('does not burn, slash, or target flyers without an anti-air item or aura', () => {
    const state = createGameState();
    (globalThis as any).__lastState = state;
    state.wave = 18;
    state.tick = 120;
    const tower = createTower(TowerType.ROMAN_TRANSFORMER, 5, 4, 4, 0);
    tower.attackCooldown = 0;
    (tower as any).__omegaWave = 18;
    (tower as any).__nextOmegaSlashTick = 120;
    state.towers.set(tower.id, tower);
    const flyer = flyerEnemy('omega-flyer', 150, 150);
    const hpBefore = flyer.hp;
    state.enemies.set(flyer.id, flyer);

    tickCombat(state, 0.016, noopCombatHooks());

    expect(flyer.hp).toBe(hpBefore);
    expect(flyer.statusEffects).toHaveLength(0);
    expect(tower.attackCooldown).toBeLessThanOrEqual(0);
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

describe('Giant Killer transformation and combat wiring', () => {
  it('fires a visible colossal splash without lending prey bonuses to the wrong target', () => {
    const state = createGameState();
    const tower = createTower(TowerType.GIANT_KILLER, 5, 4, 4, 0);
    const giant = testEnemy('giant-primary');
    giant.type = EnemyType.CYCLOPS;
    state.enemies.set(giant.id, giant);
    spawnProjectile(state, tower, giant, 550);

    expect(state.projectiles[state.projectiles.length - 1]?.splash).toBeCloseTo(1.6, 6);
    expect(GIANT_KILLER_SPLASH_DAMAGE_MULT).toBe(0.5);
    expect(giantKillerSplashDamage(550, giant, { type: EnemyType.FERAL_DOG })).toBeCloseTo(50, 6);
    expect(giantKillerSplashDamage(550, giant, { type: EnemyType.CYCLOPS })).toBeCloseTo(275, 6);
    expect(giantKillerSplashDamage(100, { type: EnemyType.FERAL_DOG }, { type: EnemyType.WAR_ELEPHANT })).toBeCloseTo(175, 6);
  });

  it('uses a deliberately slow colossal bow cadence with heavier individual arrows', () => {
    const def = (towersData as any)[TowerType.GIANT_KILLER];
    const positiveTowerSpeeds = Object.values(towersData as any)
      .map((tower: any) => Number(tower.attackSpeed ?? 0))
      .filter(speed => speed > 0);
    const fasterTowerShare = positiveTowerSpeeds.filter(speed => speed > def.attackSpeed).length / positiveTowerSpeeds.length;

    expect(def.attackSpeed).toBe(0.30);
    expect(1 / def.attackSpeed).toBeCloseTo(3.33, 1);
    expect(fasterTowerShare).toBeGreaterThan(0.9);

    const giantKiller = createTower(TowerType.GIANT_KILLER, 4, 4, 4, 0);
    const stats = towerEffectiveStats(giantKiller);
    expect(stats.attackSpeed).toBeCloseTo(0.39, 4);
    expect(towerPerAttackDamageBase(giantKiller)).toBeCloseTo(stats.dps / stats.attackSpeed, 4);
  });

  it('transforms only legal Tier V Giant\'s Bane carriers and opens four total slots', () => {
    const lowMilites = createTower(TowerType.MILITES, 3, 4, 4, 0);
    lowMilites.equippedItems.push(GIANTS_BANE_ITEM_ID);
    expect(canTransformWithGiantsBane(lowMilites)).toBe(false);
    expect(transformWithGiantsBane(lowMilites)).toBe(false);
    expect(lowMilites.type).toBe(TowerType.MILITES);

    const wrongTower = createTower(TowerType.HASTATI, 4, 4, 4, 0);
    wrongTower.equippedItems.push(GIANTS_BANE_ITEM_ID);
    expect(canTransformWithGiantsBane(wrongTower)).toBe(false);
    expect(transformWithGiantsBane(wrongTower)).toBe(false);
    expect(wrongTower.type).toBe(TowerType.HASTATI);

    const tierFourMilites = createTower(TowerType.MILITES, 4, 4, 4, 0);
    tierFourMilites.equippedItems.push(GIANTS_BANE_ITEM_ID);
    expect(canAwakenWithLegendaryItem(tierFourMilites, GIANTS_BANE_ITEM_ID)).toBe(false);
    expect(canTransformWithGiantsBane(tierFourMilites)).toBe(false);
    expect(transformWithGiantsBane(tierFourMilites)).toBe(false);

    const milites = createTower(TowerType.MILITES, 5, 4, 4, 0);
    milites.equippedItems.push('SHARPENED_BLADE', GIANTS_BANE_ITEM_ID);
    milites.equippedItemRarities = ['COMMON', 'LEGENDARY'];
    const before = towerEffectiveStats(milites);

    expect(canAwakenWithLegendaryItem(milites, GIANTS_BANE_ITEM_ID)).toBe(true);
    expect(canTransformWithGiantsBane(milites)).toBe(true);
    expect(transformWithGiantsBane(milites)).toBe(true);
    expect(milites.type).toBe(TowerType.GIANT_KILLER);
    expect(milites.equippedItems).toContain(GIANTS_BANE_ITEM_ID);
    expect(milites.equippedItemRarities).toEqual(['COMMON', 'LEGENDARY']);
    expect(towerItemSlotCap(milites)).toBe(4);
    expect(milites.builtFrom).toContain(TowerType.MILITES);
    expect(towerEffectiveStats(milites).dps).toBeGreaterThan(before.dps * 3);

    const lowCohort = createTower(TowerType.COHORT_GUARD, 3, 4, 4, 0);
    lowCohort.equippedItems.push(GIANTS_BANE_ITEM_ID);
    expect(canTransformWithGiantsBane(lowCohort)).toBe(false);
    expect(transformWithGiantsBane(lowCohort)).toBe(false);
    expect(lowCohort.type).toBe(TowerType.COHORT_GUARD);

    const tierFourCohort = createTower(TowerType.COHORT_GUARD, 4, 5, 4, 0);
    tierFourCohort.equippedItems.push(GIANTS_BANE_ITEM_ID);
    expect(canAwakenWithLegendaryItem(tierFourCohort, GIANTS_BANE_ITEM_ID)).toBe(false);
    expect(canTransformWithGiantsBane(tierFourCohort)).toBe(false);
    expect(transformWithGiantsBane(tierFourCohort)).toBe(false);

    const cohort = createTower(TowerType.COHORT_GUARD, 5, 5, 4, 0);
    cohort.equippedItems.push('BATTLE_STANDARD', GIANTS_BANE_ITEM_ID);
    cohort.equippedItemRarities = ['UNCOMMON', 'LEGENDARY'];
    const cohortBefore = towerEffectiveStats(cohort);

    expect(canAwakenWithLegendaryItem(cohort, GIANTS_BANE_ITEM_ID)).toBe(true);
    expect(canTransformWithGiantsBane(cohort)).toBe(true);
    expect(transformWithGiantsBane(cohort)).toBe(true);
    expect(cohort.type).toBe(TowerType.GIANTS_COHORT_GUARD);
    expect(cohort.equippedItems).toContain(GIANTS_BANE_ITEM_ID);
    expect(cohort.equippedItemRarities).toEqual(['UNCOMMON', 'LEGENDARY']);
    expect(towerItemSlotCap(cohort)).toBe(4);
    expect(cohort.builtFrom).toContain(TowerType.COHORT_GUARD);
    // The awakening is now a specialist, not a general-purpose early carry.
    // Its neutral sheet DPS only needs to improve meaningfully over Cohort
    // Guard; the giant-only combat multiplier supplies the legendary payoff.
    // The source Cohort Guard was strengthened in the 2026-07-13 combo pass.
    // Keep the awakened form's neutral damage restrained while its 9x giant
    // specialization remains the reason to spend Giant's Bane.
    expect(towerEffectiveStats(cohort).dps).toBeGreaterThan(cohortBefore.dps * 1.8);
  });

  it('transforms only legal Tier IV+ Witch\'s Brew Murmillo carriers and opens four total slots', () => {
    const lowMurmillo = createTower(TowerType.MURMILLO, 3, 4, 4, 0);
    lowMurmillo.equippedItems.push(WITCHS_BREW_ITEM_ID);
    expect(canTransformWithWitchsBrew(lowMurmillo)).toBe(false);
    expect(transformWithWitchsBrew(lowMurmillo)).toBe(false);
    expect(lowMurmillo.type).toBe(TowerType.MURMILLO);

    const wrongTower = createTower(TowerType.COHORT_GUARD, 4, 4, 4, 0);
    wrongTower.equippedItems.push(WITCHS_BREW_ITEM_ID);
    expect(canTransformWithWitchsBrew(wrongTower)).toBe(false);
    expect(transformWithWitchsBrew(wrongTower)).toBe(false);
    expect(wrongTower.type).toBe(TowerType.COHORT_GUARD);

    const murmillo = createTower(TowerType.MURMILLO, 4, 6, 6, 0);
    murmillo.equippedItems.push('SHARPENED_BLADE', WITCHS_BREW_ITEM_ID);
    murmillo.equippedItemRarities = ['COMMON', 'LEGENDARY'];
    const before = towerEffectiveStats(murmillo);

    expect(canTransformWithWitchsBrew(murmillo)).toBe(true);
    expect(transformWithWitchsBrew(murmillo)).toBe(true);
    expect(murmillo.type).toBe(TowerType.UNDEAD_GLADIATOR_KING);
    expect(murmillo.equippedItems).toContain(WITCHS_BREW_ITEM_ID);
    expect(murmillo.equippedItemRarities).toEqual(['COMMON', 'LEGENDARY']);
    expect(towerItemSlotCap(murmillo)).toBe(4);
    expect(murmillo.builtFrom).toContain(TowerType.MURMILLO);
    expect(towerEffectiveStats(murmillo).dps).toBeGreaterThan(before.dps * 1.8);
  });

  it('Undead Gladiator King raises timed melee summons that damage and slow enemies', () => {
    const state = createGameState();
    (globalThis as any).__lastState = state;
    state.wave = 14;
    state.tick = 100;
    const tower = createTower(TowerType.UNDEAD_GLADIATOR_KING, 5, 4, 4, 0);
    tower.attackCooldown = 999;
    state.towers.set(tower.id, tower);
    const c = towerCenter(tower);
    const target = testEnemy('king-summon-target', c.x + GRID.TILE * 1.2, c.y);
    target.hp = 5000;
    target.maxHp = 5000;
    state.enemies.set(target.id, target);
    let hitDamage = 0;
    const hooks = {
      ...noopCombatHooks(),
      onHit: (src: any, _enemy: any, dmg: number) => {
        if (src.id === tower.id) hitDamage += dmg;
      }
    };

    tickCombat(state, 0.016, hooks);
    state.tick += 0.4;
    tickCombat(state, 0.4, hooks);
    expect((state as any).__undeadGladiators).toHaveLength(UNDEAD_GLADIATOR_KING_SUMMON_COUNT);
    expect((tower as any).__nextUndeadKingSummonTick).toBeCloseTo(state.tick + UNDEAD_GLADIATOR_KING_SUMMON_INTERVAL, 4);

    const hpAfterSpawn = target.hp;
    for (let i = 0; i < 90; i++) {
      state.tick += 0.05;
      tickCombat(state, 0.05, hooks);
    }

    expect(target.hp).toBeLessThan(hpAfterSpawn);
    expect(hitDamage).toBeGreaterThan(0);
    expect(target.statusEffects.some(s => s.kind === StatusEffectKind.SLOW && s.magnitude === UNDEAD_GLADIATOR_KING_SUMMON_SLOW)).toBe(true);

    state.enemies.clear();
    state.tick = 100.4 + UNDEAD_GLADIATOR_KING_SUMMON_TTL + 0.25;
    tickCombat(state, 0.05, hooks);
    expect((state as any).__undeadGladiators).toHaveLength(0);
  });

  it('keeps item-awakened towers worth their legendary transform item', () => {
    const milites = createTower(TowerType.MILITES, 5, 4, 4, 0);
    const militesBefore = towerEffectiveStats(milites).dps;
    milites.equippedItems.push(GIANTS_BANE_ITEM_ID);
    expect(transformWithGiantsBane(milites)).toBe(true);
    const giantKillerDps = towerEffectiveStats(milites).dps;

    const cohort = createTower(TowerType.COHORT_GUARD, 5, 4, 4, 0);
    const cohortBefore = towerEffectiveStats(cohort).dps;
    cohort.equippedItems.push(GIANTS_BANE_ITEM_ID);
    expect(transformWithGiantsBane(cohort)).toBe(true);
    const giantsCohortDps = towerEffectiveStats(cohort).dps;

    const murmillo = createTower(TowerType.MURMILLO, 4, 4, 4, 0);
    const murmilloBefore = towerEffectiveStats(murmillo).dps;
    murmillo.equippedItems.push(WITCHS_BREW_ITEM_ID);
    expect(transformWithWitchsBrew(murmillo)).toBe(true);
    const kingStats = towerEffectiveStats(murmillo);
    const sustainedSummonDps = UNDEAD_GLADIATOR_KING_SUMMON_COUNT * (Math.max(12, kingStats.dps * UNDEAD_GLADIATOR_KING_SUMMON_DAMAGE_SCALAR) / 0.85);
    const kingBattlefieldDps = kingStats.dps + sustainedSummonDps;

    expect(giantKillerDps).toBeGreaterThan(militesBefore * 11);
    expect(giantsCohortDps).toBeGreaterThan(cohortBefore * 1.8);
    expect(giantsCohortDps * GIANTS_COHORT_GUARD_GIANT_DAMAGE_MULT).toBeGreaterThan(cohortBefore * 16);
    expect(kingBattlefieldDps).toBeGreaterThan(murmilloBefore * 4.0);
    expect(kingBattlefieldDps).toBeGreaterThan(giantsCohortDps);
    expect(kingBattlefieldDps).toBeLessThan(giantsCohortDps * GIANTS_COHORT_GUARD_GIANT_DAMAGE_MULT);
    expect(towerItemSlotCap(milites)).toBe(4);
    expect(towerItemSlotCap(cohort)).toBe(4);
    expect(towerItemSlotCap(murmillo)).toBe(4);
  });

  it('evolves into the new tower sprite when the legendary transform item is equipped', () => {
    const cases = [
      {
        source: TowerType.MILITES,
        tier: 5,
        item: GIANTS_BANE_ITEM_ID,
        transform: transformWithGiantsBane,
        result: TowerType.GIANT_KILLER,
        resultSprite: 'naval/t_tideforged_giant_killer.png'
      },
      {
        source: TowerType.COHORT_GUARD,
        tier: 5,
        item: GIANTS_BANE_ITEM_ID,
        transform: transformWithGiantsBane,
        result: TowerType.GIANTS_COHORT_GUARD,
        resultSprite: 't_giants_cohort_guard.png'
      },
      {
        source: TowerType.MURMILLO,
        tier: 4,
        item: WITCHS_BREW_ITEM_ID,
        transform: transformWithWitchsBrew,
        result: TowerType.UNDEAD_GLADIATOR_KING,
        resultSprite: 't_undead_gladiator_king.png'
      }
    ] as const;

    for (const c of cases) {
      const tower = createTower(c.source, c.tier as 4 | 5, 4, 4, 0);
      const originalSprite = (ASSET_KEYS as any)[tower.type];
      expect(originalSprite, `${c.source} should have a registered pre-evolution sprite`).toBeTruthy();

      tower.equippedItems.push(c.item);
      expect(c.transform(tower), `${c.source} should evolve when ${c.item} is equipped`).toBe(true);
      expect(tower.type).toBe(c.result);

      const evolvedSprite = (ASSET_KEYS as any)[tower.type];
      expect(evolvedSprite, `${c.result} should have a registered evolved sprite`).toBe(c.resultSprite);
      expect(evolvedSprite, `${c.result} should not keep the ${c.source} sprite after evolving`).not.toBe(originalSprite);
      expect(fs.existsSync(`public/assets/sprites/${evolvedSprite}`), `${c.result} evolved sprite file should exist`).toBe(true);
    }
  });

  it('specializes hard into giant-class enemies without becoming a universal answer', () => {
    function fireAt(type: EnemyType, faction: EnemyFaction, archetype: Enemy['archetype'] = 'SWARM') {
      const state = createGameState();
      (globalThis as any).__lastState = state;
      state.wave = 6;
      const tower = createTower(TowerType.GIANT_KILLER, 4, 4, 4, 0);
      tower.attackCooldown = 0;
      state.towers.set(tower.id, tower);
      const c = towerCenter(tower);
      const target = testEnemy(`giant-killer-${type}`, c.x + GRID.TILE * 2.5, c.y);
      target.type = type;
      target.faction = faction;
      target.archetype = archetype;
      target.hp = 10000;
      target.maxHp = 10000;
      state.enemies.set(target.id, target);
      const hooks = noopCombatHooks();
      tickCombat(state, 0.016, hooks);
      for (let i = 0; i < 240 && state.projectiles.length > 0; i++) {
        tickProjectiles(state, 0.05, {
          onImpact: (projectile, enemy) => {
            if (!enemy || projectile.cosmetic || projectile.damage <= 0) return;
            const source = state.towers.get(projectile.sourceTowerId);
            if (source) applyDamageAndStatus(state, source, enemy, projectile.damage, hooks);
          }
        });
      }
      return { loss: target.maxHp - target.hp, target };
    }

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    let nonGiantMyth: ReturnType<typeof fireAt>;
    let seaGiant: ReturnType<typeof fireAt>;
    let cyclops: ReturnType<typeof fireAt>;
    let warElephant: ReturnType<typeof fireAt>;
    let undeadElephant: ReturnType<typeof fireAt>;
    try {
      nonGiantMyth = fireAt(EnemyType.CHIMERA, EnemyFaction.ROMAN_MYTH, 'ELITE');
      seaGiant = fireAt(EnemyType.SEA_GIANT, EnemyFaction.ROMAN_MYTH, 'ELITE');
      cyclops = fireAt(EnemyType.CYCLOPS, EnemyFaction.ROMAN_MYTH, 'ELITE');
      warElephant = fireAt(EnemyType.WAR_ELEPHANT, EnemyFaction.CARTHAGE, 'ELITE');
      undeadElephant = fireAt(EnemyType.UNDEAD_WAR_ELEPHANT, EnemyFaction.UNDEAD_CARTHAGE, 'ELITE');
    } finally {
      randomSpy.mockRestore();
    }

    expect(GIANT_KILLER_GIANT_DAMAGE_MULT).toBe(5.5);
    expect(seaGiant.loss).toBeGreaterThan(nonGiantMyth.loss * 1.7);
    expect(cyclops.loss).toBeGreaterThan(nonGiantMyth.loss * 1.15);
    expect(warElephant.loss).toBeGreaterThan(nonGiantMyth.loss);
    expect(undeadElephant.loss).toBeGreaterThan(nonGiantMyth.loss);
    expect(warElephant.loss).toBeLessThan(seaGiant.loss);
    expect(undeadElephant.loss).toBeLessThan(seaGiant.loss);
    expect(nonGiantMyth.target.statusEffects.some(s => s.kind === StatusEffectKind.MARK)).toBe(false);
    expect(warElephant.target.statusEffects.some(s => s.kind === StatusEffectKind.MARK || s.kind === StatusEffectKind.SLOW)).toBe(false);
    expect(undeadElephant.target.statusEffects.some(s => s.kind === StatusEffectKind.MARK || s.kind === StatusEffectKind.SLOW)).toBe(false);
    expect(seaGiant.target.statusEffects.some(s => s.kind === StatusEffectKind.MARK && s.magnitude === 0.14)).toBe(true);
    expect(cyclops.target.statusEffects.some(s => s.kind === StatusEffectKind.MARK && s.magnitude === 0.14)).toBe(true);
  });

  it('treats elephants as secondary prey below true giants', () => {
    expect(GIANT_KILLER_ELEPHANT_DAMAGE_MULT).toBe(3.5);
    expect(GIANT_KILLER_GIANT_DAMAGE_MULT).toBe(5.5);
    expect(giantKillerPreyDamageMult({ type: EnemyType.WAR_ELEPHANT })).toBe(3.5);
    expect(giantKillerPreyDamageMult({ type: EnemyType.UNDEAD_WAR_ELEPHANT })).toBe(3.5);
    expect(giantKillerPreyDamageMult({ type: EnemyType.CYCLOPS })).toBe(5.5);
    expect(giantKillerPreyDamageMult({ type: EnemyType.SEA_GIANT })).toBe(5.5);
    expect(giantKillerPreyDamageMult({ type: EnemyType.CHIMERA })).toBe(1);

    const tower = createTower(TowerType.GIANT_KILLER, 5, 4, 4, 0);
    const elephant = testEnemy('giant-killer-elephant');
    elephant.type = EnemyType.WAR_ELEPHANT;
    applyDamageAndStatus(createGameState(), tower, elephant, 100, noopCombatHooks());
    expect(elephant.statusEffects.some(s => s.kind === StatusEffectKind.MARK || s.kind === StatusEffectKind.SLOW)).toBe(false);
  });

  it('surfaces general and prey DPS without drifting from combat multipliers', () => {
    const generalDps = 390;
    const rows = towerSpecialistDpsRows(TowerType.GIANT_KILLER, generalDps);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ label: 'Giant-family DPS', multiplier: 5.5, dps: 2145 });
    expect(rows[1]).toMatchObject({ label: 'Elephant DPS', multiplier: 3.5, dps: 1365 });
  });

  it('keeps Hannibal Nightmare decisively strongest against elephant packs', () => {
    const elephant = { type: EnemyType.WAR_ELEPHANT, isBoss: false, isFlyer: false };
    expect(HANNIBALS_NIGHTMARE_ELEPHANT_DAMAGE_MULT).toBe(6.5);
    expect(hannibalsNightmarePreyDamageMult(elephant)).toBeCloseTo(6.5, 6);

    const hannibalRows = towerSpecialistDpsRows(TowerType.HANNIBALS_NIGHTMARE, 235);
    const giantKillerRows = towerSpecialistDpsRows(TowerType.GIANT_KILLER, 390);
    expect(hannibalRows[0].dps).toBeCloseTo(1527.5, 4);
    expect(hannibalRows[1].dps).toBeCloseTo(3055, 4);
    expect(hannibalRows[1].dps).toBeGreaterThan(giantKillerRows[1].dps * 2);
    expect(giantKillerRows[0].dps).toBeGreaterThan(hannibalRows[0].dps);
  });

  it('calculates Hannibal prey damage independently for every twin-shot target', () => {
    const state = createGameState();
    state.wave = 10;
    const tower = createTower(TowerType.HANNIBALS_NIGHTMARE, 5, 4, 4, 0);
    tower.attackCooldown = 0;
    state.towers.set(tower.id, tower);
    const c = towerCenter(tower);

    const ordinary = testEnemy('hannibal-ordinary', c.x + GRID.TILE * 2, c.y);
    ordinary.type = EnemyType.CARTHAGE_ELITE_GUARD;
    ordinary.faction = EnemyFaction.CARTHAGE;
    ordinary.pathIndex = 5;
    ordinary.hp = ordinary.maxHp = 100000;
    const elephant = testEnemy('hannibal-elephant', c.x + GRID.TILE * 2.5, c.y);
    elephant.type = EnemyType.WAR_ELEPHANT;
    elephant.faction = EnemyFaction.CARTHAGE;
    elephant.isBoss = false;
    elephant.pathIndex = 4;
    elephant.hp = elephant.maxHp = 100000;
    state.enemies.set(ordinary.id, ordinary);
    state.enemies.set(elephant.id, elephant);

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    tickCombat(state, 0.016, noopCombatHooks());
    randomSpy.mockRestore();

    const ordinaryShot = state.projectiles.find(projectile => projectile.targetId === ordinary.id);
    const elephantShot = state.projectiles.find(projectile => projectile.targetId === elephant.id);
    expect(ordinaryShot).toBeDefined();
    expect(elephantShot).toBeDefined();
    expect(elephantShot!.damage / ordinaryShot!.damage).toBeCloseTo(6.5, 5);
    expect(ordinary.statusEffects.some(status => status.kind === StatusEffectKind.FREEZE)).toBe(true);
    expect(elephant.statusEffects.some(status => status.kind === StatusEffectKind.STUN)).toBe(true);
    expect(elephant.statusEffects.some(status => status.kind === StatusEffectKind.FREEZE)).toBe(false);
  });

  it('routes Giant\'s Cohort Guard through restrained melee cleave and giant-only specialization', () => {
    function swingAt(type: EnemyType, opts: { boss?: boolean; faction?: EnemyFaction; archetype?: Enemy['archetype'] } = {}) {
      const state = createGameState();
      state.wave = 6;
      const tower = createTower(TowerType.GIANTS_COHORT_GUARD, 5, 4, 4, 0);
      tower.attackCooldown = 0;
      state.towers.set(tower.id, tower);
      const c = towerCenter(tower);
      const target = testEnemy(`giants-cohort-${type}`, c.x + GRID.TILE * 1.4, c.y);
      target.type = type;
      target.faction = opts.faction ?? EnemyFaction.ROMAN_MYTH;
      target.archetype = opts.archetype ?? 'ELITE';
      target.isBoss = !!opts.boss;
      target.hp = 20000;
      target.maxHp = 20000;
      state.enemies.set(target.id, target);
      tickCombat(state, 0.016, noopCombatHooks());
      return { loss: target.maxHp - target.hp, target };
    }

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    let normal: ReturnType<typeof swingAt>;
    let boss: ReturnType<typeof swingAt>;
    let giant: ReturnType<typeof swingAt>;
    try {
      normal = swingAt(EnemyType.FERAL_DOG, { faction: EnemyFaction.DOGS, archetype: 'SWARM' });
      boss = swingAt(EnemyType.FERAL_DOG, { boss: true, faction: EnemyFaction.DOGS, archetype: 'BOSS' });
      giant = swingAt(EnemyType.SEA_GIANT, { faction: EnemyFaction.ROMAN_MYTH, archetype: 'ELITE' });
    } finally {
      randomSpy.mockRestore();
    }

    expect(GIANTS_COHORT_GUARD_GIANT_DAMAGE_MULT).toBe(9);
    expect(normal.loss).toBeGreaterThan(0);
    expect(boss.loss).toBeCloseTo(normal.loss, 5);
    // SEA_GIANT resists physical melee, so the authored 9x prey bonus
    // resolves to roughly 3.8x actual damage after target resistances.
    expect(giant.loss).toBeGreaterThan(normal.loss * 3.5);
    expect(normal.target.statusEffects.some(s => s.kind === StatusEffectKind.SLOW)).toBe(false);
    expect(boss.target.statusEffects.some(s => s.kind === StatusEffectKind.MARK)).toBe(false);
    expect(giant.target.statusEffects.some(s => s.kind === StatusEffectKind.MARK && s.magnitude === 0.24)).toBe(true);
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
    // 2026-07-07 — TIDE is deliberately anchored in the ocean below WP2,
    // so it joins the later special-position tiles rather than the original six.
    const spread = AURA_TILES.filter(t => t.kind !== 'IVORY' && t.kind !== 'AMBER' && t.kind !== 'TIDE');
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

  it('exactly 9 aura tiles on the map (one of each kind)', () => {
    expect(AURA_TILES.length).toBe(9);
    const kinds = new Set(AURA_TILES.map(t => t.kind));
    expect(kinds.size).toBe(9);  // all distinct
    expect(kinds.has('EMERALD')).toBe(true);
    expect(kinds.has('IVORY')).toBe(true);
    expect(kinds.has('AMBER')).toBe(true);
    expect(kinds.has('TIDE')).toBe(true);
  });

  it('IVORY tile declares an additive DIVINE rider', () => {
    const ivory = AURA_TILES.find(t => t.kind === 'IVORY')!;
    expect(AURA_TILE_EFFECTS.IVORY?.divineRiderPct).toBeCloseTo(0.35, 4);
    expect(AURA_TILE_EFFECTS.IVORY?.label).toBe('DIVINE TILE');
    expect(AURA_TILE_EFFECTS.IVORY?.description).toContain('keeps its normal damage');
    // The tile sits on open buildable terrain (clear of every waypoint).
    expect(ivory.col).toBe(31);
  });

  it('AMBER tile declares a splash blast radius', () => {
    expect(AURA_TILE_EFFECTS.AMBER?.splashBonus).toBeGreaterThan(0);
    expect(AURA_TILE_EFFECTS.AMBER?.label).toBe('BLAST TILE');
  });

  it('TIDE tile sits in the ocean below checkpoint 2 and declares a 30% hit slow', () => {
    const state = createGameState();
    initializeGrid(state);
    const tide = AURA_TILES.find(t => t.kind === 'TIDE')!;
    expect(tide).toMatchObject({ col: 10, row: 16 });
    expect(isWaterZoneTile(tide.col, tide.row)).toBe(true);
    expect(isBuildable(state, tide.col, tide.row)).toBe(false);
    expect(canBuildWaterTowerAt(state, tide.col, tide.row)).toBe(true);
    expect(AURA_TILE_EFFECTS.TIDE?.hitSlowPct).toBeCloseTo(0.30, 4);
    expect(AURA_TILE_EFFECTS.TIDE?.label).toBe('TIDE TILE');
  });

  it('tower on TIDE tile slows only enemies it damages', () => {
    const state = createGameState();
    initializeGrid(state);
    const tide = AURA_TILES.find(t => t.kind === 'TIDE')!;
    const tower = createTower(TowerType.DECURION, 3, tide.col, tide.row, 0);
    tower.attackCooldown = 0;
    state.towers.set(tower.id, tower);
    const center = towerCenter(tower);
    const hit = testEnemy('hit', center.x + GRID.TILE, center.y);
    const untouched = testEnemy('untouched', 900, 700);
    state.enemies.set(hit.id, hit);
    state.enemies.set(untouched.id, untouched);

    tickCombat(state, 0.016, noopCombatHooks());

    expect(hit.statusEffects.some(s => s.kind === StatusEffectKind.SLOW && s.magnitude === 0.30)).toBe(true);
    expect(untouched.statusEffects.some(s => s.kind === StatusEffectKind.SLOW)).toBe(false);
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

    expect(withGlobal.damage / base.damage).toBeCloseTo(1.22, 4);
  });

  it('reduces Eagle Standard global damage to 10% without changing its local speed aura', () => {
    const base = singleSwingDamage();
    const far = singleSwingDamage({
      support: [{ type: TowerType.EAGLE_STANDARD, x: 1, y: 1, tier: 5 }]
    });
    const nearby = singleSwingDamage({
      support: [{ type: TowerType.EAGLE_STANDARD, x: 9, y: 10, tier: 5 }]
    });

    expect(EAGLE_STANDARD_GLOBAL_DAMAGE_BONUS).toBe(0.10);
    expect(far.damage / base.damage).toBeCloseTo(1.10, 4);
    expect(nearby.damage / base.damage).toBeCloseTo(1.10, 4);
    expect(far.cooldown / nearby.cooldown).toBeCloseTo(1.22, 4);
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

  it('Capitoline Aegis lets a native non-divine tower damage divine-only enemies with only its divine rider', () => {
    const state = createGameState();
    const attacker = createTower(TowerType.DECURION, 1, 10, 10, 0);
    attacker.attackCooldown = 0;
    attacker.equippedItems.push('CAPITOLINE_AEGIS');
    state.towers.set(attacker.id, attacker);
    const c = towerCenter(attacker);
    const target = testEnemy('aegis-spirit', c.x + GRID.TILE, c.y);
    target.type = EnemyType.OCEAN_GHOST_SPIRIT;
    target.faction = EnemyFaction.ROMAN_MYTH;
    target.hp = 100000;
    target.maxHp = 100000;
    state.enemies.set(target.id, target);
    let hitDamage = 0;

    tickCombat(state, 0.016, {
      ...noopCombatHooks(),
      onHit: (_tower, _enemy, damage) => { hitDamage = damage; }
    });

    const expected = towerPerAttackDamageBase(attacker) *
      CAPITOLINE_AEGIS_DIVINE_RIDER_PCT *
      resistanceModifier(target.faction, DamageType.DIVINE) *
      enemyDamageMultiplier(target, DamageType.DIVINE);
    expect(attacker.damageType).toBe(DamageType.PHYS_MELEE);
    expect(hitDamage).toBeCloseTo(expected, 4);
    expect(100000 - target.hp).toBeCloseTo(expected, 4);
  });

  it('Capitoline Aegis does not bypass enemies that are explicitly divine-immune', () => {
    const state = createGameState();
    const attacker = createTower(TowerType.DECURION, 1, 10, 10, 0);
    attacker.attackCooldown = 0;
    attacker.equippedItems.push('CAPITOLINE_AEGIS');
    state.towers.set(attacker.id, attacker);
    const c = towerCenter(attacker);
    const target = testEnemy('aegis-divine-immune', c.x + GRID.TILE, c.y);
    target.type = EnemyType.MONGOL_CAPTAIN;
    target.faction = EnemyFaction.MONGOLS;
    target.hp = 100000;
    target.maxHp = 100000;
    state.enemies.set(target.id, target);
    let hitDamage = 0;

    tickCombat(state, 0.016, {
      ...noopCombatHooks(),
      onHit: (_tower, _enemy, damage) => { hitDamage = damage; }
    });

    const expectedNativeOnly = towerPerAttackDamageBase(attacker) *
      resistanceModifier(target.faction, DamageType.PHYS_MELEE) *
      enemyDamageMultiplier(target, DamageType.PHYS_MELEE);
    expect(hitDamage).toBeCloseTo(expectedNativeOnly, 4);
    expect(100000 - target.hp).toBeCloseTo(expectedNativeOnly, 4);
  });

  it('Divine Tile adds a separate divine packet without replacing native damage', () => {
    const state = createGameState();
    const ivory = AURA_TILES.find(tile => tile.kind === 'IVORY')!;
    const attacker = createTower(TowerType.DECURION, 1, ivory.col, ivory.row, 0);
    attacker.attackCooldown = 0;
    state.towers.set(attacker.id, attacker);
    const c = towerCenter(attacker);
    const target = testEnemy('ivory-neutral', c.x + GRID.TILE, c.y);
    target.faction = EnemyFaction.CARTHAGE;
    target.hp = 100000;
    target.maxHp = 100000;
    state.enemies.set(target.id, target);
    let hitDamage = 0;

    tickCombat(state, 0.016, {
      ...noopCombatHooks(),
      onHit: (_tower, _enemy, damage) => { hitDamage = damage; }
    });

    const nativePacket = resistanceModifier(target.faction, DamageType.PHYS_MELEE) *
      enemyDamageMultiplier(target, DamageType.PHYS_MELEE);
    const divinePacket = AURA_TILE_EFFECTS.IVORY.divineRiderPct! *
      resistanceModifier(target.faction, DamageType.DIVINE) *
      enemyDamageMultiplier(target, DamageType.DIVINE);
    const expected = towerPerAttackDamageBase(attacker) * (nativePacket + divinePacket);
    expect(attacker.damageType).toBe(DamageType.PHYS_MELEE);
    expect(hitDamage).toBeCloseTo(expected, 4);
    expect((attacker as any).__divineRiderVfx).toBe(true);
  });

  it('Divine Tile lets native towers target divine-only spirits with only the rider', () => {
    const state = createGameState();
    const ivory = AURA_TILES.find(tile => tile.kind === 'IVORY')!;
    const attacker = createTower(TowerType.DECURION, 1, ivory.col, ivory.row, 0);
    attacker.attackCooldown = 0;
    state.towers.set(attacker.id, attacker);
    const c = towerCenter(attacker);
    const target = testEnemy('ivory-spirit', c.x + GRID.TILE, c.y);
    target.type = EnemyType.OCEAN_GHOST_SPIRIT;
    target.faction = EnemyFaction.ROMAN_MYTH;
    target.hp = 100000;
    target.maxHp = 100000;
    state.enemies.set(target.id, target);
    let hitDamage = 0;

    tickCombat(state, 0.016, {
      ...noopCombatHooks(),
      onHit: (_tower, _enemy, damage) => { hitDamage = damage; }
    });

    const expected = towerPerAttackDamageBase(attacker) *
      AURA_TILE_EFFECTS.IVORY.divineRiderPct! *
      resistanceModifier(target.faction, DamageType.DIVINE) *
      enemyDamageMultiplier(target, DamageType.DIVINE);
    expect(hitDamage).toBeCloseTo(expected, 4);
    expect(100000 - target.hp).toBeCloseTo(expected, 4);
  });

  it('Divine immunity blocks only the Divine Tile rider, not the native hit', () => {
    const state = createGameState();
    const ivory = AURA_TILES.find(tile => tile.kind === 'IVORY')!;
    const attacker = createTower(TowerType.DECURION, 1, ivory.col, ivory.row, 0);
    attacker.attackCooldown = 0;
    state.towers.set(attacker.id, attacker);
    const c = towerCenter(attacker);
    const target = testEnemy('ivory-divine-immune', c.x + GRID.TILE, c.y);
    target.type = EnemyType.MONGOL_CAPTAIN;
    target.faction = EnemyFaction.MONGOLS;
    target.hp = 100000;
    target.maxHp = 100000;
    state.enemies.set(target.id, target);
    let hitDamage = 0;

    tickCombat(state, 0.016, {
      ...noopCombatHooks(),
      onHit: (_tower, _enemy, damage) => { hitDamage = damage; }
    });

    const expectedNative = towerPerAttackDamageBase(attacker) *
      resistanceModifier(target.faction, DamageType.PHYS_MELEE) *
      enemyDamageMultiplier(target, DamageType.PHYS_MELEE);
    expect(hitDamage).toBeCloseTo(expectedNative, 4);
    expect(100000 - target.hp).toBeCloseTo(expectedNative, 4);
  });

  it('adds Divine Tile and Capitoline Aegis riders instead of multiplying them', () => {
    const state = createGameState();
    const ivory = AURA_TILES.find(tile => tile.kind === 'IVORY')!;
    const tower = createTower(TowerType.DECURION, 1, ivory.col, ivory.row, 0);
    const base = displayedDpsFromBreakdown(createTower(TowerType.DECURION, 1, 0, 0, 0), state);
    tower.equippedItems.push('CAPITOLINE_AEGIS');
    const breakdown = towerStatBreakdown(tower, state);
    const rider = breakdown.damageMods.find(mod => mod.source.startsWith('Divine riders:'));

    expect(rider?.multiplier).toBeCloseTo(1.70, 4);
    expect(displayedDpsFromBreakdown(tower, state)).toBeCloseTo(base * 1.70, 4);
  });

  it('burn rider items fail independently on fire-immune enemies without canceling native damage', () => {
    const state = createGameState();
    const attacker = createTower(TowerType.DECURION, 1, 10, 10, 0);
    attacker.attackCooldown = 0;
    attacker.equippedItems.push('VESTAL_PYRE');
    state.towers.set(attacker.id, attacker);
    const c = towerCenter(attacker);
    const target = testEnemy('vestal-pyre-fire-immune', c.x + GRID.TILE, c.y);
    target.type = EnemyType.DEMON_HELLHOUND;
    target.faction = EnemyFaction.SUPER_DEMONS;
    target.hp = 100000;
    target.maxHp = 100000;
    state.enemies.set(target.id, target);
    let hitDamage = 0;

    tickCombat(state, 0.016, {
      ...noopCombatHooks(),
      onHit: (_tower, _enemy, damage) => { hitDamage = damage; }
    });

    const expectedNativeOnly = towerPerAttackDamageBase(attacker) *
      resistanceModifier(target.faction, DamageType.PHYS_MELEE) *
      enemyDamageMultiplier(target, DamageType.PHYS_MELEE);
    expect(hitDamage).toBeCloseTo(expectedNativeOnly, 4);
    expect(100000 - target.hp).toBeCloseTo(expectedNativeOnly, 4);
    expect(target.statusEffects.some(s => s.kind === StatusEffectKind.BURN)).toBe(false);
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

  it('does not roll Tier 5 Velites or Scorpio even when the tier roll lands on T5', () => {
    const state = createGameState();
    state.poolLevel = ECONOMY.POOL_MAX_LEVEL;
    state.heroLevel = ECONOMY.POOL_MAX_LEVEL;
    const randomSpy = vi.spyOn(Math, 'random');
    try {
      randomSpy.mockReturnValue(0.99);
      const draw = rollDraw(state, [TowerType.VELITES, TowerType.SCORPIO, TowerType.LEGATE]);
      expect(draw.every(card => !(card.tier === 5 && [TowerType.VELITES, TowerType.SCORPIO].includes(card.type)))).toBe(true);
      expect(draw.some(card => card.tier === 5)).toBe(true);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('keeps capped-only input pools from producing illegal Tier 5 capped cards', () => {
    const state = createGameState();
    state.poolLevel = ECONOMY.POOL_MAX_LEVEL;
    state.heroLevel = ECONOMY.POOL_MAX_LEVEL;
    const randomSpy = vi.spyOn(Math, 'random');
    try {
      randomSpy.mockReturnValue(0.99);
      const draw = rollDraw(state, [TowerType.VELITES, TowerType.SCORPIO]);
      expect(draw.every(card => !(card.tier === 5 && [TowerType.VELITES, TowerType.SCORPIO].includes(card.type)))).toBe(true);
      expect(draw.every(card => card.tier <= maxQualityTierForTower(card.type))).toBe(true);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('keeps unlocked specialist lines available on every higher Solo tier', () => {
    for (const type of [TowerType.VENATOR, TowerType.AQUILA_VENATOR]) {
      expect(soloProspectTierPool(2)).not.toContain(type);
      expect(soloProspectTierPool(3)).toContain(type);
      expect(soloProspectTierPool(4)).toContain(type);
      expect(soloProspectTierPool(5)).toContain(type);
    }
    expect(soloProspectTierPool(4)).not.toContain(TowerType.PRAEFECTUS);
    expect(soloProspectTierPool(5)).toContain(TowerType.PRAEFECTUS);
  });

  it('gives Venator lines a comparable max-pool type chance instead of a T3-only bottleneck', () => {
    const level = ECONOMY.POOL_MAX_LEVEL;
    const legate = soloTowerTypeChance(level, TowerType.LEGATE);
    const venator = soloTowerTypeChance(level, TowerType.VENATOR);
    const aquila = soloTowerTypeChance(level, TowerType.AQUILA_VENATOR);
    const praefectus = soloTowerTypeChance(level, TowerType.PRAEFECTUS);

    expect(venator).toBeCloseTo(aquila, 8);
    expect(venator).toBeGreaterThanOrEqual(legate * 0.75);
    expect(praefectus).toBeGreaterThan(0);
    expect(praefectus).toBeLessThan(venator);
  });

  it('never emits a Solo card outside that tower line\'s legal tier range', () => {
    const state = createGameState();
    state.poolLevel = ECONOMY.POOL_MAX_LEVEL;
    state.heroLevel = ECONOMY.POOL_MAX_LEVEL;
    for (let i = 0; i < 1000; i++) {
      for (const card of rollSoloDraw(state)) {
        expect(card.tier).toBeLessThanOrEqual(maxQualityTierForTower(card.type));
      }
    }
  });
});
