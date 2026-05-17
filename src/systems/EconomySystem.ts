import { ECONOMY, HERO_XP_THRESHOLDS, POOL_PROBABILITIES } from '../constants';
import { GameStateShape } from '../GameState';

export function canAfford(state: GameStateShape, cost: number): boolean {
  return state.denarii >= cost;
}

export function spendGold(state: GameStateShape, cost: number): boolean {
  if (!canAfford(state, cost)) return false;
  state.denarii -= cost;
  return true;
}

export function earnGold(state: GameStateShape, amount: number) {
  state.denarii += amount;
}

export function effectivePoolLevel(state: GameStateShape): number {
  return Math.max(state.poolLevel, state.heroLevel);
}

const POOL_MAX = (ECONOMY as any).POOL_MAX_LEVEL ?? 10;

export function poolProbabilities(state: GameStateShape): number[] {
  return POOL_PROBABILITIES[Math.min(POOL_MAX, effectivePoolLevel(state))];
}

// Called on every enemy kill. Auto-promotes hero level when cumulative kills cross a threshold.
// Returns the new hero level (or -1 if unchanged).
export function bumpHeroXP(state: GameStateShape): number {
  state.totalKills += 1;
  if (state.heroLevel >= 5) return -1;
  const next = HERO_XP_THRESHOLDS[state.heroLevel];
  if (state.totalKills >= next) {
    state.heroLevel += 1;
    return state.heroLevel;
  }
  return -1;
}

export function poolUpgradeCost(state: GameStateShape): number {
  if (state.poolLevel >= POOL_MAX) return -1;
  return ECONOMY.POOL_UPGRADE_COSTS[state.poolLevel];
}
