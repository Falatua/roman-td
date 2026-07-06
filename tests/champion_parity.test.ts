// Mercator Champions are real hero kits, but bought heroes begin as fresh
// level-0 recruits. They level from future kill XP instead of inheriting the
// starter hero's current rank.
import { describe, it, expect } from 'vitest';
import { createTower } from '../src/systems/TowerSystem';
import { createGameState } from '../src/GameState';
import { TowerType } from '../src/types';
import {
  heroTierForTower,
  heroBasicAttackScaleForTower,
  heroAuraScaleForTower,
  heroAuraScaleForTier,
} from '../src/systems/HeroScaling';

function makeState(heroId: string, tier: number) {
  const s = createGameState();
  s.activeHeroId = heroId as any;
  s.heroTier = tier as any;
  const starter = createTower(TowerType.HERO_CAESAR, 5, 5, 5, 1);
  s.activeHeroTowerId = starter.id;
  s.towers.set(starter.id, starter);
  const champion = createTower(TowerType.CHAMPION_CAESAR, 5, 7, 5, 1);
  s.towers.set(champion.id, champion);
  return { s, starter, champion };
}

describe('Mercator Champion progression', () => {
  it('a freshly recruited champion starts at level 0 even when the starter is higher rank', () => {
    const { s, champion } = makeState('HERO_CAESAR', 0);
    s.heroTier = 4;
    expect(heroTierForTower(s, champion)).toBe(0);
    expect(heroBasicAttackScaleForTower(s, champion)).toBeCloseTo(heroBasicAttackScaleForTower({ ...s, heroTier: 0 }, champion), 5);
    expect(heroAuraScaleForTower(s, champion)).toBeCloseTo(heroAuraScaleForTier(0), 5);
  });

  it('champion damage and aura scaling follow the champion tower rank, not the starter rank', () => {
    for (let tier = 0; tier <= 4; tier++) {
      const { s, starter, champion } = makeState('HERO_CAESAR', tier);
      champion.heroTier = tier as 0 | 1 | 2 | 3 | 4;
      expect(heroTierForTower(s, champion), `tier ${tier}`).toBe(tier);
      expect(heroBasicAttackScaleForTower(s, champion), `tier ${tier}`).toBeCloseTo(heroBasicAttackScaleForTower(s, starter), 5);
      expect(heroAuraScaleForTower(s, champion), `tier ${tier}`)
        .toBeCloseTo(heroAuraScaleForTier(tier), 5);
    }
  });
});
