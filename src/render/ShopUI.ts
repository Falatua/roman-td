import { ShopState, FORTUNA_GAMBLE_COST, FORTUNA_GAMBLE_POOL, rollFortunaCombo, getFortunaTierOdds } from '../systems/MerchantSystem';
import { GameStateShape } from '../GameState';
import { INVENTORY_SIZE, ECONOMY } from '../constants';
import { SFX } from './AudioManager';
import { spendGold } from '../systems/EconomySystem';
import { InventoryState, inventoryAdd, isConsumable } from '../systems/LootSystem';
import items from '../data/items_permanent.json';
import consumables from '../data/items_consumable.json';
import towersData from '../data/towers.json';
import { closeGameModals } from './ModalManager';
import { itemIconSvg } from './ItemIcon';
import { tex } from './Assets';
import { purchaseCompletesRecipe } from '../systems/CombinationEngine';
import { itemFamily } from '../systems/ItemRules';
import { markScrollable } from './ScrollCues';
import { HERO_FORGE_CAP, heroForgeNextCost } from '../systems/HeroSystem';

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
  const t = tex(key);
  if (!t) return null;
  const res: any = t.baseTexture?.resource;
  return res?.src ?? res?.url ?? (t as any).__srcPath ?? null;
}

// ─── HERO FORGE SECTION (2026-05-20 v2) ──────────────────────────────
// Pay-to-upgrade hero system at the gate shop. Renders a 3-button row:
//   ⚔ SHARPEN  — +6% basic-attack damage / tap (5 cap)
//   ⏱ HASTEN   — −5% ability cooldown / tap  (5 cap)
//   ✨ EMPOWER  — +5% to all numeric ability magnitudes / tap (5 cap)
// Each path has its own cost ramp (V25: 30/60/120/240/480g —
// doubling from 30g) and own stack counter; the three paths don't share
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
    effect: '+6% damage to your hero\'s basic attack per tap.',
    maxedAt5: '5/5 stacks → +30% hero DPS.',
    bestFor: 'Best for hitter heroes whose basic attack is the carry — Scipio, Caesar, Marius.'
  },
  {
    key: 'cd', label: 'HASTEN', icon: '⏱', tint: '#5a9fff',
    headline: 'ABILITY COOLDOWN',
    effect: '−5% cooldown on every ability per tap (compounding).',
    maxedAt5: '5/5 stacks → cooldowns at 0.77× (≈23% faster cycle).',
    bestFor: 'Best for caster heroes — Marius (Triarii Wall), Sulla (Proscription), Caesar (Pax Romana). Drops the time between ability windows so the wave never gets a quiet moment.'
  },
  {
    key: 'aura', label: 'EMPOWER', icon: '✨', tint: '#ffd34d',
    headline: 'ABILITY STRENGTH',
    effect: '+5% to every numeric magnitude inside every ability per tap (damage multipliers, slow %, stun durations, execute thresholds, heal amounts).',
    maxedAt5: '5/5 stacks → +25% to all ability magnitudes.',
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
    <div style="margin-top:6px;padding-top:4px;border-top:1px solid #3a3025;color:#aa9a4a;font-size:10px;letter-spacing:1px">Cost ramp: 30g · 60g · 120g · 240g · 480g · MAXED</div>`;
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
      <div style="font-size:10px;letter-spacing:4px;font-weight:bold;color:${heroTint}">⚒ HERO FORGE · ${heroName.toUpperCase()}</div>
      <div style="font-size:9px;color:#aa9a4a;letter-spacing:1px">Independent of XP/tier</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">${buttonsHtml}</div>
    <div style="margin-top:6px;font-size:10px;color:#aa9a4a;line-height:1.45">Pays gold to upgrade your hero. Each tap raises the next cost on THAT path only (the other two stay cheap). Lost on hero destruction — 50% gold refund when you draft a new hero.</div>`;
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
          try { (SFX as any).uiCancel?.(); } catch { /* ignore */ }
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
  panel.style.cssText = `background:linear-gradient(180deg,#2a1a0e,#0c0a08);border:4px solid #d4af37;outline:1px solid #1a1410;color:#fff8e0;padding:0;width:min(680px,94vw);max-height:96%;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 0 36px rgba(212,175,55,0.45),inset 0 0 24px rgba(0,0,0,0.5);`;

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
  body.style.cssText = `padding:14px 18px;overflow:auto;flex:1;background:linear-gradient(180deg,#1a1410,#0c0a08);display:flex;flex-direction:column;gap:18px`;
  panel.appendChild(body);
  markScrollable(body);

  // ─── SECTION 1: TOWERS (the reason this vendor exists) ───────────
  if (shop.towerOffers && shop.towerOffers.length > 0) {
    const towersSection = document.createElement('div');
    const towersTitle = document.createElement('div');
    towersTitle.className = 'merc-section-title';
    towersTitle.innerHTML = `<span>★ TRAVELING ARMORY — T5 TOWERS</span><span style="font-size:10px;color:#cdb98a;letter-spacing:1px;font-weight:normal">flat 50g · click empty tile to place</span>`;
    towersSection.appendChild(towersTitle);
    // 2026-05 v9 — disclaim apex super-combos are NOT in this pool.
    const towersNote = document.createElement('div');
    towersNote.style.cssText = `font-size:9.5px;color:#aa9a4a;line-height:1.35;margin:2px 0 8px;font-style:italic`;
    towersNote.innerHTML = `Base + early/mid combo towers only. <b style="color:#cc6666">Apex super-combos are never sold</b> — craft Imperium Eternum, Carthage Scourge, Triumvirate, Legion Prime, and Consular Fatebinder through recipes.`;
    towersSection.appendChild(towersNote);

    const tList = document.createElement('div');
    tList.style.cssText = `display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;`;
    for (const offer of shop.towerOffers) {
      const completesRecipe = purchaseCompletesRecipe(state, offer.type, offer.tier);
      const card = document.createElement('div');
      card.className = 'merc-card' + (completesRecipe ? ' recipe-ready-card' : '');
      card.style.cssText = `border:2px solid ${completesRecipe ? '#66ff88' : TIER_COL[offer.tier]};padding:10px 8px 8px;background:${completesRecipe ? '#0c1a10' : '#0c0a08'};display:flex;flex-direction:column;gap:4px;text-align:center;align-items:center;position:relative;`;
      const spriteSrc = imgSrcFromTex(offer.type);
      const towerDef: any = (towersData as any)[offer.type] ?? {};
      const towerName = towerDef.name ?? offer.type.replace(/_/g,' ');
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
      const ability = (towerDef.ability ?? '').replace(/"/g, "'");
      card.innerHTML = `
        ${recipeBadge}
        <div style="color:${TIER_COL[offer.tier]};font-weight:bold;font-size:13px;letter-spacing:2px">T${offer.tier}</div>
        ${portrait}
        <div style="color:#fff8e0;font-size:12px;font-weight:bold;line-height:1.25;margin-top:2px">${towerName}</div>
        <div style="display:flex;gap:6px;font-size:9px;color:#cdb98a;letter-spacing:0.5px">
          <span title="Base DPS">⚔ ${dps}</span>
          <span title="Attack Speed">⏱ ${atkText}</span>
          <span title="Range (tiles)">◎ ${range}t</span>
        </div>
        <div style="font-size:9.5px;color:#cdb98a;line-height:1.35;margin-top:3px;min-height:34px">${ability}</div>
        <div style="color:#f0c040;font-size:12px;font-weight:bold;margin-top:2px">${offer.price}g</div>`;
      const canAfford = state.gold >= offer.price;
      const buy = document.createElement('button');
      buy.textContent = canAfford ? 'BUY' : 'NEED ' + (offer.price - state.gold) + 'g';
      // 2026-05 v9: leave the button CLICKABLE even when unaffordable so the
      // failed click pops the floating insufficient-gold tooltip. Disabled
      // buttons swallow the click silently — that wasn't enough feedback.
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
        if (!state.pendingPurchasedTowers) state.pendingPurchasedTowers = [];
        state.pendingPurchasedTowers.push({ type: offer.type, tier: offer.tier, source: 'mercator' });
        const qLen = state.pendingPurchasedTowers.length;
        state.hint = qLen > 1
          ? `Bought ${offer.type.replace(/_/g,' ')} T${offer.tier}. ${qLen} towers queued — click empty tiles to place.`
          : `Bought ${offer.type.replace(/_/g,' ')} T${offer.tier}. Click an empty tile to place it.`;
        SFX.itemPickup(tierToRarity[Math.max(0, Math.min(4, offer.tier - 1))]);
        if (shop.towerOffers) shop.towerOffers = shop.towerOffers.filter(o => o !== offer);
        refresh();
      };
      card.appendChild(buy);
      tList.appendChild(card);
    }
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
      const def: any = isConsumable(offer.itemId) ? (consumables as any)[offer.itemId] : (items as any)[offer.itemId];
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

  // ─── SECTION 2.5: FORTUNA'S WHEEL — 500g combo-tower gamble ───────
  // Pure RNG. 500g per spin. Random pick from all 34 COMBO towers in
  // the game (T2-T5 mixed pool, uniform odds). Designed as a "splurge"
  // option — the player pays a hefty premium for the lottery thrill of
  // possibly landing an apex T5 they couldn't have built from their
  // current prospect line. No cap on spins.
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
      Pay <b style="color:#f0c040">${FORTUNA_GAMBLE_COST}g</b> for a <b>RANDOM EARLY/MID COMBO TOWER</b>. <b style="color:#ff5050">Higher tier = rarer</b> on a linear ramp:
    </div>
    <div style="font-size:9.5px;color:#aa9a4a;line-height:1.35;margin-top:3px;font-style:italic">
      🚫 Apex super-combos (Imperium Eternum, Carthage Scourge, Triumvirate, Legion Prime, Consular Fatebinder) are <b style="color:#cc6666">never rolled</b> — those win-condition towers must be crafted through recipes, not bought.
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
        if (!state.pendingPurchasedTowers) state.pendingPurchasedTowers = [];
        state.pendingPurchasedTowers.push({ type: result.type, tier: result.tier, source: 'mercator' });
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
  footer.style.cssText = `background:#0c0a08;border-top:2px solid #5a4a30;padding:10px 18px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0`;
  const footerHint = document.createElement('div');
  footerHint.style.cssText = `font-size:10px;color:#aa9a4a;letter-spacing:1px;font-style:italic`;
  footerHint.textContent = 'Mercator visits next at W' + (() => {
    const next = [4, 9, 14, 19].find(w => w > state.wave);
    return next ?? '— (final visit)';
  })();
  const closeBtn = document.createElement('button');
  closeBtn.className = 'merc-buy';
  closeBtn.textContent = 'CLOSE (ESC)';
  closeBtn.style.cssText = `background:#444;color:#e8d6a8;padding:8px 18px;font-size:12px`;
  closeBtn.onclick = () => hooks.onClose();
  footer.appendChild(footerHint);
  footer.appendChild(closeBtn);
  panel.appendChild(footer);

  modal.appendChild(panel);
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
    panel.style.cssText = `background:linear-gradient(180deg,#2a1a0e,#0c0a08);border:4px solid #d4af37;outline:1px solid #1a1410;color:#fff8e0;padding:0;width:min(600px,94vw);max-height:96%;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 0 36px rgba(212,175,55,0.45),inset 0 0 24px rgba(0,0,0,0.5);`;
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
    panel.style.cssText = `background:#1a1410;border:3px solid #d4af37;color:#e8d6a8;padding:14px;width:min(520px,94vw);max-height:96%;overflow:auto;font-family:'Courier New',monospace;`;
    panel.innerHTML = `<h2 style="margin:0 0 10px;color:#d4af37">GATE SHOP</h2>
      <div style="font-size:12px;margin-bottom:10px;opacity:0.8">Refreshes every 4 waves (W4 / W8 / W12 / W16 / W20).</div>`;
  }
  // Where new content (offer list, lives row, tower offers, close btn)
  // appends. For Mercator we use the inner content div; for Gate it's
  // the panel itself so existing layout is preserved.
  const contentRoot = isMerc ? panel.querySelector('div[style*="overflow:auto"]') as HTMLElement : panel;
  // 2026-05-20 v2 — HERO FORGE section. Appears at the top of the gate
  // shop modal whenever the player has a hero placed on the field. Three
  // independent upgrade paths (SHARPEN / HASTEN / EMPOWER), each capped
  // at 5 taps, each with a doubling 20/40/80/160/320g cost ramp.
  // Visible only on the gate shop (not Mercator) — the Mercator vendor
  // stays focused on legendaries + T5 armory.
  if (!isMerc && state.activeHeroTowerId) {
    renderHeroForgeSection(contentRoot, state, refresh);
  }
  // Offers list
  const list = document.createElement('div');
  list.style.cssText = `display:grid;grid-template-columns:1fr 1fr;gap:6px;`;
  for (const offer of shop.offers) {
    const def: any = isConsumable(offer.itemId) ? (consumables as any)[offer.itemId] : (items as any)[offer.itemId];
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

  // ─── Mercator: 3 random tower offers ────────────────────────────────────
  if (shop.type === 'MERCATOR' && shop.towerOffers && shop.towerOffers.length > 0) {
    const towerHeader = document.createElement('div');
    towerHeader.style.cssText = `margin-top:14px;padding-bottom:4px;border-bottom:1px solid #5a4a30;color:#d4af37;font-weight:bold;letter-spacing:2px`;
    towerHeader.textContent = '★ TRAVELING ARMORY (place on next empty-tile click)';
    contentRoot.appendChild(towerHeader);
    const tip = document.createElement('div');
    tip.style.cssText = `font-size:10px;color:#cdb98a;margin:4px 0 8px;line-height:1.4`;
    tip.innerHTML = 'Buy a tower to fill a recipe gap. Tier offers scale with your wave. Random refresh next Mercator visit. <b style="color:#cc6666">Apex super-combos (Imperium Eternum, Carthage Scourge, Triumvirate, Legion Prime, Consular Fatebinder) are never offered — earn them through crafting.</b>';
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
        const qLen = state.pendingPurchasedTowers.length;
        state.hint = qLen > 1
          ? `Bought ${offer.type.replace(/_/g,' ')} T${offer.tier}. ${qLen} towers queued — click empty tiles to place.`
          : `Bought ${offer.type.replace(/_/g,' ')} T${offer.tier}. Click an empty tile to place it.`;
        // Tier-flavored purchase sound (T1=COMMON, T5=UNIQUE)
        const tierToRarity = ['COMMON','UNCOMMON','RARE','LEGENDARY','UNIQUE'];
        SFX.itemPickup(tierToRarity[Math.max(0, Math.min(4, offer.tier - 1))]);
        if (shop.towerOffers) shop.towerOffers = shop.towerOffers.filter(o => o !== offer);
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
  parent.appendChild(modal);
}

export function renderInventoryButton(parent: HTMLElement, inv: InventoryState, hooks: { onOpen: () => void }) {
  let btn = document.getElementById('inventory-button') as HTMLButtonElement | null;
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'inventory-button';
    btn.style.cssText = `font-family:'Courier New',monospace;background:linear-gradient(180deg,#2a1f12,#0c0a08);color:#d4af37;border:2px solid #5a4a30;padding:7px 12px;cursor:pointer;letter-spacing:1px;box-shadow:inset 0 0 8px #000;`;
    const buttons = document.getElementById('buttons');
    buttons?.appendChild(btn);
  }
  const prev = Number(btn.dataset.count ?? inv.slots.length);
  btn.textContent = `INVENTORY ${inv.slots.length}/${INVENTORY_SIZE}`;
  btn.title = 'Open inventory';
  btn.onclick = hooks.onOpen;
  if (inv.slots.length > prev) flashInventoryButton(btn, inv.slots[inv.slots.length - 1]);
  btn.dataset.count = String(inv.slots.length);
}

// 2026-05 v10: sell price = half of purchase cost for EVERY item, whether
// purchased from a shop (uses tracked buyPrice) or picked up from a loot
// drop (falls back to items_permanent.json `buy` field, halved). Old
// system used a sub-half rarity-flat schedule for loot drops which felt
// punitive — half-of-buy is the consistent rule the user expects.
import permItems from '../data/items_permanent.json';
const PERM_ITEMS = permItems as Record<string, { buy?: number; rarity?: string }>;

// Fallback rarity prices — used only when neither a tracked buyPrice NOR
// an items_permanent.json buy field exists (e.g. legacy consumables).
export const SELL_PRICE: Record<string, number> = {
  COMMON: 4,        // half of average 8g buy
  UNCOMMON: 9,      // half of average 18g buy
  RARE: 18,         // half of average 36g buy
  EPIC: 30,         // 2026-05-18 — half of 60g Epic buy
  LEGENDARY: 65,    // half of average 130g buy
  UNIQUE: 75
};

// Compute sell price from an inventory slot. Half-of-buy-price for every
// path:
//   1. Slot has tracked buyPrice (purchased)  → floor(buyPrice / 2)
//   2. Slot has matching items.json entry     → floor(items[id].buy / 2)
//   3. Pure rarity fallback                   → rarity table above (half-derived)
export function inventorySellPrice(rarityOrSlot: any): number {
  if (typeof rarityOrSlot === 'string') return SELL_PRICE[rarityOrSlot] ?? 2;
  const slot = rarityOrSlot as { rarity: string; buyPrice?: number; itemId?: string };
  if (slot.buyPrice && slot.buyPrice > 0) return Math.max(1, Math.floor(slot.buyPrice / 2));
  // Fallback: look up the items.json buy price for this itemId.
  const baseBuy = slot.itemId ? PERM_ITEMS[slot.itemId]?.buy : undefined;
  if (baseBuy && baseBuy > 0) return Math.max(1, Math.floor(baseBuy / 2));
  return SELL_PRICE[slot.rarity] ?? 2;
}

export function showInventoryModal(parent: HTMLElement, inv: InventoryState, state: GameStateShape, hooks: { onSell: (idx: number) => void; onClose: () => void }) {
  closeGameModals();
  const modal = document.createElement('div');
  modal.id = 'inventory-modal';
  // 2026-05-19 — Responsive clamping (Codex pattern). Inventory modal
  // can be tall (25-slot inventory + filter chips + headline + sort
  // controls); flex-start + outer overflow:auto guarantees the close
  // button at the top stays reachable on any viewport.
  modal.style.cssText = `position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;background:rgba(0,0,0,0.55);z-index:58;padding:16px 8px;box-sizing:border-box;overflow:auto;font-family:'Courier New',monospace;`;
  const panel = document.createElement('div');
  panel.style.cssText = `width:min(560px,94vw);background:linear-gradient(180deg,#241a12,#0c0a08);border:3px solid #d4af37;color:#e8d6a8;box-shadow:0 0 28px #000;padding:14px;`;
  panel.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <div><div style="font-size:18px;color:#d4af37;font-weight:bold;letter-spacing:3px">ARMARIUM</div><div style="font-size:11px;color:#aa9a4a;letter-spacing:1px">ITEM VAULT ${inv.slots.length}/${INVENTORY_SIZE}</div></div>
    <div style="font-size:11px;color:#cdb98a;text-align:right;max-width:240px;line-height:1.4">Click an item to inspect it.<br/>Use the SELL button to convert it to Gold.</div>
  </div>`;

  // Selection state: which slot is currently selected.
  let selectedIdx = -1;

  // 2026-05 v11 (B4 Inventory sort + filter): controls row above the grid.
  // Sort dropdown reorders slots via CSS `order`; family chips hide
  // non-matching slots via `display: none`. Empty slots float to the end.
  // State persists within this modal session only.
  const RARITY_ORDER: Record<string, number> = { LEGENDARY: 0, UNIQUE: 1, RARE: 2, UNCOMMON: 3, COMMON: 4 };
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
  panel.appendChild(controls);

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
    const def: any = isConsumable(itm.itemId) ? (consumables as any)[itm.itemId] : (items as any)[itm.itemId];
    const color = RARITY_COLOR[itm.rarity];
    const sellPrice = inventorySellPrice(itm);
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
        <div style="font-size:11px;color:#cdb98a;line-height:1.5">${def?.effect ?? ''}</div>
      </div>
    `;
    const right = document.createElement('div');
    right.style.cssText = `display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0`;
    const priceLabel = document.createElement('div');
    priceLabel.style.cssText = `font-size:11px;color:#f0c040;letter-spacing:1px`;
    priceLabel.innerHTML = `SELL VALUE: <b style="font-size:14px">${sellPrice}g</b>`;
    const sellBtn = document.createElement('button');
    // 2026-05 v11 BUGFIX: previously only blocked WAVE_PHASE; now mirrors
    // the actual sell handler's `isPreWavePhase()` gate (BUILD_PHASE,
    // PROSPECT_PLACEMENT, PICK_KEEPER all OK; WAVE/GAME_OVER/VICTORY blocked).
    // 0=BUILD_PHASE 4=PROSPECT_PLACEMENT 5=PICK_KEEPER per GamePhase enum.
    const canSell = state.phase === 0 || state.phase === 4 || state.phase === 5;
    sellBtn.textContent = `SELL FOR ${sellPrice}g`;
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
      const def: any = isConsumable(itm.itemId) ? (consumables as any)[itm.itemId] : (items as any)[itm.itemId];
      slot.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">${itemIconSvg(itm.itemId, itm.rarity, 44)}${isConsumable(itm.itemId) ? '<div style="font-size:7px;color:#ee9966;letter-spacing:1px;line-height:1">1×</div>' : ''}</div>`;
      slot.title = `${def?.name ?? itm.itemId}\n${def?.effect ?? ''}\nClick to inspect`;
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
  panel.appendChild(grid);
  panel.appendChild(detail);
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
        const def: any = isConsumable(itm.itemId) ? (consumables as any)[itm.itemId] : (items as any)[itm.itemId];
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
            primary = -((def?.buy ?? 0) as number) * 1000 + idx;
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
  closeRow.style.cssText = 'display:flex;justify-content:flex-end;margin-top:12px';
  const close = document.createElement('button');
  close.textContent = 'CLOSE';
  close.style.cssText = `background:#444;color:#e8d6a8;border:1px solid #5a4a30;padding:7px 14px;cursor:pointer;font-family:inherit;font-size:12px;`;
  close.onclick = hooks.onClose;
  closeRow.appendChild(close);
  panel.appendChild(closeRow);
  modal.appendChild(panel);
  parent.appendChild(modal);
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
