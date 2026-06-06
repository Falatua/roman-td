// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION — Green Circle map geometry (2026-06-05 pivot)
//
// JB chose the Green Circle Team TD style: ONE shared map with a single
// square-spiral path running from the outer edge to a center life pool.
// Creeps walk the whole spiral; a creep that survives a segment keeps
// spiralling so the next pair gets a shot; reaching the center costs the
// team one shared life. 8 players in 4 pairs each defend a quadrant of the
// spiral. This module is the pure geometry foundation: it generates the
// spiral path, the spawn, the center, the per-pair segment of each path
// step, and the buildable tiles (the gaps between the spiral arms).
//
// Validated visually against the v1 mock (Sources/rome-td-legion-circle-
// map-proposal-v1.png) before porting here. Map-agnostic: it produces
// tile coordinates only, so the existing Roman TD combat / tower / enemy
// systems (which are position-based) can run on top of it.
// ─────────────────────────────────────────────────────────────────────

export interface CirclePoint { col: number; row: number; }

/** Pair quadrants around the square map (matches the mock coloring). */
export type CircleQuadrant = 0 | 1 | 2 | 3; // 0=NW, 1=NE, 2=SE, 3=SW

/** A corner spawn entry on the spiral. Green Circle has 4, all firing at once. */
export interface CircleSpawn { col: number; row: number; pathIndex: number; quadrant: CircleQuadrant; }

export interface CircleMapGeometry {
  size: number;                 // square grid edge length (tiles)
  ringStep: number;             // spacing between spiral arms (build gap = ringStep-1)
  margin: number;               // unbuildable outer border width
  path: CirclePoint[];          // spiral waypoints, outer -> center (4-adjacent, deduped)
  spawn: CirclePoint;           // path[0] — outer entry (legacy single)
  spawns: CircleSpawn[];        // the 4 corner entries (all fire at once, flow inward)
  center: CirclePoint;          // path[last] — the shared life pool
  /** Pair-segment (quadrant) that owns a given path index. */
  segmentOf: (pathIndex: number) => CircleQuadrant;
  /** Buildable tiles: interior, non-path, non-border (the gaps between arms). */
  buildTiles: CirclePoint[];
  /** Fast membership test for path tiles. */
  isPath: (col: number, row: number) => boolean;
}

export interface CircleMapOpts {
  size?: number;     // default 40 (matches the original Legion square grid)
  ringStep?: number; // default 3 (2-tile build gap between arms)
  margin?: number;   // default 1
}

/** Which pair-quadrant a tile sits in (NW/NE/SE/SW). */
export function quadrantOf(p: CirclePoint, size: number): CircleQuadrant {
  const left = p.col < size / 2;
  const top = p.row < size / 2;
  if (top) return left ? 0 : 1;      // NW : NE
  return left ? 3 : 2;               // SW : SE
}

/**
 * Generate the square-spiral path from the outer ring inward to the center.
 * 4-adjacent and contiguous (deduping the one overlap where each inward
 * connector meets the next ring's first tile). Ported from the validated
 * Python mock.
 */
function generateSpiral(size: number, step: number, margin: number): CirclePoint[] {
  let lo = margin;
  let hi = size - 1 - margin;
  const raw: CirclePoint[] = [];
  while (lo <= hi) {
    for (let c = lo; c <= hi; c++) raw.push({ col: c, row: lo });          // top edge L->R
    for (let r = lo + 1; r <= hi; r++) raw.push({ col: hi, row: r });      // right edge T->B
    for (let c = hi - 1; c >= lo; c--) raw.push({ col: c, row: hi });      // bottom edge R->L
    for (let r = hi - 1; r >= lo + step; r--) raw.push({ col: lo, row: r });// left edge B->T (stop to jog in)
    const nlo = lo + step;
    if (nlo <= hi - step) {
      for (let c = lo + 1; c <= nlo; c++) raw.push({ col: c, row: nlo });  // inward connector
    }
    lo += step;
    hi -= step;
  }
  // Dedupe consecutive duplicates (the connector end overlaps the next
  // ring's first tile) so the path is clean and strictly 4-adjacent.
  const path: CirclePoint[] = [];
  for (const p of raw) {
    const last = path[path.length - 1];
    if (!last || last.col !== p.col || last.row !== p.row) path.push(p);
  }
  return path;
}

export function generateCircleMap(opts: CircleMapOpts = {}): CircleMapGeometry {
  const size = opts.size ?? 40;
  const ringStep = opts.ringStep ?? 3;
  const margin = opts.margin ?? 1;

  const path = generateSpiral(size, ringStep, margin);
  const pathKey = new Set(path.map((p) => p.row * size + p.col));
  const isPath = (col: number, row: number) => pathKey.has(row * size + col);

  // Buildable tiles: interior (inside the margin), not on the path.
  const buildTiles: CirclePoint[] = [];
  for (let row = margin; row <= size - 1 - margin; row++) {
    for (let col = margin; col <= size - 1 - margin; col++) {
      if (!isPath(col, row)) buildTiles.push({ col, row });
    }
  }

  // Green Circle: the four outer-ring corners are the spawn entries. All fire
  // at once and flow inward along the one shared spiral (quarter-lap apart).
  const cornerPts: CirclePoint[] = [
    { col: margin, row: margin },                          // NW
    { col: size - 1 - margin, row: margin },               // NE
    { col: size - 1 - margin, row: size - 1 - margin },    // SE
    { col: margin, row: size - 1 - margin },               // SW
  ];
  const spawns: CircleSpawn[] = cornerPts
    .map((c) => ({ col: c.col, row: c.row, pathIndex: path.findIndex((p) => p.col === c.col && p.row === c.row), quadrant: quadrantOf(c, size) }))
    .filter((s) => s.pathIndex >= 0);

  return {
    size,
    ringStep,
    margin,
    path,
    spawn: path[0],
    spawns,
    center: path[path.length - 1],
    segmentOf: (i: number) => quadrantOf(path[Math.max(0, Math.min(path.length - 1, i))], size),
    buildTiles,
    isPath,
  };
}
