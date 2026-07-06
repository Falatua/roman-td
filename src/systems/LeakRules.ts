import { WAVE } from '../constants';
import { EnemyType, type Enemy } from '../types';
import type { GameStateShape } from '../GameState';

export function isFinalBossBreach(state: GameStateShape, enemy: Pick<Enemy, 'type'>): boolean {
  return state.wave === WAVE.TOTAL && !state.endlessMode && enemy.type === EnemyType.DAEMON_IMPERATOR;
}
