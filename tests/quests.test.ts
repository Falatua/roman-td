import { describe, expect, it } from 'vitest';
import { createGameState } from '../src/GameState';
import { GamePhase, TowerType } from '../src/types';
import enemiesData from '../src/data/enemies.json';
import wavesData from '../src/data/waves.json';
import { activeQuestsByTier, evaluateQuests, isQuestUnlocked, QUESTS } from '../src/systems/QuestSystem';
import { startWave } from '../src/systems/WaveManager';

const quest = (id: string) => QUESTS.find(q => q.id === id)!;

function soloCampaignCumulative() {
  let kills = 0;
  let bosses = 0;
  let oceanKills = 0;
  return (wavesData as any[]).map(wave => {
    for (const group of wave.spawns) {
      const def = (enemiesData as any)[group.type] ?? {};
      const isBoss = !!def.isBoss;
      const lateSecondGateMirror = wave.wave >= 21 && !def.isBoss && !def.isFlyer;
      const count = lateSecondGateMirror ? group.count * 2 : group.count;
      kills += count;
      if (isBoss) bosses += count;
      if ((group as any).ocean) oceanKills += count;
    }
    return { wave: wave.wave, kills, bosses, oceanKills };
  });
}

describe('30-wave Solo quest pacing', () => {
  it('keeps 40 unique quests distributed across the three campaign acts', () => {
    expect(QUESTS).toHaveLength(40);
    expect(new Set(QUESTS.map(q => q.id)).size).toBe(40);
    expect(QUESTS.filter(q => q.tier === 'EARLY')).toHaveLength(11);
    expect(QUESTS.filter(q => q.tier === 'MID')).toHaveLength(14);
    expect(QUESTS.filter(q => q.tier === 'LATE')).toHaveLength(15);
  });

  it('adds playstyle quests: variety, gear, hero, relics, wealth, defense', () => {
    // 2026-07-02 — fun/unique goals per act instead of pure kill counters.
    expect(quest('recruiter').tier).toBe('EARLY');
    expect(quest('quartermaster').reward.item).toBe('WATCHTOWER_LENS');
    expect(quest('first_stripe').target).toBe(1);
    expect(quest('rampart_mason').reward).toEqual({ kind: 'GOLD', amount: 55 });
    expect(quest('battle_line').reward).toEqual({ kind: 'GOLD', amount: 80 });
    expect(quest('full_spectrum').target).toBe(4);
    expect(quest('kitted_veteran').target).toBe(3);
    expect(quest('oathbound').tier).toBe('MID');
    expect(quest('untouched_walls').tier).toBe('LATE');
    expect(quest('legion_without_end').target).toBe(24);
    expect(quest('croesus_of_rome').reward.kind).toBe('LIFE');

    // Condition spot-checks against a synthetic state.
    const s = createGameState();
    s.gold = 3000;
    expect(quest('croesus_of_rome').condition(s)).toBe(1);
    s.wave = 27; s.lives = 42; s.livesBoughtThisRun = 0;
    expect(quest('untouched_walls').condition(s)).toBe(1);
    s.lives = 41;
    expect(quest('untouched_walls').condition(s)).toBe(0);
    s.lives = 42;
    s.livesBoughtThisRun = 1;   // purchased lives disqualify the record
    expect(quest('untouched_walls').condition(s)).toBe(0);
    (s as any).campaignRelicIds = ['MARS_TAX', 'COPPER_TITHE'];
    expect(quest('oathbound').condition(s)).toBe(2);
    s.heroTier = 2;
    expect(quest('first_stripe').condition(s)).toBe(2);
    s.placedRamparts = [{ col: 5, row: 5, orient: 'H' }, { col: 9, row: 9, orient: 'D1' }];
    expect(quest('rampart_mason').condition(s)).toBe(2);
  });

  it('completes Field Engineer from cumulative purchases without repeating', () => {
    const state = createGameState();
    expect(quest('field_engineer').tier).toBe('MID');
    expect(quest('field_engineer').target).toBe(8);

    state.trapsPurchased = 8;
    expect(evaluateQuests(state).map(q => q.id)).toContain('field_engineer');
    expect(evaluateQuests(state).map(q => q.id)).not.toContain('field_engineer');
  });

  it('adds two mid-game gold quests for ramparts and tower count', () => {
    const rampartState = createGameState();
    expect(quest('rampart_mason').tier).toBe('MID');
    expect(quest('rampart_mason').reward.kind).toBe('GOLD');
    rampartState.placedRamparts = [{ col: 7, row: 7, orient: 'V' }, { col: 11, row: 9, orient: 'D2' }];
    expect(evaluateQuests(rampartState).map(q => q.id)).toContain('rampart_mason');
    expect(evaluateQuests(rampartState).map(q => q.id)).not.toContain('rampart_mason');

    const towerState = createGameState();
    expect(quest('battle_line').tier).toBe('MID');
    expect(quest('battle_line').target).toBe(12);
    for (let i = 0; i < 12; i++) {
      towerState.towers.set(`t${i}`, { pending: false } as any);
    }
    expect(quest('battle_line').condition(towerState)).toBe(12);
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

  it('adds water-economy quests for ocean threats, Harbor adoption, and naval combos', () => {
    expect(quest('shipwreck_omen').reward).toEqual({ kind: 'GOLD', amount: 20 });
    expect(quest('harbor_charter').reward).toEqual({ kind: 'GOLD', amount: 50 });
    expect(quest('dockside_battery').reward).toEqual({ kind: 'GOLD', amount: 85 });
    expect(quest('tideforged_doctrine').reward).toEqual({ kind: 'GOLD', amount: 150 });
    expect(quest('leviathan_pact').reward).toEqual({ kind: 'GOLD', amount: 220 });

    const oceanKills = createGameState();
    oceanKills.oceanEnemiesKilled = 40;
    expect(evaluateQuests(oceanKills).map(q => q.id)).toContain('shipwreck_omen');

    const harbor = createGameState();
    (harbor as any).harborUnlocked = true;
    expect(evaluateQuests(harbor).map(q => q.id)).toContain('harbor_charter');

    const dock = createGameState();
    dock.towers.set('h1', { type: TowerType.TRIREME_BALLISTA, pending: false, placedOnWater: true } as any);
    dock.towers.set('h2', { type: TowerType.CORVUS_BOARDING_SHIP, pending: false, placedOnWater: true } as any);
    expect(evaluateQuests(dock).map(q => q.id)).toContain('dockside_battery');

    const tideforged = createGameState();
    tideforged.towers.set('tf1', { type: TowerType.PRAETORIAN_FLEET, pending: false, placedOnWater: true } as any);
    expect(evaluateQuests(tideforged).map(q => q.id)).not.toContain('tideforged_doctrine');
    tideforged.towers.set('tf2', { type: TowerType.ORACLE_LIGHTHOUSE, pending: false, placedOnWater: true } as any);
    expect(evaluateQuests(tideforged).map(q => q.id)).toContain('tideforged_doctrine');

    const leviathan = createGameState();
    leviathan.combosBuiltUniqueTypes = ['NEPTUNES_LEVIATHAN'];
    expect(evaluateQuests(leviathan).map(q => q.id)).toContain('leviathan_pact');
  });

  it('reveals advanced quest families progressively and caps journal clutter', () => {
    const state = createGameState();
    state.wave = 15;
    let active = activeQuestsByTier(state);
    expect(active.LATE.map(q => q.id)).not.toContain('omega_foundry');
    expect(active.MID.map(q => q.id)).not.toContain('dockside_battery');
    expect(active.EARLY.length).toBeLessThanOrEqual(5);
    expect(active.MID.length).toBeLessThanOrEqual(5);
    expect(active.LATE.length).toBeLessThanOrEqual(5);

    (state as any).harborUnlocked = true;
    state.combosBuiltUniqueTypes = ['JULIUS_CAESAR'];
    expect(isQuestUnlocked(state, quest('dockside_battery'))).toBe(true);

    state.combosBuiltUniqueTypes = ['JULIUS_CAESAR', 'HANNIBALS_NIGHTMARE'];
    expect(isQuestUnlocked(state, quest('omega_foundry'))).toBe(true);
  });

  it('paces total-kill quests near waves 7, 13, and 24', () => {
    const campaign = soloCampaignCumulative();
    const completionWave = (target: number) => campaign.find(row => row.kills >= target)?.wave;
    expect(quest('bloodline').target).toBe(430);
    expect(quest('butcher').target).toBe(900);
    expect(quest('destroyer').target).toBe(2500);
    expect(completionWave(quest('bloodline').target)).toBe(7);
    expect(completionWave(quest('butcher').target)).toBe(13);
    expect(completionWave(quest('destroyer').target)).toBe(24);
  });

  it('paces boss quests against true bosses rather than elephant elites', () => {
    const campaign = soloCampaignCumulative();
    const completionWave = (target: number) => campaign.find(row => row.bosses >= target)?.wave;
    expect(quest('beast_slayer').target).toBe(3);
    expect(quest('boss_hunter').target).toBe(4);
    expect(quest('boss_slayer_supreme').target).toBe(7);
    expect(completionWave(quest('beast_slayer').target)).toBe(10);
    expect(completionWave(quest('boss_hunter').target)).toBe(20);
    expect(completionWave(quest('boss_slayer_supreme').target)).toBe(30);
  });

  it('prevents the updated early campaign from cashing out too many milestone quests on wave 5', () => {
    const campaign = soloCampaignCumulative();
    const wave5 = campaign.find(row => row.wave === 5)!;
    expect(wave5.kills).toBeLessThan(quest('bloodline').target);
    expect(wave5.bosses).toBeLessThan(quest('beast_slayer').target);
    expect(quest('iron_discipline').target).toBeGreaterThan(120);
    expect(wave5.oceanKills).toBeGreaterThanOrEqual(quest('shipwreck_omen').target);
  });

  it('aligns single-tower mastery with the long campaign badge ladder', () => {
    expect(quest('iron_discipline').target).toBe(160);
    expect(quest('champion_tower').target).toBe(200);
    expect(quest('legend_tower').target).toBe(650);
    expect(quest('eternal_bulwark').target).toBe(29);
  });

  it('rewards super combo, omega combo, combo volume, and 15M DPS check milestones', () => {
    expect(quest('super_combo_commission').reward).toEqual({ kind: 'GOLD', amount: 500 });
    expect(quest('omega_foundry').reward).toEqual({ kind: 'GOLD', amount: 1000 });
    expect(quest('apex_forger').target).toBe(2);
    expect(quest('combo_dynasty').target).toBe(20);
    expect(quest('combo_dynasty').reward).toEqual({ kind: 'GOLD', amount: 1000 });
    expect(quest('ten_million_dps').target).toBe(15000000);
    expect(quest('ten_million_dps').reward).toEqual({ kind: 'GOLD', amount: 500 });

    const apexState = createGameState();
    apexState.combosBuiltUniqueTypes = ['LEGION_PRIME'];
    expect(evaluateQuests(apexState).map(q => q.id)).not.toContain('apex_forger');
    apexState.combosBuiltUniqueTypes.push('CONSULAR_FATEBINDER');
    expect(evaluateQuests(apexState).map(q => q.id)).toContain('apex_forger');

    const superState = createGameState();
    superState.combosBuiltUniqueTypes = ['HANNIBALS_NIGHTMARE'];
    expect(evaluateQuests(superState).map(q => q.id)).toContain('super_combo_commission');

    const omegaState = createGameState();
    omegaState.combosBuiltUniqueTypes = ['ROMAN_TRANSFORMER'];
    expect(evaluateQuests(omegaState).map(q => q.id)).toContain('omega_foundry');

    const volumeState = createGameState();
    volumeState.combosBuilt = 20;
    expect(evaluateQuests(volumeState).map(q => q.id)).toContain('combo_dynasty');

    const dpsState = createGameState();
    dpsState.bestDpsCheck = 15000000;
    expect(evaluateQuests(dpsState).map(q => q.id)).toContain('ten_million_dps');
  });

  it('completes new thresholds exactly once and preserves tier identity', () => {
    const state = createGameState();
    state.totalKills = 2500;
    state.bossesKilled = 20;
    state.wave = 29;
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
