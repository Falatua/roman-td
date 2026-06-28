import type { GameStateShape } from '../GameState';

export const TEST_YOUR_MIGHT_AFTER_WAVE = 10;
export const TEST_YOUR_MIGHT_DISPLAY_WAVE = '10.5';

export function displayWaveNumber(state: GameStateShape): string {
  return state.wave === TEST_YOUR_MIGHT_AFTER_WAVE
    && (state.testYourMightActive || state.testYourMightCleared || state.testYourMightFailed)
    ? TEST_YOUR_MIGHT_DISPLAY_WAVE
    : String(state.wave);
}
