import { Tower } from '../types';
import { GameStateShape } from '../GameState';
import HERO_DEFS from '../data/herodefs.json';
import { heroIdForTowerType, isMercatorChampionType, type HeroIdentityId } from './HeroIdentity';

export const HERO_AURA_SCALE_PER_TIER = [1.0, 1.25, 1.5, 1.75, 2.0] as const;

function clampHeroTier(tier: number | undefined | null): 0 | 1 | 2 | 3 | 4 {
  return Math.max(0, Math.min(4, Math.floor(tier ?? 0))) as 0 | 1 | 2 | 3 | 4;
}

export function heroTierForTower(state: GameStateShape | any, tower: Tower): 0 | 1 | 2 | 3 | 4 {
  const heroId = heroIdForTowerType(String(tower.type));
  if (!heroId) return 0;
  if (isMercatorChampionType(String(tower.type))) return 4;
  if (tower.id === state?.activeHeroTowerId && heroId === state?.activeHeroId) {
    return clampHeroTier(state?.heroTier);
  }
  return 0;
}

export function heroBasicAttackScaleForTier(heroId: HeroIdentityId | string | undefined, tier: number): number {
  if (!heroId) return 1;
  const def: any = (HERO_DEFS as any)[heroId];
  return def?.basicAtkScalePerTier?.[clampHeroTier(tier)] ?? 1;
}

export function heroBasicAttackScaleForTower(state: GameStateShape | any, tower: Tower): number {
  const heroId = heroIdForTowerType(String(tower.type));
  if (!heroId) return 1;
  return heroBasicAttackScaleForTier(heroId, heroTierForTower(state, tower));
}

export function heroAuraScaleForTier(tier: number): number {
  return HERO_AURA_SCALE_PER_TIER[clampHeroTier(tier)] ?? 1;
}

export function heroAuraScaleForTower(state: GameStateShape | any, tower: Tower): number {
  return heroAuraScaleForTier(heroTierForTower(state, tower));
}
