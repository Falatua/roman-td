import { GRID, COIN_FOOTPRINT_TILES, WATER_ZONE, WATER_BUILD_BUFFER_TILES, WATER_ROW_SPANS } from '../constants';
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
  // Bottom-left organic water reserve: a future-water-tower zone that
  // visually replaces the old grass/decor and blocks every normal placement.
  for (let r = WATER_ZONE.row; r < WATER_ZONE.row + WATER_ZONE.height; r++) {
    for (let c = WATER_ZONE.col; c < WATER_ZONE.col + WATER_ZONE.width; c++) {
      if (r <= 0 || r >= GRID.ROWS - 1 || c <= 0 || c >= GRID.COLS - 1) continue;
      if (isWaterZoneTile(c, r)) state.tiles[r][c] = TileType.WATER;
    }
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

export function isWaterZoneTile(col: number, row: number): boolean {
  const localC = col - WATER_ZONE.col;
  const localR = row - WATER_ZONE.row;
  if (localR < 0 || localR >= WATER_ROW_SPANS.length) return false;
  if (localC < 0 || localC >= WATER_ZONE.width) return false;
  const span = WATER_ROW_SPANS[localR];
  return localC >= span.start && localC <= span.end;
}

export function isWaterPlacementBufferTile(col: number, row: number): boolean {
  if (isWaterZoneTile(col, row)) return false;
  for (let dr = -WATER_BUILD_BUFFER_TILES; dr <= WATER_BUILD_BUFFER_TILES; dr++) {
    for (let dc = -WATER_BUILD_BUFFER_TILES; dc <= WATER_BUILD_BUFFER_TILES; dc++) {
      if (dc === 0 && dr === 0) continue;
      if (isWaterZoneTile(col + dc, row + dr)) return true;
    }
  }
  return false;
}

export function isWaterPlacementRestrictedTile(col: number, row: number): boolean {
  return isWaterZoneTile(col, row) || isWaterPlacementBufferTile(col, row);
}

export function canBuildWaterTowerAt(state: GameStateShape, col: number, row: number): boolean {
  return tileAt(state, col, row) === TileType.WATER && isWaterZoneTile(col, row);
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
  // Cave B's anchor tile is already marked SPAWN, but its surrounding grass
  // should remain buildable. The second cave is a path entry, not a large
  // decorative arch like the main cave/gate, and a 5x5 reserve on row 13
  // blocked useful maze cells left of checkpoint 2.
  const caveB = (waypointsData as any).caveB;
  if (caveB) {
    if (col === caveB.col && row === caveB.row) return true;
  }
  return false;
}

export function isBuildable(state: GameStateShape, col: number, row: number): boolean {
  if (tileAt(state, col, row) !== TileType.EMPTY) return false;
  if (isWaterPlacementBufferTile(col, row)) return false;
  if (isInsideStructureFootprint(col, row)) return false;
  return true;
}

export function setTile(state: GameStateShape, col: number, row: number, t: TileType) {
  // DEFENSE-IN-DEPTH: never let placement / combine / restoration code
  // overwrite a SPAWN, GATE, WAYPOINT, or WATER tile. Those tiles are
  // immutable map anchors. Caller code already gates on
  // `tile === EMPTY`, but if something slips through, this is the
  // backstop that prevents enemies from being stranded.
  const cur = state.tiles[row]?.[col];
  if (cur === TileType.SPAWN || cur === TileType.GATE || cur === TileType.WAYPOINT || cur === TileType.WATER) {
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
