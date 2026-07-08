import { ECONOMY, HERO_XP_THRESHOLDS, POOL_PROBABILITIES } from '../constants';
import { GameStateShape } from '../GameState';

export function canAfford(state: GameStateShape, cost: number): boolean {
  return state.gold >= cost;
}

export function spendGold(state: GameStateShape, cost: number): boolean {
  if (!canAfford(state, cost)) return false;
  state.gold -= cost;
  return true;
}

export function earnGold(state: GameStateShape, amount: number, opts?: { taxable?: boolean }): number {
  const gross = Math.round(amount);
  if (gross <= 0) {
    state.gold += gross;
    return gross;
  }
  void opts;
  state.gold += gross;
  return gross;
}

export function perfectWaveGoldBonus(wave: number): number {
  if (wave >= 21) return 50;
  if (wave >= 11) return 35;
  if (wave >= 6) return 20;
  return 10;
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
