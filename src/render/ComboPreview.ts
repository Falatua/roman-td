// 2026-05-23 — COMBO PREVIEW BLOCK
//
// Shared HTML helper for collapsible "what does this combo tower do"
// drop-down rows that appear underneath every recipe in the prospect
// placement panel (main.ts) AND in the tower-menu RECIPES USING ...
// list (TowerMenu.ts).
//
// User request: "I see all these recipes I can do, but I don't know
// what those combination Towers do. ... It would be nice if we had a
// drop-down menu for each of those recipes ... where I could see the
// entire details of that combination Tower. Specifically, like damage,
// is it ranged, is it melee, and what's its ability."
//
// Output is a single self-contained HTML string — caller just wraps it
// in a hidden container and toggles display:none when the user clicks
// the chevron. No event handlers attached here; the caller wires
// click-to-toggle.
import towersData from '../data/towers.json';

/**
 * Build the collapsible preview block HTML for a combo tower by type id.
 *
 * Returns the inner HTML for the drop-down body — caller is responsible
 * for putting it inside a container with `display:none` and toggling.
 */
export function comboPreviewBlockHtml(comboType: string): string {
  const def: any = (towersData as any)[comboType];
  if (!def) {
    return `<div style="padding:8px 10px;font-size:10px;color:#aa9a4a">No tower data for ${comboType}.</div>`;
  }
  // Damage-type label + color. Strips the PHYS_ prefix so the badge
  // reads "MELEE" / "RANGED" instead of "PHYS_MELEE".
  const rawDmg: string = String(def.damageType ?? '');
  const dmgLabel = rawDmg.replace('PHYS_', '').replace('ELEMENTAL_', '').replace(/_/g, ' ');
  const dmgColorMap: Record<string, string> = {
    'MELEE': '#ff8855',
    'RANGED': '#88ddff',
    'SIEGE': '#cdb98a',
    'DIVINE': '#ffd34d',
    'FIRE': '#ff5500',
  };
  const dmgColor = dmgColorMap[dmgLabel] ?? '#cdb98a';
  // Melee vs Ranged top-line badge — quick "do I need a path-adjacent
  // tile?" signal. Comes before the damage-type chip.
  const meleeBadge = def.melee
    ? '<span style="background:#ff8855;color:#000;padding:1px 6px;font-size:9px;font-weight:bold;letter-spacing:1px">MELEE</span>'
    : '<span style="background:#88ddff;color:#000;padding:1px 6px;font-size:9px;font-weight:bold;letter-spacing:1px">RANGED</span>';
  // Anti-air badge if this tower can only target flyers.
  const antiAirBadge = def.antiAirOnly
    ? '<span style="background:#aa44ff;color:#fff;padding:1px 6px;font-size:9px;font-weight:bold;letter-spacing:1px">ANTI-AIR ONLY</span>'
    : '';
  // Crit profile — only show if non-zero.
  const cc = (def.critChance ?? 0) * 100;
  const cm = def.critMult ?? 1.5;
  const critText = cc > 0 ? `${Math.round(cc)}% × ${cm.toFixed(1)}×` : '—';
  // Range — show as tiles. Melee is 1.5 by convention.
  const rangeText = def.range != null ? `${def.range.toFixed(1)} tiles` : '—';
  // Attack speed — present as shots/second so the player can compare
  // burst potential between recipes without doing math.
  const rateText = def.attackSpeed ? `${def.attackSpeed.toFixed(2)}/s` : '—';
  const dpsText = def.baseDps != null ? `${Math.round(def.baseDps)}` : '—';
  // Ability text — show in full. These tooltips were authored to fit
  // the tower menu and Codex; they fit here too.
  const abilityText: string = String(def.ability ?? '').trim();
  const abilityBlock = abilityText
    ? `<div style="font-size:10px;line-height:1.55;color:#cdb98a;margin-top:6px;padding-top:6px;border-top:1px dashed #3a3025">${abilityText}</div>`
    : '';
  return `
    <div style="padding:8px 10px;background:#080604">
      <div style="display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap">
        ${meleeBadge}
        <span style="background:${dmgColor};color:#000;padding:1px 6px;font-size:9px;font-weight:bold;letter-spacing:1px">${dmgLabel}</span>
        ${antiAirBadge}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 12px;font-size:10px">
        <div><b style="color:#aa9a4a;letter-spacing:1px">DPS</b> <span style="color:#ff9933;font-weight:bold">${dpsText}</span></div>
        <div><b style="color:#aa9a4a;letter-spacing:1px">RATE</b> <span style="color:#cdb98a">${rateText}</span></div>
        <div><b style="color:#aa9a4a;letter-spacing:1px">RANGE</b> <span style="color:#cdb98a">${rangeText}</span></div>
        <div><b style="color:#aa9a4a;letter-spacing:1px">CRIT</b> <span style="color:#cdb98a">${critText}</span></div>
      </div>
      ${abilityBlock}
    </div>
  `;
}
