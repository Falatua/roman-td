import { DamageType, EnemyFaction, StatusEffectKind } from '../types';
import factionRes from '../data/factionResistances.json';

export const FACTION_KEYS: Record<number, string> = {
  [EnemyFaction.DOGS]: 'DOGS',
  [EnemyFaction.CELTS]: 'CELTS',
  [EnemyFaction.CARTHAGE]: 'CARTHAGE',
  [EnemyFaction.UNDEAD_CELTS]: 'UNDEAD_CELTS',
  [EnemyFaction.UNDEAD_CARTHAGE]: 'UNDEAD_CARTHAGE',
  [EnemyFaction.SUPER_DEMONS]: 'SUPER_DEMONS',
  // 2026-05 v10 — ENDLESS MODE factions. Missing entries here would
  // make Mongol/Egyptian enemies silently take FULL damage from every
  // damage type (faction row never reached), which would have made
  // the new chaos roster trivial to chip down with any tower.
  [EnemyFaction.MONGOLS]: 'MONGOLS',
  [EnemyFaction.EGYPTIANS]: 'EGYPTIANS',
  // 2026-07-09 QC fix — ROMAN_MYTH was missing from this map, which is the
  // exact failure mode the comment above warns about: every W25-29 myth
  // enemy (Chimera, Cerberus, Typhon, Gigas, Cyclops, Colossus, sea giants,
  // naga, Stone Juggernaut + 3 commanders) silently took FULL damage from
  // every damage type while the armor UI showed the faction resists.
  [EnemyFaction.ROMAN_MYTH]: 'ROMAN_MYTH',
  [EnemyFaction.OCEAN]: 'OCEAN',
  [EnemyFaction.NEUTRAL]: 'NEUTRAL'
};
const DAMAGE_KEYS: Record<number, string> = {
  [DamageType.PHYS_MELEE]: 'PHYS_MELEE',
  [DamageType.PHYS_RANGED]: 'PHYS_RANGED',
  [DamageType.SIEGE]: 'SIEGE',
  [DamageType.ELEMENTAL_FIRE]: 'ELEMENTAL_FIRE',
  [DamageType.DIVINE]: 'DIVINE'
};

// Returns a multiplier on base damage. DIVINE ignores resistance and armor
// shred, but authored faction vulnerabilities still amplify it. No faction
// is allowed to resist or become immune to DIVINE through this layer.
// Faction resistance values in factionResistances.json are signed offsets
// added to 1.0: e.g. -0.25 = 25% resist (returns 0.75), +0.25 = 25% weakness
// (returns 1.25). 'IMMUNE' returns 0.
//
// Armor shred reverses RESISTANCE only (negative values): it sets val=0,
// restoring damage to 100%. It must NEVER reduce a weakness multiplier.
export function resistanceModifier(faction: EnemyFaction, dmg: DamageType, armorShredActive = false): number {
  if (dmg === DamageType.NONE) return 0;
  const factionKey = FACTION_KEYS[faction];
  const damageKey = DAMAGE_KEYS[dmg];
  const row = (factionRes as any)[factionKey];
  if (!row) return 1.0;
  let val = row[damageKey];
  if (val === 'IMMUNE') return 0;
  if (typeof val !== 'number') return 1.0;     // defensive: missing entry → no modifier
  // Divine remains true damage against armor. Faction rows may only make
  // it stronger as a thematic weakness, never weaker.
  if (dmg === DamageType.DIVINE) return 1 + Math.max(0, val);
  // Armor shred only matters when the faction is RESISTANT to physical (val < 0).
  // It pulls val UP to 0 (full damage). On weakness (val > 0), do nothing.
  if (armorShredActive && (dmg === DamageType.PHYS_MELEE || dmg === DamageType.PHYS_RANGED) && val < 0) {
    val = 0;
  }
  return 1 + val;
}

const STATUS_KEYS: Partial<Record<StatusEffectKind, string>> = {
  [StatusEffectKind.SLOW]: 'SLOW',
  [StatusEffectKind.BURN]: 'BURN',
  [StatusEffectKind.BLEED]: 'BLEED',
  [StatusEffectKind.POISON]: 'POISON'
};

// Faction-wide status identity. Values use the same signed-offset convention
// as direct damage: -0.20 means 20% less effective, +0.20 means 20% more
// effective, and IMMUNE means the effect cannot apply.
export function factionStatusModifier(faction: EnemyFaction, kind: StatusEffectKind): number {
  const statusKey = STATUS_KEYS[kind];
  if (!statusKey) return 1;
  const factionKey = FACTION_KEYS[faction];
  const val = (factionRes as any)[factionKey]?.STATUS?.[statusKey];
  if (val === 'IMMUNE') return 0;
  return typeof val === 'number' ? 1 + val : 1;
}

export function damageTypeFromString(s: string): DamageType {
  switch (s) {
    case 'PHYS_MELEE': return DamageType.PHYS_MELEE;
    case 'PHYS_RANGED': return DamageType.PHYS_RANGED;
    case 'SIEGE': return DamageType.SIEGE;
    case 'ELEMENTAL_FIRE': return DamageType.ELEMENTAL_FIRE;
    case 'DIVINE': return DamageType.DIVINE;
    default: return DamageType.NONE;
  }
}
