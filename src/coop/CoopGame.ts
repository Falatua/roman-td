// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION MODE — Match runtime + board render + HUD (Phase 9)
//
// The lobby hands off here once the host starts. This module owns the
// CLIENT-SIDE Legion game: a self-contained Canvas-2D board + DOM HUD that
// drives the prep → wave → round-end loop and wires every pure module built
// in Phases 1-8:
//   - LegionMap        board geometry, tile classification, sovereignty
//   - LegionScaling    per-player-count HP / speed / wave-count scaling
//   - LegionWaves      aggregate-pool wave distribution
//   - LegionCircuit    leak serialization + clockwise circuit routing
//   - LegionRome       Rome HP pool, impact damage, anim-delay, gradient bar
//   - LegionEconomy    kill-gold rates, PlayerStats, rebuild pool, summary
//   - LegionGhost      disconnect / ghost-lane (absent peers route at 50%)
//
// ISOLATION (spec Section 14): this file never touches the base game's Pixi
// RenderEngine, GameState, or systems — it renders its own board so the
// single-player experience can't regress. Base tower archetypes are used as
// read-only reference values only.
//
// MULTIPLAYER MODEL (spec Section 9.3, async): each client simulates ONLY
// its own quadrant. Own leaks are routed via the circuit and handed to the
// next connected client (broadcast 'leak'); inbound leaks spawn at the local
// secondary entry. Quadrants with no connected peer behave as ghost lanes
// (Section 10) — their hop is passed through locally at 50% HP so the full
// circuit + Rome loop stays observable on a single client. Live 2-4 client
// play requires real-device verification (no automated multi-client test).
// ─────────────────────────────────────────────────────────────────────

import type { LegionNetTransport, LegionNetMessage, LeakUnit, PlayerStats } from './LegionTypes';
import { emptyStats } from './LegionTypes';
import type { SessionConfig } from './LegionSession';
import {
  LEGION_GRID, QUADRANTS, POSITION_TITLES, FLAVOR,
  ROME_REBUILD_GOLD_PER_STEP, type QuadrantId,
} from './LegionConfig';
import {
  tileCenter, canBuildAt, classifyTile, romeRingClockwise, quadrantGeometry,
} from './LegionMap';
import { scaledEnemyHp, scaledEnemySpeed } from './LegionScaling';
import { buildLegionWave, interleaveCornerSpawns } from './LegionWaves';
import {
  serializeLeak, resolveLeakHop, QUADRANT_TRAIL_COLOR, type LeakableEnemy,
} from './LegionCircuit';
import {
  createRome, romeDamageFor, queueRomeDamage, flushPendingDamage,
  isRomeFallen, romeHpFraction, romeBarColor, isRomeCritical, restoreRome, rebuildFromGold,
} from './LegionRome';
import {
  ownLaneGold, circuitKillGold, recordWaveKill, recordCircuitKill, recordLeak,
  resetRoundDishonor, setTowerCount, recordRomeContribution,
  createRebuildPool, contributeToRebuild, resolveRebuild, resetRebuildPool,
  buildRoundSummary, type RebuildPool, type RoundSummaryRow,
} from './LegionEconomy';
import { ghostLeakHp } from './LegionGhost';

// ─── HANDOFF CONTRACT ──────────────────────────────────────────────────
export interface CoopMatchArgs {
  transport: LegionNetTransport;
  cfg: SessionConfig;
  assignments: Record<string, QuadrantId | null>;
  myQuadrant: QuadrantId;
}

const OVERLAY_ID = 'legion-overlay';
const TILE = LEGION_GRID.TILE;          // 32
const BOARD = LEGION_GRID.SIZE * TILE;  // 1280 world px (square)
const TOTAL_WAVES = 20;

// ─── TOWER ARCHETYPES (authentic base values, read-only reference) ─────
interface TowerDef {
  key: string; name: string; cost: number;
  dps: number; range: number; color: string; dmgType: string;
  income?: number; // Aerarium-style gold per round
}
const TOWER_DEFS: TowerDef[] = [
  { key: 'VELITES',     name: 'Velites',     cost: 40,  dps: 14,    range: 3.8, color: '#9fd0ff', dmgType: 'PHYS_RANGED' },
  { key: 'HASTATI',     name: 'Hastati',     cost: 70,  dps: 35.8,  range: 2.0, color: '#ffcf6b', dmgType: 'PHYS_MELEE' },
  { key: 'SCORPIO',     name: 'Scorpio',     cost: 95,  dps: 25,    range: 6.5, color: '#c8a0ff', dmgType: 'SIEGE' },
  { key: 'SAGITTARIUS', name: 'Sagittarius', cost: 165, dps: 103.4, range: 5.5, color: '#ff8f5a', dmgType: 'PHYS_RANGED' },
  { key: 'AERARIUM',    name: 'Aerarium',    cost: 120, dps: 12,    range: 4.2, color: '#ffe66b', dmgType: 'SIEGE', income: 30 },
];

// ─── ENEMY ARCHETYPES (base HP/speed, scaled at spawn) ─────────────────
interface EnemyDef { type: string; baseHp: number; baseSpeed: number; isBoss?: boolean; isImmune?: boolean; gold: number; color: string; r: number; }
const ENEMY_DEFS: Record<string, EnemyDef> = {
  GRUNT:  { type: 'GRUNT',  baseHp: 90,   baseSpeed: 2.2, gold: 8,  color: '#c0463b', r: 7 },
  RUNNER: { type: 'RUNNER', baseHp: 55,   baseSpeed: 3.6, gold: 7,  color: '#46c08a', r: 6 },
  BRUTE:  { type: 'BRUTE',  baseHp: 240,  baseSpeed: 1.5, gold: 16, color: '#7a5fc0', r: 9 },
  IMMUNE: { type: 'IMMUNE', baseHp: 150,  baseSpeed: 2.0, isImmune: true, gold: 18, color: '#46b6c0', r: 8 },
  BOSS:   { type: 'BOSS',   baseHp: 1400, baseSpeed: 1.2, isBoss: true, gold: 60, color: '#e0b020', r: 14 },
};

// Base (solo) wave composition — escalating; bosses on 5/10/15/20.
function baseWave(wave: number): { type: string; count: number }[] {
  const tiers: { type: string; count: number }[] = [];
  if (wave % 5 === 0) tiers.push({ type: 'BOSS', count: Math.max(1, Math.floor(wave / 5)) });
  tiers.push({ type: 'GRUNT', count: 6 + wave });
  if (wave >= 2) tiers.push({ type: 'RUNNER', count: 3 + Math.floor(wave / 2) });
  if (wave >= 4) tiers.push({ type: 'BRUTE', count: 2 + Math.floor(wave / 3) });
  if (wave >= 7) tiers.push({ type: 'IMMUNE', count: 2 + Math.floor(wave / 4) });
  return tiers;
}
// HP escalates with wave on top of the player-count multiplier.
function waveHpScale(wave: number): number { return 1 + (wave - 1) * 0.28; }

type Phase = 'PREP' | 'WAVE' | 'ROUND_END' | 'VICTORY' | 'DEFEAT';

interface Tower { col: number; row: number; def: TowerDef; cd: number; }
interface Enemy {
  id: number; def: EnemyDef; hp: number; maxHp: number; speed: number;
  path: { x: number; y: number }[]; seg: number; t: number; x: number; y: number;
  circuit: boolean;          // true if it arrived via the seam (inbound leak)
  origin: QuadrantId;        // who originally leaked it (Dishonor credit)
}
interface CircuitUnit {
  id: number; unit: LeakUnit; ring: { x: number; y: number }[]; idx: number; t: number;
  x: number; y: number; dest: QuadrantId | 'ROME'; trail: string;
}

let _eid = 1;

export function startCoopMatch(args: CoopMatchArgs): void {
  new LegionMatch(args).mount();
}

class LegionMatch {
  private readonly transport: LegionNetTransport;
  private readonly cfg: SessionConfig;
  private readonly myQ: QuadrantId;
  private readonly assignments: Record<string, QuadrantId | null>;

  // State
  private phase: Phase = 'PREP';
  private wave = 1;
  private gold = 130;
  private rome = createRome(2);
  private rebuild: RebuildPool = createRebuildPool();
  private myStats: PlayerStats = emptyStats();
  private peerStats: Record<string, PlayerStats> = {};   // playerId → stats (from 'stats' msgs)
  private towers: Tower[] = [];
  private enemies: Enemy[] = [];
  private circuit: CircuitUnit[] = [];
  private spawnQueue: { type: string; at: number }[] = [];
  private ring: { x: number; y: number }[] = [];
  private primaryPath: { col: number; row: number }[] = [];
  private secondaryPath: { col: number; row: number }[] = [];

  // Selection / input
  private selectedTower: TowerDef | null = TOWER_DEFS[0];
  private hover: { col: number; row: number } | null = null;

  // Timing / fx
  private clock = 0;
  private last = 0;
  private raf = 0;
  private romePulse = 0;
  private toasts: { text: string; t: number }[] = [];
  private pendingRomeFlush: { at: number; dmg: number }[] = [];

  // DOM / canvas
  private overlay!: HTMLDivElement;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private hudTop!: HTMLDivElement;
  private hudBottom!: HTMLDivElement;
  private scorePanel!: HTMLDivElement;
  private destroyed = false;

  constructor(args: CoopMatchArgs) {
    this.transport = args.transport;
    this.cfg = args.cfg;
    this.myQ = args.myQuadrant;
    this.assignments = args.assignments;
    this.rome = createRome(this.cfg.players);
    this.ring = romeRingClockwise().map((c) => tileCenter(c.col, c.row));
    this.primaryPath = buildQuadrantPath(this.myQ);
    this.secondaryPath = buildSecondaryPath(this.myQ);
  }

  // ── MOUNT ────────────────────────────────────────────────────────────
  mount(): void {
    document.getElementById(OVERLAY_ID)?.remove();
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.style.cssText =
      `position:fixed;inset:0;z-index:300;background:radial-gradient(circle at 50% 40%,#1a1206,#080503 80%);` +
      `font-family:'Courier New',monospace;color:#e7d6a8;overflow:hidden;user-select:none`;
    this.overlay = overlay;

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;left:50%;top:54%;transform:translate(-50%,-50%);box-shadow:0 0 40px rgba(0,0,0,0.8)';
    this.canvas = canvas;
    overlay.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Legion: 2D canvas unavailable');
    this.ctx = ctx;

    this.hudTop = el('div', 'position:absolute;top:0;left:0;right:0;padding:8px 14px;display:flex;align-items:center;gap:18px;' +
      'background:linear-gradient(#000d,#0000);pointer-events:none;flex-wrap:wrap');
    this.scorePanel = el('div', 'position:absolute;top:64px;right:10px;width:212px;background:#0d0805ee;border:1px solid #5a431c;' +
      'border-radius:6px;padding:8px 10px;font-size:10px;line-height:1.5');
    this.hudBottom = el('div', 'position:absolute;bottom:0;left:0;right:0;padding:10px 14px;display:flex;align-items:center;' +
      'justify-content:center;gap:8px;background:linear-gradient(#0000,#000d);flex-wrap:wrap');
    overlay.append(this.hudTop, this.scorePanel, this.hudBottom);

    document.body.appendChild(overlay);

    this.resize();
    window.addEventListener('resize', this.resize);
    canvas.addEventListener('mousemove', this.onMove);
    canvas.addEventListener('mouseleave', () => { this.hover = null; });
    canvas.addEventListener('click', this.onClick);
    this.wireTransport();

    this.startPrep();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    this.transport.leave();
    this.overlay.remove();
  }

  // ── TRANSPORT (async leak/stats/rome relay, Section 9.3) ──────────────
  private wireTransport(): void {
    this.transport.on('leak', (m: LegionNetMessage) => {
      const p = m.payload as { units: LeakUnit[]; toQuadrant: QuadrantId } | null;
      if (!p || p.toQuadrant !== this.myQ) return;
      for (const u of p.units) this.spawnInboundLeak(u);
    });
    this.transport.on('stats', (m: LegionNetMessage) => {
      const p = m.payload as PlayerStats | null;
      if (p && m.from !== this.transport.selfId) this.peerStats[m.from] = p;
    });
    this.transport.on('rome', (m: LegionNetMessage) => {
      const p = m.payload as { dmg: number } | null;
      if (p && m.from !== this.transport.selfId) this.applyRomeHit(p.dmg, false);
    });
  }

  private broadcastStats(): void {
    this.transport.send('stats', this.myStats);
  }

  // ── PHASE FLOW ────────────────────────────────────────────────────────
  private startPrep(): void {
    this.phase = 'PREP';
    this.myStats = resetRoundDishonor(this.myStats);
    this.rebuild = resetRebuildPool();
    // Aerarium income (Section 7.3 economy role) paid at prep start.
    let income = 60 + this.wave * 8;
    for (const t of this.towers) income += t.def.income ?? 0;
    this.gold += income;
    this.toast(`Prep · +${income}g income`);
    this.renderHud();
  }

  private march(): void {
    if (this.phase !== 'PREP') return;
    this.phase = 'WAVE';
    this.myStats = setTowerCount(this.myStats, this.towers.length);
    this.buildSpawnQueue();
    this.transport.send('prep_done', { wave: this.wave });
    this.toast(FLAVOR.waveStart);
    this.renderHud();
  }

  private buildSpawnQueue(): void {
    const active = this.cfg.active.length;
    const corners = buildLegionWave(baseWave(this.wave), this.cfg.players, active);
    // My corner = my index within the active list.
    const myIdx = Math.max(0, this.cfg.active.indexOf(this.myQ));
    const mine = corners[myIdx] ?? [];
    const order = interleaveCornerSpawns(mine);
    const gap = 0.62; // seconds between spawns
    this.spawnQueue = order.map((type, i) => ({ type, at: this.clock + 1.0 + i * gap }));
  }

  private endRound(): void {
    if (this.phase !== 'WAVE') return;
    // Resolve the shared Rome rebuild from the prep pool (once per prep).
    const { pool, hpRestored } = resolveRebuild(this.rebuild);
    this.rebuild = pool;
    if (hpRestored > 0) { this.rome = restoreRome(this.rome, hpRestored); this.toast(`Rome rebuilt +${hpRestored} HP`); }

    if (this.wave >= TOTAL_WAVES) { this.phase = 'VICTORY'; this.showEndScreen(true); return; }
    this.phase = 'ROUND_END';
    this.showRoundSummary();
  }

  private nextWave(): void {
    this.wave += 1;
    this.enemies = [];
    this.circuit = [];
    this.spawnQueue = [];
    this.startPrep();
  }

  // ── SPAWNING ──────────────────────────────────────────────────────────
  private spawnPrimary(type: string): void {
    const def = ENEMY_DEFS[type] ?? ENEMY_DEFS.GRUNT;
    const hp = Math.round(scaledEnemyHp(def.baseHp, this.cfg.players) * waveHpScale(this.wave));
    const speed = scaledEnemySpeed(def.baseSpeed, this.cfg.players);
    this.enemies.push(this.makeEnemy(def, hp, speed, this.primaryPath, this.myQ, false));
  }

  private spawnInboundLeak(u: LeakUnit): void {
    const def = ENEMY_DEFS[u.enemyType] ?? { ...ENEMY_DEFS.GRUNT, type: u.enemyType, isBoss: u.isBoss, isImmune: u.isImmune };
    const speed = scaledEnemySpeed(def.baseSpeed, this.cfg.players);
    const e = this.makeEnemy(def, Math.max(1, Math.round(u.hp)), speed, this.secondaryPath, u.fromQuadrant, true);
    e.maxHp = u.maxHp;
    this.enemies.push(e);
    this.toast(FLAVOR.leakEvent(POSITION_TITLES[u.fromQuadrant].title));
  }

  private makeEnemy(def: EnemyDef, hp: number, speed: number, tilePath: { col: number; row: number }[], origin: QuadrantId, circuit: boolean): Enemy {
    const path = tilePath.map((c) => tileCenter(c.col, c.row));
    const p0 = path[0] ?? { x: 0, y: 0 };
    return { id: _eid++, def, hp, maxHp: hp, speed, path, seg: 0, t: 0, x: p0.x, y: p0.y, circuit, origin };
  }

  // ── UPDATE ────────────────────────────────────────────────────────────
  private frame = (now: number): void => {
    if (this.destroyed) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.clock += dt;
    if (this.phase === 'WAVE') this.update(dt);
    this.updateFx(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number): void {
    // Spawns due
    for (let i = this.spawnQueue.length - 1; i >= 0; i--) {
      if (this.clock >= this.spawnQueue[i].at) { this.spawnPrimary(this.spawnQueue[i].type); this.spawnQueue.splice(i, 1); }
    }
    // Towers fire
    for (const t of this.towers) {
      t.cd -= dt;
      if (t.cd > 0) continue;
      const c = tileCenter(t.col, t.row);
      const rangePx = t.def.range * TILE;
      let best: Enemy | null = null; let bestProg = -1;
      for (const e of this.enemies) {
        const d = Math.hypot(e.x - c.x, e.y - c.y);
        if (d <= rangePx) { const prog = e.seg + e.t; if (prog > bestProg) { bestProg = prog; best = e; } }
      }
      if (best) {
        // 0.4s nominal attack interval; apply dps*interval as the hit.
        const interval = 0.4;
        t.cd = interval;
        best.hp -= t.def.dps * interval;
        if (best.hp <= 0) this.killEnemy(best);
      }
    }
    // Move enemies
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.hp <= 0) { this.enemies.splice(i, 1); continue; }
      this.advance(e, dt);
      if (e.seg >= e.path.length - 1) {
        // Reached the inner boundary → leak into the circuit.
        this.enemies.splice(i, 1);
        this.leakOut(e);
      }
    }
    // Circuit units travel the seam ring
    for (let i = this.circuit.length - 1; i >= 0; i--) {
      const cu = this.circuit[i];
      this.advanceCircuit(cu, dt);
      if (cu.idx >= cu.ring.length - 1) {
        this.circuit.splice(i, 1);
        this.resolveCircuitArrival(cu);
      }
    }
    // Round end: queue drained, no enemies, no circuit transit
    if (this.spawnQueue.length === 0 && this.enemies.length === 0 && this.circuit.length === 0 && this.pendingRomeFlush.length === 0) {
      this.endRound();
    }
  }

  private advance(e: Enemy, dt: number): void {
    const a = e.path[e.seg]; const b = e.path[Math.min(e.seg + 1, e.path.length - 1)];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    e.t += (e.speed * TILE * dt) / segLen;
    while (e.t >= 1 && e.seg < e.path.length - 1) { e.t -= 1; e.seg += 1; }
    const a2 = e.path[e.seg]; const b2 = e.path[Math.min(e.seg + 1, e.path.length - 1)];
    e.x = a2.x + (b2.x - a2.x) * e.t; e.y = a2.y + (b2.y - a2.y) * e.t;
  }

  private advanceCircuit(cu: CircuitUnit, dt: number): void {
    const a = cu.ring[cu.idx]; const b = cu.ring[Math.min(cu.idx + 1, cu.ring.length - 1)];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const speed = 2.4;
    cu.t += (speed * TILE * dt) / segLen;
    while (cu.t >= 1 && cu.idx < cu.ring.length - 1) { cu.t -= 1; cu.idx += 1; }
    const a2 = cu.ring[cu.idx]; const b2 = cu.ring[Math.min(cu.idx + 1, cu.ring.length - 1)];
    cu.x = a2.x + (b2.x - a2.x) * cu.t; cu.y = a2.y + (b2.y - a2.y) * cu.t;
  }

  // ── KILLS / GOLD (Section 6) ──────────────────────────────────────────
  private killEnemy(e: Enemy): void {
    const idx = this.enemies.indexOf(e);
    if (idx >= 0) this.enemies.splice(idx, 1);
    if (e.circuit) {
      // Intercepted a leak that entered via the seam → 60% assist gold.
      this.gold += circuitKillGold(e.def.gold);
      this.myStats = recordCircuitKill(this.myStats);
    } else {
      this.gold += ownLaneGold(e.def.gold);
      this.myStats = recordWaveKill(this.myStats);
    }
    this.broadcastStats();
  }

  // ── LEAK → CIRCUIT (Sections 3.3 / 3.4 / 5.2 / 10.2) ──────────────────
  private leakOut(e: Enemy): void {
    // Only OWN primary-wave leaks count as my Dishonor (Section 6.3).
    if (!e.circuit) { this.myStats = recordLeak(this.myStats); this.broadcastStats(); }
    const leakable: LeakableEnemy = {
      type: e.def.type, hp: Math.max(1, e.hp), maxHp: e.maxHp, faction: 'LEGION',
      isBoss: e.def.isBoss, isImmune: e.def.isImmune,
    };
    const fromQ = e.circuit ? this.myQ : this.myQ; // it now exits MY quadrant either way
    const unit = serializeLeak(leakable, fromQ, false);
    this.enterCircuit(unit);
  }

  /** Route a leak around the seam, handing off to peers or passing ghost lanes. */
  private enterCircuit(unit: LeakUnit): void {
    const hop = resolveLeakHop(unit, this.cfg.players);
    const trail = '#' + (QUADRANT_TRAIL_COLOR[unit.fromQuadrant] >>> 0).toString(16).padStart(6, '0');
    const cu: CircuitUnit = {
      id: _eid++, unit, ring: this.ring, idx: 0, t: 0,
      x: this.ring[0].x, y: this.ring[0].y, dest: hop.destination, trail,
    };
    this.circuit.push(cu);
  }

  private resolveCircuitArrival(cu: CircuitUnit): void {
    if (cu.dest === 'ROME') {
      const dmg = romeDamageFor(cu.unit);
      this.applyRomeHit(dmg, true);
      return;
    }
    // Destination is a quadrant. Is a real, connected peer holding it?
    const peerHolds = this.quadrantHasConnectedPeer(cu.dest);
    if (peerHolds) {
      // Hand the leak off to that client (async model). Leaves our view.
      this.transport.send('leak', { units: [cu.unit], toQuadrant: cu.dest });
      return;
    }
    // No peer there → ghost lane (Section 10.2): pass through at 50% HP and
    // continue routing locally so the circuit + Rome stay observable.
    const reducedHp = ghostLeakHp(cu.unit.hp);
    if (reducedHp <= 0) return;
    const next: LeakUnit = { ...cu.unit, hp: reducedHp, fromQuadrant: cu.dest };
    this.enterCircuit(next);
  }

  private quadrantHasConnectedPeer(q: QuadrantId): boolean {
    if (q === this.myQ) return false; // we never hand our own quadrant a leak
    const present = this.transport.presence().some((p) => p.connected && this.assignments[p.id] === q);
    return present;
  }

  // ── ROME (Section 3.4 / 6.4 / 11.2) ───────────────────────────────────
  private applyRomeHit(dmg: number, broadcast: boolean): void {
    // Queue damage; flush after the animation delay so the pulse reads first.
    this.rome = queueRomeDamage(this.rome, dmg);
    this.pendingRomeFlush.push({ at: this.clock + 0.8, dmg });
    this.romePulse = 0.3;
    this.toast(FLAVOR.romeDamage);
    if (broadcast) this.transport.send('rome', { dmg });
    this.renderHud();
  }

  private updateFx(dt: number): void {
    if (this.romePulse > 0) this.romePulse = Math.max(0, this.romePulse - dt);
    for (let i = this.toasts.length - 1; i >= 0; i--) { this.toasts[i].t -= dt; if (this.toasts[i].t <= 0) this.toasts.splice(i, 1); }
    for (let i = this.pendingRomeFlush.length - 1; i >= 0; i--) {
      if (this.clock >= this.pendingRomeFlush[i].at) {
        this.rome = flushPendingDamage(this.rome);
        this.pendingRomeFlush.splice(i, 1);
        if (isRomeFallen(this.rome) && this.phase === 'WAVE') { this.phase = 'DEFEAT'; this.showEndScreen(false); }
        this.renderHud();
      }
    }
  }

  // ── INPUT ─────────────────────────────────────────────────────────────
  private onMove = (e: MouseEvent): void => {
    const t = this.screenToTile(e);
    this.hover = t;
  };

  private onClick = (e: MouseEvent): void => {
    if (this.phase !== 'PREP') return;
    const t = this.screenToTile(e);
    if (!t || !this.selectedTower) return;
    if (!canBuildAt(t.col, t.row, this.myQ, this.cfg.players)) { this.flashInvalid(); return; }
    if (this.towers.some((tw) => tw.col === t.col && tw.row === t.row)) return;
    if (this.onPath(t.col, t.row)) { this.flashInvalid(); return; }
    if (this.gold < this.selectedTower.cost) { this.toast('Not enough gold'); return; }
    this.gold -= this.selectedTower.cost;
    this.towers.push({ col: t.col, row: t.row, def: this.selectedTower, cd: 0 });
    this.myStats = setTowerCount(this.myStats, this.towers.length);
    this.broadcastStats();
    this.renderHud();
  };

  private onPath(col: number, row: number): boolean {
    return this.primaryPath.some((p) => p.col === col && p.row === row)
      || this.secondaryPath.some((p) => p.col === col && p.row === row);
  }

  private screenToTile(e: MouseEvent): { col: number; row: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const wx = ((e.clientX - rect.left) / rect.width) * BOARD;
    const wy = ((e.clientY - rect.top) / rect.height) * BOARD;
    const col = Math.floor(wx / TILE); const row = Math.floor(wy / TILE);
    if (col < 0 || row < 0 || col >= LEGION_GRID.SIZE || row >= LEGION_GRID.SIZE) return null;
    return { col, row };
  }

  private flashInvalid(): void { this.romePulse = 0; this.toast('Outside your quadrant'); }

  private contributeRebuild(): void {
    if (this.phase !== 'PREP') return;
    const step = ROME_REBUILD_GOLD_PER_STEP;
    if (this.gold < step) { this.toast(`Need ${step}g to aid Rome`); return; }
    this.gold -= step;
    this.rebuild = contributeToRebuild(this.rebuild, this.transport.selfId, step);
    this.myStats = recordRomeContribution(this.myStats, step);
    const peek = rebuildFromGold(this.rebuild.gold);
    this.toast(peek.hpRestored > 0 ? `Rebuild ready: +${peek.hpRestored} HP at march` : `Rebuild pool ${this.rebuild.gold}g`);
    this.broadcastStats();
    this.renderHud();
  }

  // ── RENDER ────────────────────────────────────────────────────────────
  private resize = (): void => {
    const margin = 120;
    const size = Math.max(360, Math.min(window.innerWidth - 240, window.innerHeight - margin));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.style.width = size + 'px';
    this.canvas.style.height = size + 'px';
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(size * dpr);
    const s = (size * dpr) / BOARD;
    this.ctx.setTransform(s, 0, 0, s, 0, 0);
    this.renderHud();
  };

  private draw(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, BOARD, BOARD);
    this.drawTiles(ctx);
    this.drawPaths(ctx);
    this.drawRome(ctx);
    this.drawRangePreview(ctx);
    this.drawTowers(ctx);
    this.drawCircuit(ctx);
    this.drawEnemies(ctx);
    this.drawToasts(ctx);
  }

  private drawTiles(ctx: CanvasRenderingContext2D): void {
    const tintAlpha = this.phase === 'PREP' ? 0.30 : 0.10; // Section 11.1
    for (let r = 0; r < LEGION_GRID.SIZE; r++) {
      for (let c = 0; c < LEGION_GRID.SIZE; c++) {
        const kind = classifyTile(c, r, this.cfg.players);
        let base = '#1c2415';
        if (kind === 'SEALED') base = '#15110c';
        else if (kind === 'SEAM') base = ((c + r) & 1) ? '#3a352c' : '#332e26'; // cobblestone
        else if (kind === 'ROME') base = '#2a2118';
        else { // QUADRANT — per-quadrant tint
          const q = (c < LEGION_GRID.CROSS_MIN ? (r < LEGION_GRID.CROSS_MIN ? 'NW' : 'SW') : (r < LEGION_GRID.CROSS_MIN ? 'NE' : 'SE')) as QuadrantId;
          base = quadGround(q, q === this.myQ ? 1 : 0.55);
          ctx.fillStyle = base; ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
          ctx.globalAlpha = tintAlpha; ctx.fillStyle = quadTint(q); ctx.fillRect(c * TILE, r * TILE, TILE, TILE); ctx.globalAlpha = 1;
          ctx.strokeStyle = '#00000022'; ctx.strokeRect(c * TILE + 0.5, r * TILE + 0.5, TILE, TILE);
          continue;
        }
        ctx.fillStyle = base; ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
        if (kind === 'SEAM') { ctx.strokeStyle = '#00000033'; ctx.strokeRect(c * TILE + 0.5, r * TILE + 0.5, TILE, TILE); }
      }
    }
    // Spawn corner + secondary entry markers for my quadrant
    const g = quadrantGeometry(this.myQ);
    marker(ctx, tileCenter(g.spawnCorner.col, g.spawnCorner.row), '#ff5a4d', 'SPAWN');
    marker(ctx, tileCenter(g.secondaryEntry.col, g.secondaryEntry.row), '#5ad0ff', 'CIRCUIT');
  }

  private drawPaths(ctx: CanvasRenderingContext2D): void {
    const drawP = (path: { col: number; row: number }[], col: string) => {
      ctx.strokeStyle = col; ctx.lineWidth = TILE * 0.7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      path.forEach((p, i) => { const c = tileCenter(p.col, p.row); i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y); });
      ctx.stroke();
    };
    drawP(this.primaryPath, '#5b4a2e');
    drawP(this.secondaryPath, '#3f4a5b');
    ctx.lineWidth = 1;
  }

  private drawRome(ctx: CanvasRenderingContext2D): void {
    const lo = LEGION_GRID.CROSS_MIN * TILE; const span = (LEGION_GRID.CROSS_MAX - LEGION_GRID.CROSS_MIN + 1) * TILE;
    const f = romeHpFraction(this.rome);
    const cx = lo + span / 2; const cy = lo + span / 2;
    // Platform
    ctx.fillStyle = '#241b12'; ctx.fillRect(lo + 4, lo + 4, span - 8, span - 8);
    // Structure — colosseum-ish rings that crumble with HP
    ctx.save(); ctx.translate(cx, cy);
    const rad = span * 0.34;
    ctx.fillStyle = isRomeCritical(this.rome) && Math.floor(this.clock * 6) % 2 ? '#b03022' : '#caa46a';
    ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1c140c'; ctx.beginPath(); ctx.arc(0, 0, rad * 0.62, 0, Math.PI * 2); ctx.fill();
    const arches = 12; ctx.strokeStyle = '#8a6f42'; ctx.lineWidth = 3;
    for (let i = 0; i < arches; i++) {
      if (i / arches > f) continue; // crumbled arches vanish as HP drops
      const ang = (i / arches) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(Math.cos(ang) * rad * 0.64, Math.sin(ang) * rad * 0.64);
      ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad); ctx.stroke();
    }
    ctx.fillStyle = '#ffe9b0'; ctx.font = 'bold 22px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('ROMA', 0, 0);
    ctx.restore();
    ctx.lineWidth = 1;
  }

  private drawRangePreview(ctx: CanvasRenderingContext2D): void {
    if (this.phase !== 'PREP' || !this.hover || !this.selectedTower) return;
    const ok = canBuildAt(this.hover.col, this.hover.row, this.myQ, this.cfg.players)
      && !this.onPath(this.hover.col, this.hover.row)
      && !this.towers.some((t) => t.col === this.hover!.col && t.row === this.hover!.row);
    const c = tileCenter(this.hover.col, this.hover.row);
    ctx.fillStyle = ok ? '#5ad06633' : '#ff404033';
    ctx.fillRect(this.hover.col * TILE, this.hover.row * TILE, TILE, TILE);
    if (ok) {
      ctx.strokeStyle = '#ffffff55'; ctx.beginPath();
      ctx.arc(c.x, c.y, this.selectedTower.range * TILE, 0, Math.PI * 2); ctx.stroke();
    }
  }

  private drawTowers(ctx: CanvasRenderingContext2D): void {
    for (const t of this.towers) {
      const c = tileCenter(t.col, t.row);
      ctx.fillStyle = t.def.color;
      ctx.beginPath(); ctx.arc(c.x, c.y, TILE * 0.34, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#0008'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
    }
  }

  private drawEnemies(ctx: CanvasRenderingContext2D): void {
    for (const e of this.enemies) {
      const d = e.def;
      ctx.fillStyle = d.color;
      ctx.beginPath(); ctx.arc(e.x, e.y, d.r, 0, Math.PI * 2); ctx.fill();
      if (d.isBoss) { ctx.strokeStyle = '#fff3'; ctx.lineWidth = 3; ctx.stroke(); ctx.lineWidth = 1; }
      if (e.circuit) { ctx.strokeStyle = '#ffffffaa'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(e.x, e.y, d.r + 3, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
      // HP bar
      const w = d.r * 2; const frac = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = '#000a'; ctx.fillRect(e.x - w / 2, e.y - d.r - 7, w, 3);
      ctx.fillStyle = frac > 0.5 ? '#66dd66' : frac > 0.25 ? '#ddcc44' : '#dd4444';
      ctx.fillRect(e.x - w / 2, e.y - d.r - 7, w * frac, 3);
    }
  }

  private drawCircuit(ctx: CanvasRenderingContext2D): void {
    for (const cu of this.circuit) {
      // trail
      ctx.strokeStyle = cu.trail + 'aa'; ctx.lineWidth = 4; ctx.beginPath();
      const prev = cu.ring[Math.max(0, cu.idx - 1)];
      ctx.moveTo(prev.x, prev.y); ctx.lineTo(cu.x, cu.y); ctx.stroke(); ctx.lineWidth = 1;
      const r = cu.unit.isBoss ? 13 : 8;
      ctx.fillStyle = cu.trail; ctx.beginPath(); ctx.arc(cu.x, cu.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }

  private drawToasts(ctx: CanvasRenderingContext2D): void {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    this.toasts.forEach((t, i) => {
      ctx.globalAlpha = Math.min(1, t.t);
      ctx.fillStyle = '#000a'; const y = BOARD * 0.16 + i * 30;
      ctx.font = 'bold 18px Georgia';
      const w = ctx.measureText(t.text).width + 28;
      ctx.fillRect(BOARD / 2 - w / 2, y - 14, w, 26);
      ctx.fillStyle = '#ffe9b0'; ctx.fillText(t.text, BOARD / 2, y);
      ctx.globalAlpha = 1;
    });
  }

  private toast(text: string): void { this.toasts.push({ text, t: 2.6 }); if (this.toasts.length > 4) this.toasts.shift(); }

  // ── HUD (DOM) ─────────────────────────────────────────────────────────
  private renderHud(): void {
    const f = romeHpFraction(this.rome);
    const barCol = romeBarColor(this.rome);
    const title = POSITION_TITLES[this.myQ];
    const pulse = this.romePulse > 0 ? `box-shadow:0 0 0 4px #ff2a2a inset;` : '';
    this.overlay.style.outline = this.romePulse > 0 ? '6px solid #ff2a2acc' : 'none';

    this.hudTop.innerHTML = `
      <div style="font-size:15px;font-weight:900;letter-spacing:2px;color:#ffd34d;text-shadow:0 0 8px #000">⚔ LEGION</div>
      <div style="font-size:11px;color:#cdb98a">${title.title} · ${this.myQ}</div>
      <div style="min-width:230px;flex:0 0 auto">
        <div style="font-size:10px;color:#e7d6a8;display:flex;justify-content:space-between">
          <span>ROMA</span><span>${Math.ceil(this.rome.hp)} / ${this.rome.maxHp}</span></div>
        <div style="height:13px;background:#000a;border:1px solid #5a431c;border-radius:7px;overflow:hidden;${pulse}">
          <div style="height:100%;width:${(f * 100).toFixed(1)}%;background:${barCol};transition:width .25s"></div></div>
      </div>
      <div style="font-size:12px;color:#ffe66b">⛁ ${this.gold}g</div>
      <div style="font-size:11px;color:#e7d6a8">Wave <b>${this.wave}</b>/${TOTAL_WAVES}</div>
      <div style="font-size:11px;color:#ffae6b">⚑ Dishonor ${this.myStats.leaks} <span style="color:#8a7a5a">(total ${this.myStats.leaksTotal})</span></div>
      <div style="margin-left:auto;font-size:10px;color:#88cc88;letter-spacing:1px">ROOM ${this.transport.roomCode}</div>
      <button id="lg-quit" style="pointer-events:auto;background:#3a1810;color:#e0a;border:1px solid #7a2a2a;padding:4px 10px;cursor:pointer;font-family:inherit;font-size:10px">LEAVE</button>`;
    const q = this.hudTop.querySelector('#lg-quit') as HTMLElement | null;
    if (q) q.onclick = () => this.confirmQuit();

    this.renderScorePanel();
    this.renderBottom();
  }

  private renderScorePanel(): void {
    const rows = this.scoreboardRows();
    const body = rows.map((r, i) => {
      const me = r.playerId === this.transport.selfId;
      return `<tr style="${me ? 'color:#ffd34d;font-weight:bold' : 'color:#cdb98a'}">
        <td>${i + 1}</td><td style="padding:0 4px">${esc(r.name)}</td>
        <td style="text-align:right">${r.waveKills + r.circuitKills}</td>
        <td style="text-align:right;color:#ffae6b">${r.leaks}</td></tr>`;
    }).join('');
    this.scorePanel.innerHTML = `
      <div style="font-size:11px;color:#ffd34d;letter-spacing:1px;font-weight:bold;margin-bottom:4px">⚜ LEGION SCOREBOARD</div>
      <table style="width:100%;border-collapse:collapse;font-size:10px">
        <tr style="color:#8a7a5a;border-bottom:1px solid #5a431c33"><td>#</td><td style="padding:0 4px">Cohort</td><td style="text-align:right">Kills</td><td style="text-align:right">Lk</td></tr>
        ${body}
      </table>
      <div style="margin-top:6px;font-size:9px;color:#6a5a3a">Circuit kills count toward your total.</div>`;
  }

  private renderBottom(): void {
    if (this.phase === 'PREP') {
      const shop = TOWER_DEFS.map((d) => {
        const sel = this.selectedTower?.key === d.key;
        const afford = this.gold >= d.cost;
        return `<button data-tw="${d.key}" style="pointer-events:auto;background:${sel ? '#5a431c' : '#241a10'};` +
          `color:${afford ? d.color : '#665'};border:1px solid ${sel ? '#ffd34d' : '#5a431c'};border-radius:5px;` +
          `padding:5px 9px;cursor:pointer;font-family:inherit;font-size:10px;text-align:center">` +
          `${d.name}<br><span style="font-size:9px;color:#ffe66b">${d.cost}g</span>${d.income ? `<br><span style="font-size:8px;color:#9c8">+${d.income}g/rd</span>` : ''}</button>`;
      }).join('');
      this.hudBottom.innerHTML =
        `<div style="font-size:10px;color:#8a7a5a;margin-right:6px">BUILD →</div>${shop}` +
        `<button id="lg-rebuild" style="pointer-events:auto;background:#1a2a3a;color:#7ac0ff;border:1px solid #3a6a9a;border-radius:5px;padding:5px 9px;cursor:pointer;font-family:inherit;font-size:10px">⛏ Aid Rome<br><span style="font-size:9px">${ROME_REBUILD_GOLD_PER_STEP}g</span></button>` +
        `<button id="lg-march" style="pointer-events:auto;background:#3a2a0a;color:#ffd34d;border:2px solid #ffd34d;border-radius:6px;padding:8px 22px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:bold;letter-spacing:2px;margin-left:8px">⚔ MARCH TO WAR</button>`;
      this.hudBottom.querySelectorAll('[data-tw]').forEach((b) => {
        (b as HTMLElement).onclick = () => { this.selectedTower = TOWER_DEFS.find((d) => d.key === (b as HTMLElement).dataset.tw) ?? null; this.renderBottom(); };
      });
      const rb = this.hudBottom.querySelector('#lg-rebuild') as HTMLElement | null; if (rb) rb.onclick = () => this.contributeRebuild();
      const mb = this.hudBottom.querySelector('#lg-march') as HTMLElement | null; if (mb) mb.onclick = () => this.march();
    } else if (this.phase === 'WAVE') {
      const left = this.spawnQueue.length + this.enemies.length;
      this.hudBottom.innerHTML = `<div style="font-size:12px;color:#ff8f5a;letter-spacing:2px">⚔ WAVE ${this.wave} IN PROGRESS · ${left} hostiles · ${this.circuit.length} in circuit</div>`;
    } else {
      this.hudBottom.innerHTML = '';
    }
  }

  // ── ROUND SUMMARY / END SCREENS (Section 11.4 / 12.3) ─────────────────
  private scoreboardRows(): RoundSummaryRow[] {
    const rows: RoundSummaryRow[] = [];
    rows.push(this.statRow(this.transport.selfId, this.myStats));
    for (const [pid, st] of Object.entries(this.peerStats)) rows.push(this.statRow(pid, st));
    return buildRoundSummary(rows);
  }

  private statRow(pid: string, st: PlayerStats): RoundSummaryRow {
    const q = this.assignments[pid] ?? this.myQ;
    const name = pid === this.transport.selfId
      ? (this.transport.presence().find((p) => p.id === pid)?.name ?? 'You')
      : (this.transport.presence().find((p) => p.id === pid)?.name ?? pid.slice(0, 6));
    return {
      playerId: pid, name, quadrantTitle: POSITION_TITLES[q]?.title ?? '—',
      waveKills: st.waveKills, circuitKills: st.circuitKills, leaks: st.leaks, romeContributed: st.romeContributed,
    };
  }

  private showRoundSummary(): void {
    const rows = this.scoreboardRows();
    const body = rows.map((r, i) => `<tr style="${r.playerId === this.transport.selfId ? 'color:#ffd34d;font-weight:bold' : 'color:#cdb98a'}">
      <td>${i + 1}</td><td style="padding:2px 8px">${esc(r.name)}</td><td style="padding:2px 8px;color:#9c8">${r.quadrantTitle}</td>
      <td style="text-align:right">${r.waveKills}</td><td style="text-align:right">${r.circuitKills}</td>
      <td style="text-align:right;color:#ffae6b">${r.leaks}</td><td style="text-align:right;color:#7ac0ff">${r.romeContributed}</td></tr>`).join('');
    this.modal(`
      <div style="font-size:20px;color:#ffd34d;font-weight:900;letter-spacing:2px">WAVE ${this.wave} HELD</div>
      <div style="font-size:11px;color:#cdb98a;margin:4px 0 12px">Roma stands at ${Math.ceil(this.rome.hp)} / ${this.rome.maxHp} HP.</div>
      <table style="margin:0 auto;border-collapse:collapse;font-size:11px">
        <tr style="color:#8a7a5a;border-bottom:1px solid #5a431c"><td>#</td><td style="padding:2px 8px">Cohort</td><td style="padding:2px 8px">Rank</td><td>Wave K</td><td>Circ K</td><td>Lk</td><td>Rome</td></tr>
        ${body}
      </table>
      <button id="lg-next" style="margin-top:16px;background:#3a2a0a;color:#ffd34d;border:2px solid #ffd34d;border-radius:6px;padding:9px 26px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:bold;letter-spacing:2px">NEXT WAVE ▶</button>`,
      () => { const b = document.getElementById('lg-next'); if (b) (b as HTMLElement).onclick = () => { this.closeModal(); this.nextWave(); }; });
  }

  private showEndScreen(victory: boolean): void {
    cancelAnimationFrame(this.raf);
    this.draw();
    const rows = this.scoreboardRows();
    const champ = rows[0];
    this.modal(`
      <div style="font-size:30px;font-weight:900;letter-spacing:3px;color:${victory ? '#ffd34d' : '#c0463b'};text-shadow:0 0 16px ${victory ? '#ffd34d' : '#c0463b'}">${victory ? 'ROMA INVICTA' : 'SIC TRANSIT GLORIA'}</div>
      <div style="font-size:13px;color:#e7d6a8;margin:8px 0 4px">${victory ? FLAVOR.victory : FLAVOR.defeat}</div>
      <div style="font-size:11px;color:#cdb98a;margin-bottom:12px">${victory ? `All ${TOTAL_WAVES} waves held. Rome endured at ${Math.ceil(this.rome.hp)} HP.` : `Rome fell on wave ${this.wave}.`}</div>
      <div style="font-size:12px;color:#ffd34d;margin-bottom:6px">⚜ Legion Commander: <b>${esc(champ?.name ?? '—')}</b> (${(champ?.waveKills ?? 0) + (champ?.circuitKills ?? 0)} kills)</div>
      <button id="lg-end" style="margin-top:14px;background:#241a10;color:#e7d6a8;border:1px solid #7a5a1a;border-radius:6px;padding:9px 26px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:2px">RETURN TO BARRACKS</button>`,
      () => { const b = document.getElementById('lg-end'); if (b) (b as HTMLElement).onclick = () => this.destroy(); });
  }

  private confirmQuit(): void {
    this.modal(`
      <div style="font-size:16px;color:#ffd34d;font-weight:bold">Abandon the line?</div>
      <div style="font-size:11px;color:#cdb98a;margin:8px 0 14px">Leaving converts your quadrant to a ghost lane for the rest of the match.</div>
      <button id="lg-stay" style="background:#241a10;color:#e7d6a8;border:1px solid #7a5a1a;border-radius:6px;padding:7px 18px;cursor:pointer;font-family:inherit;font-size:11px;margin-right:8px">STAY</button>
      <button id="lg-go" style="background:#3a1810;color:#ff8080;border:1px solid #7a2a2a;border-radius:6px;padding:7px 18px;cursor:pointer;font-family:inherit;font-size:11px">LEAVE LEGION</button>`,
      () => {
        const s = document.getElementById('lg-stay'); if (s) (s as HTMLElement).onclick = () => this.closeModal();
        const g = document.getElementById('lg-go'); if (g) (g as HTMLElement).onclick = () => this.destroy();
      });
  }

  private modal(inner: string, after: () => void): void {
    this.closeModal();
    const m = el('div', 'position:absolute;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;background:#000b');
    m.id = 'lg-modal';
    const card = el('div', 'background:linear-gradient(#1c140c,#0d0805);border:2px solid #5a431c;border-radius:10px;padding:22px 28px;text-align:center;max-width:560px;box-shadow:0 0 40px #000');
    card.innerHTML = inner; m.appendChild(card); this.overlay.appendChild(m);
    after();
  }
  private closeModal(): void { document.getElementById('lg-modal')?.remove(); }
}

// ─── PATH BUILDERS (serpentine lanes, spaced to leave build room) ──────
function buildQuadrantPath(q: QuadrantId): { col: number; row: number }[] {
  const b = QUADRANTS[q].bounds; const spawn = QUADRANTS[q].spawnCorner;
  const SP = 3;
  const topDown = spawn.row === b.minRow;
  const rows: number[] = [];
  if (topDown) { for (let r = b.minRow; r <= b.maxRow; r += SP) rows.push(r); if (rows[rows.length - 1] !== b.maxRow) rows.push(b.maxRow); }
  else { for (let r = b.maxRow; r >= b.minRow; r -= SP) rows.push(r); if (rows[rows.length - 1] !== b.minRow) rows.push(b.minRow); }
  let goRight = spawn.col === b.minCol;
  const path: { col: number; row: number }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (goRight) for (let c = b.minCol; c <= b.maxCol; c++) path.push({ col: c, row: r });
    else for (let c = b.maxCol; c >= b.minCol; c--) path.push({ col: c, row: r });
    if (i < rows.length - 1) {
      const endCol = goRight ? b.maxCol : b.minCol; const r2 = rows[i + 1]; const st = r2 > r ? 1 : -1;
      for (let rr = r + st; rr !== r2; rr += st) path.push({ col: endCol, row: rr });
    }
    goRight = !goRight;
  }
  return path;
}

// Short path from the secondary entry inward to the inner exit (circuit leaks).
function buildSecondaryPath(q: QuadrantId): { col: number; row: number }[] {
  const g = QUADRANTS[q]; const a = g.secondaryEntry; const z = g.innerExit;
  const path: { col: number; row: number }[] = [];
  let col = a.col; let row = a.row;
  path.push({ col, row });
  const cs = z.col > col ? 1 : -1; while (col !== z.col) { col += cs; path.push({ col, row }); }
  const rs = z.row > row ? 1 : -1; while (row !== z.row) { row += rs; path.push({ col, row }); }
  return path;
}

// ─── SMALL HELPERS ─────────────────────────────────────────────────────
function el(tag: string, css: string): HTMLDivElement { const d = document.createElement(tag) as HTMLDivElement; d.style.cssText = css; return d; }
function esc(s: string): string { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c)); }
function quadTint(q: QuadrantId): string { return { NW: '#3366cc', NE: '#33aa55', SE: '#cc8833', SW: '#9955cc' }[q]; }
function quadGround(q: QuadrantId, bright: number): string {
  const base: Record<QuadrantId, [number, number, number]> = { NW: [28, 38, 30], NE: [26, 40, 28], SE: [40, 34, 24], SW: [34, 28, 40] };
  const [r, g, b] = base[q]; const k = bright;
  return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
}
function marker(ctx: CanvasRenderingContext2D, c: { x: number; y: number }, color: string, label: string): void {
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(c.x, c.y, 8, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
  ctx.fillStyle = '#fff'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, c.x, c.y - 15);
}
