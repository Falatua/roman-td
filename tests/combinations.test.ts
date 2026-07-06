// Tests for tower combination logic: same-tier merge + every recipe in towerCombinations.json.
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { scanCombos, realizableCombos, executeCombo, comboResultLocationChoices } from '../src/systems/CombinationEngine';
import { createTower } from '../src/systems/TowerSystem';
import { createGameState } from '../src/GameState';
import { TowerType, GamePhase, TileType } from '../src/types';
import { initializeGrid, setTile } from '../src/systems/GridManager';
import { buildGroundPath } from '../src/systems/PathFinder';
import comboData from '../src/data/towerCombinations.json';
import towersData from '../src/data/towers.json';

function bootstrapState() {
  const s = createGameState();
  initializeGrid(s);
  const p = buildGroundPath(s);
  if (p) s.groundPath = p;
  s.phase = GamePhase.BUILD_PHASE;
  s.gold = 1000;     // unlimited for test
  return s;
}

function placeTower(state: any, type: TowerType, tier: 1|2|3|4|5, x: number, y: number) {
  const t = createTower(type, tier, x, y, state.wave);
  state.towers.set(t.id, t);
  setTile(state, x, y, TileType.TOWER);
  return t;
}

describe('Same-tier merge detection', () => {
  it('detects 3-of-a-kind same-type same-tier as a merge candidate', () => {
    const s = bootstrapState();
    placeTower(s, TowerType.MILITES, 1, 5, 5);
    placeTower(s, TowerType.MILITES, 1, 5, 6);
    placeTower(s, TowerType.MILITES, 1, 5, 7);
    const combos = scanCombos(s);
    const merges = combos.filter(c => c.isSameTierMerge);
    expect(merges.length).toBeGreaterThan(0);
    expect(merges[0].result).toBe(TowerType.MILITES);
    expect(merges[0].resultTier).toBe(2);
  });

  it('lets the player choose a fourth matching tower as the same-tier merge result location', () => {
    const s = bootstrapState();
    placeTower(s, TowerType.MILITES, 1, 5, 5);
    placeTower(s, TowerType.MILITES, 1, 5, 6);
    placeTower(s, TowerType.MILITES, 1, 5, 7);
    const chosen = placeTower(s, TowerType.MILITES, 1, 8, 8);

    const merge = scanCombos(s).find(c => c.isSameTierMerge && c.result === TowerType.MILITES);
    expect(merge).toBeTruthy();
    expect(merge!.ingredients.map(t => t.id)).not.toContain(chosen.id);
    expect(comboResultLocationChoices(s, merge!).map(t => t.id)).toContain(chosen.id);

    const ok = executeCombo(s, merge!, chosen.id);
    expect(ok).toBe(true);
    const result = Array.from(s.towers.values()).find(t => t.type === TowerType.MILITES && t.qualityTier === 2);
    expect(result?.tileX).toBe(8);
    expect(result?.tileY).toBe(8);
    expect(s.towers.size).toBe(2);
  });

  it('does NOT trigger merge with only 2 of a kind', () => {
    const s = bootstrapState();
    placeTower(s, TowerType.HASTATI, 2, 1, 1);
    placeTower(s, TowerType.HASTATI, 2, 1, 2);
    const combos = scanCombos(s);
    const merges = combos.filter(c => c.isSameTierMerge);
    expect(merges.length).toBe(0);
  });

  it('does NOT trigger merge for mismatched tiers', () => {
    const s = bootstrapState();
    placeTower(s, TowerType.HASTATI, 1, 1, 1);
    placeTower(s, TowerType.HASTATI, 2, 1, 2);
    placeTower(s, TowerType.HASTATI, 3, 1, 3);
    const combos = scanCombos(s);
    const merges = combos.filter(c => c.isSameTierMerge);
    expect(merges.length).toBe(0);
  });

  it('T5 towers cannot merge (already at cap)', () => {
    const s = bootstrapState();
    placeTower(s, TowerType.MILITES, 5, 1, 1);
    placeTower(s, TowerType.MILITES, 5, 1, 2);
    placeTower(s, TowerType.MILITES, 5, 1, 3);
    const merges = scanCombos(s).filter(c => c.isSameTierMerge);
    expect(merges.length).toBe(0);
  });
});

describe('Recipe combo detection', () => {
  it('every recipe in the data file has at least one valid result tier and ingredients', () => {
    expect(comboData.length).toBeGreaterThan(0);
    for (const r of comboData) {
      expect(r.result).toBeTruthy();
      expect(r.tier).toBeGreaterThanOrEqual(2);
      expect(r.tier).toBeLessThanOrEqual(5);
      expect(r.ingredients.length).toBeGreaterThan(0);
      expect(r.cost).toBeGreaterThanOrEqual(0);
    }
  });

  it('detects HORSEMAN recipe (3x MILITES T2)', () => {
    const s = bootstrapState();
    placeTower(s, TowerType.MILITES, 2, 1, 1);
    placeTower(s, TowerType.MILITES, 2, 2, 1);
    placeTower(s, TowerType.MILITES, 2, 3, 1);
    const combos = scanCombos(s);
    const horseman = combos.find(c => c.result === TowerType.HORSEMAN && !c.isSameTierMerge);
    expect(horseman).toBeTruthy();
  });

  it('records recipe combo builds for quest progression from the engine', () => {
    const s: any = bootstrapState();
    const a = placeTower(s, TowerType.MILITES, 2, 1, 1);
    placeTower(s, TowerType.MILITES, 2, 2, 1);
    placeTower(s, TowerType.MILITES, 2, 3, 1);
    const horseman = scanCombos(s).find(c => c.result === TowerType.HORSEMAN && !c.isSameTierMerge)!;

    expect(executeCombo(s, horseman, a.id)).toBe(true);

    expect(s.combosBuilt).toBe(1);
    expect(s.combosBuiltUniqueTypes).toEqual([TowerType.HORSEMAN]);
  });

  it('detects SCORPION_BOLT recipe (Scorpio T2 + Velites T2)', () => {
    const s = bootstrapState();
    placeTower(s, TowerType.SCORPIO, 2, 5, 5);
    placeTower(s, TowerType.VELITES, 2, 5, 6);
    const combos = scanCombos(s);
    const sb = combos.find(c => c.result === TowerType.SCORPION_BOLT);
    expect(sb).toBeTruthy();
  });

  it('lets the player anchor a recipe combo on an alternate duplicate ingredient tower', () => {
    const s = bootstrapState();
    const firstScorpio = placeTower(s, TowerType.SCORPIO, 2, 5, 5);
    const chosenScorpio = placeTower(s, TowerType.SCORPIO, 2, 8, 8);
    const velites = placeTower(s, TowerType.VELITES, 2, 6, 5);

    const combo = scanCombos(s).find(c => c.result === TowerType.SCORPION_BOLT);
    expect(combo).toBeTruthy();
    expect(combo!.ingredients.map(t => t.id)).toContain(firstScorpio.id);
    expect(combo!.ingredients.map(t => t.id)).not.toContain(chosenScorpio.id);
    expect(comboResultLocationChoices(s, combo!).map(t => t.id)).toEqual(
      expect.arrayContaining([firstScorpio.id, chosenScorpio.id, velites.id])
    );

    const ok = executeCombo(s, combo!, chosenScorpio.id);
    expect(ok).toBe(true);
    const result = Array.from(s.towers.values()).find(t => t.type === TowerType.SCORPION_BOLT);
    expect(result?.tileX).toBe(8);
    expect(result?.tileY).toBe(8);
    expect(s.towers.has(firstScorpio.id)).toBe(true);
    expect(s.towers.has(velites.id)).toBe(false);
  });

  it('does NOT detect a recipe when ingredients are below minTier', () => {
    const s = bootstrapState();
    placeTower(s, TowerType.SCORPIO, 1, 5, 5);    // T1 fails minTier 2
    placeTower(s, TowerType.VELITES, 1, 5, 6);
    const combos = scanCombos(s);
    const sb = combos.find(c => c.result === TowerType.SCORPION_BOLT);
    expect(sb).toBeFalsy();
  });

  it('keeps the simplified super-combo recipes requested for Solo campaign', () => {
    const byResult = (result: string) => comboData.find((r: any) => r.result === result) as any;
    const types = (result: string) => byResult(result).ingredients.map((i: any) => i.type);

    expect(types('LEGION_PRIME')).toEqual(['IGNIFER', 'FLAMEN', 'CARROBALLISTA']);
    expect(types('LEGION_PRIME')).not.toContain('SPECULATOR');

    expect(types('CONSULAR_FATEBINDER')).toEqual(['PRAEFECTUS', 'VULCAN_ENGINEER', 'SOLAR_PRIEST']);
    expect(types('CONSULAR_FATEBINDER')).not.toContain('COLOSSUS_ONAGER');

    expect(types('BEASTLORD_CHAMPION')).toEqual(['BEAST_HUNTER', 'BEAST_SLAYER', 'PUGIO_ASSASSIN']);
    expect(types('BEASTLORD_CHAMPION').filter((t: string) => t === 'BEAST_SLAYER')).toHaveLength(1);
  });

  it('keeps every Beast Slayer combo ingredient at Tier 2', () => {
    const beastSlayerIngredients = (comboData as any[])
      .flatMap(recipe => recipe.ingredients.map((ingredient: any) => ({
        result: recipe.result,
        ...ingredient
      })))
      .filter(ingredient => ingredient.type === 'BEAST_SLAYER');

    expect(beastSlayerIngredients.length).toBeGreaterThan(0);
    for (const ingredient of beastSlayerIngredients) {
      expect(ingredient.minTier, ingredient.result).toBe(2);
    }
  });

  it('detects SIEGE_ONAGER with two T3 Scorpios only', () => {
    const recipe = comboData.find((r: any) => r.result === 'SIEGE_ONAGER') as any;
    expect(recipe.ingredients).toEqual([
      { type: 'SCORPIO', minTier: 3 },
      { type: 'SCORPIO', minTier: 3 }
    ]);

    const s = bootstrapState();
    placeTower(s, TowerType.SCORPIO, 3, 5, 5);
    placeTower(s, TowerType.SCORPIO, 3, 5, 6);
    const combos = scanCombos(s);
    const siege = combos.find(c => c.result === TowerType.SIEGE_ONAGER && !c.isSameTierMerge);
    expect(siege).toBeTruthy();
  });

  it('keeps Julius Caesar craftable with T4 Legate and T4 Primus Pilus', () => {
    const recipe = comboData.find((r: any) => r.result === 'JULIUS_CAESAR') as any;
    expect(recipe.ingredients).toEqual([
      { type: 'LEGATE', minTier: 4 },
      { type: 'PRIMUS_PILUS', minTier: 4 },
      { type: 'EAGLE_STANDARD', minTier: 4 }
    ]);

    const s = bootstrapState();
    placeTower(s, TowerType.LEGATE, 4, 5, 5);
    placeTower(s, TowerType.PRIMUS_PILUS, 4, 5, 6);
    placeTower(s, TowerType.EAGLE_STANDARD, 4, 5, 7);
    const combos = scanCombos(s);
    const caesar = combos.find(c => c.result === TowerType.JULIUS_CAESAR && !c.isSameTierMerge);
    expect(caesar).toBeTruthy();
  });

  it('keeps Fatebinder craftable with T4 apex ingredients', () => {
    const recipe = comboData.find((r: any) => r.result === 'CONSULAR_FATEBINDER') as any;
    expect(recipe.ingredients).toEqual([
      { type: 'PRAEFECTUS', minTier: 4 },
      { type: 'VULCAN_ENGINEER', minTier: 4 },
      { type: 'SOLAR_PRIEST', minTier: 4 }
    ]);

    const s = bootstrapState();
    placeTower(s, TowerType.PRAEFECTUS, 4, 5, 5);
    placeTower(s, TowerType.VULCAN_ENGINEER, 4, 5, 6);
    placeTower(s, TowerType.SOLAR_PRIEST, 4, 5, 7);
    const combos = scanCombos(s);
    const fatebinder = combos.find(c => c.result === TowerType.CONSULAR_FATEBINDER && !c.isSameTierMerge);
    expect(fatebinder).toBeTruthy();
  });

  it('keeps Triumphator craftable with a T4 Imperator Guard', () => {
    const recipe = comboData.find((r: any) => r.result === 'TRIUMPHATOR') as any;
    expect(recipe.ingredients).toEqual([
      { type: 'EVOCATUS', minTier: 4 },
      { type: 'IMPERATOR_GUARD', minTier: 4 },
      { type: 'PRAEFECTUS', minTier: 4 }
    ]);

    const s = bootstrapState();
    placeTower(s, TowerType.EVOCATUS, 4, 5, 5);
    placeTower(s, TowerType.IMPERATOR_GUARD, 4, 5, 6);
    placeTower(s, TowerType.PRAEFECTUS, 4, 5, 7);
    const combos = scanCombos(s);
    const triumphator = combos.find(c => c.result === TowerType.TRIUMPHATOR && !c.isSameTierMerge);
    expect(triumphator).toBeTruthy();
  });

  it('keeps Bestiarius craftable without Hastati', () => {
    const recipe = comboData.find((r: any) => r.result === 'BESTIARIUS') as any;
    expect(recipe.ingredients).toEqual([
      { type: 'BEAST_SLAYER', minTier: 2 },
      { type: 'AUXILIA', minTier: 3 }
    ]);
    expect(recipe.ingredients.map((ingredient: any) => ingredient.type)).not.toContain('HASTATI');

    const s = bootstrapState();
    placeTower(s, TowerType.BEAST_SLAYER, 2, 5, 5);
    placeTower(s, TowerType.AUXILIA, 3, 5, 6);
    const combos = scanCombos(s);
    const bestiarius = combos.find(c => c.result === TowerType.BESTIARIUS && !c.isSameTierMerge);
    expect(bestiarius).toBeTruthy();
  });

  it('keeps Scout Vexillum craftable without Velites', () => {
    const recipe = comboData.find((r: any) => r.result === 'SCOUT_VEXILLUM') as any;
    expect(recipe.ingredients).toEqual([
      { type: 'FUNDIBULUS', minTier: 2 },
      { type: 'RORARIUS', minTier: 2 }
    ]);
    expect(recipe.ingredients.map((ingredient: any) => ingredient.type)).not.toContain('VELITES');

    const s = bootstrapState();
    placeTower(s, TowerType.FUNDIBULUS, 2, 5, 5);
    placeTower(s, TowerType.RORARIUS, 2, 5, 6);
    const combos = scanCombos(s);
    const scoutVexillum = combos.find(c => c.result === TowerType.SCOUT_VEXILLUM && !c.isSameTierMerge);
    expect(scoutVexillum).toBeTruthy();
  });

  it('keeps Plague Cart craftable with only Velites and Hastati', () => {
    const recipe = comboData.find((r: any) => r.result === 'PLAGUE_CART') as any;
    expect(recipe.ingredients).toEqual([
      { type: 'VELITES', minTier: 3 },
      { type: 'HASTATI', minTier: 2 }
    ]);

    const s = bootstrapState();
    placeTower(s, TowerType.VELITES, 3, 5, 5);
    placeTower(s, TowerType.HASTATI, 2, 5, 6);
    const combos = scanCombos(s);
    const plagueCart = combos.find(c => c.result === TowerType.PLAGUE_CART && !c.isSameTierMerge);
    expect(plagueCart).toBeTruthy();
  });

  it('rewards harder-to-assemble nested combos with higher DPS', () => {
    // 2026-06-29 — JB: combos whose recipes are rarer/harder (nested combo
    // ingredients, high min-tiers, big cost) should be stronger. DPS now
    // rides a difficulty-monotonic ladder; the apex 3-nested super-combos
    // and the two-T5-super-combo siege towers top the chart (under Mars).
    const expectedBoosted: Partial<Record<TowerType, number>> = {
      [TowerType.WAR_CHARIOT]: 112.0,
      [TowerType.INFERNO_CART]: 60.5,
      [TowerType.FROZEN_LEGION]: 175.0,
      [TowerType.JULIUS_CAESAR]: 140.0,
      [TowerType.GOD_OF_WAR]: 350.0,
      [TowerType.TURMA_LANCERS]: 155.0,
      [TowerType.AURORA_LEGION]: 168.0,
      [TowerType.STORM_VEXILLATION]: 172.0,
      [TowerType.IMPERIUM_ETERNUM]: 380.0,
      [TowerType.CARTHAGE_SCOURGE]: 335.0,
      [TowerType.HANNIBALS_NIGHTMARE]: 235.0,
      [TowerType.MARS_VICTOR]: 1718.8
    };
    for (const [type, expectedDps] of Object.entries(expectedBoosted)) {
      expect((towersData as any)[type].baseDps).toBe(expectedDps);
    }
    expect((towersData as any)[TowerType.COHORT_GUARD].baseDps).toBe(79.9);
  });

  it('keeps previously underpaying combo investments on the new payoff line', () => {
    const expectedInvestmentDps: Partial<Record<TowerType, number>> = {
      [TowerType.PLAGUE_CART]: 42.0,
      [TowerType.NUMIDIAN_CAVALRY]: 255.0,
      [TowerType.TRIPLEX_ACIES]: 170.5,
      [TowerType.SKYREAPER_BATTERY]: 190.0,
      [TowerType.VULCAN_COLOSSUS]: 275.0
    };
    for (const [type, expectedDps] of Object.entries(expectedInvestmentDps)) {
      expect((towersData as any)[type].baseDps).toBe(expectedDps);
    }
  });

  it('keeps Bestiarius on the faster fury-loop line', () => {
    const bestiarius = (towersData as any)[TowerType.BESTIARIUS];
    expect(bestiarius.kind).toBe('COMBO');
    expect(bestiarius.tierBand).toBe(4);
    expect(bestiarius.attackSpeed).toBe(2.2);
    expect(bestiarius.ability).toContain('rapid polearm strikes at 2.2/s');
  });

  it('boosts labeled supercombo towers by 10 percent without touching Hannibal Nightmare', () => {
    expect((towersData as any)[TowerType.TRIPLEX_ACIES].baseDps).toBe(170.5);
    expect((towersData as any)[TowerType.LEGION_PRIME].baseDps).toBe(134.6);
    expect((towersData as any)[TowerType.CONSULAR_FATEBINDER].baseDps).toBe(250.8);
    expect((towersData as any)[TowerType.HANNIBALS_NIGHTMARE].baseDps).toBe(235.0);
  });

  it('adds four new recipe-only supercombo towers from previously unused combo ingredients', () => {
    const byResult = (result: string) => comboData.find((r: any) => r.result === result) as any;
    expect(byResult('SKY_DOMINION').ingredients).toEqual([
      { type: 'SKYREAPER_BATTERY', minTier: 4 },
      { type: 'NUMIDIAN_CAVALRY', minTier: 4 },
      { type: 'VANGUARD_WING', minTier: 4 }
    ]);
    expect(byResult('AUREATE_TRIBUNAL').ingredients).toEqual([
      { type: 'AERARIUM', minTier: 4 },
      { type: 'TRIUMVIRATE', minTier: 5 },
      { type: 'SACER_VESTAL', minTier: 4 }
    ]);
    expect(byResult('GLACIAL_PALISADE').ingredients).toEqual([
      { type: 'FROZEN_LEGION', minTier: 4 },
      { type: 'SACRED_BAND', minTier: 4 },
      { type: 'CATAPHRACT_LANCER', minTier: 4 }
    ]);
    expect(byResult('INFERNAL_COLOSSUS').ingredients).toEqual([
      { type: 'VULCAN_COLOSSUS', minTier: 5 },
      { type: 'GOD_OF_WAR', minTier: 5 },
      { type: 'TRIUMPHATOR', minTier: 5 }
    ]);
    for (const type of ['SKY_DOMINION', 'AUREATE_TRIBUNAL', 'GLACIAL_PALISADE', 'INFERNAL_COLOSSUS']) {
      const def = (towersData as any)[type];
      expect(def?.kind).toBe('COMBO');
      expect(def?.tierBand).toBe(5);
      expect(def?.ability).toContain('SUPERCOMBO');
    }
  });

  it('adds Roman Transformer as the first Omega combo from Hannibal and Caesar', () => {
    const recipe = comboData.find((r: any) => r.result === 'ROMAN_TRANSFORMER') as any;
    expect(recipe).toBeTruthy();
    expect(recipe.tier).toBe(5);
    expect(recipe.cost).toBe(300);
    expect(recipe.ingredients).toEqual([
      { type: 'HANNIBALS_NIGHTMARE', minTier: 5 },
      { type: 'JULIUS_CAESAR', minTier: 5 }
    ]);

    const def = (towersData as any)[TowerType.ROMAN_TRANSFORMER];
    expect(def?.kind).toBe('COMBO');
    expect(def?.omega).toBe(true);
    expect(def?.damageType).toBe('DIVINE');
    expect(def?.melee).toBe(true);
    expect(def?.range).toBe(6.0);
    expect(def?.ability).toContain('OMEGA COMBO');
  });

  it('ships transparent sprite assets for the new supercombo towers', () => {
    for (const file of ['ts_sky_dominion.png', 'ts_aureate_tribunal.png', 'ts_glacial_palisade.png', 'ts_infernal_colossus.png', 'ts_roman_transformer.png']) {
      expect(existsSync(path.join(process.cwd(), 'public/assets/sprites', file)), file).toBe(true);
    }
  });
});

describe('Combo execution', () => {
  it('successfully executes a same-tier merge', () => {
    const s = bootstrapState();
    const a = placeTower(s, TowerType.MILITES, 1, 1, 1);
    placeTower(s, TowerType.MILITES, 1, 1, 2);
    placeTower(s, TowerType.MILITES, 1, 1, 3);
    const merge = scanCombos(s).find(c => c.isSameTierMerge);
    expect(merge).toBeTruthy();
    const ok = executeCombo(s, merge!, a.id);
    expect(ok).toBe(true);
    // result tower should be at tier 2 with kept tile = a's tile
    const newTower = Array.from(s.towers.values()).find(t => t.qualityTier === 2);
    expect(newTower).toBeTruthy();
  });

  it('refunds gold to player when combo cost exceeds available gold', () => {
    const s = bootstrapState();
    s.gold = 1;     // not enough
    placeTower(s, TowerType.MILITES, 1, 1, 1);
    placeTower(s, TowerType.MILITES, 1, 1, 2);
    placeTower(s, TowerType.MILITES, 1, 1, 3);
    const merge = scanCombos(s).find(c => c.isSameTierMerge);
    const ok = executeCombo(s, merge!, merge!.ingredients[0].id);
    expect(ok).toBe(false);
    expect(s.gold).toBe(1);    // unchanged
  });

  it('Aerarium combo is blocked when goldTowerCount is already at max', () => {
    const s = bootstrapState();
    s.goldTowerCount = 3;
    placeTower(s, TowerType.LEGATE, 2, 1, 1);
    placeTower(s, TowerType.TRIARIUS, 2, 1, 2);
    const combos = scanCombos(s);
    const aer = combos.find(c => c.result === TowerType.AERARIUM);
    if (aer) {
      const ok = executeCombo(s, aer, aer.ingredients[0].id);
      expect(ok).toBe(false);
    }
  });

  // 2026-05-19 — Prospect-keep gate. User-reported: "I placed
  // down ten prospects, and then it let me combine towers even
  // when I was just in the prospecting phase. Before I decided
  // to keep the tower, you shouldn't be allowed to combo towers
  // until you keep them." Any pending ingredient blocks execution.
  it('refuses to execute when ALL ingredients are pending prospects', () => {
    const s = bootstrapState();
    s.phase = GamePhase.PROSPECT_PLACEMENT;
    const a = placeTower(s, TowerType.MILITES, 1, 1, 1); a.pending = true;
    const b = placeTower(s, TowerType.MILITES, 1, 1, 2); b.pending = true;
    const c = placeTower(s, TowerType.MILITES, 1, 1, 3); c.pending = true;
    const merge = scanCombos(s).find(cb => cb.isSameTierMerge);
    expect(merge).toBeTruthy();              // recipe is detectable
    const ok = executeCombo(s, merge!, a.id);
    expect(ok).toBe(false);                  // but execution refused
    // All three should still exist on the field unchanged.
    expect(s.towers.has(a.id)).toBe(true);
    expect(s.towers.has(b.id)).toBe(true);
    expect(s.towers.has(c.id)).toBe(true);
  });

  it('refuses to execute when ONE ingredient is pending and the rest are kept', () => {
    const s = bootstrapState();
    s.phase = GamePhase.PROSPECT_PLACEMENT;
    const a = placeTower(s, TowerType.MILITES, 1, 1, 1); a.pending = false; // kept
    const b = placeTower(s, TowerType.MILITES, 1, 1, 2); b.pending = false; // kept
    const c = placeTower(s, TowerType.MILITES, 1, 1, 3); c.pending = true;  // still pending
    const merge = scanCombos(s).find(cb => cb.isSameTierMerge);
    expect(merge).toBeTruthy();
    const ok = executeCombo(s, merge!, a.id);
    expect(ok).toBe(false);
    // Hint surfaces the rule so the player knows what to do.
    expect((s as any).hint).toMatch(/[Kk]eep.*prospect/);
  });

  it('allows execution once every ingredient has been kept', () => {
    const s = bootstrapState();
    s.phase = GamePhase.PROSPECT_PLACEMENT;
    const a = placeTower(s, TowerType.MILITES, 1, 1, 1); a.pending = false;
    const b = placeTower(s, TowerType.MILITES, 1, 1, 2); b.pending = false;
    const c = placeTower(s, TowerType.MILITES, 1, 1, 3); c.pending = false;
    const merge = scanCombos(s).find(cb => cb.isSameTierMerge);
    expect(merge).toBeTruthy();
    const ok = executeCombo(s, merge!, a.id);
    expect(ok).toBe(true);
    // Same-tier merge consumed the 3 and produced a higher-tier.
    const newTower = Array.from(s.towers.values()).find(t => t.qualityTier === 2);
    expect(newTower).toBeTruthy();
  });
});

describe('realizableCombos — keep-budget filter (2026-05-19)', () => {
  // The wrapper hides combos that need more pending keeps than the round
  // budget allows. Active in PROSPECT_PLACEMENT and PICK_KEEPER; no-op in
  // BUILD_PHASE (no pending towers exist by then anyway).

  it('hides a 3-pending-ingredient combo when keep budget is 2', () => {
    const s = bootstrapState();
    s.phase = GamePhase.PROSPECT_PLACEMENT;
    (s as any).keepsRemainingThisRound = 2;
    // PRAETORIAN_WALL needs PRIMUS_PILUS T3+, CENTURION T3+, HASTATI T3+.
    // Place all three as pending prospects.
    const a = placeTower(s, TowerType.PRIMUS_PILUS, 3, 1, 1); a.pending = true;
    const b = placeTower(s, TowerType.CENTURION,    3, 1, 2); b.pending = true;
    const c = placeTower(s, TowerType.HASTATI,      3, 1, 3); c.pending = true;
    const all = scanCombos(s).filter(cb => !cb.isSameTierMerge);
    const visible = realizableCombos(s).filter(cb => !cb.isSameTierMerge);
    expect(all.length).toBeGreaterThan(0);   // recipe is detectable
    expect(visible.length).toBe(0);          // but filtered out for player
  });

  it('shows a 3-ingredient combo when 1 ingredient is kept + 2 are pending (budget 2)', () => {
    const s = bootstrapState();
    s.phase = GamePhase.PROSPECT_PLACEMENT;
    (s as any).keepsRemainingThisRound = 2;
    const a = placeTower(s, TowerType.PRIMUS_PILUS, 3, 1, 1); a.pending = false; // kept from prior wave
    const b = placeTower(s, TowerType.CENTURION,    3, 1, 2); b.pending = true;
    const c = placeTower(s, TowerType.HASTATI,      3, 1, 3); c.pending = true;
    const visible = realizableCombos(s).filter(cb => cb.result === TowerType.PRAETORIAN_WALL);
    expect(visible.length).toBeGreaterThan(0);  // 2 pending fits the 2-keep budget
  });

  it('hides a 3-of-a-kind same-tier merge when all 3 are pending and budget is 2', () => {
    const s = bootstrapState();
    s.phase = GamePhase.PROSPECT_PLACEMENT;
    (s as any).keepsRemainingThisRound = 2;
    const a = placeTower(s, TowerType.MILITES, 1, 1, 1); a.pending = true;
    const b = placeTower(s, TowerType.MILITES, 1, 1, 2); b.pending = true;
    const c = placeTower(s, TowerType.MILITES, 1, 1, 3); c.pending = true;
    const visibleMerges = realizableCombos(s).filter(cb => cb.isSameTierMerge);
    expect(visibleMerges.length).toBe(0);
  });

  it('shows a 2-of-a-kind combo when both are pending and budget is 2', () => {
    const s = bootstrapState();
    s.phase = GamePhase.PROSPECT_PLACEMENT;
    (s as any).keepsRemainingThisRound = 2;
    // HORSEMAN needs 2× MILITES T2+ — exactly the keep budget.
    const a = placeTower(s, TowerType.MILITES, 2, 1, 1); a.pending = true;
    const b = placeTower(s, TowerType.MILITES, 2, 1, 2); b.pending = true;
    const visible = realizableCombos(s).filter(cb => cb.result === TowerType.HORSEMAN);
    expect(visible.length).toBeGreaterThan(0);
  });

  it('outside PROSPECT_PLACEMENT / PICK_KEEPER, no filtering is applied', () => {
    const s = bootstrapState();
    s.phase = GamePhase.BUILD_PHASE;   // budget irrelevant here
    (s as any).keepsRemainingThisRound = 0;
    // 3-ingredient recipe — all kept (no pending).
    placeTower(s, TowerType.PRIMUS_PILUS, 3, 1, 1);
    placeTower(s, TowerType.CENTURION,    3, 1, 2);
    placeTower(s, TowerType.HASTATI,      3, 1, 3);
    const all = scanCombos(s);
    const visible = realizableCombos(s);
    expect(visible.length).toBe(all.length);
  });
});
