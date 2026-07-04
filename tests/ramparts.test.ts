// Stone Rampart tests — purchasable, rotatable 5-tile barrier lines.
import { describe, it, expect } from 'vitest';
import {
  RAMPART_COST, RAMPART_MAX_PER_RUN, RAMPART_LENGTH, RAMPART_ORIENTATIONS,
  armRampartFromInventory, buyRampart, rampartsOwned, rampartsRemainingThisRun, nextRampartOrientation,
  rampartTiles, canPlaceRampart, placeRampart, RampartOrientation
} from '../src/systems/RampartSystem';
import { createGameState } from '../src/GameState';
import { initializeGrid, tileAt } from '../src/systems/GridManager';
import { buildGroundPath } from '../src/systems/PathFinder';
import { TileType } from '../src/types';

function bootstrapState() {
  const s = createGameState();
  initializeGrid(s);
  const p = buildGroundPath(s);
  if (p) s.groundPath = p;
  s.gold = 500;
  return s;
}

// A clear open spot away from waypoints/structures for placement tests.
function findOpenSpot(s: any, orient: RampartOrientation): { col: number; row: number } | null {
  for (let row = 3; row < 23; row++) {
    for (let col = 3; col < 35; col++) {
      if (canPlaceRampart(s, col, row, orient)) return { col, row };
    }
  }
  return null;
}

describe('Rampart purchasing', () => {
  it('costs 20 gold; orientation is chosen at placement, not purchase', () => {
    const s = bootstrapState();
    const spent = buyRampart(s);
    expect(spent).toBe(RAMPART_COST);
    expect(s.gold).toBe(500 - RAMPART_COST);
    expect(rampartsOwned(s)).toBe(1);
  });

  it('hard-caps at 5 purchases per run', () => {
    const s = bootstrapState();
    s.gold = 9999;
    for (let i = 0; i < 5; i++) expect(buyRampart(s)).toBe(RAMPART_COST);
    expect(rampartsRemainingThisRun(s)).toBe(0);
    expect(buyRampart(s)).toBe(0);   // 6th refused regardless of gold
    expect(s.rampartsPurchased).toBe(RAMPART_MAX_PER_RUN);
    expect(rampartsOwned(s)).toBe(5);
  });

  it('refuses purchase when gold is short', () => {
    const s = bootstrapState();
    s.gold = RAMPART_COST - 1;
    expect(buyRampart(s)).toBe(0);
    expect(rampartsOwned(s)).toBe(0);
    expect(s.gold).toBe(RAMPART_COST - 1);
  });

  it('reads legacy pre-rotation {H,V} inventory from old saves', () => {
    const s = bootstrapState();
    s.rampartInventory = { H: 1, V: 2 };
    expect(rampartsOwned(s)).toBe(3);
  });

  it('arms ramparts from inventory and clears armed traps', () => {
    const s = bootstrapState();
    s.selectedTrapType = 'IRON_SPIKE_TRAP';
    expect(armRampartFromInventory(s)).toBe(false);
    expect(s.selectedRampart).toBeNull();

    buyRampart(s);
    expect(armRampartFromInventory(s)).toBe(true);
    expect(s.selectedRampart).toBe('H');
    expect(s.selectedTrapType).toBeNull();
    expect(rampartsOwned(s)).toBe(1);
  });
});

describe('Rampart rotation + geometry', () => {
  it('cycles through all four grid orientations', () => {
    expect(RAMPART_ORIENTATIONS).toEqual(['H', 'V', 'D1', 'D2']);
    expect(nextRampartOrientation('H')).toBe('V');
    expect(nextRampartOrientation('V')).toBe('D1');
    expect(nextRampartOrientation('D1')).toBe('D2');
    expect(nextRampartOrientation('D2')).toBe('H');
  });

  it('spans exactly 5 tiles centered on the anchor for every orientation', () => {
    expect(RAMPART_LENGTH).toBe(5);
    expect(rampartTiles(10, 8, 'H')).toEqual([
      { col: 8, row: 8 }, { col: 9, row: 8 }, { col: 10, row: 8 },
      { col: 11, row: 8 }, { col: 12, row: 8 }
    ]);
    expect(rampartTiles(10, 8, 'V')).toEqual([
      { col: 10, row: 6 }, { col: 10, row: 7 }, { col: 10, row: 8 },
      { col: 10, row: 9 }, { col: 10, row: 10 }
    ]);
    expect(rampartTiles(10, 8, 'D1')).toEqual([
      { col: 8, row: 6 }, { col: 9, row: 7 }, { col: 10, row: 8 },
      { col: 11, row: 9 }, { col: 12, row: 10 }
    ]);
    expect(rampartTiles(10, 8, 'D2')).toEqual([
      { col: 8, row: 10 }, { col: 9, row: 9 }, { col: 10, row: 8 },
      { col: 11, row: 7 }, { col: 12, row: 6 }
    ]);
  });
});

describe('Rampart placement', () => {
  it('commits 5 STONE tiles, consumes inventory, counts stonesPlaced', () => {
    const s = bootstrapState();
    buyRampart(s);
    const spot = findOpenSpot(s, 'H');
    expect(spot).toBeTruthy();
    const before = s.stonesPlaced ?? 0;
    expect(placeRampart(s, spot!.col, spot!.row, 'H')).toBe(true);
    for (const t of rampartTiles(spot!.col, spot!.row, 'H')) {
      expect(tileAt(s, t.col, t.row)).toBe(TileType.STONE);
    }
    expect(rampartsOwned(s)).toBe(0);
    expect(s.stonesPlaced).toBe(before + RAMPART_LENGTH);
    expect(buildGroundPath(s)).not.toBeNull();
    // Renderer bookkeeping: the strip is recorded so RAMPART_STRIP draws
    // as one connected wall instead of 5 loose stone blocks.
    expect(s.placedRamparts).toEqual([{ col: spot!.col, row: spot!.row, orient: 'H' }]);
  });

  it('places DIAGONAL ramparts too (both ways) and keeps the road open', () => {
    const s = bootstrapState();
    s.gold = 9999;
    buyRampart(s);
    buyRampart(s);
    const d1 = findOpenSpot(s, 'D1');
    expect(d1).toBeTruthy();
    expect(placeRampart(s, d1!.col, d1!.row, 'D1')).toBe(true);
    for (const t of rampartTiles(d1!.col, d1!.row, 'D1')) {
      expect(tileAt(s, t.col, t.row)).toBe(TileType.STONE);
    }
    const d2 = findOpenSpot(s, 'D2');
    expect(d2).toBeTruthy();
    expect(placeRampart(s, d2!.col, d2!.row, 'D2')).toBe(true);
    expect(rampartsOwned(s)).toBe(0);
    expect(buildGroundPath(s)).not.toBeNull();
    expect(s.placedRamparts).toHaveLength(2);
    expect(s.placedRamparts?.map(r => r.orient)).toEqual(['D1', 'D2']);
  });

  it('refuses placement without inventory and does not mutate tiles', () => {
    const s = bootstrapState();
    const spot = findOpenSpot(s, 'H');
    expect(spot).toBeTruthy();
    expect(placeRampart(s, spot!.col, spot!.row, 'H')).toBe(false);
    expect(tileAt(s, spot!.col, spot!.row)).toBe(TileType.EMPTY);
  });

  it('refuses placement overlapping non-empty tiles without consuming', () => {
    const s = bootstrapState();
    s.gold = 9999;
    buyRampart(s);
    const spot = findOpenSpot(s, 'H')!;
    // Occupy one of the 5 tiles, then try the same anchor.
    s.tiles[spot.row][spot.col + 2] = TileType.STONE;
    expect(placeRampart(s, spot.col, spot.row, 'H')).toBe(false);
    expect(rampartsOwned(s)).toBe(1);   // not consumed
    s.tiles[spot.row][spot.col + 2] = TileType.EMPTY;
  });

  it('canPlaceRampart leaves the board unchanged after simulation', () => {
    const s = bootstrapState();
    const spot = findOpenSpot(s, 'D1')!;
    const snapshot = s.tiles.map(r => [...r]);
    canPlaceRampart(s, spot.col, spot.row, 'D1');
    expect(s.tiles).toEqual(snapshot);
  });
});
