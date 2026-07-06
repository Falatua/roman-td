import { describe, expect, it, beforeEach } from 'vitest';
import {
  getPinnedRecipes,
  MAX_PINNED_RECIPES,
  setPinnedRecipes,
  togglePinnedRecipe
} from '../src/render/PinnedRecipe';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  clear() {
    this.values.clear();
  }
}

describe('pinned recipe tracker', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: new MemoryStorage(),
      configurable: true
    });
  });

  it('allows three pinned recipes before replacing the oldest', () => {
    expect(MAX_PINNED_RECIPES).toBe(3);

    togglePinnedRecipe('SCORPION_BOLT');
    togglePinnedRecipe('HORSEMAN');
    togglePinnedRecipe('PLAGUE_CART');
    expect(getPinnedRecipes()).toEqual(['SCORPION_BOLT', 'HORSEMAN', 'PLAGUE_CART']);

    togglePinnedRecipe('AERARIUM');
    expect(getPinnedRecipes()).toEqual(['HORSEMAN', 'PLAGUE_CART', 'AERARIUM']);
  });

  it('dedupes and caps saved recipes at three', () => {
    setPinnedRecipes(['SCORPION_BOLT', 'HORSEMAN', 'SCORPION_BOLT', 'PLAGUE_CART', 'AERARIUM']);
    expect(getPinnedRecipes()).toEqual(['SCORPION_BOLT', 'HORSEMAN', 'PLAGUE_CART']);
  });
});
