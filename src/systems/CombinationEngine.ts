// CombinationEngine — same-tier merge + recipe combination logic.
//
// scanCombos: returns every executable combo on the current board.
//   - Same-tier merges (3 of same type+tier → next tier) DON'T mark towers
//     as "used", so cross-unit recipes that share the same towers still
//     surface (the player picks from the tower menu).
//   - Cross-unit recipes (towerCombinations.json) are checked greedily.
//
// executeCombo:
//   - Validates path remains traversable after the combo (rolling tile sims).
//   - Charges the recipe cost.
//   - Decrements goldTowerCount for any consumed Aerarium.
//   - Spawns the result tower at the player-chosen ingredient tile.
//   - Other ingredient tiles convert to STONE walls (preserves the maze).
//   - Carries forward kill counts + kill bonus from the ingredients.

import { Tower, TowerType, GamePhase } from '../types';
import { GameStateShape } from '../GameState';
import { ECONOMY, TIER_MULTS } from '../constants';
import { createTower } from './TowerSystem';
import { spendGold } from './EconomySystem';
import { setTile } from './GridManager';
import { TileType } from '../types';
import { buildGroundPath } from './PathFinder';
import comboData from '../data/towerCombinations.json';
import towersData from '../data/towers.json';
import { canEquipItemOnDamageType } from './ItemRules';
import { DamageType } from '../types';

// Per-tier merge cost (spec §3.4): T1=2g, T2=4g, T3=6g, T4=8g, T5 cannot merge.
const SAME_TIER_MERGE_COST: Record<number, number> = { 1: 2, 2: 4, 3: 6, 4: 8 };

export interface AvailableCombo {
  recipeIndex: number;
  result: TowerType;
  resultTier: number;
  cost: number;
  ingredients: Tower[];
  isSameTierMerge?: boolean;
}

// Find all recipes whose ingredients are present on the map.
// Greedy: a tower is consumed by at most one suggested recipe per scan.
// Includes BOTH cross-unit recipes AND same-tier 3-of-a-kind merges.
export function scanCombos(state: GameStateShape): AvailableCombo[] {
  // PENDING PROSPECTS ARE ELIGIBLE INGREDIENTS but we prefer KEPT towers
  // first. 2026-05 v11: the greedy match below sorts non-pending towers
  // to the front of the candidate list, so combos that can be satisfied
  // with already-saved towers ALONE never accidentally consume a fresh
  // prospect. Pending prospects only fill in if no kept tower can.
  // Effect: during PROSPECT_PLACEMENT / PICK_KEEPER, the player can combo
  // their saved towers in peace — prospects on the field don't get pulled
  // into the merge unless the player explicitly needs them as ingredients.
  const towers = Array.from(state.towers.values());
  const out: AvailableCombo[] = [];

  // Same-tier merges: 3 identical (same type, same tier) → next tier of that type.
  // Prefer kept (!pending) towers in the picked set so a merge fires on
  // your saved trio first; pending duplicates fill in only if the kept
  // pool has fewer than 3.
  const groups: Record<string, Tower[]> = {};
  for (const t of towers) {
    if (t.qualityTier >= 5) continue;
    const k = `${t.type}|${t.qualityTier}`;
    (groups[k] ??= []).push(t);
  }
  for (const k of Object.keys(groups)) {
    const arr = groups[k];
    if (arr.length < 3) continue;
    // Sort kept-first, then by killCount descending so the merge consumes
    // the most-veteran towers (preserves the snowballing low-killcount
    // tower's progress for the next round).
    const picked = arr.slice().sort((a, b) => {
      if (!!a.pending !== !!b.pending) return a.pending ? 1 : -1;
      return b.killCount - a.killCount;
    }).slice(0, 3);
    out.push({
      recipeIndex: -1,
      result: arr[0].type,
      resultTier: (arr[0].qualityTier + 1),
      cost: SAME_TIER_MERGE_COST[arr[0].qualityTier] ?? 0,
      ingredients: picked,
      isSameTierMerge: true
    } as AvailableCombo);
  }

  // Pre-sort the candidate pool: kept towers before pending ones, then by
  // tier descending so the highest-quality available is chosen first.
  // The greedy `find` below walks this order, so cross-unit recipes prefer
  // kept-tower matches before pulling in any prospects.
  const sortedTowers = towers.slice().sort((a, b) => {
    if (!!a.pending !== !!b.pending) return a.pending ? 1 : -1;
    return (b.qualityTier ?? 0) - (a.qualityTier ?? 0);
  });

  comboData.forEach((recipe, idx) => {
    const picked: Tower[] = [];
    const localUsed = new Set<string>();
    for (const ing of recipe.ingredients) {
      // 2026-05 v6: dropped the global `used` reservation that previously
      // hid a recipe if any of its ingredient towers had already been
      // claimed by an earlier recipe in this scan. localUsed still prevents
      // picking the same tower twice within ONE recipe.
      // 2026-05 v11: candidate pool is now pre-sorted (kept towers first)
      // so saved-tower-only combos surface naturally; prospects fill in
      // only as a last resort.
      const found = sortedTowers.find(t =>
        !localUsed.has(t.id)
        && t.type === (ing.type as TowerType)
        && t.qualityTier >= ing.minTier
      );
      if (!found) { picked.length = 0; break; }
      picked.push(found);
      localUsed.add(found.id);
    }
    if (picked.length === recipe.ingredients.length && picked.length > 0) {
      // Tier inheritance: the combo result keeps the HIGHEST tier from
      // any ingredient — if you craft an Eagle Standard recipe and one
      // of your ingredients is T5, the resulting Eagle Standard is T5
      // too. Falls back to the recipe's static tier when all ingredients
      // are at or below the recipe's default. Capped at T5 since that's
      // the apex of the tier ladder.
      const maxIngTier = picked.reduce((m, p) => Math.max(m, p.qualityTier ?? 1), 1);
      const inheritedTier = Math.min(5, Math.max(recipe.tier, maxIngTier));
      out.push({
        recipeIndex: idx,
        result: recipe.result as TowerType,
        resultTier: inheritedTier,
        cost: recipe.cost,
        ingredients: picked
      });
    }
  });
  return out;
}

// Predictive helper: would adding a tower of (type, tier) to the current board
// finish a recipe that isn't already finishable? Used by the Mercator shop UI
// (and any other purchase surface) to flag offers that complete a combo so the
// player gets the same "recipe-ready" signal as a prospect glow. Same-tier
// merges count: if you already own 2 of the same type+tier, the offer is a
// 3rd-of-a-kind that ladders the tier.
export function purchaseCompletesRecipe(state: GameStateShape, type: TowerType | string, tier: number): boolean {
  const towers = Array.from(state.towers.values());
  // Same-tier merge: 2 existing of same type+tier → buying one more completes a 3-merge.
  if (tier < 5) {
    let same = 0;
    for (const t of towers) {
      if (t.type === type && t.qualityTier === tier) same++;
      if (same >= 2) return true;
    }
  }
  // Cross-unit recipes: try every recipe; succeed if it can be filled when the
  // purchased tower is allowed to satisfy exactly one ingredient slot AND it
  // cannot be filled by current board towers alone.
  for (const recipe of comboData) {
    // Pass 1 — can it complete using ONLY existing towers (no offer)?
    const localUsedExisting = new Set<string>();
    let existingOk = true;
    for (const ing of recipe.ingredients) {
      const f = towers.find(t => !localUsedExisting.has(t.id)
        && t.type === (ing.type as TowerType)
        && t.qualityTier >= ing.minTier);
      if (!f) { existingOk = false; break; }
      localUsedExisting.add(f.id);
    }
    if (existingOk) continue; // already satisfiable — buying it doesn't "complete" anything new
    // Pass 2 — can the offer fill exactly one slot the existing towers can't?
    for (let slotIdx = 0; slotIdx < recipe.ingredients.length; slotIdx++) {
      const slot = recipe.ingredients[slotIdx];
      if (slot.type !== type) continue;
      if (tier < slot.minTier) continue;
      const localUsed = new Set<string>();
      let ok = true;
      for (let i = 0; i < recipe.ingredients.length; i++) {
        if (i === slotIdx) continue; // offer fills this one
        const ing = recipe.ingredients[i];
        const f = towers.find(t => !localUsed.has(t.id)
          && t.type === (ing.type as TowerType)
          && t.qualityTier >= ing.minTier);
        if (!f) { ok = false; break; }
        localUsed.add(f.id);
      }
      if (ok) return true;
    }
  }
  return false;
}

export function executeCombo(state: GameStateShape, combo: AvailableCombo, resultTileTowerId: string): boolean {
  // 2026-05-15 v7: combine is now ALLOWED during all pre-wave phases —
  // PROSPECT_PLACEMENT, PICK_KEEPER, AND BUILD_PHASE. Previously gated
  // to BUILD_PHASE to dodge "comboed a prospect I wouldn't have kept"
  // regret, but players were finishing the prospect round only to
  // immediately combo, adding an unwanted extra click. Now if you can
  // see the recipe completed (kept or pending towers both count), you
  // can execute it. Mid-wave is still blocked — no transactions while
  // the legion is dying.
  const inPreWavePhase = state.phase === GamePhase.PROSPECT_PLACEMENT
                      || state.phase === GamePhase.PICK_KEEPER
                      || state.phase === GamePhase.BUILD_PHASE;
  if (!inPreWavePhase) {
    state.hint = 'No combinations mid-battle. Survive first.';
    return false;
  }
  // AERARIUM CAP CHECK (bugfix 2026-05 v6): the old check blocked the
  // combo whenever the global goldTowerCount was already 3. That meant
  // a player with three Aerariums on the field couldn't merge them into
  // a higher-tier Aerarium even though the merge NETS −2 Aerariums.
  // The new check computes the post-combo count: -1 per ingredient
  // Aerarium consumed, +1 if the result is an Aerarium. Block only if
  // the projected count exceeds the cap.
  if (combo.result === TowerType.AERARIUM) {
    const consumedAerariums = combo.ingredients.filter(t => t.isAerarium).length;
    const projectedCount = state.goldTowerCount - consumedAerariums + 1;
    if (projectedCount > ECONOMY.AERARIUM_MAX_COUNT) {
      state.hint = 'Treasury limit reached (max 3).';
      return false;
    }
  }
  const resultIngr = combo.ingredients.find(t => t.id === resultTileTowerId)
    ?? combo.ingredients[0];
  // Pre-check: simulate the tile changes (TOWER on result tile, STONE on others)
  // and confirm a path-to-gate still exists. Roll back the simulation either way.
  const prevTiles: { col: number; row: number; tile: TileType }[] = [];
  for (const t of combo.ingredients) {
    prevTiles.push({ col: t.tileX, row: t.tileY, tile: state.tiles[t.tileY][t.tileX] });
    state.tiles[t.tileY][t.tileX] = (t.id === resultIngr.id) ? TileType.TOWER : TileType.STONE;
  }
  const pathOk = buildGroundPath(state) !== null;
  for (const p of prevTiles) state.tiles[p.row][p.col] = p.tile; // roll back
  if (!pathOk) {
    state.hint = 'That combo would block the path. Choose a different result tile or sell a stone first.';
    return false;
  }
  if (!spendGold(state, combo.cost)) {
    state.hint = `Not enough Gold (need ${combo.cost}).`;
    return false;
  }
  const killSum = combo.ingredients.reduce((s, t) => s + t.killCount, 0);
  const killBonusSum = combo.ingredients.reduce((s, t) => s + t.killBonusFlat, 0);
  // ITEM CARRYOVER: collect every equipped item from the ingredient towers
  // before they're deleted. The new tower gets as many as its tier-tied
  // item slot count allows; any leftovers spill into a state stash so
  // main.ts can return them to the player's inventory.
  const carriedItems: any[] = [];
  for (const t of combo.ingredients) {
    if (t.equippedItems && t.equippedItems.length > 0) {
      for (const item of t.equippedItems) carriedItems.push(item);
    }
  }
  // Consumed ingredient tiles convert to STONE walls (not EMPTY) so the maze
  // shape the player built is preserved. The chosen result tile becomes the
  // new tower; every other ingredient leaves a wall behind.
  // BUGFIX: decrement Aerarium count for any consumed Aerarium so the global
  // cap (max 3 on the map) stays accurate after merges.
  for (const t of combo.ingredients) {
    if (t.isAerarium && state.goldTowerCount > 0) state.goldTowerCount -= 1;
    state.towers.delete(t.id);
    if (t.id === resultIngr.id) {
      setTile(state, t.tileX, t.tileY, TileType.EMPTY);
    } else {
      setTile(state, t.tileX, t.tileY, TileType.STONE);
    }
  }
  const newTower = createTower(combo.result, combo.resultTier as 1 | 2 | 3 | 4 | 5,
    resultIngr.tileX, resultIngr.tileY, state.wave);
  newTower.killCount = killSum;
  newTower.killBonusFlat = killBonusSum;
  newTower.builtFrom = combo.ingredients.map(i => i.type);
  // SAME-TIER MERGE BONUS: now that tier no longer auto-grants raw damage,
  // a 3-of-a-kind merge would otherwise only swap 3 towers for a slightly
  // faster 1 — bad trade. Stamp the survivor with a +15% baseDps bonus
  // (compounds across repeated merges) so the player feels real progress.
  // Applies to BOTH base towers AND combo towers — combos can ladder T2→T5
  // just like bases.
  if (combo.isSameTierMerge) {
    newTower.baseDps = newTower.baseDps * 1.15;
  }
  // Equip as many carried items as the new tower's slot cap allows.
  // 2026-05 v11: ITEM-CLASS VALIDATION on combine. The new tower's
  // damageType may differ from any ingredient (e.g., 2 melee + 1 ranged
  // → ranged combo result), so attack-class-restricted items (MELEE-ONLY,
  // RANGED-ONLY) carried up from the ingredients must be re-validated.
  // Anything that no longer fits the result tower's class is pulled OUT
  // of the equip set and pushed into leftover, which `main.ts` then
  // deposits back into the player's inventory (with overflow → loss
  // matching the existing inventory-full pattern).
  const resultDefForItems: any = (towersData as any)[newTower.type] ?? {};
  const resultDamageType: DamageType = (DamageType as any)[resultDefForItems.damageType] ?? DamageType.PHYS_RANGED;
  const fits: any[] = [];
  const misfits: any[] = [];
  for (const item of carriedItems) {
    const check = canEquipItemOnDamageType(item as any, resultDamageType);
    if (check.ok) fits.push(item);
    else misfits.push(item);
  }
  const slotCap = (TIER_MULTS.itemSlots as any)[newTower.qualityTier] ?? 1;
  const equip = fits.slice(0, slotCap);
  // Anything beyond slot cap from the fits list also spills to inventory.
  const leftover = misfits.concat(fits.slice(slotCap));
  newTower.equippedItems = equip;
  if (leftover.length > 0) {
    (state as any).__leftoverItemsFromCombo = ((state as any).__leftoverItemsFromCombo ?? []).concat(leftover);
  }
  // Track actual gold cost so sell refund = half of what the player invested.
  // For combos this is the recipe cost + half-recovered ingredient costs (rough),
  // capped sensibly so a sell-back can't print money.
  const ingredientCostSum = combo.ingredients.reduce((s, i) => s + (i.costPaid ?? 0), 0);
  newTower.costPaid = combo.cost + Math.floor(ingredientCostSum * 0.5);
  state.towers.set(newTower.id, newTower);
  setTile(state, newTower.tileX, newTower.tileY, TileType.TOWER);
  if (newTower.isAerarium) state.goldTowerCount += 1;
  const resultDef: any = (towersData as any)[combo.result];
  const resultDisplay = resultDef?.name ?? combo.result.split('_').map((w: string) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
  state.hint = combo.isSameTierMerge
    ? `Merged 3× ${resultDisplay} T${combo.resultTier - 1} → ${resultDisplay} T${combo.resultTier}.`
    : `Combined: ${resultDisplay}!`;
  // Emergence FX: stash a one-shot effect at the result tile so the renderer can play it.
  (state as any).comboFxQueue = (state as any).comboFxQueue ?? [];
  (state as any).comboFxQueue.push({
    x: newTower.tileX * 32 + 16,
    y: newTower.tileY * 32 + 16,
    bornTick: state.tick,
    isSameTierMerge: !!combo.isSameTierMerge,
    resultTier: combo.resultTier
  });
  return true;
}
