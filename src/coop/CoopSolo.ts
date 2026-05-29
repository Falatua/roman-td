// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION — Solo test harness (LR2 + LR3 + LR4 + LV3 + LV4).
//
// A one-player entry into a REAL Roman TD board for testing, per owner
// request. Mounts a RomanBoard (the real engine: same terrain, towers,
// enemies, bosses, fliers, combos, Codex, tower menu, targeting,
// prospecting, wave briefs, enemy health, AND — since LV1/LV2 — the full
// VFX/SFX presentation: projectiles, slashes, blood, floaters, impact
// rings, boss bar, faction music, per-tower fire/melee/death sounds).
//
// LV3 wraps the board in the REAL base left/right sidebar (UIManager,
// container-injected) so it looks + reads exactly like single-player:
// left = HUD (wave/gold/pool odds/phase/tip/next-wave preview), right =
// the action buttons. A Legion strip (Rome bar + kills + dishonor) sits
// atop the left panel; the campaign LIVES chip is hidden because Rome is
// the Legion objective.
//
//   - LR3: a leaked enemy strikes ROME instead of costing a base "life".
//   - LV4: defeat (Rome falls) plays the base defeat stingers + end card;
//          full-clear plays the victory fanfare.
//
// SOLO is a TEST harness: no neighbor to route leaks to, so a leak hits
// Rome directly, and Rome HP is tuned generous. True N-player circuit +
// shared Rome + netcode is CoopMatch. Isolated in /coop.
// ─────────────────────────────────────────────────────────────────────

import { GamePhase, type Enemy } from '../types';
import { RomanBoard } from './RomanBoard';
import { mountLegionSidebar, type LegionSidebar } from './LegionSidebar';
import { getNextWaveInfo } from '../systems/WaveManager';
import { SFX, stopAllMusicTracks } from '../render/AudioManager';
import {
  createRome, romeDamageFor, applyRomeDamage, isRomeFallen,
} from './LegionRome';
import { serializeLeak } from './LegionCircuit';
import { recordLeak, recordWaveKill } from './LegionEconomy';
import { emptyStats, type PlayerStats, type RomeState } from './LegionTypes';
import enemiesData from '../data/enemies.json';

const OVERLAY_ID = 'legion-overlay';
const CANVAS_W = 1216;
const CANVAS_H = 832;
const PANEL_W = 212;
// Solo test: Rome tuned generous so the owner can play many waves while
// still seeing the Rome-damage mechanic. Real games use ROME_HP_BY_PLAYERS.
const SOLO_ROME_HP = 4000;
const FINAL_WAVE = 20;

export async function startSoloLegionTest(): Promise<void> {
  document.getElementById(OVERLAY_ID)?.remove();

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:300;background:radial-gradient(circle at 50% 35%,#1a1206,#070503 82%);' +
    "font-family:'Courier New',monospace;color:#e7d6a8;overflow:hidden;display:flex;flex-direction:column";

  // 3-COLUMN LAYOUT (base parity): [ left panel | board | right panel ].
  const mainRow = document.createElement('div');
  mainRow.style.cssText = 'flex:1 1 auto;display:flex;flex-direction:row;align-items:stretch;min-height:0';
  const host = document.createElement('div');
  host.style.cssText =
    'flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-height:0;position:relative;overflow:hidden';
  overlay.append(mainRow);
  document.body.appendChild(overlay);

  // ── Legion teamwork state (LR3/LR4) ──────────────────────────────────
  let rome: RomeState = createRome(2);
  rome = { ...rome, hp: SOLO_ROME_HP, maxHp: SOLO_ROME_HP };
  let stats: PlayerStats = emptyStats();
  let romePulse = 0;
  let defeated = false;
  let victorious = false;

  const board = new RomanBoard({
    startingGold: 100,
    hooks: {
      onFrame: (dt) => { if (romePulse > 0) romePulse = Math.max(0, romePulse - dt); syncHud(); },
      onKill: () => { stats = recordWaveKill(stats); },
      onWaveCleared: (wave) => { if (wave >= FINAL_WAVE && !victorious && !defeated) onVictory(); },
      // LR3: a leak strikes Rome instead of costing a life.
      onLeak: (e: Enemy) => {
        const unit = serializeLeak(toLeakable(e), 'NW', false);
        const dmg = romeDamageFor(unit);
        rome = applyRomeDamage(rome, dmg);
        stats = recordLeak(stats);
        romePulse = 0.3;
        if (isRomeFallen(rome) && !defeated) onDefeat();
        return true; // suppress the base life-loss; Rome is the objective
      },
    },
  });
  await board.init();

  let sidebar: LegionSidebar;
  const onResize = () => fitCanvas();
  sidebar = mountLegionSidebar({
    board,
    modeLabel: 'SOLO TEST',
    onStartWave: () => { if (!defeated && !victorious) showWaveBrief(); },
    onLeaderboard: () => toast('Solo test — no teammates. Real Legion matches show the full team board here.'),
    onLeave: () => {
      window.removeEventListener('resize', onResize);
      stopAllMusicTracks();
      board.destroy();
      sidebar.destroy();
      overlay.remove();
    },
    getRome: () => rome,
    getStats: () => stats,
  });
  mainRow.append(sidebar.leftPanel, host, sidebar.rightPanel);
  board.mount(host);
  fitCanvas();
  window.addEventListener('resize', onResize);
  // Dev handle (harmless): lets tooling drive/inspect the solo board.
  (window as any).__legionSolo = { board, getRome: () => rome, getStats: () => stats };

  function syncHud(): void {
    sidebar.refresh();
    overlay.style.outline = romePulse > 0 ? '6px solid #ff2a2acc' : 'none';
  }

  function fitCanvas(): void {
    const cv = board.canvas;
    const availW = window.innerWidth - PANEL_W * 2 - 28;
    const availH = window.innerHeight - 24;
    const scale = Math.max(0.4, Math.min(availW / CANVAS_W, availH / CANVAS_H, 1.25));
    cv.style.width = Math.round(CANVAS_W * scale) + 'px';
    cv.style.height = Math.round(CANVAS_H * scale) + 'px';
  }

  // ── Endings (LV4) ─────────────────────────────────────────────────────
  function onDefeat(): void {
    defeated = true;
    board.paused = true;
    board.state.hint = 'Sic transit gloria — Rome has fallen.';
    SFX.defeat();
    SFX.fatality();
    stopAllMusicTracks();
    showEndCard(false);
  }
  function onVictory(): void {
    victorious = true;
    board.paused = true;
    board.state.hint = 'IMPERATOR — the legion holds. Rome stands.';
    SFX.victory();
    stopAllMusicTracks();
    showEndCard(true);
  }
  function showEndCard(win: boolean): void {
    const m = document.createElement('div');
    m.style.cssText =
      'position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;background:#000c';
    m.innerHTML =
      `<div style="width:min(460px,90%);background:linear-gradient(#1c140c,#0d0805);border:3px solid ${win ? '#ffd34d' : '#ff5050'};border-radius:12px;padding:26px 28px;text-align:center;box-shadow:0 0 40px #000">` +
        `<div style="font-size:13px;letter-spacing:6px;color:${win ? '#ffd34d' : '#ff5050'};font-weight:bold">${win ? '★ VICTORY ★' : '☠ ROME HAS FALLEN ☠'}</div>` +
        `<div style="font-size:24px;font-weight:900;letter-spacing:3px;color:#fff8e0;margin-top:10px">${win ? 'THE LEGION HOLDS' : 'SIC TRANSIT GLORIA'}</div>` +
        `<div style="font-size:12px;color:#cdb98a;margin-top:12px;line-height:1.6">Kills <b style="color:#9fd0ff">${stats.waveKills + stats.circuitKills}</b> · Dishonor <b style="color:#ffae6b">${stats.leaksTotal}</b> · Reached <b style="color:#ffd34d">Wave ${board.state.wave}</b></div>` +
        `<button id="lg-end-leave" style="margin-top:20px;background:#3a2a0a;color:#ffd34d;border:2px solid #ffd34d;border-radius:6px;padding:10px 26px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:bold;letter-spacing:2px">◀ LEAVE</button>` +
      `</div>`;
    host.appendChild(m);
    (m.querySelector('#lg-end-leave') as HTMLElement).onclick = () => {
      window.removeEventListener('resize', onResize);
      stopAllMusicTracks();
      board.destroy();
      sidebar.destroy();
      overlay.remove();
    };
  }

  // ── Pre-wave brief (LR4 — same wave-brief intent as base) ──────────────
  function showWaveBrief(): void {
    if (board.hasPending) { board.march(); return; } // keeper flow handled in board
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

function toast(msg: string): void {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText =
    'position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:600;background:#1a1206;border:2px solid #d4af37;' +
    "color:#ffd34d;padding:10px 18px;border-radius:8px;font-family:'Courier New',monospace;font-size:12px;letter-spacing:1px;box-shadow:0 0 20px #000a";
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
