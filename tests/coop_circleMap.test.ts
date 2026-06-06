import { describe, it, expect } from 'vitest';
import { generateCircleMap, quadrantOf } from '../src/coop/circle/CircleMap';

describe('CircleMap geometry (Green Circle spiral)', () => {
  const g = generateCircleMap(); // 24 / step 3 / margin 1

  it('produces a non-trivial spiral path', () => {
    expect(g.path.length).toBeGreaterThan(120);
  });

  it('spawns at the outer corner and ends near the center', () => {
    expect(g.spawn).toEqual({ col: g.margin, row: g.margin });
    const mid = g.size / 2;
    expect(Math.abs(g.center.col - mid)).toBeLessThanOrEqual(g.ringStep * 2 + 1);
    expect(Math.abs(g.center.row - mid)).toBeLessThanOrEqual(g.ringStep * 2 + 1);
  });

  it('is contiguous (every step is 4-adjacent)', () => {
    for (let i = 1; i < g.path.length; i++) {
      const a = g.path[i - 1], b = g.path[i];
      const d = Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
      expect(d).toBe(1);
    }
  });

  it('never revisits a tile', () => {
    const seen = new Set(g.path.map((p) => `${p.col},${p.row}`));
    expect(seen.size).toBe(g.path.length);
  });

  it('covers all four pair-quadrants', () => {
    const segs = new Set(g.path.map((_, i) => g.segmentOf(i)));
    expect(segs.size).toBe(4);
    expect(quadrantOf({ col: 1, row: 1 }, g.size)).toBe(0);                   // NW
    expect(quadrantOf({ col: g.size - 2, row: 1 }, g.size)).toBe(1);          // NE
    expect(quadrantOf({ col: g.size - 2, row: g.size - 2 }, g.size)).toBe(2); // SE
    expect(quadrantOf({ col: 1, row: g.size - 2 }, g.size)).toBe(3);          // SW
  });

  it('build tiles exist and never overlap the path', () => {
    expect(g.buildTiles.length).toBeGreaterThan(100);
    for (const t of g.buildTiles) expect(g.isPath(t.col, t.row)).toBe(false);
  });

  it('has four corner spawns, one per quadrant, all on the path', () => {
    expect(g.spawns.length).toBe(4);
    expect(new Set(g.spawns.map((s) => s.quadrant)).size).toBe(4);
    for (const s of g.spawns) {
      expect(s.pathIndex).toBeGreaterThanOrEqual(0);
      expect(g.isPath(s.col, s.row)).toBe(true);
    }
  });
});
