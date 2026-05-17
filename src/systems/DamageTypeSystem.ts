import { DamageType, EnemyFaction } from '../types';
import factionRes from '../data/factionResistances.json';

const FACTION_KEYS: Record<number, string> = {
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
  [EnemyFaction.EGYPTIANS]: 'EGYPTIANS'
};
const DAMAGE_KEYS: Record<number, string> = {
  [DamageType.PHYS_MELEE]: 'PHYS_MELEE',
  [DamageType.PHYS_RANGED]: 'PHYS_RANGED',
  [DamageType.SIEGE]: 'SIEGE',
  [DamageType.ELEMENTAL_FIRE]: 'ELEMENTAL_FIRE',
  [DamageType.DIVINE]: 'DIVINE'
};

// Returns a multiplier on base damage. DIVINE is always 1.0 (true damage).
// Faction resistance values in factionResistances.json are signed offsets
// added to 1.0: e.g. -0.25 = 25% resist (returns 0.75), +0.25 = 25% weakness
// (returns 1.25). 'IMMUNE' returns 0.
//
// Armor shred reverses RESISTANCE only (negative values): it sets val=0,
// restoring damage to 100%. It must NEVER reduce a weakness multiplier.
export function resistanceModifier(faction: EnemyFaction, dmg: DamageType, armorShredActive = false): number {
  if (dmg === DamageType.DIVINE) return 1.0;
  if (dmg === DamageType.NONE) return 0;
  const factionKey = FACTION_KEYS[faction];
  const damageKey = DAMAGE_KEYS[dmg];
  const row = (factionRes as any)[factionKey];
  if (!row) return 1.0;
  let val = row[damageKey];
  if (val === 'IMMUNE') return 0;
  if (typeof val !== 'number') return 1.0;     // defensive: missing entry → no modifier
  // Armor shred only matters when the faction is RESISTANT to physical (val < 0).
  // It pulls val UP to 0 (full damage). On weakness (val > 0), do nothing.
  if (armorShredActive && (dmg === DamageType.PHYS_MELEE || dmg === DamageType.PHYS_RANGED) && val < 0) {
    val = 0;
  }
  return 1 + val;
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
