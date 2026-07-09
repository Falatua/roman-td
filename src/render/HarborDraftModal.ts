import { GameStateShape } from '../GameState';
import { HarborDraftOffer, queueHarborDraftPurchase } from '../systems/HarborSystem';
import towersData from '../data/towers.json';
import { enhanceModalErgonomics } from './ModalErgonomics';
import { createTower, towerStatBreakdown } from '../systems/TowerSystem';

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
      <b style="color:#ffd34d">Ability:</b> ${def?.ability ?? 'No special ability text available.'}
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
        The Draft shows <b style="color:#ffd34d">three freshly randomized naval contracts</b>. Buy one, then click an ocean tile to place it.
        You may also pass. The Harbor quartermaster returns with a refreshed draft after the next cleared wave that included water-based enemies.
      </div>
      <div style="margin-top:12px;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:left;font-size:10.5px;line-height:1.45;color:#cdefff">
        <div style="background:#07141c;border:1px solid #285a68;padding:8px"><b style="color:#88f7ff">1.</b> Pick a contract.</div>
        <div style="background:#07141c;border:1px solid #285a68;padding:8px"><b style="color:#88f7ff">2.</b> Pay gold.</div>
        <div style="background:#07141c;border:1px solid #285a68;padding:8px"><b style="color:#88f7ff">3.</b> Place on water.</div>
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

export function showHarborDraftModal(state: GameStateShape, offers: HarborDraftOffer[], onUpdate?: () => void): void {
  if (typeof document === 'undefined') return;
  document.getElementById('harbor-draft-modal')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'harbor-draft-modal';
  const cards = offers.map((o, idx) => {
    const def: any = (towersData as any)[o.type] ?? {};
    const affordable = state.gold >= o.price;
    return `
      <div style="background:linear-gradient(180deg,#162b35,#0b1118);border:2px solid ${affordable ? '#5fe6ff' : '#6b3a3a'};padding:12px;text-align:left;box-shadow:inset 0 0 16px #000;display:flex;flex-direction:column;min-height:430px">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
          <div>
            <div style="font-size:10px;letter-spacing:2px;color:#88f7ff">${towerRole(String(o.type))}</div>
            <div style="margin-top:5px;font-size:16px;color:#ffd34d;font-weight:bold;line-height:1.2">${towerLabel(String(o.type))}</div>
          </div>
          <div style="flex:0 0 auto;background:#07141c;border:1px solid #5fe6ff;color:#88f7ff;font-size:10px;font-weight:bold;padding:4px 6px;letter-spacing:1px">T${o.tier}</div>
        </div>
        ${navalContractDetailsHtml(state, o, def)}
        <button data-harbor-buy="${idx}" style="margin-top:10px;width:100%;background:${affordable ? '#1d5c66' : '#332222'};color:${affordable ? '#fff8e0' : '#aa8888'};border:2px solid ${affordable ? '#88f7ff' : '#6b3a3a'};padding:8px;cursor:${affordable ? 'pointer' : 'not-allowed'};font-family:'Courier New',monospace;font-weight:bold;letter-spacing:1.5px">${affordable ? `${o.price}g CONTRACT` : `NEED ${o.price - state.gold}g`}</button>
      </div>`;
  }).join('');
  wrap.innerHTML = `
    <div id="harbor-draft-panel" style="width:min(1040px,96vw);max-height:min(88vh,820px);padding:20px 22px;background:linear-gradient(180deg,#102532,#070b10);border:3px solid #5fe6ff;box-shadow:0 0 38px #25bfff88,inset 0 0 24px #000;color:#fff8e0;font-family:'Courier New',monospace;text-align:center;overflow:hidden">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center">
        <div style="text-align:left">
          <div style="font-size:11px;letter-spacing:5px;color:#88f7ff;font-weight:bold">HARBOR DRAFT</div>
          <div style="font-size:21px;letter-spacing:3px;color:#ffd34d;font-weight:bold">Naval Contracts</div>
        </div>
        <button id="harbor-close" aria-label="Close Harbor Draft" style="background:#241810;color:#ffd34d;border:2px solid #7a5a1a;width:34px;height:34px;cursor:pointer;font-family:'Courier New',monospace;font-weight:bold">X</button>
      </div>
      <div id="harbor-draft-body" style="margin-top:10px;max-height:min(70vh,650px);overflow-y:auto;padding-right:6px">
        <div style="font-size:12px;color:#cdefff;text-align:left;line-height:1.5">Choose one contract, then click an ocean tile to place it, or close this panel to pass. A fresh draft appears after every cleared water-enemy wave. Each card shows the tier-adjusted stats you are buying.</div>
        <div style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px">${cards}</div>
      </div>
    </div>`;
  wrap.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);z-index:125;pointer-events:auto';
  document.getElementById('stage-wrap')?.appendChild(wrap);
  const panel = wrap.querySelector<HTMLElement>('#harbor-draft-panel');
  if (panel) {
    enhanceModalErgonomics(wrap, panel, {
      bodySelector: '#harbor-draft-body',
      title: 'Harbor Draft',
      closeButton: false,
      toolRightPx: 52
    });
  }
  wrap.querySelector<HTMLButtonElement>('#harbor-close')!.onclick = () => wrap.remove();
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
        wrap.remove();
        onUpdate?.();
      }
    };
  });
}
