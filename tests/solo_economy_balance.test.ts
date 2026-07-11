import { describe, expect, it } from 'vitest';
import wavesData from '../src/data/waves.json';
import enemiesData from '../src/data/enemies.json';
import { ECONOMY, LOOT_DROP_RATES } from '../src/constants';
import { perfectWaveGoldBonus } from '../src/systems/EconomySystem';
import { QUESTS } from '../src/systems/QuestSystem';

const ADD_BOSS_TYPES = new Set(['WAR_ELEPHANT', 'UNDEAD_WAR_ELEPHANT']);

describe('30-wave Solo economy envelope', () => {
  it('starts every Solo campaign with 150 gold', () => {
    expect(ECONOMY.STARTING_GOLD).toBe(150);
  });

  it('keeps a perfect early opener below the old runaway 700g feel', () => {
    let kills = 0;
    let waveGold = 0;
    let bossBounties = 0;
    let questGold = 0;
    let perfectGold = 0;
    let oceanKills = 0;
    const completedQuests = new Set<string>();

    for (const wave of (wavesData as any[]).filter(w => w.wave <= 4)) {
      waveGold += wave.gold;
      perfectGold += perfectWaveGoldBonus(wave.wave);
      for (const group of wave.spawns) {
        const def = (enemiesData as any)[group.type] ?? {};
        const lateSecondGateMirror = wave.wave >= 21 && !def.isBoss && !def.isFlyer;
        kills += lateSecondGateMirror ? group.count * 2 : group.count;
        if ((group as any).ocean) oceanKills += group.count;
        if (wave.type === 'B' && def.isBoss && !ADD_BOSS_TYPES.has(group.type)) {
          bossBounties += group.count * (22 + Math.round(wave.wave * 3.5));
        }
      }
      for (const quest of QUESTS) {
        if (completedQuests.has(quest.id) || quest.reward.kind !== 'GOLD') continue;
        const progress = quest.id === 'first_blood' ? Math.min(1, kills)
          : quest.id === 'bloodline' ? kills
          : quest.id === 'shipwreck_omen' ? oceanKills
          : 0;
        if (progress >= quest.target) {
          completedQuests.add(quest.id);
          questGold += quest.reward.amount ?? 0;
        }
      }
    }

    const perfectOpenerGold = ECONOMY.STARTING_GOLD + kills + waveGold + bossBounties + questGold + perfectGold;
    expect(perfectGold).toBe(40);
    expect(perfectOpenerGold).toBe(559);
    expect(perfectOpenerGold).toBeLessThan(600);
  });

  it('keeps guaranteed authored income below the premium-buyout threshold', () => {
    let authoredKills = 0;
    let goldKills = 0;
    let waveGold = 0;
    let majorBossBounties = 0;

    for (const wave of wavesData as any[]) {
      waveGold += wave.gold;
      for (const group of wave.spawns) {
        const def = (enemiesData as any)[group.type] ?? {};
        if (wave.type === 'B' && wave.wave <= 15 && !def.isBoss) continue;
        const lateSecondGateMirror = wave.wave >= 21 && !def.isBoss && !def.isFlyer;
        const count = lateSecondGateMirror ? group.count * 2 : group.count;
        authoredKills += count;
        if (!def.noGoldReward) goldKills += count;
        if (wave.type === 'B' && def.isBoss && !ADD_BOSS_TYPES.has(group.type)) {
          majorBossBounties += group.count * (22 + Math.round(wave.wave * 3.5));
        }
      }
    }

    const guaranteed = ECONOMY.STARTING_GOLD + goldKills + waveGold + majorBossBounties;
    expect(authoredKills).toBe(2949);
    expect(goldKills).toBe(2919);
    expect(guaranteed).toBe(4046);
    expect(guaranteed).toBeLessThan(4100);
  });

  it('keeps ordinary random drops rare outside bosses, commanders, and events', () => {
    let ground = 0;
    let flyers = 0;
    for (const wave of wavesData as any[]) {
      for (const group of wave.spawns) {
        const def = (enemiesData as any)[group.type] ?? {};
        if (def.noItemDrop) continue;
        if (wave.type === 'B' && wave.wave <= 15 && !def.isBoss) continue;
        if (def.isFlyer) flyers += group.count;
        else ground += wave.wave >= 21 && !def.isBoss ? group.count * 2 : group.count;
      }
    }
    // 2026-07-08 — ordinary random floor loot should stay present but quiet;
    // special item moments belong more to bosses, commanders, events, and
    // ocean-specialist rewards.
    const expected = ground * LOOT_DROP_RATES.GROUND + flyers * LOOT_DROP_RATES.FLYER;
    expect(expected).toBeGreaterThan(4);
    expect(expected).toBeLessThan(5.25);
  });
});
