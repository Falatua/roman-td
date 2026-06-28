import { describe, expect, it } from 'vitest';
import { createGameState } from '../src/GameState';
import { GamePhase } from '../src/types';
import { DamageType, StatusEffectKind } from '../src/types';
import {
  completeTestYourMight,
  declineTestYourMight,
  displayWaveNumber,
  failTestYourMight,
  shouldOfferTestYourMight,
  startTestYourMight,
  TEST_YOUR_MIGHT_AFTER_WAVE,
  TEST_YOUR_MIGHT_DISPLAY_WAVE,
  TEST_YOUR_MIGHT_REWARD_GOLD,
  TEST_YOUR_MIGHT_SPAWNS,
  tickTestYourMightSpawns
} from '../src/systems/TestYourMightSystem';
import { checkWaveEnd, tickSpawns } from '../src/systems/WaveManager';
import { initializeGrid } from '../src/systems/GridManager';
import { buildFlyerPath, buildGroundPath } from '../src/systems/PathFinder';
import { enemyDamageMultiplier, statusEffectiveness } from '../src/systems/EnemyResistances';
import enemiesData from '../src/data/enemies.json';

function bootstrapState() {
  const s = createGameState();
  initializeGrid(s);
  const path = buildGroundPath(s);
  if (path) s.groundPath = path;
  s.flyerPath = buildFlyerPath();
  s.phase = GamePhase.BUILD_PHASE;
  s.wave = TEST_YOUR_MIGHT_AFTER_WAVE;
  return s;
}

describe('Test Your Might bonus wave', () => {
  it('is offered once after W10 when the run is alive', () => {
    const s = bootstrapState();
    expect(shouldOfferTestYourMight(s)).toBe(true);
    s.wave = 9;
    expect(shouldOfferTestYourMight(s)).toBe(false);
    s.wave = 10;
    s.testYourMightOffered = true;
    expect(shouldOfferTestYourMight(s)).toBe(false);
  });

  it('declining marks the offer without changing wave or lives', () => {
    const s = bootstrapState();
    declineTestYourMight(s);
    expect(s.testYourMightOffered).toBe(true);
    expect(s.testYourMightDeclined).toBe(true);
    expect(s.testYourMightActive).toBe(false);
    expect(s.wave).toBe(10);
    expect(s.lives).toBeGreaterThan(0);
  });

  it('starts a special spawn queue without advancing the campaign wave', () => {
    const s = bootstrapState();
    startTestYourMight(s);
    const expectedCount = TEST_YOUR_MIGHT_SPAWNS.reduce((sum, g) => sum + g.count, 0);
    expect(s.phase).toBe(GamePhase.WAVE_PHASE);
    expect(s.wave).toBe(10);
    expect(TEST_YOUR_MIGHT_DISPLAY_WAVE).toBe('10.5');
    expect(displayWaveNumber(s)).toBe('10.5');
    expect(s.testYourMightActive).toBe(true);
    expect(s.spawnQueue.length).toBe(expectedCount);
    expect(s.weatherIntensity).toBeGreaterThan(1);
    expect(s.weatherIntensity).toBeGreaterThanOrEqual(1.8);
    expect(s.waveModifier).toBe('GROUP_MARCH');
    expect(s.endlessExtraModifiers).toEqual(['STORM_SURGE', 'VEIL', 'DEATH_PACT']);
  });

  it('is tuned as a brutal mixed gauntlet with bosses, flyers, ground, all commanders, and affixes', () => {
    const byType = new Map(TEST_YOUR_MIGHT_SPAWNS.map(g => [g.type, g]));
    const types = TEST_YOUR_MIGHT_SPAWNS.map(g => g.type);
    const enemyDefs: any = enemiesData as any;
    const totalCount = TEST_YOUR_MIGHT_SPAWNS.reduce((sum, g) => sum + g.count, 0);

    expect(types.some(type => enemyDefs[type]?.isBoss === true)).toBe(true);
    expect(types.some(type => enemyDefs[type]?.isFlyer === true)).toBe(true);
    expect(types.some(type => enemyDefs[type]?.isBoss !== true && enemyDefs[type]?.isFlyer !== true)).toBe(true);
    expect(types).toContain('BOSS_FLYER_VULTURE');
    expect(types).toContain('PATHFINDER_COMMANDER');
    expect(types).toContain('STANDARD_BEARER_COMMANDER');
    expect(types).toContain('SIEGE_CAPTAIN_COMMANDER');
    expect(types).toContain('ANUBIS_PRIEST_COMMANDER');
    expect(totalCount).toBeGreaterThanOrEqual(110);

    expect(byType.get('HANNIBAL_BARCA')?.hpMult).toBeGreaterThanOrEqual(50);
    expect(byType.get('HANNIBAL_BARCA')?.majorReward).toBe(true);
    expect(TEST_YOUR_MIGHT_SPAWNS.filter(g => g.majorReward).map(g => g.type)).toEqual(['HANNIBAL_BARCA']);
    expect(byType.get('CARTHAGE_SPEARMAN')?.hpMult).toBeGreaterThanOrEqual(300);
    expect(byType.get('SPECTRAL_SCOUT')?.hpMult).toBeGreaterThanOrEqual(380);
    expect(TEST_YOUR_MIGHT_SPAWNS.some(g => (g.resistMult ?? 1) <= 0.70)).toBe(true);
    expect(TEST_YOUR_MIGHT_SPAWNS.some(g => (g.statusGuard ?? 1) <= 0.25)).toBe(true);
    expect(TEST_YOUR_MIGHT_SPAWNS.some(g => (g.rangedBlock ?? 0) >= 0.20)).toBe(true);
    expect(TEST_YOUR_MIGHT_SPAWNS.some(g => (g.checkpointHeal ?? 0) >= 0.12)).toBe(true);
  });

  it('routes tickSpawns through the bonus spawner and creates real enemies', () => {
    const s = bootstrapState();
    startTestYourMight(s);
    s.spawnElapsed = 999;
    tickTestYourMightSpawns(s);
    expect(s.spawnQueue.length).toBe(0);
    expect(s.enemies.size).toBeGreaterThan(0);
    expect(Array.from(s.enemies.values()).some(e => e.isBoss)).toBe(true);
    expect(Array.from(s.enemies.values()).some(e => e.isFlyer)).toBe(true);
    expect(Array.from(s.enemies.values()).filter(e => e.isScheduledBoss).map(e => e.type)).toEqual(['HANNIBAL_BARCA']);
  });

  it('stamps challenge-only resistance, status, block, regen, and checkpoint mechanics onto spawned enemies', () => {
    const s = bootstrapState();
    startTestYourMight(s);
    s.spawnElapsed = 999;
    tickTestYourMightSpawns(s);
    const enemies = Array.from(s.enemies.values()) as any[];
    const hannibal = enemies.find(e => e.type === 'HANNIBAL_BARCA');
    const elite = enemies.find(e => e.type === 'CARTHAGE_ELITE_GUARD');
    const elephant = enemies.find(e => e.type === 'WAR_ELEPHANT');

    expect(hannibal.__lateResistMult).toBeLessThan(0.8);
    expect(hannibal.__lateStatusGuard).toBeLessThanOrEqual(0.25);
    expect(enemyDamageMultiplier(hannibal, DamageType.PHYS_RANGED)).toBeLessThan(0.4);
    expect(statusEffectiveness(hannibal, StatusEffectKind.SLOW)).toBeLessThan(0.1);
    expect(elite.mutation).toBe('WARDED');
    expect(elite.__lateRangedBlock).toBeGreaterThanOrEqual(0.2);
    expect(elite.outOfCombatRegen).toBeGreaterThanOrEqual(0.04);
    expect(elephant.checkpointHealPct).toBeGreaterThanOrEqual(0.12);
  });

  it('also works through the normal WaveManager tickSpawns entrypoint', () => {
    const s = bootstrapState();
    startTestYourMight(s);
    tickSpawns(s, 999);
    expect(s.spawnQueue.length).toBe(0);
    expect(s.enemies.size).toBeGreaterThan(0);
  });

  it('one leaked enemy immediately fails the entire run', () => {
    const s = bootstrapState();
    startTestYourMight(s);
    failTestYourMight(s);
    expect(displayWaveNumber(s)).toBe('10.5');
    expect(s.testYourMightActive).toBe(false);
    expect(s.testYourMightFailed).toBe(true);
    expect(s.lives).toBe(0);
    expect(s.gameOverAt).toBeGreaterThanOrEqual(0);
  });

  it('a failed challenge cannot be converted into a wave-clear reward', () => {
    const s = bootstrapState();
    startTestYourMight(s);
    failTestYourMight(s);
    s.spawnQueue = [];
    s.enemies.clear();
    let ended = false;
    checkWaveEnd(s, () => { ended = true; });
    expect(ended).toBe(false);
    expect(s.phase).toBe(GamePhase.WAVE_PHASE);
    expect(s.lives).toBe(0);
  });

  it('a perfect clear returns to W11 prep and pays exactly the bonus reward when applied', () => {
    const s = bootstrapState();
    const beforeGold = s.gold;
    startTestYourMight(s);
    expect(completeTestYourMight(s)).toBe(true);
    s.gold += TEST_YOUR_MIGHT_REWARD_GOLD;
    expect(s.phase).toBe(GamePhase.BUILD_PHASE);
    expect(s.wave).toBe(10);
    expect(s.testYourMightCleared).toBe(true);
    expect(displayWaveNumber(s)).toBe('10.5');
    expect(s.gold - beforeGold).toBe(3000);
    expect(s.weatherKey).toBeNull();
    expect(s.waveModifier).toBeNull();
  });
});
