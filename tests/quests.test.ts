import { describe, expect, it } from 'vitest';
import { createGameState } from '../src/GameState';
import { GamePhase } from '../src/types';
import enemiesData from '../src/data/enemies.json';
import wavesData from '../src/data/waves.json';
import { evaluateQuests, QUESTS } from '../src/systems/QuestSystem';
import { startWave } from '../src/systems/WaveManager';

const quest = (id: string) => QUESTS.find(q => q.id === id)!;

function soloCampaignCumulative() {
  let kills = 0;
  let bosses = 0;
  return (wavesData as any[]).map(wave => {
    for (const group of wave.spawns) {
      const isBoss = !!(enemiesData as any)[group.type]?.isBoss;
      if (wave.type === 'B' && wave.wave <= 15 && !isBoss) continue;
      kills += group.count;
      if (isBoss) bosses += group.count;
    }
    return { wave: wave.wave, kills, bosses };
  });
}

describe('30-wave Solo quest pacing', () => {
  it('keeps 24 unique quests distributed across the three campaign acts', () => {
    expect(QUESTS).toHaveLength(24);
    expect(new Set(QUESTS.map(q => q.id)).size).toBe(24);
    expect(QUESTS.filter(q => q.tier === 'EARLY')).toHaveLength(7);
    expect(QUESTS.filter(q => q.tier === 'MID')).toHaveLength(7);
    expect(QUESTS.filter(q => q.tier === 'LATE')).toHaveLength(10);
  });

  it('completes Field Engineer from cumulative purchases without repeating', () => {
    const state = createGameState();
    expect(quest('field_engineer').tier).toBe('MID');
    expect(quest('field_engineer').target).toBe(8);

    state.trapsPurchased = 8;
    expect(evaluateQuests(state).map(q => q.id)).toContain('field_engineer');
    expect(evaluateQuests(state).map(q => q.id)).not.toContain('field_engineer');
  });

  it('adds a beginner trap quest that requires buying and deploying a trap', () => {
    const state = createGameState();
    expect(quest('trap_initiate').tier).toBe('EARLY');
    expect(quest('trap_initiate').reward).toEqual({ kind: 'GOLD', amount: 25 });

    state.trapsPurchased = 1;
    expect(evaluateQuests(state).map(q => q.id)).not.toContain('trap_initiate');

    state.trapsPlaced = 1;
    expect(evaluateQuests(state).map(q => q.id)).toContain('trap_initiate');
    expect(evaluateQuests(state).map(q => q.id)).not.toContain('trap_initiate');
  });

  it('paces total-kill quests near waves 6, 14, and 23', () => {
    const campaign = soloCampaignCumulative();
    const completionWave = (target: number) => campaign.find(row => row.kills >= target)?.wave;
    expect(quest('bloodline').target).toBe(300);
    expect(quest('butcher').target).toBe(850);
    expect(quest('destroyer').target).toBe(1900);
    expect(completionWave(quest('bloodline').target)).toBe(6);
    expect(completionWave(quest('butcher').target)).toBe(14);
    expect(completionWave(quest('destroyer').target)).toBe(23);
  });

  it('paces boss quests near waves 5, 14, and 24', () => {
    const campaign = soloCampaignCumulative();
    const completionWave = (target: number) => campaign.find(row => row.bosses >= target)?.wave;
    expect(quest('beast_slayer').target).toBe(2);
    expect(quest('boss_hunter').target).toBe(12);
    expect(quest('boss_slayer_supreme').target).toBe(19);
    expect(completionWave(quest('beast_slayer').target)).toBe(5);
    expect(completionWave(quest('boss_hunter').target)).toBe(14);
    expect(completionWave(quest('boss_slayer_supreme').target)).toBe(24);
  });

  it('aligns single-tower mastery with the long campaign badge ladder', () => {
    expect(quest('iron_discipline').target).toBe(100);
    expect(quest('champion_tower').target).toBe(200);
    expect(quest('legend_tower').target).toBe(500);
    expect(quest('eternal_bulwark').target).toBe(27);
  });

  it('rewards super combo, omega combo, combo volume, and 10M DPS check milestones', () => {
    expect(quest('super_combo_commission').reward).toEqual({ kind: 'GOLD', amount: 500 });
    expect(quest('omega_foundry').reward).toEqual({ kind: 'GOLD', amount: 1000 });
    expect(quest('combo_dynasty').target).toBe(15);
    expect(quest('combo_dynasty').reward).toEqual({ kind: 'GOLD', amount: 1000 });
    expect(quest('ten_million_dps').target).toBe(10000000);
    expect(quest('ten_million_dps').reward).toEqual({ kind: 'GOLD', amount: 500 });

    const superState = createGameState();
    superState.combosBuiltUniqueTypes = ['HANNIBALS_NIGHTMARE'];
    expect(evaluateQuests(superState).map(q => q.id)).toContain('super_combo_commission');

    const omegaState = createGameState();
    omegaState.combosBuiltUniqueTypes = ['ROMAN_TRANSFORMER'];
    expect(evaluateQuests(omegaState).map(q => q.id)).toContain('omega_foundry');

    const volumeState = createGameState();
    volumeState.combosBuilt = 15;
    expect(evaluateQuests(volumeState).map(q => q.id)).toContain('combo_dynasty');

    const dpsState = createGameState();
    dpsState.bestDpsCheck = 10000000;
    expect(evaluateQuests(dpsState).map(q => q.id)).toContain('ten_million_dps');
  });

  it('completes new thresholds exactly once and preserves tier identity', () => {
    const state = createGameState();
    state.totalKills = 1900;
    state.bossesKilled = 19;
    state.wave = 27;
    const first = evaluateQuests(state).map(q => q.id);
    expect(first).toEqual(expect.arrayContaining([
      'first_blood', 'bloodline', 'butcher', 'destroyer',
      'beast_slayer', 'boss_hunter', 'boss_slayer_supreme', 'eternal_bulwark'
    ]));
    expect(evaluateQuests(state)).toEqual([]);
  });
});

describe('W21 Khan boss integrity', () => {
  it('marks Khan Rider as a boss so the Solo boss-wave filter keeps the wave', () => {
    expect((enemiesData as any).KHAN_RIDER.isBoss).toBe(true);
    const state = createGameState();
    state.phase = GamePhase.BUILD_PHASE;
    state.wave = 20;
    startWave(state);
    expect(state.wave).toBe(21);
    expect(state.spawnQueue.some(spawn => spawn.type === 'KHAN_RIDER')).toBe(true);
  });
});
