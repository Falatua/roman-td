import { describe, expect, it } from 'vitest';
import { createGameState } from '../src/GameState';
import { WATER_ZONE } from '../src/constants';
import { initializeGrid, isBuildable, setTile } from '../src/systems/GridManager';
import { canPlaceStone } from '../src/systems/PathFinder';
import { TileType } from '../src/types';
import {
  TRAP_DEFS,
  armTrapFromInventory,
  buyTraps,
  clearPlacedTrapsForWaveEnd,
  placeTrap,
  trapOwned,
  trapPrice,
} from '../src/systems/TrapSystem';
import {
  TRAP_PURCHASE_CAP_PER_TYPE,
  grantTrapInventory,
  recordTrapDamage,
  trapPurchasesRemaining,
  trapsPurchasedByType,
} from '../src/systems/TrapInventorySystem';

describe('Trap inventory flow', () => {
  it('buying traps stocks inventory without arming placement', () => {
    const s = createGameState();
    const id = 'IRON_SPIKE_TRAP';
    s.gold = trapPrice(s, id) * 3;

    const spent = buyTraps(s, id, 3);

    expect(spent).toBe(TRAP_DEFS[id].price * 3);
    expect(trapOwned(s, id)).toBe(3);
    expect(s.trapsPurchased).toBe(3);
    expect(s.selectedTrapType).toBeNull();
  });

  it('counts only successful purchases toward lifetime trap progress', () => {
    const s = createGameState();
    const id = 'SKY_NET';

    s.gold = 0;
    expect(buyTraps(s, id, 2)).toBe(0);
    expect(buyTraps(s, 'NOT_A_TRAP', 2)).toBe(0);
    expect(s.trapsPurchased).toBe(0);

    s.gold = trapPrice(s, id) * 2;
    expect(buyTraps(s, id, 2)).toBeGreaterThan(0);
    expect(s.trapsPurchased).toBe(2);
  });

  it('caps every trap type at five acquired stock per campaign', () => {
    const s = createGameState();
    const id = 'BALLISTA_SNARE';
    s.gold = trapPrice(s, id) * 10;

    expect(buyTraps(s, id, 7)).toBe(trapPrice(s, id) * TRAP_PURCHASE_CAP_PER_TYPE);
    expect(trapOwned(s, id)).toBe(TRAP_PURCHASE_CAP_PER_TYPE);
    expect(trapsPurchasedByType(s, id)).toBe(TRAP_PURCHASE_CAP_PER_TYPE);
    expect(trapPurchasesRemaining(s, id)).toBe(0);
    expect(buyTraps(s, id, 1)).toBe(0);
    expect(grantTrapInventory(s, id, 3)).toBe(0);
    expect(trapOwned(s, id)).toBe(TRAP_PURCHASE_CAP_PER_TYPE);
  });

  it('records damage traps for the in-wave leaderboard counters', () => {
    const s = createGameState();

    recordTrapDamage(s, 'IRON_SPIKE_TRAP', 250);
    recordTrapDamage(s, 'IRON_SPIKE_TRAP', 75);
    recordTrapDamage(s, 'SKY_NET', 500);
    recordTrapDamage(s, 'SKY_NET', -10);

    expect(s.trapDamageByType?.IRON_SPIKE_TRAP).toBe(325);
    expect(s.trapDamageThisWaveByType?.IRON_SPIKE_TRAP).toBe(325);
    expect(s.trapHitsThisWaveByType?.IRON_SPIKE_TRAP).toBe(2);
    expect(s.trapDamageByType?.SKY_NET).toBe(500);
    expect(s.trapHitsThisWaveByType?.SKY_NET).toBe(1);
  });

  it('only arms traps when the player selects an owned trap from inventory', () => {
    const s = createGameState();

    expect(armTrapFromInventory(s, 'VENOM_TRAP')).toBe(false);
    expect(s.selectedTrapType).toBeNull();

    s.gold = 999;
    buyTraps(s, 'VENOM_TRAP', 1);

    expect(armTrapFromInventory(s, 'VENOM_TRAP')).toBe(true);
    expect(s.selectedTrapType).toBe('VENOM_TRAP');
  });

  it('places armed traps one at a time and expires deployed traps at wave end', () => {
    const s = createGameState();
    const id = 'FROST_SNARE';
    s.gold = 999;
    buyTraps(s, id, 3);
    armTrapFromInventory(s, id);

    expect(placeTrap(s, id, 10, 10)).toBe(true);
    expect(placeTrap(s, id, 11, 10)).toBe(true);
    expect(trapOwned(s, id)).toBe(1);
    expect(s.trapsPurchased).toBe(3);
    expect(s.trapsPlaced).toBe(2);
    expect(s.placedTraps).toHaveLength(2);

    expect(clearPlacedTrapsForWaveEnd(s)).toBe(2);
    expect(s.placedTraps).toHaveLength(0);
    expect(trapOwned(s, id)).toBe(1);
    expect(s.trapsPurchased).toBe(3);
    expect(s.trapsPlaced).toBe(2);
    expect(s.selectedTrapType).toBe(id);
  });

  it('refuses traps on water but allows shoreline grass', () => {
    const s = createGameState();
    initializeGrid(s);
    const id = 'IRON_SPIKE_TRAP';
    s.gold = 999;
    buyTraps(s, id, 2);

    expect(placeTrap(s, id, WATER_ZONE.col + 2, WATER_ZONE.row + 2)).toBe(false);
    expect(placeTrap(s, id, WATER_ZONE.col + 5, WATER_ZONE.row)).toBe(true);
    expect(trapOwned(s, id)).toBe(1);
    expect(s.placedTraps ?? []).toHaveLength(1);
  });

  it('reserves placed trap tiles from future towers, stones, and duplicate traps', () => {
    const s = createGameState();
    initializeGrid(s);
    const id = 'IRON_SPIKE_TRAP';
    s.gold = 999;
    buyTraps(s, id, 2);

    expect(placeTrap(s, id, 10, 10)).toBe(true);
    expect(isBuildable(s, 10, 10)).toBe(false);
    expect(canPlaceStone(s, 10, 10)).toBe(false);
    expect(placeTrap(s, id, 10, 10)).toBe(false);
    expect(trapOwned(s, id)).toBe(1);
    expect(s.placedTraps ?? []).toHaveLength(1);

    setTile(s, 11, 10, TileType.STONE);
    expect(placeTrap(s, id, 11, 10)).toBe(false);
    expect(trapOwned(s, id)).toBe(1);
  });
});
