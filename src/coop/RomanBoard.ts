// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION — RomanBoard (LR1 + LR2): a REAL base-engine board for one
// player, with the REAL build-phase interaction.
//
// Each player plays an actual Roman TD board that looks AND plays exactly
// like single-player, because it IS the single-player engine: same Pixi
// RenderEngine, same GameState, same systems (spawns/enemies/combat/
// projectiles/waves), same biomes/terrain/cave/gate, same prospecting
// (rollDraw), same combinations (scanCombos/executeCombo), same tower menu
// + targeting (showTowerMenu), same Codex (showCodex), same enemies/bosses/
// fliers/wave-briefs/health — all driven by the real data + systems.
//
// ISOLATION CONTRACT: this module COMPOSES the base game's already-exported,
// state-parameterized pieces. It does NOT modify or fork main.ts's
// single-player closure, so single-player cannot regress. Legion-specific
// behavior (circuit routing, Rome, scoreboard, netcode) layers on via the
// pluggable hooks; LR3 swaps onLeak to route into the circuit.
// ─────────────────────────────────────────────────────────────────────

import { ECONOMY, GRID, WORLD } from '../constants';
import { createGameState, type GameStateShape } from '../GameState';
import { GamePhase, TileType, EnemyType, TargetingMode, type Enemy, type Tower, type TowerType, type DrawCard } from '../types';
import { RenderEngine } from '../render/RenderEngine';
import { initializeGrid, setTile, pixelToTile, isBuildable } from '../systems/GridManager';
import { buildGroundPath, buildFlyerPath, resnapEnemiesToPath } from '../systems/PathFinder';
import { startWave, tickSpawns, checkWaveEnd, getNextWaveInfo } from '../systems/WaveManager';
import { tickEnemies, tickBurnPatches, tickBossHazards, spawnEnemy } from '../systems/EnemySystem';
import { tickCombat, type CombatHooks } from '../systems/CombatResolver';
import { tickProjectiles } from '../systems/ProjectileSystem';
import { createTower, rollDraw, BASE_TOWER_TYPES } from '../systems/TowerSystem';
import { createBossRuntime, tickBossScripts, handleBossDeath } from '../systems/BossScripts';
import { realizableCombos, executeCombo } from '../systems/CombinationEngine';
import { spendGold, earnGold } from '../systems/EconomySystem';
import { createInventory, type InventoryState } from '../systems/LootSystem';
import { showTowerMenu } from '../render/TowerMenu';
import { showCodex } from '../render/Codex';

// Pluggable seams later phases fill in. Defaults make the board behave like
// a normal solo board (leaks cost lives) so it is self-contained + testable;
// LR3 swaps onLeak to route into the circuit, LR4 wires the rest.
export interface RomanBoardHooks {
  onLeak?: (enemy: Enemy) => boolean | void;  // return true to SUPPRESS the life loss (LR3 routes to circuit)
  onKill?: (tower: Tower, enemy: Enemy) => void;
  onHit?: (tower: Tower, enemy: Enemy, damage: number) => void;  // every tower hit/swing (for damage totals)
  onWaveCleared?: (wave: number, gold: number) => void;
  onDefeat?: () => void;
  onFrame?: (dt: number) => void;              // per-frame HUD sync hook
}

export interface RomanBoardOpts {
  hooks?: RomanBoardHooks;
  startingGold?: number;
  sandbox?: boolean;
}

const FRAME_MS = 16;
const PROSPECT_PLACE_COST = 1;   // 1g per prospect roll (base parity, main.ts)
const MAX_PROSPECTS_PER_ROUND = 10;
const KEEPS_PER_ROUND = 2;

export class RomanBoard {
  readonly state: GameStateShape;
  readonly renderer: RenderEngine;
  readonly inventory: InventoryState;
  private readonly hooks: RomanBoardHooks;
  private host: HTMLElement | null = null;
  private loop: number | null = null;
  private lastTime = 0;
  private mounted = false;
  private destroyed = false;
  private staticDirty = true;
  // Boss behavior parity with base: rebirth/telegraph scripts need a per-wave
  // runtime + the wave-start tick (BossScripts.tickBossScripts / handleBossDeath).
  private bossRuntime = createBossRuntime();
  private waveStartTick = 0;
  speedMult = 1;
  paused = false;

  constructor(opts: RomanBoardOpts = {}) {
    this.hooks = opts.hooks ?? {};
    this.state = createGameState();
    this.inventory = createInventory();
    if (opts.sandbox) this.state.sandboxMode = true;
    if (typeof opts.startingGold === 'number') this.state.gold = opts.startingGold;
    this.renderer = new RenderEngine();
  }

  // ── SETUP ──────────────────────────────────────────────────────────────
  async init(): Promise<void> {
    await ensureEngineGlobals();
    initializeGrid(this.state);
    const path = buildGroundPath(this.state);
    if (!path) throw new Error('RomanBoard: could not build initial ground path');
    this.state.groundPath = path;
    (this.state as any).ghostPath = path.slice();
    this.state.flyerPath = buildFlyerPath();
    this.state.gold = this.state.gold || ECONOMY.STARTING_GOLD;
    this.rollProspects(); // open in PROSPECT_PLACEMENT, exactly like base
  }

  mount(parent: HTMLElement): void {
    if (this.mounted) return;
    this.mounted = true;
    this.host = parent;
    this.renderer.attachTo(parent);
    this.renderer.drawStatic(this.state);
    this.wirePointer();
    this.lastTime = performance.now();
    this.loop = window.setInterval(() => this.tick(), FRAME_MS);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.loop != null) { clearInterval(this.loop); this.loop = null; }
    document.getElementById('tower-menu')?.remove();
    document.getElementById('combo-picker')?.remove();
    try { (this.renderer.app.view as HTMLCanvasElement)?.remove(); } catch { /* ignore */ }
    try { this.renderer.app.destroy(true); } catch { /* ignore */ }
  }

  get canvas(): HTMLCanvasElement { return this.renderer.app.view as HTMLCanvasElement; }
  get hasPending(): boolean { for (const t of this.state.towers.values()) if (t.pending) return true; return false; }

  // ── PROSPECTING (base parity, see CombinationEngine + main.ts recipe) ──
  /** Roll a fresh 5-card draw and enter PROSPECT_PLACEMENT (mirrors rollProspects). */
  rollProspects(): void {
    this.state.prospectQueue = rollDraw(this.state, BASE_TOWER_TYPES);
    this.state.prospectsPlaced = 0;
    this.state.keepsRemainingThisRound = KEEPS_PER_ROUND;
    this.state.phase = GamePhase.PROSPECT_PLACEMENT;
    this.state.hint = 'Click empty tiles to reveal prospects (1g each). Click a tower to KEEP / COMBINE. MARCH when ready.';
  }

  /** Place a prospect on an empty tile: 1g, path-validated, pending=true. */
  placeProspectAt(col: number, row: number): void {
    if (this.state.phase !== GamePhase.PROSPECT_PLACEMENT) return;
    if (this.state.tiles[row]?.[col] !== TileType.EMPTY) return;
    if (this.state.prospectsPlaced >= MAX_PROSPECTS_PER_ROUND) { this.state.hint = 'Prospect cap reached this round. KEEP or MARCH.'; return; }
    if (this.state.gold < PROSPECT_PLACE_COST) { this.state.hint = 'Not enough gold to roll a prospect.'; return; }
    if (this.state.prospectQueue.length === 0) this.state.prospectQueue = rollDraw(this.state, BASE_TOWER_TYPES);
    // Path-validate (base pattern): tentatively stamp, rebuild, revert if sealed.
    setTile(this.state, col, row, TileType.TOWER);
    const np = buildGroundPath(this.state);
    if (!np) { setTile(this.state, col, row, TileType.EMPTY); this.state.hint = 'That tile would seal the route. Try another.'; return; }
    this.state.groundPath = np;
    resnapEnemiesToPath(this.state, np);
    spendGold(this.state, PROSPECT_PLACE_COST);
    const card = this.state.prospectQueue.shift() as DrawCard;
    const t = createTower(card.type as TowerType, card.tier as 1 | 2 | 3 | 4 | 5, col, row, this.state.wave, true);
    this.state.towers.set(t.id, t);
    this.state.prospectsPlaced += 1;
    this.markStaticDirty();
  }

  /** Keep a pending prospect (pending=false). Spends a keep; crystallizes the
   *  rest + returns to BUILD when keeps run out (mirrors keepPending). */
  keepProspect(id: string): void {
    const keeper = this.state.towers.get(id);
    if (!keeper || !keeper.pending) return;
    keeper.pending = false;
    keeper.placedAtWave = this.state.wave;
    if (keeper.isAerarium) this.state.goldTowerCount += 1;
    this.state.hasKeptAnyTowerEver = true;
    this.state.keepsRemainingThisRound = Math.max(0, this.state.keepsRemainingThisRound - 1);
    if (this.state.keepsRemainingThisRound > 0 && this.hasPending) {
      this.state.phase = this.state.prospectQueue.length > 0 ? GamePhase.PROSPECT_PLACEMENT : GamePhase.PICK_KEEPER;
      this.state.hint = `Kept ${towerLabel(keeper)}. ${this.state.keepsRemainingThisRound} keep(s) left.`;
    } else {
      // Keeps exhausted → crystallize remaining pending into stone walls.
      this.crystallizeRemaining(id);
      this.state.phase = GamePhase.BUILD_PHASE;
      this.state.hint = `Kept ${towerLabel(keeper)}. Remaining prospects cemented to walls. MARCH when ready.`;
    }
    this.rebuildPath();
    this.markStaticDirty();
  }

  /** Convert every pending prospect to a stone wall (mirrors crystallizeAll). */
  crystallizeAll(): void {
    for (const t of Array.from(this.state.towers.values())) {
      if (t.pending) { this.state.towers.delete(t.id); setTile(this.state, t.tileX, t.tileY, TileType.STONE); }
    }
    this.state.prospectQueue = [];
    this.state.phase = GamePhase.BUILD_PHASE;
    this.rebuildPath();
    this.markStaticDirty();
  }

  private crystallizeRemaining(exceptId: string): void {
    for (const t of Array.from(this.state.towers.values())) {
      if (t.pending && t.id !== exceptId) { this.state.towers.delete(t.id); setTile(this.state, t.tileX, t.tileY, TileType.STONE); }
    }
  }

  // ── WAVE CONTROL ─────────────────────────────────────────────────────────
  /** MARCH: crystallize any unkept prospects, then start the wave (base gate). */
  march(): void {
    if (this.state.phase === GamePhase.WAVE_PHASE) return;
    if (this.hasPending) this.crystallizeAll();
    startWave(this.state);
    this.state.phase = GamePhase.WAVE_PHASE;
    // Reset boss runtime + stamp wave-start tick (base parity for boss scripts).
    this.bossRuntime = createBossRuntime();
    this.waveStartTick = this.state.tick;
    (this.state as any).__waveStartTick = this.state.tick;
    this.markStaticDirty();
  }

  // ── OVERLAYS (reuse the REAL base UI) ──────────────────────────────────
  /** Inspect a placed/pending tower — the REAL tower menu (stats, items,
   *  targeting, combine, keep). Identical UI to single-player. */
  inspectAt(col: number, row: number): void {
    const tw = Array.from(this.state.towers.values()).find((t) => t.tileX === col && t.tileY === row);
    if (!tw || !this.host) return;
    this.renderer.selectedTowerId = tw.id;
    const prewave = this.state.phase !== GamePhase.WAVE_PHASE;
    showTowerMenu(this.host, tw, this.state, this.inventory, {
      onClose: () => { document.getElementById('tower-menu')?.remove(); this.renderer.selectedTowerId = null; },
      onPathRefresh: () => this.rebuildPath(),
      onKeep: (id: string) => { this.keepProspect(id); document.getElementById('tower-menu')?.remove(); },
      // The tower menu surfaces available combos itself and calls back with
      // the chosen recipe; we resolve it to the AvailableCombo and execute —
      // the REAL combination engine, identical to single-player.
      onCombine: prewave ? (recipeIndex: number, isSameTierMerge: boolean, resultTileTowerId: string) => {
        const combo = realizableCombos(this.state).find(
          (c) => c.recipeIndex === recipeIndex && !!c.isSameTierMerge === isSameTierMerge);
        if (combo && executeCombo(this.state, combo, resultTileTowerId)) {
          this.rebuildPath(); this.markStaticDirty();
        }
        document.getElementById('tower-menu')?.remove();
      } : undefined,
    });
  }

  /** The REAL Codex overlay (enemies, towers, combos, wave briefs, etc.). */
  openCodex(): void {
    const parent = this.host ?? document.body;
    showCodex(parent, {
      poolLevel: this.state.poolLevel,
      heroLevel: this.state.heroLevel,
      totalKills: this.state.totalKills,
      towers: Array.from(this.state.towers.values()),
      completedQuests: this.state.completedQuests ?? [],
    } as any);
  }

  // ── INPUT ────────────────────────────────────────────────────────────────
  private wirePointer(): void {
    const cv = this.canvas;
    cv.style.cursor = 'crosshair';
    cv.addEventListener('mousemove', (e) => {
      const t = this.screenToTile(e);
      const valid = this.state.phase === GamePhase.PROSPECT_PLACEMENT && isBuildable(this.state, t.col, t.row);
      this.renderer.drawHover(t.col, t.row, valid, 0);
    });
    cv.addEventListener('mouseleave', () => this.renderer.drawHover(-1, -1, false));
    cv.addEventListener('click', (e) => {
      const { col, row } = this.screenToTile(e);
      if (col < 0 || row < 0 || col >= GRID.COLS || row >= GRID.ROWS) return;
      const tile = this.state.tiles[row]?.[col];
      if (tile === TileType.TOWER) { this.inspectAt(col, row); return; }
      if (this.state.phase === GamePhase.PROSPECT_PLACEMENT && tile === TileType.EMPTY) { this.placeProspectAt(col, row); return; }
    });
  }

  private screenToTile(e: MouseEvent): { col: number; row: number } {
    const rect = this.canvas.getBoundingClientRect();
    const rawX = (e.clientX - rect.left) * (GRID.CANVAS_W / rect.width);
    const rawY = (e.clientY - rect.top) * (GRID.CANVAS_H / rect.height);
    const x = (rawX - WORLD.OFFSET_X) / WORLD.ZOOM;
    const y = (rawY - WORLD.OFFSET_Y) / WORLD.ZOOM;
    return pixelToTile(x, y);
  }

  // ── FRAME LOOP (mirrors main.ts frame()) ───────────────────────────────
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
      // Boss scripts + fire-ground + boss hazards — same per-frame systems
      // base runs (main.ts frame), so bosses/fliers/DoT behave identically.
      tickBossScripts(this.state, dt, this.bossRuntime, this.waveStartTick);
      tickBurnPatches(this.state, dt);
      tickBossHazards(this.state, dt);
      tickEnemies(this.state, dt, (e) => this.handleLeak(e), (e) => this.handleDeath(e));
      tickCombat(this.state, dt, this.combatHooks);
      tickProjectiles(this.state, dt, { onImpact: () => { /* impact VFX handled by renderer */ } });
      checkWaveEnd(this.state, (gold) => {
        earnGold(this.state, Math.max(0, gold));
        this.hooks.onWaveCleared?.(this.state.wave, gold);
        this.rollProspects(); // next build phase, base flow
      });
    }

    this.hooks.onFrame?.(dt);

    if (this.staticDirty) { this.renderer.drawStatic(this.state); this.staticDirty = false; }
    this.renderer.drawDynamic(this.state);
    const wInfo = getNextWaveInfo(this.state);
    this.renderer.drawAmbient(this.state.tick, this.state.wave, wInfo?.type === 'B');
    // autoStart:false → flush the scene graph to the canvas each frame (main.ts:7490).
    this.renderer.app.render();
  }

  // ── KILL / LEAK ───────────────────────────────────────────────────────
  private readonly combatHooks: CombatHooks = {
    onKill: (tower, enemy) => {
      this.state.gold += (enemy.reward ?? 0) + ECONOMY.BASE_GOLD_PER_KILL;
      this.state.totalKills += 1;
      this.state.enemiesKilledThisWave += 1;
      this.hooks.onKill?.(tower, enemy);
    },
    onHit: (tower, enemy, damage) => { this.hooks.onHit?.(tower, enemy, damage); },
    onMeleeSwing: (tower, enemy, damage) => { this.hooks.onHit?.(tower, enemy, damage); },
    onProjectileFire: () => { /* projectile sprites spawn from tickCombat */ },
  };

  private handleDeath(e: Enemy): void {
    // Boss-death bookkeeping (rebirth queue, drops) — base parity.
    if (e.isBoss) handleBossDeath(this.state, e, this.bossRuntime);
  }

  private handleLeak(e: Enemy): void {
    this.state.enemiesLeakedThisWave += 1;
    const suppressed = this.hooks.onLeak?.(e) === true; // LR3 routes to circuit
    if (suppressed) return;
    this.state.lives -= e.livesCost ?? 1;
    if (this.state.lives <= 0 && this.state.gameOverAt < 0) { this.state.gameOverAt = this.state.tick; this.hooks.onDefeat?.(); }
  }

  // ── HELPERS ──────────────────────────────────────────────────────────────
  /**
   * Spawn an inbound CIRCUIT leak (multiplayer): an enemy that escaped an
   * upstream player's board arrives at its RETAINED HP (Section 5.2). It
   * walks this board's path; if it leaks again, onLeak routes it onward. On
   * the classic 38x26 map it enters at the spawn cave (no on-board seam).
   */
  spawnInboundLeak(enemyType: string, hp: number, maxHp: number, fromQuadrant: string): void {
    if (this.state.phase !== GamePhase.WAVE_PHASE) return;
    const e = spawnEnemy(this.state, enemyType as EnemyType, 1);
    e.hp = Math.max(1, hp);
    e.maxHp = Math.max(e.hp, maxHp);
    (e as any).__circuit = true;
    (e as any).__origin = fromQuadrant;
  }

  markStaticDirty(): void { this.staticDirty = true; }

  // ── BASE-PARITY BUILD CONTROLS (same mechanics as single-player) ───────
  /** Gold cost of the next pool upgrade, or null if maxed (ECONOMY curve). */
  poolUpgradeCost(): number | null {
    const lvl = this.state.poolLevel;
    return lvl >= ECONOMY.POOL_MAX_LEVEL ? null : ECONOMY.POOL_UPGRADE_COSTS[lvl];
  }
  /** Upgrade the draw pool (raises rarer-tower odds in rollDraw) — base economy. */
  upgradePool(): boolean {
    const cost = this.poolUpgradeCost();
    if (cost == null || this.state.gold < cost) return false;
    spendGold(this.state, cost);
    this.state.poolLevel += 1;
    return true;
  }
  /** Bulk-retarget every placed (non-pending) tower — the base TARGET ALL. */
  setAllTargeting(mode: TargetingMode): void {
    for (const t of this.state.towers.values()) if (!t.pending) t.targetingMode = mode;
  }
  private rebuildPath(): void {
    const np = buildGroundPath(this.state);
    if (np) { this.state.groundPath = np; resnapEnemiesToPath(this.state, np); }
  }
}

function towerLabel(t: Tower): string { return `${String(t.type).replace(/_/g, ' ')} T${t.qualityTier ?? 1}`; }

// ─── SHARED ENGINE GLOBALS ─────────────────────────────────────────────
let _globalsReady = false;
async function ensureEngineGlobals(): Promise<void> {
  if (_globalsReady) return;
  const w = window as any;
  if (!w.__wpData) w.__wpData = await import('../data/waypoints.json').then((m) => m.default ?? m);
  if (!w.__enemiesData) w.__enemiesData = await import('../data/enemies.json').then((m) => m.default ?? m);
  if (!w.__waves__) w.__waves__ = await import('../data/waves.json').then((m) => m.default ?? m);
  void GRID;
  _globalsReady = true;
}
