import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createGameState } from '../src/GameState';
import { INVENTORY_SIZE } from '../src/constants';
import { inventorySellPrice } from '../src/render/ShopUI';
import {
  autoPickupOnBuildPhase,
  createInventory,
  grantWaveOneGiantsBane,
  inventoryAdd,
  inventoryRemove,
  WAVE_ONE_GIANTS_BANE_GIFT_REASON
} from '../src/systems/LootSystem';

describe("Wave 1 Giant's Bane ceremonial gift", () => {
  it('grants exactly one unsellable instance after Wave 1', () => {
    const state = createGameState();
    const inv = createInventory();
    state.wave = 0;
    expect(grantWaveOneGiantsBane(state, inv)).toBe('none');

    state.wave = 1;
    expect(grantWaveOneGiantsBane(state, inv)).toBe('inventory');
    expect(inv.slots).toHaveLength(1);
    expect(inv.slots[0]).toMatchObject({
      itemId: 'GIANTS_BANE',
      rarity: 'LEGENDARY',
      sellLockedReason: WAVE_ONE_GIANTS_BANE_GIFT_REASON
    });
    expect(inventorySellPrice(inv.slots[0])).toBe(0);
    expect(grantWaveOneGiantsBane(state, inv)).toBe('none');
  });

  it("keeps later Giant's Bane copies normally sellable", () => {
    const inv = createInventory();
    inventoryAdd(inv, 'GIANTS_BANE', 'LEGENDARY', false);
    expect(inv.slots[0].sellLockedReason).toBeUndefined();
    expect(inventorySellPrice(inv.slots[0])).toBe(407);
  });

  it('preserves the instance sale lock through a full-inventory loot orb', () => {
    const state = createGameState();
    state.wave = 1;
    const inv = createInventory();
    for (let i = 0; i < INVENTORY_SIZE; i++) inventoryAdd(inv, 'SHARPENED_BLADE', 'COMMON');

    expect(grantWaveOneGiantsBane(state, inv)).toBe('loot_orb');
    expect(state.lootOrbs[0]).toMatchObject({
      itemId: 'GIANTS_BANE',
      sellLockedReason: WAVE_ONE_GIANTS_BANE_GIFT_REASON
    });

    inventoryRemove(inv, inv.slots[0].id);
    expect(autoPickupOnBuildPhase(state, inv)).toBe(1);
    const gift = inv.slots.find(slot => slot.itemId === 'GIANTS_BANE');
    expect(gift?.sellLockedReason).toBe(WAVE_ONE_GIANTS_BANE_GIFT_REASON);
    expect(inventorySellPrice(gift)).toBe(0);
  });

  it('renders an explicit disabled sale state and carries the lock through tower returns', () => {
    const shopSource = readFileSync('src/render/ShopUI.ts', 'utf8');
    const towerSource = readFileSync('src/render/TowerMenu.ts', 'utf8');
    expect(shopSource).toContain('NOT FOR SALE');
    expect(shopSource).toContain('CEREMONIAL GIFT');
    expect(towerSource).toContain('__itemSellLockById');
    expect(towerSource).toContain('sellLockedReason');
  });
});
