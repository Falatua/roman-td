import { GRID } from '../constants';
import { TileType } from '../types';
import { GameStateShape } from '../GameState';
import { tileAt, tileToPixel } from './GridManager';
import waypointsData from '../data/waypoints.json';

interface Node { col: number; row: number; }

// A* on the map grid. Walkable: EMPTY, SPAWN, GATE, WAYPOINT, TRAP. Blocked: STONE, TOWER, BORDER.
function isWalkable(state: GameStateShape, col: number, row: number, allowOccupied = false): boolean {
  const t = tileAt(state, col, row);
  if (allowOccupied) return t !== TileType.BORDER;
  return t === TileType.EMPTY || t === TileType.SPAWN || t === TileType.GATE
      || t === TileType.WAYPOINT || t === TileType.TRAP;
}

function key(c: number, r: number): string { return `${c},${r}`; }

function manhattan(a: Node, b: Node): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

// Single-pass A* — earlier version ran the search twice (once for goal-check,
// once to reconstruct). Now we keep parents inline and reconstruct in O(path).
export function aStar(state: GameStateShape, start: Node, goal: Node, allowEndOccupied = true): Node[] | null {
  const open: Map<string, { node: Node; f: number; g: number }> = new Map();
  const parents: Map<string, string | null> = new Map();
  const closed: Set<string> = new Set();
  const startKey = key(start.col, start.row);
  open.set(startKey, { node: start, f: manhattan(start, goal), g: 0 });
  parents.set(startKey, null);

  while (open.size > 0) {
    // Pick the open node with the lowest f-score.
    let bestKey = '';
    let bestF = Infinity;
    for (const [k, v] of open) {
      if (v.f < bestF) { bestF = v.f; bestKey = k; }
    }
    const current = open.get(bestKey)!;
    open.delete(bestKey);
    closed.add(bestKey);

    if (current.node.col === goal.col && current.node.row === goal.row) {
      // Reconstruct the path by walking parents back to the start.
      const path: Node[] = [];
      let k: string | null = bestKey;
      while (k) {
        const [c, r] = k.split(',').map(Number);
        path.unshift({ col: c, row: r });
        k = parents.get(k) ?? null;
      }
      return path;
    }

    const neighbors: Node[] = [
      { col: current.node.col + 1, row: current.node.row },
      { col: current.node.col - 1, row: current.node.row },
      { col: current.node.col,     row: current.node.row + 1 },
      { col: current.node.col,     row: current.node.row - 1 }
    ];
    for (const n of neighbors) {
      const nk = key(n.col, n.row);
      if (closed.has(nk)) continue;
      const isGoal = (n.col === goal.col && n.row === goal.row);
      const walkable = isGoal && allowEndOccupied
        ? isWalkable(state, n.col, n.row, true)
        : isWalkable(state, n.col, n.row, false);
      if (!walkable) continue;
      const g = current.g + 1;
      const f = g + manhattan(n, goal);
      const existing = open.get(nk);
      if (!existing || g < existing.g) {
        open.set(nk, { node: n, f, g });
        parents.set(nk, bestKey);
      }
    }
  }
  return null;
}

// Is every tile along an existing path still walkable? Used to keep the path
// STICKY: if nothing structurally invalidated the old route we should not
// rebuild, because A* can legitimately return an equal-cost alternative that
// LOOKS like a random rewrite to the player. The final tile (gate) is
// treated as walkable even when it's the GATE tile type — the gate is the
// goal, not a blocker.
function isPathStillValid(state: GameStateShape, path: { col: number; row: number }[] | undefined | null): boolean {
  if (!path || path.length < 2) return false;
  for (let i = 0; i < path.length; i++) {
    const t = path[i];
    const allowEnd = (i === path.length - 1);
    const ok = allowEnd
      ? isWalkable(state, t.col, t.row, true)
      : isWalkable(state, t.col, t.row, false);
    if (!ok) return false;
  }
  return true;
}

// Build the full ground path: spawn -> checkpoint 1 -> ... -> checkpoint 5 -> gate.
// STICKY-PATH RULE: if the previously-stored state.groundPath is still 100%
// walkable on the current tile grid, return that path verbatim. This stops
// combos / stone placements that don't actually block the existing route
// from cosmetically rerouting it via A* tie-breaks. Only when a blocker
// lands ON the current path do we rebuild from scratch.
export function buildGroundPath(state: GameStateShape): { col: number; row: number }[] | null {
  const current = (state as any).groundPath as { col: number; row: number }[] | undefined;
  if (isPathStillValid(state, current)) return current!.slice();
  const stops: Node[] = [];
  stops.push({ col: waypointsData.spawn.col, row: waypointsData.spawn.row });
  for (const wp of waypointsData.waypoints) {
    stops.push({ col: wp.topLeft.col, row: wp.topLeft.row });
  }
  stops.push({ col: waypointsData.gate.col, row: waypointsData.gate.row });
  const full: Node[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const seg = aStar(state, stops[i], stops[i + 1], true);
    if (!seg) return null;
    if (i > 0) seg.shift(); // dedupe junction tile
    full.push(...seg);
  }
  return full;
}

// Flyer path: waypoint center pixels in same order, point-to-point.
export function buildFlyerPath(): { x: number; y: number }[] {
  const stops: { x: number; y: number }[] = [];
  stops.push(tileToPixel(waypointsData.spawn.col, waypointsData.spawn.row));
  for (const wp of waypointsData.waypoints) {
    stops.push(tileToPixel(wp.topLeft.col, wp.topLeft.row));
  }
  stops.push(tileToPixel(waypointsData.gate.col, waypointsData.gate.row));
  return stops;
}

// After the ground path is rebuilt (stone/tower placed mid-wave), live enemies
// still hold a pathIndex into the OLD array. If we don't resnap them, they
// keep walking at indices that now refer to wildly different tiles — they
// effectively ignore the new optimal route.
//
// For each non-flyer enemy, walk every segment of the new path, find the
// closest point on it to the enemy's current world position, and rewrite
// pathIndex / pathProgress so the enemy resumes onto that nearest point of
// the new optimal path. Bonus: this also lets enemies legitimately zig-zag
// through fresh maze geometry instead of cutting corners on a stale plan.
export function resnapEnemiesToPath(state: GameStateShape, newPath: { col: number; row: number }[]) {
  if (!newPath || newPath.length < 2) return;
  // Precompute pixel centers for the new path.
  const px = newPath.map(t => tileToPixel(t.col, t.row));
  for (const e of state.enemies.values()) {
    if (e.isFlyer) continue;
    let bestI = 0, bestProg = 0, bestD2 = Infinity;
    for (let i = 0; i < px.length - 1; i++) {
      const a = px[i], b = px[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const segLen2 = dx * dx + dy * dy;
      if (segLen2 < 1) continue;
      // project (e.x,e.y) onto segment AB, clamp to [0,1]
      let t = ((e.x - a.x) * dx + (e.y - a.y) * dy) / segLen2;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const cx = a.x + dx * t, cy = a.y + dy * t;
      const d2 = (e.x - cx) * (e.x - cx) + (e.y - cy) * (e.y - cy);
      if (d2 < bestD2) { bestD2 = d2; bestI = i; bestProg = t; }
    }
    e.pathIndex = bestI;
    e.pathProgress = bestProg;
  }
}

// Validate that placing a stone/tower at (col,row) does not block any waypoint reachability.
export function canPlaceStone(state: GameStateShape, col: number, row: number): boolean {
  if (tileAt(state, col, row) !== TileType.EMPTY) return false;
  // simulate
  state.tiles[row][col] = TileType.STONE;
  const ok = buildGroundPath(state) !== null;
  state.tiles[row][col] = TileType.EMPTY;
  return ok;
}
