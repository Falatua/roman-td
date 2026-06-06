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
import { GRID, ECONOMY, WAVE, type AuraTile } from '../../constants';
import { TileType, GamePhase, EnemyType, TowerType, TargetingMode, type Enemy, type DrawCard } from '../../types';
import { generateCircleMap, type CircleMapGeometry } from './CircleMap';
import { renderCircleMap, renderCircleEntities } from './CircleRenderer';
import { spawnEnemy, tickEnemies, tickBurnPatches, tickBossHazards } from '../../systems/EnemySystem';
import { tickCombat, type CombatHooks } from '../../systems/CombatResolver';
import { tickProjectiles } from '../../systems/ProjectileSystem';
import { createBossRuntime, tickBossScripts, handleBossDeath, applyEnemyAuras } from '../../systems/BossScripts';
type BossRuntime = ReturnType<typeof createBossRuntime>;
import { tickHeroAbilities, type HeroHooks } from '../../systems/HeroSystem';
import { tickSurpriseEvents } from '../../systems/SurpriseEvents';
import { createTower, rollDraw, BASE_TOWER_TYPES, setAuraTilesOverride } from '../../systems/TowerSystem';
import { startWave, tickSpawns, checkWaveEnd, getNextWaveInfo } from '../../systems/WaveManager';
import { poolUpgradeCost, spendGold, earnGold } from '../../systems/EconomySystem';
import { realizableCombos, executeCombo } from '../../systems/CombinationEngine';
import { createGoreState, tickGore, pruneCorpses, fadeCorpsesAtWaveEnd, type GoreState } from '../../systems/GoreSystem';
import { buildCombatHooks, buildProjectileHooks, emitBoardDeathFx, boardWaveAudio, realizableComboCount } from '../BoardPresentation';
import { SFX } from '../../render/AudioManager';
import { showTowerMenu } from '../../render/TowerMenu';
import { showCodex } from '../../render/Codex';
import { createInventory, type InventoryState } from '../../systems/LootSystem';
import { CircleFx } from './CircleFx';

const TILE = GRID.TILE;          // 32px game coords so base combat ranges match
const FRAME_MS = 1000 / 60;
const DT = FRAME_MS / 1000;

// Prospecting constants — base parity (RomanBoard / main.ts).
const PROSPECT_PLACE_COST = 1;
const MAX_PROSPECTS_PER_ROUND = 10;
const KEEPS_PER_ROUND = 2;

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
  host: HTMLElement = document.body;
  selectedTowerId: string | null = null;
  hover: { col: number; row: number; valid: boolean } | null = null;

  readonly fx: CircleFx;
  readonly gore: GoreState = createGoreState();
  readonly auraTiles: AuraTile[];
  private readonly mapLayer = new Container();
  private readonly entityLayer = new Container();
  private readonly combatHooks: CombatHooks;
  private readonly projHooks: { onImpact: (p: any, target: Enemy | null, hx: number, hy: number) => void };
  private loop = 0;
  private cornerRR = 0;
  private _lastCombo = 0;
  private bossRuntime: BossRuntime = createBossRuntime();
  private waveStartTick = 0;
  private readonly heroHooks: HeroHooks;
  /** Notified each frame so the host UI can refresh the HUD/sidebar. */
  onHud: ((b: CircleBoard) => void) | null = null;

  constructor(opts: CircleBoardOpts = {}) {
    this.geo = generateCircleMap();           // 24 / step 3 / margin 1
    this.auraTiles = buildCircleAuraTiles(this.geo);
    setAuraTilesOverride(this.auraTiles);     // circle aura tiles (cleared on destroy)
    if (opts.overlay) this.overlay = opts.overlay;
    this.state = createGameState();
    this.state.gold = opts.startingGold ?? ECONOMY.STARTING_GOLD;
    this.state.lives = opts.startingLives ?? ECONOMY.STARTING_LIVES;   // shared center pool
    this.state.wave = 0;                       // pre-game; march() -> wave 1
    this.state.phase = GamePhase.BUILD_PHASE;
    (this.state as any).__fixedPath = true;    // immutable spiral: skip maze re-validation in combos

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

    // REAL combat presentation: reuse the single-player BoardPresentation hooks
    // (SFX + gore + slash/muzzle/ring/shake VFX) via the CircleFx renderer shim.
    // buildCombatHooks already mints kill gold + totalKills; we add score.
    this.fx = new CircleFx(this.app.stage);
    this.combatHooks = buildCombatHooks(this.fx as any, this.state, this.gore, {
      onKill: () => { this.state.score += 1; },
    });
    this.projHooks = buildProjectileHooks(this.fx as any, this.state, this.gore, this.combatHooks);
    // Hero ability hooks → circle VFX (single-player parity; the unique
    // per-ability shape renderers are RenderEngine-only, so abilities pulse
    // a ring + flash here instead of their bespoke shapes).
    this.heroHooks = {
      triggerImpactRing: (x, y, tick, maxR, color) => this.fx.triggerImpactRing(x, y, tick, maxR, color),
      triggerShake: (i, d) => this.fx.triggerShake(i, d),
      resnapEnemiesToPath: () => { /* fixed spiral — no reroute */ },
      triggerHeroAbilityFx: (spec: any) => {
        this.fx.triggerImpactRing(spec.x, spec.y, spec.tick ?? this.state.tick, 44, spec.color ?? 0xffd34d);
        this.fx.triggerMuzzleFlash(spec.x, spec.y, spec.color ?? 0xffd34d, this.state.tick);
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
    this.host = parent;
    setAuraTilesOverride(this.auraTiles);     // this board owns the aura tiles while active
    this.app.stage.addChild(this.mapLayer, this.entityLayer, this.fx.goreLayer, this.fx.fxLayer);
    renderCircleMap(this.mapLayer, this.geo, TILE, 1, this.auraTiles);
    this.app.render();
    parent.appendChild(this.canvas);
    this.rollProspects();                  // open the first build round (PROSPECT_PLACEMENT)
    this.loop = window.setInterval(() => this.frame(), FRAME_MS);
  }
  destroy(): void {
    if (this.loop) window.clearInterval(this.loop);
    this.loop = 0;
    setAuraTilesOverride(null);               // restore base AURA_TILES for single-player
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
    if (this.hasPending) this.crystallizeAll();    // unkept prospects cement to walls
    const info: any = getNextWaveInfo(this.state);
    startWave(this.state);                         // bumps wave, builds spawnQueue, sets WAVE_PHASE
    this.bossRuntime = createBossRuntime();        // fresh boss-script runtime per wave
    this.waveStartTick = this.state.tick;
    (this.state as any).__waveStartTick = this.state.tick;
    boardWaveAudio(this.fx as any, info?.faction, info?.type === 'B', this.state.wave);  // wave bumper + faction BGM
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

  // ── PROSPECTING (base parity, build-tile placement, fixed spiral) ──────
  get hasPending(): boolean { for (const t of this.state.towers.values()) if (t.pending) return true; return false; }
  get pendingHero(): boolean { const p = this.state.pendingPurchasedTowers; return !!(p && p.length && p[0].source === 'hero'); }

  /** Roll a fresh draw and enter PROSPECT_PLACEMENT (mirrors rollProspects). */
  rollProspects(): void {
    this.state.prospectQueue = rollDraw(this.state, BASE_TOWER_TYPES);
    this.state.prospectsPlaced = 0;
    this.state.keepsRemainingThisRound = KEEPS_PER_ROUND;
    this.state.phase = GamePhase.PROSPECT_PLACEMENT;
    this.state.hint = 'Click empty grass tiles to reveal prospects (1g each). Click a tower to KEEP / COMBINE. START WAVE when ready.';
  }

  /** Reveal a prospect on a grass build tile (1g, pending=true). No path validate — the spiral is fixed. */
  placeProspectAt(col: number, row: number): boolean {
    if (this.state.phase !== GamePhase.PROSPECT_PLACEMENT) return false;
    if (!this.isBuildTile(col, row)) return false;
    if ((this.state as any).tiles[row]?.[col] !== TileType.EMPTY) return false;
    if (this.state.prospectsPlaced >= MAX_PROSPECTS_PER_ROUND) { this.state.hint = 'Prospect cap reached this round. KEEP or START WAVE.'; return false; }
    if (this.state.gold < PROSPECT_PLACE_COST) { this.state.hint = 'Not enough gold to roll a prospect.'; return false; }
    if (this.state.prospectQueue.length === 0) this.state.prospectQueue = rollDraw(this.state, BASE_TOWER_TYPES);
    spendGold(this.state, PROSPECT_PLACE_COST);
    const card = this.state.prospectQueue.shift() as DrawCard;
    const t = createTower(card.type as TowerType, card.tier as 1 | 2 | 3 | 4 | 5, col, row, Math.max(1, this.state.wave), true);
    this.state.towers.set(t.id, t);
    (this.state as any).tiles[row][col] = TileType.TOWER;
    this.state.prospectsPlaced += 1;
    SFX.prospectPlace();
    return true;
  }

  /** Keep a pending prospect; crystallize the rest + return to BUILD when keeps run out. */
  keepProspect(id: string): void {
    const keeper = this.state.towers.get(id);
    if (!keeper || !keeper.pending) return;
    keeper.pending = false;
    keeper.placedAtWave = this.state.wave;
    SFX.prospectKeep();
    if ((keeper as any).isAerarium) this.state.goldTowerCount += 1;
    this.state.hasKeptAnyTowerEver = true;
    this.state.keepsRemainingThisRound = Math.max(0, this.state.keepsRemainingThisRound - 1);
    if (this.state.keepsRemainingThisRound > 0 && this.hasPending) {
      this.state.phase = this.state.prospectQueue.length > 0 ? GamePhase.PROSPECT_PLACEMENT : GamePhase.PICK_KEEPER;
    } else {
      this.crystallizeRemaining(id);
      this.state.phase = GamePhase.BUILD_PHASE;
    }
  }

  /** Convert every pending prospect to a stone wall (mirrors crystallizeAll). */
  crystallizeAll(): void {
    for (const t of Array.from(this.state.towers.values())) {
      if (t.pending) { this.state.towers.delete(t.id); (this.state as any).tiles[t.tileY][t.tileX] = TileType.STONE; }
    }
    this.state.prospectQueue = [];
    this.state.phase = GamePhase.BUILD_PHASE;
  }
  private crystallizeRemaining(exceptId: string): void {
    for (const t of Array.from(this.state.towers.values())) {
      if (t.pending && t.id !== exceptId) { this.state.towers.delete(t.id); (this.state as any).tiles[t.tileY][t.tileX] = TileType.STONE; }
    }
  }

  /** Place the drafted hero (state.pendingPurchasedTowers) on a grass tile. */
  placeHeroAt(col: number, row: number): boolean {
    const pend = this.state.pendingPurchasedTowers;
    if (!pend || pend.length === 0 || pend[0].source !== 'hero') return false;
    if (!this.isBuildTile(col, row)) return false;
    if ((this.state as any).tiles[row]?.[col] !== TileType.EMPTY) return false;
    const head = pend.shift()!;
    const tw = createTower(head.type as TowerType, (head.tier ?? 1) as 1 | 2 | 3 | 4 | 5, col, row, Math.max(1, this.state.wave), false);
    this.state.towers.set(tw.id, tw);
    (this.state as any).tiles[row][col] = TileType.TOWER;
    if (!this.state.activeHeroId) this.state.activeHeroId = head.type as any;
    return true;
  }

  /** The REAL tower menu (stats / items / targeting / keep / combine). */
  inspectAt(col: number, row: number): void {
    const tw = Array.from(this.state.towers.values()).find((t) => t.tileX === col && t.tileY === row);
    if (!tw) return;
    this.selectedTowerId = tw.id;
    const prewave = this.state.phase !== GamePhase.WAVE_PHASE;
    showTowerMenu(this.host, tw, this.state, this.inventory, {
      onClose: () => { document.getElementById('tower-menu')?.remove(); this.selectedTowerId = null; },
      onPathRefresh: () => { /* fixed spiral — no path rebuild */ },
      onKeep: (id: string) => { this.keepProspect(id); document.getElementById('tower-menu')?.remove(); },
      onCombine: prewave ? (recipeIndex: number, isSameTierMerge: boolean, resultTileTowerId: string) => {
        const combo = realizableCombos(this.state).find((c) => c.recipeIndex === recipeIndex && !!c.isSameTierMerge === isSameTierMerge);
        if (combo && executeCombo(this.state, combo, resultTileTowerId)) SFX.comboMade();
        document.getElementById('tower-menu')?.remove();
      } : undefined,
    });
  }

  /** Route a tile click: hero placement > tower inspect > prospect reveal. */
  handleTileClick(col: number, row: number): void {
    if (this.state.phase === GamePhase.GAME_OVER || this.state.phase === GamePhase.VICTORY) return;
    const tile = (this.state as any).tiles[row]?.[col];
    if (tile === TileType.TOWER) { this.inspectAt(col, row); return; }
    if (this.pendingHero) { this.placeHeroAt(col, row); return; }
    if (this.state.phase === GamePhase.PROSPECT_PLACEMENT && tile === TileType.EMPTY) this.placeProspectAt(col, row);
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
      // Full single-player per-frame parity: surprise events, boss scripts,
      // enemy auras, hero abilities, fire-ground DoT, boss hazards.
      tickSurpriseEvents(this.state);
      tickBossScripts(this.state, dt, this.bossRuntime, this.waveStartTick);
      applyEnemyAuras(this.state);
      tickHeroAbilities(this.state, this.heroHooks);
      tickBurnPatches(this.state, dt);
      tickBossHazards(this.state, dt);
      tickEnemies(
        this.state, dt,
        (e) => {                                   // reached Rome → shared life pool
          this.state.lives = Math.max(0, this.state.lives - (e.livesCost ?? 1));
          if (this.state.lives <= 0) this.state.phase = GamePhase.GAME_OVER;
        },
        (e) => {                                   // death blood + ring + SFX + boss bookkeeping
          emitBoardDeathFx(this.fx as any, this.state, this.gore, e);
          if (e.isBoss) handleBossDeath(this.state, e, this.bossRuntime);
        },
      );
      tickCombat(this.state, dt, this.combatHooks);
      tickProjectiles(this.state, dt, this.projHooks);
      tickGore(this.gore, dt);
      checkWaveEnd(this.state, (gold) => {
        earnGold(this.state, Math.max(0, gold));
        SFX.waveSurvived();
        fadeCorpsesAtWaveEnd(this.gore, this.state.tick);
        if (this.state.wave >= WAVE.TOTAL) { this.state.phase = GamePhase.VICTORY; return; }
        this.rollProspects();                        // open the next build round
      });
    }
    pruneCorpses(this.gore, this.state.tick);
  }

  private frame(): void {
    setAuraTilesOverride(this.auraTiles);    // active board owns the aura tiles (race-proof per-frame re-assert)
    let adv = DT;
    if (!this.paused && this.state.phase !== GamePhase.GAME_OVER && this.state.phase !== GamePhase.VICTORY) {
      const steps = Math.max(1, this.speedMult | 0);
      for (let s = 0; s < steps; s++) this.step(DT);
      adv = DT * steps;
    }
    renderCircleEntities(this.entityLayer, this.state, this.geo, TILE, { selectedTowerId: this.selectedTowerId, hover: this.hover });
    this.fx.update(adv);              // advance slash/muzzle/ring/shake
    this.fx.renderGore(this.gore);    // blood + corpses + floating damage numbers
    // Combo-available chime (0 -> >=1) during build — base parity.
    const cc = realizableComboCount(this.state);
    if (this._lastCombo === 0 && cc > 0) SFX.comboAvailable();
    this._lastCombo = cc;
    this.app.render();
    this.onHud?.(this);
  }
}

/** Lay the 6 aura tiles on path-adjacent grass tiles, spread around the spiral. */
function buildCircleAuraTiles(geo: CircleMapGeometry): AuraTile[] {
  const KINDS: AuraTile['kind'][] = ['PURPLE', 'BLUE', 'RED', 'CYAN', 'GOLD', 'EMERALD'];
  const adj = geo.buildTiles.filter((t) =>
    geo.isPath(t.col + 1, t.row) || geo.isPath(t.col - 1, t.row) || geo.isPath(t.col, t.row + 1) || geo.isPath(t.col, t.row - 1));
  if (adj.length < KINDS.length) return [];
  return KINDS.map((kind, i) => {
    const t = adj[Math.floor(((i + 0.5) / KINDS.length) * adj.length)];
    return { col: t.col, row: t.row, kind };
  });
}
