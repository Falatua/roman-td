import { describe, expect, it } from 'vitest';
import wavesData from '../src/data/waves.json';
import enemiesData from '../src/data/enemies.json';
import { ECONOMY, LOOT_DROP_RATES } from '../src/constants';
import { commanderKillGoldBounty, perfectWaveGoldBonus } from '../src/systems/EconomySystem';
import { QUESTS } from '../src/systems/QuestSystem';
import { isBossEnemy, isCommanderEnemy, isEliteEnemy } from '../src/systems/EnemyClassification';

describe('30-wave Solo economy envelope', () => {
  it('starts every Solo campaign with 150 gold', () => {
    expect(ECONOMY.STARTING_GOLD).toBe(150);
  });

  it('reserves a meaningful 25g bounty for commanders, not bosses or elites', () => {
    expect(ECONOMY.COMMANDER_KILL_BOUNTY).toBe(25);
    expect(commanderKillGoldBounty('STANDARD_BEARER_COMMANDER')).toBe(25);
    expect(commanderKillGoldBounty('WAR_ELEPHANT')).toBe(0);
    expect(commanderKillGoldBounty('HANNIBAL_BARCA')).toBe(0);
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
        if (wave.type === 'B' && isBossEnemy(group.type)) {
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

  it('keeps guaranteed full-run income in the late-combination investment range', () => {
    let authoredKills = 0;
    let goldKills = 0;
    let authoredCommanderKills = 0;
    let waveGold = 0;
    let majorBossBounties = 0;

    for (const wave of wavesData as any[]) {
      waveGold += wave.gold;
      for (const group of wave.spawns) {
        const def = (enemiesData as any)[group.type] ?? {};
        if (wave.type === 'B' && wave.wave <= 15 && !isBossEnemy(group.type) && !isEliteEnemy(group.type)) continue;
        const lateSecondGateMirror = wave.wave >= 21 && !(group as any).ocean && !isBossEnemy(group.type) && !def.isFlyer;
        const count = lateSecondGateMirror ? group.count * 2 : group.count;
        authoredKills += count;
        if (!def.noGoldReward) goldKills += count;
        if (isCommanderEnemy(group.type)) authoredCommanderKills += count;
        if (wave.type === 'B' && isBossEnemy(group.type)) {
          majorBossBounties += group.count * (22 + Math.round(wave.wave * 3.5));
        }
      }
    }

    // Live scheduling adds campaign commanders and boss escorts beyond the
    // authored JSON groups. The CommanderSystem integration test locks the
    // complete schedule at 88, split 18 before W21 and 70 afterward.
    const scheduledCommanderKills = 88;
    const injectedCommanderBaselineKills = scheduledCommanderKills - authoredCommanderKills;
    const commanderBounties = scheduledCommanderKills * ECONOMY.COMMANDER_KILL_BOUNTY;
    const guaranteed = ECONOMY.STARTING_GOLD + goldKills + injectedCommanderBaselineKills
      + commanderBounties + waveGold + majorBossBounties;
    expect(authoredKills).toBe(2923);
    expect(goldKills).toBe(2893);
    expect(authoredCommanderKills).toBe(69);
    expect(guaranteed).toBe(6239);
    expect(guaranteed).toBeGreaterThan(6200);
    expect(guaranteed).toBeLessThan(6400);
  });

  it('keeps ordinary random drops rare outside bosses, commanders, and events', () => {
    let ground = 0;
    let flyers = 0;
    for (const wave of wavesData as any[]) {
      for (const group of wave.spawns) {
        const def = (enemiesData as any)[group.type] ?? {};
        if (def.noItemDrop) continue;
        if (wave.type === 'B' && wave.wave <= 15 && !isBossEnemy(group.type) && !isEliteEnemy(group.type)) continue;
        if (def.isFlyer) flyers += group.count;
        else ground += wave.wave >= 21 && !isBossEnemy(group.type) ? group.count * 2 : group.count;
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
