// Tests for grid + pathfinding behavior.
import { describe, it, expect } from 'vitest';
import { createGameState } from '../src/GameState';
import { initializeGrid, isBuildable, setTile, tileAt } from '../src/systems/GridManager';
import { buildGroundPath, canPlaceStone } from '../src/systems/PathFinder';
import { TileType } from '../src/types';

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
});

describe('Pathfinding — A* through checkpoints', () => {
  it('builds a non-empty ground path on a fresh grid', () => {
    const s = createGameState();
    initializeGrid(s);
    const path = buildGroundPath(s);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
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
