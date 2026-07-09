import { describe, expect, it } from 'vitest';
import { GamePhase, EnemyType, TileType, TowerType } from '../src/types';
import { createGameState } from '../src/GameState';
import { WATER_ZONE } from '../src/constants';
import { initializeGrid, setTowerTile, tileAt } from '../src/systems/GridManager';
import { buildGroundPath } from '../src/systems/PathFinder';
import { createTower, towerEffectiveStats } from '../src/systems/TowerSystem';
import { executeCombo, scanCombos } from '../src/systems/CombinationEngine';
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

describe('Harbor naval tower system', () => {
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

  it('rewards Tideforged combos for taking scarce ocean tiles', () => {
    const landFleet = createTower(TowerType.PRAETORIAN_FLEET, 5, 10, 10, 20);
    const waterFleet = createTower(TowerType.PRAETORIAN_FLEET, 5, 4, 20, 20);
    waterFleet.placedOnWater = true;
    const land = towerEffectiveStats(landFleet);
    const water = towerEffectiveStats(waterFleet);

    expect(water.dps).toBeGreaterThan(land.dps * 1.11);
    expect(water.range).toBeGreaterThanOrEqual(land.range + 0.65);
    expect(water.attackSpeed).toBeCloseTo(land.attackSpeed / 1.08, 4);
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

    expect(hydraBase.range).toBeGreaterThanOrEqual(2.6);
    expect(hydraBase.dps).toBeGreaterThan(towerEffectiveStats(charybdis).dps);
    expect(hydraRamped.dps).toBeGreaterThan(hydraBase.dps * 1.7);
    expect(hydraRamped.attackSpeed).toBeGreaterThan(hydraBase.attackSpeed * 1.25);
    expect(pitBase.dps).toBeGreaterThan(hydraBase.dps);
    expect(pitRamped.dps).toBeGreaterThan(pitBase.dps * 1.9);
    expect(pitRamped.attackSpeed).toBeGreaterThan(pitBase.attackSpeed * 1.35);
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
