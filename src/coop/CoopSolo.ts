// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION — Solo test harness (LR2 + LR3 + LR4).
//
// A one-player entry into a REAL Roman TD board for testing, per owner
// request. Mounts a RomanBoard (the real engine: same terrain, towers,
// enemies, bosses, fliers, combos, Codex, tower menu, targeting,
// prospecting, wave briefs, enemy health) and wraps it in the Legion
// teamwork layer:
//   - LR3: a leaked enemy strikes ROME instead of costing a base "life"
//          (LegionRome.romeDamageFor / applyRomeDamage; ×3 boss, ×1.5 immune).
//   - LR4: Rome HP bar (gradient), Dishonor counter, kills scoreboard, and
//          a pre-wave brief modal built from the real wave data.
//
// SOLO is a TEST harness, not real multiplayer: there is no neighbor to
// route leaks to, so a leak hits Rome directly, and Rome HP is tuned
// generous for unobstructed testing. True N-player circuit routing +
// shared Rome + netcode is LR5. Isolated in /coop — single-player untouched.
// ─────────────────────────────────────────────────────────────────────

import { GamePhase, type Enemy } from '../types';
import { RomanBoard } from './RomanBoard';
import { getNextWaveInfo } from '../systems/WaveManager';
import {
  createRome, romeDamageFor, applyRomeDamage, romeHpFraction, romeBarColor, isRomeFallen,
} from './LegionRome';
import { serializeLeak } from './LegionCircuit';
import { recordLeak, recordWaveKill } from './LegionEconomy';
import { emptyStats, type PlayerStats, type RomeState } from './LegionTypes';
import enemiesData from '../data/enemies.json';

const OVERLAY_ID = 'legion-overlay';
const CANVAS_W = 1216;
const CANVAS_H = 832;
// Solo test: Rome tuned generous so the owner can play many waves while
// still seeing the Rome-damage mechanic. Real games use ROME_HP_BY_PLAYERS
// (500/750/1000) — wired in LR5.
const SOLO_ROME_HP = 4000;

export async function startSoloLegionTest(): Promise<void> {
  document.getElementById(OVERLAY_ID)?.remove();

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:300;background:radial-gradient(circle at 50% 35%,#1a1206,#070503 82%);' +
    "font-family:'Courier New',monospace;color:#e7d6a8;overflow:hidden;display:flex;flex-direction:column";

  const top = document.createElement('div');
  top.style.cssText =
    'flex:0 0 auto;display:flex;align-items:center;gap:16px;padding:8px 16px;flex-wrap:wrap;' +
    'background:linear-gradient(#000c,#0000);z-index:5';
  top.innerHTML =
    '<div style="font-size:15px;font-weight:900;letter-spacing:2px;color:#ffd34d;text-shadow:0 0 8px #000">⚔ LEGION</div>' +
    '<div style="font-size:9px;letter-spacing:2px;color:#88cc88;border:1px solid #3a6a3a;border-radius:4px;padding:2px 6px">SOLO TEST</div>' +
    '<div id="lg-gold" style="font-size:13px;color:#ffe66b">⛁ —</div>' +
    '<div id="lg-wave" style="font-size:12px;color:#e7d6a8">Wave —</div>' +
    '<div id="lg-kills" style="font-size:12px;color:#9fd0ff">⚔ 0</div>' +
    '<div id="lg-dishonor" style="font-size:12px;color:#ffae6b">⚑ 0</div>' +
    '<div style="flex:1;min-width:160px;display:flex;align-items:center;gap:8px;justify-content:flex-end">' +
    '  <span style="font-size:10px;color:#cdb98a">ROMA</span>' +
    '  <div style="width:160px;height:13px;background:#000a;border:1px solid #5a431c;border-radius:7px;overflow:hidden">' +
    '    <div id="lg-rome-bar" style="height:100%;width:100%;background:#66ff88;transition:width .25s"></div></div>' +
    '  <span id="lg-rome-num" style="font-size:10px;color:#e7d6a8;min-width:78px">—</span>' +
    '</div>';
  const hintRow = document.createElement('div');
  hintRow.style.cssText = 'flex:0 0 auto;padding:0 16px 6px;font-size:11px;color:#cdb98a;background:#0008;z-index:5';
  hintRow.id = 'lg-hint';

  const host = document.createElement('div');
  host.style.cssText = 'flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-height:0;position:relative';

  const bottom = document.createElement('div');
  bottom.style.cssText =
    'flex:0 0 auto;display:flex;align-items:center;justify-content:center;gap:10px;padding:10px 16px;' +
    'background:linear-gradient(#0000,#000c);z-index:5';
  bottom.innerHTML =
    '<button id="lg-march" style="background:#3a2a0a;color:#ffd34d;border:2px solid #ffd34d;border-radius:6px;padding:9px 26px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:bold;letter-spacing:2px">⚔ MARCH TO WAR</button>' +
    '<button id="lg-codex" style="background:#1a2535;color:#9fd0ff;border:2px solid #3a6a9a;border-radius:6px;padding:9px 18px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:1px">📖 CODEX</button>' +
    '<button id="lg-speed" style="background:#241a10;color:#e7d6a8;border:2px solid #7a5a1a;border-radius:6px;padding:9px 14px;cursor:pointer;font-family:inherit;font-size:12px">▶▶ 1x</button>' +
    '<button id="lg-leave" style="background:#3a1810;color:#ff8080;border:2px solid #7a2a2a;border-radius:6px;padding:9px 18px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:1px">◀ LEAVE</button>';

  overlay.append(top, hintRow, host, bottom);
  document.body.appendChild(overlay);

  const goldEl = top.querySelector('#lg-gold') as HTMLElement;
  const waveEl = top.querySelector('#lg-wave') as HTMLElement;
  const killsEl = top.querySelector('#lg-kills') as HTMLElement;
  const dishonorEl = top.querySelector('#lg-dishonor') as HTMLElement;
  const romeBar = top.querySelector('#lg-rome-bar') as HTMLElement;
  const romeNum = top.querySelector('#lg-rome-num') as HTMLElement;
  const marchBtn = bottom.querySelector('#lg-march') as HTMLButtonElement;
  const codexBtn = bottom.querySelector('#lg-codex') as HTMLButtonElement;
  const speedBtn = bottom.querySelector('#lg-speed') as HTMLButtonElement;
  const leaveBtn = bottom.querySelector('#lg-leave') as HTMLButtonElement;

  // ── Legion teamwork state (LR3/LR4) ──────────────────────────────────
  let rome: RomeState = createRome(2);
  rome = { ...rome, hp: SOLO_ROME_HP, maxHp: SOLO_ROME_HP };
  let stats: PlayerStats = emptyStats();
  let romePulse = 0;
  let defeated = false;

  const board = new RomanBoard({
    startingGold: 100,
    hooks: {
      onFrame: (dt) => { if (romePulse > 0) romePulse = Math.max(0, romePulse - dt); syncHud(); },
      onKill: () => { stats = recordWaveKill(stats); },
      // LR3: a leak strikes Rome instead of costing a life.
      onLeak: (e: Enemy) => {
        const unit = serializeLeak(toLeakable(e), 'NW', false);
        const dmg = romeDamageFor(unit);
        rome = applyRomeDamage(rome, dmg);
        stats = recordLeak(stats);
        romePulse = 0.3;
        if (isRomeFallen(rome) && !defeated) {
          defeated = true; board.paused = true;
          (hintRow as HTMLElement).textContent = 'Sic transit gloria — Rome has fallen. (Solo test: press LEAVE.)';
        }
        return true; // suppress the base life-loss; Rome is the objective
      },
    },
  });
  await board.init();
  board.mount(host);
  fitCanvas();

  function syncHud(): void {
    const s = board.state;
    goldEl.textContent = '⛁ ' + Math.floor(s.gold) + 'g';
    waveEl.textContent = s.wave > 0 ? `Wave ${s.wave}/20` : 'Build phase';
    killsEl.textContent = '⚔ ' + (stats.waveKills + stats.circuitKills);
    dishonorEl.textContent = '⚑ ' + stats.leaksTotal;
    const f = romeHpFraction(rome);
    romeBar.style.width = (f * 100).toFixed(1) + '%';
    romeBar.style.background = romeBarColor(rome);
    romeNum.textContent = `${Math.ceil(rome.hp)} / ${rome.maxHp}`;
    hintRow.textContent = defeated ? hintRow.textContent : (s.hint ?? '');
    marchBtn.style.display = s.phase !== GamePhase.WAVE_PHASE && !defeated ? '' : 'none';
    overlay.style.outline = romePulse > 0 ? '6px solid #ff2a2acc' : 'none';
  }

  function fitCanvas(): void {
    const cv = board.canvas;
    const availW = window.innerWidth - 32;
    const availH = window.innerHeight - top.offsetHeight - bottom.offsetHeight - hintRow.offsetHeight - 24;
    const scale = Math.max(0.4, Math.min(availW / CANVAS_W, availH / CANVAS_H, 1.25));
    cv.style.width = Math.round(CANVAS_W * scale) + 'px';
    cv.style.height = Math.round(CANVAS_H * scale) + 'px';
  }
  const onResize = () => fitCanvas();
  window.addEventListener('resize', onResize);

  marchBtn.onclick = () => { if (!defeated) showWaveBrief(); };
  codexBtn.onclick = () => board.openCodex();
  speedBtn.onclick = () => {
    board.speedMult = board.speedMult >= 3 ? 1 : board.speedMult >= 2 ? 3 : 2;
    speedBtn.textContent = `▶▶ ${board.speedMult}x`;
  };
  leaveBtn.onclick = () => { window.removeEventListener('resize', onResize); board.destroy(); overlay.remove(); };

  // ── Pre-wave brief (LR4 — same wave-brief intent as base) ──────────────
  function showWaveBrief(): void {
    if (board.hasPending) { board.march(); return; } // keeper flow handled in board; brief shows on next clean MARCH
    const info: any = getNextWaveInfo(board.state) ?? {};
    const spawns: any[] = Array.isArray(info.spawns) ? info.spawns : [];
    const emap: any = enemiesData as any;
    const rows = spawns.map((sp) => {
      const def = emap[sp.type] ?? {};
      const name = def.name ?? String(sp.type).replace(/_/g, ' ');
      const tags: string[] = [];
      if (def.isBoss) tags.push('BOSS');
      if (def.isFlyer) tags.push('FLYER');
      const tagHtml = tags.length ? ` <span style="color:#ff9a6b">${tags.join(' · ')}</span>` : '';
      return `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0"><span>${esc(name)}${tagHtml}</span><span style="color:#ffd34d">×${sp.count}</span></div>`;
    }).join('') || '<div style="font-size:12px;color:#aa9a4a">Standard wave.</div>';
    const isBoss = info.type === 'B';
    const m = document.createElement('div');
    m.id = 'lg-brief';
    m.style.cssText = 'position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;background:#000b';
    m.innerHTML =
      `<div style="width:min(440px,90%);background:linear-gradient(#1c140c,#0d0805);border:3px solid ${isBoss ? '#ff5050' : '#d4af37'};border-radius:10px;padding:20px 24px;text-align:center;box-shadow:0 0 36px #000">` +
        `<div style="font-size:11px;letter-spacing:5px;color:${isBoss ? '#ff5050' : '#ffd34d'};font-weight:bold">${isBoss ? '☠ BOSS WAVE ☠' : 'INCOMING WAVE'}</div>` +
        `<div style="font-size:22px;font-weight:900;letter-spacing:3px;color:#fff8e0;margin-top:6px">WAVE ${(board.state.wave || 0) + 1}</div>` +
        `<div style="font-size:10px;color:#aa9a4a;letter-spacing:1px;margin-top:2px">${esc(String(info.faction ?? '').replace(/_/g, ' '))}</div>` +
        `<div style="margin-top:14px;text-align:left;background:rgba(0,0,0,0.4);border-left:3px solid ${isBoss ? '#ff5050' : '#d4af37'};padding:10px 14px">${rows}</div>` +
        `<div style="margin-top:16px;display:flex;gap:10px;justify-content:center">` +
          `<button id="lg-brief-go" style="background:#3a2a0a;color:#ffd34d;border:2px solid #ffd34d;border-radius:6px;padding:9px 24px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:bold;letter-spacing:2px">⚔ TO BATTLE</button>` +
          `<button id="lg-brief-x" style="background:#241a10;color:#cdb98a;border:2px solid #7a5a1a;border-radius:6px;padding:9px 16px;cursor:pointer;font-family:inherit;font-size:12px">BUILD MORE</button>` +
        `</div></div>`;
    host.appendChild(m);
    (m.querySelector('#lg-brief-go') as HTMLElement).onclick = () => { m.remove(); board.march(); };
    (m.querySelector('#lg-brief-x') as HTMLElement).onclick = () => m.remove();
  }

  syncHud();
}

function toLeakable(e: Enemy): { type: string; hp: number; maxHp: number; faction: string; isBoss?: boolean; isImmune?: boolean } {
  return {
    type: String(e.type), hp: Math.max(1, e.hp), maxHp: e.maxHp,
    faction: String((e as any).faction ?? 'LEGION'),
    isBoss: !!e.isBoss, isImmune: !!(e as any).isImmune,
  };
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c));
}
