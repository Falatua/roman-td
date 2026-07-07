import { describe, it, expect } from 'vitest';
import { createGameState } from '../src/GameState';
import { createTower } from '../src/systems/TowerSystem';
import { GamePhase, TowerType } from '../src/types';
import { distinctHeroIdentities, maybeOfferMarsVictor } from '../src/render/MarsVictorAlert';

function addTower(state: any, type: TowerType, pending = false) {
  const t = createTower(type, 2, state.towers.size + 1, 5, state.wave, pending);
  state.towers.set(t.id, t);
  return t;
}

describe('Mars Victor readiness alert', () => {
  it('counts starter heroes and Mercator Champions by distinct hero identity', () => {
    const s = createGameState();
    addTower(s, TowerType.HERO_MARIUS);
    addTower(s, TowerType.CHAMPION_AGRIPPA);
    addTower(s, TowerType.CHAMPION_AGRICOLA);
    addTower(s, TowerType.CHAMPION_SCIPIO);
    addTower(s, TowerType.CHAMPION_CAESAR);
    addTower(s, TowerType.CHAMPION_SULLA);
    addTower(s, TowerType.CHAMPION_MARIUS);

    expect(distinctHeroIdentities(s)).toBe(6);
  });

  it('ignores pending heroes until they are actually placed', () => {
    const s = createGameState();
    addTower(s, TowerType.HERO_MARIUS);
    addTower(s, TowerType.CHAMPION_AGRIPPA);
    addTower(s, TowerType.CHAMPION_AGRICOLA);
    addTower(s, TowerType.CHAMPION_SCIPIO);
    addTower(s, TowerType.CHAMPION_CAESAR);
    addTower(s, TowerType.CHAMPION_SULLA, true);

    expect(distinctHeroIdentities(s)).toBe(5);
  });

  it('offers once when all six heroes are ready, then rearms after the set breaks', () => {
    const s: any = createGameState();
    addTower(s, TowerType.HERO_MARIUS);
    addTower(s, TowerType.CHAMPION_AGRIPPA);
    addTower(s, TowerType.CHAMPION_AGRICOLA);
    addTower(s, TowerType.CHAMPION_SCIPIO);
    addTower(s, TowerType.CHAMPION_CAESAR);
    const sulla = addTower(s, TowerType.CHAMPION_SULLA);

    maybeOfferMarsVictor(null, s, false, () => {});
    expect(s.__marsVictorOffered).toBe(true);
    maybeOfferMarsVictor(null, s, false, () => {});
    expect(s.__marsVictorOffered).toBe(true);

    s.towers.delete(sulla.id);
    maybeOfferMarsVictor(null, s, false, () => {});
    expect(s.__marsVictorOffered).toBe(false);
  });

  it('defers the Mars Victor prompt during active combat and offers it afterward', () => {
    const s: any = createGameState();
    addTower(s, TowerType.HERO_MARIUS);
    addTower(s, TowerType.CHAMPION_AGRIPPA);
    addTower(s, TowerType.CHAMPION_AGRICOLA);
    addTower(s, TowerType.CHAMPION_SCIPIO);
    addTower(s, TowerType.CHAMPION_CAESAR);
    addTower(s, TowerType.CHAMPION_SULLA);

    s.phase = GamePhase.WAVE_PHASE;
    maybeOfferMarsVictor(null, s, false, () => {});
    expect(s.__marsVictorOffered).not.toBe(true);
    expect(s.__marsVictorPromptDeferred).toBe(true);

    s.phase = GamePhase.BUILD_PHASE;
    maybeOfferMarsVictor(null, s, false, () => {});
    expect(s.__marsVictorOffered).toBe(true);
    expect(s.__marsVictorPromptDeferred).toBe(false);
  });
});
