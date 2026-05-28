// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION MODE — Phase 8: Disconnect / Ghost Lane (Section 10)
//
// Implements Option A (the v1 recommendation, Section 13 Q5): when a player
// drops, their quadrant keeps running on its existing towers, no new builds,
// and its leaks enter the circuit at 50% HP. A 60-second session-token rejoin
// window (REJOIN_WINDOW_SEC) precedes the GHOST conversion; rejoining at any
// point restores control with towers intact and reverses nothing.
//
// Pure state machine + helpers — no transport, no timers of its own. The
// runtime supplies `nowSec` and calls these on its tick; that keeps the whole
// thing deterministic and unit-testable.
// ─────────────────────────────────────────────────────────────────────

import { REJOIN_WINDOW_SEC, GHOST_LANE_LEAK_HP_MULT, type QuadrantId } from './LegionConfig';
import type { LeakUnit } from './LegionTypes';

// CONNECTED → (drop) → DISCONNECTED → (60s elapses) → GHOST.
// rejoin() returns any non-connected state to CONNECTED.
export type LaneStatus = 'CONNECTED' | 'DISCONNECTED' | 'GHOST';

export interface LaneConn {
  playerId: string;
  quadrant: QuadrantId;
  name: string;
  status: LaneStatus;
  disconnectedAtSec: number | null; // start of the rejoin window; null when CONNECTED or GHOST
}

export function createLaneConn(playerId: string, quadrant: QuadrantId, name: string): LaneConn {
  return { playerId, quadrant, name, status: 'CONNECTED', disconnectedAtSec: null };
}

/**
 * Player dropped mid-session (Section 10.1). Opens the rejoin window. Idempotent
 * if the lane is already disconnected or ghosted.
 */
export function markDisconnected(lane: LaneConn, nowSec: number): LaneConn {
  if (lane.status !== 'CONNECTED') return lane;
  return { ...lane, status: 'DISCONNECTED', disconnectedAtSec: nowSec };
}

/** Seconds remaining before this lane converts to GHOST (0 once elapsed/ghosted). */
export function secondsUntilGhost(lane: LaneConn, nowSec: number): number {
  if (lane.status !== 'DISCONNECTED' || lane.disconnectedAtSec == null) return 0;
  return Math.max(0, REJOIN_WINDOW_SEC - (nowSec - lane.disconnectedAtSec));
}

/**
 * Advance the rejoin clock. Converts DISCONNECTED → GHOST once the 60s window
 * elapses (Section 10.3). No-op for CONNECTED or already-GHOST lanes.
 */
export function tickRejoinWindow(lane: LaneConn, nowSec: number): LaneConn {
  if (lane.status !== 'DISCONNECTED' || lane.disconnectedAtSec == null) return lane;
  if (nowSec - lane.disconnectedAtSec >= REJOIN_WINDOW_SEC) {
    return { ...lane, status: 'GHOST', disconnectedAtSec: null };
  }
  return lane;
}

/**
 * Player returns with their session token (Section 10.3). Restores control
 * whether they beat the window or rejoined after GHOST conversion — towers stay
 * intact, and no HP/gold events that happened while away are reversed (the
 * caller never rolls back state; this only flips status back to CONNECTED).
 */
export function rejoin(lane: LaneConn): LaneConn {
  if (lane.status === 'CONNECTED') return lane;
  return { ...lane, status: 'CONNECTED', disconnectedAtSec: null };
}

export function isGhost(lane: LaneConn): boolean { return lane.status === 'GHOST'; }
export function isConnected(lane: LaneConn): boolean { return lane.status === 'CONNECTED'; }

/**
 * Build/upgrade/downgrade is blocked the instant a player drops and stays
 * blocked through GHOST (Section 10.2). Only a CONNECTED lane can build.
 */
export function canBuildInLane(lane: LaneConn): boolean { return lane.status === 'CONNECTED'; }

// ─── GHOST-LANE LEAK REDUCTION (Section 10.2) ──────────────────────────
/** A ghost lane's leak HP after the 50% partial-defense reduction. */
export function ghostLeakHp(currentHp: number): number {
  return Math.max(0, Math.round(currentHp * GHOST_LANE_LEAK_HP_MULT));
}
/** Apply the ghost reduction to a leak only when its source lane is ghosted. */
export function applyGhostReduction(unit: LeakUnit, laneIsGhost: boolean): LeakUnit {
  if (!laneIsGhost) return unit;
  return { ...unit, hp: ghostLeakHp(unit.hp) };
}

// ─── GOLD REDISTRIBUTION (Section 10.2) ────────────────────────────────
/** Player ids of all still-connected lanes (the redistribution recipients). */
export function connectedPlayerIds(lanes: LaneConn[]): string[] {
  return lanes.filter(isConnected).map((l) => l.playerId);
}

/**
 * Split `amount` gold equally across `recipientIds`. Remainder is spread one
 * per recipient from the front so the result is deterministic and balanced
 * (mirrors LegionScaling.distributeAcrossCorners). Recipients always appear in
 * the output, even when the split is 0.
 */
export function redistributeGold(amount: number, recipientIds: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const g = Math.max(0, Math.floor(amount));
  const n = recipientIds.length;
  if (n <= 0) return out;
  const base = g > 0 ? Math.floor(g / n) : 0;
  const remainder = g > 0 ? g % n : 0;
  recipientIds.forEach((id, i) => {
    out[id] = base + (i < remainder ? 1 : 0);
  });
  return out;
}

/**
 * Runtime convenience: pool the prep-phase gold of every non-connected lane and
 * redistribute it equally among the connected players (Section 10.2). Connected
 * lanes keep their own gold; disconnected and ghost lanes forfeit theirs to the
 * survivors.
 */
export function redistributeGhostPrepGold(
  lanes: LaneConn[],
  prepGoldByPlayer: Record<string, number>,
): Record<string, number> {
  const recipients = connectedPlayerIds(lanes);
  let pooled = 0;
  for (const lane of lanes) {
    if (lane.status !== 'CONNECTED') {
      pooled += Math.max(0, Math.floor(prepGoldByPlayer[lane.playerId] ?? 0));
    }
  }
  return redistributeGold(pooled, recipients);
}
