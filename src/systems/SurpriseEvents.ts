// SurpriseEvents — 2026-05-16 mid-wave ambient events. v2 polish pass.
//
// Two flavors:
//   • INVASION: 4 perimeter FIRE BREACHES (N/S/E/W edges). Each fire
//     spits TWO enemies in quick succession that "teleport in" (cyan
//     fade-in + ghost tint) and snap to the nearest path tile.
//   • UPRISING: 4 SKULL URNS rise from a center-map diamond. Each urn
//     opens its mouth twice to birth TWO undead each, which "rise from
//     the ground" (y-offset fade-up + dust kick). Only fires on undead
//     waves.
//
// Both events are pure surprise (no banner; the audio sting + tint +
// camera shake announce them in-frame). After the LAST enemy of either
// event resolves (kill or leak), a 3-item reward modal opens (paused).
//
// v2 polish locks:
//   • 4 spawn POINTS × 2 enemies each = 8 enemies total per event.
//   • Spawn cadence is quick (0.6s between consecutive spawns at the
//     same point, 0.3s offset across points so the event feels alive).
//   • VFX phase: RISE (0.55s lead-in) → SPAWN (active until last enemy
//     emerges) → FADE (0.7s smooth fadeout). No persistent scars — the
//     play area returns to clean as soon as the spawn schedule drains.
//   • Total VFX duration ~3-4s for the visual ceremony.

import { GameStateShape } from '../GameState';
import { SurpriseEventKind, SurpriseEventState, SurpriseEventSpawnPoint, SurpriseAtmosProp, EnemyType, TileType } from '../types';
import { GRID } from '../constants';
import { spawnEnemy } from './EnemySystem';
import { effectiveWaveHpMult, lateGameLayerMult } from './WaveManager';
import wavesData from '../data/waves.json';
import enemiesData from '../data/enemies.json';
import waypointsData from '../data/waypoints.json';

// ─── PUBLIC API ────────────────────────────────────────────────────────

// Fixed trigger schedule for the 20-wave campaign. All non-boss, non-flyer
// waves. Cooldown ≥3 waves. Uprising gated to undead factions only.
//   W7  — Invasion (CARTHAGE faction)
//   W11 — Uprising (UNDEAD_CELTS)
//   W14 — Uprising (UNDEAD_CELTS)
//   W18 — Invasion (UNDEAD_CARTHAGE)
export const SURPRISE_EVENT_SCHEDULE: Record<number, SurpriseEventKind> = {
  7:  SurpriseEventKind.INVASION,
  11: SurpriseEventKind.UPRISING,
  14: SurpriseEventKind.UPRISING,
  18: SurpriseEventKind.INVASION,
};

// v2 spawn tuning. Each of the 4 visual points (fire or urn) spawns
// TWO enemies. Total enemies per event = 8 (still feels surprising
// without overwhelming the wave already in motion).
const SPAWNS_PER_POINT = 2;
const POINT_COUNT = 4;
// Stagger between consecutive spawns AT THE SAME point. Tighter for
// uprising (the user asked for "quick" emergence speed).
const INTRA_POINT_STAGGER = { INVASION: 0.7, UPRISING: 0.5 };
// Offset added between consecutive POINTS so all 4 don't fire at the
// same tick. The first point starts at lead-in + 0; the next at + this.
const INTER_POINT_OFFSET = 0.3;
// Lead-in: how long the fire/urn sprite breathes ALIVE on-screen before
// its FIRST enemy spawns. The audio sting + tint cover this window.
const VFX_RISE_SECONDS = 0.55;
// How long after the LAST spawn fires before the VFX starts fading.
// Kept short so the play area stays clean during the wave.
const VFX_HOLD_AFTER_LAST = 0.25;
// Smooth fade-out duration after the hold ends.
const VFX_FADEOUT_SECONDS = 0.7;

// Triggered from WaveManager.startWave after the standard spawn queue
// is built. If this wave matches the schedule, kicks off the event
// IMMEDIATELY in WAVE-OVERRIDE mode: every enemy in the wave will spawn
// from a perimeter fire (Invasion) or center urn (Uprising), not the cave.
export function maybeTriggerSurpriseEventForWave(state: GameStateShape): void {
  if (state.endlessMode) return;
  const kind = SURPRISE_EVENT_SCHEDULE[state.wave];
  if (!kind) return;
  const lastWave = state.lastSurpriseEventWave ?? 0;
  if (state.wave - lastWave < 3) return;
  scheduleSurpriseEvent(state, kind, state.tick + 0.5, /*waveOverride=*/true);
}

// Endless-mode trigger. ~25% chance per endless wave with 3-wave cooldown.
export function maybeTriggerEndlessSurpriseEvent(state: GameStateShape, factionKey: string): void {
  const lastWave = state.lastSurpriseEventWave ?? 0;
  const endlessWaveNum = (state.endlessWave ?? 1) + 20;
  if (endlessWaveNum - lastWave < 3) return;
  if (Math.random() > 0.25) return;
  const isUndeadFaction = factionKey === 'UNDEAD_CELTS' || factionKey === 'UNDEAD_CARTHAGE';
  const kind = isUndeadFaction && Math.random() < 0.5 ? SurpriseEventKind.UPRISING : SurpriseEventKind.INVASION;
  // Endless mode also uses waveOverride — full perimeter / center spawn flow.
  scheduleSurpriseEvent(state, kind, state.tick + 0.5, /*waveOverride=*/true);
}

// Called when an enemy dies or leaks. Fires the reward modal trigger
// the MOMENT the last event-spawned enemy resolves AND the spawn schedule
// has fully drained — i.e. the moment the player kills the last enemy
// of an invasion / uprising wave. Works in both waveOverride and legacy
// modes; the schedule-empty check (no more pending spawns) ensures we
// don't fire prematurely mid-wave.
export function notifySurpriseEnemyResolved(state: GameStateShape, enemyId: string): void {
  const ev = state.activeSurpriseEvent;
  if (!ev || ev.rewardGiven) return;
  if (!ev.spawnedEnemyIds.has(enemyId)) return;
  ev.spawnedEnemyIds.delete(enemyId);
  const allFired = ev.spawnPoints.every(p => p.fired);
  // In waveOverride mode, the spawn schedule is the wave's spawn queue
  // (which lives on state.spawnQueue). We need that to be drained too.
  const spawnQueueEmpty = !ev.waveOverride || state.spawnQueue.length === 0;
  if (allFired && spawnQueueEmpty && ev.spawnedEnemyIds.size === 0) {
    if (state.lives <= 0) return;     // dead player gets no reward
    ev.endedAt = state.tick;
    ev.rewardGiven = true;
    state.pendingSurpriseReward = { kind: ev.kind === SurpriseEventKind.INVASION ? 'INVASION' : 'UPRISING' };
    state.surpriseEventsCompleted = (state.surpriseEventsCompleted ?? 0) + 1;
    if (ev.vfxFadeOutAt === 0) ev.vfxFadeOutAt = state.tick;
  }
}

// Called from WaveManager.checkWaveEnd when a wave ends. If the wave had an
// active waveOverride surprise event AND the player is still alive, fires
// the reward modal trigger. Player gets to pick their accomplishment reward.
export function notifySurpriseEventWaveEnded(state: GameStateShape): void {
  const ev = state.activeSurpriseEvent;
  if (!ev || !ev.waveOverride || ev.rewardGiven) return;
  if (state.lives <= 0) return;     // dead player gets no reward
  ev.endedAt = state.tick;
  ev.rewardGiven = true;
  state.pendingSurpriseReward = { kind: ev.kind === SurpriseEventKind.INVASION ? 'INVASION' : 'UPRISING' };
  state.surpriseEventsCompleted = (state.surpriseEventsCompleted ?? 0) + 1;
  // Trigger the VFX fade-out so fires/urns retreat after the reward picks.
  if (ev.vfxFadeOutAt === 0) ev.vfxFadeOutAt = state.tick;
}

// Per-frame tick. In legacy (non-override) mode this drains the fixed 8-spawn
// schedule. In WAVE-OVERRIDE mode the actual spawns are driven by
// WaveManager.tickSpawns (which reads eventPointIdx off each spawn queue
// entry and routes via spawnAtSurpriseEventPoint below); this tick is a
// no-op for spawning but still handles VFX fade-out detection.
export function tickSurpriseEvents(state: GameStateShape): void {
  const ev = state.activeSurpriseEvent;
  if (!ev) return;
  if (!ev.waveOverride) {
    // Legacy path: drain the fixed schedule (unused by current campaign
    // since maybeTrigger* always passes waveOverride=true, but kept for
    // back-compat if a future caller schedules a non-override event).
    for (const point of ev.spawnPoints) {
      if (point.fired) continue;
      if (state.tick < point.spawnAt) continue;
      const enemyType = point.enemyType as EnemyType;
      const wIdx = Math.max(0, Math.min(wavesData.length - 1, state.wave - 1));
      const w = wavesData[wIdx];
      const isBossSpawn = !!(enemiesData as any)[enemyType]?.isBoss;
      const isFlyerSpawn = !!(enemiesData as any)[enemyType]?.isFlyer;
      const basicHpMult = effectiveWaveHpMult(state.wave, w.hpMult, false);
      const layerMult = lateGameLayerMult(state.wave, isBossSpawn, isFlyerSpawn);
      const spawnHpMult = (isBossSpawn
        ? effectiveWaveHpMult(state.wave, w.hpMult, true)
        : basicHpMult) * layerMult;
      const e = spawnEnemy(state, enemyType, spawnHpMult);
      attachSurpriseSpawnTags(state, e, ev, point);
      point.fired = true;
      ev.lastSpawnFiredAt = state.tick;
    }
  }
  // VFX fade-out detection. In override mode this only fires once the wave
  // ends (clearSurpriseEventsForWaveEnd will trigger the fadeout). In legacy
  // mode it fires once all 8 points have drained + the hold window passed.
  if (!ev.waveOverride) {
    const allFired = ev.spawnPoints.every(p => p.fired);
    if (allFired) {
      const fadeStart = ev.lastSpawnFiredAt + VFX_HOLD_AFTER_LAST;
      const fadeEnd = fadeStart + VFX_FADEOUT_SECONDS;
      if (state.tick > fadeEnd && ev.vfxFadeOutAt === 0) {
        ev.vfxFadeOutAt = fadeStart;
      }
    }
  }
}

// Called from WaveManager.tickSpawns in WAVE-OVERRIDE mode to repoint a
// freshly-spawned enemy onto an event spawn location. Picks the spawn
// point via round-robin (queueIdx % 4) so all four fires/urns are active
// throughout the wave. Returns true if the enemy was successfully redirected.
export function spawnAtSurpriseEventPoint(
  state: GameStateShape, enemy: any, queueIdx: number
): boolean {
  const ev = state.activeSurpriseEvent;
  if (!ev || !ev.waveOverride || ev.spawnPoints.length === 0) return false;
  const point = ev.spawnPoints[queueIdx % ev.spawnPoints.length];
  if (!point) return false;
  if (point.pathIndex >= 0 && point.pathIndex < state.groundPath.length) {
    enemy.pathIndex = point.pathIndex;
    enemy.pathProgress = 0;
    const pt = state.groundPath[point.pathIndex];
    enemy.x = pt.col * GRID.TILE + GRID.TILE / 2;
    enemy.y = pt.row * GRID.TILE + GRID.TILE / 2;
    enemy.prevX = enemy.x;
    enemy.prevY = enemy.y;
  }
  attachSurpriseSpawnTags(state, enemy, ev, point);
  point.fired = true;
  ev.lastSpawnFiredAt = state.tick;
  ev.spawnedEnemyIds.add(enemy.id);
  return true;
}

function attachSurpriseSpawnTags(state: GameStateShape, enemy: any, ev: SurpriseEventState, point: SurpriseEventSpawnPoint): void {
  enemy.__surpriseSpawn = true;
  enemy.__surpriseKind = ev.kind === SurpriseEventKind.INVASION ? 'INVASION' : 'UPRISING';
  enemy.__surpriseSpawnVfxX = point.vfxX;
  enemy.__surpriseSpawnVfxY = point.vfxY;
  enemy.__surpriseSpawnTick = state.tick;
}

// Called from WaveManager.checkWaveEnd. Clears any in-flight event state.
export function clearSurpriseEventsForWaveEnd(state: GameStateShape): void {
  if (state.activeSurpriseEvent) {
    state.lastSurpriseEventWave = state.wave;
    state.activeSurpriseEvent = null;
  }
  state.surpriseEventScars = [];
  state.pendingSurpriseReward = null;
}

// ─── INTERNAL: SCHEDULING + POINT GENERATION ──────────────────────────

function scheduleSurpriseEvent(state: GameStateShape, kind: SurpriseEventKind, startAtTick: number, waveOverride: boolean = false) {
  const points = kind === SurpriseEventKind.INVASION
    ? generateInvasionPoints(state, startAtTick, waveOverride)
    : generateUprisingPoints(state, startAtTick, waveOverride);
  if (points.length === 0) return;
  const atmosProps = kind === SurpriseEventKind.INVASION
    ? generateInvasionAtmosphere(state, points)
    : generateUprisingAtmosphere(state, points);
  const ev: SurpriseEventState = {
    kind,
    startedAt: startAtTick,
    spawnPoints: points,
    spawnedEnemyIds: new Set<string>(),
    scarPersistsThroughTick: 0,
    vfxFadeOutAt: 0,
    lastSpawnFiredAt: 0,
    rewardGiven: false,
    atmosProps,
    waveOverride
  };
  state.activeSurpriseEvent = ev;
  state.lastSurpriseEventWave = state.wave;
}

// INVASION atmosphere: 8 small fires scattered along the OUTER edge of
// the playable area. "The empire is besieged" reading — purely cosmetic.
// Never on path tiles, never on towers, never in the HUD button column.
function generateInvasionAtmosphere(state: GameStateShape, mainPoints: SurpriseEventSpawnPoint[]): SurpriseAtmosProp[] {
  const props: SurpriseAtmosProp[] = [];
  const TARGET = 8;
  // Build a candidate pool of valid perimeter tiles (tiles within 2 of
  // any edge, excluding HUD column + path + non-empty tiles).
  const hudSafe = GRID.COLS - 7;
  const candidates: { col: number; row: number }[] = [];
  for (let r = 0; r < GRID.ROWS; r++) {
    for (let c = 0; c < hudSafe; c++) {
      const onEdge = r <= 2 || r >= GRID.ROWS - 3 || c <= 2 || c >= hudSafe - 3;
      if (!onEdge) continue;
      const t = state.tiles[r]?.[c];
      if (t !== TileType.EMPTY) continue;     // skip stones/towers/path/gates
      candidates.push({ col: c, row: r });
    }
  }
  // Don't double up on the main fire breach tiles.
  const mainKeys = new Set(mainPoints.map(p => `${p.pathTileX},${p.pathTileY}`));
  // Shuffle + pick TARGET unique candidates with min separation of 3 tiles.
  shuffleInPlace(candidates);
  const placed: { col: number; row: number }[] = [];
  for (const c of candidates) {
    if (placed.length >= TARGET) break;
    if (mainKeys.has(`${c.col},${c.row}`)) continue;
    let tooClose = false;
    for (const p of placed) {
      if (Math.abs(p.col - c.col) + Math.abs(p.row - c.row) < 3) { tooClose = true; break; }
    }
    if (tooClose) continue;
    placed.push(c);
  }
  for (const p of placed) {
    props.push({
      spriteKey: 'FIRE_SMALL',
      x: p.col * GRID.TILE + GRID.TILE / 2 + (Math.random() - 0.5) * 8,
      y: p.row * GRID.TILE + GRID.TILE / 2 + (Math.random() - 0.5) * 6,
      scale: 0.45 + Math.random() * 0.30,     // 0.45..0.75 — small ambient flames
      rotation: (Math.random() - 0.5) * 0.3,
      flickerSeed: Math.random() * Math.PI * 2,
      kind: 'FIRE'
    });
  }
  return props;
}

// UPRISING atmosphere: scattered ritual blood stains + drifting purple
// smoke haze around the urn diamond. Reinforces the "burial ground /
// ritual circle" reading. Reuses existing BLOOD / SMOKE textures so we
// don't need new sprite assets. All purple-tinted for necrotic tone.
function generateUprisingAtmosphere(state: GameStateShape, mainPoints: SurpriseEventSpawnPoint[]): SurpriseAtmosProp[] {
  const props: SurpriseAtmosProp[] = [];
  // Diamond center: average of the 4 urn positions.
  let cx = 0, cy = 0;
  for (const p of mainPoints) { cx += p.vfxX; cy += p.vfxY; }
  cx /= mainPoints.length;
  cy /= mainPoints.length;
  // 4 blood stains at offset positions inside the 5x5 zone (NOT on the
  // 4 urns themselves). Stain sprites tinted purple-red for necrotic feel.
  const stainOffsets = [
    { dx: -GRID.TILE * 1.2, dy: -GRID.TILE * 1.2 },
    { dx:  GRID.TILE * 1.2, dy: -GRID.TILE * 1.2 },
    { dx: -GRID.TILE * 1.2, dy:  GRID.TILE * 1.2 },
    { dx:  GRID.TILE * 1.2, dy:  GRID.TILE * 1.2 },
  ];
  const STAIN_KEYS = ['BLOOD_HEAVY', 'BLOOD_MEDIUM', 'BLOOD_SATURATED', 'BLOOD_LIGHT'];
  for (let i = 0; i < stainOffsets.length; i++) {
    const o = stainOffsets[i];
    const px = cx + o.dx + (Math.random() - 0.5) * 8;
    const py = cy + o.dy + (Math.random() - 0.5) * 8;
    // Validate the tile is EMPTY — skip stain if the position lands on a
    // tower / path / gate so we don't paint blood ON gameplay elements.
    const tc = Math.floor(px / GRID.TILE);
    const tr = Math.floor(py / GRID.TILE);
    const t = state.tiles[tr]?.[tc];
    if (t !== TileType.EMPTY) continue;
    props.push({
      spriteKey: STAIN_KEYS[i % STAIN_KEYS.length],
      x: px,
      y: py,
      scale: 0.75 + Math.random() * 0.35,
      rotation: Math.random() * Math.PI * 2,
      tint: 0x885aff,        // necrotic purple cast
      flickerSeed: Math.random() * Math.PI * 2,
      kind: 'STAIN'
    });
  }
  // 3 drifting smoke puffs at random positions inside the diamond zone,
  // tinted purple. These animate (slow drift + alpha pulse) in render.
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2 + Math.random() * 0.3;
    const radius = GRID.TILE * (1.4 + Math.random() * 0.6);
    const px = cx + Math.cos(angle) * radius;
    const py = cy + Math.sin(angle) * radius;
    props.push({
      spriteKey: 'SMOKE_PUFF',
      x: px,
      y: py - GRID.TILE * 0.3,
      scale: 0.7 + Math.random() * 0.4,
      rotation: Math.random() * Math.PI * 2,
      tint: 0x9966cc,
      flickerSeed: Math.random() * Math.PI * 2,
      kind: 'HAZE'
    });
  }
  return props;
}

// Fisher-Yates in-place shuffle.
function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// Build the spawn point array for an event. Each visual location
// (pointId 0..3) emits SPAWNS_PER_POINT enemies in succession. The
// returned array has 4 × 2 = 8 entries.
function buildPointsFromLocations(
  locations: { col: number; row: number }[],
  kind: SurpriseEventKind,
  enemyType: string,
  startAtTick: number,
  state: GameStateShape
): SurpriseEventSpawnPoint[] {
  const stagger = INTRA_POINT_STAGGER[kind === SurpriseEventKind.INVASION ? 'INVASION' : 'UPRISING'];
  const out: SurpriseEventSpawnPoint[] = [];
  for (let pIdx = 0; pIdx < locations.length; pIdx++) {
    const pos = locations[pIdx];
    const vfxX = pos.col * GRID.TILE + GRID.TILE / 2;
    const vfxY = pos.row * GRID.TILE + GRID.TILE / 2;
    const nearest = nearestPathIndexAfterWP2(state, pos.col, pos.row);
    const pathTileX = state.groundPath[nearest]?.col ?? pos.col;
    const pathTileY = state.groundPath[nearest]?.row ?? pos.row;
    const baseStart = startAtTick + VFX_RISE_SECONDS + pIdx * INTER_POINT_OFFSET;
    for (let s = 0; s < SPAWNS_PER_POINT; s++) {
      out.push({
        vfxX,
        vfxY,
        pathTileX,
        pathTileY,
        pathIndex: nearest,
        spawnAt: baseStart + s * stagger,
        enemyType,
        fired: false,
        pointId: pIdx
      });
    }
  }
  return out;
}

function generateInvasionPoints(state: GameStateShape, startAtTick: number, waveOverride: boolean): SurpriseEventSpawnPoint[] {
  // 2026-05-17 — Perimeter breach count expanded from 4 → 10 so the
  // invasion reads as a TRUE perimeter assault (enemies coming from
  // many points along every edge) instead of just 4 corners. The wave's
  // spawn queue is round-robin distributed across all 10 points, so
  // each fire spawns ~1-3 enemies depending on wave size — a varied,
  // unpredictable spread instead of clustered single-point streams.
  //
  // Layout: 3 fires along the TOP edge, 3 along the BOTTOM, 2 along
  // the LEFT, 2 along the RIGHT (right edge inset to dodge the HUD
  // button column). Roughly even spacing per side.
  const wallSafeRight = GRID.COLS - 7;
  const topRow = 1;
  const botRow = GRID.ROWS - 2;
  const leftCol = 1;
  // 3 evenly-spaced columns for top/bottom edges
  const colA = Math.floor(wallSafeRight * 0.25);
  const colB = Math.floor(wallSafeRight * 0.50);
  const colC = Math.floor(wallSafeRight * 0.75);
  // 2 evenly-spaced rows for left/right edges
  const rowA = Math.floor(GRID.ROWS * 0.33);
  const rowB = Math.floor(GRID.ROWS * 0.66);
  const locations = [
    // Top edge — 3 breaches
    { col: colA, row: topRow },
    { col: colB, row: topRow },
    { col: colC, row: topRow },
    // Bottom edge — 3 breaches
    { col: colA, row: botRow },
    { col: colB, row: botRow },
    { col: colC, row: botRow },
    // Left edge — 2 breaches
    { col: leftCol, row: rowA },
    { col: leftCol, row: rowB },
    // Right edge — 2 breaches (inset for HUD safety)
    { col: wallSafeRight, row: rowA },
    { col: wallSafeRight, row: rowB },
  ];
  // In waveOverride mode the spawn-timing is driven by the wave queue
  // (not the per-point spawnAt), so we only need 1 entry per point
  // representing the VISUAL location. tickSpawns reads pointId on each
  // queue entry to choose the spawn location.
  if (waveOverride) {
    return locations.map((pos, i) => {
      const vfxX = pos.col * GRID.TILE + GRID.TILE / 2;
      const vfxY = pos.row * GRID.TILE + GRID.TILE / 2;
      const nearest = nearestPathIndexAfterWP2(state, pos.col, pos.row);
      return {
        vfxX, vfxY,
        pathTileX: state.groundPath[nearest]?.col ?? pos.col,
        pathTileY: state.groundPath[nearest]?.row ?? pos.row,
        pathIndex: nearest,
        spawnAt: startAtTick,
        enemyType: '',     // unused in override mode
        fired: false,      // gets repurposed: "has any enemy spawned here this wave"
        pointId: i
      };
    });
  }
  const enemyType = pickSurpriseEnemyType(state, /*undeadOnly=*/false);
  return buildPointsFromLocations(locations, SurpriseEventKind.INVASION, enemyType, startAtTick, state);
}

function generateUprisingPoints(state: GameStateShape, startAtTick: number, waveOverride: boolean): SurpriseEventSpawnPoint[] {
  // Center-of-map diamond. Anchor at map center ± jitter. Urns at
  // radius 2 (N/S/E/W of center).
  const midCol = Math.floor(GRID.COLS / 2);
  const midRow = Math.floor(GRID.ROWS / 2);
  const jitterC = Math.floor(Math.random() * 3) - 1;
  const jitterR = Math.floor(Math.random() * 3) - 1;
  const cx = midCol + jitterC;
  const cy = midRow + jitterR;
  const locations = [
    { col: cx, row: cy - 2 },
    { col: cx, row: cy + 2 },
    { col: cx - 2, row: cy },
    { col: cx + 2, row: cy },
  ];
  if (waveOverride) {
    return locations.map((pos, i) => {
      const vfxX = pos.col * GRID.TILE + GRID.TILE / 2;
      const vfxY = pos.row * GRID.TILE + GRID.TILE / 2;
      const nearest = nearestPathIndexAfterWP2(state, pos.col, pos.row);
      return {
        vfxX, vfxY,
        pathTileX: state.groundPath[nearest]?.col ?? pos.col,
        pathTileY: state.groundPath[nearest]?.row ?? pos.row,
        pathIndex: nearest,
        spawnAt: startAtTick,
        enemyType: '',
        fired: false,
        pointId: i
      };
    });
  }
  const enemyType = pickSurpriseEnemyType(state, /*undeadOnly=*/true);
  return buildPointsFromLocations(locations, SurpriseEventKind.UPRISING, enemyType, startAtTick, state);
}

function pickSurpriseEnemyType(state: GameStateShape, undeadOnly: boolean): string {
  const wIdx = Math.max(0, Math.min(wavesData.length - 1, state.wave - 1));
  const w = wavesData[wIdx];
  const candidates: string[] = [];
  for (const grp of w.spawns) {
    const def: any = (enemiesData as any)[grp.type];
    if (!def) continue;
    if (def.isBoss) continue;
    if (def.isFlyer) continue;
    if (undeadOnly) {
      const fac = (def.faction ?? '').toString();
      if (fac !== 'UNDEAD_CELTS' && fac !== 'UNDEAD_CARTHAGE') continue;
    }
    candidates.push(grp.type);
  }
  if (candidates.length === 0) {
    return undeadOnly ? EnemyType.UNDEAD_CELT : EnemyType.CARTHAGE_SPEARMAN;
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// 2026-05-17 — Surprise events (Invasion + Skeletal Uprising) drop
// enemies onto the path AT OR AFTER waypoint 3. Per design: the breach
// arrivals SKIP waypoints 1 + 2 (they didn't walk from the cave) but
// must still touch waypoints 3, 4, 5, 6, 7 in order before reaching
// the gate. This guarantees the maze still pressures them through
// the back half of the path — single-tile chokes at WP3-7 still work,
// and the player's late-stage tower placements still see them.
//
// Cached on first access because the path doesn't change after build.
let _wp3PathIndex: number | null = null;
function getMinSurprisePathIndex(state: GameStateShape): number {
  if (_wp3PathIndex !== null && state.groundPath.length > 0) return _wp3PathIndex;
  // Find WP2's path index — the tile on the path closest to WP2.
  // Spawning AT OR JUST AFTER WP2 means the enemy still has WP3-7 ahead.
  const wp2 = (waypointsData as any).waypoints.find((w: any) => w.index === 2);
  if (!wp2) { _wp3PathIndex = 0; return 0; }
  let bestIdx = 0;
  let bestD = Infinity;
  for (let i = 0; i < state.groundPath.length; i++) {
    const p = state.groundPath[i];
    const d = Math.abs(p.col - wp2.topLeft.col) + Math.abs(p.row - wp2.topLeft.row);
    if (d < bestD) { bestD = d; bestIdx = i; }
  }
  // Step one tile PAST WP2 so the spawn doesn't accidentally trigger
  // a "crossed WP2" event (relevant for the checkpoint-heal mechanic).
  // Cap at path-length-1 in case WP2 is the last tile (it isn't, but
  // defensive).
  _wp3PathIndex = Math.min(state.groundPath.length - 1, bestIdx + 1);
  return _wp3PathIndex;
}

// Variant of nearestPathIndex that clamps the result so the enemy can
// never spawn BEFORE waypoint 3. The result is always >= getMinSurprisePathIndex.
// Used by the surprise-event spawn-snap so Invasion/Uprising enemies
// skip WP1+WP2 but still walk WP3-7 in order.
function nearestPathIndexAfterWP2(state: GameStateShape, col: number, row: number): number {
  const minIdx = getMinSurprisePathIndex(state);
  let best = minIdx;
  let bestD = Infinity;
  for (let i = minIdx; i < state.groundPath.length; i++) {
    const p = state.groundPath[i];
    const d = Math.abs(p.col - col) + Math.abs(p.row - row);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

export function isSurpriseEventActive(state: GameStateShape): boolean {
  const ev = state.activeSurpriseEvent;
  if (!ev) return false;
  return ev.vfxFadeOutAt === 0 || state.tick < ev.vfxFadeOutAt + VFX_FADEOUT_SECONDS;
}

// Screen tint envelope: trapezoid from event start through last-spawn +
// fade window. Returns null when no tint should paint.
export function surpriseEventTintRGBA(state: GameStateShape): { r: number; g: number; b: number; a: number } | null {
  const ev = state.activeSurpriseEvent;
  if (!ev) return null;
  const elapsed = state.tick - ev.startedAt;
  if (elapsed < 0) return null;
  let alpha = 0.22;
  // Fade-in across the rise window.
  if (elapsed < VFX_RISE_SECONDS) alpha = 0.22 * (elapsed / VFX_RISE_SECONDS);
  // Fade-out after vfxFadeOutAt is set.
  if (ev.vfxFadeOutAt > 0) {
    const fadeProgress = (state.tick - ev.vfxFadeOutAt) / VFX_FADEOUT_SECONDS;
    if (fadeProgress >= 1) return null;
    alpha = 0.22 * Math.max(0, 1 - fadeProgress);
  }
  if (alpha <= 0.001) return null;
  if (ev.kind === SurpriseEventKind.INVASION) {
    // Warm red-orange fire tint.
    return { r: 0.85, g: 0.15, b: 0.05, a: alpha };
  } else {
    // Sickly green-purple necrotic tint.
    return { r: 0.35, g: 0.05, b: 0.55, a: alpha };
  }
}

// Renderer helpers (exported for drawSurpriseEvents) — keep the
// timing constants here, single source of truth.
export const VFX_TIMING = {
  RISE_SECONDS: VFX_RISE_SECONDS,
  HOLD_AFTER_LAST: VFX_HOLD_AFTER_LAST,
  FADEOUT_SECONDS: VFX_FADEOUT_SECONDS,
  INTRA_POINT_STAGGER,
} as const;
