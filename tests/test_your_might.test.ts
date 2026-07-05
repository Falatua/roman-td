import { describe, expect, it } from 'vitest';
import { createGameState } from '../src/GameState';
import { GamePhase } from '../src/types';
import { DamageType, StatusEffectKind } from '../src/types';
import {
  acceptTestYourMight,
  completeTestYourMight,
  declineTestYourMight,
  displayWaveNumber,
  failTestYourMight,
  shouldOfferTestYourMight,
  startTestYourMight,
  TEST_YOUR_MIGHT_AFTER_WAVE,
  TEST_YOUR_MIGHT_DISPLAY_WAVE,
  TEST_YOUR_MIGHT_MAX_SPAWN_DT,
  TEST_YOUR_MIGHT_REWARD_GOLD,
  TEST_YOUR_MIGHT_SPAWNS,
  tickTestYourMightSpawns
} from '../src/systems/TestYourMightSystem';
import { checkWaveEnd, startWave, tickSpawns } from '../src/systems/WaveManager';
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
    expect(s.testYourMightAccepted).toBe(false);
    expect(s.testYourMightActive).toBe(false);
    expect(s.wave).toBe(10);
    expect(s.lives).toBeGreaterThan(0);
  });

  it('accepting arms the challenge without starting it so the player can prep', () => {
    const s = bootstrapState();
    acceptTestYourMight(s);
    expect(s.phase).toBe(GamePhase.BUILD_PHASE);
    expect(s.wave).toBe(10);
    expect(s.testYourMightOffered).toBe(true);
    expect(s.testYourMightAccepted).toBe(true);
    expect(s.testYourMightActive).toBe(false);
    expect(s.spawnQueue.length).toBe(0);
    expect(displayWaveNumber(s)).toBe('10');
    startWave(s);
    expect(s.phase).toBe(GamePhase.WAVE_PHASE);
    expect(s.wave).toBe(10);
    expect(s.testYourMightAccepted).toBe(false);
    expect(s.testYourMightActive).toBe(true);
    expect(displayWaveNumber(s)).toBe('10.5');
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
    expect(s.weatherIntensity).toBeGreaterThanOrEqual(1.3);
    expect(s.waveModifier).toBe('GROUP_MARCH');
    expect(s.endlessExtraModifiers).toEqual(['STORM_SURGE', 'DEATH_PACT']);
  });

  it('is tuned as a brutal ground gauntlet with bosses, commanders, no flyers, and affixes', () => {
    const byType = new Map(TEST_YOUR_MIGHT_SPAWNS.map(g => [g.type, g]));
    const types = TEST_YOUR_MIGHT_SPAWNS.map(g => g.type);
    const enemyDefs: any = enemiesData as any;
    const totalCount = TEST_YOUR_MIGHT_SPAWNS.reduce((sum, g) => sum + g.count, 0);

    expect(types.some(type => enemyDefs[type]?.isBoss === true)).toBe(true);
    expect(types.some(type => enemyDefs[type]?.isFlyer === true)).toBe(false);
    expect(types.some(type => enemyDefs[type]?.isBoss !== true && enemyDefs[type]?.isFlyer !== true)).toBe(true);
    expect(types).not.toContain('BOSS_FLYER_VULTURE');
    expect(types).not.toContain('NUMIDIAN_RIDER');
    expect(types).not.toContain('SPECTRAL_SCOUT');
    expect(types).not.toContain('SHADOW_CAVALRY');
    expect(types).toContain('PATHFINDER_COMMANDER');
    expect(types).toContain('STANDARD_BEARER_COMMANDER');
    expect(types).toContain('SIEGE_CAPTAIN_COMMANDER');
    expect(types).toContain('ANUBIS_PRIEST_COMMANDER');
    expect(totalCount).toBe(40);

    expect(byType.get('HANNIBAL_BARCA')?.hpMult).toBeGreaterThanOrEqual(50);
    expect(byType.get('HANNIBAL_BARCA')?.majorReward).toBe(true);
    expect(TEST_YOUR_MIGHT_SPAWNS.filter(g => g.majorReward).map(g => g.type)).toEqual(['HANNIBAL_BARCA']);
    expect(byType.get('CARTHAGE_SPEARMAN')?.count).toBe(18);
    expect(byType.get('CARTHAGE_ELITE_GUARD')?.count).toBe(8);
    expect(byType.get('IRON_PHALANX')?.count).toBe(5);
    expect(byType.get('CARTHAGE_SPEARMAN')?.hpMult).toBeGreaterThanOrEqual(265);
    expect(TEST_YOUR_MIGHT_SPAWNS.some(g => (g.resistMult ?? 1) <= 0.82)).toBe(true);
    expect(TEST_YOUR_MIGHT_SPAWNS.some(g => (g.statusGuard ?? 1) <= 0.46)).toBe(true);
    expect(TEST_YOUR_MIGHT_SPAWNS.some(g => (g.rangedBlock ?? 0) >= 0.10)).toBe(true);
    expect(TEST_YOUR_MIGHT_SPAWNS.some(g => (g.checkpointHeal ?? 0) >= 0.05)).toBe(true);
  });

  it('routes tickSpawns through the bonus spawner and creates real enemies', () => {
    const s = bootstrapState();
    startTestYourMight(s);
    s.spawnElapsed = 999;
    tickTestYourMightSpawns(s);
    expect(s.spawnQueue.length).toBe(0);
    expect(s.enemies.size).toBeGreaterThan(0);
    expect(Array.from(s.enemies.values()).some(e => e.isBoss)).toBe(true);
    expect(Array.from(s.enemies.values()).some(e => e.isFlyer)).toBe(false);
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

    expect(hannibal.__lateResistMult).toBeLessThanOrEqual(0.84);
    expect(hannibal.__lateStatusGuard).toBeLessThanOrEqual(0.46);
    expect(enemyDamageMultiplier(hannibal, DamageType.PHYS_RANGED)).toBeLessThan(0.5);
    expect(statusEffectiveness(hannibal, StatusEffectKind.SLOW)).toBeLessThan(0.2);
    expect(elite.mutation).toBe('WARDED');
    expect(elite.__lateRangedBlock).toBeGreaterThanOrEqual(0.10);
    expect(elite.outOfCombatRegen).toBeGreaterThanOrEqual(0.018);
    expect(elephant.checkpointHealPct).toBeGreaterThanOrEqual(0.05);
  });

  it('caps bonus-wave spawn pacing through the normal WaveManager entrypoint', () => {
    const s = bootstrapState();
    startTestYourMight(s);
    tickSpawns(s, 999);
    expect(s.spawnElapsed).toBeCloseTo(TEST_YOUR_MIGHT_MAX_SPAWN_DT);
    expect(s.spawnQueue.length).toBeGreaterThan(0);
    expect(s.enemies.size).toBeGreaterThan(0);
  });

  it('one leaked enemy immediately fails the entire run', () => {
    const s = bootstrapState();
    startTestYourMight(s);
    failTestYourMight(s, 'War Elephant');
    expect(displayWaveNumber(s)).toBe('10.5');
    expect(s.testYourMightActive).toBe(false);
    expect(s.testYourMightFailed).toBe(true);
    expect(s.lives).toBe(0);
    expect(s.gameOverAt).toBeGreaterThanOrEqual(0);
    expect(s.hint).toContain('War Elephant reached Rome');
    expect(s.hint).toContain('One leak ends Test Your Might');
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
