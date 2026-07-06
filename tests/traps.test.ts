import { describe, expect, it } from 'vitest';
import { createGameState } from '../src/GameState';
import { WATER_ZONE } from '../src/constants';
import { initializeGrid } from '../src/systems/GridManager';
import {
  TRAP_DEFS,
  armTrapFromInventory,
  buyTraps,
  clearPlacedTrapsForWaveEnd,
  placeTrap,
  trapOwned,
  trapPrice,
} from '../src/systems/TrapSystem';

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

    expect(placeTrap(s, id, 4, 4)).toBe(true);
    expect(placeTrap(s, id, 5, 4)).toBe(true);
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

  it('refuses traps on water and the one-tile shoreline buffer', () => {
    const s = createGameState();
    initializeGrid(s);
    const id = 'IRON_SPIKE_TRAP';
    s.gold = 999;
    buyTraps(s, id, 2);

    expect(placeTrap(s, id, WATER_ZONE.col + 2, WATER_ZONE.row + 2)).toBe(false);
    expect(placeTrap(s, id, WATER_ZONE.col + WATER_ZONE.width, WATER_ZONE.row + 2)).toBe(false);
    expect(trapOwned(s, id)).toBe(2);
    expect(s.placedTraps ?? []).toHaveLength(0);
  });
});
