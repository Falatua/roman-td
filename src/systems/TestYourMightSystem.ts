import { GameStateShape } from '../GameState';
import { GamePhase } from '../types';
import { spawnEnemy } from './EnemySystem';
import { prepareHeroAbilitiesForWave } from './HeroSystem';
import { TEST_YOUR_MIGHT_AFTER_WAVE, TEST_YOUR_MIGHT_DISPLAY_WAVE } from './TestYourMightLabels';

export const TEST_YOUR_MIGHT_REWARD_GOLD = 3000;
export const TEST_YOUR_MIGHT_REWARD_RARITY = 'LEGENDARY' as const;
export const TEST_YOUR_MIGHT_MAX_SPAWN_DT = 1 / 30;
export { displayWaveNumber, TEST_YOUR_MIGHT_AFTER_WAVE, TEST_YOUR_MIGHT_DISPLAY_WAVE } from './TestYourMightLabels';

type TestYourMightMutation = 'WARDED' | 'AURA_STAR';
type TestYourMightSpawn = {
  type: string;
  count: number;
  gap: number;
  start?: number;
  hpMult: number;
  speedMult?: number;
  majorReward?: boolean;
  resistMult?: number;
  statusGuard?: number;
  rangedBlock?: number;
  checkpointHeal?: number;
  outOfCombatRegen?: number;
  mutation?: TestYourMightMutation;
};

export const TEST_YOUR_MIGHT_SPAWNS: TestYourMightSpawn[] = [
  // These are direct spawn multipliers, not authored wave hpMult values.
  // The challenge now sits around the W16/W17 band: ground-heavy boss
  // pressure, commander auras, and challenge-only resistance stamps,
  // but with a prep window after accepting. Only Hannibal is marked as the
  // scheduled reward boss so the run still pays exactly one randomized
  // Legendary item.
  { type: 'HANNIBAL_BARCA', count: 1, gap: 0, start: 0.0, hpMult: 75, speedMult: 1.04, majorReward: true, resistMult: 0.84, statusGuard: 0.46, rangedBlock: 0.08, checkpointHeal: 0.035, outOfCombatRegen: 0.018 },
  { type: 'UNDEAD_WAR_ELEPHANT', count: 1, gap: 3.4, start: 3.8, hpMult: 44, speedMult: 1.01, resistMult: 0.84, statusGuard: 0.48, rangedBlock: 0.08, checkpointHeal: 0.05, outOfCombatRegen: 0.018 },
  { type: 'WAR_ELEPHANT', count: 2, gap: 3.0, start: 5.0, hpMult: 45, speedMult: 1.02, resistMult: 0.84, statusGuard: 0.50, rangedBlock: 0.08, checkpointHeal: 0.05, outOfCombatRegen: 0.018 },
  { type: 'CELTIC_BERSERKER', count: 18, gap: 0.40, start: 6.2, hpMult: 405, speedMult: 1.04, resistMult: 0.88, statusGuard: 0.64, rangedBlock: 0.05, checkpointHeal: 0.035 },
  { type: 'CARTHAGE_ELITE_GUARD', count: 8, gap: 0.58, start: 10.2, hpMult: 428, speedMult: 1.03, resistMult: 0.86, statusGuard: 0.58, rangedBlock: 0.10, checkpointHeal: 0.04, outOfCombatRegen: 0.018, mutation: 'WARDED' },
  { type: 'IRON_PHALANX', count: 5, gap: 0.92, start: 14.8, hpMult: 48, speedMult: 1.0, resistMult: 0.84, statusGuard: 0.50, checkpointHeal: 0.04, outOfCombatRegen: 0.012 },
  { type: 'PATHFINDER_COMMANDER', count: 1, gap: 0, start: 8.4, hpMult: 315, speedMult: 1.04, resistMult: 0.86, statusGuard: 0.56, rangedBlock: 0.06, mutation: 'AURA_STAR' },
  { type: 'STANDARD_BEARER_COMMANDER', count: 1, gap: 0, start: 12.4, hpMult: 300, speedMult: 1.01, resistMult: 0.84, statusGuard: 0.52, rangedBlock: 0.06, outOfCombatRegen: 0.012 },
  { type: 'SIEGE_CAPTAIN_COMMANDER', count: 1, gap: 0, start: 16.4, hpMult: 293, speedMult: 1.0, resistMult: 0.84, statusGuard: 0.54, rangedBlock: 0.08, outOfCombatRegen: 0.012 },
  { type: 'ANUBIS_PRIEST_COMMANDER', count: 1, gap: 0, start: 20.0, hpMult: 308, speedMult: 1.02, resistMult: 0.82, statusGuard: 0.50, rangedBlock: 0.06, outOfCombatRegen: 0.018 },
  { type: 'ANUBIS_KING', count: 1, gap: 0, start: 29.0, hpMult: 30, speedMult: 1.03, resistMult: 0.82, statusGuard: 0.46, rangedBlock: 0.08, checkpointHeal: 0.035, outOfCombatRegen: 0.018 }
];

export function shouldOfferTestYourMight(state: GameStateShape): boolean {
  return state.wave === TEST_YOUR_MIGHT_AFTER_WAVE
    && state.lives > 0
    && state.gameOverAt < 0
    && state.phase !== GamePhase.GAME_OVER
    && !state.endlessMode
    && !state.testYourMightOffered
    && !state.testYourMightCleared
    && !state.testYourMightFailed;
}

export function declineTestYourMight(state: GameStateShape): void {
  state.testYourMightOffered = true;
  state.testYourMightDeclined = true;
  state.testYourMightAccepted = false;
  state.testYourMightActive = false;
  state.hint = 'Test Your Might declined. The Senate pretends this was wisdom.';
}

export function acceptTestYourMight(state: GameStateShape): void {
  if (state.phase === GamePhase.WAVE_PHASE
    || state.phase === GamePhase.GAME_OVER
    || state.phase === GamePhase.VICTORY) return;
  state.testYourMightOffered = true;
  state.testYourMightDeclined = false;
  state.testYourMightAccepted = true;
  state.testYourMightActive = false;
  state.testYourMightCleared = false;
  state.testYourMightFailed = false;
  state.hint = `WAVE ${TEST_YOUR_MIGHT_DISPLAY_WAVE} accepted. Prep your maze, traps, heroes, and ground killers, then press START when Rome is ready.`;
}

export function startTestYourMight(state: GameStateShape): void {
  // 2026-06-28 HARDENING: the accept button can resolve from any
  // non-combat phase — after a wave clears the run passes through the
  // build / prospecting sub-phases (PROSPECT_PLACEMENT, PICK_KEEPER)
  // before the player presses START. The old `phase !== BUILD_PHASE`
  // guard SILENTLY no-opped the accept whenever the phase had drifted,
  // so "YES, TEST ME" did nothing and the player slid straight into
  // Wave 11 instead of the bonus Wave 10.5. Only refuse to launch if a
  // wave is already live or the run is already decided.
  if (state.phase === GamePhase.WAVE_PHASE
    || state.phase === GamePhase.GAME_OVER
    || state.phase === GamePhase.VICTORY) return;
  if (state.testYourMightActive) return;   // never double-launch
  state.testYourMightOffered = true;
  state.testYourMightDeclined = false;
  state.testYourMightAccepted = false;
  state.testYourMightActive = true;
  state.testYourMightCleared = false;
  state.testYourMightFailed = false;
  (state as any).__testYourMightLegendaryDrops = 0;
  // W10.5 must be a clean, opt-in challenge. If any stale enemy, projectile,
  // or surprise-event route survived the W10 end flow, it must not be able to
  // leak and fail the bonus before the authored gauntlet begins.
  state.enemies.clear();
  state.projectiles.length = 0;
  state.activeSurpriseEvent = null;
  state.extraSurpriseEvents = [];
  state.surpriseEventScars = [];
  (state as any).__surpriseSpawnRoundIdx = 0;
  state.spawnQueue = [];
  state.spawnElapsed = 0;
  state.enemiesKilledThisWave = 0;
  state.enemiesLeakedThisWave = 0;
  (state as any).carriedEnemiesThisWave = 0;

  for (const group of TEST_YOUR_MIGHT_SPAWNS) {
    const start = group.start ?? 0;
    for (let i = 0; i < group.count; i++) {
      state.spawnQueue.push({
        type: group.type,
        spawnAt: start + i * group.gap,
        __testYourMightHpMult: group.hpMult,
        __testYourMightSpeedMult: group.speedMult ?? 1,
        __testYourMightMajorReward: group.majorReward === true,
        __testYourMightResistMult: group.resistMult,
        __testYourMightStatusGuard: group.statusGuard,
        __testYourMightRangedBlock: group.rangedBlock,
        __testYourMightCheckpointHeal: group.checkpointHeal,
        __testYourMightOocRegen: group.outOfCombatRegen,
        __testYourMightMutation: group.mutation
      } as any);
    }
  }
  state.spawnQueue.sort((a, b) => a.spawnAt - b.spawnAt);
  (state as any).totalEnemiesThisWave = state.spawnQueue.length + state.enemies.size;
  (state as any).__waveStartTick = state.tick;
  state.phase = GamePhase.WAVE_PHASE;
  state.weatherKey = 'CARTHAGE';
  state.weatherIntensity = 1.35;
  state.waveModifier = 'GROUP_MARCH';
  state.endlessExtraModifiers = ['STORM_SURGE'];
  state.waveModifierTick = 0;
  state.hint = `WAVE ${TEST_YOUR_MIGHT_DISPLAY_WAVE} — TEST YOUR MIGHT! One leak ends the run. Perfect clear pays 3000g, a free Tier-5 Colossus Onager, and the boss Legendary.`;
  prepareHeroAbilitiesForWave(state);
}

export function tickTestYourMightSpawns(state: GameStateShape): boolean {
  if (!state.testYourMightActive || state.phase !== GamePhase.WAVE_PHASE) return false;
  while (state.spawnQueue.length > 0 && state.spawnQueue[0].spawnAt <= state.spawnElapsed) {
    const item: any = state.spawnQueue.shift()!;
    const e = spawnEnemy(state, item.type as any, item.__testYourMightHpMult ?? 1, false, false);
    const speedMult = item.__testYourMightSpeedMult ?? 1;
    e.baseSpeed *= speedMult;
    e.currentSpeed = e.baseSpeed;
    if (e.isBoss) e.isScheduledBoss = item.__testYourMightMajorReward === true;
    (e as any).__testYourMightEnemy = true;
    (e as any).__testYourMightNoStealth = true;
    (e as any).__veiled = false;
    (e as any).__truesightRevealed = true;
    if (typeof item.__testYourMightResistMult === 'number') {
      (e as any).__lateResistMult = ((e as any).__lateResistMult ?? 1) * item.__testYourMightResistMult;
    }
    if (typeof item.__testYourMightStatusGuard === 'number') {
      (e as any).__lateStatusGuard = Math.min((e as any).__lateStatusGuard ?? 1, item.__testYourMightStatusGuard);
    }
    if (typeof item.__testYourMightRangedBlock === 'number') {
      (e as any).__lateRangedBlock = Math.max((e as any).__lateRangedBlock ?? 0, item.__testYourMightRangedBlock);
    }
    if (typeof item.__testYourMightCheckpointHeal === 'number' && !e.isFlyer) {
      e.checkpointHealPct = Math.max(e.checkpointHealPct ?? 0, item.__testYourMightCheckpointHeal);
    }
    if (typeof item.__testYourMightOocRegen === 'number') {
      (e as any).outOfCombatRegen = Math.max((e as any).outOfCombatRegen ?? 0, item.__testYourMightOocRegen);
    }
    if (item.__testYourMightMutation === 'WARDED' || item.__testYourMightMutation === 'AURA_STAR') {
      e.mutation = item.__testYourMightMutation;
    }
  }
  return true;
}

export function isTestYourMightLeakEnemy(enemy: any): boolean {
  return !!enemy?.__testYourMightEnemy;
}

export function shouldDeferSurpriseRewardForTestYourMight(state: GameStateShape): boolean {
  if (state.wave !== TEST_YOUR_MIGHT_AFTER_WAVE) return false;
  if (state.testYourMightDeclined || state.testYourMightCleared || state.testYourMightFailed) return false;
  return !!(state as any).__testYourMightOpen
    || !!state.testYourMightAccepted
    || !!state.testYourMightActive;
}

export function completeTestYourMight(state: GameStateShape): boolean {
  if (!state.testYourMightActive) return false;
  state.testYourMightActive = false;
  state.testYourMightCleared = true;
  state.testYourMightFailed = false;
  state.phase = GamePhase.BUILD_PHASE;
  state.weatherKey = null;
  state.weatherIntensity = 1;
  state.waveModifier = null;
  state.endlessExtraModifiers = [];
  state.waveModifierTick = 0;
  state.hint = `WAVE ${TEST_YOUR_MIGHT_DISPLAY_WAVE} cleared perfectly. +${TEST_YOUR_MIGHT_REWARD_GOLD}g and a free Tier-5 Colossus Onager. Rome is acting very normal about this.`;
  return true;
}

export function failTestYourMight(state: GameStateShape, leakedEnemyName?: string): void {
  if (!state.testYourMightActive) return;
  state.testYourMightActive = false;
  state.testYourMightFailed = true;
  state.lives = 0;
  if (state.gameOverAt < 0) state.gameOverAt = state.tick;
  const culprit = leakedEnemyName?.trim()
    ? `${leakedEnemyName.trim()} reached Rome.`
    : 'One got through.';
  state.hint = `WAVE ${TEST_YOUR_MIGHT_DISPLAY_WAVE} failed. ${culprit} One leak ends Test Your Might.`;
}
