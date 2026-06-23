// Mercator Champions must be functionally identical to the starter hero
// (JB, 2026-06-22): same tier, same basic-attack scale, same aura scale at
// every point in the run — NOT a max-tier recruit. At game start (tier 0) a
// champion is exactly as strong as if you had picked that hero to begin with.
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
  it('a freshly recruited champion starts at tier 0 with base (1.0x) auras, not max tier', () => {
    const { s, champion } = makeState('HERO_CAESAR', 0);
    expect(heroTierForTower(s, champion)).toBe(0);
    expect(heroAuraScaleForTower(s, champion)).toBeCloseTo(heroAuraScaleForTier(0), 5); // 1.0x, not 2.0x
  });

  it('champion tier, basic-attack scale, and aura scale match the starter at every tier', () => {
    for (let tier = 0; tier <= 4; tier++) {
      const { s, starter, champion } = makeState('HERO_CAESAR', tier);
      expect(heroTierForTower(s, champion), `tier ${tier}`).toBe(heroTierForTower(s, starter));
      expect(heroBasicAttackScaleForTower(s, champion), `tier ${tier}`)
        .toBeCloseTo(heroBasicAttackScaleForTower(s, starter), 5);
      expect(heroAuraScaleForTower(s, champion), `tier ${tier}`)
        .toBeCloseTo(heroAuraScaleForTower(s, starter), 5);
    }
  });
});
