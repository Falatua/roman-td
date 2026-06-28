import { describe, expect, it } from 'vitest';
import wavesData from '../src/data/waves.json';
import enemiesData from '../src/data/enemies.json';
import { ECONOMY, LOOT_DROP_RATES } from '../src/constants';

const ADD_BOSS_TYPES = new Set(['WAR_ELEPHANT', 'UNDEAD_WAR_ELEPHANT']);

describe('30-wave Solo economy envelope', () => {
  it('keeps guaranteed authored income below the premium-buyout threshold', () => {
    let kills = 0;
    let waveGold = 0;
    let majorBossBounties = 0;

    for (const wave of wavesData as any[]) {
      waveGold += wave.gold;
      for (const group of wave.spawns) {
        const def = (enemiesData as any)[group.type] ?? {};
        if (wave.type === 'B' && !def.isBoss) continue;
        kills += group.count;
        if (wave.type === 'B' && def.isBoss && !ADD_BOSS_TYPES.has(group.type)) {
          majorBossBounties += group.count * (22 + Math.round(wave.wave * 3.5));
        }
      }
    }

    const guaranteed = ECONOMY.STARTING_GOLD + kills + waveGold + majorBossBounties;
    expect(kills).toBe(2029);
    expect(guaranteed).toBe(3199);
    expect(guaranteed).toBeLessThan(3200);
  });

  it('averages roughly six ordinary drops across authored enemies', () => {
    let ground = 0;
    let flyers = 0;
    for (const wave of wavesData as any[]) {
      for (const group of wave.spawns) {
        const def = (enemiesData as any)[group.type] ?? {};
        if (wave.type === 'B' && !def.isBoss) continue;
        if (def.isFlyer) flyers += group.count;
        else ground += group.count;
      }
    }
    const expected = ground * LOOT_DROP_RATES.GROUND + flyers * LOOT_DROP_RATES.FLYER;
    expect(expected).toBeGreaterThan(5);
    expect(expected).toBeLessThan(7);
  });
});
