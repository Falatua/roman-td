// WaveManager — wave start/end + spawn schedule + difficulty curve.
//
// Responsibilities:
//   1. effectiveWaveHpMult: class-aware campaign HP multiplier.
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
import { ENEMY_BALANCE, WAVE, WAVE_MODIFIERS } from '../constants';
import wavesData from '../data/waves.json';
import enemiesData from '../data/enemies.json';
import { spawnEnemy } from './EnemySystem';
import { generateEndlessWave, EndlessWaveConfig, endlessClearScore } from './EndlessMode';
import { maybeTriggerSurpriseEventForWave, maybeTriggerEndlessSurpriseEvent, clearSurpriseEventsForWaveEnd, spawnAtSurpriseEventPoint, spawnUprisingDragonAtEventPoint, notifySurpriseEventWaveEnded } from './SurpriseEvents';
import { injectBossEscortCommanders, injectCampaignCommanders, isCommanderType } from './CommanderSystem';
import { campaignRelicWaveGoldMult } from './CampaignRelicSystem';
import { prepareHeroAbilitiesForWave } from './HeroSystem';
import { completeTestYourMight, startTestYourMight, TEST_YOUR_MIGHT_MAX_SPAWN_DT, tickTestYourMightSpawns } from './TestYourMightSystem';
import { campaignPressureHpMult } from './CampaignDifficulty';
import { routeOceanSpawnToPath } from './OceanSpawnSystem';
import { isBossEnemy, isCommanderEnemy, isEliteEnemy } from './EnemyClassification';
import { staggerElephantSpawns } from './ElephantPacing';
import { grantTrapGiftInventory } from './TrapInventorySystem';
import { expireHarborDraftForNewWave } from './HarborSystem';

// Faction → boss enemy ID. Used to pick a thematically-appropriate bonus boss.
const FACTION_BOSS: Record<string, string> = {
  DOGS: 'ALPHA_DOG',
  CELTS: 'CELTIC_WARLORD',
  CARTHAGE: 'HANNIBAL_BARCA',
  UNDEAD_CELTS: 'UNDEAD_WARLORD',
  UNDEAD_CARTHAGE: 'UNDEAD_WAR_ELEPHANT',
  SUPER_DEMONS: 'DAEMON_IMPERATOR'
};

type SpawnQueueItem = GameStateShape['spawnQueue'][number];

export const REBORN_BOSS_OPENING_GAP_SECONDS = 0.75;

export const WAVE_20_TRAP_GIFT_WAVE = 20;
export const WAVE_20_TRAP_GIFT = [
  { id: 'BALLISTA_SNARE', qty: 1 },
  { id: 'SKY_NET', qty: 1 },
  { id: 'FROST_SNARE', qty: 1 },
] as const;

function sortSpawnQueue(queue: SpawnQueueItem[]): void {
  queue.sort((a, b) =>
    (a.spawnAt - b.spawnAt) ||
    (Number(!!b.rebornBoss) - Number(!!a.rebornBoss)) ||
    (Number(!!a.caveB) - Number(!!b.caveB))
  );
}

function shouldMirrorToCaveB(state: GameStateShape, type: string): boolean {
  if (state.wave < 21 || state.groundPathB.length === 0) return false;
  const def = (enemiesData as any)[type];
  if (!def || isBossEnemy(type) || def.isFlyer) return false;
  return true;
}

function mirrorGroundSpawnsToCaveB(state: GameStateShape): void {
  if (state.wave < 21 || state.groundPathB.length === 0) return;
  const mirrors: SpawnQueueItem[] = [];
  for (const item of state.spawnQueue) {
    if (item.ocean) continue;
    if (item.caveB || !shouldMirrorToCaveB(state, item.type)) continue;
    mirrors.push({ ...item, caveB: true });
  }
  if (mirrors.length === 0) return;
  state.spawnQueue.push(...mirrors);
  sortSpawnQueue(state.spawnQueue);
}

export function grantWave20TrapGift(state: GameStateShape): Array<{ id: string; qty: number }> {
  if (state.wave !== WAVE_20_TRAP_GIFT_WAVE || state.wave20TrapGiftGranted) return [];
  if (state.sandboxMode || state.endlessMode) return [];
  state.wave20TrapGiftGranted = true;
  const granted: Array<{ id: string; qty: number }> = [];
  for (const gift of WAVE_20_TRAP_GIFT) {
    const qty = grantTrapGiftInventory(state, gift.id, gift.qty);
    if (qty > 0) granted.push({ id: gift.id, qty });
  }
  (state as any).__wave20TrapGiftJustGranted = granted;
  return granted;
}

export function effectiveWaveHpMult(waveNumber: number, baseHpMult: number, isBoss = false, isElite = false): number {
  // 30-WAVE CAMPAIGN: the curve splits by enemy class. Authored hpMult values
  // are encounter-budget controls, not standalone difficulty ratings; the
  // composed campaign curve is guarded by nominalWaveThreatHp tests below.
  //
  // Ordinary mobs retain the legacy milestone pressure that supports large
  // swarm waves. Bosses skip that pressure and follow the authored linear
  // lane. Elites and commanders use a continuous progression between those
  // extremes. The wave-level hpMult values compensate for roster size and
  // composition so total encounter pressure stays smooth even when a wave
  // changes from swarms to a few premium threats.
  const linearStep    = 1 + 0.10 * waveNumber;
  const midLateStep   = 0.10 * Math.max(0, waveNumber - 10);
  const aggressiveLateStep = 0.15 * Math.max(0, waveNumber - 11);
  const linearTotal   = (linearStep + midLateStep + aggressiveLateStep) * campaignPressureHpMult(waveNumber);
  if (isBoss) {
    // Bosses stay on the authored linear lane.
    return baseHpMult * linearTotal;
  }
  if (isElite) {
    // Elites begin their own continuous escalation at W9. The endpoint meets
    // the old late-campaign pressure by W30, but the 21%-per-wave ramp removes
    // every five-wave health cliffs and, crucially, does not front-load W9.
    const eliteProgression = waveNumber < 9 ? 1 : Math.pow(1.21, waveNumber - 9);
    return baseHpMult * linearTotal * eliteProgression;
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
//   POST-W15 every class:   escalating late-campaign pressure through W30
//                            W16 is intentionally a softer bridge out of
//                            W15; the climb becomes severe as the campaign
//                            crosses W18, W21, W25, and W30.
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
  // 2026-07-05 — W16+ flyers are the dedicated combo anti-air check.
  // Ground/bosses keep the softened campaign bridge, but flyers climb harder
  // so W18+ air waves reward Scorpion Bolt, Exploratores, Storm Ballista,
  // Skyreaper Battery, Sky Dominion, and other combo anti-air instead of
  // plain archer stacking.
  if (waveNumber > 15) {
    const late = waveNumber - 15;
    if (isBoss) m *= 1.05 + late * 0.06;
    else if (isFlyer) m *= 1.10 + late * 0.07;
    else m *= 1.00 + late * 0.05;
  }
  if (waveNumber >= 21) {
    if (isBoss) m *= 1.20;
    else if (isFlyer) m *= 1.10;
    else m *= 1.15;
  }
  if (waveNumber >= 25) {
    if (isBoss) m *= 1.22;
    else if (isFlyer) m *= 1.12;
    else m *= 1.18;
  }
  if (waveNumber >= 30 && isBoss) m *= 1.40;
  return m;
}

function clearStaleSurpriseEventRuntimeForNewWave(state: GameStateShape): void {
  const hasRuntime = !!state.activeSurpriseEvent || !!(state.extraSurpriseEvents && state.extraSurpriseEvents.length > 0);
  if (!hasRuntime) return;
  if ((state.lastSurpriseEventWave ?? 0) === state.wave) return;
  state.activeSurpriseEvent = null;
  state.extraSurpriseEvents = [];
  state.surpriseEventScars = [];
  (state as any).__surpriseSpawnRoundIdx = 0;
}

// Canonical preview HP — exactly what spawnEnemy will produce for this
// enemy on this wave, minus only the random Blood-Moon roll (which the
// preview can't know in advance). Both the Codex ENEMIES table and the
// wave-preview chip's enemy-inspect modal call this so the numbers always
// agree and always match the in-game spawn.
//
// 2026-05-19 — Added optional `heroActive` flag. When the player has
// drafted a hero, every spawn picks up a +15% HP comp multiplier (see
// EnemySystem.spawnEnemy:heroComp). The preview has to factor this in
// or the Codex / wave-preview chip / W20 banner will all underreport
// the real number by 15%. Default false so existing callers that
// pre-date the hero system keep their old numbers (e.g. internal
// non-game-loop math, future tests).
export function previewSpawnHp(def: any, waveNumber: number, wType: 'B' | 'M' | 'G' | 'F', hpMult: number, heroActive: boolean = false): number {
  if (waveNumber === 1) {
    // W1 is pinned to ~350 HP for every spawn (was 100 HP pre-2026-05-23).
    // User bumped the calibration target several times — 150 → 300 → 350 —
    // because the original 100 HP felt trivially easy. Hero-comp +15% still
    // applies so the W1 preview chip doesn't lie. Without a hero drafted
    // (sandbox / pre-hero saves) the floor stays at 300.
    return heroActive ? 350 : 300;
  }
  const type = String(def?.type ?? '');
  const isBoss  = isBossEnemy(type) || def.isBoss === true;
  const isElite = isEliteEnemy(type) || isCommanderEnemy(type) || def.isElite === true || def.isCommander === true;
  const isFlyer = !!def.isFlyer;
  const waveMult = effectiveWaveHpMult(waveNumber, hpMult, isBoss, isElite);
  const soloBuff = (isBoss && wType === 'B' && waveNumber <= 15) ? 2.0 : 1.0;
  const layer    = lateGameLayerMult(waveNumber, isBoss, isFlyer);
  const basicBuff = (isBoss || isElite) ? 1.0 : 1.70;
  const heroComp = heroActive ? 1.15 : 1.00;
  const flyerHpMult = isFlyer ? ENEMY_BALANCE.FLYER_HEALTH_MULT : 1.0;
  const campaignRoleHpScale = Number(def.campaignHpScaleByWave?.[String(waveNumber)] ?? 1);
  return Math.round(def.baseHp * waveMult * soloBuff * layer * basicBuff * heroComp * flyerHpMult * campaignRoleHpScale);
}

// Campaign-level encounter budget used by balance tests and tooling. It
// composes the same HP layers as live spawns, includes the second-gate mirror,
// and honors the early boss-wave rule that keeps only bosses and authored
// elites. Keeping this beside previewSpawnHp prevents future wave tuning from
// comparing raw hpMult values that omit most of the real difficulty stack.
export function nominalWaveThreatHp(waveNumber: number, heroActive = true): number {
  const wave: any = (wavesData as any[])[waveNumber - 1];
  if (!wave) return 0;
  let total = 0;
  const earlySoloBossWave = wave.type === 'B' && waveNumber <= 15;
  for (const group of wave.spawns ?? []) {
    const def: any = (enemiesData as any)[group.type];
    if (!def) continue;
    const boss = isBossEnemy(group.type);
    if (earlySoloBossWave && !boss && !isEliteEnemy(group.type)) continue;
    const mirror = waveNumber >= 21 && !group.ocean && !boss && !def.isFlyer ? group.count : 0;
    const count = Number(group.count ?? 0) + mirror;
    total += previewSpawnHp(def, waveNumber, wave.type, wave.hpMult, heroActive) * count;
  }
  return total;
}

export function startWave(state: GameStateShape) {
  if (
    state.phase !== GamePhase.BUILD_PHASE &&
    state.phase !== GamePhase.PROSPECT_PLACEMENT &&
    state.phase !== GamePhase.PICK_KEEPER
  ) return;
  // Closing the Harbor panel keeps its contracts during preparation, but
  // launching any next wave ends that merchant visit.
  expireHarborDraftForNewWave(state);
  // Deployment is a preparation decision. Clear any armed trap before every
  // normal, bonus, endless, or sandbox wave so pausing combat cannot revive
  // a placement cursor that was armed during the preceding build phase.
  state.selectedTrapType = null;
  if (state.testYourMightAccepted && !state.testYourMightActive && !state.testYourMightCleared && !state.testYourMightFailed) {
    startTestYourMight(state);
    return;
  }
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
  // Defensive campaign guard: if a previous surprise event was waiting on
  // a reward/modal when the next wave began, its waveOverride routing could
  // still redirect later non-boss spawns. That made W22 look like an
  // invisible instant leak/death. New waves always get fresh spawn routing.
  clearStaleSurpriseEventRuntimeForNewWave(state);
  // 2026 v2 spec Ch7 — Cave B reveals only when its first enemy emerges (set
  // in the spawn loop below). Re-hide it whenever we (re)enter a pre-W21 wave:
  // a fresh run or a sandbox jump backward.
  if (state.wave < 21) state.caveBActive = false;
  const w = wavesData[state.wave - 1];
  // 2026-05-23 — TRUESIGHT REVEAL RESET. The Truesight Lens marks
  // stealth/ambush enemies with `__truesightRevealed = true` once they
  // enter range of a truesight tower, persisting for the rest of the
  // wave. Carried-over enemies (boss rebirth, leak-and-respawn) would
  // otherwise keep the reveal forever, leaking visibility into waves
  // where the player no longer has truesight coverage. Clear at the
  // start of every wave so each round starts dark.
  for (const e of state.enemies.values()) {
    (e as any).__truesightRevealed = false;
  }
  // build spawn schedule
  state.spawnQueue = [];
  state.spawnElapsed = 0;
  let t = 0;
  let oceanT = 0;
  let oceanSpawnIndex = 0;
  // BOSS-SOLO RULE: early authored boss waves strip the mob horde so the
  // boss arrives as a clean teaching encounter. After W15, boss waves keep
  // their authored escort groups so the 30-wave campaign ramps smoothly
  // instead of dipping into a one-unit valley at W20/W21/W24.
  const isBossWave = w.type === 'B';
  const soloBossWave = isBossWave && state.wave <= 15;
  let commanderSpawnAt = 4.5;
  let oceanCommanderSpawnAt = 4.5;
  for (const grp of w.spawns) {
    const isBossGrp = isBossEnemy(grp.type);
    if (soloBossWave && !isBossGrp && !isEliteEnemy(grp.type)) continue;
    // 2026 v2 — stagger FLYER releases by >=1s each so air groups arrive in a
    // readable trickle instead of a swarm (per design feedback).
    const isFlyerGrp = !!(enemiesData as any)[grp.type]?.isFlyer && !isBossGrp;
    for (let i = 0; i < grp.count; i++) {
      const commander = isCommanderType(grp.type);
      const ocean = !!(grp as any).ocean;
      const spacing = isFlyerGrp ? Math.max(WAVE.SPAWN_INTERVAL, 1.0) : WAVE.SPAWN_INTERVAL;
      const spawnAt = ocean
        ? (commander ? Math.max(oceanT, oceanT > 0 ? oceanCommanderSpawnAt : 0) : oceanT)
        : (commander ? commanderSpawnAt : t);
      state.spawnQueue.push({
        type: grp.type,
        spawnAt,
        ocean,
        oceanIndex: ocean ? oceanSpawnIndex++ : undefined
      });
      if (commander) {
        if (ocean) oceanCommanderSpawnAt += 1.3;
        else commanderSpawnAt += 1.3;
      }
      if (ocean) oceanT += spacing;
      else t += spacing;
    }
  }
  sortSpawnQueue(state.spawnQueue);
  // 20-WAVE CAMPAIGN: Iron Phalanx now has a single dedicated appearance at
  // W17 (the wave's spawns already list the phalanx group in waves.json so
  // we no longer append a separate tail here — wave 17 is type 'M' and the
  // Phalanx units come through normal spawn processing).
  // 2026-05-17 — TWIN/AMBUSH BOSS RNG REMOVED FROM CAMPAIGN.
  // Per user direction: the 20-wave campaign is now fully deterministic
  // for boss spawns. No random twin-boss roll on W15 (was 25%), no
  // random ambush-boss roll on W17-W19 (was 15%). The campaign reads
  // exactly the same every run; players can plan around a known
  // schedule instead of getting blindsided.
  const bonusBossType: string | null = null;
  const bonusReason = '';
  // BOSS REBIRTH: any boss that leaked to Rome on a prior wave returns at
  // the opening of the next wave with its carried HP. The old schedule
  // appended these bosses after the complete authored roster, which could
  // delay a return deep into dense waves. `rebornBoss` gives opening spawns
  // priority over an authored t=0 spawn and makes HP carry assignment exact.
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
    for (let i = 0; i < respawnQueue.length; i++) {
      const entry = respawnQueue[i];
      state.spawnQueue.push({
        type: entry.type as EnemyType,
        spawnAt: i * REBORN_BOSS_OPENING_GAP_SECONDS,
        rebornBoss: true
      });
      carry.push(entry);
    }
    (state as any).__pendingBossCarry = carry;
    state.bossRespawnQueue = [];
    (state as any).pendingRebornBosses = respawnQueue.length;     // banner hook for main.ts
    sortSpawnQueue(state.spawnQueue);
  }
  if (bonusBossType && (enemiesData as any)[bonusBossType]) {
    // Append the bonus boss LAST in the queue so the "last-boss-in-queue"
    // tag in tickSpawns finds it (not a reborn boss).
    state.spawnQueue.push({ type: bonusBossType as EnemyType, spawnAt: t + 2.5 });
    (state as any).pendingBonusBoss = bonusReason;
  }
  if (isBossWave) injectBossEscortCommanders(state, state.spawnQueue);
  injectCampaignCommanders(state, state.spawnQueue);
  // 2026-07-05 — Cave B is now a true second ground gate. Once it opens,
  // every authored ground non-boss spawn is mirrored so Gate A and Gate B
  // each emit the same count. Bosses and flyers keep their special routes.
  mirrorGroundSpawnsToCaveB(state);
  if (state.spawnQueue.some(item => item.ocean)) {
    (state as any).__oceanWarningWave = state.wave;
    (state as any).__oceanWarningUntil = state.tick + 7.5;
  }
  state.enemiesKilledThisWave = 0;
  state.enemiesLeakedThisWave = 0;
  (state as any).carriedEnemiesThisWave = state.enemies.size;
  (state as any).totalEnemiesThisWave = state.spawnQueue.length + state.enemies.size;
  state.phase = GamePhase.WAVE_PHASE;
  prepareHeroAbilitiesForWave(state);
  // Set faction weather (boss waves intensify by 50%).
  state.weatherKey = w.faction;
  state.weatherIntensity = w.type === 'B' ? 1.5 : 1.0;
  // Boss hazards removed 2026-05 — kept the field zero'd so any leftover
  // renderer code reads null and bails.
  (state as any).bossHazardKey = null;
  // 2026-05-17 — WAVE MODIFIER RNG REMOVED FROM CAMPAIGN.
  // Per user direction the 30%-from-W3 wave-modifier roll (Blood Moon /
  // Storm Surge / Death Pact / Veil / Revenant / Group March) is no
  // longer fired during the 20-wave campaign. The campaign is now
  // 100% deterministic — same waves, same enemies, same difficulty
  // every run. RNG mechanics are reserved for Endless mode where the
  // procedural wave generator already handles its own variability.
  // Stamping null here clears any stale value carried over from a
  // prior wave or game-reset path.
  state.waveModifier = null;
  state.endlessExtraModifiers = [];
  state.waveModifierTick = 0;
  const carry = state.enemies.size > 0 ? ` ${state.enemies.size} enemies carried over.` : '';
  state.hint = `Wave ${state.wave} — ${w.faction}.${carry}`;
  // 2026-05-16 — SURPRISE EVENTS (Invasion + Skeletal Uprising). Fires
  // 8 seconds into the wave if SURPRISE_EVENT_SCHEDULE matches. Cooldown
  // gates inside the helper; W7 / W11 / W14 / W18 are the campaign hits.
  maybeTriggerSurpriseEventForWave(state);
  // Elephant dust shields and tower-slow auras become oppressive when event
  // bursts or Cave B release several elephants together. Apply this after all
  // campaign queue transformations so every elephant enters at least 2s apart.
  staggerElephantSpawns(state.spawnQueue);
  // Elephant pacing owns its own chronological sort. Re-apply the shared
  // opening priority afterward so a reborn boss always wins a t=0 tie.
  sortSpawnQueue(state.spawnQueue);
  // Surprise events may append event-only elites after the authored wave
  // roster has been counted. Refresh the HUD denominator so Uprising giants
  // and dragons cannot drive "enemies remaining" below zero.
  (state as any).totalEnemiesThisWave = state.spawnQueue.length + state.enemies.size;
}

export function tickSpawns(state: GameStateShape, dt: number) {
  if (state.phase !== GamePhase.WAVE_PHASE) return;
  // Wave 10.5 is a short scripted gauntlet. At 4x speed, or after any
  // unusually chunky frame, the old shared spawn clock could compress the
  // whole challenge into a tiny burst and look like it ended on its own.
  const spawnDt = state.testYourMightActive ? Math.min(dt, TEST_YOUR_MIGHT_MAX_SPAWN_DT) : dt;
  state.spawnElapsed += spawnDt;
  if (tickTestYourMightSpawns(state)) return;
  // 2026-05 v10 — ENDLESS MODE: route to a dedicated tick handler that
  // uses the procedurally-generated cfg's hpMult/speedMult/resistBoost.
  // Lets normal tickSpawns keep its waves.json-driven path untouched.
  if (state.endlessMode) {
    tickEndlessSpawns(state);
    return;
  }
  const w = wavesData[state.wave - 1];
  // Basic-enemy HP path (with the every-5-wave doubling). Elite threats use
  // their own smooth lane below so they cannot inherit trash-mob inflation.
  const basicHpMult = effectiveWaveHpMult(state.wave, w.hpMult, false);
  const bossWaveSoloBuff = (w.type === 'B' && state.wave <= 15) ? 2.0 : 1.0;     // early solo boss HP
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
    const isBossSpawn = isBossEnemy(item.type);
    const isEliteSpawn = isEliteEnemy(item.type) || isCommanderEnemy(item.type);
    const isFlyerSpawn = !!(enemiesData as any)[item.type]?.isFlyer;
    // LAYERED LATE-GAME HP UPLIFT — single source of truth in
    // `lateGameLayerMult` (W7 / W10 / W11 / W15 breakpoints all live
    // there). The preview-side path uses the same helper so spawn HP
    // and Codex preview HP can never drift apart again.
    const layerMult = lateGameLayerMult(state.wave, isBossSpawn, isFlyerSpawn);
    const spawnHpMult = (isBossSpawn
      ? effectiveWaveHpMult(state.wave, w.hpMult, true) * bossWaveSoloBuff
      : isEliteSpawn
        ? effectiveWaveHpMult(state.wave, w.hpMult, false, true)
      : basicHpMult) * layerMult;
    // 2026-07-05 — Cave B route is now explicit on the queue item. W21+
    // ground non-boss groups are mirrored at wave start so both gates emit
    // equal counts instead of splitting one shared count.
    const fromCaveB = !!item.caveB && !isBossSpawn && !isFlyerSpawn && state.groundPathB.length > 0;
    // Reveal the second cave the instant its first enemy actually emerges
    // (the renderer reads this to un-hide the archway + fire the eruption).
    if (fromCaveB) state.caveBActive = true;
    const e = spawnEnemy(state, item.type as EnemyType, spawnHpMult, false, fromCaveB);
    const fromOcean = !!item.ocean;
    if (fromOcean) routeOceanSpawnToPath(state, e, item.oceanIndex ?? 0);
    if (item.bossEscort) {
      (e as any).__bossEscortCommander = true;
      // W5 introduces boss-escort commanders early. Keep them present as
      // priority targets, but soften their final health by 10% so Brennus's
      // first boss wave does not over-punish fresh Solo builds.
      if (state.wave === 5) {
        e.maxHp *= 0.9;
        e.hp *= 0.9;
      }
    }
    // 2026-06-23 — W9 war elephants teach checkpoint healing before the
    // Hannibal boss wave. Keep that sustain wave-scoped.
    //
    // 2026-07-05 — W9/W10 escort elephants are boss-class combat threats,
    // but not legendary trophy bosses. Hannibal is the W10 legendary drop.
    if (state.wave === 9 && item.type === EnemyType.WAR_ELEPHANT) {
      e.checkpointHealPct = 0.08;
    }
    if ((state.wave === 9 || state.wave === 10) && item.type === EnemyType.WAR_ELEPHANT) {
      e.rareDropOnly = true;
    }
    // 2026-05-17 — Surprise event waveOverride: redirect this enemy to
    // spawn at a perimeter fire (Invasion) or center urn (Uprising)
    // instead of the cave. Round-robin across the 4 visual points so
    // all four stay active. Bosses skip the redirect — boss waves
    // never coincide with surprise events anyway, but defensive guard.
    // 2026-05-19 — FLYERS ALSO SKIP. The redirect sets pathIndex against
    // state.groundPath, but the path-follow loop reads flyer pathIndex
    // against state.flyerPath. Since the ground path is much longer than
    // the flyer path, the resolved ground index typically exceeds
    // flyerPath.length-1, which trips the gate-leak check on the very
    // first move tick — every flyer leaks INSTANTLY on spawn, draining
    // lives before any combat. W14 (Uprising + 8 SPECTRAL_SCOUTs)
    // produced the auto-death this guard fixes. Flyers now always
    // spawn from the normal flyer cave entry regardless of any active
    // surprise event.
    if (item.uprisingDragon && isFlyerSpawn) {
      spawnUprisingDragonAtEventPoint(state, e);
    } else if (!isBossSpawn && !isFlyerSpawn && !fromCaveB && !fromOcean) {
      spawnAtSurpriseEventPoint(state, e, surpriseSpawnIdx);
      surpriseSpawnIdx++;
    }
    // WAVE 1 EXCEPTION: every enemy that spawns on wave 1 is pinned to
    // a flat ~350 HP regardless of baseHp / hpMult / per-wave /
    // boss-cleared scaling. The pin makes W1 deterministic so the
    // calibration wave doesn't accidentally jump every time we tune
    // FERAL_DOG's baseHp.
    //
    // 2026-05-23 — Pin raised 100 → 350 (hero) / 300 (no hero) per user
    // feedback that the original 100 HP felt trivially easy. The user
    // walked it up across a few sessions: 150 → 300 → 350. Hero-comp
    // +15% still factors so the wave-preview chip stays in sync.
    if (state.wave === 1) {
      const w1Hp = state.activeHeroId ? 350 : 300;
      e.maxHp = w1Hp;
      e.hp = w1Hp;
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
      if (item.rebornBoss && carry && carry.length > 0) {
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
      if (state.spawnQueue.filter(s => isBossEnemy(s.type)).length === 0) {
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
  if (state.testYourMightFailed) return;
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
    for (const tower of state.towers.values()) tower.attackFlash = 0;
    if (state.testYourMightActive) {
      completeTestYourMight(state);
      onWaveEnd(0);
      return;
    }
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
    state.endlessExtraModifiers = [];
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
    // player cleared the wave, pay a generous bonus on top of the
    // standard wave gold. The old run-points counter remains telemetry only;
    // it does not affect the authoritative leaderboard score. Players also
    // get a free Uncommon item on launch (see main.ts launchWave).
    let modBonus = 0;
    let modScoreBonus = 0;
    if (state.waveModifier) {
      state.modifierWavesSurvived = (state.modifierWavesSurvived ?? 0) + 1;
      modBonus = 60;
      modScoreBonus = 4000;
      state.gold += modBonus;
      state.score = (state.score ?? 0) + modScoreBonus;
      // Transient flag so main.ts can fire a celebration banner this
      // frame. Cleared by the wave-end callback after the banner shows.
      (state as any).__modifierJustSurvived = state.waveModifier;
    }
    // 2026-05-19 — FLYER WAVE PAYOUT BONUS. Flyer waves (W6, W12, W18)
    // are the hardest wave type because they bypass maze chokepoints
    // entirely. Players who invest in dedicated anti-air (Storm
    // Javelin, Flyer Bane, ranged pool, Aquila Talons, Hadrian if the
    // hero system is in) deserve a meaningful payout. +50% rounded
    // bonus on top of the authored w.gold so each flyer wave pays
    // ~1.5× a same-difficulty ground wave.
    let flyerBonus = 0;
    if (w.type === 'F') {
      flyerBonus = Math.max(5, Math.round(w.gold * 0.5));
    }
    const totalWaveGold = Math.round((w.gold + flyerBonus) * campaignRelicWaveGoldMult(state));
    const modSuffix = modBonus > 0 ? ` +${modBonus}g RNG bonus.` : '';
    const flyerSuffix = flyerBonus > 0 ? ` +${flyerBonus}g Flyer-Survival bonus.` : '';
    state.hint = `Wave ${state.wave} survived. +${totalWaveGold} Gold.${flyerSuffix}${modSuffix} The empire pretends not to be impressed.`;
    grantWave20TrapGift(state);
    // Clear weather + modifier — sky clears between waves.
    state.weatherKey = null;
    state.weatherIntensity = 1;
    state.waveModifier = null;
    state.endlessExtraModifiers = [];
    (state as any).bloodMoonHpMult = 1;
    (state as any).__surpriseSpawnRoundIdx = 0;
    // 2026-05-17 — Surprise event wave clear path. notifySurpriseEventWaveEnded
    // sets pendingSurpriseReward IF the event was in waveOverride mode AND
    // the player survived. The active event stays alive until the reward
    // modal closes (main.ts re-fires clearSurpriseEventsForWaveEnd there).
    // Otherwise we clear immediately like before.
    notifySurpriseEventWaveEnded(state);
    if (!state.pendingSurpriseReward) clearSurpriseEventsForWaveEnd(state);
    onWaveEnd(totalWaveGold);   // callback may override phase (e.g. VICTORY)
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
  staggerElephantSpawns(state.spawnQueue);
  state.enemiesKilledThisWave = 0;
  state.enemiesLeakedThisWave = 0;
  (state as any).carriedEnemiesThisWave = state.enemies.size;
  (state as any).totalEnemiesThisWave = state.spawnQueue.length + state.enemies.size;
  // Stash the cfg so spawnEnemy / pre-wave brief / scoring can read it.
  (state as any).__endlessWaveCfg = cfg;
  state.phase = GamePhase.WAVE_PHASE;
  prepareHeroAbilitiesForWave(state);
  // 2026-05-20 — ENDLESS MODIFIER ROLL. The campaign's modifier RNG was
  // dormant (intentionally — campaign is deterministic). Endless now
  // activates it with stacking: 1 modifier at E1-3, 2 at E4-7, 3 at
  // E8+. Picks are unique across the stack so no Blood Moon × Blood
  // Moon. First pick lands on `state.waveModifier` for backward compat
  // with existing reactive code (CombatResolver, EnemySystem, render);
  // any extras live in `state.endlessExtraModifiers` and are honored
  // by the same code paths via the iterateActiveModifiers helper.
  const modCount = cfg.endlessIdx >= 8 ? 3 : cfg.endlessIdx >= 4 ? 2 : 1;
  const pool = WAVE_MODIFIERS.map(m => m.key);
  const picks: string[] = [];
  for (let i = 0; i < modCount && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picks.push(pool.splice(idx, 1)[0]);
  }
  state.waveModifier = picks[0] ?? null;
  state.endlessExtraModifiers = picks.slice(1);
  state.waveModifierTick = 0;
  // BLOOD_MOON applies a +25% HP scalar at spawn time. The reactive
  // code in EnemySystem.spawnEnemy reads `state.bloodMoonHpMult`, so
  // we stamp 1.25 here when BLOOD_MOON is in the active set. Cleared
  // back to 1.0 in checkWaveEnd.
  (state as any).bloodMoonHpMult = picks.includes('BLOOD_MOON') ? 1.25 : 1;
  // 2026-05-20 — Endless surprise event rate cranked. Was 25% with a
  // 3-wave cooldown; now ~75% with a 2-wave cooldown so the outskirts-
  // invasion lands almost every Endless wave (user direction: invade
  // from the perimeter, not the cave). Cooldown still gates back-to-
  // backs so the player gets one quiet wave to recover after each
  // chaotic one.
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
    const isBossSpawn = isBossEnemy(item.type);
    const isEliteSpawn = isEliteEnemy(item.type) || isCommanderEnemy(item.type);
    const isFlyerSpawn = !!(enemiesData as any)[item.type]?.isFlyer;
    // Compose a wave-curve mult for the W20 baseline THEN multiply by
    // the Endless hpMult on top.
    const baseLineMult = effectiveWaveHpMult(20, 1.0, isBossSpawn, isEliteSpawn);
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
