import { ItemId, DamageType } from '../types';
import towersData from '../data/towers.json';

// 2026-07: SPECIAL is now a real equip family, not a free-stacking bucket.
// This prevents one tower from becoming the entire run by stacking multiple
// trophies/procs. DoT items currently live in SPECIAL too, so they follow the
// same one-special-item limit.
export type ItemFamily =
  | 'DAMAGE'
  | 'SPEED'
  | 'RANGE'
  | 'DOT_BURN'
  | 'DOT_POISON'
  | 'DOT_BLEED'
  | 'AURA'
  | 'ECONOMY'
  | 'DEFENSE'
  | 'SPECIAL';
// EquipMode (2026-05 v6): all class-restricted items resolve to either
// MELEE or RANGED — the prior PHYSICAL + CAVALRY niche gates were too
// narrow to read. Items themed around blades / spurs / iron tips are
// MELEE; items themed around saddles / projectile-tips are RANGED.
export type EquipMode = 'MELEE' | 'RANGED' | 'ANY';

// EQUIP MODE GATE (2026-05): items whose effect text reads "Melee tower"
// or "Ranged tower" are mechanically restricted to that attack class.
// A melee gladius can't be screwed onto a Sagittarius archer; a Storm
// Javelin can't be glued to a hastatus's wrist. Anything not listed is
// ANY and equips freely (e.g. general damage / speed / aura items).
const EQUIP_MODE: Record<string, EquipMode> = {
  // MELEE-only — gladius / sword / spur / charge themed items
  BARBED_GLADIUS: 'MELEE',
  BERSERKERS_MUZZLE: 'MELEE',
  AQUILA_TALONS: 'MELEE',
  SPEAR_OF_MARS: 'MELEE',
  POISONED_BLADE: 'MELEE',
  IRON_TIP: 'MELEE',                // iron-tipped pilum / gladius
  CELTIC_LONGSWORD: 'MELEE',
  NECROTIC_LONGSWORD: 'MELEE',
  CAVALRY_SPUR: 'MELEE',            // mounted charge — melee identity
  // 2026-05 v7: ALL bleed sources are now MELEE-only. Bleed is the
  // visceral cut-flesh mechanic — a thrown javelin or a magic staff
  // applying bleed never made sense. These were the last two bleed
  // items left ungated.
  FALCATA_BLADE: 'MELEE',
  ALPHA_PACK_FANG: 'MELEE',
  // 2026-05-19 — DAMNATIO MEMORIAE execute is MELEE only. The visceral
  // "the gladius drops them" reading; a ranged tower picking off
  // sub-25% enemies from across the map is too sweeping. Restricting
  // to melee makes the player invest in a frontline killer to use it.
  DAMNATIO_MEMORIAE: 'MELEE',
  // RANGED-only — projectile / saddle / shot themed items
  STORM_JAVELIN: 'RANGED',
  QUICKDRAW_GLOVES: 'RANGED',
  FLYER_BANE: 'RANGED',
  FIRE_OIL_FLASK: 'RANGED',
  NUMIDIAN_SADDLE: 'RANGED',         // Numidian skirmisher — ranged identity
  VENOM_TIPPED_ARROWS: 'RANGED',     // 2026-05 v9: ranged-poison Mercator stock
  AUXILIARY_SLING: 'RANGED',         // 2026-05-18: Epic ranged sling
  CONCUSSIVE_WARHEAD: 'RANGED',      // 2026 v2: legendary ranged splash
  EXECUTIONERS_FALX: 'MELEE',        // 2026 v2: legendary melee cleave
  // 2026-07-02 — bug fix: these two items' effect text has always read
  // "MELEE ONLY" / "RANGED ONLY" but they were never added to this map,
  // so they defaulted to ANY and equipped on the wrong attack class.
  // A feature_audit test now scans item text so this can't recur.
  FALX_BLADE: 'MELEE',
  VOLLEY_QUIVER: 'RANGED',
  // Sea-giant hunter gear: a heavy thrown/fired harpoon belongs on ranged towers.
  TIDEPIERCER_HARPOON: 'RANGED'
  // SERPENT_AMULET and WITCHS_VENOM omitted → default ANY (equip on any tower).
};

const FAMILY: Record<string, ItemFamily> = {
  SHARPENED_BLADE: 'DAMAGE',
  IRON_TIP: 'DAMAGE',
  FLYER_BANE: 'DAMAGE',
  STORM_JAVELIN: 'DAMAGE',
  ELEPHANT_TUSK: 'DAMAGE',
  NECROTIC_LONGSWORD: 'DAMAGE',
  CELTIC_LONGSWORD: 'DAMAGE',

  TRAINING_SCROLL: 'SPEED',
  QUICKDRAW_GLOVES: 'SPEED',
  CAVALRY_SPUR: 'SPEED',
  MERCURY_FEATHER: 'SPEED',
  HOURGLASS_OF_SATURN: 'SPEED',
  // WAR_HOUND_COLLAR moved to AURA (2026-05) — was +35% atk speed self,
  // now emits a 2.5-tile +18% atk speed aura. Family change matches.
  NUMIDIAN_SADDLE: 'SPEED',

  WATCHTOWER_LENS: 'RANGE',
  DRUID_STAFF_FRAGMENT: 'RANGE',

  // DoT items occupy SPECIAL, which is capped at one per tower.
  FIRE_OIL_FLASK: 'SPECIAL',
  POISONED_BLADE: 'SPECIAL',
  BARBED_GLADIUS: 'SPECIAL',
  FALCATA_BLADE: 'SPECIAL',
  ALPHA_PACK_FANG: 'SPECIAL',
  EXECUTIONERS_FALX: 'SPECIAL',
  CONCUSSIVE_WARHEAD: 'SPECIAL',
  // CURSED_TORC moved out of DOT (description was actually +30% damage)
  // into AURA — now emits an enemy-debuff (nearby enemies take +18%).

  CENTURIONS_TRUMPET: 'AURA',
  BATTLE_STANDARD: 'AURA',
  BARCA_WAR_HORN: 'AURA',
  LICH_GENERALS_SEAL: 'AURA',
  // 2026-05 aura expansion — five items converted from single-tower
  // self-buffs to actual aura emitters so the AURA family has real
  // variety and supports vs. ally-buff vs. enemy-debuff archetypes.
  WAR_HOUND_COLLAR: 'AURA',     // +18% atk speed aura, 2.5 tiles
  DRUIDS_TORC: 'AURA',          // +18% damage aura, 2.5 tiles
  CURSED_TORC: 'AURA',          // +18% enemy-taken aura, 2 tiles (debuff)

  GOLD_PURSE: 'ECONOMY',
  HANNIBALS_STRATEGY_SCROLL: 'ECONOMY',
  PUNIC_LEDGER: 'ECONOMY',
  // 2026-05 v6: Mercator-exclusive items below.
  TYRIAN_DYE: 'DAMAGE',
  SCIPIO_PLAYBOOK: 'DAMAGE',
  AQUILIFER_BANNER: 'AURA',

  GALLIC_SHIELD_BOSS: 'DEFENSE',
  GILDED_SCALE_ARMOR: 'DEFENSE',

  BERSERKERS_MUZZLE: 'SPECIAL',
  // DRUIDS_TORC moved to AURA (was SPECIAL self-buff).
  WARLORDS_WAR_PAINT: 'SPECIAL',
  UNDEAD_ELEPHANT_BONE: 'SPECIAL',
  // New legendaries (2026-05): AQUILA_TALONS is a SPECIAL anti-air enabler;
  // SPEAR_OF_MARS occupies the RANGE family because its hook is the +5 tile
  // reach; JUPITERS_WRATH is a SPECIAL chain-lightning proc.
  AQUILA_TALONS: 'SPECIAL',
  SPEAR_OF_MARS: 'RANGE',
  JUPITERS_WRATH: 'SPECIAL',
  CAPITOLINE_AEGIS: 'SPECIAL',
  // 2026-05-15 — three proc/faction items. SPECIAL now means one per
  // tower, so these compete with other trophy/proc effects.
  FALX_BLADE: 'SPECIAL',
  VOLLEY_QUIVER: 'SPECIAL',
  SIGIL_OF_SOL_INVICTUS: 'SPECIAL',
  // TYRANTS_LAUREL is DAMAGE family (occupies the same slot as Sharpened
  // Blade / Iron Tip). VESTAL_PYRE / VENOM_TIPPED_ARROWS / SERPENT_AMULET /
  // WITCHS_VENOM live in SPECIAL, so they compete with other trophy/proc
  // effects under the one-SPECIAL-item cap.
  TYRANTS_LAUREL: 'DAMAGE',
  VESTAL_PYRE: 'SPECIAL',
  VENOM_TIPPED_ARROWS: 'SPECIAL',
  SERPENT_AMULET: 'SPECIAL',
  WITCHS_VENOM: 'SPECIAL',
  // 2026-05-18 — EVENT-EXCLUSIVE LEGENDARIES. They are SPECIAL trophy
  // effects, capped at one per tower for build diversity.
  VANGUARD_PILUM: 'SPECIAL',
  AQUILA_RAMPART: 'SPECIAL',
  PERIMETER_TORCH: 'SPECIAL',
  GRAVEKEEPERS_SCYTHE: 'SPECIAL',
  SOULFIRE_BRAND: 'SPECIAL',
  NECROMANCERS_LANTERN: 'SPECIAL',
  HELLGATE_BRAND: 'SPECIAL',
  DEMONSWORN_CROWN: 'SPECIAL',
  INFERNO_STANDARD: 'SPECIAL',
  // 2026-05-19 — DAMNATIO MEMORIAE. SPECIAL execute trophy. Triggers
  // instant kill on non-Boss enemies below 25% HP when this tower's
  // attack lands. Bosses are immune.
  DAMNATIO_MEMORIAE: 'SPECIAL',
  // 2026-05-18 — EPIC TIER ITEMS. Three new at this rarity (Lictor's
  // Fasces, Auxiliary Sling, Optio's Whistle). DAMAGE for the two stat
  // sticks so they conflict with Sharpened Blade / Iron Tip (sensible —
  // one damage item per tower), AURA for the whistle so it conflicts
  // with Centurion's Trumpet / Druid's Torc / similar.
  LICTOR_FASCES: 'DAMAGE',
  AUXILIARY_SLING: 'DAMAGE',
  OPTIO_WHISTLE: 'AURA',
  BRINEHOOK_ROPE: 'SPECIAL',
  TIDEPIERCER_HARPOON: 'SPECIAL',
  AEGEAN_PEARL: 'SPECIAL',
  STORMGLASS_AMPHORA: 'SPECIAL',
  NEPTUNES_TRIDENT: 'SPECIAL',
  // 2026-05-19 — GATE-EXCLUSIVE STARTER ITEMS. Five new items only
  // sold at the gate shop. Family assignments keep them slotted with
  // the existing exclusivity rules so they conflict appropriately
  // with Mercator items of the same family.
  PRAETORIAN_COIN: 'ECONOMY',
  BRONZE_GREAVES: 'RANGE',
  RUSTED_HASTA: 'DAMAGE',
  AUGUR_SCROLL: 'SPEED',
  CONSULAR_TOKEN: 'DAMAGE'
};

export function itemFamily(itemId: ItemId): ItemFamily {
  return FAMILY[itemId] ?? 'SPECIAL';
}

export const AURA_ITEM_RANDOM_WEIGHT = 0.25;
export const OCEAN_SPECIALIST_ITEM_RANDOM_WEIGHT = 0.62;

const OCEAN_SPECIALIST_ITEMS = new Set<string>([
  'BRINEHOOK_ROPE',
  'TIDEPIERCER_HARPOON',
  'AEGEAN_PEARL',
  'STORMGLASS_AMPHORA',
  'NEPTUNES_TRIDENT'
]);

export function isAuraItem(itemId: ItemId | string): boolean {
  return itemFamily(itemId as ItemId) === 'AURA';
}

export function isOceanSpecialistItem(itemId: ItemId | string): boolean {
  return OCEAN_SPECIALIST_ITEMS.has(String(itemId));
}

export function itemRandomSelectionWeight(itemId: ItemId | string): number {
  let weight = 1;
  if (isAuraItem(itemId)) weight *= AURA_ITEM_RANDOM_WEIGHT;
  if (isOceanSpecialistItem(itemId)) weight *= OCEAN_SPECIALIST_ITEM_RANDOM_WEIGHT;
  return weight;
}

export function canEquipItemFamily(equipped: ItemId[], itemId: ItemId): { ok: boolean; family: ItemFamily } {
  const family = itemFamily(itemId);
  return { ok: !equipped.some(id => itemFamily(id) === family), family };
}

// Lookup the equip-mode for an item. Defaults to ANY when not in the
// EQUIP_MODE map so most items behave exactly as before.
export function itemEquipMode(itemId: ItemId): EquipMode {
  return EQUIP_MODE[itemId] ?? 'ANY';
}

// EQUIP MODE CHECK — verifies a candidate item's attack-class restriction
// matches the target tower's damageType. Returns ok=true for any item
// without a restriction. Melee-only items reject every non-melee tower;
// ranged-only items reject melee towers.
//
// 2026-05-22 V29 — "melee" is now read from BOTH the damageType AND
// the `melee` flag in towers.json. Previously the check was strictly
// `damageType === PHYS_MELEE`, which rejected melee items on towers
// like Pontifex (DIVINE damage, melee:true) and Caesar (DIVINE damage,
// melee:true). Now any tower with `melee:true` in towers.json — even
// if it deals DIVINE or FIRE — passes the MELEE-only restriction.
// `towerType` is optional so existing callers without the type still
// get the old PHYS_MELEE-only behavior (backwards compatible).
export function canEquipItemOnDamageType(
  itemId: ItemId,
  towerDamageType: DamageType,
  towerType?: string
): {
  ok: boolean;
  mode: EquipMode;
  reason?: string;
} {
  const mode = itemEquipMode(itemId);
  if (mode === 'ANY') return { ok: true, mode };
  const damageTypeIsMelee = towerDamageType === DamageType.PHYS_MELEE;
  const flagSaysMelee = towerType ? !!(towersData as any)[towerType]?.melee : false;
  const isMeleeTower = damageTypeIsMelee || flagSaysMelee;
  if (mode === 'MELEE' && !isMeleeTower) {
    return { ok: false, mode, reason: 'Melee-only item — this tower attacks at range. Equip on a melee tower instead.' };
  }
  if (mode === 'RANGED' && isMeleeTower) {
    return { ok: false, mode, reason: 'Ranged-only item — this tower fights in melee. Equip on a ranged tower instead.' };
  }
  return { ok: true, mode };
}
