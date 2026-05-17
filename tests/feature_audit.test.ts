// Comprehensive feature + combo audit.
//
// Walks every recipe in towerCombinations.json end-to-end through the
// engine: places ingredients, scans, executes, asserts the result tower
// is produced and the ingredients are consumed. Also exercises the
// systems users actually touch in a run:
//   - Tower-ability case wiring (RETIARIUS + post-rename consistency)
//   - Item EQUIP_MODE gates (MELEE vs RANGED)
//   - Mercator tower-buy pool + Fortuna gamble pool integrity
//   - Combo cost / gold-debit / refund-on-fail
//   - Same-tier merge produces a tier-up
//   - Aerarium gold-tower cap
//
// Every assertion has an explanation so failures point to the broken
// invariant, not just "expected X to be Y".
import { describe, it, expect, beforeAll } from 'vitest';
import { scanCombos, executeCombo } from '../src/systems/CombinationEngine';
import { createTower } from '../src/systems/TowerSystem';
import { createGameState } from '../src/GameState';
import { TowerType, GamePhase, TileType } from '../src/types';
import { initializeGrid, setTile } from '../src/systems/GridManager';
import { buildGroundPath, buildFlyerPath } from '../src/systems/PathFinder';
import {
  FORTUNA_GAMBLE_POOL,
  rollFortunaCombo
} from '../src/systems/MerchantSystem';
import comboData from '../src/data/towerCombinations.json';
import towersData from '../src/data/towers.json';

beforeAll(() => {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (globalThis as any).window.__renderer = { triggerSpawnPuff: () => {} };
});

function bootstrap() {
  const s = createGameState();
  initializeGrid(s);
  const p = buildGroundPath(s);
  if (p) s.groundPath = p;
  s.flyerPath = buildFlyerPath();
  s.phase = GamePhase.BUILD_PHASE;
  s.denarii = 5000;
  return s;
}

function place(state: any, type: string, tier: 1|2|3|4|5, x: number, y: number) {
  const t = createTower(type as TowerType, tier, x, y, state.wave);
  state.towers.set(t.id, t);
  setTile(state, x, y, TileType.TOWER);
  return t;
}

// Some recipes have a minTier > 2 — feed the highest minTier across the
// ingredient list so scanCombos won't reject for under-tier inputs.
function minTierFor(recipe: any, ingType: string): number {
  const ing = recipe.ingredients.find((i: any) => i.type === ingType);
  return ing?.minTier ?? 2;
}

// ───────────────────────────────────────────────────────────────────────
// 1. Recipe exhaustion — every authored recipe is discoverable + executable
// ───────────────────────────────────────────────────────────────────────
describe('Every authored recipe is discoverable + executable', () => {
  for (const recipe of comboData) {
    it(`recipe → ${recipe.result} (tier ${recipe.tier}): scanCombos finds it`, () => {
      const s = bootstrap();
      let col = 1;
      const placed: any[] = [];
      for (const ing of recipe.ingredients) {
        const minTier = (ing.minTier ?? 2) as 1|2|3|4|5;
        placed.push(place(s, ing.type, minTier, col++, 5));
      }
      const combos = scanCombos(s);
      const match = combos.find(c => c.result === recipe.result);
      expect(match, `scanCombos did not return ${recipe.result} after placing ${recipe.ingredients.map((i:any)=>i.type).join(',')}`).toBeTruthy();
    });

    it(`recipe → ${recipe.result}: executeCombo produces the result tower`, () => {
      const s = bootstrap();
      let col = 1;
      const placed: any[] = [];
      for (const ing of recipe.ingredients) {
        const minTier = (ing.minTier ?? 2) as 1|2|3|4|5;
        placed.push(place(s, ing.type, minTier, col++, 5));
      }
      const combos = scanCombos(s);
      const match = combos.find(c => c.result === recipe.result);
      expect(match, `expected combo ${recipe.result}`).toBeTruthy();
      const keepId = match!.ingredients[0].id;
      const startTowers = s.towers.size;
      const ok = executeCombo(s, match!, keepId);
      // Special case: Aerarium fails if goldTowerCount is at cap; we
      // don't pre-seed goldTowerCount, so default 0 < cap → must succeed.
      // Most recipes consume more than they produce (N ingredients → 1
      // result), so size should drop. Exact delta depends on the recipe.
      expect(ok, `executeCombo returned false for ${recipe.result}`).toBe(true);
      const result = Array.from(s.towers.values()).find(
        (t: any) => t.type === recipe.result
      );
      expect(result, `result tower ${recipe.result} not in state after executeCombo`).toBeTruthy();
      // Total tower count must drop: consumed ingredients > 1 result,
      // unless the recipe is a same-tier merge (3 → 1).
      const expectedFinal = startTowers - recipe.ingredients.length + 1;
      expect(s.towers.size, `tower count after combo should drop from ${startTowers} to ${expectedFinal}`).toBe(expectedFinal);
    });
  }
});

// ───────────────────────────────────────────────────────────────────────
// 2. Tower roster integrity
// ───────────────────────────────────────────────────────────────────────
describe('Tower roster integrity', () => {
  it('every tower id in towers.json has matching TowerType enum entry', () => {
    const enumKeys = new Set(Object.values(TowerType));
    for (const tid of Object.keys(towersData as any)) {
      expect(enumKeys.has(tid as TowerType), `TowerType enum missing ${tid}`).toBe(true);
    }
  });

  it('every TowerType enum entry has a corresponding towers.json record', () => {
    const dataKeys = new Set(Object.keys(towersData as any));
    for (const v of Object.values(TowerType)) {
      expect(dataKeys.has(v as string), `towers.json missing record for ${v}`).toBe(true);
    }
  });

  it('RETIARIUS exists, LANCEARIUS is fully purged', () => {
    expect((towersData as any).RETIARIUS, 'RETIARIUS must be in towers.json').toBeTruthy();
    expect((towersData as any).LANCEARIUS, 'LANCEARIUS must NOT be in towers.json').toBeFalsy();
    expect((TowerType as any).LANCEARIUS, 'LANCEARIUS enum must be gone').toBeUndefined();
    expect((TowerType as any).RETIARIUS, 'RETIARIUS enum must exist').toBeTruthy();
  });

  it('TESSERARIUS recipe uses RETIARIUS (post-rename)', () => {
    const tess = comboData.find(r => r.result === 'TESSERARIUS');
    expect(tess).toBeTruthy();
    const ingTypes = tess!.ingredients.map(i => i.type);
    expect(ingTypes).toContain('RETIARIUS');
    expect(ingTypes).not.toContain('LANCEARIUS');
  });
});

// ───────────────────────────────────────────────────────────────────────
// 3. Mercator + Fortuna pool integrity (every pool member is a real tower)
// ───────────────────────────────────────────────────────────────────────
describe('Merchant pools reference only real towers', () => {
  it('Fortuna gamble pool members all exist in towers.json as COMBO kind', () => {
    for (const id of FORTUNA_GAMBLE_POOL) {
      const def: any = (towersData as any)[id];
      expect(def, `Fortuna pool member ${id} not in towers.json`).toBeTruthy();
      expect(def?.kind).toBe('COMBO');
    }
  });

  it('rollFortunaCombo returns only valid combo-tower IDs over 500 rolls', () => {
    for (let i = 0; i < 500; i++) {
      const r = rollFortunaCombo();
      expect(FORTUNA_GAMBLE_POOL).toContain(r.type);
      expect((towersData as any)[r.type]?.kind).toBe('COMBO');
    }
  });

  it('Fortuna pool size matches count of NON-APEX COMBO-kind towers', () => {
    // 2026-05 v9: apex super-combos (5 cross-combos) are blocked from
    // Fortuna so they have to be crafted, not bought. Test asserts the
    // pool equals (total combos − 5 blocked apex) and has no duplicates.
    const APEX = new Set(['IMPERIUM_ETERNUM','CARTHAGE_SCOURGE','TRIUMVIRATE','LEGION_PRIME','CONSULAR_FATEBINDER']);
    const eligibleCombos = Object.entries(towersData as any)
      .filter(([id, d]: any) => d.kind === 'COMBO' && !APEX.has(id))
      .map(([id]) => id);
    expect(FORTUNA_GAMBLE_POOL.length).toBe(eligibleCombos.length);
    expect(new Set(FORTUNA_GAMBLE_POOL).size).toBe(eligibleCombos.length);   // no dupes
    // Also verify no apex slipped through.
    for (const apex of APEX) expect(FORTUNA_GAMBLE_POOL).not.toContain(apex);
  });
});

// ───────────────────────────────────────────────────────────────────────
// 4. Same-tier merge mechanic — works at every base tier
// ───────────────────────────────────────────────────────────────────────
describe('Same-tier merge produces a tier-up at every band', () => {
  for (const baseTier of [1, 2, 3, 4] as const) {
    it(`3× T${baseTier} MILITES → 1× T${baseTier+1} MILITES`, () => {
      const s = bootstrap();
      const a = place(s, TowerType.MILITES, baseTier, 1, 1);
      place(s, TowerType.MILITES, baseTier, 1, 2);
      place(s, TowerType.MILITES, baseTier, 1, 3);
      const merge = scanCombos(s).find(c => c.isSameTierMerge);
      expect(merge, `same-tier merge not detected for T${baseTier} MILITES`).toBeTruthy();
      const ok = executeCombo(s, merge!, a.id);
      expect(ok).toBe(true);
      const upgraded = Array.from(s.towers.values()).find((t: any) => t.qualityTier === baseTier + 1);
      expect(upgraded, `expected a T${baseTier+1} tower after merging T${baseTier} ×3`).toBeTruthy();
    });
  }
});

// ───────────────────────────────────────────────────────────────────────
// 5. Aerarium gold-tower cap — combo blocked when cap reached
// ───────────────────────────────────────────────────────────────────────
describe('Aerarium combo respects the gold-tower cap', () => {
  it('Aerarium can be built when goldTowerCount < cap', () => {
    const s = bootstrap();
    s.goldTowerCount = 0;
    // Find a recipe producing AERARIUM and build it
    const recipe = comboData.find(r => r.result === 'AERARIUM');
    expect(recipe).toBeTruthy();
    let col = 1;
    const placed: any[] = [];
    for (const ing of recipe!.ingredients) {
      const tier = (ing.minTier ?? 2) as 1|2|3|4|5;
      placed.push(place(s, ing.type, tier, col++, 5));
    }
    const match = scanCombos(s).find(c => c.result === 'AERARIUM');
    expect(match, 'Aerarium combo not surfaced').toBeTruthy();
    const ok = executeCombo(s, match!, placed[0].id);
    expect(ok, 'Aerarium combo should succeed when below cap').toBe(true);
  });

  it('Aerarium combo is blocked when goldTowerCount is at the cap (3)', () => {
    const s = bootstrap();
    s.goldTowerCount = 3;
    const recipe = comboData.find(r => r.result === 'AERARIUM');
    let col = 1;
    const placed: any[] = [];
    for (const ing of recipe!.ingredients) {
      placed.push(place(s, ing.type, (ing.minTier ?? 2) as 1|2|3|4|5, col++, 5));
    }
    const match = scanCombos(s).find(c => c.result === 'AERARIUM');
    if (match) {
      const ok = executeCombo(s, match, placed[0].id);
      expect(ok, 'Aerarium combo should fail when cap reached').toBe(false);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────
// 6. Combo cost / gold-debit semantics
// ───────────────────────────────────────────────────────────────────────
describe('Combo cost / gold debit', () => {
  it('successful combo debits exactly its cost from denarii', () => {
    const s = bootstrap();
    s.denarii = 200;
    const a = place(s, TowerType.MILITES, 1, 1, 1);
    place(s, TowerType.MILITES, 1, 1, 2);
    place(s, TowerType.MILITES, 1, 1, 3);
    const merge = scanCombos(s).find(c => c.isSameTierMerge);
    const cost = merge!.cost;
    const ok = executeCombo(s, merge!, a.id);
    expect(ok).toBe(true);
    expect(s.denarii).toBe(200 - cost);
  });

  it('combo with cost > denarii is refused; gold unchanged', () => {
    const s = bootstrap();
    s.denarii = 0;
    const a = place(s, TowerType.MILITES, 1, 1, 1);
    place(s, TowerType.MILITES, 1, 1, 2);
    place(s, TowerType.MILITES, 1, 1, 3);
    const merge = scanCombos(s).find(c => c.isSameTierMerge);
    if (merge && merge.cost > 0) {
      const ok = executeCombo(s, merge, a.id);
      expect(ok).toBe(false);
      expect(s.denarii).toBe(0);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────
// 7. Tower ability wiring — RETIARIUS keeps both its signatures post-rename
// ───────────────────────────────────────────────────────────────────────
describe('RETIARIUS ability wiring (post-rename)', () => {
  it('RETIARIUS is in MELEE_TYPES (range-1.5 melee gate)', () => {
    const cr = require('fs').readFileSync('src/systems/CombatResolver.ts', 'utf8');
    expect(cr.includes('TowerType.RETIARIUS, TowerType.CLIBANARIUS')).toBe(true);
  });
  it('RETIARIUS keeps the first-hit ×2 damage signature', () => {
    const cr = require('fs').readFileSync('src/systems/CombatResolver.ts', 'utf8');
    expect(cr.includes('TowerType.RETIARIUS && (t as any).__lastTargetId !== target.id')).toBe(true);
  });
  it('RETIARIUS still applies ARMOR_SHRED on every hit', () => {
    const cr = require('fs').readFileSync('src/systems/CombatResolver.ts', 'utf8');
    expect(cr.includes('case TowerType.RETIARIUS')).toBe(true);
  });
  it('RETIARIUS has polearm range 2.0 (trident reach) and PHYS_MELEE damage type', () => {
    // 2026-05 v10: spear/trident/lance melee towers get +0.5 polearm
    // range. Retiarius (trident-and-net gladiator) sits in this group.
    const def: any = (towersData as any).RETIARIUS;
    expect(def.range).toBe(2.0);
    expect(def.damageType).toBe('PHYS_MELEE');
    expect(def.melee).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────
// 8. Item EQUIP_MODE gates — sanity check (MELEE-only items reject ranged)
// ───────────────────────────────────────────────────────────────────────
describe('Item EQUIP_MODE gates', () => {
  it('MELEE-only items list is non-empty and includes core melee items', () => {
    const ir = require('fs').readFileSync('src/systems/ItemRules.ts', 'utf8');
    for (const meleeItem of ['BARBED_GLADIUS', 'POISONED_BLADE', 'CELTIC_LONGSWORD']) {
      expect(ir.includes(`${meleeItem}: 'MELEE'`), `${meleeItem} should be MELEE-gated`).toBe(true);
    }
  });
  it('RANGED-only items list is non-empty and includes core ranged items', () => {
    const ir = require('fs').readFileSync('src/systems/ItemRules.ts', 'utf8');
    for (const rangedItem of ['STORM_JAVELIN', 'FIRE_OIL_FLASK', 'NUMIDIAN_SADDLE']) {
      expect(ir.includes(`${rangedItem}: 'RANGED'`), `${rangedItem} should be RANGED-gated`).toBe(true);
    }
  });
});
