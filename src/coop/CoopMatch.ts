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
import { mountLegionSidebar, type LegionSidebar } from './LegionSidebar';
import { SFX, stopAllMusicTracks } from '../render/AudioManager';
import {
  createRome, romeDamageFor, applyRomeDamage, isRomeFallen,
} from './LegionRome';
import { serializeLeak, resolveLeakHop } from './LegionCircuit';
import { ghostLeakHp } from './LegionGhost';
import { recordLeak, recordWaveKill, recordCircuitKill, recordDamage } from './LegionEconomy';
import { emptyStats, type PlayerStats, type RomeState, type LegionNetMessage, type LegionNetTransport, type LeakUnit } from './LegionTypes';
import { POSITION_TITLES, FLAVOR, type QuadrantId } from './LegionConfig';
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
  private victorious = false;
  private statsTimer = 0;
  private boardTimer: number | null = null;
  private sidebar!: LegionSidebar;
  private onResize: () => void = () => {};

  constructor(a: CoopMatchArgs) {
    this.t = a.transport; this.cfg = a.cfg; this.myQ = a.myQuadrant; this.assignments = a.assignments;
    // createRome(players) already sets HP from ROME_HP_BY_PLAYERS (500/750/1000).
    this.rome = createRome(this.cfg.players);
  }

  async mount(): Promise<void> {
    document.getElementById(OVERLAY_ID)?.remove();
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:300;background:radial-gradient(circle at 50% 35%,#1a1206,#070503 82%);' +
      "font-family:'Courier New',monospace;color:#e7d6a8;overflow:hidden;display:flex;flex-direction:column";
    this.overlay = overlay;

    // 3-COLUMN LAYOUT (base parity): [ left panel | board | right panel ].
    const mainRow = el('div', 'flex:1 1 auto;display:flex;flex-direction:row;align-items:stretch;min-height:0');
    const host = el('div', 'flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-height:0;position:relative;overflow:hidden');
    // Always-on corner mini-leaderboard (multiplayer teamwork at a glance).
    const score = el('div', 'position:absolute;top:8px;right:10px;width:196px;background:#0d0805ee;border:1px solid #5a431c;border-radius:6px;padding:8px 10px;font-size:10px;z-index:6');
    score.id = 'lg-score';
    score.style.cursor = 'pointer';
    score.title = 'Open the full Legion leaderboard';
    score.onclick = () => this.openLeaderboard();
    host.appendChild(score);
    overlay.append(mainRow);
    document.body.appendChild(overlay);

    this.board = new RomanBoard({
      startingGold: 100,
      hooks: {
        onFrame: (dt) => { if (this.romePulse > 0) this.romePulse = Math.max(0, this.romePulse - dt); this.statsTimer += dt; if (this.statsTimer > 0.5) { this.statsTimer = 0; this.t.send('stats', this.myStats); } this.syncHud(); },
        onKill: (_t, e) => { this.myStats = (e as any).__circuit ? recordCircuitKill(this.myStats) : recordWaveKill(this.myStats); },
        onHit: (_t, _e, dmg) => { this.myStats = recordDamage(this.myStats, dmg); },
        onWaveCleared: (wave) => { if (wave >= 20 && !this.victorious && !this.defeated) this.onVictory(); },
        onLeak: (e: Enemy) => this.routeLeak(e),
      },
    });
    await this.board.init();

    this.sidebar = mountLegionSidebar({
      board: this.board,
      modeLabel: `${POSITION_TITLES[this.myQ].title} · ${this.myQ}`,
      onStartWave: () => { if (!this.defeated && !this.victorious) this.board.march(); },
      onLeaderboard: () => this.openLeaderboard(),
      onLeave: () => {
        if (this.boardTimer != null) clearInterval(this.boardTimer);
        window.removeEventListener('resize', this.onResize);
        stopAllMusicTracks();
        this.board.destroy();
        this.sidebar.destroy();
        overlay.remove();
        this.t.leave();
      },
      getRome: () => this.rome,
      getStats: () => this.myStats,
    });
    mainRow.append(this.sidebar.leftPanel, host, this.sidebar.rightPanel);
    this.board.mount(host);
    this.fit();
    this.onResize = () => this.fit();
    window.addEventListener('resize', this.onResize);

    this.wireTransport();
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
    this.board.state.hint = FLAVOR.defeat + ' — Rome has fallen.';
    SFX.defeat();
    SFX.fatality();
    stopAllMusicTracks();
    this.showEndCard(false);
  }

  private onVictory(): void {
    this.victorious = true; this.board.paused = true;
    this.board.state.hint = 'IMPERATOR — the legion holds. Rome stands.';
    SFX.victory();
    stopAllMusicTracks();
    this.showEndCard(true);
  }

  private showEndCard(win: boolean): void {
    if (document.getElementById('lg-end-card')) return;
    const m = el('div', 'position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;background:#000c');
    m.id = 'lg-end-card';
    const k = this.myStats.waveKills + this.myStats.circuitKills;
    m.innerHTML =
      `<div style="width:min(460px,90%);background:linear-gradient(#1c140c,#0d0805);border:3px solid ${win ? '#ffd34d' : '#ff5050'};border-radius:12px;padding:26px 28px;text-align:center;box-shadow:0 0 40px #000">` +
        `<div style="font-size:13px;letter-spacing:6px;color:${win ? '#ffd34d' : '#ff5050'};font-weight:bold">${win ? '★ VICTORY ★' : '☠ ROME HAS FALLEN ☠'}</div>` +
        `<div style="font-size:24px;font-weight:900;letter-spacing:3px;color:#fff8e0;margin-top:10px">${win ? 'THE LEGION HOLDS' : 'SIC TRANSIT GLORIA'}</div>` +
        `<div style="font-size:12px;color:#cdb98a;margin-top:12px;line-height:1.6">Your kills <b style="color:#9fd0ff">${k}</b> · Dishonor <b style="color:#ffae6b">${this.myStats.leaksTotal}</b> · Damage <b style="color:#9fd0ff">${fmt(this.myStats.damageDealt)}</b></div>` +
        `<div style="margin-top:18px;display:flex;gap:10px;justify-content:center">` +
          `<button id="lg-end-board" style="background:#2a2540;color:#c8a0ff;border:2px solid #6a4a9a;border-radius:6px;padding:10px 22px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:1px">⚜ LEGION BOARD</button>` +
          `<button id="lg-end-leave" style="background:#3a2a0a;color:#ffd34d;border:2px solid #ffd34d;border-radius:6px;padding:10px 26px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:bold;letter-spacing:2px">◀ LEAVE</button>` +
        `</div></div>`;
    this.overlay.appendChild(m);
    (m.querySelector('#lg-end-board') as HTMLElement).onclick = () => this.openLeaderboard();
    (m.querySelector('#lg-end-leave') as HTMLElement).onclick = () => {
      if (this.boardTimer != null) clearInterval(this.boardTimer);
      window.removeEventListener('resize', this.onResize);
      stopAllMusicTracks();
      this.board.destroy();
      this.sidebar.destroy();
      this.overlay.remove();
      this.t.leave();
    };
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
    // The left/right sidebar (real base HUD + buttons) + Legion strip
    // (Rome bar / kills / dishonor) refresh here; the corner mini-board
    // and the screen-edge damage pulse are Legion-only extras.
    this.sidebar.refresh();
    this.overlay.style.outline = this.romePulse > 0 ? '6px solid #ff2a2acc' : 'none';
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

  private fit(): void {
    const cv = this.board.canvas;
    const availW = window.innerWidth - 212 * 2 - 28;   // two 212px side panels
    const availH = window.innerHeight - 24;
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
