// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION MODE — Phase 5: Leak detection + circuit routing
//
// The leak/circuit RULES (Sections 3.3, 4.3, 5.2, 10.2). Leak DETECTION
// (a unit crossing the inner boundary) is a runtime/render concern wired in
// Phase 9; this module owns the deterministic routing logic that decides:
//   - whether a leaked unit goes to the next quadrant or strikes Rome
//   - where it re-enters (secondary entry, Section 4.3)
//   - HP retention (100%, Section 5.2) and ghost-lane reduction (50%, 10.2)
//   - serializing a leak into the tiny network manifest (Section 9.3)
// All pure functions — fully unit-testable.
// ─────────────────────────────────────────────────────────────────────

import { QUADRANTS, GHOST_LANE_LEAK_HP_MULT, type QuadrantId } from './LegionConfig';
import { nextInChain, quadrantGeometry } from './LegionMap';
import type { LeakUnit, LeakManifest } from './LegionTypes';

// A minimal shape any enemy-like object can satisfy for serialization. The
// runtime passes its live enemy; tests pass plain objects.
export interface LeakableEnemy {
  type: string;
  hp: number;
  maxHp: number;
  faction: string;
  isBoss?: boolean;
  isImmune?: boolean;
}

/**
 * Where a leak from `fromQuadrant` travels next. Returns the next active
 * quadrant id, or 'ROME' if this is the last quadrant in the chain (its
 * leaks strike Rome directly, Section 2.3 / 3.4).
 */
export function routeLeakNext(fromQuadrant: QuadrantId, playerCount: number): QuadrantId | 'ROME' {
  return nextInChain(fromQuadrant, playerCount) ?? 'ROME';
}

/** The pixel/tile secondary-entry where a leak appears in the next quadrant. */
export function secondaryEntryFor(quadrant: QuadrantId): { col: number; row: number } {
  return quadrantGeometry(quadrant).secondaryEntry;
}

/**
 * Serialize a live enemy into a LeakUnit for circuit transit. HP is captured
 * at 100% of current (no restoration, Section 5.2). `underReqCheckpoints`
 * flags a maze that let the unit out before the required checkpoint count
 * (red-trail warning, Section 4.2).
 */
export function serializeLeak(
  e: LeakableEnemy, fromQuadrant: QuadrantId, underReqCheckpoints: boolean,
): LeakUnit {
  return {
    enemyType: e.type,
    hp: Math.max(0, e.hp),
    maxHp: e.maxHp,
    faction: e.faction,
    isBoss: !!e.isBoss,
    isImmune: !!e.isImmune,
    fromQuadrant,
    underReqCheckpoints,
  };
}

/** Bundle a quadrant's leaks for a wave into a network manifest (Section 9.3). */
export function buildLeakManifest(wave: number, fromQuadrant: QuadrantId, units: LeakUnit[]): LeakManifest {
  return { wave, fromQuadrant, units };
}

/**
 * Apply the ghost-lane HP reduction to a leak (Section 10.2). When the
 * source quadrant is a disconnected player's ghost lane, its leaks enter
 * the circuit at 50% of their current HP to simulate partial defense.
 */
export function ghostLaneReduce(unit: LeakUnit): LeakUnit {
  return { ...unit, hp: Math.max(0, Math.round(unit.hp * GHOST_LANE_LEAK_HP_MULT)) };
}

/**
 * Resolve a full leak hop: given a serialized leak and the routing context,
 * return where it goes and (if to a quadrant) the entry point. The runtime
 * uses this to either spawn the unit at the next player's secondary entry
 * or queue a Rome damage event.
 */
export interface LeakRouting {
  destination: QuadrantId | 'ROME';
  entry: { col: number; row: number } | null; // null when destination is Rome
}
export function resolveLeakHop(unit: LeakUnit, playerCount: number): LeakRouting {
  const dest = routeLeakNext(unit.fromQuadrant, playerCount);
  if (dest === 'ROME') return { destination: 'ROME', entry: null };
  return { destination: dest, entry: secondaryEntryFor(dest) };
}

/** Quadrant trail color (for circuit visualization, Section 11.3). */
export const QUADRANT_TRAIL_COLOR: Record<QuadrantId, number> = {
  NW: 0x66ccff, // blue
  NE: 0x88ff88, // green
  SE: 0xffaa44, // orange
  SW: 0xcc66ff, // violet
};

/** Convenience: the geometry record used by the runtime when spawning a leak. */
export function leakSpawnGeometry(quadrant: QuadrantId) {
  return QUADRANTS[quadrant];
}
