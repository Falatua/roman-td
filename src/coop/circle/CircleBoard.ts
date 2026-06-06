// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION — Green Circle game board (CIRCLE-4)
//
// The full single-player Roman TD experience on the shared circular map.
// CircleBoard composes the base game's exported, state-parameterized
// systems on a GameState whose groundPath IS the circle spiral — no fork
// of main.ts. It implements the board interface the real single-player
// UIManager sidebar expects (see CircleSidebar), so the mode gets the same
// left HUD (WAVE / LIVES / GOLD / POOL odds / SCORE) and right button rail
// (START WAVE / speed / pause / UPGRADE POOL / SHOP / QUESTS / CODEX / SELL
// STONES / LEADERBOARD / DPS CHECK / TARGET ALL / SETTINGS / INVENTORY).
//
// Differences from single-player, by design:
//   • No maze: towers go only on grass build tiles; the spiral is fixed.
//   • Four corner caves spawn at once (Green Circle) — the real WaveManager
//     waves are fanned across the 4 corner path-indices.
//   • LIVES is the shared center life pool (state.lives); a creep reaching
//     Rome costs the team a life.
//
// Combat coords use GRID.TILE (32px) so base ranges are correct. Combat
// hooks are renderer-free for now (real damage, SFX/VFX added next slice).
// ─────────────────────────────────────────────────────────────────────

import { Application, Container } from 'pixi.js';
import { createGameState, type GameStateShape } from '../../GameState';
import { GRID, ECONOMY, WAVE } from '../../constants';
import { TileType, GamePhase, EnemyType, TowerType, TargetingMode, type Enemy } from '../../types';
import { generateCircleMap, type CircleMapGeometry } from './CircleMap';
import { renderCircleMap, renderCircleEntities } from './CircleRenderer';
import { spawnEnemy, tickEnemies } from '../../systems/EnemySystem';
import { tickCombat, applyDamageAndStatus, type CombatHooks } from '../../systems/CombatResolver';
import { tickProjectiles } from '../../systems/ProjectileSystem';
import { createTower, rollDraw, BASE_TOWER_TYPES } from '../../systems/TowerSystem';
import { startWave, tickSpawns, checkWaveEnd } from '../../systems/WaveManager';
import { poolUpgradeCost } from '../../systems/EconomySystem';
import { showCodex } from '../../render/Codex';
import { createInventory, type InventoryState } from '../../systems/LootSystem';

const TILE = GRID.TILE;          // 32px game coords so base combat ranges match
const FRAME_MS = 1000 / 60;
const DT = FRAME_MS / 1000;

export interface CircleBoardOpts {
  startingGold?: number;
  startingLives?: number;
  /** DOM element used as the parent for modals (codex/shop). */
  overlay?: HTMLElement;
}

export class CircleBoard {
  readonly state: GameStateShape;
  readonly geo: CircleMapGeometry;
  readonly app: Application;
  readonly inventory: InventoryState = createInventory();
  speedMult = 1;
  paused = false;
  overlay: HTMLElement = document.body;

  private readonly mapLayer = new Container();
  private readonly entityLayer = new Container();
  private readonly combatHooks: CombatHooks;
  private readonly projHooks: { onImpact: (p: any, target: Enemy | null, hx: number, hy: number) => void };
  private loop = 0;
  private cornerRR = 0;
  /** Notified each frame so the host UI can refresh the HUD/sidebar. */
  onHud: ((b: CircleBoard) => void) | null = null;

  constructor(opts: CircleBoardOpts = {}) {
    this.geo = generateCircleMap();           // 24 / step 3 / margin 1
    if (opts.overlay) this.overlay = opts.overlay;
    this.state = createGameState();
    this.state.gold = opts.startingGold ?? ECONOMY.STARTING_GOLD;
    this.state.lives = opts.startingLives ?? ECONOMY.STARTING_LIVES;   // shared center pool
    this.state.wave = 0;                       // pre-game; march() -> wave 1
    this.state.phase = GamePhase.BUILD_PHASE;

    // The circle spiral IS the ground path. Flyer path = pixel-center version.
    this.state.groundPath = this.geo.path.map((p) => ({ col: p.col, row: p.row }));
    this.state.flyerPath = this.geo.path.map((p) => ({ x: p.col * TILE + TILE / 2, y: p.row * TILE + TILE / 2 }));

    // Tiles grid sized to the circle: path + border = non-buildable (STONE),
    // interior gaps = EMPTY (buildable). Position/path based systems never
    // read these dims, so this is safe.
    const N = this.geo.size;
    const tiles: TileType[][] = [];
    for (let r = 0; r < N; r++) {
      const row: TileType[] = [];
      for (let c = 0; c < N; c++) row.push(this.isBuildTile(c, r) ? TileType.EMPTY : TileType.STONE);
      tiles.push(row);
    }
    (this.state as any).tiles = tiles;

    this.app = new Application({ width: N * TILE, height: N * TILE, backgroundColor: 0x0c1208, antialias: false, autoStart: false });

    this.combatHooks = {
      onKill: (_t, e) => {
        this.state.gold += (e.reward ?? 0) + ECONOMY.BASE_GOLD_PER_KILL;
        this.state.totalKills += 1;
        this.state.enemiesKilledThisWave += 1;
        this.state.score += 1;
      },
      onHit: () => { /* VFX added next slice */ },
      onMeleeSwing: () => { /* VFX/SFX added next slice */ },
      onProjectileFire: () => { /* SFX added next slice */ },
    };
    this.projHooks = {
      onImpact: (p, target, hx, hy) => {
        if (p.cosmetic) return;
        if (target && target.hp > 0) {
          const tw = this.state.towers.get(p.sourceTowerId);
          if (tw) applyDamageAndStatus(this.state, tw, target, p.damage, this.combatHooks);
          if (p.splash > 0) {
            const r = p.splash * TILE;
            for (const other of this.state.enemies.values()) {
              if (other.id === (target as Enemy).id) continue;
              if (Math.hypot(other.x - hx, other.y - hy) <= r && tw) {
                applyDamageAndStatus(this.state, tw, other, p.damage * 0.6, this.combatHooks);
              }
            }
          }
        }
      },
    };
  }

  /** Buildable = interior, not on the path, not on the outer margin. */
  isBuildTile(col: number, row: number): boolean {
    const lo = this.geo.margin, hi = this.geo.size - 1 - this.geo.margin;
    if (col < lo || col > hi || row < lo || row > hi) return false;
    return !this.geo.isPath(col, row);
  }

  // ── Lifecycle (board interface) ────────────────────────────────────────
  mount(parent: HTMLElement): void {
    this.app.stage.addChild(this.mapLayer, this.entityLayer);
    renderCircleMap(this.mapLayer, this.geo, TILE, 1);
    this.app.render();
    parent.appendChild(this.canvas);
    this.loop = window.setInterval(() => this.frame(), FRAME_MS);
  }
  destroy(): void {
    if (this.loop) window.clearInterval(this.loop);
    this.loop = 0;
    try { (this.app.view as HTMLCanvasElement)?.remove(); } catch { /* ignore */ }
    try { this.app.destroy(true); } catch { /* ignore */ }
  }
  get canvas(): HTMLCanvasElement { return this.app.view as HTMLCanvasElement; }
  get enemiesAlive(): number { return this.state.enemies.size; }
  get inWave(): boolean { return this.state.phase === GamePhase.WAVE_PHASE; }

  // ── Board interface the sidebar wires to ───────────────────────────────
  /** START WAVE — boot the real WaveManager wave (fanned to 4 corners). */
  march(): void {
    if (this.inWave) return;
    if (this.state.phase === GamePhase.GAME_OVER || this.state.phase === GamePhase.VICTORY) return;
    startWave(this.state);                     // bumps wave, builds spawnQueue, sets WAVE_PHASE
  }
  upgradePool(): boolean {
    const cost = poolUpgradeCost(this.state);
    if (cost < 0 || this.state.gold < cost) return false;
    this.state.gold -= cost;
    this.state.poolLevel += 1;
    return true;
  }
  setAllTargeting(mode: TargetingMode): void {
    for (const t of this.state.towers.values()) t.targetingMode = mode;
  }
  openCodex(): void {
    showCodex(this.overlay, {
      poolLevel: this.state.poolLevel,
      heroLevel: this.state.heroLevel ?? 0,
      totalKills: this.state.totalKills,
      towers: Array.from(this.state.towers.values()).map((t) => ({ type: t.type, qualityTier: t.qualityTier, pending: t.pending })),
      completedQuests: (this.state as any).completedQuests ?? [],
    });
  }

  /** Place a tower on a grass build tile (prototype build: rolls a real type). */
  placeTower(col: number, row: number, type?: TowerType, tier: 1 | 2 | 3 | 4 | 5 = 1, cost = 10): boolean {
    if (!this.isBuildTile(col, row)) return false;
    if ((this.state as any).tiles[row]?.[col] !== TileType.EMPTY) return false;  // one tower per tile
    if (this.state.gold < cost) return false;
    let t: TowerType; let q: 1 | 2 | 3 | 4 | 5 = tier;
    if (type) { t = type; } else {
      const card = (this.state.prospectQueue?.[0]) ?? rollDraw(this.state, BASE_TOWER_TYPES)[0];
      t = card.type as TowerType; q = card.tier as 1 | 2 | 3 | 4 | 5;
    }
    const tw = createTower(t, q, col, row, Math.max(1, this.state.wave), false);
    this.state.towers.set(tw.id, tw);
    (this.state as any).tiles[row][col] = TileType.TOWER;
    this.state.gold -= cost;
    return true;
  }

  // ── Per-frame simulation ───────────────────────────────────────────────
  private assignCorner(e: Enemy): void {
    const sp = this.geo.spawns[this.cornerRR % this.geo.spawns.length];
    this.cornerRR += 1;
    if (!sp) return;
    const tile = this.geo.path[sp.pathIndex];
    e.pathIndex = sp.pathIndex;
    e.pathProgress = 0;
    e.x = e.prevX = tile.col * TILE + TILE / 2;
    e.y = e.prevY = tile.row * TILE + TILE / 2;
  }

  private step(dt: number): void {
    this.state.tick += dt;
    if (this.inWave) {
      const before = new Set(this.state.enemies.keys());
      tickSpawns(this.state, dt);
      // Fan every newly-spawned ground creep across the 4 corner caves.
      for (const [id, e] of this.state.enemies) {
        if (before.has(id) || e.isFlyer) continue;
        this.assignCorner(e);
      }
      tickEnemies(
        this.state, dt,
        (e) => {                                   // reached Rome → shared life pool
          this.state.lives = Math.max(0, this.state.lives - (e.livesCost ?? 1));
          if (this.state.lives <= 0) this.state.phase = GamePhase.GAME_OVER;
        },
        () => { /* death gold handled in combat onKill */ },
      );
      tickCombat(this.state, dt, this.combatHooks);
      tickProjectiles(this.state, dt, this.projHooks);
      checkWaveEnd(this.state, (gold) => {
        this.state.gold += gold;
        if (this.state.wave >= WAVE.TOTAL) this.state.phase = GamePhase.VICTORY;
      });
    }
  }

  private frame(): void {
    if (!this.paused && this.state.phase !== GamePhase.GAME_OVER && this.state.phase !== GamePhase.VICTORY) {
      const steps = Math.max(1, this.speedMult | 0);
      for (let s = 0; s < steps; s++) this.step(DT);
    }
    renderCircleEntities(this.entityLayer, this.state, this.geo, TILE);
    this.app.render();
    this.onHud?.(this);
  }
}
