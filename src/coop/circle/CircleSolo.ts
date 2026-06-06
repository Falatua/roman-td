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
import { GamePhase, TileType } from '../../types';
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

  // Hero-placement banner (bottom-center), shown while a drafted hero awaits placement.
  const heroBanner = document.createElement('div');
  heroBanner.style.cssText =
    'position:absolute;left:50%;bottom:18px;transform:translateX(-50%);z-index:40;display:none;' +
    'background:linear-gradient(180deg,#0d1830,#08101f);border:2px solid #4a90e2;border-radius:8px;' +
    'padding:8px 20px;text-align:center;color:#cfe6ff;box-shadow:0 0 22px #0009;pointer-events:none;' +
    'animation:cs-pulse 1.2s ease-in-out infinite';
  host.appendChild(heroBanner);
  if (!document.getElementById('cs-pulse-style')) {
    const st = document.createElement('style'); st.id = 'cs-pulse-style';
    st.textContent = '@keyframes cs-pulse{0%,100%{opacity:.78}50%{opacity:1}}';
    document.head.appendChild(st);
  }

  // Refresh the sidebar/HUD each frame off the board loop + toggle hero banner.
  board.onHud = () => {
    sidebar?.refresh();
    if (board.pendingHero) {
      const h = board.state.pendingPurchasedTowers![0];
      heroBanner.style.display = '';
      heroBanner.innerHTML = `<div style="font-size:11px;letter-spacing:2px;color:#9fd0ff">★ CLICK ANY GRASS TILE TO PLACE</div>` +
        `<div style="font-size:15px;font-weight:900;letter-spacing:1px">${String(h.type).replace(/^HERO_/, '').replace(/_/g, ' ')}</div>`;
    } else if (heroBanner.style.display !== 'none') {
      heroBanner.style.display = 'none';
    }
  };

  const tileAt = (ev: MouseEvent): { col: number; row: number } => {
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / W;
    return { col: Math.floor((ev.clientX - rect.left) / scale / TILE), row: Math.floor((ev.clientY - rect.top) / scale / TILE) };
  };

  // Click a grass tile: hero placement > tower inspect > prospect reveal (real flow).
  canvas.addEventListener('click', (ev) => {
    const { col, row } = tileAt(ev);
    board.handleTileClick(col, row);
  });

  // Hover highlight on build tiles (green = buildable, red = blocked).
  canvas.addEventListener('mousemove', (ev) => {
    const { col, row } = tileAt(ev);
    if (col < 0 || row < 0 || col >= board.geo.size || row >= board.geo.size) { board.hover = null; return; }
    const empty = board.isBuildTile(col, row) && board.state.tiles[row]?.[col] === TileType.EMPTY;
    board.hover = { col, row, valid: empty && (board.state.phase === GamePhase.PROSPECT_PLACEMENT || board.pendingHero) };
  });
  canvas.addEventListener('mouseleave', () => { board.hover = null; });

  // Start-of-game hero draft (real ChooseHeroModal → state.pendingPurchasedTowers).
  import('../../render/ChooseHeroModal')
    .then((m) => m.showChooseHeroModal(board.state))
    .catch(() => { /* hero draft optional */ });

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
