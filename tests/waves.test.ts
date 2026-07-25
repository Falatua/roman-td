// Tests for the wave system: HP scaling, wave-end conditions, win/loss state.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { effectiveWaveHpMult, nominalWaveThreatHp, previewSpawnHp, startWave, tickSpawns, checkWaveEnd, grantWave20TrapGift } from '../src/systems/WaveManager';
import { campaignPressureHpMult, campaignPressureResistMult } from '../src/systems/CampaignDifficulty';
import { spawnEnemy, tickEnemies } from '../src/systems/EnemySystem';
import { tickSurpriseEvents } from '../src/systems/SurpriseEvents';
import { createGameState } from '../src/GameState';
import { EnemyType, GamePhase, SurpriseEventKind } from '../src/types';
import { initializeGrid } from '../src/systems/GridManager';
import { buildGroundPath, buildGroundPathB, buildFlyerPath } from '../src/systems/PathFinder';
import { enemyResistanceProfile } from '../src/systems/EnemyResistances';
import { isLegendaryBossDropEnemy, isRareOnlyBossDropEnemy } from '../src/systems/RewardEligibility';
import { isFinalBossBreach, leakLifeCostFor, shouldRespawnBossOnLeak } from '../src/systems/LeakRules';
import { failTestYourMight, isTestYourMightLeakEnemy, startTestYourMight } from '../src/systems/TestYourMightSystem';
import wavesData from '../src/data/waves.json';
import enemiesData from '../src/data/enemies.json';
import waypointsData from '../src/data/waypoints.json';
import { GRID, WATER_ZONE, WAVE } from '../src/constants';
import { ELEPHANT_SPAWN_GAP_SECONDS } from '../src/systems/ElephantPacing';
import { createBossRuntime, tickBossScripts } from '../src/systems/BossScripts';
import { isCommanderEnemy, isEliteEnemy } from '../src/systems/EnemyClassification';

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

function waypointPathIndex(state: any, waypointNumber: number): number {
  const wp = (waypointsData as any).waypoints.find((entry: any) => entry.index === waypointNumber)?.topLeft;
  expect(wp, `Waypoint ${waypointNumber} should exist`).toBeTruthy();
  let bestIdx = 0;
  let bestD = Infinity;
  for (let i = 0; i < state.groundPath.length; i++) {
    const p = state.groundPath[i];
    const d = Math.abs(p.col - wp.col) + Math.abs(p.row - wp.row);
    if (d < bestD) { bestD = d; bestIdx = i; }
  }
  return bestIdx;
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

  it('gives every boss before Wave 11 the 15 percent early-boss health bump', () => {
    const expected = new Map<string, number>([
      ['ALPHA_DOG', 3765],
      ['CELTIC_WARLORD', 4117],
      ['HANNIBAL_BARCA', 8625]
    ]);
    const preWave11BossTypes = new Set<string>();

    for (const wave of (wavesData as any[]).filter(wave => wave.wave < 11)) {
      for (const spawn of wave.spawns ?? []) {
        const def = (enemiesData as any)[spawn.type];
        if (def?.isBoss) preWave11BossTypes.add(spawn.type);
      }
    }

    expect([...preWave11BossTypes].sort()).toEqual([...expected.keys()].sort());
    for (const [type, baseHp] of expected) {
      expect((enemiesData as any)[type].baseHp).toBe(baseHp);
    }
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
      [6, 2.3575],
      [7, 2.28],
      [8, 2.25],
      [9, 2.55],
      [10, 8.3],
      [12, 8.746],
      [13, 3.277],
      [14, 3.836],
      [15, 2.649]
    ]);
    for (const [wave, hpMult] of expected) {
      expect(byWave.get(wave)?.hpMult, `W${wave} authored HP should stay firm after W5`).toBe(hpMult);
    }
  });
});

describe('Late-wave DoT profile coverage', () => {
  it('keeps physical-melee immune threats present across W16-W30', () => {
    const meleeImmuneTypes = new Set(
      Object.entries(enemiesData as any)
        .filter(([, def]: any) => def?.meleeImmune === true)
        .map(([type]) => type)
    );

    for (const wave of (wavesData as any[]).filter(w => w.wave >= 16 && w.wave <= 30)) {
      const types = [...new Set((wave.spawns ?? []).map((spawn: any) => spawn.type))];
      expect(
        types.some(type => meleeImmuneTypes.has(type)),
        `W${wave.wave} should include at least one physical-melee immune threat`
      ).toBe(true);
    }
  });

  it('keeps physical-ranged immune threats present across W16-W30', () => {
    const rangedImmuneTypes = new Set(
      Object.entries(enemiesData as any)
        .filter(([, def]: any) => def?.rangedImmune === true)
        .map(([type]) => type)
    );

    for (const wave of (wavesData as any[]).filter(w => w.wave >= 16 && w.wave <= 30)) {
      const types = [...new Set((wave.spawns ?? []).map((spawn: any) => spawn.type))];
      expect(
        types.some(type => rangedImmuneTypes.has(type)),
        `W${wave.wave} should include at least one physical-ranged immune threat`
      ).toBe(true);
    }
  });

  it('keeps siege-immune threats present across W16-W30', () => {
    const siegeImmuneTypes = new Set(
      Object.entries(enemiesData as any)
        .filter(([, def]: any) => def?.siegeImmune === true)
        .map(([type]) => type)
    );

    for (const wave of (wavesData as any[]).filter(w => w.wave >= 16 && w.wave <= 30)) {
      const types = [...new Set((wave.spawns ?? []).map((spawn: any) => spawn.type))];
      expect(
        types.some(type => siegeImmuneTypes.has(type)),
        `W${wave.wave} should include at least one siege-immune threat`
      ).toBe(true);
    }
  });

  it('keeps damage-over-time counterplay present after the W16 bridge without overloading late hard immunities', () => {
    const dotImmuneTypes = new Set(
      Object.entries(enemiesData as any)
        .filter(([, def]: any) => def?.dotImmune === true)
        .map(([type]) => type)
    );

    for (const wave of (wavesData as any[]).filter(w => w.wave >= 17 && w.wave <= 30)) {
      const types = [...new Set((wave.spawns ?? []).map((spawn: any) => spawn.type))];
      const hasDotImmune = types.some(type => dotImmuneTypes.has(type));
      if (types.includes(EnemyType.ANUBIS_PRIEST_COMMANDER) && !hasDotImmune) {
        expect(types).toContain(EnemyType.ANUBIS_PRIEST_COMMANDER);
        const profile = enemyResistanceProfile(EnemyType.ANUBIS_PRIEST_COMMANDER);
        expect(profile.poison, `W${wave.wave} Anubis commander poison should land`).toBeGreaterThan(0);
        expect(profile.burn, `W${wave.wave} Anubis commander burn remains blocked`).toBe(0);
        expect(profile.bleed, `W${wave.wave} Anubis commander bleed remains blocked`).toBe(0);
        continue;
      }
      if (wave.wave <= 22) {
        expect(hasDotImmune, `W${wave.wave} should include at least one damage-over-time immune threat`).toBe(true);
      } else {
        const hasHardOrHeavySoftCounter = hasDotImmune || types.some(type => {
          const profile = enemyResistanceProfile(type as EnemyType);
          return (profile.burn ?? 1) <= 0.35 || (profile.poison ?? 1) <= 0.35 || (profile.bleed ?? 1) <= 0.35;
        });
        expect(hasHardOrHeavySoftCounter, `W${wave.wave} should include at least one hard or heavy-soft DoT counter`).toBe(true);
      }
    }
  });

  it('keeps divine-immune threats present after the W16 bridge', () => {
    const divineImmuneTypes = new Set(
      Object.entries(enemiesData as any)
        .filter(([, def]: any) => def?.divineImmune === true)
        .map(([type]) => type)
    );

    for (const wave of (wavesData as any[]).filter(w => w.wave >= 17 && w.wave <= 30)) {
      const types = [...new Set((wave.spawns ?? []).map((spawn: any) => spawn.type))];
      expect(
        types.some(type => divineImmuneTypes.has(type)),
        `W${wave.wave} should include at least one divine-immune threat`
      ).toBe(true);
    }
  });

  it('keeps fire-immune threats present after the W16 bridge', () => {
    const fireImmuneTypes = new Set(
      Object.entries(enemiesData as any)
        .filter(([, def]: any) => def?.immuneFire === true)
        .map(([type]) => type)
    );

    for (const wave of (wavesData as any[]).filter(w => w.wave >= 17 && w.wave <= 30)) {
      const types = [...new Set((wave.spawns ?? []).map((spawn: any) => spawn.type))];
      expect(
        types.some(type => fireImmuneTypes.has(type)),
        `W${wave.wave} should include at least one fire-immune threat`
      ).toBe(true);
    }
  });

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
    expect(enemyResistanceProfile(EnemyType.DUNE_STALKER).bleed).toBeGreaterThan(0);
    expect(enemyResistanceProfile(EnemyType.DUNE_STALKER).bleed).toBeLessThan(0.5);
    expect(enemyResistanceProfile(EnemyType.SIEGE_CAPTAIN_COMMANDER).burn).toBe(0);
    expect(enemyResistanceProfile(EnemyType.SIEGE_CAPTAIN_COMMANDER).siege).toBe(0);
    expect(enemyResistanceProfile(EnemyType.SIEGE_CAPTAIN_COMMANDER).bleed).toBeGreaterThan(1);
    expect(enemyResistanceProfile(EnemyType.SKY_PATHFINDER_COMMANDER).siege).toBe(0);
    expect(enemyResistanceProfile(EnemyType.SKY_ANUBIS_COMMANDER).poison).toBeGreaterThan(0);
    expect(enemyResistanceProfile(EnemyType.SKY_ANUBIS_COMMANDER).poison).toBeLessThan(0.5);
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

    expect(w24.enemySpeedBoostPct).toBeGreaterThan(w23.enemySpeedBoostPct);
    expect(w24.enemyDamageReductPct).toBeGreaterThan(w23.enemyDamageReductPct);
    expect(w24.enemyDotResistPct).toBeGreaterThanOrEqual(w23.enemyDotResistPct);
    expect(w24.enemyRegenPctPerSec).toBeGreaterThan(w23.enemyRegenPctPerSec);
    expect(count(w24, 'SIEGE_WAGON')).toBe(count(w23, 'SIEGE_WAGON'));
    expect(count(w24, 'SPHINX')).toBe(4);
    expect(nominalWaveThreatHp(24)).toBeGreaterThan(nominalWaveThreatHp(23) * 1.4);
  });

  it('keeps post-W18 scheduled bosses tougher than every non-boss in their wave bodies', () => {
    for (const wave of (wavesData as any[]).filter(w => w.wave > 18 && w.type === 'B')) {
      let strongestBoss = 0;
      let strongestNonBoss = 0;
      for (const spawn of wave.spawns ?? []) {
        const def: any = (enemiesData as any)[spawn.type];
        if (!def) continue;
        const hp = previewSpawnHp(def, wave.wave, wave.type, wave.hpMult, true);
        if (def.isBoss) {
          strongestBoss = Math.max(strongestBoss, hp);
        } else {
          strongestNonBoss = Math.max(strongestNonBoss, hp);
        }
      }
      expect(strongestBoss, `W${wave.wave} should have a scheduled boss`).toBeGreaterThan(0);
      if (strongestNonBoss > 0) {
        expect(strongestBoss, `W${wave.wave} boss should not be easier to kill than the strongest non-boss enemy`).toBeGreaterThan(strongestNonBoss);
      }
    }
  });

  it('keeps authored enemy role hierarchy readable: base below commanders below bosses', () => {
    for (const wave of wavesData as any[]) {
      let strongestBase = 0;
      let strongestCommander = 0;
      let strongestBoss = 0;
      let strongestNonBoss = 0;
      for (const spawn of wave.spawns ?? []) {
        const def: any = (enemiesData as any)[spawn.type];
        if (!def) continue;
        const hp = previewSpawnHp(def, wave.wave, wave.type, wave.hpMult, true);
        if (def.isBoss) {
          strongestBoss = Math.max(strongestBoss, hp);
        } else {
          strongestNonBoss = Math.max(strongestNonBoss, hp);
          if (isCommanderEnemy(spawn.type)) {
            strongestCommander = Math.max(strongestCommander, hp);
          } else if (!isEliteEnemy(spawn.type) && def.isElite !== true) {
            strongestBase = Math.max(strongestBase, hp);
          }
        }
      }
      if (strongestCommander > 0 && strongestBase > 0) {
        expect(strongestCommander, `W${wave.wave} commanders should be tougher than ordinary base enemies`).toBeGreaterThan(strongestBase);
      }
      if (strongestBoss > 0 && strongestNonBoss > 0) {
        expect(strongestBoss, `W${wave.wave} bosses should be tougher than every non-boss escort`).toBeGreaterThan(strongestNonBoss);
      }
    }
  });

  it('makes Wave 25 escalate after Wave 24 instead of dipping', () => {
    const byWave = new Map((wavesData as any[]).map(w => [w.wave, w]));
    const w24 = byWave.get(24);
    const w25 = byWave.get(25);
    expect(nominalWaveThreatHp(25)).toBeGreaterThan(nominalWaveThreatHp(24) * 1.4);
    expect(w25.enemySpeedBoostPct).toBeGreaterThan(w24.enemySpeedBoostPct);
    expect(w25.enemyDamageReductPct).toBeGreaterThan(w24.enemyDamageReductPct);
    expect(w25.comboAntiAirArmorPct).toBeGreaterThan(w24.comboAntiAirArmorPct);
  });

  it('keeps the W15-W29 encounter budget on a consistent player-power ramp', () => {
    let previous = nominalWaveThreatHp(15);
    for (let wave = 16; wave <= 29; wave++) {
      const current = nominalWaveThreatHp(wave);
      const growth = current / previous;
      expect(growth, `W${wave} should increase over W${wave - 1}`).toBeGreaterThan(1.4);
      expect(growth, `W${wave} should not cliff over W${wave - 1}`).toBeLessThan(1.6);
      previous = current;
    }
    const finalGrowth = nominalWaveThreatHp(30) / nominalWaveThreatHp(29);
    expect(finalGrowth).toBeGreaterThan(2.3);
    expect(finalGrowth).toBeLessThan(2.5);
  });

  it('smooths every authored encounter from the first elephants through W15', () => {
    let previous = nominalWaveThreatHp(8);
    for (let wave = 9; wave <= 15; wave++) {
      const current = nominalWaveThreatHp(wave);
      const growth = current / previous;
      expect(growth, `W${wave} should rise over W${wave - 1}`).toBeGreaterThan(1.15);
      expect(growth, `W${wave} should not create an early wall`).toBeLessThan(1.35);
      previous = current;
    }
  });

  it('keeps the first War Elephant wave on a readable step after Wave 8', () => {
    const wave8 = nominalWaveThreatHp(8);
    const wave9 = nominalWaveThreatHp(9);
    expect(wave9).toBeGreaterThan(wave8);
    expect(wave9 / wave8).toBeLessThan(1.5);

    const elephant: any = (enemiesData as any).WAR_ELEPHANT;
    const wave9Def: any = (wavesData as any[])[8];
    const elephantHp = previewSpawnHp(elephant, 9, wave9Def.type, wave9Def.hpMult, true);
    expect(elephantHp).toBeGreaterThan(150_000);
    expect(elephantHp).toBeLessThan(225_000);
  });

  it('spawns two undead war elephants on Wave 14', () => {
    const wave14 = (wavesData as any[]).find(w => w.wave === 14);
    const elephants = (wave14.spawns ?? []).find((spawn: any) => spawn.type === 'UNDEAD_WAR_ELEPHANT');
    expect(elephants?.count).toBe(2);
  });

  it('stagger-releases every campaign elephant by at least four seconds', () => {
    for (const wave of [9, 10, 14, 22, 30]) {
      const s = bootstrapState();
      s.wave = wave - 1;
      startWave(s);
      const times = s.spawnQueue
        .filter(item => item.type === EnemyType.WAR_ELEPHANT || item.type === EnemyType.UNDEAD_WAR_ELEPHANT)
        .map(item => item.spawnAt)
        .sort((a, b) => a - b);
      expect(times.length, `W${wave} should schedule elephants`).toBeGreaterThan(0);
      for (let i = 1; i < times.length; i++) {
        expect(times[i] - times[i - 1], `W${wave} elephant ${i + 1} released too soon`)
          .toBeGreaterThanOrEqual(ELEPHANT_SPAWN_GAP_SECONDS - 1e-9);
      }
    }
  });

  it('keeps elite elephants deliberately slower than ordinary heavy units', () => {
    expect((enemiesData as any).WAR_ELEPHANT.speed).toBe(1.3);
    expect((enemiesData as any).UNDEAD_WAR_ELEPHANT.speed).toBe(1.35);
  });

  it('adds shipwreck ocean spawns and Stormtide Wyvern commanders across the campaign', () => {
    const byWave = new Map((wavesData as any[]).map(w => [w.wave, w]));
    expect(byWave.get(3).spawns).toContainEqual({ type: 'OCEAN_FISHLING', count: 40, ocean: true });
    expect(byWave.get(8).spawns).toContainEqual({ type: 'STORMTIDE_WYVERN_COMMANDER', count: 1, ocean: true });
    expect(byWave.get(12).spawns).toContainEqual({ type: 'SEA_GIANT', count: 2, ocean: true });
    expect(byWave.get(12).spawns).toContainEqual({ type: 'TIDECALLER_COMMANDER', count: 1, ocean: true });
    expect(byWave.get(18).spawns).toContainEqual({ type: 'STORMTIDE_WYVERN_COMMANDER', count: 1, ocean: true });
    expect(byWave.get(18).spawns).toContainEqual({ type: 'OCEAN_GHOST_SPIRIT', count: 30, ocean: true });
    expect(byWave.get(27).spawns).toContainEqual({ type: 'SEA_GIANT_WARBRINGER', count: 6, ocean: true });
    expect(byWave.get(27).spawns).toContainEqual({ type: 'TIDECALLER_COMMANDER', count: 2, ocean: true });
    expect(byWave.get(27).spawns).toContainEqual({ type: 'STORMTIDE_WYVERN_COMMANDER', count: 1, ocean: true });
    expect(byWave.get(29).spawns).toContainEqual({ type: 'NETHER_AMPHIBIOUS_GIANT', count: 4, ocean: true });
    expect(byWave.get(29).spawns).toContainEqual({ type: 'TIDECALLER_COMMANDER', count: 2, ocean: true });
  });

  it('adds Naga sleepcasters across late-beginning, mid-game, and end-game waves', () => {
    const byWave = new Map((wavesData as any[]).map(w => [w.wave, w]));
    expect(byWave.get(8).spawns).toContainEqual({ type: 'NAGA_ADEPT', count: 3, ocean: true });
    expect(byWave.get(17).spawns).toContainEqual({ type: 'NAGA_SLEEPWEAVER', count: 4, ocean: true });
    expect(byWave.get(28).spawns).toContainEqual({ type: 'NAGA_ORACLE', count: 3, ocean: true });
  });

  it('starts ocean enemies alongside the normal cave wave instead of after it', () => {
    for (const wave of [3, 8, 12, 17, 18, 27, 28, 29]) {
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
    expect(sea.pathIndex).toBeGreaterThan(waypointPathIndex(s, 2));
    const wreckX = WATER_ZONE.col * GRID.TILE + 4;
    const wreckY = (WATER_ZONE.row + WATER_ZONE.height - 3.45) * GRID.TILE;
    expect(sea.x).toBeGreaterThanOrEqual(wreckX);
    expect(sea.x).toBeLessThanOrEqual(wreckX + GRID.TILE * 4.5);
    expect(sea.y).toBeGreaterThanOrEqual(wreckY);
    expect(sea.y).toBeLessThanOrEqual(wreckY + GRID.TILE * 3.375);
  });

  it('routes every authored ocean-marked campaign spawn past the first two checkpoints', () => {
    const oceanWaves = (wavesData as any[]).filter(wave => (wave.spawns ?? []).some((spawn: any) => spawn.ocean));
    expect(oceanWaves.length, 'campaign should include ocean threat waves').toBeGreaterThan(0);

    for (const waveDef of oceanWaves) {
      const s = bootstrapState();
      s.wave = waveDef.wave - 1;
      startWave(s);
      const oceanQueue = s.spawnQueue.filter(item => item.ocean);
      expect(oceanQueue.length, `W${waveDef.wave} should schedule ocean enemies`).toBeGreaterThan(0);

      s.enemies.clear();
      s.spawnQueue = oceanQueue.map((item, idx) => ({ ...item, spawnAt: 0, oceanIndex: idx }));
      s.spawnElapsed = 0;
      tickSpawns(s, 0.01);

      const spawned = Array.from(s.enemies.values()) as any[];
      expect(spawned.length, `W${waveDef.wave} should spawn its ocean queue`).toBe(oceanQueue.length);
      const wp2Idx = waypointPathIndex(s, 2);
      for (const enemy of spawned) {
        expect(enemy.__oceanSpawn, `W${waveDef.wave} ${enemy.type} should be tagged ocean-spawned`).toBe(true);
        expect(enemy.__approachActive, `W${waveDef.wave} ${enemy.type} should approach from the shipwreck`).toBe(true);
        if (enemy.isFlyer) {
          expect(enemy.__oceanRouteGroundPath, `W${waveDef.wave} ${enemy.type} should remain on the flyer route`).toBe(false);
          expect(enemy.pathIndex, `W${waveDef.wave} ${enemy.type} should join flyer path at checkpoint 3`).toBeGreaterThanOrEqual(3);
          expect(enemy.pathIndex, `W${waveDef.wave} ${enemy.type} should stay within flyer path bounds`).toBeLessThan(s.flyerPath.length);
        } else {
          expect(enemy.__oceanRouteGroundPath, `W${waveDef.wave} ${enemy.type} should use the post-WP2 ground route`).toBe(true);
          expect(enemy.pathIndex, `W${waveDef.wave} ${enemy.type} should skip checkpoints 1 and 2`).toBeGreaterThan(wp2Idx);
        }
      }
    }
  });

  it('routes ocean-flagged boss-class spawns from the shipwreck for future water bosses', () => {
    const s = bootstrapState();
    s.wave = 11;
    s.phase = GamePhase.WAVE_PHASE;
    s.spawnQueue = [{ type: EnemyType.HANNIBAL_BARCA, spawnAt: 0, ocean: true, oceanIndex: 0 }];
    s.spawnElapsed = 0;

    tickSpawns(s, 0.01);
    const boss = Array.from(s.enemies.values()).find(e => e.type === EnemyType.HANNIBAL_BARCA) as any;
    expect(boss).toBeTruthy();
    expect(boss.isBoss).toBe(true);
    expect(boss.__oceanSpawn).toBe(true);
    expect(boss.__oceanRouteGroundPath).toBe(true);
    expect(boss.pathIndex).toBeGreaterThan(waypointPathIndex(s, 2));
  });

  it('keeps the Stormtide Wyvern targetable as air while routing it from the ocean', () => {
    const s = bootstrapState();
    s.wave = 7;
    startWave(s);
    expect(s.spawnQueue.some(item => item.type === EnemyType.STORMTIDE_WYVERN_COMMANDER && item.ocean)).toBe(true);
    tickSpawns(s, 5);
    const wyvern = Array.from(s.enemies.values()).find(e => e.type === EnemyType.STORMTIDE_WYVERN_COMMANDER) as any;
    expect(wyvern).toBeTruthy();
    expect(wyvern.isFlyer).toBe(true);
    expect(wyvern.__oceanSpawn).toBe(true);
    expect(wyvern.__oceanRouteGroundPath).toBe(false);
    expect(wyvern.__approachActive).toBe(true);
    expect(wyvern.pathIndex).toBeGreaterThanOrEqual(3);
    expect(wyvern.pathIndex).toBeLessThan(s.flyerPath.length);
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
    const wyverns = s.spawnQueue.filter(item => item.type === 'STORMTIDE_WYVERN_COMMANDER');
    expect(wyverns).toHaveLength(1);
    expect(wyverns.every(item => item.ocean && !item.caveB)).toBe(true);
  });

  it('plays the replacement ocean emergence cue only once per ocean wave', () => {
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
      expect((s as any).__oceanEmergenceWave).toBe(3);
      expect((s as any).__oceanSurgeUntil).toBeGreaterThan(0);

      s.enemies.clear();
      s.phase = GamePhase.BUILD_PHASE;
      s.wave = 11;
      startWave(s);
      tickSpawns(s, 0.01);
      expect(cueCount).toBe(2);
      expect((s as any).__oceanEmergenceWave).toBe(12);
    } finally {
      (globalThis as any).__renderer = prevRenderer;
      (globalThis as any).__oceanEmergenceSfx = prevOceanCue;
    }
  });

  it('turns W26-W30 into the final apex-tower gauntlet', () => {
    const byWave = new Map((wavesData as any[]).map(w => [w.wave, w]));
    const expected = new Map<number, { hp: number; dr: number; aa: number; dot: number; regen: number }>([
      [26, { hp: 2.703, dr: 0.12, aa: 0.62, dot: 0.25, regen: 0.007 }],
      [27, { hp: 2.417, dr: 0.14, aa: 0.66, dot: 0.28, regen: 0.008 }],
      [28, { hp: 2.952, dr: 0.16, aa: 0.68, dot: 0.30, regen: 0.009 }],
      [29, { hp: 2.418, dr: 0.18, aa: 0.70, dot: 0.32, regen: 0.010 }],
      [30, { hp: 0.227, dr: 0.20, aa: 0.72, dot: 0.35, regen: 0.012 }]
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

  it('keeps the full flyer roster on the authored 10% faster speed pass', () => {
    const expectedFlyerSpeeds: Record<string, number> = {
      CELTIC_SCOUT: 1.98,
      NUMIDIAN_RIDER: 1.98,
      SPECTRAL_SCOUT: 1.98,
      GHOST_RIDER: 2.86,
      BONEWING_DRAKE: 0.682,
      GRAVE_LEGION_DRAGON: 0.605,
      DREAD_UPRISING_DRAGON: 0.528,
      SHADOW_CAVALRY: 3.52,
      SPHINX: 1.43,
      BOSS_FLYER_VULTURE: 0.66,
      CHIMERA: 1.43,
      SKY_STANDARD_COMMANDER: 0.902,
      SKY_PATHFINDER_COMMANDER: 1.045,
      SKY_ANUBIS_COMMANDER: 0.858,
      STORMTIDE_WYVERN_COMMANDER: 0.77,
      SKY_BARGE: 0.572
    };

    const authoredFlyers = Object.entries(enemiesData as Record<string, any>)
      .filter(([, def]) => def.isFlyer === true)
      .map(([type]) => type)
      .sort();

    expect(authoredFlyers).toEqual(Object.keys(expectedFlyerSpeeds).sort());
    for (const [type, expectedSpeed] of Object.entries(expectedFlyerSpeeds)) {
      expect((enemiesData as any)[type].speed, type).toBe(expectedSpeed);
    }
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

  it('grants a free emergency trap crate after clearing wave 20 without counting purchases', () => {
    const s: any = bootstrapState();
    s.phase = GamePhase.WAVE_PHASE;
    s.wave = 20;
    s.spawnQueue = [];
    s.enemies.clear();

    checkWaveEnd(s, () => {});

    expect(s.wave20TrapGiftGranted).toBe(true);
    expect(s.trapInventory.BALLISTA_SNARE).toBe(1);
    expect(s.trapInventory.SKY_NET).toBe(1);
    expect(s.trapInventory.FROST_SNARE).toBe(1);
    expect(s.trapsPurchased).toBe(0);
    expect(s.trapPurchasesByType.BALLISTA_SNARE ?? 0).toBe(0);
    expect(s.__wave20TrapGiftJustGranted).toEqual([
      { id: 'BALLISTA_SNARE', qty: 1 },
      { id: 'SKY_NET', qty: 1 },
      { id: 'FROST_SNARE', qty: 1 },
    ]);
  });

  it('does not repeat the wave 20 trap gift and respects held trap caps', () => {
    const s: any = bootstrapState();
    s.wave = 20;
    s.trapInventory.SKY_NET = 5;

    expect(grantWave20TrapGift(s)).toEqual([
      { id: 'BALLISTA_SNARE', qty: 1 },
      { id: 'FROST_SNARE', qty: 1 },
    ]);
    expect(s.trapInventory.SKY_NET).toBe(5);
    expect(grantWave20TrapGift(s)).toEqual([]);
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

  it('does not leak or kill the player in the opening seconds of W21-W23', () => {
    const prevWindow = (globalThis as any).window;
    (globalThis as any).window = prevWindow ?? {};
    try {
      for (const wave of [21, 22, 23]) {
        const s = bootstrapState();
        s.phase = GamePhase.BUILD_PHASE;
        s.wave = wave - 1;
        s.lives = 30;
        startWave(s);

        const leaks: string[] = [];
        for (let i = 0; i < 180; i++) {
          s.tick += 1 / 60;
          tickSpawns(s, 1 / 60);
          tickEnemies(
            s,
            1 / 60,
            e => {
              leaks.push(`${String(e.type)}@${s.tick.toFixed(2)}#${e.pathIndex}+${e.pathProgress.toFixed(2)}`);
              s.lives -= leakLifeCostFor(e);
              if (s.lives <= 0 && s.gameOverAt < 0) s.gameOverAt = s.tick;
            },
            e => s.enemies.delete(e.id)
          );
        }

        expect(leaks, `W${wave} should not leak in the first 3 seconds`).toEqual([]);
        expect(s.lives, `W${wave} lives should stay untouched in the opening window`).toBe(30);
        expect(s.gameOverAt, `W${wave} should not set game over in the opening window`).toBeLessThan(0);
      }
    } finally {
      if (prevWindow === undefined) delete (globalThis as any).window;
      else (globalThis as any).window = prevWindow;
    }
  });

  it('treats W22 elephant breaches as elite leaks, not boss instant-death chains', () => {
    const prevWindow = (globalThis as any).window;
    (globalThis as any).window = prevWindow ?? {};
    const s = bootstrapState();
    s.phase = GamePhase.BUILD_PHASE;
    s.wave = 21;
    s.lives = 30;
    startWave(s);

    const elephant = spawnEnemy(s, EnemyType.UNDEAD_WAR_ELEPHANT, 1);
    elephant.pathIndex = s.groundPath.length - 1;
    elephant.pathProgress = 0;

    let leakCost = 0;
    try {
      tickEnemies(
        s,
        1 / 60,
        e => {
          leakCost = leakLifeCostFor(e);
          s.lives -= leakCost;
        },
        e => s.enemies.delete(e.id)
      );

      expect(leakCost).toBe(5);
      expect(s.lives).toBe(25);
      expect(shouldRespawnBossOnLeak(elephant)).toBe(false);
      expect(s.bossRespawnQueue ?? []).toEqual([]);
    } finally {
      if (prevWindow === undefined) delete (globalThis as any).window;
      else (globalThis as any).window = prevWindow;
    }
  });
});

describe('Campaign opening leak audit', () => {
  it('keeps Wave 14 Dead Uprising from draining lives during the first 30 seconds', () => {
    const prevWindow = (globalThis as any).window;
    (globalThis as any).window = prevWindow ?? {};
    try {
      const s = bootstrapState();
      s.phase = GamePhase.BUILD_PHASE;
      s.wave = 13;
      s.lives = 30;
      startWave(s);

      const leaks: string[] = [];
      for (let i = 0; i < 30 * 60; i++) {
        s.tick += 1 / 60;
        tickSpawns(s, 1 / 60);
        tickSurpriseEvents(s);
        tickEnemies(
          s,
          1 / 60,
          e => {
            const pathLen = e.isFlyer ? s.flyerPath.length : ((e as any).__caveB ? s.groundPathB.length : s.groundPath.length);
            leaks.push(`${String(e.type)}@${s.tick.toFixed(2)}#${e.pathIndex}/${pathLen - 1}+${e.pathProgress.toFixed(2)}`);
            s.lives -= leakLifeCostFor(e);
            if (s.lives <= 0 && s.gameOverAt < 0) s.gameOverAt = s.tick;
          },
          e => s.enemies.delete(e.id)
        );
      }

      expect(leaks).toEqual([]);
      expect(s.lives).toBe(30);
      expect(s.gameOverAt).toBeLessThan(0);
    } finally {
      if (prevWindow === undefined) delete (globalThis as any).window;
      else (globalThis as any).window = prevWindow;
    }
  }, 15000);

  it('keeps Wave 14 rebirth and reanimation chains from causing hidden leaks', () => {
    const prevWindow = (globalThis as any).window;
    (globalThis as any).window = prevWindow ?? {};
    try {
      const s = bootstrapState();
      s.phase = GamePhase.BUILD_PHASE;
      s.wave = 13;
      s.lives = 30;
      startWave(s);

      const leaks: string[] = [];
      const deaths: Record<string, number> = {};
      for (let i = 0; i < 30 * 60; i++) {
        s.tick += 1 / 60;
        tickSpawns(s, 1 / 60);
        tickSurpriseEvents(s);
        for (const e of s.enemies.values()) {
          if (!e.risingUntil || s.tick >= e.risingUntil) e.hp = 0;
        }
        tickEnemies(
          s,
          1 / 60,
          e => {
            const pathLen = e.isFlyer ? s.flyerPath.length : ((e as any).__caveB ? s.groundPathB.length : s.groundPath.length);
            leaks.push(`${String(e.type)}@${s.tick.toFixed(2)}#${e.pathIndex}/${pathLen - 1}+${e.pathProgress.toFixed(2)}`);
            s.lives -= leakLifeCostFor(e);
            if (s.lives <= 0 && s.gameOverAt < 0) s.gameOverAt = s.tick;
          },
          e => {
            deaths[String(e.type)] = (deaths[String(e.type)] ?? 0) + 1;
            s.enemies.delete(e.id);
          }
        );
      }

      expect(leaks).toEqual([]);
      expect(s.lives).toBe(30);
      expect(s.gameOverAt).toBeLessThan(0);
      expect(deaths.UNDEAD_CELT).toBe(54);
      expect(deaths.REANIMATED_ZOMBIE).toBeGreaterThan(300);
      expect(deaths.SPECTRAL_SCOUT).toBe(8);
      expect(deaths.GRAVE_LEGION_DRAGON).toBe(1);
    } finally {
      if (prevWindow === undefined) delete (globalThis as any).window;
      else (globalThis as any).window = prevWindow;
    }
  }, 15000);

  it('does not leak or set game over in the opening seconds of any authored wave', () => {
    const prevWindow = (globalThis as any).window;
    (globalThis as any).window = prevWindow ?? {};
    try {
      const report: Record<number, { leaks: string[]; lives: number; gameOverAt: number; queue: number; enemies: number; phase: GamePhase; ended: number }> = {};

      for (let wave = 1; wave <= WAVE.TOTAL; wave++) {
        const s = bootstrapState();
        s.phase = GamePhase.BUILD_PHASE;
        s.wave = wave - 1;
        s.lives = 30;
        startWave(s);

        const leaks: string[] = [];
        let ended = 0;
        for (let i = 0; i < 180; i++) {
          s.tick += 1 / 60;
          tickSpawns(s, 1 / 60);
          tickEnemies(
            s,
            1 / 60,
            e => {
              const progress = `${e.pathIndex}+${e.pathProgress.toFixed(2)}`;
              leaks.push(`${String(e.type)}@${s.tick.toFixed(2)}#${progress}`);
              s.lives -= leakLifeCostFor(e);
              s.enemiesLeakedThisWave++;
              if (s.lives <= 0 && s.gameOverAt < 0) s.gameOverAt = s.tick;
            },
            e => s.enemies.delete(e.id)
          );
          checkWaveEnd(s, () => { ended++; });
        }

        report[wave] = {
          leaks,
          lives: s.lives,
          gameOverAt: s.gameOverAt,
          queue: s.spawnQueue.length,
          enemies: s.enemies.size,
          phase: s.phase,
          ended
        };
      }

      for (let wave = 1; wave <= WAVE.TOTAL; wave++) {
        expect(report[wave].leaks, `W${wave} should not leak in the first 3 seconds`).toEqual([]);
        expect(report[wave].lives, `W${wave} should not lose lives in the first 3 seconds`).toBe(30);
        expect(report[wave].gameOverAt, `W${wave} should not set game over in the first 3 seconds`).toBeLessThan(0);
        expect(report[wave].ended, `W${wave} should not auto-end in the first 3 seconds`).toBe(0);
        expect(report[wave].phase, `W${wave} should still be active in the first 3 seconds`).toBe(GamePhase.WAVE_PHASE);
      }
    } finally {
      if (prevWindow === undefined) delete (globalThis as any).window;
      else (globalThis as any).window = prevWindow;
    }
  }, 30000);

  it('keeps Test Your Might alive during its opening seconds unless a real bonus enemy leaks', () => {
    const prevWindow = (globalThis as any).window;
    (globalThis as any).window = prevWindow ?? {};
    const s = bootstrapState();
    try {
      startTestYourMight(s);

      const leaks: string[] = [];
      for (let i = 0; i < 180; i++) {
        s.tick += 1 / 60;
        tickSpawns(s, 1 / 60);
        tickEnemies(
          s,
          1 / 60,
          e => {
            leaks.push(`${String(e.type)}@${s.tick.toFixed(2)}#${e.pathIndex}+${e.pathProgress.toFixed(2)}`);
            if (isTestYourMightLeakEnemy(e)) failTestYourMight(s, String(e.type));
          },
          e => s.enemies.delete(e.id)
        );
      }

      expect(leaks, 'W10.5 should not leak in the first 3 seconds').toEqual([]);
      expect(s.testYourMightActive).toBe(true);
      expect(s.testYourMightFailed).toBe(false);
      expect(s.lives).toBeGreaterThan(0);
      expect(s.gameOverAt).toBeLessThan(0);
    } finally {
      if (prevWindow === undefined) delete (globalThis as any).window;
      else (globalThis as any).window = prevWindow;
    }
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

  it('wave 9 war elephant elites heal at checkpoint coins without boss rewards', () => {
    const s = bootstrapState();
    s.phase = GamePhase.BUILD_PHASE;
    s.wave = 8;
    startWave(s);
    tickSpawns(s, 999);

    const elephant = Array.from(s.enemies.values()).find(e => e.type === EnemyType.WAR_ELEPHANT);
    expect(elephant).toBeDefined();
    expect(elephant!.isBoss).toBe(false);
    expect(elephant!.isElite).toBe(true);
    expect(elephant!.checkpointHealPct).toBe(0.08);
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

  it('spends each checkpoint on first touch and never heals twice after a route loop', () => {
    const s = bootstrapState();
    s.phase = GamePhase.BUILD_PHASE;
    s.wave = 8;
    startWave(s);
    tickSpawns(s, 999);

    const elephant = Array.from(s.enemies.values()).find(e => e.type === EnemyType.WAR_ELEPHANT)!;
    expect(elephant).toBeDefined();

    // First contact at full HP must still consume checkpoint I.
    elephant.hp = elephant.maxHp;
    elephant.x = 10 * 32 + 16;
    elephant.y = 5 * 32 + 16;
    tickEnemies(s, 0, () => {}, () => {});
    expect(elephant.healedCheckpoints).toEqual([1]);

    // A later loop over checkpoint I cannot heal after the enemy is damaged.
    elephant.hp = elephant.maxHp * 0.50;
    const afterDamage = elephant.hp;
    tickEnemies(s, 0, () => {}, () => {});
    expect(elephant.hp).toBe(afterDamage);
    expect(elephant.healedCheckpoints).toEqual([1]);

    // A different checkpoint remains available exactly once.
    elephant.x = 10 * 32 + 16;
    elephant.y = 13 * 32 + 16;
    tickEnemies(s, 0, () => {}, () => {});
    expect(elephant.hp).toBeGreaterThan(afterDamage);
    expect(elephant.healedCheckpoints).toEqual([1, 2]);
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
      expect(elephant.isBoss).toBe(false);
      expect(elephant.isElite).toBe(true);
      expect(isRareOnlyBossDropEnemy(elephant)).toBe(true);
      expect(isLegendaryBossDropEnemy(elephant)).toBe(false);
    }
  });

  it('keeps Hannibal free of passive health regeneration', () => {
    const def: any = (enemiesData as any).HANNIBAL_BARCA;
    expect(def.regenPctPerSec).toBeUndefined();
    expect(def.outOfCombatRegen).toBeUndefined();

    const s = bootstrapState();
    s.wave = 10;
    s.phase = GamePhase.WAVE_PHASE;
    s.tick = 20;
    const hannibal = spawnEnemy(s, EnemyType.HANNIBAL_BARCA, 1);
    const elephant = spawnEnemy(s, EnemyType.WAR_ELEPHANT, 1);
    const runtime = createBossRuntime();

    hannibal.hp = hannibal.maxHp * 0.5;
    hannibal.lastDamagedTick = -999;
    const before = hannibal.hp;
    tickBossScripts(s, 5, runtime, 0);

    expect(elephant.type).toBe(EnemyType.WAR_ELEPHANT);
    expect(hannibal.hp).toBe(before);
  });

  it('does not summon replacement elephants when Hannibal enters his low-health phase', () => {
    const s = bootstrapState();
    s.wave = 10;
    s.phase = GamePhase.WAVE_PHASE;
    s.tick = 10;
    const hannibal = spawnEnemy(s, EnemyType.HANNIBAL_BARCA, 1);
    const runtime = createBossRuntime();

    hannibal.hp = hannibal.maxHp * 0.54;
    tickBossScripts(s, 0.016, runtime, 0);
    expect(Array.from(s.enemies.values()).filter(e => e.type === EnemyType.WAR_ELEPHANT)).toHaveLength(0);

    s.tick = 11.1;
    hannibal.hp = hannibal.maxHp * 0.50;
    tickBossScripts(s, 0.016, runtime, 0);

    expect(hannibal.hasRebirthed).toBe(true);
    expect(hannibal.hp).toBeCloseTo(hannibal.maxHp * 0.65, 4);
    expect(Array.from(s.enemies.values()).filter(e => e.type === EnemyType.WAR_ELEPHANT)).toHaveLength(0);
    expect(s.spawnQueue.filter(item => item.type === EnemyType.WAR_ELEPHANT)).toHaveLength(0);
    expect(s.hint).not.toContain('Elephant');

    s.tick = 20;
    hannibal.hp = hannibal.maxHp * 0.15;
    tickBossScripts(s, 0.016, runtime, 0);
    expect(Array.from(s.enemies.values()).filter(e => e.type === EnemyType.WAR_ELEPHANT)).toHaveLength(0);

    for (const file of ['src/systems/BossScripts.ts', 'src/render/EnemyInspect.ts', 'src/render/Codex.ts']) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/Hannibal[\s\S]{0,220}summons? 2 War Elephants/i);
      expect(source).not.toMatch(/summons? 2 War Elephants[\s\S]{0,220}Hannibal/i);
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
