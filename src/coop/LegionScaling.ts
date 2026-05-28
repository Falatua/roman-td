// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION MODE — Phase 2: Difficulty scaling math (Section 5)
// Pure functions. Consumed by the wave spawner (Phase 4) and Rome system
// (Phase 6). No base-game imports — base wave/enemy data is passed in.
// ─────────────────────────────────────────────────────────────────────

import { DIFFICULTY_BY_PLAYERS, ROME_HP_BY_PLAYERS } from './LegionConfig';

function profile(players: number) {
  const p = Math.max(2, Math.min(4, players));
  return DIFFICULTY_BY_PLAYERS[p];
}

/** Per-enemy HP after the player-count multiplier (Section 5.1). */
export function scaledEnemyHp(baseHp: number, players: number): number {
  return Math.round(baseHp * profile(players).waveHpMult);
}

/** Per-enemy movement speed after the player-count modifier (Section 5.1). */
export function scaledEnemySpeed(baseSpeed: number, players: number): number {
  return baseSpeed * profile(players).enemySpeedMult;
}

/** Rome starting HP for the player count (Section 5.4). */
export function romeStartingHp(players: number): number {
  const p = Math.max(2, Math.min(4, players));
  return ROME_HP_BY_PLAYERS[p];
}

/**
 * Total wave unit count across the WHOLE team (Section 5.3). This is the
 * critical nuance: the count multiplier applies to the AGGREGATE pool, not
 * to each lane independently. base × countMult = total units the team
 * faces; that pool is then split across the active corners so each player
 * sees roughly solo density.
 */
export function totalWaveCount(baseCount: number, players: number): number {
  return Math.round(baseCount * profile(players).waveCountMult);
}

/**
 * Distribute a total unit pool as evenly as possible across N active
 * corners. Remainder units are spread one-per-lane from the front so the
 * split is deterministic and balanced (e.g. 14 units / 4 lanes → [4,4,3,3]).
 */
export function distributeAcrossCorners(totalUnits: number, activeCount: number): number[] {
  if (activeCount <= 0) return [];
  const base = Math.floor(totalUnits / activeCount);
  const remainder = totalUnits % activeCount;
  const out: number[] = [];
  for (let i = 0; i < activeCount; i++) {
    out.push(base + (i < remainder ? 1 : 0));
  }
  return out;
}
