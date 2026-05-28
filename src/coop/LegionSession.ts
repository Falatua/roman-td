// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION MODE — Phase 2: Session config resolver
// Resolves the full per-player-count layout + difficulty into one object
// the runtime can read. Validates the 2-4 player requirement (Section 8.4).
// ─────────────────────────────────────────────────────────────────────

import {
  PLAYER_COUNT_CONFIG, DIFFICULTY_BY_PLAYERS, ROME_HP_BY_PLAYERS,
  type QuadrantId, type DifficultyProfile,
} from './LegionConfig';

export interface SessionConfig {
  players: number;            // 2-4
  active: QuadrantId[];        // active quadrants
  sealed: QuadrantId[];        // sealed corners
  chain: QuadrantId[];         // clockwise leak chain
  difficulty: DifficultyProfile;
  romeStartHp: number;
  circuitShape: string;
}

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

/** True if the player count can start a Legion session (Section 8.4). */
export function canStartLegion(playerCount: number): boolean {
  return playerCount >= MIN_PLAYERS && playerCount <= MAX_PLAYERS;
}

/**
 * Resolve the complete session configuration for a given player count.
 * Clamps to the supported 2-4 range so an out-of-range value never crashes
 * the setup (returns the nearest valid config).
 */
export function resolveSessionConfig(playerCount: number): SessionConfig {
  const p = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.round(playerCount)));
  const layout = PLAYER_COUNT_CONFIG[p];
  return {
    players: p,
    active: [...layout.active],
    sealed: [...layout.sealed],
    chain: [...layout.chain],
    difficulty: { ...DIFFICULTY_BY_PLAYERS[p] },
    romeStartHp: ROME_HP_BY_PLAYERS[p],
    circuitShape: layout.circuitShape,
  };
}

/** Human-readable summary for the lobby / onboarding text. */
export function sessionSummary(cfg: SessionConfig): string {
  const d = cfg.difficulty;
  return `${cfg.players} legions · ${cfg.circuitShape} · enemy HP ×${d.waveHpMult} · Rome ${cfg.romeStartHp} HP`;
}
