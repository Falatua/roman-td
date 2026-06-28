import { GameStateShape } from '../GameState';
import { GamePhase } from '../types';
import { spawnEnemy } from './EnemySystem';
import { prepareHeroAbilitiesForWave } from './HeroSystem';
import { TEST_YOUR_MIGHT_AFTER_WAVE, TEST_YOUR_MIGHT_DISPLAY_WAVE } from './TestYourMightLabels';

export const TEST_YOUR_MIGHT_REWARD_GOLD = 3000;
export const TEST_YOUR_MIGHT_REWARD_RARITY = 'LEGENDARY' as const;
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
  // The challenge now sits above the W15/W16 band: bigger mixed density,
  // stacked wave modifiers, all commander auras, and challenge-only
  // resistance stamps. Only Hannibal is marked as the scheduled reward
  // boss so the run still pays exactly one randomized Legendary item.
  { type: 'HANNIBAL_BARCA', count: 1, gap: 0, start: 0.0, hpMult: 70, speedMult: 1.11, majorReward: true, resistMult: 0.74, statusGuard: 0.25, rangedBlock: 0.18, checkpointHeal: 0.08, outOfCombatRegen: 0.045 },
  { type: 'BOSS_FLYER_VULTURE', count: 1, gap: 0, start: 1.8, hpMult: 20, speedMult: 1.15, resistMult: 0.72, statusGuard: 0.30, rangedBlock: 0.16, outOfCombatRegen: 0.035 },
  { type: 'UNDEAD_WAR_ELEPHANT', count: 2, gap: 3.4, start: 3.0, hpMult: 42, speedMult: 1.09, resistMult: 0.70, statusGuard: 0.28, rangedBlock: 0.20, checkpointHeal: 0.12, outOfCombatRegen: 0.04 },
  { type: 'WAR_ELEPHANT', count: 3, gap: 2.8, start: 4.0, hpMult: 48, speedMult: 1.11, resistMult: 0.72, statusGuard: 0.32, rangedBlock: 0.18, checkpointHeal: 0.12, outOfCombatRegen: 0.04 },
  { type: 'NUMIDIAN_RIDER', count: 14, gap: 0.58, start: 4.7, hpMult: 438, speedMult: 1.25, resistMult: 0.78, statusGuard: 0.42, rangedBlock: 0.12 },
  { type: 'CARTHAGE_SPEARMAN', count: 42, gap: 0.30, start: 5.2, hpMult: 388, speedMult: 1.17, resistMult: 0.78, statusGuard: 0.45, rangedBlock: 0.14, checkpointHeal: 0.08 },
  { type: 'CARTHAGE_ELITE_GUARD', count: 22, gap: 0.42, start: 8.8, hpMult: 425, speedMult: 1.14, resistMult: 0.72, statusGuard: 0.35, rangedBlock: 0.22, checkpointHeal: 0.10, outOfCombatRegen: 0.045, mutation: 'WARDED' },
  { type: 'IRON_PHALANX', count: 8, gap: 0.78, start: 12.8, hpMult: 48, speedMult: 1.07, resistMult: 0.70, statusGuard: 0.30, checkpointHeal: 0.10, outOfCombatRegen: 0.035 },
  { type: 'PATHFINDER_COMMANDER', count: 1, gap: 0, start: 7.0, hpMult: 312, speedMult: 1.13, resistMult: 0.72, statusGuard: 0.35, rangedBlock: 0.14, mutation: 'AURA_STAR' },
  { type: 'STANDARD_BEARER_COMMANDER', count: 1, gap: 0, start: 10.8, hpMult: 288, speedMult: 1.07, resistMult: 0.70, statusGuard: 0.30, rangedBlock: 0.16, outOfCombatRegen: 0.035 },
  { type: 'SIEGE_CAPTAIN_COMMANDER', count: 1, gap: 0, start: 14.4, hpMult: 281, speedMult: 1.05, resistMult: 0.70, statusGuard: 0.32, rangedBlock: 0.18, outOfCombatRegen: 0.035 },
  { type: 'ANUBIS_PRIEST_COMMANDER', count: 1, gap: 0, start: 18.0, hpMult: 294, speedMult: 1.09, resistMult: 0.68, statusGuard: 0.28, rangedBlock: 0.16, outOfCombatRegen: 0.04 },
  { type: 'SPECTRAL_SCOUT', count: 12, gap: 0.58, start: 15.0, hpMult: 481, speedMult: 1.25, resistMult: 0.76, statusGuard: 0.28, rangedBlock: 0.12, mutation: 'WARDED' },
  { type: 'SHADOW_CAVALRY', count: 8, gap: 0.72, start: 19.5, hpMult: 450, speedMult: 1.23, resistMult: 0.74, statusGuard: 0.25, rangedBlock: 0.14, mutation: 'WARDED' },
  { type: 'ANUBIS_KING', count: 1, gap: 0, start: 26.0, hpMult: 30, speedMult: 1.11, resistMult: 0.66, statusGuard: 0.22, rangedBlock: 0.20, checkpointHeal: 0.08, outOfCombatRegen: 0.045 }
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
  state.testYourMightActive = false;
  state.hint = 'Test Your Might declined. The Senate pretends this was wisdom.';
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
  state.testYourMightActive = true;
  state.testYourMightCleared = false;
  state.testYourMightFailed = false;
  state.spawnQueue = [];
  state.spawnElapsed = 0;
  state.enemiesKilledThisWave = 0;
  state.enemiesLeakedThisWave = 0;
  (state as any).carriedEnemiesThisWave = state.enemies.size;

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
  state.weatherIntensity = 1.85;
  state.waveModifier = 'GROUP_MARCH';
  state.endlessExtraModifiers = ['STORM_SURGE', 'VEIL', 'DEATH_PACT'];
  state.waveModifierTick = 0;
  state.hint = `WAVE ${TEST_YOUR_MIGHT_DISPLAY_WAVE} — TEST YOUR MIGHT! One leak ends the run. Perfect clear pays 3000g and a free Tier-5 Scorpio. The wave cheats tastefully.`;
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
  state.hint = `WAVE ${TEST_YOUR_MIGHT_DISPLAY_WAVE} cleared perfectly. +${TEST_YOUR_MIGHT_REWARD_GOLD}g and a free Tier-5 Scorpio. Rome is acting very normal about this.`;
  return true;
}

export function failTestYourMight(state: GameStateShape): void {
  if (!state.testYourMightActive) return;
  state.testYourMightActive = false;
  state.testYourMightFailed = true;
  state.lives = 0;
  if (state.gameOverAt < 0) state.gameOverAt = state.tick;
  state.hint = `WAVE ${TEST_YOUR_MIGHT_DISPLAY_WAVE} failed. One got through. The Senate has chosen screaming.`;
}
