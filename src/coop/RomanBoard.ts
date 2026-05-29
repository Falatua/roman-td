// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION — RomanBoard (LR1): a REAL base-engine board for one player.
//
// The whole point of the Legion visual-reuse pass: each player plays an
// actual Roman TD board that looks EXACTLY like single-player, because it
// IS the single-player engine — same Pixi RenderEngine, same GameState,
// same systems (spawns, enemies, combat, projectiles, waves), same biomes,
// terrain, cave, gate, towers, and (wired in later phases) the same combos,
// Codex, and tower menu.
//
// ISOLATION CONTRACT: this module COMPOSES the base game's already-exported,
// state-parameterized pieces. It does NOT modify or fork main.ts's
// single-player closure, so single-player cannot regress because of Legion.
// Everything Legion-specific (circuit routing, Rome, scoreboard, netcode)
// layers on top via the pluggable hooks below in LR3/LR4.
//
// LR1 scope: stand the board up, render it with the real engine, and run a
// real wave loop. Build-phase UX reuse (draw/keep/combine/menu/Codex) is
// LR2; leak→circuit is LR3; teamwork HUD + netcode is LR4.
// ─────────────────────────────────────────────────────────────────────

import { ECONOMY, GRID } from '../constants';
import { createGameState, type GameStateShape } from '../GameState';
import { GamePhase, TileType, type Enemy, type Tower, type TowerType } from '../types';
import { RenderEngine } from '../render/RenderEngine';
import { initializeGrid, setTile } from '../systems/GridManager';
import { buildGroundPath, buildFlyerPath, resnapEnemiesToPath } from '../systems/PathFinder';
import { startWave, tickSpawns, checkWaveEnd, getNextWaveInfo } from '../systems/WaveManager';
import { tickEnemies } from '../systems/EnemySystem';
import { tickCombat, type CombatHooks } from '../systems/CombatResolver';
import { tickProjectiles } from '../systems/ProjectileSystem';
import { createTower } from '../systems/TowerSystem';

// Pluggable seams the later phases fill in. Defaults make the board behave
// like a normal solo board (leaks cost lives) so LR1 is self-contained and
// testable; LR3 swaps onLeak to route into the circuit, LR4 wires the rest.
export interface RomanBoardHooks {
  /** An enemy crossed the gate without dying. Return true to SUPPRESS the
   *  default life loss (LR3 returns true and routes the unit to the circuit). */
  onLeak?: (enemy: Enemy) => boolean | void;
  /** A tower killed an enemy (after base gold is awarded). */
  onKill?: (tower: Tower, enemy: Enemy) => void;
  /** The wave finished (queue drained, board clear). `gold` is the wave bonus. */
  onWaveCleared?: (wave: number, gold: number) => void;
  /** Rome/lives hit zero. */
  onDefeat?: () => void;
  /** Called every frame after the systems tick, before render — for HUD sync. */
  onFrame?: (dt: number) => void;
}

export interface RomanBoardOpts {
  hooks?: RomanBoardHooks;
  startingGold?: number;
  /** Legion is harder; the runtime can pass a per-wave HP/speed scaler later. */
  sandbox?: boolean;
}

const FRAME_MS = 16;

export class RomanBoard {
  readonly state: GameStateShape;
  readonly renderer: RenderEngine;
  private readonly hooks: RomanBoardHooks;
  private loop: number | null = null;
  private lastTime = 0;
  private mounted = false;
  private destroyed = false;
  private staticDirty = true;     // redraw the terrain/decoration layer next frame
  speedMult = 1;
  paused = false;

  constructor(opts: RomanBoardOpts = {}) {
    this.hooks = opts.hooks ?? {};
    this.state = createGameState();
    if (opts.sandbox) this.state.sandboxMode = true;
    if (typeof opts.startingGold === 'number') this.state.gold = opts.startingGold;
    this.renderer = new RenderEngine();
  }

  // ── SETUP ──────────────────────────────────────────────────────────────
  /**
   * Lay down the real map (cave/gate/waypoint tiles + path), exactly as the
   * base game does after createGameState. Ensures the shared data globals the
   * engine reads (waypoints/enemies/waves) are present — they normally are,
   * since the player reached Legion after main.ts boot ran, but we load them
   * defensively so RomanBoard is self-contained.
   */
  async init(): Promise<void> {
    await ensureEngineGlobals();
    initializeGrid(this.state);
    const path = buildGroundPath(this.state);
    if (!path) throw new Error('RomanBoard: could not build initial ground path');
    this.state.groundPath = path;
    (this.state as any).ghostPath = path.slice();
    this.state.flyerPath = buildFlyerPath();
    this.state.gold = this.state.gold || ECONOMY.STARTING_GOLD;
    this.state.phase = GamePhase.BUILD_PHASE;
  }

  /** Attach the real Pixi canvas into the DOM and start the frame loop. */
  mount(parent: HTMLElement): void {
    if (this.mounted) return;
    this.mounted = true;
    this.renderer.attachTo(parent);
    this.renderer.drawStatic(this.state);
    this.lastTime = performance.now();
    this.loop = window.setInterval(() => this.tick(), FRAME_MS);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.loop != null) { clearInterval(this.loop); this.loop = null; }
    try { (this.renderer.app.view as HTMLCanvasElement)?.remove(); } catch { /* ignore */ }
    try { this.renderer.app.destroy(true); } catch { /* ignore */ }
  }

  /** The canvas element, for sizing/positioning by the host overlay. */
  get canvas(): HTMLCanvasElement {
    return this.renderer.app.view as HTMLCanvasElement;
  }

  // ── WAVE CONTROL ─────────────────────────────────────────────────────────
  /** Begin the next wave (BUILD_PHASE → WAVE_PHASE), mirroring base flow. */
  beginWave(): void {
    if (this.state.phase !== GamePhase.BUILD_PHASE) return;
    startWave(this.state);
    this.state.phase = GamePhase.WAVE_PHASE;
    this.markStaticDirty();
  }

  /** Place a tower programmatically (used by LR2's real placement flow + tests).
   *  Path-validated: rejects a drop that would seal the route. */
  placeTower(col: number, row: number, type: TowerType, tier: 1 | 2 | 3 | 4 | 5): Tower | null {
    if (this.state.tiles[row]?.[col] !== TileType.EMPTY) return null;
    setTile(this.state, col, row, TileType.TOWER);
    const np = buildGroundPath(this.state);
    if (!np) { setTile(this.state, col, row, TileType.EMPTY); return null; }
    this.state.groundPath = np;
    resnapEnemiesToPath(this.state, np);
    const tw = createTower(type, tier, col, row, this.state.wave);
    this.state.towers.set(tw.id, tw);
    this.markStaticDirty();
    return tw;
  }

  /** Force a terrain-layer redraw next frame (after any tile/path change). */
  markStaticDirty(): void { this.staticDirty = true; }

  // ── FRAME LOOP ───────────────────────────────────────────────────────────
  // Mirrors main.ts's frame(): real-time dt (clamped) × speed, zeroed when
  // paused; tick the real systems only in WAVE_PHASE; always render the
  // dynamic + ambient layers; redraw the static layer only when dirty.
  private tick(): void {
    if (this.destroyed) return;
    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    dt = Math.min(0.05, Math.max(0, dt));
    if (this.paused) dt = 0;
    else dt *= this.speedMult;

    this.state.tick += dt;

    if (dt > 0 && this.state.phase === GamePhase.WAVE_PHASE) {
      tickSpawns(this.state, dt);
      tickEnemies(this.state, dt, (e) => this.handleLeak(e), (e) => this.handleDeath(e));
      tickCombat(this.state, dt, this.combatHooks);
      tickProjectiles(this.state, dt, { onImpact: () => { /* impact VFX handled by renderer */ } });
      checkWaveEnd(this.state, (gold) => {
        this.state.gold += Math.max(0, gold);
        this.state.phase = GamePhase.BUILD_PHASE;
        this.hooks.onWaveCleared?.(this.state.wave, gold);
      });
    }

    this.hooks.onFrame?.(dt);

    // Render — the real engine, real sprites.
    if (this.staticDirty) { this.renderer.drawStatic(this.state); this.staticDirty = false; }
    this.renderer.drawDynamic(this.state);
    const wInfo = getNextWaveInfo(this.state);
    this.renderer.drawAmbient(this.state.tick, this.state.wave, wInfo?.type === 'B');
    // Pixi Application is autoStart:false (constructor), so the scene graph
    // only flushes to the canvas when we explicitly render — exactly as
    // main.ts's frame loop does (main.ts:7490). Without this the board is
    // simulated but never painted.
    this.renderer.app.render();
  }

  // ── KILL / LEAK HANDLERS ───────────────────────────────────────────────
  private readonly combatHooks: CombatHooks = {
    onKill: (tower, enemy) => {
      // Base kill gold. (Full kill-bonus / Aerarium economy is layered in a
      // later phase; LR1 keeps a faithful baseline so the loop is testable.)
      this.state.gold += (enemy.reward ?? 0) + ECONOMY.BASE_GOLD_PER_KILL;
      this.state.totalKills += 1;
      this.state.enemiesKilledThisWave += 1;
      this.hooks.onKill?.(tower, enemy);
    },
    onHit: () => { /* hit VFX handled inside the renderer */ },
    onMeleeSwing: () => { /* swing VFX handled inside the renderer */ },
    onProjectileFire: () => { /* projectile sprites spawn from tickCombat */ },
  };

  private handleDeath(_e: Enemy): void {
    // Reserved for DEATH_PACT / REVENANT modifier hooks (parity with base).
  }

  private handleLeak(e: Enemy): void {
    this.state.enemiesLeakedThisWave += 1;
    // LR3 swaps this: onLeak returns true to suppress the life loss and route
    // the unit into the circuit toward the next player / Rome.
    const suppressed = this.hooks.onLeak?.(e) === true;
    if (suppressed) return;
    this.state.lives -= e.livesCost ?? 1;
    if (this.state.lives <= 0 && this.state.gameOverAt < 0) {
      this.state.gameOverAt = this.state.tick;
      this.hooks.onDefeat?.();
    }
  }
}

// ─── SHARED ENGINE GLOBALS ─────────────────────────────────────────────
// The base RenderEngine + PathFinder read a few `window.__*` data blobs that
// main.ts sets during boot. They're present by the time Legion is entered,
// but we load them defensively so a RomanBoard works even if instantiated
// before/without the campaign boot (e.g. in isolation).
let _globalsReady = false;
async function ensureEngineGlobals(): Promise<void> {
  if (_globalsReady) return;
  const w = window as any;
  if (!w.__wpData) w.__wpData = await import('../data/waypoints.json').then((m) => m.default ?? m);
  if (!w.__enemiesData) w.__enemiesData = await import('../data/enemies.json').then((m) => m.default ?? m);
  if (!w.__waves__) w.__waves__ = await import('../data/waves.json').then((m) => m.default ?? m);
  void GRID; // keep the constants import meaningful + future-proof for sizing
  _globalsReady = true;
}
