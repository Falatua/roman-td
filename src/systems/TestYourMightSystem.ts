import { GameStateShape } from '../GameState';
import { GamePhase } from '../types';
import { spawnEnemy } from './EnemySystem';
import { prepareHeroAbilitiesForWave } from './HeroSystem';

export const TEST_YOUR_MIGHT_REWARD_GOLD = 2000;
export const TEST_YOUR_MIGHT_AFTER_WAVE = 10;
export const TEST_YOUR_MIGHT_REWARD_RARITY = 'LEGENDARY' as const;

export const TEST_YOUR_MIGHT_SPAWNS: { type: string; count: number; gap: number; start?: number; hpMult: number; speedMult?: number; majorReward?: boolean }[] = [
  // These are direct spawn multipliers, not authored wave hpMult values.
  // Normal W15/W16 scaling enters EnemySystem near 250x to 700x after
  // global and late-game layers. Test Your Might sits near the W15 band,
  // then adds mixed bosses, flyers, commanders, weather, and one-leak death.
  { type: 'HANNIBAL_BARCA', count: 1, gap: 0, start: 0.0, hpMult: 42, speedMult: 1.02, majorReward: true },
  { type: 'WAR_ELEPHANT', count: 2, gap: 2.4, start: 2.2, hpMult: 30, speedMult: 1.02 },
  { type: 'NUMIDIAN_RIDER', count: 10, gap: 0.9, start: 3.2, hpMult: 285, speedMult: 1.14 },
  { type: 'CARTHAGE_SPEARMAN', count: 34, gap: 0.42, start: 4.0, hpMult: 235, speedMult: 1.08 },
  { type: 'CARTHAGE_ELITE_GUARD', count: 16, gap: 0.62, start: 7.4, hpMult: 265, speedMult: 1.06 },
  { type: 'PATHFINDER_COMMANDER', count: 1, gap: 0, start: 8.5, hpMult: 190, speedMult: 1.02 },
  { type: 'SIEGE_CAPTAIN_COMMANDER', count: 1, gap: 0, start: 13.6, hpMult: 165, speedMult: 1.0 },
  { type: 'SPECTRAL_SCOUT', count: 8, gap: 1.0, start: 15.0, hpMult: 305, speedMult: 1.12 },
  { type: 'ANUBIS_KING', count: 1, gap: 0, start: 23.0, hpMult: 18, speedMult: 1.0 }
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
  if (state.phase !== GamePhase.BUILD_PHASE) return;
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
        __testYourMightMajorReward: group.majorReward === true
      } as any);
    }
  }
  state.spawnQueue.sort((a, b) => a.spawnAt - b.spawnAt);
  (state as any).totalEnemiesThisWave = state.spawnQueue.length + state.enemies.size;
  (state as any).__waveStartTick = state.tick;
  state.phase = GamePhase.WAVE_PHASE;
  state.weatherKey = 'CARTHAGE';
  state.weatherIntensity = 1.5;
  state.waveModifier = 'GROUP_MARCH';
  state.endlessExtraModifiers = [];
  state.waveModifierTick = 0;
  state.hint = 'TEST YOUR MIGHT! One leak ends the run. Perfect clear pays 2000g and a random Legendary.';
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
  state.hint = `TEST YOUR MIGHT cleared perfectly. +${TEST_YOUR_MIGHT_REWARD_GOLD}g and a random Legendary. Rome is acting very normal about this.`;
  return true;
}

export function failTestYourMight(state: GameStateShape): void {
  if (!state.testYourMightActive) return;
  state.testYourMightActive = false;
  state.testYourMightFailed = true;
  state.lives = 0;
  if (state.gameOverAt < 0) state.gameOverAt = state.tick;
  state.hint = 'TEST YOUR MIGHT failed. One got through. The Senate has chosen screaming.';
}
