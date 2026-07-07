import { Tower, TowerType, DamageType, TargetingMode, DrawCard } from '../types';
import { GameStateShape } from '../GameState';
import { TIER_MULTS, ECONOMY, POOL_PROBABILITIES, GRID, AURA_TILES, AURA_TILE_EFFECTS, type AuraTile } from '../constants';
import towersData from '../data/towers.json';
import { damageTypeFromString } from './DamageTypeSystem';
import { isInsideStructureFootprint } from './GridManager';
import { hasBossTrophy } from './BossTrophySystem';
import { campaignRelicTowerDpsMult, campaignRelicTowerRangeBonus, campaignRelicTowerSpeedMult } from './CampaignRelicSystem';
import { heroIdForTowerType, isMercatorChampionType } from './HeroIdentity';
import { heroAuraScaleForTower, heroBasicAttackScaleForTower } from './HeroScaling';
import enemiesData from '../data/enemies.json';

// 2026-05-19 — AURA TILE LOOKUP. Returns the kind of aura tile the
// tower sits on, or null. Used by stat math + combat hooks so every
// tile-bonus path reads the same source-of-truth lookup. O(5) per
// call (5 fixed tiles), no need to cache.
// Fixed-path modes (e.g. the Green Circle co-op map) lay out their aura tiles
// on different coordinates than the base 38x26 map. They inject a list here;
// null restores the base AURA_TILES. Single-player never sets this.
let _auraOverride: AuraTile[] | null = null;
export function setAuraTilesOverride(tiles: AuraTile[] | null): void { _auraOverride = tiles; }

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
  for (const a of (_auraOverride ?? AURA_TILES)) {
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
const MELEE_ATTACK_SPEED_MULT = 1.06;
const MELEE_MIN_RANGE_TILES = 2.0;
const AURA_STACK_CAP = 2.00;
const SULLA_PASSIVE_RADIUS_TILES = 5.5;

function isMeleeClassTower(t: Tower): boolean {
  const def: any = (towersData as any)[t.type];
  return def?.melee === true || t.damageType === DamageType.PHYS_MELEE;
}

function classBalanceScalar(t: Tower): number {
  const def: any = (towersData as any)[t.type];
  if (!def) return 1;
  if (t.type === TowerType.MARS_VICTOR) return 1;
  // 2026-05 v10 — ENDLESS MODE: nerfs are LIFTED. Endless explicitly
  // exaggerates tower behavior to fight back the exponential enemy
  // scaling, so apex combos, ranged combos, and T5 base towers fire at
  // their JSON-canonical DPS in chaos mode. The endless wave generator
  // is doing all the difficulty work — towers don't also need to be
  // suppressed. Window guard so vitest (node env) doesn't crash.
  const gs: any = typeof globalThis !== 'undefined'
    ? ((globalThis as any).__lastState ?? (globalThis as any).__game ?? (typeof window !== 'undefined' ? (window as any).__lastState : null))
    : null;
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
    // Default targeting: FIRST (2026-05-29, per user request). Every fresh
    // build (or combo result) lands on FIRST — furthest-along enemy, closest
    // to leaking — so a new game always starts on FIRST and the player
    // adjusts from there via the tower menu or the TARGET ALL bulk picker.
    // Flyer-only towers are the exception: they stay on FLYERS so their
    // inspect panel and bulk-targeting state match what combat can do.
    targetingMode: def.antiAirOnly ? TargetingMode.FLYERS : TargetingMode.FIRST,
    killCount: 0,
    killBonusFlat: 0,
    hasBeenDowngraded: false,
    builtFrom: [],
    equippedItems: [],
    equippedItemRarities: [],
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
    ...((def as any).isHero ? { heroXp: 0, heroTier: 0 as 0 | 1 | 2 | 3 | 4 } : {}),
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
  let itemDmgMult = t.equippedItems.includes('SHARPENED_BLADE') ? 1.10 : 1;
  if ((t.equippedItems.includes('CELTIC_LONGSWORD')) && (t.damageType === DamageType.PHYS_MELEE || t.damageType === DamageType.PHYS_RANGED)) itemDmgMult *= 1.50;
  if ((t.equippedItems.includes('NECROTIC_LONGSWORD')) && (t.damageType === DamageType.PHYS_MELEE || t.damageType === DamageType.PHYS_RANGED)) itemDmgMult *= 1.55;
  if (t.equippedItems.includes('STORM_JAVELIN') && t.damageType === DamageType.PHYS_RANGED) itemDmgMult *= 1.40;
  let itemSpeedMult = 1;
  if (t.equippedItems.includes('TRAINING_SCROLL')) { itemDmgMult *= 1.05; itemSpeedMult *= 1.08; }
  if (t.equippedItems.includes('QUICKDRAW_GLOVES') && !isMeleeClassTower(t)) itemSpeedMult *= 1.22;
  if (t.equippedItems.includes('MERCURY_FEATHER')) itemSpeedMult *= 1.25;
  if (t.equippedItems.includes('HOURGLASS_OF_SATURN')) itemSpeedMult *= 1.40;
  if (t.equippedItems.includes('FALCONERS_WATCHPOST')) itemSpeedMult *= 1.40;
  // 2026-05 v6: CAVALRY niche dropped — CAVALRY_SPUR is now MELEE-only
  // (equip gate in ItemRules); NUMIDIAN_SADDLE is now RANGED-only. Both
  // apply universally within their class with no per-tower cavalry filter.
  // Uncommon speed items sit at +25%, above Common and below Rare.
  if (t.equippedItems.includes('CAVALRY_SPUR') && t.damageType === DamageType.PHYS_MELEE) itemSpeedMult *= 1.25;
  // WAR_HOUND_COLLAR converted to AURA (2026-05) — applies to nearby
  // towers via CombatResolver's localAuras pass, not as a self-buff.
  if (t.equippedItems.includes('NUMIDIAN_SADDLE') && t.damageType === DamageType.PHYS_RANGED) itemSpeedMult *= 1.60;
  // ─── BOSS / LEGENDARY TROPHIES (2026-05) ───────────────────────────────
  // Every trophy now carries a real, legible effect so the inventory text
  // matches what the tower actually does. Boss-only damage bonuses
  // (WARLORDS_WAR_PAINT, UNDEAD_ELEPHANT_BONE, ELEPHANT_TUSK) apply per-hit
  // in CombatResolver, not here.
  if (t.equippedItems.includes('BERSERKERS_MUZZLE') && (t.damageType === DamageType.PHYS_MELEE)) { itemDmgMult *= 1.45; itemSpeedMult *= 1.30; }
  // DRUIDS_TORC converted to AURA — applies via CombatResolver localAuras.
  // GALLIC_SHIELD_BOSS is a control proc now, applied in CombatResolver.
  if (t.equippedItems.includes('GILDED_SCALE_ARMOR')) itemDmgMult *= 1.60;   // 2026-06-23 LEG 1.55→1.60: beat EPIC Necrotic/Celtic (+55%)
  if (t.equippedItems.includes('SPEAR_OF_MARS')) itemDmgMult *= 1.60;        // 2026-06-23 LEG 1.35→1.60: beat EPIC melee dmg items
  // 2026-05-18 — EPIC TIER (purple) STATS.
  // LICTOR_FASCES: +40% damage (range +2 below in extraRange).
  // AUXILIARY_SLING: ranged-only +55% damage.
  // OPTIO_WHISTLE: +28% attack speed aura — applied via CombatResolver
  //                localAuras pass below, no self-buff here.
  if (t.equippedItems.includes('LICTOR_FASCES')) itemDmgMult *= 1.40;
  if (t.equippedItems.includes('AUXILIARY_SLING') && (t.damageType === DamageType.PHYS_RANGED)) itemDmgMult *= 1.55;
  const itemHarborDef: any = (towersData as any)[t.type];
  const isHarborOrTideforged = !!(itemHarborDef?.waterOnly || itemHarborDef?.amphibious);
  if (isHarborOrTideforged && t.equippedItems.includes('AEGEAN_PEARL')) itemDmgMult *= 1.35;
  if (isHarborOrTideforged && t.equippedItems.includes('STORMGLASS_AMPHORA')) itemSpeedMult *= 1.20;
  if (isHarborOrTideforged && t.equippedItems.includes('NEPTUNES_TRIDENT')) {
    itemDmgMult *= 1.60;
    itemSpeedMult *= 1.20;
  }
  // 2026-05-19 — GATE-EXCLUSIVE COMMONS/UNCOMMONS. Five new items
  // that live only at the gate shop:
  //   • RUSTED_HASTA: +10% damage
  //   • AUGUR_SCROLL: +25% attack speed (gate-exclusive Uncommon)
  //   • CONSULAR_TOKEN: +15% damage, +0.75 range (range below)
  //   • PRAETORIAN_COIN: +1 gold per kill (wired in main.ts kill hook)
  //   • BRONZE_GREAVES: +0.5 tile range (below in extraRange)
  if (t.equippedItems.includes('RUSTED_HASTA')) itemDmgMult *= 1.10;
  if (t.equippedItems.includes('AUGUR_SCROLL')) itemSpeedMult *= 1.25;
  if (t.equippedItems.includes('CONSULAR_TOKEN')) itemDmgMult *= 1.15;
  // 2026-05-18 — EVENT-EXCLUSIVE LEGENDARIES (atk-speed half).
  // PERIMETER_TORCH (invasion):    +50% atk speed (damage in CombatResolver)
  // HELLGATE_BRAND   (gates):      +40% atk speed (damage in CombatResolver)
  if (t.equippedItems.includes('PERIMETER_TORCH')) itemSpeedMult *= 1.50;
  if (t.equippedItems.includes('HELLGATE_BRAND')) itemSpeedMult *= 1.40;
  // CURSED_TORC, LICH_GENERALS_SEAL, BARCA_WAR_HORN all converted to
  // AURA emitters in CombatResolver (2026-05). Self-buff lines removed
  // so a tower no longer double-dips its own aura.
  const extraRange =
    (t.equippedItems.includes('WATCHTOWER_LENS') ? 0.75 : 0) +
    (t.equippedItems.includes('DRUID_STAFF_FRAGMENT') ? 3 : 0) +
    (t.equippedItems.includes('GILDED_SCALE_ARMOR') ? 3 : 0) +
    // 2026-05-18 — INVASION-exclusive VANGUARD_PILUM: +2 tile range
    // alongside its +75% damage (applied in CombatResolver).
    (t.equippedItems.includes('VANGUARD_PILUM') ? 2 : 0) +
    // 2026-05-18 — EPIC LICTOR_FASCES: +1 tile range alongside its
    // +40% damage (applied above in itemDmgMult).
    (t.equippedItems.includes('LICTOR_FASCES') ? 2 : 0) +
    // 2026-05-19 — Gate-exclusive range items.
    (t.equippedItems.includes('BRONZE_GREAVES') ? 0.5 : 0) +
    (t.equippedItems.includes('CONSULAR_TOKEN') ? 0.75 : 0) +
    (isHarborOrTideforged && t.equippedItems.includes('AEGEAN_PEARL') ? 0.75 : 0) +
    (isHarborOrTideforged && t.equippedItems.includes('NEPTUNES_TRIDENT') ? 1.0 : 0) +
    // 2026 v2 — anti-air items add reach to catch fliers.
    (t.equippedItems.includes('FALCONERS_WATCHPOST') ? 3 : 0) +
    (t.equippedItems.includes('STORM_AQUILA_TALONS') ? 2 : 0) +
    (t.equippedItems.includes('QUICKDRAW_GLOVES') && !isMeleeClassTower(t) ? 0.5 : 0) +
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
    // Keep the radius synced with Agrippa's damage aura in CombatResolver.ts.
    ((() => {
      const g: any = typeof globalThis !== 'undefined' ? (globalThis as any) : undefined;
      const gs: any = g?.__game;
      if (!gs) return 0;
      if (t.damageType !== DamageType.SIEGE) return 0;
      for (const hero of gs.towers?.values?.() ?? []) {
        if (heroIdForTowerType(String(hero.type)) !== 'HERO_AGRIPPA') continue;
        if (hero.id !== gs.activeHeroTowerId && !isMercatorChampionType(String(hero.type))) continue;
        const dx = (hero.tileX - t.tileX);
        const dy = (hero.tileY - t.tileY);
        if (Math.hypot(dx, dy) <= 5) return 1.0 * heroAuraScaleForTower(gs, hero);
      }
      return 0;
    })()) +
    // SPEAR OF MARS — converts a melee tower into a thrown-spear unit by
    // adding five tiles of reach. CombatResolver spawns a visible PROJ_HASTA
    // flying from the tower to the target whenever a melee swing fires
    // while this item is equipped, so the extended range reads visually.
    (t.equippedItems.includes('SPEAR_OF_MARS') ? 7 : 0) +
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
  const gs: any = typeof globalThis !== 'undefined'
    ? ((globalThis as any).__lastState ?? (globalThis as any).__game ?? (typeof window !== 'undefined' ? (window as any).__lastState : null))
    : null;
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
  if (gs && hasBossTrophy(gs, 'AUXILIA_DRILL')) {
    const def: any = (towersData as any)[t.type];
    if (def?.kind === 'BASE') itemSpeedMult *= 1.10;
  }
  const defForRelic: any = (towersData as any)[t.type];
  const relicDpsMult = gs ? campaignRelicTowerDpsMult(gs, t, defForRelic?.kind) : 1;
  const relicSpeedMult = gs ? campaignRelicTowerSpeedMult(gs, t, defForRelic?.kind) : 1;
  const relicRangeBonus = gs ? campaignRelicTowerRangeBonus(gs, t) : 0;
  const harborDef: any = (towersData as any)[t.type];
  let harborDmgMult = 1;
  let harborSpeedMult = 1;
  let harborRangeBonus = 0;
  if (t.type === TowerType.HYDRA_OF_LERNA || t.type === TowerType.HYDRA_BEAST_PIT) {
    const headStacks = Math.min(t.type === TowerType.HYDRA_BEAST_PIT ? 8 : 5, Math.floor((t.killCount ?? 0) / 6));
    harborDmgMult *= 1 + headStacks * (t.type === TowerType.HYDRA_BEAST_PIT ? 0.09 : 0.08);
    harborSpeedMult *= 1 + headStacks * 0.035;
  }
  if (harborDef?.amphibious) {
    if ((t as any).placedOnWater) {
      harborRangeBonus += 0.5;
      harborDmgMult *= 1.08;
    } else {
      harborSpeedMult *= 1.08;
    }
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
  // applies to every deployed hero tower. Stacks live on game state (not on
  // the tower instance) so this branch reads from globalThis.__game,
  // same pattern used by the Agrippa range-aura block at line 314.
  let forgeDmgMult = 1;
  let heroLevelDmgMult = 1;
  if (t.isHero) {
    const g: any = typeof globalThis !== 'undefined' ? (globalThis as any) : undefined;
    const heroGs: any = g?.__game ?? g?.__lastState;
    heroLevelDmgMult = heroGs ? heroBasicAttackScaleForTower(heroGs, t) : 1;
    const n = heroGs?.heroForgeStacks?.dmg ?? 0;
    if (n > 0) forgeDmgMult = 1 + 0.06 * n;
  }
  return {
    dps: t.baseDps * dmgMult * itemDmgMult * classScalar * endlessDmgBoost * auraDmgMult * heroLevelDmgMult * forgeDmgMult * relicDpsMult * harborDmgMult,
    attackSpeed: t.attackSpeed * spdMult * itemSpeedMult * endlessSpdBoost * auraSpdMult * relicSpeedMult * harborSpeedMult * (isMeleeClassTower(t) ? MELEE_ATTACK_SPEED_MULT : 1),
    range: Math.max(isMeleeClassTower(t) ? MELEE_MIN_RANGE_TILES : 1, t.range + extraRange + endlessRangeBoost + auraRangeBonus + relicRangeBonus + harborRangeBonus)
  };
}

export function towerPerAttackDamageBase(t: Tower): number {
  const stats = towerEffectiveStats(t);
  const meleeTempo = isMeleeClassTower(t) ? MELEE_ATTACK_SPEED_MULT : 1;
  const effectiveBaseSpeed = Math.max(0.05, t.attackSpeed * TIER_MULTS.speed[t.qualityTier] * meleeTempo);
  return stats.dps / effectiveBaseSpeed;
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
  if (isMeleeClassTower(t)) spdMods.push({ source: 'Melee tempo', multiplier: MELEE_ATTACK_SPEED_MULT });

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
    if (t.type === TowerType.MARS_VICTOR) {
      // Mars Victor is a 6000g six-hero fusion and should not inherit the
      // generic ranged-combo dampener meant for ordinary ranged combos.
    } else if (APEX.has(t.type)) dmgMods.push({ source: 'Apex Balance', multiplier: 0.88 });
    else if (def.kind === 'COMBO' && def.melee === false) dmgMods.push({ source: 'Ranged Combo Balance', multiplier: 0.92 });
    else if (def.kind === 'BASE' && def.tierBand === 5) dmgMods.push({ source: 'T5 Base Balance', multiplier: 0.90 });
  }

  // ── Items ──────────────────────────────────────────────────────────────
  const items = t.equippedItems;
  if (items.includes('SHARPENED_BLADE')) dmgMods.push({ source: 'Sharpened Blade', multiplier: 1.10 });
  if (items.includes('CELTIC_LONGSWORD') &&
      (t.damageType === DamageType.PHYS_MELEE || t.damageType === DamageType.PHYS_RANGED)) {
    dmgMods.push({ source: 'Celtic Longsword', multiplier: 1.50 });
  }
  if (items.includes('NECROTIC_LONGSWORD') &&
      (t.damageType === DamageType.PHYS_MELEE || t.damageType === DamageType.PHYS_RANGED)) {
    dmgMods.push({ source: 'Necrotic Longsword', multiplier: 1.55 });
  }
  if (items.includes('STORM_JAVELIN') && t.damageType === DamageType.PHYS_RANGED) {
    dmgMods.push({ source: 'Storm Javelin', multiplier: 1.40 });
  }
  if (items.includes('TRAINING_SCROLL')) {
    dmgMods.push({ source: 'Training Scroll', multiplier: 1.05 });
    spdMods.push({ source: 'Training Scroll', multiplier: 1.08 });
  }
  if (items.includes('QUICKDRAW_GLOVES') && !isMeleeClassTower(t)) {
    spdMods.push({ source: 'Quickdraw Gloves (ranged)', multiplier: 1.22 });
    rngMods.push({ source: 'Quickdraw Gloves (ranged)', flat: 0.5 });
  }
  if (items.includes('MERCURY_FEATHER')) spdMods.push({ source: 'Mercury Feather', multiplier: 1.25 });
  if (items.includes('HOURGLASS_OF_SATURN')) spdMods.push({ source: 'Hourglass of Saturn', multiplier: 1.40 });
  if (items.includes('CAVALRY_SPUR') && t.damageType === DamageType.PHYS_MELEE) spdMods.push({ source: 'Cavalry Spur (melee)', multiplier: 1.25 });
  // WAR_HOUND_COLLAR is an AURA (2026-05) — buff appears via the
  // cross-tower aura pass below, not on self.
  if (items.includes('NUMIDIAN_SADDLE') && t.damageType === DamageType.PHYS_RANGED) spdMods.push({ source: 'Numidian Saddle (ranged)', multiplier: 1.60 });
  // CAVALRY_SPUR's +0.5 range bonus stays paired with the speed mod (melee-only).
  if (items.includes('CAVALRY_SPUR') && t.damageType === DamageType.PHYS_MELEE) rngMods.push({ source: 'Cavalry Spur (melee)', flat: 0.5 });
  if (items.includes('WATCHTOWER_LENS')) rngMods.push({ source: 'Watchtower Lens', flat: 0.75 });
  // ── Legendary trophies (real effects) ─────────────────────────────────
  if (items.includes('BERSERKERS_MUZZLE') && t.damageType === DamageType.PHYS_MELEE) {
    dmgMods.push({ source: "Berserker's Muzzle (melee)", multiplier: 1.45 });
    spdMods.push({ source: "Berserker's Muzzle (melee)", multiplier: 1.30 });
  }
  // DRUIDS_TORC is an AURA — buff appears via aura pass below.
  // GALLIC_SHIELD_BOSS is a control proc, not a stat modifier.
  if (items.includes('GILDED_SCALE_ARMOR')) { dmgMods.push({ source: 'Gilded Scale Armor', multiplier: 1.60 }); rngMods.push({ source: 'Gilded Scale Armor', flat: 3 }); }
  // CURSED_TORC / LICH_GENERALS_SEAL / BARCA_WAR_HORN are AURAS — they
  // buff nearby allies (or debuff nearby enemies), not the wearer.
  if (items.includes('DRUID_STAFF_FRAGMENT')) rngMods.push({ source: 'Druid Staff Fragment', flat: 3 });
  if (items.includes('LICTOR_FASCES')) { dmgMods.push({ source: "Lictor's Fasces", multiplier: 1.40 }); rngMods.push({ source: "Lictor's Fasces", flat: 2 }); }
  if (items.includes('AUXILIARY_SLING') && t.damageType === DamageType.PHYS_RANGED) dmgMods.push({ source: 'Auxiliary Sling', multiplier: 1.55 });
  if (items.includes('FALCONERS_WATCHPOST')) { spdMods.push({ source: "Falconer's Watchpost", multiplier: 1.40 }); rngMods.push({ source: "Falconer's Watchpost", flat: 3 }); }
  if (items.includes('AUGUR_SCROLL')) spdMods.push({ source: "Augur's Scroll", multiplier: 1.25 });
  if (items.includes('CONSULAR_TOKEN')) { dmgMods.push({ source: 'Consular Token', multiplier: 1.15 }); rngMods.push({ source: 'Consular Token', flat: 0.75 }); }
  if (items.includes('RUSTED_HASTA')) dmgMods.push({ source: 'Rusted Hasta', multiplier: 1.10 });
  if (items.includes('SPEAR_OF_MARS')) { dmgMods.push({ source: 'Spear of Mars', multiplier: 1.60 }); rngMods.push({ source: 'Spear of Mars', flat: 7 }); }
  if (items.includes('CAPITOLINE_AEGIS')) dmgMods.push({ source: 'Capitoline Aegis divine rider', multiplier: 1.35 });
  if (items.includes('VANGUARD_PILUM')) { dmgMods.push({ source: 'Vanguard Pilum', multiplier: 1.75 }); rngMods.push({ source: 'Vanguard Pilum', flat: 2 }); }
  if (items.includes('PERIMETER_TORCH')) {
    dmgMods.push({ source: 'Perimeter Torch', multiplier: 1.50 });
    spdMods.push({ source: 'Perimeter Torch', multiplier: 1.50 });
  }
  if (items.includes('HELLGATE_BRAND')) {
    dmgMods.push({ source: 'Hellgate Brand', multiplier: 1.80 });
    spdMods.push({ source: 'Hellgate Brand', multiplier: 1.40 });
  }
  if (items.includes('BRONZE_GREAVES')) rngMods.push({ source: 'Bronze Greaves', flat: 0.5 });
  if (items.includes('STORM_AQUILA_TALONS')) rngMods.push({ source: 'Storm Aquila Talons', flat: 2 });

  // ── Live support aura stack ───────────────────────────────────────────
  // Mirrors CombatResolver: global damage sources add together, local
  // auras multiply, and the final support stack is capped at 2x.
  if (state?.towers) {
    const pctLabel = (pct: number) => `${pct >= 0 ? '+' : ''}${Math.round(pct * 100)}%`;
    const multLabel = (mult: number) => pctLabel(mult - 1);
    const auraDmgParts: string[] = [];
    const auraSpdParts: string[] = [];
    let globalDmgBonus = 0;
    let globalSpeedMult = 1;
    let localDmgMult = 1;
    let localSpeedMult = 1;
    const cx = t.tileX * GRID.TILE + GRID.TILE / 2;
    const cy = t.tileY * GRID.TILE + GRID.TILE / 2;
    const tick = state.tick ?? 0;
    const nullifiers: Array<{ x: number; y: number }> = [];
    for (const e of state.enemies?.values?.() ?? []) {
      if (e.hp <= 0) continue;
      const enemyDef: any = (enemiesData as any)[e.type];
      if (enemyDef?.auraNullifier) nullifiers.push({ x: e.x, y: e.y });
    }
    const isAuraOff = (other: Tower): boolean => {
      if (((other as any).asleepUntil ?? 0) > tick) return true;
      if (nullifiers.length === 0) return false;
      const ox = other.tileX * GRID.TILE + GRID.TILE / 2;
      const oy = other.tileY * GRID.TILE + GRID.TILE / 2;
      for (const n of nullifiers) {
        if (Math.hypot(n.x - ox, n.y - oy) <= 2 * GRID.TILE) return true;
      }
      return false;
    };
    const addGlobalDmg = (label: string, pct: number) => {
      if (pct === 0) return;
      globalDmgBonus += pct;
      auraDmgParts.push(`${label} ${pctLabel(pct)}`);
    };
    const addGlobalSpeed = (label: string, mult: number) => {
      if (mult === 1) return;
      globalSpeedMult *= mult;
      auraSpdParts.push(`${label} ${multLabel(mult)}`);
    };
    const addLocalDmg = (label: string, pct: number) => {
      if (pct === 0) return;
      localDmgMult *= 1 + pct;
      auraDmgParts.push(`${label} ${pctLabel(pct)}`);
    };
    const addLocalSpeed = (label: string, pct: number) => {
      if (pct === 0) return;
      localSpeedMult *= 1 + pct;
      auraSpdParts.push(`${label} ${pctLabel(pct)}`);
    };
    const within = (other: Tower, radiusTiles: number): boolean => {
      const ox = other.tileX * GRID.TILE + GRID.TILE / 2;
      const oy = other.tileY * GRID.TILE + GRID.TILE / 2;
      return Math.hypot(ox - cx, oy - cy) <= radiusTiles * GRID.TILE;
    };

    const poolLevel = state.poolLevel ?? 0;
    addGlobalDmg(`Pool L${poolLevel}`, 0.03 * Math.max(0, poolLevel - 1));

    const heroAuraSources: Array<{ heroId: string; tower: Tower; auraScale: number }> = [];
    for (const other of state.towers.values() as Iterable<Tower>) {
      if (other.pending) continue;
      const heroId = heroIdForTowerType(String(other.type));
      if (!heroId) continue;
      if (other.id === state.activeHeroTowerId || isMercatorChampionType(String(other.type))) {
        heroAuraSources.push({ heroId, tower: other, auraScale: heroAuraScaleForTower(state, other) });
      }
    }
    let caesarAuraScale = 0;
    for (const h of heroAuraSources) {
      if (h.heroId === 'HERO_CAESAR' && h.auraScale > caesarAuraScale) caesarAuraScale = h.auraScale;
    }
    if (caesarAuraScale > 0) {
      addGlobalDmg('Hero Caesar', 0.15 * caesarAuraScale);
      addGlobalSpeed('Hero Caesar', 1 + 0.15 * caesarAuraScale);
    }

    for (const other of state.towers.values() as Iterable<Tower>) {
      if (other.pending || isAuraOff(other)) continue;
      const oTier = other.qualityTier;
      if (other.type === TowerType.EAGLE_STANDARD) {
        addGlobalDmg(`Eagle Standard T${oTier}`, 0.18 * (1 + 0.05 * (oTier - 1)));
        if (within(other, 5)) addLocalSpeed('Eagle Standard local', 0.22);
      }
      if (other.type === TowerType.AQUILIFER_TITAN) {
        addGlobalDmg(`Aquilifer Titan T${oTier}`, 0.35 * (1 + 0.05 * (oTier - 1)));
      }
      if (other.type === TowerType.MARS_VICTOR) {
        addGlobalDmg('Mars Victor', 0.35);
        addGlobalSpeed('Mars Victor', 1.20);
      }
      if (other.type === TowerType.JULIUS_CAESAR) addGlobalDmg('Julius Caesar', 0.55);
      if (other.type === TowerType.TRIUMVIRATE) {
        addGlobalDmg('Triumvirate', 0.40);
        addGlobalSpeed('Triumvirate', 1.30);
      }
      if (other.type === TowerType.AUREATE_TRIBUNAL) {
        addGlobalDmg('Aureate Tribunal', 0.55);
        addGlobalSpeed('Aureate Tribunal', 1.40);
      }
      if (other.type === TowerType.IMPERIUM_ETERNUM) addGlobalSpeed('Imperium Eternum', 1.25);
      if (other.type === TowerType.TRIARIUS) addGlobalDmg('Triarius global', 0.12);
      if (other.type === TowerType.CONSULAR_FATEBINDER) {
        addGlobalDmg('Fatebinder', 0.22);
        addGlobalSpeed('Fatebinder', 1.22);
      }
      if (other.type === TowerType.COHORT_GUARD && within(other, 3)) addLocalDmg('Cohort Guard local', 0.15);
      if (other.type === TowerType.TRIPLEX_ACIES && within(other, 3)) addLocalSpeed('Triplex Acies', 0.25);
      if (other.type === TowerType.LEGION_PRIME && within(other, 3)) addLocalDmg('Legion Prime', 0.25);
      if (other.type === TowerType.GLACIAL_PALISADE && within(other, 3)) addLocalDmg('Glacial Palisade', 0.20);

      const otherItems = other.equippedItems ?? [];
      if (otherItems.includes('CENTURIONS_TRUMPET') && within(other, 2.5)) addLocalSpeed("Centurion's Trumpet aura", 0.18);
      if (otherItems.includes('BATTLE_STANDARD') && within(other, 2.5)) addLocalDmg('Battle Standard aura', 0.18);
      if (otherItems.includes('WAR_HOUND_COLLAR') && within(other, 3)) addLocalSpeed('War-Hound Collar aura', 0.28);
      if (otherItems.includes('DRUIDS_TORC') && within(other, 3)) addLocalDmg("Druid's Torc aura", 0.28);
      if (otherItems.includes('BARCA_WAR_HORN') && within(other, 3.5)) {
        addLocalDmg('Barca War Horn aura', 0.30);
        addLocalSpeed('Barca War Horn aura', 0.20);
      }
      if (otherItems.includes('LICH_GENERALS_SEAL') && within(other, 3.5)) {
        addLocalDmg("Lich General's Seal aura", 0.30);
        addLocalSpeed("Lich General's Seal aura", 0.30);
      }
      if (otherItems.includes('AQUILIFER_BANNER') && within(other, 3)) {
        addLocalDmg("Aquilifer's Banner aura", 0.20);
        addLocalSpeed("Aquilifer's Banner aura", 0.15);
      }
      if (otherItems.includes('OPTIO_WHISTLE') && within(other, 3)) addLocalSpeed("Optio's Whistle aura", 0.28);
      if (otherItems.includes('INFERNO_STANDARD') && within(other, 3.5)) addLocalDmg('Inferno Standard aura', 0.40);
    }

    for (const h of heroAuraSources) {
      if (h.tower.id === t.id) continue;
      const dh = Math.hypot(
        (h.tower.tileX - t.tileX) * GRID.TILE,
        (h.tower.tileY - t.tileY) * GRID.TILE
      );
      if (h.heroId === 'HERO_MARIUS' && t.damageType === DamageType.PHYS_MELEE && dh <= 5 * GRID.TILE) {
        addLocalDmg('Hero Marius melee aura', 0.35 * h.auraScale);
      }
      if (h.heroId === 'HERO_AGRIPPA' && t.damageType === DamageType.SIEGE && dh <= 5 * GRID.TILE) {
        addLocalDmg('Hero Agrippa siege aura', 0.30 * h.auraScale);
        rngMods.push({ source: 'Hero Agrippa range aura', flat: 1 * h.auraScale });
      }
      if (h.heroId === 'HERO_SULLA' && dh <= SULLA_PASSIVE_RADIUS_TILES * GRID.TILE) {
        addLocalDmg('Hero Sulla fire rider', 0.22 * h.auraScale);
      }
    }

    const marianUntil = (t as any).__marianFormationUntilTick ?? 0;
    if (tick < marianUntil) {
      const sMult = (t as any).__marianSpeedMult ?? 1.0;
      const dMult = (t as any).__marianDmgMult ?? 1.0;
      if (dMult !== 1) {
        localDmgMult *= dMult;
        auraDmgParts.push(`Marian Formation ${multLabel(dMult)}`);
      }
      if (sMult !== 1) {
        localSpeedMult *= sMult;
        auraSpdParts.push(`Marian Formation ${multLabel(sMult)}`);
      }
    }

    const rawAuraDmg = (1 + globalDmgBonus) * localDmgMult;
    const rawAuraSpeed = globalSpeedMult * localSpeedMult;
    const cappedAuraDmg = Math.min(AURA_STACK_CAP, rawAuraDmg);
    const cappedAuraSpeed = Math.min(AURA_STACK_CAP, rawAuraSpeed);
    if (cappedAuraDmg !== 1) {
      dmgMods.push({
        source: `Aura stack${rawAuraDmg > AURA_STACK_CAP ? ' (capped)' : ''}: ${auraDmgParts.join(' · ')}`,
        multiplier: cappedAuraDmg
      });
    }
    if (cappedAuraSpeed !== 1) {
      spdMods.push({
        source: `Aura stack${rawAuraSpeed > AURA_STACK_CAP ? ' (capped)' : ''}: ${auraSpdParts.join(' · ')}`,
        multiplier: cappedAuraSpeed
      });
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
  rangeFinal = Math.max(isMeleeClassTower(t) ? MELEE_MIN_RANGE_TILES : 1, rangeFinal);

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
