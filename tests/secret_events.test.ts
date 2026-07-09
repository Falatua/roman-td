import { describe, expect, it } from 'vitest';
import { createGameState } from '../src/GameState';
import { GamePhase, TowerType } from '../src/types';
import {
  buildMercatorBackRoomOffers,
  claimMercatorBackRoomOffer,
  declineMercatorBackRoom,
  markMercatorBackRoomOffered,
  recordMercatorBackRoomPurchase,
  shouldOfferMercatorBackRoom
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
    expect(tower.towerType).not.toBe(TowerType.VELITES);
    expect(tower.towerType).not.toBe(TowerType.SCORPIO);
  });

  it('claims a discounted T5 tower through the normal placement queue', () => {
    const s = createGameState();
    s.gold = 500;
    s.mercatorBackRoomOffers = [{
      id: 'armory-chit-t5',
      kind: 'TOWER',
      title: 'Legate T5',
      eyebrow: 'STAMPED ARMORY CHIT',
      description: 'test',
      price: 225,
      towerType: TowerType.LEGATE,
      tier: 5
    }];
    const result = claimMercatorBackRoomOffer(s, 'armory-chit-t5');
    expect(result.ok).toBe(true);
    expect(s.gold).toBe(275);
    expect(s.mercatorBackRoomClaimed).toBe(true);
    expect(s.pendingPurchasedTowers).toEqual([{ type: TowerType.LEGATE, tier: 5, source: 'backroom' }]);
    expect(claimMercatorBackRoomOffer(s, 'armory-chit-t5').ok).toBe(false);
  });

  it('defensively clamps legacy hidden T5 Scorpio and Velites offers to Tier 4', () => {
    const s = createGameState();
    s.gold = 500;
    s.mercatorBackRoomOffers = [{
      id: 'armory-chit-t5',
      kind: 'TOWER',
      title: 'Legacy Scorpio T5',
      eyebrow: 'STAMPED ARMORY CHIT',
      description: 'test',
      price: 225,
      towerType: TowerType.SCORPIO,
      tier: 5
    }];
    const result = claimMercatorBackRoomOffer(s, 'armory-chit-t5');
    expect(result.ok).toBe(true);
    expect(s.pendingPurchasedTowers).toEqual([{ type: TowerType.SCORPIO, tier: 4, source: 'backroom' }]);
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

  it('claims a support cache without selling traps or ramparts', () => {
    const s = createGameState();
    s.lives = 10;
    s.gold = 500;
    s.mercatorBackRoomOffers = [{
      id: 'vestal-ration-chits',
      kind: 'SUPPLIES',
      title: 'Vestal Ration Chits',
      eyebrow: 'SEALED MERCY TOKENS',
      description: 'test',
      price: 160,
      lifeBonus: 3
    }];
    const result = claimMercatorBackRoomOffer(s, 'vestal-ration-chits');
    expect(result.ok).toBe(true);
    expect(s.gold).toBe(340);
    expect(s.lives).toBe(13);
    expect(Object.keys(s.trapInventory ?? {})).toHaveLength(0);
    expect(s.rampartsOwned ?? 0).toBe(0);
  });

  it('does not build Back Room offers with trap or rampart payloads', () => {
    const s = createGameState();
    const offers = buildMercatorBackRoomOffers(s);
    for (const offer of offers) {
      expect((offer as any).trapBundle, `${offer.id} should not sell traps through Mercator Back Room`).toBeUndefined();
      expect((offer as any).ramparts, `${offer.id} should not sell Stone Ramparts through Mercator Back Room`).toBeUndefined();
    }
  });
});
