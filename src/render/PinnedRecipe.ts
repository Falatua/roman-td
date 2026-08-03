// PinnedRecipe — 2026-05 v11 QoL feature, expanded 2026-05-15 to two pins,
// 2026-07-06 to three, 2026-07-10 to four, 2026-07-24 to six, then
// 2026-07-26 to eight.
//
// Lets the player pin up to eight combination recipes from the Codex so they
// float below the INVENTORY button at all times. Ingredients update live:
//   GREEN  — already-kept tower of the right type/tier on the field
//   ORANGE — pending prospect that would satisfy the slot if KEPT
//   GRAY   — not yet present anywhere
//
// Persists across sessions via localStorage. The widget container is
// scrolls with the right HUD column if the chips exceed the available height.

import towersData from '../data/towers.json';
import comboData from '../data/towerCombinations.json';
import { tex } from './Assets';
import { towerBriefHtml } from './TowerCopy';
import { comboCostLabel } from '../systems/ComboPricing';

const LS_KEY = 'roman_td_pinned_recipe_v1';
// Tutorial-style default — the recipe the player sees pinned on every
// fresh game start. SCORPION_BOLT is a 2-ingredient T2 combo
// (SCORPIO T2 + VELITES T2 → 10g) that's reachable in the first few
// waves, so the chip actually does its onboarding job. To change the
// starter, just swap this constant.
const DEFAULT_PINNED_RECIPE = 'SCORPION_BOLT';

// Hard cap on simultaneous pins. The right HUD panel owns overflow, so all
// eight chips stack cleanly and scroll with the side rail when needed.
export const MAX_PINNED_RECIPES = 8;

// 2026-05-15 v6: storage now holds a JSON array of result IDs. Read side
// still handles the v5 single-string format so existing saves don't break.
function readStored(): string[] {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (!v || v.length === 0) return [];
    // v6 array format — parse, validate, dedupe, cap.
    if (v.startsWith('[')) {
      const parsed = JSON.parse(v);
      if (!Array.isArray(parsed)) return [];
      const out: string[] = [];
      for (const id of parsed) {
        if (typeof id === 'string' && id.length > 0 && !out.includes(id)) {
          out.push(id);
          if (out.length >= MAX_PINNED_RECIPES) break;
        }
      }
      return out;
    }
    // Legacy v5 single-string format — wrap into array.
    return [v];
  } catch { return []; }
}

function writeStored(ids: string[]) {
  try {
    const clean = ids
      .filter((id, i) => typeof id === 'string' && id.length > 0 && ids.indexOf(id) === i)
      .slice(0, MAX_PINNED_RECIPES);
    if (clean.length === 0) localStorage.removeItem(LS_KEY);
    else localStorage.setItem(LS_KEY, JSON.stringify(clean));
  } catch { /* private mode / quota — ignore */ }
}

// 2026-05-15 v6: UNPIN is still SESSION-LOCAL — clearing both chips
// during play doesn't erase the tutorial default for next session. A
// fresh boot with empty storage plants Scorpion Bolt again so new
// players never miss the onboarding scaffold.
export function ensurePinnedRecipeDefault() {
  const existing = readStored();
  if (existing.length === 0) writeStored([DEFAULT_PINNED_RECIPE]);
}

// New v6 array-aware API.
export function getPinnedRecipes(): string[] {
  return readStored();
}

export function setPinnedRecipes(ids: string[]) {
  writeStored(ids);
}

// Backward-compat shims — anything still calling getPinnedRecipe() gets
// the first pinned recipe (or null if none). setPinnedRecipe replaces the
// entire list with a single entry (or clears all).
export function getPinnedRecipe(): string | null {
  const arr = readStored();
  return arr.length > 0 ? arr[0] : null;
}

export function setPinnedRecipe(resultId: string | null) {
  writeStored(resultId ? [resultId] : []);
}

// Toggle a recipe in/out of the pinned set. Returns true if pinned after
// the toggle, false if unpinned. FIFO eviction: pinning beyond the cap
// drops the oldest entry so the cap stays at MAX_PINNED_RECIPES.
export function togglePinnedRecipe(resultId: string): boolean {
  const current = readStored();
  const idx = current.indexOf(resultId);
  if (idx >= 0) {
    current.splice(idx, 1);
    writeStored(current);
    return false;
  }
  current.push(resultId);
  while (current.length > MAX_PINNED_RECIPES) current.shift();
  writeStored(current);
  return true;
}

// Helper: turn a manifest texture into an <img>-renderable src. Mirrors
// the texUrl() logic from main.ts so this module stays standalone.
function spriteSrc(key: string): string | null {
  const t = tex(key);
  const res: any = t?.baseTexture?.resource;
  return res?.src ?? res?.url ?? (t as any)?.__srcPath ?? null;
}

// Build the inner HTML for one pinned-recipe chip given a result id.
// Returns null if the recipe id is stale (renamed/removed). Also returns
// a per-chip signature string the caller can hash so the whole container
// re-renders only when ingredient state actually changes.
function buildChipHtml(pinnedId: string, state: any): { html: string; sig: string } | null {
  const recipe = (comboData as any[]).find(r => r.result === pinnedId);
  if (!recipe) return null;

  // Tally owned and pending towers by (type, tier). Greedy match: each
  // ingredient slot consumes the highest-tier matching tower from the
  // available pool to maximize green hits. Re-cloned per chip so chip 1
  // and chip 2 don't fight over the same field towers — both chips see
  // the full board, mirroring how the player actually scans them.
  const ownedPool = new Map<string, number[]>();
  const pendingPool = new Map<string, number[]>();
  for (const t of (state.towers as Map<string, any>).values()) {
    const target = t.pending ? pendingPool : ownedPool;
    const arr = target.get(t.type) ?? [];
    arr.push(t.qualityTier);
    target.set(t.type, arr);
  }
  for (const arr of ownedPool.values()) arr.sort((a, b) => b - a);
  for (const arr of pendingPool.values()) arr.sort((a, b) => b - a);
  const ownedClone = new Map(Array.from(ownedPool.entries(), ([k, v]) => [k, [...v]]));
  const prospClone = new Map(Array.from(pendingPool.entries(), ([k, v]) => [k, [...v]]));

  const resultDef: any = (towersData as any)[recipe.result] ?? {};
  const tierHex: Record<number, string> = { 1:'#aaaaaa', 2:'#b87333', 3:'#c0c0c0', 4:'#ffd34d', 5:'#ff5050' };
  const resultColor = tierHex[recipe.tier] ?? '#ffd34d';
  const resultSrc = spriteSrc(recipe.result);

  const ingredientHtml: string[] = [];
  const sigParts: string[] = [pinnedId];
  let ownedCount = 0;
  let pendingCount = 0;
  const totalIngredients = recipe.ingredients.length;
  for (const ing of recipe.ingredients) {
    const ownArr = ownedClone.get(ing.type) ?? [];
    const ownIdx = ownArr.findIndex((q: number) => q >= ing.minTier);
    let color = '#5a4a30';
    let icon = '✗';
    let status = 'miss';
    if (ownIdx >= 0) {
      ownArr.splice(ownIdx, 1);
      color = '#66ff66';
      icon = '✓';
      status = 'own';
      ownedCount++;
    } else {
      const prosArr = prospClone.get(ing.type) ?? [];
      const prosIdx = prosArr.findIndex((q: number) => q >= ing.minTier);
      if (prosIdx >= 0) {
        prosArr.splice(prosIdx, 1);
        color = '#ff9933';
        icon = '◐';
        status = 'pen';
        pendingCount++;
      }
    }
    sigParts.push(`${ing.type}:${ing.minTier}:${status}`);
    const ingSrc = spriteSrc(ing.type);
    const ingDef: any = (towersData as any)[ing.type] ?? {};
    const fullName = ingDef.name ?? ing.type.replace(/_/g, ' ');
    ingredientHtml.push(`
      <div style="display:flex;align-items:flex-start;gap:7px;font-size:12px;line-height:1.3">
        <div style="width:28px;height:28px;border:2px solid ${color};background:#100c09;display:flex;align-items:center;justify-content:center;flex-shrink:0;position:relative">
          ${ingSrc ? `<img src="${ingSrc}" style="width:26px;height:26px;image-rendering:pixelated"/>` : ''}
        </div>
        <div style="flex:1;min-width:0;color:${color};font-weight:bold;word-break:break-word">
          ${icon} ${fullName} <span style="color:#9be0ff;font-weight:normal;white-space:nowrap">T${ing.minTier}+</span>
        </div>
      </div>
    `);
  }
  const craftable = ownedCount === totalIngredients;
  const partial = !craftable && (ownedCount + pendingCount === totalIngredients);
  const statusBadge = craftable
    ? '<span style="background:#1a3a0e;color:#88ff88;padding:1px 6px;border:1px solid #66ff66;letter-spacing:1px;font-size:10px;font-weight:bold">✓ CRAFTABLE</span>'
    : partial
      ? `<span style="background:#3a2a0e;color:#ff9933;padding:1px 6px;border:1px solid #ff9933;letter-spacing:1px;font-size:10px;font-weight:bold">KEEP ${totalIngredients - ownedCount} MORE</span>`
      : `<span style="background:#2a1a0e;color:#aa9a4a;padding:1px 6px;border:1px solid #5a4a30;letter-spacing:1px;font-size:10px;font-weight:bold">NEED ${totalIngredients - ownedCount - pendingCount}</span>`;
  sigParts.push(craftable ? 'CRAFT' : partial ? 'PART' : 'NEED');

  const abilityText = towerBriefHtml(String(recipe.result), resultDef);
  const abilityHtml = resultDef.ability
    ? `<div style="font-size:11px;color:#cdb98a;line-height:1.4;padding:6px 0 2px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;text-overflow:ellipsis;word-break:break-word">${abilityText}</div>`
    : '';

  // 2026-05-15 v6: each chip's UNPIN button carries a data-pin-id so the
  // delegated handler on the outer container knows WHICH chip to drop.
  const html = `
    <div class="pinned-recipe-chip-inner" data-pin-id="${pinnedId}" style="padding:12px;background:linear-gradient(180deg,#2a1f12,#0c0a08);border:2px solid #d4af37;color:#e8d6a8;font-family:'Courier New',monospace;font-size:12px;letter-spacing:1px;box-shadow:0 0 12px rgba(212,175,55,0.35);box-sizing:border-box;display:flex;flex-direction:column;gap:8px;flex-shrink:0">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#aa9a4a;letter-spacing:2px;line-height:1.2">
        <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">📌 PINNED RECIPE</span>
        <button class="pinned-recipe-unpin-btn" data-pin-id="${pinnedId}" style="background:#1a1410;border:1px solid #5a4a30;color:#cdb98a;font-family:inherit;font-size:11px;padding:3px 10px;cursor:pointer;letter-spacing:1.5px;font-weight:bold;flex-shrink:0">UNPIN</button>
      </div>
      <div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-top:1px dashed #3a3025;border-bottom:1px dashed #3a3025">
        <div style="width:44px;height:44px;border:2px solid ${resultColor};background:#100c09;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 0 8px ${resultColor}55">
          ${resultSrc ? `<img src="${resultSrc}" style="width:42px;height:42px;image-rendering:pixelated"/>` : ''}
        </div>
        <div style="flex:1;min-width:0;line-height:1.3">
          <div style="color:${resultColor};font-weight:bold;font-size:13px;word-break:break-word;letter-spacing:1px">${resultDef.name ?? recipe.result}</div>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:3px">
            <span style="font-size:11px;color:#9be0ff;letter-spacing:1.5px;white-space:nowrap">T${recipe.tier} · ${comboCostLabel(recipe.cost)}</span>
            ${statusBadge}
          </div>
        </div>
      </div>
      ${abilityHtml}
      <div style="display:flex;flex-direction:column;gap:7px">${ingredientHtml.join('')}</div>
    </div>
  `;
  return { html, sig: sigParts.join('|') };
}

// Render (or hide) the pinned-recipe widget below the INVENTORY button.
// 2026-05-15 v6: container holds up to the pin cap, scrolls if needed,
// and uses event delegation on the outer wrapper so per-chip UNPIN clicks
// survive the per-frame innerHTML rewrites that update ingredient state.
export function renderPinnedRecipeWidget(state: any, buttonsEl?: HTMLElement | null) {
  // Single-player passes nothing → the global #buttons rail. Green Circle
  // passes its own right-panel #buttons so the widget lands in the circle's
  // sidebar even if a stale single-player #buttons still lingers in the DOM.
  const buttons = buttonsEl ?? document.getElementById('buttons');
  const pinnedIds = readStored();
  // Scope the wrap to its owning button rail so the two mount contexts never
  // fight over one shared #pinned-recipe-wrap node.
  let wrap = (buttons?.querySelector('#pinned-recipe-wrap')
    ?? document.getElementById('pinned-recipe-wrap')) as HTMLElement | null;
  if (pinnedIds.length === 0) {
    if (wrap) wrap.remove();
    return;
  }

  // Stale-id cleanup pass: drop ids that no longer reference a real recipe.
  const validIds: string[] = [];
  const chipParts: { html: string; sig: string }[] = [];
  for (const id of pinnedIds) {
    const built = buildChipHtml(id, state);
    if (built) {
      validIds.push(id);
      chipParts.push(built);
    }
  }
  if (validIds.length !== pinnedIds.length) writeStored(validIds);
  if (validIds.length === 0) {
    if (wrap) wrap.remove();
    return;
  }

  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'pinned-recipe-wrap';
    // 2026-05-15 v10: removed the wrap's own max-height + overflow now
    // that #right-panel handles vertical overflow at 832 px. Stacking
    // two scrollbars (panel + inner wrap) created jittery scroll
    // behavior and made the pin chips feel cramped. Now the wrap just
    // flows vertically; if the chips + HUD buttons together exceed the
    // panel's max-height, the panel itself scrolls cleanly.
    wrap.style.cssText = `
      margin-top:10px;width:100%;box-sizing:border-box;display:flex;
      flex-direction:column;gap:10px;
    `;
    // Delegated click handler — survives all future innerHTML rewrites.
    wrap.addEventListener('click', (ev) => {
      const target = ev.target as HTMLElement;
      const btn = target.closest('.pinned-recipe-unpin-btn') as HTMLElement | null;
      if (!btn) return;
      ev.stopPropagation();
      const pinId = btn.getAttribute('data-pin-id');
      if (!pinId) return;
      togglePinnedRecipe(pinId);
      // Force a fresh signature so the next render rebuilds without the
      // unpinned chip. We don't tear down the wrapper itself — the next
      // frame's renderPinnedRecipeWidget call handles the redraw.
      (wrap as any).__sig = '';
    });
    buttons?.appendChild(wrap);
  }

  // Combined signature across all chips — only rewrite when something
  // actually changed. Prevents per-frame innerHTML churn that would
  // destroy mid-click button DOM (the v11 fix that's now extended to 2 chips).
  const combinedSig = `n=${chipParts.length}|` + chipParts.map(c => c.sig).join('||');
  if ((wrap as any).__sig === combinedSig) return;
  (wrap as any).__sig = combinedSig;

  wrap.innerHTML = chipParts.map(c => c.html).join('');
}
