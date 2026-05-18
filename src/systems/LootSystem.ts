import { GameStateShape } from '../GameState';
import { Enemy, ItemId, LootOrb } from '../types';
import { GRID, INVENTORY_SIZE, LOOT_DROP_RATES } from '../constants';
import items from '../data/items_permanent.json';
import consumables from '../data/items_consumable.json';

// 2026-05-18 — EPIC tier inserted between RARE and LEGENDARY. Visual
// color is purple (#a060ff). Standard buy price is 60g — sits cleanly
// between RARE's ~38-42g and LEGENDARY's 120-150g. Used for the demoted
// melee-stat legendaries (Berserker's Muzzle, Celtic Longsword,
// Necrotic Longsword) and for new "premium-but-not-build-defining"
// items that fill the gap between Rare and Legendary.
export type Rarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | 'UNIQUE';

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

// 2026-05 v6: DOT items (BARBED_GLADIUS, FIRE_OIL_FLASK, POISONED_BLADE)
// removed from random kill-drop pools. DOTs are now Mercator-only stock,
// making damage-over-time builds a deliberate strategic purchase rather
// than a passive drop. FALCATA_BLADE / ALPHA_PACK_FANG remain in boss
// legendary tables (already rare via the v6 35% boss-drop probability).
const COMMON_ITEMS: ItemId[] = ['SHARPENED_BLADE','TRAINING_SCROLL','WATCHTOWER_LENS'];
const UNCOMMON_ITEMS: ItemId[] = ['FLYER_BANE','CAVALRY_SPUR','IRON_TIP'];
const RARE_ITEMS: ItemId[] = ['CENTURIONS_TRUMPET','GOLD_PURSE','BATTLE_STANDARD','HOURGLASS_OF_SATURN','STORM_JAVELIN'];

export function rollDrop(): { itemId: ItemId; rarity: Rarity } | null {
  // Mostly Common/Uncommon for ground/flyer drops.
  const r = Math.random();
  if (r < 0.6) return { itemId: pick(COMMON_ITEMS), rarity: 'COMMON' };
  if (r < 0.9) return { itemId: pick(UNCOMMON_ITEMS), rarity: 'UNCOMMON' };
  return { itemId: pick(RARE_ITEMS), rarity: 'RARE' };
}

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

// Faction-specific boss legendary tables. Updated 2026-05: every faction
// (including SUPER_DEMONS) has a real legendary drop table now, and the
// drop site in main.ts no longer gates by wave type / first-kill — every
// boss enemy that falls drops a guaranteed legendary.
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
  // SUPER_DEMONS: the Daemon Imperator can drop any apex legendary —
  // including the three divine-themed additions. Final-boss kills are
  // the only path to these without raiding Mercator. 2026-05-15 added
  // SIGIL_OF_SOL_INVICTUS to the SUPER_DEMONS pool too — thematic
  // (sun-god relic dropped by the demon vanguard) and gives the player
  // a way to seed the anti-demon item via W19 boss kill, in addition
  // to the W3 Alpha-Dog opener.
  SUPER_DEMONS: ['UNDEAD_ELEPHANT_BONE', 'LICH_GENERALS_SEAL', 'CURSED_TORC', 'WARLORDS_WAR_PAINT', 'ELEPHANT_TUSK', 'JUPITERS_WRATH', 'AQUILA_TALONS', 'SPEAR_OF_MARS', 'SIGIL_OF_SOL_INVICTUS']
};

// Fallback table for any faction that somehow isn't in the map above —
// the legendary set is wide enough that no boss kill should ever silently
// fail to drop. Includes the three 2026-05 additions so an out-of-table
// boss can still seed the new items.
const FALLBACK_LEGENDARIES: ItemId[] = [
  'DRUIDS_TORC','CELTIC_LONGSWORD','ELEPHANT_TUSK','HANNIBALS_STRATEGY_SCROLL',
  'NUMIDIAN_SADDLE','FALCATA_BLADE','BARCA_WAR_HORN','GILDED_SCALE_ARMOR',
  'CURSED_TORC','LICH_GENERALS_SEAL',
  'AQUILA_TALONS','SPEAR_OF_MARS','JUPITERS_WRATH',
  // 2026-05-15: anti-demon sigil falls back here too so out-of-table
  // bosses can still seed it.
  'SIGIL_OF_SOL_INVICTUS'
];

// LEGENDARY UNIQUENESS (2026-05): the player can only HOLD one of each
// legendary at a time. We walk the live inventory + every tower's
// equippedItems and build a Set of legendary IDs that are currently
// claimed. The drop site and Mercator pool then filter this set out
// before picking. Selling a legendary frees it up again — this is "no
// duplicates," not "one per run."
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
    for (const t of state.towers.values()) {
      for (const eq of (t.equippedItems ?? [])) {
        const def: any = (items as any)[eq];
        if (def?.rarity === 'LEGENDARY') owned.add(eq);
      }
    }
  }
  return owned;
}

export function rollBossDrop(
  faction: string,
  state?: GameStateShape | null,
  inv?: InventoryState | null
): { itemId: ItemId; rarity: Rarity } | null {
  const table = BOSS_LEGENDARIES[faction];
  const basePool = (table && table.length > 0) ? table : FALLBACK_LEGENDARIES;
  // Filter out already-owned legendaries so the player can't stack duplicates.
  const owned = currentlyOwnedLegendarySet(state, inv);
  let pool = basePool.filter(id => !owned.has(id));
  // If the boss-specific table is exhausted, widen to the full legendary set
  // before giving up — most runs won't get past the boss-table here, but the
  // late-game player who has the whole CARTHAGE table already shouldn't get
  // a dead boss-kill bonus.
  if (pool.length === 0) {
    // 2026-05-18 — Boss drops also skip event-exclusive legendaries.
    // Those are reserved for surprise-event reward modals only.
    const allLegendaries = Object.keys(items).filter(id => {
      const def: any = (items as any)[id];
      return def?.rarity === 'LEGENDARY' && !def?.eventExclusive;
    });
    pool = allLegendaries.filter(id => !owned.has(id));
  }
  if (pool.length === 0) return null; // player owns every legendary in the game — rare flex
  return { itemId: pick(pool), rarity: 'LEGENDARY' };
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
