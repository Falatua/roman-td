import { ItemId } from '../types';
import items from '../data/items_permanent.json';
import { Rarity } from './LootSystem';

export interface ShopOffer {
  itemId: ItemId;
  rarity: Rarity;
  price: number;
  isConsumable: boolean;
}

const ITEMS = items as Record<string, any>;
// Wider pools so each 5-wave rotation actually looks different.
// Items shown are rolled distinct (no dupes within a single visit).
// 2026-05 v6: DOT items pulled from the gate shop pools entirely so
// damage-over-time builds require a deliberate Mercator visit. Gate
// shop now offers only direct-stat / aura / range / speed items.
// 2026-05 v10: BARBED_GLADIUS (MELEE-only Bleed, 1%/s for 10s) added
// back to GATE_COMMON. It's a melee-only entry-point bleed — players
// who lean into melee builds now get a basic bleed option without
// having to wait for Mercator. Heavier bleeds (Falcata, Alpha Pack
// Fang) still gate behind boss drops + Mercator.
const GATE_COMMON = [
  'SHARPENED_BLADE','TRAINING_SCROLL','WATCHTOWER_LENS',
  'IRON_TIP','QUICKDRAW_GLOVES','BARBED_GLADIUS'
];
const GATE_UNCOMMON = [
  'FLYER_BANE','CAVALRY_SPUR','MERCURY_FEATHER'
];
const GATE_RARE = [
  'CENTURIONS_TRUMPET','BATTLE_STANDARD','GOLD_PURSE','STORM_JAVELIN',
  'HOURGLASS_OF_SATURN'
];
const MERCATOR_RARE = [
  'HOURGLASS_OF_SATURN','STORM_JAVELIN','BATTLE_STANDARD','CENTURIONS_TRUMPET',
  'GOLD_PURSE'
];
const MERCATOR_MID = [
  'CAVALRY_SPUR','MERCURY_FEATHER','QUICKDRAW_GLOVES','FLYER_BANE',
  'FIRE_OIL_FLASK','POISONED_BLADE','BARBED_GLADIUS','IRON_TIP','TRAINING_SCROLL',
  // 2026-05 v6: Mercator-exclusive uncommon (gate shop never carries this).
  'TYRIAN_DYE',
  // 2026-05 v9: poison-family expansion. Players had two BURN options and
  // three BLEED options but only ONE poison item (POISONED_BLADE, melee-
  // only). Adding three mid-game pickups closes the gap so the DOT split
  // (one BURN + one POISON + one BLEED per tower) is actually playable on
  // ranged/aerial towers too.
  'VENOM_TIPPED_ARROWS', 'SERPENT_AMULET', 'VESTAL_PYRE'
];
// 2026-05 v6: items the Mercator stocks that the gate shop never carries.
// One guaranteed slot per visit picks from this pool so Mercator wares feel
// distinct, not "more of what you saw at the gate."
const MERCATOR_EXCLUSIVE_RARE = [
  'SCIPIO_PLAYBOOK','AQUILIFER_BANNER','PUNIC_LEDGER',
  // 2026-05 v9: heavy poison option in the RARE bucket. Higher rarity =
  // higher chance of seeing it across the run since the Mercator
  // guarantees an exclusive-rare per visit.
  'WITCHS_VENOM'
];
// Premium Mercator stock — Legendary trophies that the Gate Shop never carries.
// These cost 3-5× a normal item but offer build-defining effects.
const MERCATOR_LEGENDARY = [
  'ALPHA_PACK_FANG','WAR_HOUND_COLLAR','CELTIC_LONGSWORD','ELEPHANT_TUSK',
  'NUMIDIAN_SADDLE','FALCATA_BLADE','BARCA_WAR_HORN','GILDED_SCALE_ARMOR',
  'NECROTIC_LONGSWORD','LICH_GENERALS_SEAL','HANNIBALS_STRATEGY_SCROLL',
  'DRUID_STAFF_FRAGMENT',
  // 2026-05 build-defining legendaries — anti-air enabler, spear-throw
  // melee, chain lightning. All rotated through the same per-run
  // uniqueness filter so the player never sees a duplicate.
  'AQUILA_TALONS','SPEAR_OF_MARS','JUPITERS_WRATH'
];
// Legendary trophies baseline at 150g (set in items_permanent.json).
// Mercator no longer marks them up — codex price == Mercator price for
// orange/legendary items, so the player always sees the same number.
const LEGENDARY_PREMIUM_PRICE = 0;

// (Consumable price table removed 2026-05 — one-use items are gone.)

// MERCATOR tower offer — actual placeable tower for sale. Generated fresh
// every Mercator visit. Tier weighting scales with current wave so late-game
// visits offer T4-T5 more often. Purpose is to fill recipe gaps, not raw DPS.
export interface MercatorTowerOffer {
  type: string;     // tower type id (e.g. 'CENTURION')
  tier: number;     // 1..5
  price: number;    // gold cost
}

export interface ShopState {
  type: 'GATE' | 'MERCATOR';
  offers: ShopOffer[];
  livesPrice: number;
  livesMaxThisVisit: number;
  livesBoughtThisVisit: number;
  // Mercator-only: 3 random tower offers, tier-weighted by wave.
  towerOffers?: MercatorTowerOffer[];
  // Mercator-only: Fortuna's Wheel — 500g RNG roll on any combo tower
  // (T2-T5, all 34 combos are in the pool with uniform odds). Tracked
  // per-visit so the player can see how many times they've gambled this
  // round. No cap — pure RNG, by design.
  gambleSpinsThisVisit?: number;
  gambleWinsThisVisit?: string[];
}

// Mercator tower offerings (2026-05): Mercator now ONLY stocks T5 towers
// and every offer is a flat 50g. The player still gets variety in tower
// TYPE (the pool below picks 3 distinct types per visit) — they just
// always arrive at apex tier and at the same price tag.
const MERCATOR_TOWER_PRICE: Record<number, number> = {
  1: 50, 2: 50, 3: 50, 4: 50, 5: 50
};

// Buyable tower pool — base & low-tier combo towers only. Specifically
// excludes apex/cross-combos: those have to be earned via crafting.
const MERCATOR_TOWER_POOL = [
  // Core BASE
  'MILITES','VELITES','HASTATI','SAGITTARIUS','SCORPIO','TRIARIUS',
  'DECURION','CENTURION','PRIMUS_PILUS','LEGATE',
  // Tier-band fillers
  'AUXILIA','FUNDIBULUS','RORARIUS','LIBRITOR','ACCENSUS',
  'RETIARIUS','BALLISTARIUS','OPTIO','PUGIO_ASSASSIN','ARCUBALLISTA',
  'VENATOR','IGNIFER','SPECULATOR','FLAMEN','CARROBALLISTA','AQUILA_VENATOR',
  // 2026-05-15 v13: CLIBANARIUS dropped from Mercator pool — it's now a
  // mid-game COMBO. Players craft it from Pugio Assassin + Cataphract.
  'CATAPHRACT','AUGUR','EVOCATUS','HARUSPEX',
  'PRAEFECTUS','VULCAN_ENGINEER','IMPERATOR_GUARD','SOLAR_PRIEST','COLOSSUS_ONAGER'
];

function rollTier(_wave: number): number {
  // 2026-05: Mercator now only sells T5 towers (always apex tier). The
  // wave-bracket weight table is retired; the function is kept so the
  // call site doesn't change.
  return 5;
}

export function buildMercatorTowerOffers(wave: number, count = 5): MercatorTowerOffer[] {
  const offers: MercatorTowerOffer[] = [];
  const used = new Set<string>();
  let tries = 0;
  // 2026-05 v9: defensive filter — APEX cross-combos (Imperium Eternum,
  // Carthage Scourge, Triumvirate, Legion Prime, Consular Fatebinder)
  // are NEVER offered for sale. If a future contributor accidentally
  // adds one to MERCATOR_TOWER_POOL, this filter blocks it from
  // reaching the player. Apex towers must be crafted, not bought.
  const eligible = MERCATOR_TOWER_POOL.filter(id => !FORTUNA_APEX_BLOCKLIST.has(id));
  while (offers.length < count && tries++ < 50) {
    const type = eligible[Math.floor(Math.random() * eligible.length)];
    if (used.has(type)) continue;
    used.add(type);
    const tier = rollTier(wave);
    offers.push({ type, tier, price: MERCATOR_TOWER_PRICE[tier] ?? 100 });
  }
  return offers;
}

function asRarity(s: string): Rarity { return s as Rarity; }

// 20-WAVE CAMPAIGN: Mercator visits land on the wave BEFORE each scheduled
// boss (W5/W10/W15/W20). Visits: W4, W9, W14, W19.
export const MERCATOR_WAVES = [4, 9, 14, 19];

// 2026-05 v10: BARBED_GLADIUS is a guaranteed gate-shop staple from the
// very first visit — melee-only bleed should always be reachable for
// pure-melee builds, not gated behind a lucky 3-of-6 common roll. The
// guarantee is implemented by reserving one of the 3 common slots for
// BARBED_GLADIUS and sampling the other 2 from the remaining pool.
const GATE_GUARANTEED_COMMONS = ['BARBED_GLADIUS'];

export function buildGateShop(_refreshSeed = 0, ownedLegendaries?: Set<string>): ShopState {
  const offers: ShopOffer[] = [];
  // Reserved slot(s): always-stocked common items. Pulled from the same
  // items_permanent.json source so price + rarity stay consistent.
  for (const id of GATE_GUARANTEED_COMMONS) {
    const def = ITEMS[id];
    if (def) offers.push({ itemId: id as ItemId, rarity: asRarity(def.rarity), price: def.buy, isConsumable: false });
  }
  // Random commons drawn from the rest of the pool (skip the guaranteed
  // ones so the player can't see a duplicate).
  const remainingCommons = GATE_COMMON.filter(id => !GATE_GUARANTEED_COMMONS.includes(id));
  const commonsNeeded = Math.max(0, 3 - GATE_GUARANTEED_COMMONS.length);
  const commons = sampleN(entries(remainingCommons), commonsNeeded);
  const uncommons = sampleN(entries(GATE_UNCOMMON), 3);
  const rares = sampleN(entries(GATE_RARE), 2);
  for (const [id, def] of commons) offers.push({ itemId: id, rarity: 'COMMON', price: def.buy, isConsumable: false });
  for (const [id, def] of uncommons) offers.push({ itemId: id, rarity: 'UNCOMMON', price: def.buy, isConsumable: false });
  for (const [id, def] of rares) offers.push({ itemId: id, rarity: 'RARE', price: def.buy, isConsumable: false });
  // 2026-05 v11: ONE rotating LEGENDARY slot per gate-shop refresh. Keeps
  // the gate shop relevant past the early game without devaluing the
  // Mercator (which still offers FOUR legendaries per visit + the T5
  // armory). Filters out anything the player already owns so the slot
  // always rotates fresh. Falls through to a random pick if nothing is
  // available (every legendary owned — extremely rare).
  const legendaryPool = ownedLegendaries
    ? MERCATOR_LEGENDARY.filter(id => !ownedLegendaries.has(id))
    : MERCATOR_LEGENDARY;
  const legendarySource = legendaryPool.length > 0 ? legendaryPool : MERCATOR_LEGENDARY;
  const picked = legendarySource[Math.floor(Math.random() * legendarySource.length)];
  const legendaryDef = ITEMS[picked];
  if (legendaryDef) {
    offers.push({ itemId: picked as ItemId, rarity: 'LEGENDARY', price: legendaryDef.buy, isConsumable: false });
  }
  return { type: 'GATE', offers, livesPrice: 5, livesMaxThisVisit: 5, livesBoughtThisVisit: 0 };
}

export function buildMercatorStock(_seed = 0, ownedLegendaries?: Set<string>): ShopState {
  // Mercator is the high-tier vendor. Each `sampleN` call is wrapped in a
  // length check so a partially-populated items.json can't crash the build.
  const offers: ShopOffer[] = [];

  // 2 guaranteed Legendary trophies — premium-priced, distinct.
  // Filter out anything the player ALREADY HOLDS (inventory or equipped)
  // so the Mercator rotates fresh legendaries instead of offering duplicates.
  // If everything is owned the pool falls through to an empty array and
  // sampleN just returns nothing — no crash, just no legendary row.
  // 2026-05 v6: Mercator legendaries now hard-set to a flat 75g each
  // regardless of items.json baseline. Keeps trophies aspirational but
  // reachable without the prior 120-140g price tags.
  const filteredLegendaryIds = ownedLegendaries
    ? MERCATOR_LEGENDARY.filter(id => !ownedLegendaries.has(id))
    : MERCATOR_LEGENDARY;
  // 2026-05 v6: bumped 2 → 4 legendary slots so each Mercator visit
  // actually feels like a trophy haul. Still filtered against owned
  // legendaries so no duplicates land in the stock.
  const legs = sampleN(entries(filteredLegendaryIds), 4);
  for (const [id] of legs) {
    offers.push({ itemId: id, rarity: 'LEGENDARY', price: 75, isConsumable: false });
  }

  // 1 guaranteed Rare with a steep markup.
  const rares = sampleN(entries(MERCATOR_RARE), 1);
  if (rares.length > 0) {
    const [rId, rDef] = rares[0];
    offers.push({ itemId: rId, rarity: 'RARE', price: (rDef?.buy ?? 8) + 8, isConsumable: false });
  }

  // 2026-05 v6: 1 GUARANTEED Mercator-exclusive item (Scipio's Playbook,
  // Aquilifer's Banner, or Punic Ledger). These never appear in the gate
  // shop, so the player has a reason to actually visit the Mercator beyond
  // the legendary slots.
  const excl = sampleN(entries(MERCATOR_EXCLUSIVE_RARE), 1);
  if (excl.length > 0) {
    const [eId, eDef] = excl[0];
    offers.push({ itemId: eId, rarity: 'RARE', price: (eDef?.buy ?? 36), isConsumable: false });
  }

  // Consumables removed 2026-05 — Mercator now slots an extra mid-tier
  // permanent item where the one-use consumable used to sit, so stock
  // size remains stable.

  // 3 mid items (was 2 + 1 consumable), all marked up.
  const mids = sampleN(entries(MERCATOR_MID), 3);
  for (const [id, def] of mids) {
    if (!def) continue;
    offers.push({ itemId: id, rarity: asRarity(def.rarity), price: (def.buy ?? 5) + 4, isConsumable: false });
  }

  return { type: 'MERCATOR', offers, livesPrice: 7, livesMaxThisVisit: 3, livesBoughtThisVisit: 0, towerOffers: [], gambleSpinsThisVisit: 0, gambleWinsThisVisit: [] };
}

// ─── Fortuna's Wheel — 500g RNG combo-tower gamble ─────────────────────
// Pure-RNG mechanic added 2026-05 v9. The pool is every authored COMBO
// tower in towers.json (currently 34 across T2/T3/T4/T5). Every spin
// rolls a TIER first (linearly weighted so apex towers stay rare) and
// then uniformly picks a tower within that tier. No pity, no per-visit
// cap. The player decides when to stop chasing.
//
// TIER ODDS (2026-05 v10, refined from the original uniform-pool roll):
//   T2 weight 4 → 40% per spin (every T2 individually ~10%)
//   T3 weight 3 → 30% per spin (every T3 individually ~10%)
//   T4 weight 2 → 20% per spin (every T4 individually ~5%)
//   T5 weight 1 → 10% per spin (every T5 individually ~0.43%)
// A linear 4/3/2/1 ramp: each step up the tier ladder cuts the per-spin
// hit chance by 10 percentage points. T5 "feels earned" — average ~10
// spins (5,000g) to land any T5; getting a SPECIFIC T5 averages ~230
// spins (115,000g). T2/T3 stay common so 500g still has a clear floor.
import towersJson from '../data/towers.json';
export const FORTUNA_GAMBLE_COST = 500;
// 2026-05 v9: APEX super-combos are no longer rollable from Fortuna or
// offered in the Mercator tower lineup. The 5 LATE-game cross-combos
// (Imperium Eternum, Carthage Scourge, Triumvirate, Legion Prime,
// Consular Fatebinder) are win-condition towers — they MUST be earned
// through crafting, not bought. Buying-your-way-to-victory was hollowing
// out the recipe meta. The pool keeps every other combo (early + mid
// recipes) so gold still has a clear path to a strong placement.
const FORTUNA_APEX_BLOCKLIST = new Set([
  'IMPERIUM_ETERNUM',
  'CARTHAGE_SCOURGE',
  'TRIUMVIRATE',
  'LEGION_PRIME',
  'CONSULAR_FATEBINDER'
]);
export const FORTUNA_GAMBLE_POOL: string[] = Object.entries(towersJson as any)
  .filter(([id, def]: any) => def.kind === 'COMBO' && !FORTUNA_APEX_BLOCKLIST.has(id))
  .map(([id]) => id);

// Linear-descending tier weights. T2 = weight 4 (most common), T5 = 1.
export const FORTUNA_TIER_WEIGHTS: Record<number, number> = { 2: 4, 3: 3, 4: 2, 5: 1 };

// Pool grouped by tier band — built once at module load so the weighted
// roll doesn't iterate the whole pool every spin.
const FORTUNA_POOL_BY_TIER: Map<number, string[]> = (() => {
  const map = new Map<number, string[]>();
  for (const id of FORTUNA_GAMBLE_POOL) {
    const def: any = (towersJson as any)[id];
    const tier = def?.tierBand ?? 5;
    if (!map.has(tier)) map.set(tier, []);
    map.get(tier)!.push(id);
  }
  return map;
})();

// Sorted ascending tier list — cached for the rolling loop.
const FORTUNA_TIERS_ASC: number[] = Array.from(FORTUNA_POOL_BY_TIER.keys()).sort((a, b) => a - b);

// Per-tier probability summary (precomputed for UI hints).
export function getFortunaTierOdds(): Array<{ tier: number; pct: number; count: number }> {
  const totalW = FORTUNA_TIERS_ASC.reduce((s, t) => s + (FORTUNA_TIER_WEIGHTS[t] ?? 0), 0);
  return FORTUNA_TIERS_ASC.map(t => ({
    tier: t,
    pct: ((FORTUNA_TIER_WEIGHTS[t] ?? 0) / totalW) * 100,
    count: FORTUNA_POOL_BY_TIER.get(t)?.length ?? 0
  }));
}

// Single-spin roll. Linearly-weighted tier pick, then uniform within tier.
// Caller is responsible for gold debit + adding the tower to
// pendingPurchasedTowers.
export function rollFortunaCombo(): { type: string; tier: number } {
  const totalW = FORTUNA_TIERS_ASC.reduce((s, t) => s + (FORTUNA_TIER_WEIGHTS[t] ?? 0), 0);
  let r = Math.random() * totalW;
  let pickedTier = FORTUNA_TIERS_ASC[0];
  for (const t of FORTUNA_TIERS_ASC) {
    r -= FORTUNA_TIER_WEIGHTS[t] ?? 0;
    if (r < 0) { pickedTier = t; break; }
  }
  const inTier = FORTUNA_POOL_BY_TIER.get(pickedTier) ?? FORTUNA_GAMBLE_POOL;
  const id = inTier[Math.floor(Math.random() * inTier.length)];
  return { type: id, tier: pickedTier };
}

function entries(ids: string[]): [string, any][] {
  return ids.map(id => [id, ITEMS[id]] as [string, any]).filter(([, def]) => !!def);
}

// Fisher-Yates shuffle, take first N. Guarantees distinct picks within a single visit.
function sampleN<T>(arr: [string, T][], n: number): [string, T][] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.min(n, a.length));
}

export function isMercatorWave(wave: number): boolean { return MERCATOR_WAVES.includes(wave); }
// 20-WAVE CAMPAIGN: gate shop refreshes every 4 waves (5 refreshes per run).
export function gateShopRefreshDue(wave: number): boolean { return wave > 0 && wave % 4 === 0; }
