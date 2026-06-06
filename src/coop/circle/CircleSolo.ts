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
import { showEnemyInspect } from '../../render/EnemyInspect';
import { isMercatorWave } from '../../systems/MerchantSystem';
import { GamePhase, TileType } from '../../types';
import { GRID } from '../../constants';

const OVERLAY_ID = 'legion-overlay';
const TILE = GRID.TILE;

export async function startCircleSolo(): Promise<void> {
  // Tear down any prior circle session first — otherwise its setInterval loop
  // keeps running (CPU/memory leak) and rival boards fight over global state.
  try { (window as any).__circleSolo?.board?.destroy?.(); } catch { /* ignore */ }
  try { (window as any).__circleSolo?.sidebar?.destroy?.(); } catch { /* ignore */ }
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

  // Victory / defeat end screen (single-player parity — the run resolves).
  let ended = false;
  function showEndScreen(win: boolean): void {
    const s = board.state;
    const card = document.createElement('div');
    card.id = 'cs-endscreen';
    card.style.cssText = 'position:absolute;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(4,6,3,0.80)';
    card.innerHTML =
      `<div style="background:linear-gradient(180deg,#1a1206,#0a0704);border:2px solid ${win ? '#5ac46a' : '#c45a5a'};border-radius:12px;padding:26px 38px;text-align:center;box-shadow:0 0 44px #000">
        <div style="font-size:26px;font-weight:900;letter-spacing:3px;color:${win ? '#9fe6a0' : '#ff8080'};text-shadow:0 0 10px #000">${win ? '⚔ VICTORY' : '☠ ROME HAS FALLEN'}</div>
        <div style="font-size:12px;color:#cdb98a;margin:10px 0 16px">${win ? 'The Legion held the circle to Wave 20.' : 'The center pool was breached.'}</div>
        <div style="font-size:13px;color:#e7d6a8;line-height:1.9">Wave <b>${s.wave}</b> / 20 &nbsp;·&nbsp; Kills <b>${s.totalKills}</b> &nbsp;·&nbsp; Score <b>${s.score}</b> &nbsp;·&nbsp; Rome <b>${board.state.lives}</b></div>
        <div style="margin-top:20px;display:flex;gap:10px;justify-content:center">
          <button id="cs-again" style="background:#1a3a18;color:#aaffaa;border:2px solid #2a7a2a;border-radius:6px;padding:9px 20px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:1px;font-weight:900">↻ PLAY AGAIN</button>
          <button id="cs-end-leave" style="background:#3a1810;color:#ff8080;border:2px solid #7a2a2a;border-radius:6px;padding:9px 20px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:1px">◀ LEAVE</button>
        </div>
      </div>`;
    host.appendChild(card);
    (card.querySelector('#cs-again') as HTMLElement).onclick = () => { teardown(); void startCircleSolo(); };
    (card.querySelector('#cs-end-leave') as HTMLElement).onclick = () => teardown();
  }

  // Transient on-board banner (boss approach / Mercator visit).
  function flashBanner(text: string, color: string, ms = 2600): void {
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;left:50%;top:54px;transform:translateX(-50%);z-index:50;pointer-events:none;' +
      'background:linear-gradient(180deg,#1a1206,#0a0704);border:2px solid ' + color + ';border-radius:9px;padding:9px 24px;' +
      'color:#ffe9a8;text-align:center;box-shadow:0 0 26px #000a;font-weight:900;letter-spacing:1.5px;font-size:14px';
    d.textContent = text;
    host.appendChild(d);
    setTimeout(() => { d.style.transition = 'opacity .45s'; d.style.opacity = '0'; setTimeout(() => d.remove(), 450); }, ms);
  }
  let lastMercatorBannerWave = -1;
  board.onWaveStart = (info) => {
    if (info.isBoss) flashBanner('⚔ BOSS APPROACHING — WAVE ' + info.wave, '#cc3322', 3000);
  };
  // Quest-completion banner (single-player parity) — celebrate the reward.
  board.onQuestComplete = (q) => flashBanner(`✓ QUEST COMPLETE — ${q.title}  ${q.reward}`, '#88ff88', 3400);

  // Refresh the sidebar/HUD each frame off the board loop + toggle hero banner.
  board.onHud = () => {
    sidebar?.refresh();
    // Mercator-in-town banner during a mercator wave's build phase (once per visit).
    if (!board.inWave && isMercatorWave(board.state.wave) && lastMercatorBannerWave !== board.state.wave) {
      lastMercatorBannerWave = board.state.wave;
      flashBanner('★ THE MERCATOR IS IN TOWN — rare gear available', '#d4af37', 3200);
    }
    if (board.pendingPlacement) {
      const h = board.state.pendingPurchasedTowers![0];
      const isHero = (h as any).source === 'hero';
      const name = String(h.type).replace(/^HERO_/, '').replace(/_/g, ' ');
      const label = isHero ? name : `${name}${(h as any).tier ? ' T' + (h as any).tier : ''}`;
      heroBanner.style.display = '';
      heroBanner.innerHTML = `<div style="font-size:11px;letter-spacing:2px;color:#9fd0ff">★ CLICK ANY GRASS TILE TO PLACE${isHero ? '' : ' (' + String((h as any).source).toUpperCase() + ')'}</div>` +
        `<div style="font-size:15px;font-weight:900;letter-spacing:1px">${label}</div>`;
    } else if (heroBanner.style.display !== 'none') {
      heroBanner.style.display = 'none';
    }
    if (!ended && (board.state.phase === GamePhase.VICTORY || board.state.phase === GamePhase.GAME_OVER)) {
      ended = true;
      showEndScreen(board.state.phase === GamePhase.VICTORY);
    }
  };

  // Convert a mouse event to a tile, inverting the camera (zoom + pan).
  const tileAt = (ev: MouseEvent): { col: number; row: number } => {
    const rect = canvas.getBoundingClientRect();
    const s = W / rect.width;          // CSS px -> stage units (stage is W across)
    return board.stageToTile((ev.clientX - rect.left) * s, (ev.clientY - rect.top) * s);
  };

  // Click: enemy inspect (if on an enemy) > hero placement / tower inspect / prospect.
  canvas.addEventListener('click', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const s = W / rect.width;
    const wx = ((ev.clientX - rect.left) * s - board.world.position.x) / board.zoom;
    const wy = ((ev.clientY - rect.top) * s - board.world.position.y) / board.zoom;
    let near: import('../../types').Enemy | null = null, best = 20 * 20;
    for (const e of board.state.enemies.values()) { const d = (e.x - wx) ** 2 + (e.y - wy) ** 2; if (d < best) { best = d; near = e; } }
    if (near) { showEnemyInspect(overlay, near, board.state.wave); return; }   // "click any enemy to inspect"
    const { col, row } = tileAt(ev);
    board.handleTileClick(col, row);
  });

  // Mouse move: cursor-follow camera pan (zoomed in, so move to see the edges)
  // + build hover highlight.
  canvas.addEventListener('mousemove', (ev) => {
    const rect = canvas.getBoundingClientRect();
    board.panToFraction((ev.clientX - rect.left) / rect.width, (ev.clientY - rect.top) / rect.height);
    const { col, row } = tileAt(ev);
    if (col < 0 || row < 0 || col >= board.geo.size || row >= board.geo.size) { board.hover = null; return; }
    const empty = board.isBuildTile(col, row) && board.state.tiles[row]?.[col] === TileType.EMPTY;
    board.hover = { col, row, valid: empty && (board.state.phase === GamePhase.PROSPECT_PLACEMENT || board.pendingPlacement) };
  });
  canvas.addEventListener('mouseleave', () => { board.hover = null; });
  // Scroll wheel = zoom.
  canvas.addEventListener('wheel', (ev) => { ev.preventDefault(); board.zoomBy(ev.deltaY < 0 ? 0.12 : -0.12); }, { passive: false });

  // Zoom in/out controls (bottom-right of the board).
  const zoomCtl = document.createElement('div');
  zoomCtl.style.cssText = 'position:absolute;right:12px;bottom:12px;z-index:45;display:flex;flex-direction:column;gap:6px';
  const mkZoom = (label: string, d: number) => {
    const z = document.createElement('button');
    z.textContent = label;
    z.style.cssText = 'width:34px;height:34px;background:#1a1206cc;color:#ffd34d;border:2px solid #5a431c;border-radius:7px;cursor:pointer;font-family:inherit;font-size:18px;font-weight:900;line-height:1';
    z.onclick = () => board.zoomBy(d);
    return z;
  };
  zoomCtl.append(mkZoom('+', 0.2), mkZoom('−', -0.2));
  host.appendChild(zoomCtl);

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
