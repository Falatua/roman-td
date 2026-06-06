// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION — Green Circle solo harness (CIRCLE-3)
//
// Hosts the live CircleBoard: the shared square-spiral map running the REAL
// Roman TD systems (enemies from all 4 corners, real combat, real sprites)
// with a minimal control rail. Solo-first, per JB's plan — one player who
// can build anywhere while we prove the loop before adding the prospecting
// + Codex + shop sidebar and the multiplayer layer.
//
// Reachable from the Legion lobby ("GREEN CIRCLE" button).
// ─────────────────────────────────────────────────────────────────────

import { CircleBoard } from './CircleBoard';
import { TowerType } from '../../types';
import { GRID } from '../../constants';

const OVERLAY_ID = 'legion-overlay';
const TILE = GRID.TILE;

// Build palette for the prototype (one melee, one ranged, one siege). The
// full prospecting roll + combine flow is the next integration step.
const PALETTE: Array<{ type: TowerType; label: string; cost: number }> = [
  { type: TowerType.MILITES, label: '⚔ Milites', cost: 10 },
  { type: TowerType.SAGITTARIUS, label: '🏹 Sagittarius', cost: 12 },
  { type: TowerType.SCORPIO, label: '🦂 Scorpio', cost: 16 },
];

export async function startCircleSolo(): Promise<void> {
  document.getElementById(OVERLAY_ID)?.remove();

  const board = new CircleBoard({ startingGold: 300, startingLives: 20 });
  const W = board.geo.size * TILE;
  let selected = PALETTE[0];

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:300;background:radial-gradient(circle at 50% 42%,#16210f,#070a05 85%);' +
    "font-family:'Courier New',monospace;color:#e7d6a8;overflow:hidden;display:flex;flex-direction:column";

  const top = document.createElement('div');
  top.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;gap:12px;padding:8px 16px;flex-wrap:wrap';
  top.innerHTML =
    '<div style="font-size:15px;font-weight:900;letter-spacing:2px;color:#88ff88;text-shadow:0 0 8px #000">🟢 GREEN CIRCLE</div>' +
    '<div id="cs-hud" style="font-size:12px;color:#ffe9a8;letter-spacing:0.5px"></div>' +
    '<div style="flex:1"></div>' +
    '<button id="cs-wave" style="background:#1a3a18;color:#aaffaa;border:2px solid #2a7a2a;border-radius:6px;padding:8px 18px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:1px;font-weight:900">▶ START WAVE</button>' +
    '<button id="cs-leave" style="background:#3a1810;color:#ff8080;border:2px solid #7a2a2a;border-radius:6px;padding:8px 18px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:1px">◀ LEAVE</button>';

  // Build palette rail
  const rail = document.createElement('div');
  rail.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:0 16px 8px';
  rail.innerHTML = '<span style="font-size:10px;color:#cdb98a">BUILD (click a grass tile):</span>';
  const btns: HTMLButtonElement[] = [];
  for (const p of PALETTE) {
    const b = document.createElement('button');
    b.textContent = `${p.label} ${p.cost}g`;
    b.style.cssText = 'background:#241a10;color:#e7d6a8;border:2px solid #5a4426;border-radius:6px;padding:6px 12px;cursor:pointer;font-family:inherit;font-size:11px';
    b.onclick = () => { selected = p; for (const x of btns) x.style.borderColor = '#5a4426'; b.style.borderColor = '#ffd24f'; };
    btns.push(b);
    rail.appendChild(b);
  }
  btns[0].style.borderColor = '#ffd24f';

  const host = document.createElement('div');
  host.style.cssText = 'flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-height:0;position:relative';
  overlay.append(top, rail, host);
  document.body.appendChild(overlay);

  const canvas = board.canvas;
  canvas.style.imageRendering = 'pixelated';
  canvas.style.cursor = 'crosshair';
  host.appendChild(canvas);
  board.start();

  // HUD refresh each frame.
  const hud = overlay.querySelector('#cs-hud') as HTMLElement;
  const waveBtn = overlay.querySelector('#cs-wave') as HTMLButtonElement;
  board.onHud = (b) => {
    hud.innerHTML =
      `💰 <b>${Math.floor(b.state.gold)}</b>g · ` +
      `🌊 Wave <b>${b.state.wave}</b> · ` +
      `❤ Rome <b style="color:${b.lives <= 5 ? '#ff7070' : '#9fe6a0'}">${b.lives}</b> · ` +
      `💀 <b>${b.state.totalKills}</b> kills · ` +
      `👹 <b>${b.enemiesAlive}</b> on field`;
    waveBtn.style.display = b.inWave ? 'none' : '';
  };
  waveBtn.onclick = () => board.startWave();

  // Click a grass tile to build the selected tower.
  canvas.addEventListener('click', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const scale = rect.width / W;
    const col = Math.floor((ev.clientX - rect.left) / scale / TILE);
    const row = Math.floor((ev.clientY - rect.top) / scale / TILE);
    board.placeTower(col, row, selected.type, 1, selected.cost);
  });

  function fit(): void {
    const availW = window.innerWidth - 32;
    const availH = window.innerHeight - top.offsetHeight - rail.offsetHeight - 24;
    const s = Math.max(0.3, Math.min(availW / W, availH / W, 1.4));
    canvas.style.width = Math.round(W * s) + 'px';
    canvas.style.height = Math.round(W * s) + 'px';
  }
  fit();
  const onResize = () => fit();
  window.addEventListener('resize', onResize);
  (overlay.querySelector('#cs-leave') as HTMLElement).onclick = () => {
    window.removeEventListener('resize', onResize);
    board.destroy();
    overlay.remove();
  };

  // expose for tooling/iteration
  (window as any).__circleSolo = { board, geometry: board.geo };
}
