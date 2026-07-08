import { GameStateShape } from '../GameState';
import { GamePhase } from '../types';

export function canReceiveRunReward(state: GameStateShape): boolean {
  return state.lives > 0 && state.gameOverAt < 0 && state.phase !== GamePhase.GAME_OVER;
}

export function isMajorBossRewardEnemy(enemy: any): boolean {
  if (!enemy?.isBoss || !enemy?.isScheduledBoss || enemy?.isBonusBoss) return false;
  return enemy.type !== 'WAR_ELEPHANT' && enemy.type !== 'UNDEAD_WAR_ELEPHANT';
}

export function isRareOnlyBossDropEnemy(enemy: any): boolean {
  return !!enemy?.rareDropOnly;
}

export const RARE_ONLY_BOSS_DROP_CHANCE = 0.80;

export function shouldDropRareOnlyBossLoot(enemy: any, randomValue = Math.random()): boolean {
  return isRareOnlyBossDropEnemy(enemy) && randomValue < RARE_ONLY_BOSS_DROP_CHANCE;
}

export function isLegendaryBossDropEnemy(enemy: any): boolean {
  if (isRareOnlyBossDropEnemy(enemy)) return false;
  // Final boss drops arrive as a W29 clear prelude reward instead. A
  // W30 kill ends the run, so a corpse drop there has no strategic value.
  if (enemy?.type === 'DAEMON_IMPERATOR') return false;
  return !!enemy?.isBoss;
}
