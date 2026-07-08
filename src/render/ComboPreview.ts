// 2026-05-23 — COMBO PREVIEW BLOCK + INFO MODAL
//
// Shared HTML helper for "what does this combo tower do" surfaces:
// - `comboPreviewBlockHtml(type)` returns an inline HTML block used in
//   collapsible drop-downs under each recipe in the prospect placement
//   panel (main.ts) AND the tower-menu RECIPES USING ... list
//   (TowerMenu.ts).
// - `showComboInfoModal(comboType)` opens a centered modal with the
//   same info presented bigger + harder to miss. Used when the player
//   clicks a recipe row's name in the prospect sidebar.
//
// User request: "Have it so that if I click on that scorpion bolt or
// if I click on that Aerarium, it gives me a breakdown of what that
// combination tower is and what it does."
import towersData from '../data/towers.json';
import comboData from '../data/towerCombinations.json';
import { texUrl } from './Assets';
import { enhanceModalErgonomics } from './ModalErgonomics';

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

/**
 * Open a centered modal showing a full combo-tower breakdown — sprite,
 * stats, ability text, and the recipe ingredients. Pops above the
 * playfield with a dimmed backdrop. Close on backdrop click, ✕ button,
 * or Escape.
 *
 * Caller passes the combo's TowerType key (e.g. "SCORPION_BOLT").
 */
export function showComboInfoModal(comboType: string): void {
  // Remove any prior instance so re-clicks don't stack overlays.
  document.getElementById('combo-info-modal')?.remove();
  const def: any = (towersData as any)[comboType];
  if (!def) return;
  const recipe: any = (comboData as any[]).find(r => r.result === comboType);
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
  const TIER_HEX: Record<number, string> = {
    1: '#88ccff', 2: '#88ff88', 3: '#ffd34d', 4: '#cc99ff', 5: '#ff5050',
  };
  const tierColor = TIER_HEX[recipe?.tier ?? 1] ?? '#ffd34d';
  const meleeBadge = def.melee
    ? '<span style="background:#ff8855;color:#000;padding:3px 10px;font-size:11px;font-weight:bold;letter-spacing:1px">MELEE</span>'
    : '<span style="background:#88ddff;color:#000;padding:3px 10px;font-size:11px;font-weight:bold;letter-spacing:1px">RANGED</span>';
  const antiAirBadge = def.antiAirOnly
    ? '<span style="background:#aa44ff;color:#fff;padding:3px 10px;font-size:11px;font-weight:bold;letter-spacing:1px">ANTI-AIR ONLY</span>'
    : '';
  const cc = (def.critChance ?? 0) * 100;
  const cm = def.critMult ?? 1.5;
  const critText = cc > 0 ? `${Math.round(cc)}% × ${cm.toFixed(1)}×` : '—';
  const rangeText = def.range != null ? `${def.range.toFixed(1)} tiles` : '—';
  const rateText = def.attackSpeed ? `${def.attackSpeed.toFixed(2)}/s` : '—';
  const dpsText = def.baseDps != null ? `${Math.round(def.baseDps)}` : '—';
  const abilityText: string = String(def.ability ?? '').trim();
  // Try to grab the sprite via the same texUrl path the renderer uses.
  // Falls through to "no image" if the lookup misses (unregistered key,
  // pre-asset-load, etc.).
  const spriteSrc = texUrl(comboType) ?? '';
  // Ingredients block — show as "TYPE T#+" chips in a compact row.
  const ingredientsHtml = recipe
    ? recipe.ingredients.map((ing: any) => {
        const ingDef: any = (towersData as any)[ing.type];
        const ingName = ingDef?.name ?? String(ing.type).replace(/_/g, ' ');
        const ingTier = TIER_HEX[ing.minTier] ?? '#cdb98a';
        return `<span style="padding:3px 8px;border:1.5px solid ${ingTier};color:${ingTier};font-size:11px;font-weight:bold;letter-spacing:0.5px">${ingName} T${ing.minTier}+</span>`;
      }).join('<span style="color:#cdb98a;margin:0 4px">+</span>')
    : '<span style="color:#aa9a4a">No recipe data.</span>';
  const cost = recipe?.cost != null ? `${recipe.cost}g` : '—';
  // Build the modal DOM.
  const modal = document.createElement('div');
  modal.id = 'combo-info-modal';
  modal.style.cssText = `
    position:fixed;inset:0;
    display:flex;align-items:center;justify-content:center;
    background:rgba(0,0,0,0.65);
    z-index:9000;
    font-family:'Courier New',monospace;
  `;
  modal.innerHTML = `
    <div id="combo-info-panel" style="
      width:min(440px,90%);
      max-height:88vh;
      overflow-y:auto;
      background:linear-gradient(180deg,#1a1208,#0c0a08);
      border:3px solid ${tierColor};
      box-shadow:0 0 32px ${tierColor}88, inset 0 0 24px rgba(0,0,0,0.55);
      padding:18px 20px;
      color:#cdb98a;
      position:relative;
    ">
      <button id="combo-info-close" title="Close" style="
        position:absolute;top:6px;right:8px;
        width:28px;height:28px;
        background:transparent;color:#cdb98a;border:1px solid #5a4a30;
        font-size:18px;font-family:inherit;cursor:pointer;line-height:1;
      ">✕</button>

      <div style="text-align:center;border-bottom:1px solid ${tierColor}55;padding-bottom:10px;margin-bottom:10px">
        ${spriteSrc ? `<img src="${spriteSrc}" alt="${def.name}" style="width:96px;height:96px;image-rendering:pixelated;display:block;margin:0 auto 8px"/>` : ''}
        <div style="font-size:11px;letter-spacing:3px;color:${tierColor};font-weight:bold">T${recipe?.tier ?? '?'} COMBO</div>
        <div style="font-size:18px;letter-spacing:2px;color:${tierColor};font-weight:bold;margin-top:4px;text-shadow:1px 1px 0 #000">${def.name ?? String(comboType).replace(/_/g,' ')}</div>
      </div>

      <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;justify-content:center">
        ${meleeBadge}
        <span style="background:${dmgColor};color:#000;padding:3px 10px;font-size:11px;font-weight:bold;letter-spacing:1px">${dmgLabel}</span>
        ${antiAirBadge}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 18px;font-size:13px;margin-bottom:14px">
        <div><span style="color:#aa9a4a;letter-spacing:1px;font-size:10px">DPS</span><br/><span style="color:#ff9933;font-weight:bold;font-size:16px">${dpsText}</span></div>
        <div><span style="color:#aa9a4a;letter-spacing:1px;font-size:10px">ATTACK RATE</span><br/><span style="color:#cdb98a;font-weight:bold;font-size:16px">${rateText}</span></div>
        <div><span style="color:#aa9a4a;letter-spacing:1px;font-size:10px">RANGE</span><br/><span style="color:#cdb98a;font-weight:bold;font-size:16px">${rangeText}</span></div>
        <div><span style="color:#aa9a4a;letter-spacing:1px;font-size:10px">CRIT</span><br/><span style="color:#cdb98a;font-weight:bold;font-size:16px">${critText}</span></div>
      </div>

      ${abilityText ? `
        <div style="border-top:1px dashed #3a3025;padding-top:10px;margin-bottom:14px">
          <div style="font-size:10px;letter-spacing:2px;color:#aa9a4a;margin-bottom:6px">ABILITY</div>
          <div style="font-size:12px;line-height:1.55;color:#fff8e0">${abilityText}</div>
        </div>
      ` : ''}

      <div style="border-top:1px dashed #3a3025;padding-top:10px">
        <div style="font-size:10px;letter-spacing:2px;color:#aa9a4a;margin-bottom:6px">RECIPE · ${cost}</div>
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:2px">${ingredientsHtml}</div>
      </div>

      <div style="margin-top:14px;text-align:center">
        <button id="combo-info-dismiss" style="
          padding:8px 20px;
          background:linear-gradient(180deg,${tierColor}33,#1a1208);
          color:${tierColor};
          border:1.5px solid ${tierColor};
          font-family:inherit;font-size:11px;font-weight:bold;letter-spacing:2px;
          cursor:pointer;
        ">CLOSE</button>
      </div>
    </div>
  `;
  // Click outside the panel closes the modal. Inner panel stops the
  // bubble so clicks INSIDE the panel don't dismiss it.
  const panel = modal.querySelector('#combo-info-panel') as HTMLElement;
  const closeModal = () => {
    modal.remove();
    document.removeEventListener('keydown', escHandler);
  };
  modal.onclick = closeModal;
  if (panel) panel.onclick = (ev) => ev.stopPropagation();
  (modal.querySelector('#combo-info-close') as HTMLButtonElement | null)
    ?.addEventListener('click', closeModal);
  (modal.querySelector('#combo-info-dismiss') as HTMLButtonElement | null)
    ?.addEventListener('click', closeModal);
  // Escape closes too.
  const escHandler = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') {
      closeModal();
    }
  };
  document.addEventListener('keydown', escHandler);
  if (panel) {
    enhanceModalErgonomics(modal, panel, {
      title: 'Combo information',
      closeButton: true,
      closeButtonId: 'combo-info-modal-x',
      onClose: closeModal,
      toolRightPx: 42
    });
  }
  document.body.appendChild(modal);
}
