// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION — Multiplayer match runtime (LR5).
//
// Replaces the old Canvas-2D CoopGame stub. Each player plays a REAL Roman
// TD board (RomanBoard — same engine/visuals/mechanics as single-player),
// wrapped in the Legion teamwork layer:
//   - A leak off your board routes around the circuit (LegionCircuit) to the
//     next connected player's board (broadcast 'leak'), or strikes shared
//     ROME if it completes the loop / no downstream peer exists.
//   - Inbound circuit leaks spawn on your board at retained HP (Section 5.2).
//   - Shared Rome HP + per-player scoreboard + Dishonor, synced via the
//     transport ('leak' / 'rome' / 'stats').
//
// ISOLATION: built entirely on /coop modules + RomanBoard; main.ts untouched.
//
// VERIFICATION NOTE: compiles + a host mounts a real board (single-client
// smoke). Live 2-4 client circuit routing over Supabase Realtime requires
// real separate clients to validate — that is the one thing automated/solo
// checks cannot cover, and the classic-map secondary-entry (leaks currently
// enter at the spawn cave) is a candidate for tuning after live playtests.
// ─────────────────────────────────────────────────────────────────────

import { GamePhase, type Enemy } from '../types';
import { RomanBoard } from './RomanBoard';
import { mountBuildControls, type BuildControls } from './LegionControls';
import {
  createRome, romeDamageFor, applyRomeDamage, romeHpFraction, romeBarColor, isRomeFallen,
} from './LegionRome';
import { serializeLeak, resolveLeakHop } from './LegionCircuit';
import { ghostLeakHp } from './LegionGhost';
import { recordLeak, recordWaveKill, recordCircuitKill, recordDamage } from './LegionEconomy';
import { emptyStats, type PlayerStats, type RomeState, type LegionNetMessage, type LegionNetTransport, type LeakUnit } from './LegionTypes';
import { POSITION_TITLES, FLAVOR, type QuadrantId } from './LegionConfig';
import { romeStartingHp } from './LegionScaling';
import type { SessionConfig } from './LegionSession';

export interface CoopMatchArgs {
  transport: LegionNetTransport;
  cfg: SessionConfig;
  assignments: Record<string, QuadrantId | null>;
  myQuadrant: QuadrantId;
}

const OVERLAY_ID = 'legion-overlay';
const CANVAS_W = 1216;
const CANVAS_H = 832;

export function startCoopMatch(args: CoopMatchArgs): void {
  new CoopMatch(args).mount();
}

class CoopMatch {
  private readonly t: LegionNetTransport;
  private readonly cfg: SessionConfig;
  private readonly myQ: QuadrantId;
  private readonly assignments: Record<string, QuadrantId | null>;
  private board!: RomanBoard;
  private overlay!: HTMLDivElement;
  private rome: RomeState;
  private myStats: PlayerStats = emptyStats();
  private peerStats: Record<string, PlayerStats> = {};
  private romePulse = 0;
  private defeated = false;
  private statsTimer = 0;
  private boardTimer: number | null = null;
  private ctrls: BuildControls | null = null;

  constructor(a: CoopMatchArgs) {
    this.t = a.transport; this.cfg = a.cfg; this.myQ = a.myQuadrant; this.assignments = a.assignments;
    const max = romeStartingHp(this.cfg.players);
    this.rome = createRome(this.cfg.players);
    void max;
  }

  async mount(): Promise<void> {
    document.getElementById(OVERLAY_ID)?.remove();
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:300;background:radial-gradient(circle at 50% 35%,#1a1206,#070503 82%);' +
      "font-family:'Courier New',monospace;color:#e7d6a8;overflow:hidden;display:flex;flex-direction:column";
    this.overlay = overlay;

    const title = POSITION_TITLES[this.myQ];
    const top = el('div', 'flex:0 0 auto;display:flex;align-items:center;gap:14px;padding:8px 16px;flex-wrap:wrap;background:linear-gradient(#000c,#0000);z-index:5');
    top.innerHTML =
      `<div style="font-size:15px;font-weight:900;letter-spacing:2px;color:#ffd34d;text-shadow:0 0 8px #000">⚔ LEGION</div>` +
      `<div style="font-size:10px;color:#cdb98a">${title.title} · ${this.myQ}</div>` +
      `<div id="lg-gold" style="font-size:13px;color:#ffe66b">⛁ —</div>` +
      `<div id="lg-wave" style="font-size:12px;color:#e7d6a8">Wave —</div>` +
      `<div id="lg-dishonor" style="font-size:12px;color:#ffae6b">⚑ 0</div>` +
      `<div style="flex:1;min-width:160px;display:flex;align-items:center;gap:8px;justify-content:flex-end">` +
      `  <span style="font-size:10px;color:#cdb98a">ROMA</span>` +
      `  <div style="width:160px;height:13px;background:#000a;border:1px solid #5a431c;border-radius:7px;overflow:hidden">` +
      `    <div id="lg-rome-bar" style="height:100%;width:100%;background:#66ff88;transition:width .25s"></div></div>` +
      `  <span id="lg-rome-num" style="font-size:10px;color:#e7d6a8;min-width:70px">—</span>` +
      `</div>` +
      `<div style="font-size:10px;color:#88cc88;letter-spacing:1px">ROOM ${this.t.roomCode}</div>`;
    const hintRow = el('div', 'flex:0 0 auto;padding:0 16px 6px;font-size:11px;color:#cdb98a;background:#0008;z-index:5');
    hintRow.id = 'lg-hint';
    const host = el('div', 'flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-height:0;position:relative');
    const score = el('div', 'position:absolute;top:8px;right:10px;width:196px;background:#0d0805ee;border:1px solid #5a431c;border-radius:6px;padding:8px 10px;font-size:10px;z-index:6');
    score.id = 'lg-score';
    host.appendChild(score);
    const bottom = el('div', 'flex:0 0 auto;display:flex;align-items:center;justify-content:center;gap:10px;padding:10px 16px;background:linear-gradient(#0000,#000c);z-index:5');
    bottom.innerHTML =
      `<button id="lg-march" style="background:#3a2a0a;color:#ffd34d;border:2px solid #ffd34d;border-radius:6px;padding:9px 26px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:bold;letter-spacing:2px">⚔ MARCH TO WAR</button>` +
      `<button id="lg-codex" style="background:#1a2535;color:#9fd0ff;border:2px solid #3a6a9a;border-radius:6px;padding:9px 18px;cursor:pointer;font-family:inherit;font-size:12px">📖 CODEX</button>` +
      `<button id="lg-board" style="background:#2a2540;color:#c8a0ff;border:2px solid #6a4a9a;border-radius:6px;padding:9px 18px;cursor:pointer;font-family:inherit;font-size:12px">⚜ LEGION BOARD</button>` +
      `<button id="lg-leave" style="background:#3a1810;color:#ff8080;border:2px solid #7a2a2a;border-radius:6px;padding:9px 18px;cursor:pointer;font-family:inherit;font-size:12px">◀ LEAVE</button>`;
    overlay.append(top, hintRow, host, bottom);
    document.body.appendChild(overlay);

    this.board = new RomanBoard({
      startingGold: 100,
      hooks: {
        onFrame: (dt) => { if (this.romePulse > 0) this.romePulse = Math.max(0, this.romePulse - dt); this.statsTimer += dt; if (this.statsTimer > 0.5) { this.statsTimer = 0; this.t.send('stats', this.myStats); } this.syncHud(); },
        onKill: (_t, e) => { this.myStats = (e as any).__circuit ? recordCircuitKill(this.myStats) : recordWaveKill(this.myStats); },
        onHit: (_t, _e, dmg) => { this.myStats = recordDamage(this.myStats, dmg); },
        onLeak: (e: Enemy) => this.routeLeak(e),
      },
    });
    await this.board.init();
    this.board.mount(host);
    this.ctrls = mountBuildControls(bottom, this.board);
    this.fit(top, bottom, hintRow);
    window.addEventListener('resize', () => this.fit(top, bottom, hintRow));

    this.wireTransport();

    (bottom.querySelector('#lg-march') as HTMLElement).onclick = () => { if (!this.defeated) this.board.march(); };
    (bottom.querySelector('#lg-codex') as HTMLElement).onclick = () => this.board.openCodex();
    (bottom.querySelector('#lg-board') as HTMLElement).onclick = () => this.openLeaderboard();
    (bottom.querySelector('#lg-leave') as HTMLElement).onclick = () => { if (this.boardTimer != null) clearInterval(this.boardTimer); this.board.destroy(); overlay.remove(); this.t.leave(); };
    // The always-on corner panel is also a shortcut into the full board.
    score.style.cursor = 'pointer';
    score.title = 'Open the full Legion leaderboard';
    score.onclick = () => this.openLeaderboard();
    this.syncHud();
  }

  // ── LEAK ROUTING (Sections 3.3 / 3.4 / 10.2) ───────────────────────────
  private routeLeak(e: Enemy): boolean {
    const fromQ: QuadrantId = ((e as any).__origin as QuadrantId) ?? this.myQ;
    const unit = serializeLeak(toLeakable(e), this.myQ, false);
    const hop = resolveLeakHop({ ...unit, fromQuadrant: this.myQ }, this.cfg.players);
    if (hop.destination === 'ROME') {
      this.strikeRome(unit, true);
    } else if (this.peerAt(hop.destination)) {
      this.t.send('leak', { units: [unit], toQuadrant: hop.destination });
    } else {
      // No connected peer downstream → ghost-lane reduction, then Rome.
      this.strikeRome({ ...unit, hp: ghostLeakHp(unit.hp) }, true);
    }
    this.myStats = recordLeak(this.myStats);
    void fromQ;
    return true; // Rome is the objective — never a base life-loss
  }

  private strikeRome(unit: LeakUnit, broadcast: boolean): void {
    const dmg = romeDamageFor(unit);
    this.rome = applyRomeDamage(this.rome, dmg);
    this.romePulse = 0.3;
    if (broadcast) this.t.send('rome', { dmg });
    if (isRomeFallen(this.rome) && !this.defeated) this.onDefeat();
  }

  private peerAt(q: QuadrantId): boolean {
    return this.t.presence().some((p) => p.connected && p.id !== this.t.selfId && this.assignments[p.id] === q);
  }

  private onDefeat(): void {
    this.defeated = true; this.board.paused = true;
    const h = document.getElementById('lg-hint'); if (h) h.textContent = FLAVOR.defeat + ' — Rome has fallen.';
  }

  private wireTransport(): void {
    this.t.on('leak', (m: LegionNetMessage) => {
      const p = m.payload as { units: LeakUnit[]; toQuadrant: QuadrantId } | null;
      if (!p || p.toQuadrant !== this.myQ) return;
      for (const u of p.units) this.board.spawnInboundLeak(u.enemyType, u.hp, u.maxHp, u.fromQuadrant);
    });
    this.t.on('rome', (m: LegionNetMessage) => {
      const p = m.payload as { dmg: number } | null;
      if (!p || m.from === this.t.selfId) return;
      this.rome = applyRomeDamage(this.rome, p.dmg);
      this.romePulse = 0.3;
      if (isRomeFallen(this.rome) && !this.defeated) this.onDefeat();
    });
    this.t.on('stats', (m: LegionNetMessage) => {
      const p = m.payload as PlayerStats | null;
      if (p && m.from !== this.t.selfId) this.peerStats[m.from] = p;
    });
  }

  // ── HUD ─────────────────────────────────────────────────────────────────
  private syncHud(): void {
    const s = this.board.state;
    set('lg-gold', '⛁ ' + Math.floor(s.gold) + 'g');
    set('lg-wave', s.wave > 0 ? `Wave ${s.wave}/20` : 'Build phase');
    set('lg-dishonor', '⚑ ' + this.myStats.leaksTotal);
    set('lg-hint', this.defeated ? (document.getElementById('lg-hint')?.textContent ?? '') : (s.hint ?? ''));
    const bar = document.getElementById('lg-rome-bar'); if (bar) { bar.style.width = (romeHpFraction(this.rome) * 100).toFixed(1) + '%'; bar.style.background = romeBarColor(this.rome); }
    set('lg-rome-num', `${Math.ceil(this.rome.hp)} / ${this.rome.maxHp}`);
    const march = document.getElementById('lg-march'); if (march) march.style.display = s.phase !== GamePhase.WAVE_PHASE && !this.defeated ? '' : 'none';
    this.overlay.style.outline = this.romePulse > 0 ? '6px solid #ff2a2acc' : 'none';
    this.ctrls?.refresh();
    this.renderScore();
  }

  /** One row per player (self + connected peers), with the full teammate
   *  stats, sorted by total kills. Shared by the corner panel + full board. */
  private teamRows() {
    const present = this.t.presence();
    return [{ id: this.t.selfId, st: this.myStats }, ...Object.entries(this.peerStats).map(([id, st]) => ({ id, st }))]
      .map((r) => {
        const p = present.find((x) => x.id === r.id);
        const q = (this.assignments[r.id] ?? this.myQ);
        return {
          id: r.id,
          name: p?.name ?? r.id.slice(0, 6),
          position: POSITION_TITLES[q]?.title ?? '—',
          connected: r.id === this.t.selfId ? true : !!p?.connected,
          me: r.id === this.t.selfId,
          waveKills: r.st.waveKills,
          circuitKills: r.st.circuitKills,
          kills: r.st.waveKills + r.st.circuitKills,
          leaks: r.st.leaksTotal,
          damage: r.st.damageDealt,
          rome: r.st.romeContributed,
        };
      })
      .sort((a, b) => b.kills - a.kills);
  }

  // Compact always-on corner panel: rank, cohort, kills, leaks, damage.
  private renderScore(): void {
    const rows = this.teamRows();
    const body = rows.map((r, i) =>
      `<tr style="${r.me ? 'color:#ffd34d;font-weight:bold' : r.connected ? 'color:#cdb98a' : 'color:#6a5a4a'}">` +
      `<td>${i + 1}</td><td style="padding:0 4px">${esc(r.name)}${r.connected ? '' : ' ⌁'}</td>` +
      `<td style="text-align:right">${r.kills}</td>` +
      `<td style="text-align:right;color:#ffae6b">${r.leaks}</td>` +
      `<td style="text-align:right;color:#9fd0ff">${fmt(r.damage)}</td></tr>`).join('');
    const sc = document.getElementById('lg-score');
    if (sc) sc.innerHTML =
      `<div style="font-size:10px;color:#ffd34d;letter-spacing:1px;font-weight:bold;margin-bottom:4px">⚜ LEGION ▸</div>` +
      `<table style="width:100%;border-collapse:collapse;font-size:10px"><tr style="color:#8a7a5a"><td>#</td><td style="padding:0 4px">Cohort</td><td style="text-align:right">Kill</td><td style="text-align:right">Lk</td><td style="text-align:right">Dmg</td></tr>${body}</table>` +
      `<div style="margin-top:4px;font-size:8px;color:#6a5a3a">click for full board</div>`;
  }

  // Full, accessible leaderboard modal: every teammate's kills (wave +
  // circuit), leaks, damage dealt, and Rome contribution. The table body
  // refreshes in place every second so numbers tick up live; a single
  // stored timer is cleared on close (no leak / no rebuild churn).
  private openLeaderboard(): void {
    if (document.getElementById('lg-board-modal')) return; // already open
    const m = el('div', 'position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;background:#000b');
    m.id = 'lg-board-modal';
    const card = el('div', 'background:linear-gradient(#1c140c,#0d0805);border:2px solid #6a4a9a;border-radius:10px;padding:20px 26px;max-width:680px;box-shadow:0 0 40px #000');
    card.innerHTML =
      `<div style="text-align:center;font-size:18px;font-weight:900;letter-spacing:3px;color:#c8a0ff">⚜ LEGION LEADERBOARD</div>` +
      `<div style="text-align:center;font-size:10px;color:#aa9a4a;margin:4px 0 12px">How the cohort is holding the line · updates live</div>` +
      `<table style="border-collapse:collapse;font-size:12px;margin:0 auto"><thead><tr style="color:#8a7a5a;border-bottom:1px solid #5a431c">` +
        `<td>#</td><td style="padding:4px 10px">Cohort</td><td style="padding:4px 8px">Position</td>` +
        `<td style="text-align:right;padding:4px 8px">Wave K</td><td style="text-align:right;padding:4px 8px">Circ K</td>` +
        `<td style="text-align:right;padding:4px 8px;color:#ffae6b">Leaked</td>` +
        `<td style="text-align:right;padding:4px 8px;color:#9fd0ff">Damage</td>` +
        `<td style="text-align:right;padding:4px 8px;color:#7ac0ff">Rome</td></tr></thead><tbody id="lg-board-body"></tbody></table>` +
      `<div style="text-align:center;margin-top:14px"><button id="lg-board-close" style="background:#241a10;color:#e7d6a8;border:1px solid #7a5a1a;border-radius:6px;padding:8px 22px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:2px">CLOSE</button></div>`;
    m.appendChild(card);
    this.overlay.appendChild(m);

    const paint = () => {
      const tbody = document.getElementById('lg-board-body');
      if (!tbody) return;
      tbody.innerHTML = this.teamRows().map((r, i) =>
        `<tr style="${r.me ? 'color:#ffd34d;font-weight:bold' : r.connected ? 'color:#e7d6a8' : 'color:#7a6a55'}">` +
          `<td>${i + 1}</td>` +
          `<td style="padding:4px 10px">${esc(r.name)}${r.me ? ' (you)' : ''}${r.connected ? '' : ' <span style="color:#ff8080">⌁ ghost</span>'}</td>` +
          `<td style="padding:4px 8px;color:#9c8">${r.position}</td>` +
          `<td style="text-align:right;padding:4px 8px">${r.waveKills}</td>` +
          `<td style="text-align:right;padding:4px 8px">${r.circuitKills}</td>` +
          `<td style="text-align:right;padding:4px 8px;color:#ffae6b">${r.leaks}</td>` +
          `<td style="text-align:right;padding:4px 8px;color:#9fd0ff">${fmt(r.damage)}</td>` +
          `<td style="text-align:right;padding:4px 8px;color:#7ac0ff">${r.rome}g</td></tr>`).join('');
    };
    paint();
    if (this.boardTimer != null) clearInterval(this.boardTimer);
    this.boardTimer = window.setInterval(paint, 1000);
    const close = () => { if (this.boardTimer != null) { clearInterval(this.boardTimer); this.boardTimer = null; } m.remove(); };
    (card.querySelector('#lg-board-close') as HTMLElement).onclick = close;
    m.onclick = (ev) => { if (ev.target === m) close(); };
  }

  private fit(top: HTMLElement, bottom: HTMLElement, hintRow: HTMLElement): void {
    const cv = this.board.canvas;
    const availW = window.innerWidth - 32;
    const availH = window.innerHeight - top.offsetHeight - bottom.offsetHeight - hintRow.offsetHeight - 24;
    const scale = Math.max(0.4, Math.min(availW / CANVAS_W, availH / CANVAS_H, 1.25));
    cv.style.width = Math.round(CANVAS_W * scale) + 'px';
    cv.style.height = Math.round(CANVAS_H * scale) + 'px';
  }
}

function toLeakable(e: Enemy) {
  return { type: String(e.type), hp: Math.max(1, e.hp), maxHp: e.maxHp, faction: String((e as any).faction ?? 'LEGION'), isBoss: !!e.isBoss, isImmune: !!(e as any).isImmune };
}
function el(tag: string, css: string): HTMLDivElement { const d = document.createElement(tag) as HTMLDivElement; d.style.cssText = css; return d; }
function set(id: string, text: string): void { const e = document.getElementById(id); if (e) e.textContent = text; }
function fmt(n: number): string { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n)); }
function esc(s: string): string { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c)); }
