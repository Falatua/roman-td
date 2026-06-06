// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION — Green Circle solo harness (CIRCLE-4)
//
// Hosts the live CircleBoard with the REAL single-player sidebar (left HUD
// + right button rail) mounted around the circular map canvas. Three-column
// layout, exactly like single-player: [HUD | board | buttons]. Solo-first.
//
// Reachable from the Legion lobby ("GREEN CIRCLE" button).
// ─────────────────────────────────────────────────────────────────────

import { CircleBoard } from './CircleBoard';
import { mountCircleSidebar, type CircleSidebar } from './CircleSidebar';
import { GamePhase } from '../../types';
import { GRID } from '../../constants';

const OVERLAY_ID = 'legion-overlay';
const TILE = GRID.TILE;

export async function startCircleSolo(): Promise<void> {
  document.getElementById(OVERLAY_ID)?.remove();

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:300;background:radial-gradient(circle at 50% 42%,#16210f,#070a05 85%);' +
    "font-family:'Courier New',monospace;color:#e7d6a8;overflow:hidden;display:flex;flex-direction:column";
  document.body.appendChild(overlay);

  const board = new CircleBoard({ startingGold: 100, overlay });
  const W = board.geo.size * TILE;

  const mainRow = document.createElement('div');
  mainRow.style.cssText = 'flex:1 1 auto;display:flex;align-items:stretch;min-height:0';
  overlay.appendChild(mainRow);

  const host = document.createElement('div');
  host.style.cssText = 'flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-height:0;min-width:0;position:relative';

  let sidebar: CircleSidebar | null = null;
  const onResize = () => fit();
  function teardown(): void {
    window.removeEventListener('resize', onResize);
    board.destroy();
    sidebar?.destroy();
    overlay.remove();
  }

  sidebar = mountCircleSidebar({
    board,
    overlay,
    modeLabel: 'SOLO TEST',
    onStartWave: () => board.march(),
    onLeaderboard: () => { /* team board comes with the multiplayer layer */ },
    onLeave: teardown,
  });

  mainRow.append(sidebar.leftPanel, host, sidebar.rightPanel);
  board.mount(host);

  const canvas = board.canvas;
  canvas.style.imageRendering = 'pixelated';
  canvas.style.cursor = 'crosshair';

  // Refresh the sidebar/HUD each frame off the board loop.
  board.onHud = () => sidebar?.refresh();

  // Click a grass tile to build (prototype: rolls a real tower type).
  canvas.addEventListener('click', (ev) => {
    if (board.state.phase === GamePhase.GAME_OVER || board.state.phase === GamePhase.VICTORY) return;
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / W;
    const col = Math.floor((ev.clientX - rect.left) / scale / TILE);
    const row = Math.floor((ev.clientY - rect.top) / scale / TILE);
    board.placeTower(col, row);
  });

  function fit(): void {
    const availW = host.clientWidth - 16;
    const availH = host.clientHeight - 16;
    const s = Math.max(0.3, Math.min(availW / W, availH / W, 1.6));
    canvas.style.width = Math.round(W * s) + 'px';
    canvas.style.height = Math.round(W * s) + 'px';
  }
  fit();
  window.addEventListener('resize', onResize);

  // expose for tooling/iteration
  (window as any).__circleSolo = { board, sidebar, geometry: board.geo };
}
