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

export function isBuildable(state: GameStateShape, col: number, row: number): boolean {
  return tileAt(state, col, row) === TileType.EMPTY;
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
