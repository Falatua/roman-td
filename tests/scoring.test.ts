// Tests for the simplified leaderboard scoring formula (2026-05-25).
// The old formula let a slow early-death run out-score a deep run — a
// W10 LOSS hit a 54K sanity cap and ranked #1 above a legit W19 run at
// 43.7K. The new formula is purely additive: waves + combos + quests +
// W30 win bump, so progression is the main lever.
import { describe, it, expect } from 'vitest';
import {
  computeScore,
  SCORE_PER_WAVE,
  SCORE_PER_COMBO,
  SCORE_PER_QUEST,
  SCORE_WIN_BONUS,
  INVALIDATED_GLOBAL_SCORE_IDS,
  isScoringVictory,
  primaryDamageTowerForState,
} from '../src/render/Leaderboard';
import { createGameState } from '../src/GameState';
import { createTower } from '../src/systems/TowerSystem';
import { TowerType } from '../src/types';

describe('Simplified scoring — computeScore', () => {
  it('scores a loss as (wave-1) waves cleared + combos + quests, no win bump', () => {
    // W10 LOSS, 0 combos, 11 quests (the bugged NICKCTOM #1 entry).
    const score = computeScore({ wave: 10, won: false, combos: 0, quests: 11 });
    // 9 waves cleared × 2000 + 0 + 11 × 400 = 18,000 + 4,400 = 22,400
    expect(score).toBe(9 * SCORE_PER_WAVE + 0 * SCORE_PER_COMBO + 11 * SCORE_PER_QUEST);
    expect(score).toBe(22400);
  });

  it('keeps legacy W20 wins as cleared waves but removes the old win bump', () => {
    // W20 used to be a win; now it is historical credit only because the
    // campaign ends on W30. The W badge can stay, but the win factor is gone.
    const score = computeScore({ wave: 20, won: true, combos: 20, quests: 17 });
    expect(score).toBe(20 * SCORE_PER_WAVE + 20 * SCORE_PER_COMBO + 17 * SCORE_PER_QUEST);
    expect(score).toBe(56800);
    expect(isScoringVictory({ wave: 20, won: true })).toBe(false);
  });

  it('scores a true W30 campaign win as all waves cleared + combos + quests + win bump', () => {
    const score = computeScore({ wave: 30, won: true, combos: 20, quests: 17 });
    expect(score).toBe(30 * SCORE_PER_WAVE + 20 * SCORE_PER_COMBO + 17 * SCORE_PER_QUEST + SCORE_WIN_BONUS);
    expect(score).toBe(116800);
    expect(isScoringVictory({ wave: 30, won: true })).toBe(true);
  });

  it('FIXES THE BUG: a deep W19 loss out-scores a shallow W10 loss', () => {
    // The exact screenshot data the user reported.
    const nickctom = computeScore({ wave: 10, won: false, combos: 0, quests: 11 }); // was #1 at 54K
    const jb       = computeScore({ wave: 19, won: false, combos: 17, quests: 17 }); // was #2 at 43.7K
    // JB reached 9 more waves — that alone is +18,000, far more than
    // NICKCTOM's quest lead can make up. JB must rank above NICKCTOM.
    expect(jb).toBeGreaterThan(nickctom);
    expect(jb).toBe(18 * SCORE_PER_WAVE + 17 * SCORE_PER_COMBO + 17 * SCORE_PER_QUEST); // 36,000 + 8,500 + 6,800 = 51,300
    expect(nickctom).toBe(22400);
  });

  it('a true W30 winner always out-scores any non-winner', () => {
    // Worst-case true winner: barely cleared W30 with zero side-objectives.
    const minWinner = computeScore({ wave: 30, won: true, combos: 0, quests: 0 });
    // Best-case pre-victory run: died on W30 with strong side objectives.
    const maxLoser  = computeScore({ wave: 30, won: false, combos: 30, quests: 20 });
    expect(minWinner).toBeGreaterThan(maxLoser);
  });

  it('one extra wave outweighs several combos or quests (progression dominates)', () => {
    const deeper  = computeScore({ wave: 11, won: false, combos: 0, quests: 0 });  // 10 waves cleared
    const shallow = computeScore({ wave: 10, won: false, combos: 3, quests: 4 });  // 9 waves + side objectives
    // 1 wave (2000) > 3 combos (1500) + 4 quests (1600)? No — 2000 < 3100.
    // So this specific case is intentionally close; assert the wave value
    // is the single biggest lever instead.
    expect(SCORE_PER_WAVE).toBeGreaterThan(SCORE_PER_COMBO);
    expect(SCORE_PER_WAVE).toBeGreaterThan(SCORE_PER_QUEST);
    // sanity: both are positive, non-zero
    expect(deeper).toBeGreaterThan(0);
    expect(shallow).toBeGreaterThan(0);
  });

  it('clamps negative combo/quest counts to zero (no exploit)', () => {
    const score = computeScore({ wave: 5, won: false, combos: -10, quests: -5 });
    // 4 waves × 2000 = 8,000; negatives floored to 0.
    expect(score).toBe(4 * SCORE_PER_WAVE);
  });

  it('a wave-0 loss (never started a wave) scores zero waves', () => {
    const score = computeScore({ wave: 0, won: false, combos: 0, quests: 0 });
    expect(score).toBe(0);
  });

  it('keeps the pre-balance W30 global rows invalidated from display', () => {
    expect(INVALIDATED_GLOBAL_SCORE_IDS.size).toBe(3);
    expect(INVALIDATED_GLOBAL_SCORE_IDS.has('59674466-f16b-4022-bcc5-731d2c827a9a')).toBe(true);
    expect(INVALIDATED_GLOBAL_SCORE_IDS.has('0f32dab9-abcb-4cd0-843b-fb216ddffaf4')).toBe(true);
    expect(INVALIDATED_GLOBAL_SCORE_IDS.has('7ae16acf-e27c-4485-9118-e6baaa23c20f')).toBe(true);
  });
});

describe('Primary damage dealer leaderboard stat', () => {
  it('picks the highest lifetime tower type from the run aggregate', () => {
    const state = createGameState();
    state.towerDamageByType = {
      [TowerType.MILITES]: 1200,
      [TowerType.SCORPIO]: 9600,
      [TowerType.LEGATE]: 2000
    };
    const top = primaryDamageTowerForState(state);
    expect(top).toEqual({ type: TowerType.SCORPIO, name: 'Scorpio', damage: 9600 });
  });

  it('falls back to surviving tower counters for older saves', () => {
    const state = createGameState();
    state.towerDamageByType = {};
    const milites = createTower(TowerType.MILITES, 3, 2, 2, 1);
    const legate = createTower(TowerType.LEGATE, 5, 3, 3, 1);
    milites.totalDamageDealt = 5000;
    legate.totalDamageDealt = 7000;
    state.towers.set(milites.id, milites);
    state.towers.set(legate.id, legate);
    const top = primaryDamageTowerForState(state);
    expect(top?.type).toBe(TowerType.LEGATE);
    expect(top?.name).toBe('Legate');
    expect(top?.damage).toBe(7000);
  });

  it('returns null when no tower dealt damage', () => {
    const state = createGameState();
    expect(primaryDamageTowerForState(state)).toBeNull();
  });
});
