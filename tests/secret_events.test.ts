import { describe, expect, it } from 'vitest';
import { createGameState } from '../src/GameState';
import { GamePhase, TowerType } from '../src/types';
import { earnGold } from '../src/systems/EconomySystem';
import {
  acceptSenateBailout,
  applySenateBailoutTax,
  buildMercatorBackRoomOffers,
  claimMercatorBackRoomOffer,
  declineMercatorBackRoom,
  finishSenateBailoutTaxWave,
  markMercatorBackRoomOffered,
  markSenateBailoutOffered,
  recordMercatorBackRoomPurchase,
  SENATE_BAILOUT_GOLD,
  SENATE_BAILOUT_TAX_WAVES,
  shouldOfferMercatorBackRoom,
  shouldOfferSenateBailout
} from '../src/systems/SecretEventsSystem';
import towersData from '../src/data/towers.json';
import itemsData from '../src/data/items_permanent.json';

describe('Mercator Back Room hidden event', () => {
  it('unlocks from repeat Mercator purchases only during a live pre-wave run', () => {
    const s = createGameState();
    s.phase = GamePhase.BUILD_PHASE;
    s.wave = 9;
    s.gold = 1000;

    expect(shouldOfferMercatorBackRoom(s)).toBe(false);
    recordMercatorBackRoomPurchase(s, 250);
    recordMercatorBackRoomPurchase(s, 250);
    expect(shouldOfferMercatorBackRoom(s)).toBe(false);
    recordMercatorBackRoomPurchase(s, 250);
    expect(shouldOfferMercatorBackRoom(s)).toBe(true);

    s.phase = GamePhase.WAVE_PHASE;
    expect(shouldOfferMercatorBackRoom(s)).toBe(false);
    s.phase = GamePhase.BUILD_PHASE;
    s.gameOverAt = s.tick;
    expect(shouldOfferMercatorBackRoom(s)).toBe(false);
  });

  it('is one-shot once offered, declined, or claimed', () => {
    const s = createGameState();
    s.wave = 9;
    s.gold = 1000;
    recordMercatorBackRoomPurchase(s, 1500);
    expect(shouldOfferMercatorBackRoom(s)).toBe(true);
    markMercatorBackRoomOffered(s);
    expect(shouldOfferMercatorBackRoom(s)).toBe(false);

    const declined = createGameState();
    declined.wave = 9;
    recordMercatorBackRoomPurchase(declined, 1500);
    declineMercatorBackRoom(declined);
    expect(shouldOfferMercatorBackRoom(declined)).toBe(false);
  });

  it('builds three thematic offers with real item/tower targets', () => {
    const s = createGameState();
    const offers = buildMercatorBackRoomOffers(s);
    expect(offers).toHaveLength(3);
    expect(offers.map(o => o.kind).sort()).toEqual(['ITEM', 'SUPPLIES', 'TOWER']);
    const item = offers.find(o => o.kind === 'ITEM')!;
    const tower = offers.find(o => o.kind === 'TOWER')!;
    expect((itemsData as any)[item.itemId!]?.rarity).toBe('LEGENDARY');
    expect((towersData as any)[tower.towerType!]?.kind ?? 'BASE').toBe('BASE');
    expect(tower.tier).toBe(5);
  });

  it('claims a discounted T5 tower through the normal placement queue', () => {
    const s = createGameState();
    s.gold = 500;
    s.mercatorBackRoomOffers = [{
      id: 'armory-chit-t5',
      kind: 'TOWER',
      title: 'Scorpio T5',
      eyebrow: 'STAMPED ARMORY CHIT',
      description: 'test',
      price: 125,
      towerType: TowerType.SCORPIO,
      tier: 5
    }];
    const result = claimMercatorBackRoomOffer(s, 'armory-chit-t5');
    expect(result.ok).toBe(true);
    expect(s.gold).toBe(375);
    expect(s.mercatorBackRoomClaimed).toBe(true);
    expect(s.pendingPurchasedTowers).toEqual([{ type: TowerType.SCORPIO, tier: 5, source: 'backroom' }]);
    expect(claimMercatorBackRoomOffer(s, 'armory-chit-t5').ok).toBe(false);
  });

  it('does not charge gold for a secret item when inventory is full', () => {
    const s = createGameState();
    s.gold = 500;
    s.mercatorBackRoomOffers = [{
      id: 'under-table-legendary',
      kind: 'ITEM',
      title: 'Jupiter',
      eyebrow: 'UNDER-TABLE LEGENDARY',
      description: 'test',
      price: 300,
      itemId: 'JUPITERS_WRATH',
      rarity: 'LEGENDARY'
    }];
    const result = claimMercatorBackRoomOffer(s, 'under-table-legendary', {
      addItem: () => false
    });
    expect(result).toEqual({ ok: false, reason: 'inventory_full' });
    expect(s.gold).toBe(500);
    expect(s.mercatorBackRoomClaimed).toBeFalsy();
  });
});

describe('Senate Bailout hidden event', () => {
  it('offers only to low-gold, low-life live campaign runs after early game', () => {
    const s = createGameState();
    s.phase = GamePhase.BUILD_PHASE;
    s.wave = 8;
    s.gold = 100;
    s.lives = 7;
    expect(shouldOfferSenateBailout(s)).toBe(true);

    s.gold = 101;
    expect(shouldOfferSenateBailout(s)).toBe(false);
    s.gold = 100;
    s.lives = 8;
    expect(shouldOfferSenateBailout(s)).toBe(false);
    s.lives = 7;
    s.wave = 7;
    expect(shouldOfferSenateBailout(s)).toBe(false);
  });

  it('accepts gold immediately and starts a three-wave tax', () => {
    const s = createGameState();
    s.wave = 10;
    s.gold = 20;
    s.lives = 5;
    markSenateBailoutOffered(s);
    const ok = acceptSenateBailout(s);
    expect(ok).toBe(true);
    expect(s.gold).toBe(20 + SENATE_BAILOUT_GOLD);
    expect(s.senateBailoutClaimed).toBe(true);
    expect(s.senateBailoutTaxWavesRemaining).toBe(SENATE_BAILOUT_TAX_WAVES);
  });

  it('taxes only taxable income and tracks gold skimmed', () => {
    const s = createGameState();
    s.gold = 0;
    s.senateBailoutTaxWavesRemaining = 3;
    const taxed = applySenateBailoutTax(s, 100);
    expect(taxed).toEqual({ net: 70, tax: 30 });
    expect(s.senateBailoutTaxGoldLost).toBe(30);

    earnGold(s, 100);
    expect(s.gold).toBe(100);
    earnGold(s, 100, { taxable: true });
    expect(s.gold).toBe(170);
    expect(s.senateBailoutTaxGoldLost).toBe(60);
  });

  it('counts down after cleared campaign waves and blocks repeat offers', () => {
    const s = createGameState();
    s.wave = 9;
    s.gold = 10;
    s.lives = 4;
    expect(shouldOfferSenateBailout(s)).toBe(true);
    markSenateBailoutOffered(s);
    acceptSenateBailout(s);
    expect(shouldOfferSenateBailout(s)).toBe(false);
    expect(finishSenateBailoutTaxWave(s)).toBe(2);
    expect(finishSenateBailoutTaxWave(s)).toBe(1);
    expect(finishSenateBailoutTaxWave(s)).toBe(0);
    expect(finishSenateBailoutTaxWave(s)).toBe(0);
    expect(shouldOfferSenateBailout(s)).toBe(false);
  });
});
