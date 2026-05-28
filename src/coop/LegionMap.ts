// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION MODE — Map model (Phase 1)
// Pure geometry + tile classification for the 40×40 Legion square grid.
// No rendering, no networking, no base-game state. Fully unit-testable.
// ─────────────────────────────────────────────────────────────────────

import {
  LEGION_GRID, QUADRANTS, CIRCUIT_ORDER_CW, PLAYER_COUNT_CONFIG,
  type QuadrantId, type LegionTileKind,
} from './LegionConfig';

const { SIZE, CROSS_MIN, CROSS_MAX } = LEGION_GRID;

/** True if a tile coord is inside the 40×40 grid. */
export function inBounds(col: number, row: number): boolean {
  return col >= 0 && col < SIZE && row >= 0 && row < SIZE;
}

/** Is this tile inside the central cross band (seam OR Rome)? */
function inCrossBand(col: number, row: number): boolean {
  const inColBand = col >= CROSS_MIN && col <= CROSS_MAX;
  const inRowBand = row >= CROSS_MIN && row <= CROSS_MAX;
  return inColBand || inRowBand;
}

/** Is this tile the central Rome block (the cross intersection)? */
export function isRome(col: number, row: number): boolean {
  return col >= CROSS_MIN && col <= CROSS_MAX && row >= CROSS_MIN && row <= CROSS_MAX;
}

/**
 * Which quadrant a tile belongs to, or null if it's in the cross band
 * (seam/Rome). Geometry-only — does not consider which quadrants are
 * active for the current player count (see classifyTile for that).
 */
export function quadrantOf(col: number, row: number): QuadrantId | null {
  if (!inBounds(col, row) || inCrossBand(col, row)) return null;
  const west = col < CROSS_MIN;   // left of the cross
  const north = row < CROSS_MIN;  // above the cross
  if (north) return west ? 'NW' : 'NE';
  return west ? 'SW' : 'SE';
}

/**
 * Full tile classification for a given player count. Sealed quadrants
 * (inactive corners, Section 2.4) report 'SEALED' so the renderer can wall
 * them off and placement is rejected there.
 */
export function classifyTile(col: number, row: number, playerCount: number): LegionTileKind {
  if (!inBounds(col, row)) return 'SEALED';
  if (isRome(col, row)) return 'ROME';
  const quad = quadrantOf(col, row);
  if (quad === null) return 'SEAM'; // cross arm, not Rome
  const cfg = PLAYER_COUNT_CONFIG[playerCount] ?? PLAYER_COUNT_CONFIG[4];
  return cfg.active.includes(quad) ? 'QUADRANT' : 'SEALED';
}

/**
 * Quadrant Sovereignty (Section 4.1): a player may only build inside their
 * OWN active quadrant. Seam, Rome, sealed corners, and other players'
 * quadrants all reject placement. Enforced at the data layer (Section 4.4).
 */
export function canBuildAt(
  col: number, row: number, ownerQuadrant: QuadrantId, playerCount: number,
): boolean {
  if (classifyTile(col, row, playerCount) !== 'QUADRANT') return false;
  return quadrantOf(col, row) === ownerQuadrant;
}

/** Pixel center of a tile (for rendering + entity placement). */
export function tileCenter(col: number, row: number): { x: number; y: number } {
  const t = LEGION_GRID.TILE;
  return { x: col * t + t / 2, y: row * t + t / 2 };
}

/**
 * Build the clockwise circuit polyline for the active player count. The
 * polyline is a sequence of seam tile coords that a leaked unit follows
 * from a quadrant's innerExit, around Rome, to the next active quadrant's
 * secondaryEntry, and (for the last in the chain) inward to Rome.
 *
 * For v1 we route along the seam ring immediately surrounding Rome: the
 * 8 seam tiles hugging the 6×6 Rome block, walked clockwise. Each segment
 * connects one quadrant's exit to the next's entry through those ring tiles.
 */
export function romeRingClockwise(): { col: number; row: number }[] {
  // The seam tiles immediately bordering Rome (cols/rows CROSS_MIN-1 .. CROSS_MAX+1
  // that touch the Rome block), walked clockwise starting top-left.
  const a = CROSS_MIN - 1;   // 16 — just outside Rome on the low side
  const b = CROSS_MAX + 1;   // 23 — just outside Rome on the high side
  const mid = Math.floor((CROSS_MIN + CROSS_MAX) / 2); // ~19 center of Rome span
  // 8-point ring around Rome (top, right, bottom, left + corners), clockwise.
  return [
    { col: a, row: a },        // top-left
    { col: mid, row: a },      // top-mid
    { col: b, row: a },        // top-right
    { col: b, row: mid },      // right-mid
    { col: b, row: b },        // bottom-right
    { col: mid, row: b },      // bottom-mid
    { col: a, row: b },        // bottom-left
    { col: a, row: mid },      // left-mid
  ];
}

/**
 * The ordered list of active quadrants in clockwise chain order for a given
 * player count (who leaks to whom). Last entry's leaks head to Rome.
 */
export function activeChain(playerCount: number): QuadrantId[] {
  const cfg = PLAYER_COUNT_CONFIG[playerCount] ?? PLAYER_COUNT_CONFIG[4];
  return cfg.chain;
}

/** The next quadrant a leak travels to, or null if it heads to Rome. */
export function nextInChain(from: QuadrantId, playerCount: number): QuadrantId | null {
  const chain = activeChain(playerCount);
  const idx = chain.indexOf(from);
  if (idx < 0) return null;
  if (idx === chain.length - 1) return null; // last in chain → Rome
  return chain[idx + 1];
}

/** Convenience: geometry record for a quadrant. */
export function quadrantGeometry(id: QuadrantId) {
  return QUADRANTS[id];
}

/** All four quadrant ids in fixed clockwise order. */
export function allQuadrants(): QuadrantId[] {
  return [...CIRCUIT_ORDER_CW];
}
