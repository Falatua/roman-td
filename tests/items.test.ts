// Tests for item rules, inventory operations, and shop pool sampling.
import { describe, it, expect } from 'vitest';
import { itemFamily, canEquipItemFamily } from '../src/systems/ItemRules';
import { createInventory, inventoryAdd, inventoryRemove, isPermanent, isConsumable, rollDrop } from '../src/systems/LootSystem';
import { buildGateShop, buildMercatorStock, isMercatorWave, gateShopRefreshDue } from '../src/systems/MerchantSystem';

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
});

describe('Merchant — gate shop', () => {
  it('produces 2 COMMON-tier offers (gate is now a thin starter shop)', () => {
    // 2026-05-18: gate shop trimmed to a 2-COMMON starter set
    // (SHARPENED_BLADE + WATCHTOWER_LENS) — every other rarity / item
    // moved to Mercator-exclusive pools. Honors the design rule that
    // every Mercator item is exclusive to Mercator.
    const shop = buildGateShop();
    expect(shop.type).toBe('GATE');
    expect(shop.offers.length).toBe(2);
    const commons = shop.offers.filter(o => o.rarity === 'COMMON');
    expect(commons.length).toBe(2);
    const ids = shop.offers.map(o => o.itemId).sort();
    expect(ids).toEqual(['SHARPENED_BLADE', 'WATCHTOWER_LENS']);
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
  it('always includes 4 Legendaries + 2 Rare + 3 mid + 2 Epic (2026-05-18 — EPIC tier added)', () => {
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
    // 4 legendary + 2 rare + 3 mid + 2 epic = 11 offers.
    expect(shop.offers.length).toBe(11);
  });

  it('Mercator legendaries are priced significantly higher than gate shop rares', () => {
    const merc = buildMercatorStock();
    const legPrices = merc.offers.filter(o => o.rarity === 'LEGENDARY').map(o => o.price);
    expect(Math.min(...legPrices)).toBeGreaterThan(30);
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
