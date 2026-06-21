export const HERO_IDS = [
  'HERO_MARIUS',
  'HERO_AGRIPPA',
  'HERO_AGRICOLA',
  'HERO_SCIPIO',
  'HERO_CAESAR',
  'HERO_SULLA'
] as const;

export type HeroIdentityId = typeof HERO_IDS[number];

export const HERO_TO_CHAMPION: Record<HeroIdentityId, string> = {
  HERO_MARIUS: 'CHAMPION_MARIUS',
  HERO_AGRIPPA: 'CHAMPION_AGRIPPA',
  HERO_AGRICOLA: 'CHAMPION_AGRICOLA',
  HERO_SCIPIO: 'CHAMPION_SCIPIO',
  HERO_CAESAR: 'CHAMPION_CAESAR',
  HERO_SULLA: 'CHAMPION_SULLA'
};

export const CHAMPION_TO_HERO: Record<string, HeroIdentityId> = Object.fromEntries(
  Object.entries(HERO_TO_CHAMPION).map(([heroId, championId]) => [championId, heroId])
) as Record<string, HeroIdentityId>;

export function championForHero(heroId?: string | null): string | null {
  return heroId && heroId in HERO_TO_CHAMPION
    ? HERO_TO_CHAMPION[heroId as HeroIdentityId]
    : null;
}

export function heroIdForTowerType(type?: string | null): HeroIdentityId | null {
  if (!type) return null;
  if ((HERO_IDS as readonly string[]).includes(type)) return type as HeroIdentityId;
  return CHAMPION_TO_HERO[type] ?? null;
}

export function isMercatorChampionType(type?: string | null): boolean {
  return !!type && type in CHAMPION_TO_HERO;
}
