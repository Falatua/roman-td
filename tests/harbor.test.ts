import { describe, expect, it, vi } from 'vitest';
import { GamePhase, EnemyFaction, EnemyType, StatusEffectKind, TileType, TowerType, type Enemy, type Tower } from '../src/types';
import { createGameState } from '../src/GameState';
import { GRID, WATER_ZONE } from '../src/constants';
import { initializeGrid, setTowerTile, tileAt } from '../src/systems/GridManager';
import { buildGroundPath } from '../src/systems/PathFinder';
import { createTower, towerEffectiveStats } from '../src/systems/TowerSystem';
import { executeCombo, scanCombos } from '../src/systems/CombinationEngine';
import { applyDamageAndStatus, fatedCurrentDamageMult, tickCombat, type CombatHooks } from '../src/systems/CombatResolver';
import { tickProjectiles } from '../src/systems/ProjectileSystem';
import { commanderDamageTakenMult, commanderSpeedMult, isCommanderType, tickCommanderSupport } from '../src/systems/CommanderSystem';
import towersData from '../src/data/towers.json';
import {
  buildHarborDraftOffers,
  harborDraftTierForWave,
  harborTowerCanUseTile,
  isHarborTowerType,
  isOceanThreatEnemy,
  markHarborUnlocked,
  queueHarborDraftForClearedOceanWave,
  queueHarborDraftPurchase,
  placeTowerTileForType,
  shouldUnlockHarborFromKill,
  waveHasOceanThreats
} from '../src/systems/HarborSystem';

function waterTile() {
  return { col: WATER_ZONE.col + 1, row: WATER_ZONE.row + WATER_ZONE.height - 2 };
}

function readyState() {
  const s = createGameState();
  initializeGrid(s);
  s.phase = GamePhase.BUILD_PHASE;
  s.gold = 9999;
  s.groundPath = buildGroundPath(s)!;
  return s;
}

function placeTower(s: any, type: TowerType, tier: 1 | 2 | 3 | 4 | 5, col: number, row: number, water = false) {
  expect(setTowerTile(s, col, row)).toBe(true);
  const t = createTower(type, tier, col, row, s.wave);
  if (water) (t as any).placedOnWater = true;
  s.towers.set(t.id, t);
  return t;
}

function towerCenter(tower: { tileX: number; tileY: number }) {
  return {
    x: tower.tileX * GRID.TILE + GRID.TILE / 2,
    y: tower.tileY * GRID.TILE + GRID.TILE / 2
  };
}

function combatTarget(id: string, tower: Tower, offsetTiles = 1): Enemy {
  const c = towerCenter(tower);
  return {
    id,
    type: EnemyType.FERAL_DOG,
    faction: EnemyFaction.DOGS,
    hp: 100000,
    maxHp: 100000,
    baseSpeed: 1,
    currentSpeed: 1,
    isFlyer: false,
    x: c.x + offsetTiles * GRID.TILE,
    y: c.y,
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

function leaderboardDamageHooks(): CombatHooks {
  return {
    onKill: () => {},
    onHit: (tower, _enemy, damage) => {
      const dealt = Math.max(0, damage);
      tower.damageThisWave = (tower.damageThisWave ?? 0) + dealt;
      tower.totalDamageDealt = (tower.totalDamageDealt ?? 0) + dealt;
    },
    onMeleeSwing: () => {},
    onProjectileFire: () => {}
  };
}

function runOneAttackThroughLeaderboard(type: TowerType, tier: 1 | 2 | 3 | 4 | 5, offsetTiles = 1) {
  const s = readyState();
  s.phase = GamePhase.WAVE_PHASE;
  s.wave = 12;
  const tower = createTower(type, tier, 10, 10, s.wave);
  tower.attackCooldown = 0;
  tower.damageThisWave = 0;
  tower.totalDamageDealt = 0;
  (tower as any).placedOnWater = true;
  s.towers.set(tower.id, tower);

  const target = combatTarget(`target-${type}`, tower, offsetTiles);
  s.enemies.set(target.id, target);

  const hooks = leaderboardDamageHooks();
  tickCombat(s, 0.016, hooks);
  for (let i = 0; i < 240 && s.projectiles.length > 0; i++) {
    tickProjectiles(s, 0.05, {
      onImpact: (projectile, enemy) => {
        if (!enemy || projectile.cosmetic || projectile.damage <= 0) return;
        const source = s.towers.get(projectile.sourceTowerId);
        if (source) applyDamageAndStatus(s, source, enemy, projectile.damage, hooks);
      }
    });
  }

  return {
    tower,
    target,
    projectilesLeft: s.projectiles.length
  };
}

describe('Harbor naval tower system', () => {
  it('refuses every queued tower tile commit during an active wave', () => {
    const s = readyState();
    s.phase = GamePhase.WAVE_PHASE;
    const before = tileAt(s, 5, 5);

    expect(placeTowerTileForType(s, TowerType.MILITES, 5, 5)).toBe(false);
    expect(tileAt(s, 5, 5)).toBe(before);
  });

  it('offers Harbor drafts after cleared ocean-threat waves and builds three draft offers', () => {
    const s = readyState();
    s.wave = 3;
    expect(shouldUnlockHarborFromKill(s, EnemyType.FERAL_DOG)).toBe(false);
    expect(waveHasOceanThreats(3)).toBe(true);
    expect(waveHasOceanThreats(4)).toBe(false);
    expect(queueHarborDraftForClearedOceanWave(s)).toBe(true);
    expect((s as any).harborUnlocked).toBe(true);
    expect((s as any).__pendingHarborWaveDraft).toBe(3);
    expect((s as any).__pendingHarborUnlockNotice).toBe(false);
    expect((s as any).__harborDraftWave).toBe(3);
    expect((s as any).__harborDraftOffers).toHaveLength(3);
    expect(s.hint).toContain('Ocean threat wave 3 cleared');
    expect(harborDraftTierForWave(3)).toBe(2);
    const earlyOffers = buildHarborDraftOffers(s);
    expect(earlyOffers).toBe((s as any).__harborDraftOffers);
    expect(earlyOffers).toHaveLength(3);
    for (const offer of earlyOffers) {
      expect(isHarborTowerType(offer.type)).toBe(true);
      expect(offer.tier).toBe(2);
      expect(offer.price).toBeGreaterThan(0);
    }
  });

  it('refreshes Harbor contracts after every cleared water-enemy wave', () => {
    const s = readyState();
    s.wave = 3;
    expect(queueHarborDraftForClearedOceanWave(s)).toBe(true);
    const wave3Offers = buildHarborDraftOffers(s);
    expect(wave3Offers).toHaveLength(3);
    expect(wave3Offers.every(o => o.tier === 2)).toBe(true);

    s.wave = 12;
    expect(queueHarborDraftForClearedOceanWave(s)).toBe(true);
    const wave12Offers = buildHarborDraftOffers(s);
    expect(wave12Offers).toHaveLength(3);
    expect(wave12Offers).not.toBe(wave3Offers);
    expect(wave12Offers.every(o => o.tier === 2)).toBe(true);
    expect((s as any).__pendingHarborWaveDraft).toBe(12);
    expect((s as any).__harborDraftWave).toBe(12);
    expect(harborDraftTierForWave(16)).toBe(3);
    expect(harborDraftTierForWave(21)).toBe(4);
    expect(harborDraftTierForWave(27)).toBe(5);
  });

  it('randomizes naval contract tower choices when the Harbor draft refreshes', () => {
    const s = readyState();
    s.wave = 12;
    const randomSpy = vi.spyOn(Math, 'random');
    try {
      randomSpy.mockReturnValue(0);
      const first = buildHarborDraftOffers(s, true).map(o => o.type);
      const cached = buildHarborDraftOffers(s).map(o => o.type);
      expect(cached).toEqual(first);

      randomSpy.mockReturnValue(0.999);
      const refreshed = buildHarborDraftOffers(s, true).map(o => o.type);
      expect(refreshed).not.toEqual(first);
      expect(new Set(refreshed).size).toBe(refreshed.length);
      for (const type of refreshed) expect(isHarborTowerType(type)).toBe(true);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('reserves one randomized Harbor slot for the best current recipe path', () => {
    const s = readyState();
    s.wave = 16;
    placeTower(s, TowerType.SCORPIO, 4, 12, 8);

    const offers = buildHarborDraftOffers(s, true);
    const trireme = offers.find(offer => offer.type === TowerType.TRIREME_BALLISTA);
    expect(trireme).toBeDefined();
    expect(trireme?.tier).toBe(3);
    expect(trireme?.recipeAssisted).toBe(true);
  });

  it('still marks Sea Giant-class kills as Harbor unlocks without opening a modal mid-wave', () => {
    const s = readyState();
    s.wave = 12;
    expect(shouldUnlockHarborFromKill(s, EnemyType.SEA_GIANT)).toBe(true);
    expect(markHarborUnlocked(s)).toBe(true);
    expect((s as any).harborUnlocked).toBe(true);
    expect((s as any).__pendingHarborWaveDraft).toBe(12);
    expect((s as any).__pendingHarborUnlockNotice).toBeFalsy();
    expect(s.hint).toContain('after this ocean wave');
    expect(harborDraftTierForWave(12)).toBe(2);
    const offers = buildHarborDraftOffers(s, true);
    expect(offers).toHaveLength(3);
    for (const offer of offers) {
      expect(isHarborTowerType(offer.type)).toBe(true);
      expect(offer.tier).toBe(2);
      expect(offer.price).toBeGreaterThan(0);
    }
  });

  it('identifies ocean threats for naval quests and item bonuses', () => {
    expect(isOceanThreatEnemy(EnemyType.OCEAN_FISHLING)).toBe(true);
    expect(isOceanThreatEnemy(EnemyType.OCEAN_GHOST_SPIRIT)).toBe(true);
    expect(isOceanThreatEnemy(EnemyType.SEA_GIANT_WARBRINGER)).toBe(true);
    expect(isOceanThreatEnemy(EnemyType.TIDECALLER_COMMANDER)).toBe(true);
    expect(isOceanThreatEnemy(EnemyType.STORMTIDE_WYVERN_COMMANDER)).toBe(true);
    expect(isOceanThreatEnemy({ type: EnemyType.FERAL_DOG, __oceanSpawn: true })).toBe(true);
    expect(isOceanThreatEnemy(EnemyType.FERAL_DOG)).toBe(false);
  });

  it('queues Harbor purchases and only lets naval towers use water tiles', () => {
    const s = readyState();
    markHarborUnlocked(s);
    const tile = waterTile();
    const offer = { type: TowerType.TRIREME_BALLISTA, tier: 2 as const, price: 100 };
    expect(queueHarborDraftPurchase(s, offer)).toBe(true);
    expect(s.pendingPurchasedTowers?.[0]).toMatchObject({ type: TowerType.TRIREME_BALLISTA, tier: 2, source: 'harbor' });
    expect(harborTowerCanUseTile(s, TowerType.TRIREME_BALLISTA, tile.col, tile.row)).toBe(true);
    expect(harborTowerCanUseTile(s, TowerType.MILITES, tile.col, tile.row)).toBe(false);
    expect(harborTowerCanUseTile(s, TowerType.TRIREME_BALLISTA, WATER_ZONE.col + WATER_ZONE.width + 1, WATER_ZONE.row)).toBe(false);
  });

  it('tideforged combos preserve ocean tiles instead of turning them into stones', () => {
    const s = readyState();
    s.wave = 18;
    markHarborUnlocked(s);
    const water = waterTile();
    const trireme = placeTower(s, TowerType.TRIREME_BALLISTA, 3, water.col, water.row, true);
    placeTower(s, TowerType.SCORPIO, 4, 12, 7);
    const combo = scanCombos(s).find(c => c.result === TowerType.PRAETORIAN_FLEET);
    expect(combo).toBeTruthy();
    expect(executeCombo(s, combo!, trireme.id)).toBe(true);
    const result = Array.from(s.towers.values()).find(t => t.type === TowerType.PRAETORIAN_FLEET);
    expect(result).toBeTruthy();
    expect((result as any).placedOnWater).toBe(true);
    expect(tileAt(s, water.col, water.row)).toBe(TileType.TOWER);
    const oldLandIngredientTile = tileAt(s, 12, 7);
    expect(oldLandIngredientTile).toBe(TileType.STONE);
  });

  it('keeps Giant Killer out of normal Harbor recipes after the Giant\'s Bane rework', () => {
    const s = readyState();
    s.wave = 18;
    markHarborUnlocked(s);
    const water = waterTile();
    placeTower(s, TowerType.NEREID_ORACLE, 4, water.col, water.row, true);
    placeTower(s, TowerType.LIBRITOR, 4, 12, 7);
    placeTower(s, TowerType.BEAST_HUNTER, 4, 13, 7);

    expect(scanCombos(s).some(c => c.result === TowerType.GIANT_KILLER)).toBe(false);
    expect(isHarborTowerType(TowerType.GIANT_KILLER)).toBe(false);
  });

  it('naval items give Harbor towers real stat growth', () => {
    const base = createTower(TowerType.TRIREME_BALLISTA, 3, 2, 20, 12);
    const plain = towerEffectiveStats(base);
    base.equippedItems.push('AEGEAN_PEARL', 'STORMGLASS_AMPHORA', 'NEPTUNES_TRIDENT');
    const boosted = towerEffectiveStats(base);
    expect(boosted.dps).toBeGreaterThan(plain.dps * 2.0);
    expect(boosted.attackSpeed).toBeGreaterThan(plain.attackSpeed);
    expect(boosted.range).toBeGreaterThanOrEqual(plain.range + 1.75);
  });

  it('keeps new Harbor towers inside the intended balance band', () => {
    const charybdis = createTower(TowerType.CHARYBDIS_VORTEX, 4, 2, 20, 12);
    const nereid = createTower(TowerType.NEREID_ORACLE, 4, 3, 20, 12);
    const oracle = createTower(TowerType.ORACLE_LIGHTHOUSE, 5, 4, 20, 12);
    oracle.placedOnWater = true;
    const leviathan = createTower(TowerType.NEPTUNES_LEVIATHAN, 5, 5, 20, 12);
    leviathan.placedOnWater = true;
    const transformer = createTower(TowerType.ROMAN_TRANSFORMER, 5, 6, 20, 12);
    const fleet = createTower(TowerType.PRAETORIAN_FLEET, 5, 7, 20, 12);
    fleet.placedOnWater = true;

    expect(towerEffectiveStats(charybdis).dps).toBeGreaterThan(155);
    expect(towerEffectiveStats(nereid).dps).toBeGreaterThan(145);
    expect(towerEffectiveStats(oracle).dps).toBeGreaterThan(470);
    expect(towerEffectiveStats(oracle).dps).toBeLessThan(towerEffectiveStats(fleet).dps);
    expect(towerEffectiveStats(leviathan).dps).toBeGreaterThan(3000);
    expect(towerEffectiveStats(leviathan).dps).toBeGreaterThan(towerEffectiveStats(transformer).dps);
    expect(towerEffectiveStats(leviathan).range).toBeLessThan(towerEffectiveStats(transformer).range / 2);
  });

  it('keeps Harbor tower ability copy practical instead of flavor-only', () => {
    const harborTypes = [
      TowerType.TRIREME_BALLISTA,
      TowerType.CORVUS_BOARDING_SHIP,
      TowerType.RAMMING_QUINQUEREME,
      TowerType.CHARYBDIS_VORTEX,
      TowerType.NEREID_ORACLE,
      TowerType.HYDRA_OF_LERNA,
      TowerType.PRAETORIAN_FLEET,
      TowerType.CORVUS_LEGION_DOCK,
      TowerType.ORACLE_LIGHTHOUSE,
      TowerType.ABYSSAL_ONAGER,
      TowerType.HYDRA_BEAST_PIT,
      TowerType.MARS_TIDAL_BASTION,
      TowerType.NEPTUNES_LEVIATHAN
    ];

    for (const type of harborTypes) {
      const ability = String((towersData as any)[type]?.ability ?? '');
      expect(ability, `${type} should name placement rules`).toMatch(/OCEAN|TIDEFORGED|WATER-ONLY/);
      expect(ability, `${type} should include numeric mechanics`).toMatch(/\d/);
      expect(ability, `${type} should name at least one concrete effect`).toMatch(/SLOW|STUN|MARK|ARMOR SHRED|BLEED|POISON|knockback|splash|damage|range|attack speed/i);
    }
  });

  it('shows a visible current when Charybdis applies its slow', () => {
    const previousRenderer = (globalThis as any).__renderer;
    const triggerCharybdisCurrent = vi.fn();
    (globalThis as any).__renderer = { triggerCharybdisCurrent };
    try {
      const s = readyState();
      s.phase = GamePhase.WAVE_PHASE;
      s.wave = 12;
      s.tick = 42;
      const charybdis = createTower(TowerType.CHARYBDIS_VORTEX, 4, 2, 20, s.wave);
      (charybdis as any).placedOnWater = true;
      const target = combatTarget('current-target', charybdis, 1.5);

      applyDamageAndStatus(s, charybdis, target, 100, leaderboardDamageHooks());

      expect(target.statusEffects.some(effect => effect.kind === 'SLOW')).toBe(true);
      expect(triggerCharybdisCurrent).toHaveBeenCalledTimes(1);
      expect(triggerCharybdisCurrent).toHaveBeenCalledWith(target.x, target.y, s.tick, expect.any(Number));
    } finally {
      (globalThis as any).__renderer = previousRenderer;
    }
  });

  it('distributes the full support toolkit across accessible naval specialists', () => {
    const s = readyState();
    s.phase = GamePhase.WAVE_PHASE;
    s.tick = 10;
    const hooks = leaderboardDamageHooks();

    const nereid = createTower(TowerType.NEREID_ORACLE, 4, 2, 20, s.wave);
    nereid.placedOnWater = true;
    const exposed = combatTarget('fated-current', nereid);
    applyDamageAndStatus(s, nereid, exposed, 10, hooks);
    expect(exposed.statusEffects.some(effect => effect.kind === StatusEffectKind.MARK && effect.magnitude === 0.20)).toBe(true);
    expect(fatedCurrentDamageMult(exposed, 10)).toBeCloseTo(1.10, 6);

    const lighthouse = createTower(TowerType.ORACLE_LIGHTHOUSE, 5, 3, 20, s.wave);
    lighthouse.placedOnWater = true;
    applyDamageAndStatus(s, lighthouse, exposed, 10, hooks);
    expect(fatedCurrentDamageMult(exposed, 10)).toBeCloseTo(1.14, 6);
    expect(fatedCurrentDamageMult(exposed, 15.5)).toBe(1);

    const ramming = createTower(TowerType.RAMMING_QUINQUEREME, 4, 4, 20, s.wave);
    ramming.placedOnWater = true;
    (ramming as any).__hitCount = 3;
    const cracked = combatTarget('rammed-armor', ramming);
    applyDamageAndStatus(s, ramming, cracked, 10, hooks);
    expect(cracked.statusEffects.some(effect => effect.kind === StatusEffectKind.STUN)).toBe(true);
    expect(cracked.statusEffects.some(effect => effect.kind === StatusEffectKind.ARMOR_SHRED)).toBe(true);

    const charybdis = createTower(TowerType.CHARYBDIS_VORTEX, 4, 5, 20, s.wave);
    charybdis.placedOnWater = true;
    (charybdis as any).__hitCount = 4;
    const drowned = combatTarget('drowned-recovery', charybdis);
    applyDamageAndStatus(s, charybdis, drowned, 10, hooks);
    expect(drowned.statusEffects.some(effect => effect.kind === StatusEffectKind.SLOW)).toBe(true);
    expect((drowned as any).__healingBlockedUntil).toBeCloseTo(12.25, 6);

    const abyssal = createTower(TowerType.ABYSSAL_ONAGER, 5, 6, 20, s.wave);
    abyssal.placedOnWater = true;
    (abyssal as any).__hitCount = 3;
    const sealed = combatTarget('abyssal-heal-lock', abyssal);
    applyDamageAndStatus(s, abyssal, sealed, 10, hooks);
    expect(sealed.statusEffects.some(effect => effect.kind === StatusEffectKind.ARMOR_SHRED)).toBe(true);
    expect(sealed.statusEffects.some(effect => effect.kind === StatusEffectKind.STUN)).toBe(true);
    expect((sealed as any).__healingBlockedUntil).toBe(13);

    const hydra = createTower(TowerType.HYDRA_OF_LERNA, 4, 7, 20, s.wave);
    hydra.placedOnWater = true;
    (hydra as any).__hitCount = 4;
    const bleeding = combatTarget('hydra-bleed', hydra);
    applyDamageAndStatus(s, hydra, bleeding, 10, hooks);
    expect(bleeding.statusEffects.some(effect => effect.kind === StatusEffectKind.BLEED)).toBe(true);
  });

  it('keeps a low-uptime land healing-denial route through Plague Cart', () => {
    const s = readyState();
    s.phase = GamePhase.WAVE_PHASE;
    s.tick = 20;
    const cart = createTower(TowerType.PLAGUE_CART, 3, 10, 10, s.wave);
    (cart as any).__hitCount = 3;
    const target = combatTarget('plague-heal-lock', cart);

    applyDamageAndStatus(s, cart, target, 10, leaderboardDamageHooks());

    expect(target.statusEffects.some(effect => effect.kind === StatusEffectKind.POISON)).toBe(true);
    expect(target.statusEffects.some(effect => effect.kind === StatusEffectKind.SLOW)).toBe(true);
    expect((target as any).__healingBlockedUntil).toBe(22);
  });

  it('makes Necromancer Lantern regeneration denial match its item promise', () => {
    const s = readyState();
    s.phase = GamePhase.WAVE_PHASE;
    s.tick = 30;
    const bearer = createTower(TowerType.MILITES, 5, 10, 10, s.wave);
    bearer.equippedItems.push('NECROMANCERS_LANTERN');
    bearer.attackCooldown = 999;
    s.towers.set(bearer.id, bearer);
    const target = combatTarget('lantern-heal-lock', bearer, 2);
    s.enemies.set(target.id, target);

    tickCombat(s, 0.016, leaderboardDamageHooks());

    expect((target as any).__healingBlockedUntil).toBeGreaterThan(s.tick);
  });

  it('rewards Tideforged combos for taking scarce ocean tiles', () => {
    const landFleet = createTower(TowerType.PRAETORIAN_FLEET, 5, 10, 10, 20);
    const waterFleet = createTower(TowerType.PRAETORIAN_FLEET, 5, 4, 20, 20);
    waterFleet.placedOnWater = true;
    const land = towerEffectiveStats(landFleet);
    const water = towerEffectiveStats(waterFleet);

    // Ocean stance keeps the prior 1.12 Tideforged bonus and gains the
    // global 1.20 Harbor deployment buff: 1.12 * 1.20 = 1.344 damage.
    expect(water.dps).toBeCloseTo(land.dps * 1.344, 4);
    expect(water.range).toBeGreaterThanOrEqual(land.range + 0.65);
    expect(water.attackSpeed).toBeCloseTo(land.attackSpeed / 1.08, 4);
  });

  it('makes every water-only Harbor tower exactly 20% stronger at sea', () => {
    const navalTypes: Array<[TowerType, 1 | 2 | 3 | 4 | 5]> = [
      [TowerType.TRIREME_BALLISTA, 3],
      [TowerType.CORVUS_BOARDING_SHIP, 3],
      [TowerType.RAMMING_QUINQUEREME, 4],
      [TowerType.CHARYBDIS_VORTEX, 4],
      [TowerType.NEREID_ORACLE, 4],
      [TowerType.HYDRA_OF_LERNA, 4],
      [TowerType.NEPTUNES_LEVIATHAN, 5]
    ];
    for (const [type, tier] of navalTypes) {
      const dryReference = createTower(type, tier, 8, 8, 20);
      const oceanTower = createTower(type, tier, 4, 20, 20);
      oceanTower.placedOnWater = true;
      expect(towerEffectiveStats(oceanTower).dps, type)
        .toBeCloseTo(towerEffectiveStats(dryReference).dps * 1.20, 4);
    }
  });

  it('lets the Hydra line ramp into a real short-range naval payoff', () => {
    const charybdis = createTower(TowerType.CHARYBDIS_VORTEX, 4, 2, 20, 12);
    const hydra = createTower(TowerType.HYDRA_OF_LERNA, 4, 3, 20, 12);
    hydra.placedOnWater = true;
    const hydraBase = towerEffectiveStats(hydra);
    hydra.killCount = 28;
    const hydraRamped = towerEffectiveStats(hydra);

    const pit = createTower(TowerType.HYDRA_BEAST_PIT, 5, 4, 20, 12);
    pit.placedOnWater = true;
    const pitBase = towerEffectiveStats(pit);
    pit.killCount = 36;
    const pitRamped = towerEffectiveStats(pit);

    expect((towersData as any).HYDRA_OF_LERNA.range).toBe(4);
    expect((towersData as any).HYDRA_OF_LERNA.attackSpeed).toBe(1.65);
    expect(hydraBase.range).toBe(4);
    expect(hydraRamped.attackSpeed).toBeCloseTo(hydraBase.attackSpeed * 1.28, 4);
    expect(hydraBase.dps).toBeGreaterThan(towerEffectiveStats(charybdis).dps);
    expect(hydraRamped.dps).toBeGreaterThan(hydraBase.dps * 1.7);
    expect(hydraRamped.attackSpeed).toBeGreaterThan(hydraBase.attackSpeed * 1.25);
    expect(pitBase.dps).toBeGreaterThan(hydraBase.dps);
    expect((towersData as any).HYDRA_BEAST_PIT.range).toBe(2.75);
    expect((towersData as any).HYDRA_BEAST_PIT.attackSpeed).toBe(1.68);
    expect(pitRamped.dps).toBeGreaterThan(pitBase.dps * 1.9);
    expect(pitRamped.attackSpeed).toBeGreaterThan(pitBase.attackSpeed * 1.35);
  });

  it('routes every ranged Harbor and Tideforged tower through real projectile damage and leaderboard credit', () => {
    const rangedHarborTypes: Array<[TowerType, 1 | 2 | 3 | 4 | 5]> = [
      [TowerType.TRIREME_BALLISTA, 3],
      [TowerType.RAMMING_QUINQUEREME, 4],
      [TowerType.CHARYBDIS_VORTEX, 4],
      [TowerType.NEREID_ORACLE, 4],
      [TowerType.PRAETORIAN_FLEET, 5],
      [TowerType.ORACLE_LIGHTHOUSE, 5],
      [TowerType.ABYSSAL_ONAGER, 5],
      [TowerType.MARS_TIDAL_BASTION, 5]
    ];

    for (const [type, tier] of rangedHarborTypes) {
      const { tower, target, projectilesLeft } = runOneAttackThroughLeaderboard(type, tier, 2);
      expect(projectilesLeft, `${type} projectile should resolve`).toBe(0);
      expect(target.hp, `${type} should damage the target`).toBeLessThan(target.maxHp);
      expect(tower.damageThisWave, `${type} should credit wave leaderboard damage`).toBeGreaterThan(0);
      expect(tower.totalDamageDealt, `${type} should credit lifetime leaderboard damage`).toBeGreaterThan(0);
    }
  });

  it('routes every melee Harbor and Tideforged tower through direct damage and leaderboard credit', () => {
    const meleeHarborTypes: Array<[TowerType, 1 | 2 | 3 | 4 | 5]> = [
      [TowerType.CORVUS_BOARDING_SHIP, 3],
      [TowerType.HYDRA_OF_LERNA, 4],
      [TowerType.CORVUS_LEGION_DOCK, 5],
      [TowerType.HYDRA_BEAST_PIT, 5],
      [TowerType.NEPTUNES_LEVIATHAN, 5]
    ];

    for (const [type, tier] of meleeHarborTypes) {
      const { tower, target, projectilesLeft } = runOneAttackThroughLeaderboard(type, tier);
      expect(projectilesLeft, `${type} should not need a damage projectile`).toBe(0);
      expect(target.hp, `${type} should damage the target`).toBeLessThan(target.maxHp);
      expect(tower.damageThisWave, `${type} should credit wave leaderboard damage`).toBeGreaterThan(0);
      expect(tower.totalDamageDealt, `${type} should credit lifetime leaderboard damage`).toBeGreaterThan(0);
    }
  });

  it('keeps the mythic sea towers on divine damage while grounded naval hardware stays physical', () => {
    expect((towersData as any).CHARYBDIS_VORTEX.damageType).toBe('DIVINE');
    expect((towersData as any).NEREID_ORACLE.damageType).toBe('DIVINE');
    expect((towersData as any).RAMMING_QUINQUEREME.damageType).toBe('DIVINE');
    expect((towersData as any).HYDRA_OF_LERNA.damageType).toBe('DIVINE');
    expect((towersData as any).TRIREME_BALLISTA.damageType).toBe('SIEGE');
    expect((towersData as any).CORVUS_BOARDING_SHIP.damageType).toBe('PHYS_MELEE');
  });

  it('Tidecaller commanders protect and heal ocean-spawned allies until killed', () => {
    const s: any = readyState();
    s.wave = 27;
    const tidecaller: any = {
      id: 'tidecaller',
      type: EnemyType.TIDECALLER_COMMANDER,
      hp: 100,
      maxHp: 100,
      x: 10 * 32,
      y: 10 * 32,
      isBoss: false,
      isFlyer: false,
      isCommander: true
    };
    const fishling: any = {
      id: 'fishling',
      type: EnemyType.OCEAN_FISHLING,
      hp: 40,
      maxHp: 100,
      x: 11 * 32,
      y: 10 * 32,
      isBoss: false,
      isFlyer: false,
      __oceanSpawn: true
    };
    s.enemies.set(tidecaller.id, tidecaller);
    s.enemies.set(fishling.id, fishling);

    expect(isCommanderType(EnemyType.TIDECALLER_COMMANDER)).toBe(true);
    expect(commanderDamageTakenMult(s, fishling)).toBeLessThan(1);
    expect(commanderSpeedMult(s, fishling)).toBeGreaterThan(1);
    tickCommanderSupport(s, 0.1);
    expect(fishling.hp).toBeGreaterThan(40);
  });
});
