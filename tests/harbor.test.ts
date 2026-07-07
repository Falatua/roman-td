import { describe, expect, it } from 'vitest';
import { GamePhase, EnemyType, TileType, TowerType } from '../src/types';
import { createGameState } from '../src/GameState';
import { WATER_ZONE } from '../src/constants';
import { initializeGrid, setTowerTile, tileAt } from '../src/systems/GridManager';
import { buildGroundPath } from '../src/systems/PathFinder';
import { createTower } from '../src/systems/TowerSystem';
import { executeCombo, scanCombos } from '../src/systems/CombinationEngine';
import {
  buildHarborDraftOffers,
  harborDraftTierForWave,
  harborTowerCanUseTile,
  isHarborTowerType,
  markHarborUnlocked,
  queueHarborDraftPurchase,
  shouldUnlockHarborFromKill
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
  it('unlocks only from Sea Giant-class kills and builds three draft offers', () => {
    const s = readyState();
    s.wave = 12;
    expect(shouldUnlockHarborFromKill(s, EnemyType.FERAL_DOG)).toBe(false);
    expect(shouldUnlockHarborFromKill(s, EnemyType.SEA_GIANT)).toBe(true);
    expect(markHarborUnlocked(s)).toBe(true);
    expect((s as any).harborUnlocked).toBe(true);
    expect(harborDraftTierForWave(12)).toBe(2);
    const offers = buildHarborDraftOffers(s, true);
    expect(offers).toHaveLength(3);
    for (const offer of offers) {
      expect(isHarborTowerType(offer.type)).toBe(true);
      expect(offer.tier).toBe(2);
      expect(offer.price).toBeGreaterThan(0);
    }
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
});
