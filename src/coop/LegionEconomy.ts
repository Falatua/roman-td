// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION MODE — Phase 7: Economy (Section 6)
//
// Preserves base kill-gold, adds the multiplayer layers: circuit-kill
// assist rates, the Legion Dishonor counter (display-only), the shared
// Rome-rebuild pool, and the end-of-round summary. Pure functions +
// immutable stat helpers — fully testable.
// ─────────────────────────────────────────────────────────────────────

import {
  CIRCUIT_KILL_GOLD_RATE, CIRCUIT_DOT_FINISH_RATE,
  ROME_REBUILD_GOLD_PER_STEP, ROME_REBUILD_HP_PER_STEP,
} from './LegionConfig';
import { type PlayerStats, emptyStats } from './LegionTypes';

// ─── KILL GOLD (Section 6.1 / 6.2) ─────────────────────────────────────
/** Full kill gold for a kill in your own primary wave (Section 6.1). */
export function ownLaneGold(baseGold: number): number {
  return Math.max(0, Math.round(baseGold));
}
/** 60% assist gold for killing a circuit leak in your quadrant (Section 6.2). */
export function circuitKillGold(baseGold: number): number {
  return Math.max(0, Math.round(baseGold * CIRCUIT_KILL_GOLD_RATE));
}
/** 40% for a residual-DoT finish on a leak in the seam (Section 6.2). */
export function dotFinishGold(baseGold: number): number {
  return Math.max(0, Math.round(baseGold * CIRCUIT_DOT_FINISH_RATE));
}
/** The original leak player earns NOTHING for a leaked unit (Section 6.2). */
export const LEAK_PLAYER_GOLD = 0;

// ─── STAT HELPERS (immutable) ──────────────────────────────────────────
export function recordWaveKill(s: PlayerStats, n = 1): PlayerStats {
  return { ...s, waveKills: s.waveKills + n };
}
export function recordCircuitKill(s: PlayerStats, n = 1): PlayerStats {
  return { ...s, circuitKills: s.circuitKills + n };
}
/** A unit leaked from this player (Dishonor +1 this round and cumulatively). */
export function recordLeak(s: PlayerStats, n = 1): PlayerStats {
  return { ...s, leaks: s.leaks + n, leaksTotal: s.leaksTotal + n };
}
/** Reset the per-round Dishonor counter (cumulative persists, Section 11.4). */
export function resetRoundDishonor(s: PlayerStats): PlayerStats {
  return { ...s, leaks: 0 };
}
export function recordCombo(s: PlayerStats, n = 1): PlayerStats {
  return { ...s, combosBuilt: s.combosBuilt + n };
}
export function recordQuest(s: PlayerStats, n = 1): PlayerStats {
  return { ...s, questsDone: s.questsDone + n };
}
export function setTowerCount(s: PlayerStats, count: number): PlayerStats {
  return { ...s, towersBuilt: Math.max(0, count) };
}
export function recordRomeContribution(s: PlayerStats, gold: number): PlayerStats {
  return { ...s, romeContributed: s.romeContributed + Math.max(0, gold) };
}
/** Accumulate tower damage dealt (for the team leaderboard's damage column). */
export function recordDamage(s: PlayerStats, dmg: number): PlayerStats {
  return { ...s, damageDealt: s.damageDealt + Math.max(0, dmg) };
}

// ─── ROME REBUILD SHARED POOL (Section 6.4) ────────────────────────────
export interface RebuildPool {
  gold: number;                       // combined gold in the pool this prep
  byPlayer: Record<string, number>;   // per-player contributions (visible, 6.4 note)
  usedThisPrep: boolean;              // caps at one rebuild per prep phase
}
export function createRebuildPool(): RebuildPool {
  return { gold: 0, byPlayer: {}, usedThisPrep: false };
}
export function contributeToRebuild(pool: RebuildPool, playerId: string, gold: number): RebuildPool {
  const g = Math.max(0, Math.round(gold));
  return {
    ...pool,
    gold: pool.gold + g,
    byPlayer: { ...pool.byPlayer, [playerId]: (pool.byPlayer[playerId] ?? 0) + g },
  };
}
/**
 * Resolve the rebuild at end of prep: if the pool has reached the step
 * threshold and hasn't been used this prep, return the HP to restore and
 * mark used. Otherwise no-op.
 */
export function resolveRebuild(pool: RebuildPool): { pool: RebuildPool; hpRestored: number } {
  if (pool.usedThisPrep || pool.gold < ROME_REBUILD_GOLD_PER_STEP) {
    return { pool, hpRestored: 0 };
  }
  return { pool: { ...pool, usedThisPrep: true }, hpRestored: ROME_REBUILD_HP_PER_STEP };
}
/** New prep phase → reset the pool. */
export function resetRebuildPool(): RebuildPool {
  return createRebuildPool();
}

// ─── END-OF-ROUND SUMMARY (Section 11.4) ───────────────────────────────
export interface RoundSummaryRow {
  playerId: string;
  name: string;
  quadrantTitle: string;
  waveKills: number;
  circuitKills: number;
  leaks: number;            // this round (Dishonor)
  romeContributed: number;
}
/** Build a sortable summary (descending by total kills) for the panel. */
export function buildRoundSummary(
  rows: Omit<RoundSummaryRow, never>[],
): RoundSummaryRow[] {
  return [...rows].sort((a, b) =>
    (b.waveKills + b.circuitKills) - (a.waveKills + a.circuitKills));
}

/** Fresh stats (re-export for the runtime). */
export { emptyStats };
