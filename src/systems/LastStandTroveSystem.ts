import { GameStateShape } from '../GameState';
import { GamePhase, TowerType } from '../types';
import towersData from '../data/towers.json';
import { BASE_TOWER_TYPES } from './TowerSystem';

export const LAST_STAND_TROVE_SOURCE = 'laststand' as const;
export const LAST_STAND_TROVE_TIER = 5 as const;

export function lastStandTroveChoices(): TowerType[] {
  return BASE_TOWER_TYPES.filter(type => {
    const def: any = (towersData as any)[type];
    return !!def && (def.kind ?? 'BASE') === 'BASE';
  });
}

export function shouldOfferLastStandTrove(state: GameStateShape): boolean {
  return state.lives === 1
    && state.gameOverAt < 0
    && state.victoryAt < 0
    && state.phase !== GamePhase.GAME_OVER
    && state.phase !== GamePhase.VICTORY
    && !state.lastStandTroveOffered
    && !state.lastStandTroveClaimed;
}

export function markLastStandTroveOffered(state: GameStateShape): void {
  state.lastStandTroveOffered = true;
}

export function claimLastStandTroveTower(state: GameStateShape, towerType: TowerType | string): boolean {
  if (state.lastStandTroveClaimed) return false;
  if (!lastStandTroveChoices().includes(towerType as TowerType)) return false;
  state.pendingPurchasedTowers = state.pendingPurchasedTowers ?? [];
  state.pendingPurchasedTowers.push({
    type: String(towerType),
    tier: LAST_STAND_TROVE_TIER,
    source: LAST_STAND_TROVE_SOURCE
  });
  state.lastStandTroveClaimed = true;
  return true;
}
