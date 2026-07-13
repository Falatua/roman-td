import { ShopState, FORTUNA_APEX_BLOCKLIST, FORTUNA_GAMBLE_COST, FORTUNA_GAMBLE_POOL, rollFortunaCombo, getFortunaTierOdds } from '../systems/MerchantSystem';
import { TRAP_DEFS, TRAP_IDS, armTrapFromInventory, buyTraps, canDeployTraps, trapPrice } from '../systems/TrapSystem';
import { TRAP_PURCHASE_CAP_PER_TYPE, trapPurchasesRemaining, trapsPurchasedByType } from '../systems/TrapInventorySystem';
import { RAMPART_COST, RAMPART_MAX_PER_RUN, RAMPART_ORIENT_LABEL, armRampartFromInventory, buyRampart, rampartsOwned, rampartsRemainingThisRun } from '../systems/RampartSystem';
import { GameStateShape } from '../GameState';
import { INVENTORY_SIZE, ECONOMY } from '../constants';
import { SFX } from './AudioManager';
import { spendGold } from '../systems/EconomySystem';
import { InventoryState, inventoryAdd, isConsumable, itemBuyPrice } from '../systems/LootSystem';
import items from '../data/items_permanent.json';
import consumables from '../data/items_consumable.json';
import towersData from '../data/towers.json';
import heroDefs from '../data/herodefs.json';
import { closeGameModals } from './ModalManager';
import { itemIconSvg } from './ItemIcon';
import { tex } from './Assets';
import { purchaseCompletesRecipe } from '../systems/CombinationEngine';
import { itemFamily } from '../systems/ItemRules';
import { markScrollable } from './ScrollCues';
import { enhanceModalErgonomics } from './ModalErgonomics';
import { HERO_FORGE_CAP, heroForgeNextCost } from '../systems/HeroSystem';
import { heroIdForTowerType, isMercatorChampionType } from '../systems/HeroIdentity';
import { towerBriefHtml } from './TowerCopy';
import { recordMercatorBackRoomPurchase } from '../systems/SecretEventsSystem';
import { towerName } from '../format';

// Inject the recipe-ready pulse keyframes once. Mirrors the green glow used on
// pending prospects whose `id` lands in scanCombos's ingredient set, so the
// Mercator shop carries the same visual language.
function ensureRecipeBlinkStyle() {
  if (document.getElementById('recipe-blink-style')) return;
  const st = document.createElement('style');
  st.id = 'recipe-blink-style';
  st.textContent = `
    @keyframes recipeReadyPulse {
      0%,100% { box-shadow: 0 0 6px 1px #66ff88, inset 0 0 6px #66ff88aa; border-color:#66ff88; }
      50%     { box-shadow: 0 0 18px 4px #aaffbb, inset 0 0 12px #bbffcccc; border-color:#bbffcc; }
    }
    @keyframes recipeReadyBadgePulse {
      0%,100% { opacity:1; transform: scale(1); }
      50%     { opacity:0.7; transform: scale(1.06); }
    }
    .recipe-ready-card { animation: recipeReadyPulse 0.85s ease-in-out infinite; }
    .recipe-ready-badge { animation: recipeReadyBadgePulse 0.85s ease-in-out infinite; }
  `;
  document.head.appendChild(st);
}

function imgSrcFromTex(key: string): string | null {
  // 2026 v2 Ch8 — Champions of Rome reuse the hero portraits in the shop.
  if (key.startsWith('CHAMPION_')) key = 'HERO_' + key.slice('CHAMPION_'.length);
  const t = tex(key);
  if (!t) return null;
  const res: any = t.baseTexture?.resource;
  return res?.src ?? res?.url ?? (t as any).__srcPath ?? null;
}

const recipeOnlyComboNames = () => Array.from(FORTUNA_APEX_BLOCKLIST)
  .filter(id => !id.startsWith('CHAMPION_'))
  .map(id => ((towersData as any)[id]?.name ?? id.replace(/_/g, ' ')))
  .join(', ');

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function championHeroDetailsHtml(type: string, towerDef: any, tint: string): string {
  const heroId = heroIdForTowerType(type);
  const heroDef: any = heroId ? (heroDefs as any)[heroId] : null;
  if (!heroDef) return '';
  const abilities: any[] = heroDef.abilities ?? [];
  const tierTitles: string[] = heroDef.tierTitles ?? [];
  const scales: number[] = heroDef.basicAtkScalePerTier ?? [];
  const critPct = Math.round((towerDef.critChance ?? 0) * 100);
  const critMult = Number(towerDef.critMult ?? 0).toFixed(1);
  const dmgType = String(towerDef.damageType ?? heroDef.specialty ?? '').replace(/_/g, ' ');
  const statCell = (label: string, value: string) => `
    <div style="background:#120d08;border:1px solid ${tint}55;padding:5px 4px;text-align:center">
      <div style="font-size:8px;color:#8f8060;letter-spacing:1px">${label}</div>
      <div style="font-size:10px;color:#fff8e0;font-weight:bold;line-height:1.2">${value}</div>
    </div>`;
  return `
    <div class="merc-champion-details" style="display:none;width:100%;box-sizing:border-box;margin-top:4px;text-align:left;background:linear-gradient(180deg,#17100a,#080604);border:1px solid ${tint};box-shadow:inset 0 0 12px ${tint}22;padding:8px;color:#d8c79a;font-size:10px;line-height:1.45">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;border-bottom:1px solid ${tint}55;padding-bottom:5px;margin-bottom:6px">
        <div>
          <div style="color:${tint};font-size:10px;font-weight:bold;letter-spacing:2px">${escapeHtml(heroDef.specialty ?? 'CHAMPION')}</div>
          <div style="color:#fff8e0;font-size:12px;font-weight:bold;line-height:1.2">${escapeHtml(heroDef.name)}</div>
          <div style="color:#aa9a4a;font-size:9px;font-style:italic">${escapeHtml(heroDef.title)}</div>
        </div>
        <div style="color:#f0c040;font-size:9px;letter-spacing:1px;text-align:right;white-space:nowrap">FULL KIT<br/>ON BUY</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-bottom:7px">
        ${statCell('DPS', escapeHtml(towerDef.baseDps ?? '?'))}
        ${statCell('RANGE', `${escapeHtml(towerDef.range ?? '?')} tiles`)}
        ${statCell('CRIT', `${critPct}% x${critMult}`)}
        ${statCell('TYPE', escapeHtml(dmgType))}
        ${statCell('SPEED', `${Number(towerDef.attackSpeed ?? 0).toFixed(2)}/s`)}
        ${statCell('SLOTS', '6 items')}
      </div>
      <div style="margin-bottom:6px">
        <div style="color:${tint};font-size:9px;font-weight:bold;letter-spacing:1.5px;margin-bottom:2px">WHY BUY</div>
        <div style="color:#cdb98a">${escapeHtml(heroDef.playerProblemSolved)}</div>
      </div>
      <div style="margin-bottom:6px">
        <div style="color:${tint};font-size:9px;font-weight:bold;letter-spacing:1.5px;margin-bottom:2px">PASSIVE</div>
        <div style="color:#fff8e0">${escapeHtml(heroDef.passive?.description)}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:5px">
        ${abilities.map((a, i) => `
          <div style="border-top:1px dashed ${tint}55;padding-top:5px">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:2px">
              <div style="color:#fff8e0;font-weight:bold">${escapeHtml(a.name)}</div>
              <div style="color:#f0c040;font-size:9px;white-space:nowrap">${escapeHtml(tierTitles[a.level] ?? (i === 0 ? 'LEGATUS' : 'CONSUL'))} · ${escapeHtml(a.cooldownSec)}s</div>
            </div>
            <div style="color:#cdb98a">${escapeHtml(a.description)}</div>
          </div>
        `).join('')}
      </div>
      <div style="margin-top:7px;padding-top:5px;border-top:1px solid ${tint}33;color:#aa9a4a;font-size:9px">
        Basic attack scales ${scales.length ? scales.map(n => `${Number(n).toFixed(1)}x`).join(' → ') : 'with hero tier'} across hero ranks. A Mercator Champion starts as a fresh level-0 recruit, then earns future kill XP to unlock these same passives, abilities, and rank damage.
      </div>
    </div>`;
}

function recordMercatorChampionPurchase(state: GameStateShape, type: string): void {
  if (!isMercatorChampionType(type)) return;
  const purchased = new Set(state.mercatorPurchasedChampionTypes ?? []);
  purchased.add(type);
  state.mercatorPurchasedChampionTypes = Array.from(purchased);
}

// ─── HERO FORGE SECTION (2026-05-20 v2) ──────────────────────────────
// Pay-to-upgrade hero system at the gate shop. The Forge is a run-wide
// hero investment: starter heroes and Mercator Champions all read the
// same stacks. Renders a 3-button row:
//   ⚔ SHARPEN  — +6% basic-attack damage / tap (5 cap)
//   ⏱ HASTEN   — −5% ability cooldown / tap  (5 cap)
//   ✨ EMPOWER  — +5% to all numeric ability/passive magnitudes / tap (5 cap)
// Each path has its own cost ramp (46/92/184/368/736g —
// doubling from 46g) and own stack counter; the three paths don't share
// resources or interact. The section frame tints to the active
// hero's color from towers.json so the forge feels personalized.
// 2026-05-20 v3 — Richer per-path metadata for the hover tooltip.
// `headline` is the short subtitle under the path name. `effect` is
// the per-tap effect. `maxedAt5` is the "what 5/5 gets you" line.
// `bestFor` flavor helps the player pick a path based on hero role.
// `notes` is optional extra clarification (e.g. EMPOWER count exclusion).
const FORGE_PATHS: Array<{
  key: 'dmg' | 'cd' | 'aura';
  label: string;
  icon: string;
  tint: string;
  headline: string;
  effect: string;
  maxedAt5: string;
  bestFor: string;
  notes?: string;
}> = [
  {
    key: 'dmg', label: 'SHARPEN', icon: '⚔', tint: '#ff5a4a',
    headline: 'BASIC ATTACK POWER',
    effect: '+6% damage to every deployed hero\'s basic attack per tap.',
    maxedAt5: '5/5 stacks → +30% hero DPS for the starter and all bought Champions.',
    bestFor: 'Best for hitter heroes whose basic attack is the carry — Scipio, Caesar, Marius.'
  },
  {
    key: 'cd', label: 'HASTEN', icon: '⏱', tint: '#5a9fff',
    headline: 'ABILITY COOLDOWN',
    effect: '−5% cooldown on every deployed hero ability per tap (compounding).',
    maxedAt5: '5/5 stacks → all hero cooldowns at 0.77× (≈23% faster cycle).',
    bestFor: 'Best for caster heroes — Marius (Capite Censi), Sulla (Proscription), Caesar (Pax Romana). Drops the time between ability windows so the wave never gets a quiet moment.'
  },
  {
    key: 'aura', label: 'EMPOWER', icon: '✨', tint: '#ffd34d',
    headline: 'ABILITY + PASSIVE STRENGTH',
    effect: '+5% to every numeric magnitude inside every deployed hero ability and passive aura per tap (damage multipliers, slow %, stun durations, aura strength).',
    maxedAt5: '5/5 stacks → +25% to all hero ability magnitudes and passive aura strength.',
    bestFor: 'Best for balanced heroes where the abilities themselves are the value — Agricola, Agrippa.',
    notes: 'Skips integer COUNTS (javelin/eagle/shell numbers stay the same) and binary triggers. bossSpeedMultiplier scales INVERSE — higher EMPOWER slows bosses MORE.'
  }
];

// 2026-05-20 v3 — Per-button hover tooltip. Renders a styled chip near
// the button (not the native title attribute, which delays + has no
// styling). Cleared on mouseleave. Tooltip uses the path's tint color
// for the border + accent so each path reads instantly.
function showForgeTooltip(btn: HTMLElement, path: typeof FORGE_PATHS[number]): void {
  document.getElementById('hero-forge-tooltip')?.remove();
  const tip = document.createElement('div');
  tip.id = 'hero-forge-tooltip';
  tip.style.cssText = `position:fixed;pointer-events:none;z-index:200;background:linear-gradient(180deg,#1a1410,#0c0a08);border:2px solid ${path.tint};padding:10px 14px;font-family:'Courier New',monospace;color:#e8d6a8;font-size:11px;letter-spacing:0.5px;line-height:1.5;box-shadow:0 0 20px ${path.tint}66;width:min(320px,90vw);`;
  tip.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;border-bottom:1px solid ${path.tint}44;padding-bottom:4px">
      <div style="font-size:18px;color:${path.tint}">${path.icon}</div>
      <div>
        <div style="color:${path.tint};font-weight:bold;font-size:13px;letter-spacing:2px">${path.label}</div>
        <div style="color:#aa9a4a;font-size:9px;letter-spacing:1.5px">${path.headline}</div>
      </div>
    </div>
    <div style="margin-top:6px"><b style="color:#fff8e0">EFFECT:</b> ${path.effect}</div>
    <div style="margin-top:4px"><b style="color:#88ff88">AT MAX:</b> ${path.maxedAt5}</div>
    <div style="margin-top:4px;color:#cdb98a;font-style:italic">${path.bestFor}</div>
    ${path.notes ? `<div style="margin-top:6px;padding-top:4px;border-top:1px dashed ${path.tint}44;font-size:10px;color:#aa9a4a">${path.notes}</div>` : ''}
    <div style="margin-top:6px;padding-top:4px;border-top:1px solid #3a3025;color:#aa9a4a;font-size:10px;letter-spacing:1px">Cost ramp: 46g · 92g · 184g · 368g · 736g · MAXED</div>`;
  document.body.appendChild(tip);
  const rect = btn.getBoundingClientRect();
  const tw = 320, th = 200;
  // Prefer above the button; fall back to below if not enough room
  let top = rect.top - th - 8;
  if (top < 8) top = rect.bottom + 8;
  let left = rect.left + rect.width / 2 - tw / 2;
  left = Math.min(window.innerWidth - tw - 8, Math.max(8, left));
  tip.style.left = left + 'px';
  tip.style.top  = top + 'px';
}
function hideForgeTooltip(): void {
  document.getElementById('hero-forge-tooltip')?.remove();
}
function renderHeroForgeSection(contentRoot: HTMLElement, state: GameStateShape, refresh: () => void): void {
  // Lookup active hero tint for the section frame.
  const heroDef: any = state.activeHeroId ? (towersData as any)[state.activeHeroId] : null;
  const heroTint = String(heroDef?.tint ?? '#d4af37');
  const heroName = String(heroDef?.name ?? 'Hero');
  const wrap = document.createElement('div');
  wrap.id = 'hero-forge-section';
  wrap.style.cssText = `margin-bottom:12px;padding:10px 12px;background:linear-gradient(180deg,#0c0a08,#1a1410);border:2px solid ${heroTint};box-shadow:0 0 14px ${heroTint}44;`;
  const stacks = state.heroForgeStacks ?? { dmg: 0, cd: 0, aura: 0 };
  // 2026-05-20 v3 — Native `title` attribute removed in favor of the
  // styled mouseenter tooltip wired below. The native tooltip delays
  // ~1s and isn't readable against the dark shop bg; the styled chip
  // appears instantly with the path's tint border + structured layout.
  const buttonsHtml = FORGE_PATHS.map(p => {
    const cur = (stacks as any)[p.key] as number;
    const nextCost = heroForgeNextCost(cur);
    const maxed = nextCost === null;
    const canAfford = !maxed && (state.gold ?? 0) >= (nextCost ?? 0);
    const baseBg = maxed ? '#2a1410' : canAfford ? '#1a2a1a' : '#1a1410';
    const baseBorder = maxed ? '#5a4a30' : canAfford ? p.tint : '#5a4a30';
    const cursor = (maxed || !canAfford) ? 'not-allowed' : 'pointer';
    const opacity = (maxed || !canAfford) ? 0.55 : 1;
    return `<button data-forge-path="${p.key}" style="display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 6px;background:${baseBg};border:2px solid ${baseBorder};color:#fff8e0;font-family:'Courier New',monospace;cursor:${cursor};opacity:${opacity};transition:transform 0.08s">
      <div style="font-size:18px;color:${p.tint};line-height:1">${p.icon}</div>
      <div style="font-size:11px;letter-spacing:2px;font-weight:bold;color:${p.tint}">${p.label}</div>
      <div style="font-size:10px;color:#cdb98a">${cur}/${HERO_FORGE_CAP}</div>
      <div style="font-size:11px;color:${maxed ? '#888' : canAfford ? '#f0c040' : '#aa6666'};font-weight:bold">${maxed ? 'MAXED' : `${nextCost}g`}</div>
    </button>`;
  }).join('');
  wrap.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
      <div style="font-size:10px;letter-spacing:4px;font-weight:bold;color:${heroTint}">⚒ HERO FORGE · ${heroName.toUpperCase()} + CHAMPIONS</div>
      <div style="font-size:9px;color:#aa9a4a;letter-spacing:1px">All deployed heroes</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">${buttonsHtml}</div>
    <div style="margin-top:6px;font-size:10px;color:#aa9a4a;line-height:1.45">Pays gold to upgrade the starter hero and every Mercator Champion you deploy. Each tap raises the next cost on THAT path only (the other two stay cheap). Lost on hero destruction — 50% gold refund when you draft a new hero.</div>`;
  // Wire each button. Click → check cap + gold → deduct + bump stack +
  // bump heroForgeGoldSpent + refresh the modal so the price ramps up
  // and the HUD chip badges below also re-render on next state read.
  // Hover → show the styled per-path tooltip; mouseleave → hide it.
  setTimeout(() => {
    const btns = wrap.querySelectorAll<HTMLButtonElement>('button[data-forge-path]');
    btns.forEach(btn => {
      const pathKey = btn.dataset.forgePath as 'dmg' | 'cd' | 'aura' | undefined;
      const path = pathKey ? FORGE_PATHS.find(p => p.key === pathKey) : undefined;
      if (path) {
        btn.onmouseenter = () => showForgeTooltip(btn, path);
        btn.onmouseleave = () => hideForgeTooltip();
      }
      btn.onclick = (ev) => {
        ev.stopPropagation();
        if (!pathKey) return;
        const curStacks = state.heroForgeStacks ?? { dmg: 0, cd: 0, aura: 0 };
        const cur = curStacks[pathKey];
        const cost = heroForgeNextCost(cur);
        if (cost === null) {
          state.hint = `⚒ ${pathKey.toUpperCase()} path is MAXED at 5/5.`;
          return;
        }
        if (!spendGold(state, cost)) {
          state.hint = `⚒ Not enough gold for next ${pathKey.toUpperCase()} tap (need ${cost}g).`;
          const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
          const stageRect = document.getElementById('stage-wrap')?.getBoundingClientRect();
          const ax = stageRect ? r.left + r.width / 2 - stageRect.left : undefined;
          const ay = stageRect ? r.top - stageRect.top : undefined;
          (window as any).__showInsufficientGoldToast?.(cost, ax, ay);
          return;
        }
        if (!state.heroForgeStacks) state.heroForgeStacks = { dmg: 0, cd: 0, aura: 0 };
        (state.heroForgeStacks as any)[pathKey] = cur + 1;
        state.heroForgeGoldSpent = (state.heroForgeGoldSpent ?? 0) + cost;
        try { (SFX as any).comboSuccess?.(); } catch { /* ignore */ }
        // Hide any tooltip that was up before the refresh wipes the DOM.
        hideForgeTooltip();
        refresh();
      };
    });
  }, 0);
  contentRoot.appendChild(wrap);
}


// One-shot stylesheet for Fortuna's Wheel — pulsing border + button glow.
// The CSS lives next to recipe-blink so all merc-shop visual languages
// stay together. Injected at most once per page load.
function ensureFortunaStyles() {
  if (document.getElementById('fortuna-style')) return;
  const st = document.createElement('style');
  st.id = 'fortuna-style';
  st.textContent = `
    @keyframes fortunaPulse {
      0%,100% { box-shadow: 0 0 8px rgba(212,175,55,0.35); border-color:#d4af37; }
      50%     { box-shadow: 0 0 20px rgba(212,175,55,0.75); border-color:#ffd680; }
    }
    .fortuna-card { animation: fortunaPulse 2.2s ease-in-out infinite; }
    .fortuna-spin-btn:not(:disabled):hover {
      background: #a07a1c !important;
      box-shadow: 0 0 14px rgba(255,214,128,0.8) !important;
    }
    .fortuna-reel { animation: fortunaPulse 2.2s ease-in-out infinite; }
  `;
  document.head.appendChild(st);
}

const RARITY_COLOR: Record<string, string> = {
  COMMON: '#cccccc',
  UNCOMMON: '#5cd05c',
  RARE: '#5ca0ff',
  EPIC: '#a060ff',           // 2026-05-18 — purple Epic tier
  LEGENDARY: '#ff9933',
  UNIQUE: '#ffd34d'
};

let __inventoryTooltipEl: HTMLElement | null = null;

function ensureInventoryItemTooltip(): HTMLElement {
  if (__inventoryTooltipEl && __inventoryTooltipEl.isConnected) return __inventoryTooltipEl;
  __inventoryTooltipEl = document.createElement('div');
  __inventoryTooltipEl.id = 'inventory-item-tooltip';
  __inventoryTooltipEl.style.cssText = `position:fixed;z-index:100050;pointer-events:none;display:none;width:min(280px,calc(100vw - 24px));background:linear-gradient(180deg,#1a1410,#0c0a08);color:#fff8e0;border:2px solid #d4af37;padding:10px 12px;font-family:'Courier New',monospace;font-size:11px;line-height:1.45;box-shadow:0 0 18px rgba(0,0,0,0.72);`;
  document.body.appendChild(__inventoryTooltipEl);
  return __inventoryTooltipEl;
}

function hideInventoryItemTooltip(): void {
  if (__inventoryTooltipEl) __inventoryTooltipEl.style.display = 'none';
}

function positionInventoryItemTooltip(tip: HTMLElement, ev: MouseEvent): void {
  const margin = 14;
  const w = tip.offsetWidth || 280;
  const h = tip.offsetHeight || 120;
  let x = ev.clientX + margin;
  let y = ev.clientY + margin;
  if (x + w > window.innerWidth - 8) x = ev.clientX - w - margin;
  if (y + h > window.innerHeight - 8) y = ev.clientY - h - margin;
  tip.style.left = `${Math.max(6, x)}px`;
  tip.style.top = `${Math.max(6, y)}px`;
}

function attachInventoryItemTooltip(el: HTMLElement, itm: { itemId: string; rarity: string }, def: any): void {
  el.setAttribute('aria-label', `${def?.name ?? itm.itemId}. ${def?.effect ?? ''}`);
  el.addEventListener('mouseenter', (ev) => {
    const tip = ensureInventoryItemTooltip();
    const color = RARITY_COLOR[itm.rarity] ?? '#d4af37';
    const family = itemFamily(itm.itemId) ?? 'SPECIAL';
    const price = itemBuyPrice(itm.itemId);
    tip.style.borderColor = color;
    tip.style.boxShadow = `0 0 18px rgba(0,0,0,0.72),0 0 12px ${color}66`;
    tip.innerHTML = `
      <div style="display:flex;align-items:flex-start;gap:8px;border-bottom:1px solid ${color}55;padding-bottom:6px;margin-bottom:7px">
        <div style="flex:0 0 auto">${itemIconSvg(itm.itemId, itm.rarity, 34)}</div>
        <div style="min-width:0">
          <div style="font-size:13px;font-weight:bold;letter-spacing:1px;color:${color};line-height:1.2">${escapeHtml(def?.name ?? itm.itemId.replace(/_/g, ' '))}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:3px;font-size:9px;color:#aa9a4a;letter-spacing:1px">
            <span>${escapeHtml(itm.rarity)}</span><span>${escapeHtml(family)}</span>${isConsumable(itm.itemId) ? '<span>CONSUMABLE</span>' : ''}
          </div>
        </div>
      </div>
      <div style="color:#cdb98a;font-size:11px;line-height:1.5">${escapeHtml(def?.effect ?? '(no effect description)')}</div>
      ${price > 0 ? `<div style="margin-top:7px;font-size:10px;color:#f0c040">Base cost: ${price}g · Click to inspect</div>` : '<div style="margin-top:7px;font-size:10px;color:#f0c040">Click to inspect</div>'}`;
    tip.style.display = 'block';
    positionInventoryItemTooltip(tip, ev as MouseEvent);
  });
  el.addEventListener('mousemove', (ev) => {
    if (__inventoryTooltipEl && __inventoryTooltipEl.style.display === 'block') {
      positionInventoryItemTooltip(__inventoryTooltipEl, ev as MouseEvent);
    }
  });
  el.addEventListener('mouseleave', hideInventoryItemTooltip);
}

if (typeof window !== 'undefined' && !(window as any).__inventoryItemTooltipBound) {
  window.addEventListener('click', hideInventoryItemTooltip, true);
  window.addEventListener('scroll', hideInventoryItemTooltip, true);
  window.addEventListener('blur', hideInventoryItemTooltip);
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') hideInventoryItemTooltip();
  }, true);
  (window as any).__inventoryItemTooltipBound = true;
}

export interface ShopHooks {
  onClose: () => void;
}

// ─── MERCATOR SHOP (2026-05 v2 — dedicated UX layout) ──────────────────
// The Mercator is the most consequential vendor in the run (T5 towers,
// Legendary trophies). The Gate shop is a side-stop; the Mercator is a
// decision moment. This layout reflects that:
//   • Sticky header — player gold and inventory slots always visible so
//     the player knows what they can spend before scrolling.
//   • Towers first — the unique-to-Mercator T5 slots are the reason the
//     vendor exists. They show abilities + range/DPS + recipe-completes
//     glow so the player can decide without leaving the panel.
//   • Items grouped by rarity tier with family tags.
//   • Lives row sits last, lower priority.
//   • Hover lift + disabled-state BUY buttons (gold below price greys it
//     out instead of letting the player click through to a hint).
// ─── STONE RAMPARTS section (2026-07-02) — 5-tile barrier lines for
// mazing. Rendered by the gate shop and inventory placement flow.
// Buy → PLACE arms it → click a tile; placed tiles are ordinary wall
// stones (identical art + sell rules); hard cap 3 purchases per campaign.
// Styles are fully inline so the section renders correctly in the gate
// shop, which never injects the Mercator stylesheet.
function renderRampartSection(root: HTMLElement, state: GameStateShape, refresh: () => void, onClose: () => void): void {
  const rampSection = document.createElement('div');
  rampSection.style.cssText = `margin-top:14px;`;
  const rampTitle = document.createElement('div');
  rampTitle.style.cssText = `display:flex;justify-content:space-between;align-items:center;color:#d4af37;font-weight:bold;letter-spacing:2px;font-size:13px;border-bottom:1px solid #4a3a24;padding-bottom:4px;margin-bottom:6px;`;
  const left = rampartsRemainingThisRun(state);
  rampTitle.innerHTML = `<span>▦ STONE RAMPARTS</span><span style="font-size:10px;color:#cdb98a;letter-spacing:1px;font-weight:normal">${left} of ${RAMPART_MAX_PER_RUN} left this campaign</span>`;
  rampSection.appendChild(rampTitle);
  const rNote = document.createElement('div');
  rNote.style.cssText = `font-size:10px;color:#cdb98a;line-height:1.4;margin-bottom:8px;`;
  rNote.innerHTML = `Buy one and it goes to your <b style="color:#ffd34d">Armarium inventory</b>. Click it there, or hit PLACE below, to arm a straight line of <b style="color:#ffcc44">5 wall stones</b>. While placing, a rotate tray appears: press <b style="color:#ffe066">R</b>, tap ROTATE, or choose horizontal / vertical / diagonal ↘ / diagonal ↗. Hover to preview before confirming. Build phase only.`;
  rampSection.appendChild(rNote);
  // Single generic card — orientation is chosen at placement time (2026-07-03).
  // Portrait uses the real RAMPART_STRIP sprite (Higgsfield i2i off
  // m_stone_block.png); falls back to CSS blocks pre-texture-load.
  const stripSrc = imgSrcFromTex('RAMPART_STRIP');
  const portrait = stripSrc
    ? `<img src="${stripSrc}" style="width:48px;height:10px;image-rendering:pixelated;"/>`
    : `<div style="display:flex;gap:2px">${'<div style="width:9px;height:9px;background:#8a8a92;border:1px solid #3a3a40"></div>'.repeat(5)}</div>`;
  const owned = rampartsOwned(state);
  const armed = !!state.selectedRampart;
  const card = document.createElement('div');
  card.style.cssText = `border:2px solid ${armed ? '#ffe066' : '#8a8a92'};padding:8px 6px;background:#0c0a08;display:flex;flex-direction:column;gap:4px;text-align:center;align-items:center;`;
  card.innerHTML = `
    <div style="width:54px;height:54px;border:1px solid #8a8a92;background:#1a1410;display:flex;align-items:center;justify-content:center">${portrait}</div>
    <div style="color:#fff8e0;font-size:11px;font-weight:bold;line-height:1.2">Stone Rampart</div>
    <div style="font-size:8.5px;color:#cdb98a;line-height:1.3">5 stones in a line, centered on the tile you click. Rotate while previewing.</div>
    <div style="color:#f0c040;font-size:11px;font-weight:bold">${RAMPART_COST}g${owned > 0 ? ` · <span style="color:#88ff88">x${owned}</span>` : ''}</div>`;
  const row = document.createElement('div');
  row.style.cssText = `display:flex;gap:4px;width:100%;margin-top:3px`;
  const buyBtn = document.createElement('button');
  buyBtn.textContent = left <= 0 ? 'SOLD OUT' : 'BUY';
  buyBtn.disabled = left <= 0;
  buyBtn.style.cssText = `flex:1;background:${left <= 0 ? '#2a2420' : '#3a5520'};color:#e8d6a8;border:1px solid #1a1410;padding:4px 0;cursor:${left <= 0 ? 'not-allowed' : 'pointer'};font-size:10px;font-family:inherit`;
  buyBtn.onclick = () => {
    const spent = buyRampart(state);
    if (spent <= 0) {
      if (rampartsRemainingThisRun(state) <= 0) state.hint = `Rampart quota exhausted — ${RAMPART_MAX_PER_RUN} per campaign.`;
      else (window as any).__showInsufficientGoldToast?.(RAMPART_COST);
      return;
    }
    state.hint = 'Bought a Stone Rampart. It is in your Armarium inventory. Open inventory and click it, or hit PLACE here.';
    SFX.buy();
    refresh();
  };
  row.appendChild(buyBtn);
  if (owned > 0) {
    const armBtn = document.createElement('button');
    armBtn.textContent = armed ? 'ARMED' : 'PLACE';
    armBtn.title = 'Arm rampart placement. A rotate tray will appear with horizontal, vertical, and both diagonal options.';
    armBtn.style.cssText = `flex:1;background:${armed ? '#5a4a10' : '#4a3a24'};color:#ffe066;border:1px solid #1a1410;padding:4px 0;cursor:pointer;font-size:10px;font-family:inherit`;
    armBtn.onclick = () => {
      armRampartFromInventory(state, state.selectedRampart ?? 'H');
      state.hint = `Rampart armed (${RAMPART_ORIENT_LABEL[state.selectedRampart!]}). Use the rotate tray or R, hover for preview, then click a valid tile or road to confirm.`;
      onClose();
    };
    row.appendChild(armBtn);
  }
  card.appendChild(row);
  rampSection.appendChild(card);
  root.appendChild(rampSection);
}

function renderTrapSection(root: HTMLElement, state: GameStateShape, refresh: () => void): void {
  const trapSection = document.createElement('div');
  trapSection.style.cssText = `margin-top:14px;`;
  const trapTitle = document.createElement('div');
  trapTitle.className = 'merc-section-title';
  trapTitle.style.cssText = `display:flex;justify-content:space-between;align-items:center;color:#d4af37;font-weight:bold;letter-spacing:2px;font-size:13px;border-bottom:1px solid #4a3a24;padding-bottom:4px;margin-bottom:6px;`;
  trapTitle.innerHTML = `<span>☠ CONSUMABLE TRAPS</span><span style="font-size:10px;color:#cdb98a;letter-spacing:1px;font-weight:normal">buy → inventory → place between waves · 5 each</span>`;
  trapSection.appendChild(trapTitle);
  const tNote = document.createElement('div');
  tNote.style.cssText = `font-size:9.5px;color:#aa9a4a;line-height:1.35;margin:2px 0 8px;font-style:italic`;
  tNote.innerHTML = `Stockpile traps, then <b style="color:#ffd34d">deploy them between waves</b>. Active-wave placement stays locked even while paused. Each type is capped at <b style="color:#ffd34d">5 per campaign</b>. Deployed traps re-arm during that wave, then expire when it ends. <b style="color:#ffcc44">Ballista Snare</b> shreds bosses; <b style="color:#88ddff">Sky Net</b> is the only trap that catches fliers.`;
  trapSection.appendChild(tNote);
  const tg = document.createElement('div');
  tg.style.cssText = `display:grid;grid-template-columns:repeat(auto-fit,minmax(138px,1fr));gap:8px;`;
  for (const tid of TRAP_IDS) {
    const def = TRAP_DEFS[tid];
    const price = trapPrice(state, tid);
    const colHex = '#' + def.color.toString(16).padStart(6, '0');
    const selected = state.selectedTrapType === tid;
    const owned = (state.trapInventory ?? {})[tid] ?? 0;
    const purchased = trapsPurchasedByType(state, tid);
    const remaining = trapPurchasesRemaining(state, tid);
    const card = document.createElement('div');
    card.style.cssText = `border:2px solid ${selected ? '#ffe066' : remaining <= 0 ? '#5a4a30' : colHex};padding:8px 6px;background:#0c0a08;display:flex;flex-direction:column;gap:3px;text-align:center;align-items:center;opacity:${remaining <= 0 ? '0.68' : '1'};`;
    const src = imgSrcFromTex(def.spriteKey);
    const portrait = src
      ? `<div style="width:54px;height:54px;border:1px solid ${colHex};background:#1a1410;display:flex;align-items:center;justify-content:center"><img src="${src}" style="width:48px;height:48px;image-rendering:pixelated"/></div>`
      : `<div style="width:54px;height:54px;border:1px solid ${colHex};color:#cdb98a;font-size:8px;display:flex;align-items:center;justify-content:center">NO IMG</div>`;
    card.innerHTML = `
      ${portrait}
      <div style="color:#fff8e0;font-size:11px;font-weight:bold;line-height:1.2">${def.name}</div>
      <div style="font-size:8.5px;color:#cdb98a;line-height:1.3;min-height:30px">${def.blurb.replace(/"/g, "'")}</div>
      <div style="color:#f0c040;font-size:11px;font-weight:bold">${price}g${owned > 0 ? ` · <span style="color:#88ff88">x${owned}</span>` : ''}</div>
      <div style="font-size:8.5px;color:${remaining <= 0 ? '#ff7777' : '#aa9a4a'};letter-spacing:1px">BOUGHT ${purchased}/${TRAP_PURCHASE_CAP_PER_TYPE}</div>`;
    const row = document.createElement('div');
    row.style.cssText = `display:flex;gap:4px;width:100%;margin-top:3px`;
    const mkBuy = (n: number) => {
      const b = document.createElement('button');
      b.className = 'merc-buy';
      const buyQty = Math.min(n, remaining);
      b.textContent = remaining <= 0 ? 'MAX' : `BUY ${buyQty}`;
      b.disabled = remaining <= 0;
      b.style.cssText = `flex:1;background:${remaining <= 0 ? '#2a241c' : '#3a5520'};color:${remaining <= 0 ? '#776b55' : '#e8d6a8'};cursor:${remaining <= 0 ? 'not-allowed' : 'pointer'};font-size:10px`;
      b.onclick = () => {
        if (remaining <= 0) {
          state.hint = `${def.name} is capped at ${TRAP_PURCHASE_CAP_PER_TYPE} per campaign.`;
          refresh();
          return;
        }
        const spent = buyTraps(state, tid, buyQty);
        if (spent <= 0) { (window as any).__showInsufficientGoldToast?.(price * buyQty); return; }
        recordMercatorBackRoomPurchase(state, spent);
        state.hint = `Bought ${buyQty}x ${def.name}. Open inventory and click it to arm placement.`;
        SFX.buy();
        refresh();
      };
      return b;
    };
    row.appendChild(mkBuy(1));
    row.appendChild(mkBuy(5));
    card.appendChild(row);
    card.onclick = (ev) => {
      if ((ev.target as HTMLElement).tagName === 'BUTTON') return;
      if (((state.trapInventory ?? {})[tid] ?? 0) > 0) {
        state.hint = `Open inventory and click ${def.name} to arm it.`;
        refresh();
      }
    };
    tg.appendChild(card);
  }
  trapSection.appendChild(tg);
  root.appendChild(trapSection);
}

function renderMercatorShop(
  parent: HTMLElement, shop: ShopState, state: GameStateShape,
  inv: InventoryState, hooks: ShopHooks, refresh: () => void
) {
  const TIER_COL: Record<number, string> = { 1:'#aaaaaa', 2:'#b87333', 3:'#c0c0c0', 4:'#ffd34d', 5:'#ff5050' };
  const tierToRarity = ['COMMON','UNCOMMON','RARE','LEGENDARY','UNIQUE'];

  // One-shot stylesheet for hover lifts + disabled BUY buttons.
  if (!document.getElementById('mercator-shop-style')) {
    const st = document.createElement('style');
    st.id = 'mercator-shop-style';
    st.textContent = `
      .merc-card { transition: transform 0.08s ease, box-shadow 0.12s ease, border-color 0.12s ease; }
      .merc-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(212,175,55,0.35); }
      .merc-buy { font-family:'Courier New',monospace; font-size:11px; letter-spacing:1px; font-weight:bold; padding:6px 10px; border:1px solid #5a4a30; cursor:pointer; transition: background 0.1s; }
      .merc-buy:not(:disabled):hover { background:#4a6a28; }
      .merc-buy:disabled { background:#2a2a2a; color:#666; border-color:#3a3a3a; cursor:not-allowed; }
      .merc-section-title { font-size:11px; letter-spacing:4px; color:#d4af37; font-weight:bold; padding:0 0 4px; border-bottom:1px solid #5a4a30; margin-bottom:8px; display:flex; align-items:center; justify-content:space-between; }
      .merc-champion-toggle { font-family:'Courier New',monospace; font-size:10px; letter-spacing:1.5px; font-weight:bold; padding:5px 8px; border:1px solid #5a4a30; background:#17100a; color:#d4af37; cursor:pointer; width:100%; }
      .merc-champion-toggle:hover { background:#2a1a0e; border-color:#d4af37; }
    `;
    document.head.appendChild(st);
  }

  const modal = document.createElement('div');
  modal.id = 'shop-modal';
  // Leave right gutter clear for the prospect-building sidebar.
  // 2026-05-19 — Anchor to flex-start so the header banner is always
  // reachable at the top regardless of viewport height. The panel keeps
  // its flex-column structure (sticky header + scrollable body).
  modal.style.cssText = `position:absolute;left:0;top:0;bottom:0;right:120px;display:flex;align-items:flex-start;justify-content:center;background:radial-gradient(ellipse at center,rgba(58,22,6,0.65),rgba(0,0,0,0.85));z-index:50;padding:12px 8px;box-sizing:border-box;font-family:'Courier New',monospace;`;

  const panel = document.createElement('div');
  panel.style.cssText = `background:linear-gradient(180deg,#2a1a0e,#0c0a08);border:4px solid #d4af37;outline:1px solid #1a1410;color:#fff8e0;padding:0;width:min(920px,96vw);max-height:calc(100% - 8px);overflow:hidden;display:flex;flex-direction:column;box-shadow:0 0 36px rgba(212,175,55,0.45),inset 0 0 24px rgba(0,0,0,0.5);`;

  // ── Header banner ──────────────────────────────────────────────────
  const cartSrc = imgSrcFromTex('MERCATOR_CART') || imgSrcFromTex('MERCATOR');
  const cartHtml = cartSrc
    ? `<img src="${cartSrc}" style="width:64px;height:64px;image-rendering:pixelated;flex-shrink:0;filter:drop-shadow(2px 2px 0 #000)"/>`
    : '';
  const header = document.createElement('div');
  header.style.cssText = `background:linear-gradient(90deg,#5a3a16,#d4af37,#5a3a16);padding:12px 18px;display:flex;align-items:center;gap:14px;border-bottom:3px solid #1a1410;flex-shrink:0`;
  header.innerHTML = `
    ${cartHtml}
    <div style="flex:1">
      <div style="font-size:10px;letter-spacing:5px;color:#1a1410;font-weight:bold">★ MERCATOR ★</div>
      <div style="font-size:22px;font-weight:bold;letter-spacing:4px;color:#1a1410;text-shadow:1px 1px 0 #d4af37">TRAVELING ARMORY</div>
      <div style="font-size:11px;color:#3a2010;margin-top:2px;font-style:italic">"Spend well, legate. The next wave will not wait."</div>
    </div>`;
  panel.appendChild(header);

  // ── Sticky resources bar (gold + inventory + lives this visit) ────
  const goldFill = state.gold;
  const invUsed = inv.slots.length;
  const invCap = INVENTORY_SIZE;
  const resourcesBar = document.createElement('div');
  resourcesBar.style.cssText = `background:#0c0a08;border-bottom:2px solid #5a4a30;padding:10px 18px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;flex-shrink:0;font-size:11px;letter-spacing:1px`;
  resourcesBar.innerHTML = `
    <div>
      <div style="color:#aa9a4a;font-size:9px;letter-spacing:2px">GOLD</div>
      <div style="color:#f0c040;font-size:18px;font-weight:bold">${goldFill}g</div>
    </div>
    <div>
      <div style="color:#aa9a4a;font-size:9px;letter-spacing:2px">INVENTORY</div>
      <div style="color:${invUsed >= invCap ? '#ff7766' : '#fff8e0'};font-size:18px;font-weight:bold">${invUsed} / ${invCap}</div>
    </div>
    <div>
      <div style="color:#aa9a4a;font-size:9px;letter-spacing:2px">LIVES BOUGHT</div>
      <div style="color:#fff8e0;font-size:18px;font-weight:bold">${shop.livesBoughtThisVisit} / ${shop.livesMaxThisVisit}</div>
    </div>`;
  panel.appendChild(resourcesBar);

  // ── Scrollable body ───────────────────────────────────────────────
  const body = document.createElement('div');
  body.id = 'mercator-shop-body';
  body.style.cssText = `padding:14px 18px;overflow:auto;flex:1;background:linear-gradient(180deg,#1a1410,#0c0a08);display:flex;flex-direction:column;gap:18px`;
  panel.appendChild(body);
  markScrollable(body);

  const renderMercatorPlaceableOffer = (
    offer: NonNullable<ShopState['towerOffers']>[number],
    listEl: HTMLElement,
    purchaseKind: 'hero' | 'mercator'
  ) => {
    const isChampion = purchaseKind === 'hero';
    const completesRecipe = !isChampion && purchaseCompletesRecipe(state, offer.type, offer.tier);
    const card = document.createElement('div');
    card.className = 'merc-card' + (completesRecipe ? ' recipe-ready-card' : '');
    card.style.cssText = `border:2px solid ${completesRecipe ? '#66ff88' : TIER_COL[offer.tier]};padding:10px 8px 8px;background:${completesRecipe ? '#0c1a10' : '#0c0a08'};display:flex;flex-direction:column;gap:4px;text-align:center;align-items:center;position:relative;`;
    const spriteSrc = imgSrcFromTex(offer.type);
    const towerDef: any = (towersData as any)[offer.type] ?? {};
    const towerName = towerDef.name ?? offer.type.replace(/_/g,' ');
    const championDetails = isChampion
      ? championHeroDetailsHtml(offer.type, towerDef, towerDef.tint ?? TIER_COL[offer.tier])
      : '';
    const portrait = spriteSrc
      ? `<div style="width:64px;height:64px;border:1px solid ${TIER_COL[offer.tier]};background:#1a1410;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 8px ${TIER_COL[offer.tier]}55"><img src="${spriteSrc}" style="width:56px;height:56px;image-rendering:pixelated" alt="${towerName}"/></div>`
      : `<div style="width:64px;height:64px;border:1px solid ${TIER_COL[offer.tier]};background:#1a1410;color:#cdb98a;font-size:9px;display:flex;align-items:center;justify-content:center;letter-spacing:1px">NO IMG</div>`;
    const recipeBadge = completesRecipe
      ? `<div class="recipe-ready-badge" style="position:absolute;top:-9px;left:50%;transform:translateX(-50%);background:#0c1a10;border:1.5px solid #66ff88;color:#bbffcc;font-size:9px;font-weight:bold;letter-spacing:1px;padding:2px 6px;white-space:nowrap;text-shadow:0 0 4px #66ff88">★ COMPLETES RECIPE</div>`
      : '';
    const dps = towerDef.baseDps ?? '?';
    const range = towerDef.range ?? '?';
    const atk = towerDef.attackSpeed ?? null;
    const atkText = atk != null ? `${atk.toFixed(1)}/s` : '?/s';
    const ability = towerBriefHtml(String(offer.type), towerDef);
    card.innerHTML = `
      ${recipeBadge}
      <div style="color:${TIER_COL[offer.tier]};font-weight:bold;font-size:13px;letter-spacing:2px">${isChampion ? 'HERO' : `T${offer.tier}`}</div>
      ${portrait}
      <div style="color:#fff8e0;font-size:12px;font-weight:bold;line-height:1.25;margin-top:2px">${towerName}</div>
      <div style="display:flex;gap:6px;font-size:9px;color:#cdb98a;letter-spacing:0.5px">
        <span title="Base DPS">⚔ ${dps}</span>
        <span title="Attack Speed">⏱ ${atkText}</span>
        <span title="Range (tiles)">◎ ${range}t</span>
      </div>
      <div style="font-size:9.5px;color:#cdb98a;line-height:1.35;margin-top:3px;min-height:34px">${ability}</div>
      ${championDetails ? `<button class="merc-champion-toggle" type="button" data-champion-details="${offer.type}" aria-expanded="false">DETAILS</button>${championDetails}` : ''}
      <div style="color:#f0c040;font-size:12px;font-weight:bold;margin-top:2px">${offer.price}g</div>`;
    const detailBtn = card.querySelector<HTMLButtonElement>('button[data-champion-details]');
    const detailPanel = card.querySelector<HTMLElement>('.merc-champion-details');
    if (detailBtn && detailPanel) {
      detailBtn.onclick = (ev) => {
        ev.stopPropagation();
        const opening = detailPanel.style.display === 'none';
        listEl.querySelectorAll<HTMLElement>('.merc-champion-details').forEach(el => { el.style.display = 'none'; });
        listEl.querySelectorAll<HTMLButtonElement>('button[data-champion-details]').forEach(btn => {
          btn.textContent = 'DETAILS';
          btn.setAttribute('aria-expanded', 'false');
        });
        if (opening) {
          detailPanel.style.display = 'block';
          detailBtn.textContent = 'HIDE';
          detailBtn.setAttribute('aria-expanded', 'true');
        }
      };
    }
    const canAfford = state.gold >= offer.price;
    const buy = document.createElement('button');
    buy.textContent = canAfford ? 'BUY' : 'NEED ' + (offer.price - state.gold) + 'g';
    buy.className = 'merc-buy';
    buy.style.cssText = `background:${canAfford ? '#3a5520' : '#2a2a2a'};color:${canAfford ? '#e8d6a8' : '#666'};width:100%;margin-top:4px;cursor:${canAfford ? 'pointer' : 'not-allowed'};`;
    buy.onclick = (ev) => {
      if (state.gold < offer.price) {
        const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
        const stageRect = document.getElementById('stage-wrap')?.getBoundingClientRect();
        const ax = stageRect ? r.left + r.width / 2 - stageRect.left : undefined;
        const ay = stageRect ? r.top - stageRect.top : undefined;
        (window as any).__showInsufficientGoldToast?.(offer.price, ax, ay);
        return;
      }
      spendGold(state, offer.price);
      recordMercatorBackRoomPurchase(state, offer.price);
      if (!state.pendingPurchasedTowers) state.pendingPurchasedTowers = [];
      state.pendingPurchasedTowers.push({ type: offer.type, tier: offer.tier, source: purchaseKind });
      if (isChampion) recordMercatorChampionPurchase(state, offer.type);
      const qLen = state.pendingPurchasedTowers.length;
      const verb = isChampion ? 'Recruited' : 'Bought';
      state.hint = qLen > 1
        ? `${verb} ${towerName(String(offer.type))}. ${qLen} placements queued — click empty tiles to place.`
        : `${verb} ${towerName(String(offer.type))}. Click an empty tile to place it.`;
      SFX.itemPickup(isChampion ? 'LEGENDARY' : tierToRarity[Math.max(0, Math.min(4, offer.tier - 1))]);
      if (isChampion) {
        shop.championOffers = (shop.championOffers ?? []).filter(o => o !== offer);
      } else {
        shop.towerOffers = (shop.towerOffers ?? []).filter(o => o !== offer);
      }
      refresh();
    };
    card.appendChild(buy);
    listEl.appendChild(card);
  };

  // ─── SECTION 1A: CHAMPIONS (hero recruits, not randomized towers) ──
  if (shop.championOffers && shop.championOffers.length > 0) {
    const champSection = document.createElement('div');
    const champTitle = document.createElement('div');
    champTitle.className = 'merc-section-title';
    champTitle.innerHTML = `<span>★ CHAMPION RECRUITMENT</span><span style="font-size:10px;color:#cdb98a;letter-spacing:1px;font-weight:normal">heroes · 1000g each · recruit all 6 → MARS VICTOR</span>`;
    champSection.appendChild(champTitle);
    const champNote = document.createElement('div');
    champNote.style.cssText = `font-size:9.5px;color:#aa9a4a;line-height:1.35;margin:2px 0 8px;font-style:italic`;
    champNote.textContent = 'Mercator Champions are heroes. They are not part of the random tower armory and bought Champions leave future visits.';
    champSection.appendChild(champNote);
    const cList = document.createElement('div');
    cList.style.cssText = `display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;`;
    for (const offer of shop.championOffers) renderMercatorPlaceableOffer(offer, cList, 'hero');
    champSection.appendChild(cList);
    body.appendChild(champSection);
  }

  // ─── SECTION 1B: T5 BASE TOWERS (randomized armory) ────────────────
  if (shop.towerOffers && shop.towerOffers.length > 0) {
    const towersSection = document.createElement('div');
    const towersTitle = document.createElement('div');
    towersTitle.className = 'merc-section-title';
    towersTitle.innerHTML = `<span>★ RANDOMIZED T5 BASE TOWERS</span><span style="font-size:10px;color:#cdb98a;letter-spacing:1px;font-weight:normal">${shop.towerOffers.length} random base towers · refreshes next Mercator visit</span>`;
    towersSection.appendChild(towersTitle);
    const towersNote = document.createElement('div');
    towersNote.style.cssText = `font-size:9.5px;color:#aa9a4a;line-height:1.35;margin:2px 0 8px;font-style:italic`;
    towersNote.innerHTML = `Base towers only. <b style="color:#cc6666">Heroes, combo towers, apex towers, and omega towers are never in this random shelf</b> — ${recipeOnlyComboNames()} must be crafted.`;
    towersSection.appendChild(towersNote);
    const tList = document.createElement('div');
    tList.style.cssText = `display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;`;
    for (const offer of shop.towerOffers) renderMercatorPlaceableOffer(offer, tList, 'mercator');
    towersSection.appendChild(tList);
    body.appendChild(towersSection);
  }

  // ─── SECTION 2: ITEMS (grouped by rarity bucket so player sees the
  // Legendary tier first — that's the Mercator's other unique draw) ───
  if (shop.offers.length > 0) {
    const itemsSection = document.createElement('div');
    const itemsTitle = document.createElement('div');
    itemsTitle.className = 'merc-section-title';
    itemsTitle.innerHTML = `<span>★ TROPHIES & WARES</span><span style="font-size:10px;color:#cdb98a;letter-spacing:1px;font-weight:normal">one per item-family per tower</span>`;
    itemsSection.appendChild(itemsTitle);

    // Sort: legendary → rare → uncommon → common so the apex trophies
    // sit at the top of the player's eye line.
    const RARITY_ORDER: Record<string, number> = { LEGENDARY: 0, UNIQUE: 1, EPIC: 2, RARE: 3, UNCOMMON: 4, COMMON: 5 };
    const sortedOffers = shop.offers.slice().sort((a, b) =>
      (RARITY_ORDER[a.rarity] ?? 9) - (RARITY_ORDER[b.rarity] ?? 9)
    );

    const itemList = document.createElement('div');
    itemList.style.cssText = `display:grid;grid-template-columns:1fr 1fr;gap:8px;`;
    for (const offer of sortedOffers) {
      const def: any = (consumables as any)[offer.itemId] ?? (items as any)[offer.itemId];
      const card = document.createElement('div');
      card.className = 'merc-card';
      card.style.cssText = `border:2px solid ${RARITY_COLOR[offer.rarity]};padding:8px;background:#0c0a08;display:flex;flex-direction:column;gap:5px;position:relative;`;
      // 2026-05 v9: render DoT sub-families as their kind label ("BURN" /
      // "POISON" / "BLEED") so the player sees the DoT type, not the
      // internal sub-family key. Other families render verbatim.
      const rawFam = itemFamily(offer.itemId) ?? 'MISC';
      const famLabel = rawFam.startsWith('DOT_') ? rawFam.slice(4) : rawFam;
      const familyTag = `<span style="font-size:8.5px;color:#cdb98a;letter-spacing:1px;background:#1a1410;border:1px solid #3a3025;padding:1px 4px">${famLabel.toUpperCase()}</span>`;
      const rarityTag = `<span style="font-size:8.5px;color:${RARITY_COLOR[offer.rarity]};letter-spacing:1.5px;font-weight:bold">${offer.rarity}</span>`;
      card.innerHTML = `
        <div style="display:flex;gap:8px;align-items:flex-start">
          <div style="flex-shrink:0">${itemIconSvg(offer.itemId, offer.rarity, 40)}</div>
          <div style="flex:1;min-width:0">
            <div style="color:${RARITY_COLOR[offer.rarity]};font-weight:bold;font-size:13px;line-height:1.2">${def?.name ?? offer.itemId}</div>
            <div style="display:flex;gap:4px;margin-top:3px;flex-wrap:wrap">${rarityTag}${familyTag}</div>
            <div style="font-size:10.5px;color:#cdb98a;margin-top:4px;line-height:1.4">${def?.effect ?? ''}</div>
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:4px;border-top:1px dashed #3a3025">
          <span style="color:#f0c040;font-size:13px;font-weight:bold">${offer.price}g</span>
        </div>`;
      const canAfford = state.gold >= offer.price;
      const invFull = inv.slots.length >= INVENTORY_SIZE;
      const buyBtn = document.createElement('button');
      buyBtn.className = 'merc-buy';
      // 2026-05 v9: leave clickable; INV FULL stays disabled (different
      // failure mode — no tooltip benefit) but the gold-short case pops
      // the floating tooltip on click.
      buyBtn.disabled = invFull;
      buyBtn.textContent = invFull ? 'INV FULL' : canAfford ? 'BUY' : 'NEED ' + (offer.price - state.gold) + 'g';
      buyBtn.style.cssText = `background:${(canAfford && !invFull) ? '#3a5520' : '#2a2a2a'};color:${(canAfford && !invFull) ? '#e8d6a8' : '#666'};cursor:${(canAfford && !invFull) ? 'pointer' : 'not-allowed'};`;
      buyBtn.onclick = (ev) => {
        if (inv.slots.length >= INVENTORY_SIZE) return;
        if (state.gold < offer.price) {
          const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
          const stageRect = document.getElementById('stage-wrap')?.getBoundingClientRect();
          const ax = stageRect ? r.left + r.width / 2 - stageRect.left : undefined;
          const ay = stageRect ? r.top - stageRect.top : undefined;
          (window as any).__showInsufficientGoldToast?.(offer.price, ax, ay);
          return;
        }
        spendGold(state, offer.price);
        recordMercatorBackRoomPurchase(state, offer.price);
        inventoryAdd(inv, offer.itemId, offer.rarity, offer.isConsumable, offer.price);
        state.hint = `Bought ${def?.name ?? offer.itemId}.`;
        SFX.itemPickup(offer.rarity);
        shop.offers = shop.offers.filter(o => o !== offer);
        refresh();
      };
      // Attach the BUY button to the bottom row by replacing the placeholder.
      const bottomRow = card.querySelector('div:last-child') as HTMLElement;
      bottomRow.appendChild(buyBtn);
      itemList.appendChild(card);
    }
    itemsSection.appendChild(itemList);
    body.appendChild(itemsSection);
  }

  // ─── SECTION 2.5: FORTUNA'S WHEEL — regular combo-tower gamble ─────
  // Pure RNG. Random pick from regular COMBO towers only. Supercombo,
  // Omega, Champion, and recipe-chain combo-of-combo results remain
  // crafted rewards.
  ensureFortunaStyles();
  const fortunaSection = document.createElement('div');
  const fortunaTitle = document.createElement('div');
  fortunaTitle.className = 'merc-section-title';
  fortunaTitle.innerHTML = `
    <span>🎰 FORTUNA'S WHEEL — COMBO TOWER GAMBLE</span>
    <span style="font-size:10px;color:#cdb98a;letter-spacing:1px;font-weight:normal">${shop.gambleSpinsThisVisit ?? 0} spin${(shop.gambleSpinsThisVisit ?? 0) === 1 ? '' : 's'} this visit</span>`;
  fortunaSection.appendChild(fortunaTitle);

  const fortunaCard = document.createElement('div');
  fortunaCard.className = 'merc-card fortuna-card';
  fortunaCard.style.cssText = `border:2px solid #d4af37;padding:12px;background:linear-gradient(180deg,#1a0a08,#0c0a08);display:flex;align-items:center;gap:14px;position:relative;overflow:hidden;`;

  // Reel viewport — the spinning sprites land in this 96x96 box.
  const reel = document.createElement('div');
  reel.className = 'fortuna-reel';
  reel.style.cssText = `width:96px;height:96px;border:2px solid #d4af37;background:#0c0a08;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:inset 0 0 12px rgba(212,175,55,0.4);position:relative;`;
  const reelImg = document.createElement('div');
  reelImg.style.cssText = `width:80px;height:80px;display:flex;align-items:center;justify-content:center;font-size:32px;color:#d4af37;`;
  reelImg.innerHTML = '🎲';
  reel.appendChild(reelImg);

  // Body — flavor copy + win log + buy button.
  const fortunaBody = document.createElement('div');
  fortunaBody.style.cssText = `flex:1;display:flex;flex-direction:column;gap:6px;`;
  const wins = shop.gambleWinsThisVisit ?? [];
  const winsLog = wins.length > 0
    ? `<div style="font-size:9px;color:#88ff88;letter-spacing:1px;margin-top:4px;line-height:1.4">★ WON: ${wins.map(w => (towersData as any)[w]?.name ?? w).join(' · ')}</div>`
    : '';
  // Surface the per-tier odds inline so the player can see the linear
  // rarity ramp before they pull the lever. The colors match TIER_COL so
  // T5 reads "red = rare" at a glance.
  const TIER_HEX: Record<number, string> = { 2:'#b87333', 3:'#c0c0c0', 4:'#ffd34d', 5:'#ff5050' };
  const oddsChips = getFortunaTierOdds()
    .map(o => `<span style="background:#0c0a08;border:1px solid ${TIER_HEX[o.tier]};color:${TIER_HEX[o.tier]};padding:1px 5px;font-size:9.5px;font-weight:bold;letter-spacing:1px;margin-right:3px">T${o.tier} ${o.pct.toFixed(0)}%</span>`)
    .join('');
  fortunaBody.innerHTML = `
    <div style="color:#d4af37;font-weight:bold;font-size:14px;letter-spacing:2px;text-shadow:0 0 4px #d4af3766">💰 FORTUNA SMILES ON THE BOLD</div>
    <div style="font-size:10.5px;color:#cdb98a;line-height:1.4">
      Pay <b style="color:#f0c040">${FORTUNA_GAMBLE_COST}g</b> for a <b>RANDOM REGULAR COMBO TOWER</b>. <b style="color:#ff5050">Higher tier = rarer</b> on a linear ramp:
    </div>
    <div style="font-size:9.5px;color:#aa9a4a;line-height:1.35;margin-top:3px;font-style:italic">
      🚫 Supercombo, Omega, Champion, and combo-of-combo towers are <b style="color:#cc6666">never rolled</b> — those win-condition towers must be crafted through recipes, not bought.
    </div>
    <div style="margin-top:3px">${oddsChips}</div>
    ${winsLog}`;

  const fortunaBuyWrap = document.createElement('div');
  fortunaBuyWrap.style.cssText = `display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;`;
  const fortunaCanAfford = state.gold >= FORTUNA_GAMBLE_COST;
  const fortunaBtn = document.createElement('button');
  fortunaBtn.className = 'merc-buy fortuna-spin-btn';
  // 2026-05 v9: leave clickable so failed click pops the gold tooltip.
  fortunaBtn.textContent = fortunaCanAfford ? `🎰 SPIN ${FORTUNA_GAMBLE_COST}g` : `NEED ${FORTUNA_GAMBLE_COST - state.gold}g`;
  fortunaBtn.style.cssText = `background:${fortunaCanAfford ? '#7a5a14' : '#2a2a2a'};color:${fortunaCanAfford ? '#fff8e0' : '#666'};padding:10px 14px;font-size:12px;font-weight:bold;letter-spacing:1.5px;cursor:${fortunaCanAfford ? 'pointer' : 'not-allowed'};${fortunaCanAfford ? 'box-shadow:0 0 8px rgba(212,175,55,0.6);' : ''}`;

  // Spin animation: cycle through random combo-tower portraits at a
  // decelerating rate (~14 frames). On the LAST frame, paint the actual
  // roll result + flash the card border in the tier color. Then push to
  // pendingPurchasedTowers so the player can place it. The button is
  // disabled mid-spin so the player can't double-roll.
  fortunaBtn.onclick = (ev) => {
    if (state.gold < FORTUNA_GAMBLE_COST) {
      const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      const stageRect = document.getElementById('stage-wrap')?.getBoundingClientRect();
      const ax = stageRect ? r.left + r.width / 2 - stageRect.left : undefined;
      const ay = stageRect ? r.top - stageRect.top : undefined;
      (window as any).__showInsufficientGoldToast?.(FORTUNA_GAMBLE_COST, ax, ay);
      return;
    }
    spendGold(state, FORTUNA_GAMBLE_COST);
    recordMercatorBackRoomPurchase(state, FORTUNA_GAMBLE_COST);
    shop.gambleSpinsThisVisit = (shop.gambleSpinsThisVisit ?? 0) + 1;
    const result = rollFortunaCombo();
    fortunaBtn.disabled = true;
    fortunaBtn.textContent = 'SPINNING...';
    // 14-frame deceleration: short → long intervals.
    const frames = [40, 50, 60, 75, 90, 110, 130, 155, 185, 220, 260, 310, 370, 440];
    let i = 0;
    const tick = () => {
      const randomId = FORTUNA_GAMBLE_POOL[Math.floor(Math.random() * FORTUNA_GAMBLE_POOL.length)];
      const src = imgSrcFromTex(randomId);
      reelImg.innerHTML = src
        ? `<img src="${src}" style="width:72px;height:72px;image-rendering:pixelated"/>`
        : '🎲';
      SFX.buy();
      i++;
      if (i < frames.length) {
        setTimeout(tick, frames[i]);
      } else {
        // Final reveal — paint the actual winner + flash the card.
        const winSrc = imgSrcFromTex(result.type);
        reelImg.innerHTML = winSrc
          ? `<img src="${winSrc}" style="width:72px;height:72px;image-rendering:pixelated;filter:drop-shadow(0 0 6px #d4af37)"/>`
          : '🏆';
        const tierColor = ({ 2:'#b87333', 3:'#c0c0c0', 4:'#ffd34d', 5:'#ff5050' } as any)[result.tier] ?? '#d4af37';
        fortunaCard.style.boxShadow = `0 0 24px ${tierColor}`;
        fortunaCard.style.borderColor = tierColor;
        // Land SFX: triumphant fanfare with rarity scaling.
        const rarity = result.tier === 5 ? 'UNIQUE' : result.tier === 4 ? 'LEGENDARY' : result.tier === 3 ? 'RARE' : 'UNCOMMON';
        SFX.itemPickup(rarity);
        SFX.comboExecuted();
        // Queue the tower for placement (same path as a Mercator T5 buy).
        // 2026-05-25 — Tagged as 'fortuna' (a gamble/bonus win) rather
        // than 'mercator' (a purchase) so the placement-confirm modal
        // labels it accurately as "FORTUNA WIN" instead of "MERCATOR
        // PURCHASE". The downstream placement flow is unchanged.
        if (!state.pendingPurchasedTowers) state.pendingPurchasedTowers = [];
        state.pendingPurchasedTowers.push({ type: result.type, tier: result.tier, source: 'fortuna' });
        shop.gambleWinsThisVisit = [...(shop.gambleWinsThisVisit ?? []), result.type];
        const towerName = (towersData as any)[result.type]?.name ?? result.type.replace(/_/g, ' ');
        state.hint = `🎰 FORTUNA: ${towerName} T${result.tier}! Click an empty tile to place it.`;
        // Re-render after 650ms so the player gets to read the result
        // and see the glow before the panel rebuilds with the next spin.
        setTimeout(refresh, 650);
      }
    };
    tick();
  };

  fortunaBuyWrap.appendChild(fortunaBtn);
  const oddsHint = document.createElement('div');
  oddsHint.style.cssText = `font-size:8.5px;color:#aa9a4a;letter-spacing:1px;text-align:right`;
  oddsHint.innerHTML = `${FORTUNA_GAMBLE_POOL.length} combos<br/>weighted by tier`;
  fortunaBuyWrap.appendChild(oddsHint);

  fortunaCard.appendChild(reel);
  fortunaCard.appendChild(fortunaBody);
  fortunaCard.appendChild(fortunaBuyWrap);
  fortunaSection.appendChild(fortunaCard);
  body.appendChild(fortunaSection);

  // ─── SECTION 3: LIVES ─────────────────────────────────────────────
  const livesSection = document.createElement('div');
  const livesTitle = document.createElement('div');
  livesTitle.className = 'merc-section-title';
  livesTitle.innerHTML = `<span>★ EXTRA LIFE</span><span style="font-size:10px;color:#cdb98a;letter-spacing:1px;font-weight:normal">${shop.livesBoughtThisVisit}/${shop.livesMaxThisVisit} this visit</span>`;
  livesSection.appendChild(livesTitle);
  const livesCard = document.createElement('div');
  livesCard.className = 'merc-card';
  livesCard.style.cssText = `border:2px solid #7a1a1a;padding:10px 14px;background:#0c0a08;display:flex;justify-content:space-between;align-items:center;gap:12px;`;
  const livesCapped = shop.livesBoughtThisVisit >= shop.livesMaxThisVisit;
  const livesCanAfford = state.gold >= shop.livesPrice;
  livesCard.innerHTML = `
    <div>
      <div style="color:#ee5555;font-weight:bold;font-size:14px">❤ +1 LIFE</div>
      <div style="font-size:10.5px;color:#cdb98a;margin-top:3px">Bosses cost 10. Add a cushion before the next one walks in.</div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      <div style="color:#f0c040;font-size:14px;font-weight:bold;margin-bottom:4px">${shop.livesPrice}g</div>
    </div>`;
  const buyLifeBtn = document.createElement('button');
  buyLifeBtn.className = 'merc-buy';
  // 2026-05 v9: leave clickable so failed click pops the gold tooltip
  // (MAX-REACHED stays disabled — different failure mode, not gold).
  buyLifeBtn.disabled = livesCapped;
  buyLifeBtn.textContent = livesCapped ? 'MAX REACHED' : livesCanAfford ? 'BUY LIFE' : 'NEED ' + (shop.livesPrice - state.gold) + 'g';
  buyLifeBtn.style.cssText = `background:${(!livesCapped && livesCanAfford) ? '#7a1a1a' : '#2a2a2a'};color:${(!livesCapped && livesCanAfford) ? '#e8d6a8' : '#666'};cursor:${(!livesCapped && livesCanAfford) ? 'pointer' : 'not-allowed'};`;
  buyLifeBtn.onclick = (ev) => {
    if (shop.livesBoughtThisVisit >= shop.livesMaxThisVisit) return;
    if (state.gold < shop.livesPrice) {
      const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      const stageRect = document.getElementById('stage-wrap')?.getBoundingClientRect();
      const ax = stageRect ? r.left + r.width / 2 - stageRect.left : undefined;
      const ay = stageRect ? r.top - stageRect.top : undefined;
      (window as any).__showInsufficientGoldToast?.(shop.livesPrice, ax, ay);
      return;
    }
    if (state.lives >= ECONOMY.MAX_LIVES) { state.hint = `Lives capped at ${ECONOMY.MAX_LIVES}.`; return; }
    spendGold(state, shop.livesPrice);
    recordMercatorBackRoomPurchase(state, shop.livesPrice);
    state.lives = Math.min(ECONOMY.MAX_LIVES, state.lives + 1);
    shop.livesBoughtThisVisit += 1;
    // 2026-05-22 V33 — Track total lives purchased this run for the
    // end-of-game score penalty. Buying lives is a survival lever but
    // costs ~300 score per life on the leaderboard so the "I bought
    // my way through" run can't outscore the "I held the line" run.
    state.livesBoughtThisRun = (state.livesBoughtThisRun ?? 0) + 1;
    state.hint = '+1 Life.';
    SFX.buy();
    refresh();
  };
  (livesCard.querySelector('div:last-child') as HTMLElement).appendChild(buyLifeBtn);
  livesSection.appendChild(livesCard);
  body.appendChild(livesSection);

  // ── Footer: CLOSE button (sticky bottom) ──────────────────────────
  const footer = document.createElement('div');
  footer.id = 'mercator-shop-footer';
  footer.style.cssText = `background:#0c0a08;border-top:2px solid #5a4a30;padding:10px 18px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0`;
  const footerHint = document.createElement('div');
  footerHint.style.cssText = `font-size:10px;color:#aa9a4a;letter-spacing:1px;font-style:italic`;
  footerHint.textContent = 'Mercator visits next at W' + (() => {
    const next = [4, 9, 14, 19, 23, 27].find(w => w > state.wave);
    return next ?? '— (final visit)';
  })();
  const closeBtn = document.createElement('button');
  closeBtn.className = 'merc-buy';
  closeBtn.textContent = 'CLOSE';
  closeBtn.style.cssText = `background:#444;color:#e8d6a8;padding:8px 18px;font-size:12px`;
  closeBtn.onclick = () => hooks.onClose();
  footer.appendChild(footerHint);
  footer.appendChild(closeBtn);
  panel.appendChild(footer);

  modal.appendChild(panel);
  enhanceModalErgonomics(modal, panel, {
    bodySelector: '#mercator-shop-body',
    footerSelector: '#mercator-shop-footer',
    title: 'Mercator shop',
    onClose: hooks.onClose,
    toolRightPx: 8
  });
  // 2026-05-24 — Backdrop click closes the shop. Per UI audit.
  modal.addEventListener('click', (ev) => {
    if (ev.target === modal) hooks.onClose();
  });
  panel.addEventListener('click', (ev) => ev.stopPropagation());
  parent.appendChild(modal);
}

export function renderShop(parent: HTMLElement, shop: ShopState, state: GameStateShape, inv: InventoryState, hooks: ShopHooks) {
  closeGameModals();
  ensureRecipeBlinkStyle();
  // Refresh in place — used after every purchase so the player doesn't get
  // kicked out of the store. Removes the current modal and re-renders with
  // the same shop/inventory state, so updated counts and remaining offers
  // show without losing context.
  const refresh = () => {
    document.getElementById('shop-modal')?.remove();
    renderShop(parent, shop, state, inv, hooks);
  };
  const isMerc = shop.type === 'MERCATOR';
  // MERCATOR (2026-05 v2): dedicated layout — Towers first, then items,
  // then lives, with a sticky gold/inventory header. Gate shop continues
  // using the original layout below.
  if (isMerc) {
    renderMercatorShop(parent, shop, state, inv, hooks, refresh);
    return;
  }
  const modal = document.createElement('div');
  modal.id = 'shop-modal';
  // Mercator gets a darker, warmer overlay tint to feel like a market tent
  // at dusk; gate shop stays neutral.
  // 2026-05 v6: shop modal now offsets to the LEFT and leaves the right
  // 110px clear so the prospect-building sidebar stays usable. The overlay
  // also stops short of the right edge so the sidebar isn't darkened.
  modal.style.cssText = `position:absolute;left:0;top:0;bottom:0;right:120px;display:flex;align-items:flex-start;justify-content:center;background:${isMerc ? 'radial-gradient(ellipse at center,rgba(58,22,6,0.65),rgba(0,0,0,0.85))' : 'rgba(0,0,0,0.55)'};z-index:50;padding:12px 8px;box-sizing:border-box;font-family:'Courier New',monospace;`;
  const panel = document.createElement('div');
  // Mercator panel: larger, double-bordered, ornate gold accents, decorative
  // top banner with a tent/cart sprite. Gate shop keeps its compact look.
  if (isMerc) {
    panel.style.cssText = `background:linear-gradient(180deg,#2a1a0e,#0c0a08);border:4px solid #d4af37;outline:1px solid #1a1410;color:#fff8e0;padding:0;width:min(920px,96vw);max-height:calc(100% - 8px);overflow:hidden;display:flex;flex-direction:column;box-shadow:0 0 36px rgba(212,175,55,0.45),inset 0 0 24px rgba(0,0,0,0.5);`;
    // Header strip with gold gradient + Mercator portrait/cart icon
    const cartSrc = imgSrcFromTex('MERCATOR_CART') || imgSrcFromTex('MERCATOR');
    const cartHtml = cartSrc ? `<img src="${cartSrc}" style="width:64px;height:64px;image-rendering:pixelated;flex-shrink:0;filter:drop-shadow(2px 2px 0 #000)"/>` : '';
    panel.innerHTML = `
      <div style="background:linear-gradient(90deg,#5a3a16,#d4af37,#5a3a16);padding:14px 18px;display:flex;align-items:center;gap:14px;border-bottom:3px solid #1a1410">
        ${cartHtml}
        <div style="flex:1">
          <div style="font-size:10px;letter-spacing:5px;color:#1a1410;font-weight:bold">★ MERCATOR ★</div>
          <div style="font-size:24px;font-weight:bold;letter-spacing:4px;color:#1a1410;text-shadow:1px 1px 0 #d4af37">TRAVELING ARMORY</div>
          <div style="font-size:11px;color:#3a2010;margin-top:2px;font-style:italic">"Spend well, legate. The next wave will not wait."</div>
        </div>
      </div>
      <div style="padding:14px 18px;overflow:auto;flex:1;background:linear-gradient(180deg,#1a1410,#0c0a08)"></div>`;
  } else {
    // Gate shop panel uses the simpler "let it grow, modal scrolls"
    // pattern. The outer modal already has overflow scroll via padding +
    // align-items:flex-start, so the panel just sets a max-height of 96%
    // of parent (#app) and lets the inner content overflow:auto.
    panel.style.cssText = `background:#1a1410;border:3px solid #d4af37;color:#e8d6a8;padding:14px;width:min(760px,96vw);max-height:calc(100% - 8px);overflow:auto;font-family:'Courier New',monospace;`;
    panel.innerHTML = `<h2 style="margin:0 0 10px;color:#d4af37">GATE SHOP</h2>
      <div style="font-size:12px;margin-bottom:10px;opacity:0.8">Refreshes every 4 waves (W4 / W8 / W12 / W16 / W20 / W24 / W28).</div>`;
  }
  // Where new content (offer list, lives row, tower offers, close btn)
  // appends. For Mercator we use the inner content div; for Gate it's
  // the panel itself so existing layout is preserved.
  const contentRoot = isMerc ? panel.querySelector('div[style*="overflow:auto"]') as HTMLElement : panel;
  // 2026-05-20 v2 — HERO FORGE section. Appears at the top of the gate
  // shop modal whenever the player has a hero placed on the field. Three
  // independent upgrade paths (SHARPEN / HASTEN / EMPOWER), each capped
  // at 5 taps, each with a doubling 46/92/184/368/736g cost ramp.
  // Visible only on the gate shop (not Mercator) — the Mercator vendor
  // stays focused on legendaries + T5 armory.
  if (!isMerc && state.activeHeroTowerId) {
    renderHeroForgeSection(contentRoot, state, refresh);
  }
  // Offers list
  const list = document.createElement('div');
  list.style.cssText = `display:grid;grid-template-columns:1fr 1fr;gap:6px;`;
  for (const offer of shop.offers) {
    const def: any = (consumables as any)[offer.itemId] ?? (items as any)[offer.itemId];
    const card = document.createElement('div');
    card.style.cssText = `border:2px solid ${RARITY_COLOR[offer.rarity]};padding:6px;background:#0c0a08;display:flex;flex-direction:column;gap:4px;`;
    const oneUseTag = offer.isConsumable ? `<span style="font-size:9px;color:#ee9966;letter-spacing:1px;background:#2a1410;border:1px solid #ee9966;padding:1px 4px;margin-left:4px">ONE USE</span>` : '';
    card.innerHTML = `
      <div style="display:flex;gap:8px;align-items:flex-start">
        <div style="flex-shrink:0">${itemIconSvg(offer.itemId, offer.rarity, 36)}</div>
        <div style="flex:1;min-width:0">
          <div style="color:${RARITY_COLOR[offer.rarity]};font-weight:bold;font-size:13px">${def?.name ?? offer.itemId}${oneUseTag}</div>
          <div style="font-size:10px;opacity:0.85">${def?.effect ?? ''}</div>
          <div style="font-size:11px;color:#f0c040">${offer.price}g</div>
        </div>
      </div>`;
    const buyBtn = document.createElement('button');
    buyBtn.textContent = 'BUY';
    buyBtn.style.cssText = `background:#3a5520;color:#e8d6a8;border:1px solid #5a4a30;padding:4px 8px;cursor:pointer;font-family:inherit;font-size:11px;`;
    buyBtn.onclick = (ev) => {
      if (state.gold < offer.price) {
        const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
        const stageRect = document.getElementById('stage-wrap')?.getBoundingClientRect();
        const ax = stageRect ? r.left + r.width / 2 - stageRect.left : undefined;
        const ay = stageRect ? r.top - stageRect.top : undefined;
        (window as any).__showInsufficientGoldToast?.(offer.price, ax, ay);
        state.hint = `Need ${offer.price}g.`;
        return;
      }
      if (inv.slots.length >= INVENTORY_SIZE) { state.hint = 'INVENTORY FULL.'; return; }
      spendGold(state, offer.price);
      inventoryAdd(inv, offer.itemId, offer.rarity, offer.isConsumable, offer.price);
      state.hint = `Bought ${def?.name ?? offer.itemId}.`;
      // Rarity-flavored purchase sound — higher rarities trigger the
      // extra-fanfare branch in SFX.itemPickup.
      SFX.itemPickup(offer.rarity);
      shop.offers = shop.offers.filter(o => o !== offer);
      refresh();
    };
    card.appendChild(buyBtn);
    list.appendChild(card);
  }
  contentRoot.appendChild(list);
  renderTrapSection(contentRoot, state, refresh);
  // STONE RAMPARTS (2026-07-02) — gate shop placement = right below the
  // item offers so the mazing aid is visible from the very first shop visit.
  renderRampartSection(contentRoot, state, refresh, hooks.onClose);
  // Lives purchase
  const livesRow = document.createElement('div');
  livesRow.style.cssText = `margin-top:12px;padding:8px;border:1px dashed #5a4a30;display:flex;justify-content:space-between;align-items:center;`;
  livesRow.innerHTML = `<span>Buy Life: <b style="color:#ee5555">+1 Life</b> for ${shop.livesPrice}g (${shop.livesBoughtThisVisit}/${shop.livesMaxThisVisit} this visit)</span>`;
  const buyLifeBtn = document.createElement('button');
  buyLifeBtn.textContent = 'BUY LIFE';
  buyLifeBtn.style.cssText = `background:#7a1a1a;color:#e8d6a8;border:1px solid #5a4a30;padding:4px 10px;cursor:pointer;font-family:inherit;font-size:11px;`;
  buyLifeBtn.onclick = (ev) => {
    if (shop.livesBoughtThisVisit >= shop.livesMaxThisVisit) { state.hint = 'Life purchase cap reached.'; return; }
    if (state.gold < shop.livesPrice) {
      const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      const stageRect = document.getElementById('stage-wrap')?.getBoundingClientRect();
      const ax = stageRect ? r.left + r.width / 2 - stageRect.left : undefined;
      const ay = stageRect ? r.top - stageRect.top : undefined;
      (window as any).__showInsufficientGoldToast?.(shop.livesPrice, ax, ay);
      state.hint = `Need ${shop.livesPrice}g.`;
      return;
    }
    if (state.lives >= ECONOMY.MAX_LIVES) { state.hint = `Lives capped at ${ECONOMY.MAX_LIVES}. The empire trusts you with no more.`; return; }
    spendGold(state, shop.livesPrice);
    state.lives = Math.min(ECONOMY.MAX_LIVES, state.lives + 1);
    shop.livesBoughtThisVisit += 1;
    // 2026-05-22 V33 — Same run-total tracking on the Mercator path.
    // -300 score per life applies regardless of which shop sold it.
    state.livesBoughtThisRun = (state.livesBoughtThisRun ?? 0) + 1;
    state.hint = '+1 Life.';
    SFX.buy();
    refresh();
  };
  livesRow.appendChild(buyLifeBtn);
  contentRoot.appendChild(livesRow);

  // ─── Mercator: random T5 base tower offers ───────────────────────────────
  if (shop.type === 'MERCATOR' && shop.towerOffers && shop.towerOffers.length > 0) {
    const towerHeader = document.createElement('div');
    towerHeader.style.cssText = `margin-top:14px;padding-bottom:4px;border-bottom:1px solid #5a4a30;color:#d4af37;font-weight:bold;letter-spacing:2px`;
    towerHeader.textContent = '★ TRAVELING ARMORY (place on next empty-tile click)';
    contentRoot.appendChild(towerHeader);
    const tip = document.createElement('div');
    tip.style.cssText = `font-size:10px;color:#cdb98a;margin:4px 0 8px;line-height:1.4`;
    tip.innerHTML = `Buy a T5 base tower to fill a recipe gap. Random refresh next Mercator visit. <b style="color:#cc6666">Recipe-only apex / omega combos (${recipeOnlyComboNames()}) are never offered — earn them through crafting.</b>`;
    contentRoot.appendChild(tip);
    const tList = document.createElement('div');
    tList.style.cssText = `display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;`;
    const TIER_COL: Record<number, string> = { 1:'#aaaaaa', 2:'#b87333', 3:'#c0c0c0', 4:'#ffd34d', 5:'#ff5050' };
    for (const offer of shop.towerOffers) {
      const completesRecipe = purchaseCompletesRecipe(state, offer.type, offer.tier);
      const card = document.createElement('div');
      card.style.cssText = `border:2px solid ${completesRecipe ? '#66ff88' : TIER_COL[offer.tier]};padding:8px;background:${completesRecipe ? '#0c1a10' : '#0c0a08'};display:flex;flex-direction:column;gap:4px;text-align:center;align-items:center;position:relative;`;
      if (completesRecipe) card.classList.add('recipe-ready-card');
      // Pull the real sprite (same texture rendered on the map) so the
      // player can identify the tower at a glance instead of decoding
      // an ALL_CAPS name like "AQUILA VENATOR".
      const spriteSrc = imgSrcFromTex(offer.type);
      const towerDef: any = (towersData as any)[offer.type] ?? {};
      const towerName = towerDef.name ?? offer.type.replace(/_/g,' ');
      const portrait = spriteSrc
        ? `<div style="width:56px;height:56px;border:1px solid ${TIER_COL[offer.tier]};background:#1a1410;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 6px ${TIER_COL[offer.tier]}55"><img src="${spriteSrc}" style="width:48px;height:48px;image-rendering:pixelated" alt="${towerName}"/></div>`
        : `<div style="width:56px;height:56px;border:1px solid ${TIER_COL[offer.tier]};background:#1a1410;color:#cdb98a;font-size:9px;display:flex;align-items:center;justify-content:center;letter-spacing:1px">NO IMG</div>`;
      const recipeBadge = completesRecipe
        ? `<div class="recipe-ready-badge" style="position:absolute;top:-9px;left:50%;transform:translateX(-50%);background:#0c1a10;border:1.5px solid #66ff88;color:#bbffcc;font-size:9px;font-weight:bold;letter-spacing:1px;padding:2px 6px;white-space:nowrap;text-shadow:0 0 4px #66ff88">★ COMPLETES RECIPE</div>`
        : '';
      card.innerHTML = `
        ${recipeBadge}
        <div style="color:${TIER_COL[offer.tier]};font-weight:bold;font-size:13px;letter-spacing:1px">T${offer.tier}</div>
        ${portrait}
        <div style="color:#fff8e0;font-size:11px;font-weight:bold;line-height:1.3">${towerName}</div>
        <div style="color:#f0c040;font-size:11px">${offer.price}g</div>`;
      const buy = document.createElement('button');
      buy.textContent = 'BUY';
      buy.style.cssText = `background:#3a5520;color:#e8d6a8;border:1px solid #5a4a30;padding:4px 6px;cursor:pointer;font-family:inherit;font-size:11px;`;
      buy.onclick = (ev) => {
        if (state.gold < offer.price) {
          const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
          const stageRect = document.getElementById('stage-wrap')?.getBoundingClientRect();
          const ax = stageRect ? r.left + r.width / 2 - stageRect.left : undefined;
          const ay = stageRect ? r.top - stageRect.top : undefined;
          (window as any).__showInsufficientGoldToast?.(offer.price, ax, ay);
          state.hint = `Need ${offer.price}g.`;
          return;
        }
        spendGold(state, offer.price);
        if (!state.pendingPurchasedTowers) state.pendingPurchasedTowers = [];
        state.pendingPurchasedTowers.push({ type: offer.type, tier: offer.tier, source: 'mercator' });
        recordMercatorChampionPurchase(state, offer.type);
        const qLen = state.pendingPurchasedTowers.length;
        state.hint = qLen > 1
          ? `Bought ${towerName(String(offer.type))} T${offer.tier}. ${qLen} towers queued — click empty tiles to place.`
          : `Bought ${towerName(String(offer.type))} T${offer.tier}. Click an empty tile to place it.`;
        // Tier-flavored purchase sound (T1=COMMON, T5=UNIQUE)
        const tierToRarity = ['COMMON','UNCOMMON','RARE','LEGENDARY','UNIQUE'];
        SFX.itemPickup(tierToRarity[Math.max(0, Math.min(4, offer.tier - 1))]);
        // Mercator Champions are one recruit per run. Remove the bought
        // offer immediately; restockMercator also excludes it forever after.
        if (shop.towerOffers) {
          shop.towerOffers = shop.towerOffers.filter(o => o !== offer);
        }
        refresh();
      };
      card.appendChild(buy);
      tList.appendChild(card);
    }
    contentRoot.appendChild(tList);
  }
  // Close
  const closeRow = document.createElement('div');
  closeRow.style.cssText = `margin-top:12px;display:flex;justify-content:flex-end;`;
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'CLOSE';
  closeBtn.style.cssText = `background:#444;color:#e8d6a8;border:1px solid #5a4a30;padding:6px 14px;cursor:pointer;font-family:inherit;font-size:12px;`;
  closeBtn.onclick = () => hooks.onClose();
  closeRow.appendChild(closeBtn);
  contentRoot.appendChild(closeRow);
  modal.appendChild(panel);
  enhanceModalErgonomics(modal, panel, {
    title: 'Gate shop',
    onClose: hooks.onClose
  });
  // 2026-05-24 — Backdrop click closes the Mercator modal.
  modal.addEventListener('click', (ev) => {
    if (ev.target === modal) hooks.onClose();
  });
  panel.addEventListener('click', (ev) => ev.stopPropagation());
  parent.appendChild(modal);
}

export function renderInventoryButton(parent: HTMLElement, inv: InventoryState, hooks: { onOpen: () => void; rampartCount?: number }) {
  let btn = document.getElementById('inventory-button') as HTMLButtonElement | null;
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'inventory-button';
    btn.style.cssText = `font-family:'Courier New',monospace;background:linear-gradient(180deg,#2a1f12,#0c0a08);color:#d4af37;border:2px solid #5a4a30;padding:7px 12px;cursor:pointer;letter-spacing:1px;box-shadow:inset 0 0 8px #000;`;
    const buttons = document.getElementById('buttons');
    buttons?.appendChild(btn);
  }
  const rampartCount = hooks.rampartCount ?? 0;
  const prev = Number(btn.dataset.count ?? inv.slots.length);
  const prevRamparts = Number(btn.dataset.ramparts ?? rampartCount);
  btn.textContent = `INVENTORY ${inv.slots.length}/${INVENTORY_SIZE}${rampartCount > 0 ? ` · RAMPARTS ${rampartCount}` : ''}`;
  btn.title = rampartCount > 0 ? `Open inventory. Stone Ramparts owned: ${rampartCount}` : 'Open inventory';
  btn.onclick = hooks.onOpen;
  if (inv.slots.length > prev) flashInventoryButton(btn, inv.slots[inv.slots.length - 1]);
  if (rampartCount > prevRamparts) flashInventoryButton(btn);
  btn.dataset.count = String(inv.slots.length);
  btn.dataset.ramparts = String(rampartCount);
}

// 2026-05 v10: sell price = half of purchase cost for EVERY item, whether
// purchased from a shop (uses tracked buyPrice) or picked up from a loot
// drop (falls back to items_permanent.json `buy` field, halved). Old
// system used a sub-half rarity-flat schedule for loot drops which felt
// punitive — half-of-buy is the consistent rule the user expects.
// Fallback rarity prices — used only when neither a tracked buyPrice NOR
// an items_permanent.json buy field exists (e.g. legacy consumables).
export const SELL_PRICE: Record<string, number> = {
  COMMON: 10,
  UNCOMMON: 22,
  RARE: 50,
  EPIC: 214,
  LEGENDARY: 407,
  UNIQUE: 250
};

// Compute sell price from an inventory slot. Half-of-buy-price for every
// path:
//   1. Slot has tracked buyPrice (purchased)  → floor(buyPrice / 2)
//   2. Slot has matching items.json entry     → floor(items[id].buy / 2)
//   3. Pure rarity fallback                   → rarity table above (half-derived)
export function inventorySellPrice(rarityOrSlot: any): number {
  if (typeof rarityOrSlot === 'string') return SELL_PRICE[rarityOrSlot] ?? 2;
  const slot = rarityOrSlot as { rarity: string; buyPrice?: number; itemId?: string; sellLockedReason?: string };
  if (slot.sellLockedReason) return 0;
  if (slot.buyPrice && slot.buyPrice > 0) return Math.max(1, Math.floor(slot.buyPrice / 2));
  // Fallback: look up the items.json buy price for this itemId.
  const baseBuy = slot.itemId ? itemBuyPrice(slot.itemId) : undefined;
  if (baseBuy && baseBuy > 0) return Math.max(1, Math.floor(baseBuy / 2));
  return SELL_PRICE[slot.rarity] ?? 2;
}

export function showInventoryModal(parent: HTMLElement, inv: InventoryState, state: GameStateShape, hooks: { onSell: (idx: number) => void; onClose: () => void }) {
  closeGameModals();
  hideInventoryItemTooltip();
  const closeInventory = () => {
    hideInventoryItemTooltip();
    hooks.onClose();
  };
  const modal = document.createElement('div');
  modal.id = 'inventory-modal';
  // 2026-07-09 — Inventory containment. The modal frame itself stays fixed;
  // the variable-height shelves/grid/detail area scrolls inside the yellow
  // Armarium border so empty slots and the inspect panel never spill onto
  // the map outside the frame.
  modal.style.cssText = `position:fixed;inset:0;display:flex;align-items:flex-start;justify-content:center;background:rgba(0,0,0,0.55);z-index:100000;pointer-events:auto;padding:16px 8px;box-sizing:border-box;overflow:hidden;font-family:'Courier New',monospace;`;
  const panel = document.createElement('div');
  panel.style.cssText = `position:relative;z-index:1;width:min(680px,96vw);height:min(960px,calc(100vh - 16px));max-height:calc(100vh - 16px);box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;background:linear-gradient(180deg,#241a12,#0c0a08);border:3px solid #d4af37;color:#e8d6a8;box-shadow:0 0 28px #000;padding:14px;`;
  const ownedRamparts = rampartsOwned(state);
  panel.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex:0 0 auto">
    <div><div style="font-size:18px;color:#d4af37;font-weight:bold;letter-spacing:3px">ARMARIUM</div><div style="font-size:11px;color:#aa9a4a;letter-spacing:1px">ITEM VAULT ${inv.slots.length}/${INVENTORY_SIZE}${ownedRamparts > 0 ? ` · RAMPARTS ${ownedRamparts}` : ''}</div></div>
    <div style="font-size:11px;color:#cdb98a;text-align:right;max-width:240px;line-height:1.4">Click an item to inspect it.<br/>Click traps or ramparts to arm placement.</div>
  </div>`;
  const body = document.createElement('div');
  body.id = 'inventory-scroll-body';
  body.style.cssText = `flex:1 1 auto;min-height:0;overflow:auto;padding-right:4px;box-sizing:border-box;scrollbar-gutter:stable both-edges;`;
  body.addEventListener('scroll', hideInventoryItemTooltip, { passive: true });
  panel.appendChild(body);

  // Selection state: which slot is currently selected.
  let selectedIdx = -1;

  if (ownedRamparts > 0) {
    const rampShelf = document.createElement('div');
    rampShelf.style.cssText = `margin-bottom:12px;padding:10px;background:#100c09;border:2px solid #5a4a30;`;
    const rampHead = document.createElement('div');
    rampHead.style.cssText = `display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;`;
    rampHead.innerHTML = `
      <div style="font-size:12px;color:#d4af37;font-weight:bold;letter-spacing:2px">RAMPARTS</div>
      <div style="font-size:10px;color:#aa9a4a;letter-spacing:1px;text-align:right">CLICK TO ARM · ROTATE TRAY + R KEY · BUILD PHASE ONLY</div>
    `;
    rampShelf.appendChild(rampHead);
    const selected = !!state.selectedRampart;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = `width:100%;min-height:64px;background:${selected ? 'linear-gradient(180deg,#3a2a14,#1a1208)' : 'linear-gradient(180deg,#1a1410,#100c09)'};border:${selected ? '3px solid #ffd34d' : '2px solid #8a8a92'};color:#e8d6a8;padding:8px;display:flex;align-items:center;gap:10px;cursor:pointer;font-family:inherit;text-align:left;box-shadow:${selected ? '0 0 14px rgba(255,211,77,0.45)' : 'inset 0 0 10px #000'};`;
    const stripSrc = imgSrcFromTex('RAMPART_STRIP');
    const icon = stripSrc
      ? `<img src="${stripSrc}" style="width:54px;height:14px;image-rendering:pixelated;flex-shrink:0"/>`
      : `<div style="display:flex;gap:2px;flex-shrink:0">${'<div style="width:9px;height:9px;background:#8a8a92;border:1px solid #3a3a40"></div>'.repeat(5)}</div>`;
    btn.innerHTML = `
      <div style="width:62px;height:42px;border:1px solid #8a8a92;background:#1a1410;display:flex;align-items:center;justify-content:center;flex-shrink:0">${icon}</div>
      <div style="min-width:0;line-height:1.25;flex:1">
        <div style="font-size:12px;color:#fff8e0;font-weight:bold">Stone Rampart</div>
        <div style="font-size:10px;color:#cdb98a;margin-top:2px">Places 5 wall stones in one line. Hover preview, rotate, click to confirm.</div>
      </div>
      <div style="font-size:13px;color:#88ff88;font-weight:bold;letter-spacing:1px">x${ownedRamparts}</div>
    `;
    btn.title = 'Stone Rampart\nClick to arm. A rotate tray appears with horizontal, vertical, diagonal down, and diagonal up. Hover for a five-tile preview, then click a valid tile or road.';
    btn.onclick = () => {
      if (!armRampartFromInventory(state, state.selectedRampart ?? 'H')) return;
      state.hint = `Rampart armed (${RAMPART_ORIENT_LABEL[state.selectedRampart!]}). Use the rotate tray or R, hover for preview, then click a valid tile or road to confirm.`;
      hooks.onClose();
    };
    rampShelf.appendChild(btn);
    body.appendChild(rampShelf);
  }

  const ownedTrapIds = TRAP_IDS.filter(tid => ((state.trapInventory ?? {})[tid] ?? 0) > 0);
  if (ownedTrapIds.length > 0) {
    const trapPlacementLocked = !canDeployTraps(state);
    const trapShelf = document.createElement('div');
    trapShelf.style.cssText = `margin-bottom:12px;padding:10px;background:#100c09;border:2px solid #4a3a24;`;
    const trapHead = document.createElement('div');
    trapHead.style.cssText = `display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;`;
    trapHead.innerHTML = `
      <div style="font-size:12px;color:#d4af37;font-weight:bold;letter-spacing:2px">TRAPS</div>
      <div style="font-size:10px;color:${trapPlacementLocked ? '#ff8877' : '#aa9a4a'};letter-spacing:1px;text-align:right">${trapPlacementLocked ? 'PLACEMENT LOCKED DURING WAVES' : 'CLICK TO ARM · DEPLOYED TRAPS EXPIRE AT WAVE END'}</div>
    `;
    trapShelf.appendChild(trapHead);
    const trapGrid = document.createElement('div');
    trapGrid.style.cssText = `display:grid;grid-template-columns:repeat(auto-fit,minmax(126px,1fr));gap:8px;`;
    for (const tid of ownedTrapIds) {
      const def = TRAP_DEFS[tid];
      const owned = (state.trapInventory ?? {})[tid] ?? 0;
      const selected = state.selectedTrapType === tid;
      const colHex = '#' + def.color.toString(16).padStart(6, '0');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.disabled = trapPlacementLocked;
      btn.style.cssText = `min-height:58px;background:${selected ? 'linear-gradient(180deg,#3a2a14,#1a1208)' : 'linear-gradient(180deg,#1a1410,#100c09)'};border:${selected ? '3px solid #ffd34d' : `2px solid ${colHex}`};color:#e8d6a8;padding:6px;display:flex;align-items:center;gap:8px;cursor:${trapPlacementLocked ? 'not-allowed' : 'pointer'};font-family:inherit;text-align:left;box-shadow:${selected ? '0 0 14px rgba(255,211,77,0.45)' : 'inset 0 0 10px #000'};opacity:${trapPlacementLocked ? '0.52' : '1'};`;
      const src = imgSrcFromTex(def.spriteKey);
      const icon = src
        ? `<img src="${src}" style="width:36px;height:36px;image-rendering:pixelated;flex-shrink:0"/>`
        : `<div style="width:36px;height:36px;border:1px solid ${colHex};flex-shrink:0"></div>`;
      btn.innerHTML = `
        ${icon}
        <div style="min-width:0;line-height:1.2">
          <div style="font-size:11px;color:#fff8e0;font-weight:bold;white-space:normal">${def.name}</div>
          <div style="font-size:10px;color:#88ff88;margin-top:2px">x${owned}</div>
        </div>
      `;
      btn.title = trapPlacementLocked
        ? `${def.name}\nTraps can only be armed and placed between waves.`
        : `${def.name}\n${def.blurb}\nClick to arm`;
      btn.onclick = () => {
        if (!armTrapFromInventory(state, tid)) return;
        state.hint = `${def.name} armed. Click empty tiles to place one at a time.`;
        hooks.onClose();
      };
      trapGrid.appendChild(btn);
    }
    trapShelf.appendChild(trapGrid);
    body.appendChild(trapShelf);
  }

  // 2026-05 v11 (B4 Inventory sort + filter): controls row above the grid.
  // Sort dropdown reorders slots via CSS `order`; family chips hide
  // non-matching slots via `display: none`. Empty slots float to the end.
  // State persists within this modal session only.
  const RARITY_ORDER: Record<string, number> = { LEGENDARY: 0, UNIQUE: 1, EPIC: 2, RARE: 3, UNCOMMON: 4, COMMON: 5 };
  const controls = document.createElement('div');
  controls.style.cssText = `display:flex;gap:8px;align-items:center;margin-bottom:10px;font-size:11px;color:#cdb98a;letter-spacing:1px;flex-wrap:wrap;`;
  const sortLabel = document.createElement('span');
  sortLabel.textContent = 'SORT';
  sortLabel.style.cssText = 'color:#aa9a4a;letter-spacing:2px';
  const sortSel = document.createElement('select');
  sortSel.style.cssText = `background:#0c0a08;border:1px solid #5a4a30;color:#e8d6a8;font-family:inherit;font-size:11px;padding:4px 6px;cursor:pointer`;
  ['RARITY', 'FAMILY', 'NAME', 'BUY PRICE'].forEach(opt => {
    const o = document.createElement('option'); o.value = opt; o.text = opt;
    sortSel.appendChild(o);
  });
  controls.appendChild(sortLabel); controls.appendChild(sortSel);
  const filterLabel = document.createElement('span');
  filterLabel.textContent = '· FAMILY';
  filterLabel.style.cssText = 'color:#aa9a4a;letter-spacing:2px;margin-left:6px';
  controls.appendChild(filterLabel);
  let activeFamily = 'ALL';
  const FAMILIES = ['ALL', 'DAMAGE', 'SPEED', 'RANGE', 'DOT', 'AURA', 'ECONOMY', 'DEFENSE', 'SPECIAL'];
  const chipEls: HTMLButtonElement[] = [];
  FAMILIES.forEach(fam => {
    const chip = document.createElement('button');
    chip.textContent = fam;
    chip.style.cssText = `background:${fam === 'ALL' ? '#5a3a14' : '#222'};color:${fam === 'ALL' ? '#ffd34d' : '#cdb98a'};border:1px solid #5a4a30;padding:2px 8px;cursor:pointer;font-family:inherit;font-size:10px;letter-spacing:1px`;
    chip.onclick = () => {
      activeFamily = fam;
      chipEls.forEach(c => {
        const active = c.textContent === activeFamily;
        c.style.background = active ? '#5a3a14' : '#222';
        c.style.color = active ? '#ffd34d' : '#cdb98a';
      });
      applyInventorySort();
    };
    chipEls.push(chip);
    controls.appendChild(chip);
  });
  body.appendChild(controls);

  const grid = document.createElement('div');
  grid.style.cssText = `display:grid;grid-template-columns:repeat(5,72px);grid-template-rows:repeat(5,72px);gap:6px;justify-content:center;padding:12px;background:#0c0a08;border:2px solid #5a4a30;box-shadow:inset 0 0 18px #000;`;

  // Detail panel under the grid — populated on selection.
  const detail = document.createElement('div');
  detail.style.cssText = `margin-top:12px;padding:14px;background:#120c08;border:2px solid #3a3025;min-height:96px;display:flex;align-items:center;justify-content:space-between;gap:14px`;

  const renderDetail = () => {
    detail.innerHTML = '';
    if (selectedIdx < 0 || !inv.slots[selectedIdx]) {
      detail.innerHTML = `<div style="opacity:0.55;font-size:12px;letter-spacing:1px;text-align:center;width:100%">SELECT AN ITEM TO INSPECT</div>`;
      return;
    }
    const itm = inv.slots[selectedIdx];
    const def: any = (consumables as any)[itm.itemId] ?? (items as any)[itm.itemId];
    const color = RARITY_COLOR[itm.rarity];
    const sellPrice = inventorySellPrice(itm);
    const saleLocked = !!itm.sellLockedReason;
    const left = document.createElement('div');
    left.style.cssText = `flex:1;min-width:0;display:flex;gap:12px;align-items:flex-start`;
    const oneUseNote = isConsumable(itm.itemId)
      ? '<div style="font-size:10px;color:#ee9966;letter-spacing:2px;margin:0 0 6px;font-weight:bold">⚠ ONE USE — CONSUMED ON USE</div>'
      : '';
    left.innerHTML = `
      <div style="flex-shrink:0">${itemIconSvg(itm.itemId, itm.rarity, 56)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:bold;color:${color};letter-spacing:1px">${def?.name ?? itm.itemId}</div>
        <div style="font-size:10px;color:${color};opacity:0.85;letter-spacing:2px;margin:2px 0 6px">${itm.rarity}${isConsumable(itm.itemId) ? ' · CONSUMABLE' : ''}</div>
        ${oneUseNote}
        ${saleLocked ? `<div style="font-size:10px;color:#ffd34d;letter-spacing:1px;margin:0 0 6px;font-weight:bold">★ ${itm.sellLockedReason}</div>` : ''}
        <div style="font-size:11px;color:#cdb98a;line-height:1.5">${def?.effect ?? ''}</div>
      </div>
    `;
    const right = document.createElement('div');
    right.style.cssText = `display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0`;
    const priceLabel = document.createElement('div');
    priceLabel.style.cssText = `font-size:11px;color:#f0c040;letter-spacing:1px`;
    priceLabel.innerHTML = saleLocked
      ? '<b style="font-size:12px;color:#ffd34d">NOT FOR SALE</b>'
      : `SELL VALUE: <b style="font-size:14px">${sellPrice}g</b>`;
    const sellBtn = document.createElement('button');
    // 2026-05 v11 BUGFIX: previously only blocked WAVE_PHASE; now mirrors
    // the actual sell handler's `isPreWavePhase()` gate (BUILD_PHASE,
    // PROSPECT_PLACEMENT, PICK_KEEPER all OK; WAVE/GAME_OVER/VICTORY blocked).
    // 0=BUILD_PHASE 4=PROSPECT_PLACEMENT 5=PICK_KEEPER per GamePhase enum.
    const canSell = !saleLocked && (state.phase === 0 || state.phase === 4 || state.phase === 5);
    sellBtn.textContent = saleLocked ? 'CEREMONIAL GIFT' : `SELL FOR ${sellPrice}g`;
    sellBtn.disabled = !canSell;
    sellBtn.style.cssText = `background:linear-gradient(180deg,#aa1818,#660808);color:#ffe6e6;border:2px solid #ff5050;padding:9px 16px;cursor:${canSell ? 'pointer' : 'not-allowed'};font-family:inherit;font-size:13px;font-weight:bold;letter-spacing:2px;text-shadow:1px 1px 0 #000;box-shadow:0 0 12px rgba(255,80,80,0.35);transition:transform 0.08s,filter 0.1s;${canSell ? '' : 'opacity:0.4;'}`;
    sellBtn.onmouseenter = () => { if (canSell) sellBtn.style.filter = 'brightness(1.25)'; };
    sellBtn.onmouseleave = () => { sellBtn.style.filter = 'brightness(1)'; };
    sellBtn.onclick = () => {
      if (!canSell) return;
      hooks.onSell(selectedIdx);
    };
    right.appendChild(priceLabel);
    right.appendChild(sellBtn);
    detail.appendChild(left);
    detail.appendChild(right);
  };

  for (let i = 0; i < INVENTORY_SIZE; i++) {
    const slot = document.createElement('div');
    const itm = inv.slots[i];
    const color = itm ? RARITY_COLOR[itm.rarity] : '#3a3025';
    const isSel = i === selectedIdx;
    const setStyle = (selected: boolean) => {
      slot.style.cssText = `width:72px;height:72px;border:${selected ? '3px solid #ffd34d' : `2px solid ${color}`};background:${selected ? 'linear-gradient(180deg,#3a2a14,#1a1208)' : 'linear-gradient(180deg,#1a1410,#100c09)'};display:flex;align-items:center;justify-content:center;font-size:12px;color:${color};cursor:${itm ? 'pointer' : 'default'};text-align:center;line-height:1.1;padding:6px;box-shadow:${selected ? '0 0 14px rgba(255,211,77,0.55)' : 'inset 0 0 10px #000'};`;
    };
    setStyle(isSel);
    if (itm) {
      const def: any = (consumables as any)[itm.itemId] ?? (items as any)[itm.itemId];
      slot.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">${itemIconSvg(itm.itemId, itm.rarity, 44)}${isConsumable(itm.itemId) ? '<div style="font-size:7px;color:#ee9966;letter-spacing:1px;line-height:1">1×</div>' : ''}</div>`;
      attachInventoryItemTooltip(slot, itm, def);
      slot.onclick = () => {
        // Update selection: clear previous highlight, mark this one.
        const prev = grid.querySelectorAll<HTMLDivElement>('[data-inv-slot]');
        selectedIdx = i;
        prev.forEach((el, idx) => {
          const it = inv.slots[idx];
          const c = it ? RARITY_COLOR[it.rarity] : '#3a3025';
          const sel = idx === selectedIdx;
          el.style.cssText = `width:72px;height:72px;border:${sel ? '3px solid #ffd34d' : `2px solid ${c}`};background:${sel ? 'linear-gradient(180deg,#3a2a14,#1a1208)' : 'linear-gradient(180deg,#1a1410,#100c09)'};display:flex;align-items:center;justify-content:center;font-size:12px;color:${c};cursor:${it ? 'pointer' : 'default'};text-align:center;line-height:1.1;padding:6px;box-shadow:${sel ? '0 0 14px rgba(255,211,77,0.55)' : 'inset 0 0 10px #000'};`;
        });
        renderDetail();
      };
    }
    slot.dataset.invSlot = String(i);
    grid.appendChild(slot);
  }
  body.appendChild(grid);
  body.appendChild(detail);
  renderDetail();

  // Apply sort + filter: reorder via CSS `order`, hide non-matching via display:none.
  // Empty slots always float to the end regardless of sort mode.
  const applyInventorySort = () => {
    const slots = grid.querySelectorAll<HTMLDivElement>('[data-inv-slot]');
    const mode = sortSel.value;
    type Row = { idx: number; itm: any; primary: string | number; familyOk: boolean };
    const rows: Row[] = [];
    slots.forEach((_el, idx) => {
      const itm = inv.slots[idx];
      let primary: string | number = idx;
      let familyOk = true;
      if (itm) {
        const def: any = (consumables as any)[itm.itemId] ?? (items as any)[itm.itemId];
        const fam = itemFamily(itm.itemId) ?? 'SPECIAL';
        // 2026-05 v9: DoT sub-families (DOT_BURN/POISON/BLEED) all match
        // the player-facing "DOT" chip — the split is mechanical, not UX.
        const matchesDot = activeFamily === 'DOT' && fam.startsWith('DOT_');
        familyOk = activeFamily === 'ALL' || fam === activeFamily || matchesDot;
        switch (mode) {
          case 'RARITY':
            primary = (RARITY_ORDER[itm.rarity] ?? 9) * 1000 + idx;
            break;
          case 'FAMILY':
            primary = fam + String(idx).padStart(3, '0');
            break;
          case 'NAME':
            primary = (def?.name ?? itm.itemId).toString().toUpperCase();
            break;
          case 'BUY PRICE':
            // descending: most expensive first
            primary = -itemBuyPrice(itm.itemId) * 1000 + idx;
            break;
        }
      } else {
        // Empty slots float to end.
        primary = mode === 'NAME' || mode === 'FAMILY' ? '~~~~~' : 9999999;
      }
      rows.push({ idx, itm, primary, familyOk });
    });
    rows.sort((a, b) => {
      // Empty slots always last
      if (!a.itm && !b.itm) return a.idx - b.idx;
      if (!a.itm) return 1;
      if (!b.itm) return -1;
      if (typeof a.primary === 'number' && typeof b.primary === 'number') return a.primary - b.primary;
      return String(a.primary).localeCompare(String(b.primary));
    });
    rows.forEach((row, order) => {
      const el = slots[row.idx];
      if (!el) return;
      el.style.order = String(order);
      // Hide non-matching item slots; empty slots always visible (so they look uniform).
      if (row.itm && !row.familyOk) {
        el.style.display = 'none';
      } else {
        el.style.display = '';
      }
    });
  };
  sortSel.onchange = applyInventorySort;
  // Apply initial sort (default RARITY, ALL families).
  applyInventorySort();

  const closeRow = document.createElement('div');
  closeRow.id = 'inventory-footer';
  closeRow.style.cssText = 'display:flex;justify-content:flex-end;margin-top:12px;flex:0 0 auto';
  const close = document.createElement('button');
  close.textContent = 'CLOSE';
  close.style.cssText = `background:#444;color:#e8d6a8;border:1px solid #5a4a30;padding:7px 14px;cursor:pointer;font-family:inherit;font-size:12px;`;
  close.onclick = closeInventory;
  closeRow.appendChild(close);
  panel.appendChild(closeRow);
  modal.appendChild(panel);
  enhanceModalErgonomics(modal, panel, {
    bodySelector: '#inventory-scroll-body',
    footerSelector: '#inventory-footer',
    title: 'Inventory',
    onClose: closeInventory
  });
  // 2026-05-24 — Backdrop click closes the inventory modal.
  modal.addEventListener('click', (ev) => {
    if (ev.target === modal) closeInventory();
  });
  panel.addEventListener('click', (ev) => ev.stopPropagation());
  // Mount at body level so the transformed stage wrapper can never sit
  // above the inventory and swallow item clicks.
  (document.body ?? parent).appendChild(modal);
}

function flashInventoryButton(btn: HTMLButtonElement, itm?: { itemId: string; rarity: string }) {
  const color = itm ? RARITY_COLOR[itm.rarity] : '#ffd34d';
  // Ensure positioning context so the overlay siblings anchor to the button.
  if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative';
  btn.style.borderColor = color;
  btn.style.boxShadow = `0 0 18px ${color}, inset 0 0 8px #000`;
  // 1. Button itself: bounce + brighten.
  btn.animate([
    { transform: 'scale(1)',    filter: 'brightness(1)' },
    { transform: 'scale(1.14)', filter: 'brightness(1.7)' },
    { transform: 'scale(1)',    filter: 'brightness(1)' }
  ], { duration: 620, easing: 'ease-out' });
  // 2. Radiating ring overlay — a hollow square that scales outward and
  // fades. Subtle: doesn't block any clicks, never persists.
  const ring = document.createElement('div');
  ring.style.cssText = `position:absolute;inset:-4px;border:2px solid ${color};pointer-events:none;border-radius:2px;`;
  btn.appendChild(ring);
  ring.animate([
    { transform: 'scale(1)',   opacity: 0.95 },
    { transform: 'scale(1.6)', opacity: 0 }
  ], { duration: 720, easing: 'cubic-bezier(.2,.7,.4,1)' });
  setTimeout(() => ring.remove(), 760);
  // 3. Floating "+1" tag — drifts up from above the button, fades.
  const plus = document.createElement('div');
  plus.textContent = '+1';
  plus.style.cssText = `position:absolute;top:-4px;right:-4px;color:${color};font-family:'Courier New',monospace;font-size:13px;font-weight:bold;text-shadow:1px 1px 0 #000;pointer-events:none;`;
  btn.appendChild(plus);
  plus.animate([
    { transform: 'translateY(0px) scale(1)',     opacity: 1 },
    { transform: 'translateY(-22px) scale(1.2)', opacity: 0 }
  ], { duration: 900, easing: 'ease-out' });
  setTimeout(() => plus.remove(), 940);
  // 4. Reset the button chrome after the animation completes.
  setTimeout(() => {
    btn.style.borderColor = '#5a4a30';
    btn.style.boxShadow = 'inset 0 0 8px #000';
  }, 800);
}
