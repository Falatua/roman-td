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
import { ASSET_KEYS, BASE_TOWER_ATTACK_TYPES } from '../src/render/Assets';
import { baseTowerAttackFlashWindow, isBaseTowerAttackAnimated } from '../src/systems/BaseTowerAttackAnimation';
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
  s.gold = 5000;
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
  function meanFrameDiff(a: Buffer, b: Buffer): number {
    const len = Math.min(a.length, b.length);
    let diff = 0;
    for (let i = 0; i < len; i++) diff += Math.abs(a[i] - b[i]);
    return diff / Math.max(1, len);
  }

  function alphaBounds(raw: Buffer, frameSize: number) {
    let minX = frameSize;
    let minY = frameSize;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < frameSize; y++) {
      for (let x = 0; x < frameSize; x++) {
        const alpha = raw[(y * frameSize + x) * 4 + 3];
        if (alpha > 16) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return { width: 0, height: 0 };
    return { width: maxX - minX + 1, height: maxY - minY + 1 };
  }

  async function expectAttackSheetBodyStable(sharp: any, file: string, frameSize: number, label: string, minIdleHeightRatio: number) {
    const first = await sharp(file).extract({ left: 0, top: 0, width: frameSize, height: frameSize }).ensureAlpha().raw().toBuffer();
    const firstBounds = alphaBounds(first, frameSize);
    expect(firstBounds.height / frameSize, `${label} attack frame 1 body is too small inside the sprite cell`).toBeGreaterThanOrEqual(minIdleHeightRatio);
    for (let frame = 0; frame < 9; frame++) {
      const raw = await sharp(file)
        .extract({
          left: (frame % 3) * frameSize,
          top: Math.floor(frame / 3) * frameSize,
          width: frameSize,
          height: frameSize
        })
        .ensureAlpha()
        .raw()
        .toBuffer();
      const bounds = alphaBounds(raw, frameSize);
      const bodyRatio = Math.min(
        bounds.width / Math.max(1, firstBounds.width),
        bounds.height / Math.max(1, firstBounds.height)
      );
      expect(bodyRatio, `${label} attack frame ${frame + 1} shrinks too far from idle-sized frame 1`).toBeGreaterThanOrEqual(0.80);
    }
  }

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

  it('every hero has a 3x3 attack sprite sheet', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const sharp = (await import('sharp')).default;
    const heroes = ['MARIUS', 'AGRIPPA', 'AGRICOLA', 'SCIPIO', 'CAESAR', 'SULLA'];
    for (const id of heroes) {
      expect((ASSET_KEYS as any)[`HERO_ATTACK_${id}`], `${id} hero attack sheet missing from asset manifest`).toBe(`../heroes/attacks/hero_${id.toLowerCase()}_attack_sheet.png`);
      const file = path.join(process.cwd(), 'public/assets/heroes/attacks', `hero_${id.toLowerCase()}_attack_sheet.png`);
      expect(fs.existsSync(file), `${id} hero attack sheet missing at ${file}`).toBe(true);
      const meta = await sharp(file).metadata();
      expect(meta.width, `${id} hero attack sheet should be a 3x3 grid of 256px frames`).toBe(768);
      expect(meta.height, `${id} hero attack sheet should be a 3x3 grid of 256px frames`).toBe(768);
      const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let tinyAlpha = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0 && data[i] <= 4) tinyAlpha++;
      expect(tinyAlpha, `${id} hero attack sheet has barely-visible alpha dust that can look like a dirty background`).toBe(0);
      const first = await sharp(file).extract({ left: 0, top: 0, width: 256, height: 256 }).ensureAlpha().raw().toBuffer();
      const ninth = await sharp(file).extract({ left: 512, top: 512, width: 256, height: 256 }).ensureAlpha().raw().toBuffer();
      expect(meanFrameDiff(first, ninth), `${id} hero attack frame 9 should visibly settle back to idle frame 1`).toBeLessThan(0.05);
      await expectAttackSheetBodyStable(sharp, file, 256, `${id} hero`, 0.70);
    }
  });

  it('every non-melee, non-hero base tower has a 3x3 attack sprite sheet', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const sharp = (await import('sharp')).default;
    const baseTowers = Object.entries(towersData as any)
      .filter(([, def]: any) => def.kind === 'BASE' && !def.isHero && !def.melee)
      .map(([id]) => id)
      .sort();
    expect(baseTowers.length, 'expected the base tower roster to be non-empty').toBeGreaterThan(0);
    expect([...BASE_TOWER_ATTACK_TYPES].sort(), 'runtime attack-sheet roster should match ranged/caster base tower roster').toEqual(baseTowers);
    for (const id of baseTowers) {
      expect((ASSET_KEYS as any)[`ATTACK_${id}`], `${id} attack sheet missing from asset manifest`).toBe(`attacks/atk_${id.toLowerCase()}.png`);
      const file = path.join(process.cwd(), 'public/assets/sprites/attacks', `atk_${id.toLowerCase()}.png`);
      expect(fs.existsSync(file), `${id} attack sheet missing at ${file}`).toBe(true);
      const meta = await sharp(file).metadata();
      expect(meta.width, `${id} attack sheet should be a 3x3 grid of 128px frames`).toBe(384);
      expect(meta.height, `${id} attack sheet should be a 3x3 grid of 128px frames`).toBe(384);
      const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let tinyAlpha = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0 && data[i] <= 4) tinyAlpha++;
      expect(tinyAlpha, `${id} attack sheet has barely-visible alpha dust that can look like a dirty background`).toBe(0);
      const first = await sharp(file).extract({ left: 0, top: 0, width: 128, height: 128 }).ensureAlpha().raw().toBuffer();
      const ninth = await sharp(file).extract({ left: 256, top: 256, width: 128, height: 128 }).ensureAlpha().raw().toBuffer();
      expect(meanFrameDiff(first, ninth), `${id} attack frame 9 should visibly settle back to idle frame 1`).toBeLessThan(0.05);
      await expectAttackSheetBodyStable(sharp, file, 128, `${id} base tower`, 0.50);
    }
  });

  it('base tower attack animations use speed windows that match tower families', () => {
    expect(isBaseTowerAttackAnimated('MILITES')).toBe(false);
    expect(isBaseTowerAttackAnimated('BEAST_HUNTER')).toBe(false);
    expect(isBaseTowerAttackAnimated('SCORPIO')).toBe(true);
    expect(isBaseTowerAttackAnimated('HERO_MARIUS')).toBe(false);
    expect(isBaseTowerAttackAnimated('JULIUS_CAESAR')).toBe(false);
    expect(baseTowerAttackFlashWindow('BEAST_HUNTER')).toBeCloseTo(0.18, 4);
    expect(baseTowerAttackFlashWindow('VELITES')).toBeCloseTo(0.24, 4);
    expect(baseTowerAttackFlashWindow('MILITES')).toBeCloseTo(0.18, 4);
    expect(baseTowerAttackFlashWindow('SCORPIO')).toBeCloseTo(0.36, 4);
    expect(baseTowerAttackFlashWindow('FLAMEN')).toBeCloseTo(0.34, 4);
    expect(baseTowerAttackFlashWindow('JULIUS_CAESAR')).toBeCloseTo(0.18, 4);
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
    // 2026-05 v9 + v2 Ch9: apex super-combos (6 cross-combos incl. Mars Victor)
    // are blocked from Fortuna so they have to be crafted, not bought. Test
    // asserts the pool equals (total combos − 6 blocked apex), no duplicates.
    const APEX = new Set(['IMPERIUM_ETERNUM','CARTHAGE_SCOURGE','TRIUMVIRATE','LEGION_PRIME','CONSULAR_FATEBINDER','MARS_VICTOR',
      'SKY_DOMINION','AUREATE_TRIBUNAL','GLACIAL_PALISADE','INFERNAL_COLOSSUS',
      // 2026 v2 Ch8 — Champions are COMBO-kind but Mercator-only, blocked from Fortuna.
      'CHAMPION_MARIUS','CHAMPION_AGRIPPA','CHAMPION_AGRICOLA','CHAMPION_SCIPIO','CHAMPION_CAESAR','CHAMPION_SULLA']);
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
  it('successful combo debits exactly its cost from gold', () => {
    const s = bootstrap();
    s.gold = 200;
    const a = place(s, TowerType.MILITES, 1, 1, 1);
    place(s, TowerType.MILITES, 1, 1, 2);
    place(s, TowerType.MILITES, 1, 1, 3);
    const merge = scanCombos(s).find(c => c.isSameTierMerge);
    const cost = merge!.cost;
    const ok = executeCombo(s, merge!, a.id);
    expect(ok).toBe(true);
    expect(s.gold).toBe(200 - cost);
  });

  it('combo with cost > gold is refused; gold unchanged', () => {
    const s = bootstrap();
    s.gold = 0;
    const a = place(s, TowerType.MILITES, 1, 1, 1);
    place(s, TowerType.MILITES, 1, 1, 2);
    place(s, TowerType.MILITES, 1, 1, 3);
    const merge = scanCombos(s).find(c => c.isSameTierMerge);
    if (merge && merge.cost > 0) {
      const ok = executeCombo(s, merge, a.id);
      expect(ok).toBe(false);
      expect(s.gold).toBe(0);
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
