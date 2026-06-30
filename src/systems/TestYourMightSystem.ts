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
  // The challenge now sits around the W15/W16 band: mixed density, boss
  // pressure, all commander auras, and challenge-only resistance stamps,
  // but with a prep window after accepting. Only Hannibal is marked as the
  // scheduled reward boss so the run still pays exactly one randomized
  // Legendary item.
  { type: 'HANNIBAL_BARCA', count: 1, gap: 0, start: 0.0, hpMult: 58, speedMult: 1.07, majorReward: true, resistMult: 0.80, statusGuard: 0.38, rangedBlock: 0.12, checkpointHeal: 0.05, outOfCombatRegen: 0.025 },
  { type: 'BOSS_FLYER_VULTURE', count: 1, gap: 0, start: 2.0, hpMult: 16, speedMult: 1.10, resistMult: 0.80, statusGuard: 0.40, rangedBlock: 0.10, outOfCombatRegen: 0.02 },
  { type: 'UNDEAD_WAR_ELEPHANT', count: 1, gap: 3.4, start: 3.8, hpMult: 34, speedMult: 1.04, resistMult: 0.78, statusGuard: 0.40, rangedBlock: 0.12, checkpointHeal: 0.08, outOfCombatRegen: 0.025 },
  { type: 'WAR_ELEPHANT', count: 2, gap: 3.0, start: 5.0, hpMult: 38, speedMult: 1.06, resistMult: 0.80, statusGuard: 0.42, rangedBlock: 0.12, checkpointHeal: 0.08, outOfCombatRegen: 0.025 },
  { type: 'NUMIDIAN_RIDER', count: 10, gap: 0.62, start: 5.8, hpMult: 350, speedMult: 1.17, resistMult: 0.84, statusGuard: 0.55, rangedBlock: 0.08 },
  { type: 'CARTHAGE_SPEARMAN', count: 34, gap: 0.34, start: 6.2, hpMult: 315, speedMult: 1.10, resistMult: 0.84, statusGuard: 0.56, rangedBlock: 0.09, checkpointHeal: 0.05 },
  { type: 'CARTHAGE_ELITE_GUARD', count: 16, gap: 0.48, start: 10.2, hpMult: 340, speedMult: 1.08, resistMult: 0.80, statusGuard: 0.48, rangedBlock: 0.14, checkpointHeal: 0.06, outOfCombatRegen: 0.025, mutation: 'WARDED' },
  { type: 'IRON_PHALANX', count: 6, gap: 0.84, start: 14.8, hpMult: 38, speedMult: 1.03, resistMult: 0.78, statusGuard: 0.42, checkpointHeal: 0.06, outOfCombatRegen: 0.02 },
  { type: 'PATHFINDER_COMMANDER', count: 1, gap: 0, start: 8.4, hpMult: 245, speedMult: 1.08, resistMult: 0.80, statusGuard: 0.48, rangedBlock: 0.10, mutation: 'AURA_STAR' },
  { type: 'STANDARD_BEARER_COMMANDER', count: 1, gap: 0, start: 12.4, hpMult: 230, speedMult: 1.04, resistMult: 0.78, statusGuard: 0.44, rangedBlock: 0.10, outOfCombatRegen: 0.02 },
  { type: 'SIEGE_CAPTAIN_COMMANDER', count: 1, gap: 0, start: 16.4, hpMult: 225, speedMult: 1.03, resistMult: 0.78, statusGuard: 0.45, rangedBlock: 0.12, outOfCombatRegen: 0.02 },
  { type: 'ANUBIS_PRIEST_COMMANDER', count: 1, gap: 0, start: 20.0, hpMult: 235, speedMult: 1.05, resistMult: 0.76, statusGuard: 0.42, rangedBlock: 0.10, outOfCombatRegen: 0.025 },
  { type: 'SPECTRAL_SCOUT', count: 9, gap: 0.64, start: 17.0, hpMult: 385, speedMult: 1.17, resistMult: 0.82, statusGuard: 0.42, rangedBlock: 0.08, mutation: 'WARDED' },
  { type: 'SHADOW_CAVALRY', count: 6, gap: 0.78, start: 22.0, hpMult: 360, speedMult: 1.16, resistMult: 0.80, statusGuard: 0.40, rangedBlock: 0.10, mutation: 'WARDED' },
  { type: 'ANUBIS_KING', count: 1, gap: 0, start: 29.0, hpMult: 24, speedMult: 1.06, resistMult: 0.76, statusGuard: 0.38, rangedBlock: 0.12, checkpointHeal: 0.05, outOfCombatRegen: 0.025 }
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
  state.hint = `WAVE ${TEST_YOUR_MIGHT_DISPLAY_WAVE} accepted. Prep your maze, traps, heroes, and anti-air, then press START when Rome is ready.`;
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
  state.weatherIntensity = 1.55;
  state.waveModifier = 'GROUP_MARCH';
  state.endlessExtraModifiers = ['STORM_SURGE', 'DEATH_PACT'];
  state.waveModifierTick = 0;
  state.hint = `WAVE ${TEST_YOUR_MIGHT_DISPLAY_WAVE} — TEST YOUR MIGHT! One leak ends the run. Perfect clear pays 3000g, a free Tier-5 Scorpio, and the boss Legendary.`;
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
