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
        kills += group.count;
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
        kills += group.count;
        if (wave.type === 'B' && def.isBoss && !ADD_BOSS_TYPES.has(group.type)) {
          majorBossBounties += group.count * (22 + Math.round(wave.wave * 3.5));
        }
      }
    }

    const guaranteed = ECONOMY.STARTING_GOLD + kills + waveGold + majorBossBounties;
    expect(kills).toBe(2275);
    expect(guaranteed).toBe(3399);
    expect(guaranteed).toBeLessThan(3400);
  });

  it('keeps ordinary random drops rare outside bosses, commanders, and events', () => {
    let ground = 0;
    let flyers = 0;
    for (const wave of wavesData as any[]) {
      for (const group of wave.spawns) {
        const def = (enemiesData as any)[group.type] ?? {};
        if (wave.type === 'B' && wave.wave <= 15 && !def.isBoss) continue;
        if (def.isFlyer) flyers += group.count;
        else ground += group.count;
      }
    }
    // 2026-07-03 — drop rates +33% (0.0015/0.003 → 0.002/0.004), so the
    // expected free-drop count per campaign rose from ~3.4 to ~4.5.
    const expected = ground * LOOT_DROP_RATES.GROUND + flyers * LOOT_DROP_RATES.FLYER;
    expect(expected).toBeGreaterThan(4);
    expect(expected).toBeLessThan(5.5);
  });
});
