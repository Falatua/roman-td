// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION — Solo test harness (LR2).
//
// A one-player entry into a REAL Roman TD board for testing, per owner
// request ("allow one-player testing just for right now"). Mounts a
// RomanBoard (the real engine: same terrain, towers, enemies, bosses,
// fliers, combos, Codex, tower menu, targeting, prospecting, wave briefs,
// enemy health) and wraps it in a compact HUD.
//
// This is a TEST harness, not the shipped multiplayer flow: leaks cost
// lives here (coherent solo loop) until the circuit/Rome teamwork layer
// lands in LR3/LR4. Isolated in /coop — single-player is untouched.
// ─────────────────────────────────────────────────────────────────────

import { GamePhase } from '../types';
import { RomanBoard } from './RomanBoard';

const OVERLAY_ID = 'legion-overlay';
const CANVAS_W = 1216;
const CANVAS_H = 832;

export async function startSoloLegionTest(): Promise<void> {
  document.getElementById(OVERLAY_ID)?.remove();

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:300;background:radial-gradient(circle at 50% 35%,#1a1206,#070503 82%);' +
    "font-family:'Courier New',monospace;color:#e7d6a8;overflow:hidden;display:flex;flex-direction:column";

  // Top HUD
  const top = document.createElement('div');
  top.style.cssText =
    'flex:0 0 auto;display:flex;align-items:center;gap:18px;padding:8px 16px;flex-wrap:wrap;' +
    'background:linear-gradient(#000c,#0000);z-index:5';
  top.innerHTML =
    '<div style="font-size:15px;font-weight:900;letter-spacing:2px;color:#ffd34d;text-shadow:0 0 8px #000">⚔ LEGION</div>' +
    '<div style="font-size:9px;letter-spacing:2px;color:#88cc88;border:1px solid #3a6a3a;border-radius:4px;padding:2px 6px">SOLO TEST</div>' +
    '<div id="lg-gold" style="font-size:13px;color:#ffe66b">⛁ —</div>' +
    '<div id="lg-wave" style="font-size:12px;color:#e7d6a8">Wave —</div>' +
    '<div id="lg-lives" style="font-size:12px;color:#ff8f8f">♥ —</div>' +
    '<div id="lg-hint" style="flex:1;min-width:200px;font-size:11px;color:#cdb98a;text-align:right"></div>';

  // Board host (centered, fills remaining space)
  const host = document.createElement('div');
  host.style.cssText = 'flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-height:0;position:relative';

  // Bottom controls
  const bottom = document.createElement('div');
  bottom.style.cssText =
    'flex:0 0 auto;display:flex;align-items:center;justify-content:center;gap:10px;padding:10px 16px;' +
    'background:linear-gradient(#0000,#000c);z-index:5';
  bottom.innerHTML =
    '<button id="lg-march" style="background:#3a2a0a;color:#ffd34d;border:2px solid #ffd34d;border-radius:6px;padding:9px 26px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:bold;letter-spacing:2px">⚔ MARCH TO WAR</button>' +
    '<button id="lg-codex" style="background:#1a2535;color:#9fd0ff;border:2px solid #3a6a9a;border-radius:6px;padding:9px 18px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:1px">📖 CODEX</button>' +
    '<button id="lg-speed" style="background:#241a10;color:#e7d6a8;border:2px solid #7a5a1a;border-radius:6px;padding:9px 14px;cursor:pointer;font-family:inherit;font-size:12px">▶▶ 1x</button>' +
    '<button id="lg-leave" style="background:#3a1810;color:#ff8080;border:2px solid #7a2a2a;border-radius:6px;padding:9px 18px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:1px">◀ LEAVE</button>';

  overlay.append(top, host, bottom);
  document.body.appendChild(overlay);

  const goldEl = top.querySelector('#lg-gold') as HTMLElement;
  const waveEl = top.querySelector('#lg-wave') as HTMLElement;
  const livesEl = top.querySelector('#lg-lives') as HTMLElement;
  const hintEl = top.querySelector('#lg-hint') as HTMLElement;
  const marchBtn = bottom.querySelector('#lg-march') as HTMLButtonElement;
  const codexBtn = bottom.querySelector('#lg-codex') as HTMLButtonElement;
  const speedBtn = bottom.querySelector('#lg-speed') as HTMLButtonElement;
  const leaveBtn = bottom.querySelector('#lg-leave') as HTMLButtonElement;

  const board = new RomanBoard({
    startingGold: 100,
    hooks: {
      onFrame: () => syncHud(),
      onDefeat: () => { board.paused = true; hintEl.textContent = 'Rome has fallen. (Solo test — press LEAVE.)'; },
    },
  });
  await board.init();
  board.mount(host);
  fitCanvas();

  function syncHud(): void {
    const s = board.state;
    goldEl.textContent = '⛁ ' + Math.floor(s.gold) + 'g';
    waveEl.textContent = s.wave > 0 ? `Wave ${s.wave}/20` : 'Build phase';
    livesEl.textContent = '♥ ' + Math.max(0, s.lives);
    hintEl.textContent = s.hint ?? '';
    const prewave = s.phase !== GamePhase.WAVE_PHASE;
    marchBtn.style.display = prewave ? '' : 'none';
  }

  function fitCanvas(): void {
    const cv = board.canvas;
    const availW = window.innerWidth - 32;
    const availH = window.innerHeight - top.offsetHeight - bottom.offsetHeight - 24;
    const scale = Math.max(0.4, Math.min(availW / CANVAS_W, availH / CANVAS_H, 1.25));
    cv.style.width = Math.round(CANVAS_W * scale) + 'px';
    cv.style.height = Math.round(CANVAS_H * scale) + 'px';
  }
  const onResize = () => fitCanvas();
  window.addEventListener('resize', onResize);

  marchBtn.onclick = () => board.march();
  codexBtn.onclick = () => board.openCodex();
  speedBtn.onclick = () => {
    board.speedMult = board.speedMult >= 3 ? 1 : board.speedMult >= 2 ? 3 : 2;
    speedBtn.textContent = `▶▶ ${board.speedMult}x`;
  };
  leaveBtn.onclick = () => { window.removeEventListener('resize', onResize); board.destroy(); overlay.remove(); };

  syncHud();
}
