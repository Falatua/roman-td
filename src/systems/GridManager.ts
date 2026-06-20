import { GRID, COIN_FOOTPRINT_TILES } from '../constants';
import { TileType } from '../types';
import { GameStateShape } from '../GameState';
import waypointsData from '../data/waypoints.json';

export function initializeGrid(state: GameStateShape) {
  // Border ring
  for (let c = 0; c < GRID.COLS; c++) {
    state.tiles[0][c] = TileType.BORDER;
    state.tiles[GRID.ROWS - 1][c] = TileType.BORDER;
  }
  for (let r = 0; r < GRID.ROWS; r++) {
    state.tiles[r][0] = TileType.BORDER;
    state.tiles[r][GRID.COLS - 1] = TileType.BORDER;
  }
  // Spawn marker from map data. Cave art can be larger, but only this tile is reserved.
  state.tiles[waypointsData.spawn.row][waypointsData.spawn.col] = TileType.SPAWN;
  // Gate marker from map data. Gate art can be larger, but only this tile is reserved.
  state.tiles[waypointsData.gate.row][waypointsData.gate.col] = TileType.GATE;
  // 2026 v2 spec Ch7 — Cave B second spawn (only when waypoints.json defines it).
  const caveB = (waypointsData as any).caveB;
  if (caveB) state.tiles[caveB.row][caveB.col] = TileType.SPAWN;
  // Checkpoints: one reserved tile each, Gem TD style.
  for (const wp of waypointsData.waypoints) {
    for (let dr = 0; dr < COIN_FOOTPRINT_TILES; dr++) {
      for (let dc = 0; dc < COIN_FOOTPRINT_TILES; dc++) {
        const r = wp.topLeft.row + dr;
        const c = wp.topLeft.col + dc;
        if (r >= 0 && r < GRID.ROWS && c >= 0 && c < GRID.COLS) {
          state.tiles[r][c] = TileType.WAYPOINT;
        }
      }
    }
  }
}

export function tileAt(state: GameStateShape, col: number, row: number): TileType {
  if (col < 0 || col >= GRID.COLS || row < 0 || row >= GRID.ROWS) return TileType.BORDER;
  return state.tiles[row][col] as TileType;
}

// 2026-05-22 V20 — Cave + gate are rendered at 128×128 with their
// procedural stone frame (RenderEngine.ts:2235-2330) which spans a
// FULL 5×5 tile footprint centered on the spawn / gate anchors. The
// raw tile state at the anchor is SPAWN / GATE (already non-EMPTY),
// but the surrounding 24 tiles around each anchor are currently
// EMPTY and would happily accept tower placement — visually creating
// the bad outcome of a tower sitting under the cave entrance art.
//
// Reserve a 2-tile radius (5×5 square) around each anchor. This is
// strictly a BUILD restriction, not a path restriction — enemies +
// path-finding don't read isBuildable, so cave-to-WP1 routing is
// unaffected.
const CAVE_GATE_RESERVE_RADIUS = 2;
export function isInsideStructureFootprint(col: number, row: number): boolean {
  const dSpawnC = Math.abs(col - waypointsData.spawn.col);
  const dSpawnR = Math.abs(row - waypointsData.spawn.row);
  if (dSpawnC <= CAVE_GATE_RESERVE_RADIUS && dSpawnR <= CAVE_GATE_RESERVE_RADIUS) return true;
  const dGateC = Math.abs(col - waypointsData.gate.col);
  const dGateR = Math.abs(row - waypointsData.gate.row);
  if (dGateC <= CAVE_GATE_RESERVE_RADIUS && dGateR <= CAVE_GATE_RESERVE_RADIUS) return true;
  // 2026 v2 spec Ch7 — Cave B archway gets the same reserve (only when defined).
  const caveB = (waypointsData as any).caveB;
  if (caveB) {
    const dBC = Math.abs(col - caveB.col);
    const dBR = Math.abs(row - caveB.row);
    if (dBC <= CAVE_GATE_RESERVE_RADIUS && dBR <= CAVE_GATE_RESERVE_RADIUS) return true;
  }
  return false;
}

export function isBuildable(state: GameStateShape, col: number, row: number): boolean {
  if (tileAt(state, col, row) !== TileType.EMPTY) return false;
  if (isInsideStructureFootprint(col, row)) return false;
  return true;
}

export function setTile(state: GameStateShape, col: number, row: number, t: TileType) {
  // DEFENSE-IN-DEPTH: never let placement / combine / restoration code
  // overwrite a SPAWN, GATE, or WAYPOINT tile. Those tiles are the
  // immutable anchors of the path. Caller code already gates on
  // `tile === EMPTY`, but if something slips through, this is the
  // backstop that prevents enemies from being stranded.
  const cur = state.tiles[row]?.[col];
  if (cur === TileType.SPAWN || cur === TileType.GATE || cur === TileType.WAYPOINT) {
    return;     // silently refuse — preserves the anchor tile.
  }
  state.tiles[row][col] = t;
}

export function tileToPixel(col: number, row: number): { x: number; y: number } {
  return { x: col * GRID.TILE + GRID.TILE / 2, y: row * GRID.TILE + GRID.TILE / 2 };
}

export function pixelToTile(x: number, y: number): { col: number; row: number } {
  return { col: Math.floor(x / GRID.TILE), row: Math.floor(y / GRID.TILE) };
}
