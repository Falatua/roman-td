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
      if (wave.type === 'B' && !isBoss) continue;
      kills += group.count;
      if (isBoss) bosses += group.count;
    }
    return { wave: wave.wave, kills, bosses };
  });
}

describe('30-wave Solo quest pacing', () => {
  it('keeps 19 unique quests distributed across the three campaign acts', () => {
    expect(QUESTS).toHaveLength(19);
    expect(new Set(QUESTS.map(q => q.id)).size).toBe(19);
    expect(QUESTS.filter(q => q.tier === 'EARLY')).toHaveLength(6);
    expect(QUESTS.filter(q => q.tier === 'MID')).toHaveLength(7);
    expect(QUESTS.filter(q => q.tier === 'LATE')).toHaveLength(6);
  });

  it('completes Field Engineer from cumulative purchases without repeating', () => {
    const state = createGameState();
    expect(quest('field_engineer').tier).toBe('MID');
    expect(quest('field_engineer').target).toBe(8);

    state.trapsPurchased = 8;
    expect(evaluateQuests(state).map(q => q.id)).toContain('field_engineer');
    expect(evaluateQuests(state).map(q => q.id)).not.toContain('field_engineer');
  });

  it('paces total-kill quests near waves 6, 14, and 23', () => {
    const campaign = soloCampaignCumulative();
    const completionWave = (target: number) => campaign.find(row => row.kills >= target)?.wave;
    expect(quest('bloodline').target).toBe(300);
    expect(quest('butcher').target).toBe(850);
    expect(quest('destroyer').target).toBe(1800);
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

  it('completes new thresholds exactly once and preserves tier identity', () => {
    const state = createGameState();
    state.totalKills = 1800;
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
