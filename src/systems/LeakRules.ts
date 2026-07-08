import { WAVE } from '../constants';
import { EnemyType, type Enemy } from '../types';
import type { GameStateShape } from '../GameState';

export function isFinalBossBreach(state: GameStateShape, enemy: Pick<Enemy, 'type'>): boolean {
  return state.wave === WAVE.TOTAL && !state.endlessMode && enemy.type === EnemyType.DAEMON_IMPERATOR;
}

export function isElephantEliteLeak(enemy: Pick<Enemy, 'type'>): boolean {
  return enemy.type === EnemyType.WAR_ELEPHANT || enemy.type === EnemyType.UNDEAD_WAR_ELEPHANT;
}

export function leakLifeCostFor(enemy: Pick<Enemy, 'type' | 'livesCost'>): number {
  if (isElephantEliteLeak(enemy)) return 5;
  return enemy.livesCost ?? 1;
}

export function shouldRespawnBossOnLeak(enemy: Pick<Enemy, 'type' | 'isBoss'>): boolean {
  return !!enemy.isBoss && !isElephantEliteLeak(enemy);
}
