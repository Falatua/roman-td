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
import { readFileSync } from 'node:fs';
import { scanCombos, executeCombo } from '../src/systems/CombinationEngine';
import { createTower } from '../src/systems/TowerSystem';
import { createGameState } from '../src/GameState';
import { TowerType, GamePhase, TileType } from '../src/types';
import { WATER_ZONE } from '../src/constants';
import { initializeGrid, setTile } from '../src/systems/GridManager';
import { buildGroundPath, buildFlyerPath } from '../src/systems/PathFinder';
import {
  FORTUNA_GAMBLE_POOL,
  isFortunaRegularCombo,
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

function placeRecipeIngredient(state: any, recipe: any, ing: any, index: number, col: number) {
  const minTier = (ing.minTier ?? 2) as 1|2|3|4|5;
  const resultDef: any = (towersData as any)[recipe.result] ?? {};
  if (resultDef.waterOnly && index === 0) {
    const t = createTower(ing.type as TowerType, minTier, WATER_ZONE.col + 1, WATER_ZONE.row + WATER_ZONE.height - 2, state.wave);
    t.placedOnWater = true;
    state.towers.set(t.id, t);
    return t;
  }
  return place(state, ing.type, minTier, col, 5);
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
      for (let index = 0; index < recipe.ingredients.length; index++) {
        const ing = recipe.ingredients[index];
        placed.push(placeRecipeIngredient(s, recipe, ing, index, col++));
      }
      const combos = scanCombos(s);
      const match = combos.find(c => c.result === recipe.result);
      expect(match, `scanCombos did not return ${recipe.result} after placing ${recipe.ingredients.map((i:any)=>i.type).join(',')}`).toBeTruthy();
    });

    it(`recipe → ${recipe.result}: executeCombo produces the result tower`, () => {
      const s = bootstrap();
      let col = 1;
      const placed: any[] = [];
      for (let index = 0; index < recipe.ingredients.length; index++) {
        const ing = recipe.ingredients[index];
        placed.push(placeRecipeIngredient(s, recipe, ing, index, col++));
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
// 2. Recipe display-name consistency
// ───────────────────────────────────────────────────────────────────────
describe('Tower recipe names stay player-facing', () => {
  it('every recipe result and ingredient resolves to a tower display name', () => {
    for (const recipe of comboData as any[]) {
      const resultDef: any = (towersData as any)[recipe.result];
      expect(resultDef?.name, `recipe result ${recipe.result} is missing a display name`).toBeTruthy();
      for (const ing of recipe.ingredients) {
        const ingDef: any = (towersData as any)[ing.type];
        expect(ingDef?.name, `recipe ${recipe.result} ingredient ${ing.type} is missing a display name`).toBeTruthy();
      }
    }
  });

  it('tower ability copy does not leak raw recipe IDs', () => {
    const recipeIds = new Set<string>();
    for (const recipe of comboData as any[]) {
      recipeIds.add(recipe.result);
      for (const ing of recipe.ingredients) recipeIds.add(ing.type);
    }
    for (const [towerId, def] of Object.entries(towersData as any)) {
      const ability = String((def as any).ability ?? '');
      for (const recipeId of recipeIds) {
        expect(
          new RegExp(`\\b${recipeId}\\b`).test(ability),
          `${towerId} ability text leaks raw tower id ${recipeId}; use the display name instead`
        ).toBe(false);
      }
    }
  });

  it('known historical alias towers use the same display names recipes show', () => {
    expect((towersData as any).AUXILIA.name).toBe('Skizzer');
    expect((towersData as any).BALLISTARIUS.name).toBe('Turris');
    expect((towersData as any).LIBRITOR.name).toBe('Librator');
    expect((towersData as any).AQUILIFER_TITAN.name).toBe('Aquilifer');
    expect((towersData as any).PONTIFEX_MAXIMUS.name).toBe('Pontifex');
    expect((towersData as any).CONSULAR_FATEBINDER.name).toBe('Fatebinder');
    expect((towersData as any).MIRMILLO_REAVER.name).toBe('Murmillo Reaver');
  });
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

  it('new Harbor and ocean sprites stay transparent, readable, and visually non-flat', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const sharp = (await import('sharp')).default;
    const keys = [
      'TIDECALLER_COMMANDER',
      'TRIREME_BALLISTA',
      'CORVUS_BOARDING_SHIP',
      'RAMMING_QUINQUEREME',
      'CHARYBDIS_VORTEX',
      'NEREID_ORACLE',
      'HYDRA_OF_LERNA',
      'PRAETORIAN_FLEET',
      'CORVUS_LEGION_DOCK',
      'ORACLE_LIGHTHOUSE',
      'ABYSSAL_ONAGER',
      'HYDRA_BEAST_PIT',
      'MARS_TIDAL_BASTION',
      'NEPTUNES_LEVIATHAN',
      'ITEM_BRINEHOOK_ROPE',
      'ITEM_TIDEPIERCER_HARPOON',
      'ITEM_AEGEAN_PEARL',
      'ITEM_STORMGLASS_AMPHORA',
      'ITEM_NEPTUNES_TRIDENT'
    ];
    for (const key of keys) {
      const rel = (ASSET_KEYS as any)[key];
      expect(rel, `${key} should be registered in the asset manifest`).toBeTruthy();
      const file = path.join(process.cwd(), 'public/assets/sprites', rel);
      expect(fs.existsSync(file), `${key} asset missing at ${file}`).toBe(true);
      const img = sharp(file).ensureAlpha();
      const meta = await img.metadata();
      expect(meta.width, `${key} width`).toBe(128);
      expect(meta.height, `${key} height`).toBe(128);
      expect(meta.hasAlpha, `${key} should keep a transparent background`).toBe(true);
      const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
      let opaque = 0;
      let tinyAlpha = 0;
      const colorBuckets = new Set<string>();
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a > 0 && a <= 4) tinyAlpha++;
        if (a > 16) {
          opaque++;
          colorBuckets.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
        }
      }
      const coverage = opaque / (info.width * info.height);
      expect(tinyAlpha, `${key} has alpha dust that can look like a dirty background`).toBe(0);
      expect(coverage, `${key} should not be a tiny unreadable mark`).toBeGreaterThan(0.12);
      expect(coverage, `${key} should preserve transparent negative space`).toBeLessThan(0.65);
      const minColorBuckets = key.startsWith('ITEM_') ? 8 : 24;
      expect(colorBuckets.size, `${key} should have enough color variation to match the detailed pixel-art roster`).toBeGreaterThan(minColorBuckets);
    }
  });

  it('Sulla meteor projectile and impact sheets keep stable transparent animation frames', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const sharp = (await import('sharp')).default;
    const assets = [
      { key: 'PROJ_SULLA_METEOR', file: 'sulla_meteor_projectile.png', w: 96, h: 96, frames: 1 },
      { key: 'SULLA_METEOR_PROJECTILE', file: 'sulla_meteor_projectile_sheet.png', w: 576, h: 96, frames: 6 },
      { key: 'SULLA_METEOR_IMPACT', file: 'sulla_meteor_impact_sheet.png', w: 768, h: 128, frames: 6 }
    ];
    for (const asset of assets) {
      expect((ASSET_KEYS as any)[asset.key], `${asset.key} should be registered`).toBe(`../heroes/attacks/${asset.file}`);
      const file = path.join(process.cwd(), 'public/assets/heroes/attacks', asset.file);
      expect(fs.existsSync(file), `${asset.file} missing`).toBe(true);
      const img = sharp(file).ensureAlpha();
      const meta = await img.metadata();
      expect(meta.width, `${asset.file} width`).toBe(asset.w);
      expect(meta.height, `${asset.file} height`).toBe(asset.h);
      expect(meta.hasAlpha, `${asset.file} should be transparent`).toBe(true);
      const { data } = await img.raw().toBuffer({ resolveWithObject: true });
      let tinyAlpha = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0 && data[i] <= 4) tinyAlpha++;
      expect(tinyAlpha, `${asset.file} has alpha dust`).toBe(0);
      const frameW = asset.frames === 1 ? asset.w : asset.w / asset.frames;
      for (let frame = 0; frame < asset.frames; frame++) {
        const raw = await sharp(file)
          .extract({ left: frame * frameW, top: 0, width: frameW, height: asset.h })
          .ensureAlpha()
          .raw()
          .toBuffer();
        const bounds = alphaBounds(raw, Math.max(frameW, asset.h));
        expect(bounds.width, `${asset.file} frame ${frame + 1} should contain visible art`).toBeGreaterThan(12);
        expect(bounds.height, `${asset.file} frame ${frame + 1} should contain visible art`).toBeGreaterThan(12);
      }
    }
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

  it('Fortuna pool size matches count of regular COMBO-kind towers', () => {
    // Fortuna may roll ordinary combo towers only. Supercombo, Omega, Champion,
    // and recipe-chain combo-of-combo results must remain crafted rewards.
    const eligibleCombos = Object.entries(towersData as any)
      .filter(([id, d]: any) => isFortunaRegularCombo(id, d))
      .map(([id]) => id);
    expect(FORTUNA_GAMBLE_POOL.length).toBe(eligibleCombos.length);
    expect(new Set(FORTUNA_GAMBLE_POOL).size).toBe(eligibleCombos.length);   // no dupes
    for (const superCombo of ['ROMAN_TRANSFORMER','JULIUS_CAESAR','HANNIBALS_NIGHTMARE','TRIPLEX_ACIES','LEGION_PRIME']) {
      expect(FORTUNA_GAMBLE_POOL).not.toContain(superCombo);
    }
  });

  it('Mercator shop renderer does not sell traps or stone ramparts', () => {
    const source = readFileSync('src/render/ShopUI.ts', 'utf8');
    const mercStart = source.indexOf('function renderMercatorShop');
    const mercEnd = source.indexOf('export function renderShop', mercStart);
    expect(mercStart, 'renderMercatorShop should exist').toBeGreaterThanOrEqual(0);
    expect(mercEnd, 'renderShop should follow renderMercatorShop').toBeGreaterThan(mercStart);

    const mercatorRenderer = source.slice(mercStart, mercEnd);
    expect(mercatorRenderer).not.toContain('renderTrapSection(');
    expect(mercatorRenderer).not.toContain('renderRampartSection(');

    const gateRenderer = source.slice(mercEnd);
    expect(gateRenderer).toContain('renderTrapSection(contentRoot');
    expect(gateRenderer).toContain('renderRampartSection(contentRoot');
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
  it('RETIARIUS is in MELEE_TYPES (melee gate)', () => {
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
    // FALX_BLADE added 2026-07-02 — its effect text said "MELEE ONLY" but it
    // was missing from EQUIP_MODE, so it equipped on ranged towers (bug).
    for (const meleeItem of ['BARBED_GLADIUS', 'POISONED_BLADE', 'CELTIC_LONGSWORD', 'FALX_BLADE']) {
      expect(ir.includes(`${meleeItem}: 'MELEE'`), `${meleeItem} should be MELEE-gated`).toBe(true);
    }
  });
  it('every item whose effect text says MELEE/RANGED ONLY is actually gated', () => {
    // Data-consistency guard: scan all permanent item defs for restriction
    // wording and assert the EQUIP_MODE map covers them, so a new item with
    // "MELEE ONLY" copy can never silently default to ANY again.
    const fs = require('fs');
    const perm = JSON.parse(fs.readFileSync('src/data/items_permanent.json', 'utf8'));
    const ir = fs.readFileSync('src/systems/ItemRules.ts', 'utf8');
    for (const [id, def] of Object.entries<any>(perm)) {
      const txt = `${def.effect ?? ''} ${def.description ?? ''}`;
      if (/\bMELEE ONLY\b|\bMelee-only\b/i.test(txt)) {
        expect(ir.includes(`${id}: 'MELEE'`), `${id} text says MELEE ONLY but is not gated`).toBe(true);
      }
      if (/\bRANGED ONLY\b|\bRanged-only\b/i.test(txt)) {
        expect(ir.includes(`${id}: 'RANGED'`), `${id} text says RANGED ONLY but is not gated`).toBe(true);
      }
    }
  });
  it('RANGED-only items list is non-empty and includes core ranged items', () => {
    const ir = require('fs').readFileSync('src/systems/ItemRules.ts', 'utf8');
    for (const rangedItem of ['STORM_JAVELIN', 'FIRE_OIL_FLASK', 'NUMIDIAN_SADDLE']) {
      expect(ir.includes(`${rangedItem}: 'RANGED'`), `${rangedItem} should be RANGED-gated`).toBe(true);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────
// 9. Sample SFX wiring — critical UI stings stay present and preloaded
// ───────────────────────────────────────────────────────────────────────
describe('Sample SFX wiring', () => {
  it('Test Your Might offer has its MP3 cue, playback hook, and preload entry', () => {
    const fs = require('fs');
    const audio = fs.readFileSync('src/render/AudioManager.ts', 'utf8');
    const modal = fs.readFileSync('src/render/TestYourMightModal.ts', 'utf8');
    const cue = 'assets/sfx/test_your_might.mp3';

    expect(fs.existsSync(`public/${cue}`), 'missing Test Your Might MP3 asset').toBe(true);
    expect(audio.includes(`'${cue}'`), 'Test Your Might MP3 should be preloaded').toBe(true);
    expect(audio.includes(`testYourMight:  () => playSample(sfx('${cue}')`), 'SFX.testYourMight should play the MP3').toBe(true);
    expect(modal.includes('SFX.testYourMight();'), 'offer modal should fire the cue when it appears').toBe(true);
  });

  it('ocean enemy emergence has its MP3 cue, preload entry, and wave-start hook', () => {
    const fs = require('fs');
    const audio = fs.readFileSync('src/render/AudioManager.ts', 'utf8');
    const main = fs.readFileSync('src/main.ts', 'utf8');
    const waveManager = fs.readFileSync('src/systems/WaveManager.ts', 'utf8');
    const cue = 'assets/sfx/ocean_emerge.mp3';

    expect(fs.existsSync(`public/${cue}`), 'missing ocean emergence MP3 asset').toBe(true);
    expect(audio.includes(`'${cue}'`), 'ocean emergence MP3 should be preloaded').toBe(true);
    expect(audio.includes(`oceanEmerge:    () => playSample(sfx('${cue}')`), 'SFX.oceanEmerge should play the MP3').toBe(true);
    expect(main.includes('__oceanEmergenceSfx'), 'main should expose the ocean emergence audio hook').toBe(true);
    expect(waveManager.includes('__oceanEmergenceSfxWave'), 'WaveManager should guard the cue to once per wave').toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────
// 10. Hero picker copy — keep hidden scaling math out of player cards
// ───────────────────────────────────────────────────────────────────────
describe('Hero picker copy hygiene', () => {
  it('does not expose hidden hero level-scaling math in the choose-hero cards', () => {
    const fs = require('fs');
    const source = fs.readFileSync('src/render/ChooseHeroModal.ts', 'utf8');
    expect(source).not.toContain('Scales 1.0');
    expect(source).not.toContain('XP rises');
  });
});

// ───────────────────────────────────────────────────────────────────────
// 11. Inventory modal layering — item cards must win pointer clicks
// ───────────────────────────────────────────────────────────────────────
describe('Inventory modal interaction layer', () => {
  it('keeps the Armarium above stage/build overlays so item cards are clickable', () => {
    const fs = require('fs');
    const source = fs.readFileSync('src/render/ShopUI.ts', 'utf8');
    expect(source).toContain("modal.id = 'inventory-modal'");
    expect(source).toContain('position:fixed;inset:0');
    expect(source).toContain('z-index:100000;pointer-events:auto');
    expect(source).toContain('position:relative;z-index:1;width:min(560px,94vw)');
    expect(source).toContain('(document.body ?? parent).appendChild(modal)');
  });
});

describe('Quest modal interaction layer', () => {
  it('keeps the quest close button above queued banner overlays', () => {
    const fs = require('fs');
    const source = fs.readFileSync('src/main.ts', 'utf8');
    expect(source).toContain("modal.id = 'quests-modal'");
    expect(source).toContain('position:fixed;inset:0');
    expect(source).toContain('z-index:100000;pointer-events:auto');
    expect(source).toContain('document.body.appendChild(modal)');
  });
});

describe('Codex modal interaction layer', () => {
  it('keeps codex tabs and close buttons above reminders and stage overlays', () => {
    const fs = require('fs');
    const source = fs.readFileSync('src/render/Codex.ts', 'utf8');
    expect(source).toContain("modal.id = 'codex-modal'");
    expect(source).toContain('position:fixed;inset:0');
    expect(source).toContain('z-index:100000;pointer-events:auto');
    expect(source).toContain('(document.body ?? parent).appendChild(modal)');
  });
});
