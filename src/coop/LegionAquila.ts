// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION MODE — Phase 10: The Aquila Team Combo Tower (Section 7.2)
//
// The team reward for collective competence: if every active quadrant clears
// a wave with ZERO leaks, a single Aquila Standard unlocks. It is the ONE
// exception to seam non-buildability (Section 4.4) — it sits on the circuit
// seam and strikes everything traveling it. Powerful but fragile: a boss leak
// impact destroys it, and only one can ever be placed per game.
//
// The user chose to INCLUDE the Aquila in v1 (overriding the spec's Section 13
// Q4 default-B "hold for v2"). Pure state machine + helpers — fully testable.
// ─────────────────────────────────────────────────────────────────────

import { classifyTile } from './LegionMap';
import type { RoundSummaryRow } from './LegionEconomy';

// Strong vs. seam traffic, wide coverage, but a thin HP pool so a boss can
// crush it. Tunable starting values.
export const AQUILA_DPS = 95;
export const AQUILA_HP = 600;
export const AQUILA_RANGE_TILES = 9;

export interface AquilaState {
  earned: boolean;    // a zero-leak round occurred → reward unlocked
  placed: boolean;    // the single Aquila has been placed this game
  destroyed: boolean; // a boss leak impact destroyed it (cannot rebuild)
  col: number;
  row: number;
  hp: number;
}

export function createAquila(): AquilaState {
  return { earned: false, placed: false, destroyed: false, col: -1, row: -1, hp: 0 };
}

/**
 * Zero-leak round (Section 7.2): EVERY active quadrant ended the wave with no
 * leaks. `roundLeaksByPlayer` is each active player's leak count for the round.
 */
export function isZeroLeakRound(roundLeaksByPlayer: number[]): boolean {
  return roundLeaksByPlayer.length > 0 && roundLeaksByPlayer.every((n) => n === 0);
}

/** Unlock the reward (idempotent). No-op once earned or already placed. */
export function grantAquilaReward(s: AquilaState): AquilaState {
  if (s.earned || s.placed) return s;
  return { ...s, earned: true };
}

/** Only after the zero-leak unlock, only once per game (Section 7.2). */
export function canPlaceAquila(s: AquilaState): boolean {
  return s.earned && !s.placed && !s.destroyed;
}

/**
 * The seam-placement EXCEPTION (Section 7.2 / 4.4): the Aquila is the only
 * structure that may sit on a CIRCUIT_SEAM tile. Everything else — quadrants,
 * Rome, sealed corners — is rejected.
 */
export function canPlaceAquilaAt(col: number, row: number, playerCount: number): boolean {
  return classifyTile(col, row, playerCount) === 'SEAM';
}

export function placeAquila(s: AquilaState, col: number, row: number, playerCount: number): AquilaState {
  if (!canPlaceAquila(s) || !canPlaceAquilaAt(col, row, playerCount)) return s;
  return { ...s, placed: true, col, row, hp: AQUILA_HP };
}

/** Active = placed, alive, not destroyed. Only an active Aquila fires. */
export function isAquilaActive(s: AquilaState): boolean {
  return s.placed && !s.destroyed && s.hp > 0;
}

/** A boss leak impact destroys it outright (Section 7.2). Cannot be rebuilt. */
export function destroyAquila(s: AquilaState): AquilaState {
  if (!s.placed) return s;
  return { ...s, destroyed: true, hp: 0 };
}

/** Chip HP (e.g. a non-boss impact). Destroyed when it hits zero. */
export function damageAquila(s: AquilaState, dmg: number): AquilaState {
  if (!isAquilaActive(s)) return s;
  const hp = Math.max(0, s.hp - Math.max(0, dmg));
  return { ...s, hp, destroyed: hp <= 0 };
}

/**
 * Legion Commander = highest total (wave + circuit) kills this run (Section
 * 7.2). They place the Aquila when no majority vote is wired. Ties resolve to
 * the first row. Returns null for an empty board.
 */
export function legionCommander(rows: RoundSummaryRow[]): string | null {
  if (rows.length === 0) return null;
  let best = rows[0];
  for (const r of rows) {
    if (r.waveKills + r.circuitKills > best.waveKills + best.circuitKills) best = r;
  }
  return best.playerId;
}
