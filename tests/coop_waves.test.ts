// Phase 4 — Legion wave composition (aggregate-pool model, Section 5.3).
import { describe, it, expect } from 'vitest';
import {
  buildLegionWave, cornerUnitTotal, teamUnitTotal, interleaveCornerSpawns,
  type BaseSpawn,
} from '../src/coop/LegionWaves';

const W7: BaseSpawn[] = [
  { type: 'CARTHAGE_SPEARMAN', count: 48 },
  { type: 'NUMIDIAN_RIDER', count: 12 },
];

describe('Legion wave composition', () => {
  it('preserves enemy-type composition per corner', () => {
    const corners = buildLegionWave(W7, 4, 4);
    expect(corners.length).toBe(4);
    for (const c of corners) {
      const types = c.map((g) => g.type).sort();
      expect(types).toEqual(['CARTHAGE_SPEARMAN', 'NUMIDIAN_RIDER']);
    }
  });

  it('scales the AGGREGATE pool, not each lane (4P × 1.2)', () => {
    const corners = buildLegionWave(W7, 4, 4);
    // 48 spearmen × 1.2 = 57.6 → 58 total across 4 corners
    const spearTotal = corners.reduce((s, c) => s + (c.find((g) => g.type === 'CARTHAGE_SPEARMAN')?.count ?? 0), 0);
    expect(spearTotal).toBe(58);
    // 12 riders × 1.2 = 14.4 → 14 total
    const riderTotal = corners.reduce((s, c) => s + (c.find((g) => g.type === 'NUMIDIAN_RIDER')?.count ?? 0), 0);
    expect(riderTotal).toBe(14);
  });

  it('each corner sees roughly solo density (team total / players)', () => {
    const corners = buildLegionWave(W7, 4, 4);
    const team = teamUnitTotal(corners);     // 58 + 14 = 72
    expect(team).toBe(72);
    // each corner ~18 (72/4)
    for (const c of corners) {
      expect(cornerUnitTotal(c)).toBeGreaterThanOrEqual(17);
      expect(cornerUnitTotal(c)).toBeLessThanOrEqual(19);
    }
  });

  it('2-player keeps base count (×1.0) split across 2 corners', () => {
    const corners = buildLegionWave(W7, 2, 2);
    expect(teamUnitTotal(corners)).toBe(60); // 48 + 12, no count bump at 2P
    expect(cornerUnitTotal(corners[0])).toBe(30);
    expect(cornerUnitTotal(corners[1])).toBe(30);
  });

  it('interleaves a corner spawn list across types', () => {
    const corner = [{ type: 'A', count: 3 }, { type: 'B', count: 2 }];
    const seq = interleaveCornerSpawns(corner);
    expect(seq.length).toBe(5);
    // round-robin: A B A B A
    expect(seq).toEqual(['A', 'B', 'A', 'B', 'A']);
  });
});
