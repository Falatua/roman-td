import { WAVE } from '../constants';
import { EnemyType, type Enemy } from '../types';
import type { GameStateShape } from '../GameState';
import { isBossEnemy, isCommanderEnemy, isEliteEnemy, isEventStructure } from './EnemyClassification';

export function isFinalBossBreach(state: GameStateShape, enemy: Pick<Enemy, 'type'>): boolean {
  return state.wave === WAVE.TOTAL && !state.endlessMode && enemy.type === EnemyType.DAEMON_IMPERATOR;
}

export function isElephantEliteLeak(enemy: Pick<Enemy, 'type'>): boolean {
  return isEliteEnemy(enemy) && (enemy.type === EnemyType.WAR_ELEPHANT || enemy.type === EnemyType.UNDEAD_WAR_ELEPHANT);
}

export function leakLifeCostFor(enemy: Pick<Enemy, 'type' | 'livesCost'>): number {
  if (isEventStructure(enemy)) return 0;
  if (isBossEnemy(enemy)) return 10;
  if (isEliteEnemy(enemy) || isCommanderEnemy(enemy)) return 5;
  return enemy.livesCost ?? 1;
}

export function shouldRespawnBossOnLeak(enemy: Pick<Enemy, 'type' | 'isBoss'>): boolean {
  return isBossEnemy(enemy);
}
