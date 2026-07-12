import { GamePhase } from '../types';

/** Show the Cyclops carrion flies only through the opening wave. */
export function shouldShowCyclopsFlies(wave: number, phase: GamePhase): boolean {
  return wave === 0 || (wave === 1 && phase === GamePhase.WAVE_PHASE);
}

/** Show the ominous cave thundercloud through the opening wave only. */
export function shouldShowOpeningThundercloud(wave: number, phase: GamePhase): boolean {
  return wave === 0 || (wave === 1 && phase === GamePhase.WAVE_PHASE);
}
