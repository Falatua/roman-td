import { describe, expect, it } from 'vitest';
import wavesData from '../src/data/waves.json';
import enemiesData from '../src/data/enemies.json';
import { ECONOMY, LOOT_DROP_RATES } from '../src/constants';
import { perfectWaveGoldBonus } from '../src/systems/EconomySystem';
import { QUESTS } from '../src/systems/QuestSystem';

const ADD_BOSS_TYPES = new Set(['WAR_ELEPHANT', 'UNDEAD_WAR_ELEPHANT']);

describe('30-wave Solo economy envelope', () => {
  it('keeps a perfect early opener below the old runaway 700g feel', () => {
    let kills = 0;
    let waveGold = 0;
    let bossBounties = 0;
    let questGold = 0;
    let perfectGold = 0;
    const completedQuests = new Set<string>();

    for (const wave of (wavesData as any[]).filter(w => w.wave <= 4)) {
      waveGold += wave.gold;
      perfectGold += perfectWaveGoldBonus(wave.wave);
      for (const group of wave.spawns) {
        const def = (enemiesData as any)[group.type] ?? {};
        const lateSecondGateMirror = wave.wave >= 21 && !def.isBoss && !def.isFlyer;
        kills += lateSecondGateMirror ? group.count * 2 : group.count;
        if (wave.type === 'B' && def.isBoss && !ADD_BOSS_TYPES.has(group.type)) {
          bossBounties += group.count * (22 + Math.round(wave.wave * 3.5));
        }
      }
      for (const quest of QUESTS) {
        if (completedQuests.has(quest.id) || quest.reward.kind !== 'GOLD') continue;
        const progress = quest.id === 'first_blood' ? Math.min(1, kills)
          : quest.id === 'bloodline' ? kills
          : 0;
        if (progress >= quest.target) {
          completedQuests.add(quest.id);
          questGold += quest.reward.amount ?? 0;
        }
      }
    }

    const perfectOpenerGold = ECONOMY.STARTING_GOLD + kills + waveGold + bossBounties + questGold + perfectGold;
    expect(perfectGold).toBe(40);
    expect(perfectOpenerGold).toBeLessThan(550);
  });

  it('keeps guaranteed authored income below the premium-buyout threshold', () => {
    let kills = 0;
    let waveGold = 0;
    let majorBossBounties = 0;

    for (const wave of wavesData as any[]) {
      waveGold += wave.gold;
      for (const group of wave.spawns) {
        const def = (enemiesData as any)[group.type] ?? {};
        if (wave.type === 'B' && wave.wave <= 15 && !def.isBoss) continue;
        const lateSecondGateMirror = wave.wave >= 21 && !def.isBoss && !def.isFlyer;
        kills += lateSecondGateMirror ? group.count * 2 : group.count;
        if (wave.type === 'B' && def.isBoss && !ADD_BOSS_TYPES.has(group.type)) {
          majorBossBounties += group.count * (22 + Math.round(wave.wave * 3.5));
        }
      }
    }

    const guaranteed = ECONOMY.STARTING_GOLD + kills + waveGold + majorBossBounties;
    expect(kills).toBe(2851);
    expect(guaranteed).toBe(3975);
    expect(guaranteed).toBeLessThan(4000);
  });

  it('keeps ordinary random drops rare outside bosses, commanders, and events', () => {
    let ground = 0;
    let flyers = 0;
    for (const wave of wavesData as any[]) {
      for (const group of wave.spawns) {
        const def = (enemiesData as any)[group.type] ?? {};
        if (wave.type === 'B' && wave.wave <= 15 && !def.isBoss) continue;
        if (def.isFlyer) flyers += group.count;
        else ground += wave.wave >= 21 && !def.isBoss ? group.count * 2 : group.count;
      }
    }
    // 2026-07-05 — Cave B now mirrors every W21+ ground non-boss spawn, so
    // the expected ordinary free-drop count rises with the doubled late lanes.
    const expected = ground * LOOT_DROP_RATES.GROUND + flyers * LOOT_DROP_RATES.FLYER;
    expect(expected).toBeGreaterThan(5);
    expect(expected).toBeLessThan(6.5);
  });
});
