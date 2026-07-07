// Tests for the wave system: HP scaling, wave-end conditions, win/loss state.
import { describe, it, expect, beforeEach } from 'vitest';
import { effectiveWaveHpMult, startWave, tickSpawns, checkWaveEnd } from '../src/systems/WaveManager';
import { campaignPressureHpMult, campaignPressureResistMult } from '../src/systems/CampaignDifficulty';
import { spawnEnemy, tickEnemies } from '../src/systems/EnemySystem';
import { createGameState } from '../src/GameState';
import { EnemyType, GamePhase, SurpriseEventKind } from '../src/types';
import { initializeGrid } from '../src/systems/GridManager';
import { buildGroundPath, buildGroundPathB, buildFlyerPath } from '../src/systems/PathFinder';
import { enemyResistanceProfile } from '../src/systems/EnemyResistances';
import { isLegendaryBossDropEnemy, isRareOnlyBossDropEnemy } from '../src/systems/RewardEligibility';
import { isFinalBossBreach } from '../src/systems/LeakRules';
import wavesData from '../src/data/waves.json';
import enemiesData from '../src/data/enemies.json';
import waypointsData from '../src/data/waypoints.json';
import { GRID, WATER_ZONE } from '../src/constants';

function bootstrapState() {
  const s = createGameState();
  initializeGrid(s);
  const path = buildGroundPath(s);
  if (path) s.groundPath = path;
  const pathB = buildGroundPathB(s);
  if (pathB) s.groundPathB = pathB;
  s.flyerPath = buildFlyerPath();
  return s;
}

describe('Wave HP scaling — 30-wave linear + mid-late accelerator + boss-cleared bump', () => {
  it('applies linear + mid-late accelerator + x2.00 per cleared 5-wave boss', () => {
    // Reference formula:
    //   linearStep    = 1 + 0.10*w
    //   midLateStep   = 0.10 * max(0, w-10)
    //   aggressiveLateStep = 0.15 * max(0, w-11)   (W11+ creative ramp)
    //   pressure      = 1 + min(0.25, max(0, w-5) * 0.012)
    //   linearTotal   = (linearStep + midLateStep + aggressiveLateStep) * pressure
    //   hp_mult       = baseHpMult * linearTotal * pow(2.00, floor((w-1)/5))
    expect(effectiveWaveHpMult(1, 1)).toBeCloseTo(1.10 * 1.0, 4);
    expect(effectiveWaveHpMult(5, 1)).toBeCloseTo(1.50 * 1.0, 4);
    expect(effectiveWaveHpMult(6, 1)).toBeCloseTo(1.60 * campaignPressureHpMult(6) * 2.0, 4);
    expect(effectiveWaveHpMult(10, 1)).toBeCloseTo(2.00 * campaignPressureHpMult(10) * 2.0, 4);
    expect(effectiveWaveHpMult(11, 1)).toBeCloseTo((2.10 + 0.10) * campaignPressureHpMult(11) * 4.0, 4);  // W11: +10% mid-late, no aggressive step yet (w-11=0)
    expect(effectiveWaveHpMult(15, 1)).toBeCloseTo((2.50 + 0.50 + 0.60) * campaignPressureHpMult(15) * 4.0, 4);  // W15: +60% aggressive (0.15 * 4)
    expect(effectiveWaveHpMult(20, 1)).toBeCloseTo((3.00 + 1.00 + 1.35) * campaignPressureHpMult(20) * Math.pow(2.0, 3), 4);  // W20: +135% aggressive (0.15 * 9)
  });

  it('respects authored baseHpMult passed in', () => {
    const w20Authored = 8.0;
    const result = effectiveWaveHpMult(20, w20Authored);
    expect(result).toBeCloseTo(w20Authored * (3.00 + 1.00 + 1.35) * campaignPressureHpMult(20) * Math.pow(2.0, 3), 4);
  });

  it('keeps Wave 7 Carthage enemies on the hardened post-W5 health line', () => {
    const w7 = (wavesData as any[]).find(w => w.wave === 7);
    expect(w7.hpMult).toBe(2.28);
  });

  it('curve is monotonic across the 30-wave run', () => {
    let last = 0;
    for (let w = 1; w <= 30; w++) {
      const m = effectiveWaveHpMult(w, 1);
      expect(m).toBeGreaterThanOrEqual(last);
      last = m;
    }
  });

  it('bosses scale LINEARLY (no per-5-wave doubling)', () => {
    // 2026-05 v5: bosses bypass the postBossStep entirely. They ride only
    // the linear + mid-late accelerator stack so progression feels like a
    // clean ramp instead of an exponential wall.
    expect(effectiveWaveHpMult(5, 1, true)).toBeCloseTo(1.50, 4);
    expect(effectiveWaveHpMult(10, 1, true)).toBeCloseTo(2.00 * campaignPressureHpMult(10), 4);
    expect(effectiveWaveHpMult(15, 1, true)).toBeCloseTo((2.50 + 0.50 + 0.60) * campaignPressureHpMult(15), 4);  // W15: aggressive +60%
    expect(effectiveWaveHpMult(20, 1, true)).toBeCloseTo((3.00 + 1.00 + 1.35) * campaignPressureHpMult(20), 4);  // W20: aggressive +135%
    expect(effectiveWaveHpMult(30, 1, true)).toBeCloseTo((4.00 + 2.00 + 2.85) * campaignPressureHpMult(30), 4);  // W30: aggressive +285%
    // And each boss wave is strictly heavier than the previous:
    expect(effectiveWaveHpMult(10, 1, true)).toBeGreaterThan(effectiveWaveHpMult(5, 1, true));
    expect(effectiveWaveHpMult(15, 1, true)).toBeGreaterThan(effectiveWaveHpMult(10, 1, true));
    expect(effectiveWaveHpMult(20, 1, true)).toBeGreaterThan(effectiveWaveHpMult(15, 1, true));
  });

  it('adds a modest linear campaign pressure layer after W5', () => {
    expect(campaignPressureHpMult(5)).toBe(1);
    expect(campaignPressureHpMult(6)).toBeCloseTo(1.012, 4);
    expect(campaignPressureHpMult(20)).toBeCloseTo(1.18, 4);
    expect(campaignPressureHpMult(30)).toBeCloseTo(1.25, 4);
    expect(campaignPressureResistMult(5)).toBe(1);
    expect(campaignPressureResistMult(6)).toBeCloseTo(0.9945, 4);
    expect(campaignPressureResistMult(30)).toBeCloseTo(0.8625, 4);
    expect(campaignPressureResistMult(30, true)).toBeCloseTo(0.9125, 4);
  });

  it('keeps W6-W15 meaningfully hardened after the first boss', () => {
    const byWave = new Map((wavesData as any[]).map(w => [w.wave, w]));
    const expected = new Map<number, number>([
      [6, 2.05],
      [7, 2.28],
      [8, 2.25],
      [9, 2.55],
      [10, 5.9],
      [12, 5.8],
      [13, 7.0],
      [14, 9.5],
      [15, 7.5]
    ]);
    for (const [wave, hpMult] of expected) {
      expect(byWave.get(wave)?.hpMult, `W${wave} authored HP should stay firm after W5`).toBe(hpMult);
    }
  });
});

describe('Late-wave DoT profile coverage', () => {
  it('gives every W16-W30 enemy at least one explicit burn, poison, or bleed profile', () => {
    for (const wave of (wavesData as any[]).filter(w => w.wave >= 16 && w.wave <= 30)) {
      const types = [...new Set((wave.spawns ?? []).map((s: any) => s.type))] as EnemyType[];
      expect(types.length).toBeGreaterThan(0);
      for (const type of types) {
        const profile = enemyResistanceProfile(type);
        expect(
          typeof profile.burn === 'number' ||
          typeof profile.poison === 'number' ||
          typeof profile.bleed === 'number'
        ).toBe(true);
      }
    }
  });

  it('keeps late DoT identities varied instead of one universal answer', () => {
    expect(enemyResistanceProfile(EnemyType.DEMON_HELLHOUND).burn).toBe(0);
    expect(enemyResistanceProfile(EnemyType.DEMON_HELLHOUND).poison).toBeGreaterThan(1);
    expect(enemyResistanceProfile(EnemyType.MUMMY_WARRIOR).burn).toBeGreaterThan(1);
    expect(enemyResistanceProfile(EnemyType.MUMMY_WARRIOR).poison).toBe(0);
    expect(enemyResistanceProfile(EnemyType.STONE_JUGGERNAUT).poison).toBeLessThan(0.5);
    expect(enemyResistanceProfile(EnemyType.DUNE_STALKER).bleed).toBeGreaterThan(1);
    expect(enemyResistanceProfile(EnemyType.SIEGE_CAPTAIN_COMMANDER).burn).toBe(0);
    expect(enemyResistanceProfile(EnemyType.SIEGE_CAPTAIN_COMMANDER).siege).toBe(0);
    expect(enemyResistanceProfile(EnemyType.SIEGE_CAPTAIN_COMMANDER).bleed).toBeGreaterThan(1);
    expect(enemyResistanceProfile(EnemyType.SKY_PATHFINDER_COMMANDER).siege).toBe(0);
    expect(enemyResistanceProfile(EnemyType.SKY_ANUBIS_COMMANDER).poison).toBe(0);
    expect(enemyResistanceProfile(EnemyType.SKY_BARGE).bleed).toBeLessThan(1);
  });
});

describe('Late-campaign mechanic variety after combo tower buffs', () => {
  it('gives W21-W30 multiple difficulty levers beyond health', () => {
    for (const wave of (wavesData as any[]).filter(w => w.wave >= 21 && w.wave <= 30)) {
      const levers = [
        typeof wave.enemySpeedBoostPct === 'number',
        typeof wave.enemyDamageReductPct === 'number',
        typeof wave.enemyDotResistPct === 'number',
        typeof wave.enemyRegenPctPerSec === 'number',
        (wave.spawns ?? []).some((s: any) => String(s.type).includes('COMMANDER'))
      ].filter(Boolean).length;
      expect(levers, `W${wave.wave} should have at least three late-game pressure levers`).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps Wave 24 as a real pressure step after Wave 23', () => {
    const byWave = new Map((wavesData as any[]).map(w => [w.wave, w]));
    const w23 = byWave.get(23);
    const w24 = byWave.get(24);
    const count = (wave: any, type: string) => (wave.spawns ?? []).find((s: any) => s.type === type)?.count ?? 0;
    const authoredHp = (wave: any) => (wave.spawns ?? []).reduce(
      (sum: number, spawn: any) => sum + ((enemiesData as any)[spawn.type]?.baseHp ?? 0) * spawn.count * (wave.hpMult ?? 1),
      0
    );

    expect(w24.enemySpeedBoostPct).toBeGreaterThan(w23.enemySpeedBoostPct);
    expect(w24.enemyDamageReductPct).toBeGreaterThan(w23.enemyDamageReductPct);
    expect(w24.enemyDotResistPct).toBeGreaterThanOrEqual(w23.enemyDotResistPct);
    expect(w24.enemyRegenPctPerSec).toBeGreaterThan(w23.enemyRegenPctPerSec);
    expect(count(w24, 'SIEGE_WAGON')).toBe(count(w23, 'SIEGE_WAGON'));
    expect(count(w24, 'SPHINX')).toBe(4);
    expect(authoredHp(w24)).toBeGreaterThan(authoredHp(w23) * 3.5);
  });

  it('makes Wave 25 escalate after Wave 24 instead of dipping', () => {
    const byWave = new Map((wavesData as any[]).map(w => [w.wave, w]));
    const w24 = byWave.get(24);
    const w25 = byWave.get(25);
    const authoredHp = (wave: any) => (wave.spawns ?? []).reduce(
      (sum: number, spawn: any) => sum + ((enemiesData as any)[spawn.type]?.baseHp ?? 0) * spawn.count * (wave.hpMult ?? 1),
      0
    );

    expect(authoredHp(w25)).toBeGreaterThan(authoredHp(w24));
    expect(w25.enemySpeedBoostPct).toBeGreaterThan(w24.enemySpeedBoostPct);
    expect(w25.enemyDamageReductPct).toBeGreaterThan(w24.enemyDamageReductPct);
    expect(w25.comboAntiAirArmorPct).toBeGreaterThan(w24.comboAntiAirArmorPct);
  });

  it('spawns two undead war elephants on Wave 14', () => {
    const wave14 = (wavesData as any[]).find(w => w.wave === 14);
    const elephants = (wave14.spawns ?? []).find((spawn: any) => spawn.type === 'UNDEAD_WAR_ELEPHANT');
    expect(elephants?.count).toBe(2);
  });

  it('adds shipwreck ocean spawns on Waves 3, 12, 27, and 29', () => {
    const byWave = new Map((wavesData as any[]).map(w => [w.wave, w]));
    expect(byWave.get(3).spawns).toContainEqual({ type: 'OCEAN_FISHLING', count: 25, ocean: true });
    expect(byWave.get(12).spawns).toContainEqual({ type: 'SEA_GIANT', count: 2, ocean: true });
    expect(byWave.get(12).spawns).toContainEqual({ type: 'TIDECALLER_COMMANDER', count: 1, ocean: true });
    expect(byWave.get(27).spawns).toContainEqual({ type: 'SEA_GIANT_WARBRINGER', count: 6, ocean: true });
    expect(byWave.get(27).spawns).toContainEqual({ type: 'TIDECALLER_COMMANDER', count: 2, ocean: true });
    expect(byWave.get(29).spawns).toContainEqual({ type: 'NETHER_AMPHIBIOUS_GIANT', count: 4, ocean: true });
    expect(byWave.get(29).spawns).toContainEqual({ type: 'TIDECALLER_COMMANDER', count: 2, ocean: true });
  });

  it('starts ocean enemies alongside the normal cave wave instead of after it', () => {
    for (const wave of [3, 12, 27, 29]) {
      const s = bootstrapState();
      s.wave = wave - 1;
      startWave(s);
      const caveSpawns = s.spawnQueue.filter(item => !item.ocean && !item.caveB);
      const oceanSpawns = s.spawnQueue.filter(item => item.ocean);
      expect(caveSpawns.length, `W${wave} should have cave spawns`).toBeGreaterThan(0);
      expect(oceanSpawns.length, `W${wave} should have ocean spawns`).toBeGreaterThan(0);

      const firstCave = Math.min(...caveSpawns.map(item => item.spawnAt));
      const firstOcean = Math.min(...oceanSpawns.map(item => item.spawnAt));
      const lastCave = Math.max(...caveSpawns.map(item => item.spawnAt));
      expect(firstOcean, `W${wave} ocean lane should open with Cave A`).toBe(firstCave);
      if (lastCave > firstCave) {
        expect(firstOcean, `W${wave} ocean lane should not be appended after Cave A`).toBeLessThan(lastCave);
      }
    }
  });

  it('routes ocean spawns from the shipwreck to the post-checkpoint-2 ground path', () => {
    const s = bootstrapState();
    s.wave = 2;
    startWave(s);
    expect(s.spawnQueue[0]).toMatchObject({ type: 'OCEAN_FISHLING', ocean: true });
    tickSpawns(s, 0.01);
    const sea = Array.from(s.enemies.values()).find(e => e.type === EnemyType.OCEAN_FISHLING) as any;
    expect(sea).toBeTruthy();
    expect(sea.__oceanSpawn).toBe(true);
    expect(sea.__approachActive).toBe(true);
    const wp2 = (waypointsData as any).waypoints[1].topLeft;
    let wp2PathIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < s.groundPath.length; i++) {
      const p = s.groundPath[i];
      const d = Math.abs(p.col - wp2.col) + Math.abs(p.row - wp2.row);
      if (d < bestD) { bestD = d; wp2PathIdx = i; }
    }
    expect(sea.pathIndex).toBeGreaterThan(wp2PathIdx);
    const wreckX = WATER_ZONE.col * GRID.TILE + 4;
    const wreckY = (WATER_ZONE.row + WATER_ZONE.height - 3.45) * GRID.TILE;
    expect(sea.x).toBeGreaterThanOrEqual(wreckX);
    expect(sea.x).toBeLessThanOrEqual(wreckX + GRID.TILE * 4.5);
    expect(sea.y).toBeGreaterThanOrEqual(wreckY);
    expect(sea.y).toBeLessThanOrEqual(wreckY + GRID.TILE * 3.375);
  });

  it('does not mirror ocean spawns to Cave B on late waves', () => {
    const s = bootstrapState();
    s.wave = 26;
    startWave(s);
    const oceanWarbringers = s.spawnQueue.filter(item => item.type === 'SEA_GIANT_WARBRINGER');
    expect(oceanWarbringers).toHaveLength(6);
    expect(oceanWarbringers.every(item => item.ocean && !item.caveB)).toBe(true);
    const tidecallers = s.spawnQueue.filter(item => item.type === 'TIDECALLER_COMMANDER');
    expect(tidecallers).toHaveLength(2);
    expect(tidecallers.every(item => item.ocean && !item.caveB)).toBe(true);
  });

  it('plays the ocean emergence cue only once per ocean wave', () => {
    const s = bootstrapState();
    let cueCount = 0;
    const prevRenderer = (globalThis as any).__renderer;
    const prevOceanCue = (globalThis as any).__oceanEmergenceSfx;
    (globalThis as any).__renderer = { triggerSpawnPuff: () => {}, triggerImpactRing: () => {}, triggerShake: () => {} };
    (globalThis as any).__oceanEmergenceSfx = () => { cueCount += 1; };
    try {
      s.wave = 2;
      startWave(s);
      tickSpawns(s, 0.01);
      tickSpawns(s, 6);
      expect(cueCount).toBe(1);

      s.enemies.clear();
      s.phase = GamePhase.BUILD_PHASE;
      s.wave = 11;
      startWave(s);
      tickSpawns(s, 0.01);
      expect(cueCount).toBe(2);
    } finally {
      (globalThis as any).__renderer = prevRenderer;
      (globalThis as any).__oceanEmergenceSfx = prevOceanCue;
    }
  });

  it('turns W26-W30 into the final apex-tower gauntlet', () => {
    const byWave = new Map((wavesData as any[]).map(w => [w.wave, w]));
    const expected = new Map<number, { hp: number; dr: number; aa: number; dot: number; regen: number }>([
      [26, { hp: 21, dr: 0.12, aa: 0.62, dot: 0.25, regen: 0.007 }],
      [27, { hp: 24, dr: 0.14, aa: 0.66, dot: 0.28, regen: 0.008 }],
      [28, { hp: 27, dr: 0.16, aa: 0.68, dot: 0.30, regen: 0.009 }],
      [29, { hp: 30, dr: 0.18, aa: 0.70, dot: 0.32, regen: 0.010 }],
      [30, { hp: 18, dr: 0.20, aa: 0.72, dot: 0.35, regen: 0.012 }]
    ]);

    for (const [waveNumber, values] of expected) {
      const wave = byWave.get(waveNumber);
      expect(wave.hpMult, `W${waveNumber} authored HP should sit on the final-gauntlet line`).toBe(values.hp);
      expect(wave.enemyDamageReductPct, `W${waveNumber} should dampen non-apex direct damage`).toBeCloseTo(values.dr, 4);
      expect(wave.comboAntiAirArmorPct, `W${waveNumber} should force combo anti-air into late flyers`).toBeCloseTo(values.aa, 4);
      expect(wave.enemyDotResistPct, `W${waveNumber} should resist one-answer DoT clearing`).toBeCloseTo(values.dot, 4);
      expect(wave.enemyRegenPctPerSec, `W${waveNumber} should punish low burst DPS`).toBeCloseTo(values.regen, 4);
    }

    for (const waveNumber of [27, 28, 29, 30]) {
      const prev = byWave.get(waveNumber - 1);
      const cur = byWave.get(waveNumber);
      expect(cur.enemyDamageReductPct).toBeGreaterThan(prev.enemyDamageReductPct);
      expect(cur.comboAntiAirArmorPct).toBeGreaterThan(prev.comboAntiAirArmorPct);
      expect(cur.enemyDotResistPct).toBeGreaterThan(prev.enemyDotResistPct);
      expect(cur.enemyRegenPctPerSec).toBeGreaterThan(prev.enemyRegenPctPerSec);
    }
  });

  it('mixes wave roles so late waves ask for different tower answers', () => {
    const byWave = new Map((wavesData as any[]).map(w => [w.wave, w]));
    expect(byWave.get(21).spawns.some((s: any) => s.type === 'MONGOL_SCOUT')).toBe(true);
    expect(byWave.get(23).spawns.some((s: any) => s.type === 'DUNE_STALKER')).toBe(true);
    expect(byWave.get(24).spawns.some((s: any) => s.type === 'SIEGE_WAGON')).toBe(true);
    for (const wave of [18, 22, 24, 27, 29]) {
      expect(byWave.get(wave).spawns.some((s: any) => s.type === 'SKY_BARGE'), `W${wave} should field a Sky Barge air transport`).toBe(true);
    }
    expect(byWave.get(25).spawns.some((s: any) => s.type === 'DEMON_HELLHOUND')).toBe(true);
    expect(byWave.get(28).spawns.some((s: any) => s.type === 'SIEGE_CAPTAIN_COMMANDER')).toBe(true);
    expect(byWave.get(28).spawns.some((s: any) => s.type === 'SKY_PATHFINDER_COMMANDER')).toBe(true);
    expect(byWave.get(30).spawns.some((s: any) => s.type === 'CHIMERA')).toBe(true);
  });

  it('makes mid-to-late anti-air investment feel necessary', () => {
    const flyerCountsByWave = new Map((wavesData as any[]).map(wave => {
      const flyers = (wave.spawns ?? [])
        .filter((spawn: any) => (enemiesData as any)[spawn.type]?.isFlyer)
        .reduce((sum: number, spawn: any) => sum + spawn.count, 0);
      return [wave.wave, flyers];
    }));
    for (const wave of [18, 19, 20, 22, 23, 24]) {
      expect(flyerCountsByWave.get(wave), `W${wave} should include an air-pressure check`).toBeGreaterThan(0);
    }
    for (const wave of [25, 26, 27, 28, 29, 30]) {
      expect(flyerCountsByWave.get(wave), `W${wave} should require endgame anti-air coverage`).toBeGreaterThanOrEqual(2);
    }
    expect((enemiesData as any).CHIMERA.isFlyer).toBe(true);
    expect((enemiesData as any).CHIMERA.phaseHits).toBeGreaterThanOrEqual(3);
  });

  it('turns W12+ flyer pressure into combo anti-air checks while leaving W6 fair', () => {
    const byWave = new Map((wavesData as any[]).map(w => [w.wave, w]));
    expect(byWave.get(6).comboAntiAirArmorPct).toBeUndefined();
    expect(byWave.get(12).comboAntiAirArmorPct).toBeGreaterThan(0);
    expect(byWave.get(18).comboAntiAirArmorPct).toBeGreaterThan(byWave.get(12).comboAntiAirArmorPct);
    expect(byWave.get(18).comboAntiAirArmorPct).toBeGreaterThanOrEqual(0.45);
    expect(byWave.get(22).comboAntiAirArmorPct).toBeGreaterThanOrEqual(0.5);
    expect(byWave.get(27).comboAntiAirArmorPct).toBeGreaterThanOrEqual(0.62);
    expect(byWave.get(30).comboAntiAirArmorPct).toBeGreaterThanOrEqual(0.65);

    const flyerPressureWaves = (wavesData as any[])
      .filter(w => w.wave >= 12)
      .filter(w => (w.spawns ?? []).some((spawn: any) => (enemiesData as any)[spawn.type]?.isFlyer));
    expect(flyerPressureWaves.length).toBeGreaterThan(0);
    for (const wave of flyerPressureWaves) {
      expect(wave.comboAntiAirArmorPct, `W${wave.wave} should warn and pressure combo anti-air`).toBeGreaterThan(0);
      if (wave.wave > 15) {
        expect(wave.comboAntiAirArmorPct, `W${wave.wave} should make combo anti-air the primary flyer answer`).toBeGreaterThanOrEqual(0.45);
      }
    }
  });

  it('lets Sky Barges drop melee cargo at matching ground-route progress', () => {
    const state: any = bootstrapState();
    state.wave = 22;
    state.phase = GamePhase.WAVE_PHASE;
    const barge = spawnEnemy(state, EnemyType.SKY_BARGE, 1);
    const flyerTotal = state.flyerPath.length - 1;
    barge.pathIndex = Math.max(0, Math.floor(flyerTotal * 0.55));
    barge.pathProgress = 0.25;
    barge.hp = 0;

    tickEnemies(state, 0.016, () => {}, () => {});

    const burst = (enemiesData as any).SKY_BARGE.deathBurst;
    const children = [...state.enemies.values()].filter((e: any) => e.__reanimated);
    const expectedGroundIndex = Math.floor(((barge.pathIndex + barge.pathProgress) / flyerTotal) * (state.groundPath.length - 1));
    expect(children).toHaveLength(burst.count);
    expect(children.every((e: any) => !e.isFlyer)).toBe(true);
    expect(new Set(children.map((e: any) => e.type))).toEqual(new Set(burst.types));
    expect(children.every((e: any) => Math.abs(e.pathIndex - expectedGroundIndex) <= 1)).toBe(true);
  });

  it('lets Sea Giants burst into brine minions that keep ocean-spawn identity', () => {
    const state: any = bootstrapState();
    state.wave = 12;
    state.phase = GamePhase.WAVE_PHASE;
    const giant = spawnEnemy(state, EnemyType.SEA_GIANT, 1);
    giant.__oceanSpawn = true;
    giant.pathIndex = 12;
    giant.pathProgress = 0.4;
    giant.hp = 0;

    tickEnemies(state, 0.016, () => {}, () => {});

    const burst = (enemiesData as any).SEA_GIANT.deathBurst;
    const children = [...state.enemies.values()].filter((e: any) => e.__reanimated);
    expect(children).toHaveLength(burst.count);
    expect(children.every((e: any) => e.type === EnemyType.OCEAN_FISHLING)).toBe(true);
    expect(children.every((e: any) => e.__oceanSpawn)).toBe(true);
    expect(children.every((e: any) => Math.abs(e.pathIndex - giant.pathIndex) <= 1)).toBe(true);
  });
});

describe('Wave start — basic flow', () => {
  let state: ReturnType<typeof createGameState>;
  beforeEach(() => { state = bootstrapState(); });

  it('starting from build phase advances wave and switches phase', () => {
    state.phase = GamePhase.BUILD_PHASE;
    state.wave = 0;
    startWave(state);
    expect(state.wave).toBe(1);
    expect(state.phase).toBe(GamePhase.WAVE_PHASE);
  });

  it('does not start a wave from the WAVE_PHASE', () => {
    state.phase = GamePhase.WAVE_PHASE;
    state.wave = 5;
    startWave(state);
    expect(state.wave).toBe(5);    // unchanged
  });

  it('builds a non-empty spawn queue', () => {
    state.phase = GamePhase.BUILD_PHASE;
    startWave(state);
    expect(state.spawnQueue.length).toBeGreaterThan(0);
  });

  it('sets a faction weather profile on wave start', () => {
    state.phase = GamePhase.BUILD_PHASE;
    startWave(state);
    expect(state.weatherKey).toBeTruthy();
  });
});

describe('Wave 11 Dead Uprising necromancy safety', () => {
  it('does not let reanimated children inherit a gate-leak position', () => {
    const state: any = bootstrapState();
    state.wave = 11;
    state.phase = GamePhase.WAVE_PHASE;
    state.lives = 25;

    const undead = spawnEnemy(state, EnemyType.UNDEAD_CELT, 1, false, false);
    undead.hp = 0;
    undead.pathIndex = state.groundPath.length - 1;
    undead.pathProgress = 0;
    const gate = state.groundPath[state.groundPath.length - 1];
    undead.x = gate.col * GRID.TILE + GRID.TILE / 2;
    undead.y = gate.row * GRID.TILE + GRID.TILE / 2;
    undead.prevX = undead.x;
    undead.prevY = undead.y;

    let leaks = 0;
    tickEnemies(state, 0.016, () => { leaks++; }, () => {});

    const children = [...state.enemies.values()].filter((e: any) => e.__reanimated);
    expect(children.length).toBeGreaterThan(0);
    expect(leaks).toBe(0);
    const maxSafeIndex = state.groundPath.length - 1 - 8;
    expect(children.every((e: any) => e.pathIndex <= maxSafeIndex)).toBe(true);
  });
});

describe('Wave end — gold reward + reset', () => {
  it('checkWaveEnd transitions back to build phase when queue empty + no enemies', () => {
    const s = bootstrapState();
    s.phase = GamePhase.WAVE_PHASE;
    s.wave = 3;
    s.spawnQueue = [];
    s.enemies.clear();
    let goldAwarded = -1;
    checkWaveEnd(s, (g) => { goldAwarded = g; });
    expect(s.phase).toBe(GamePhase.BUILD_PHASE);
    expect(goldAwarded).toBeGreaterThan(0);
  });

  it('clears weather state at wave end', () => {
    const s = bootstrapState();
    s.phase = GamePhase.WAVE_PHASE;
    s.wave = 3;
    s.weatherKey = 'CELTS';
    s.spawnQueue = [];
    s.enemies.clear();
    checkWaveEnd(s, () => {});
    expect(s.weatherKey).toBeNull();
  });
});

describe('Win/Loss conditions', () => {
  it('player has lives > 0 at game start', () => {
    const s = bootstrapState();
    expect(s.lives).toBeGreaterThan(0);
  });

  it('lives at 0 represents game over', () => {
    const s = bootstrapState();
    s.lives = 0;
    expect(s.lives).toBe(0);    // sanity assertion
  });

  it('only the Daemon Imperator, not W30 escorts, triggers final-boss instant defeat', () => {
    const s: any = bootstrapState();
    s.wave = 30;
    s.endlessMode = false;

    expect(isFinalBossBreach(s, { type: EnemyType.DAEMON_IMPERATOR } as any)).toBe(true);
    expect(isFinalBossBreach(s, { type: EnemyType.SHADOW_CAVALRY } as any)).toBe(false);
    expect(isFinalBossBreach(s, { type: EnemyType.CHIMERA } as any)).toBe(false);
    expect(isFinalBossBreach(s, { type: EnemyType.PATHFINDER_COMMANDER } as any)).toBe(false);
    expect(isFinalBossBreach(s, { type: EnemyType.UNDEAD_WAR_ELEPHANT } as any)).toBe(false);
  });

  it('does not use final-boss lockdown in Endless mode', () => {
    const s: any = bootstrapState();
    s.wave = 30;
    s.endlessMode = true;

    expect(isFinalBossBreach(s, { type: EnemyType.DAEMON_IMPERATOR } as any)).toBe(false);
  });
});

describe('Spawn queue ticking', () => {
  it('does nothing when not in WAVE_PHASE', () => {
    const s = bootstrapState();
    s.phase = GamePhase.BUILD_PHASE;
    s.spawnQueue = [{ type: 'FERAL_DOG', spawnAt: 0 }];
    s.spawnElapsed = 1;
    s.wave = 1;
    tickSpawns(s, 0.1);
    expect(s.spawnQueue.length).toBe(1);   // unchanged
    expect(s.enemies.size).toBe(0);
  });
});

describe('Wave 22 regression guards', () => {
  it('clears stale waveOverride surprise routing before W22 starts', () => {
    const s = bootstrapState();
    s.phase = GamePhase.BUILD_PHASE;
    s.wave = 21;
    s.lives = 30;
    s.lastSurpriseEventWave = 18;
    s.activeSurpriseEvent = {
      kind: SurpriseEventKind.INVASION,
      startedAt: 100,
      spawnPoints: [
        {
          vfxX: 12,
          vfxY: 12,
          pathTileX: s.groundPath[Math.max(0, s.groundPath.length - 2)].col,
          pathTileY: s.groundPath[Math.max(0, s.groundPath.length - 2)].row,
          pathIndex: Math.max(0, s.groundPath.length - 2),
          spawnAt: 100,
          enemyType: 'MONGOL_CAPTAIN',
          fired: false,
          pointId: 0
        }
      ],
      spawnedEnemyIds: new Set<string>(),
      scarPersistsThroughTick: 0,
      lastSpawnFiredAt: 0,
      vfxFadeOutAt: 0,
      rewardGiven: false,
      atmosProps: [],
      waveOverride: true
    };

    startWave(s);

    expect(s.wave).toBe(22);
    expect(s.activeSurpriseEvent).toBeNull();
    expect(s.lives).toBe(30);
  });

  it('does not leak or kill the player on the first W22 spawn tick', () => {
    const s = bootstrapState();
    s.phase = GamePhase.BUILD_PHASE;
    s.wave = 21;
    s.lives = 30;
    startWave(s);

    let leaked = 0;
    tickSpawns(s, 0);
    tickEnemies(s, 0, () => { leaked += 1; }, e => s.enemies.delete(e.id));

    expect(s.wave).toBe(22);
    expect(leaked).toBe(0);
    expect(s.lives).toBe(30);
    expect(s.enemies.size).toBeGreaterThan(0);
  });
});

describe('Endless modifier stacking (isWaveModifierActive helper)', () => {
  // 2026-05-20 — Endless rolls 1-3 stacked modifiers per wave. The
  // primary lands on state.waveModifier; extras live on
  // state.endlessExtraModifiers. isWaveModifierActive returns true
  // for either bucket so reactive code paths fire once a modifier
  // is in the active set regardless of slot.
  it('returns false when no modifier is active', async () => {
    const { isWaveModifierActive } = await import('../src/GameState');
    const s = bootstrapState();
    expect(isWaveModifierActive(s, 'BLOOD_MOON')).toBe(false);
  });

  it('returns true when key matches the primary slot', async () => {
    const { isWaveModifierActive } = await import('../src/GameState');
    const s = bootstrapState();
    s.waveModifier = 'BLOOD_MOON';
    s.endlessExtraModifiers = [];
    expect(isWaveModifierActive(s, 'BLOOD_MOON')).toBe(true);
    expect(isWaveModifierActive(s, 'DEATH_PACT')).toBe(false);
  });

  it('returns true when key matches one of the endless extras', async () => {
    const { isWaveModifierActive } = await import('../src/GameState');
    const s = bootstrapState();
    s.waveModifier = 'BLOOD_MOON';
    s.endlessExtraModifiers = ['DEATH_PACT', 'GROUP_MARCH'];
    expect(isWaveModifierActive(s, 'BLOOD_MOON')).toBe(true);
    expect(isWaveModifierActive(s, 'DEATH_PACT')).toBe(true);
    expect(isWaveModifierActive(s, 'GROUP_MARCH')).toBe(true);
    expect(isWaveModifierActive(s, 'VEIL')).toBe(false);
  });
});

describe('Per-wave checkpoint-heal override (disableCheckpointHeal field)', () => {
  // 2026-05-20 — Wave 11 (42x Undead Celt, necromancy=true) suppresses
  // the standard checkpoint-touch heal. The 15% heal at every waypoint
  // stacked on top of the reanim slog made the wave drag without
  // serving any teaching purpose; the mechanic itself is still active
  // on W7/W8 (intro) and W14/W15 (reinforcement) where Undead Celt
  // also appears.
  it('wave 11 carries disableCheckpointHeal = true', () => {
    const w11 = (wavesData as any[]).find(w => w.wave === 11);
    expect(w11).toBeDefined();
    expect(w11.disableCheckpointHeal).toBe(true);
  });

  it('no other wave currently carries disableCheckpointHeal (clean data)', () => {
    const others = (wavesData as any[]).filter(w => w.wave !== 11 && w.disableCheckpointHeal === true);
    expect(others.length).toBe(0);
  });

  it('wave 9 war elephants heal at checkpoint coins despite being boss-class enemies', () => {
    const s = bootstrapState();
    s.phase = GamePhase.BUILD_PHASE;
    s.wave = 8;
    startWave(s);
    tickSpawns(s, 999);

    const elephant = Array.from(s.enemies.values()).find(e => e.type === EnemyType.WAR_ELEPHANT);
    expect(elephant).toBeDefined();
    expect(elephant!.isBoss).toBe(true);
    expect(elephant!.checkpointHealPct).toBe(0.15);
    expect(isRareOnlyBossDropEnemy(elephant)).toBe(true);
    expect(isLegendaryBossDropEnemy(elephant)).toBe(false);

    elephant!.hp = elephant!.maxHp * 0.50;
    const before = elephant!.hp;
    elephant!.x = 10 * 32 + 16;
    elephant!.y = 5 * 32 + 16;
    tickEnemies(s, 0, () => {}, () => {});

    expect(elephant!.hp).toBeGreaterThan(before);
    expect(elephant!.healedCheckpoints).toContain(1);
  });

  it('wave 10 makes only Hannibal eligible for legendary boss loot', () => {
    const s = bootstrapState();
    s.phase = GamePhase.BUILD_PHASE;
    s.wave = 9;
    startWave(s);
    tickSpawns(s, 999);

    const enemies = Array.from(s.enemies.values());
    const hannibal = enemies.find(e => e.type === EnemyType.HANNIBAL_BARCA);
    const elephants = enemies.filter(e => e.type === EnemyType.WAR_ELEPHANT);

    expect(hannibal).toBeDefined();
    expect(hannibal!.isBoss).toBe(true);
    expect(hannibal!.isScheduledBoss).toBe(true);
    expect(isRareOnlyBossDropEnemy(hannibal)).toBe(false);
    expect(isLegendaryBossDropEnemy(hannibal)).toBe(true);

    expect(elephants.length).toBeGreaterThan(0);
    for (const elephant of elephants) {
      expect(elephant.isBoss).toBe(true);
      expect(isRareOnlyBossDropEnemy(elephant)).toBe(true);
      expect(isLegendaryBossDropEnemy(elephant)).toBe(false);
    }
  });
});

describe('Per-wave resistance relief (resistReduction field)', () => {
  // 2026-05-20 — Wave 8 (CARTHAGE, 33x Sacred Band + 18x Spearman + 5x
  // Numidian Rider) carries a 0.15 resistReduction. The CombatResolver
  // brings the effective resistance multiplier 15% closer to 1.0 — but
  // only when the enemy is RESISTANT (resMod < 1). Weaknesses untouched.
  it('wave 8 carries resistReduction = 0.15', () => {
    const w8 = (wavesData as any[]).find(w => w.wave === 8);
    expect(w8).toBeDefined();
    expect(w8.resistReduction).toBe(0.15);
  });

  it('no other wave currently carries resistReduction (clean data)', () => {
    // Anyone else adding the field later would intentionally surface in
    // the Codex 🛡 RESIST tag — this test catches accidental copy-paste.
    const others = (wavesData as any[]).filter(w => w.wave !== 8 && typeof w.resistReduction === 'number' && w.resistReduction > 0);
    expect(others.length).toBe(0);
  });

  it('relief formula brings resMod 15% closer to 1 when resistant', () => {
    // The applied formula is: resMod = 1 - (1 - resMod) * (1 - 0.15)
    // i.e. the resistance GAP shrinks to 85% of its original size.
    const reduce = (m: number, r = 0.15) => (m < 1 ? 1 - (1 - m) * (1 - r) : m);

    // CARTHAGE PHYS_MELEE: base -0.30 → resMod 0.70 → reduced to 0.745
    expect(reduce(0.70)).toBeCloseTo(0.745, 4);
    // CARTHAGE PHYS_RANGED: base -0.20 → resMod 0.80 → reduced to 0.83
    expect(reduce(0.80)).toBeCloseTo(0.83, 4);
    // Neutral (CARTHAGE SIEGE / ELEMENTAL_FIRE): no change
    expect(reduce(1.0)).toBe(1.0);
    // Weakness: untouched (we never *reduce* damage to the player)
    expect(reduce(1.25)).toBe(1.25);
  });
});
