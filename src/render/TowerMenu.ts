import { Tower, TowerType, TargetingMode } from '../types';
import { GameStateShape } from '../GameState';
import { ECONOMY, INVENTORY_SIZE, TIER_COLORS, HERO_ITEM_SLOTS } from '../constants';
import { damageTypeLabel, pretty } from '../format';
import { canDowngrade, downgradeTower } from '../systems/DowngradeSystem';
import { earnGold } from '../systems/EconomySystem';
import { setTile } from '../systems/GridManager';
import { canTransformWithGiantsBane, canTransformWithWitchsBrew, GIANTS_BANE_ITEM_ID, isGiantsBaneTransformedTowerType, isWitchsBrewTransformedTowerType, towerEffectiveStats, towerItemSlotCap, towerPerAttackDamageBase, towerStatBreakdown, transformWithGiantsBane, transformWithWitchsBrew, WITCHS_BREW_ITEM_ID, StatModifier } from '../systems/TowerSystem';
import { getTowerProjectileProfile } from '../systems/ProjectileSystem';
import { TileType } from '../types';
import { InventoryState, inventoryAdd, inventoryRemove, itemBuyPrice, Rarity } from '../systems/LootSystem';
import permItems from '../data/items_permanent.json';
import consumables from '../data/items_consumable.json';
import towersData from '../data/towers.json';
// 2026-05-19 — Hero defs for the inspect panel short-circuit at the
// top of showTowerMenu. Renderer reads tier titles, XP thresholds,
// ability list, and biography off this single source of truth.
import HERO_DEFS_FOR_INSPECT from '../data/herodefs.json';
import comboData from '../data/towerCombinations.json';
import { canEquipItemFamily, canEquipItemOnDamageType, itemEquipMode, itemFamily } from '../systems/ItemRules';
import { markScrollable } from './ScrollCues';
import { enhanceModalErgonomics } from './ModalErgonomics';
import { scanCombos, resolveComboChoice } from '../systems/CombinationEngine';
import { tex } from './Assets';
import { closeGameModals } from './ModalManager';
import { itemIconSvg } from './ItemIcon';
import { comboPreviewBlockHtml } from './ComboPreview';
import { heroIdForTowerType } from '../systems/HeroIdentity';
import { heroTierForTower, heroXpForTower } from '../systems/HeroScaling';
import { towerDamageProfile, renderTowerDamageProfileHtml } from './TowerDamageProfile';

const RAR: Record<string, string> = { COMMON:'#cccccc', UNCOMMON:'#5cd05c', RARE:'#5ca0ff', EPIC:'#a060ff', LEGENDARY:'#ff9933', UNIQUE:'#ffd34d' };
const TOWER_INSPECT_PANEL_MAX_HEIGHT_PX = 1152;

export interface TowerMenuHooks {
  onClose: () => void;
  onPathRefresh: () => void;
  onKeep?: (towerId: string) => void;
  onUndoPlacement?: (towerId: string) => void;
  // Pending-prospect undo: returns the prospect's card to the queue and clears the tile
  // so the player can place it elsewhere.
  onUndoProspect?: (towerId: string) => void;
  // Combination execution from inside the tower menu.
  onCombine?: (recipeIndex: number, isSameTierMerge: boolean, resultTileTowerId: string) => void;
}

function enhanceTowerInspectModal(modal: HTMLElement, panel: HTMLElement, title: string, onClose: () => void): void {
  const existingBody = panel.querySelector<HTMLElement>('.rtd-tower-menu-scroll-body');
  const body = existingBody ?? document.createElement('div');
  if (!existingBody) {
    body.className = 'rtd-tower-menu-scroll-body rtd-tower-menu-collapse';
    body.style.cssText = [
      'overflow-y:auto',
      'overflow-x:hidden',
      'min-height:0',
      'flex:1',
      'scrollbar-gutter:stable',
      '-webkit-overflow-scrolling:touch',
      'overscroll-behavior:contain'
    ].join(';');
    const detailChildren = Array.from(panel.children).slice(2);
    for (const child of detailChildren) body.appendChild(child);
    panel.appendChild(body);
  }
  panel.style.display = 'flex';
  panel.style.flexDirection = 'column';
  panel.style.maxHeight = 'calc(100vh - 8px)';
  panel.style.height = `min(${TOWER_INSPECT_PANEL_MAX_HEIGHT_PX}px, calc(100vh - 8px))`;
  panel.style.overflow = 'hidden';
  enhanceModalErgonomics(modal, panel, {
    bodySelector: '.rtd-tower-menu-collapse',
    title,
    closeOnEscape: true,
    onClose
  });
  // Tower banners already reserve horizontal room for all three tools. Keep
  // the controls in that banner instead of spending a separate 54px row on
  // empty chrome, which exposes more of the actionable footer at once.
  panel.style.setProperty('--rtd-modal-tools-reserve-top', '0px');
}

function targetingModeLabel(mode: TargetingMode): string {
  return mode === TargetingMode.CLOSE ? 'CLOSEST' : TargetingMode[mode];
}

function towerModalStyle(): string {
  return `position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;background:rgba(0,0,0,0.58);z-index:55;padding:8px;box-sizing:border-box;overflow:auto;font-family:'Courier New',monospace;`;
}

function towerPanelStyle(accent: string, shadow = '24px'): string {
  return `position:relative;background:linear-gradient(180deg,#241a12 0%,#17110c 46%,#0b0907 100%);border:3px solid ${accent};color:#e8d6a8;width:min(680px,96vw);box-shadow:0 0 ${shadow} ${accent}44,0 18px 42px rgba(0,0,0,0.72);opacity:1;overflow:hidden;`;
}

function tierColorHex(tier: number): string {
  const c = TIER_COLORS[tier] ?? 0xffffff;
  return '#' + c.toString(16).padStart(6, '0');
}

// ─── Item tooltip helper ────────────────────────────────────────────────
// Singleton tooltip — exactly one DOM node, reused across every hovered
// item. Avoids the bug where multiple tooltips piled up after fast hover
// because per-element closure tips weren't getting cleaned up on rapid
// mouse paths or when the underlying modal redrew mid-hover.
let __tooltipEl: HTMLElement | null = null;
function ensureTooltip(): HTMLElement {
  if (__tooltipEl && __tooltipEl.isConnected) return __tooltipEl;
  __tooltipEl = document.createElement('div');
  __tooltipEl.id = 'item-tooltip';
  __tooltipEl.style.cssText = `position:fixed;z-index:9999;pointer-events:none;display:none;background:linear-gradient(180deg,#1a1410,#0c0a08);color:#fff8e0;padding:10px 12px;width:240px;font-family:'Courier New',monospace;font-size:11px;line-height:1.5;box-shadow:0 0 18px rgba(0,0,0,0.7);`;
  document.body.appendChild(__tooltipEl);
  return __tooltipEl;
}
function hideTooltip() {
  if (__tooltipEl) __tooltipEl.style.display = 'none';
}
// Hide tooltip on any global click / scroll / window blur — these all
// indicate the player has moved past hovering, but mouseleave on the
// element may not fire (e.g. when the modal closes underneath the cursor).
if (typeof window !== 'undefined' && !(window as any).__itemTooltipBound) {
  window.addEventListener('click', hideTooltip, true);
  window.addEventListener('scroll', hideTooltip, true);
  window.addEventListener('blur', hideTooltip);
  (window as any).__itemTooltipBound = true;
}
function attachItemTooltip(el: HTMLElement, itemId: string, rarity: string, def: any, equippedSlot: boolean) {
  el.addEventListener('mouseenter', (ev) => {
    const tip = ensureTooltip();
    const rarColor = RAR[rarity] ?? '#cccccc';
    tip.style.border = `2px solid ${rarColor}`;
    tip.style.boxShadow = `0 0 18px rgba(0,0,0,0.7),0 0 12px ${rarColor}66`;
    const family = itemFamily(itemId);
    const action = equippedSlot ? '<div style="margin-top:8px;font-size:10px;color:#88ff88;letter-spacing:1px">CLICK TO UNEQUIP</div>' : '';
    tip.innerHTML = `
      <div style="font-size:13px;font-weight:bold;letter-spacing:1px;color:${rarColor}">${def?.name ?? itemId.replace(/_/g,' ')}</div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:#aa9a4a;margin-top:2px">
        <span>${family}</span><span>${rarity}</span>
      </div>
      <div style="margin-top:8px;color:#cdb98a;font-size:11px;line-height:1.5">${def?.effect ?? '(no effect description)'}</div>
      ${def?.rarity ? `<div style="margin-top:6px;font-size:10px;color:#f0c040">Base cost: ${itemBuyPrice(itemId)}g</div>` : ''}
      ${action}`;
    tip.style.display = 'block';
    positionTooltip(tip, ev as MouseEvent);
  });
  el.addEventListener('mousemove', (ev) => {
    if (__tooltipEl && __tooltipEl.style.display === 'block') positionTooltip(__tooltipEl, ev as MouseEvent);
  });
  el.addEventListener('mouseleave', hideTooltip);
}
function positionTooltip(tip: HTMLElement, ev: MouseEvent) {
  const margin = 14;
  const w = tip.offsetWidth || 240;
  const h = tip.offsetHeight || 100;
  let x = ev.clientX + margin;
  let y = ev.clientY + margin;
  if (x + w > window.innerWidth - 8) x = ev.clientX - w - margin;
  if (y + h > window.innerHeight - 8) y = ev.clientY - h - margin;
  tip.style.left = `${Math.max(4, x)}px`;
  tip.style.top = `${Math.max(4, y)}px`;
}
function spriteSrc(towerType: string): string | null {
  const t = tex(towerType);
  if (!t) return null;
  // Pixi v7 ImageResource exposes the URL on either `src` or `url` depending
  // on the build/loader. Some textures (e.g. lazy-bound combo results) expose
  // neither directly — fall through to the manifest-derived path stashed
  // when the texture was registered.
  const res: any = t.baseTexture?.resource;
  return res?.src ?? res?.url ?? (t as any).__srcPath ?? null;
}

export function showTowerMenu(parent: HTMLElement, t: Tower, state: GameStateShape, inv: InventoryState, hooks: TowerMenuHooks) {
  closeGameModals();
  // 2026-06-24 — Hero inspect panel short-circuit. Starter heroes and
  // Mercator-purchased champions share the same hero layout: no regular
  // sell/combine/downgrade controls, HERO_ITEM_SLOTS item slots, and the
  // full ability/passive readout players need before gearing them.
  if (t.isHero) {
    showHeroInspectPanel(parent, t, state, inv, hooks);
    return;
  }
  // Refresh in place — used after equip / unequip so the menu reflects the
  // new state without the player having to reopen the tower. Re-renders
  // with the same tower + inventory references so equipped slots, the
  // family-disable highlight, and the stat breakdown all stay current.
  const refresh = () => { document.getElementById('tower-menu')?.remove(); showTowerMenu(parent, t, state, inv, hooks); };
  const def: any = (towersData as any)[t.type] ?? {};
  const antiAirOnly = !!def.antiAirOnly;
  if (antiAirOnly && t.targetingMode !== TargetingMode.FLYERS) {
    t.targetingMode = TargetingMode.FLYERS;
  }
  const effective = towerEffectiveStats(t);
  const projectile = getTowerProjectileProfile(t.type);
  const stats = {
    dpsBase: effective.dps,
    speed: effective.attackSpeed,
    range: effective.range,
    damagePerHit: towerPerAttackDamageBase(t),
    slots: towerItemSlotCap(t),
    refund: Math.max(1, Math.floor((t.costPaid ?? ECONOMY.TIER_PLACE_COST[t.qualityTier] ?? 0) / 2))
  };
  const killBonusPct = ((t.killBonusFlat / Math.max(1, t.baseDps)) * 100).toFixed(1);
  const tierColor = tierColorHex(t.qualityTier);
  const portrait = spriteSrc(t.type);
  const closeMenu = () => { hideTooltip(); hooks.onClose(); };

  const modal = document.createElement('div');
  modal.id = 'tower-menu';
  // 2026-05-19 — RESPONSIVE CLAMPING (matches Codex pattern). The MODAL
  // is the scroll container with `align-items:flex-start` so the title
  // banner is always reachable at the top regardless of viewport
  // height. When the panel is taller than the viewport (lots of
  // recipes + items), the user scrolls the whole panel inside the
  // modal — every button + recipe row stays reachable.
  modal.style.cssText = towerModalStyle();

  const panel = document.createElement('div');
  // No max-height on the panel itself — the modal's overflow:auto above
  // handles the scrolling. Width is fixed at 560px but caps at 96vw on
  // narrow viewports.
  panel.style.cssText = towerPanelStyle(tierColor);

  // Top banner: pending vs permanent
  const banner = document.createElement('div');
  if (t.pending) {
    banner.style.cssText = 'background:linear-gradient(90deg,#5a3a1a,#d4af37,#5a3a1a);color:#1a1410;padding:8px 128px 8px 10px;min-height:42px;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:12px;font-weight:bold;letter-spacing:2px;font-size:12px';
    banner.innerHTML = `<span>PENDING PROSPECT — KEEP OR REVEAL ANOTHER</span><span>TIER ${t.qualityTier}</span>`;
  } else {
    banner.style.cssText = `background:${tierColor};color:#1a1410;padding:6px 128px 6px 10px;min-height:42px;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;font-weight:bold;letter-spacing:2px;font-size:12px`;
    banner.innerHTML = `<span>${def.kind === 'COMBO' ? 'COMBINATION TOWER' : 'LEGION UNIT'}</span><span>TIER ${t.qualityTier}</span>`;
  }
  panel.appendChild(banner);

  // Hero header: portrait + name + role
  const head = document.createElement('div');
  head.style.cssText = 'display:grid;grid-template-columns:96px 1fr;gap:12px;padding:12px;border-bottom:1px solid #3a3025;background:#1a1410';
  const portFrame = document.createElement('div');
  portFrame.style.cssText = `width:96px;height:96px;border:2px solid ${tierColor};background:#0c0a08;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 8px ${tierColor}88`;
  if (portrait) {
    const img = document.createElement('img');
    img.src = portrait;
    img.style.cssText = 'width:88px;height:88px;image-rendering:pixelated';
    portFrame.appendChild(img);
  } else {
    portFrame.textContent = t.type;
  }
  head.appendChild(portFrame);

  const headInfo = document.createElement('div');
  headInfo.innerHTML = `
    <div style="font-size:18px;color:${tierColor};letter-spacing:3px;font-weight:bold">${def.name ?? t.type}</div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px">
      <span style="font-size:10px;color:#1a1410;background:${tierColor};padding:3px 7px;font-weight:bold;letter-spacing:1px">TIER ${t.qualityTier}</span>
      <span style="font-size:10px;color:#aa9a4a;letter-spacing:1px">${damageTypeLabel(def.damageType)} · ${def.melee ? 'Melee' : 'Ranged'} · ${pretty(def.kind ?? 'BASE')}</span>
    </div>
    <div style="font-size:11px;color:#cdb98a;margin-top:6px;font-style:italic">${def.ability ?? ''}</div>
  `;
  head.appendChild(headInfo);
  panel.appendChild(head);

  // Stats grid
  const statsGrid = document.createElement('div');
  statsGrid.className = 'rtd-tower-stats-grid';
  statsGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1px;background:#3a3025;border-top:1px solid #3a3025;border-bottom:1px solid #3a3025';
  const statBox = (label: string, value: string, color = '#e8d6a8') =>
    `<div style="background:#1a1410;padding:8px 10px;font-size:11px"><div style="color:#aa9a4a;letter-spacing:1px;text-transform:uppercase;font-size:9px">${label}</div><div style="color:${color};font-size:14px;font-weight:bold;margin-top:2px">${value}</div></div>`;

  // ── Breakdown-aware stat boxes ──────────────────────────────────────
  // For DAMAGE/HIT, ATK SPEED, and RANGE, show the base value, then list
  // every active modifier (tier roll, items, auras, pool level) inline
  // with its contribution. Player can see exactly why their tower is
  // hitting harder than the raw def number.
  const breakdown = towerStatBreakdown(t, state);
  const damageProfile = towerDamageProfile(t, state, breakdown);
  const finalDpsValue = breakdown.damageFinal * (breakdown.speedFinal / Math.max(0.05, breakdown.speedBase));
  const finalPerHit = finalDpsValue / Math.max(0.05, breakdown.speedFinal);
  const basePerHit = breakdown.damageBase / Math.max(0.05, breakdown.speedBase);
  // Format a list of modifiers as compact "+X% src, +Y% src" lines.
  const fmtMods = (mods: StatModifier[]): string => {
    if (mods.length === 0) return '';
    const parts = mods.map(m => {
      if (m.flat !== undefined) return `<span style="color:#88ff88">+${m.flat}</span> <span style="color:#aa9a4a;font-size:9px">${m.source}</span>`;
      const pct = ((m.multiplier ?? 1) - 1) * 100;
      const sign = pct >= 0 ? '+' : '';
      // 2026-05 v10 — negative modifiers (like the v10 class-balance
      // scalars: −8% ranged combo, −10% T5 base, −12% apex) render in
      // RED instead of green so a nerf reads as a nerf, not a bonus.
      const color = pct >= 0 ? '#88ff88' : '#ff7777';
      return `<span style="color:${color}">${sign}${pct.toFixed(0)}%</span> <span style="color:#aa9a4a;font-size:9px">${m.source}</span>`;
    });
    return `<div style="margin-top:4px;font-size:10px;line-height:1.5">${parts.join(' · ')}</div>`;
  };
  const dmgFinalDisplay = (mods: StatModifier[]) => mods.length === 0
    ? `<div style="color:#ee9966;font-size:14px;font-weight:bold;margin-top:2px">${basePerHit.toFixed(1)}</div>`
    : `<div style="display:flex;align-items:baseline;gap:6px;margin-top:2px;flex-wrap:wrap">
        <span style="color:#aa9a4a;font-size:11px;text-decoration:line-through">${basePerHit.toFixed(1)}</span>
        <span style="color:#88ff88;font-size:11px">→</span>
        <span style="color:#ee9966;font-size:14px;font-weight:bold">${finalPerHit.toFixed(1)}</span>
      </div>${fmtMods(mods)}`;
  const spdFinalDisplay = (mods: StatModifier[]) => mods.length === 0
    ? `<div style="color:#e8d6a8;font-size:14px;font-weight:bold;margin-top:2px">${breakdown.speedBase.toFixed(2)} /s</div>`
    : `<div style="display:flex;align-items:baseline;gap:6px;margin-top:2px;flex-wrap:wrap">
        <span style="color:#aa9a4a;font-size:11px;text-decoration:line-through">${breakdown.speedBase.toFixed(2)}/s</span>
        <span style="color:#88ff88;font-size:11px">→</span>
        <span style="color:#e8d6a8;font-size:14px;font-weight:bold">${breakdown.speedFinal.toFixed(2)} /s</span>
      </div>${fmtMods(mods)}`;
  const rngFinalDisplay = (mods: StatModifier[]) => mods.length === 0
    ? `<div style="color:#e8d6a8;font-size:14px;font-weight:bold;margin-top:2px">${breakdown.rangeBase} tiles</div>`
    : `<div style="display:flex;align-items:baseline;gap:6px;margin-top:2px;flex-wrap:wrap">
        <span style="color:#aa9a4a;font-size:11px;text-decoration:line-through">${breakdown.rangeBase}</span>
        <span style="color:#88ff88;font-size:11px">→</span>
        <span style="color:#e8d6a8;font-size:14px;font-weight:bold">${breakdown.rangeFinal} tiles</span>
      </div>${fmtMods(mods)}`;
  const dmgBoxClean = `<div style="background:#1a1410;padding:8px 10px;font-size:11px;grid-column:span 2"><div style="color:#aa9a4a;letter-spacing:1px;text-transform:uppercase;font-size:9px">Damage / hit</div>${dmgFinalDisplay(breakdown.damageMods)}</div>`;
  const spdBox = `<div style="background:#1a1410;padding:8px 10px;font-size:11px"><div style="color:#aa9a4a;letter-spacing:1px;text-transform:uppercase;font-size:9px">Atk Speed</div>${spdFinalDisplay(breakdown.speedMods)}</div>`;
  const rngBox = `<div style="background:#1a1410;padding:8px 10px;font-size:11px"><div style="color:#aa9a4a;letter-spacing:1px;text-transform:uppercase;font-size:9px">Range</div>${rngFinalDisplay(breakdown.rangeMods)}</div>`;
  const dpsFinal = finalDpsValue.toFixed(1);
  const dpsBaseCalc = breakdown.damageBase.toFixed(1);
  const dpsHasBoost = breakdown.damageMods.length + breakdown.speedMods.length > 0;
  const dpsBox = `<div style="background:#1a1410;padding:8px 10px;font-size:11px"><div style="color:#aa9a4a;letter-spacing:1px;text-transform:uppercase;font-size:9px">Effective DPS</div>${
    dpsHasBoost
      ? `<div style="display:flex;align-items:baseline;gap:6px;margin-top:2px;flex-wrap:wrap">
          <span style="color:#aa9a4a;font-size:11px;text-decoration:line-through">${dpsBaseCalc}</span>
          <span style="color:#88ff88;font-size:11px">→</span>
          <span style="color:#ffbe7a;font-size:14px;font-weight:bold">${dpsFinal}</span>
        </div>`
      : `<div style="color:#ffbe7a;font-size:14px;font-weight:bold;margin-top:2px">${dpsFinal}</div>`
  }</div>`;
  // CRIT row (2026-05 v11): show crit chance × crit multiplier so the
  // player understands the burst potential of each tower. Towers with
  // critChance=0 have other crit mechanics (e.g., Scorpio's every-5th-shot
  // auto-crit) — surface that as a footnote.
  const critChance = (def.critChance ?? 0) as number;
  const critMult   = (def.critMult ?? 1.5) as number;
  const critLabel  = critChance > 0
    ? `${Math.round(critChance * 100)}% · ${critMult.toFixed(2)}×`
    : (def.ability && /every \d+(th|nd|rd|st) hit|every \d+th/i.test(def.ability) ? 'special' : '—');
  const critColor  = critChance >= 0.18 ? '#ffd34d' : (critChance > 0 ? '#ffbe7a' : '#aa9a4a');
  statsGrid.innerHTML =
    statBox('Tier', `T${t.qualityTier}`, tierColor) +
    statBox('Splash', projectile ? (projectile.splash > 0 ? `${projectile.splash} tiles` : 'Single target') : 'Melee') +
    dmgBoxClean +
    dpsBox +
    spdBox +
    rngBox +
    statBox('Crit', critLabel, critColor) +
    statBox('Item slots', `${t.equippedItems.length} / ${stats.slots}`) +
    statBox('Targeting', targetingModeLabel(t.targetingMode), '#9be0ff') +
    statBox('Kill bonus', `${t.killCount} kills · +${killBonusPct}%`, '#d4af37');
  panel.appendChild(statsGrid);

  const damageProfilePanel = document.createElement('div');
  damageProfilePanel.style.cssText = 'padding:10px 12px;background:#0c0a08;border-bottom:1px solid #3a3025';
  damageProfilePanel.innerHTML = renderTowerDamageProfileHtml(damageProfile);
  panel.appendChild(damageProfilePanel);

  // ITEM IMPACT PANEL (2026-05): the stat boxes above show base→final
  // numbers but a 12% Sharpened Blade barely moves a T1 tower's DPS. This
  // panel makes the item contribution UNMISSABLE — large total-boost
  // badges plus a per-item effect line so the player can see exactly
  // what each piece of gear is doing. Includes conditional effects (vs
  // bosses / vs flyers / DoT-apply) that don't show in the static DPS.
  if (!t.pending && t.equippedItems.length > 0) {
    const itemImpact = document.createElement('div');
    itemImpact.style.cssText = 'padding:10px 12px;background:#0c0a08;border-top:1px solid #3a3025;border-bottom:1px solid #3a3025';
    // Sum item-source damage and speed contributions vs base.
    let itemDmgFactor = 1.0;
    const nonItemSource = /aura|Aura|Pool|Tier|Balance|Endless|Relic|Hero|Forge|Melee tempo|Marian Formation|stack/i;
    for (const m of breakdown.damageMods) {
      if (nonItemSource.test(m.source)) continue;
      itemDmgFactor *= (m.multiplier ?? 1);
    }
    let itemSpdFactor = 1.0;
    for (const m of breakdown.speedMods) {
      if (nonItemSource.test(m.source)) continue;
      itemSpdFactor *= (m.multiplier ?? 1);
    }
    let itemRngFlat = 0;
    for (const m of breakdown.rangeMods) {
      if (nonItemSource.test(m.source)) continue;
      itemRngFlat += (m.flat ?? 0);
    }
    const dmgPct  = (itemDmgFactor - 1) * 100;
    const spdPct  = (itemSpdFactor - 1) * 100;
    const dpsPct  = (itemDmgFactor * itemSpdFactor - 1) * 100;
    const summary = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-size:10px;color:#ffd34d;letter-spacing:2px;font-weight:bold">⚙ ITEM IMPACT</div>
        <div style="font-size:11px;color:${dpsPct > 0 ? '#88ff88' : '#aa9a4a'};font-weight:bold;letter-spacing:1px">
          ${dpsPct > 0 ? `+${dpsPct.toFixed(1)}% TOTAL DPS` : 'no static damage gain'}
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <div style="flex:1;background:#1a1410;padding:6px 8px;border-left:3px solid #ee9966">
          <div style="font-size:9px;color:#aa9a4a;letter-spacing:1px">DAMAGE</div>
          <div style="color:${dmgPct > 0 ? '#88ff88' : '#aa9a4a'};font-size:14px;font-weight:bold">${dmgPct > 0 ? '+' : ''}${dmgPct.toFixed(0)}%</div>
        </div>
        <div style="flex:1;background:#1a1410;padding:6px 8px;border-left:3px solid #e8d6a8">
          <div style="font-size:9px;color:#aa9a4a;letter-spacing:1px">ATK SPEED</div>
          <div style="color:${spdPct > 0 ? '#88ff88' : '#aa9a4a'};font-size:14px;font-weight:bold">${spdPct > 0 ? '+' : ''}${spdPct.toFixed(0)}%</div>
        </div>
        <div style="flex:1;background:#1a1410;padding:6px 8px;border-left:3px solid #9be0ff">
          <div style="font-size:9px;color:#aa9a4a;letter-spacing:1px">RANGE</div>
          <div style="color:${itemRngFlat > 0 ? '#88ff88' : '#aa9a4a'};font-size:14px;font-weight:bold">${itemRngFlat > 0 ? '+' : ''}${itemRngFlat} tiles</div>
        </div>
      </div>`;
    // Per-item effect lines. Pulls the human-readable `effect` field from
    // items_permanent.json so the player sees EXACTLY what each piece does,
    // including conditional ones the static DPS bar can't show.
    const lines = t.equippedItems.map((id, idx) => {
      const def: any = (permItems as any)[id] ?? {};
      // 2026-05-25 — prefer the per-instance rarity (set at equip time)
      // over the def's base rarity. A LEGENDARY-rolled item stays
      // orange in the items-info breakdown instead of falling back to
      // the def's base EPIC purple.
      const rarity = t.equippedItemRarities?.[idx] ?? def.rarity ?? 'COMMON';
      const col = RAR[rarity] ?? '#cdb98a';
      const name = def.name ?? id.replace(/_/g, ' ');
      const eff = def.effect ?? '';
      return `<div style="display:flex;align-items:center;gap:8px;padding:5px 6px;background:#100c09;border-left:2px solid ${col};margin-bottom:3px">
        <div style="width:24px;height:24px;flex-shrink:0">${itemIconSvg(id, rarity, 22)}</div>
        <div style="flex:1;font-size:10px;line-height:1.35">
          <div style="color:${col};font-weight:bold;letter-spacing:0.5px">${name}</div>
          <div style="color:#cdb98a;font-size:10px">${eff}</div>
        </div>
      </div>`;
    }).join('');
    itemImpact.innerHTML = summary + lines;
    panel.appendChild(itemImpact);
  }

  // Veteran service record (Player Fantasy §4)
  if (!t.pending) {
    const wavesOfService = Math.max(0, state.wave - t.placedAtWave + 1);
    const vetBox = document.createElement('div');
    vetBox.style.cssText = 'background:#0c0a08;border-top:1px solid #3a3025;border-bottom:1px solid #3a3025;padding:10px 12px';
    const mvpStars = '★'.repeat(Math.min(5, t.mvpAwards)) + (t.mvpAwards > 5 ? `+${t.mvpAwards - 5}` : '');
    vetBox.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div style="font-size:10px;color:#aa9a4a;letter-spacing:1px;text-transform:uppercase">SERVICE RECORD</div>
        ${t.mvpAwards > 0 ? `<div style="color:#ffd34d;font-size:10px">${mvpStars} (${t.mvpAwards} MVP wave${t.mvpAwards > 1 ? 's' : ''})</div>` : ''}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:11px">
        <div><div style="color:#aa9a4a;font-size:9px;letter-spacing:1px">LIFETIME KILLS</div><div style="color:#d4af37;font-size:13px;font-weight:bold">${t.killCount}</div></div>
        <div><div style="color:#aa9a4a;font-size:9px;letter-spacing:1px">BOSS DAMAGE</div><div style="color:#ff8866;font-size:13px;font-weight:bold">${Math.round(t.bossDamageDealt).toLocaleString()}</div></div>
        <div><div style="color:#aa9a4a;font-size:9px;letter-spacing:1px">TOTAL DAMAGE</div><div style="color:#ee9966;font-size:13px;font-weight:bold">${Math.round(t.totalDamageDealt).toLocaleString()}</div></div>
        <div><div style="color:#aa9a4a;font-size:9px;letter-spacing:1px">KILLS / WAVE</div><div style="color:#9be0ff;font-size:13px;font-weight:bold">${t.killsThisWave}</div></div>
        <div><div style="color:#aa9a4a;font-size:9px;letter-spacing:1px">DMG / WAVE</div><div style="color:#9be0ff;font-size:13px;font-weight:bold">${Math.round(t.damageThisWave).toLocaleString()}</div></div>
        <div><div style="color:#aa9a4a;font-size:9px;letter-spacing:1px">SERVICE</div><div style="color:#cdb98a;font-size:13px;font-weight:bold">${wavesOfService} wave${wavesOfService === 1 ? '' : 's'}</div></div>
      </div>`;
    panel.appendChild(vetBox);
  }

  // Targeting buttons
  const targetRow = document.createElement('div');
  targetRow.style.cssText = 'display:flex;gap:4px;padding:10px;border-bottom:1px solid #3a3025;flex-wrap:wrap';
  targetRow.innerHTML = `<div style="font-size:10px;color:#aa9a4a;width:100%;letter-spacing:1px;margin-bottom:4px">TARGETING</div>${antiAirOnly ? '<div style="font-size:10px;color:#66ccff;width:100%;margin:-2px 0 4px">Flyer-only tower. Ground targets are ignored.</div>' : ''}`;
  // 2026-05-19 — WEAKEST sits near STRONG (natural HP pair), FAST
  // at the end. CASTERS sits after STRONG because it is a priority-threat
  // mode like boss/commander targeting.
  const targetingModes = antiAirOnly
    ? [TargetingMode.FLYERS]
    : [TargetingMode.FIRST, TargetingMode.LAST, TargetingMode.STRONG, TargetingMode.CASTERS, TargetingMode.WEAKEST, TargetingMode.CLOSE, TargetingMode.FLYERS, TargetingMode.FAST];
  for (const mode of targetingModes) {
    const b = document.createElement('button');
    b.textContent = targetingModeLabel(mode);
    const isActive = t.targetingMode === mode;
    b.style.cssText = `background:${isActive ? '#3a5520' : '#2a2018'};color:${isActive ? '#d4af37' : '#e8d6a8'};border:1px solid #5a4a30;padding:4px 8px;cursor:pointer;font-family:inherit;font-size:10px;letter-spacing:1px`;
    // 2026-05 v7: stay in the menu after a targeting change so the
    // player can verify the new active highlight + toggle modes without
    // re-opening. Same pattern used by item swap / undo buttons above.
    b.onclick = () => { t.targetingMode = mode; refresh(); };
    targetRow.appendChild(b);
  }
  panel.appendChild(targetRow);

  // Equipped items — square slots to match the Armarium inventory feel.
  // Pending prospects show a single LOCKED notice in place of the equip block.
  if (t.pending) {
    const lockEq = document.createElement('div');
    lockEq.style.cssText = 'padding:10px;border-bottom:1px solid #3a3025;background:#0c0a08;color:#aa9a4a;font-size:11px;line-height:1.5';
    lockEq.innerHTML = '<b style="color:#d4af37">ITEMS LOCKED</b><br>This is still a prospect. Items can only be equipped after you KEEP this tower.';
    panel.appendChild(lockEq);
  }
  // The equipped/equip-from-inventory blocks below are skipped for pending towers
  // by the `if (!t.pending)` guards just inside each block.
  const eqRow = document.createElement('div');
  eqRow.style.cssText = 'padding:10px;border-bottom:1px solid #3a3025';
  if (t.pending) eqRow.style.display = 'none';
  eqRow.innerHTML = `<div style="font-size:10px;color:#aa9a4a;letter-spacing:1px;margin-bottom:4px">EQUIPPED (${t.equippedItems.length}/${stats.slots})</div>`;
  const eqGrid = document.createElement('div');
  eqGrid.style.cssText = `display:grid;grid-template-columns:repeat(${stats.slots},64px);gap:6px;padding:8px;background:#0c0a08;border:2px solid #5a4a30;box-shadow:inset 0 0 14px #000;overflow-x:auto`;
  for (let i = 0; i < stats.slots; i++) {
    const itemId = t.equippedItems[i];
    const idef: any = itemId ? ((permItems as any)[itemId] ?? (consumables as any)[itemId]) : null;
    // 2026-05-25 — use the per-instance rarity (parallel array set at
    // equip time) so the equipped tile keeps its actual rarity color.
    // Falls back to def rarity for any older in-memory state created
    // before equippedItemRarities existed.
    const rarity = (itemId ? (t.equippedItemRarities?.[i] ?? idef?.rarity ?? 'COMMON') : 'COMMON');
    const color = itemId ? RAR[rarity] : '#3a3025';
    const slot = document.createElement('div');
    slot.style.cssText = `width:64px;height:64px;border:2px solid ${color};background:linear-gradient(180deg,#1a1410,#100c09);display:flex;align-items:center;justify-content:center;text-align:center;line-height:1.05;color:${color};box-shadow:inset 0 0 10px #000;cursor:${itemId ? 'pointer' : 'default'};`;
    if (itemId) {
      slot.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:1px">${itemIconSvg(itemId, rarity, 38)}<div style="font-size:7px;color:#aa9a4a;letter-spacing:1px">${itemFamily(itemId)}</div></div>`;
      attachItemTooltip(slot, itemId, rarity, idef, true);
      slot.onclick = () => {
        if (isGiantsBaneTransformedTowerType(t.type) && itemId === GIANTS_BANE_ITEM_ID) {
          state.hint = "This awakened giant tower is bound to Giant's Bane. Sell the tower if you want the relic back.";
          return;
        }
        if (isWitchsBrewTransformedTowerType(t.type) && itemId === WITCHS_BREW_ITEM_ID) {
          state.hint = "The Undead Gladiator King is bound to Witch's Brew. Sell the tower if you want the relic back.";
          return;
        }
        if (inv.slots.length >= INVENTORY_SIZE) { state.hint = 'Inventory full. Sell something first to unequip.'; return; }
        const idx = t.equippedItems.indexOf(itemId);
        if (idx >= 0) {
          t.equippedItems.splice(idx, 1);
          // Keep the parallel rarity array in lockstep with equippedItems.
          if (t.equippedItemRarities) t.equippedItemRarities.splice(idx, 1);
        }
        // Return to inventory at the rarity it was actually equipped at
        // — not the def's base rarity. Fixes orange-LEGENDARY → purple-
        // EPIC demotion on the equip/unequip cycle.
        inventoryAdd(inv, itemId, rarity as Rarity, false);
        state.hint = `Unequipped ${idef?.name ?? itemId} → inventory.`;
        refresh();        // stay in the menu so the player can keep swapping
      };
    } else {
      slot.innerHTML = '<div style="font-size:9px;color:#5a4a30;letter-spacing:1px">EMPTY</div>';
    }
    eqGrid.appendChild(slot);
  }
  eqRow.appendChild(eqGrid);
  panel.appendChild(eqRow);

  // Inventory equip list — only meaningful for kept towers.
  if (t.pending) {
    // No-op: we already showed a single LOCKED notice above. Avoid duplicate.
  } else if (t.equippedItems.length < stats.slots && inv.slots.length > 0) {
    const equipRow = document.createElement('div');
    equipRow.style.cssText = 'padding:10px;border-bottom:1px solid #3a3025';
    equipRow.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
        <div style="font-size:10px;color:#aa9a4a;letter-spacing:1px">EQUIP FROM INVENTORY</div>
        <div style="font-size:9px;color:#cc6666;letter-spacing:0.5px">⚠ ONE PER FAMILY · NO DUPLICATES</div>
      </div>
      <div style="font-size:10px;color:#cdb98a;margin-bottom:6px;line-height:1.4">
        Each tower can equip only <b style="color:#fff8e0">one item per family</b> (DAMAGE / SPEED / RANGE / AURA / ECONOMY / DEFENSE / SPECIAL). SPECIAL trophies and proc items are powerful, so a tower can carry only one of them. The same exact item can't be doubled either. Items already disallowed show a red tag. <b style="color:#88ff88">Click an equipped item</b> to send it back to your inventory.
      </div>`;
    const invGrid = document.createElement('div');
    invGrid.style.cssText = `display:grid;grid-template-columns:repeat(5,54px);gap:5px;padding:8px;background:#0c0a08;border:2px solid #5a4a30;box-shadow:inset 0 0 14px #000;`;
    // Visually grey out + tag inventory items that CAN'T be equipped on this
    // tower right now (already equipped, family conflict, or no slot left).
    // The player sees the conflict before clicking, not after.
    for (const slot of inv.slots) {
      const idef: any = (permItems as any)[slot.itemId] ?? (consumables as any)[slot.itemId];
      const cell = document.createElement('div');
      // Compute the blocker reason (if any) up-front for the visual state.
      let blocker: string | null = null;
      let blockerShort = '';
      if (t.equippedItems.includes(slot.itemId)) {
        blocker = 'Already equipped on this tower'; blockerShort = 'OWNED';
      } else if (slot.itemId === GIANTS_BANE_ITEM_ID && !canTransformWithGiantsBane(t)) {
        blocker = "Giant's Bane only fits Tier IV or Tier V Milites or Cohort Guard.";
        blockerShort = 'T4+ ONLY';
      } else if (slot.itemId === WITCHS_BREW_ITEM_ID && !canTransformWithWitchsBrew(t)) {
        blocker = "Witch's Brew only fits a Tier IV or Tier V Murmillo.";
        blockerShort = 'MURMILLO';
      } else {
        // EQUIP MODE GATE — runs before the family check so a Sagittarius
        // looking at a Barbed Gladius sees "MELEE ONLY" first, not the
        // less-helpful "family conflict" if both happened to apply.
        const modeCheck = canEquipItemOnDamageType(slot.itemId, t.damageType, t.type);
        if (!modeCheck.ok) {
          blocker = modeCheck.reason ?? 'Wrong attack class for this item.';
          blockerShort = modeCheck.mode === 'MELEE' ? 'MELEE ONLY' : 'RANGED ONLY';
        } else {
          const familyCheck = canEquipItemFamily(t.equippedItems, slot.itemId);
          if (!familyCheck.ok) {
            blocker = `Only one ${familyCheck.family.toLowerCase()} item per tower — unequip the existing one first`;
            blockerShort = familyCheck.family;
          } else if (t.equippedItems.length >= stats.slots) {
            blocker = `Tower has only ${stats.slots} item slot${stats.slots === 1 ? '' : 's'} — unequip one first`;
            blockerShort = 'FULL';
          }
        }
      }
      const dim = blocker ? 'opacity:0.4;' : '';
      const cursor = blocker ? 'not-allowed' : 'pointer';
      cell.style.cssText = `position:relative;width:54px;height:54px;border:2px solid ${RAR[slot.rarity]};background:linear-gradient(180deg,#1a1410,#100c09);display:flex;align-items:center;justify-content:center;text-align:center;line-height:1.05;color:${RAR[slot.rarity]};box-shadow:inset 0 0 10px #000;cursor:${cursor};${dim}`;
      const blockerTag = blocker ? `<div style="position:absolute;top:-5px;right:-5px;background:#7a1a1a;color:#fff;font-size:7px;font-weight:bold;letter-spacing:1px;padding:1px 4px;border:1px solid #000">${blockerShort}</div>` : '';
      cell.innerHTML = `${blockerTag}<div style="display:flex;flex-direction:column;align-items:center;gap:1px">${itemIconSvg(slot.itemId, slot.rarity, 32)}<div style="font-size:6px;color:#aa9a4a;letter-spacing:1px">${itemFamily(slot.itemId)}</div></div>`;
      attachItemTooltip(cell, slot.itemId, slot.rarity, idef, false);
      cell.onclick = (ev) => {
        if (blocker) {
          // 2026-05 v10: pop the floating "CAN'T EQUIP" toast anchored to
          // the clicked cell. The HUD hint also stays (state.hint) as a
          // fallback for screen readers / players watching the hint bar,
          // but the toast is the primary feedback channel — far easier
          // to notice than a one-line hint that gets overwritten.
          const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
          const stageRect = document.getElementById('stage-wrap')?.getBoundingClientRect();
          const ax = stageRect ? r.left + r.width / 2 - stageRect.left : undefined;
          const ay = stageRect ? r.top - stageRect.top : undefined;
          (window as any).__showEquipBlockedToast?.(blocker, ax, ay);
          state.hint = blocker + '.';
          return;
        }
        t.equippedItems.push(slot.itemId);
        // Stash the per-instance rarity alongside so unequip can put it
        // back at the SAME rarity it dropped/was-bought at — instead of
        // demoting it to the def's base rarity.
        if (!t.equippedItemRarities) t.equippedItemRarities = [];
        t.equippedItemRarities.push(slot.rarity);
        inventoryRemove(inv, slot.id);
        const transformed = slot.itemId === GIANTS_BANE_ITEM_ID && transformWithGiantsBane(t);
        const brewTransformed = slot.itemId === WITCHS_BREW_ITEM_ID && transformWithWitchsBrew(t);
        state.hint = transformed
          ? `Giant's Bane awakens. ${def.name ?? 'Tower'} has become ${(towersData as any)[t.type]?.name ?? t.type}.`
          : brewTransformed
          ? `Witch's Brew boils over. ${def.name ?? 'Tower'} has become ${(towersData as any)[t.type]?.name ?? t.type}.`
          : `Equipped ${idef?.name ?? slot.itemId}.`;
        refresh();
      };
      invGrid.appendChild(cell);
    }
    equipRow.appendChild(invGrid);
    panel.appendChild(equipRow);
  }

  // 2026-05 v11 PROSPECT GUIDANCE: when the player opens a still-pending
  // prospect's menu, surface a clear message explaining why combine isn't
  // available on this card. Pending prospects can fill in as ingredients
  // for combos centered on KEPT towers, but a pending tower cannot itself
  // BE the landing tile for a combo. Without this card the player just
  // sees the menu missing the COMBINATIONS READY block with no reason.
  if (t.pending && hooks.onCombine) {
    // Check whether ANY combo exists that USES this prospect as an ingredient,
    // so we can give actionable hint ("KEEP this to unlock X combos").
    const usable = scanCombos(state).filter(cb => !!resolveComboChoice(state, cb, t.id));
    const row = document.createElement('div');
    row.style.cssText = 'padding:10px 12px;border-bottom:1px solid #3a3025;background:#2a1d0a';
    const recipeBlurb = usable.length > 0
      ? `<div style="color:#ffd34d;font-size:11px;margin-top:4px">✓ This prospect already fits <b>${usable.length}</b> recipe${usable.length === 1 ? '' : 's'}. KEEP it (or any other ingredient in the recipe) to unlock the combine.</div>`
      : `<div style="color:#cdb98a;font-size:11px;margin-top:4px">No active recipe needs this prospect yet — KEEP towers that finish recipes first.</div>`;
    row.innerHTML = `
      <div style="font-size:11px;color:#ff9933;letter-spacing:1.5px;font-weight:bold">⚠ PROSPECT — NOT YET COMBINABLE</div>
      <div style="font-size:11px;color:#cdb98a;line-height:1.45;margin-top:5px">
        Combinations land on KEPT towers only. Press <b style="color:#88ff88">★ KEEP THIS TOWER</b> below to save this prospect first — then open its menu again (or click any other kept ingredient) and the <b style="color:#ffd34d">COMBINATIONS READY</b> panel will appear.
      </div>
      ${recipeBlurb}
    `;
    panel.appendChild(row);
  }
  // ACTIVE COMBINATIONS — recipes that are currently completable and include this
  // tower as an ingredient. Clicking one executes the combo with this tower's tile
  // as the result location; the other ingredient tiles convert to wall stones.
  if (!t.pending && hooks.onCombine) {
    const combos = scanCombos(state).filter(cb => !!resolveComboChoice(state, cb, t.id));
    if (combos.length > 0) {
      const row = document.createElement('div');
      row.style.cssText = 'padding:10px;border-bottom:1px solid #3a3025;background:#1a1208';
      row.innerHTML = `<div style="font-size:10px;color:#ffd34d;letter-spacing:1px;margin-bottom:6px">⚔ COMBINATIONS READY (LANDS HERE)</div>`;
      for (const cb of combos) {
        const resolved = resolveComboChoice(state, cb, t.id) ?? cb;
        const resultDef: any = (towersData as any)[resolved.result];
        const tierColor = tierColorHex(resolved.resultTier);
        const card = document.createElement('div');
        const canAfford = state.gold >= resolved.cost;
        card.style.cssText = `padding:8px 10px;background:#0c0a08;margin-bottom:4px;border:2px solid ${tierColor};display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:${canAfford ? 'pointer' : 'not-allowed'};${canAfford ? '' : 'opacity:0.45;'}`;
        // Each ingredient gets BOTH a color tag and an explicit role tag so
        // the player can instantly tell which slot is which:
        //   • THIS PROSPECT (the tower the menu is open for — yellow underline)
        //   • YOUR TOWER     (already-kept tower elsewhere on the field — green)
        //   • PENDING        (another pending prospect still on the field — orange)
        // The yellow underline marks the tower in your hand so you don't
        // confuse "this is what I'm placing" with "this is what I've got."
        const ingredientsList = resolved.ingredients.map(ing => {
          const idef: any = (towersData as any)[ing.type];
          const live = state.towers.get(ing.id);
          const isPending = !!live?.pending;
          const isThis = ing.id === t.id;
          let color: string;
          let role: string;
          if (isThis) {
            color = '#ffd34d'; role = 'THIS TILE';
          } else if (isPending) {
            color = '#ff9933'; role = 'PENDING — KEEP IT';
          } else {
            color = '#88ff88'; role = 'YOUR TOWER';
          }
          const underline = isThis ? 'border-bottom:2px solid #ffd34d;' : '';
          return `<span style="color:${color};${underline}font-weight:600">${idef?.name ?? ing.type} T${ing.qualityTier}<span style="font-size:8.5px;letter-spacing:1px;margin-left:4px;opacity:0.85">(${role})</span></span>`;
        }).join(' <span style="color:#cdb98a">+</span> ');
        const headLabel = resolved.isSameTierMerge ? `MERGE → ${resultDef?.name ?? resolved.result} T${resolved.resultTier}` : `${resultDef?.name ?? resolved.result} T${resolved.resultTier}`;
        // Legend line under the combo header — makes the role tags
        // self-explanatory without forcing the player to remember.
        const legendHtml = `<div style="font-size:8.5px;color:#7a7060;letter-spacing:1px;margin-top:3px">
          <span style="color:#ffd34d">■ this result tile</span> ·
          <span style="color:#88ff88">■ already-kept tower</span> ·
          <span style="color:#ff9933">■ pending prospect (must KEEP)</span>
        </div>`;
        card.innerHTML = `
          <div style="flex:1;min-width:0">
            <div style="color:${tierColor};font-weight:bold;font-size:13px;letter-spacing:1px">${headLabel}</div>
            <div style="font-size:10px;color:#cdb98a;margin-top:3px;line-height:1.45">${ingredientsList}</div>
            ${legendHtml}
          </div>
          <div style="text-align:right">
            <div style="color:#f0c040;font-size:12px;font-weight:bold">${resolved.cost}g</div>
            ${canAfford ? '<div style="color:#66cc55;font-size:10px;letter-spacing:1px">▶ COMBINE</div>' : `<div style="color:#cc6666;font-size:9px">NEED ${resolved.cost - state.gold}g</div>`}
          </div>`;
        card.onmouseenter = () => { if (canAfford) card.style.background = '#1d1714'; };
        card.onmouseleave = () => { card.style.background = '#0c0a08'; };
        card.onclick = (ev) => {
          if (!canAfford) {
            const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
            const stageRect = document.getElementById('stage-wrap')?.getBoundingClientRect();
            const ax = stageRect ? r.left + r.width / 2 - stageRect.left : undefined;
            const ay = stageRect ? r.top - stageRect.top : undefined;
            (window as any).__showInsufficientGoldToast?.(resolved.cost, ax, ay);
            return;
          }
          hooks.onCombine!(cb.recipeIndex, !!cb.isSameTierMerge, t.id);
          hooks.onClose();
        };
        row.appendChild(card);
      }
      panel.appendChild(row);
    }
  }

  // Recipes this tower could be part of — surfaces ALL recipes that involve this type
  // (not just currently-eligible). Highlights the ones the player has all ingredients for.
  // 2026-05-19 — Match against EVERY tower, kept or pending. The old filter
  // excluded other pending prospects, which caused the confusing case where
  // two glowing prospects (eligible for the same combo) were each shown the
  // recipe with ONLY THEMSELVES counted — the partner prospect appeared as
  // missing (gray "0/1") even though it was sitting right next to them on
  // the board. The greedy match below still prefers KEPT towers first via
  // matchOrder, so the green-vs-orange honesty rule (green = all kept,
  // orange = ≥1 pending) survives. Other pending prospects now correctly
  // count toward the slot, lighting up "READY IF KEPT" the way the player
  // expects when two prospects can be combined together.
  const allTowers = Array.from(state.towers.values());
  const matchingRecipes = comboData.filter(rcp => rcp.ingredients.some(ing => ing.type === t.type));
  if (matchingRecipes.length > 0) {
    const rcpRow = document.createElement('div');
    rcpRow.style.cssText = 'padding:10px;border-bottom:1px solid #3a3025';
    rcpRow.innerHTML = `<div style="font-size:10px;color:#aa9a4a;letter-spacing:1px;margin-bottom:6px">${t.pending ? 'IF KEPT: ' : ''}RECIPES USING ${def.name?.toUpperCase() ?? t.type}</div>`;
    for (const rcp of matchingRecipes) {
      // Per-ingredient have/need (Tower Doc §20 recipe progress tracker)
      const used = new Set<string>();
      // Aggregate same-type ingredients into "X / N" lines + track how many
      // matches were KEPT vs PENDING so colors mean what the player expects:
      // green = truly ready, orange = "ready if you keep that prospect."
      const ingredientGroups: Record<string, { needed: number; have: number; pendingMatches: number; minTier: number }> = {};
      for (const ing of rcp.ingredients) {
        const key = `${ing.type}|${ing.minTier}`;
        ingredientGroups[key] ??= { needed: 0, have: 0, pendingMatches: 0, minTier: ing.minTier };
        ingredientGroups[key].needed += 1;
      }
      // Greedy match — prefer KEPT (non-pending) towers first, so a pending
      // tower only counts toward the slot if no kept option exists. That
      // makes the green/orange split honest: green slots really are kept.
      const matchOrder = allTowers.slice().sort((a, b) => (a.pending ? 1 : 0) - (b.pending ? 1 : 0));
      for (const ing of rcp.ingredients) {
        const found = matchOrder.find(tt => !used.has(tt.id) && tt.type === ing.type && tt.qualityTier >= ing.minTier);
        if (found) {
          used.add(found.id);
          const key = `${ing.type}|${ing.minTier}`;
          ingredientGroups[key].have += 1;
          if (found.pending) ingredientGroups[key].pendingMatches += 1;
        }
      }
      const haveAll = Object.values(ingredientGroups).every(g => g.have >= g.needed);
      const hasAnyPendingMatch = Object.values(ingredientGroups).some(g => g.pendingMatches > 0);
      const progressLines = Object.entries(ingredientGroups).map(([key, prog]) => {
        const [type] = key.split('|');
        const complete = prog.have >= prog.needed;
        // Color the X/N tag based on the WORST match in that slot:
        //   complete + all kept    → green
        //   complete + ≥1 pending  → orange
        //   incomplete             → muted yellow
        const countColor = !complete ? '#aa9a4a' : (prog.pendingMatches > 0 ? '#ff9933' : '#66cc55');
        const typeColor  = !complete ? '#888'    : (prog.pendingMatches > 0 ? '#ffc080' : '#cdb98a');
        // Show the human-readable name from towers.json instead of the raw
        // type id (which is upper-snake-case with underscores).
        const typeName = (towersData as any)[type]?.name ?? type.replace(/_/g, ' ');
        return `<span style="color:${countColor};font-weight:bold">${prog.have}/${prog.needed}</span> <span style="color:${typeColor}">${typeName} T${prog.minTier}+</span>`;
      }).join(' · ');

      // Border + status tag colors align with the green/orange rule:
      //   haveAll AND no pending matches → green (truly READY)
      //   haveAll BUT relies on pendings  → orange (READY IF KEPT)
      //   not all slots filled → muted (just show cost; the X/N progress is
      //   already visible inline). The "HELPS" tag was redundant + confusing.
      const fullyKeptReady = haveAll && !hasAnyPendingMatch;
      const conditionallyReady = haveAll && hasAnyPendingMatch;
      const borderColor = fullyKeptReady ? '#66cc55'
                       : conditionallyReady ? '#ff9933'
                       : '#3a3025';
      const headerColor = fullyKeptReady ? '#88ff88'
                       : conditionallyReady ? '#ffc080'
                       : '#aaa';
      const card = document.createElement('div');
      card.style.cssText = `background:#0c0a08;margin-bottom:3px;border-left:3px solid ${borderColor};opacity:${haveAll ? 1 : 0.85}`;
      // 2026-05-23 — Each recipe row now has a collapsible drop-down with
      // the combo tower's stats + ability text. User flagged that the
      // bare recipe lines didn't tell them WHAT the combo did, forcing a
      // Codex jump. Click the chevron (▶ / ▼) to expand the preview body
      // underneath. Each row is independent — opening one doesn't close
      // the others.
      card.innerHTML = `
        <div class="rcp-summary" style="padding:6px 8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:6px">
          <div style="flex:1;min-width:0">
            <div style="color:${headerColor};font-weight:bold;font-size:12px">→ ${(towersData as any)[rcp.result]?.name ?? String(rcp.result).replace(/_/g,' ')} <span style="opacity:0.7">T${rcp.tier}</span></div>
            <div style="font-size:10px;margin-top:2px">${progressLines}</div>
          </div>
          <div style="text-align:right">
            ${fullyKeptReady
              ? `<span style="color:#66cc55;font-weight:bold;font-size:10px;letter-spacing:1px">READY</span><div style="font-size:10px;color:#aa9a4a">${rcp.cost}g</div>`
              : conditionallyReady
                ? `<span style="color:#ff9933;font-weight:bold;font-size:10px;letter-spacing:1px">READY IF KEPT</span><div style="font-size:10px;color:#aa9a4a">${rcp.cost}g</div>`
              : `<span style="font-size:10px;color:#666">Cost ${rcp.cost}g</span>`}
          </div>
          <div class="rcp-chev" title="Show / hide combo details" style="font-size:14px;color:${headerColor};padding:2px 6px;border:1px solid ${headerColor};line-height:1;align-self:center;user-select:none">▶</div>
        </div>
        <div class="rcp-details" style="display:none;border-top:1px dashed #3a3025">${comboPreviewBlockHtml(String(rcp.result))}</div>`;
      // Wire the toggle. Clicking the summary row (or the chevron) flips
      // the details body open/closed and updates the chevron glyph.
      const summary = card.querySelector('.rcp-summary') as HTMLElement | null;
      const details = card.querySelector('.rcp-details') as HTMLElement | null;
      const chev = card.querySelector('.rcp-chev') as HTMLElement | null;
      if (summary && details) {
        summary.onclick = () => {
          const isOpen = details.style.display === 'block';
          details.style.display = isOpen ? 'none' : 'block';
          if (chev) chev.textContent = isOpen ? '▶' : '▼';
        };
      }
      rcpRow.appendChild(card);
    }
    panel.appendChild(rcpRow);
  }

  // PENDING: KEEP remains the primary action, but recipe context above explains why.
  if (t.pending && hooks.onKeep) {
    const keepRow = document.createElement('div');
    keepRow.style.cssText = 'padding:14px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap';
    const keepBtn = mkBtn('★ KEEP THIS TOWER ★', '#3a7720');
    keepBtn.style.fontSize = '14px';
    keepBtn.style.padding = '10px 22px';
    keepBtn.onclick = () => { hooks.onKeep!(t.id); hooks.onClose(); };
    keepRow.appendChild(keepBtn);
    if (hooks.onUndoProspect) {
      const undoBtn = mkBtn('↶ PUT BACK', '#5a3a1a');
      undoBtn.title = 'Return this prospect to the queue so you can place it on a different tile.';
      undoBtn.onclick = () => { hooks.onUndoProspect!(t.id); hooks.onClose(); };
      keepRow.appendChild(undoBtn);
    }
    const cancel = mkBtn('CANCEL', '#444');
    cancel.onclick = () => closeMenu();
    keepRow.appendChild(cancel);
    panel.appendChild(keepRow);
    modal.appendChild(panel);
    // 2026-05-24 — Backdrop click dismiss (pending-prospect path too).
    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) closeMenu();
    });
    panel.addEventListener('click', (ev) => ev.stopPropagation());
    parent.appendChild(modal);
    enhanceTowerInspectModal(modal, panel, `${def.name ?? t.type} prospect menu`, closeMenu);
    return;
  }

  // Action footer
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;padding:12px;background:linear-gradient(180deg,#1a1410,#0c0a08)';
  const downgradeBtn = mkBtn(canDowngrade(t) ? `DOWNGRADE (2g)` : 'DOWNGRADED', '#5a3a1a');
  if (!canDowngrade(t)) downgradeBtn.disabled = true;
  downgradeBtn.onclick = () => {
    if (!confirm(`Downgrade ${t.type} from T${t.qualityTier} to T${t.qualityTier - 1}?\nThis destroys ${t.killCount} kills and +${t.killBonusFlat.toFixed(1)} flat bonus permanently.\nCosts 2 Gold.`)) return;
    const ok = downgradeTower(state, t, (id) => {
      const idef: any = (permItems as any)[id] ?? (consumables as any)[id];
      inventoryAdd(inv, id, idef?.rarity ?? 'COMMON', false);
    });
    if (ok) state.hint = `Downgraded to T${t.qualityTier}.`;
    closeMenu();
  };
  actions.appendChild(downgradeBtn);
  if (hooks.onUndoPlacement) {
    const undoPlaceBtn = mkBtn('UNDO PLACEMENT', '#4a4a1a');
    undoPlaceBtn.onclick = () => hooks.onUndoPlacement?.(t.id);
    actions.appendChild(undoPlaceBtn);
  }
  const sellBtn = mkBtn(`SELL (+${stats.refund}g)`, '#7a1a1a');
  sellBtn.onclick = () => {
    const warn = t.killCount >= 50 ? `\nThis tower has ${t.killCount} kills (+${t.killBonusFlat.toFixed(1)} flat dmg). Selling permanently destroys all battle experience.\n` : '';
    if (!confirm(`Sell ${def.name ?? t.type} T${t.qualityTier} for ${stats.refund}g?${warn}`)) return;
    if (t.isAerarium) state.goldTowerCount = Math.max(0, state.goldTowerCount - 1);
    // 2026-05-25 — restore equipped items to inventory at their actual
    // per-instance rarity (not the def's base rarity), so a LEGENDARY
    // drop that was equipped to a sold tower returns to inventory as
    // LEGENDARY, not the def's base EPIC.
    for (let i = 0; i < t.equippedItems.length; i++) {
      const itemId = t.equippedItems[i];
      const idef: any = (permItems as any)[itemId] ?? (consumables as any)[itemId];
      const rarity = (t.equippedItemRarities?.[i] ?? idef?.rarity ?? 'COMMON') as Rarity;
      inventoryAdd(inv, itemId, rarity, false);
    }
    earnGold(state, stats.refund);
    state.towers.delete(t.id);
    setTile(state, t.tileX, t.tileY, TileType.EMPTY);
    state.hint = `Sold for ${stats.refund}g.`;
    hooks.onPathRefresh();
    closeMenu();
  };
  actions.appendChild(sellBtn);
  const close = mkBtn('CLOSE', '#444');
  close.onclick = () => closeMenu();
  actions.appendChild(close);
  panel.appendChild(actions);

  modal.appendChild(panel);
  // 2026-05-24 — Backdrop click closes the menu. Per UI audit the tower
  // menu was the most-opened modal in the game and was missing the
  // standard backdrop-dismiss affordance every other modal has. Click
  // outside the panel → close; clicks INSIDE the panel stop here so
  // they don't bubble up to the backdrop.
  modal.addEventListener('click', (ev) => {
    if (ev.target === modal) closeMenu();
  });
  panel.addEventListener('click', (ev) => ev.stopPropagation());
  parent.appendChild(modal);
  enhanceTowerInspectModal(modal, panel, `${def.name ?? t.type} tower menu`, closeMenu);
  // Gold scrollbar + "▼ SCROLL FOR MORE" hint on the MODAL (the scroll
  // container after the 2026-05-19 responsive-clamping refactor). Long
  // tower menus with lots of recipes overflow the viewport and the
  // user needs a clear cue that they can scroll.
  markScrollable(modal);
}

function mkBtn(label: string, bg: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = `background:${bg};color:#e8d6a8;border:1px solid #5a4a30;padding:7px 14px;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:1px`;
  return b;
}

function itemInitials(name: string): string {
  return name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────
// HERO INSPECT PANEL (2026-05-19, updated 2026-05-21)
// Dedicated layout shown when the player clicks the hero tile or the
// HUD hero chip. Mirrors the tower-menu CSS pattern (responsive
// clamping, fixed-width panel) but with hero-specific content blocks:
// portrait + tier + XP bar + kill bonus, HERO_ITEM_SLOTS item
// slots, 2 ability cards (locked badge if heroTier < ability.level),
// equip-from-inventory grid, no sell/combine/downgrade.
// ─────────────────────────────────────────────────────────────────────
function showHeroInspectPanel(parent: HTMLElement, t: Tower, state: GameStateShape, inv: InventoryState, hooks: TowerMenuHooks): void {
  // 2026-05-19 (rebuild) — Hero panel now mirrors the regular tower
  // menu's chrome and layout. Same banner shape, same 96px portrait
  // frame, same stats grid with breakdowns (DAMAGE/HIT · ATK SPEED ·
  // RANGE · EFFECTIVE DPS), same item-slot row, same close-row
  // footer. Hero-specific elements (XP bar, tier titles, tier-locked
  // ability cards, kill bonus) layer on top so the panel reads as
  // an enriched tower menu rather than a separate UI altogether.
  const heroId = heroIdForTowerType(String(t.type)) ?? String(t.type);
  const heroDef: any = (HERO_DEFS_FOR_INSPECT as any)[heroId] ?? {};
  const towerDef: any = (towersData as any)[t.type] ?? {};
  const tint = heroDef.visual?.tierUpColor ?? '#ffd34d';
  const tier = heroTierForTower(state, t);
  const xp = heroXpForTower(state, t);
  const thresholds: number[] = heroDef.xpThresholds ?? [0, 75, 280, 650, 1300];
  const tierTitles: string[] = heroDef.tierTitles ?? ['TIRO','LEGATUS','CONSUL','IMPERATOR','DIVUS'];
  const curTh = thresholds[tier] ?? 0;
  const nextTh = thresholds[Math.min(thresholds.length - 1, tier + 1)] ?? thresholds[thresholds.length - 1];
  const pctXp = tier >= 4 ? 100 : Math.max(0, Math.min(100, ((xp - curTh) / Math.max(1, nextTh - curTh)) * 100));
  const closeMenu = () => { hideTooltip(); hooks.onClose(); };

  // Stats — pull the breakdown helper (same one the regular tower
  // menu uses). Heroes gain a natural rank bonus from their definition,
  // which is folded into the displayed "Damage / hit".
  const effective = towerEffectiveStats(t);
  const breakdown = towerStatBreakdown(t, state);
  const tierScales: number[] = heroDef.basicAtkScalePerTier ?? [1, 1.2, 1.5, 1.9, 2.4];
  const tierScale = tierScales[tier] ?? 1;
  if (tierScale !== 1) {
    breakdown.damageMods.push({ source: `${tierTitles[tier]} rank bonus`, multiplier: tierScale });
    breakdown.damageFinal *= tierScale;
  }

  const refresh = () => { document.getElementById('tower-menu')?.remove(); showHeroInspectPanel(parent, t, state, inv, hooks); };

  const modal = document.createElement('div');
  modal.id = 'tower-menu';
  modal.style.cssText = towerModalStyle();
  const panel = document.createElement('div');
  panel.style.cssText = towerPanelStyle(tint, '30px');

  // ── Top banner (mirrors tower menu — "TIER N" on the right) ───────
  const banner = document.createElement('div');
  banner.style.cssText = `background:${tint};color:#1a1410;padding:6px 128px 6px 10px;min-height:42px;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;font-weight:bold;letter-spacing:2px;font-size:12px`;
  banner.innerHTML = `<span>⚔ HERO · ${tierTitles[tier]}</span><span>TIER ${tier + 1}/5</span>`;
  panel.appendChild(banner);

  // ── Header: 96px sprite portrait + name + tag chips (matches the
  // regular tower menu's `head` layout). The sprite comes from the
  // same Pixi-cached `spriteSrc(t.type)` lookup the tower menu uses,
  // so the same Higgs-Field hero PNG that renders on the map shows
  // up in the inspect panel — no separate asset wiring.
  const head = document.createElement('div');
  head.style.cssText = 'display:grid;grid-template-columns:96px 1fr;gap:12px;padding:12px;border-bottom:1px solid #3a3025;background:#1a1410';
  const portFrame = document.createElement('div');
  portFrame.style.cssText = `width:96px;height:96px;border:2px solid ${tint};background:#0c0a08;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 8px ${tint}88;overflow:hidden`;
  const portraitUrl = spriteSrc(t.type);
  if (portraitUrl) {
    const img = document.createElement('img');
    img.src = portraitUrl;
    img.style.cssText = 'width:88px;height:88px;image-rendering:pixelated;image-rendering:crisp-edges';
    portFrame.appendChild(img);
  } else {
    portFrame.innerHTML = `<div style="font-size:42px;color:${tint};text-shadow:0 0 8px ${tint}">⚔</div>`;
  }
  head.appendChild(portFrame);

  const headInfo = document.createElement('div');
  // Damage-type label resolved from the tower def (e.g. SIEGE,
  // PHYS_MELEE) — mirrors what the regular tower menu shows. Uses
  // the same damageTypeLabel helper.
  const dmgLabel = damageTypeLabel(towerDef.damageType);
  headInfo.innerHTML = `
    <div style="font-size:18px;color:${tint};letter-spacing:3px;font-weight:bold;text-shadow:0 0 8px ${tint}88">${(heroDef.name ?? t.type).toUpperCase()}</div>
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px">
      <span style="font-size:10px;color:#1a1410;background:${tint};padding:3px 7px;font-weight:bold;letter-spacing:1px">${tierTitles[tier]}</span>
      <span style="font-size:10px;color:#aa9a4a;letter-spacing:1px">${dmgLabel} · ${heroDef.specialty ?? 'HERO'}</span>
    </div>
    <div style="font-size:11px;color:#cdb98a;margin-top:6px;font-style:italic">${heroDef.title ?? ''}</div>
  `;
  head.appendChild(headInfo);
  panel.appendChild(head);

  // ── XP bar (hero-specific). Lives right under the header like the
  // tower menu's tier banner — visually positioned the same way so
  // the panel reads as "tower with leveling on top" rather than
  // "different UI."
  const xpRow = document.createElement('div');
  xpRow.style.cssText = 'padding:10px 14px;background:#12100d;border-bottom:1px solid #3a3025';
  xpRow.innerHTML = `
    <div style="display:flex;justify-content:space-between;font-size:10px;color:#aa9a4a;letter-spacing:1px;margin-bottom:4px">
      <span>XP → ${tierTitles[Math.min(4, tier + 1)] ?? 'MAX'}</span>
      <span>${tier >= 4 ? 'MAXED' : `${xp} / ${nextTh}`}</span>
    </div>
    <div style="background:#0c0a08;border:1px solid #5a4a30;height:10px;overflow:hidden">
      <div style="width:${pctXp}%;height:100%;background:linear-gradient(90deg,${tint},${tint}aa);transition:width 0.3s"></div>
    </div>`;
  panel.appendChild(xpRow);

  // ── Stats grid (mirrors the tower menu's breakdown-aware grid).
  // Same boxes, same format, same breakdown listing. Heroes get an
  // extra row for KILLS + KILL BONUS that the tower menu doesn't
  // surface (the regular menu shows kill count under the breakdown
  // section, but heroes have a kill-bonus stack that's worth
  // highlighting up front).
  const statsGrid = document.createElement('div');
  statsGrid.className = 'rtd-tower-stats-grid';
  statsGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1px;background:#3a3025;border-top:1px solid #3a3025;border-bottom:1px solid #3a3025';
  const damageProfile = towerDamageProfile(t, state, breakdown);
  const finalDpsValue = breakdown.damageFinal * (breakdown.speedFinal / Math.max(0.05, breakdown.speedBase));
  const finalPerHit = finalDpsValue / Math.max(0.05, breakdown.speedFinal);
  const basePerHit = breakdown.damageBase / Math.max(0.05, breakdown.speedBase);
  const fmtMods = (mods: StatModifier[]): string => {
    if (mods.length === 0) return '';
    const parts = mods.map(m => {
      if (m.flat !== undefined) return `<span style="color:#88ff88">+${m.flat}</span> <span style="color:#aa9a4a;font-size:9px">${m.source}</span>`;
      const pct = ((m.multiplier ?? 1) - 1) * 100;
      const sign = pct >= 0 ? '+' : '';
      const color = pct >= 0 ? '#88ff88' : '#ff7777';
      return `<span style="color:${color}">${sign}${pct.toFixed(0)}%</span> <span style="color:#aa9a4a;font-size:9px">${m.source}</span>`;
    });
    return `<div style="margin-top:4px;font-size:10px;line-height:1.5">${parts.join(' · ')}</div>`;
  };
  const dmgBox = `<div style="background:#1a1410;padding:8px 10px;font-size:11px;grid-column:span 2"><div style="color:#aa9a4a;letter-spacing:1px;text-transform:uppercase;font-size:9px">Damage / hit</div>${
    breakdown.damageMods.length === 0
      ? `<div style="color:#ee9966;font-size:14px;font-weight:bold;margin-top:2px">${basePerHit.toFixed(1)}</div>`
      : `<div style="display:flex;align-items:baseline;gap:6px;margin-top:2px;flex-wrap:wrap">
          <span style="color:#aa9a4a;font-size:11px;text-decoration:line-through">${basePerHit.toFixed(1)}</span>
          <span style="color:#88ff88;font-size:11px">→</span>
          <span style="color:#ee9966;font-size:14px;font-weight:bold">${finalPerHit.toFixed(1)}</span>
        </div>${fmtMods(breakdown.damageMods)}`
  }</div>`;
  const spdBox = `<div style="background:#1a1410;padding:8px 10px;font-size:11px"><div style="color:#aa9a4a;letter-spacing:1px;text-transform:uppercase;font-size:9px">Atk Speed</div>${
    breakdown.speedMods.length === 0
      ? `<div style="color:#e8d6a8;font-size:14px;font-weight:bold;margin-top:2px">${breakdown.speedBase.toFixed(2)} /s</div>`
      : `<div style="display:flex;align-items:baseline;gap:6px;margin-top:2px;flex-wrap:wrap">
          <span style="color:#aa9a4a;font-size:11px;text-decoration:line-through">${breakdown.speedBase.toFixed(2)}/s</span>
          <span style="color:#88ff88;font-size:11px">→</span>
          <span style="color:#e8d6a8;font-size:14px;font-weight:bold">${breakdown.speedFinal.toFixed(2)} /s</span>
        </div>${fmtMods(breakdown.speedMods)}`
  }</div>`;
  const rngBox = `<div style="background:#1a1410;padding:8px 10px;font-size:11px"><div style="color:#aa9a4a;letter-spacing:1px;text-transform:uppercase;font-size:9px">Range</div>${
    breakdown.rangeMods.length === 0
      ? `<div style="color:#e8d6a8;font-size:14px;font-weight:bold;margin-top:2px">${breakdown.rangeBase} tiles</div>`
      : `<div style="display:flex;align-items:baseline;gap:6px;margin-top:2px;flex-wrap:wrap">
          <span style="color:#aa9a4a;font-size:11px;text-decoration:line-through">${breakdown.rangeBase}</span>
          <span style="color:#88ff88;font-size:11px">→</span>
          <span style="color:#e8d6a8;font-size:14px;font-weight:bold">${breakdown.rangeFinal} tiles</span>
        </div>${fmtMods(breakdown.rangeMods)}`
  }</div>`;
  const dpsFinal = finalDpsValue.toFixed(1);
  const dpsBaseCalc = breakdown.damageBase.toFixed(1);
  const dpsHasBoost = breakdown.damageMods.length + breakdown.speedMods.length > 0;
  const dpsBox = `<div style="background:#1a1410;padding:8px 10px;font-size:11px"><div style="color:#aa9a4a;letter-spacing:1px;text-transform:uppercase;font-size:9px">Effective DPS</div>${
    dpsHasBoost
      ? `<div style="display:flex;align-items:baseline;gap:6px;margin-top:2px;flex-wrap:wrap">
          <span style="color:#aa9a4a;font-size:11px;text-decoration:line-through">${dpsBaseCalc}</span>
          <span style="color:#88ff88;font-size:11px">→</span>
          <span style="color:#ffbe7a;font-size:14px;font-weight:bold">${dpsFinal}</span>
        </div>`
      : `<div style="color:#ffbe7a;font-size:14px;font-weight:bold;margin-top:2px">${dpsFinal}</div>`
  }</div>`;
  // Hero-specific row: kills + cumulative kill-bonus DPS stack. The
  // regular tower menu surfaces these too (further down), but heroes
  // earn kill-bonus DPS at custom rates set in herodefs.json so the
  // breakdown is worth keeping front-and-center.
  const killsBox = `<div style="background:#1a1410;padding:8px 10px;font-size:11px"><div style="color:#aa9a4a;letter-spacing:1px;text-transform:uppercase;font-size:9px">Kills</div><div style="color:#d4af37;font-size:14px;font-weight:bold;margin-top:2px">${t.killCount}</div></div>`;
  const kbBox    = `<div style="background:#1a1410;padding:8px 10px;font-size:11px"><div style="color:#aa9a4a;letter-spacing:1px;text-transform:uppercase;font-size:9px">Kill Bonus</div><div style="color:#9be0ff;font-size:14px;font-weight:bold;margin-top:2px">+${t.killBonusFlat.toFixed(1)} DPS</div></div>`;
  const targetBox = `<div style="background:#1a1410;padding:8px 10px;font-size:11px;grid-column:span 2"><div style="color:#aa9a4a;letter-spacing:1px;text-transform:uppercase;font-size:9px">Targeting</div><div style="color:#9be0ff;font-size:14px;font-weight:bold;margin-top:2px">${targetingModeLabel(t.targetingMode)}</div></div>`;
  statsGrid.innerHTML = dmgBox + spdBox + rngBox + dpsBox + killsBox + kbBox + targetBox;
  panel.appendChild(statsGrid);

  const damageProfilePanel = document.createElement('div');
  damageProfilePanel.style.cssText = 'padding:10px 14px;background:#0c0a08;border-bottom:1px solid #3a3025';
  damageProfilePanel.innerHTML = renderTowerDamageProfileHtml(damageProfile);
  panel.appendChild(damageProfilePanel);

  // Heroes use the same targeting engine as towers. Surface the per-hero
  // controls here so a purchased champion can be tuned without relying on
  // the bulk "target all" button.
  const targetRow = document.createElement('div');
  targetRow.style.cssText = 'display:flex;gap:4px;padding:10px 14px;border-bottom:1px solid #3a3025;flex-wrap:wrap';
  targetRow.innerHTML = '<div style="font-size:9px;color:#aa9a4a;width:100%;letter-spacing:2px;margin-bottom:4px">TARGETING</div>';
  for (const mode of [TargetingMode.FIRST, TargetingMode.LAST, TargetingMode.STRONG, TargetingMode.CASTERS, TargetingMode.WEAKEST, TargetingMode.CLOSE, TargetingMode.FLYERS, TargetingMode.FAST]) {
    const b = document.createElement('button');
    b.textContent = targetingModeLabel(mode);
    const isActive = t.targetingMode === mode;
    b.style.cssText = `background:${isActive ? '#3a5520' : '#2a2018'};color:${isActive ? '#d4af37' : '#e8d6a8'};border:1px solid #5a4a30;padding:4px 8px;cursor:pointer;font-family:inherit;font-size:10px;letter-spacing:1px`;
    b.onclick = () => { t.targetingMode = mode; refresh(); };
    targetRow.appendChild(b);
  }
  panel.appendChild(targetRow);

  // 2026-05-20 — "BUILT FOR" flavor block removed per design ask.
  // playerProblemSolved was a marketing/draft-pitch line — useful in
  // the cold-start ChooseHeroModal but pure clutter on the in-field
  // tower inspect. The hero's stats + passive + abilities below are
  // the only things the player actually needs to act on mid-run.

  // ── Passive (defensive lookup — handles DUAL-kind heroes like
  // Agricola whose top-level description is empty)
  const p: any = heroDef.passive;
  let passiveText: string = p?.description ?? '';
  if (!passiveText && p) {
    const bits: string[] = [];
    if (p.global?.description) bits.push(`Global: ${p.global.description}`);
    if (p.local?.description)  bits.push(`Local: ${p.local.description}`);
    passiveText = bits.join(' ');
  }
  const passive = document.createElement('div');
  passive.style.cssText = 'padding:10px 14px;border-bottom:1px solid #3a3025';
  passive.innerHTML = `<div style="font-size:9px;color:#aa9a4a;letter-spacing:2px;margin-bottom:4px">⚜ PASSIVE</div><div style="font-size:11px;color:#cdb98a;line-height:1.5">${passiveText}</div>`;
  panel.appendChild(passive);

  // Hero item grid. Loop bound, grid template, and the EQUIPPED counter
  // all read from HERO_ITEM_SLOTS so the slot count lives in one place.
  const eqRow = document.createElement('div');
  eqRow.style.cssText = 'padding:10px 14px;border-bottom:1px solid #3a3025';
  eqRow.innerHTML = `<div style="font-size:9px;color:#aa9a4a;letter-spacing:2px;margin-bottom:6px">⚒ EQUIPPED (${t.equippedItems.length}/${HERO_ITEM_SLOTS})</div>`;
  const eqGrid = document.createElement('div');
  eqGrid.style.cssText = `display:grid;grid-template-columns:repeat(${HERO_ITEM_SLOTS},52px);gap:6px;padding:6px;background:#0c0a08;border:2px solid ${tint};`;
  for (let i = 0; i < HERO_ITEM_SLOTS; i++) {
    const itemId = t.equippedItems[i];
    const idef: any = itemId ? ((permItems as any)[itemId] ?? (consumables as any)[itemId]) : null;
    // 2026-05-25 — use the per-instance rarity (parallel array set at
    // equip time). Without this, a LEGENDARY-rolled item equipped to
    // a hero showed up purple (def's base EPIC) instead of orange.
    const rarity = (itemId ? (t.equippedItemRarities?.[i] ?? idef?.rarity ?? 'COMMON') : 'COMMON');
    const color = itemId ? RAR[rarity] : '#3a3025';
    const slot = document.createElement('div');
    slot.style.cssText = `width:52px;height:52px;border:2px solid ${color};background:linear-gradient(180deg,#1a1410,#100c09);display:flex;align-items:center;justify-content:center;color:${color};cursor:${itemId ? 'pointer' : 'default'};font-size:8.5px;text-align:center;line-height:1.1`;
    if (itemId) {
      // 2026-05-25 — render the same sprite-with-rarity-frame the
      // inventory and the regular tower menu use, so an equipped item
      // stays visually consistent across all three places it appears.
      // Previously the hero panel showed name-only text and dropped
      // the artwork on equip, making the player feel they'd lost the
      // sprite — they hadn't, the panel was just rendering text-only.
      slot.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:1px">${itemIconSvg(itemId, rarity, 30)}<div style="font-size:6px;color:#aa9a4a;letter-spacing:1px">${itemFamily(itemId)}</div></div>`;
      attachItemTooltip(slot, itemId, rarity, idef, true);
      slot.onclick = () => {
        if (inv.slots.length >= INVENTORY_SIZE) { state.hint = 'Inventory full. Sell something first to unequip.'; return; }
        const idx = t.equippedItems.indexOf(itemId);
        if (idx >= 0) {
          t.equippedItems.splice(idx, 1);
          // Keep the parallel rarity array in lockstep with equippedItems.
          if (t.equippedItemRarities) t.equippedItemRarities.splice(idx, 1);
        }
        // Return to inventory at the actual rarity, not the def default.
        inventoryAdd(inv, itemId, rarity as Rarity, false);
        refresh();
      };
    } else {
      slot.textContent = 'EMPTY';
    }
    eqGrid.appendChild(slot);
  }
  eqRow.appendChild(eqGrid);
  panel.appendChild(eqRow);

  // Hero equip-from-inventory section. Mirrors the regular tower menu's
  // grid (family/mode gates, blocker chips, click-to-equip) with
  // HERO_ITEM_SLOTS as the slot cap.
  if (t.equippedItems.length < HERO_ITEM_SLOTS && inv.slots.length > 0) {
    const equipRow = document.createElement('div');
    equipRow.style.cssText = 'padding:10px 14px;border-bottom:1px solid #3a3025';
    equipRow.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
        <div style="font-size:9px;color:#aa9a4a;letter-spacing:2px">⚒ EQUIP FROM INVENTORY</div>
        <div style="font-size:9px;color:#cc6666;letter-spacing:0.5px">⚠ ONE PER FAMILY · NO DUPLICATES</div>
      </div>
      <div style="font-size:10px;color:#cdb98a;margin-bottom:6px;line-height:1.4">
        Heroes carry up to <b style="color:#fff8e0">${HERO_ITEM_SLOTS} items</b>. Same family + mode rules apply — one DAMAGE, one SPEED, one SPECIAL, etc., and MELEE / RANGED items respect the hero's attack class. Click an equipped item to send it back to your inventory.
      </div>`;
    const invGrid = document.createElement('div');
    invGrid.style.cssText = `display:grid;grid-template-columns:repeat(5,54px);gap:5px;padding:8px;background:#0c0a08;border:2px solid ${tint};box-shadow:inset 0 0 14px #000;`;
    for (const slot of inv.slots) {
      const idef: any = (permItems as any)[slot.itemId] ?? (consumables as any)[slot.itemId];
      const cell = document.createElement('div');
      let blocker: string | null = null;
      let blockerShort = '';
      if (t.equippedItems.includes(slot.itemId)) {
        blocker = 'Already equipped on this hero'; blockerShort = 'OWNED';
      } else if (slot.itemId === GIANTS_BANE_ITEM_ID) {
        blocker = "Giant's Bane only fits Tier IV or Tier V Milites or Cohort Guard.";
        blockerShort = 'T4+ ONLY';
      } else if (slot.itemId === WITCHS_BREW_ITEM_ID) {
        blocker = "Witch's Brew only fits a Tier IV or Tier V Murmillo.";
        blockerShort = 'MURMILLO';
      } else {
        const modeCheck = canEquipItemOnDamageType(slot.itemId, t.damageType, t.type);
        if (!modeCheck.ok) {
          blocker = modeCheck.reason ?? 'Wrong attack class for this item.';
          blockerShort = modeCheck.mode === 'MELEE' ? 'MELEE ONLY' : 'RANGED ONLY';
        } else {
          const familyCheck = canEquipItemFamily(t.equippedItems, slot.itemId);
          if (!familyCheck.ok) {
            blocker = `Only one ${familyCheck.family.toLowerCase()} item per hero — unequip the existing one first`;
            blockerShort = familyCheck.family;
          } else if (t.equippedItems.length >= HERO_ITEM_SLOTS) {
            blocker = `Hero has only ${HERO_ITEM_SLOTS} item slots — unequip one first`;
            blockerShort = 'FULL';
          }
        }
      }
      const dim = blocker ? 'opacity:0.4;' : '';
      const cursor = blocker ? 'not-allowed' : 'pointer';
      cell.style.cssText = `position:relative;width:54px;height:54px;border:2px solid ${RAR[slot.rarity]};background:linear-gradient(180deg,#1a1410,#100c09);display:flex;align-items:center;justify-content:center;text-align:center;line-height:1.05;color:${RAR[slot.rarity]};box-shadow:inset 0 0 10px #000;cursor:${cursor};${dim}`;
      const blockerTag = blocker ? `<div style="position:absolute;top:-5px;right:-5px;background:#7a1a1a;color:#fff;font-size:7px;font-weight:bold;letter-spacing:1px;padding:1px 4px;border:1px solid #000">${blockerShort}</div>` : '';
      cell.innerHTML = `${blockerTag}<div style="display:flex;flex-direction:column;align-items:center;gap:1px">${itemIconSvg(slot.itemId, slot.rarity, 32)}<div style="font-size:6px;color:#aa9a4a;letter-spacing:1px">${itemFamily(slot.itemId)}</div></div>`;
      attachItemTooltip(cell, slot.itemId, slot.rarity, idef, false);
      cell.onclick = (ev) => {
        if (blocker) {
          const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
          const stageRect = document.getElementById('stage-wrap')?.getBoundingClientRect();
          const ax = stageRect ? r.left + r.width / 2 - stageRect.left : undefined;
          const ay = stageRect ? r.top - stageRect.top : undefined;
          (window as any).__showEquipBlockedToast?.(blocker, ax, ay);
          state.hint = blocker + '.';
          return;
        }
        t.equippedItems.push(slot.itemId);
        // Stash the per-instance rarity in the parallel array so the
        // hero panel renders the actual rarity color (orange-LEGENDARY
        // stays orange, not the def's purple-EPIC default).
        if (!t.equippedItemRarities) t.equippedItemRarities = [];
        t.equippedItemRarities.push(slot.rarity);
        inventoryRemove(inv, slot.id);
        state.hint = `Equipped ${idef?.name ?? slot.itemId}.`;
        refresh();
      };
      invGrid.appendChild(cell);
    }
    equipRow.appendChild(invGrid);
    panel.appendChild(equipRow);
  }

  // Ability cards
  const abilityBlock = document.createElement('div');
  abilityBlock.style.cssText = 'padding:10px 14px;border-bottom:1px solid #3a3025';
  abilityBlock.innerHTML = '<div style="font-size:9px;color:#aa9a4a;letter-spacing:2px;margin-bottom:6px">⚔ ABILITIES</div>';
  for (const ability of (heroDef.abilities ?? [])) {
    const unlocked = tier >= ability.level;
    const cooldownStamp = (t.__heroCooldowns ?? {})[ability.id] ?? 0;
    const timeToNext = Math.max(0, cooldownStamp - state.tick);
    const cdText = unlocked && timeToNext > 0 ? `⏱ ${timeToNext.toFixed(1)}s` : `⏱ ${ability.cooldownSec}s`;
    const card = document.createElement('div');
    card.style.cssText = `margin-bottom:6px;padding:8px 10px;background:#100c09;border-left:3px solid ${unlocked ? tint : '#5a4a30'};opacity:${unlocked ? 1 : 0.55}`;
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px">
        <div style="font-size:12px;color:${unlocked ? tint : '#aa9a4a'};font-weight:bold;letter-spacing:1px">${unlocked ? '✓' : '🔒'} ${ability.name}</div>
        <div style="font-size:9px;color:#aa9a4a;letter-spacing:1px">${tierTitles[ability.level] ?? `T${ability.level}`} · ${cdText}</div>
      </div>
      <div style="font-size:10.5px;color:#cdb98a;line-height:1.5">${ability.description}</div>
    `;
    abilityBlock.appendChild(card);
  }
  panel.appendChild(abilityBlock);

  // 2026-05-20 — Biography block also removed per design ask. The
  // quote was atmospheric lore — fine for the Codex HEROES tab where
  // players go specifically for lore, but clutter in the mid-run
  // tower inspect. Codex HEROES tab still surfaces full biographies.

  // Close button only — no sell/move/downgrade for heroes. Mars Victor
  // fusion is surfaced by the global readiness prompt, not this panel.
  const closeRow = document.createElement('div');
  closeRow.style.cssText = 'padding:10px;display:flex;justify-content:center;background:linear-gradient(180deg,#1a1410,#0c0a08)';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'CLOSE';
  closeBtn.style.cssText = 'background:#444;color:#e8d6a8;border:1px solid #5a4a30;padding:8px 22px;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:2px';
  closeBtn.onclick = () => closeMenu();
  closeRow.appendChild(closeBtn);
  panel.appendChild(closeRow);

  modal.appendChild(panel);
  modal.addEventListener('click', (ev) => {
    if (ev.target === modal) closeMenu();
  });
  panel.addEventListener('click', (ev) => ev.stopPropagation());
  parent.appendChild(modal);
  enhanceTowerInspectModal(modal, panel, `${heroDef.name ?? t.type} hero menu`, closeMenu);
}
