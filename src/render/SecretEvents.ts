import { GameStateShape } from '../GameState';
import { InventoryState, inventoryAdd } from '../systems/LootSystem';
import {
  acceptSenateBailout,
  buildMercatorBackRoomOffers,
  claimMercatorBackRoomOffer,
  declineMercatorBackRoom,
  declineSenateBailout,
  MercatorBackRoomOffer,
  SENATE_BAILOUT_GOLD,
  SENATE_BAILOUT_TAX_RATE,
  SENATE_BAILOUT_TAX_WAVES
} from '../systems/SecretEventsSystem';
import towersData from '../data/towers.json';
import itemsData from '../data/items_permanent.json';
import { itemIconSvg } from './ItemIcon';
import { texUrl } from './Assets';
import { closeGameModals } from './ModalManager';

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ensureSecretEventStyles(): void {
  if (document.getElementById('secret-event-style')) return;
  const st = document.createElement('style');
  st.id = 'secret-event-style';
  st.textContent = `
    @keyframes secretEventIn {
      from { opacity:0; transform:translate(-50%, -48%) scale(0.96); }
      to { opacity:1; transform:translate(-50%, -50%) scale(1); }
    }
    .secret-event-btn {
      font-family:'Courier New',monospace;
      font-size:11px;
      font-weight:bold;
      letter-spacing:1.5px;
      border:2px solid #7a5a1a;
      cursor:pointer;
      padding:8px 12px;
      color:#fff8e0;
      background:#2a1a0e;
    }
    .secret-event-btn:hover { border-color:#ffd34d; filter:brightness(1.12); }
    .secret-event-btn:focus-visible { outline:3px solid #88ddff; outline-offset:2px; }
    .secret-event-card {
      transition:transform 0.08s ease, border-color 0.12s ease, box-shadow 0.12s ease;
    }
    .secret-event-card:hover {
      transform:translateY(-2px);
      border-color:#ffd34d !important;
      box-shadow:0 0 18px rgba(255,211,77,0.32), inset 0 0 18px rgba(255,211,77,0.08);
    }
    @media (max-width: 760px) {
      #mercator-backroom-grid { grid-template-columns:1fr !important; }
      #mercator-backroom-panel, #senate-bailout-panel { width:94vw !important; max-height:90vh !important; }
    }
  `;
  document.head.appendChild(st);
}

function offerArtHtml(offer: MercatorBackRoomOffer): string {
  if (offer.kind === 'ITEM' && offer.itemId && offer.rarity) {
    return itemIconSvg(offer.itemId, offer.rarity, 74);
  }
  if (offer.kind === 'TOWER' && offer.towerType) {
    const src = texUrl(offer.towerType);
    const name = (towersData as any)[offer.towerType]?.name ?? offer.towerType;
    if (src) return `<img src="${src}" alt="${escapeHtml(name)}" style="width:74px;height:74px;object-fit:contain;image-rendering:pixelated;filter:drop-shadow(0 2px 0 #000)"/>`;
  }
  const src = texUrl('MERCATOR_CART') || texUrl('MERCATOR');
  if (src) return `<img src="${src}" alt="" style="width:74px;height:74px;object-fit:contain;image-rendering:pixelated;filter:drop-shadow(0 2px 0 #000)"/>`;
  return `<div style="font-size:36px;color:#ffd34d">?</div>`;
}

function offerMetaHtml(offer: MercatorBackRoomOffer): string {
  if (offer.kind === 'ITEM' && offer.itemId) {
    const def: any = (itemsData as any)[offer.itemId] ?? {};
    return `<div style="font-size:9.5px;color:#cdb98a;line-height:1.35">${escapeHtml(def.effect ?? 'Legendary item.')}</div>`;
  }
  if (offer.kind === 'TOWER' && offer.towerType) {
    const def: any = (towersData as any)[offer.towerType] ?? {};
    return `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:6px;color:#cdb98a;font-size:9px">
      <span style="background:#120d08;border:1px solid #3a3025;padding:4px;text-align:center"><b style="color:#ffd34d">DPS</b><br/>${Math.round(Number(def.baseDps ?? 0))}</span>
      <span style="background:#120d08;border:1px solid #3a3025;padding:4px;text-align:center"><b style="color:#ffd34d">RNG</b><br/>${Number(def.range ?? 0).toFixed(1)}</span>
      <span style="background:#120d08;border:1px solid #3a3025;padding:4px;text-align:center"><b style="color:#ffd34d">SPD</b><br/>${Number(def.attackSpeed ?? 0).toFixed(2)}/s</span>
    </div>`;
  }
  return `<div style="font-size:9.5px;color:#cdb98a;line-height:1.35">Adds traps to inventory and one rampart to your placement stockpile.</div>`;
}

export function showMercatorBackRoomModal(
  state: GameStateShape,
  inventory: InventoryState,
  hooks: { onClose?: () => void; onClaim?: (offer: MercatorBackRoomOffer) => void } = {}
): void {
  closeGameModals();
  ensureSecretEventStyles();
  document.getElementById('mercator-backroom-modal')?.remove();
  const offers = buildMercatorBackRoomOffers(state);
  const root = document.createElement('div');
  root.id = 'mercator-backroom-modal';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.style.cssText = `position:fixed;inset:0;z-index:2147483647;background:radial-gradient(circle at 50% 32%,rgba(255,211,77,0.18),rgba(0,0,0,0.88) 56%,rgba(0,0,0,0.96));font-family:'Courier New',monospace;color:#fff8e0;`;

  const cartSrc = texUrl('MERCATOR_CART') || texUrl('MERCATOR');
  const cart = cartSrc ? `<img src="${cartSrc}" alt="" style="width:72px;height:72px;image-rendering:pixelated;filter:drop-shadow(2px 2px 0 #000);flex-shrink:0"/>` : '';
  root.innerHTML = `
    <div id="mercator-backroom-panel" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(980px,92vw);max-height:88vh;display:flex;flex-direction:column;background:linear-gradient(180deg,#2a1708,#0c0805 44%,#080604);border:4px double #ffd34d;box-shadow:0 0 54px rgba(255,211,77,0.45),inset 0 0 28px rgba(0,0,0,0.8);animation:secretEventIn 0.22s ease-out;">
      <div style="padding:16px 18px 13px;border-bottom:2px solid #7a5a1a;background:linear-gradient(90deg,#120905,#3a210d,#120905);display:flex;gap:14px;align-items:center">
        ${cart}
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;letter-spacing:5px;color:#ffcc66;font-weight:bold">MERCATOR'S BACK ROOM</div>
          <div style="margin-top:5px;font-size:24px;line-height:1.1;font-weight:bold;letter-spacing:3px;color:#fff8e0;text-shadow:2px 2px 0 #000,0 0 16px #ffd34d">THE CURTAIN BEHIND THE CART OPENS</div>
          <div style="margin-top:8px;color:#d8c79a;font-size:12px;line-height:1.5">
            Mercator has noticed your excellent taste in suspicious purchases. Choose <b style="color:#ffd34d">one</b> private bargain, or close the curtain and pretend this never happened.
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;align-self:flex-start">
          <button class="secret-event-btn" id="mercator-backroom-collapse" type="button" title="Collapse this secret offer">MIN</button>
          <button class="secret-event-btn" id="mercator-backroom-x" type="button" title="Decline and close">X</button>
        </div>
      </div>
      <div id="mercator-backroom-body" style="padding:14px 18px;overflow:auto;min-height:0">
        <div id="mercator-backroom-grid" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">
          ${offers.map(offer => `
            <div class="secret-event-card" data-backroom-card="${escapeHtml(offer.id)}" style="border:2px solid #7a5a1a;background:linear-gradient(180deg,#20160d,#080604);padding:10px;display:flex;flex-direction:column;gap:9px;min-height:290px;box-shadow:inset 0 0 14px rgba(0,0,0,0.62)">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                <span style="font-size:9px;color:#ffd34d;font-weight:bold;letter-spacing:1.5px">${escapeHtml(offer.eyebrow)}</span>
                <span style="font-size:11px;color:#f0c040;font-weight:bold">${offer.price}g</span>
              </div>
              <div style="display:grid;place-items:center;width:88px;height:88px;margin:0 auto;background:radial-gradient(circle,#3a2412 0%,#0c0805 72%);border:1px solid #ffd34d55;box-shadow:0 0 12px rgba(255,211,77,0.22)">${offerArtHtml(offer)}</div>
              <div style="font-size:14px;color:#fff8e0;font-weight:bold;text-align:center;line-height:1.2">${escapeHtml(offer.title)}</div>
              <div style="font-size:10.5px;color:#d8c79a;line-height:1.45;flex:1">${escapeHtml(offer.description)}</div>
              ${offerMetaHtml(offer)}
              <button class="secret-event-btn" data-backroom-buy="${escapeHtml(offer.id)}" type="button" style="background:${state.gold >= offer.price ? '#3a5520' : '#2a2a2a'};border-color:${state.gold >= offer.price ? '#88cc55' : '#555'};color:${state.gold >= offer.price ? '#fff8e0' : '#888'}">${state.gold >= offer.price ? 'BUY SECRET' : `NEED ${offer.price - state.gold}g`}</button>
            </div>
          `).join('')}
        </div>
        <div id="mercator-backroom-message" style="margin-top:10px;min-height:18px;color:#ffcc88;font-size:11px;line-height:1.4;text-align:center"></div>
      </div>
      <div id="mercator-backroom-footer" style="padding:10px 16px;border-top:1px solid #5a3a14;color:#aa9a4a;font-size:10px;line-height:1.45;text-align:center;background:#080604">
        One bargain. One time. Mercator will deny the room exists if asked by anyone with a badge.
      </div>
    </div>`;

  document.body.appendChild(root);
  const body = root.querySelector<HTMLElement>('#mercator-backroom-body');
  const footer = root.querySelector<HTMLElement>('#mercator-backroom-footer');
  const msg = root.querySelector<HTMLElement>('#mercator-backroom-message');
  let collapsed = false;
  const closeDecline = () => {
    declineMercatorBackRoom(state);
    root.remove();
    hooks.onClose?.();
  };
  root.querySelector<HTMLButtonElement>('#mercator-backroom-x')?.addEventListener('click', closeDecline);
  root.querySelector<HTMLButtonElement>('#mercator-backroom-collapse')?.addEventListener('click', ev => {
    ev.stopPropagation();
    collapsed = !collapsed;
    if (body) body.style.display = collapsed ? 'none' : 'block';
    if (footer) footer.style.display = collapsed ? 'none' : 'block';
    const btn = ev.currentTarget as HTMLButtonElement;
    btn.textContent = collapsed ? 'OPEN' : 'MIN';
  });
  root.querySelectorAll<HTMLButtonElement>('button[data-backroom-buy]').forEach(btn => {
    btn.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const id = btn.dataset.backroomBuy;
      if (!id) return;
      const result = claimMercatorBackRoomOffer(state, id, {
        addItem: (itemId, rarity, price) => inventoryAdd(inventory, itemId, rarity, false, price)
      });
      if (!result.ok) {
        if (msg) {
          msg.textContent = result.reason === 'not_enough_gold'
            ? 'Mercator taps the price tag. The back room still uses math.'
            : result.reason === 'inventory_full'
              ? 'Inventory full. Sell or equip something before buying a secret item.'
              : 'The curtain jams. This secret bargain is no longer available.';
        }
        return;
      }
      root.remove();
      hooks.onClaim?.(result.offer);
      hooks.onClose?.();
    });
  });
}

export function showSenateBailoutModal(
  state: GameStateShape,
  hooks: { onAccept?: () => void; onDecline?: () => void } = {}
): void {
  closeGameModals();
  ensureSecretEventStyles();
  document.getElementById('senate-bailout-modal')?.remove();
  const root = document.createElement('div');
  root.id = 'senate-bailout-modal';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.style.cssText = `position:fixed;inset:0;z-index:2147483647;background:radial-gradient(circle at 50% 34%,rgba(136,221,255,0.16),rgba(0,0,0,0.88) 58%,rgba(0,0,0,0.96));font-family:'Courier New',monospace;color:#fff8e0;`;
  const badgeSrc = texUrl('BADGE_GOLD') || texUrl('ORB_LEGENDARY');
  const badge = badgeSrc ? `<img src="${badgeSrc}" alt="" style="width:82px;height:82px;image-rendering:pixelated;filter:drop-shadow(2px 2px 0 #000) drop-shadow(0 0 10px #ffd34d)"/>` : '';
  const taxPct = Math.round(SENATE_BAILOUT_TAX_RATE * 100);
  root.innerHTML = `
    <div id="senate-bailout-panel" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(720px,92vw);max-height:88vh;display:flex;flex-direction:column;background:linear-gradient(180deg,#102030,#080604);border:4px double #88ddff;box-shadow:0 0 54px rgba(136,221,255,0.35),inset 0 0 28px rgba(0,0,0,0.8);animation:secretEventIn 0.22s ease-out;">
      <div style="padding:18px 22px 14px;border-bottom:2px solid #446688;background:linear-gradient(90deg,#06111a,#1b3a4a,#06111a);display:flex;gap:16px;align-items:center">
        ${badge}
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;letter-spacing:5px;color:#88ddff;font-weight:bold">EMERGENCY SENATE SESSION</div>
          <div style="margin-top:6px;font-size:25px;line-height:1.15;font-weight:bold;letter-spacing:3px;color:#fff8e0;text-shadow:2px 2px 0 #000,0 0 16px #88ddff">THE SENATE HAS FOUND A WALLET</div>
          <div style="margin-top:9px;color:#d8c79a;font-size:12px;line-height:1.55">
            Your treasury is thin and Rome is breathing through a reed. The Senate offers <b style="color:#ffd34d">${SENATE_BAILOUT_GOLD}g now</b>, then skims <b style="color:#ffcc66">${taxPct}%</b> from combat and wave income for the next <b style="color:#ffcc66">${SENATE_BAILOUT_TAX_WAVES}</b> cleared campaign waves.
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;align-self:flex-start">
          <button class="secret-event-btn" id="senate-bailout-collapse" type="button" title="Collapse this offer">MIN</button>
          <button class="secret-event-btn" id="senate-bailout-x" type="button" title="Refuse bailout">X</button>
        </div>
      </div>
      <div id="senate-bailout-body" style="padding:16px 20px;overflow:auto;min-height:0">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div style="background:#0c0a08;border:2px solid #ffd34d;padding:12px;text-align:center">
            <div style="font-size:10px;color:#aa9a4a;letter-spacing:2px">IMMEDIATE RELIEF</div>
            <div style="font-size:34px;color:#ffd34d;font-weight:bold;margin-top:4px">+${SENATE_BAILOUT_GOLD}g</div>
            <div style="font-size:10.5px;color:#cdb98a;line-height:1.45;margin-top:4px">Use it for prospects, shop stock, recipes, or one questionable plan with confidence.</div>
          </div>
          <div style="background:#0c0a08;border:2px solid #ffcc66;padding:12px;text-align:center">
            <div style="font-size:10px;color:#aa9a4a;letter-spacing:2px">SENATE TAX</div>
            <div style="font-size:34px;color:#ffcc66;font-weight:bold;margin-top:4px">${taxPct}%</div>
            <div style="font-size:10.5px;color:#cdb98a;line-height:1.45;margin-top:4px">Only future combat and wave reward income gets skimmed. Refunds and selling stay clean.</div>
          </div>
        </div>
        <div style="margin-top:12px;padding:10px 12px;background:rgba(60,30,10,0.55);border:1px dashed #ff8844;color:#ffcc88;font-size:12px;line-height:1.55">
          Accept this when the run is slipping but still alive. It is a comeback lever, not charity. The Senate will absolutely call it charity.
        </div>
      </div>
      <div id="senate-bailout-footer" style="padding:13px 18px;border-top:1px solid #446688;background:#080604;display:flex;gap:10px;justify-content:flex-end;align-items:center">
        <button class="secret-event-btn" id="senate-bailout-no" type="button" style="background:#2a1a0e;color:#cdb98a">REFUSE THE LOAN</button>
        <button class="secret-event-btn" id="senate-bailout-yes" type="button" style="background:#204a30;border-color:#88ff88;color:#fff8e0">ACCEPT +${SENATE_BAILOUT_GOLD}g</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  const body = root.querySelector<HTMLElement>('#senate-bailout-body');
  const footer = root.querySelector<HTMLElement>('#senate-bailout-footer');
  let collapsed = false;
  const decline = () => {
    declineSenateBailout(state);
    root.remove();
    hooks.onDecline?.();
  };
  root.querySelector<HTMLButtonElement>('#senate-bailout-x')?.addEventListener('click', decline);
  root.querySelector<HTMLButtonElement>('#senate-bailout-no')?.addEventListener('click', decline);
  root.querySelector<HTMLButtonElement>('#senate-bailout-collapse')?.addEventListener('click', ev => {
    ev.stopPropagation();
    collapsed = !collapsed;
    if (body) body.style.display = collapsed ? 'none' : 'block';
    if (footer) footer.style.display = collapsed ? 'none' : 'flex';
    const btn = ev.currentTarget as HTMLButtonElement;
    btn.textContent = collapsed ? 'OPEN' : 'MIN';
  });
  root.querySelector<HTMLButtonElement>('#senate-bailout-yes')?.addEventListener('click', ev => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!acceptSenateBailout(state)) return;
    root.remove();
    hooks.onAccept?.();
  });
}
