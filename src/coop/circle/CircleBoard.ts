// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION — Green Circle game board (CIRCLE-3)
//
// First PLAYABLE circle: real Roman TD systems running on the shared
// square-spiral map. This is the integration vehicle for the /goal —
// it composes the base game's exported, state-parameterized systems
// (spawnEnemy / tickEnemies / tickCombat / tickProjectiles / createTower)
// onto the CircleMap geometry, with the REAL tower + enemy + projectile
// sprites resolved by tex(type). No fork of main.ts's single-player
// closure: every system is reused as-is on a GameState whose groundPath
// IS the circle spiral.
//
// What runs here today:
//   • Enemies stream from ALL FOUR corner caves at once (Green Circle),
//     each spiralling inward to Rome along the one shared path.
//   • A creep that reaches Rome (path end) costs the team 1 shared life.
//   • Towers placed on grass build tiles fight with real combat: melee
//     swings, projectiles, splash, status — all via the base resolver.
//   • Real sprites for towers (tex(tower.type)), enemies (tex(enemy.type)),
//     and projectiles (tex(p.spriteKey)).
//
// The combat coordinate space uses GRID.TILE (32px) so the base combat
// ranges are correct; the small 24-tile grid is what makes each tile read
// big. Hooks are renderer-free (no RenderEngine dependency): VFX are
// no-ops here, damage application is the real applyDamageAndStatus.
//
// Still to wire (tracked in the Legion spec / backlog): the 20 authored
// waves via WaveManager, prospecting + combos + Codex + shop + Mercator
// sidebar. Those systems are confirmed reusable (see the vault reuse map);
// this board is the surface they mount onto.
// ─────────────────────────────────────────────────────────────────────

import { Application, Container } from 'pixi.js';
import { createGameState, type GameStateShape } from '../../GameState';
import { GRID, ECONOMY } from '../../constants';
import { TileType, GamePhase, EnemyType, TowerType, type Enemy } from '../../types';
import { generateCircleMap, type CircleMapGeometry } from './CircleMap';
import { renderCircleMap, renderCircleEntities } from './CircleRenderer';
import { spawnEnemy, tickEnemies } from '../../systems/EnemySystem';
import { tickCombat, applyDamageAndStatus, type CombatHooks } from '../../systems/CombatResolver';
import { tickProjectiles } from '../../systems/ProjectileSystem';
import { createTower } from '../../systems/TowerSystem';

const TILE = GRID.TILE;          // 32px game coords so base combat ranges match
const FRAME_MS = 1000 / 60;
const DT = FRAME_MS / 1000;

/** A queued spawn: which enemy, which corner, and when (wave-elapsed sec). */
interface QueuedSpawn { type: EnemyType; corner: number; at: number; }

/**
 * Representative early-game roster for the prototype. The real 20 authored
 * waves (WaveManager.tickSpawns) are a confirmed-reusable follow-up; this
 * roster exists so multiple REAL enemy sprites stream the spiral now.
 */
const ROSTER: EnemyType[] = [
  EnemyType.FERAL_DOG, EnemyType.RABID_DOG, EnemyType.CELTIC_FOOTMAN,
  EnemyType.CELTIC_BERSERKER, EnemyType.CARTHAGE_SPEARMAN, EnemyType.CELTIC_SCOUT,
];

export interface CircleBoardOpts {
  startingGold?: number;
  startingLives?: number;
}

export class CircleBoard {
  readonly state: GameStateShape;
  readonly geo: CircleMapGeometry;
  readonly app: Application;
  lives: number;
  private readonly mapLayer = new Container();
  private readonly entityLayer = new Container();
  private readonly combatHooks: CombatHooks;
  private readonly projHooks: { onImpact: (p: any, target: Enemy | null, hx: number, hy: number) => void };
  private loop = 0;
  private queue: QueuedSpawn[] = [];
  private waveElapsed = 0;
  private spawned = 0;
  /** Notified each frame so the host UI can refresh the HUD. */
  onHud: ((b: CircleBoard) => void) | null = null;

  constructor(opts: CircleBoardOpts = {}) {
    this.geo = generateCircleMap();           // 24 / step 3 / margin 1
    this.lives = opts.startingLives ?? 20;
    this.state = createGameState();
    this.state.gold = opts.startingGold ?? 300;
    this.state.wave = 1;
    this.state.phase = GamePhase.BUILD_PHASE;

    // The circle spiral IS the ground path. Build tiles outside it.
    this.state.groundPath = this.geo.path.map((p) => ({ col: p.col, row: p.row }));
    // Flyer path: pixel-center version of the spiral so flyer spawns don't
    // crash (no flyers in the early roster; full flyer arc is a follow-up).
    this.state.flyerPath = this.geo.path.map((p) => ({ x: p.col * TILE + TILE / 2, y: p.row * TILE + TILE / 2 }));

    // Tiles grid sized to the circle (24x24): path + border = non-buildable
    // (STONE), interior gaps = EMPTY (buildable). Combat/enemy systems are
    // position + path based and never read these dims, so this is safe.
    const N = this.geo.size;
    const tiles: TileType[][] = [];
    for (let r = 0; r < N; r++) {
      const row: TileType[] = [];
      for (let c = 0; c < N; c++) row.push(this.isBuildTile(c, r) ? TileType.EMPTY : TileType.STONE);
      tiles.push(row);
    }
    (this.state as any).tiles = tiles;

    this.app = new Application({ width: N * TILE, height: N * TILE, backgroundColor: 0x0c1208, antialias: false, autoStart: false });

    // Renderer-free combat: damage is real, VFX are no-ops on the circle.
    this.combatHooks = {
      onKill: (_t, e) => {
        this.state.gold += (e.reward ?? 0) + ECONOMY.BASE_GOLD_PER_KILL;
        this.state.totalKills += 1;
        this.state.enemiesKilledThisWave += 1;
      },
      onHit: () => { /* VFX no-op on the circle prototype */ },
      onMeleeSwing: () => { /* VFX no-op */ },
      onProjectileFire: () => { /* SFX no-op */ },
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

  start(): void {
    this.app.stage.addChild(this.mapLayer, this.entityLayer);
    renderCircleMap(this.mapLayer, this.geo, TILE, this.state.wave);
    this.app.render();
    this.loop = window.setInterval(() => this.tick(), FRAME_MS);
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

  // ── Build a wave roster: every corner fires at once (Green Circle). Count
  //    and cadence scale gently with wave number. ────────────────────────
  startWave(): void {
    if (this.inWave) return;
    const wave = this.state.wave;
    const perCorner = 6 + wave * 2;
    const gap = Math.max(0.35, 0.85 - wave * 0.03);   // seconds between spawns
    this.queue = [];
    for (let i = 0; i < perCorner; i++) {
      const type = ROSTER[(i + wave) % ROSTER.length];
      for (let corner = 0; corner < 4; corner++) this.queue.push({ type, corner, at: i * gap });
    }
    this.queue.sort((a, b) => a.at - b.at);
    this.waveElapsed = 0;
    this.spawned = 0;
    this.state.enemiesKilledThisWave = 0;
    this.state.phase = GamePhase.WAVE_PHASE;
    (this.state as any).__waveStartTick = this.state.tick;
  }

  /** Place a tower on a grass build tile (real createTower → real combat). */
  placeTower(col: number, row: number, type: TowerType, tier: 1 | 2 | 3 | 4 | 5 = 1, cost = 10): boolean {
    if (!this.isBuildTile(col, row)) return false;
    if ((this.state as any).tiles[row]?.[col] !== TileType.EMPTY) return false;  // one tower per tile
    if (this.state.gold < cost) return false;
    const t = createTower(type, tier, col, row, this.state.wave, false);
    this.state.towers.set(t.id, t);
    (this.state as any).tiles[row][col] = TileType.TOWER;
    this.state.gold -= cost;
    return true;
  }

  /** Spawn one enemy at a given corner, snapped to that corner's path index. */
  private spawnAtCorner(type: EnemyType, corner: number): void {
    const sp = this.geo.spawns[corner % this.geo.spawns.length];
    if (!sp) return;
    const hpMult = 1 + (this.state.wave - 1) * 0.12;
    const e = spawnEnemy(this.state, type, hpMult);
    const tile = this.geo.path[sp.pathIndex];
    e.pathIndex = sp.pathIndex;
    e.pathProgress = 0;
    e.x = e.prevX = tile.col * TILE + TILE / 2;
    e.y = e.prevY = tile.row * TILE + TILE / 2;
    this.state.enemies.set(e.id, e);
  }

  private tick(): void {
    this.state.tick += DT;

    if (this.inWave) {
      this.waveElapsed += DT;
      // Drain due spawns from the queue across the 4 corners.
      while (this.queue.length && this.queue[0].at <= this.waveElapsed) {
        const q = this.queue.shift() as QueuedSpawn;
        this.spawnAtCorner(q.type, q.corner);
        this.spawned += 1;
      }
      // Wave end: queue drained and field cleared.
      if (this.queue.length === 0 && this.state.enemies.size === 0 && this.spawned > 0) {
        this.state.phase = GamePhase.BUILD_PHASE;
        this.state.gold += 40 + this.state.wave * 10;     // end-of-wave bounty
        this.state.wave += 1;
        this.spawned = 0;
      }
    }

    // Real base systems, in the base order.
    tickEnemies(
      this.state, DT,
      (_e) => { this.lives = Math.max(0, this.lives - (_e.livesCost ?? 1)); },  // reached Rome
      (_e) => { /* death handled via combat onKill */ },
    );
    tickCombat(this.state, DT, this.combatHooks);
    tickProjectiles(this.state, DT, this.projHooks);

    // Redraw entities (towers + enemies + projectiles) with real sprites.
    renderCircleEntities(this.entityLayer, this.state, this.geo, TILE);
    this.app.render();
    this.onHud?.(this);
  }
}
