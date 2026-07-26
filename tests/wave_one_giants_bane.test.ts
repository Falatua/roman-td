import { describe, expect, it } from 'vitest';
import { createGameState } from '../src/GameState';
import { INVENTORY_SIZE } from '../src/constants';
import { inventorySellPrice } from '../src/render/ShopUI';
import {
  autoPickupOnBuildPhase,
  createInventory,
  grantWave18DracoStandard,
  grantWave22WitchsBrew,
  grantWaveOneGiantsBane,
  inventoryAdd,
  inventoryRemove
} from '../src/systems/LootSystem';

describe("Wave 1 Giant's Bane gift", () => {
  it('grants exactly one half-value Legendary after Wave 1', () => {
    const state = createGameState();
    const inv = createInventory();
    state.wave = 0;
    expect(grantWaveOneGiantsBane(state, inv)).toBe('none');

    state.wave = 1;
    expect(grantWaveOneGiantsBane(state, inv)).toBe('inventory');
    expect(inv.slots).toHaveLength(1);
    expect(inv.slots[0]).toMatchObject({
      itemId: 'GIANTS_BANE',
      rarity: 'LEGENDARY'
    });
    expect(inv.slots[0].sellLockedReason).toBeUndefined();
    expect(inventorySellPrice(inv.slots[0])).toBe(407);
    expect(grantWaveOneGiantsBane(state, inv)).toBe('none');
  });

  it("keeps later Giant's Bane copies at the same half-value rule", () => {
    const inv = createInventory();
    inventoryAdd(inv, 'GIANTS_BANE', 'LEGENDARY', false);
    expect(inv.slots[0].sellLockedReason).toBeUndefined();
    expect(inventorySellPrice(inv.slots[0])).toBe(407);
  });

  it('preserves the half-value gift through a full-inventory loot orb', () => {
    const state = createGameState();
    state.wave = 1;
    const inv = createInventory();
    for (let i = 0; i < INVENTORY_SIZE; i++) inventoryAdd(inv, 'SHARPENED_BLADE', 'COMMON');

    expect(grantWaveOneGiantsBane(state, inv)).toBe('loot_orb');
    expect(state.lootOrbs[0]).toMatchObject({
      itemId: 'GIANTS_BANE'
    });

    inventoryRemove(inv, inv.slots[0].id);
    expect(autoPickupOnBuildPhase(state, inv)).toBe(1);
    const gift = inv.slots.find(slot => slot.itemId === 'GIANTS_BANE');
    expect(gift?.sellLockedReason).toBeUndefined();
    expect(inventorySellPrice(gift)).toBe(407);
  });

  it('limits purchases, enemy drops, and free gifts to half of their applicable cost', () => {
    expect(inventorySellPrice({ itemId: 'DRACO_STANDARD', rarity: 'LEGENDARY' })).toBe(407);
    expect(inventorySellPrice({ itemId: 'WITCHS_BREW', rarity: 'LEGENDARY' })).toBe(407);
    expect(inventorySellPrice({ itemId: 'DRACO_STANDARD', rarity: 'LEGENDARY', buyPrice: 733 })).toBe(366);
    expect(inventorySellPrice({ itemId: 'GIANTS_BANE', rarity: 'LEGENDARY', sellLockedReason: 'legacy gift metadata' })).toBe(407);
  });
});

describe('Wave 18 Draco Standard gift', () => {
  it('grants exactly one sellable-at-half Legendary after Wave 18', () => {
    const state = createGameState();
    const inv = createInventory();
    state.wave = 17;
    expect(grantWave18DracoStandard(state, inv)).toBe('none');

    state.wave = 18;
    expect(grantWave18DracoStandard(state, inv)).toBe('inventory');
    expect(inv.slots).toHaveLength(1);
    expect(inv.slots[0]).toMatchObject({
      itemId: 'DRACO_STANDARD',
      rarity: 'LEGENDARY',
      isConsumable: false
    });
    expect(inventorySellPrice(inv.slots[0])).toBe(407);
    expect(grantWave18DracoStandard(state, inv)).toBe('none');
  });

  it('waits as a loot orb when inventory is full and skips sandbox or endless', () => {
    const state = createGameState();
    state.wave = 18;
    const inv = createInventory();
    for (let i = 0; i < INVENTORY_SIZE; i++) inventoryAdd(inv, 'SHARPENED_BLADE', 'COMMON');
    expect(grantWave18DracoStandard(state, inv)).toBe('loot_orb');
    expect(state.lootOrbs[0]).toMatchObject({
      itemId: 'DRACO_STANDARD',
      rarity: 'LEGENDARY'
    });

    const sandboxState = createGameState();
    sandboxState.wave = 18;
    sandboxState.sandboxMode = true;
    expect(grantWave18DracoStandard(sandboxState, createInventory())).toBe('none');

    const endlessState = createGameState();
    endlessState.wave = 18;
    endlessState.endlessMode = true;
    expect(grantWave18DracoStandard(endlessState, createInventory())).toBe('none');
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
    expect(inventorySellPrice(inv.slots[0])).toBe(407);
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
