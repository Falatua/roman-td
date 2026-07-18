import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createGameState } from '../src/GameState';
import { INVENTORY_SIZE } from '../src/constants';
import { inventorySellPrice } from '../src/render/ShopUI';
import {
  autoPickupOnBuildPhase,
  createInventory,
  grantWave22WitchsBrew,
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

describe("Wave 22 Witch's Brew gift", () => {
  it("grants exactly one Witch's Brew after Wave 22", () => {
    const state = createGameState();
    const inv = createInventory();
    state.wave = 21;
    expect(grantWave22WitchsBrew(state, inv)).toBe('none');

    state.wave = 22;
    expect(grantWave22WitchsBrew(state, inv)).toBe('inventory');
    expect(inv.slots).toHaveLength(1);
    expect(inv.slots[0]).toMatchObject({
      itemId: 'WITCHS_BREW',
      rarity: 'LEGENDARY',
      isConsumable: false
    });
    expect(grantWave22WitchsBrew(state, inv)).toBe('none');
    expect(inv.slots).toHaveLength(1);
  });

  it("preserves the Witch's Brew gift as a loot orb when inventory is full", () => {
    const state = createGameState();
    state.wave = 22;
    const inv = createInventory();
    for (let i = 0; i < INVENTORY_SIZE; i++) inventoryAdd(inv, 'SHARPENED_BLADE', 'COMMON');

    expect(grantWave22WitchsBrew(state, inv)).toBe('loot_orb');
    expect(state.lootOrbs).toHaveLength(1);
    expect(state.lootOrbs[0]).toMatchObject({
      itemId: 'WITCHS_BREW',
      rarity: 'LEGENDARY'
    });
  });

  it('does not grant in sandbox or endless modes', () => {
    const sandboxState = createGameState();
    sandboxState.wave = 22;
    sandboxState.sandboxMode = true;
    expect(grantWave22WitchsBrew(sandboxState, createInventory())).toBe('none');

    const endlessState = createGameState();
    endlessState.wave = 22;
    endlessState.endlessMode = true;
    expect(grantWave22WitchsBrew(endlessState, createInventory())).toBe('none');
  });
});
