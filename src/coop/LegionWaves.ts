// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION MODE — Phase 4: Wave composition (Section 5.3)
//
// Builds the per-quadrant spawn manifest for a Legion wave. The critical
// spec nuance: the wave-count multiplier scales the TEAM AGGREGATE pool,
// not each lane. So we scale each enemy type's total count by the count
// multiplier, then distribute that pool across the active corners — each
// player sees ~solo density while the team faces a larger aggregate threat.
//
// Pure logic: base wave data (enemy type + count) is passed in. HP/speed
// scaling is applied at spawn time by the runtime via LegionScaling.
// ─────────────────────────────────────────────────────────────────────

import { totalWaveCount, distributeAcrossCorners } from './LegionScaling';

export interface BaseSpawn { type: string; count: number; }

// One corner's spawn list for a wave: ordered enemy groups to emit at the
// primary spawn corner.
export type CornerSpawns = BaseSpawn[];

/**
 * Build per-corner spawn lists for a Legion wave.
 *
 * @param baseSpawns  the base (solo) wave's spawn groups
 * @param playerCount 2-4
 * @param activeCount number of active corners (== playerCount, but explicit
 *                    so callers can't desync the two)
 * @returns array of length `activeCount`; each entry is that corner's
 *          spawn list. Enemy-type composition is preserved per corner.
 */
export function buildLegionWave(
  baseSpawns: BaseSpawn[],
  playerCount: number,
  activeCount: number,
): CornerSpawns[] {
  const corners: CornerSpawns[] = Array.from({ length: activeCount }, () => []);
  for (const grp of baseSpawns) {
    // Scale this enemy type's TOTAL count by the aggregate count multiplier.
    const totalForType = totalWaveCount(grp.count, playerCount);
    // Split that total across the active corners (balanced remainder).
    const perCorner = distributeAcrossCorners(totalForType, activeCount);
    for (let i = 0; i < activeCount; i++) {
      if (perCorner[i] > 0) corners[i].push({ type: grp.type, count: perCorner[i] });
    }
  }
  return corners;
}

/** Total enemy count a single corner receives for a wave. */
export function cornerUnitTotal(corner: CornerSpawns): number {
  return corner.reduce((sum, g) => sum + g.count, 0);
}

/** Total enemy count across the whole team for a wave (sanity / HUD). */
export function teamUnitTotal(corners: CornerSpawns[]): number {
  return corners.reduce((sum, c) => sum + cornerUnitTotal(c), 0);
}

/**
 * Flatten a corner's grouped spawns into an ordered, interleaved spawn
 * sequence so a wave doesn't dump one type then another (which would make
 * the lane trivially sortable). Round-robins across types for a mixed feel,
 * matching how the base game staggers spawns.
 */
export function interleaveCornerSpawns(corner: CornerSpawns): string[] {
  const queues = corner.map((g) => ({ type: g.type, left: g.count }));
  const out: string[] = [];
  let remaining = queues.reduce((s, q) => s + q.left, 0);
  while (remaining > 0) {
    for (const q of queues) {
      if (q.left > 0) { out.push(q.type); q.left--; remaining--; }
    }
  }
  return out;
}
