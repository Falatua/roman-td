// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION — Sidebar (LV3)
//
// Brings the REAL single-player left/right panel layout into Legion by
// mounting the actual base UIManager into Legion-owned panel containers
// (UIManager now accepts injected panels). That gives byte-for-byte:
//   - LEFT panel: the HUD (WAVE / GOLD / POOL + the tier-odds strip that IS
//     the prospecting readout, SCORE, PHASE), the context tip bar that
//     guides the click-to-reveal prospecting, and the next-wave preview.
//   - RIGHT panel: the action buttons (START WAVE / SPEED / PAUSE /
//     UPGRADE POOL / SHOP / CODEX / TARGET ALL + 7-mode picker / …) with
//     base styling, wired to the real RomanBoard systems.
//
// On top of the base HUD we prepend a Legion teamwork strip (Rome bar +
// kills + dishonor) and append a LEGION BOARD + LEAVE control, and we hide
// the campaign-only LIVES chip (Rome is the Legion objective, not lives).
//
// Buttons Legion fully supports are wired to the board; the few that are
// campaign-only (SHOP / QUESTS / DPS / SELL STONES) show an honest toast.
// SETTINGS opens the real audio panel. Isolated in /coop — no single-player
// change beyond UIManager's optional injected-panel param.
// ─────────────────────────────────────────────────────────────────────

import { TargetingMode } from '../types';
import { UIManager } from '../render/UIManager';
import { showSettingsPanel } from '../render/SettingsPanel';
import type { RomanBoard } from './RomanBoard';
import { romeHpFraction, romeBarColor } from './LegionRome';
import type { PlayerStats, RomeState } from './LegionTypes';

export interface LegionSidebarOpts {
  board: RomanBoard;
  modeLabel: string;                 // "SOLO TEST" / "LEGION"
  onStartWave: () => void;           // host: brief-then-march (solo) or march
  onLeaderboard: () => void;         // host: LEGION BOARD modal
  onLeave: () => void;
  getRome: () => RomeState;
  getStats: () => PlayerStats;
}

export interface LegionSidebar {
  leftPanel: HTMLElement;
  rightPanel: HTMLElement;
  refresh: () => void;
  destroy: () => void;
}

let _styleInjected = false;
function ensureLegionPanelStyle(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  const st = document.createElement('style');
  st.id = 'legion-sidebar-style';
  st.textContent = `
    .legion-panel { width:212px;flex:0 0 212px;height:100%;overflow-y:auto;overflow-x:hidden;
      background:linear-gradient(180deg,#120d07,#0a0704);box-sizing:border-box;padding:10px 8px;
      display:flex;flex-direction:column;gap:8px;scrollbar-width:thin;scrollbar-color:#5a431c #1a1409; }
    .legion-panel::-webkit-scrollbar { width:8px; }
    .legion-panel::-webkit-scrollbar-thumb { background:#5a431c;border-radius:4px; }
    .legion-panel #buttons { display:flex;flex-direction:column;gap:8px;margin-top:4px; }
    .legion-panel #hud-top { display:flex; }
    /* Rome is the Legion objective — hide the campaign LIVES chip. */
    .legion-panel [data-stat="lives"] { display:none !important; }
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
  setTimeout(() => t.remove(), 2200);
}

export function mountLegionSidebar(o: LegionSidebarOpts): LegionSidebar {
  ensureLegionPanelStyle();
  const board = o.board;

  const leftPanel = document.createElement('div');
  leftPanel.className = 'legion-panel';
  const rightPanel = document.createElement('div');
  rightPanel.className = 'legion-panel';

  // ── Legion teamwork strip (prepended above the base HUD) ───────────────
  const strip = document.createElement('div');
  strip.style.cssText =
    'background:linear-gradient(180deg,#1c1409,#0d0805);border:1px solid #5a431c;border-radius:6px;padding:8px;display:flex;flex-direction:column;gap:6px';
  strip.innerHTML =
    `<div style="display:flex;align-items:center;gap:8px">
       <span style="font-size:13px;font-weight:900;letter-spacing:2px;color:#ffd34d">⚔ LEGION</span>
       <span style="font-size:8px;letter-spacing:2px;color:#88cc88;border:1px solid #3a6a3a;border-radius:4px;padding:1px 5px">${o.modeLabel}</span>
     </div>
     <div style="display:flex;justify-content:space-between;font-size:11px">
       <span style="color:#9fd0ff" id="lg-s-kills">⚔ 0</span>
       <span style="color:#ffae6b" id="lg-s-dishonor">⚑ 0</span>
     </div>
     <div>
       <div style="font-size:9px;letter-spacing:2px;color:#cdb98a;margin-bottom:2px">ROMA</div>
       <div style="height:12px;background:#000a;border:1px solid #5a431c;border-radius:6px;overflow:hidden">
         <div id="lg-s-rome-bar" style="height:100%;width:100%;background:#66ff88;transition:width .25s"></div>
       </div>
       <div id="lg-s-rome-num" style="font-size:9px;color:#e7d6a8;text-align:right;margin-top:2px">—</div>
     </div>`;
  leftPanel.appendChild(strip);

  // The base UIManager reads #tip-text (it never creates it). Provide one in
  // the left panel so its prospecting / phase guidance shows, exactly like base.
  const tip = document.createElement('div');
  tip.id = 'tip-text';
  tip.style.cssText =
    'font-size:11px;line-height:1.45;color:#cdb98a;background:rgba(0,0,0,0.35);border-left:3px solid #5a431c;padding:7px 9px;margin-top:4px';
  // (appended AFTER the UIManager hud below so it sits under the stat block.)

  // ── Mount the REAL base sidebar into our panels ───────────────────────
  const ui = new UIManager(leftPanel, {
    onCardSelected: () => { /* prospect cards are hidden in base; click-tile flow handles reveal */ },
    onConfirmCard: () => o.onStartWave(),
    onPoolUpgrade: () => { board.upgradePool(); },
    onComboList: () => board.openCodex(),
    onOpenShop: () => toast('SHOP is campaign-only for now — coming to Legion.'),
    onOpenMercator: () => toast('The Mercator does not visit the Legion front.'),
    onOpenCodex: () => board.openCodex(),
    onOpenQuests: () => toast('Quests are campaign-only — Legion tracks the team board instead.'),
    onOpenLeaderboard: () => o.onLeaderboard(),
    onToggleSpeed: (btn) => {
      board.speedMult = board.speedMult >= 3 ? 1 : board.speedMult >= 2 ? 3 : 2;
      btn.textContent = `▶ ${board.speedMult}×`;
    },
    onTogglePause: (btn) => {
      board.paused = !board.paused;
      btn.textContent = board.paused ? '▶ RESUME' : '⏸ PAUSE';
    },
    onSellAllStones: () => toast('Stone-selling is campaign-only for now.'),
    onOpenSettings: () => showSettingsPanel(document.getElementById('legion-overlay') ?? document.body),
    onDpsCheck: () => toast('DPS Check is campaign-only for now.'),
    onSetAllTargeting: (mode: TargetingMode) => board.setAllTargeting(mode),
    onHeroInspect: () => { /* no hero draft in Legion */ },
  }, { leftPanel, rightPanel });

  // Place the tip bar directly under the HUD stat block.
  ui.hud.insertAdjacentElement('afterend', tip);

  // Relabel START WAVE → the legion "MARCH" verb (same button, base styling).
  ui.startBtn.textContent = '⚔ MARCH TO WAR';
  ui.startBtn.title = 'Begin the next wave. Builds + buys lock until the wave ends.';

  // Append LEGION BOARD + LEAVE to the right panel button column.
  const boardBtn = mkLegionBtn('🏆 LEGION BOARD', '#10243a', '#9be0ff');
  boardBtn.title = 'Open the team board: every legionnaire\'s kills, leaks (dishonor), and damage.';
  boardBtn.onclick = () => o.onLeaderboard();
  const leaveBtn = mkLegionBtn('◀ LEAVE', '#3a1810', '#ff8080');
  leaveBtn.onclick = () => o.onLeave();
  const buttonsHost = rightPanel.querySelector('#buttons') ?? rightPanel;
  buttonsHost.append(boardBtn, leaveBtn);

  // ── Live HUD refresh ──────────────────────────────────────────────────
  const romeBar = strip.querySelector('#lg-s-rome-bar') as HTMLElement;
  const romeNum = strip.querySelector('#lg-s-rome-num') as HTMLElement;
  const killsEl = strip.querySelector('#lg-s-kills') as HTMLElement;
  const dishonorEl = strip.querySelector('#lg-s-dishonor') as HTMLElement;

  function refresh(): void {
    ui.update(board.state, null);
    // ui.update rebuilds hud.innerHTML, which detaches our tip bar reference's
    // sibling order only if it was inside hud — it is not (it's a sibling), so
    // it survives. Re-assert position defensively if it got moved.
    if (tip.previousElementSibling !== ui.hud) ui.hud.insertAdjacentElement('afterend', tip);
    const rome = o.getRome();
    const stats = o.getStats();
    romeBar.style.width = (romeHpFraction(rome) * 100).toFixed(1) + '%';
    romeBar.style.background = romeBarColor(rome);
    romeNum.textContent = `${Math.ceil(rome.hp)} / ${rome.maxHp}`;
    killsEl.textContent = '⚔ ' + (stats.waveKills + stats.circuitKills);
    dishonorEl.textContent = '⚑ ' + stats.leaksTotal;
  }

  function destroy(): void {
    leftPanel.remove();
    rightPanel.remove();
  }

  refresh();
  return { leftPanel, rightPanel, refresh, destroy };
}

function mkLegionBtn(label: string, bg: string, fg: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText =
    `background:${bg};color:${fg};border:2px solid ${fg};padding:8px 14px;font-family:inherit;font-size:13px;cursor:pointer;letter-spacing:1px;font-weight:bold`;
  return b;
}
