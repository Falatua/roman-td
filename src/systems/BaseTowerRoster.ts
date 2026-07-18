import { TowerType } from '../types';
import towersData from '../data/towers.json';

// One authoritative roster for Solo shops, hidden events, and reward grants.
// Derived from authored data so newly added BASE lines automatically join the
// randomization without another hand-maintained vendor list.
export const ALL_LEGION_BASE_TOWER_TYPES: TowerType[] = Object.entries(towersData as Record<string, any>)
  .filter(([id, def]) => def?.kind === 'BASE' && !def?.isHero && !id.startsWith('HERO_') && !id.startsWith('CHAMPION_'))
  .map(([id]) => id as TowerType);

export const TIER_FOUR_MAX_TOWER_TYPES = new Set<TowerType>();

export function maxQualityTierForTower(type: TowerType | string): 1 | 2 | 3 | 4 | 5 {
  return TIER_FOUR_MAX_TOWER_TYPES.has(type as TowerType) ? 4 : 5;
}

export function eligibleBaseTowerTypesAtTier(tier: number): TowerType[] {
  return ALL_LEGION_BASE_TOWER_TYPES.filter(type => maxQualityTierForTower(type) >= tier);
}
