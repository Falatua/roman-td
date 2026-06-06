// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION — Green Circle sidebar (CIRCLE-4)
//
// Mounts the REAL single-player UIManager into the circle mode so it gets
// byte-for-byte the base left HUD (WAVE / LIVES / GOLD / POOL odds / SCORE,
// phase tip, next-wave preview) and the right button rail. Unlike the
// board-each LegionSidebar (which stubbed SHOP / MERCATOR / QUESTS as
// toasts), this wires the REAL systems:
//   • SHOP      → buildGateShop + renderShop (gate stock, lives, items)
//   • MERCATOR  → buildMercatorStock + buildMercatorTowerOffers + renderShop
//   • CODEX     → showCodex (all 9 tabs)
//   • QUESTS    → showCodex on its QUESTS tab
//   • INVENTORY → showInventoryModal
//   • DPS CHECK → spawns a TRAINING_DUMMY on the spiral
//   • SETTINGS / SPEED / PAUSE / UPGRADE POOL / TARGET ALL → board + base UI
//
// LIVES stays visible: on the circle it IS the shared center life pool.
// Isolated in /coop/circle — no single-player change.
// ─────────────────────────────────────────────────────────────────────

import { TargetingMode, EnemyType } from '../../types';
import { UIManager } from '../../render/UIManager';
import { showSettingsPanel } from '../../render/SettingsPanel';
import { renderShop, showInventoryModal } from '../../render/ShopUI';
import { buildGateShop, buildMercatorStock, buildMercatorTowerOffers, isMercatorWave } from '../../systems/MerchantSystem';
import { currentlyOwnedLegendarySet, inventoryRemove } from '../../systems/LootSystem';
import { spawnEnemy } from '../../systems/EnemySystem';
import { GRID } from '../../constants';
import type { CircleBoard } from './CircleBoard';

export interface CircleSidebarOpts {
  board: CircleBoard;
  overlay: HTMLElement;              // modal parent (the circle overlay)
  modeLabel: string;
  onStartWave: () => void;
  onLeaderboard: () => void;
  onLeave: () => void;
}

export interface CircleSidebar {
  leftPanel: HTMLElement;
  rightPanel: HTMLElement;
  refresh: () => void;
  destroy: () => void;
}

let _styleInjected = false;
function ensureCirclePanelStyle(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  const st = document.createElement('style');
  st.id = 'circle-sidebar-style';
  st.textContent = `
    .circle-panel { width:212px;flex:0 0 212px;height:100%;overflow-y:auto;overflow-x:hidden;
      background:linear-gradient(180deg,#120d07,#0a0704);box-sizing:border-box;padding:10px 8px;
      display:flex;flex-direction:column;gap:8px;scrollbar-width:thin;scrollbar-color:#5a431c #1a1409; }
    .circle-panel::-webkit-scrollbar { width:8px; }
    .circle-panel::-webkit-scrollbar-thumb { background:#5a431c;border-radius:4px; }
    .circle-panel #buttons { display:flex;flex-direction:column;gap:8px;margin-top:4px; }
  `;
  document.head.appendChild(st);
}

function toast(msg: string): void {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText =
    'position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:600;' +
    'background:#1a1206;border:2px solid #d4af37;color:#ffd34d;padding:10px 18px;border-radius:8px;' +
    "font-family:'Courier New',monospace;font-size:12px;letter-spacing:1px;box-shadow:0 0 20px #000a";
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

export function mountCircleSidebar(o: CircleSidebarOpts): CircleSidebar {
  ensureCirclePanelStyle();
  const board = o.board;
  const state = board.state;

  const leftPanel = document.createElement('div');
  leftPanel.className = 'circle-panel';
  const rightPanel = document.createElement('div');
  rightPanel.className = 'circle-panel';

  // Title strip.
  const strip = document.createElement('div');
  strip.style.cssText =
    'background:linear-gradient(180deg,#10210d,#070a05);border:1px solid #2a6a2a;border-radius:6px;padding:8px;display:flex;align-items:center;gap:8px';
  strip.innerHTML =
    `<span style="font-size:13px;font-weight:900;letter-spacing:2px;color:#88ff88">🟢 GREEN CIRCLE</span>
     <span style="font-size:8px;letter-spacing:2px;color:#cdb98a;border:1px solid #3a6a3a;border-radius:4px;padding:1px 5px">${o.modeLabel}</span>`;
  leftPanel.appendChild(strip);

  // The base UIManager reads #tip-text (it never creates it). Provide one.
  const tip = document.createElement('div');
  tip.id = 'tip-text';
  tip.style.cssText =
    'font-size:11px;line-height:1.45;color:#cdb98a;background:rgba(0,0,0,0.35);border-left:3px solid #5a431c;padding:7px 9px;margin-top:4px';

  // ── Real shop / mercator / inventory / dps openers ─────────────────────
  let gateShop: ReturnType<typeof buildGateShop> | null = null;
  function openGateShop(): void {
    if (!gateShop) gateShop = buildGateShop(state.wave, currentlyOwnedLegendarySet(state, board.inventory));
    (state as any).shopRefreshedUnopened = false;
    renderShop(o.overlay, gateShop, state, board.inventory, {
      onClose: () => document.getElementById('shop-modal')?.remove(),
    });
  }
  let mercatorShop: ReturnType<typeof buildMercatorStock> | null = null;
  function openMercator(): void {
    if (!isMercatorWave(state.wave)) {
      toast('The Mercator only visits on W4 / W9 / W14 / W19. Catch him next visit.');
      return;
    }
    if (board.inWave) { toast('The Mercator only trades between waves. Survive the current wave first.'); return; }
    if (!mercatorShop) {
      mercatorShop = buildMercatorStock(state.wave, currentlyOwnedLegendarySet(state, board.inventory));
      mercatorShop.towerOffers = buildMercatorTowerOffers(state.wave, 5);
    }
    renderShop(o.overlay, mercatorShop, state, board.inventory, {
      onClose: () => document.getElementById('shop-modal')?.remove(),
    });
  }
  function openInventory(): void {
    showInventoryModal(o.overlay, board.inventory, state, {
      onClose: () => document.getElementById('inventory-modal')?.remove(),
      onSell: (idx) => {
        const slot = board.inventory.slots[idx];
        if (!slot) return;
        const refund = Math.max(1, Math.floor((slot.buyPrice ?? 8) * 0.5));
        inventoryRemove(board.inventory, slot.id);
        state.gold += refund;
        openInventory();
      },
    });
  }
  function dpsCheck(): void {
    if (board.inWave) { toast('DPS Check runs between waves. Survive first.'); return; }
    const e: any = spawnEnemy(state, 'TRAINING_DUMMY' as EnemyType, 1.0);
    // Drop it on the spiral near a corner so towers can reach it.
    const sp = board.geo.spawns[0];
    const tile = board.geo.path[sp.pathIndex];
    e.pathIndex = sp.pathIndex; e.pathProgress = 0;
    e.x = e.prevX = tile.col * GRID.TILE + GRID.TILE / 2;
    e.y = e.prevY = tile.row * GRID.TILE + GRID.TILE / 2;
    state.enemies.set(e.id, e);
    toast('Training dummy deployed. Read its DPS in the tower menus.');
  }

  // ── Mount the REAL base sidebar with REAL system wiring ────────────────
  const ui = new UIManager(leftPanel, {
    onCardSelected: () => { /* prospect reveal handled on the canvas */ },
    onConfirmCard: () => o.onStartWave(),
    onPoolUpgrade: () => { board.upgradePool(); },
    onComboList: () => board.openCodex(),
    onOpenShop: () => openGateShop(),
    onOpenMercator: () => openMercator(),
    onOpenCodex: () => board.openCodex(),
    onOpenQuests: () => board.openCodex(),            // Codex carries the QUESTS tab
    onOpenInventory: () => openInventory(),
    onOpenLeaderboard: () => o.onLeaderboard(),
    onToggleSpeed: (btn) => {
      board.speedMult = board.speedMult >= 3 ? 1 : board.speedMult >= 2 ? 3 : 2;
      btn.textContent = `▶ ${board.speedMult}×`;
    },
    onTogglePause: (btn) => {
      board.paused = !board.paused;
      btn.textContent = board.paused ? '▶ RESUME' : '⏸ PAUSE';
    },
    onSellAllStones: () => toast('No maze walls to sell on the circle — towers sit on grass.'),
    onOpenSettings: () => showSettingsPanel(o.overlay),
    onDpsCheck: () => dpsCheck(),
    onSetAllTargeting: (mode: TargetingMode) => board.setAllTargeting(mode),
    onHeroInspect: () => {
      const h = Array.from(board.state.towers.values()).find((t) => String(t.type).startsWith('HERO_'));
      if (h) board.inspectAt(h.tileX, h.tileY);   // open the real tower menu on the placed hero
    },
  }, { leftPanel, rightPanel });

  // Place the tip bar directly under the HUD stat block.
  ui.hud.insertAdjacentElement('afterend', tip);

  // Append a LEAVE control to the right rail.
  const leaveBtn = document.createElement('button');
  leaveBtn.textContent = '◀ LEAVE';
  leaveBtn.style.cssText =
    'background:#3a1810;color:#ff8080;border:2px solid #7a2a2a;padding:8px 14px;font-family:inherit;font-size:13px;cursor:pointer;letter-spacing:1px;font-weight:bold';
  leaveBtn.onclick = () => o.onLeave();
  (rightPanel.querySelector('#buttons') ?? rightPanel).appendChild(leaveBtn);

  function refresh(): void {
    ui.update(board.state, null);
    if (tip.previousElementSibling !== ui.hud) ui.hud.insertAdjacentElement('afterend', tip);
  }
  function destroy(): void {
    leftPanel.remove();
    rightPanel.remove();
  }

  refresh();
  return { leftPanel, rightPanel, refresh, destroy };
}
