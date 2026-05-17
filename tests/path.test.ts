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
    // find an interior empty tile
    expect(isBuildable(s, 5, 5)).toBe(true);
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

  it('canPlaceStone returns false on an already-occupied tile', () => {
    const s = createGameState();
    initializeGrid(s);
    setTile(s, 5, 5, TileType.STONE);
    expect(canPlaceStone(s, 5, 5)).toBe(false);
  });
});
