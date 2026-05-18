import { ItemId, DamageType } from '../types';

// 2026-05 v9: DOT split into per-kind sub-families (DOT_BURN, DOT_POISON,
// DOT_BLEED) so a tower can carry one of each — variety of DoTs is
// rewarded but stacking multiple of the SAME kind is blocked. The
// legacy 'DOT' label is gone; every DoT-applying item now declares its
// kind. Player-facing copy still calls them all "DoT items" — the
// sub-families only matter for the canEquipItemFamily rule.
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
  // RANGED-only — projectile / saddle / shot themed items
  STORM_JAVELIN: 'RANGED',
  FLYER_BANE: 'RANGED',
  FIRE_OIL_FLASK: 'RANGED',
  NUMIDIAN_SADDLE: 'RANGED',         // Numidian skirmisher — ranged identity
  VENOM_TIPPED_ARROWS: 'RANGED',     // 2026-05 v9: ranged-poison Mercator stock
  AUXILIARY_SLING: 'RANGED'          // 2026-05-18: Epic ranged sling
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

  // 2026-05-17 — DoT items moved to SPECIAL so a tower can stack any
  // combination of DoT items freely. Previously DoT was split into
  // sub-families (DOT_BURN / DOT_POISON / DOT_BLEED) so one of each
  // type could coexist, but two of the same type were blocked. Per
  // user direction: DoT items now all stack — build a dedicated
  // "DoT specialist" tower with burn + poison + bleed + venom + etc.
  FIRE_OIL_FLASK: 'SPECIAL',
  POISONED_BLADE: 'SPECIAL',
  BARBED_GLADIUS: 'SPECIAL',
  FALCATA_BLADE: 'SPECIAL',
  ALPHA_PACK_FANG: 'SPECIAL',
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
  // New legendaries (2026-05): AQUILA_TALONS is a SPECIAL anti-air enabler
  // (stacks with any damage/range item); SPEAR_OF_MARS occupies the RANGE
  // family because its hook is the +5 tile reach; JUPITERS_WRATH is a
  // SPECIAL chain-lightning proc so it can pair with a damage item.
  AQUILA_TALONS: 'SPECIAL',
  SPEAR_OF_MARS: 'RANGE',
  JUPITERS_WRATH: 'SPECIAL',
  // 2026-05-15 — three new items. All SPECIAL so they stack freely with
  // damage / speed / range / DOT / aura items on the same tower (the
  // SPECIAL family always passes canEquipItemFamily). Effects are
  // multi-hit expansions (cleave + extra shot) and a faction-specific
  // damage spike (anti-demon).
  FALX_BLADE: 'SPECIAL',
  VOLLEY_QUIVER: 'SPECIAL',
  SIGIL_OF_SOL_INVICTUS: 'SPECIAL',
  // TYRANTS_LAUREL is DAMAGE family (occupies the same slot as Sharpened
  // Blade / Iron Tip). 2026-05-17 — VESTAL_PYRE / VENOM_TIPPED_ARROWS /
  // SERPENT_AMULET / WITCHS_VENOM moved to SPECIAL with the rest of
  // the DoT family so the "stack as many DoTs as you want" rule applies
  // uniformly.
  TYRANTS_LAUREL: 'DAMAGE',
  VESTAL_PYRE: 'SPECIAL',
  VENOM_TIPPED_ARROWS: 'SPECIAL',
  SERPENT_AMULET: 'SPECIAL',
  WITCHS_VENOM: 'SPECIAL',
  // 2026-05-18 — EVENT-EXCLUSIVE LEGENDARIES. All registered SPECIAL
  // so they stack with any other equipped item (DoT, damage, range,
  // aura). The intention is event rewards feel additive to whatever
  // build the player already has, not "you have to drop your damage
  // item to use this".
  VANGUARD_PILUM: 'SPECIAL',
  AQUILA_RAMPART: 'SPECIAL',
  PERIMETER_TORCH: 'SPECIAL',
  GRAVEKEEPERS_SCYTHE: 'SPECIAL',
  SOULFIRE_BRAND: 'SPECIAL',
  NECROMANCERS_LANTERN: 'SPECIAL',
  HELLGATE_BRAND: 'SPECIAL',
  DEMONSWORN_CROWN: 'SPECIAL',
  INFERNO_STANDARD: 'SPECIAL',
  // 2026-05-18 — EPIC TIER ITEMS. Three new at this rarity (Lictor's
  // Fasces, Auxiliary Sling, Optio's Whistle). DAMAGE for the two stat
  // sticks so they conflict with Sharpened Blade / Iron Tip (sensible —
  // one damage item per tower), AURA for the whistle so it conflicts
  // with Centurion's Trumpet / Druid's Torc / similar.
  LICTOR_FASCES: 'DAMAGE',
  AUXILIARY_SLING: 'DAMAGE',
  OPTIO_WHISTLE: 'AURA'
};

export function itemFamily(itemId: ItemId): ItemFamily {
  return FAMILY[itemId] ?? 'SPECIAL';
}

export function canEquipItemFamily(equipped: ItemId[], itemId: ItemId): { ok: boolean; family: ItemFamily } {
  const family = itemFamily(itemId);
  if (family === 'SPECIAL') return { ok: true, family };
  return { ok: !equipped.some(id => itemFamily(id) === family), family };
}

// Lookup the equip-mode for an item. Defaults to ANY when not in the
// EQUIP_MODE map so most items behave exactly as before.
export function itemEquipMode(itemId: ItemId): EquipMode {
  return EQUIP_MODE[itemId] ?? 'ANY';
}

// EQUIP MODE CHECK — verifies a candidate item's attack-class restriction
// matches the target tower's damageType. Returns ok=true for any item
// without a restriction. Melee-only items reject every non-PHYS_MELEE
// tower; ranged-only items reject PHYS_MELEE towers.
export function canEquipItemOnDamageType(itemId: ItemId, towerDamageType: DamageType): {
  ok: boolean;
  mode: EquipMode;
  reason?: string;
} {
  const mode = itemEquipMode(itemId);
  if (mode === 'ANY') return { ok: true, mode };
  const isMeleeTower = towerDamageType === DamageType.PHYS_MELEE;
  if (mode === 'MELEE' && !isMeleeTower) {
    return { ok: false, mode, reason: 'Melee-only item — this tower attacks at range. Equip on a melee tower instead.' };
  }
  if (mode === 'RANGED' && isMeleeTower) {
    return { ok: false, mode, reason: 'Ranged-only item — this tower fights in melee. Equip on a ranged tower instead.' };
  }
  return { ok: true, mode };
}
