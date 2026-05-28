// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION MODE — Configuration (single source of truth)
// Roman TD Co-op Legion Mode v1.0 | Musubi Strong Creative
//
// This file encodes every tunable number and the fixed map geometry from
// the design spec. It has ZERO imports from the base game on purpose: the
// /coop module is an isolated additive layer (spec Section 14 orientation
// note). Base systems (damage types, factions, combos, spawnEnemy,
// CombatResolver, Biomes) are read-only references consumed by the runtime
// modules, never by this config.
//
// Spec section references are noted inline so a future contributor can
// trace any value back to the design document.
// ─────────────────────────────────────────────────────────────────────

import { GRID } from '../constants';

// Entry gate. The loading-screen Co-op button is password-protected so the
// mode stays hidden/beta until the team opens it up. Reuses the same code
// as the dev sandbox per the owner's instruction (2026-05).
export const COOP_PASSWORD = '1027';

// ─── MAP GEOMETRY ──────────────────────────────────────────────────────
// Spec Section 2.1: "The Co-op Legion Mode map is a fixed square." The base
// game map is 38×26 (non-square), so Legion uses its OWN dedicated square
// grid inside this module — the base map is never touched.
//
// Layout: a central 6-wide cross splits the board into four equal 17×17
// corner quadrants. The cross intersection is ROME (6×6). The cross arms
// (minus Rome) are the non-buildable CIRCUIT SEAM that leaked units travel.
//
//        col: 0 ............ 16 | 17..22 | 23 ............ 39
//   row 0   ┌─────────────────┐  ║seam ║  ┌─────────────────┐
//           │     NW  (P1)     │  ║ arm ║  │     NE  (P2)     │
//   row 16  └─────────────────┘  ║     ║  └─────────────────┘
//   row 17  ═══ seam arm ════════╬ ROME╬════ seam arm ═══════
//   row 22                       ║ 6×6 ║
//   row 23  ┌─────────────────┐  ║     ║  ┌─────────────────┐
//           │     SW  (P4)     │  ║ arm ║  │     SE  (P3)     │
//   row 39  └─────────────────┘  ║seam ║  └─────────────────┘
//
export const LEGION_GRID = {
  SIZE: 40,            // 40×40 square
  TILE: GRID.TILE,     // 32px — same tile pixel size as the base game
  CROSS_MIN: 17,       // central band start (col & row)
  CROSS_MAX: 22,       // central band end (inclusive) — 6 tiles wide (17..22)
  QUADRANT_SIZE: 17,   // each corner quadrant is 17×17 buildable tiles
} as const;

export type QuadrantId = 'NW' | 'NE' | 'SE' | 'SW';

// Tile classification kinds for the Legion board. Distinct from the base
// TileType enum so the two map systems never collide. CIRCUIT_SEAM is the
// permanently non-buildable transit path (spec Section 4.4).
export type LegionTileKind = 'QUADRANT' | 'SEAM' | 'ROME' | 'SEALED';

// Per-quadrant fixed geometry. Coordinates are TILE coords on the 40×40 grid.
//   spawnCorner   — primary wave spawn (outer corner)                 [Section 2.1]
//   innerExit     — where this quadrant's leaks enter the seam        [Section 3.3]
//   secondaryEntry— where upstream circuit leaks ENTER this quadrant  [Section 4.3]
//   defaultPlayer — default slot index (P1..P4)                        [Section 2.1]
export interface QuadrantGeometry {
  id: QuadrantId;
  defaultPlayer: 1 | 2 | 3 | 4;
  spawnCorner: { col: number; row: number };
  innerExit: { col: number; row: number };
  secondaryEntry: { col: number; row: number };
  // Inclusive buildable tile bounds (corner rectangle).
  bounds: { minCol: number; maxCol: number; minRow: number; maxRow: number };
}

const Q = LEGION_GRID.QUADRANT_SIZE - 1; // 16 — max inner index of a quadrant
const FAR = LEGION_GRID.SIZE - 1;        // 39 — max grid index
const LO = LEGION_GRID.CROSS_MIN;        // 17
const HI = LEGION_GRID.CROSS_MAX;        // 22
const MID = Math.floor(LEGION_GRID.QUADRANT_SIZE / 2); // 8 — midpoint of a quadrant edge

export const QUADRANTS: Record<QuadrantId, QuadrantGeometry> = {
  NW: {
    id: 'NW', defaultPlayer: 1,
    spawnCorner: { col: 0, row: 0 },
    innerExit: { col: Q, row: Q },              // (16,16) — feeds the NE-bound seam
    secondaryEntry: { col: MID, row: Q },        // (8,16) — leaks from SW arrive here
    bounds: { minCol: 0, maxCol: Q, minRow: 0, maxRow: Q },
  },
  NE: {
    id: 'NE', defaultPlayer: 2,
    spawnCorner: { col: FAR, row: 0 },
    innerExit: { col: HI + 1, row: Q },          // (23,16) — feeds the SE-bound seam
    secondaryEntry: { col: HI + 1, row: MID },   // (23,8) — leaks from NW arrive here
    bounds: { minCol: HI + 1, maxCol: FAR, minRow: 0, maxRow: Q },
  },
  SE: {
    id: 'SE', defaultPlayer: 3,
    spawnCorner: { col: FAR, row: FAR },
    innerExit: { col: HI + 1, row: HI + 1 },     // (23,23) — feeds the SW-bound seam
    secondaryEntry: { col: HI + 1 + MID, row: HI + 1 }, // (31,23) — leaks from NE arrive here
    bounds: { minCol: HI + 1, maxCol: FAR, minRow: HI + 1, maxRow: FAR },
  },
  SW: {
    id: 'SW', defaultPlayer: 4,
    spawnCorner: { col: 0, row: FAR },
    innerExit: { col: Q, row: HI + 1 },          // (16,23) — feeds back toward Rome
    secondaryEntry: { col: Q, row: HI + 1 + MID }, // (16,31) — leaks from SE arrive here
    bounds: { minCol: 0, maxCol: Q, minRow: HI + 1, maxRow: FAR },
  },
};

// Clockwise circuit order (spec Section 2.3: P1 exit → P2 entry → … → Rome).
export const CIRCUIT_ORDER_CW: QuadrantId[] = ['NW', 'NE', 'SE', 'SW'];

// ─── PLAYER-COUNT AUTO-ADJUSTMENT (Section 2.4 / Section 8) ────────────
// Which quadrants are active, which corners are sealed, and the clockwise
// chain of active quadrants for each supported player count. 2-player uses
// the OPPOSING diagonal (NW vs SE) to maximize circuit length (Section 2.4
// note). Solo is intentionally absent — Legion requires 2+ (Section 8.4).
export interface PlayerCountConfig {
  players: number;
  active: QuadrantId[];
  sealed: QuadrantId[];
  // Clockwise chain: chain[i]'s leaks flow to chain[(i+1) % len], the last
  // wraps toward Rome.
  chain: QuadrantId[];
  circuitShape: string;
}

export const PLAYER_COUNT_CONFIG: Record<number, PlayerCountConfig> = {
  2: { players: 2, active: ['NW', 'SE'], sealed: ['NE', 'SW'], chain: ['NW', 'SE'], circuitShape: 'Two-point line through Rome' },
  3: { players: 3, active: ['NW', 'NE', 'SE'], sealed: ['SW'], chain: ['NW', 'NE', 'SE'], circuitShape: 'Three-point arc' },
  4: { players: 4, active: ['NW', 'NE', 'SE', 'SW'], sealed: [], chain: ['NW', 'NE', 'SE', 'SW'], circuitShape: 'Full square loop' },
};

// ─── DIFFICULTY SCALING (Section 5.1) ──────────────────────────────────
// Starting values; HP multiplier is the primary lever (spec note).
export interface DifficultyProfile {
  waveHpMult: number;
  waveCountMult: number;
  enemySpeedMult: number;
}
export const DIFFICULTY_BY_PLAYERS: Record<number, DifficultyProfile> = {
  2: { waveHpMult: 1.3, waveCountMult: 1.0, enemySpeedMult: 1.00 },
  3: { waveHpMult: 1.5, waveCountMult: 1.1, enemySpeedMult: 1.05 },
  4: { waveHpMult: 1.7, waveCountMult: 1.2, enemySpeedMult: 1.10 },
};

// ─── ROME HP POOL (Section 5.4) ────────────────────────────────────────
export const ROME_HP_BY_PLAYERS: Record<number, number> = { 2: 500, 3: 750, 4: 1000 };
// Rome damage multipliers (Section 3.4): base = unit current HP at impact.
export const ROME_BOSS_DAMAGE_MULT = 3.0;
export const ROME_IMMUNE_DAMAGE_MULT = 1.5;
// Rome damage visual delay before HP applies (Section 13 Q6 default B).
export const ROME_DAMAGE_ANIM_DELAY_SEC = 0.8;

// ─── ECONOMY (Section 6) ───────────────────────────────────────────────
export const CIRCUIT_KILL_GOLD_RATE = 0.60;   // killing a circuit leak in your quadrant (6.2)
export const CIRCUIT_DOT_FINISH_RATE = 0.40;  // residual DoT finishing a leak in the seam (6.2)
export const ROME_REBUILD_GOLD_PER_STEP = 50; // combined gold per repair tick (6.4)
export const ROME_REBUILD_HP_PER_STEP = 25;   // HP restored per repair tick (6.4)

// Ghost-lane leak HP reduction when a player disconnects (Section 10.2, Q5 default A).
export const GHOST_LANE_LEAK_HP_MULT = 0.50;
export const REJOIN_WINDOW_SEC = 60;          // (Section 10.3)

// ─── ROMAN LORE (Section 12) ───────────────────────────────────────────
export const POSITION_TITLES: Record<QuadrantId, { title: string; role: string }> = {
  NW: { title: 'Hastati', role: 'Youngest, front line — faces the primary wave first.' },
  NE: { title: 'Principes', role: 'Experienced second rank — intercepts P1 leaks.' },
  SE: { title: 'Triarii', role: 'Veterans, last resort — final interception before Rome.' },
  SW: { title: 'Velites', role: 'Skirmishers — full circuit interception in 4-player.' },
};

export const FLAVOR = {
  modeSelect: 'Form the line. Rome does not fall alone.',
  lobbyWaiting: 'The legions gather. Awaiting cohort.',
  waveStart: 'Ad aciem. To the battle line.',
  leakEvent: (title: string) => `Breach at the ${title} flank.`,
  romeDamage: 'The city takes the blow. Hold the line.',
  romeCritical: 'The eternal city burns. This is the Triarii moment.',
  victory: 'Roma Invicta. Rome undefeated.',
  defeat: 'Sic transit gloria. So passes the glory.',
} as const;
