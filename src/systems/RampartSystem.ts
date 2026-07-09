// RampartSystem — 2026-07-02: purchasable 5-tile stone barrier lines.
//
// A rampart is a mazing aid sold at the Gate Shop: 30 gold buys
// a straight run of FIVE wall stones placed in one click. The placed tiles
// are ordinary TileType.STONE — identical art, identical sell/refund
// behavior, identical pathing rules to the stones the player already gets
// from crystallized prospects. No damage, no stats; purely architecture.
// Hard-capped at 3 purchases per campaign so it eases early/mid mazing
// without trivializing the maze economy.
//
// 2026-07-03 v2 — ROTATABLE. Ramparts are now a single generic purchase;
// while placing, the player rotates the armed rampart through all four
// straight lines the tile grid supports: H (—), V (|), D1 (↘), D2 (↗).
// The R key or the floating ROTATE chip cycles orientations. Because enemy
// pathing is strictly 4-directional (PathFinder.aStar), a DIAGONAL line of
// stones is just as solid a wall as an orthogonal one — enemies cannot
// squeeze through the corner gap between two diagonally-adjacent stones.
//
// Flow mirrors traps: buy at shop → inventory → PLACE arms it → rotate →
// click a tile. The clicked tile is the CENTER of the line. Placement is
// build-phase-only (gated by the caller in main.ts) and validated through
// the same buildGroundPath chokepoint canPlaceStone uses, so a rampart can
// never seal Rome.

import { GameStateShape } from '../GameState';
import { TileType } from '../types';
import { GRID } from '../constants';
import { isInsideStructureFootprint, tileAt, setTile } from './GridManager';
import { buildGroundPath, resnapEnemiesToPath } from './PathFinder';

export const RAMPART_COST = 30;
export const RAMPART_MAX_PER_RUN = 3;
export const RAMPART_LENGTH = 5;

export type RampartOrientation = 'H' | 'V' | 'D1' | 'D2';

// Rotation cycle for the R key / ROTATE chip, plus display labels.
export const RAMPART_ORIENTATIONS: RampartOrientation[] = ['H', 'V', 'D1', 'D2'];
export const RAMPART_ORIENT_LABEL: Record<RampartOrientation, string> = {
  H: 'HORIZONTAL —', V: 'VERTICAL |', D1: 'DIAGONAL ↘', D2: 'DIAGONAL ↗'
};

export function nextRampartOrientation(o: RampartOrientation): RampartOrientation {
  const i = RAMPART_ORIENTATIONS.indexOf(o);
  return RAMPART_ORIENTATIONS[(i + 1) % RAMPART_ORIENTATIONS.length];
}

// Per-orientation unit step from the center tile.
function orientStep(orient: RampartOrientation): { dc: number; dr: number } {
  switch (orient) {
    case 'H':  return { dc: 1, dr: 0 };
    case 'V':  return { dc: 0, dr: 1 };
    case 'D1': return { dc: 1, dr: 1 };   // ↘
    case 'D2': return { dc: 1, dr: -1 };  // ↗
  }
}

export function rampartsPurchased(state: GameStateShape): number {
  return state.rampartsPurchased ?? 0;
}

export function rampartsRemainingThisRun(state: GameStateShape): number {
  return Math.max(0, RAMPART_MAX_PER_RUN - rampartsPurchased(state));
}

// Unplaced ramparts in inventory. Reads the legacy per-orientation
// {H,V} inventory too so a save from the pre-rotation version keeps
// its purchases.
export function rampartsOwned(state: GameStateShape): number {
  const legacy = (state.rampartInventory?.H ?? 0) + (state.rampartInventory?.V ?? 0);
  return (state.rampartsOwned ?? 0) + legacy;
}

// Arm a rampart from inventory so the next empty map click places one
// rampart line. Buying ramparts deliberately does not auto-arm them.
export function armRampartFromInventory(state: GameStateShape, orient: RampartOrientation = 'H'): boolean {
  if (rampartsOwned(state) <= 0) return false;
  state.selectedRampart = orient;
  // Only one deployable can own empty-tile clicks at a time.
  state.selectedTrapType = null;
  return true;
}

function consumeRampart(state: GameStateShape): void {
  // Drain legacy inventory first, then the generic count.
  if ((state.rampartInventory?.H ?? 0) > 0) { state.rampartInventory!.H -= 1; return; }
  if ((state.rampartInventory?.V ?? 0) > 0) { state.rampartInventory!.V -= 1; return; }
  state.rampartsOwned = Math.max(0, (state.rampartsOwned ?? 0) - 1);
}

// Buy one rampart (orientation is chosen at placement time, not purchase).
// Returns gold spent (0 = failed: out of gold or the per-run cap is done).
export function buyRampart(state: GameStateShape): number {
  if (rampartsRemainingThisRun(state) <= 0) return 0;
  if ((state.gold ?? 0) < RAMPART_COST) return 0;
  state.gold -= RAMPART_COST;
  state.rampartsPurchased = rampartsPurchased(state) + 1;
  state.rampartsOwned = (state.rampartsOwned ?? 0) + 1;
  return RAMPART_COST;
}

// The 5 tile coordinates of a rampart centered on (col,row).
export function rampartTiles(col: number, row: number, orient: RampartOrientation): { col: number; row: number }[] {
  const half = Math.floor(RAMPART_LENGTH / 2);
  const { dc, dr } = orientStep(orient);
  const out: { col: number; row: number }[] = [];
  for (let i = -half; i <= half; i++) {
    out.push({ col: col + i * dc, row: row + i * dr });
  }
  return out;
}

export function isRampartTileInBounds(col: number, row: number): boolean {
  return col >= 0 && col < GRID.COLS && row >= 0 && row < GRID.ROWS;
}

export function isRampartTilePlaceable(state: GameStateShape, col: number, row: number): boolean {
  if (!isRampartTileInBounds(col, row)) return false;
  if (isInsideStructureFootprint(col, row)) return false;
  if (tileAt(state, col, row) !== TileType.EMPTY) return false;
  for (const tower of state.towers.values()) {
    if (tower.tileX === col && tower.tileY === row) return false;
  }
  for (const trap of state.placedTraps ?? []) {
    if (trap.col === col && trap.row === row) return false;
  }
  return true;
}

export function rampartPreviewTiles(state: GameStateShape, col: number, row: number, orient: RampartOrientation): Array<{ col: number; row: number; valid: boolean }> {
  return rampartTiles(col, row, orient).map(t => ({
    ...t,
    valid: isRampartTilePlaceable(state, t.col, t.row)
  }));
}

// Validate: all five tiles must physically fit on the map and be placeable.
// The visible road is the computed route through EMPTY tiles, so ramparts may
// sit on roads/trails as long as they do not cover checkpoints or other
// reserved/occupied tiles. Simulating all five as STONE must still leave the
// ground path intact.
export function canPlaceRampart(state: GameStateShape, col: number, row: number, orient: RampartOrientation): boolean {
  const tiles = rampartTiles(col, row, orient);
  for (const t of tiles) {
    if (!isRampartTilePlaceable(state, t.col, t.row)) return false;
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
  if (rampartsOwned(state) <= 0) return false;
  if (!canPlaceRampart(state, col, row, orient)) return false;
  for (const t of rampartTiles(col, row, orient)) setTile(state, t.col, t.row, TileType.STONE);
  consumeRampart(state);
  if (rampartsOwned(state) <= 0) state.selectedRampart = null;
  state.stonesPlaced = (state.stonesPlaced ?? 0) + RAMPART_LENGTH;
  // Remember the strip so the renderer can draw the connected rampart
  // sprite over these 5 tiles (instead of 5 loose stone blocks).
  if (!state.placedRamparts) state.placedRamparts = [];
  state.placedRamparts.push({ col, row, orient });
  const np = buildGroundPath(state);
  if (np) { state.groundPath = np; resnapEnemiesToPath(state, np); }
  return true;
}
