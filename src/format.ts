// Display-name helpers. Source-code identifiers (enum values, JSON keys) keep
// their UPPER_SNAKE_CASE form; anything shown to the player is routed through
// these helpers so no underscore ever leaks into the UI.

import towersData from './data/towers.json';
import enemiesData from './data/enemies.json';
import itemsData from './data/items_permanent.json';
import consumablesData from './data/items_consumable.json';

const TOWERS = towersData as Record<string, { name?: string }>;
const ENEMIES = enemiesData as Record<string, { name?: string }>;
const ITEMS = itemsData as Record<string, { name?: string }>;
const CONS = consumablesData as Record<string, { name?: string }>;

// Generic: "FERAL_DOG" -> "Feral Dog", "DOGS" -> "Dogs", "Iron Tip" -> "Iron Tip" (idempotent).
export function pretty(raw: string | undefined | null): string {
  if (!raw) return '';
  if (!raw.includes('_')) {
    // Already mixed case, leave alone. If the whole word is uppercase, title-case it.
    return raw === raw.toUpperCase() && raw.length > 1
      ? raw.charAt(0) + raw.slice(1).toLowerCase()
      : raw;
  }
  return raw.split('_').map(w => w.length === 0 ? '' : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

// Resolve a tower display name: prefer the JSON's `name` field, fall back to pretty(enum).
export function towerName(type: string): string {
  return TOWERS[type]?.name ?? pretty(type);
}

export function enemyName(type: string): string {
  return ENEMIES[type]?.name ?? pretty(type);
}

export function itemName(id: string): string {
  return ITEMS[id]?.name ?? CONS[id]?.name ?? pretty(id);
}

// Faction display: "UNDEAD_CARTHAGE" -> "Undead Carthage".
// 2026-05-17 — Special-case MONGOLS to display as "Huns" since the
// Romans historically fought Attila the Hun, not Mongols. Internal
// enum / file IDs stay MONGOLS for save-game compatibility; only the
// player-facing label changes.
export function factionName(raw: string): string {
  if (raw === 'MONGOLS') return 'Huns';
  return pretty(raw);
}

// Player-facing damage-type label: turns the internal SCREAMING_SNAKE_CASE
// damage-type enum keys into clean Title Case strings without underscores.
// e.g. "PHYS_MELEE" -> "Physical Melee", "ELEMENTAL_FIRE" -> "Elemental Fire".
const DAMAGE_TYPE_LABEL: Record<string, string> = {
  PHYS_MELEE: 'Physical Melee',
  PHYS_RANGED: 'Physical Ranged',
  SIEGE: 'Siege',
  ELEMENTAL_FIRE: 'Elemental Fire',
  DIVINE: 'Divine',
  NONE: '—'
};
export function damageTypeLabel(raw: string | undefined | null): string {
  if (!raw) return '—';
  return DAMAGE_TYPE_LABEL[raw] ?? pretty(raw);
}
