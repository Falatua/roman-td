import { Tower, TowerType, DamageType, TargetingMode, DrawCard } from '../types';
import { GameStateShape } from '../GameState';
import { TIER_MULTS, ECONOMY, POOL_PROBABILITIES, GRID, AURA_TILES, AURA_TILE_EFFECTS } from '../constants';
import towersData from '../data/towers.json';
import { damageTypeFromString } from './DamageTypeSystem';
import { isInsideStructureFootprint } from './GridManager';

// 2026-05-19 — AURA TILE LOOKUP. Returns the kind of aura tile the
// tower sits on, or null. Used by stat math + combat hooks so every
// tile-bonus path reads the same source-of-truth lookup. O(5) per
// call (5 fixed tiles), no need to cache.
export function towerAuraTileKind(t: Tower): typeof AURA_TILES[number]['kind'] | null {
  // 2026-05-22 — Confirmed aura-tile coverage applies UNIFORMLY to
  // heroes and regular towers. This lookup only checks the tile
  // coordinates against the 6 fixed AURA_TILES; the `isHero` flag
  // is intentionally ignored so a hero placed on a PURPLE tile gets
  // the same +30% attack speed that a Hastati would get. Same for
  // BLUE (+30% damage), RED (+50% vs-boss damage), CYAN (melee can
  // hit flyers), GOLD (+2 gold per kill), and EMERALD (+2 tile
  // range). The damage + speed bonuses compose into the hero's
  // effective stats via towerEffectiveStats (called on every tower
  // including heroes in CombatResolver per frame), the +range bonus
  // flows through the additive range band alongside hero items and
  // pool-level extras. 2026-05-24 audit fix — corrected the per-color
  // labels in this comment (they had PURPLE/BLUE/CYAN swapped vs the
  // source-of-truth table at constants.ts:332-342). Code paths were
  // always correct, only the documentation was wrong.
  for (const a of AURA_TILES) {
    if (a.col === t.tileX && a.row === t.tileY) return a.kind;
  }
  return null;
}

// 2026-05 v10 — CLASS-BASED DAMAGE SCALARS
//
// Rather than re-tuning ~25 baseDps values across towers.json, we apply
// a category multiplier at stat-compute time. The JSON keeps its
// canonical numbers; this table is the single dial for sweeping nerfs
// to ranged combos, apex super-combos, and T5 base towers (the three
// classes the player feedback called out as over-tuned).
//
// Numbers chosen for "slightly", not "harshly":
//   • RANGED_COMBO_NERF   — 0.92 (8% cut)
//   • APEX_COMBO_NERF     — 0.88 (12% cut, biggest)
//   • T5_BASE_NERF        — 0.90 (10% cut)
//
// Applied in towerEffectiveStats() against `dps`. A tower can be in
// multiple buckets (e.g. an apex combo is both COMBO and apex) — we
// pick the SMALLEST scalar so a category match takes precedence
// without compounding.
const APEX_COMBOS = new Set<string>([
  'IMPERIUM_ETERNUM', 'CARTHAGE_SCOURGE', 'TRIUMVIRATE',
  'LEGION_PRIME', 'CONSULAR_FATEBINDER'
]);
function classBalanceScalar(t: Tower): number {
  const def: any = (towersData as any)[t.type];
  if (!def) return 1;
  // 2026-05 v10 — ENDLESS MODE: nerfs are LIFTED. Endless explicitly
  // exaggerates tower behavior to fight back the exponential enemy
  // scaling, so apex combos, ranged combos, and T5 base towers fire at
  // their JSON-canonical DPS in chaos mode. The endless wave generator
  // is doing all the difficulty work — towers don't also need to be
  // suppressed. Window guard so vitest (node env) doesn't crash.
  const gs: any = typeof window !== 'undefined' ? (window as any).__lastState : null;
  if (gs?.endlessMode) return 1;
  let mult = 1;
  // Apex super-combo nerf (12%)
  if (APEX_COMBOS.has(t.type)) mult = Math.min(mult, 0.88);
  // Ranged combo nerf (8%) — combo + non-melee. Apex combos already
  // captured above; this hits the non-apex ranged combos.
  if (def.kind === 'COMBO' && def.melee === false && !APEX_COMBOS.has(t.type)) {
    mult = Math.min(mult, 0.92);
  }
  // T5 base nerf (10%) — only base towers with tierBand 5.
  if (def.kind === 'BASE' && def.tierBand === 5) mult = Math.min(mult, 0.90);
  return mult;
}

let nextId = 1;
function newId(): string { return `tw${nextId++}`; }

// 2026-05 v6: CAVALRY_TYPES set retired — Cavalry Spur and Numidian
// Saddle now gate by attack class (MELEE / RANGED) instead of a niche
// cavalry archetype check.

export function towerDef(type: TowerType): any {
  return (towersData as any)[type];
}

export function createTower(type: TowerType, tier: 1 | 2 | 3 | 4 | 5, col: number, row: number, wave: number, pending = false): Tower {
  const def = towerDef(type);
  return {
    id: newId(),
    type,
    qualityTier: tier,
    tileX: col,
    tileY: row,
    damageType: damageTypeFromString(def.damageType),
    // GLOBAL +10% DAMAGE BUFF (2026-05): all towers (base + combo) get a
    // flat 10% boost to their baseDps at spawn time. Stacks multiplicatively
    // with same-tier-merge bonus and item/pool multipliers downstream.
    baseDps: def.baseDps * 1.10,
    attackSpeed: def.attackSpeed,
    range: def.range,
    // Default targeting: STRONG. Player can still cycle to FIRST / LAST /
    // CLOSE / FLYERS via the tower menu; this is just the default a fresh
    // build (or a combo result) lands on.
    targetingMode: TargetingMode.STRONG,
    killCount: 0,
    killBonusFlat: 0,
    hasBeenDowngraded: false,
    builtFrom: [],
    equippedItems: [],
    placedAtWave: wave,
    attackCooldown: 0,
    rotation: 0,
    isAerarium: type === TowerType.AERARIUM,
    pending,
    attackFlash: 0,
    bossDamageDealt: 0,
    totalDamageDealt: 0,
    killsThisWave: 0,
    damageThisWave: 0,
    mvpAwards: 0,
    costPaid: ECONOMY.TIER_PLACE_COST[tier] ?? 0,
    // 2026-05-19 — Hero placement is free and the hero cannot be sold,
    // combined, moved, or downgraded. itemSlots and combineable
    // checks elsewhere read isHero off the Tower instance. Slot cap
    // for heroes is fixed at 2 regardless of tier (see TowerMenu).
    isHero: !!(def as any).isHero
  };
}

// Probability draw: 5 cards. Each is type + tier per pool weights.
// Uses the EFFECTIVE pool level = max(gold-purchased poolLevel, kill-XP heroLevel).
export function rollDraw(state: GameStateShape, basePool: TowerType[] = BASE_TOWER_TYPES): DrawCard[] {
  const eff = Math.max(state.poolLevel ?? 0, state.heroLevel ?? 0);
  const tierWeights = POOL_PROBABILITIES[Math.min(POOL_PROBABILITIES.length - 1, eff)];

  const cards: DrawCard[] = [];
  for (let i = 0; i < 5; i++) {
    const tier = pickTier(tierWeights);
    const pool = tierPool(tier, basePool);
    const type = pool[Math.floor(Math.random() * pool.length)];
    cards.push({ type, tier });
  }
  // Duplicate-upgrade rule (Gem TD): if 2+ cards share type+tier, upgrade one of them.
  // 4 matches → +2 tiers on one. 2-3 matches → +1 tier on one.
  applyDuplicateUpgrade(cards);
  return cards;
}

function applyDuplicateUpgrade(cards: DrawCard[]) {
  const groups = new Map<string, number[]>();
  cards.forEach((c, i) => {
    const k = `${c.type}|${c.tier}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(i);
  });
  let bestSize = 0;
  let bestIdx: number[] | null = null;
  for (const idxs of groups.values()) {
    if (idxs.length > bestSize) { bestSize = idxs.length; bestIdx = idxs; }
  }
  if (!bestIdx || bestSize < 2) return;
  const bump = bestSize >= 4 ? 2 : 1;
  // Upgrade the first one in the group; cap at tier 5
  const i = bestIdx[0];
  cards[i] = { type: cards[i].type, tier: Math.min(5, cards[i].tier + bump) as 1 | 2 | 3 | 4 | 5 };
  (cards[i] as any).__duplicateBumped = bump;     // surface to UI
}

function pickTier(weights: number[]): 1 | 2 | 3 | 4 | 5 {
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return (i + 1) as 1 | 2 | 3 | 4 | 5;
  }
  return 1;
}

export const BASE_TOWER_TYPES: TowerType[] = [
  TowerType.MILITES, TowerType.VELITES, TowerType.HASTATI,
  TowerType.SAGITTARIUS, TowerType.SCORPIO, TowerType.TRIARIUS,
  TowerType.DECURION, TowerType.CENTURION, TowerType.PRIMUS_PILUS,
  TowerType.LEGATE
];

// 2026-05-15 v9: AUXILIA, FUNDIBULUS, RORARIUS, LIBRITOR, ACCENSUS moved
// from the T1 bonus pool to the T3 bonus pool. T3 now has 11 bonus towers
// (the original 6 + these 5), making T3 the deepest pool in the game.
// T1 has no bonus towers — all T1 rolls draw from the 10-strong BASE pool.
export const TIER_BONUS_TOWER_TYPES: Record<number, TowerType[]> = {
  // 2026-05-17 — Beast Hunter (T1) + Beast Slayer (T2) added as
  // standalone early-game beast-bane towers. Players see them in the
  // standard prospect roll. No combo dependencies, so they can sit on
  // the field permanently without being "stuck" ingredients.
  // 2026-05-21 — Beast Slayer widened to T1-T3 bonus pool presence so
  // it can roll at any of the early-game tiers. T2 stays its "primary"
  // band (existing tierBand: 2 in towers.json + Codex anchor) but the
  // pool draw now surfaces it across T1, T2, T3 — players who hit a
  // T1 prospect roll on a dog-heavy wave can grab one without waiting
  // for a T2 roll. Combo-tower recipes (BESTIARIUS) and the BEAST-BANE
  // bonus math are unchanged; this is purely an availability change.
  1: [TowerType.BEAST_HUNTER, TowerType.BEAST_SLAYER],
  // 2026-05-21 — T2-only base towers (Retiarius, Ballistarius/Turris,
  // Optio, Pugio Assassin, Arcuballista) promoted up to T3 per user
  // direction. T2 bonus pool keeps only BEAST_SLAYER (which is multi-
  // tier T1-T3 per the prior pass), and T3 absorbs the five
  // ex-T2-only towers. Net effect: those five are now scarcer in the
  // early pool but spawn at higher quality when they do roll, which
  // satisfies all existing minTier:2 recipes naturally (T3 > T2).
  2: [TowerType.BEAST_SLAYER],
  3: [
    TowerType.VENATOR, TowerType.IGNIFER, TowerType.SPECULATOR, TowerType.FLAMEN, TowerType.CARROBALLISTA, TowerType.AQUILA_VENATOR,
    // ── 2026-05-15 v9 promotions ───────────────────────────────────────
    TowerType.AUXILIA, TowerType.FUNDIBULUS, TowerType.RORARIUS, TowerType.LIBRITOR, TowerType.ACCENSUS,
    TowerType.BEAST_SLAYER,
    // ── 2026-05-21 promotions (ex-T2-only towers) ─────────────────────
    TowerType.RETIARIUS, TowerType.BALLISTARIUS, TowerType.OPTIO, TowerType.PUGIO_ASSASSIN, TowerType.ARCUBALLISTA
  ],
  // 2026-05-15 v13: CLIBANARIUS removed — it's now a COMBO (Pugio Assassin
  // + Cataphract → Clibanarius @ 50g). T4 base pool drops from 5 → 4 entries.
  4: [TowerType.CATAPHRACT, TowerType.AUGUR, TowerType.EVOCATUS, TowerType.HARUSPEX],
  5: [TowerType.PRAEFECTUS, TowerType.VULCAN_ENGINEER, TowerType.IMPERATOR_GUARD, TowerType.SOLAR_PRIEST, TowerType.COLOSSUS_ONAGER]
};

function tierPool(tier: number, basePool: TowerType[]): TowerType[] {
  return [...basePool, ...(TIER_BONUS_TOWER_TYPES[tier] ?? [])];
}

export function placeCost(tier: number): number {
  return ECONOMY.TIER_PLACE_COST[tier] ?? 0;
}

// Find N random EMPTY tiles that don't break path-to-gate when occupied.
// Used by Gem TD-style auto-placement at the start of each build phase.
export function findRandomBuildTiles(
  state: any,                                                 // GameStateShape, avoiding circular import
  n: number,
  pathValidator: (col: number, row: number) => boolean
): { col: number; row: number }[] {
  const out: { col: number; row: number }[] = [];
  const used = new Set<string>();
  let attempts = 0;
  while (out.length < n && attempts < 800) {
    attempts++;
    // Bias towards near-path tiles for relevance — pick along the ground path with small offset
    let col: number, row: number;
    if (state.groundPath?.length && Math.random() < 0.7) {
      const p = state.groundPath[Math.floor(Math.random() * state.groundPath.length)];
      const dx = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2));
      const dy = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2));
      col = p.col + dx; row = p.row + dy;
    } else {
      col = 1 + Math.floor(Math.random() * (GRID.COLS - 2));
      row = 1 + Math.floor(Math.random() * (GRID.ROWS - 2));
    }
    const key = `${col},${row}`;
    if (used.has(key)) continue;
    if (state.tiles[row]?.[col] !== 0) continue;        // not EMPTY
    // 2026-05-22 V20 — Gem-TD random-roll must also respect the 5×5
    // cave + gate reserved footprint, otherwise prospects could spawn
    // sitting under the cave entrance art.
    if (isInsideStructureFootprint(col, row)) continue;
    if (!pathValidator(col, row)) continue;
    out.push({ col, row });
    used.add(key);
  }
  return out;
}

export function towerEffectiveStats(t: Tower): { dps: number; attackSpeed: number; range: number } {
  const dmgMult = TIER_MULTS.damage[t.qualityTier];
  const spdMult = TIER_MULTS.speed[t.qualityTier];
  // Item damage/speed multipliers — kept in lockstep with items_permanent.json.
  // Adjusted 2026-05 so common/uncommon/rare/legendary actually escalate.
  let itemDmgMult = t.equippedItems.includes('SHARPENED_BLADE') ? 1.12 : 1;
  if ((t.equippedItems.includes('CELTIC_LONGSWORD')) && (t.damageType === DamageType.PHYS_MELEE || t.damageType === DamageType.PHYS_RANGED)) itemDmgMult *= 1.25;
  if ((t.equippedItems.includes('NECROTIC_LONGSWORD')) && (t.damageType === DamageType.PHYS_MELEE || t.damageType === DamageType.PHYS_RANGED)) itemDmgMult *= 1.28;
  if (t.equippedItems.includes('STORM_JAVELIN') && t.damageType === DamageType.PHYS_RANGED) itemDmgMult *= 1.22;
  let itemSpeedMult = 1;
  if (t.equippedItems.includes('TRAINING_SCROLL')) itemSpeedMult *= 1.12;
  if (t.equippedItems.includes('QUICKDRAW_GLOVES')) itemSpeedMult *= 1.15;
  if (t.equippedItems.includes('MERCURY_FEATHER')) itemSpeedMult *= 1.22;
  if (t.equippedItems.includes('HOURGLASS_OF_SATURN')) itemSpeedMult *= 1.30;
  // 2026-05 v6: CAVALRY niche dropped — CAVALRY_SPUR is now MELEE-only
  // (equip gate in ItemRules); NUMIDIAN_SADDLE is now RANGED-only. Both
  // apply universally within their class with no per-tower cavalry filter.
  // 2026-05-19 rarity rebalance — Cavalry Spur tuned from +30% → +22%
  // atk speed so it sits cleanly in the UNCOMMON tier next to Mercury
  // Feather (+22% any-tower). Keeps the +0.5 range bonus from below.
  if (t.equippedItems.includes('CAVALRY_SPUR') && t.damageType === DamageType.PHYS_MELEE) itemSpeedMult *= 1.22;
  // WAR_HOUND_COLLAR converted to AURA (2026-05) — applies to nearby
  // towers via CombatResolver's localAuras pass, not as a self-buff.
  if (t.equippedItems.includes('NUMIDIAN_SADDLE') && t.damageType === DamageType.PHYS_RANGED) itemSpeedMult *= 1.35;
  // ─── BOSS / LEGENDARY TROPHIES (2026-05) ───────────────────────────────
  // Every trophy now carries a real, legible effect so the inventory text
  // matches what the tower actually does. Boss-only damage bonuses
  // (WARLORDS_WAR_PAINT, UNDEAD_ELEPHANT_BONE, ELEPHANT_TUSK) apply per-hit
  // in CombatResolver, not here.
  if (t.equippedItems.includes('BERSERKERS_MUZZLE') && (t.damageType === DamageType.PHYS_MELEE)) { itemDmgMult *= 1.25; itemSpeedMult *= 1.20; }
  // DRUIDS_TORC converted to AURA — applies via CombatResolver localAuras.
  if (t.equippedItems.includes('GALLIC_SHIELD_BOSS')) itemDmgMult *= 1.18;
  if (t.equippedItems.includes('GILDED_SCALE_ARMOR')) itemDmgMult *= 1.22;
  // 2026-05-18 — EPIC TIER (purple) STATS.
  // LICTOR_FASCES: +18% damage (range +1 below in extraRange).
  // AUXILIARY_SLING: ranged-only +30% damage.
  // OPTIO_WHISTLE: +12% attack speed aura — applied via CombatResolver
  //                localAuras pass below, no self-buff here.
  if (t.equippedItems.includes('LICTOR_FASCES')) itemDmgMult *= 1.18;
  if (t.equippedItems.includes('AUXILIARY_SLING') && (t.damageType === DamageType.PHYS_RANGED)) itemDmgMult *= 1.30;
  // 2026-05-19 — GATE-EXCLUSIVE COMMONS/UNCOMMONS. Five new items
  // that live only at the gate shop:
  //   • RUSTED_HASTA: +10% damage
  //   • AUGUR_SCROLL: +20% attack speed (gate-exclusive Uncommon)
  //   • CONSULAR_TOKEN: +8% damage, +0.5 range (range below)
  //   • PRAETORIAN_COIN: +1 gold per kill (wired in main.ts kill hook)
  //   • BRONZE_GREAVES: +0.5 tile range (below in extraRange)
  if (t.equippedItems.includes('RUSTED_HASTA')) itemDmgMult *= 1.10;
  if (t.equippedItems.includes('AUGUR_SCROLL')) itemSpeedMult *= 1.20;
  if (t.equippedItems.includes('CONSULAR_TOKEN')) itemDmgMult *= 1.08;
  // 2026-05-18 — EVENT-EXCLUSIVE LEGENDARIES (atk-speed half).
  // PERIMETER_TORCH (invasion):    +25% atk speed (damage in CombatResolver)
  // HELLGATE_BRAND   (gates):      +25% atk speed (damage in CombatResolver)
  if (t.equippedItems.includes('PERIMETER_TORCH')) itemSpeedMult *= 1.25;
  if (t.equippedItems.includes('HELLGATE_BRAND')) itemSpeedMult *= 1.25;
  // CURSED_TORC, LICH_GENERALS_SEAL, BARCA_WAR_HORN all converted to
  // AURA emitters in CombatResolver (2026-05). Self-buff lines removed
  // so a tower no longer double-dips its own aura.
  const extraRange =
    (t.equippedItems.includes('WATCHTOWER_LENS') ? 1 : 0) +
    (t.equippedItems.includes('DRUID_STAFF_FRAGMENT') ? 2 : 0) +
    (t.equippedItems.includes('GALLIC_SHIELD_BOSS') ? 1 : 0) +
    (t.equippedItems.includes('GILDED_SCALE_ARMOR') ? 1 : 0) +
    // 2026-05-18 — INVASION-exclusive VANGUARD_PILUM: +1 tile range
    // alongside its +35% damage (applied in CombatResolver).
    (t.equippedItems.includes('VANGUARD_PILUM') ? 1 : 0) +
    // 2026-05-18 — EPIC LICTOR_FASCES: +1 tile range alongside its
    // +18% damage (applied above in itemDmgMult).
    (t.equippedItems.includes('LICTOR_FASCES') ? 1 : 0) +
    // 2026-05-19 — Gate-exclusive range items.
    (t.equippedItems.includes('BRONZE_GREAVES') ? 0.5 : 0) +
    (t.equippedItems.includes('CONSULAR_TOKEN') ? 0.5 : 0) +
    // 2026-05-22 — Agrippa hero passive: +1.0 tile range to every
    // SIEGE tower within 5 tiles of Agrippa's tile. Read off the
    // global state ref (set by main.ts in renderer mode); test env
    // has no global state, so the guard returns 0 and the test suite's
    // tower stat math stays unaffected by the hero feature.
    //
    // Bug history: this check used to filter on PHYS_RANGED, but the
    // V19 hero rework moved Agrippa's passive filter to SIEGE in
    // CombatResolver.ts without updating this range hook. Net effect:
    // the range portion of Agrippa's passive was silently broken for
    // 3 days. Bonus now correctly targets SIEGE towers, and the
    // magnitude is +1.0 tile (was +0.5) to match the felt-undertuned
    // user feedback that prompted the hero buff pass.
    // 2026-05-22 (later) — Aura radius bumped 3 → 5 tiles to match the
    // damage-aura radius change in CombatResolver.ts. A single Agrippa
    // can now buff a whole siege lane instead of just neighbors.
    ((() => {
      const g: any = typeof globalThis !== 'undefined' ? (globalThis as any) : undefined;
      const gs: any = g?.__game;
      if (!gs || gs.activeHeroId !== 'HERO_AGRIPPA' || !gs.activeHeroTowerId) return 0;
      if (t.damageType !== DamageType.SIEGE) return 0;
      const hero = gs.towers?.get?.(gs.activeHeroTowerId);
      if (!hero) return 0;
      const dx = (hero.tileX - t.tileX);
      const dy = (hero.tileY - t.tileY);
      return Math.hypot(dx, dy) <= 5 ? 1.0 : 0;
    })()) +
    // SPEAR OF MARS — converts a melee tower into a thrown-spear unit by
    // adding five tiles of reach. CombatResolver spawns a visible PROJ_HASTA
    // flying from the tower to the target whenever a melee swing fires
    // while this item is equipped, so the extended range reads visually.
    (t.equippedItems.includes('SPEAR_OF_MARS') ? 5 : 0) +
    // CAVALRY SPUR (2026-05 v6): MELEE-only (gated in ItemRules) — adds
    // +0.5 tile range on top of the +30% atk speed so it stays distinct
    // from MERCURY_FEATHER (universal +22% speed, no range bonus).
    (t.equippedItems.includes('CAVALRY_SPUR') && t.damageType === DamageType.PHYS_MELEE ? 0.5 : 0);
  const classScalar = classBalanceScalar(t);
  // 2026-05 v10 — ENDLESS exaggeration. While in endless mode, towers
  // exceed their normal caps: damage and attack speed scale up with
  // endlessWave (capped sanely), and range gets a flat +1 tile so
  // ranged builds can still reach the path. Lets skilled players
  // express mastery through tower mastery + combo recipes even as
  // enemies become near-unkillable per the design brief.
  const gs: any = typeof window !== 'undefined' ? (window as any).__lastState : null;
  let endlessDmgBoost = 1, endlessSpdBoost = 1, endlessRangeBoost = 0;
  if (gs?.endlessMode) {
    const ew = gs.endlessWave ?? 1;
    // +6% damage per endless wave, capped at +90%.
    endlessDmgBoost = 1 + Math.min(0.90, 0.06 * ew);
    // +4% attack speed per endless wave, capped at +60%.
    endlessSpdBoost = 1 + Math.min(0.60, 0.04 * ew);
    // +1 tile range flat (matches the Watchtower Lens bonus).
    endlessRangeBoost = 1;
  }
  // 2026-05-19 — AURA TILE BUFFS. If the tower sits on one of the 5
  // fixed aura tiles, apply that tile's damage / attack-speed
  // multiplier here. Stacks multiplicatively with items and the
  // class scalar so a Tempo tile + Cavalry Spur combo lands at
  // 1.30 × 1.30 = 1.69× speed (no cap). Boss-damage variant is
  // applied in CombatResolver per-hit so it can check target.isBoss.
  // Anti-air variant is handled in the target-selection pass.
  let auraDmgMult = 1;
  let auraSpdMult = 1;
  let auraRangeBonus = 0;
  const auraKind = towerAuraTileKind(t);
  if (auraKind) {
    const eff = AURA_TILE_EFFECTS[auraKind];
    if (eff.dmgMult) auraDmgMult *= eff.dmgMult;
    if (eff.spdMult) auraSpdMult *= eff.spdMult;
    // 2026-05-19 — EMERALD WATCHTOWER tile. Adds a flat +N tile range
    // to the tower's effective range. Stacks additively with the
    // Watchtower Lens trophy (+1 range) and pool-level extra range —
    // all three live in the additive `range + extra` band, not in
    // the multiplicative aura band. Consistent with how the BLUE
    // damage tile composes with item damage mults: kind-specific
    // surface on the aura record, applied where the math fits best.
    if (eff.rangeBonus) auraRangeBonus += eff.rangeBonus;
  }
  // 2026-05-20 v2 — Hero Forge Path A (SHARPEN). +6% damage per stack
  // applies to the hero tower only. Stacks live on game state (not on
  // the tower instance) so this branch reads from globalThis.__game,
  // same pattern used by the Agrippa range-aura block at line 314.
  let forgeDmgMult = 1;
  if (t.isHero) {
    const g: any = typeof globalThis !== 'undefined' ? (globalThis as any) : undefined;
    const gs: any = g?.__game;
    const n = gs?.heroForgeStacks?.dmg ?? 0;
    if (n > 0) forgeDmgMult = 1 + 0.06 * n;
  }
  return {
    dps: t.baseDps * dmgMult * itemDmgMult * classScalar * endlessDmgBoost * auraDmgMult * forgeDmgMult,
    attackSpeed: t.attackSpeed * spdMult * itemSpeedMult * endlessSpdBoost * auraSpdMult,
    range: t.range + extraRange + endlessRangeBoost + auraRangeBonus
  };
}

export function towerPerAttackDamageBase(t: Tower): number {
  const stats = towerEffectiveStats(t);
  const tierSpeed = Math.max(0.05, t.attackSpeed * TIER_MULTS.speed[t.qualityTier]);
  return stats.dps / tierSpeed;
}

// ─── STAT BREAKDOWN ─────────────────────────────────────────────────────
// For the tower-info UI: enumerate every modifier that affects the tower's
// damage / attack speed / range, broken down by source (tier roll, items,
// auras, pool level, etc). Multiplicative modifiers are listed with their
// multiplier; flat modifiers (range +1) carry a `flat` field. The UI sums
// these to show "base 17 + 6 = 23" style breakdowns next to each stat.
export interface StatModifier {
  source: string;        // human label e.g. 'Tier 4', 'Sharpened Blade'
  multiplier?: number;   // 1.15 = +15%
  flat?: number;         // for range +1 etc.
}

export interface StatBreakdown {
  damageBase: number;            // baseDps before any multipliers
  speedBase: number;             // attackSpeed before any multipliers
  rangeBase: number;             // base range
  damageMods: StatModifier[];
  speedMods: StatModifier[];
  rangeMods: StatModifier[];
  // Final stacked values (additive auras + multiplicative items + tier).
  damageFinal: number;
  speedFinal: number;
  rangeFinal: number;
}

export function towerStatBreakdown(t: Tower, state: any): StatBreakdown {
  const dmgMods: StatModifier[] = [];
  const spdMods: StatModifier[] = [];
  const rngMods: StatModifier[] = [];

  // Tier multipliers (the qualityTier roll)
  const tierDmg = TIER_MULTS.damage[t.qualityTier];
  const tierSpd = TIER_MULTS.speed[t.qualityTier];
  if (tierDmg !== 1) dmgMods.push({ source: `Tier ${t.qualityTier}`, multiplier: tierDmg });
  if (tierSpd !== 1) spdMods.push({ source: `Tier ${t.qualityTier}`, multiplier: tierSpd });

  // 2026-05 v10 — CLASS BALANCE SCALAR. Surface the hidden class scalar
  // from classBalanceScalar() so the player can see why their tower's
  // effective DPS is 8-12% below baseDps. Three categories: ranged
  // combos −8%, apex super-combos −12%, T5 base −10%. Stays read-only
  // (no item modifies it) but visible in the stat breakdown so the
  // math reconciles with the codex baseDps number.
  const APEX = new Set<TowerType>([
    TowerType.IMPERIUM_ETERNUM, TowerType.CARTHAGE_SCOURGE,
    TowerType.TRIUMVIRATE, TowerType.LEGION_PRIME, TowerType.CONSULAR_FATEBINDER
  ]);
  const def: any = (towersData as any)[t.type];
  if (def) {
    if (APEX.has(t.type)) dmgMods.push({ source: 'Apex Balance', multiplier: 0.88 });
    else if (def.kind === 'COMBO' && def.melee === false) dmgMods.push({ source: 'Ranged Combo Balance', multiplier: 0.92 });
    else if (def.kind === 'BASE' && def.tierBand === 5) dmgMods.push({ source: 'T5 Base Balance', multiplier: 0.90 });
  }

  // ── Items ──────────────────────────────────────────────────────────────
  const items = t.equippedItems;
  if (items.includes('SHARPENED_BLADE')) dmgMods.push({ source: 'Sharpened Blade', multiplier: 1.12 });
  if (items.includes('CELTIC_LONGSWORD') &&
      (t.damageType === DamageType.PHYS_MELEE || t.damageType === DamageType.PHYS_RANGED)) {
    dmgMods.push({ source: 'Celtic Longsword', multiplier: 1.25 });
  }
  if (items.includes('NECROTIC_LONGSWORD') &&
      (t.damageType === DamageType.PHYS_MELEE || t.damageType === DamageType.PHYS_RANGED)) {
    dmgMods.push({ source: 'Necrotic Longsword', multiplier: 1.28 });
  }
  if (items.includes('STORM_JAVELIN') && t.damageType === DamageType.PHYS_RANGED) {
    dmgMods.push({ source: 'Storm Javelin', multiplier: 1.22 });
  }
  if (items.includes('TRAINING_SCROLL')) spdMods.push({ source: 'Training Scroll', multiplier: 1.12 });
  if (items.includes('QUICKDRAW_GLOVES')) spdMods.push({ source: 'Quickdraw Gloves', multiplier: 1.15 });
  if (items.includes('MERCURY_FEATHER')) spdMods.push({ source: 'Mercury Feather', multiplier: 1.22 });
  if (items.includes('HOURGLASS_OF_SATURN')) spdMods.push({ source: 'Hourglass of Saturn', multiplier: 1.30 });
  if (items.includes('CAVALRY_SPUR') && t.damageType === DamageType.PHYS_MELEE) spdMods.push({ source: 'Cavalry Spur (melee)', multiplier: 1.22 });
  // WAR_HOUND_COLLAR is an AURA (2026-05) — buff appears via the
  // cross-tower aura pass below, not on self.
  if (items.includes('NUMIDIAN_SADDLE') && t.damageType === DamageType.PHYS_RANGED) spdMods.push({ source: 'Numidian Saddle (ranged)', multiplier: 1.35 });
  // CAVALRY_SPUR's +0.5 range bonus stays paired with the speed mod (melee-only).
  if (items.includes('CAVALRY_SPUR') && t.damageType === DamageType.PHYS_MELEE) rngMods.push({ source: 'Cavalry Spur (melee)', flat: 0.5 });
  if (items.includes('WATCHTOWER_LENS')) rngMods.push({ source: 'Watchtower Lens', flat: 1 });
  // ── Legendary trophies (real effects) ─────────────────────────────────
  if (items.includes('BERSERKERS_MUZZLE') && t.damageType === DamageType.PHYS_MELEE) {
    dmgMods.push({ source: "Berserker's Muzzle (melee)", multiplier: 1.25 });
    spdMods.push({ source: "Berserker's Muzzle (melee)", multiplier: 1.20 });
  }
  // DRUIDS_TORC is an AURA — buff appears via aura pass below.
  if (items.includes('GALLIC_SHIELD_BOSS')) { dmgMods.push({ source: 'Gallic Shield Boss', multiplier: 1.18 }); rngMods.push({ source: 'Gallic Shield Boss', flat: 1 }); }
  if (items.includes('GILDED_SCALE_ARMOR')) { dmgMods.push({ source: 'Gilded Scale Armor', multiplier: 1.22 }); rngMods.push({ source: 'Gilded Scale Armor', flat: 1 }); }
  // CURSED_TORC / LICH_GENERALS_SEAL / BARCA_WAR_HORN are AURAS — they
  // buff nearby allies (or debuff nearby enemies), not the wearer.
  if (items.includes('DRUID_STAFF_FRAGMENT')) rngMods.push({ source: 'Druid Staff Fragment', flat: 2 });

  // ── Pool level (additive global damage) ───────────────────────────────
  // Pool damage bonus kicks in starting at L2 (L0 and L1 = no bonus).
  const poolLevel = state?.poolLevel ?? 0;
  const poolBonus = 0.03 * Math.max(0, poolLevel - 1);
  if (poolBonus > 0) dmgMods.push({ source: `Pool L${poolLevel}`, multiplier: 1 + poolBonus });

  // ── Live aura sources from other towers ───────────────────────────────
  if (state?.towers) {
    const cx = t.tileX * GRID.TILE + GRID.TILE / 2;
    const cy = t.tileY * GRID.TILE + GRID.TILE / 2;
    for (const other of state.towers.values()) {
      if (other.id === t.id || other.pending) continue;
      const ox = other.tileX * GRID.TILE + GRID.TILE / 2;
      const oy = other.tileY * GRID.TILE + GRID.TILE / 2;
      const d = Math.hypot(ox - cx, oy - cy);
      const oTier = other.qualityTier;
      // Global auras (apply regardless of distance)
      if (other.type === TowerType.EAGLE_STANDARD) {
        // 2026-05-23 — Was 0.18 global + 4-tile 1.10 spd; both stale.
        // Sync to CombatResolver:464-465 which uses 0.15 global +
        // 5-tile 1.18 spd. Numbers now match the actual aura output.
        dmgMods.push({ source: `Eagle Standard T${oTier}`, multiplier: 1 + 0.15 * (1 + 0.05 * (oTier - 1)) });
        if (d <= 5 * GRID.TILE) spdMods.push({ source: 'Eagle Standard local', multiplier: 1.18 });
      }
      if (other.type === TowerType.AQUILIFER_TITAN) {
        dmgMods.push({ source: `Aquilifer Titan T${oTier}`, multiplier: 1 + 0.30 * (1 + 0.05 * (oTier - 1)) });
      }
      if (other.type === TowerType.JULIUS_CAESAR) dmgMods.push({ source: 'Julius Caesar', multiplier: 1.45 });
      if (other.type === TowerType.TRIUMVIRATE) {
        dmgMods.push({ source: 'Triumvirate', multiplier: 1.35 });
        spdMods.push({ source: 'Triumvirate', multiplier: 1.25 });
      }
      if (other.type === TowerType.IMPERIUM_ETERNUM) spdMods.push({ source: 'Imperium Eternum', multiplier: 1.20 });
      if (other.type === TowerType.CONSULAR_FATEBINDER) {
        dmgMods.push({ source: 'Consular Fatebinder', multiplier: 1.30 });
        spdMods.push({ source: 'Consular Fatebinder', multiplier: 1.30 });
      }
      // 2026-05-24 audit fix — TRIARIUS +12% global damage aura.
      // Mirrors CombatResolver.ts:521-524. Previously applied in
      // combat but missing from the tower-info breakdown panel, so
      // the player couldn't see WHY a tower hit harder than its base
      // stats.
      if (other.type === TowerType.TRIARIUS) {
        dmgMods.push({ source: 'Triarius global', multiplier: 1.12 });
      }
      // Local auras (range-gated)
      if (other.type === TowerType.TRIPLEX_ACIES && d <= 3 * GRID.TILE) {
        spdMods.push({ source: 'Triplex Acies', multiplier: 1.20 });
      }
      if (other.type === TowerType.LEGION_PRIME && d <= 3 * GRID.TILE) {
        dmgMods.push({ source: 'Legion Prime', multiplier: 1.25 });
      }
      // 2026-05-24 audit fix — COHORT_GUARD +15% local 3-tile damage
      // aura. Mirrors CombatResolver.ts:525-528.
      if (other.type === TowerType.COHORT_GUARD && d <= 3 * GRID.TILE) {
        dmgMods.push({ source: 'Cohort Guard local', multiplier: 1.15 });
      }
      if (other.equippedItems.includes('CENTURIONS_TRUMPET') && d <= 2 * GRID.TILE) {
        spdMods.push({ source: "Centurion's Trumpet aura", multiplier: 1.12 });
      }
      if (other.equippedItems.includes('BATTLE_STANDARD') && d <= 2 * GRID.TILE) {
        dmgMods.push({ source: 'Battle Standard aura', multiplier: 1.10 });
      }
      // 2026-05 aura expansion — five legendaries that used to be
      // single-tower self-buffs now project to nearby allies.
      if (other.equippedItems.includes('WAR_HOUND_COLLAR') && d <= 2.5 * GRID.TILE) {
        spdMods.push({ source: 'War-Hound Collar aura', multiplier: 1.18 });
      }
      if (other.equippedItems.includes('DRUIDS_TORC') && d <= 2.5 * GRID.TILE) {
        dmgMods.push({ source: "Druid's Torc aura", multiplier: 1.18 });
      }
      if (other.equippedItems.includes('BARCA_WAR_HORN') && d <= 3 * GRID.TILE) {
        dmgMods.push({ source: 'Barca War Horn aura', multiplier: 1.12 });
        spdMods.push({ source: 'Barca War Horn aura', multiplier: 1.10 });
      }
      if (other.equippedItems.includes('LICH_GENERALS_SEAL') && d <= 3 * GRID.TILE) {
        dmgMods.push({ source: "Lich General's Seal aura", multiplier: 1.12 });
        spdMods.push({ source: "Lich General's Seal aura", multiplier: 1.15 });
      }
      // 2026-05-24 audit fix — three more item auras missing from the
      // breakdown panel. All apply in combat at CombatResolver.ts:612-636.
      if (other.equippedItems.includes('AQUILIFER_BANNER') && d <= 2.5 * GRID.TILE) {
        dmgMods.push({ source: "Aquilifer's Banner aura", multiplier: 1.14 });
        spdMods.push({ source: "Aquilifer's Banner aura", multiplier: 1.10 });
      }
      if (other.equippedItems.includes('OPTIO_WHISTLE') && d <= 2 * GRID.TILE) {
        spdMods.push({ source: "Optio's Whistle aura", multiplier: 1.12 });
      }
      if (other.equippedItems.includes('INFERNO_STANDARD') && d <= 3 * GRID.TILE) {
        dmgMods.push({ source: 'Inferno Standard aura', multiplier: 1.25 });
      }
      // CURSED_TORC and NECROMANCERS_LANTERN are ENEMY-DEBUFF auras
      // (enemy-taken multipliers), not ally buffs. CombatResolver applies
      // them via the enemyTakenAuras array per-hit, so they don't show
      // up here in the wearer's-neighbor breakdown — they affect damage
      // OUTPUT through a different code path.
    }
  }

  // Compose final values. Damage + speed are pure multiplicative chains
  // (matches towerEffectiveStats math). Range is base + sum-of-flat.
  let damageFinal = t.baseDps;
  for (const m of dmgMods) damageFinal *= (m.multiplier ?? 1);
  let speedFinal = t.attackSpeed;
  for (const m of spdMods) speedFinal *= (m.multiplier ?? 1);
  let rangeFinal = t.range;
  for (const m of rngMods) rangeFinal += (m.flat ?? 0);

  return {
    damageBase: t.baseDps,
    speedBase: t.attackSpeed,
    rangeBase: t.range,
    damageMods: dmgMods,
    speedMods: spdMods,
    rangeMods: rngMods,
    damageFinal, speedFinal, rangeFinal
  };
}
