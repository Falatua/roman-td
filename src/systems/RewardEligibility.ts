import { GameStateShape } from '../GameState';
import { GamePhase } from '../types';
import { isBossEnemy } from './EnemyClassification';

export function canReceiveRunReward(state: GameStateShape): boolean {
  return state.lives > 0 && state.gameOverAt < 0 && state.phase !== GamePhase.GAME_OVER;
}

export function isMajorBossRewardEnemy(enemy: any): boolean {
  return !!enemy && isBossEnemy(enemy) && !!enemy.isScheduledBoss && !enemy.isBonusBoss;
}

export function isRareOnlyBossDropEnemy(enemy: any): boolean {
  return !!enemy?.rareDropOnly;
}

export const RARE_ONLY_BOSS_DROP_CHANCE = 0.25;

export function shouldDropRareOnlyBossLoot(enemy: any, randomValue = Math.random()): boolean {
  return isRareOnlyBossDropEnemy(enemy) && randomValue < RARE_ONLY_BOSS_DROP_CHANCE;
}

export function isLegendaryBossDropEnemy(enemy: any): boolean {
  if (isRareOnlyBossDropEnemy(enemy)) return false;
  // Final boss drops arrive as a W29 clear prelude reward instead. A
  // W30 kill ends the run, so a corpse drop there has no strategic value.
  if (enemy?.type === 'DAEMON_IMPERATOR') return false;
  // Test Your Might (W10.5) has several boss-class bruisers for pressure,
  // but the bonus wave should pay at most the one intended boss Legendary.
  // Only the challenge's scheduled/major-reward boss is eligible here.
  if (enemy?.__testYourMightEnemy) return isBossEnemy(enemy) && !!enemy?.isScheduledBoss;
  return !!enemy && isBossEnemy(enemy);
}
