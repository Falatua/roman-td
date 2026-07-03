// RampartSystem — 2026-07-02: purchasable 5-tile stone barrier lines.
//
// A rampart is a mazing aid sold at the shop (gate + Mercator): 20 gold buys
// a straight run of FIVE wall stones, placed horizontally or vertically in
// one click. The placed tiles are ordinary TileType.STONE — identical art,
// identical sell/refund behavior, identical pathing rules to the stones the
// player already gets from crystallized prospects. No damage, no stats;
// purely architecture. Hard-capped at 5 purchases per campaign so it eases
// early/mid mazing without trivializing the maze economy.
//
// Flow mirrors traps: buy at shop → inventory → arm (pick H or V) → click a
// tile to place. The clicked tile is the CENTER of the line. Placement is
// build-phase-only (gated by the caller in main.ts) and validated through
// the same buildGroundPath chokepoint canPlaceStone uses, so a rampart can
// never seal Rome.

import { GameStateShape } from '../GameState';
import { TileType } from '../types';
import { tileAt, setTile } from './GridManager';
import { buildGroundPath, resnapEnemiesToPath } from './PathFinder';

export const RAMPART_COST = 20;
export const RAMPART_MAX_PER_RUN = 5;
export const RAMPART_LENGTH = 5;

export type RampartOrientation = 'H' | 'V';

export function rampartsPurchased(state: GameStateShape): number {
  return state.rampartsPurchased ?? 0;
}

export function rampartsRemainingThisRun(state: GameStateShape): number {
  return Math.max(0, RAMPART_MAX_PER_RUN - rampartsPurchased(state));
}

export function rampartOwned(state: GameStateShape, orient: RampartOrientation): number {
  return state.rampartInventory?.[orient] ?? 0;
}

// Buy one rampart of the given orientation. Returns gold spent (0 = failed:
// out of gold or the per-run cap is exhausted).
export function buyRampart(state: GameStateShape, orient: RampartOrientation): number {
  if (rampartsRemainingThisRun(state) <= 0) return 0;
  if ((state.gold ?? 0) < RAMPART_COST) return 0;
  state.gold -= RAMPART_COST;
  state.rampartsPurchased = rampartsPurchased(state) + 1;
  if (!state.rampartInventory) state.rampartInventory = { H: 0, V: 0 };
  state.rampartInventory[orient] = (state.rampartInventory[orient] ?? 0) + 1;
  return RAMPART_COST;
}

// The 5 tile coordinates of a rampart centered on (col,row).
export function rampartTiles(col: number, row: number, orient: RampartOrientation): { col: number; row: number }[] {
  const half = Math.floor(RAMPART_LENGTH / 2);
  const out: { col: number; row: number }[] = [];
  for (let i = -half; i <= half; i++) {
    out.push(orient === 'H' ? { col: col + i, row } : { col, row: row + i });
  }
  return out;
}

// Validate: every tile of the line must be EMPTY, and simulating all five as
// STONE must leave the ground path intact (same chokepoint as canPlaceStone).
export function canPlaceRampart(state: GameStateShape, col: number, row: number, orient: RampartOrientation): boolean {
  const tiles = rampartTiles(col, row, orient);
  for (const t of tiles) {
    if (tileAt(state, t.col, t.row) !== TileType.EMPTY) return false;
  }
  for (const t of tiles) state.tiles[t.row][t.col] = TileType.STONE;
  const ok = buildGroundPath(state) !== null;
  for (const t of tiles) state.tiles[t.row][t.col] = TileType.EMPTY;
  return ok;
}

// Place an owned rampart centered at (col,row). Consumes one from inventory,
// commits the five STONE tiles, counts toward stonesPlaced (Maze Architect
// quest progress), and rebuilds + resnaps the ground path. Returns false
// without consuming anything if the spot is invalid or none are owned.
export function placeRampart(state: GameStateShape, col: number, row: number, orient: RampartOrientation): boolean {
  if (rampartOwned(state, orient) <= 0) return false;
  if (!canPlaceRampart(state, col, row, orient)) return false;
  for (const t of rampartTiles(col, row, orient)) setTile(state, t.col, t.row, TileType.STONE);
  state.rampartInventory![orient] -= 1;
  state.stonesPlaced = (state.stonesPlaced ?? 0) + RAMPART_LENGTH;
  const np = buildGroundPath(state);
  if (np) { state.groundPath = np; resnapEnemiesToPath(state, np); }
  return true;
}
