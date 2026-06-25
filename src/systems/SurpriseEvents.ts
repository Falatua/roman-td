// SurpriseEvents — 2026-05-16 mid-wave ambient events. v2 polish pass.
//
// Two flavors:
//   • INVASION: 4 perimeter FIRE BREACHES (N/S/E/W edges). Each fire
//     spits TWO enemies in quick succession that "teleport in" (cyan
//     fade-in + ghost tint) and snap to the nearest path tile.
//   • UPRISING: ONE skull urn rises from the EXACT center tile of the
//     map (2026-05-20: was a 4-urn diamond). The undead pour from
//     that single mass-grave point in bursts of four, "rising from
//     the ground" (y-offset fade-up + dust kick). Only fires on
//     undead waves.
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

// Fixed trigger schedule for the 30-wave campaign. All non-boss, non-flyer
// waves. Cooldown ≥3 waves (W14→W16 is 2 apart, but GATES_OF_HELL is
// special: it doesn't override the wave's normal spawn flow, so the
// cooldown rule is relaxed for it specifically).
//   W7  — Invasion (CARTHAGE faction)
//   W11 — Uprising (UNDEAD_CELTS)
//   W14 — Uprising (UNDEAD_CELTS)
//   W16 — Gates of Hell (SUPER_DEMONS) — destructible gates at WP3/WP4
//         pump out fire giants for 15s. Player can shut them down by
//         destroying the gates. Bridges the undead → demon faction
//         transition heading into W20.
//   W18 — Invasion (UNDEAD_CARTHAGE)
export const SURPRISE_EVENT_SCHEDULE: Record<number, SurpriseEventKind> = {
  7:  SurpriseEventKind.INVASION,
  11: SurpriseEventKind.UPRISING,
  14: SurpriseEventKind.UPRISING,
  16: SurpriseEventKind.GATES_OF_HELL,
  18: SurpriseEventKind.INVASION,
};

// ─── GATES OF HELL TUNING ─────────────────────────────────────────────
// 2-second cadence per gate, alternating phases so the player sees a
// new fire giant pop out every second. 15-second window total. After
// that the gates auto-seal (no more spawns) regardless of whether the
// player destroyed them. Already-spawned giants persist normally and
// the wave still has to clear them.
// 2026-05-22 V37 — Window 15s → 20s per user direction ("Hell Gate
// should close after 20 seconds"). The Hell Gate now stays active
// for a full 20s of spawn cadence before auto-sealing. Combined
// with the 300K HP bump in enemies.json, players who want to break
// the gate before timeout need a serious damage commitment — but
// they have 5 extra seconds to do it.
const GATES_OF_HELL_WINDOW_SECONDS = 20;
const GATES_OF_HELL_CADENCE_SECONDS = 2;

// v2 spawn tuning. Each of the 4 visual points (fire or urn) spawns
// TWO enemies. Total enemies per event = 8 (still feels surprising
// without overwhelming the wave already in motion).
const SPAWNS_PER_POINT = 2;
const POINT_COUNT = 4;
// Stagger between consecutive spawns AT THE SAME point. 2026-05-18:
// Invasion cadence tightened HARD (0.35 → 0.18s) so 18 perimeter fires
// each pumping enemies = a wall of incoming threats. Uprising kept at
// 0.30s — undead waves are about pressure, not velocity.
const INTRA_POINT_STAGGER = { INVASION: 0.18, UPRISING: 0.30 };
// Offset added between consecutive POINTS so all 4 don't fire at the
// same tick. Tightened 0.3 → 0.15 to keep the multi-point burst tight.
const INTER_POINT_OFFSET = 0.15;
// Lead-in: how long the fire/urn sprite breathes ALIVE on-screen before
// its FIRST enemy spawns. Shortened 0.55 → 0.30 so enemies start
// emerging almost immediately after the sting.
const VFX_RISE_SECONDS = 0.30;
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
  // 2026-05-17 — Cooldown rule relaxed for GATES_OF_HELL since it doesn't
  // override the wave's normal spawn flow. The other two event kinds
  // would feel oppressive back-to-back; gates run in parallel with the
  // wave's regular enemies so the player can still focus-fire normally.
  if (kind !== SurpriseEventKind.GATES_OF_HELL && state.wave - lastWave < 3) return;
  // GATES_OF_HELL uses waveOverride=false (its spawns are EXTRA, not
  // a replacement for the wave queue). Invasion/Uprising stay on the
  // existing waveOverride=true path so back-compat holds.
  const waveOverride = kind !== SurpriseEventKind.GATES_OF_HELL;
  scheduleSurpriseEvent(state, kind, state.tick + 0.5, waveOverride);
  // 2026-05-19 — INVASION = SIMULTANEOUS BURST. Once the event is
  // scheduled, collapse every queued non-boss spawn's spawnAt to the
  // same instant so all invaders emerge from the perimeter at once
  // (after the brief fire rise-in). Bosses (rare on invasion waves
  // but defensive) keep their original schedule.
  if (kind === SurpriseEventKind.INVASION && state.activeSurpriseEvent?.waveOverride) {
    flattenInvasionSpawnSchedule(state);
  }
  // 2026-05-19 — UPRISING = CLUSTER BURSTS. Each urn erupts a group of
  // skeletons together (5-6 at a time over ~0.4s) then pauses 1.0s
  // before the next cluster. Visually reads as "a collection of bone-
  // risers pouring out of each urn" — the user's exact ask. Without
  // this, the wave queue's 0.6s SPAWN_INTERVAL produced a slow
  // single-file trickle that didn't look like a true uprising.
  if (kind === SurpriseEventKind.UPRISING && state.activeSurpriseEvent?.waveOverride) {
    clusterUprisingSpawnSchedule(state);
  }
}

// Called right after an INVASION event is scheduled in waveOverride
// mode. Pins every non-boss spawn's spawnAt to a single instant
// (VFX_RISE_SECONDS into the wave) so the WaveManager.tickSpawns
// loop drains the entire wave queue in one frame. Result: every
// invader emerges from its assigned perimeter fire at the same time.
function flattenInvasionSpawnSchedule(state: GameStateShape): void {
  const burstAt = VFX_RISE_SECONDS;
  for (const item of state.spawnQueue) {
    const isBossSpawn = !!(enemiesData as any)[item.type]?.isBoss;
    if (isBossSpawn) continue;
    item.spawnAt = burstAt;
  }
}

// 2026-05-19 (REDESIGNED) — Uprising spawns from ALL 4 urns
// SIMULTANEOUSLY each burst. Previous version dumped 6 enemies from
// one urn before moving to the next; player only saw one urn active
// at a time. New design: each "wave" of the uprising is 4 enemies
// — one from each urn at the same instant — followed by a 1s pause,
// repeat until the queue drains.
//
// Naming: UPRISING_BURST_SIZE = 4 (one per urn). Kept the
// UPRISING_CLUSTER_SIZE alias for back-compat with any tests/imports
// that might reference it, but the semantic shifted.
export const UPRISING_CLUSTER_SIZE = 4;        // one enemy per urn per burst
const UPRISING_INTER_BURST_GAP = 1.0;          // 1s pause between bursts

// Reshape the spawn queue's timing: 4 consecutive non-boss entries
// share the same spawnAt (so they emerge from all 4 urns at once),
// then a 1s gap before the next burst of 4.
function clusterUprisingSpawnSchedule(state: GameStateShape): void {
  let burstTime = VFX_RISE_SECONDS;
  let inBurstIdx = 0;
  for (const item of state.spawnQueue) {
    const isBossSpawn = !!(enemiesData as any)[item.type]?.isBoss;
    if (isBossSpawn) continue;
    item.spawnAt = burstTime;        // every enemy in this burst shares the timestamp
    inBurstIdx++;
    if (inBurstIdx >= UPRISING_CLUSTER_SIZE) {
      burstTime += UPRISING_INTER_BURST_GAP;
      inBurstIdx = 0;
    }
  }
}

// Endless-mode trigger. ~25% base chance per endless wave with 3-wave
// cooldown for the FIRST event. 2026-05-18 — once the primary fires,
// roll for 1-2 ADDITIONAL stacked events ("Endless is pure chaos" per
// design ask). Stacked events get pushed to state.extraSurpriseEvents
// and live alongside the primary; the renderer, tick loop, and spawn
// flow all iterate primary + extras together.
//
// Stack chances (independent rolls, gated by "primary already fired"):
//   • 40% chance to add a SECOND event of a different kind
//   • If a second was added, 25% chance to add a THIRD of a third kind
//
// Each extra event is scheduled at a tick OFFSET (0.6s and 1.2s after
// the primary) so the visual / audio impact staggers instead of
// landing all at once — keeps the perf hit smooth and the player can
// process each one. Extras NEVER override the wave queue — only the
// primary gets waveOverride=true. Extras run as ADDITIONAL spawn
// sources (legacy-path schedule), same model GATES_OF_HELL uses on
// the campaign W16.
export function maybeTriggerEndlessSurpriseEvent(state: GameStateShape, factionKey: string): void {
  const lastWave = state.lastSurpriseEventWave ?? 0;
  const endlessWaveNum = (state.endlessWave ?? 1) + 20;
  // 2026-05-20 — cooldown 3 → 2 waves, fire chance 25% → 75%. User
  // direction: Endless should feel like a perpetual invasion from
  // the outskirts, not a cave defense with the occasional surprise.
  // Two-wave cooldown still guarantees one quiet recovery wave after
  // each chaotic event so the player can rebuild without two stacked
  // chaos waves in a row.
  if (endlessWaveNum - lastWave < 2) return;
  if (Math.random() > 0.75) return;
  const isUndeadFaction = factionKey === 'UNDEAD_CELTS' || factionKey === 'UNDEAD_CARTHAGE';
  // Pick the primary event kind (existing 50/50 invasion-vs-uprising
  // on undead waves, invasion-only on non-undead).
  const primary = isUndeadFaction && Math.random() < 0.5 ? SurpriseEventKind.UPRISING : SurpriseEventKind.INVASION;
  // Endless mode also uses waveOverride — full perimeter / center spawn flow.
  scheduleSurpriseEvent(state, primary, state.tick + 0.5, /*waveOverride=*/true);
  // ─── Stack rolls ─────────────────────────────────────────────────
  // Pool of OTHER kinds (different from primary) to draw from.
  const allKinds: SurpriseEventKind[] = [
    SurpriseEventKind.INVASION,
    SurpriseEventKind.UPRISING,
    SurpriseEventKind.GATES_OF_HELL
  ];
  const others = allKinds.filter(k => k !== primary);
  // Shuffle the "others" pool so each stack pick is random.
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  // Second event: 40% chance.
  if (Math.random() < 0.40 && others.length > 0) {
    const second = others.shift()!;
    scheduleExtraSurpriseEvent(state, second, state.tick + 1.1);
    // Third event: 25% chance only if a second was added.
    if (Math.random() < 0.25 && others.length > 0) {
      const third = others.shift()!;
      scheduleExtraSurpriseEvent(state, third, state.tick + 1.7);
    }
  }
}

// Return primary + all extras as a flat array. Consumers iterate this
// instead of the single field so endless-mode stacking just works.
export function getAllActiveSurpriseEvents(state: GameStateShape): SurpriseEventState[] {
  const out: SurpriseEventState[] = [];
  if (state.activeSurpriseEvent) out.push(state.activeSurpriseEvent);
  if (state.extraSurpriseEvents && state.extraSurpriseEvents.length > 0) {
    for (const ev of state.extraSurpriseEvents) out.push(ev);
  }
  return out;
}

// Schedule an EXTRA stacked event. Same generators + atmosphere as the
// primary path, just pushed to extraSurpriseEvents instead of
// overwriting activeSurpriseEvent. Always waveOverride=false (only
// the primary gets to reroute the wave's spawn queue).
function scheduleExtraSurpriseEvent(state: GameStateShape, kind: SurpriseEventKind, startAtTick: number): void {
  let points: SurpriseEventSpawnPoint[];
  let atmosProps: SurpriseAtmosProp[];
  if (kind === SurpriseEventKind.INVASION) {
    points = generateInvasionPoints(state, startAtTick, /*waveOverride=*/false);
    atmosProps = generateInvasionAtmosphere(state, points);
  } else if (kind === SurpriseEventKind.UPRISING) {
    points = generateUprisingPoints(state, startAtTick, /*waveOverride=*/false);
    atmosProps = generateUprisingAtmosphere(state, points);
  } else {
    points = generateGatesOfHellPoints(state, startAtTick);
    atmosProps = generateGatesOfHellAtmosphere(state, points);
  }
  if (points.length === 0) return;
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
    waveOverride: false
  };
  if (!state.extraSurpriseEvents) state.extraSurpriseEvents = [];
  state.extraSurpriseEvents.push(ev);
}

// Called when an enemy dies or leaks. Fires the reward modal trigger
// the MOMENT the last event-spawned enemy resolves AND the spawn schedule
// has fully drained — i.e. the moment the player kills the last enemy
// of an invasion / uprising wave. Works in both waveOverride and legacy
// modes; the schedule-empty check (no more pending spawns) ensures we
// don't fire prematurely mid-wave.
export function notifySurpriseEnemyResolved(state: GameStateShape, enemyId: string): void {
  // 2026-05-18 — Iterate primary + extras. Each event tracks its own
  // spawnedEnemyIds, so an enemy belongs to at most one event. The
  // matching event's reward gate fires when its own spawn schedule
  // drains, independent of the others. In endless this means stacked
  // events each award their own reward as they resolve.
  for (const ev of getAllActiveSurpriseEvents(state)) {
    if (ev.rewardGiven) continue;
    if (!ev.spawnedEnemyIds.has(enemyId)) continue;
    ev.spawnedEnemyIds.delete(enemyId);
    const allFired = ev.spawnPoints.every(p => p.fired);
    const spawnQueueEmpty = !ev.waveOverride || state.spawnQueue.length === 0;
    if (allFired && spawnQueueEmpty && ev.spawnedEnemyIds.size === 0) {
      if (state.lives <= 0) return;     // dead player gets no reward
      ev.endedAt = state.tick;
      ev.rewardGiven = true;
      // Queue the reward only if none is already pending (one modal
      // at a time). Subsequent events keep their rewardGiven flag so
      // they don't re-queue; the player gets one modal per surviving
      // event, processed in the order they resolved.
      if (!state.pendingSurpriseReward) {
        state.pendingSurpriseReward = {
          kind: ev.kind === SurpriseEventKind.INVASION ? 'INVASION'
              : ev.kind === SurpriseEventKind.UPRISING ? 'UPRISING'
              : 'GATES_OF_HELL'
        };
      } else {
        // A reward is already queued — bank this one so the next-modal-
        // closes path can pick it up.
        if (!state.queuedSurpriseRewards) state.queuedSurpriseRewards = [];
        state.queuedSurpriseRewards.push({
          kind: ev.kind === SurpriseEventKind.INVASION ? 'INVASION'
              : ev.kind === SurpriseEventKind.UPRISING ? 'UPRISING'
              : 'GATES_OF_HELL'
        });
      }
      state.surpriseEventsCompleted = (state.surpriseEventsCompleted ?? 0) + 1;
      if (ev.vfxFadeOutAt === 0) ev.vfxFadeOutAt = state.tick;
      return;     // Only one event resolves per enemy (no cross-event leakage).
    }
    return;       // Enemy belonged to this event; stop searching.
  }
}

// Called from WaveManager.checkWaveEnd when a wave ends. If the wave had an
// active waveOverride surprise event AND the player is still alive, fires
// the reward modal trigger. Player gets to pick their accomplishment reward.
export function notifySurpriseEventWaveEnded(state: GameStateShape): void {
  // 2026-05-18 — Also iterate extras. Each waveOverride event fires
  // its own reward at wave-end (only the primary is waveOverride in
  // endless, but extras still get their non-override reward path
  // through notifySurpriseEnemyResolved). Here we only handle the
  // primary's wave-override case for back-compat.
  const ev = state.activeSurpriseEvent;
  if (!ev || !ev.waveOverride || ev.rewardGiven) return;
  if (state.lives <= 0) return;     // dead player gets no reward
  ev.endedAt = state.tick;
  ev.rewardGiven = true;
  state.pendingSurpriseReward = {
    kind: ev.kind === SurpriseEventKind.INVASION ? 'INVASION'
        : ev.kind === SurpriseEventKind.UPRISING ? 'UPRISING'
        : 'GATES_OF_HELL'
  };
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
  // 2026-05-18 — Iterate primary + extras. Each event runs its own
  // spawn schedule independently. In endless this is how stacked
  // events pump out enemies in parallel without stepping on each
  // other.
  for (const ev of getAllActiveSurpriseEvents(state)) {
    tickSingleSurpriseEvent(state, ev);
  }
}

function tickSingleSurpriseEvent(state: GameStateShape, ev: SurpriseEventState): void {
  if (!ev.waveOverride) {
    // Legacy path: drain the fixed schedule. Active for GATES_OF_HELL,
    // which uses waveOverride=false so its 2 gates + 15 fire giants
    // spawn on a custom 2s alternating cadence rather than rerouting
    // the wave's normal spawn queue.
    for (const point of ev.spawnPoints) {
      if (point.fired) continue;
      if (state.tick < point.spawnAt) continue;
      // 2026-05-17 — GATE-DEATH DEQUEUE. If the gate at this pointId is
      // already destroyed (marked via __gateDestroyed flag on the
      // event), skip spawns from that point. The remaining schedule
      // entries get flagged fired=true so they drain cleanly.
      const destroyed = (ev as any).__destroyedPointIds as Set<number> | undefined;
      if (destroyed && destroyed.has(point.pointId) && point.enemyType === 'FIRE_GIANT') {
        point.fired = true;
        continue;
      }
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
      // Reposition the spawn onto the event's path index. For
      // HELL_GATE this also pins the position (speed 0 means it stays
      // there); for FIRE_GIANT it sets the starting waypoint so the
      // giant walks WP3-7 or WP4-7 depending on which gate spawned it.
      if (point.pathIndex >= 0 && point.pathIndex < state.groundPath.length) {
        e.pathIndex = point.pathIndex;
        e.pathProgress = 0;
        const pt = state.groundPath[point.pathIndex];
        e.x = pt.col * GRID.TILE + GRID.TILE / 2;
        e.y = pt.row * GRID.TILE + GRID.TILE / 2;
        e.prevX = e.x;
        e.prevY = e.y;
      }
      attachSurpriseSpawnTags(state, e, ev, point);
      ev.spawnedEnemyIds.add(e.id);
      point.fired = true;
      ev.lastSpawnFiredAt = state.tick;
    }

    // 2026-05-17 — GATES OF HELL auto-seal. After the 15s window
    // expires, any HELL_GATE that's still alive self-destructs (sets
    // hp to 0). The normal enemy-death handler then runs: dequeues
    // remaining fire-giant spawns from that gate's queue, triggers
    // the shatter VFX, removes the gate from the enemy pool. Player
    // can still ignore the event and survive; the wave just won't
    // hang waiting on the gates to be killed.
    if (ev.kind === SurpriseEventKind.GATES_OF_HELL) {
      const sealTick = ev.startedAt + VFX_RISE_SECONDS + GATES_OF_HELL_WINDOW_SECONDS + GATES_OF_HELL_CADENCE_SECONDS;
      if (state.tick > sealTick) {
        for (const e of state.enemies.values()) {
          if (e.type === 'HELL_GATE' && e.hp > 0) {
            e.hp = 0;
          }
        }
      }
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
// freshly-spawned enemy onto an event spawn location.
//
// 2026-05-19 — INVASION = TRUE PERIMETER SPAWN. Each enemy is positioned
// at its OWN unique perimeter tile (point.vfxX / point.vfxY) at spawn
// time. The enemy then enters APPROACH MODE: it walks straight from
// its perimeter tile to the path-entry tile (WP3) where it joins the
// normal ground path. EnemySystem reads `__approachActive` + the
// target coords and overrides the path-follow loop until the enemy
// reaches the join point. Result: 30+ enemies materialize across all
// four edges of the map simultaneously, each on its own tile, then
// converge on the maze. UPRISING and other kinds keep the original
// snap-to-path behavior since their spawn is center-of-map (urns) and
// the visual already reads correctly.
export function spawnAtSurpriseEventPoint(
  state: GameStateShape, enemy: any, queueIdx: number
): boolean {
  const ev = state.activeSurpriseEvent;
  if (!ev || !ev.waveOverride || ev.spawnPoints.length === 0) return false;
  // 2026-05-19 — Belt-and-suspenders: refuse to redirect flyers. The
  // call site in WaveManager.tickSpawns already guards on isFlyerSpawn,
  // but if a future caller forgets, doing the redirect would set a
  // ground-path pathIndex that the flyer-path-follow loop misreads as
  // "past the gate" → instant leak on spawn. W14 (Uprising + 8
  // SPECTRAL_SCOUTs) hit this in the wild before the call-site guard
  // was added. The function now refuses to corrupt flyer state.
  if (enemy?.isFlyer) return false;
  // 2026-05-19 (REDESIGNED) — Routing strategy:
  //   • INVASION: each enemy gets its OWN unique perimeter tile
  //     (queueIdx % spawnPoints.length).
  //   • UPRISING: each BURST of 4 enemies fills all 4 urns
  //     simultaneously. queueIdx % 4 gives the urn assignment, and
  //     the spawn-schedule reshaper above ensures each block of 4
  //     consecutive enemies shares the same spawnAt. Result: every
  //     burst is a synchronized 4-urn eruption, exactly what the
  //     player asked for (no more "only one urn active").
  const pointIdx = queueIdx % ev.spawnPoints.length;
  const point = ev.spawnPoints[pointIdx];
  if (!point) return false;
  const isInvasion = ev.kind === SurpriseEventKind.INVASION;
  const isUprising = ev.kind === SurpriseEventKind.UPRISING;
  if (point.pathIndex >= 0 && point.pathIndex < state.groundPath.length) {
    enemy.pathIndex = point.pathIndex;
    enemy.pathProgress = 0;
    const pt = state.groundPath[point.pathIndex];
    const pathTileX = pt.col * GRID.TILE + GRID.TILE / 2;
    const pathTileY = pt.row * GRID.TILE + GRID.TILE / 2;
    if (isInvasion || isUprising) {
      // 2026-05-22 — Uprising joins Invasion in using approach mode.
      // Enemy spawns at the urn / fire-breach (point.vfxX/vfxY) — for
      // Uprising that's the center-tile skull urn — and walks straight
      // to the path-entry tile so the player visibly sees them
      // "pour out of the urn" before joining the maze.
      // EnemySystem reads __approachActive + the target coords and
      // overrides path-follow until the enemy reaches the target.
      enemy.x = point.vfxX;
      enemy.y = point.vfxY;
      enemy.prevX = enemy.x;
      enemy.prevY = enemy.y;
      (enemy as any).__approachActive = true;
      (enemy as any).__approachTargetX = pathTileX;
      (enemy as any).__approachTargetY = pathTileY;
    } else {
      // Future event kinds: original snap-to-path behavior.
      enemy.x = pathTileX;
      enemy.y = pathTileY;
      enemy.prevX = enemy.x;
      enemy.prevY = enemy.y;
    }
  }
  attachSurpriseSpawnTags(state, enemy, ev, point);
  point.fired = true;
  ev.lastSpawnFiredAt = state.tick;
  ev.spawnedEnemyIds.add(enemy.id);
  return true;
}

function attachSurpriseSpawnTags(state: GameStateShape, enemy: any, ev: SurpriseEventState, point: SurpriseEventSpawnPoint): void {
  enemy.__surpriseSpawn = true;
  enemy.__surpriseKind = ev.kind === SurpriseEventKind.INVASION ? 'INVASION'
    : ev.kind === SurpriseEventKind.UPRISING ? 'UPRISING'
    : 'GATES_OF_HELL';
  enemy.__surpriseSpawnVfxX = point.vfxX;
  enemy.__surpriseSpawnVfxY = point.vfxY;
  enemy.__surpriseSpawnTick = state.tick;
  // Carry the pointId so the gate-destruction handler can flag the
  // matching spawn schedule entries when this enemy dies.
  enemy.__surprisePointId = point.pointId;
  // 2026-05-18 — INVASION AGGRESSION BUFF. Every invader gains +25%
  // base speed to sell the "frenzied breach" feel. They run at the
  // gate instead of plodding — the player has less time to redirect
  // tower fire after the breach lights up. HP intentionally kept at
  // baseline so the wave-preview HP numbers still match what spawns
  // (the preview-parity tests would break if we touched maxHp here).
  if (ev.kind === SurpriseEventKind.INVASION) {
    enemy.baseSpeed *= 1.25;
    enemy.currentSpeed = enemy.baseSpeed;
  }
}

// 2026-05-17 — Called from the death-handling code when a HELL_GATE
// enemy dies. Marks the matching pointId as destroyed so future
// fire-giant spawns from that gate get skipped (the gate's been
// breached, no more demons can come through). The OTHER gate keeps
// spawning on its schedule until the player breaks it too OR the 15s
// window expires.
export function notifyHellGateDestroyed(state: GameStateShape, pointId: number): void {
  const ev = state.activeSurpriseEvent;
  if (!ev || ev.kind !== SurpriseEventKind.GATES_OF_HELL) return;
  const evAny = ev as any;
  if (!evAny.__destroyedPointIds) evAny.__destroyedPointIds = new Set<number>();
  evAny.__destroyedPointIds.add(pointId);
}

// Called from WaveManager.checkWaveEnd. Clears any in-flight event state.
export function clearSurpriseEventsForWaveEnd(state: GameStateShape): void {
  if (state.activeSurpriseEvent || (state.extraSurpriseEvents && state.extraSurpriseEvents.length > 0)) {
    state.lastSurpriseEventWave = state.wave;
    state.activeSurpriseEvent = null;
    state.extraSurpriseEvents = [];
  }
  state.surpriseEventScars = [];
  state.pendingSurpriseReward = null;
}

// ─── INTERNAL: SCHEDULING + POINT GENERATION ──────────────────────────

function scheduleSurpriseEvent(state: GameStateShape, kind: SurpriseEventKind, startAtTick: number, waveOverride: boolean = false) {
  let points: SurpriseEventSpawnPoint[];
  let atmosProps: SurpriseAtmosProp[];
  if (kind === SurpriseEventKind.INVASION) {
    points = generateInvasionPoints(state, startAtTick, waveOverride);
    atmosProps = generateInvasionAtmosphere(state, points);
  } else if (kind === SurpriseEventKind.UPRISING) {
    points = generateUprisingPoints(state, startAtTick, waveOverride);
    atmosProps = generateUprisingAtmosphere(state, points);
  } else {
    // GATES_OF_HELL
    points = generateGatesOfHellPoints(state, startAtTick);
    atmosProps = generateGatesOfHellAtmosphere(state, points);
  }
  if (points.length === 0) return;
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

// INVASION atmosphere: small fires scattered along the OUTER edge of
// the playable area. "The empire is besieged" reading — purely cosmetic.
// Never on path tiles, never on towers, never in the HUD button column.
// 2026-05-18 — Doubled the count (8 → 16) so the perimeter glow reads
// as a TRUE city-under-siege, matching the 18 breach fires from the
// main spawn-point pass.
function generateInvasionAtmosphere(state: GameStateShape, mainPoints: SurpriseEventSpawnPoint[]): SurpriseAtmosProp[] {
  const props: SurpriseAtmosProp[] = [];
  const TARGET = 16;
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
//
// 2026-05-21 — More visuals pass. Adds 4 satellite urn props at the
// cardinal compass points around the (single, center-tile) spawn urn
// so the wave reads as a graveyard ritual rather than one lonely urn.
// The satellites are PURELY DECORATIVE — they don't carry spawn
// points or path indices, just SKULL_URN sprites tinted darker than
// the center so the player's eye still tracks the bright center as
// the actual mass-grave point.
function generateUprisingAtmosphere(state: GameStateShape, mainPoints: SurpriseEventSpawnPoint[]): SurpriseAtmosProp[] {
  const props: SurpriseAtmosProp[] = [];
  // Diamond center: average of the 4 urn positions (the 4 positions
  // are now collapsed to the same center tile per the W11 polish, so
  // the average is just that tile).
  let cx = 0, cy = 0;
  for (const p of mainPoints) { cx += p.vfxX; cy += p.vfxY; }
  cx /= mainPoints.length;
  cy /= mainPoints.length;

  // ─── 4 satellite urns at NSEW cardinal points, ~2 tiles out ──────
  // Visual-only props that establish a ritual ring around the spawn
  // urn. Each is tinted darker (necrotic purple shadow) so the center
  // urn (drawn full-bright by the renderer's surprise-event pass)
  // stays the visual focus. Skip a satellite if the candidate tile is
  // path/tower so we never overlap a gameplay tile.
  const SAT_OFFSETS: Array<{ dx: number; dy: number; angle: number }> = [
    { dx:  0, dy: -2, angle: 0 },              // north
    { dx:  2, dy:  0, angle: 0 },              // east
    { dx:  0, dy:  2, angle: 0 },              // south
    { dx: -2, dy:  0, angle: 0 }               // west
  ];
  for (const off of SAT_OFFSETS) {
    const sx = cx + off.dx * GRID.TILE;
    const sy = cy + off.dy * GRID.TILE;
    const tc = Math.floor(sx / GRID.TILE);
    const tr = Math.floor(sy / GRID.TILE);
    const t = state.tiles[tr]?.[tc];
    if (t !== TileType.EMPTY) continue;
    props.push({
      spriteKey: 'SKULL_URN',
      x: sx,
      y: sy,
      scale: 0.55 + Math.random() * 0.10,      // smaller than the spawn urn
      rotation: (Math.random() - 0.5) * 0.30,
      tint: 0x5a3a8a,                          // darker necrotic-purple
      flickerSeed: Math.random() * Math.PI * 2,
      kind: 'HAZE'                             // 'HAZE' kind so the renderer ticks them like the smoke layer; visual-only
    });
  }

  // ─── 6 scattered bone shards as ground litter ────────────────────
  // Re-uses BLOOD_LIGHT keyed sprite with bone-tan tint so we don't
  // ship a new asset. Smaller scale + lower alpha so they read as
  // bone fragments / ritual debris rather than blood pools.
  const BONE_TILE_RADIUS_MIN = 1.4;
  const BONE_TILE_RADIUS_MAX = 2.6;
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + Math.random() * 0.6;
    const radius = GRID.TILE * (BONE_TILE_RADIUS_MIN + Math.random() * (BONE_TILE_RADIUS_MAX - BONE_TILE_RADIUS_MIN));
    const bx = cx + Math.cos(angle) * radius;
    const by = cy + Math.sin(angle) * radius;
    const tc = Math.floor(bx / GRID.TILE);
    const tr = Math.floor(by / GRID.TILE);
    const t = state.tiles[tr]?.[tc];
    if (t !== TileType.EMPTY) continue;
    props.push({
      spriteKey: 'BLOOD_LIGHT',
      x: bx,
      y: by,
      scale: 0.35 + Math.random() * 0.25,
      rotation: Math.random() * Math.PI * 2,
      tint: 0xd8c89a,                          // bone-tan
      flickerSeed: Math.random() * Math.PI * 2,
      kind: 'STAIN'
    });
  }
  // 2026-05-17 — OVER-THE-TOP PASS. Double the stains (4 → 10) scattered
  // at varied radii, doubled smoke puffs (3 → 8), and a wider zone so
  // the death-uprising feels like a graveyard ritual is consuming the
  // whole center of the map. Stain placement still skips path/tower
  // tiles so we never paint blood on gameplay elements.
  const STAIN_KEYS = ['BLOOD_HEAVY', 'BLOOD_MEDIUM', 'BLOOD_SATURATED', 'BLOOD_LIGHT'];
  const STAIN_COUNT = 10;
  for (let i = 0; i < STAIN_COUNT; i++) {
    const angle = (i / STAIN_COUNT) * Math.PI * 2 + Math.random() * 0.4;
    const radius = GRID.TILE * (0.9 + Math.random() * 1.6);     // 0.9 .. 2.5 tiles
    const px = cx + Math.cos(angle) * radius + (Math.random() - 0.5) * 6;
    const py = cy + Math.sin(angle) * radius + (Math.random() - 0.5) * 6;
    const tc = Math.floor(px / GRID.TILE);
    const tr = Math.floor(py / GRID.TILE);
    const t = state.tiles[tr]?.[tc];
    if (t !== TileType.EMPTY) continue;
    props.push({
      spriteKey: STAIN_KEYS[i % STAIN_KEYS.length],
      x: px,
      y: py,
      scale: 0.65 + Math.random() * 0.45,                       // wider range
      rotation: Math.random() * Math.PI * 2,
      tint: 0x885aff,        // necrotic purple cast
      flickerSeed: Math.random() * Math.PI * 2,
      kind: 'STAIN'
    });
  }
  // 8 drifting smoke puffs at varied radii — closer ring + outer ring so
  // the haze fills the zone, not just hugs the center.
  const SMOKE_COUNT = 8;
  for (let i = 0; i < SMOKE_COUNT; i++) {
    const ring = i < 4 ? 0 : 1;                                  // inner ring, outer ring
    const angle = ((i % 4) / 4) * Math.PI * 2 + ring * Math.PI * 0.25 + Math.random() * 0.3;
    const radius = GRID.TILE * (ring === 0 ? 1.2 : 2.2) + Math.random() * 0.4 * GRID.TILE;
    const px = cx + Math.cos(angle) * radius;
    const py = cy + Math.sin(angle) * radius - GRID.TILE * 0.2;
    props.push({
      spriteKey: 'SMOKE_PUFF',
      x: px,
      y: py - GRID.TILE * 0.3,
      scale: 0.7 + Math.random() * 0.55,
      rotation: Math.random() * Math.PI * 2,
      tint: ring === 0 ? 0x9966cc : 0x6633aa,                    // outer ring darker
      flickerSeed: Math.random() * Math.PI * 2,
      kind: 'HAZE'
    });
  }
  return props;
}

// ─── GATES OF HELL POINT + ATMOSPHERE GENERATORS (2026-05-17) ────────
//
// Two visual points: one at WP3, one at WP4. Each gate spawns ONE
// HELL_GATE at t=0 (the structure that towers shoot to shut the event
// down) followed by FIRE_GIANT spawns on a 2s cadence, alternating
// between the gates so the player sees a new fire giant every second.
// 2026-05-19 — Gate 4 fires FIRST (per the player's "out of four
// and then come out of three and then come out of four and then
// come out of three" description). Total fire giants over the 15s
// window: 15 (8 from gate-4, 7 from gate-3).
//
// Path positioning: HELL_GATE itself doesn't walk (speed 0); the fire
// giants snap to WP3's or WP4's path index and walk the remainder of
// the path normally. The renderer puts the gate sprite AT the
// waypoint's pixel position.
function generateGatesOfHellPoints(state: GameStateShape, startAtTick: number): SurpriseEventSpawnPoint[] {
  // 2026-05-22 — FOUR gates instead of two. Player asked for the
  // gates to stay at the same map locations (WP3 / WP4 area) but
  // for each waypoint to host TWO gates separated by a couple of
  // tiles. So WP3 anchors a pair (one to the west, one to the east
  // of the path tile) and WP4 anchors another pair. Total: 4 gates.
  //
  // pointId mapping:
  //   0 — WP3-west   (col-1)
  //   1 — WP3-east   (col+1)
  //   2 — WP4-west   (col-1)
  //   3 — WP4-east   (col+1)
  //
  // Visual: gates flank each waypoint medallion, the path runs
  // between them. Fire giants from each gate enter the path at the
  // nearest path tile (the waypoint itself).
  const wp3 = (waypointsData as any).waypoints.find((w: any) => w.index === 3);
  const wp4 = (waypointsData as any).waypoints.find((w: any) => w.index === 4);
  if (!wp3 || !wp4) return [];
  const locations = [
    { col: wp3.topLeft.col - 1, row: wp3.topLeft.row, pointId: 0 },
    { col: wp3.topLeft.col + 1, row: wp3.topLeft.row, pointId: 1 },
    { col: wp4.topLeft.col - 1, row: wp4.topLeft.row, pointId: 2 },
    { col: wp4.topLeft.col + 1, row: wp4.topLeft.row, pointId: 3 }
  ];
  const out: SurpriseEventSpawnPoint[] = [];
  // Spawn the HELL_GATE structures at all 4 locations. All four
  // rise simultaneously at startAtTick + VFX_RISE_SECONDS (the
  // underworld breaks open in four places at once).
  for (const loc of locations) {
    const vfxX = loc.col * GRID.TILE + GRID.TILE / 2;
    const vfxY = loc.row * GRID.TILE + GRID.TILE / 2;
    const nearest = nearestPathIndexAtWaypoint(state, loc.col, loc.row);
    out.push({
      vfxX, vfxY,
      pathTileX: loc.col,
      pathTileY: loc.row,
      pathIndex: nearest,
      spawnAt: startAtTick + VFX_RISE_SECONDS,
      enemyType: 'HELL_GATE',
      fired: false,
      pointId: loc.pointId
    });
  }
  // Fire-giant spawn schedule: round-robin through all 4 gates with
  // a ~1.5s cadence (so a giant emerges from a different gate every
  // 1.5 seconds). Over the 20s window that lands ~13 giants — a
  // modest bump from the prior 9-giant cadence to match the 4-gate
  // framing, without being a wall the player can't survive. Order:
  // WP4-east → WP3-east → WP4-west → WP3-west → repeat. Tilting
  // toward the WP4 (back) gates first so the player has a moment
  // to engage before the WP3 (front-line) giants arrive.
  const baseStart = startAtTick + VFX_RISE_SECONDS;
  const GIANT_CADENCE = 1.5;   // seconds between giant emergences
  const order = [3, 1, 2, 0];  // WP4-east, WP3-east, WP4-west, WP3-west
  let t = GATES_OF_HELL_CADENCE_SECONDS;
  let orderIdx = 0;
  while (t <= GATES_OF_HELL_WINDOW_SECONDS + 1) {
    const pointId = order[orderIdx % order.length];
    const loc = locations.find(l => l.pointId === pointId)!;
    out.push({
      vfxX: loc.col * GRID.TILE + GRID.TILE / 2,
      vfxY: loc.row * GRID.TILE + GRID.TILE / 2,
      pathTileX: loc.col,
      pathTileY: loc.row,
      pathIndex: nearestPathIndexAtWaypoint(state, loc.col, loc.row),
      spawnAt: baseStart + t,
      enemyType: 'FIRE_GIANT',
      fired: false,
      pointId
    });
    t += GIANT_CADENCE;
    orderIdx++;
  }
  return out;
}

// Find the path index nearest to a waypoint tile. Unlike
// nearestPathIndexAfterWP2 this doesn't clamp — fire giants from gate-3
// can start at WP3's path index (walking WP4-7), gate-4 giants at WP4's
// path index (walking WP5-7).
function nearestPathIndexAtWaypoint(state: GameStateShape, col: number, row: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < state.groundPath.length; i++) {
    const p = state.groundPath[i];
    const d = Math.abs(p.col - col) + Math.abs(p.row - row);
    if (d < bestD) { bestD = d; best = i; }
  }
  // Step one tile past the waypoint so the spawn doesn't accidentally
  // trigger a "crossed this waypoint" event (matches the WP2 logic
  // in getMinSurprisePathIndex).
  return Math.min(state.groundPath.length - 1, best + 1);
}

// GATES OF HELL atmosphere: heavy fire dressing around every gate.
// 2026-05-22 — Now 4 gates instead of 2. Per-gate prop counts cut
// roughly in half so the total visual prop count stays in the same
// ballpark as the prior 2-gate version (16 fires vs 12, 12 smoke
// vs 6, 8 stains vs 4) — the underworld is bleeding through 4
// seams of reality now, but the renderer doesn't choke on doubled
// particle volume.
function generateGatesOfHellAtmosphere(state: GameStateShape, mainPoints: SurpriseEventSpawnPoint[]): SurpriseAtmosProp[] {
  const props: SurpriseAtmosProp[] = [];
  // Group main points by pointId to get the 4 gate locations
  const gatePositions: { x: number; y: number }[] = [];
  const seen = new Set<number>();
  for (const p of mainPoints) {
    if (seen.has(p.pointId)) continue;
    seen.add(p.pointId);
    gatePositions.push({ x: p.vfxX, y: p.vfxY });
  }
  // Around each gate: ring of 4 small fires + 3 smoke puffs + 2 stains.
  const FIRES_PER_GATE = 4;
  const SMOKE_PER_GATE = 3;
  const STAINS_PER_GATE = 2;
  for (const gp of gatePositions) {
    for (let i = 0; i < FIRES_PER_GATE; i++) {
      const angle = (i / FIRES_PER_GATE) * Math.PI * 2 + Math.random() * 0.4;
      const radius = GRID.TILE * (1.6 + Math.random() * 0.8);   // ring at 1.6-2.4 tiles out
      const px = gp.x + Math.cos(angle) * radius;
      const py = gp.y + Math.sin(angle) * radius;
      const tc = Math.floor(px / GRID.TILE);
      const tr = Math.floor(py / GRID.TILE);
      const t = state.tiles[tr]?.[tc];
      if (t !== TileType.EMPTY) continue;
      props.push({
        spriteKey: Math.random() < 0.5 ? 'FIRE_LARGE' : 'FIRE_SMALL',
        x: px,
        y: py,
        scale: 0.6 + Math.random() * 0.45,
        rotation: (Math.random() - 0.5) * 0.3,
        flickerSeed: Math.random() * Math.PI * 2,
        kind: 'FIRE'
      });
    }
    for (let i = 0; i < SMOKE_PER_GATE; i++) {
      const angle = (i / SMOKE_PER_GATE) * Math.PI * 2 + Math.random() * 0.5;
      const radius = GRID.TILE * (1.0 + Math.random() * 1.4);
      props.push({
        spriteKey: 'SMOKE_PUFF',
        x: gp.x + Math.cos(angle) * radius,
        y: gp.y + Math.sin(angle) * radius - GRID.TILE * 0.4,
        scale: 0.8 + Math.random() * 0.4,
        rotation: Math.random() * Math.PI * 2,
        tint: 0xff7a33,             // warm red-orange smoke (vs uprising's purple)
        flickerSeed: Math.random() * Math.PI * 2,
        kind: 'HAZE'
      });
    }
    for (let i = 0; i < STAINS_PER_GATE; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = GRID.TILE * (0.7 + Math.random() * 0.9);
      const px = gp.x + Math.cos(angle) * radius;
      const py = gp.y + Math.sin(angle) * radius;
      const tc = Math.floor(px / GRID.TILE);
      const tr = Math.floor(py / GRID.TILE);
      const t = state.tiles[tr]?.[tc];
      if (t !== TileType.EMPTY) continue;
      props.push({
        spriteKey: Math.random() < 0.5 ? 'BLOOD_HEAVY' : 'BLOOD_SATURATED',
        x: px,
        y: py,
        scale: 0.7 + Math.random() * 0.35,
        rotation: Math.random() * Math.PI * 2,
        tint: 0xaa3322,             // dark crimson (scorch + blood)
        flickerSeed: Math.random() * Math.PI * 2,
        kind: 'STAIN'
      });
    }
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
  // 2026-05-19 — FULL-PERIMETER ASSAULT.
  // The invasion now spawns EVERY enemy in the wave from a unique
  // perimeter tile, all simultaneously. We generate one location per
  // enemy in the spawn queue, distributed evenly around the four
  // edges of the playable area (excluding the HUD column). For a
  // 54-enemy wave (W7) that's 54 fires lighting up at once around
  // the map; the wave-override path in WaveManager flattens every
  // spawn's spawnAt to the same instant so they all emerge as a
  // single burst rather than over time.
  //
  // We size the location array to max(wave-queue-length, 24) so even
  // tiny endless-mode invasions look like a full siege. Non-override
  // mode (legacy 8-spawn schedule for backwards-compat tests) keeps
  // a fixed 18-fire setup.
  const wallSafeRight = GRID.COLS - 7;
  const topRow = 1;
  const botRow = GRID.ROWS - 2;
  const leftCol = 1;
  // Decide how many spawn points to generate. In waveOverride mode this
  // is one per enemy in the wave (so every invader gets its own unique
  // perimeter fire). In legacy mode we keep the old 18-fire setup.
  const desiredCount = waveOverride
    ? Math.max(24, state.spawnQueue.length)
    : 18;
  // Perimeter-edge length budget (in tiles). Reserve corners with -2.
  const topLen = Math.max(1, wallSafeRight - 2);
  const botLen = Math.max(1, wallSafeRight - 2);
  const leftLen = Math.max(1, GRID.ROWS - 4);
  const rightLen = Math.max(1, GRID.ROWS - 4);
  const totalLen = topLen + botLen + leftLen + rightLen;
  // Distribute spawns proportionally to each edge's length so the
  // pattern is visually balanced (top + bottom get more tiles since
  // they're longer than the side edges).
  const topCount   = Math.max(1, Math.round(desiredCount * (topLen   / totalLen)));
  const botCount   = Math.max(1, Math.round(desiredCount * (botLen   / totalLen)));
  const leftCount  = Math.max(1, Math.round(desiredCount * (leftLen  / totalLen)));
  const rightCount = Math.max(1, desiredCount - topCount - botCount - leftCount);
  const locations: { col: number; row: number }[] = [];
  // TOP edge — columns evenly spaced across the playable width.
  for (let i = 0; i < topCount; i++) {
    const t = (i + 0.5) / topCount;
    locations.push({ col: Math.min(wallSafeRight - 1, Math.max(1, Math.round(1 + t * topLen))), row: topRow });
  }
  // BOTTOM edge — same column distribution.
  for (let i = 0; i < botCount; i++) {
    const t = (i + 0.5) / botCount;
    locations.push({ col: Math.min(wallSafeRight - 1, Math.max(1, Math.round(1 + t * botLen))), row: botRow });
  }
  // LEFT edge — rows evenly spaced down the side.
  for (let i = 0; i < leftCount; i++) {
    const t = (i + 0.5) / leftCount;
    locations.push({ col: leftCol, row: Math.min(GRID.ROWS - 2, Math.max(1, Math.round(2 + t * leftLen))) });
  }
  // RIGHT edge — same row distribution, inset for HUD safety.
  for (let i = 0; i < rightCount; i++) {
    const t = (i + 0.5) / rightCount;
    locations.push({ col: wallSafeRight, row: Math.min(GRID.ROWS - 2, Math.max(1, Math.round(2 + t * rightLen))) });
  }
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
  // 2026-05-20 — REDESIGNED. Previously a 4-urn diamond (urns at the
  // N/S/E/W tiles two steps off center, with ±1 jitter on the anchor).
  // Per user request the uprising now rises from a SINGLE urn on the
  // exact center tile — no jitter, no diamond, no scatter. The undead
  // pour out of one mass grave at the heart of the map.
  //
  // We pad the locations array to UPRISING_CLUSTER_SIZE (4) entries
  // all pointing at the SAME center tile so that:
  //   • clusterUprisingSpawnSchedule (waveOverride mode) still groups
  //     4 enemies per burst — preserves the "wave of undead" feel
  //   • buildPointsFromLocations (legacy mode) still emits a total of
  //     UPRISING_CLUSTER_SIZE × SPAWNS_PER_POINT enemies, matching the
  //     prior count budget. Their stagger from INTER_POINT_OFFSET
  //     produces a tight ripple-out rather than a single-frame burst.
  // The renderer drawing 4 overlapping urn sprites at the same tile
  // visually collapses to one urn (overdraw is idempotent for opaque
  // sprites; alpha-blended ones get a slight bloom on the center tile
  // which actually reads as "the urn is glowing brighter" — fine).
  const midCol = Math.floor(GRID.COLS / 2);
  const midRow = Math.floor(GRID.ROWS / 2);
  const center = { col: midCol, row: midRow };
  const locations = [center, center, center, center];
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

// 2026-05-18 — FIXED. All Invasion/Uprising spawns now enter the path
// at the WP3 entry index regardless of where their visual fire/urn
// spawns on the map. Skips WP1+WP2 (design intent) but forces every
// breach enemy to walk WP3→WP4→WP5→WP6→WP7 in linear order before
// they reach the gate. Previously this searched for the nearest
// path tile to the spawn position, which meant a right-side
// perimeter spawn snapped onto the path near WP7 and ran straight
// to the gate, skipping 3/4/5/6 entirely. Visual disconnect between
// the perimeter fire and the WP3 path entry is masked by the
// teleport-in / ground-rise emergence VFX on each enemy.
//
// Hell Gates keep their own per-gate snap (see
// nearestPathIndexAtWaypoint) so a WP3 gate spawns at WP3 and a WP4
// gate spawns at WP4 — that's the intentional per-gate progression.
function nearestPathIndexAfterWP2(state: GameStateShape, _col: number, _row: number): number {
  return getMinSurprisePathIndex(state);
}

export function isSurpriseEventActive(state: GameStateShape): boolean {
  // Any live event (primary or extras) counts as active. Used by HUD
  // checks that just want a boolean "is something dramatic happening".
  for (const ev of getAllActiveSurpriseEvents(state)) {
    if (ev.vfxFadeOutAt === 0 || state.tick < ev.vfxFadeOutAt + VFX_FADEOUT_SECONDS) return true;
  }
  return false;
}

// Screen tint envelope: trapezoid from event start through last-spawn +
// fade window. Returns null when no tint should paint. With stacked
// endless events, blends each active event's tint together — the
// chaos screen shows red-orange + purple + hellfire-red merged.
export function surpriseEventTintRGBA(state: GameStateShape): { r: number; g: number; b: number; a: number } | null {
  const events = getAllActiveSurpriseEvents(state);
  if (events.length === 0) return null;
  let rSum = 0, gSum = 0, bSum = 0, aSum = 0, aMax = 0;
  for (const ev of events) {
    const t = singleEventTint(state, ev);
    if (!t) continue;
    rSum += t.r * t.a;
    gSum += t.g * t.a;
    bSum += t.b * t.a;
    aSum += t.a;
    if (t.a > aMax) aMax = t.a;
  }
  if (aSum <= 0.001) return null;
  // Cap combined alpha at 0.45 so a 3-event stack doesn't black out
  // the screen. Each individual peak is 0.22-0.32.
  const a = Math.min(0.45, aMax + (aSum - aMax) * 0.5);
  return { r: rSum / aSum, g: gSum / aSum, b: bSum / aSum, a };
}

function singleEventTint(state: GameStateShape, ev: SurpriseEventState): { r: number; g: number; b: number; a: number } | null {
  const elapsed = state.tick - ev.startedAt;
  if (elapsed < 0) return null;
  const peak = ev.kind === SurpriseEventKind.UPRISING ? 0.32
             : ev.kind === SurpriseEventKind.GATES_OF_HELL ? 0.28
             : 0.22;
  let alpha = peak;
  if (elapsed < VFX_RISE_SECONDS) alpha = peak * (elapsed / VFX_RISE_SECONDS);
  if (ev.vfxFadeOutAt > 0) {
    const fadeProgress = (state.tick - ev.vfxFadeOutAt) / VFX_FADEOUT_SECONDS;
    if (fadeProgress >= 1) return null;
    alpha = peak * Math.max(0, 1 - fadeProgress);
  }
  if (alpha <= 0.001) return null;
  if (ev.kind === SurpriseEventKind.UPRISING) {
    return { r: 0.40, g: 0.04, b: 0.62, a: alpha };
  } else if (ev.kind === SurpriseEventKind.GATES_OF_HELL) {
    return { r: 0.90, g: 0.10, b: 0.08, a: alpha };
  } else {
    return { r: 0.85, g: 0.15, b: 0.05, a: alpha };
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
