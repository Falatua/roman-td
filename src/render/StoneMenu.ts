import { GameStateShape } from '../GameState';
import { ECONOMY } from '../constants';
import { closeGameModals } from './ModalManager';

export interface StoneMenuHooks {
  onSell: () => void;
  onClose: () => void;
}

export function showStoneMenu(parent: HTMLElement, col: number, row: number, state: GameStateShape, hooks: StoneMenuHooks) {
  closeGameModals();
  const modal = document.createElement('div');
  modal.id = 'stone-menu';
  // 2026-05-19 — Responsive clamping (Codex pattern).
  modal.style.cssText = `position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;background:rgba(0,0,0,0.45);z-index:54;padding:16px 8px;box-sizing:border-box;overflow:auto;font-family:'Courier New',monospace;`;

  const panel = document.createElement('div');
  panel.style.cssText = 'width:min(360px,94vw);background:linear-gradient(180deg,#221912,#0c0a08);border:3px solid #8a7a5a;color:#e8d6a8;box-shadow:0 0 24px #000';
  panel.innerHTML = `
    <div style="background:#6b6048;color:#120d0a;padding:8px 10px;font-weight:bold;letter-spacing:2px;font-size:12px;display:flex;justify-content:space-between">
      <span>MAZE STONE</span><span>${col},${row}</span>
    </div>
    <div style="padding:14px;border-bottom:1px solid #3a3025">
      <div style="font-size:14px;color:#d4af37;font-weight:bold;letter-spacing:2px">Blocking Object</div>
      <div style="font-size:11px;color:#cdb98a;margin-top:6px;line-height:1.5">
        This stone extends your maze and changes the enemy route. Sell it here when you want to reopen pathing or recover Gold.
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#3a3025;margin-top:12px">
        <div style="background:#1a1410;padding:8px 10px"><div style="color:#aa9a4a;font-size:9px;letter-spacing:1px">REFUND</div><div style="color:#ffd34d;font-size:14px;font-weight:bold">${ECONOMY.STONE_COST}g</div></div>
        <div style="background:#1a1410;padding:8px 10px"><div style="color:#aa9a4a;font-size:9px;letter-spacing:1px">PHASE</div><div style="color:#9be0ff;font-size:14px;font-weight:bold">${state.wave + 1}</div></div>
      </div>
    </div>
  `;

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:8px;justify-content:center;padding:12px;background:linear-gradient(180deg,#1a1410,#0c0a08)';
  const sell = mkBtn(`SELL STONE (+${ECONOMY.STONE_COST}g)`, '#7a4a1a');
  sell.onclick = hooks.onSell;
  const close = mkBtn('CLOSE', '#444');
  close.onclick = hooks.onClose;
  actions.append(sell, close);
  panel.appendChild(actions);
  modal.appendChild(panel);
  parent.appendChild(modal);
}

function mkBtn(label: string, bg: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = `background:${bg};color:#e8d6a8;border:1px solid #5a4a30;padding:7px 12px;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:1px`;
  return b;
}
