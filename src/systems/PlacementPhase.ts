import { GamePhase } from '../types';

/** Tower and prospect placement is preparation-only, including while combat is paused. */
export function canPlaceTowersOrProspects(phase: GamePhase): boolean {
  return phase === GamePhase.BUILD_PHASE ||
    phase === GamePhase.PROSPECT_PLACEMENT ||
    phase === GamePhase.PICK_KEEPER;
}
