import { GameStateShape } from '../GameState';
import { GamePhase, TowerType } from '../types';
import towersData from '../data/towers.json';
import comboData from '../data/towerCombinations.json';
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
    && state.phase !== GamePhase.WAVE_PHASE
    && state.phase !== GamePhase.GAME_OVER
    && state.phase !== GamePhase.VICTORY
    && !state.lastStandTroveOffered
    && !state.lastStandTroveClaimed;
}

function existingTowerPool(state: GameStateShape): Map<string, number[]> {
  const pool = new Map<string, number[]>();
  for (const tower of state.towers.values()) {
    if (tower.pending) continue;
    const arr = pool.get(String(tower.type)) ?? [];
    arr.push(tower.qualityTier ?? 1);
    pool.set(String(tower.type), arr);
  }
  for (const arr of pool.values()) arr.sort((a, b) => b - a);
  return pool;
}

function consumeIngredient(pool: Map<string, number[]>, type: string, minTier: number): boolean {
  const arr = pool.get(type);
  if (!arr) return false;
  const idx = arr.findIndex(tier => tier >= minTier);
  if (idx < 0) return false;
  arr.splice(idx, 1);
  return true;
}

export interface LastStandTroveRecipeHint {
  result: TowerType;
  name: string;
  tier: number;
}

export function lastStandTroveRecipeHints(state: GameStateShape, towerType: TowerType | string, limit = 3): LastStandTroveRecipeHint[] {
  const offeredType = String(towerType);
  const hints: LastStandTroveRecipeHint[] = [];
  for (const recipe of comboData as any[]) {
    const matchingSlots = (recipe.ingredients ?? [])
      .map((ingredient: any, index: number) => ({ ingredient, index }))
      .filter(({ ingredient }: any) => String(ingredient.type) === offeredType && LAST_STAND_TROVE_TIER >= Number(ingredient.minTier ?? 1));
    if (matchingSlots.length === 0) continue;

    for (const slot of matchingSlots) {
      const pool = existingTowerPool(state);
      let ok = true;
      for (let i = 0; i < recipe.ingredients.length; i++) {
        if (i === slot.index) continue;
        const ingredient = recipe.ingredients[i];
        if (!consumeIngredient(pool, String(ingredient.type), Number(ingredient.minTier ?? 1))) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      const result = String(recipe.result) as TowerType;
      const def: any = (towersData as any)[result] ?? {};
      hints.push({
        result,
        name: String(def.name ?? result.replace(/_/g, ' ')),
        tier: Number(recipe.tier ?? 1)
      });
      break;
    }
    if (hints.length >= limit) break;
  }
  return hints;
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
