import { GameStateShape } from '../GameState';
import { SOLO_MAX_LIVES } from '../constants';

/**
 * Restores Solo lives without allowing an ordinary reward to exceed the
 * campaign cap or erase a temporary relic-granted overcap.
 */
export function restoreSoloLives(
  state: Pick<GameStateShape, 'lives'>,
  amount: number,
  cap: number = SOLO_MAX_LIVES
): number {
  const before = Math.max(0, Number(state.lives) || 0);
  const gain = Math.max(0, Math.floor(Number(amount) || 0));
  if (gain <= 0 || before >= cap) return 0;
  state.lives = Math.min(cap, before + gain);
  return state.lives - before;
}
