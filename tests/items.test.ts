// Tests for item rules, inventory operations, and shop pool sampling.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { APOTHEOSIS_ITEM_RANDOM_WEIGHT, AURA_ITEM_RANDOM_WEIGHT, OCEAN_SPECIALIST_ITEM_RANDOM_WEIGHT, DOT_ITEM_RANDOM_WEIGHT, itemFamily, canEquipItemFamily, isAuraItem, isOceanSpecialistItem, isDotItem, itemRandomSelectionWeight, itemEquipMode } from '../src/systems/ItemRules';
import { createTower, towerEffectiveStats } from '../src/systems/TowerSystem';
import { TowerType } from '../src/types';
import { createInventory, grantSoloStartingItems, inventoryAdd, inventoryRemove, isPermanent, isConsumable, itemBuyPrice, premiumDropRoll, RARITY_BUY_PRICE, rollDrop, rollRareDrop, rollEpicDrop, PREMIUM_NON_BOSS_DROP_CHANCES, premiumNonBossDropChance, rollPremiumNonBossDrop, itemLootPoolCoverage, oceanSpecialistDropChance, rollOceanSpecialistDrop, LEGENDARY_DROP_ITEM_POOL, SOLO_STARTING_ITEM_LOADOUT } from '../src/systems/LootSystem';
import { buildGateShop, buildMercatorStock, buildMercatorTowerOffers, isMercatorWave, gateShopRefreshDue, MERCATOR_LEGENDARY } from '../src/systems/MerchantSystem';
import itemsData from '../src/data/items_permanent.json';
import towersData from '../src/data/towers.json';
import { LOOT_DROP_RATES } from '../src/constants';

function itemAssetMap(): Record<string, string> {
  const source = readFileSync(path.join(process.cwd(), 'src/render/Assets.ts'), 'utf8');
  const out: Record<string, string> = {};
  for (const match of source.matchAll(/\b(ITEM_[A-Z0-9_]+)\s*:\s*'([^']+)'/g)) {
    out[match[1].replace(/^ITEM_/, '')] = match[2];
  }
  return out;
}

describe('Item families', () => {
  it('classifies items into the correct family', () => {
    expect(itemFamily('SHARPENED_BLADE')).toBe('DAMAGE');
    expect(itemFamily('TRAINING_SCROLL')).toBe('SPEED');
    expect(itemFamily('WATCHTOWER_LENS')).toBe('RANGE');
    expect(itemFamily('FIRE_OIL_FLASK')).toBe('DOT_BURN');
    expect(itemFamily('POISONED_BLADE')).toBe('DOT_POISON');
    expect(itemFamily('BARBED_GLADIUS')).toBe('DOT_BLEED');
    expect(itemFamily('CENTURIONS_TRUMPET')).toBe('AURA');
    expect(itemFamily('GOLD_PURSE')).toBe('ECONOMY');
    expect(itemFamily('GALLIC_SHIELD_BOSS')).toBe('UTILITY');
    expect(itemFamily('CAPITOLINE_AEGIS')).toBe('SPECIAL');
    expect(itemFamily('BRINEHOOK_ROPE')).toBe('DAMAGE');
    expect(itemFamily('TIDEPIERCER_HARPOON')).toBe('DAMAGE');
    expect(itemFamily('AEGEAN_PEARL')).toBe('DAMAGE');
    expect(itemFamily('STORMGLASS_AMPHORA')).toBe('DAMAGE');
    expect(itemFamily('NEPTUNES_TRIDENT')).toBe('DAMAGE');
    expect(itemFamily('GIANTS_BANE')).toBe('SPECIAL');
    expect(itemFamily('WITCHS_BREW')).toBe('SPECIAL');
    expect(itemFamily('CENSER_OF_MEFITIS')).toBe('SPECIAL');
  });

  it('unknown items default to SPECIAL', () => {
    expect(itemFamily('UNKNOWN_ITEM')).toBe('SPECIAL');
  });
});

describe('Mefitis awakening relic availability', () => {
  it('is a randomized legendary drop and Mercator offering', () => {
    expect(LEGENDARY_DROP_ITEM_POOL).toContain('CENSER_OF_MEFITIS');
    expect(MERCATOR_LEGENDARY).toContain('CENSER_OF_MEFITIS');
    expect(itemBuyPrice('CENSER_OF_MEFITIS')).toBe(RARITY_BUY_PRICE.LEGENDARY);
  });
});

describe('Legendary mystery copy', () => {
  const awakeningClues: Record<string, string> = {
    GIANTS_BANE: 'Milites or Cohort Guard',
    WITCHS_BREW: 'Murmillo',
    CENSER_OF_MEFITIS: 'Plague Lobber',
    DAMNATIO_MEMORIAE: 'Praetorian Executioner',
    SIGIL_OF_SOL_INVICTUS: 'War Chariot',
    STORM_AQUILA_TALONS: 'Beastlord Champion'
  };

  it('keeps awakening clues concise, mysterious, and mechanically useful', () => {
    for (const [id, sourceTower] of Object.entries(awakeningClues)) {
      const effect = String((itemsData as any)[id].effect);
      expect(effect.trim().split(/\s+/).length, id).toBeLessThanOrEqual(45);
      expect(effect, id).toContain(sourceTower);
      expect(effect, id).toMatch(/Tier IV|Tier V/);
      expect(effect, id).toMatch(/remain(s)? bound/);
    }
  });

  it('keeps the one-use Apotheosis legend readable at a glance', () => {
    const effect = String((itemsData as any).EAGLE_OF_APOTHEOSIS.effect);
    expect(effect.trim().split(/\s+/).length).toBeLessThanOrEqual(45);
    expect(effect).toContain('ONE USE');
    expect(effect).toContain('Tier V');
    expect(effect).toContain('without taking an item slot');
  });
});

describe('Item icon assets', () => {
  it('maps every current item to a transparent PNG icon', async () => {
    const sharp = (await import('sharp')).default;
    const assets = itemAssetMap();

    for (const id of Object.keys(itemsData as any)) {
      const file = assets[id];
      expect(file, `${id} item icon mapping`).toBeTruthy();
      const fullPath = path.join(process.cwd(), 'public/assets/sprites', file);
      expect(existsSync(fullPath), `${id} -> ${file}`).toBe(true);
    }

    const uniqueFiles = [...new Set(Object.keys(itemsData as any).map(id => assets[id]))];
    for (const file of uniqueFiles) {
      const fullPath = path.join(process.cwd(), 'public/assets/sprites', file);
      const meta = await sharp(fullPath).metadata();
      const { data, info } = await sharp(fullPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const corners = [
        data[3],
        data[((info.width - 1) * 4) + 3],
        data[(((info.height - 1) * info.width) * 4) + 3],
        data[(((info.height * info.width) - 1) * 4) + 3]
      ];

      let visible = 0;
      let edgeVisible = 0;
      let edgePixels = 0;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const alpha = data[((y * info.width + x) * 4) + 3];
          if (alpha > 8) visible++;
          if (x === 0 || y === 0 || x === info.width - 1 || y === info.height - 1) {
            edgePixels++;
            if (alpha > 8) edgeVisible++;
          }
        }
      }

      const transparentPct = 1 - visible / (info.width * info.height);
      const edgeVisiblePct = edgeVisible / edgePixels;
      expect(meta.hasAlpha, `${file} should have alpha`).toBe(true);
      expect(Math.max(...corners), `${file} transparent corners`).toBeLessThanOrEqual(8);
      expect(transparentPct, `${file} should not be a filled square`).toBeGreaterThan(0.08);
      expect(edgeVisiblePct, `${file} should not press into the inventory frame`).toBeLessThan(0.35);
    }
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

  it('blocks a second SPECIAL item on the same tower', () => {
    const equipped = ['BERSERKERS_MUZZLE'];
    expect(canEquipItemFamily(equipped, 'JUPITERS_WRATH').ok).toBe(true);
    expect(canEquipItemFamily(['CAPITOLINE_AEGIS'], 'JUPITERS_WRATH').ok).toBe(false);
  });

  it('keeps Burn, Poison, and Bleed as separate status families instead of SPECIAL', () => {
    expect(canEquipItemFamily(['FIRE_OIL_FLASK'], 'VESTAL_PYRE').ok).toBe(false);
    expect(canEquipItemFamily(['POISONED_BLADE'], 'WITCHS_VENOM').ok).toBe(false);
    expect(canEquipItemFamily(['BARBED_GLADIUS'], 'FALCATA_BLADE').ok).toBe(false);
    expect(canEquipItemFamily(['FIRE_OIL_FLASK'], 'POISONED_BLADE').ok).toBe(true);
    expect(canEquipItemFamily(['FIRE_OIL_FLASK'], 'GIANTS_BANE').ok).toBe(true);
  });

  it('keeps Legendary SPECIAL as a curated rule-breaking lane, not the default legendary bucket', () => {
    const legendaryIds = Object.keys(itemsData as any).filter(id => (itemsData as any)[id]?.rarity === 'LEGENDARY');
    const specialLegendaryIds = legendaryIds.filter(id => itemFamily(id as any) === 'SPECIAL');
    const nonSpecialFamilies = new Set(legendaryIds.map(id => itemFamily(id as any)).filter(f => f !== 'SPECIAL'));

    expect(specialLegendaryIds).toEqual(expect.arrayContaining([
      'GIANTS_BANE',
      'WITCHS_BREW',
      'CAPITOLINE_AEGIS',
      'JUPITERS_WRATH',
      'EXECUTIONERS_FALX',
      'CONCUSSIVE_WARHEAD',
      'DAMNATIO_MEMORIAE'
    ]));
    expect(specialLegendaryIds.length).toBeLessThan(legendaryIds.length / 2);
    expect([...nonSpecialFamilies]).toEqual(expect.arrayContaining(['DAMAGE', 'AURA', 'SPEED', 'RANGE', 'ECONOMY', 'DEFENSE']));
  });
});

describe('Inventory operations', () => {
  it('starts a fresh Solo run with Sharpened Blade and both existing starter items', () => {
    const inv = createInventory();
    const granted = grantSoloStartingItems(inv);
    expect(granted).toBe(3);
    expect(inv.slots.map(slot => [slot.itemId, slot.rarity, slot.isConsumable])).toEqual([
      ['CAVALRY_SPUR', 'UNCOMMON', false],
      ['BARBED_GLADIUS', 'COMMON', false],
      ['SHARPENED_BLADE', 'COMMON', false]
    ]);
    expect(SOLO_STARTING_ITEM_LOADOUT).toHaveLength(3);
  });

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

  it('recognizes the one-use Apotheosis relic without treating normal gear as consumable', () => {
    expect(isConsumable('RAGE_POTION')).toBe(false);
    expect(isConsumable('SHARPENED_BLADE')).toBe(false);
    expect(isConsumable('EAGLE_OF_APOTHEOSIS')).toBe(true);
  });

  it('every item is permanent (no consumables)', () => {
    expect(isPermanent('SHARPENED_BLADE')).toBe(true);
  });
});

describe('Loot drop rolling', () => {
  it('downweights aura-family items in random drops and shop rolls while keeping them possible', () => {
    expect(AURA_ITEM_RANDOM_WEIGHT).toBe(0.10);
    for (const id of ['CENTURIONS_TRUMPET', 'BATTLE_STANDARD', 'AQUILIFER_BANNER', 'WAR_HOUND_COLLAR', 'DRUIDS_TORC', 'OPTIO_WHISTLE', 'BARCA_WAR_HORN', 'CURSED_TORC', 'LICH_GENERALS_SEAL']) {
      expect(isAuraItem(id), id).toBe(true);
      expect(itemRandomSelectionWeight(id), id).toBe(AURA_ITEM_RANDOM_WEIGHT);
    }
    for (const id of ['SHARPENED_BLADE', 'LICTOR_FASCES', 'SKYPIERCER_BOLTS', 'JUPITERS_SKYFIRE']) {
      expect(isAuraItem(id), id).toBe(false);
      expect(itemRandomSelectionWeight(id), id).toBe(1);
    }
    // 2026-07-11 — DoT items are rarer finds in random drops and shop rolls.
    // Explicit list (not the SPECIAL family); event-exclusive DoT rewards
    // (Soulfire Brand, Inferno Standard) are untouched since they never
    // enter ordinary pools.
    expect(DOT_ITEM_RANDOM_WEIGHT).toBe(0.40);
    for (const id of ['BARBED_GLADIUS', 'FIRE_OIL_FLASK', 'POISONED_BLADE', 'VESTAL_PYRE', 'VENOM_TIPPED_ARROWS', 'SERPENT_AMULET', 'WITCHS_VENOM', 'ALPHA_PACK_FANG', 'FALCATA_BLADE']) {
      expect(isDotItem(id), id).toBe(true);
      expect(itemRandomSelectionWeight(id), id).toBe(DOT_ITEM_RANDOM_WEIGHT);
    }
    for (const id of ['SOULFIRE_BRAND', 'INFERNO_STANDARD', 'SHARPENED_BLADE', 'EXECUTIONERS_FALX', 'CONCUSSIVE_WARHEAD']) {
      expect(isDotItem(id), id).toBe(false);
    }
    expect(OCEAN_SPECIALIST_ITEM_RANDOM_WEIGHT).toBe(0.62);
    for (const id of ['BRINEHOOK_ROPE', 'TIDEPIERCER_HARPOON', 'AEGEAN_PEARL', 'STORMGLASS_AMPHORA', 'NEPTUNES_TRIDENT']) {
      expect(isOceanSpecialistItem(id), id).toBe(true);
      expect(itemRandomSelectionWeight(id), id).toBe(OCEAN_SPECIALIST_ITEM_RANDOM_WEIGHT);
    }
  });

  it('always returns a valid drop with rarity and itemId', () => {
    for (let i = 0; i < 100; i++) {
      const drop = rollDrop();
      expect(drop).not.toBeNull();
      expect(drop!.itemId).toBeTruthy();
      expect(['COMMON','UNCOMMON','RARE','EPIC','LEGENDARY','UNIQUE']).toContain(drop!.rarity);
      expect((itemsData as any)[drop!.itemId]?.rarity).toBe(drop!.rarity);
    }
  });

  it('makes Rare drops more visible and allows very rare Epic ordinary drops', () => {
    const randomSpy = vi.spyOn(Math, 'random');
    randomSpy.mockReturnValue(0.965);
    expect(rollDrop()?.rarity).toBe('RARE');
    // 2026-07-03 — epic boundary moved 0.99 → 0.9925 (rare band widened).
    randomSpy.mockReturnValue(0.992);
    expect(rollDrop()?.rarity).toBe('RARE');
    randomSpy.mockReturnValue(0.995);
    expect(rollDrop()?.rarity).toBe('EPIC');
    randomSpy.mockRestore();
  });

  it('uses 30-wave drop rates and deterministic premium-roll boundaries', () => {
    // 2026-07-08 — ordinary random floor loot is quieter after ocean and
    // late-wave enemy-count additions. Guaranteed boss/commander/event drops
    // stay governed by their own reward rules.
    expect(LOOT_DROP_RATES.GROUND).toBe(0.0015);
    expect(LOOT_DROP_RATES.FLYER).toBe(0.003);
    expect(premiumDropRoll(0.20, 0.1999)).toBe(true);
    expect(premiumDropRoll(0.20, 0.20)).toBe(false);
    expect(premiumDropRoll(0.10, 0.95)).toBe(false);
  });

  it('lets meaningful ocean enemies rarely drop anti-water specialist gear', () => {
    expect(oceanSpecialistDropChance({ type: 'OCEAN_FISHLING' })).toBe(0);
    expect(oceanSpecialistDropChance({ type: 'OCEAN_GHOST_SPIRIT' })).toBe(0);
    expect(oceanSpecialistDropChance({ type: 'SEA_GIANT' })).toBe(0.18);
    expect(oceanSpecialistDropChance({ type: 'SEA_GIANT_WARBRINGER' })).toBe(0.38);
    expect(oceanSpecialistDropChance({ type: 'TIDECALLER_COMMANDER' })).toBe(0.45);
    expect(oceanSpecialistDropChance({ type: 'STORMTIDE_WYVERN_COMMANDER' })).toBe(0.45);

    const randomSpy = vi.spyOn(Math, 'random');
    try {
      randomSpy.mockReturnValue(0.99);
      const rare = rollOceanSpecialistDrop({ type: 'SEA_GIANT' });
      expect(rare?.rarity).toBe('RARE');
      expect(['BRINEHOOK_ROPE', 'TIDEPIERCER_HARPOON']).toContain(rare?.itemId);

      randomSpy.mockReturnValue(0.01);
      const epic = rollOceanSpecialistDrop({ type: 'SEA_GIANT_WARBRINGER' });
      expect(epic?.rarity).toBe('EPIC');
      expect(['AEGEAN_PEARL', 'STORMGLASS_AMPHORA']).toContain(epic?.itemId);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('uses every non-event item in the correct ordinary rarity pool', () => {
    const coverage = itemLootPoolCoverage();
    for (const rarity of ['COMMON', 'UNCOMMON', 'RARE', 'EPIC'] as const) {
      const expected = Object.keys(itemsData as any).filter(id => {
        const def: any = (itemsData as any)[id];
        return def?.rarity === rarity && !def?.eventExclusive;
      }).sort();
      const actual = [...coverage.ordinary[rarity]].sort();
      expect(actual, `${rarity} ordinary drop pool`).toEqual(expected);
      for (const id of actual) {
        expect((itemsData as any)[id]?.rarity, id).toBe(rarity);
      }
    }
  });

  it('uses every non-event legendary in the boss legendary randomization pool', () => {
    const coverage = itemLootPoolCoverage();
    const expected = Object.keys(itemsData as any).filter(id => {
      const def: any = (itemsData as any)[id];
      return def?.rarity === 'LEGENDARY' && !def?.eventExclusive;
    }).sort();
    expect([...coverage.legendary].sort()).toEqual(expected);
    expect(coverage.legendary).toContain('TYRANTS_LAUREL');
    expect(coverage.legendary).toContain('JUPITERS_SKYFIRE');
    expect(coverage.legendary).toContain('CONCUSSIVE_WARHEAD');
    expect(coverage.legendary).toContain('CAPITOLINE_AEGIS');
    expect(coverage.legendary).toContain('GIANTS_BANE');
    expect(coverage.legendary).toContain('WITCHS_BREW');
    expect(coverage.legendary).toContain('EAGLE_OF_APOTHEOSIS');
  });

  it('keeps event-exclusive items out of ordinary and boss RNG while still tracking them by event', () => {
    const coverage = itemLootPoolCoverage();
    const ordinaryAndBoss = new Set<string>([
      ...coverage.ordinary.COMMON,
      ...coverage.ordinary.UNCOMMON,
      ...coverage.ordinary.RARE,
      ...coverage.ordinary.EPIC,
      ...coverage.legendary
    ]);
    const eventExclusive = Object.keys(itemsData as any).filter(id => (itemsData as any)[id]?.eventExclusive);
    expect(eventExclusive.length).toBeGreaterThan(0);
    for (const id of eventExclusive) {
      expect(ordinaryAndBoss.has(id), id).toBe(false);
      const eventKind = (itemsData as any)[id].eventExclusive;
      expect(coverage.eventExclusive[eventKind]).toContain(id);
    }
  });

  it('guaranteed Rare drops use the full Rare data pool and return Rare payloads', () => {
    const expected = new Set(Object.keys(itemsData as any).filter(id => {
      const def: any = (itemsData as any)[id];
      return def?.rarity === 'RARE' && !def?.eventExclusive;
    }));
    expect(expected.size).toBeGreaterThan(0);
    for (let i = 0; i < 50; i++) {
      const drop = rollRareDrop();
      expect(drop).not.toBeNull();
      expect(drop!.rarity).toBe('RARE');
      expect(expected.has(drop!.itemId as string)).toBe(true);
    }
  });
});

describe('Item rarity economy', () => {
  it('uses a strict five-tier purchase ladder for every permanent item', () => {
    expect(RARITY_BUY_PRICE.COMMON).toBe(37);
    expect(RARITY_BUY_PRICE.UNCOMMON).toBe(83);
    expect(RARITY_BUY_PRICE.RARE).toBe(185);
    expect(RARITY_BUY_PRICE.EPIC).toBe(429);
    expect(RARITY_BUY_PRICE.LEGENDARY).toBe(814);

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
  it('produces 9 offers (4 commons + 2 uncommons + 2 epics + 1 legendary)', () => {
    const shop = buildGateShop();
    expect(shop.type).toBe('GATE');
    expect(shop.offers.length).toBe(9);
    const commons = shop.offers.filter(o => o.rarity === 'COMMON');
    const uncommons = shop.offers.filter(o => o.rarity === 'UNCOMMON');
    const epics = shop.offers.filter(o => o.rarity === 'EPIC');
    const legendaries = shop.offers.filter(o => o.rarity === 'LEGENDARY');
    expect(commons.length).toBe(4);
    expect(uncommons.length).toBe(2);
    expect(epics.length).toBe(2);
    expect(legendaries.length).toBe(1);
    expect(MERCATOR_LEGENDARY).toContain(legendaries[0].itemId);
    expect((itemsData as any)[legendaries[0].itemId]?.eventExclusive).toBeUndefined();
    expect(legendaries[0].price).toBe(733);
    const gateIds = new Set([
      'SHARPENED_BLADE','WATCHTOWER_LENS',
      'PRAETORIAN_COIN','BRONZE_GREAVES','RUSTED_HASTA',
      'AUGUR_SCROLL','CONSULAR_TOKEN',
      'LICTOR_FASCES','AUXILIARY_SLING','OPTIO_WHISTLE',
      'SKYPIERCER_BOLTS','FALCONERS_WATCHPOST'
    ]);
    for (const o of shop.offers.filter(o => o.rarity !== 'LEGENDARY')) {
      expect(gateIds.has(o.itemId)).toBe(true);
    }
  });

  it('does not offer a legendary the player already owns', () => {
    const onlyAvailable = MERCATOR_LEGENDARY[0];
    const owned = new Set(MERCATOR_LEGENDARY.filter(id => id !== onlyAvailable));
    const shop = buildGateShop(0, owned);
    const legendaries = shop.offers.filter(o => o.rarity === 'LEGENDARY');
    expect(legendaries).toHaveLength(1);
    expect(legendaries[0].itemId).toBe(onlyAvailable);
  });

  it('omits the legendary shelf safely when every legal legendary is owned', () => {
    const shop = buildGateShop(0, new Set(MERCATOR_LEGENDARY));
    expect(shop.offers.filter(o => o.rarity === 'LEGENDARY')).toHaveLength(0);
    expect(shop.offers).toHaveLength(8);
  });

  it('contains no duplicate offers within a single visit', () => {
    for (let trial = 0; trial < 20; trial++) {
      const shop = buildGateShop();
      const ids = shop.offers.map(o => o.itemId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('rerolls the item lineup when refreshed', () => {
    const randomSpy = vi.spyOn(Math, 'random');
    try {
      randomSpy.mockReturnValue(0);
      const first = buildGateShop().offers.map(o => o.itemId).sort();
      randomSpy.mockReturnValue(0.999);
      const second = buildGateShop().offers.map(o => o.itemId).sort();
      expect(second).not.toEqual(first);
    } finally {
      randomSpy.mockRestore();
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
    expect(cons.every(o => o.itemId === 'EAGLE_OF_APOTHEOSIS')).toBe(true);
    expect(cons.length).toBeLessThanOrEqual(1);
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
    // Shop/Mercator item buys keep the 10% vendor discount on top of rarity prices.
    expect(new Set(legPrices)).toEqual(new Set([733]));
    expect(merc.offers.filter(o => o.rarity === 'EPIC').every(o => o.price === 386)).toBe(true);
    expect(merc.livesPrice).toBe(83);
  });

  it('can roll Neptune\'s Trident in Mercator legendary stock', () => {
    const randomSpy = vi.spyOn(Math, 'random');
    try {
      randomSpy.mockReturnValue(0.999);
      const merc = buildMercatorStock();
      expect(merc.offers.some(o => o.itemId === 'NEPTUNES_TRIDENT' && o.rarity === 'LEGENDARY')).toBe(true);
      expect(merc.offers.some(o => o.itemId === 'GIANTS_BANE' && o.rarity === 'LEGENDARY')).toBe(true);
      expect(merc.offers.some(o => o.itemId === 'WITCHS_BREW' && o.rarity === 'LEGENDARY')).toBe(true);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('keeps the Eagle of Apotheosis in Mercator\'s randomized Legendary pool', () => {
    expect(MERCATOR_LEGENDARY).toContain('EAGLE_OF_APOTHEOSIS');
    expect((itemsData as any).EAGLE_OF_APOTHEOSIS.rarity).toBe('LEGENDARY');
    expect(APOTHEOSIS_ITEM_RANDOM_WEIGHT).toBe(0.35);
    expect(itemRandomSelectionWeight('EAGLE_OF_APOTHEOSIS')).toBe(0.35);
  });

  it('rerolls Mercator item stock when each visit resets', () => {
    const randomSpy = vi.spyOn(Math, 'random');
    try {
      randomSpy.mockReturnValue(0);
      const first = buildMercatorStock().offers.map(o => o.itemId).sort();
      randomSpy.mockReturnValue(0.999);
      const second = buildMercatorStock().offers.map(o => o.itemId).sort();
      expect(second).not.toEqual(first);
      expect(first).toContain('TRUESIGHT_LENS');
      expect(second).toContain('TRUESIGHT_LENS');
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('prices Mercator T5 towers as campaign investments', () => {
    const armory = buildMercatorTowerOffers(10, 10);
    expect(armory).toHaveLength(10);
    expect(armory.every(o => o.tier === 5 && o.price === 325)).toBe(true);
    expect(new Set(armory.map(o => o.type)).size).toBe(10);
    expect(armory.every(o => (towersData as any)[o.type]?.kind === 'BASE')).toBe(true);
    expect(armory.every(o => !o.type.startsWith('CHAMPION_'))).toBe(true);
    expect(armory.map(o => o.type)).not.toContain('VELITES');
    expect(armory.map(o => o.type)).not.toContain('SCORPIO');
  });

  it('re-randomizes the T5 armory: excludeTypes bars last visit’s lineup', () => {
    // 2026-07-03 — consecutive Mercator visits must not repeat T5 towers.
    // main.ts passes the previous visit's randomized types as excludeTypes.
    const first = buildMercatorTowerOffers(9, 10).map(o => o.type);
    expect(first).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      const second = buildMercatorTowerOffers(14, 10, { excludeTypes: first }).map(o => o.type);
      expect(second).toHaveLength(10);
      for (const t of second) expect(first).not.toContain(t);
    }
  });
});

describe('Merchant — wave timing predicates', () => {
  it('isMercatorWave flags the 30-wave campaign visits', () => {
    for (const wave of [4, 9, 14, 19, 23, 27]) {
      expect(isMercatorWave(wave), `W${wave}`).toBe(true);
    }
    expect(isMercatorWave(8)).toBe(false);
    expect(isMercatorWave(10)).toBe(false);
    expect(isMercatorWave(24)).toBe(false);
  });

  it('gateShopRefreshDue triggers every 4 waves (excluding wave 0)', () => {
    expect(gateShopRefreshDue(0)).toBe(false);
    for (const wave of [4, 8, 12, 16, 20, 24, 28]) {
      expect(gateShopRefreshDue(wave), `W${wave}`).toBe(true);
    }
    expect(gateShopRefreshDue(7)).toBe(false);
    expect(gateShopRefreshDue(27)).toBe(false);
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

  it('keeps commanders and elites chance-based instead of guaranteed item drops', () => {
    expect(PREMIUM_NON_BOSS_DROP_CHANCES.COMMANDER).toBe(0.35);
    expect(PREMIUM_NON_BOSS_DROP_CHANCES.BOSS_ESCORT_COMMANDER).toBe(0.22);
    expect(PREMIUM_NON_BOSS_DROP_CHANCES.FIRE_GIANT).toBe(0.28);
    expect(PREMIUM_NON_BOSS_DROP_CHANCES.ELITE).toBe(0.22);
    expect(PREMIUM_NON_BOSS_DROP_CHANCES.ELITE_MUTATION).toBe(0.08);

    expect(premiumNonBossDropChance({ type: 'PATHFINDER_COMMANDER', isCommander: true, archetype: 'RUNNER' })).toBe(0.35);
    expect(premiumNonBossDropChance({ type: 'STANDARD_BEARER_COMMANDER', isCommander: true, __bossEscortCommander: true })).toBe(0.22);
    expect(premiumNonBossDropChance({ type: 'FIRE_GIANT' })).toBe(0.28);
    expect(premiumNonBossDropChance({ type: 'UNDEAD_GIANT', isElite: true })).toBe(0.22);
    expect(premiumNonBossDropChance({ type: 'FERAL_DOG', archetype: 'SWARM', mutation: 'VETERAN' })).toBe(0.08);
    expect(premiumNonBossDropChance({ type: 'GALLIC_DRUID', archetype: 'ELITE' })).toBe(0);
    expect(premiumNonBossDropChance({ type: 'FERAL_DOG', archetype: 'SWARM' })).toBe(0);
  });

  it('uses Rare/Epic payloads only after premium non-boss enemies win their chance roll', () => {
    const randomSpy = vi.spyOn(Math, 'random');
    try {
      randomSpy.mockReturnValue(0.99);
      expect(rollPremiumNonBossDrop({ type: 'PATHFINDER_COMMANDER', isCommander: true })?.rarity).toBe('RARE');
      expect(rollPremiumNonBossDrop({ type: 'FIRE_GIANT' })?.rarity).toBe('RARE');
      expect(rollPremiumNonBossDrop({ type: 'UNDEAD_GIANT', isElite: true })?.rarity).toBe('RARE');

      randomSpy.mockReturnValue(0.01);
      expect(rollPremiumNonBossDrop({ type: 'PATHFINDER_COMMANDER', isCommander: true })?.rarity).toBe('EPIC');
      expect(rollPremiumNonBossDrop({ type: 'FIRE_GIANT' })?.rarity).toBe('EPIC');
      expect(rollPremiumNonBossDrop({ type: 'UNDEAD_GIANT', isElite: true })?.rarity).toBe('EPIC');

      expect(rollPremiumNonBossDrop({ type: 'STANDARD_BEARER_COMMANDER', isCommander: true, __bossEscortCommander: true })?.rarity).toBe('RARE');
      expect(rollPremiumNonBossDrop({ type: 'GALLIC_DRUID', archetype: 'ELITE' })).toBeNull();
    } finally {
      randomSpy.mockRestore();
    }
  });
});

// ── 2026-07-09 item balance pass ─────────────────────────────────────────
// Pins the six changes that removed same-rarity duplicates, dominated
// items, and the Witch's Venom RARE > LEGENDARY DoT inversion. Each pin
// asserts the RUNTIME effect (not just JSON text) so a future retune has
// to touch these deliberately.
describe('2026-07-09 item balance pass', () => {
  const mkMelee = () => {
    const t = createTowerForItems(TowerType.MILITES);
    return t;
  };
  const mkRanged = () => createTowerForItems(TowerType.VELITES);

  function createTowerForItems(type: TowerType) {
    return createTower(type, 3, 10, 10, 0);
  }

  it("Augur's Scroll is a hybrid (+18% speed, +0.5 range), no longer a Mercury Feather clone", () => {
    const bare = mkRanged();
    const withScroll = mkRanged();
    withScroll.equippedItems.push('AUGUR_SCROLL');
    const a = towerEffectiveStats(bare);
    const b = towerEffectiveStats(withScroll);
    expect(b.attackSpeed / a.attackSpeed).toBeCloseTo(1.18, 6);
    expect(b.range - a.range).toBeCloseTo(0.5, 6);
    const withFeather = mkRanged();
    withFeather.equippedItems.push('MERCURY_FEATHER');
    const c = towerEffectiveStats(withFeather);
    expect(c.attackSpeed / a.attackSpeed).toBeCloseTo(1.25, 6);
    expect(c.range - a.range).toBeCloseTo(0, 6);
  });

  it('Rusted Hasta no longer grants a flat self damage multiplier (now +14% vs ground per-hit in CombatResolver)', () => {
    const bare = mkMelee();
    const withHasta = mkMelee();
    withHasta.equippedItems.push('RUSTED_HASTA');
    expect(towerEffectiveStats(withHasta).dps).toBeCloseTo(towerEffectiveStats(bare).dps, 6);
    expect((itemsData as any).RUSTED_HASTA.effect).toContain('GROUND');
  });

  it('Bronze Greaves is MELEE-only with +0.5 reach and +10% damage', () => {
    expect(itemEquipMode('BRONZE_GREAVES')).toBe('MELEE');
    const bare = mkMelee();
    const withGreaves = mkMelee();
    withGreaves.equippedItems.push('BRONZE_GREAVES');
    const a = towerEffectiveStats(bare);
    const b = towerEffectiveStats(withGreaves);
    expect(b.dps / a.dps).toBeCloseTo(1.10, 6);
    expect(b.range - a.range).toBeCloseTo(0.5, 6);
    expect((itemsData as any).BRONZE_GREAVES.effect).toContain('MELEE ONLY');
  });

  it("Witch's Venom applies 4% maxHP/sec poison (was 8%, which saturated the 7% aggregate cap alone)", () => {
    const source = readFileSync(path.join(process.cwd(), 'src/systems/CombatResolver.ts'), 'utf8');
    const m = source.match(/WITCHS_VENOM'\)\)\s+pushStatus\(target, StatusEffectKind\.POISON, 5, ([0-9.]+), tier\)/);
    expect(m, 'WITCHS_VENOM pushStatus call not found').toBeTruthy();
    expect(parseFloat(m![1])).toBeCloseTo(0.04, 6);
    expect((itemsData as any).WITCHS_VENOM.effect).toContain('4% maxHP/sec');
  });

  it('Elephant Tusk fires vs Elites as well as Bosses (no longer dominated by War Paint)', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/systems/CombatResolver.ts'), 'utf8');
    expect(source).toContain("(isBossEnemy(target) || isEliteEnemy(target)) && t.equippedItems.includes('ELEPHANT_TUSK')");
    expect((itemsData as any).ELEPHANT_TUSK.effect).toContain('Bosses and Elites');
  });

  it('War Hound Collar aura is a hybrid (+22% dmg, +18% speed), no longer an Optio Whistle clone', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/systems/CombatResolver.ts'), 'utf8');
    expect(source).toMatch(/WAR_HOUND_COLLAR'\) && !auraOff\) \{[\s\S]{0,600}?dmg: 0\.22, spd: 0\.18/);
    expect((itemsData as any).WAR_HOUND_COLLAR.effect).toContain('+22% damage and +18% attack speed');
  });
});
