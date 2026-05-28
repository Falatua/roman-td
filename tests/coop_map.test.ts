// Phase 1 — Legion map geometry invariants.
import { describe, it, expect } from 'vitest';
import {
  inBounds, isRome, quadrantOf, classifyTile, canBuildAt,
  nextInChain, activeChain, allQuadrants, romeRingClockwise,
} from '../src/coop/LegionMap';
import { LEGION_GRID, QUADRANTS, PLAYER_COUNT_CONFIG } from '../src/coop/LegionConfig';

describe('Legion grid bounds', () => {
  it('is a 40×40 square', () => {
    expect(LEGION_GRID.SIZE).toBe(40);
    expect(inBounds(0, 0)).toBe(true);
    expect(inBounds(39, 39)).toBe(true);
    expect(inBounds(40, 0)).toBe(false);
    expect(inBounds(-1, 0)).toBe(false);
  });
});

describe('Tile classification', () => {
  it('classifies the center as Rome', () => {
    expect(isRome(19, 19)).toBe(true);
    expect(classifyTile(19, 19, 4)).toBe('ROME');
  });

  it('classifies the cross arms as seam', () => {
    // col band (17-22) outside Rome rows → seam
    expect(classifyTile(19, 2, 4)).toBe('SEAM');
    expect(classifyTile(2, 19, 4)).toBe('SEAM');
  });

  it('classifies the four corners as their quadrants', () => {
    expect(quadrantOf(0, 0)).toBe('NW');
    expect(quadrantOf(39, 0)).toBe('NE');
    expect(quadrantOf(39, 39)).toBe('SE');
    expect(quadrantOf(0, 39)).toBe('SW');
  });

  it('cross-band tiles belong to no quadrant', () => {
    expect(quadrantOf(19, 19)).toBeNull(); // Rome
    expect(quadrantOf(19, 5)).toBeNull();  // seam arm
  });

  it('every quadrant is 17×17 buildable tiles in 4-player mode', () => {
    for (const id of allQuadrants()) {
      const b = QUADRANTS[id].bounds;
      let count = 0;
      for (let c = b.minCol; c <= b.maxCol; c++) {
        for (let r = b.minRow; r <= b.maxRow; r++) {
          if (classifyTile(c, r, 4) === 'QUADRANT') count++;
        }
      }
      expect(count).toBe(17 * 17);
    }
  });
});

describe('Player-count sealing (Section 2.4)', () => {
  it('seals SW in 3-player', () => {
    expect(PLAYER_COUNT_CONFIG[3].sealed).toContain('SW');
    // a tile in the SW corner reads SEALED at 3 players
    expect(classifyTile(2, 37, 3)).toBe('SEALED');
    // but is a normal quadrant at 4 players
    expect(classifyTile(2, 37, 4)).toBe('QUADRANT');
  });

  it('2-player uses the opposing diagonal NW/SE', () => {
    expect(PLAYER_COUNT_CONFIG[2].active.sort()).toEqual(['NW', 'SE']);
    expect(classifyTile(2, 2, 2)).toBe('QUADRANT');    // NW active
    expect(classifyTile(37, 37, 2)).toBe('QUADRANT');  // SE active
    expect(classifyTile(37, 2, 2)).toBe('SEALED');     // NE sealed
    expect(classifyTile(2, 37, 2)).toBe('SEALED');     // SW sealed
  });
});

describe('Quadrant sovereignty (Section 4.1)', () => {
  it('lets a player build only in their own active quadrant', () => {
    expect(canBuildAt(2, 2, 'NW', 4)).toBe(true);    // own quadrant
    expect(canBuildAt(37, 2, 'NW', 4)).toBe(false);  // NE — not yours
    expect(canBuildAt(19, 2, 'NW', 4)).toBe(false);  // seam — never
    expect(canBuildAt(19, 19, 'NW', 4)).toBe(false); // Rome — never
  });
});

describe('Circuit chain (Section 2.3)', () => {
  it('flows clockwise and the last hop heads to Rome (null)', () => {
    expect(nextInChain('NW', 4)).toBe('NE');
    expect(nextInChain('NE', 4)).toBe('SE');
    expect(nextInChain('SE', 4)).toBe('SW');
    expect(nextInChain('SW', 4)).toBeNull(); // SW → Rome
  });

  it('2-player chain is NW → SE → Rome', () => {
    expect(activeChain(2)).toEqual(['NW', 'SE']);
    expect(nextInChain('NW', 2)).toBe('SE');
    expect(nextInChain('SE', 2)).toBeNull();
  });

  it('rome ring is an 8-point clockwise loop', () => {
    const ring = romeRingClockwise();
    expect(ring.length).toBe(8);
    // first point is top-left of the ring
    expect(ring[0]).toEqual({ col: 16, row: 16 });
  });
});
