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

import { TargetingMode, EnemyType, GamePhase } from '../../types';
import { UIManager } from '../../render/UIManager';
import { realizableCombos } from '../../systems/CombinationEngine';
import { showComboInfoModal } from '../../render/ComboPreview';
import { texUrl } from '../../render/Assets';
import towersData from '../../data/towers.json';
import { showSettingsPanel } from '../../render/SettingsPanel';
import { renderShop, showInventoryModal, renderInventoryButton } from '../../render/ShopUI';
import { renderPinnedRecipeWidget, ensurePinnedRecipeDefault } from '../../render/PinnedRecipe';
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

// Prospect column (single-player parity of main.ts updateProspectSidebar):
// during the prospect/keeper phase, list each PLACED-PENDING prospect as a
// portrait cell (click → its tower menu) plus a live RECIPES block of the
// combos those prospects can complete (green = kept, orange = still pending;
// click → the centered combo-info modal). Renders into the circle's LEFT panel.
const PS_TIER_HEX: Record<number, string> = { 1:'#aaaaaa', 2:'#b87333', 3:'#c0c0c0', 4:'#ffd34d', 5:'#ff5050' };
function renderCircleProspectColumn(board: CircleBoard, host: HTMLElement): void {
  const state = board.state;
  const inFlow = state.phase === GamePhase.PROSPECT_PLACEMENT || state.phase === GamePhase.PICK_KEEPER;
  const placed = Array.from(state.towers.values()).filter((t) => t.pending)
    .sort((a, b) => (a.tileY === b.tileY ? a.tileX - b.tileX : a.tileY - b.tileY));
  let panel = host.querySelector('#circle-prospect-col') as HTMLElement | null;
  if (!inFlow || placed.length === 0) { if (panel) panel.remove(); return; }

  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'circle-prospect-col';
    panel.style.cssText =
      'width:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;padding:8px;margin-top:6px;' +
      'background:linear-gradient(180deg,rgba(26,20,16,0.96),rgba(12,10,8,0.96));border:2px solid #d4af37;' +
      "box-shadow:0 0 14px rgba(212,175,55,0.25);font-family:'Courier New',monospace;max-height:48vh;overflow-y:auto;overflow-x:hidden";
    host.appendChild(panel);
  }

  const combos = realizableCombos(state).filter((cb: any) =>
    cb.ingredients.some((ing: any) => placed.some((p) => p.id === ing.id)));

  // Signature guard so per-frame refreshes don't destroy a mid-click handler.
  const sig = `${state.phase}|${placed.map((t) => `${t.id}:${t.qualityTier}`).join(',')}|`
    + combos.map((c: any) => `${c.result}:${c.ingredients.map((i: any) => !!state.towers.get(i.id)?.pending).join('')}`).join(';');
  if ((panel as any).__sig === sig) return;
  (panel as any).__sig = sig;

  const headline = state.phase === GamePhase.PICK_KEEPER
    ? `KEEP ${state.keepsRemainingThisRound ?? 2} / 2`
    : `${placed.length} PLACED`;
  const cell = (t: any) => {
    const src = texUrl(String(t.type)) ?? '';
    const def: any = (towersData as any)[t.type] ?? {};
    const cc = (def.critChance ?? 0) as number;
    const critTxt = cc > 0 ? `${Math.round(cc * 100)}% ${(def.critMult ?? 1.5).toFixed(1)}×` : '—';
    const col = PS_TIER_HEX[t.qualityTier] ?? '#aaa';
    return `<div class="cps-cell" data-col="${t.tileX}" data-row="${t.tileY}" style="position:relative;border:2px solid ${col};background:#0c0a08;padding:6px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px">
      <div style="width:84px;height:84px">${src ? `<img src="${src}" style="width:84px;height:84px;image-rendering:pixelated;display:block"/>` : ''}</div>
      <div style="font-size:11px;color:${col};font-weight:bold;letter-spacing:1px">T${t.qualityTier}</div>
      <div style="font-size:10px;color:#cdb98a;text-align:center;line-height:1.2;font-weight:bold;word-break:break-word">${String(t.type).replace(/_/g, ' ')}</div>
      <div style="font-size:9px;color:#aa9a4a;font-weight:bold">CRIT ${critTxt}</div>
    </div>`;
  };
  let recipeHtml = '';
  if (combos.length > 0) {
    const rows = combos.slice(0, 5).map((cb: any) => {
      const anyPending = cb.ingredients.some((ing: any) => state.towers.get(ing.id)?.pending);
      const hc = anyPending ? '#ff9933' : '#88ff88';
      const ing = cb.ingredients.map((i: any) => {
        const c = state.towers.get(i.id)?.pending ? '#ff9933' : '#88ff88';
        return `<span style="color:${c}">${String(i.type).replace(/_/g, ' ')}</span>`;
      }).join('<span style="color:#cdb98a"> + </span>');
      return `<div class="cps-recipe" data-combo="${String(cb.result)}" style="margin-bottom:6px;border-left:2px solid ${hc};background:#100c08;cursor:pointer;padding:6px 8px">
        <div style="color:${hc};font-weight:bold;letter-spacing:1px;font-size:11px">${String(cb.result).replace(/_/g, ' ')}</div>
        <div style="font-size:10px;margin-top:2px;word-break:break-word">${ing}</div>
        <div style="font-size:9px;color:${hc};letter-spacing:1px;margin-top:2px;font-weight:bold">${anyPending ? 'READY-IF-KEPT' : 'READY'} · ${cb.cost}g <span style="opacity:0.6;font-weight:normal">· click for details</span></div>
      </div>`;
    }).join('');
    recipeHtml = `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed #5a4a30">
      <div style="font-size:11px;letter-spacing:3px;color:#ffd34d;text-align:center;margin-bottom:5px;font-weight:bold">RECIPES</div>${rows}</div>`;
  }
  panel.innerHTML = `<div style="text-align:center;padding-bottom:6px;border-bottom:1px solid #5a4a30;margin-bottom:4px">
      <div style="font-size:12px;letter-spacing:3px;color:#ffd34d;font-weight:bold">${headline}</div></div>`
    + placed.map(cell).join('') + recipeHtml;
  panel.querySelectorAll('.cps-cell').forEach((el) => {
    const c = Number((el as HTMLElement).dataset.col), r = Number((el as HTMLElement).dataset.row);
    (el as HTMLElement).onclick = () => board.inspectAt(c, r);
  });
  panel.querySelectorAll('.cps-recipe').forEach((row) => {
    const key = (row as HTMLElement).dataset.combo ?? '';
    if (key) (row as HTMLElement).onclick = () => showComboInfoModal(key);
  });
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
  const buttonsRail = (rightPanel.querySelector('#buttons') ?? rightPanel) as HTMLElement;
  const leaveBtn = document.createElement('button');
  leaveBtn.textContent = '◀ LEAVE';
  leaveBtn.style.cssText =
    'background:#3a1810;color:#ff8080;border:2px solid #7a2a2a;padding:8px 14px;font-family:inherit;font-size:13px;cursor:pointer;letter-spacing:1px;font-weight:bold';
  leaveBtn.onclick = () => o.onLeave();
  buttonsRail.appendChild(leaveBtn);

  // Pinned-recipe widget parity (single-player QoL): seed the tutorial default
  // once, then render the live chip(s) into THIS sidebar's button rail every
  // frame. Passing buttonsRail keeps the widget in the circle's panel even if
  // a single-player #buttons still lives in the DOM underneath.
  ensurePinnedRecipeDefault();

  function refresh(): void {
    ui.update(board.state, null);
    if (tip.previousElementSibling !== ui.hud) ui.hud.insertAdjacentElement('afterend', tip);
    renderPinnedRecipeWidget(board.state, buttonsRail);
    renderCircleProspectColumn(board, leftPanel);   // prospect column in the left HUD
    renderInventoryButton(buttonsRail, board.inventory, { onOpen: openInventory });  // INVENTORY button + live count
  }
  function destroy(): void {
    leftPanel.remove();
    rightPanel.remove();
  }

  refresh();
  return { leftPanel, rightPanel, refresh, destroy };
}
