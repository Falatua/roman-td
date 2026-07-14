import { describe, expect, it } from 'vitest';
import { createGameState } from '../src/GameState';
import {
  ECONOMY,
  SOLO_AEGIS_OVERCAP_LIVES,
  SOLO_ENDLESS_RESTOCK_LIVES,
  SOLO_MAX_LIVES,
  SOLO_STARTING_LIVES
} from '../src/constants';
import enemiesData from '../src/data/enemies.json';
import { applyCampaignRelic } from '../src/systems/CampaignRelicSystem';
import { classifyEnemy } from '../src/systems/EnemyClassification';
import { leakLifeCostFor } from '../src/systems/LeakRules';
import { restoreSoloLives } from '../src/systems/LifeSystem';

describe('Solo 45-life campaign budget', () => {
  it('starts Solo at 45 while preserving the shared multiplayer budget at 30', () => {
    expect(SOLO_STARTING_LIVES).toBe(45);
    expect(SOLO_MAX_LIVES).toBe(45);
    expect(SOLO_ENDLESS_RESTOCK_LIVES).toBe(38);
    expect(createGameState().lives).toBe(45);
    expect(ECONOMY.STARTING_LIVES).toBe(30);
    expect(ECONOMY.MAX_LIVES).toBe(30);
  });

  it('enforces the 1 / 5 / 10 leak contract across every authored enemy', () => {
    const enemies = enemiesData as Record<string, { livesCost?: number; isStructure?: boolean }>;
    for (const [type, def] of Object.entries(enemies)) {
      const classes = classifyEnemy(type);
      const actual = leakLifeCostFor({ type: type as any, livesCost: def.livesCost ?? 1 });
      const expected = classes.eventStructure || type === 'TRAINING_DUMMY'
        ? 0
        : classes.boss
          ? 10
          : classes.elite || classes.commander
            ? 5
            : 1;
      expect(actual, `${type} should leak for ${expected}`).toBe(expected);
      expect(def.livesCost, `${type} data should match its authoritative class`).toBe(expected);
    }
  });

  it('caps ordinary healing at 45 and reports the amount actually restored', () => {
    const state = createGameState();
    state.lives = 43;
    expect(restoreSoloLives(state, 5)).toBe(2);
    expect(state.lives).toBe(45);
    expect(restoreSoloLives(state, 3)).toBe(0);
    expect(state.lives).toBe(45);
  });

  it('lets Aegis Wall overcap to 60 without a later life reward reducing it', () => {
    const state = createGameState();
    expect(applyCampaignRelic(state, 'AEGIS_WALL')).toBe(true);
    expect(state.lives).toBe(SOLO_AEGIS_OVERCAP_LIVES);
    expect(restoreSoloLives(state, 2)).toBe(0);
    expect(state.lives).toBe(SOLO_AEGIS_OVERCAP_LIVES);
  });

  it('keeps Agricola at 29 lives so the larger reserve makes the gamble easier', () => {
    const state = createGameState();
    expect(applyCampaignRelic(state, 'AGRICOLA_LEVY')).toBe(true);
    expect(state.lives).toBe(16);
  });
});
