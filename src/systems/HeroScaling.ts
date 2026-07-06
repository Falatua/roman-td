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
  if (isMercatorChampionType(String(tower.type))) return clampHeroTier(tower.heroTier ?? 0);
  return clampHeroTier(state?.heroTier);
}

export function heroXpForTower(state: GameStateShape | any, tower: Tower): number {
  const heroId = heroIdForTowerType(String(tower.type));
  if (!heroId) return 0;
  if (isMercatorChampionType(String(tower.type))) return Math.max(0, Math.floor(tower.heroXp ?? 0));
  return Math.max(0, Math.floor(state?.heroXp ?? 0));
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

function heroForgeMagnitudeScale(state: GameStateShape | any): number {
  const stacks = Math.max(0, Math.min(5, Math.floor(state?.heroForgeStacks?.aura ?? 0)));
  return 1 + 0.05 * stacks;
}

export function heroAuraScaleForTower(state: GameStateShape | any, tower: Tower): number {
  return heroAuraScaleForTier(heroTierForTower(state, tower)) * heroForgeMagnitudeScale(state);
}
