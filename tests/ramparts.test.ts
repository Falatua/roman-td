// Stone Rampart tests — purchasable 5-tile barrier lines (2026-07-02).
import { describe, it, expect } from 'vitest';
import {
  RAMPART_COST, RAMPART_MAX_PER_RUN, RAMPART_LENGTH,
  buyRampart, rampartOwned, rampartsRemainingThisRun,
  rampartTiles, canPlaceRampart, placeRampart
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
function findOpenSpot(s: any, orient: 'H' | 'V'): { col: number; row: number } | null {
  for (let row = 3; row < 23; row++) {
    for (let col = 3; col < 35; col++) {
      if (canPlaceRampart(s, col, row, orient)) return { col, row };
    }
  }
  return null;
}

describe('Rampart purchasing', () => {
  it('costs 20 gold and adds to the orientation inventory', () => {
    const s = bootstrapState();
    const spent = buyRampart(s, 'H');
    expect(spent).toBe(RAMPART_COST);
    expect(s.gold).toBe(500 - RAMPART_COST);
    expect(rampartOwned(s, 'H')).toBe(1);
    expect(rampartOwned(s, 'V')).toBe(0);
  });

  it('hard-caps at 5 purchases per run across BOTH orientations', () => {
    const s = bootstrapState();
    s.gold = 9999;
    expect(buyRampart(s, 'H')).toBe(RAMPART_COST);
    expect(buyRampart(s, 'H')).toBe(RAMPART_COST);
    expect(buyRampart(s, 'V')).toBe(RAMPART_COST);
    expect(buyRampart(s, 'V')).toBe(RAMPART_COST);
    expect(buyRampart(s, 'H')).toBe(RAMPART_COST);
    expect(rampartsRemainingThisRun(s)).toBe(0);
    // 6th purchase refused regardless of orientation or gold.
    expect(buyRampart(s, 'H')).toBe(0);
    expect(buyRampart(s, 'V')).toBe(0);
    expect(s.rampartsPurchased).toBe(RAMPART_MAX_PER_RUN);
    expect(rampartOwned(s, 'H')).toBe(3);
    expect(rampartOwned(s, 'V')).toBe(2);
  });

  it('refuses purchase when gold is short', () => {
    const s = bootstrapState();
    s.gold = RAMPART_COST - 1;
    expect(buyRampart(s, 'H')).toBe(0);
    expect(rampartOwned(s, 'H')).toBe(0);
    expect(s.gold).toBe(RAMPART_COST - 1);
  });
});

describe('Rampart geometry', () => {
  it('spans exactly 5 tiles centered on the anchor', () => {
    expect(RAMPART_LENGTH).toBe(5);
    expect(rampartTiles(10, 8, 'H')).toEqual([
      { col: 8, row: 8 }, { col: 9, row: 8 }, { col: 10, row: 8 },
      { col: 11, row: 8 }, { col: 12, row: 8 }
    ]);
    expect(rampartTiles(10, 8, 'V')).toEqual([
      { col: 10, row: 6 }, { col: 10, row: 7 }, { col: 10, row: 8 },
      { col: 10, row: 9 }, { col: 10, row: 10 }
    ]);
  });
});

describe('Rampart placement', () => {
  it('commits 5 STONE tiles, consumes inventory, counts stonesPlaced', () => {
    const s = bootstrapState();
    buyRampart(s, 'H');
    const spot = findOpenSpot(s, 'H');
    expect(spot).toBeTruthy();
    const before = s.stonesPlaced ?? 0;
    expect(placeRampart(s, spot!.col, spot!.row, 'H')).toBe(true);
    for (const t of rampartTiles(spot!.col, spot!.row, 'H')) {
      expect(tileAt(s, t.col, t.row)).toBe(TileType.STONE);
    }
    expect(rampartOwned(s, 'H')).toBe(0);
    expect(s.stonesPlaced).toBe(before + RAMPART_LENGTH);
    // Path survived the placement.
    expect(buildGroundPath(s)).not.toBeNull();
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
    buyRampart(s, 'H');
    const spot = findOpenSpot(s, 'H')!;
    // Occupy one of the 5 tiles, then try the same anchor.
    s.tiles[spot.row][spot.col + 2] = TileType.STONE;
    expect(placeRampart(s, spot.col, spot.row, 'H')).toBe(false);
    expect(rampartOwned(s, 'H')).toBe(1);   // not consumed
    s.tiles[spot.row][spot.col + 2] = TileType.EMPTY;
  });

  it('canPlaceRampart leaves the board unchanged after simulation', () => {
    const s = bootstrapState();
    const spot = findOpenSpot(s, 'V')!;
    const snapshot = s.tiles.map(r => [...r]);
    canPlaceRampart(s, spot.col, spot.row, 'V');
    expect(s.tiles).toEqual(snapshot);
  });
});
