// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION MODE — Shared types
// Isolated /coop module. Imports base ItemId/enemy-type strings as plain
// references only; never mutates base state.
// ─────────────────────────────────────────────────────────────────────

import type { QuadrantId } from './LegionConfig';

// ─── LOBBY / SESSION ───────────────────────────────────────────────────
export type LegionPhase =
  | 'LOBBY'        // room created, waiting for players
  | 'PREP'         // build phase (all players build simultaneously)
  | 'WAVE'         // wave combat in progress
  | 'ROUND_END'    // summary panel between waves
  | 'VICTORY'      // all waves cleared, Rome stood
  | 'DEFEAT';      // Rome fell

export interface LegionPlayer {
  id: string;            // stable per-session id (also the reconnection token)
  name: string;          // display name (sanitized, ≤12 chars)
  quadrant: QuadrantId | null; // assigned quadrant (null until placed)
  isHost: boolean;
  connected: boolean;    // false → Ghost Lane (Section 10)
  ghost: boolean;        // true once converted to a ghost lane
}

// ─── LEAK MANIFEST (the network payload, Section 9.3) ──────────────────
// A leaked unit serialized for transit to the next quadrant. Tiny by design
// so the async model stays cheap: enemy type + current HP + faction + the
// secondary entry it should appear at.
export interface LeakUnit {
  enemyType: string;     // base EnemyType string key
  hp: number;            // CURRENT hp, 100% retained (Section 5.2)
  maxHp: number;         // for HP-bar rendering on arrival
  faction: string;       // base EnemyFaction string key
  isBoss: boolean;
  isImmune: boolean;     // "immune creep" — 1.5× Rome damage (Section 3.4)
  fromQuadrant: QuadrantId; // who leaked it (for trail color + Dishonor credit)
  underReqCheckpoints: boolean; // true → maze was insufficient (red-trail flag, Section 4.2)
}

// A manifest is one player's full set of leaks for a single wave.
export interface LeakManifest {
  wave: number;
  fromQuadrant: QuadrantId;
  units: LeakUnit[];
}

// ─── ROME ──────────────────────────────────────────────────────────────
export interface RomeState {
  hp: number;
  maxHp: number;
  pendingDamage: number;   // queued during the animation-delay window
}

// ─── PER-PLAYER ROUND STATS (live scoreboard + end-of-round, Section 11.4) ──
// The owner asked for a persistent in-match scoreboard tracking kills,
// towers, combos, quests — so we track cumulative AND per-round.
export interface PlayerStats {
  waveKills: number;        // kills of own primary-wave enemies (cumulative)
  circuitKills: number;     // kills of leaked units that entered your quadrant
  leaks: number;            // units you leaked this ROUND (resets each round = Dishonor)
  leaksTotal: number;       // cumulative leaks (cumulative Dishonor)
  towersBuilt: number;      // current placed tower count in your quadrant
  combosBuilt: number;      // combination towers forged this run
  questsDone: number;       // quests completed this run
  romeContributed: number;  // gold contributed to the shared Rome-rebuild pool
}

export function emptyStats(): PlayerStats {
  return {
    waveKills: 0, circuitKills: 0, leaks: 0, leaksTotal: 0,
    towersBuilt: 0, combosBuilt: 0, questsDone: 0, romeContributed: 0,
  };
}

// ─── NET TRANSPORT ABSTRACTION (Section 9) ─────────────────────────────
// The coop runtime is written against this interface, not against Supabase
// directly. That keeps the game logic transport-agnostic and unit-testable
// with a mock transport. The Supabase Realtime implementation (Phase 3)
// satisfies this, lazy-loaded so the base bundle is unaffected.
export interface LegionNetMessage {
  type: string;            // 'leak' | 'rome' | 'stats' | 'prep_done' | 'rebuild' | ...
  from: string;            // sender player id
  payload: unknown;
}

export interface LegionNetTransport {
  roomCode: string;
  selfId: string;
  isHost: boolean;
  send(type: string, payload: unknown): void;
  on(type: string, handler: (msg: LegionNetMessage) => void): void;
  presence(): LegionPlayer[];
  leave(): void;
}
