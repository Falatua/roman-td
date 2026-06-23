// Mercator Champions are real hero kits, but bought heroes now begin as T2
// recruits rather than fully maxed or fresh T1 starters. Internally the hero
// ladder is zero-based, so player-facing T2 is tier index 1.
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

describe('Mercator Champion === starter hero strength', () => {
  it('a freshly recruited champion starts at player-facing T2, not base tier or max tier', () => {
    const { s, champion } = makeState('HERO_CAESAR', 0);
    expect(heroTierForTower(s, champion)).toBe(1);
    expect(heroAuraScaleForTower(s, champion)).toBeCloseTo(heroAuraScaleForTier(1), 5);
  });

  it('champions keep their T2 floor, then match the starter once the run tier passes it', () => {
    for (let tier = 0; tier <= 4; tier++) {
      const { s, starter, champion } = makeState('HERO_CAESAR', tier);
      expect(heroTierForTower(s, champion), `tier ${tier}`).toBe(Math.max(1, heroTierForTower(s, starter)));
      expect(heroBasicAttackScaleForTower(s, champion), `tier ${tier}`).toBeGreaterThanOrEqual(heroBasicAttackScaleForTower(s, starter));
      expect(heroAuraScaleForTower(s, champion), `tier ${tier}`)
        .toBeCloseTo(heroAuraScaleForTier(Math.max(1, tier)), 5);
    }
  });
});
