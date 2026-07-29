import { Tower, DamageType, TowerType } from '../types';
import { GameStateShape } from '../GameState';
import { damageTypeLabel } from '../format';
import { AURA_TILE_EFFECTS } from '../constants';
import { towerAuraTileKind, StatBreakdown } from '../systems/TowerSystem';

export interface TowerDamageProfileRow {
  kind: 'PRIMARY' | 'NATIVE' | 'EXTRA' | 'ON-HIT';
  label: string;
  detail: string;
  color: string;
}

export interface TowerDamageProfile {
  summary: string;
  rows: TowerDamageProfileRow[];
}

const DAMAGE_COLORS: Record<number, string> = {
  [DamageType.PHYS_MELEE]: '#ffb86b',
  [DamageType.PHYS_RANGED]: '#9be0ff',
  [DamageType.SIEGE]: '#c6a36a',
  [DamageType.ELEMENTAL_FIRE]: '#ff7a3a',
  [DamageType.DIVINE]: '#fff2a8',
  [DamageType.NONE]: '#aa9a4a'
};

function damageKey(type: DamageType): string {
  return DamageType[type] ?? 'NONE';
}

function damageLabel(type: DamageType): string {
  return damageTypeLabel(damageKey(type));
}

function pctLabel(pct: number): string {
  return `+${Math.round(pct * 100)}%`;
}

function upsertSummaryPart(parts: string[], part: string): void {
  if (!parts.includes(part)) parts.push(part);
}

function firstDamageModPct(breakdown: StatBreakdown | undefined, sourceNeedle: string): number {
  const mod = breakdown?.damageMods.find(m => m.source.toLowerCase().includes(sourceNeedle.toLowerCase()));
  return Math.max(0, (mod?.multiplier ?? 1) - 1);
}

export function towerDamageProfile(tower: Tower, state: GameStateShape, breakdown?: StatBreakdown): TowerDamageProfile {
  const rows: TowerDamageProfileRow[] = [];
  const summaryParts: string[] = [];
  const auraKind = towerAuraTileKind(tower);
  const proscriptionActive = (state.tick ?? 0) < (((state as any).__proscriptionUntilTick ?? 0) as number);
  const nativeType = tower.damageType ?? DamageType.NONE;

  if (tower.type === TowerType.MARS_VICTOR) {
    rows.push({
      kind: 'PRIMARY',
      label: 'Siege + Divine',
      detail: 'Dual strike: resolves against whichever resistance is weaker.',
      color: DAMAGE_COLORS[DamageType.DIVINE]
    });
    upsertSummaryPart(summaryParts, 'Siege');
    upsertSummaryPart(summaryParts, 'Divine');
  } else if (nativeType === DamageType.NONE) {
    rows.push({
      kind: 'PRIMARY',
      label: 'No direct damage',
      detail: 'Pure support or economy tower.',
      color: DAMAGE_COLORS[DamageType.NONE]
    });
    upsertSummaryPart(summaryParts, 'Support');
  } else if (proscriptionActive) {
    rows.push({
      kind: 'PRIMARY',
      label: 'Divine',
      detail: `Primary hits are converted from ${damageLabel(nativeType)} by Sulla Proscription.`,
      color: DAMAGE_COLORS[DamageType.DIVINE]
    });
    rows.push({
      kind: 'NATIVE',
      label: damageLabel(nativeType),
      detail: 'Native damage profile before this conversion.',
      color: DAMAGE_COLORS[nativeType]
    });
    upsertSummaryPart(summaryParts, 'Divine');
  } else {
    rows.push({
      kind: 'PRIMARY',
      label: damageLabel(nativeType),
      detail: 'Native direct-hit damage type.',
      color: DAMAGE_COLORS[nativeType]
    });
    upsertSummaryPart(summaryParts, damageLabel(nativeType).replace('Physical ', ''));
  }

  const aura = auraKind ? AURA_TILE_EFFECTS[auraKind] : null;
  if (nativeType !== DamageType.NONE && (aura?.divineRiderPct ?? 0) > 0) {
    rows.push({
      kind: 'EXTRA',
      label: 'Divine',
      detail: `${aura!.label} adds ${pctLabel(aura!.divineRiderPct!)} separate Divine damage; native ${damageLabel(nativeType)} remains.`,
      color: DAMAGE_COLORS[DamageType.DIVINE]
    });
    upsertSummaryPart(summaryParts, 'Divine');
  }

  if (tower.equippedItems.includes('CAPITOLINE_AEGIS')) {
    rows.push({
      kind: 'EXTRA',
      label: 'Divine',
      detail: 'Capitoline Aegis adds +35% separate Divine damage on hit.',
      color: DAMAGE_COLORS[DamageType.DIVINE]
    });
    upsertSummaryPart(summaryParts, 'Divine');
  }

  if (tower.type === TowerType.SOL_INVICTUS_QUADRIGA) {
    rows.push({
      kind: 'EXTRA',
      label: 'Divine',
      detail: 'Sol Invictus adds +35% separate Divine damage on hit.',
      color: DAMAGE_COLORS[DamageType.DIVINE]
    });
    upsertSummaryPart(summaryParts, 'Divine');
  }

  const sullaFirePct = firstDamageModPct(breakdown, 'Hero Sulla fire rider');
  if (sullaFirePct > 0) {
    rows.push({
      kind: 'EXTRA',
      label: 'Elemental Fire',
      detail: `Sulla aura adds ${pctLabel(sullaFirePct)} separate Fire damage on hit.`,
      color: DAMAGE_COLORS[DamageType.ELEMENTAL_FIRE]
    });
    upsertSummaryPart(summaryParts, 'Fire');
  }

  const marsFirePct = firstDamageModPct(breakdown, 'Mars Victor Sulla fire rider');
  if (marsFirePct > 0) {
    rows.push({
      kind: 'EXTRA',
      label: 'Elemental Fire',
      detail: `Mars Victor's fused Sulla passive adds ${pctLabel(marsFirePct)} separate Fire damage on hit.`,
      color: DAMAGE_COLORS[DamageType.ELEMENTAL_FIRE]
    });
    upsertSummaryPart(summaryParts, 'Fire');
  }

  if (aura?.hitSlowPct) {
    rows.push({
      kind: 'ON-HIT',
      label: 'Slow',
      detail: `${aura.label}: hits slow enemies by ${Math.round(aura.hitSlowPct * 100)}%.`,
      color: '#78d8ff'
    });
  }

  const itemSet = new Set(tower.equippedItems ?? []);
  const onHitItems: Array<[string, string, string, string]> = [
    ['GALLIC_SHIELD_BOSS', 'Stun + Healing Denial', 'Gallic Shield Boss: every 4th hit stuns non-boss enemies for 1.2s and blocks regeneration for 3s.', '#ffd34d'],
    ['SAPPERS_CHISEL', 'Armor Shred', "Sapper's Chisel: every 3rd hit applies Armor Shred for 3.5s.", '#d9a35f'],
    ['CALTROP_SATCHEL', 'Slow', 'Caltrop Satchel: every 4th hit slows the enemy by 25% for 2.6s.', '#78d8ff'],
    ['CENSORS_SEAL', 'Mark', "Censor's Seal: every 4th hit marks the enemy to take 20% more damage for 4s.", '#ff6f61'],
    ['NECROTIC_LONGSWORD', 'Healing Denial', 'Necrotic Longsword: melee hits block regeneration for 1.5s.', '#b56cff'],
    ['JUPITERS_WRATH', 'Lightning + Stun', "Jupiter's Wrath: chains lightning to nearby enemies and stuns the primary target.", '#fff2a8'],
    ['FIRE_OIL_FLASK', 'Burn', 'Fire Oil Flask: burns the target and nearby enemies on impact.', DAMAGE_COLORS[DamageType.ELEMENTAL_FIRE]],
    ['VESTAL_PYRE', 'Burn', 'Vestal Pyre: adds Fire burn damage on hit.', DAMAGE_COLORS[DamageType.ELEMENTAL_FIRE]],
    ['INFERNO_STANDARD', 'Burn', 'Inferno Standard: carrier attacks apply heavy Burn on hit.', DAMAGE_COLORS[DamageType.ELEMENTAL_FIRE]],
    ['POISONED_BLADE', 'Poison', 'Poisoned Blade: melee hits apply Poison over time.', '#84ff88'],
    ['VENOM_TIPPED_ARROWS', 'Poison', 'Venom-Tipped Arrows: ranged hits apply Poison over time.', '#84ff88'],
    ['SERPENT_AMULET', 'Poison', 'Serpent Amulet: hits apply Poison over time.', '#84ff88'],
    ['WITCHS_VENOM', 'Poison', "Witch's Venom: hits apply strong Poison over time.", '#84ff88'],
    ['BARBED_GLADIUS', 'Bleed', 'Barbed Gladius: melee hits apply Bleed over time.', '#ff7f7f'],
    ['FALCATA_BLADE', 'Bleed', 'Falcata Blade: melee hits apply savage Bleed over time.', '#ff7f7f'],
    ['ALPHA_PACK_FANG', 'Bleed', 'Alpha Pack Fang: melee hits apply long ruinous Bleed.', '#ff7f7f'],
    ['SOULFIRE_BRAND', 'Hellfire', 'Soulfire Brand: hits apply Hellfire true damage over time.', '#ff55dd'],
  ];
  for (const [id, label, detail, color] of onHitItems) {
    if (!itemSet.has(id)) continue;
    rows.push({ kind: 'ON-HIT', label, detail, color });
    if (label === 'Burn') upsertSummaryPart(summaryParts, 'Burn');
    else if (label === 'Hellfire') upsertSummaryPart(summaryParts, 'Hellfire');
    else if (label === 'Poison') upsertSummaryPart(summaryParts, 'Poison');
    else if (label === 'Bleed') upsertSummaryPart(summaryParts, 'Bleed');
  }
  if (itemSet.has('VULCANS_TEMPER')) {
    rows.push({
      kind: 'EXTRA',
      label: 'Resistance Breach',
      detail: "Vulcan's Temper: attacks ignore 28% of reducible resistance, but never immunity.",
      color: '#ff9b4a'
    });
  }

  return {
    summary: summaryParts.join(' + ') || 'Support',
    rows
  };
}

function escapeHtml(raw: string): string {
  return raw.replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch] ?? ch));
}

export function renderTowerDamageProfileHtml(profile: TowerDamageProfile, compact = false): string {
  const visibleRows = compact ? profile.rows.slice(0, 4) : profile.rows;
  const rowHtml = visibleRows.map(row => `
    <div style="display:grid;grid-template-columns:54px 88px 1fr;gap:6px;align-items:start;padding:${compact ? '2px 0' : '4px 0'};border-top:1px solid #2a2118">
      <span style="color:#aa9a4a;font-size:${compact ? '8px' : '9px'};letter-spacing:1px">${row.kind}</span>
      <span style="color:${row.color};font-weight:bold">${escapeHtml(row.label)}</span>
      <span style="color:#cdb98a">${escapeHtml(row.detail)}</span>
    </div>
  `).join('');
  const more = compact && profile.rows.length > visibleRows.length
    ? `<div style="color:#aa9a4a;font-size:9px;margin-top:2px">+${profile.rows.length - visibleRows.length} more in tower menu</div>`
    : '';
  return `
    <div style="background:#100c09;border:1px solid #3a3025;padding:${compact ? '6px 8px' : '8px 10px'};font-size:${compact ? '9.5px' : '10.5px'};line-height:1.35">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:4px">
        <div style="color:#aa9a4a;letter-spacing:1.5px;font-size:${compact ? '8px' : '9px'};text-transform:uppercase">Damage Profile</div>
        <div style="color:#fff2a8;font-weight:bold;text-align:right">${escapeHtml(profile.summary)}</div>
      </div>
      ${rowHtml}
      ${more}
    </div>
  `;
}
