import { GameStateShape } from '../GameState';
import { GRID, WATER_ZONE } from '../constants';
import waypointsData from '../data/waypoints.json';

function nearestPathIndexForTile(state: GameStateShape, col: number, row: number): number {
  let bestIdx = 0;
  let bestD = Infinity;
  for (let i = 0; i < state.groundPath.length; i++) {
    const p = state.groundPath[i];
    const d = Math.abs(p.col - col) + Math.abs(p.row - row);
    if (d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function oceanShipwreckSpawnPoint(oceanIndex = 0): { x: number; y: number } {
  const wreckX = WATER_ZONE.col * GRID.TILE + 4;
  const wreckY = (WATER_ZONE.row + WATER_ZONE.height - 3.45) * GRID.TILE;
  const offsets = [
    { x: 0, y: 0 },
    { x: -18, y: 10 },
    { x: 20, y: 8 },
    { x: -8, y: -12 },
    { x: 14, y: -10 },
    { x: -26, y: -2 },
    { x: 28, y: -4 },
    { x: 4, y: 18 }
  ];
  const offset = offsets[Math.abs(oceanIndex) % offsets.length];
  return {
    x: wreckX + GRID.TILE * 2.35 + offset.x,
    y: wreckY + GRID.TILE * 1.95 + offset.y
  };
}

function oceanJoinPathIndex(state: GameStateShape): number {
  const wp2 = (waypointsData as any).waypoints?.[1]?.topLeft;
  if (!wp2) return nearestPathIndexForTile(state, WATER_ZONE.col + WATER_ZONE.width, WATER_ZONE.row);
  const wp2Idx = nearestPathIndexForTile(state, wp2.col, wp2.row);
  return Math.min(state.groundPath.length - 1, wp2Idx + 1);
}

function markOceanEmergenceOnce(state: GameStateShape): void {
  const scratch = state as any;
  if (scratch.__oceanEmergenceWave === state.wave) return;
  scratch.__oceanEmergenceWave = state.wave;
  scratch.__oceanSurgeStartedAt = state.tick;
  scratch.__oceanSurgeUntil = Math.max(scratch.__oceanSurgeUntil ?? 0, state.tick + 6.0);
  const hook = (globalThis as any).__oceanEmergenceSfx;
  if (typeof hook === 'function') hook();
}

export function routeOceanSpawnToPath(state: GameStateShape, enemy: any, oceanIndex = 0): boolean {
  if (!enemy || state.groundPath.length === 0) return false;
  const joinIdx = oceanJoinPathIndex(state);
  const join = state.groundPath[joinIdx] ?? state.groundPath[0];
  const { x: spawnX, y: spawnY } = oceanShipwreckSpawnPoint(oceanIndex);
  const targetX = join.col * GRID.TILE + GRID.TILE / 2;
  const targetY = join.row * GRID.TILE + GRID.TILE / 2;
  enemy.x = spawnX;
  enemy.y = spawnY;
  enemy.prevX = spawnX;
  enemy.prevY = spawnY;
  enemy.pathIndex = joinIdx;
  enemy.pathProgress = 0;
  enemy.__oceanSpawn = true;
  enemy.__oceanRouteGroundPath = true;
  enemy.__approachActive = true;
  enemy.__approachTargetX = targetX;
  enemy.__approachTargetY = targetY;
  const renderer = (globalThis as any).__renderer;
  if (renderer?.triggerSpawnPuff) renderer.triggerSpawnPuff(spawnX, spawnY, state.tick);
  if (renderer?.triggerImpactRing) {
    renderer.triggerImpactRing(spawnX, spawnY, state.tick, 42, 0x4bd8ff);
    renderer.triggerImpactRing(spawnX, spawnY, state.tick + 0.08, 70, 0xb9f7ff);
    renderer.triggerImpactRing(spawnX, spawnY, state.tick + 0.16, 98, 0x1a72c8);
  }
  if (renderer?.triggerShake) renderer.triggerShake(2.5, 0.24);
  markOceanEmergenceOnce(state);
  return true;
}
