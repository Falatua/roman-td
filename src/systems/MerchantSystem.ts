import { ItemId } from '../types';
import items from '../data/items_permanent.json';
import { itemBuyPrice, Rarity } from './LootSystem';
import { championForHero } from './HeroIdentity';
import { itemRandomSelectionWeight } from './ItemRules';

export interface ShopOffer {
  itemId: ItemId;
  rarity: Rarity;
  price: number;
  isConsumable: boolean;
}

const ITEMS = items as Record<string, any>;
// Wider pools so each 5-wave rotation actually looks different.
// Items shown are rolled distinct (no dupes within a single visit).
// 2026-05-18 — MERCATOR-EXCLUSIVE RESTRUCTURE. Every item that appears
// in any Mercator pool is now ABSENT from gate pools, so the Mercator
// truly is the only source for those wares. The gate shop becomes a
// thin "starter stat" stop that sells SHARPENED_BLADE and
// WATCHTOWER_LENS as guaranteed commons — both items unique to the
// gate (Mercator never carries them). Players between Mercator visits
// can buy basic damage / range pickups from the gate; everything
// else requires a deliberate Mercator visit.
//
// Mercator's offerings split across four tiers:
//   • MID = uncommon-tier mostly-stat items (the previous gate
//     uncommons + Mercator-mids, all consolidated here).
//   • RARE = aura + utility items (the previous gate rares + Mercator
//     rares + Mercator-exclusive rares, all consolidated here).
//   • EPIC = the new purple tier (2026-05-18). Three demoted melee
//     legendaries + three new 60g items live here.
//   • LEGENDARY = build-defining trophies, same set as before.
// 2026-05-19 — Gate-exclusive items added (5 new) so the gate shop
// actually carries a rotating lineup again, while keeping every
// Mercator pool fully exclusive (no overlap). Each item is tagged
// `gateExclusive: true` in items_permanent.json so the free-grant
// pool also skips them — they're Gate-only the way Mercator items
// are Mercator-only.
const GATE_COMMON = [
  'SHARPENED_BLADE','WATCHTOWER_LENS',
  'PRAETORIAN_COIN','BRONZE_GREAVES','RUSTED_HASTA'
];
const GATE_UNCOMMON: string[] = [
  'AUGUR_SCROLL','CONSULAR_TOKEN'
];
const GATE_RARE: string[] = [];
const GATE_EPIC = [
  'LICTOR_FASCES','AUXILIARY_SLING','OPTIO_WHISTLE',
  'SKYPIERCER_BOLTS','FALCONERS_WATCHPOST'
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
  // 2026-05-25 — TRUESIGHT_LENS moved out of the random MID pool. It
  // now ships as a GUARANTEED slot (see buildMercatorStock below) so
  // the player never has to gamble on whether the stealth-counter
  // appears between waves. Per user direction: "the item to see fliers
  // and reveal them to other towers should always be available at
  // Mercator." Stealthed flyers (Ghost Rider, Shadow Cavalry) are the
  // primary use case, and the player needs reliable access to the
  // counter — not a 3-in-13 random roll.
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
// 2026-05-18 — NEW EPIC TIER. Six items live here: 3 demoted legendary
// melee items (Berserker's Muzzle, Celtic Longsword, Necrotic Longsword)
// and 3 brand-new 60g picks (Lictor's Fasces, Auxiliary Sling, Optio's
// Whistle). Mercator-exclusive — gate never carries Epic items.
const MERCATOR_EPIC = [
  'BERSERKERS_MUZZLE','CELTIC_LONGSWORD','NECROTIC_LONGSWORD',
  'LICTOR_FASCES','AUXILIARY_SLING','OPTIO_WHISTLE',
  // 2026 v2 — anti-air EPIC options.
  'SKYPIERCER_BOLTS','FALCONERS_WATCHPOST'
];
// Premium Mercator stock — Legendary trophies that the Gate Shop never carries.
// These cost 3-5× a normal item but offer build-defining effects.
const MERCATOR_LEGENDARY = [
  // 2026 v2 — anti-air LEGENDARY options.
  'JUPITERS_SKYFIRE','STORM_AQUILA_TALONS',
  'ALPHA_PACK_FANG','WAR_HOUND_COLLAR','ELEPHANT_TUSK',
  'NUMIDIAN_SADDLE','FALCATA_BLADE','BARCA_WAR_HORN','GILDED_SCALE_ARMOR',
  'LICH_GENERALS_SEAL','HANNIBALS_STRATEGY_SCROLL',
  'DRUID_STAFF_FRAGMENT',
  // 2026-05 build-defining legendaries — anti-air enabler, spear-throw
  // melee, chain lightning. All rotated through the same per-run
  // uniqueness filter so the player never sees a duplicate.
  'AQUILA_TALONS','SPEAR_OF_MARS','JUPITERS_WRATH',
  // 2026-05-19 — DAMNATIO MEMORIAE execute item joins the Mercator
  // legendary pool so the player can buy it directly between waves
  // rather than relying on a random boss drop.
  'DAMNATIO_MEMORIAE',
  // 2026 v2 — legendary AoE items: full cleave (melee) + splash (ranged).
  'EXECUTIONERS_FALX', 'CONCUSSIVE_WARHEAD'
  // CELTIC_LONGSWORD + NECROTIC_LONGSWORD removed from this list — they
  // are now EPIC (see MERCATOR_EPIC).
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
  // Mercator-only: random T5 base tower offers.
  towerOffers?: MercatorTowerOffer[];
  // Mercator-only: Fortuna's Wheel — 925g RNG roll on a regular combo tower
  // (T2-T5, Supercombo/Omega/recipe-chain results excluded). Tracked
  // per-visit so the player can see how many times they've gambled this
  // round. No cap — pure RNG, by design.
  gambleSpinsThisVisit?: number;
  gambleWinsThisVisit?: string[];
}

// Mercator tower offerings (2026-05): Mercator now ONLY stocks T5 towers
// and every offer has a flat armory price. The player still gets variety in tower
// TYPE (the pool below picks 8 distinct types per visit) — they just
// always arrive at apex tier and at the same price tag.
// 2026-06-23 — JB set T5 Mercator armory towers to 250g. Champions are
// premium 1000g recruits because they feed the Mars Victor path.
const MERCATOR_TOWER_PRICE: Record<number, number> = {
  1: 250, 2: 250, 3: 250, 4: 250, 5: 250
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

// 2026 v2 Ch8 — the 6 Champions of Rome. Always stocked at Mercator (1000g
// each) so the player can recruit them across visits and combine all six
// into MARS VICTOR. They reuse the hero portraits in the shop + the hero
// board sprites once placed.
export const CHAMPION_TYPES = [
  'CHAMPION_MARIUS', 'CHAMPION_AGRIPPA', 'CHAMPION_AGRICOLA',
  'CHAMPION_SCIPIO', 'CHAMPION_CAESAR', 'CHAMPION_SULLA'
];
export const CHAMPION_PRICE = 1000;

export interface MercatorTowerOfferOptions {
  activeHeroId?: string | null;
  excludeTypes?: string[];
  purchasedChampionTypes?: string[];
}

export function mercatorExcludedChampionForHero(activeHeroId?: string | null): string | null {
  return championForHero(activeHeroId);
}

export function buildMercatorTowerOffers(wave: number, count = 5, options: MercatorTowerOfferOptions = {}): MercatorTowerOffer[] {
  const offers: MercatorTowerOffer[] = [];
  const excluded = new Set(options.excludeTypes ?? []);
  for (const championType of options.purchasedChampionTypes ?? []) {
    excluded.add(championType);
  }
  const activeHeroChampion = mercatorExcludedChampionForHero(options.activeHeroId);
  if (activeHeroChampion) excluded.add(activeHeroChampion);
  // The 6 Champions always head the lineup at a flat 1000g — the Mars Victor path.
  for (const ct of CHAMPION_TYPES) {
    // 2026-06-23 — Purchased Champions arrive as T2 recruits: stronger
    // than a fresh starter, but not full apex heroes.
    if (!excluded.has(ct)) offers.push({ type: ct, tier: 2, price: CHAMPION_PRICE });
  }
  const used = new Set<string>(CHAMPION_TYPES);
  let tries = 0;
  // 2026-05 v9: defensive filter — APEX cross-combos (Imperium Eternum,
  // Carthage Scourge, Triumvirate, Legion Prime, Consular Fatebinder)
  // are NEVER offered for sale. If a future contributor accidentally
  // adds one to MERCATOR_TOWER_POOL, this filter blocks it from
  // reaching the player. Apex towers must be crafted, not bought.
  const eligible = MERCATOR_TOWER_POOL.filter(id => !FORTUNA_APEX_BLOCKLIST.has(id));
  // Fill the rest with 10 random T5 base towers (champions already took 6 slots).
  // 2026-07-03 — options.excludeTypes now applies to these random slots too
  // (previously it only gated champions). main.ts passes the PREVIOUS visit's
  // random lineup here, so consecutive Mercator visits never repeat a tower
  // and the T5 armory is properly re-randomized each stop. Safety: if the
  // exclusions would starve the pool below the draw count, ignore them.
  const randomCount = 10;
  let pool = eligible.filter(id => !excluded.has(id));
  if (pool.length < randomCount) pool = eligible;
  const targetCount = offers.length + randomCount;
  while (offers.length < targetCount && tries++ < 200) {
    const type = pool[Math.floor(Math.random() * pool.length)];
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
// 2026 v2 — 30-wave campaign. Mercator now also visits in the late game so
// the Champions of Rome (1000g each, ~6000g for all six) are reachable before
// the W24 Anubis King and the W30 Daemon finale.
export const MERCATOR_WAVES = [4, 9, 14, 19, 23, 27];

// 2026-05-18 — Gate shop is now a thin starter shop: it sells the
// two gate-exclusive commons (SHARPENED_BLADE + WATCHTOWER_LENS) and
// nothing else. Every other item — uncommon, rare, epic, legendary —
// requires a Mercator visit. This honors the design rule "all items
// at Mercator are exclusive to Mercator." The 2-item offering is
// always the same so the gate shop is predictable filler between
// Mercator stops, not a meaningful loot rotation.
// `ownedLegendaries` kept for back-compat with the call sites but
// unused now that the legendary slot is removed.
// 2026-05-19 — Gate shop samples from gate-exclusive common/uncommon pools.
// 2026-07-01 — It also carries a small Epic shelf so the base shop has
// meaningful purple purchases between Mercator visits. ownedLegendaries kept
// for back-compat with the call sites but unused (gate doesn't carry legendaries).
export function buildGateShop(_refreshSeed = 0, _ownedLegendaries?: Set<string>): ShopState {
  const offers: ShopOffer[] = [];
  // Sample 4 commons. The pool only has 5, so the player sees 4-of-5
  // each visit — predictable enough that they know what's coming,
  // varied enough that they don't always see the same lineup.
  const commons = sampleN(entries(GATE_COMMON), Math.min(4, GATE_COMMON.length));
  for (const [id, def] of commons) {
    offers.push({ itemId: id, rarity: 'COMMON', price: itemBuyPrice(id), isConsumable: false });
  }
  // Sample 2 uncommons (the pool has 2, so always both for now).
  const uncommons = sampleN(entries(GATE_UNCOMMON), Math.min(2, GATE_UNCOMMON.length));
  for (const [id, def] of uncommons) {
    offers.push({ itemId: id, rarity: 'UNCOMMON', price: itemBuyPrice(id), isConsumable: false });
  }
  const epics = sampleNWeightedItems(entries(GATE_EPIC), Math.min(2, GATE_EPIC.length));
  for (const [id] of epics) {
    offers.push({ itemId: id, rarity: 'EPIC', price: itemBuyPrice(id), isConsumable: false });
  }
  // Final presentation shuffle: the stock contents are already sampled per
  // rarity, but the card order should also feel freshly rolled each refresh.
  shuffleInPlace(offers);
  // 2026-06-28 — every item costs 10% less to buy from the gate shop.
  for (const o of offers) o.price = Math.max(1, Math.round(o.price * 0.9));
  return { type: 'GATE', offers, livesPrice: 55, livesMaxThisVisit: 5, livesBoughtThisVisit: 0 };
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
    ? MERCATOR_LEGENDARY.filter(id => ITEMS[id]?.rarity === 'LEGENDARY' && !ownedLegendaries.has(id))
    : MERCATOR_LEGENDARY.filter(id => ITEMS[id]?.rarity === 'LEGENDARY');
  // 2026-05 v6: bumped 2 → 4 legendary slots so each Mercator visit
  // actually feels like a trophy haul. Still filtered against owned
  // legendaries so no duplicates land in the stock.
  const legs = sampleNWeightedItems(entries(filteredLegendaryIds), 4);
  for (const [id] of legs) {
    offers.push({ itemId: id, rarity: 'LEGENDARY', price: itemBuyPrice(id), isConsumable: false });
  }

  // 1 guaranteed Rare with a steep markup.
  const rares = sampleNWeightedItems(entries(MERCATOR_RARE), 1);
  if (rares.length > 0) {
    const [rId, rDef] = rares[0];
    offers.push({ itemId: rId, rarity: 'RARE', price: itemBuyPrice(rId) + 28, isConsumable: false });
  }

  // 2026-05 v6: 1 GUARANTEED Mercator-exclusive item (Scipio's Playbook,
  // Aquilifer's Banner, or Punic Ledger). These never appear in the gate
  // shop, so the player has a reason to actually visit the Mercator beyond
  // the legendary slots.
  const excl = sampleNWeightedItems(entries(MERCATOR_EXCLUSIVE_RARE), 1);
  if (excl.length > 0) {
    const [eId, eDef] = excl[0];
    offers.push({ itemId: eId, rarity: 'RARE', price: itemBuyPrice(eId), isConsumable: false });
  }

  // Consumables removed 2026-05 — Mercator now slots an extra mid-tier
  // permanent item where the one-use consumable used to sit, so stock
  // size remains stable.

  // 3 mid items (was 2 + 1 consumable), all marked up.
  const mids = sampleNWeightedItems(entries(MERCATOR_MID), 3);
  for (const [id, def] of mids) {
    if (!def) continue;
    offers.push({ itemId: id, rarity: asRarity(def.rarity), price: itemBuyPrice(id) + 18, isConsumable: false });
  }

  // 2026-05-18 — 2 GUARANTEED EPIC slots. Pulled from the new purple
  // tier (3 demoted melee legendaries + 3 new Epics). Price is the
  // flat 60g baseline from items_permanent.json, no markup — the
  // user set the Epic price specifically.
  const epics = sampleNWeightedItems(entries(MERCATOR_EPIC), 2);
  for (const [id, def] of epics) {
    if (!def) continue;
    offers.push({ itemId: id, rarity: 'EPIC' as Rarity, price: itemBuyPrice(id), isConsumable: false });
  }

  // 2026-05-25 — GUARANTEED TRUESIGHT_LENS slot. The stealth-reveal
  // counter must be reliably purchasable; per user direction it's
  // always available at Mercator instead of a random roll out of the
  // MID pool. Same markup convention as other MID items (+4g over
  // codex baseline). Defensive lookup so a missing item def doesn't
  // crash the build.
  const tsDef: any = (ITEMS as any)['TRUESIGHT_LENS'];
  if (tsDef) {
    offers.push({
      itemId: 'TRUESIGHT_LENS',
      rarity: asRarity(tsDef.rarity ?? 'UNCOMMON'),
      price: itemBuyPrice('TRUESIGHT_LENS') + 18,
      isConsumable: false
    });
  }

  // 2026-06-28 — every item costs 10% less to buy from the Mercator (premiums included).
  // Shuffle after the guaranteed Truesight slot is added so Mercator's item
  // shelf does not always read as the same tier-bucket layout.
  shuffleInPlace(offers);
  for (const o of offers) o.price = Math.max(1, Math.round(o.price * 0.9));
  return { type: 'MERCATOR', offers, livesPrice: 83, livesMaxThisVisit: 3, livesBoughtThisVisit: 0, towerOffers: [], gambleSpinsThisVisit: 0, gambleWinsThisVisit: [] };
}

// ─── Fortuna's Wheel — 925g RNG regular-combo gamble ───────────────────
// Pure-RNG mechanic added 2026-05 v9. The pool is every regular authored
// COMBO tower in towers.json across T2/T3/T4/T5. Supercombo, Omega, Champion,
// and recipe-chain combo-of-combo results are excluded so Fortuna stays a
// shortcut into combo play, not a way to buy out the super/omega crafting
// ladder. Every spin rolls a TIER first, then uniformly picks within tier.
// No pity, no per-visit cap. The player decides when to stop chasing.
//
// TIER ODDS (2026-05 v10, refined from the original uniform-pool roll):
//   T2 weight 4 → 40% per spin (every T2 individually ~10%)
//   T3 weight 3 → 30% per spin (every T3 individually ~10%)
//   T4 weight 2 → 20% per spin (every T4 individually ~5%)
//   T5 weight 1 → 10% per spin
// A linear 4/3/2/1 ramp: each step up the tier ladder cuts the per-spin
// hit chance by 10 percentage points. T5 "feels earned"; T2/T3 stay common
// so 925g still has a clear floor.
import towersJson from '../data/towers.json';
import towerCombinationsJson from '../data/towerCombinations.json';
// 2026-06-23 — 500 → 925 (~1.85x) to match the ~1.86x gold income from the
// doubled enemy counts.
export const FORTUNA_GAMBLE_COST = 925;
// 2026-05 v9: APEX super-combos are no longer rollable from Fortuna or
// offered in the Mercator tower lineup. The 6 LATE-game cross-combos
// (Imperium Eternum, Carthage Scourge, Triumvirate, Legion Prime,
// Consular Fatebinder) are win-condition towers — they MUST be earned
// through crafting, not bought. Buying-your-way-to-victory was hollowing
// out the recipe meta. The pool keeps every other combo (early + mid
// recipes) so gold still has a clear path to a strong placement.
export const FORTUNA_APEX_BLOCKLIST = new Set([
  'IMPERIUM_ETERNUM',
  'CARTHAGE_SCOURGE',
  'TRIUMVIRATE',
  'LEGION_PRIME',
  'CONSULAR_FATEBINDER',
  'SKY_DOMINION',
  'AUREATE_TRIBUNAL',
  'GLACIAL_PALISADE',
  'INFERNAL_COLOSSUS',
  'ROMAN_TRANSFORMER',
  'MARS_VICTOR',   // 2026 v2 Ch9 — DIVINE apex; recipe-only, never gambled/bought
  // 2026 v2 Ch8 — Champions are a deliberate 1000g Mercator buy, never gambled.
  'CHAMPION_MARIUS', 'CHAMPION_AGRIPPA', 'CHAMPION_AGRICOLA',
  'CHAMPION_SCIPIO', 'CHAMPION_CAESAR', 'CHAMPION_SULLA'
]);

const FORTUNA_SUPER_MARKERS = ['SUPER COMBO', 'SUPERCOMBO', 'OMEGA', 'COMBO-OF-COMBO'];
const COMBO_KIND_IDS = new Set(
  Object.entries(towersJson as any)
    .filter(([, def]: any) => def?.kind === 'COMBO')
    .map(([id]) => id)
);
const COMBO_RECIPE_BY_RESULT = new Map<string, any>(
  (towerCombinationsJson as any[]).map(recipe => [String(recipe.result), recipe])
);

function recipeConsumesComboTower(resultId: string): boolean {
  const recipe = COMBO_RECIPE_BY_RESULT.get(resultId);
  return (recipe?.ingredients ?? []).some((ing: any) => COMBO_KIND_IDS.has(String(ing.type)));
}

export function isFortunaRegularCombo(id: string, def: any = (towersJson as any)[id]): boolean {
  if (!def || def.kind !== 'COMBO') return false;
  if (id.startsWith('CHAMPION_')) return false;
  if (def.omega === true) return false;
  if (FORTUNA_APEX_BLOCKLIST.has(id)) return false;
  if (recipeConsumesComboTower(id)) return false;

  const ability = String(def.ability ?? '').toUpperCase();
  return !FORTUNA_SUPER_MARKERS.some(marker => ability.includes(marker));
}

export const FORTUNA_GAMBLE_POOL: string[] = Object.entries(towersJson as any)
  .filter(([id, def]: any) => isFortunaRegularCombo(id, def))
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
  shuffleInPlace(a);
  return a.slice(0, Math.min(n, a.length));
}

function sampleNWeightedItems<T>(arr: [string, T][], n: number): [string, T][] {
  const pool = arr.slice();
  const out: [string, T][] = [];
  const target = Math.min(n, pool.length);
  while (out.length < target && pool.length > 0) {
    let total = 0;
    for (const [id] of pool) total += Math.max(0, itemRandomSelectionWeight(id));
    if (total <= 0) {
      shuffleInPlace(pool);
      out.push(...pool.splice(0, target - out.length));
      break;
    }
    let r = Math.random() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= Math.max(0, itemRandomSelectionWeight(pool[i][0]));
      if (r < 0) { idx = i; break; }
    }
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

function shuffleInPlace<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function isMercatorWave(wave: number): boolean { return MERCATOR_WAVES.includes(wave); }
// 20-WAVE CAMPAIGN: gate shop refreshes every 4 waves (5 refreshes per run).
export function gateShopRefreshDue(wave: number): boolean { return wave > 0 && wave % 4 === 0; }
