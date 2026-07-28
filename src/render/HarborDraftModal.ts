import { GameStateShape } from '../GameState';
import {
  HARBOR_DRAFT_OFFER_COUNT,
  HarborDraftOffer,
  buildHarborDraftOffers,
  queueHarborDraftPurchase
} from '../systems/HarborSystem';
import towersData from '../data/towers.json';
import { enhanceModalErgonomics } from './ModalErgonomics';
import { createTower, towerStatBreakdown } from '../systems/TowerSystem';
import { ASSET_KEYS, texUrl } from './Assets';
import { purchaseRecipeHints } from '../systems/CombinationEngine';
import { towerBriefHtml } from './TowerCopy';
import { SFX } from './AudioManager';

interface HarborPurchaseReceipt {
  name: string;
  tier: number;
  price: number;
  queued: number;
}

function ensureHarborPurchaseStyle(): void {
  if (document.getElementById('harbor-purchase-style')) return;
  const style = document.createElement('style');
  style.id = 'harbor-purchase-style';
  style.textContent = `
    @keyframes harborContractSigned {
      0%, 58% { opacity:1; transform:translateY(0) scale(1); filter:brightness(1.35) drop-shadow(0 0 12px #88f7ff); }
      100% { opacity:0; transform:translateY(-10px) scale(0.94); filter:brightness(0.75); }
    }
    .harbor-contract-purchased {
      animation:harborContractSigned 0.64s ease-in forwards !important;
      pointer-events:none !important;
      overflow:hidden;
    }
    .harbor-contract-purchased::after {
      content:'CONTRACT SIGNED';
      position:absolute;
      inset:42% 12px auto 12px;
      z-index:3;
      padding:7px 8px;
      border:2px solid #88f7ff;
      background:rgba(5,18,25,0.96);
      color:#fff8e0;
      text-align:center;
      font-size:11px;
      font-weight:bold;
      letter-spacing:2px;
      box-shadow:0 0 18px rgba(95,230,255,0.55);
    }
  `;
  document.head.appendChild(style);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function towerLabel(type: string): string {
  return (towersData as any)[type]?.name ?? type.replace(/_/g, ' ');
}

function towerRole(type: string): string {
  if (type.includes('TRIREME')) return 'Pierce / anti-elite';
  if (type.includes('CORVUS')) return 'Melee support / anchor';
  if (type.includes('RAMMING')) return 'Burst / knockback';
  if (type.includes('CHARYBDIS')) return 'Control / boss weakening';
  if (type.includes('NEREID')) return 'Truesight / crit marks';
  if (type.includes('HYDRA')) return 'Snowball melee';
  return 'Naval contract';
}

function fmtNum(n: unknown, digits = 1): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '?';
  return v.toFixed(digits).replace(/\.0$/, '');
}

function fmtDamageType(type: unknown): string {
  return String(type ?? 'SPECIAL').replace(/^PHYS_/, '').replace(/^ELEMENTAL_/, '').replace(/_/g, ' ');
}

function placementRule(def: any): string {
  if (def?.waterOnly) return 'Ocean tiles only';
  if (def?.amphibious) return 'Ocean or land';
  return 'Land placement';
}

function attackStyle(def: any): string {
  if (def?.melee) return 'Melee / short reach';
  if (def?.damageType === 'SIEGE') return 'Siege projectile';
  if (def?.damageType === 'DIVINE') return 'Divine ranged';
  return 'Ranged';
}

function navalContractSpriteHtml(type: string, label: string, tier: number): string {
  const manifestFile = (ASSET_KEYS as Record<string, string>)[type];
  const src = texUrl(type) ?? (manifestFile ? `assets/sprites/${manifestFile}` : null);
  const tierLabel = `T${tier}`;
  if (src) {
    return `
      <div style="width:86px;height:86px;display:grid;place-items:center;background:radial-gradient(circle,#1b3f4c 0%,#07141c 72%);border:2px solid #5fe6ff;box-shadow:inset 0 0 14px #000,0 0 12px rgba(95,230,255,0.22);position:relative;flex:0 0 auto">
        <img src="${src}" alt="${label}" style="width:76px;height:76px;object-fit:contain;image-rendering:pixelated;display:block"/>
        <div style="position:absolute;right:4px;bottom:4px;background:#0c0a08;color:#ffd34d;border:1px solid #7a5a1a;font-size:9px;font-weight:bold;letter-spacing:1px;padding:2px 4px">${tierLabel}</div>
      </div>`;
  }
  const letter = label.trim().charAt(0).toUpperCase() || '?';
  return `
    <div style="width:86px;height:86px;display:grid;place-items:center;background:radial-gradient(circle,#1b3f4c 0%,#07141c 72%);border:2px solid #5fe6ff;box-shadow:inset 0 0 14px #000,0 0 12px rgba(95,230,255,0.22);position:relative;flex:0 0 auto">
      <span style="font-size:34px;color:#ffd34d;font-weight:bold;text-shadow:2px 2px 0 #000">${letter}</span>
      <div style="position:absolute;right:4px;bottom:4px;background:#0c0a08;color:#ffd34d;border:1px solid #7a5a1a;font-size:9px;font-weight:bold;letter-spacing:1px;padding:2px 4px">${tierLabel}</div>
    </div>`;
}

function navalContractDetailsHtml(state: GameStateShape, offer: HarborDraftOffer, def: any): string {
  const preview = createTower(offer.type, offer.tier, 0, 0, state.wave, true);
  preview.placedOnWater = !!def?.waterOnly || !!def?.amphibious;
  const stats = towerStatBreakdown(preview, state as any);
  const critChance = Math.round(Number(def?.critChance ?? 0) * 100);
  const critMult = fmtNum(def?.critMult ?? 1, 1);
  const chips = [
    ['DPS', fmtNum(stats.damageFinal, 0)],
    ['ATK/S', fmtNum(stats.speedFinal, 2)],
    ['RANGE', `${fmtNum(stats.rangeFinal, 1)} tiles`],
    ['TYPE', fmtDamageType(def?.damageType)],
    ['CRIT', critChance > 0 ? `${critChance}% x${critMult}` : 'None'],
    ['PLACE', placementRule(def)]
  ];
  const chipHtml = chips.map(([label, value]) => `
    <div style="background:#07141c;border:1px solid #285a68;padding:6px 7px;min-height:38px">
      <div style="font-size:8.5px;color:#88f7ff;letter-spacing:1.4px">${label}</div>
      <div style="margin-top:2px;font-size:11px;color:#fff8e0;font-weight:bold;line-height:1.15">${value}</div>
    </div>`).join('');
  return `
    <div style="margin-top:8px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px">${chipHtml}</div>
    <div style="margin-top:8px;border:1px solid #285a68;background:rgba(7,20,28,0.72);padding:7px 8px;font-size:10.5px;color:#cdefff;line-height:1.45">
      <b style="color:#88f7ff">Role:</b> ${towerRole(String(offer.type))}<br/>
      <b style="color:#88f7ff">Attack:</b> ${attackStyle(def)}<br/>
      <b style="color:#88f7ff">Placement:</b> ${placementRule(def)}. Buy the contract, then click a valid ocean tile to place it.
    </div>
    <div style="margin-top:8px;border-left:3px solid #5fe6ff;background:rgba(0,0,0,0.32);padding:8px 9px;font-size:10.5px;color:#fff8e0;line-height:1.45">
      ${towerBriefHtml(String(offer.type), def ?? {})}
    </div>`;
}

function navalRecipeHintHtml(state: GameStateShape, offer: HarborDraftOffer): string {
  const hints = purchaseRecipeHints(state, offer.type, offer.tier, 3);
  if (hints.length > 0) {
    const names = hints.map(hint => {
      const prefix = hint.isSameTierMerge ? 'Tier merge: ' : '';
      return `<b>${escapeHtml(prefix + hint.name)}</b>`;
    }).join(', ');
    return `
      <div style="margin-top:8px;background:#092015;border:1.5px solid #66ff88;color:#b8ffcc;padding:7px 8px;font-size:10px;line-height:1.4;box-shadow:0 0 10px rgba(102,255,136,0.14)">
        <b style="color:#88ff88;letter-spacing:1.2px">RECIPE ALERT</b><br/>
        This contract completes ${names}.
      </div>`;
  }
  return `
    <div style="margin-top:8px;background:#101015;border:1px solid #3a4450;color:#9fb3bd;padding:7px 8px;font-size:10px;line-height:1.4">
      <b style="color:#88f7ff;letter-spacing:1.2px">RECIPE ALERT</b><br/>
      Does not complete a recipe with your current towers yet.
    </div>`;
}

export function showHarborWaveClearModal(state: GameStateShape, clearedWave: number, onOpenDraft?: () => void): void {
  if (typeof document === 'undefined') return;
  document.getElementById('harbor-unlock-modal')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'harbor-unlock-modal';
  const firstOpen = (state as any).harborUnlockWave === clearedWave;
  wrap.innerHTML = `
    <div id="harbor-unlock-panel" style="width:min(620px,92vw);padding:24px 28px;background:linear-gradient(180deg,#102532,#080c12);border:3px solid #5fe6ff;box-shadow:0 0 38px #25bfff88,inset 0 0 24px #000;color:#fff8e0;font-family:'Courier New',monospace;text-align:center">
      <div style="font-size:11px;letter-spacing:6px;color:#88f7ff;font-weight:bold">${firstOpen ? 'THE SHIPWRECK STIRS' : 'TIDE SPOILS CLAIMED'}</div>
      <div style="margin-top:8px;font-size:26px;letter-spacing:4px;color:#ffd34d;text-shadow:2px 2px 0 #000">${firstOpen ? 'THE HARBOR AWAKENS' : 'HARBOR CONTRACTS AVAILABLE'}</div>
      <div style="margin-top:14px;font-size:13px;line-height:1.65;text-align:left;background:rgba(0,0,0,0.38);border-left:3px solid #5fe6ff;padding:12px 14px">
        Wave <b style="color:#ffd34d">${clearedWave}</b> brought ocean-born enemies, and Rome survived them.
        The Harbor Draft is available <b style="color:#88f7ff">now, after the water threat is defeated</b>.
        The Draft shows <b style="color:#ffd34d">three freshly randomized naval contracts</b>. You may buy one, two, or all three, then place each purchased tower on the ocean.
        You may also pass. The Harbor quartermaster returns with a refreshed draft after the next cleared wave that included water-based enemies.
      </div>
      <div style="margin-top:12px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:left;font-size:10.5px;line-height:1.45;color:#cdefff">
        <div style="background:#07141c;border:1px solid #285a68;padding:8px"><b style="color:#88f7ff">1.</b> Buy up to three.</div>
        <div style="background:#07141c;border:1px solid #285a68;padding:8px"><b style="color:#88f7ff">2.</b> Each card leaves after purchase.</div>
        <div style="background:#07141c;border:1px solid #285a68;padding:8px"><b style="color:#88f7ff">3.</b> Place purchases on water.</div>
      </div>
      <div style="margin-top:18px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button id="harbor-unlock-open-draft" style="background:#17394a;color:#fff8e0;border:2px solid #88f7ff;padding:10px 24px;cursor:pointer;font-family:'Courier New',monospace;font-size:13px;font-weight:bold;letter-spacing:2px">VIEW NAVAL CONTRACTS</button>
        <button id="harbor-unlock-later" style="background:#241810;color:#ffd34d;border:2px solid #7a5a1a;padding:10px 18px;cursor:pointer;font-family:'Courier New',monospace;font-size:12px;font-weight:bold;letter-spacing:2px">PASS THIS DRAFT</button>
      </div>
    </div>`;
  wrap.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);z-index:130;pointer-events:auto';
  document.getElementById('stage-wrap')?.appendChild(wrap);
  const panel = wrap.querySelector<HTMLElement>('#harbor-unlock-panel');
  if (panel) enhanceModalErgonomics(wrap, panel, { title: 'Harbor wave-clear notice' });
  wrap.querySelector<HTMLButtonElement>('#harbor-unlock-open-draft')!.onclick = () => {
    wrap.remove();
    onOpenDraft?.();
  };
  wrap.querySelector<HTMLButtonElement>('#harbor-unlock-later')!.onclick = () => wrap.remove();
  state.hint = `Fresh Harbor contracts are available after clearing ocean wave ${clearedWave}. View contracts now, or pass for the next water-enemy wave.`;
}

export function showHarborDraftModal(
  state: GameStateShape,
  offers: HarborDraftOffer[],
  onUpdate?: () => void,
  receipt?: HarborPurchaseReceipt
): void {
  if (typeof document === 'undefined') return;
  ensureHarborPurchaseStyle();
  document.getElementById('harbor-draft-modal')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'harbor-draft-modal';
  const cards = offers.map((o, idx) => {
    const def: any = (towersData as any)[o.type] ?? {};
    const affordable = state.gold >= o.price;
    const label = towerLabel(String(o.type));
    const recipeHints = purchaseRecipeHints(state, o.type, o.tier, 1);
    const completesRecipe = recipeHints.length > 0;
    const assisted = o.recipeAssisted === true;
    return `
      <div data-harbor-card="${idx}" style="background:linear-gradient(180deg,${completesRecipe ? '#173a27' : '#162b35'},#0b1118);border:2px solid ${completesRecipe ? '#66ff88' : affordable ? '#5fe6ff' : '#6b3a3a'};padding:12px;text-align:left;box-shadow:inset 0 0 16px #000${completesRecipe ? ',0 0 16px rgba(102,255,136,0.18)' : ''};display:flex;flex-direction:column;min-height:430px;position:relative">
        ${completesRecipe ? `<div style="position:absolute;top:-10px;left:14px;background:#0c1a10;border:1.5px solid #66ff88;color:#bbffcc;font-size:9px;font-weight:bold;letter-spacing:1px;padding:2px 7px;white-space:nowrap;text-shadow:0 0 4px #66ff88">★ COMPLETES RECIPE</div>` : assisted ? `<div style="position:absolute;top:-10px;left:14px;background:#10202a;border:1.5px solid #88f7ff;color:#cdefff;font-size:9px;font-weight:bold;letter-spacing:1px;padding:2px 7px;white-space:nowrap">★ BEST RECIPE PATH</div>` : ''}
        <div style="display:flex;gap:12px;align-items:flex-start">
          ${navalContractSpriteHtml(String(o.type), label, o.tier)}
          <div style="min-width:0;flex:1">
            <div style="font-size:10px;letter-spacing:2px;color:#88f7ff">${towerRole(String(o.type))}</div>
            <div style="margin-top:5px;font-size:16px;color:#ffd34d;font-weight:bold;line-height:1.2">${label}</div>
            <div style="margin-top:8px;font-size:10px;color:#cdefff;line-height:1.35">Actual in-game sprite shown above. Stats below reflect this offered tier.</div>
          </div>
        </div>
        ${navalContractDetailsHtml(state, o, def)}
        ${navalRecipeHintHtml(state, o)}
        <button data-harbor-buy="${idx}" style="margin-top:10px;width:100%;background:${affordable ? '#1d5c66' : '#332222'};color:${affordable ? '#fff8e0' : '#aa8888'};border:2px solid ${affordable ? '#88f7ff' : '#6b3a3a'};padding:8px;cursor:${affordable ? 'pointer' : 'not-allowed'};font-family:'Courier New',monospace;font-weight:bold;letter-spacing:1.5px">${affordable ? `${o.price}g CONTRACT` : `NEED ${o.price - state.gold}g`}</button>
      </div>`;
  }).join('');
  wrap.innerHTML = `
    <div id="harbor-draft-panel" style="width:min(1180px,97vw);max-height:min(94vh,960px);padding:20px 22px;background:linear-gradient(180deg,#102532,#070b10);border:3px solid #5fe6ff;box-shadow:0 0 38px #25bfff88,inset 0 0 24px #000;color:#fff8e0;font-family:'Courier New',monospace;text-align:center;overflow:hidden">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;padding-right:120px">
        <div style="text-align:left">
          <div style="font-size:11px;letter-spacing:5px;color:#88f7ff;font-weight:bold">HARBOR DRAFT</div>
          <div style="font-size:21px;letter-spacing:3px;color:#ffd34d;font-weight:bold">Naval Contracts</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
          <div style="border:1px solid #285a68;background:#07141c;padding:6px 9px;text-align:center">
            <div style="font-size:8px;letter-spacing:1.5px;color:#88f7ff">CONTRACTS LEFT</div>
            <div style="font-size:16px;color:#fff8e0;font-weight:bold">${offers.length} / ${HARBOR_DRAFT_OFFER_COUNT}</div>
          </div>
          <div style="border:1px solid #6b5721;background:#171006;padding:6px 9px;text-align:center">
            <div style="font-size:8px;letter-spacing:1.5px;color:#ffd34d">GOLD</div>
            <div style="font-size:16px;color:#fff8e0;font-weight:bold">${state.gold}g</div>
          </div>
        </div>
      </div>
      <div id="harbor-draft-body" style="margin-top:10px;max-height:min(78vh,760px);overflow-y:auto;padding-right:6px">
        ${receipt ? `<div role="status" aria-live="polite" style="margin-bottom:10px;border:2px solid #88f7ff;background:#0a2029;padding:9px 11px;text-align:left;box-shadow:0 0 16px rgba(95,230,255,0.2)">
          <div style="font-size:9px;letter-spacing:2px;color:#88f7ff;font-weight:bold">PURCHASE CONFIRMED</div>
          <div style="margin-top:3px;color:#fff8e0;font-size:12px"><b>${escapeHtml(receipt.name)} T${receipt.tier}</b> signed for <b style="color:#ffd34d">${receipt.price}g</b>. ${receipt.queued} purchased tower${receipt.queued === 1 ? '' : 's'} waiting for placement.</div>
        </div>` : ''}
        <div style="font-size:12px;color:#cdefff;text-align:left;line-height:1.5">Buy any or all remaining contracts. A purchased card signs, disappears, and joins your placement queue. The panel closes after all three are bought, or you may close it early to pass on the rest. A fresh draft appears after every cleared water-enemy wave. Each card shows the tier-adjusted stats and current recipe value.</div>
        <div style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">${cards}</div>
      </div>
    </div>`;
  wrap.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);z-index:125;pointer-events:auto';
  document.getElementById('stage-wrap')?.appendChild(wrap);
  const panel = wrap.querySelector<HTMLElement>('#harbor-draft-panel');
  if (panel) {
    enhanceModalErgonomics(wrap, panel, {
      bodySelector: '#harbor-draft-body',
      title: 'Harbor Draft',
      onClose: () => wrap.remove()
    });
  }
  wrap.querySelectorAll<HTMLButtonElement>('[data-harbor-buy]').forEach(btn => {
    btn.onclick = (ev) => {
      const offer = offers[Number(btn.dataset.harborBuy)];
      if (offer && state.gold < offer.price) {
        const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
        const stageRect = document.getElementById('stage-wrap')?.getBoundingClientRect();
        const ax = stageRect ? r.left + r.width / 2 - stageRect.left : undefined;
        const ay = stageRect ? r.top - stageRect.top : undefined;
        (window as any).__showInsufficientGoldToast?.(offer.price, ax, ay);
        state.hint = `The Harbor wants ${offer.price}g. You have ${state.gold}g.`;
        return;
      }
      if (offer && queueHarborDraftPurchase(state, offer)) {
        try { SFX.buy(); } catch { /* audio feedback is optional */ }
        btn.disabled = true;
        btn.textContent = 'CONTRACT SIGNED';
        const card = wrap.querySelector<HTMLElement>(`[data-harbor-card="${btn.dataset.harborBuy}"]`);
        card?.classList.add('harbor-contract-purchased');
        const remainingOffers = buildHarborDraftOffers(state);
        const queued = state.pendingPurchasedTowers?.length ?? 0;
        const nextReceipt: HarborPurchaseReceipt = {
          name: towerLabel(String(offer.type)),
          tier: offer.tier,
          price: offer.price,
          queued
        };
        onUpdate?.();
        window.setTimeout(() => {
          if (remainingOffers.length === 0) {
            wrap.remove();
            state.hint = `All ${HARBOR_DRAFT_OFFER_COUNT} Harbor contracts purchased. ${queued} towers are waiting for ocean placement.`;
            onUpdate?.();
            return;
          }
          showHarborDraftModal(state, remainingOffers, onUpdate, nextReceipt);
        }, 660);
      }
    };
  });
}
