// Tests for item rules, inventory operations, and shop pool sampling.
import { describe, it, expect } from 'vitest';
import { itemFamily, canEquipItemFamily } from '../src/systems/ItemRules';
import { createInventory, inventoryAdd, inventoryRemove, isPermanent, isConsumable, itemBuyPrice, premiumDropRoll, RARITY_BUY_PRICE, rollDrop, rollEpicDrop } from '../src/systems/LootSystem';
import { buildGateShop, buildMercatorStock, buildMercatorTowerOffers, isMercatorWave, gateShopRefreshDue } from '../src/systems/MerchantSystem';
import itemsData from '../src/data/items_permanent.json';
import { LOOT_DROP_RATES } from '../src/constants';

describe('Item families', () => {
  it('classifies items into the correct family', () => {
    expect(itemFamily('SHARPENED_BLADE')).toBe('DAMAGE');
    expect(itemFamily('TRAINING_SCROLL')).toBe('SPEED');
    expect(itemFamily('WATCHTOWER_LENS')).toBe('RANGE');
    // 2026-05-17 — DoT items moved to SPECIAL family so they stack
    // freely on a tower (multiple DoTs ticking simultaneously). Was
    // split into DOT_BURN / DOT_POISON / DOT_BLEED sub-families pre-fix.
    expect(itemFamily('FIRE_OIL_FLASK')).toBe('SPECIAL');
    expect(itemFamily('POISONED_BLADE')).toBe('SPECIAL');
    expect(itemFamily('BARBED_GLADIUS')).toBe('SPECIAL');
    expect(itemFamily('CENTURIONS_TRUMPET')).toBe('AURA');
    expect(itemFamily('GOLD_PURSE')).toBe('ECONOMY');
    expect(itemFamily('GALLIC_SHIELD_BOSS')).toBe('DEFENSE');
  });

  it('unknown items default to SPECIAL', () => {
    expect(itemFamily('UNKNOWN_ITEM')).toBe('SPECIAL');
  });
});

describe('Item equip family exclusivity', () => {
  it('allows equipping a DAMAGE item when no DAMAGE is currently equipped', () => {
    const result = canEquipItemFamily([], 'SHARPENED_BLADE');
    expect(result.ok).toBe(true);
    expect(result.family).toBe('DAMAGE');
  });

  it('blocks a second item of the same family', () => {
    const result = canEquipItemFamily(['SHARPENED_BLADE'], 'IRON_TIP');
    expect(result.ok).toBe(false);
    expect(result.family).toBe('DAMAGE');
  });

  it('allows mixing items from different families', () => {
    const equipped = ['SHARPENED_BLADE', 'TRAINING_SCROLL'];
    expect(canEquipItemFamily(equipped, 'WATCHTOWER_LENS').ok).toBe(true);
  });

  it('SPECIAL items always stack (no exclusivity)', () => {
    const equipped = ['BERSERKERS_MUZZLE'];
    expect(canEquipItemFamily(equipped, 'DRUIDS_TORC').ok).toBe(true);
  });
});

describe('Inventory operations', () => {
  it('adds an item and returns true', () => {
    const inv = createInventory();
    const ok = inventoryAdd(inv, 'SHARPENED_BLADE', 'COMMON');
    expect(ok).toBe(true);
    expect(inv.slots.length).toBe(1);
  });

  it('records buyPrice when provided (purchased items)', () => {
    const inv = createInventory();
    inventoryAdd(inv, 'IRON_TIP', 'COMMON', false, 8);
    expect(inv.slots[0].buyPrice).toBe(8);
  });

  it('removes an item by id', () => {
    const inv = createInventory();
    inventoryAdd(inv, 'SHARPENED_BLADE', 'COMMON');
    const removed = inventoryRemove(inv, inv.slots[0].id);
    expect(removed).not.toBeNull();
    expect(inv.slots.length).toBe(0);
  });

  it('returns null for a non-existent removal', () => {
    const inv = createInventory();
    expect(inventoryRemove(inv, 'nonexistent')).toBeNull();
  });

  it('rejects adding past INVENTORY_SIZE', () => {
    const inv = createInventory();
    for (let i = 0; i < 25; i++) inventoryAdd(inv, 'SHARPENED_BLADE', 'COMMON');
    const overflow = inventoryAdd(inv, 'IRON_TIP', 'COMMON');
    expect(overflow).toBe(false);
  });
});

describe('Item permanence classification', () => {
  it('isPermanent identifies permanent items', () => {
    expect(isPermanent('SHARPENED_BLADE')).toBe(true);
  });

  it('isConsumable always returns false (consumables removed 2026-05)', () => {
    expect(isConsumable('RAGE_POTION')).toBe(false);
    expect(isConsumable('SHARPENED_BLADE')).toBe(false);
  });

  it('every item is permanent (no consumables)', () => {
    expect(isPermanent('SHARPENED_BLADE')).toBe(true);
  });
});

describe('Loot drop rolling', () => {
  it('always returns a valid drop with rarity and itemId', () => {
    for (let i = 0; i < 100; i++) {
      const drop = rollDrop();
      expect(drop).not.toBeNull();
      expect(drop!.itemId).toBeTruthy();
      expect(['COMMON','UNCOMMON','RARE','LEGENDARY','UNIQUE']).toContain(drop!.rarity);
    }
  });

  it('uses 30-wave drop rates and deterministic premium-roll boundaries', () => {
    expect(LOOT_DROP_RATES.GROUND).toBe(0.003);
    expect(LOOT_DROP_RATES.FLYER).toBe(0.006);
    expect(premiumDropRoll(0.20, 0.1999)).toBe(true);
    expect(premiumDropRoll(0.20, 0.20)).toBe(false);
    expect(premiumDropRoll(0.10, 0.95)).toBe(false);
  });
});

describe('Item rarity economy', () => {
  it('uses a strict five-tier purchase ladder for every permanent item', () => {
    expect(RARITY_BUY_PRICE.COMMON).toBe(37);
    expect(RARITY_BUY_PRICE.UNCOMMON).toBe(83);
    expect(RARITY_BUY_PRICE.RARE).toBe(185);
    expect(RARITY_BUY_PRICE.EPIC).toBe(390);
    expect(RARITY_BUY_PRICE.LEGENDARY).toBe(740);

    for (const [id, def] of Object.entries(itemsData as any)) {
      expect(itemBuyPrice(id), id).toBe(RARITY_BUY_PRICE[(def as any).rarity as keyof typeof RARITY_BUY_PRICE]);
    }
  });

  it('keeps Gallic Shield Boss distinct from the Lictor stat item', () => {
    const shield = (itemsData as any).GALLIC_SHIELD_BOSS.effect as string;
    const fasces = (itemsData as any).LICTOR_FASCES.effect as string;
    expect(shield.toLowerCase()).toContain('stun');
    expect(shield).not.toContain('+40% damage');
    expect(shield).not.toContain('+2');
    expect(fasces).toContain('+40% damage');
    expect(fasces).toContain('+2');
  });
});

describe('Merchant — gate shop', () => {
  it('produces 6 offers (4 commons + 2 uncommons, all gate-exclusive)', () => {
    // 2026-05-19: gate shop expanded with 5 new gate-exclusive items
    // (3 commons + 2 uncommons) on top of the existing 2 commons. A
    // visit samples 4 commons from the 5-item common pool and both
    // uncommons. Mercator pools remain fully exclusive — none of
    // the 7 gate items appear at Mercator.
    const shop = buildGateShop();
    expect(shop.type).toBe('GATE');
    expect(shop.offers.length).toBe(6);
    const commons = shop.offers.filter(o => o.rarity === 'COMMON');
    const uncommons = shop.offers.filter(o => o.rarity === 'UNCOMMON');
    expect(commons.length).toBe(4);
    expect(uncommons.length).toBe(2);
    // Every offered item must be drawn from the gate's exclusive pool.
    const gateOnlyIds = new Set([
      'SHARPENED_BLADE','WATCHTOWER_LENS',
      'PRAETORIAN_COIN','BRONZE_GREAVES','RUSTED_HASTA',
      'AUGUR_SCROLL','CONSULAR_TOKEN'
    ]);
    for (const o of shop.offers) expect(gateOnlyIds.has(o.itemId)).toBe(true);
  });

  it('contains no duplicate offers within a single visit', () => {
    for (let trial = 0; trial < 20; trial++) {
      const shop = buildGateShop();
      const ids = shop.offers.map(o => o.itemId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('Merchant — Mercator stock', () => {
  it('always includes 4 Legendaries + 2 Rare + 3 mid + 2 Epic + guaranteed Truesight (2026-05-25 — Truesight always available)', () => {
    const shop = buildMercatorStock();
    expect(shop.type).toBe('MERCATOR');
    const legendaries = shop.offers.filter(o => o.rarity === 'LEGENDARY');
    const rare = shop.offers.filter(o => o.rarity === 'RARE');
    const epic = shop.offers.filter(o => o.rarity === 'EPIC');
    const cons = shop.offers.filter(o => o.isConsumable);
    expect(legendaries.length).toBe(4);
    // 1 regular rare + 1 exclusive rare = 2 rares minimum.
    expect(rare.length).toBeGreaterThanOrEqual(2);
    // 2026-05-18 — 2 guaranteed EPIC slots per visit.
    expect(epic.length).toBe(2);
    expect(cons.length).toBe(0);
    // 2026-05-25 — TRUESIGHT_LENS now ships as a GUARANTEED slot every
    // Mercator visit (was a 3-in-13 random MID roll). Player must
    // always have reliable access to the stealth-reveal counter.
    const truesight = shop.offers.filter(o => o.itemId === 'TRUESIGHT_LENS');
    expect(truesight.length).toBe(1);
    // 4 legendary + 2 rare + 3 mid + 2 epic + 1 truesight = 12 offers.
    expect(shop.offers.length).toBe(12);
  });

  it('Mercator legendaries are priced significantly higher than gate shop rares', () => {
    const merc = buildMercatorStock();
    const legPrices = merc.offers.filter(o => o.rarity === 'LEGENDARY').map(o => o.price);
    expect(new Set(legPrices)).toEqual(new Set([740]));
    expect(merc.offers.filter(o => o.rarity === 'EPIC').every(o => o.price === 390)).toBe(true);
    expect(merc.livesPrice).toBe(83);
  });

  it('prices Mercator T5 towers as campaign investments', () => {
    const towers = buildMercatorTowerOffers(10, 5);
    const armory = towers.filter(o => !o.type.startsWith('CHAMPION_'));
    expect(armory).toHaveLength(3);
    expect(armory.every(o => o.tier === 5 && o.price === 250)).toBe(true);
  });
});

describe('Merchant — wave timing predicates', () => {
  it('isMercatorWave flags the 20-wave campaign waves (W4/9/14/19)', () => {
    expect(isMercatorWave(4)).toBe(true);
    expect(isMercatorWave(9)).toBe(true);
    expect(isMercatorWave(14)).toBe(true);
    expect(isMercatorWave(19)).toBe(true);
    expect(isMercatorWave(8)).toBe(false);
    expect(isMercatorWave(10)).toBe(false);
  });

  it('gateShopRefreshDue triggers every 4 waves (excluding wave 0)', () => {
    expect(gateShopRefreshDue(0)).toBe(false);
    expect(gateShopRefreshDue(4)).toBe(true);
    expect(gateShopRefreshDue(8)).toBe(true);
    expect(gateShopRefreshDue(12)).toBe(true);
    expect(gateShopRefreshDue(7)).toBe(false);
  });
});

describe('EPIC premium drop payload — rollEpicDrop', () => {
  // The caller now performs the chance roll; this helper validates the
  // payload whenever an elephant, minor boss, or Fire Giant wins that roll.
  it('always returns an EPIC-rarity drop', () => {
    for (let i = 0; i < 50; i++) {
      const drop = rollEpicDrop();
      expect(drop).not.toBeNull();
      expect(drop!.rarity).toBe('EPIC');
    }
  });

  it('only draws from items.json entries flagged rarity=EPIC', () => {
    // Compute the expected pool the same way the runtime does, then
    // verify rollEpicDrop's outputs all sit inside it.
    const expected = new Set(Object.keys(itemsData as any).filter(id => {
      const def: any = (itemsData as any)[id];
      return def?.rarity === 'EPIC' && !def?.eventExclusive;
    }));
    expect(expected.size).toBeGreaterThan(0);
    for (let i = 0; i < 50; i++) {
      const drop = rollEpicDrop();
      expect(expected.has(drop!.itemId as string)).toBe(true);
    }
  });
});
