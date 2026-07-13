import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
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

  it('allows four pinned recipes before replacing the oldest', () => {
    expect(MAX_PINNED_RECIPES).toBe(4);

    togglePinnedRecipe('SCORPION_BOLT');
    togglePinnedRecipe('HORSEMAN');
    togglePinnedRecipe('PLAGUE_CART');
    togglePinnedRecipe('AERARIUM');
    expect(getPinnedRecipes()).toEqual(['SCORPION_BOLT', 'HORSEMAN', 'PLAGUE_CART', 'AERARIUM']);

    togglePinnedRecipe('EAGLE_SCOUT');
    expect(getPinnedRecipes()).toEqual(['HORSEMAN', 'PLAGUE_CART', 'AERARIUM', 'EAGLE_SCOUT']);
  });

  it('dedupes and caps saved recipes at four', () => {
    setPinnedRecipes(['SCORPION_BOLT', 'HORSEMAN', 'SCORPION_BOLT', 'PLAGUE_CART', 'AERARIUM', 'EAGLE_SCOUT']);
    expect(getPinnedRecipes()).toEqual(['SCORPION_BOLT', 'HORSEMAN', 'PLAGUE_CART', 'AERARIUM']);
  });

  it('cannot resize the desktop battlefield when pins add sidebar overflow', () => {
    const html = readFileSync('index.html', 'utf8');
    const main = readFileSync('src/main.ts', 'utf8');

    expect(html).toContain('flex: 0 0 190px; width: 190px; min-width: 190px; max-width: 190px');
    expect(html).toContain('#right-panel > * { min-width: 0; max-width: 100%; }');
    expect(html).toContain('flex: 0 0 88px !important;');
    expect(html).toContain('width: 88px !important;');
    expect(main).toContain('const w = app.offsetWidth;');
    expect(main).toContain('const h = app.offsetHeight;');
    expect(main).not.toContain('const w = app.scrollWidth;');
    expect(main).not.toContain('const h = app.scrollHeight;');
  });
});
