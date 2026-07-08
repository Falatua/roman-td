import { GameStateShape } from '../GameState';
import { HarborDraftOffer, queueHarborDraftPurchase } from '../systems/HarborSystem';
import towersData from '../data/towers.json';
import { enhanceModalErgonomics } from './ModalErgonomics';

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

export function showHarborUnlockModal(state: GameStateShape): void {
  if (typeof document === 'undefined') return;
  document.getElementById('harbor-unlock-modal')?.remove();
  const wrap = document.createElement('div');
  wrap.id = 'harbor-unlock-modal';
  wrap.innerHTML = `
    <div id="harbor-unlock-panel" style="width:min(620px,92vw);padding:24px 28px;background:linear-gradient(180deg,#102532,#080c12);border:3px solid #5fe6ff;box-shadow:0 0 38px #25bfff88,inset 0 0 24px #000;color:#fff8e0;font-family:'Courier New',monospace;text-align:center">
      <div style="font-size:11px;letter-spacing:6px;color:#88f7ff;font-weight:bold">THE SHIPWRECK STIRS</div>
      <div style="margin-top:8px;font-size:26px;letter-spacing:4px;color:#ffd34d;text-shadow:2px 2px 0 #000">THE HARBOR AWAKENS</div>
      <div style="margin-top:14px;font-size:13px;line-height:1.65;text-align:left;background:rgba(0,0,0,0.38);border-left:3px solid #5fe6ff;padding:12px 14px">
        The first Sea Giant has fallen. Ocean tiles can now host <b style="color:#88f7ff">naval towers</b> through the Harbor Draft.
        Click the ocean between waves to see three randomized contracts. These towers are optional early, but late sea pressure rewards players who invest before Rome is surrounded.
      </div>
      <button id="harbor-unlock-close" style="margin-top:18px;background:#17394a;color:#fff8e0;border:2px solid #88f7ff;padding:10px 24px;cursor:pointer;font-family:'Courier New',monospace;font-size:13px;font-weight:bold;letter-spacing:2px">OPEN THE HARBOR</button>
    </div>`;
  wrap.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);z-index:130;pointer-events:auto';
  document.getElementById('stage-wrap')?.appendChild(wrap);
  const panel = wrap.querySelector<HTMLElement>('#harbor-unlock-panel');
  if (panel) enhanceModalErgonomics(wrap, panel, { title: 'Harbor unlock notice' });
  wrap.querySelector<HTMLButtonElement>('#harbor-unlock-close')!.onclick = () => wrap.remove();
  state.hint = 'The Harbor is awake. Click ocean tiles between waves to draft naval towers.';
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
      <div style="flex:1;min-width:170px;background:linear-gradient(180deg,#162b35,#0b1118);border:2px solid ${affordable ? '#5fe6ff' : '#6b3a3a'};padding:12px;text-align:left;box-shadow:inset 0 0 16px #000">
        <div style="font-size:10px;letter-spacing:2px;color:#88f7ff">${towerRole(String(o.type))}</div>
        <div style="margin-top:5px;font-size:16px;color:#ffd34d;font-weight:bold;line-height:1.2">${towerLabel(String(o.type))}</div>
        <div style="margin-top:5px;font-size:11px;color:#cdefff">Tier ${o.tier} · ${def.damageType ?? 'SPECIAL'} · ${def.range ?? '?'} tiles</div>
        <div style="margin-top:8px;font-size:11px;color:#fff8e0;line-height:1.45;min-height:88px">${def.ability ?? ''}</div>
        <button data-harbor-buy="${idx}" ${affordable ? '' : 'disabled'} style="margin-top:10px;width:100%;background:${affordable ? '#1d5c66' : '#332222'};color:${affordable ? '#fff8e0' : '#aa8888'};border:2px solid ${affordable ? '#88f7ff' : '#6b3a3a'};padding:8px;cursor:${affordable ? 'pointer' : 'not-allowed'};font-family:'Courier New',monospace;font-weight:bold;letter-spacing:1.5px">${o.price}g CONTRACT</button>
      </div>`;
  }).join('');
  wrap.innerHTML = `
    <div id="harbor-draft-panel" style="width:min(760px,94vw);padding:20px 22px;background:linear-gradient(180deg,#102532,#070b10);border:3px solid #5fe6ff;box-shadow:0 0 38px #25bfff88,inset 0 0 24px #000;color:#fff8e0;font-family:'Courier New',monospace;text-align:center">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:center">
        <div style="text-align:left">
          <div style="font-size:11px;letter-spacing:5px;color:#88f7ff;font-weight:bold">HARBOR DRAFT</div>
          <div style="font-size:21px;letter-spacing:3px;color:#ffd34d;font-weight:bold">Naval Contracts</div>
        </div>
        <button id="harbor-close" aria-label="Close Harbor Draft" style="background:#241810;color:#ffd34d;border:2px solid #7a5a1a;width:34px;height:34px;cursor:pointer;font-family:'Courier New',monospace;font-weight:bold">X</button>
      </div>
      <div id="harbor-draft-body">
        <div style="margin-top:10px;font-size:12px;color:#cdefff;text-align:left;line-height:1.5">Choose one contract, then click an ocean tile to place it. Draft refreshes every three waves or after purchases.</div>
        <div style="margin-top:14px;display:flex;gap:12px;flex-wrap:wrap">${cards}</div>
      </div>
    </div>`;
  wrap.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);z-index:125;pointer-events:auto';
  document.getElementById('stage-wrap')?.appendChild(wrap);
  const panel = wrap.querySelector<HTMLElement>('#harbor-draft-panel');
  if (panel) {
    enhanceModalErgonomics(wrap, panel, {
      bodySelector: '#harbor-draft-body',
      title: 'Harbor Draft',
      toolRightPx: 52
    });
  }
  wrap.querySelector<HTMLButtonElement>('#harbor-close')!.onclick = () => wrap.remove();
  wrap.querySelectorAll<HTMLButtonElement>('[data-harbor-buy]').forEach(btn => {
    btn.onclick = () => {
      const offer = offers[Number(btn.dataset.harborBuy)];
      if (offer && queueHarborDraftPurchase(state, offer)) {
        wrap.remove();
        onUpdate?.();
      }
    };
  });
}
