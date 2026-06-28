import { GameStateShape } from '../GameState';
import { GamePhase } from '../types';

export function canReceiveRunReward(state: GameStateShape): boolean {
  return state.lives > 0 && state.gameOverAt < 0 && state.phase !== GamePhase.GAME_OVER;
}

export function isMajorBossRewardEnemy(enemy: any): boolean {
  if (!enemy?.isBoss || !enemy?.isScheduledBoss || enemy?.isBonusBoss) return false;
  return enemy.type !== 'WAR_ELEPHANT' && enemy.type !== 'UNDEAD_WAR_ELEPHANT';
}

export function isLegendaryBossDropEnemy(enemy: any): boolean {
  if (!enemy?.isBoss || enemy?.isBonusBoss) return false;
  if (enemy.type === 'WAR_ELEPHANT' || enemy.type === 'UNDEAD_WAR_ELEPHANT') return false;
  return enemy.isScheduledBoss === true || enemy.type === 'ALPHA_DOG';
}
