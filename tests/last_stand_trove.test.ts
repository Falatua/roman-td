import { describe, expect, it } from 'vitest';
import { createGameState } from '../src/GameState';
import { GamePhase, TowerType } from '../src/types';
import towersData from '../src/data/towers.json';
import { createTower } from '../src/systems/TowerSystem';
import {
  claimLastStandTroveTower,
  lastStandTroveChoices,
  lastStandTroveRecipeHints,
  LAST_STAND_TROVE_SOURCE,
  LAST_STAND_TROVE_TIER,
  markLastStandTroveOffered,
  shouldOfferLastStandTrove
} from '../src/systems/LastStandTroveSystem';
import { eligibleBaseTowerTypesAtTier } from '../src/systems/BaseTowerRoster';

describe('Last-Life Trove hidden event', () => {
  it('only offers at exactly one life during a live run', () => {
    const state = createGameState();
    state.phase = GamePhase.BUILD_PHASE;
    state.lives = 2;
    expect(shouldOfferLastStandTrove(state)).toBe(false);

    state.lives = 1;
    expect(shouldOfferLastStandTrove(state)).toBe(true);

    state.phase = GamePhase.WAVE_PHASE;
    expect(shouldOfferLastStandTrove(state)).toBe(false);

    state.phase = GamePhase.BUILD_PHASE;
    state.lives = 0;
    expect(shouldOfferLastStandTrove(state)).toBe(false);

    state.lives = 1;
    state.gameOverAt = state.tick;
    expect(shouldOfferLastStandTrove(state)).toBe(false);

    state.gameOverAt = -1;
    state.phase = GamePhase.GAME_OVER;
    expect(shouldOfferLastStandTrove(state)).toBe(false);
  });

  it('is one-shot once offered or claimed', () => {
    const state = createGameState();
    state.lives = 1;
    expect(shouldOfferLastStandTrove(state)).toBe(true);
    markLastStandTroveOffered(state);
    expect(shouldOfferLastStandTrove(state)).toBe(false);

    const fresh = createGameState();
    fresh.lives = 1;
    fresh.lastStandTroveClaimed = true;
    expect(shouldOfferLastStandTrove(fresh)).toBe(false);
  });

  it('offers every authored base tower and no combo, super, omega, or hero tower', () => {
    const choices = lastStandTroveChoices();
    expect(new Set(choices)).toEqual(new Set(eligibleBaseTowerTypesAtTier(5)));
    expect(choices).toContain(TowerType.MILITES);
    expect(choices).toContain(TowerType.LEGATE);
    expect(choices).not.toContain(TowerType.VELITES);
    expect(choices).not.toContain(TowerType.SCORPIO);
    expect(choices.length).toBe(35);
    expect(choices).not.toContain(TowerType.SCORPION_BOLT);
    expect(choices).not.toContain(TowerType.HANNIBALS_NIGHTMARE);
    expect(choices).not.toContain(TowerType.ROMAN_TRANSFORMER);
    expect(choices).not.toContain(TowerType.HERO_MARIUS);

    for (const type of choices) {
      const def: any = (towersData as any)[type];
      expect(def, `${type} has tower data`).toBeTruthy();
      expect(def.kind ?? 'BASE', `${type} is a base tower`).toBe('BASE');
    }
  });

  it('shows recipe hints when a Trove pick would complete a recipe', () => {
    const state = createGameState();
    const velites = createTower(TowerType.VELITES, 2, 4, 4, 1);
    state.towers.set(velites.id, velites);

    const hints = lastStandTroveRecipeHints(state, TowerType.SCORPIO);
    expect(hints.map(hint => hint.result)).toContain(TowerType.SCORPION_BOLT);
    expect(hints.map(hint => hint.name)).toContain('Scorpion Bolt');
  });

  it('does not count unkept pending prospects for recipe hints', () => {
    const state = createGameState();
    const pendingVelites = createTower(TowerType.VELITES, 2, 4, 4, 1, true);
    state.towers.set(pendingVelites.id, pendingVelites);

    const hints = lastStandTroveRecipeHints(state, TowerType.SCORPIO);
    expect(hints.map(hint => hint.result)).not.toContain(TowerType.SCORPION_BOLT);
  });

  it('queues exactly one free Tier 5 tower for normal placement', () => {
    const state = createGameState();
    const ok = claimLastStandTroveTower(state, TowerType.LEGATE);
    expect(ok).toBe(true);
    expect(state.lastStandTroveClaimed).toBe(true);
    expect(state.pendingPurchasedTowers).toEqual([
      { type: TowerType.LEGATE, tier: LAST_STAND_TROVE_TIER, source: LAST_STAND_TROVE_SOURCE }
    ]);

    const duplicate = claimLastStandTroveTower(state, TowerType.LEGATE);
    expect(duplicate).toBe(false);
    expect(state.pendingPurchasedTowers).toHaveLength(1);
  });

  it('rejects non-base tower claims defensively', () => {
    const state = createGameState();
    expect(claimLastStandTroveTower(state, TowerType.SCORPION_BOLT)).toBe(false);
    expect(claimLastStandTroveTower(state, TowerType.ROMAN_TRANSFORMER)).toBe(false);
    expect(claimLastStandTroveTower(state, TowerType.HERO_MARIUS)).toBe(false);
    expect(claimLastStandTroveTower(state, TowerType.SCORPIO)).toBe(false);
    expect(claimLastStandTroveTower(state, TowerType.VELITES)).toBe(false);
    expect(state.pendingPurchasedTowers ?? []).toHaveLength(0);
    expect(state.lastStandTroveClaimed).toBeFalsy();
  });
});
