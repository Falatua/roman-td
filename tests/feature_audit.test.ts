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
import { tickCombat } from '../src/systems/CombatResolver';
import { createGameState } from '../src/GameState';
import { Enemy, EnemyFaction, EnemyType, TowerType, GamePhase, TileType } from '../src/types';
import { WATER_ZONE } from '../src/constants';
import { initializeGrid, setTile } from '../src/systems/GridManager';
import { buildGroundPath, buildFlyerPath } from '../src/systems/PathFinder';
import {
  FORTUNA_GAMBLE_POOL,
  isFortunaRegularCombo,
  rollFortunaCombo
} from '../src/systems/MerchantSystem';
import { ASSET_KEYS, BASE_TOWER_ATTACK_TYPES, HERO_ABILITY_VFX_ASSETS } from '../src/render/Assets';
import { baseTowerAttackFlashWindow, isBaseTowerAttackAnimated } from '../src/systems/BaseTowerAttackAnimation';
import comboData from '../src/data/towerCombinations.json';
import towersData from '../src/data/towers.json';
import HERO_DEFS from '../src/data/herodefs.json';

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

function trainingDummy(id = 'dps-dummy'): Enemy {
  return {
    id,
    type: EnemyType.TRAINING_DUMMY,
    faction: EnemyFaction.DOGS,
    hp: 15_000_000,
    maxHp: 15_000_000,
    baseSpeed: 0.25,
    currentSpeed: 0.25,
    isFlyer: false,
    x: 7 * 32 + 16,
    y: 5 * 32 + 16,
    pathIndex: 0,
    pathProgress: 0,
    statusEffects: [],
    hasFeared: false,
    livesCost: 0,
    isBoss: false,
    reward: 0,
    archetype: 'BULKY',
    hpFlashTimer: 0,
    isDpsCheck: true,
    __dpsDmgAccum: 0
  } as Enemy;
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
// 2b. Inspection modal usability
// ───────────────────────────────────────────────────────────────────────
describe('Inspection panels keep obvious close controls', () => {
  it('tower and hero inspect menus use one close control plus Escape close', () => {
    const src = readFileSync('src/render/TowerMenu.ts', 'utf8');
    expect(src, 'tower menu should use the shared solid panel style').toContain('towerPanelStyle');
    expect(src, 'tower/hero inspect should not add a second helper X').not.toContain("closeButtonId: 'tower-menu-x'");
    expect(src, 'tower/hero inspect should close from Escape').toContain('closeOnEscape: true');
    expect(src, 'hero inspect should no longer use translucent ability cards').not.toContain('background:rgba(0,0,0,0.3)');
  });

  it('stone and enemy quick inspect boxes keep a single close path and Escape close', () => {
    const stone = readFileSync('src/render/StoneMenu.ts', 'utf8');
    const enemy = readFileSync('src/render/EnemyInspect.ts', 'utf8');
    expect(stone).not.toContain("closeButtonId: 'stone-menu-x'");
    expect(enemy).not.toContain("closeButtonId: 'enemy-inspect-x'");
    expect(stone).toContain('closeOnEscape: true');
    expect(enemy).toContain('closeOnEscape: true');
  });

  it('major shop and info modals do not stack helper X buttons on manual close controls', () => {
    const files = [
      'src/render/ShopUI.ts',
      'src/render/Codex.ts',
      'src/render/ComboPreview.ts',
      'src/render/TowerLeaderboard.ts',
      'src/render/SandboxPanel.ts'
    ];
    const src = files.map(file => readFileSync(file, 'utf8')).join('\n');
    for (const id of [
      'mercator-shop-x',
      'gate-shop-x',
      'inventory-modal-x',
      'codex-modal-x',
      'combo-info-modal-x',
      'tower-leaderboard-x',
      'sandbox-wave-picker-x',
      'sandbox-tower-picker-x'
    ]) {
      expect(src, `${id} should not add a duplicate helper close button`).not.toContain(`closeButtonId: '${id}'`);
    }
    expect(readFileSync('src/render/Codex.ts', 'utf8')).not.toContain('codex-close-bottom');
    expect(readFileSync('src/render/ComboPreview.ts', 'utf8')).not.toContain('combo-info-dismiss');
  });

  it('shared modal ergonomics adds a standard X close button by default', () => {
    const helper = readFileSync('src/render/ModalErgonomics.ts', 'utf8');
    expect(helper).toContain('opts.closeButton !== false');
    expect(helper).toContain("btn.textContent = 'X'");
    expect(helper).toContain("btn.title = 'Close this panel'");
    expect(helper).toContain("btn.setAttribute('aria-label', 'Close this panel')");
    expect(helper).toContain("root.dispatchEvent(new CustomEvent('rtd:modal-force-close'))");
    expect(helper).toContain('.rtd-modal-tools');
    expect(helper).toContain('.rtd-modal-tool');
    expect(helper).toContain('display: inline-grid');
    expect(helper).toContain('place-items: center');
    expect(helper).toContain('width: 34px');
    expect(helper).toContain('height: 34px');
  });

  it('choice-modal X buttons use safe decline or skip behavior instead of trapping progression', () => {
    const relic = readFileSync('src/render/CampaignRelicModal.ts', 'utf8');
    const trophy = readFileSync('src/render/BossTrophyModal.ts', 'utf8');
    const tym = readFileSync('src/render/TestYourMightModal.ts', 'utf8');
    expect(relic).toContain('const declineAll = () =>');
    expect(relic).toContain('skipCampaignRelic(state)');
    expect(relic).toContain('onClose: declineAll');
    expect(trophy).toContain('const skipTrophy = () =>');
    expect(trophy).toContain('onChoose(null)');
    expect(trophy).toContain('onClose: skipTrophy');
    expect(tym).toContain('const decline = () =>');
    expect(tym).toContain('declineTestYourMight(state)');
    expect(tym).toContain('onClose: decline');
  });

  it('manual-X modals opt out while Harbor uses the shared aligned control row', () => {
    const files = [
      'src/main.ts',
      'src/render/SecretEvents.ts',
      'src/render/ComboPreview.ts'
    ];
    const source = files.map(file => readFileSync(file, 'utf8')).join('\n');
    expect(source).toContain('closeButton: false');
    const harbor = readFileSync('src/render/HarborDraftModal.ts', 'utf8');
    expect(harbor).not.toContain('id="harbor-close"');
    expect(harbor).toContain('onClose: () => wrap.remove()');
    expect(readFileSync('src/render/SecretEvents.ts', 'utf8')).toContain('id="mercator-backroom-x"');
    expect(readFileSync('src/render/ComboPreview.ts', 'utf8')).toContain('id="combo-info-close"');
    expect(readFileSync('src/main.ts', 'utf8')).toContain('id="dps-summary-close"');
  });

  it('older full-screen overlays expose explicit X close icons too', () => {
    const files = [
      'src/render/ChooseHeroModal.ts',
      'src/render/MarsVictorAlert.ts',
      'src/render/Leaderboard.ts',
      'src/render/EndScreens.ts',
      'src/main.ts'
    ];
    const source = files.map(file => readFileSync(file, 'utf8')).join('\n');
    for (const id of [
      'sandbox-pw-x',
      'etch-name-x',
      'end-summary-x',
      'name-prompt-x',
      'hog-close-x',
      'end-screen-x'
    ]) {
      expect(source).toContain(id);
    }
    expect(source).toContain("closeBtn.setAttribute('aria-label', 'Close hero selection')");
    expect(source).toContain("closeBtn.setAttribute('aria-label', 'Close Mars Victor prompt')");
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
      let chromaResidue = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 0 && data[i + 3] <= 4) tinyAlpha++;
        if (data[i + 3] > 16 && data[i + 1] > 95 && data[i + 1] > data[i] * 1.35 && data[i + 1] > data[i + 2] * 1.35) chromaResidue++;
      }
      expect(tinyAlpha, `${id} hero attack sheet has barely-visible alpha dust that can look like a dirty background`).toBe(0);
      expect(chromaResidue, `${id} hero attack sheet has chroma-key residue left in visible pixels`).toBe(0);
      const first = await sharp(file).extract({ left: 0, top: 0, width: 256, height: 256 }).ensureAlpha().raw().toBuffer();
      const fifth = await sharp(file).extract({ left: 256, top: 256, width: 256, height: 256 }).ensureAlpha().raw().toBuffer();
      const ninth = await sharp(file).extract({ left: 512, top: 512, width: 256, height: 256 }).ensureAlpha().raw().toBuffer();
      expect(meanFrameDiff(first, ninth), `${id} hero attack frame 9 should visibly settle back to idle frame 1`).toBeLessThan(0.05);
      if (id !== 'MARIUS') {
        const idleFile = path.join(process.cwd(), 'public/assets/heroes', `hero_${id.toLowerCase()}.png`);
        const idle = await sharp(idleFile).ensureAlpha().raw().toBuffer();
        expect(meanFrameDiff(first, idle), `${id} hero attack frame 1 should match the shipped idle sprite to avoid popping into attacks`).toBeLessThan(1);
        expect(meanFrameDiff(first, fifth), `${id} hero attack frame 5 should be a real contact/release pose, not a static idle frame`).toBeGreaterThan(12);
      }
      await expectAttackSheetBodyStable(sharp, file, 256, `${id} hero`, 0.70);
    }
  });

  it('Marius custom attack sheet has a readable sword swing and idle return', async () => {
    const path = await import('node:path');
    const sharp = (await import('sharp')).default;
    const file = path.join(process.cwd(), 'public/assets/heroes/attacks/hero_marius_attack_sheet.png');
    const first = await sharp(file).extract({ left: 0, top: 0, width: 256, height: 256 }).ensureAlpha().raw().toBuffer();
    const fifth = await sharp(file).extract({ left: 256, top: 256, width: 256, height: 256 }).ensureAlpha().raw().toBuffer();
    const sixth = await sharp(file).extract({ left: 512, top: 256, width: 256, height: 256 }).ensureAlpha().raw().toBuffer();
    const ninth = await sharp(file).extract({ left: 512, top: 512, width: 256, height: 256 }).ensureAlpha().raw().toBuffer();

    expect(meanFrameDiff(first, fifth), 'Marius frame 5 should be a visibly different contact pose, not a floating slash over idle').toBeGreaterThan(30);
    expect(meanFrameDiff(first, sixth), 'Marius frame 6 should carry follow-through motion after contact').toBeGreaterThan(30);
    expect(meanFrameDiff(first, ninth), 'Marius frame 9 should return to frame 1 for clean idle recovery').toBeLessThan(0.05);
    expect(alphaBounds(fifth, 256).width, 'Marius contact frame should include a broad readable sword arc').toBeGreaterThan(220);
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

  it('attack and throw animations always fall back to idle when action ends', () => {
    const combat = readFileSync('src/systems/CombatResolver.ts', 'utf8');
    const render = readFileSync('src/render/RenderEngine.ts', 'utf8');
    expect(combat, 'attackFlash must drain before no-enemy early return').toMatch(/for \(const t of towers\) \{\s*if \(!Number\.isFinite\(t\.attackFlash\)/);
    expect(combat, 'sleep should not freeze a tower mid-swing').toContain('Attack-flash timers are decremented before');
    expect(render, 'renderer should allow attack sheets during real waves and active DPS Check').toContain('const combatVisualsActive = state.phase === GamePhase.WAVE_PHASE || !!(state as any).__dpsCheckActive');
    expect(render, 'renderer should clear stale attack state outside combat').toContain('if (!combatVisualsActive || !Number.isFinite(tw.attackFlash)');
    expect(render, 'renderer should reject invalid animation timers').toContain('!Number.isFinite(tw.attackFlash)');
    expect(render, 'renderer should clamp stale attack timers to their legal window').toContain('tw.attackFlash = flashWindow');
    expect(render, 'idle texture must be restored when attack sampling is inactive').toContain('if (idleTex && entry.sp.texture !== idleTex) entry.sp.texture = idleTex');
    expect(render, 'pose offsets must reset every non-attacking frame').toContain('entry.sp.rotation = heroAttackRotation');
    expect(render, 'pose skew must reset every non-attacking frame').toContain('entry.sp.skew.x = heroAttackSkewX');
  });

  it('DPS Check combat still drives real tower attack timers outside wave phase', () => {
    const s = bootstrap();
    s.phase = GamePhase.BUILD_PHASE;
    (s as any).__dpsCheckActive = true;
    const tower = place(s, TowerType.SCORPIO, 3, 7, 5);
    tower.attackCooldown = 0;
    const dummy = trainingDummy();
    s.enemies.set(dummy.id, dummy);

    let projectileFired = false;
    tickCombat(s, 0.05, {
      onHit: () => {},
      onMeleeSwing: () => {},
      onProjectileFire: () => { projectileFired = true; },
      onKill: () => {}
    });

    expect(projectileFired, 'DPS Check should use the same combat firing path as a real wave').toBe(true);
    expect(tower.attackFlash, 'DPS Check renderer should receive a non-idle attack timer to sample tower attack sheets').toBeGreaterThan(0);
    expect(s.projectiles.length, 'ranged DPS Check attacks should create the same projectile objects used during real waves').toBeGreaterThan(0);
  });

  it('Pugio Assassin sprite keeps a complete full-body silhouette with feet', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const sharp = (await import('sharp')).default;
    expect((ASSET_KEYS as any).PUGIO_ASSASSIN, 'Pugio Assassin asset registration').toBe('t_new_pugio_assassin.png');
    const file = path.join(process.cwd(), 'public/assets/sprites/t_new_pugio_assassin.png');
    expect(fs.existsSync(file), 'Pugio Assassin sprite missing').toBe(true);
    const img = sharp(file).ensureAlpha();
    const meta = await img.metadata();
    expect(meta.width, 'Pugio Assassin should be normalized to the standard tower sprite cell width').toBe(256);
    expect(meta.height, 'Pugio Assassin should be normalized to the standard tower sprite cell height').toBe(256);
    expect(meta.hasAlpha, 'Pugio Assassin should keep a transparent background').toBe(true);
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    let tinyAlpha = 0;
    let greenPixels = 0;
    let minX = info.width;
    let minY = info.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * 4;
        const a = data[i + 3];
        if (a > 0 && a <= 4) tinyAlpha++;
        if (a > 16) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
          if (data[i + 1] > 150 && data[i + 1] > data[i] * 1.45 && data[i + 1] > data[i + 2] * 1.45) greenPixels++;
        }
      }
    }
    expect(tinyAlpha, 'Pugio Assassin has alpha dust that can look like a dirty background').toBe(0);
    expect(greenPixels, 'Pugio Assassin should not retain chroma-key green pixels').toBe(0);
    expect(maxX - minX + 1, 'Pugio Assassin should stay broad enough to read shield and dagger').toBeGreaterThan(130);
    expect(maxY - minY + 1, 'Pugio Assassin should include the full body from hood through feet').toBeGreaterThan(220);
    expect(maxY, 'Pugio Assassin feet should not be clipped against the bottom edge').toBeLessThanOrEqual(248);
  });

  it('new Harbor and ocean sprites stay transparent, readable, and visually non-flat', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const sharp = (await import('sharp')).default;
    const keys = [
      'TIDECALLER_COMMANDER',
      'STORMTIDE_WYVERN_COMMANDER',
      'UNDEAD_GIANT',
      'UNDEAD_CYCLOPS',
      'DREAD_UNDEAD_GIANT',
      'DREAD_UNDEAD_CYCLOPS',
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
      'NAGA_ADEPT',
      'NAGA_SLEEPWEAVER',
      'NAGA_ORACLE',
      'OCEAN_GHOST_SPIRIT',
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

  it('ocean emergence animation sheet stays sprite-based, transparent, and renderer-wired', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const sharp = (await import('sharp')).default;
    const renderEngine = fs.readFileSync('src/render/RenderEngine.ts', 'utf8');
    const waveManager = fs.readFileSync('src/systems/WaveManager.ts', 'utf8');
    const oceanSpawnSystem = fs.readFileSync('src/systems/OceanSpawnSystem.ts', 'utf8');
    const retiredEventKeys = [
      'EVENT_DEAD_UPRISING_SHEET',
      'EVENT_INVASION_BREACH_SHEET',
      'EVENT_HELL_GATE_SHEET'
    ];
    const key = 'EVENT_OCEAN_EMERGENCE_SHEET';

    for (const retiredKey of retiredEventKeys) {
      expect((ASSET_KEYS as any)[retiredKey], `${retiredKey} should not be registered after reverting surprise-event centerpieces`).toBeUndefined();
      expect(renderEngine.includes(retiredKey), `${retiredKey} should not be consumed by the renderer`).toBe(false);
    }

    const rel = (ASSET_KEYS as any)[key];
    expect(rel, `${key} should be registered in the asset manifest`).toBeTruthy();
    expect(renderEngine.includes(key), `${key} should be consumed by the renderer, not only shipped as an unused asset`).toBe(true);
    const file = path.join(process.cwd(), 'public/assets/sprites', rel);
    expect(fs.existsSync(file), `${key} asset missing at ${file}`).toBe(true);
    const img = sharp(file).ensureAlpha();
    const meta = await img.metadata();
    expect(meta.width, `${key} should be a 3x3 grid of 256px frames`).toBe(768);
    expect(meta.height, `${key} should be a 3x3 grid of 256px frames`).toBe(768);
    expect(meta.hasAlpha, `${key} should keep a transparent background`).toBe(true);
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    let opaque = 0;
    let tinyAlpha = 0;
    let greenPixels = 0;
    const colorBuckets = new Set<string>();
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a > 0 && a <= 4) tinyAlpha++;
      if (a > 16) {
        opaque++;
        colorBuckets.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
        if (data[i + 1] > 150 && data[i + 1] > data[i] * 1.35 && data[i + 1] > data[i + 2] * 1.35) greenPixels++;
      }
    }
    const coverage = opaque / (info.width * info.height);
    expect(tinyAlpha, `${key} has alpha dust that can look like a dirty background`).toBe(0);
    expect(greenPixels, `${key} should not retain chroma-key green pixels`).toBe(0);
    expect(coverage, `${key} should have enough visible VFX mass to read in-game`).toBeGreaterThan(0.10);
    expect(coverage, `${key} should preserve transparent negative space`).toBeLessThan(0.72);
    expect(colorBuckets.size, `${key} should have enough color variation to look like sprite art, not a flat coded shape`).toBeGreaterThan(30);
    expect(renderEngine.includes("texGridFrame('EVENT_OCEAN_EMERGENCE_SHEET', frame, 256, 256, 3)"), 'renderer should still slice the ocean emergence sheet as a 3x3 sprite animation').toBe(true);
    expect(renderEngine.includes('drawOceanEmergenceFx'), 'renderer should expose the ocean emergence sprite-sheet pass').toBe(true);
    expect(waveManager.includes('routeOceanSpawnToPath'), 'wave manager should route ocean spawns through the shared ocean helper').toBe(true);
    expect(oceanSpawnSystem.includes('__oceanSurgeStartedAt'), 'ocean waves should record a start tick for sprite-sheet timing').toBe(true);
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

  it('hero projectile and impact sprite assets are registered and transparent', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const sharp = (await import('sharp')).default;
    const assets = [
      { key: 'HERO_PROJ_AGRIPPA_BOLT', file: 'hero_proj_agrippa_bolt.png', w: 96, h: 96, frames: 1 },
      { key: 'HERO_PROJ_AGRICOLA_ARROW', file: 'hero_proj_agricola_arrow.png', w: 96, h: 96, frames: 1 },
      { key: 'HERO_PROJ_SULLA_METEOR', file: 'hero_proj_sulla_meteor.png', w: 96, h: 96, frames: 1 },
      { key: 'HERO_IMPACT_MARIUS', file: 'hero_impact_marius_sheet.png', w: 768, h: 128, frames: 6 },
      { key: 'HERO_IMPACT_AGRIPPA', file: 'hero_impact_agrippa_sheet.png', w: 768, h: 128, frames: 6 },
      { key: 'HERO_IMPACT_AGRICOLA', file: 'hero_impact_agricola_sheet.png', w: 768, h: 128, frames: 6 },
      { key: 'HERO_IMPACT_SCIPIO', file: 'hero_impact_scipio_sheet.png', w: 768, h: 128, frames: 6 },
      { key: 'HERO_IMPACT_CAESAR', file: 'hero_impact_caesar_sheet.png', w: 768, h: 128, frames: 6 },
      { key: 'HERO_IMPACT_SULLA', file: 'hero_impact_sulla_sheet.png', w: 768, h: 128, frames: 6 }
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
      const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
      let tinyAlpha = 0;
      let chromaResidue = 0;
      let visible = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 0 && data[i + 3] <= 4) tinyAlpha++;
        if (data[i + 3] > 16) {
          visible++;
          if (data[i + 1] > 95 && data[i + 1] > data[i] * 1.35 && data[i + 1] > data[i + 2] * 1.35) chromaResidue++;
        }
      }
      expect(tinyAlpha, `${asset.file} has alpha dust`).toBe(0);
      expect(chromaResidue, `${asset.file} has chroma-key residue`).toBe(0);
      expect(visible / (info.width * info.height), `${asset.file} should preserve transparent negative space`).toBeLessThan(0.60);
      const frameW = asset.frames === 1 ? asset.w : asset.w / asset.frames;
      for (let frame = 0; frame < asset.frames; frame++) {
        const raw = await sharp(file)
          .extract({ left: frame * frameW, top: 0, width: frameW, height: asset.h })
          .ensureAlpha()
          .raw()
          .toBuffer();
        const bounds = alphaBounds(raw, Math.max(frameW, asset.h));
        expect(bounds.width, `${asset.file} frame ${frame + 1} should contain visible art`).toBeGreaterThan(10);
        expect(bounds.height, `${asset.file} frame ${frame + 1} should contain visible art`).toBeGreaterThan(10);
      }
    }
    const render = readFileSync('src/render/RenderEngine.ts', 'utf8');
    const main = readFileSync('src/main.ts', 'utf8');
    expect(render).toContain('triggerSpriteImpact');
    expect(render).toContain('MAX_TRANSIENT_SPRITE_IMPACTS');
    expect(main).toContain('function heroImpactKeyForTowerType');
    expect(main).toContain('triggerHeroHitImpact(tw, hx, hy)');
  });

  it('every hero ability has explicit sprite or sheet VFX coverage', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const sharp = (await import('sharp')).default;
    const renderer = readFileSync('src/render/RenderEngine.ts', 'utf8');
    const abilityIds = Object.values(HERO_DEFS as any).flatMap((def: any) => (def.abilities ?? []).map((ability: any) => ability.id));
    expect(new Set(abilityIds).size, 'hero ability ids should be unique').toBe(abilityIds.length);

    for (const abilityId of abilityIds) {
      const coverage = (HERO_ABILITY_VFX_ASSETS as any)[abilityId];
      expect(coverage, `${abilityId} must be registered in HERO_ABILITY_VFX_ASSETS`).toBeTruthy();
      expect(coverage.description, `${abilityId} should explain its visual identity`).toBeTruthy();
      const keys = [...(coverage.spriteKeys ?? []), ...(coverage.sheetKeys ?? [])];
      expect(keys.length, `${abilityId} must name at least one sprite/sheet key`).toBeGreaterThan(0);
      expect(renderer, `${abilityId} must have a drawHeroAbilityFx renderer case`).toContain(`case '${abilityId}'`);

      for (const key of keys) {
        const assetPath = (ASSET_KEYS as any)[key];
        expect(assetPath, `${abilityId} references missing asset key ${key}`).toBeTruthy();
        if (!String(assetPath).startsWith('../heroes/attacks/')) continue;
        const file = path.join(process.cwd(), 'public/assets/heroes/attacks', String(assetPath).replace('../heroes/attacks/', ''));
        expect(fs.existsSync(file), `${abilityId} asset ${key} missing at ${file}`).toBe(true);
        const img = sharp(file).ensureAlpha();
        const meta = await img.metadata();
        expect(meta.width, `${abilityId} asset ${key} width`).toBeGreaterThanOrEqual(32);
        expect(meta.height, `${abilityId} asset ${key} height`).toBeGreaterThanOrEqual(32);
        expect(meta.hasAlpha, `${abilityId} asset ${key} should have transparency`).toBe(true);
        const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
        let visible = 0;
        let chromaResidue = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] <= 16) continue;
          visible++;
          if (data[i + 1] > 95 && data[i + 1] > data[i] * 1.35 && data[i + 1] > data[i + 2] * 1.35) chromaResidue++;
        }
        expect(visible, `${abilityId} asset ${key} should contain visible sprite art`).toBeGreaterThan(64);
        expect(visible / (info.width * info.height), `${abilityId} asset ${key} should preserve transparent negative space`).toBeLessThan(0.82);
        expect(chromaResidue, `${abilityId} asset ${key} should not retain chroma-key residue`).toBe(0);
      }
    }
    expect(Object.keys(HERO_ABILITY_VFX_ASSETS).sort(), 'ability VFX registry should not carry stale abilities').toEqual([...abilityIds].sort());
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
  it('insufficient-gold purchases play the More Gold cue across buying surfaces', () => {
    const fs = require('fs');
    const audio = fs.readFileSync('src/render/AudioManager.ts', 'utf8');
    const main = fs.readFileSync('src/main.ts', 'utf8');
    const shop = fs.readFileSync('src/render/ShopUI.ts', 'utf8');
    const harbor = fs.readFileSync('src/render/HarborDraftModal.ts', 'utf8');
    const relics = fs.readFileSync('src/render/CampaignRelicModal.ts', 'utf8');
    const ui = fs.readFileSync('src/render/UIManager.ts', 'utf8');
    const comboPicker = fs.readFileSync('src/render/ComboPicker.ts', 'utf8');
    const towerMenu = fs.readFileSync('src/render/TowerMenu.ts', 'utf8');
    const cue = 'assets/sfx/more_gold.mp3';

    expect(fs.existsSync(`public/${cue}`), 'missing More Gold MP3 asset').toBe(true);
    expect(fs.statSync(`public/${cue}`).size, 'More Gold MP3 asset should not be empty').toBeGreaterThan(1000);
    expect(audio.includes(`'${cue}'`), 'More Gold MP3 should be preloaded').toBe(true);
    expect(audio.includes(`moreGold:       () => playSample(sfx('${cue}')`), 'SFX.moreGold should play the MP3').toBe(true);
    expect(main).toContain('function showInsufficientGoldToast');
    expect(main).toContain('SFX.moreGold();');
    expect(main, 'prospect placement should use the shared insufficient-gold feedback').toContain('showInsufficientGoldToast(1,');
    expect(shop, 'Hero Forge should use the shared insufficient-gold feedback').toContain('__showInsufficientGoldToast?.(cost, ax, ay)');
    expect(shop, 'Hero Forge should not call the old missing cancel cue').not.toContain('uiCancel?.();');
    expect(harbor, 'Harbor unaffordable offers should stay clickable and show feedback').toContain('NEED ${o.price - state.gold}g');
    expect(harbor).toContain('__showInsufficientGoldToast?.(offer.price, ax, ay)');
    expect(relics, 'gold-cost relics should stay clickable for feedback instead of being disabled').not.toContain('card.disabled = !affordability.canAfford');
    expect(relics).toContain('__showInsufficientGoldToast?.(latest.goldCost, ax, ay)');
    expect(ui, 'pool upgrade should remain clickable when gold is short so the shared feedback can fire').not.toContain('|| !canAfford(state, uc)');
    expect(comboPicker, 'combo picker location chips should not be disabled before feedback can fire').not.toContain('chip.disabled = !canAfford');
    expect(comboPicker).toContain('__showInsufficientGoldToast?.(cb.cost, ax, ay)');
    expect(towerMenu).toContain('__showInsufficientGoldToast?.(resolved.cost, ax, ay)');
  });

  it('Supercombo and Omega crafted towers play their dedicated MP3 cue', () => {
    const fs = require('fs');
    const audio = fs.readFileSync('src/render/AudioManager.ts', 'utf8');
    const main = fs.readFileSync('src/main.ts', 'utf8');
    const cue = 'assets/sfx/super_omega_combo.mp3';

    expect(fs.existsSync(`public/${cue}`), 'missing Super/Omega combo MP3 asset').toBe(true);
    expect(fs.statSync(`public/${cue}`).size, 'Super/Omega combo MP3 asset should not be empty').toBeGreaterThan(1000);
    expect(audio.includes(`'${cue}'`), 'Super/Omega combo MP3 should be preloaded').toBe(true);
    expect(audio.includes(`superOmegaCombo: () => playSample(sfx('${cue}')`), 'SFX.superOmegaCombo should play the MP3').toBe(true);
    expect(main).toContain('function isSuperOrOmegaComboResult');
    expect(main).toContain("ability.includes('SUPERCOMBO')");
    expect(main).toContain("ability.includes('OMEGA COMBO')");
    expect(main).toContain("ability.includes('COMBO-OF-COMBO')");
    expect(main).toContain('towerType === TowerType.MARS_VICTOR');
    expect(main).toContain('function playComboCreationSfx');
    expect(main).toContain('SFX.superOmegaCombo();');
    expect(main.split('playComboCreationSfx(').length - 1, 'all three Solo crafted-combo success paths should use the class-aware cue helper').toBeGreaterThanOrEqual(4);
  });

  it('regular recipe combo towers play the level-up MP3 without replacing merge or Super/Omega cues', () => {
    const fs = require('fs');
    const audio = fs.readFileSync('src/render/AudioManager.ts', 'utf8');
    const main = fs.readFileSync('src/main.ts', 'utf8');
    const cue = 'assets/sfx/combo_tower_made.mp3';

    expect(fs.existsSync(`public/${cue}`), 'missing regular combo-tower MP3 asset').toBe(true);
    expect(fs.statSync(`public/${cue}`).size, 'regular combo-tower MP3 asset should not be empty').toBeGreaterThan(1000);
    expect(audio.includes(`'${cue}'`), 'regular combo-tower MP3 should be preloaded').toBe(true);
    expect(audio.includes(`comboTowerMade: () => playSample(sfx('${cue}')`), 'SFX.comboTowerMade should play the MP3').toBe(true);
    expect(main).toContain('function playComboCreationSfx(resultType: TowerType | string, isSameTierMerge = false)');
    expect(main).toContain('if (isSameTierMerge)');
    expect(main).toContain('SFX.comboMade();');
    expect(main).toContain('SFX.superOmegaCombo();');
    expect(main).toContain('SFX.comboTowerMade();');
    expect(main).toContain('playComboCreationSfx(resolvedTarget.result, !!resolvedTarget.isSameTierMerge)');
    expect(main).toContain('playComboCreationSfx(pickerResolved.result, !!pickerResolved.isSameTierMerge)');
  });

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

  it('ocean enemy emergence plays the replacement murloc cue and keeps the old MP3 removed', () => {
    const fs = require('fs');
    const audio = fs.readFileSync('src/render/AudioManager.ts', 'utf8');
    const main = fs.readFileSync('src/main.ts', 'utf8');
    const waveManager = fs.readFileSync('src/systems/WaveManager.ts', 'utf8');
    const oceanSpawnSystem = fs.readFileSync('src/systems/OceanSpawnSystem.ts', 'utf8');
    const oldCue = 'assets/sfx/ocean_emerge.mp3';
    const cue = 'assets/sfx/murloc.mp3';

    expect(fs.existsSync(`public/${oldCue}`), 'old ocean emergence MP3 should stay removed from shipped assets').toBe(false);
    expect(audio.includes(`'${oldCue}'`), 'old ocean emergence MP3 should not be preloaded').toBe(false);
    expect(audio.includes('oceanEmerge:'), 'old SFX.oceanEmerge method should stay removed').toBe(false);
    expect(fs.existsSync(`public/${cue}`), 'missing replacement murloc MP3 asset').toBe(true);
    expect(audio.includes(`'${cue}'`), 'murloc MP3 should be preloaded').toBe(true);
    expect(audio.includes(`oceanMurloc:    () => playSample(sfx('${cue}')`), 'SFX.oceanMurloc should play the replacement MP3').toBe(true);
    expect(main.includes('__oceanEmergenceSfx'), 'main should expose the replacement ocean emergence audio hook').toBe(true);
    expect(main.includes('SFX.oceanMurloc()'), 'main ocean hook should play the replacement murloc cue').toBe(true);
    expect(waveManager.includes('routeOceanSpawnToPath'), 'WaveManager should still use the ocean route helper').toBe(true);
    expect(oceanSpawnSystem.includes('markOceanEmergenceOnce'), 'shared ocean helper should still mark the visual ocean surge once per wave').toBe(true);
  });

  it('DPS Check keeps the normal tower and hero attack SFX hooks alive', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    const renderEngine = readFileSync('src/render/RenderEngine.ts', 'utf8');
    const start = main.indexOf('const dpsCombatHooks = {');
    const end = main.indexOf('tickBurnPatches(state, dt);', start);
    const dpsBlock = main.slice(start, end);

    expect(main).toContain('function playTowerMeleeAttackSfx');
    expect(main).toContain('function playTowerProjectileAttackSfx');
    expect(main).toContain('function emitTowerMeleeAttackVisual');
    expect(main).toContain('function emitTowerProjectileAttackVisual');
    expect(main).toContain("'HERO_AGRIPPA'");
    expect(main).toContain("'HERO_SULLA'");
    expect(renderEngine, 'DPS Check runs pre-wave, so attack sheets must be allowed outside WAVE_PHASE while the dummy is active').toContain("!!(state as any).__dpsCheckActive");
    expect(dpsBlock, 'DPS Check should credit current-wave tower damage so the in-game leaderboard shows per-tower contribution').toContain('t.damageThisWave = (t.damageThisWave ?? 0) + Math.max(0, d)');
    expect(dpsBlock, 'DPS Check should not inflate lifetime run damage with training-dummy hits').not.toContain('t.totalDamageDealt +=');
    expect(dpsBlock, 'DPS melee swings should use the same attack visuals as live waves').toContain('emitTowerMeleeAttackVisual(t, e, false)');
    expect(dpsBlock, 'DPS projectile fires should use the same attack visuals as live waves').toContain('emitTowerProjectileAttackVisual(t, target)');
    expect(main, 'shared projectile helper should still play attack audio').toContain('playTowerProjectileAttackSfx(t)');
    expect(main, 'shared projectile helper should still create muzzle flashes').toContain('renderer.triggerMuzzleFlash(tipX, tipY');
    expect(dpsBlock, 'DPS projectile audio hook must not regress to a silent no-op').not.toContain('onProjectileFire: () => {}');
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

  it('keeps codex text inside a real brown scroll body instead of overflowing over the map', () => {
    const fs = require('fs');
    const source = fs.readFileSync('src/render/Codex.ts', 'utf8');
    expect(source).toContain('overflow:hidden');
    expect(source).toContain('display:flex;flex-direction:column');
    expect(source).toContain('height:min(860px,calc(100vh - 32px))');
    expect(source).toContain('class="rtd-codex-scroll-body"');
    expect(source).toContain('flex:1 1 auto;min-height:0;overflow:auto');
    expect(source).toContain('background:#0c0a08;border:1px solid #3a3025;padding:10px');
    expect(source).toContain('scrollbar-gutter:stable both-edges');
  });
});

describe('Modal ergonomics and popup stacking', () => {
  it('offers Harbor Draft access only after clearing ocean-threat waves', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    const harborSystem = readFileSync('src/systems/HarborSystem.ts', 'utf8');
    const harborModal = readFileSync('src/render/HarborDraftModal.ts', 'utf8');
    const killBlock = main.slice(
      main.indexOf('if (shouldUnlockHarborFromKill(state, e.type) && markHarborUnlocked(state))'),
      main.indexOf('// 2026-05-16', main.indexOf('if (shouldUnlockHarborFromKill(state, e.type) && markHarborUnlocked(state))'))
    );
    const waveEndBlock = main.slice(
      main.indexOf('const offerHarborDraftThenContinue'),
      main.indexOf('const offerBossTrophyThenContinue')
    );

    expect(harborSystem).toContain('export function waveHasOceanThreats');
    expect(harborSystem).toContain('export function queueHarborDraftForClearedOceanWave');
    expect(harborSystem).toContain('__pendingHarborWaveDraft = state.wave');
    expect(harborSystem).toContain('buildHarborDraftOffers(state, true);');
    expect(harborSystem).toContain('scratch.__harborDraftWave !== state.wave');
    expect(harborSystem).toContain('Ocean threat wave ${state.wave} cleared');
    expect(killBlock, 'Harbor unlock should not open a Harbor modal mid-wave on the kill frame').not.toContain('showHarborUnlockModal(state)');
    expect(killBlock, 'Harbor unlock should not open the wave-clear modal mid-wave on the kill frame').not.toContain('showHarborWaveClearModal(state');
    expect(main).toContain('queueHarborDraftForClearedOceanWave(state);');
    expect(waveEndBlock).toContain('__pendingHarborWaveDraft');
    expect(waveEndBlock).toContain('showHarborWaveClearModal(state, pendingWave, () => {');
    expect(waveEndBlock).toContain('showHarborDraftModal(state, buildHarborDraftOffers(state, true)');
    expect(main).toContain('offerHarborDraftThenContinue(offerTestYourMightOrCampaignRelic)');
    expect(main).not.toContain("showHarborDraftModal(state, buildHarborDraftOffers(state), () => updateHeroPlacementBanner());");
    expect(main).toContain('Buy naval contracts from the Harbor panel after clearing water-enemy waves');
    expect(harborModal).toContain('VIEW NAVAL CONTRACTS');
    expect(harborModal).toContain('PASS THIS DRAFT');
    expect(harborModal).toContain('showHarborWaveClearModal(state: GameStateShape, clearedWave: number, onOpenDraft?: () => void)');
    expect(harborModal).toContain('onOpenDraft?.();');
    expect(harborModal).toContain('You may also pass. The Harbor quartermaster returns with a refreshed draft after the next cleared wave that included water-based enemies.');
    expect(harborModal).toContain('A fresh draft appears after every cleared water-enemy wave.');
  });

  it('shows full naval contract stats and details in the Harbor Draft', () => {
    const harborModal = readFileSync('src/render/HarborDraftModal.ts', 'utf8');
    expect(harborModal).toContain('function navalContractSpriteHtml');
    expect(harborModal).toContain('texUrl(type)');
    expect(harborModal).toContain('Actual in-game sprite shown above.');
    expect(harborModal).toContain('function navalRecipeHintHtml');
    expect(harborModal).toContain('purchaseRecipeHints(state, offer.type, offer.tier, 3)');
    expect(harborModal).toContain('RECIPE ALERT');
    expect(harborModal).toContain('This contract completes');
    expect(harborModal).toContain('Does not complete a recipe with your current towers yet.');
    expect(harborModal).toContain('function navalContractDetailsHtml');
    expect(harborModal).toContain('towerStatBreakdown(preview, state as any)');
    expect(harborModal).toContain('Each card shows the tier-adjusted stats you are buying and whether the contract completes a recipe right now.');
    for (const label of ['DPS', 'ATK/S', 'RANGE', 'TYPE', 'CRIT', 'PLACE']) {
      expect(harborModal, `Harbor Draft should show ${label} detail`).toContain(`['${label}'`);
    }
    expect(harborModal).toContain('<b style="color:#ffd34d">Ability:</b>');
    expect(harborModal).toContain('max-height:min(70vh,650px);overflow-y:auto');
    expect(harborModal).toContain('grid-template-columns:repeat(auto-fit,minmax(260px,1fr))');
  });

  it('ships one shared collapse and drag helper for major player-facing panels', () => {
    const helper = readFileSync('src/render/ModalErgonomics.ts', 'utf8');
    expect(helper).toContain('export function enhanceModalErgonomics');
    expect(helper).toContain('export function makePanelDraggable');
    expect(helper).toContain('is-rtd-collapsed');
    expect(helper).toContain('collapseTargetsFor');
    expect(helper).toContain('directChildren.slice(1)');
    expect(helper).toContain('is-rtd-summary-collapse');
    expect(helper).toContain('Drag this handle to move the panel');
    expect(helper).toContain("setAttribute('role'");
    expect(helper).toContain('rtd:viewport-change');
  });

  it('applies collapsible or movable ergonomics to the largest recurring choice panels', () => {
    const files = [
      'src/render/CampaignRelicModal.ts',
      'src/render/BossTrophyModal.ts',
      'src/render/TestYourMightModal.ts',
      'src/render/HarborDraftModal.ts',
      'src/render/LastStandTrove.ts',
      'src/render/SecretEvents.ts',
      'src/render/SurpriseReward.ts',
      'src/render/ComboPicker.ts',
      'src/render/TowerMenu.ts',
      'src/render/ShopUI.ts',
      'src/render/Codex.ts',
      'src/render/TowerLeaderboard.ts',
      'src/render/ComboPreview.ts',
      'src/render/SandboxPanel.ts',
      'src/render/SettingsPanel.ts',
      'src/main.ts'
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} should use shared modal ergonomics`).toContain('enhanceModalErgonomics');
    }
  });

  it('keeps tower and hero inspect details inside a real scroll body', () => {
    const source = readFileSync('src/render/TowerMenu.ts', 'utf8');
    expect(source).toContain('rtd-tower-menu-scroll-body');
    expect(source).toContain("'overflow-y:auto'");
    expect(source).toContain("'flex:1'");
    expect(source).toContain("panel.style.maxHeight = 'calc(100vh - 32px)'");
    expect(source).toContain("panel.style.height = 'min(900px, calc(100vh - 32px))'");
    expect(source).toContain("bodySelector: '.rtd-tower-menu-collapse'");
  });

  it('keeps enemy inspect details inside a real scroll body', () => {
    const source = readFileSync('src/render/EnemyInspect.ts', 'utf8');
    expect(source).toContain('rtd-enemy-inspect-scroll-body');
    expect(source).toContain("'overflow-y:auto'");
    expect(source).toContain("'flex:1'");
    expect(source).toContain('max-height:calc(100vh - 32px)');
    expect(source).toContain("bodySelector: '.rtd-enemy-inspect-collapse'");
    expect(source).toContain('markScrollable(body)');
    expect(source).not.toContain('markScrollable(modal)');
  });

  it('surfaces Vulture Imperator siege immunity in player-facing enemy copy', () => {
    const codex = readFileSync('src/render/Codex.ts', 'utf8');
    const enemyInspect = readFileSync('src/render/EnemyInspect.ts', 'utf8');
    const resist = readFileSync('src/systems/EnemyResistances.ts', 'utf8');
    expect(resist).toContain('[EnemyType.BOSS_FLYER_VULTURE]:');
    expect(resist).toContain('siege: 0');
    expect(codex).toContain('SIEGE-IMMUNE');
    expect(codex).toContain('non-siege flyer killers');
    expect(enemyInspect).toContain('SIEGE-IMMUNE — siege damage deals 0');
  });

  it('keeps mandatory decision modals expanded on every new offer', () => {
    for (const file of [
      'src/render/CampaignRelicModal.ts',
      'src/render/BossTrophyModal.ts',
      'src/render/TestYourMightModal.ts',
      'src/render/HarborDraftModal.ts',
      'src/render/LastStandTrove.ts',
      'src/render/SecretEvents.ts',
      'src/render/SurpriseReward.ts'
    ]) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} should not persist collapsed state for a required decision`).not.toContain('storageKey:');
    }
  });

  it('dispatches modal force-close cleanup before universal Escape removes panels', () => {
    const source = readFileSync('src/main.ts', 'utf8');
    expect(source).toContain("el.dispatchEvent(new CustomEvent('rtd:modal-force-close'))");
    const reward = readFileSync('src/render/SurpriseReward.ts', 'utf8');
    expect(reward).toContain("modal.addEventListener('rtd:modal-force-close'");
    expect(reward).toContain('__surpriseRewardOpen = false');
  });

  it('does not show Escape-key copy when close controls already exist', () => {
    const settings = readFileSync('src/render/SettingsPanel.ts', 'utf8');
    const codex = readFileSync('src/render/Codex.ts', 'utf8');
    const main = readFileSync('src/main.ts', 'utf8');
    const modalErgonomics = readFileSync('src/render/ModalErgonomics.ts', 'utf8');
    const shop = readFileSync('src/render/ShopUI.ts', 'utf8');
    expect(settings).not.toContain('Press ESC to close');
    expect(codex).not.toContain('<b>ESC</b> closes any open menu');
    expect(main).not.toContain('ESC cancels.');
    expect(shop).not.toContain('CLOSE (ESC)');
    expect(modalErgonomics).not.toContain("btn.textContent = 'Esc'");
    expect(modalErgonomics).not.toContain('Press Escape to close');
    expect(modalErgonomics).not.toContain('Escape closes this panel');
    expect(settings, 'Settings should still keep Escape functionality without advertising it').toContain("ev.key === 'Escape'");
    expect(modalErgonomics, 'Shared modals should still keep Escape functionality without advertising it').toContain("ev.key !== 'Escape'");
  });

  it('keeps Solo free of whole-screen shake and low-life red screen tint', () => {
    const renderer = readFileSync('src/render/RenderEngine.ts', 'utf8');
    const main = readFileSync('src/main.ts', 'utf8');
    const index = readFileSync('index.html', 'utf8');
    const bossWarning = readFileSync('src/render/BossWarning.ts', 'utf8');
    const codex = readFileSync('src/render/Codex.ts', 'utf8');
    const enemyInspect = readFileSync('src/render/EnemyInspect.ts', 'utf8');

    expect(renderer).toContain('Screen shake is intentionally disabled for Solo readability');
    expect(renderer).not.toContain('(Math.random() - 0.5) * 2 * this.shakeMagnitude');
    expect(renderer).toContain('this.app.stage.x = WORLD.OFFSET_X');
    expect(renderer).toContain('this.app.stage.y = WORLD.OFFSET_Y');

    expect(index).not.toContain('@keyframes loadingShake');
    expect(bossWarning).not.toContain('@keyframes bwShake');
    expect(bossWarning).not.toContain("classList.add('shake')");
    expect(main).not.toContain("classList.add('shake')");
    expect(bossWarning).not.toContain('renderer.triggerShake(6, 0.6)');

    expect(main).not.toContain("v.id = 'low-lives-vignette'");
    expect(main).not.toContain('@keyframes vignettePulse');
    expect(codex).not.toContain('Pulsing red border');
    expect(enemyInspect).not.toContain('screen shake');
  });

  it('does not stack the first-run teaching banner under name or hero gates', () => {
    const source = readFileSync('src/main.ts', 'utf8');
    expect(source).toContain('function queueFirstRoundBanner');
    expect(source).toContain("document.getElementById('etch-name-modal')");
    expect(source).toContain("document.getElementById('choose-hero-modal')");
    expect(source).toContain('!state.activeHeroId');
    expect(source).toContain("markTipSeen('first_run_intro')");
  });

  it('registers recent popup surfaces in the central modal cleanup list', () => {
    const source = readFileSync('src/render/ModalManager.ts', 'utf8');
    for (const id of [
      'quests-modal',
      'combo-info-modal',
      'last-stand-trove-modal',
      'harbor-unlock-modal',
      'harbor-draft-modal',
      'surprise-reward-modal',
      'sandbox-wave-picker',
      'sandbox-tower-picker'
    ]) {
      expect(source, `ModalManager should close stale ${id}`).toContain(`'${id}'`);
    }
  });
});
