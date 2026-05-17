// WaveManager — wave start/end + spawn schedule + difficulty curve.
//
// Responsibilities:
//   1. effectiveWaveHpMult: linear-stepped HP multiplier for each wave
//      (+25% per 5 waves, +50% per 10 waves cumulatively).
//   2. startWave: bumps wave counter, builds spawn queue from waves.json,
//      injects Iron Phalanx at every 15th wave, rolls bonus boss past W20+
//      and surprise boss past W40, sets faction weather, rolls a wave
//      modifier (~30% from W6+), shifts phase to WAVE_PHASE.
//   3. tickSpawns: per-frame, drains the spawn queue when spawnAt <= elapsed.
//   4. checkWaveEnd: detects "queue empty + no live enemies" and transitions
//      back to BUILD_PHASE, awarding wave gold and clearing wave-specific
//      state. Defensive against missing wavesData entries (endless mode).

import { GamePhase, EnemyType } from '../types';
import { GameStateShape } from '../GameState';
import { WAVE, WAVE_MODIFIERS } from '../constants';
import wavesData from '../data/waves.json';
import enemiesData from '../data/enemies.json';
import { spawnEnemy } from './EnemySystem';
import { generateEndlessWave, EndlessWaveConfig, endlessClearScore } from './EndlessMode';
import { maybeTriggerSurpriseEventForWave, maybeTriggerEndlessSurpriseEvent, clearSurpriseEventsForWaveEnd, spawnAtSurpriseEventPoint, notifySurpriseEventWaveEnded } from './SurpriseEvents';

// Faction → boss enemy ID. Used to pick a thematically-appropriate bonus boss.
const FACTION_BOSS: Record<string, string> = {
  DOGS: 'ALPHA_DOG',
  CELTS: 'CELTIC_WARLORD',
  CARTHAGE: 'HANNIBAL_BARCA',
  UNDEAD_CELTS: 'UNDEAD_WARLORD',
  UNDEAD_CARTHAGE: 'UNDEAD_WAR_ELEPHANT',
  SUPER_DEMONS: 'DAEMON_IMPERATOR'
};

export function effectiveWaveHpMult(waveNumber: number, baseHpMult: number, isBoss = false): number {
  // 20-WAVE CAMPAIGN (2026-05 v5): the curve splits by enemy class.
  //
  // BASIC ENEMIES — linear + mid-late accelerator + every-5-wave DOUBLING:
  //   linear (every wave):      1 + 0.10 * w               (W1=1.10, W20=3.00)
  //   mid-late accelerator:     +0.10 * max(0, w - 10)     (kicks in at W11)
  //   per-5-wave doubling:      2.00 ^ floor((w-1)/5)
  //
  // BOSSES — LINEAR ONLY. The doubling step is intentionally skipped so
  // bosses follow a smooth, predictable progression instead of the
  // monstrous exponential blow-up basic enemies get late game. Bosses
  // still get the wave-authored hpMult (boss waves are tagged 4.0-5.0×)
  // and the in-spawn `bossWaveSoloBuff` (×2.0 for solo arrival), but the
  // multiplicative every-5-wave doubling is OFF.
  //
  // Sample curves (composed, baseHpMult = 1.0):
  //                         Basic       Boss (linear-only)
  //   W1   1.10×1.0     =   1.10        1.10
  //   W5   1.50×1.0     =   1.50        1.50
  //   W6   1.60×2.0     =   3.20        1.60
  //   W10  2.00×2.0     =   4.00        2.00
  //   W11  (2.10+0.10)×4.0 = 8.80       2.20  (mid-late kicks in)
  //   W15  (2.50+0.50)×4.0 = 12.00      3.00
  //   W20  (3.00+1.00)×8.0 = 32.00      4.00  (linear, predictable)
  // Linear ramp: +10% per wave baseline. W11+ adds an additional +15%
  // per wave on top, making the post-W11 climb significantly steeper
  // than the pre-W11 phase. Ground basics + bosses both feel this; the
  // lateGameLayerMult below adds per-class flavor on top.
  const linearStep    = 1 + 0.10 * waveNumber;
  const midLateStep   = 0.10 * Math.max(0, waveNumber - 10);
  const aggressiveLateStep = 0.15 * Math.max(0, waveNumber - 11);
  const linearTotal   = linearStep + midLateStep + aggressiveLateStep;
  if (isBoss) {
    // Linear progression — no exponential per-5-wave doubling for bosses.
    return baseHpMult * linearTotal;
  }
  const bossesCleared = Math.floor((waveNumber - 1) / 5);
  const postBossStep  = Math.pow(2.00, bossesCleared);
  return baseHpMult * linearTotal * postBossStep;
}

// Late-game layer uplift — mirrors the layerMult applied at spawn time in
// tickSpawns. Pulled out so the Codex + wave-preview can show the SAME
// spawn HP the game will actually use.
//   POST-W7  ground mobs:   ×1.30   (2026-05 v9 — ground felt too soft
//                                    post-mid-game; gate moved from W8
//                                    and uplift bumped from 1.20)
//   POST-W10 ground:        ×1.50   (or flyer ×1.20, or boss ×1.25)
//   POST-W15 every class:   ×1.20
export function lateGameLayerMult(waveNumber: number, isBoss: boolean, isFlyer: boolean): number {
  let m = 1;
  if (waveNumber > 7 && !isBoss && !isFlyer) m *= 1.30;
  if (waveNumber > 10) {
    if (isBoss) m *= 1.25;
    else if (isFlyer) m *= 1.20;
    else m *= 1.50;
  }
  // W11+ creative difficulty layer: ground basics get +30% extra HP,
  // bosses get +40% extra. Stacks on top of the >W10 layer above and
  // the aggressive linear step in effectiveWaveHpMult. Flyers stay
  // unchanged — they're already capped by ranged-only counterplay.
  if (waveNumber > 11) {
    if (isBoss) m *= 1.40;
    else if (!isFlyer) m *= 1.30;
  }
  if (waveNumber > 15) m *= 1.20;
  return m;
}

// Canonical preview HP — exactly what spawnEnemy will produce for this
// enemy on this wave, minus only the random Blood-Moon roll (which the
// preview can't know in advance). Both the Codex ENEMIES table and the
// wave-preview chip's enemy-inspect modal call this so the numbers always
// agree and always match the in-game spawn.
export function previewSpawnHp(def: any, waveNumber: number, wType: 'B' | 'M' | 'G' | 'F', hpMult: number): number {
  if (waveNumber === 1) return 100;       // W1 is pinned to 100 HP for every spawn
  const isBoss  = !!def.isBoss;
  const isFlyer = !!def.isFlyer;
  const waveMult = effectiveWaveHpMult(waveNumber, hpMult, isBoss);
  const soloBuff = (isBoss && wType === 'B') ? 2.0 : 1.0;
  const layer    = lateGameLayerMult(waveNumber, isBoss, isFlyer);
  const basicBuff = isBoss ? 1.0 : 1.70;
  return Math.round(def.baseHp * waveMult * soloBuff * layer * basicBuff);
}

export function startWave(state: GameStateShape) {
  if (
    state.phase !== GamePhase.BUILD_PHASE &&
    state.phase !== GamePhase.PROSPECT_PLACEMENT &&
    state.phase !== GamePhase.PICK_KEEPER
  ) return;
  // 2026-05 v10 — ENDLESS MODE: state.wave stays frozen at 20 once the
  // main run is cleared. endlessWave increments per Endless clear and
  // drives the generator. Phase still flips to WAVE_PHASE; spawn queue
  // is built from generateEndlessWave() instead of wavesData[].
  if (state.endlessMode) {
    state.endlessWave = (state.endlessWave ?? 0) + 1;
    const cfg = generateEndlessWave(state.endlessWave);
    runEndlessSpawnQueue(state, cfg);
    return;
  }
  state.wave += 1;
  if (state.wave > WAVE.TOTAL) return;
  const w = wavesData[state.wave - 1];
  // build spawn schedule
  state.spawnQueue = [];
  state.spawnElapsed = 0;
  let t = 0;
  // BOSS-SOLO RULE: on authored boss waves (type 'B'), strip the mob horde
  // so the boss arrives alone. Boss scripts can still summon helpers from
  // BossScripts.ts at runtime — those are part of the boss's own mechanics
  // and remain untouched. Bosses spawned solo get +HP via tickSpawns to
  // compensate for the missing chip damage from cleared mobs.
  const isBossWave = w.type === 'B';
  for (const grp of w.spawns) {
    const isBossGrp = !!(enemiesData as any)[grp.type]?.isBoss;
    if (isBossWave && !isBossGrp) continue;       // skip mobs on boss waves
    for (let i = 0; i < grp.count; i++) {
      state.spawnQueue.push({ type: grp.type, spawnAt: t });
      t += WAVE.SPAWN_INTERVAL;
    }
  }
  // 20-WAVE CAMPAIGN: Iron Phalanx now has a single dedicated appearance at
  // W17 (the wave's spawns already list the phalanx group in waves.json so
  // we no longer append a separate tail here — wave 17 is type 'M' and the
  // Phalanx units come through normal spawn processing).
  // (Legacy %15 trigger removed.)
  // BONUS-BOSS SYSTEM:
  //   • After wave 20, scheduled boss waves (type 'B') have a 25% chance to
  //     spawn a SECOND boss alongside the authored one.
  //   • After wave 40, ANY wave has a 15% chance to spawn a surprise extra boss.
  // Bonus bosses give 2× gold on kill (handled in main.ts onKill).
  let bonusBossType: string | null = null;
  let bonusReason = '';
  // 20-WAVE CAMPAIGN: twin-boss roll active after W11; ambush-boss after W16.
  // 2026-05 v7: W20 is RNG-FREE — no twin bosses, no ambush bosses, no
  // wave modifier roll. The final encounter is the Daemon Imperator
  // standalone; nothing else competes for the player's attention.
  const isFinalWave = state.wave === 20;
  if (!isFinalWave && state.wave > 11 && w.type === 'B' && Math.random() < 0.25) {
    bonusBossType = FACTION_BOSS[w.faction] ?? 'CELTIC_WARLORD';
    bonusReason = 'TWIN BOSSES — TWO COLUMNS, ONE LEGION';
  } else if (!isFinalWave && state.wave > 16 && Math.random() < 0.15) {
    bonusBossType = FACTION_BOSS[w.faction] ?? 'CELTIC_WARLORD';
    bonusReason = 'AMBUSH BOSS — THE PATROL WALKED INTO YOU';
  }
  // BOSS REBIRTH (2026-05 v6): any boss that leaked to Rome on a prior
  // wave is queued here with the HP it had at leak time. We append each
  // to this wave's spawn schedule and stash the HP carry on a sibling
  // map so tickSpawns can apply it the moment the boss spawns. Bosses
  // arrive AFTER authored spawns so they don't double-up at t=0.
  //
  // ORDER: reborn bosses are appended BEFORE the bonus boss (if any) so
  // the bonus-boss-tagging logic in tickSpawns ("flag the LAST boss to
  // spawn as isBonusBoss") doesn't accidentally tag a reborn boss as the
  // bonus boss and double-pay gold on it.
  const respawnQueue = state.bossRespawnQueue ?? [];
  if (respawnQueue.length > 0) {
    // Pending HP carry by spawn order — drained in tickSpawns when each
    // matching boss type spawns. Stack semantics keep it ordered if the
    // same boss type leaked multiple times (rare but possible on twins).
    const carry: { type: string; hpAtLeak: number; hpFraction: number; wasScheduled?: boolean }[] = [];
    for (const entry of respawnQueue) {
      t += 2.0;     // 2-second gap between rebirthed bosses
      state.spawnQueue.push({ type: entry.type as EnemyType, spawnAt: t });
      carry.push(entry);
    }
    (state as any).__pendingBossCarry = carry;
    state.bossRespawnQueue = [];
    (state as any).pendingRebornBosses = respawnQueue.length;     // banner hook for main.ts
  }
  if (bonusBossType && (enemiesData as any)[bonusBossType]) {
    // Append the bonus boss LAST in the queue so the "last-boss-in-queue"
    // tag in tickSpawns finds it (not a reborn boss).
    state.spawnQueue.push({ type: bonusBossType as EnemyType, spawnAt: t + 2.5 });
    (state as any).pendingBonusBoss = bonusReason;
  }
  state.enemiesKilledThisWave = 0;
  state.enemiesLeakedThisWave = 0;
  (state as any).carriedEnemiesThisWave = state.enemies.size;
  (state as any).totalEnemiesThisWave = state.spawnQueue.length + state.enemies.size;
  state.phase = GamePhase.WAVE_PHASE;
  // Set faction weather (boss waves intensify by 50%).
  state.weatherKey = w.faction;
  state.weatherIntensity = w.type === 'B' ? 1.5 : 1.0;
  // Boss hazards removed 2026-05 — kept the field zero'd so any leftover
  // renderer code reads null and bails.
  (state as any).bossHazardKey = null;
  // Roll a wave modifier — 30% chance from W3 onward (20-WAVE CAMPAIGN),
  // never on the dedicated Iron Phalanx wave. Boss waves CAN roll one
  // for extra stakes.
  state.waveModifier = null;
  state.waveModifierTick = 0;
  const isPhalanxWave = state.wave === 17;
  // W20 RNG-FREE rule also blocks the wave-modifier roll. The final
  // wave is a clean, deterministic Daemon Imperator fight.
  if (state.wave >= 3 && !isPhalanxWave && !isFinalWave && Math.random() < 0.30) {
    const m = WAVE_MODIFIERS[Math.floor(Math.random() * WAVE_MODIFIERS.length)];
    state.waveModifier = m.key;
    // BLOOD_MOON: stat-based modifier — bake the +25% HP into the wave hpMult
    // by stuffing a flag the spawn loop will use to scale per-enemy maxHp.
    if (m.key === 'BLOOD_MOON') (state as any).bloodMoonHpMult = 1.25;
  }
  const carry = state.enemies.size > 0 ? ` ${state.enemies.size} enemies carried over.` : '';
  state.hint = `Wave ${state.wave} — ${w.faction}.${carry}`;
  // 2026-05-16 — SURPRISE EVENTS (Invasion + Skeletal Uprising). Fires
  // 8 seconds into the wave if SURPRISE_EVENT_SCHEDULE matches. Cooldown
  // gates inside the helper; W7 / W11 / W14 / W18 are the campaign hits.
  maybeTriggerSurpriseEventForWave(state);
}

export function tickSpawns(state: GameStateShape, dt: number) {
  if (state.phase !== GamePhase.WAVE_PHASE) return;
  state.spawnElapsed += dt;
  // 2026-05 v10 — ENDLESS MODE: route to a dedicated tick handler that
  // uses the procedurally-generated cfg's hpMult/speedMult/resistBoost.
  // Lets normal tickSpawns keep its waves.json-driven path untouched.
  if (state.endlessMode) {
    tickEndlessSpawns(state);
    return;
  }
  const w = wavesData[state.wave - 1];
  // Basic-enemy HP path (with the every-5-wave doubling). Computed once
  // per tickSpawns; bosses use a separate linear-only path below.
  const basicHpMult = effectiveWaveHpMult(state.wave, w.hpMult, false);
  const bossWaveSoloBuff = w.type === 'B' ? 2.0 : 1.0;     // +100% HP when boss is alone
  // 2026-05-17 — Round-robin counter for surprise-event waveOverride mode.
  // Each spawn off the queue gets the next point in sequence so all 4
  // fires/urns stay active throughout the wave instead of just one.
  let surpriseSpawnIdx = (state as any).__surpriseSpawnRoundIdx ?? 0;
  while (state.spawnQueue.length > 0 && state.spawnQueue[0].spawnAt <= state.spawnElapsed) {
    const item = state.spawnQueue.shift()!;
    // Boss vs basic split (2026-05 v5): bosses scale LINEARLY across the
    // 20-wave run — no exponential doubling — so each boss is a real
    // step heavier than the previous boss without being a wall. Basic
    // mobs still get the doubling-per-5-waves stack.
    const isBossSpawn = !!(enemiesData as any)[item.type]?.isBoss;
    const isFlyerSpawn = !!(enemiesData as any)[item.type]?.isFlyer;
    // LAYERED LATE-GAME HP UPLIFT — single source of truth in
    // `lateGameLayerMult` (W7 / W10 / W11 / W15 breakpoints all live
    // there). The preview-side path uses the same helper so spawn HP
    // and Codex preview HP can never drift apart again.
    const layerMult = lateGameLayerMult(state.wave, isBossSpawn, isFlyerSpawn);
    const spawnHpMult = (isBossSpawn
      ? effectiveWaveHpMult(state.wave, w.hpMult, true) * bossWaveSoloBuff
      : basicHpMult) * layerMult;
    const e = spawnEnemy(state, item.type as EnemyType, spawnHpMult);
    // 2026-05-17 — Surprise event waveOverride: redirect this enemy to
    // spawn at a perimeter fire (Invasion) or center urn (Uprising)
    // instead of the cave. Round-robin across the 4 visual points so
    // all four stay active. Bosses skip the redirect — boss waves
    // never coincide with surprise events anyway, but defensive guard.
    if (!isBossSpawn) {
      spawnAtSurpriseEventPoint(state, e, surpriseSpawnIdx);
      surpriseSpawnIdx++;
    }
    // WAVE 1 EXCEPTION (2026-05): every enemy that spawns on wave 1 is
    // pinned to a flat 100 HP regardless of baseHp / hpMult / per-wave /
    // boss-cleared scaling. W1 is the player's onboarding moment — they
    // need a clean introductory wave, not a Feral-Dog × 2× × 1.10 ×
    // basicHpBuff math problem. Bosses don't spawn on W1 in the
    // schedule, so this only ever affects the 30 Feral Dogs intended for
    // the calibration wave.
    if (state.wave === 1) {
      e.maxHp = 100;
      e.hp = 100;
    }
    // 2026-05 v6: BOSS HP CARRY. If this boss is queued via the rebirth
    // path, restore the HP it had at leak time (capped to the new wave's
    // maxHp). We drain the carry stack only on a matching boss type so
    // intermixed authored / queued bosses don't get confused. Tag the
    // enemy as a reborn boss so render/UI can flag it visually.
    if (isBossSpawn) {
      // 2026-05 v11: tag the boss as "scheduled" if the current wave is an
      // authored boss wave (type 'B'). The flag survives across leak/respawn
      // (see __pendingBossCarry below) so killing this boss ALWAYS drops a
      // legendary, regardless of which wave the kill happens on. Bonus /
      // twin / ambush bosses are flagged separately further down.
      if (w.type === 'B') {
        e.isScheduledBoss = true;
      }
      const carry: { type: string; hpAtLeak: number; hpFraction: number; wasScheduled?: boolean }[] | undefined = (state as any).__pendingBossCarry;
      if (carry && carry.length > 0) {
        const idx = carry.findIndex(c => c.type === item.type);
        if (idx >= 0) {
          const entry = carry[idx];
          carry.splice(idx, 1);
          e.hp = Math.min(e.maxHp, Math.max(1, entry.hpAtLeak));
          (e as any).__rebornFromLeak = true;
          (e as any).__rebornHpFraction = entry.hpFraction;
          // 2026-05 v11: restore the original `isScheduledBoss` flag so the
          // reborn instance still drops a legendary on kill even if the
          // current wave is non-'B'.
          if (entry.wasScheduled) e.isScheduledBoss = true;
          // 2026-05 v6 BUGFIX: reborn bosses must NOT re-trigger their
          // phase-2 rebirth script. The original encounter already paid
          // for that mechanic (the player already saw Hannibal/Warlord/
          // UWE summon helpers + enrage + status-clear). Marking
          // hasRebirthed=true makes BossScripts skip the threshold
          // trigger so the reborn fight isn't a "free boss buff" payoff
          // for the player having leaked.
          e.hasRebirthed = true;
        }
      }
    }
    // Mark the LAST boss spawned this wave as the bonus boss when one is queued.
    // (Authored boss spawns first; the surprise bonus boss is appended last.)
    if (e.isBoss && (state as any).pendingBonusBoss) {
      // Only flag it if this is one of the post-authored spawns (heuristic: the
      // pendingBonusBoss flag is set when scheduling, and we set isBonusBoss on
      // the final boss enemy in the queue).
      if (state.spawnQueue.filter(s => (enemiesData as any)[s.type]?.isBoss).length === 0) {
        e.isBonusBoss = true;
        (state as any).bonusBossAnnouncement = (state as any).pendingBonusBoss;
        (state as any).pendingBonusBoss = null;
      }
    }
  }
  // Persist the round-robin counter across ticks so subsequent spawns
  // continue from where the last batch left off.
  (state as any).__surpriseSpawnRoundIdx = surpriseSpawnIdx;
}

export function checkWaveEnd(state: GameStateShape, onWaveEnd: (gold: number) => void) {
  if (state.phase !== GamePhase.WAVE_PHASE) return;
  // BOSS REBIRTH (2026-05 v6): bosses that leak to Rome are now deleted
  // from state.enemies and queued for respawn on the NEXT wave's start
  // (see EnemySystem leak path + WaveManager.startWave). So wave-end is
  // a simple "no live enemies + no pending spawns" check again — the
  // prior `hasLeakedOnce` carry-forward filter is no longer needed.
  // 2026-05 v11: training dummies (DPS Check) don't block wave-end —
  // they're a measurement tool, not real wave content.
  let liveEnemies = 0;
  for (const e of state.enemies.values()) {
    if (!(e as any).isDpsCheck) liveEnemies++;
  }
  if (state.spawnQueue.length === 0 && liveEnemies === 0) {
    // 2026-05 v10 — ENDLESS MODE wave-end path. Cumulative endless
    // score bumps by endlessClearScore(cfg) per cleared wave; gold
    // intentionally unstable (±50% jitter on the cfg.gold baseline)
    // for the "sometimes generous, sometimes scarce" tone the design
    // brief calls for. Mercator + boss-rebirth logic skipped.
    if (state.endlessMode) {
      const cfg = (state as any).__endlessWaveCfg as EndlessWaveConfig | undefined;
      state.phase = GamePhase.BUILD_PHASE;
      const baseGold = cfg?.gold ?? 40;
      const jitter = 0.5 + Math.random();  // 0.5×..1.5×
      const goldAward = Math.max(8, Math.round(baseGold * jitter));
      const earned = cfg ? endlessClearScore(cfg) : 100;
      state.endlessScore = (state.endlessScore ?? 0) + earned;
      state.hint = `ENDLESS WAVE ${state.endlessWave} survived. +${goldAward}g, +${earned} endless score.`;
      state.weatherKey = null;
      state.weatherIntensity = 1;
      state.waveModifier = null;
      (state as any).__surpriseSpawnRoundIdx = 0;
      // 2026-05-17 — Fire reward modal trigger BEFORE clearing the event,
      // so the modal can read activeSurpriseEvent.kind. clearSurpriseEventsForWaveEnd
      // is then deferred until the reward closes (main.ts handles this).
      notifySurpriseEventWaveEnded(state);
      if (!state.pendingSurpriseReward) clearSurpriseEventsForWaveEnd(state);
      onWaveEnd(goldAward);
      return;
    }
    // Defensive lookup — endless-mode waves > 50 fall off the authored array.
    // Use a sane fallback so the wave-end flow can never crash.
    const w = wavesData[state.wave - 1] ?? { gold: 30, faction: 'SUPER_DEMONS', type: 'B', spawns: [], hpMult: 1 };
    state.phase = GamePhase.BUILD_PHASE;
    // RNG-event reward (2026-05): if a wave modifier rolled and the
    // player cleared the wave, pay a flat +40g bonus on top of the
    // standard wave gold. Also bumps the score-formula counter.
    let modBonus = 0;
    if (state.waveModifier) {
      state.modifierWavesSurvived = (state.modifierWavesSurvived ?? 0) + 1;
      // 2026-05 v6 BUFF: modifier wave survival bumped 15g → 40g + 1500
      // score. Combined with the free Uncommon item grant on launch
      // (see main.ts launchWave) the player feels meaningfully rewarded
      // for shrugging off Blood Moon / Storm Surge / Death Pact / Veil /
      // Revenant / Group March instead of paying a small consolation.
      modBonus = 40;
      state.denarii += modBonus;
      state.score = (state.score ?? 0) + 1500;
      // Transient flag so main.ts can fire a celebration banner this
      // frame. Cleared by the wave-end callback after the banner shows.
      (state as any).__modifierJustSurvived = state.waveModifier;
    }
    const modSuffix = modBonus > 0 ? ` +${modBonus}g RNG bonus +1500 score.` : '';
    state.hint = `Wave ${state.wave} survived. +${w.gold} Denarii.${modSuffix} The empire pretends not to be impressed.`;
    // Clear weather + modifier — sky clears between waves.
    state.weatherKey = null;
    state.weatherIntensity = 1;
    state.waveModifier = null;
    (state as any).bloodMoonHpMult = 1;
    (state as any).__surpriseSpawnRoundIdx = 0;
    // 2026-05-17 — Surprise event wave clear path. notifySurpriseEventWaveEnded
    // sets pendingSurpriseReward IF the event was in waveOverride mode AND
    // the player survived. The active event stays alive until the reward
    // modal closes (main.ts re-fires clearSurpriseEventsForWaveEnd there).
    // Otherwise we clear immediately like before.
    notifySurpriseEventWaveEnded(state);
    if (!state.pendingSurpriseReward) clearSurpriseEventsForWaveEnd(state);
    onWaveEnd(w.gold);   // callback may override phase (e.g. VICTORY)
  }
}

export function getWaveInfo(state: GameStateShape) {
  if (state.wave === 0) return wavesData[0];
  return wavesData[Math.min(state.wave - 1, WAVE.TOTAL - 1)];
}

export function getNextWaveInfo(state: GameStateShape) {
  return wavesData[Math.min(state.wave, WAVE.TOTAL - 1)];
}

// ─── ENDLESS MODE SPAWN QUEUE BUILDER (2026-05 v10) ───────────────────
// Builds the spawnQueue from a procedurally-generated EndlessWaveConfig.
// Stash the config on state so the wave-end / mid-tick code can read
// metadata back (e.g. hpMult for late-stage scaling, isBoss for banners).
// Stash speedMult + resistBoost as well so tickSpawns can stamp the
// scaled values on each spawned enemy.
function runEndlessSpawnQueue(state: GameStateShape, cfg: EndlessWaveConfig) {
  state.spawnQueue = [];
  state.spawnElapsed = 0;
  let t = 0;
  for (const grp of cfg.spawns) {
    for (let i = 0; i < grp.count; i++) {
      state.spawnQueue.push({ type: grp.type, spawnAt: t });
      // Endless mode runs a tighter spawn interval as endlessWave climbs
      // — by E10 the SPAWN_INTERVAL is roughly half normal, which feels
      // like the "endless swarm" tone the design brief calls for.
      const intervalScale = Math.max(0.45, 1 - cfg.endlessIdx * 0.06);
      t += WAVE.SPAWN_INTERVAL * intervalScale;
    }
  }
  state.enemiesKilledThisWave = 0;
  state.enemiesLeakedThisWave = 0;
  (state as any).carriedEnemiesThisWave = state.enemies.size;
  (state as any).totalEnemiesThisWave = state.spawnQueue.length + state.enemies.size;
  // Stash the cfg so spawnEnemy / pre-wave brief / scoring can read it.
  (state as any).__endlessWaveCfg = cfg;
  state.phase = GamePhase.WAVE_PHASE;
  // 2026-05-16 — Endless surprise events: ~25% chance per endless wave,
  // 3-wave cooldown. Uprising prefers undead faction days; otherwise
  // defaults to Invasion. Same VFX + reward pipeline as the campaign.
  maybeTriggerEndlessSurpriseEvent(state, cfg.faction ?? 'CARTHAGE');
}

// Exposed so main.ts / pre-wave brief can read the active endless cfg.
export function getEndlessCfg(state: GameStateShape): EndlessWaveConfig | null {
  return (state as any).__endlessWaveCfg ?? null;
}

// Endless variant of tickSpawns. Applies cfg.hpMult flat on top of the
// W20 baseline, then stamps cfg.speedMult on currentSpeed and a
// __lateResistMult reflecting cfg.resistBoost so the rest of the game
// (CombatResolver, EnemyResistances) honors the harder Endless math
// without further changes.
function tickEndlessSpawns(state: GameStateShape) {
  const cfg = (state as any).__endlessWaveCfg as EndlessWaveConfig | undefined;
  if (!cfg) return;
  while (state.spawnQueue.length > 0 && state.spawnQueue[0].spawnAt <= state.spawnElapsed) {
    const item = state.spawnQueue.shift()!;
    const isBossSpawn = !!(enemiesData as any)[item.type]?.isBoss;
    const isFlyerSpawn = !!(enemiesData as any)[item.type]?.isFlyer;
    // Compose a wave-curve mult for the W20 baseline THEN multiply by
    // the Endless hpMult on top.
    const baseLineMult = effectiveWaveHpMult(20, 1.0, isBossSpawn);
    const layer = lateGameLayerMult(20, isBossSpawn, isFlyerSpawn);
    const basicBuff = isBossSpawn ? 1.0 : 1.70;
    const spawnHpMult = baseLineMult * cfg.hpMult * layer * basicBuff;
    const e = spawnEnemy(state, item.type as EnemyType, spawnHpMult);
    // Speed scalar.
    e.baseSpeed *= cfg.speedMult;
    e.currentSpeed = e.baseSpeed;
    // Resist stamp — multiplies through damage AND DoT effectiveness.
    (e as any).__lateResistMult = ((e as any).__lateResistMult ?? 1) * cfg.resistBoost;
    // Tag the spawn so renderer/inspect knows we're in Endless.
    (e as any).__endlessWave = cfg.endlessIdx;
  }
}
