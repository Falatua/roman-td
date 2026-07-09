import { GameStateShape } from '../GameState';
import { Enemy, ItemId, LootOrb } from '../types';
import { GRID, INVENTORY_SIZE, LOOT_DROP_RATES } from '../constants';
import items from '../data/items_permanent.json';
import consumables from '../data/items_consumable.json';
import { itemRandomSelectionWeight } from './ItemRules';

// 2026-05-18 — EPIC tier inserted between RARE and LEGENDARY. Visual
// color is purple (#a060ff). Standard buy price is 60g — sits cleanly
// between RARE's ~38-42g and LEGENDARY's 120-150g. Used for the demoted
// melee-stat legendaries (Berserker's Muzzle, Celtic Longsword,
// Necrotic Longsword) and for new "premium-but-not-build-defining"
// items that fill the gap between Rare and Legendary.
export type Rarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | 'UNIQUE';

// 2026-06-23 — item prices ~1.85x to match the ~1.86x gold income from the
// doubled enemy counts (1g/kill). Sell refunds (floor(buyPrice/2)) scale with
// these automatically, as do Mercator trophy + item offers and loot-orb values.
export const RARITY_BUY_PRICE: Record<Rarity, number> = {
  COMMON: 37,
  UNCOMMON: 83,
  RARE: 185,
  EPIC: 390,
  LEGENDARY: 740,
  UNIQUE: 925
};

export function itemBuyPrice(itemId: string): number {
  const rarity = (items as any)[itemId]?.rarity as Rarity | undefined;
  return rarity ? RARITY_BUY_PRICE[rarity] : 0;
}

let nextId = 1;
function newId(): string { return `lo${nextId++}`; }

// Module-local monotonic counter for inventory slot IDs. Replaces the
// Date.now()+random-suffix approach which could collide on fast successive
// adds within the same millisecond. Guaranteed unique per session.
let nextInvSlotId = 1;
function newInvSlotId(): string { return `inv${nextInvSlotId++}`; }

export interface InventorySlot {
  id: string;
  itemId: ItemId;
  rarity: Rarity;
  isConsumable: boolean;
  // Gold paid for this item, when known. Sell refund = floor(buyPrice / 2).
  // Loot drops have no buyPrice; those fall back to a rarity-based default.
  buyPrice?: number;
}

export interface InventoryState {
  slots: InventorySlot[];   // length <= 10
}

export function createInventory(): InventoryState { return { slots: [] }; }

export function inventoryAdd(inv: InventoryState, itemId: ItemId, rarity: Rarity, isConsumable = false, buyPrice?: number): boolean {
  if (inv.slots.length >= INVENTORY_SIZE) return false;
  inv.slots.push({ id: newInvSlotId(), itemId, rarity, isConsumable, buyPrice });
  return true;
}

export function inventoryRemove(inv: InventoryState, slotId: string): InventorySlot | null {
  const idx = inv.slots.findIndex(s => s.id === slotId);
  if (idx < 0) return null;
  return inv.slots.splice(idx, 1)[0] ?? null;
}

function permanentItemPoolByRarity(rarity: Rarity): ItemId[] {
  return Object.keys(items).filter(id => {
    const def: any = (items as any)[id];
    return def?.rarity === rarity && !def?.eventExclusive;
  }) as ItemId[];
}

// 2026-06-30 — ordinary item RNG is data-driven by rarity. This keeps the
// existing rarity odds intact while ensuring every non-event-exclusive item
// in a tier can actually appear in that tier's random pool. Event-exclusive
// legendaries stay reserved for surprise-event reward choices.
export const ORDINARY_DROP_ITEMS_BY_RARITY: Readonly<Record<'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC', readonly ItemId[]>> = {
  COMMON: permanentItemPoolByRarity('COMMON'),
  UNCOMMON: permanentItemPoolByRarity('UNCOMMON'),
  RARE: permanentItemPoolByRarity('RARE'),
  EPIC: permanentItemPoolByRarity('EPIC')
};

export const LEGENDARY_DROP_ITEM_POOL: readonly ItemId[] = permanentItemPoolByRarity('LEGENDARY');

const COMMON_ITEMS: readonly ItemId[] = ORDINARY_DROP_ITEMS_BY_RARITY.COMMON;
const UNCOMMON_ITEMS: readonly ItemId[] = ORDINARY_DROP_ITEMS_BY_RARITY.UNCOMMON;
const RARE_ITEMS: readonly ItemId[] = ORDINARY_DROP_ITEMS_BY_RARITY.RARE;
const ORDINARY_EPIC_ITEMS: readonly ItemId[] = ORDINARY_DROP_ITEMS_BY_RARITY.EPIC;
const EPIC_ITEM_POOL: readonly ItemId[] = ORDINARY_DROP_ITEMS_BY_RARITY.EPIC;
const OCEAN_SPECIALIST_RARE_ITEMS: readonly ItemId[] = ['BRINEHOOK_ROPE', 'TIDEPIERCER_HARPOON']
  .filter(id => (items as any)[id]?.rarity === 'RARE') as ItemId[];
const OCEAN_SPECIALIST_EPIC_ITEMS: readonly ItemId[] = ['AEGEAN_PEARL', 'STORMGLASS_AMPHORA']
  .filter(id => (items as any)[id]?.rarity === 'EPIC') as ItemId[];

export const EVENT_EXCLUSIVE_ITEMS_BY_EVENT: Readonly<Record<string, readonly ItemId[]>> = Object.freeze(
  Object.keys(items).reduce((acc, id) => {
    const def: any = (items as any)[id];
    if (!def?.eventExclusive) return acc;
    const key = String(def.eventExclusive);
    if (!acc[key]) acc[key] = [];
    acc[key].push(id as ItemId);
    return acc;
  }, {} as Record<string, ItemId[]>)
);

const ALL_EVENT_EXCLUSIVE_ITEMS: readonly ItemId[] = Object.values(EVENT_EXCLUSIVE_ITEMS_BY_EVENT).flat();

export function itemLootPoolCoverage() {
  return {
    ordinary: ORDINARY_DROP_ITEMS_BY_RARITY,
    legendary: LEGENDARY_DROP_ITEM_POOL,
    eventExclusive: EVENT_EXCLUSIVE_ITEMS_BY_EVENT,
    allEventExclusive: ALL_EVENT_EXCLUSIVE_ITEMS
  };
}

const GLOBAL_NON_EVENT_LEGENDARY_ITEMS: readonly ItemId[] = LEGENDARY_DROP_ITEM_POOL;

function rollFromPool(rarity: Rarity, pool: readonly ItemId[]): { itemId: ItemId; rarity: Rarity } | null {
  if (pool.length === 0) return null;
  return { itemId: pickWeightedItem(pool), rarity };
}

function fallbackDrop(): { itemId: ItemId; rarity: Rarity } | null {
  return rollFromPool('COMMON', COMMON_ITEMS)
    ?? rollFromPool('UNCOMMON', UNCOMMON_ITEMS)
    ?? rollFromPool('RARE', RARE_ITEMS)
    ?? rollFromPool('EPIC', ORDINARY_EPIC_ITEMS)
    ?? null;
}

export function rollDrop(): { itemId: ItemId; rarity: Rarity } | null {
  // Ordinary kill drops are intentionally rare; the reliable loot moments
  // are commanders, bosses, and special-event enemies. When a normal enemy
  // does hit the small drop chance, keep the payload mostly Common/Uncommon
  // with only a tiny Epic tail.
  // 2026-07-03 — per-kill rate rose 0.15%→0.20% (constants.ts), so the
  // EPIC tail shrinks 1%→0.75% here to hold epic's absolute drop rate
  // constant; the extra frequency all flows to Common/Uncommon/Rare.
  const r = Math.random();
  if (r < 0.68) return rollFromPool('COMMON', COMMON_ITEMS) ?? fallbackDrop();
  if (r < 0.94) return rollFromPool('UNCOMMON', UNCOMMON_ITEMS) ?? fallbackDrop();
  if (r < 0.9925 || ORDINARY_EPIC_ITEMS.length === 0) return rollFromPool('RARE', RARE_ITEMS) ?? fallbackDrop();
  return rollFromPool('EPIC', ORDINARY_EPIC_ITEMS) ?? fallbackDrop();
}

// Guaranteed RARE-tier drop (used by the Fire Giant kill hook).
export function rollRareDrop(): { itemId: ItemId; rarity: Rarity } | null {
  return rollFromPool('RARE', RARE_ITEMS);
}

export function premiumDropRoll(chance: number, randomValue = Math.random()): boolean {
  return randomValue < Math.max(0, Math.min(1, chance));
}

export function oceanSpecialistDropChance(enemy: Partial<Enemy> | any): number {
  switch (String(enemy?.type ?? '')) {
    case 'OCEAN_GHOST_SPIRIT':
      return 0;
    case 'SEA_GIANT':
      return 0.18;
    case 'SEA_GIANT_WARBRINGER':
    case 'NETHER_AMPHIBIOUS_GIANT':
      return 0.38;
    case 'TIDECALLER_COMMANDER':
    case 'STORMTIDE_WYVERN_COMMANDER':
      return 0.45;
    default:
      return 0;
  }
}

export function rollOceanSpecialistDrop(enemy: Partial<Enemy> | any): { itemId: ItemId; rarity: Rarity } | null {
  const type = String(enemy?.type ?? '');
  const epicChance =
    type === 'SEA_GIANT_WARBRINGER' || type === 'NETHER_AMPHIBIOUS_GIANT' || type === 'TIDECALLER_COMMANDER' || type === 'STORMTIDE_WYVERN_COMMANDER'
      ? 0.35
      : 0.10;
  if (premiumDropRoll(epicChance)) {
    return rollFromPool('EPIC', OCEAN_SPECIALIST_EPIC_ITEMS) ?? rollFromPool('RARE', OCEAN_SPECIALIST_RARE_ITEMS);
  }
  return rollFromPool('RARE', OCEAN_SPECIALIST_RARE_ITEMS) ?? rollFromPool('EPIC', OCEAN_SPECIALIST_EPIC_ITEMS);
}

function pick<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

function pickWeightedItem(pool: readonly ItemId[]): ItemId {
  let total = 0;
  for (const id of pool) total += Math.max(0, itemRandomSelectionWeight(id));
  if (total <= 0) return pick(pool);
  let r = Math.random() * total;
  for (const id of pool) {
    r -= Math.max(0, itemRandomSelectionWeight(id));
    if (r < 0) return id;
  }
  return pool[pool.length - 1];
}

// Boss-specific signature legendaries. Each boss tries to drop its exact
// trophy first, then falls back to the broader faction table only if the
// signature is already claimed by inventory/equipment/a pending loot orb.
export const BOSS_SIGNATURE_LEGENDARIES: Readonly<Record<string, ItemId>> = Object.freeze({
  ALPHA_DOG: 'ALPHA_PACK_FANG',
  CELTIC_WARLORD: 'WARLORDS_WAR_PAINT',
  WAR_ELEPHANT: 'ELEPHANT_TUSK',
  HANNIBAL_BARCA: 'HANNIBALS_STRATEGY_SCROLL',
  UNDEAD_WARLORD: 'CURSED_TORC',
  UNDEAD_WAR_ELEPHANT: 'UNDEAD_ELEPHANT_BONE',
  BOSS_FLYER_VULTURE: 'STORM_AQUILA_TALONS',
  KHAN_RIDER: 'SPEAR_OF_MARS',
  ANUBIS_KING: 'LICH_GENERALS_SEAL',
  DAEMON_IMPERATOR: 'SIGIL_OF_SOL_INVICTUS'
});

export function signatureLegendaryForBoss(enemyType: string | null | undefined): ItemId | null {
  if (!enemyType) return null;
  const id = BOSS_SIGNATURE_LEGENDARIES[enemyType];
  return id && (items as any)[id]?.rarity === 'LEGENDARY' ? id : null;
}

// Faction-specific fallback tables. Updated 2026-07: exact boss trophies
// live above, while these pools preserve the legendary no-duplicate rule
// when a repeated boss type dies after its signature is already claimed.
const BOSS_LEGENDARIES: Record<string, ItemId[]> = {
  // Dogs: brutal melee themes. Spear of Mars fits the savage-charge
  // identity (Alpha Dog's pack chasing flyers fits AQUILA TALONS too).
  DOGS: ['ALPHA_PACK_FANG', 'WAR_HOUND_COLLAR', 'BERSERKERS_MUZZLE', 'AQUILA_TALONS', 'SPEAR_OF_MARS'],
  // Celts: druid/warlord theme. SPEAR_OF_MARS fits the Celtic Berserker
  // spear-charge identity perfectly.
  CELTS: ['DRUIDS_TORC', 'CELTIC_LONGSWORD', 'WARLORDS_WAR_PAINT', 'GALLIC_SHIELD_BOSS', 'DRUID_STAFF_FRAGMENT', 'SPEAR_OF_MARS', 'JUPITERS_WRATH'],
  // Carthage: cavalry / elephants / flyers (Numidian Riders). AQUILA
  // TALONS lets your melee answer those Numidian flyers.
  CARTHAGE: ['ELEPHANT_TUSK', 'HANNIBALS_STRATEGY_SCROLL', 'NUMIDIAN_SADDLE', 'FALCATA_BLADE', 'BARCA_WAR_HORN', 'GILDED_SCALE_ARMOR', 'AQUILA_TALONS'],
  // Undead Celts: necrotic + spectral. JUPITER'S WRATH (chain lightning)
  // is the Roman gods striking down the unliving — Undead Warlord drops it.
  UNDEAD_CELTS: ['CURSED_TORC', 'NECROTIC_LONGSWORD', 'UNDEAD_ELEPHANT_BONE', 'LICH_GENERALS_SEAL', 'JUPITERS_WRATH', 'AQUILA_TALONS'],
  // Undead Carthage: spectral cavalry + iron phalanx. All three new
  // legendaries thematically fit (sky-claw for ghosts, spear for phalanx,
  // chain lightning for divine purification).
  UNDEAD_CARTHAGE: ['UNDEAD_ELEPHANT_BONE', 'LICH_GENERALS_SEAL', 'CURSED_TORC', 'AQUILA_TALONS', 'SPEAR_OF_MARS', 'JUPITERS_WRATH'],
  // SUPER_DEMONS: the Daemon Imperator's intended boss legendary is now
  // awarded as a W29 clear prelude reward, so the player can use it in
  // the final fight instead of receiving a useless post-victory corpse
  // drop. This pool still supplies the no-duplicate fallback for that
  // prelude reward.
  SUPER_DEMONS: ['UNDEAD_ELEPHANT_BONE', 'LICH_GENERALS_SEAL', 'CURSED_TORC', 'WARLORDS_WAR_PAINT', 'ELEPHANT_TUSK', 'JUPITERS_WRATH', 'AQUILA_TALONS', 'SPEAR_OF_MARS', 'SIGIL_OF_SOL_INVICTUS'],
  EGYPTIANS: ['STORM_AQUILA_TALONS', 'JUPITERS_SKYFIRE', 'LICH_GENERALS_SEAL', 'JUPITERS_WRATH', 'CURSED_TORC'],
  MONGOLS: ['SPEAR_OF_MARS', 'NUMIDIAN_SADDLE', 'EXECUTIONERS_FALX', 'DAMNATIO_MEMORIAE', 'FALCATA_BLADE']
};

// Fallback table for any faction that somehow isn't in the map above.
// Data-driven so every non-event-exclusive legendary, including future
// additions, can appear in boss-drop randomization.
const FALLBACK_LEGENDARIES: readonly ItemId[] = GLOBAL_NON_EVENT_LEGENDARY_ITEMS;

// LEGENDARY UNIQUENESS (2026-05): the player can only HOLD one of each
// legendary at a time. We walk the live inventory, pending loot orbs, and
// every tower's equippedItems and build a Set of legendary IDs that are
// currently claimed. The drop site and Mercator pool then filter this set
// out before picking. Selling a legendary frees it up again — this is
// "no duplicates," not "one per run."
export function currentlyOwnedLegendarySet(
  state: GameStateShape | null | undefined,
  inv: InventoryState | null | undefined
): Set<string> {
  const owned = new Set<string>();
  if (inv) {
    for (const s of inv.slots) {
      if (s.rarity === 'LEGENDARY') owned.add(s.itemId);
    }
  }
  if (state) {
    for (const o of state.lootOrbs ?? []) {
      const def: any = (items as any)[o.itemId];
      if (def?.rarity === 'LEGENDARY') owned.add(o.itemId);
    }
  }
  if (state) {
    for (const t of state.towers.values()) {
      for (const eq of (t.equippedItems ?? [])) {
        const def: any = (items as any)[eq];
        if (def?.rarity === 'LEGENDARY') owned.add(eq);
      }
    }
  }
  return owned;
}

// Premium payload pool for chance-based non-boss elite kills. Pool is every
// item in items_permanent.json whose rarity is EPIC and which isn't
// event-exclusive. EPIC items don't carry the legendary one-per-run
// uniqueness gate, so duplicates are allowed across different towers or
// inventory slots. Computed once at module load.
/**
 * Pick a random EPIC item for a premium kill that already won its chance
 * roll. Returns null only if the player somehow has zero EPIC items to draw
 * from. The caller owns the chance roll.
 */
export function rollEpicDrop(_state?: GameStateShape | null, _inv?: InventoryState | null): { itemId: ItemId; rarity: Rarity } | null {
  return rollFromPool('EPIC', EPIC_ITEM_POOL);
}

export const PREMIUM_NON_BOSS_DROP_CHANCES = Object.freeze({
  COMMANDER: 0.35,
  BOSS_ESCORT_COMMANDER: 0.22,
  FIRE_GIANT: 0.28,
  ELITE: 0.22,
  ELITE_MUTATION: 0.08
});

export function premiumNonBossDropChance(enemy: Partial<Enemy> | any): number {
  if (!enemy) return 0;
  if (enemy.__bossEscortCommander) return PREMIUM_NON_BOSS_DROP_CHANCES.BOSS_ESCORT_COMMANDER;
  if (enemy.isCommander) return PREMIUM_NON_BOSS_DROP_CHANCES.COMMANDER;
  if (enemy.type === 'FIRE_GIANT') return PREMIUM_NON_BOSS_DROP_CHANCES.FIRE_GIANT;
  if (enemy.isElite) return PREMIUM_NON_BOSS_DROP_CHANCES.ELITE;
  if (enemy.mutation) return PREMIUM_NON_BOSS_DROP_CHANCES.ELITE_MUTATION;
  return 0;
}

export function rollPremiumNonBossDrop(
  enemy: Partial<Enemy> | any,
  state?: GameStateShape | null,
  inv?: InventoryState | null
): { itemId: ItemId; rarity: Rarity } | null {
  const chance = premiumNonBossDropChance(enemy);
  if (chance <= 0) return null;

  if (enemy?.__bossEscortCommander) return rollRareDrop();
  if (enemy?.isCommander) {
    return premiumDropRoll(0.30) ? rollEpicDrop(state, inv) : rollRareDrop();
  }
  if (enemy?.type === 'FIRE_GIANT') {
    return premiumDropRoll(0.35) ? rollEpicDrop(state, inv) : rollRareDrop();
  }
  if (enemy?.isElite) {
    return premiumDropRoll(0.30) ? rollEpicDrop(state, inv) : rollRareDrop();
  }
  if (enemy?.mutation) {
    return premiumDropRoll(0.15) ? rollEpicDrop(state, inv) : rollRareDrop();
  }
  return null;
}

export function rollBossDrop(
  faction: string,
  state?: GameStateShape | null,
  inv?: InventoryState | null,
  bossType?: string | null
): { itemId: ItemId; rarity: Rarity } | null {
  const owned = currentlyOwnedLegendarySet(state, inv);
  const signature = signatureLegendaryForBoss(bossType);
  if (signature && !owned.has(signature)) {
    return { itemId: signature, rarity: 'LEGENDARY' };
  }
  const table = BOSS_LEGENDARIES[faction];
  const basePool = Array.from(new Set([
    ...(signature ? [signature] : []),
    ...((table && table.length > 0) ? table : FALLBACK_LEGENDARIES)
  ])) as ItemId[];
  const legendaryPool = basePool.filter(id => (items as any)[id]?.rarity === 'LEGENDARY');
  // Filter out already-owned legendaries so the player can't stack duplicates.
  let pool = legendaryPool.filter(id => !owned.has(id));
  // If the boss-specific table is exhausted, widen to the full legendary set
  // before giving up — most runs won't get past the boss-table here, but the
  // late-game player who has the whole CARTHAGE table already shouldn't get
  // a dead boss-kill bonus.
  if (pool.length === 0) {
    // 2026-05-18 — Boss drops also skip event-exclusive legendaries.
    // Those are reserved for surprise-event reward modals only.
    pool = GLOBAL_NON_EVENT_LEGENDARY_ITEMS.filter(id => !owned.has(id));
  }
  if (pool.length === 0) return null; // player owns every legendary in the game — rare flex
  return { itemId: pick(pool), rarity: 'LEGENDARY' };
}

export function rollFinalBossPreludeDrop(
  state?: GameStateShape | null,
  inv?: InventoryState | null
): { itemId: ItemId; rarity: Rarity } | null {
  return rollBossDrop('SUPER_DEMONS', state, inv, 'DAEMON_IMPERATOR');
}

export function spawnLootAt(state: GameStateShape, e: Enemy, drop: { itemId: ItemId; rarity: Rarity }) {
  const orb: LootOrb = {
    id: newId(),
    x: e.x, y: e.y,
    itemId: drop.itemId,
    rarity: drop.rarity
  };
  state.lootOrbs.push(orb);
}

export function maybeRollLootOnKill(state: GameStateShape, e: Enemy) {
  const rate = e.isFlyer ? LOOT_DROP_RATES.FLYER : LOOT_DROP_RATES.GROUND;
  if (Math.random() >= rate) return;
  const drop = rollDrop();
  if (drop) spawnLootAt(state, e, drop);
}

export function isPermanent(itemId: ItemId): boolean {
  return Object.prototype.hasOwnProperty.call(items, itemId);
}

export function isConsumable(itemId: ItemId): boolean {
  return Object.prototype.hasOwnProperty.call(consumables, itemId);
}

// Auto-pickup: any orb whose tile center is within 1.2 tile of the gate area is grabbed
// during the build phase (player isn't controlling Architectus yet — we simplify).
export function autoPickupOnBuildPhase(state: GameStateShape, inv: InventoryState): number {
  if (state.lootOrbs.length === 0) return 0;
  let picked = 0;
  for (let i = state.lootOrbs.length - 1; i >= 0; i--) {
    const o = state.lootOrbs[i];
    if (inv.slots.length >= INVENTORY_SIZE) {
      state.hint = 'INVENTORY FULL — sell or equip an item.';
      break;
    }
    const ok = inventoryAdd(inv, o.itemId, o.rarity, isConsumable(o.itemId));
    if (ok) { state.lootOrbs.splice(i, 1); picked++; }
  }
  return picked;
}
