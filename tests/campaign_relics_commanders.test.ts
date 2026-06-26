import { describe, it, expect, beforeAll } from 'vitest';
import { createGameState } from '../src/GameState';
import { DamageType, EnemyType, GamePhase, TowerType } from '../src/types';
import { initializeGrid } from '../src/systems/GridManager';
import { buildFlyerPath, buildGroundPath, buildGroundPathB } from '../src/systems/PathFinder';
import { startWave, tickSpawns } from '../src/systems/WaveManager';
import {
  CAMPAIGN_RELICS,
  activeCampaignRelicIds,
  applyCampaignRelic,
  campaignRelicDamageMult,
  campaignRelicEnemySpeedMult,
  campaignRelicOffersForWave,
  campaignRelicWaveGoldMult,
  shouldOfferCampaignRelics,
  skipCampaignRelic
} from '../src/systems/CampaignRelicSystem';
import { applyBossTrophy, bossTrophyDamageMult, bossTrophyTrapDamageMult, bossTrophyTrapRadiusMult, shouldOfferBossTrophy } from '../src/systems/BossTrophySystem';
import { buyTraps, trapPrice, TRAP_DEFS } from '../src/systems/TrapSystem';
import { commanderDamageTakenMult, commanderSpeedMult, commanderTrapRadiusDisabled, isCommanderType } from '../src/systems/CommanderSystem';
import { createTower, towerEffectiveStats } from '../src/systems/TowerSystem';
import { canReceiveRunReward } from '../src/systems/RewardEligibility';

beforeAll(() => {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (globalThis as any).window.__renderer = { triggerSpawnPuff: () => {} };
});

function bootstrapState() {
  const s = createGameState();
  initializeGrid(s);
  const path = buildGroundPath(s);
  if (path) s.groundPath = path;
  s.groundPathB = buildGroundPathB(s) ?? [];
  s.flyerPath = buildFlyerPath();
  return s;
}

describe('Campaign relics', () => {
  it('ships a full 30-relic randomized campaign pool', () => {
    expect(CAMPAIGN_RELICS.length).toBe(32);
    expect(new Set(CAMPAIGN_RELICS.map(r => r.id)).size).toBe(32);
    for (const relic of CAMPAIGN_RELICS) {
      expect(relic.upside.length).toBeGreaterThan(5);
      expect(relic.caveat.length).toBeGreaterThan(5);
    }
  });

  it('offers relics after each fifth wave before W30 only', () => {
    const s = bootstrapState();
    for (const wave of [1, 4, 6, 9, 11, 24, 26, 30]) {
      s.wave = wave;
      expect(shouldOfferCampaignRelics(s), `W${wave}`).toBe(false);
    }
    for (const wave of [5, 10, 15, 20, 25]) {
      const st = bootstrapState();
      st.wave = wave;
      expect(shouldOfferCampaignRelics(st), `W${wave}`).toBe(true);
    }
  });

  it('builds four unclaimed offers and preserves them for the wave', () => {
    const s = bootstrapState();
    s.wave = 10;
    applyCampaignRelic(s, 'MARS_TAX');
    const offers = campaignRelicOffersForWave(s, 10);
    expect(offers.length).toBe(4);
    expect(new Set(offers.map(o => o.id)).size).toBe(4);
    expect(offers.map(o => o.id)).not.toContain('MARS_TAX');
    expect(campaignRelicOffersForWave(s, 10).map(o => o.id)).toEqual(offers.map(o => o.id));
  });

  it('lets the player reject an offer without adding a relic', () => {
    const s = bootstrapState();
    s.wave = 5;
    expect(shouldOfferCampaignRelics(s)).toBe(true);
    skipCampaignRelic(s);
    expect(activeCampaignRelicIds(s)).toEqual([]);
    expect(shouldOfferCampaignRelics(s)).toBe(false);
    expect(s.campaignRelicSkippedWaves).toContain(5);
  });

  it('relics are high-stakes campaign bargains, not tiny stat nudges', () => {
    const byId = Object.fromEntries(CAMPAIGN_RELICS.map(r => [r.id, r]));
    expect(byId.MARS_TAX.upside).toContain('-75%');
    expect(byId.BLACK_OIL.upside).toContain('+125%');
    expect(byId.AEGIS_WALL.caveat).toContain('+65%');
    expect(byId.LAST_EAGLE.upside).toContain('+70%');
    expect(byId.LAUREL_CENSUS.caveat).toContain('+100%');
    expect(byId.SENATE_AUDIT.caveat).toContain('+80%');
  });

  it('Saturn debt grants the immediate 900g campaign bankroll', () => {
    const s = bootstrapState();
    const before = s.gold;
    applyCampaignRelic(s, 'SATURNS_DEBT');
    expect(s.campaignRelicId).toBe('SATURNS_DEBT');
    expect(s.campaignRelicIds).toContain('SATURNS_DEBT');
    expect(s.gold).toBe(before + 900);
  });

  it('Jupiter mandate buffs divine damage and commander damage', () => {
    const s = bootstrapState();
    applyCampaignRelic(s, 'JUPITERS_MANDATE');
    const tower = createTower(TowerType.SOLAR_PRIEST, 5, 1, 1, 21);
    tower.damageType = DamageType.DIVINE;
    const target = { isCommander: true, type: 'STANDARD_BEARER_COMMANDER' };
    expect(campaignRelicDamageMult(s, tower, target)).toBeCloseTo(1.8 * 1.5, 4);
  });

  it('Mars Tax discounts trap prices and raises enemy speed', () => {
    const s = bootstrapState();
    applyCampaignRelic(s, 'MARS_TAX');
    const id = 'IRON_SPIKE_TRAP';
    expect(trapPrice(s, id)).toBe(Math.round(TRAP_DEFS[id].price * 0.25));
    expect(campaignRelicEnemySpeedMult(s)).toBeCloseTo(1.40, 4);
    s.gold = 999;
    const spent = buyTraps(s, id, 2);
    expect(spent).toBe(trapPrice(s, id) * 2);
    expect(s.trapInventory?.[id]).toBe(2);
  });

  it('Ceres Tithe increases wave gold while retaining its caveat elsewhere', () => {
    const s = bootstrapState();
    applyCampaignRelic(s, 'CERES_TITHE');
    expect(campaignRelicWaveGoldMult(s)).toBeCloseTo(1.75, 4);
  });

  it('tower-stat relics read live game state for speed and range changes', () => {
    const s = bootstrapState();
    (globalThis as any).__game = s;
    const tower = createTower(TowerType.MILITES, 1, 1, 1, 5);
    const base = towerEffectiveStats(tower);
    applyCampaignRelic(s, 'RAPID_MUSTER');
    applyCampaignRelic(s, 'SCOUT_MAPS');
    const boosted = towerEffectiveStats(tower);
    expect(boosted.attackSpeed).toBeCloseTo(base.attackSpeed * 1.55, 4);
    expect(boosted.range).toBeCloseTo(base.range + 2, 4);
    delete (globalThis as any).__game;
  });
});

describe('Boss trophies', () => {
  it('only offers a trophy for scheduled major bosses and never elephants', () => {
    const s = bootstrapState();
    s.wave = 24;
    expect(shouldOfferBossTrophy(s, { isBoss: true, isScheduledBoss: true, type: 'ANUBIS_KING' })).toBe(true);
    expect(shouldOfferBossTrophy(s, { isBoss: true, isScheduledBoss: true, type: 'UNDEAD_WAR_ELEPHANT' })).toBe(false);
    expect(shouldOfferBossTrophy(s, { isBoss: true, isScheduledBoss: false, type: 'ANUBIS_KING' })).toBe(false);
  });

  it('suppresses every run reward once the player has died', () => {
    const s = bootstrapState();
    s.wave = 10;
    s.lives = 0;
    s.gameOverAt = s.tick;
    expect(canReceiveRunReward(s)).toBe(false);
    expect(shouldOfferCampaignRelics(s)).toBe(false);
    expect(shouldOfferBossTrophy(s, { isBoss: true, isScheduledBoss: true, type: 'HANNIBAL_BARCA' })).toBe(false);

    s.phase = GamePhase.GAME_OVER;
    s.lives = 30;
    s.gameOverAt = -1;
    expect(canReceiveRunReward(s)).toBe(false);
  });

  it('applies run-level boss trophy damage and trap modifiers', () => {
    const s = bootstrapState();
    const tower = createTower(TowerType.MILITES, 1, 1, 1, 21);
    applyBossTrophy(s, 'EXECUTIONERS_LAUREL');
    expect(bossTrophyDamageMult(s, tower, { isBoss: true })).toBeCloseTo(1.15, 4);
    expect(bossTrophyDamageMult(s, tower, { isCommander: true })).toBeCloseTo(1.10, 4);
    applyBossTrophy(s, 'FIELD_ENGINEERS');
    expect(bossTrophyTrapDamageMult(s)).toBeCloseTo(1.25, 4);
    expect(bossTrophyTrapRadiusMult(s)).toBeCloseTo(1.15, 4);
  });
});

describe('Enemy commanders', () => {
  it('injects authored commander spawns into W21, W23, W26, W29, and W30', () => {
    const expected: Record<number, string> = {
      21: 'PATHFINDER_COMMANDER',
      23: 'ANUBIS_PRIEST_COMMANDER',
      26: 'STANDARD_BEARER_COMMANDER',
      29: 'SIEGE_CAPTAIN_COMMANDER',
      30: 'STANDARD_BEARER_COMMANDER'
    };
    for (const [waveText, type] of Object.entries(expected)) {
      const s = bootstrapState();
      s.phase = GamePhase.BUILD_PHASE;
      s.wave = Number(waveText) - 1;
      startWave(s);
      expect(s.spawnQueue.some(q => q.type === type)).toBe(true);
    }
  });

  it('marks spawned commanders and gives them non-boss support behavior', () => {
    const s = bootstrapState();
    s.phase = GamePhase.BUILD_PHASE;
    s.wave = 20;
    startWave(s);
    tickSpawns(s, 10);
    const commander = Array.from(s.enemies.values()).find(e => isCommanderType(e.type as any));
    expect(commander).toBeTruthy();
    expect(commander!.isBoss).toBe(false);
    expect((commander as any).isCommander).toBe(true);
  });

  it('standard bearers protect nearby non-boss enemies', () => {
    const s = bootstrapState();
    const commander: any = { id: 'c', type: EnemyType.STANDARD_BEARER_COMMANDER, hp: 100, x: 100, y: 100 };
    const ally: any = { id: 'a', type: EnemyType.MONGOL_FOOTMAN, hp: 100, isBoss: false, x: 120, y: 100 };
    s.enemies.set(commander.id, commander);
    expect(commanderDamageTakenMult(s, ally)).toBeCloseTo(0.85, 4);
  });

  it('pathfinders speed the wave and siege captains suppress nearby traps', () => {
    const s = bootstrapState();
    const pathfinder: any = { id: 'p', type: EnemyType.PATHFINDER_COMMANDER, hp: 100, x: 100, y: 100 };
    const siege: any = { id: 's', type: EnemyType.SIEGE_CAPTAIN_COMMANDER, hp: 100, x: 200, y: 200 };
    s.enemies.set(pathfinder.id, pathfinder);
    s.enemies.set(siege.id, siege);
    expect(commanderSpeedMult(s, { type: EnemyType.MONGOL_FOOTMAN, hp: 100 })).toBeCloseTo(1.12, 4);
    expect(commanderTrapRadiusDisabled(s, 210, 210)).toBe(true);
    expect(commanderTrapRadiusDisabled(s, 500, 500)).toBe(false);
  });
});
