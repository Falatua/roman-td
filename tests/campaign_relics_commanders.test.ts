import { describe, it, expect, beforeAll } from 'vitest';
import { createGameState } from '../src/GameState';
import { DamageType, EnemyType, GamePhase, TowerType } from '../src/types';
import { initializeGrid } from '../src/systems/GridManager';
import { buildFlyerPath, buildGroundPath, buildGroundPathB } from '../src/systems/PathFinder';
import { effectiveWaveHpMult, lateGameLayerMult, startWave, tickSpawns } from '../src/systems/WaveManager';
import {
  CAMPAIGN_RELICS,
  activeCampaignRelicIds,
  applyCampaignRelic,
  campaignRelicAffordability,
  campaignRelicBossKillLives,
  campaignRelicDamageMult,
  campaignRelicEnemyHpMult,
  campaignRelicEnemySpeedMult,
  campaignRelicKillGoldBonus,
  campaignRelicOffersForWave,
  campaignRelicTowerDpsMult,
  campaignRelicVestalRescue,
  campaignRelicWaveGoldMult,
  shouldOfferCampaignRelics,
  skipCampaignRelic
} from '../src/systems/CampaignRelicSystem';
import {
  applyBossTrophy,
  bossTrophyDamageMult,
  bossTrophyTrapDamageMult,
  bossTrophyTrapRadiusMult,
  consumePendingBossTrophyOffer,
  queueBossTrophyOfferForWave,
  shouldOfferBossTrophy
} from '../src/systems/BossTrophySystem';
import { buyTraps, trapPrice, TRAP_DEFS } from '../src/systems/TrapSystem';
import { grantTrapInventory } from '../src/systems/TrapInventorySystem';
import { bossEscortCommandersForWave, commanderDamageTakenMult, commanderSpeedMult, commanderTrapRadiusDisabled, isCommanderType } from '../src/systems/CommanderSystem';
import { createTower, towerEffectiveStats } from '../src/systems/TowerSystem';
import { canReceiveRunReward } from '../src/systems/RewardEligibility';
import enemiesData from '../src/data/enemies.json';

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
  it('ships a full 69-relic randomized campaign pool', () => {
    expect(CAMPAIGN_RELICS.length).toBe(69);
    expect(new Set(CAMPAIGN_RELICS.map(r => r.id)).size).toBe(69);
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
    expect(byId.AEGIS_WALL.caveat).toContain('+45%');
    expect(byId.LAST_EAGLE.upside).toContain('+70%');
    expect(byId.LAUREL_CENSUS.caveat).toContain('+70%');
    expect(byId.SENATE_AUDIT.caveat).toContain('+55%');
    expect(byId.CONSCRIPTS_WAGER.upside).toContain('Tier-5');
    expect(byId.ARMORY_BARGAIN.caveat).toContain('7 lives');
    expect(byId.LEGATE_CONTRACT.caveat).toContain('300 gold');
    expect(byId.AGRICOLA_LEVY.upside).toContain('Champion Agricola');
    expect(byId.AGRICOLA_LEVY.caveat).toContain('29 lives');
    expect(byId.RANK_AND_FILE_EDICT.upside).toContain('+20%');
    expect(byId.RANK_AND_FILE_EDICT.caveat).toContain('20% less');
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

  it('Rank-and-File Edict boosts base enemies but weakens boss and commander damage', () => {
    const s = bootstrapState();
    applyCampaignRelic(s, 'RANK_AND_FILE_EDICT');
    const tower = createTower(TowerType.MILITES, 3, 1, 1, 1);

    expect(campaignRelicDamageMult(s, tower, { type: 'CELTIC_FOOTMAN', archetype: 'BASIC' })).toBeCloseTo(1.20, 4);
    expect(campaignRelicDamageMult(s, tower, { type: 'WAR_ELEPHANT', archetype: 'ELITE' })).toBeCloseTo(1.00, 4);
    expect(campaignRelicDamageMult(s, tower, { type: 'CELTIC_WARLORD', isBoss: true })).toBeCloseTo(0.80, 4);
    expect(campaignRelicDamageMult(s, tower, { type: 'STANDARD_BEARER_COMMANDER', isCommander: true })).toBeCloseTo(0.80, 4);
  });

  it('Mars Tax discounts trap prices and raises enemy speed', () => {
    const s = bootstrapState();
    applyCampaignRelic(s, 'MARS_TAX');
    const id = 'IRON_SPIKE_TRAP';
    expect(trapPrice(s, id)).toBe(Math.round(TRAP_DEFS[id].price * 0.25));
    expect(campaignRelicEnemySpeedMult(s)).toBeCloseTo(1.30, 4);
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

  it('adds low-key builder bargain relics with immediate life costs', () => {
    const towerState = bootstrapState();
    towerState.lives = 35;
    applyCampaignRelic(towerState, 'CONSCRIPTS_WAGER');
    expect(towerState.lives).toBe(21);
    expect(towerState.pendingPurchasedTowers).toHaveLength(1);
    expect(towerState.pendingPurchasedTowers?.[0].tier).toBe(5);
    expect(towerState.pendingPurchasedTowers?.[0].source).toBe('relic');

    const rareState = bootstrapState();
    rareState.lives = 30;
    applyCampaignRelic(rareState, 'ARMORY_BARGAIN');
    expect(rareState.lives).toBe(23);
    expect((rareState as any).__pendingRelicItemRarities).toEqual(['RARE']);

    const epicState = bootstrapState();
    epicState.lives = 30;
    applyCampaignRelic(epicState, 'PATRICIAN_LOCKBOX');
    expect(epicState.lives).toBe(20);
    expect((epicState as any).__pendingRelicItemRarities).toEqual(['EPIC']);
  });

  it('adds low-stakes relics: small trades with small punishments', () => {
    // 2026-07-02 — JB: not every relic should be a run-defining gamble.
    const pilusState = bootstrapState();
    pilusState.lives = 30;
    applyCampaignRelic(pilusState, 'PILUS_PLEDGE');
    expect(pilusState.lives).toBe(25);
    expect(pilusState.pendingPurchasedTowers).toHaveLength(1);
    expect(pilusState.pendingPurchasedTowers?.[0].type).toBe(TowerType.PRIMUS_PILUS);
    expect(pilusState.pendingPurchasedTowers?.[0].tier).toBe(3);

    const loanState = bootstrapState();
    loanState.gold = 500;
    applyCampaignRelic(loanState, 'CENTURION_LOAN');
    expect(loanState.gold).toBe(350);
    expect(loanState.pendingPurchasedTowers?.[0].type).toBe(TowerType.CENTURION);
    expect(loanState.pendingPurchasedTowers?.[0].tier).toBe(3);

    const titheState = bootstrapState();
    titheState.lives = 20;
    const goldBefore = titheState.gold;
    applyCampaignRelic(titheState, 'COPPER_TITHE');
    expect(titheState.gold).toBe(goldBefore + 150);
    expect(titheState.lives).toBe(17);

    const watchState = bootstrapState();
    watchState.gold = 500;
    watchState.lives = 20;
    applyCampaignRelic(watchState, 'WATCHMANS_DUE');
    expect(watchState.gold).toBe(375);
    expect(watchState.lives).toBe(24);

    const scrapState = bootstrapState();
    scrapState.gold = 500;
    applyCampaignRelic(scrapState, 'SCRAP_REQUISITION');
    expect(scrapState.gold).toBe(360);
    expect((scrapState as any).__pendingRelicItemRarities).toEqual(['RARE']);

    // Affordability gates hold for the small costs too.
    const brokeState = bootstrapState();
    brokeState.lives = 5;
    expect(campaignRelicAffordability(brokeState, 'PILUS_PLEDGE').canAfford).toBe(false);
    const poorState = bootstrapState();
    poorState.gold = 80;
    expect(campaignRelicAffordability(poorState, 'SCRAP_REQUISITION').canAfford).toBe(false);
  });

  it('adds more low-stakes relics for quiet tactical choices', () => {
    const scout = bootstrapState();
    scout.gold = 500;
    applyCampaignRelic(scout, 'SCOUTS_STIPEND');
    expect(scout.gold).toBe(375);
    expect(scout.pendingPurchasedTowers?.[0]).toEqual({ type: TowerType.SPECULATOR, tier: 3, source: 'relic' });

    const slinger = bootstrapState();
    slinger.lives = 20;
    applyCampaignRelic(slinger, 'SLINGER_LEVY');
    expect(slinger.lives).toBe(16);
    expect(slinger.pendingPurchasedTowers?.[0]).toEqual({ type: TowerType.FUNDIBULUS, tier: 3, source: 'relic' });

    const builder = bootstrapState();
    builder.gold = 500;
    applyCampaignRelic(builder, 'BUILDER_CHIT');
    expect(builder.gold).toBe(360);
    expect(builder.pendingPurchasedTowers).toHaveLength(1);
    expect(builder.pendingPurchasedTowers?.[0].tier).toBe(3);
    expect(builder.pendingPurchasedTowers?.[0].source).toBe('relic');

    const rampart = bootstrapState();
    rampart.lives = 20;
    applyCampaignRelic(rampart, 'SMALL_RAMPART_GRANT');
    expect(rampart.lives).toBe(17);
    expect(rampart.rampartsOwned).toBe(1);
    expect(rampart.rampartsPurchased ?? 0).toBe(0);

    const traps = bootstrapState();
    traps.gold = 500;
    applyCampaignRelic(traps, 'TRAPWRIGHTS_SAMPLE');
    expect(traps.gold).toBe(405);
    expect(traps.trapInventory?.IRON_SPIKE_TRAP).toBe(1);
    expect(traps.trapInventory?.FROST_SNARE).toBe(1);
    expect(traps.trapsPurchased).toBe(2);

    const cappedTraps = bootstrapState();
    cappedTraps.gold = 500;
    grantTrapInventory(cappedTraps, 'IRON_SPIKE_TRAP', 5);
    applyCampaignRelic(cappedTraps, 'TRAPWRIGHTS_SAMPLE');
    expect(cappedTraps.trapInventory?.IRON_SPIKE_TRAP).toBe(5);
    expect(cappedTraps.trapInventory?.FROST_SNARE).toBe(1);
    expect(cappedTraps.trapsPurchased).toBe(6);

    const chapel = bootstrapState();
    chapel.gold = 500;
    chapel.lives = 12;
    applyCampaignRelic(chapel, 'CHAPEL_CANDLE');
    expect(chapel.gold).toBe(410);
    expect(chapel.lives).toBe(15);

    const noGold = bootstrapState();
    noGold.gold = 94;
    expect(campaignRelicAffordability(noGold, 'TRAPWRIGHTS_SAMPLE').canAfford).toBe(false);
    expect(applyCampaignRelic(noGold, 'TRAPWRIGHTS_SAMPLE')).toBe(false);
    expect(noGold.trapInventory?.IRON_SPIKE_TRAP ?? 0).toBe(0);
    expect(noGold.trapInventory?.FROST_SNARE ?? 0).toBe(0);

    const noLives = bootstrapState();
    noLives.lives = 3;
    expect(campaignRelicAffordability(noLives, 'SMALL_RAMPART_GRANT').canAfford).toBe(false);
    expect(applyCampaignRelic(noLives, 'SMALL_RAMPART_GRANT')).toBe(false);
    expect(noLives.rampartsOwned ?? 0).toBe(0);
  });

  it('adds mechanic-hook relics: ramparts, traps, kill gold, Saturnalia, wager, rescue', () => {
    // 2026-07-03 — six relics that plug into distinct game systems.
    // MASONS_CHARTER — 2 free ramparts, quota untouched, −6 lives.
    const mason = bootstrapState();
    mason.lives = 30;
    applyCampaignRelic(mason, 'MASONS_CHARTER');
    expect(mason.rampartsOwned).toBe(2);
    expect(mason.rampartsPurchased ?? 0).toBe(0);   // shop quota untouched
    expect(mason.lives).toBe(24);

    // VULCANS_CACHE — 6 traps for 180g.
    const vulcan = bootstrapState();
    vulcan.gold = 500;
    applyCampaignRelic(vulcan, 'VULCANS_CACHE');
    expect(vulcan.gold).toBe(320);
    expect(vulcan.trapInventory?.IRON_SPIKE_TRAP).toBe(2);
    expect(vulcan.trapInventory?.TAR_FIRE_TRAP).toBe(2);
    expect(vulcan.trapInventory?.FROST_SNARE).toBe(2);

    // PUBLICANS_CONTRACT — +2g/kill, wave gold ×0.70.
    const publican = bootstrapState();
    applyCampaignRelic(publican, 'PUBLICANS_CONTRACT');
    expect(campaignRelicKillGoldBonus(publican)).toBe(2);
    expect(campaignRelicWaveGoldMult(publican)).toBeCloseTo(0.70, 4);

    // SATURNALIA_EDICT — enemies ×0.88 speed, towers ×0.90 damage.
    const saturn = bootstrapState();
    applyCampaignRelic(saturn, 'SATURNALIA_EDICT');
    expect(campaignRelicEnemySpeedMult(saturn, {})).toBeCloseTo(0.88, 4);
    const anyTower = createTower(TowerType.MILITES, 1, 1, 1, 1);
    expect(campaignRelicTowerDpsMult(saturn, anyTower, 'BASE')).toBeCloseTo(0.90, 4);

    // COLOSSEUM_WAGER — +2 lives per boss kill, non-boss HP ×1.12.
    const wager = bootstrapState();
    applyCampaignRelic(wager, 'COLOSSEUM_WAGER');
    expect(campaignRelicBossKillLives(wager)).toBe(2);
    expect(campaignRelicEnemyHpMult(wager, { isBoss: false })).toBeCloseTo(1.12, 4);
    expect(campaignRelicEnemyHpMult(wager, { isBoss: true })).toBeCloseTo(1.0, 4);

    // VESTAL_COVENANT — one-time rescue below 6 lives; never fires twice.
    const vestal = bootstrapState();
    vestal.gold = 500;
    applyCampaignRelic(vestal, 'VESTAL_COVENANT');
    expect(vestal.gold).toBe(200);
    vestal.lives = 8;
    expect(campaignRelicVestalRescue(vestal)).toBe(false);   // not low enough
    vestal.lives = 4;
    expect(campaignRelicVestalRescue(vestal)).toBe(true);
    expect(vestal.lives).toBe(12);
    vestal.lives = 3;
    expect(campaignRelicVestalRescue(vestal)).toBe(false);   // covenant spent
    expect(vestal.lives).toBe(3);
    // Rescue never resurrects a dead run (Test Your Might sets lives = 0).
    const dead = bootstrapState();
    applyCampaignRelic(dead, 'VESTAL_COVENANT');
    dead.lives = 0;
    expect(campaignRelicVestalRescue(dead)).toBe(false);
  });

  it('blocks draft relic rewards when the life cost would kill the player', () => {
    const tooLowState = bootstrapState();
    tooLowState.lives = 8;
    expect(campaignRelicAffordability(tooLowState, 'VETERAN_DRAFT').canAfford).toBe(false);
    expect(applyCampaignRelic(tooLowState, 'VETERAN_DRAFT')).toBe(false);
    expect(tooLowState.lives).toBe(8);
    expect(tooLowState.pendingPurchasedTowers ?? []).toHaveLength(0);
    expect(activeCampaignRelicIds(tooLowState)).toEqual([]);

    const draftState = bootstrapState();
    draftState.lives = 9;
    expect(campaignRelicAffordability(draftState, 'VETERAN_DRAFT').canAfford).toBe(true);
    expect(applyCampaignRelic(draftState, 'VETERAN_DRAFT')).toBe(true);
    expect(draftState.lives).toBe(1);
    expect(draftState.pendingPurchasedTowers).toHaveLength(2);
    expect(draftState.pendingPurchasedTowers?.every(t => t.tier === 3)).toBe(true);

    const permitState = bootstrapState();
    permitState.lives = 20;
    applyCampaignRelic(permitState, 'ARCHITECTS_PERMIT');
    expect(permitState.lives).toBe(13);
    expect(permitState.pendingPurchasedTowers?.[0].tier).toBe(4);

    const frontierState = bootstrapState();
    frontierState.lives = 30;
    applyCampaignRelic(frontierState, 'FRONTIER_RECRUITS');
    expect(frontierState.lives).toBe(18);
    expect(frontierState.pendingPurchasedTowers).toHaveLength(2);
    expect(frontierState.pendingPurchasedTowers?.every(t => t.tier === 4)).toBe(true);
  });

  it('adds smaller gold and item bargains beside the high-stakes relics', () => {
    const ledgerState = bootstrapState();
    ledgerState.gold = 100;
    ledgerState.lives = 20;
    applyCampaignRelic(ledgerState, 'QUARTERMASTER_LEDGER');
    expect(ledgerState.gold).toBe(400);
    expect(ledgerState.lives).toBe(15);

    const purseState = bootstrapState();
    purseState.gold = 100;
    purseState.lives = 20;
    applyCampaignRelic(purseState, 'FORTUNA_PURSE');
    expect(purseState.gold).toBe(280);
    expect(purseState.lives).toBe(12);
    expect((purseState as any).__pendingRelicItemRarities).toEqual(['RARE']);
  });

  it('adds specific gold-sacrifice tower relics', () => {
    const legateState = bootstrapState();
    legateState.gold = 1000;
    applyCampaignRelic(legateState, 'LEGATE_CONTRACT');
    expect(legateState.gold).toBe(700);
    expect(legateState.pendingPurchasedTowers).toEqual([
      { type: TowerType.LEGATE, tier: 5, source: 'relic' }
    ]);

    const onagerState = bootstrapState();
    onagerState.gold = 1000;
    applyCampaignRelic(onagerState, 'ONAGER_INDENTURE');
    expect(onagerState.gold).toBe(675);
    expect(onagerState.pendingPurchasedTowers?.[0]).toEqual({ type: TowerType.COLOSSUS_ONAGER, tier: 5, source: 'relic' });

    const guardState = bootstrapState();
    guardState.gold = 1000;
    applyCampaignRelic(guardState, 'PRAETORIAN_STIPEND');
    expect(guardState.gold).toBe(550);
    expect(guardState.pendingPurchasedTowers?.[0]).toEqual({ type: TowerType.IMPERATOR_GUARD, tier: 5, source: 'relic' });
  });

  it('adds life-sacrifice hero and epic item relics', () => {
    const agricolaState = bootstrapState();
    agricolaState.lives = 40;
    applyCampaignRelic(agricolaState, 'AGRICOLA_LEVY');
    expect(agricolaState.lives).toBe(11);
    expect(agricolaState.pendingPurchasedTowers).toEqual([
      { type: TowerType.CHAMPION_AGRICOLA, tier: 2, source: 'relic' }
    ]);

    const epicState = bootstrapState();
    epicState.lives = 30;
    applyCampaignRelic(epicState, 'VESTAL_ORPHANS');
    expect(epicState.lives).toBe(20);
    expect((epicState as any).__pendingRelicItemRarities).toEqual(['EPIC']);

    const doubleState = bootstrapState();
    doubleState.lives = 17;
    expect(applyCampaignRelic(doubleState, 'DOUBLE_EPIC_FUNERAL')).toBe(true);
    expect(doubleState.lives).toBe(1);
    expect((doubleState as any).__pendingRelicItemRarities).toEqual(['EPIC', 'EPIC']);
  });

  it('blocks life-sacrifice relics when the player cannot survive the cost', () => {
    const agricolaState = bootstrapState();
    agricolaState.lives = 29;
    const affordability = campaignRelicAffordability(agricolaState, 'AGRICOLA_LEVY');
    expect(affordability.canAfford).toBe(false);
    expect(affordability.lifeCost).toBe(29);
    expect(affordability.reason).toContain('30 lives');
    expect(applyCampaignRelic(agricolaState, 'AGRICOLA_LEVY')).toBe(false);
    expect(agricolaState.lives).toBe(29);
    expect(agricolaState.pendingPurchasedTowers ?? []).toHaveLength(0);
    expect(activeCampaignRelicIds(agricolaState)).toEqual([]);

    const exactSurvivalState = bootstrapState();
    exactSurvivalState.lives = 30;
    expect(campaignRelicAffordability(exactSurvivalState, 'AGRICOLA_LEVY').canAfford).toBe(true);
    expect(applyCampaignRelic(exactSurvivalState, 'AGRICOLA_LEVY')).toBe(true);
    expect(exactSurvivalState.lives).toBe(1);
    expect(exactSurvivalState.pendingPurchasedTowers).toEqual([
      { type: TowerType.CHAMPION_AGRICOLA, tier: 2, source: 'relic' }
    ]);
  });

  it('adds gold-sacrifice epic and legendary item relics without going negative', () => {
    const shortAuctionState = bootstrapState();
    shortAuctionState.gold = 424;
    const affordability = campaignRelicAffordability(shortAuctionState, 'EPIC_AUCTION');
    expect(affordability.canAfford).toBe(false);
    expect(affordability.reason).toContain('425 gold');
    expect(applyCampaignRelic(shortAuctionState, 'EPIC_AUCTION')).toBe(false);
    expect(shortAuctionState.gold).toBe(424);
    expect((shortAuctionState as any).__pendingRelicItemRarities).toBeUndefined();
    expect(activeCampaignRelicIds(shortAuctionState)).toEqual([]);

    const auctionState = bootstrapState();
    auctionState.gold = 600;
    expect(applyCampaignRelic(auctionState, 'EPIC_AUCTION')).toBe(true);
    expect(auctionState.gold).toBe(175);
    expect((auctionState as any).__pendingRelicItemRarities).toEqual(['EPIC']);

    const ransomState = bootstrapState();
    ransomState.gold = 650;
    expect(campaignRelicAffordability(ransomState, 'RELIQUARY_RANSOM').canAfford).toBe(true);
    expect(applyCampaignRelic(ransomState, 'RELIQUARY_RANSOM')).toBe(true);
    expect(ransomState.gold).toBe(0);
    expect((ransomState as any).__pendingRelicLegendary).toBe(true);
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

  it('queues boss trophy choices until the wave-end reward flow consumes them', () => {
    const s = bootstrapState();
    s.wave = 24;
    const boss = { isBoss: true, isScheduledBoss: true, type: 'ANUBIS_KING' };

    expect(queueBossTrophyOfferForWave(s, boss, 'Anubis King')).toBe(true);
    expect(s.pendingBossTrophyOffer).toEqual({ wave: 24, bossName: 'Anubis King' });
    expect(s.bossTrophyWavesClaimed).toContain(24);
    expect(shouldOfferBossTrophy(s, boss)).toBe(false);

    const pending = consumePendingBossTrophyOffer(s);
    expect(pending).toEqual({ wave: 24, bossName: 'Anubis King' });
    expect(s.pendingBossTrophyOffer).toBeNull();
  });

  it('drops pending boss trophy choices if the run dies before the wave ends', () => {
    const s = bootstrapState();
    s.wave = 24;
    expect(queueBossTrophyOfferForWave(s, { isBoss: true, isScheduledBoss: true, type: 'ANUBIS_KING' }, 'Anubis King')).toBe(true);

    s.lives = 0;
    s.gameOverAt = s.tick;
    expect(consumePendingBossTrophyOffer(s)).toBeNull();
    expect(s.pendingBossTrophyOffer).toBeNull();
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
  it('injects authored commander spawns into early, mid, and late campaign waves', () => {
    const expected: Record<number, string> = {
      8: 'SKY_PATHFINDER_COMMANDER',
      18: 'SKY_STANDARD_COMMANDER',
      21: 'PATHFINDER_COMMANDER',
      23: 'ANUBIS_PRIEST_COMMANDER',
      24: 'SKY_ANUBIS_COMMANDER',
      26: 'STANDARD_BEARER_COMMANDER',
      28: 'SKY_PATHFINDER_COMMANDER',
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

  it('adds small wave-scaled commander escorts to every authored boss wave', () => {
    const expectedEscortSize: Record<number, number> = {
      5: 2,
      10: 3,
      20: 4,
      21: 4,
      24: 5,
      30: 6
    };
    for (const [waveText, expectedCount] of Object.entries(expectedEscortSize)) {
      const s = bootstrapState();
      s.phase = GamePhase.BUILD_PHASE;
      s.wave = Number(waveText) - 1;
      startWave(s);
      const commanders = s.spawnQueue.filter(q => isCommanderType(q.type as any));
      const mainGateCommanders = commanders.filter(q => !q.caveB);
      const caveBGroundCommanders = commanders.filter(q => q.caveB);
      expect(mainGateCommanders.length, `W${waveText} main-gate commander escort size`).toBe(expectedCount);
      expect(bossEscortCommandersForWave(Number(waveText)).length).toBe(expectedCount);
      if (Number(waveText) >= 21) {
        for (const commander of mainGateCommanders) {
          const def = (enemiesData as any)[commander.type] ?? {};
          if (def.isFlyer) continue;
          const mirrored = caveBGroundCommanders.filter(q => q.type === commander.type);
          const mainSameType = mainGateCommanders.filter(q => q.type === commander.type);
          expect(mirrored.length, `W${waveText} ${commander.type} mirrored commander`).toBe(mainSameType.length);
        }
      } else {
        expect(caveBGroundCommanders.length, `W${waveText} should not use Cave B escorts`).toBe(0);
      }
    }
  });

  it('keeps the W5 boss escort subtle and tagged as escort-only pressure', () => {
    const s = bootstrapState();
    s.phase = GamePhase.BUILD_PHASE;
    s.wave = 4;
    startWave(s);
    const escort = s.spawnQueue.filter(q => q.bossEscort);
    expect(escort.map(q => q.type)).toEqual(['PATHFINDER_COMMANDER', 'STANDARD_BEARER_COMMANDER']);
    tickSpawns(s, 5);
    const spawnedEscort = Array.from(s.enemies.values()).filter(e => (e as any).__bossEscortCommander);
    expect(spawnedEscort.length).toBe(2);
    expect(spawnedEscort.every(e => (e as any).isCommander && !e.isBoss)).toBe(true);
    const wave5BasicHpMult = effectiveWaveHpMult(5, 5, false) * lateGameLayerMult(5, false, false);
    for (const e of spawnedEscort) {
      const def: any = (enemiesData as any)[e.type];
      const unreducedHp = def.baseHp * wave5BasicHpMult * 1.7;
      expect(e.maxHp, e.type).toBeCloseTo(unreducedHp * 0.9, 4);
      expect(e.hp, e.type).toBeCloseTo(e.maxHp, 4);
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

  it('flying commanders specialize in flyer support', () => {
    const s = bootstrapState();
    const skyStandard: any = { id: 'ss', type: EnemyType.SKY_STANDARD_COMMANDER, hp: 100, x: 100, y: 100 };
    const skyPathfinder: any = { id: 'sp', type: EnemyType.SKY_PATHFINDER_COMMANDER, hp: 100, x: 130, y: 100 };
    s.enemies.set(skyStandard.id, skyStandard);
    s.enemies.set(skyPathfinder.id, skyPathfinder);

    expect(isCommanderType(EnemyType.SKY_ANUBIS_COMMANDER)).toBe(true);
    expect(commanderDamageTakenMult(s, { type: EnemyType.SPHINX, hp: 100, isBoss: false, isFlyer: true, x: 120, y: 100 })).toBeCloseTo(0.82, 4);
    expect(commanderDamageTakenMult(s, { type: EnemyType.MONGOL_FOOTMAN, hp: 100, isBoss: false, x: 120, y: 100 })).toBeCloseTo(0.92, 4);
    expect(commanderSpeedMult(s, { type: EnemyType.SPHINX, hp: 100, isFlyer: true })).toBeCloseTo(1.08, 4);
    expect(commanderSpeedMult(s, { type: EnemyType.MONGOL_FOOTMAN, hp: 100, isFlyer: false })).toBeCloseTo(1, 4);
  });
});
