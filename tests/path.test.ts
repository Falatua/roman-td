// Tests for grid + pathfinding behavior.
import { describe, it, expect } from 'vitest';
import { createGameState } from '../src/GameState';
import {
  canBuildWaterTowerAt,
  initializeGrid,
  isBuildable,
  isWaterPlacementBufferTile,
  isWaterPlacementRestrictedTile,
  setTile,
  tileAt
} from '../src/systems/GridManager';
import { aStar, buildGroundPath, canPlaceStone } from '../src/systems/PathFinder';
import { TileType } from '../src/types';
import { WATER_ROW_SPANS, WATER_TILE_COUNT, WATER_ZONE } from '../src/constants';

describe('Grid initialization', () => {
  it('creates a grid with border tiles around the perimeter', () => {
    const s = createGameState();
    initializeGrid(s);
    expect(tileAt(s, 0, 0)).toBe(TileType.BORDER);
  });

  it('places a SPAWN tile and a GATE tile', () => {
    const s = createGameState();
    initializeGrid(s);
    let foundSpawn = false, foundGate = false;
    for (let r = 0; r < s.tiles.length; r++) {
      for (let c = 0; c < s.tiles[r].length; c++) {
        if (s.tiles[r][c] === TileType.SPAWN) foundSpawn = true;
        if (s.tiles[r][c] === TileType.GATE) foundGate = true;
      }
    }
    expect(foundSpawn).toBe(true);
    expect(foundGate).toBe(true);
  });

  it('isBuildable returns false on non-empty tiles and true on empty', () => {
    const s = createGameState();
    initializeGrid(s);
    expect(isBuildable(s, 0, 0)).toBe(false);    // border
    // 2026-05-22 V20 — (5,5) was inside the new 5×5 cave footprint
    // reserve (cave anchor (3,4), radius 2). Use (15, 15) instead —
    // a deep-interior tile that's well clear of both cave + gate.
    expect(isBuildable(s, 15, 15)).toBe(true);
  });

  it('isBuildable false inside the cave footprint (V20 reserve)', () => {
    const s = createGameState();
    initializeGrid(s);
    // Cave anchor (3, 4) — entire 5×5 footprint around it must reject placement
    for (let dc = -2; dc <= 2; dc++) {
      for (let dr = -2; dr <= 2; dr++) {
        const c = 3 + dc, r = 4 + dr;
        if (c < 1 || c >= 37 || r < 1 || r >= 25) continue;     // skip border
        expect(isBuildable(s, c, r), `cave footprint (${c},${r}) should not be buildable`).toBe(false);
      }
    }
  });

  it('isBuildable false inside the gate footprint (V20 reserve)', () => {
    const s = createGameState();
    initializeGrid(s);
    // Gate anchor (35, 23) — entire 5×5 footprint around it must reject placement
    for (let dc = -2; dc <= 2; dc++) {
      for (let dr = -2; dr <= 2; dr++) {
        const c = 35 + dc, r = 23 + dr;
        if (c < 1 || c >= 37 || r < 1 || r >= 25) continue;     // skip border
        expect(isBuildable(s, c, r), `gate footprint (${c},${r}) should not be buildable`).toBe(false);
      }
    }
  });

  it('keeps Cave B anchor protected but allows adjacent checkpoint-2-left grass', () => {
    const s = createGameState();
    initializeGrid(s);
    expect(isBuildable(s, 3, 13)).toBe(false); // Cave B spawn anchor.
    expect(tileAt(s, 3, 13)).toBe(TileType.SPAWN);
    expect(isBuildable(s, 4, 13)).toBe(true);
  });

  it('reserves the organic bottom-left water zone for future water towers only', () => {
    const s = createGameState();
    initializeGrid(s);
    let waterTiles = 0;
    for (let r = WATER_ZONE.row; r < WATER_ZONE.row + WATER_ZONE.height; r++) {
      for (let c = WATER_ZONE.col; c < WATER_ZONE.col + WATER_ZONE.width; c++) {
        const localR = r - WATER_ZONE.row;
        const localC = c - WATER_ZONE.col;
        const span = WATER_ROW_SPANS[localR];
        const isWater = localC >= span.start && localC <= span.end;
        if (isWater) {
          expect(tileAt(s, c, r), `water tile ${c},${r}`).toBe(TileType.WATER);
          expect(isBuildable(s, c, r), `normal build blocked on ${c},${r}`).toBe(false);
          expect(canBuildWaterTowerAt(s, c, r), `future water tower hook allows ${c},${r}`).toBe(true);
          waterTiles++;
        } else {
          expect(tileAt(s, c, r), `organic non-water tile ${c},${r}`).toBe(TileType.EMPTY);
          expect(isBuildable(s, c, r), `organic non-water grass buildable ${c},${r}`).toBe(true);
          expect(canBuildWaterTowerAt(s, c, r), `future water tower blocked on grass ${c},${r}`).toBe(false);
        }
      }
    }
    expect(waterTiles).toBe(WATER_TILE_COUNT);
    expect(canBuildWaterTowerAt(s, WATER_ZONE.col + WATER_ZONE.width, WATER_ZONE.row)).toBe(false);
  });

  it('keeps actual water restricted while nearby shoreline grass stays buildable', () => {
    const s = createGameState();
    initializeGrid(s);
    const bufferTiles = [
      { col: WATER_ZONE.col + 5, row: WATER_ZONE.row },
      { col: WATER_ZONE.col + 4, row: WATER_ZONE.row - 1 },
      { col: WATER_ZONE.col + 10, row: WATER_ZONE.row + 3 }
    ];
    for (const t of bufferTiles) {
      expect(tileAt(s, t.col, t.row), `shore grass ${t.col},${t.row} stays land`).toBe(TileType.EMPTY);
      expect(isWaterPlacementBufferTile(t.col, t.row), `visual trim helper ${t.col},${t.row}`).toBe(true);
      expect(isWaterPlacementRestrictedTile(t.col, t.row), `not restricted ${t.col},${t.row}`).toBe(false);
      expect(isBuildable(s, t.col, t.row), `buildable ${t.col},${t.row}`).toBe(true);
      expect(canPlaceStone(s, t.col, t.row), `stone allowed if path stays open ${t.col},${t.row}`).toBe(true);
    }
    expect(isWaterPlacementRestrictedTile(WATER_ZONE.col + 2, WATER_ZONE.row + 2)).toBe(true);
    expect(isBuildable(s, WATER_ZONE.col + 2, WATER_ZONE.row + 2)).toBe(false);
  });

  it('does not let generic tile writes erase water reserves', () => {
    const s = createGameState();
    initializeGrid(s);
    setTile(s, WATER_ZONE.col + 2, WATER_ZONE.row + 2, TileType.TOWER);
    expect(tileAt(s, WATER_ZONE.col + 2, WATER_ZONE.row + 2)).toBe(TileType.WATER);
  });
});

describe('Pathfinding — A* through checkpoints', () => {
  it('builds a non-empty ground path on a fresh grid', () => {
    const s = createGameState();
    initializeGrid(s);
    const path = buildGroundPath(s);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
    expect(path!.some(t => tileAt(s, t.col, t.row) === TileType.WATER)).toBe(false);
  });

  it('does not allow A* to use water as an occupied endpoint', () => {
    const s = createGameState();
    initializeGrid(s);
    const waterGoal = { col: WATER_ZONE.col + 3, row: WATER_ZONE.row + 3 };
    const path = aStar(s, { col: WATER_ZONE.col + WATER_ZONE.width + 1, row: WATER_ZONE.row + 3 }, waterGoal);
    expect(path).toBeNull();
  });

  it('canPlaceStone returns true for an interior empty tile that does not block path', () => {
    const s = createGameState();
    initializeGrid(s);
    expect(canPlaceStone(s, 10, 10)).toBe(true);
  });

  it('can place a blocker left of checkpoint 2 when both lanes still route around it', () => {
    const s = createGameState();
    initializeGrid(s);
    expect(isBuildable(s, 4, 13)).toBe(true);
    expect(canPlaceStone(s, 4, 13)).toBe(true);
  });

  it('canPlaceStone returns false on an already-occupied tile', () => {
    const s = createGameState();
    initializeGrid(s);
    setTile(s, 5, 5, TileType.STONE);
    expect(canPlaceStone(s, 5, 5)).toBe(false);
  });
});
