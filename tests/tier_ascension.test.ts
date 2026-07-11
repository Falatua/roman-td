import { describe, expect, it } from 'vitest';
import { createGameState } from '../src/GameState';
import { INVENTORY_SIZE } from '../src/constants';
import { createInventory, grantFirstFlyerApotheosis, inventoryAdd, rollApotheosisLuckyDrop, APOTHEOSIS_LUCKY_DROP_CHANCE } from '../src/systems/LootSystem';
import { applyEagleOfApotheosis, canApplyEagleOfApotheosis } from '../src/systems/TierAscensionSystem';
import { createTower } from '../src/systems/TowerSystem';
import { TowerType } from '../src/types';

describe('Eagle of Apotheosis', () => {
  it('consumes no equipment slot and immediately raises an eligible kept tower to Tier V', () => {
    const tower = createTower(TowerType.MILITES, 1, 4, 4, 1, false);
    tower.equippedItems.push('SHARPENED_BLADE');
    expect(applyEagleOfApotheosis(tower).ok).toBe(true);
    expect(tower.qualityTier).toBe(5);
    expect(tower.equippedItems).toEqual(['SHARPENED_BLADE']);
  });

  it('rejects pending prospects, heroes, existing Tier V towers, and Tier-IV-capped lines', () => {
    const pending = createTower(TowerType.MILITES, 1, 1, 1, 1, true);
    expect(canApplyEagleOfApotheosis(pending).ok).toBe(false);

    const hero = createTower(TowerType.HERO_MARIUS, 1, 1, 1, 1, false);
    hero.isHero = true;
    expect(canApplyEagleOfApotheosis(hero).ok).toBe(false);

    const apex = createTower(TowerType.MILITES, 5, 1, 1, 1, false);
    expect(canApplyEagleOfApotheosis(apex).ok).toBe(false);

    const capped = createTower(TowerType.SCORPIO, 4, 1, 1, 1, false);
    expect(canApplyEagleOfApotheosis(capped).ok).toBe(false);
    expect(capped.qualityTier).toBe(4);
  });

  it('guarantees exactly one after the first authored Flyer wave', () => {
    const state = createGameState();
    state.wave = 6;
    const inv = createInventory();
    expect(grantFirstFlyerApotheosis(state, inv, false)).toBe('none');
    expect(grantFirstFlyerApotheosis(state, inv, true)).toBe('inventory');
    expect(inv.slots).toHaveLength(1);
    expect(inv.slots[0]).toMatchObject({ itemId: 'EAGLE_OF_APOTHEOSIS', rarity: 'LEGENDARY', isConsumable: true });
    expect(grantFirstFlyerApotheosis(state, inv, true)).toBe('none');
    expect(inv.slots).toHaveLength(1);
  });

  it('preserves the guaranteed reward as a loot orb when inventory is full', () => {
    const state = createGameState();
    state.wave = 6;
    const inv = createInventory();
    for (let i = 0; i < INVENTORY_SIZE; i++) inventoryAdd(inv, 'SHARPENED_BLADE', 'COMMON');
    expect(grantFirstFlyerApotheosis(state, inv, true)).toBe('loot_orb');
    expect(state.lootOrbs).toHaveLength(1);
    expect(state.lootOrbs[0]).toMatchObject({ itemId: 'EAGLE_OF_APOTHEOSIS', rarity: 'LEGENDARY' });
  });

  it('allows exceptionally rare later drops but never duplicates an owned copy', () => {
    const state = createGameState();
    state.wave = 7;
    state.firstFlyerApotheosisGranted = true;
    const inv = createInventory();
    expect(APOTHEOSIS_LUCKY_DROP_CHANCE).toBe(0.00015);
    expect(rollApotheosisLuckyDrop(state, inv, 0)).toEqual({ itemId: 'EAGLE_OF_APOTHEOSIS', rarity: 'LEGENDARY' });
    expect(rollApotheosisLuckyDrop(state, inv, APOTHEOSIS_LUCKY_DROP_CHANCE)).toBeNull();
    inventoryAdd(inv, 'EAGLE_OF_APOTHEOSIS', 'LEGENDARY', true);
    expect(rollApotheosisLuckyDrop(state, inv, 0)).toBeNull();
  });
});
