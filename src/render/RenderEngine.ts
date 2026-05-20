import { Application, Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import { GRID, TIER_COLORS, FACTION_WEATHER, WAVE_MODIFIERS, WORLD, AURA_TILES, AURA_TILE_EFFECTS } from '../constants';
import { TileType, GamePhase, TowerType, DamageType } from '../types';
import { GameStateShape } from '../GameState';
import { GoreState } from '../systems/GoreSystem';
import { towerEffectiveStats } from '../systems/TowerSystem';
import { tex } from './Assets';
import waypointsData from '../data/waypoints.json';
import enemiesData from '../data/enemies.json';
// 2026-05-19 — Hero sprite tinting reads off towers.json `tint` field.
import towersData from '../data/towers.json';
import { surpriseEventTintRGBA, VFX_TIMING, getAllActiveSurpriseEvents } from '../systems/SurpriseEvents';
import { SurpriseEventKind } from '../types';

export class RenderEngine {
  app: Application;
  layers: {
    bg: Container;
    tiles: Container;
    waypoints: Container;
    overlay: Container;     // range circles, hover preview
    enemies: Container;
    towers: Container;
    fx: Container;
    hud: Container;
  };
  bgGfx: Graphics;
  stainGfx: Graphics;
  bloodGfx: Graphics;
  projGfx: Graphics;
  overlayGfx: Graphics;
  rangeGfx: Graphics;
  comboGfx: Graphics;
  auraGfx: Graphics;
  tierPipGfx: Graphics;
  // 2026-05 v9: dedicated Graphics for the druid sleep-dart trail
  // ribbons + orb glows. Cleared and redrawn every frame in
  // drawDruidSleepDarts().
  druidDartGfx: Graphics;
  // 2026-05 v10: dust-shield dome rendered behind elephants + soft
  // shimmer over protected ground allies. Cleared each frame.
  elephantAuraGfx: Graphics;
  // 2026-05 v6 polish
  bossAuraGfx: Graphics;
  bossVignetteGfx: Graphics;
  // 2026-05-19 — Aura tile glow layer.
  auraTileGfx: Graphics;
  bossVignetteBaked = false;        // draw-once flag
  bossVignetteTargetAlpha = 0;      // 0 outside boss waves, ~0.18 during
  // Boss-death blood rain: each drop is a falling Sprite that lands and
  // sticks to the ground (alpha reduced, no further animation).
  private bloodRainDrops: { sp: Sprite; vy: number; targetY: number; rotSpeed: number; landed: boolean; bornTick: number }[] = [];
  private bloodRainLanded: Sprite[] = [];     // permanent landed stains for cleanup on game-over
  enemySprites: Map<string, {
    sp: Sprite;
    hp: Graphics;
    statusBar: Container;
    displayX: number;
    displayY: number;
    lastTick: number;
    knockX?: number;
    knockY?: number;
    knockTimer?: number;
    // Persistent wound overlay: cuts, blood drips that accumulate visibly
    // on the enemy as it takes damage.
    wounds?: Container;
    woundCount?: number;
    nextDripTick?: number;
    // (Removed 2026-05-17: stuckArrowsBin + stuckArrowsCount — embedded-
    // shaft overlay pulled for perf. See onProjectileHit handler in main.ts.)
    // 2026-05 v7 perf: pooled shield indicator. Created ONCE on first
    // render, repositioned + alpha-tweened each frame, destroyed only on
    // shield-break or enemy death. Was previously 3 fresh Pixi objects
    // (Graphics + Graphics + Sprite) per shielded enemy per frame —
    // ~3,240 allocations/sec on a packed W8 shield wave, the source of
    // the visible lag the player reported.
    shieldBin?: Container;
    shieldRing?: Graphics;
    shieldSprite?: Sprite;
  }>;
  towerSprites: Map<string, { sp: Sprite; tier: Sprite | null }>;
  selectedTowerId: string | null = null;
  // 2026-05 v11 (B3 Hover range): a second tower id whose range circle
  // renders in a dimmer color underneath the selected one. Driven by
  // canvas-mousemove + prospect-sidebar hover handlers in main.ts.
  hoveredTowerId: string | null = null;

  constructor() {
    this.app = new Application({
      width: GRID.CANVAS_W,
      height: GRID.CANVAS_H,
      // 2026-05-19 — Undead Map Overhaul. Was '#1f4422' forest green;
      // now deep cursed indigo so the off-canvas border around the
      // play area reads as "void / cursed land beyond the field."
      background: '#1a0e1a',
      antialias: false,
      resolution: 1,
      autoStart: false        // we drive render() manually so it works in hidden tabs
    });
    this.layers = {
      bg: new Container(),
      tiles: new Container(),
      waypoints: new Container(),
      overlay: new Container(),
      enemies: new Container(),
      towers: new Container(),
      fx: new Container(),
      hud: new Container()
    };
    this.app.stage.addChild(this.layers.bg, this.layers.tiles, this.layers.waypoints,
      this.layers.overlay, this.layers.enemies, this.layers.towers, this.layers.fx, this.layers.hud);
    this.bgGfx = new Graphics();
    this.stainGfx = new Graphics();
    this.bloodGfx = new Graphics();
    this.projGfx = new Graphics();
    this.overlayGfx = new Graphics();
    this.rangeGfx = new Graphics();
    this.comboGfx = new Graphics();
    this.auraGfx = new Graphics();
    this.tierPipGfx = new Graphics();
    this.druidDartGfx = new Graphics();
    this.layers.fx.addChild(this.druidDartGfx);   // above projectiles, with the rest of fx
    // 2026-05 v10: dedicated Graphics for the war-elephant dust shield
    // dome + protected-ally shimmer. Sits BELOW enemies on the overlay
    // layer so the dome reads behind the units it's protecting.
    this.elephantAuraGfx = new Graphics();
    this.layers.overlay.addChild(this.elephantAuraGfx);
    // 2026-05 v6: shared Graphics for the boss low-HP red pulse aura.
    // Sits in the overlay layer below the enemy sprite so the ring
    // appears behind the boss but above the terrain. Cleared each frame.
    this.bossAuraGfx = new Graphics();
    // 2026-05 v6: boss-fight vignette overlay. Single fullscreen Graphics
    // drawn once on boss-wave start, alpha-tweened in, dropped on wave end.
    this.bossVignetteGfx = new Graphics();
    this.bossVignetteGfx.alpha = 0;
    this.layers.bg.addChild(this.bgGfx);
    this.layers.bg.addChild(this.stainGfx);   // stains live above grass, below corpses/towers
    // 2026-05-19 — Aura tile overlay. Cleared and redrawn each frame
    // for the pulse animation. Sits on the bg layer above stains but
    // below corpses/towers so the glow reads as ground-level magic.
    this.auraTileGfx = new Graphics();
    this.layers.bg.addChild(this.auraTileGfx);
    this.layers.fx.addChild(this.bloodGfx);
    this.layers.fx.addChild(this.projGfx);
    this.layers.overlay.addChild(this.auraGfx, this.comboGfx, this.overlayGfx, this.rangeGfx);
    this.layers.overlay.addChild(this.bossAuraGfx);     // below enemies (overlay < enemies)
    this.layers.hud.addChild(this.bossVignetteGfx);     // above everything except UI
    this.layers.towers.addChild(this.tierPipGfx);
    this.enemySprites = new Map();
    this.towerSprites = new Map();
  }

  // Lazy text-pool for floating damage numbers and status icons
  private numberPool: Text[] = [];
  private numberPoolIdx = 0;
  private getNumberText(): Text {
    if (this.numberPoolIdx < this.numberPool.length) return this.numberPool[this.numberPoolIdx++];
    // Style fill is white at creation so we can color the pool entries
    // via `.tint` each frame (cheap GPU op) instead of re-baking the text
    // texture by mutating .style.fill (expensive CPU + GPU upload).
    const t = new Text('0', new TextStyle({ fontFamily: 'Courier New', fontSize: 12, fontWeight: 'bold', fill: 0xffffff, stroke: 0x000000, strokeThickness: 3 }));
    t.anchor.set(0.5);
    this.layers.fx.addChild(t);
    this.numberPool.push(t);
    this.numberPoolIdx++;
    return t;
  }

  drawGore(gore: GoreState, tick: number) {
    // Stains accumulate. Redraw entire stain layer (cheap because cap=200).
    this.stainGfx.clear();
    for (const s of gore.stains) {
      const sz = 6 + s.intensity * 4;
      const alpha = 0.55 + s.intensity * 0.05;
      this.stainGfx.beginFill(0x4a0a08, alpha).drawCircle(s.x, s.y, sz).endFill();
      this.stainGfx.beginFill(0x6a0e0e, alpha * 0.6).drawCircle(s.x + sz * 0.3, s.y - sz * 0.2, sz * 0.5).endFill();
    }
    // Blood particles each frame
    this.bloodGfx.clear();
    for (const p of gore.particles) {
      const a = Math.max(0, Math.min(1, p.life / 0.5));
      const color = (p as any).color ?? 0xb01818;
      this.bloodGfx.beginFill(color, 0.85 * a).drawCircle(p.x, p.y, p.size).endFill();
    }
    // Corpses (drawn as a tinted dark blob — sprite-free for perf, recognizable)
    for (const c of gore.corpses) {
      const fade = c.fadeStartTick < 0 ? 1 : Math.max(0, 1 - (tick - c.fadeStartTick) / 3);
      const sz = c.isBoss ? 20 : 10;
      this.bloodGfx.beginFill(0x2a1a0a, 0.55 * fade).drawEllipse(c.x, c.y + 2, sz, sz * 0.5).endFill();
      this.bloodGfx.beginFill(0x6a0e0e, 0.4 * fade).drawCircle(c.x, c.y, sz * 0.7).endFill();
    }
    // Floating damage numbers — readability per Vision §4.2
    // PERF (2026-05): pool text objects keep their style.fill = white and
    // we color via `.tint` instead of mutating .style.fill, which used to
    // force a full texture rebake every frame for every visible number.
    // Tint is GPU-cheap and the result reads identically.
    this.numberPoolIdx = 0;
    for (const n of gore.numbers) {
      const t = this.getNumberText();
      if (t.text !== n.text) t.text = n.text;     // only touch when changed
      t.x = n.x;
      t.y = n.y;
      t.alpha = Math.min(1, n.life / 0.4);
      t.tint = n.color;
      // 2026-05 v11 (B8): crit numbers render at 1.3× scale so they pop
      // visually without dominating the screen. Normal hits stay at 1.0.
      // Anchor is top-left by default; the slight left-bias of larger
      // crits is acceptable — gold tint + scale + shake mark the crit.
      t.scale.set(n.isCrit ? 1.3 : 1.0);
      t.visible = true;
    }
    // Hide unused pool entries
    for (let i = this.numberPoolIdx; i < this.numberPool.length; i++) this.numberPool[i].visible = false;
  }

  // Per-frame ambient motion: drifting cave mist + flickering glow halos.
  // Cheap (just modulates Graphics each frame), keeps the world feeling alive (Visual §3.1, §8.1, §8.2, §8.5).
  private ambientGfx?: Graphics;
  private grassWindGfx?: Graphics;
  // 2026-05-19 — Undead Map Overhaul. Persistent container of
  // animated atmosphere sprites (crystals / graves / thorns) at
  // fixed map positions. Built once on first drawAmbient(); each
  // subsequent call just updates alpha + scale + rotation on the
  // existing sprites via a tick-driven sine. Cheap — ≤12 sprites.
  private undeadAnimContainer?: Container;
  private undeadAnimSprites: Array<{
    sp: Sprite;
    kind: 'crystal' | 'grave' | 'thorn';
    phase: number;       // per-sprite phase offset so they don't pulse in lockstep
  }> = [];
  // 2026-05-19 — Phase 2: hand-placed large feature decorations.
  // Built once on first drawAmbient() call; the 8 anchored sprites
  // are static (no per-frame updates). Sprite-only — no Graphics
  // alpha/scale tween like the undeadAnimSprites above.
  private undeadFeatureContainer?: Container;
  drawAmbient(tick: number, wave: number = 0, isBossWave: boolean = false) {
    if (!this.ambientGfx) {
      this.ambientGfx = new Graphics();
      this.layers.fx.addChildAt(this.ambientGfx, 0);
    }
    if (!this.grassWindGfx) {
      // Grass wind sits above bg but below towers, so it doesn't obscure paths/units.
      this.grassWindGfx = new Graphics();
      this.layers.bg.addChild(this.grassWindGfx);
    }
    const a = this.ambientGfx;
    const g = this.grassWindGfx;
    a.clear();
    g.clear();

    // GRASS WIND TUFTS — sparse animated grass tufts drift in a sine wave (§8.1)
    // Performance: only render on a 2-tile-spaced subgrid + skip path/border/etc tiles.
    for (let r = 2; r < GRID.ROWS - 2; r += 2) {
      for (let c = 2; c < GRID.COLS - 2; c += 2) {
        const sway = Math.sin(tick * 1.4 + c * 0.31 + r * 0.17) * 1.6;
        const x = c * GRID.TILE + 12 + sway;
        const y = r * GRID.TILE + 18;
        // Only draw on grass tiles (skip path / waypoint / border)
        const tile = (this as any).__lastTileRef?.[r]?.[c] ?? 0;
        if (tile !== 0) continue;
        g.beginFill(0x4f8a3a, 0.55).drawRect(x, y, 1.5, 4).endFill();
        g.beginFill(0x6cab5a, 0.35).drawRect(x + 2, y + 1, 1.5, 3).endFill();
      }
    }

    // WAVE PROGRESSION TINT (§13) — subtle darkening + warm tone as waves progress.
    // 0 → wave 0 (lush green). 0.5 → mid (trampled). 1 → late (war-torn).
    const progress = Math.min(1, wave / 40);
    if (progress > 0.05) {
      // Darken with brown overlay
      a.beginFill(0x4a2a14, 0.04 + progress * 0.10).drawRect(0, 0, GRID.CANVAS_W, GRID.CANVAS_H).endFill();
      if (progress > 0.5) {
        // Late waves get a faint crimson cast
        a.beginFill(0x6a1010, 0.05 + (progress - 0.5) * 0.10).drawRect(0, 0, GRID.CANVAS_W, GRID.CANVAS_H).endFill();
      }
    }

    // EDGE FOG DRIFT — wisps along the map borders (§8.2)
    // Subtle, never covers gameplay center.
    for (let i = 0; i < 6; i++) {
      const t = tick * 0.3 + i * 1.7;
      const fy = 24 + Math.sin(t) * 8 + i * 4;
      const fx = 80 + (i * 130 + tick * 18) % (GRID.CANVAS_W - 100);
      a.beginFill(0xd0d8e8, 0.06 + 0.03 * Math.sin(t)).drawEllipse(fx, fy, 36, 12).endFill();
      a.beginFill(0xd0d8e8, 0.05 + 0.03 * Math.sin(t * 1.2)).drawEllipse(fx, GRID.CANVAS_H - 24 - fy * 0.3, 32, 10).endFill();
    }

    // CAVE MIST — three slow-drifting purple wisps near the spawn
    const caveCx = waypointsData.spawn.col * GRID.TILE + GRID.TILE / 2;
    const caveCy = waypointsData.spawn.row * GRID.TILE + GRID.TILE / 2;
    for (let i = 0; i < 3; i++) {
      const t = tick * 0.4 + i * 2.1;
      const wx = caveCx + Math.cos(t * 0.7) * 38 + i * 6;
      const wy = caveCy + Math.sin(t * 0.5) * 22 - 12 - i * 6;
      const r = 18 + Math.sin(t) * 4;
      a.beginFill(0x6b3aa0, 0.06 + 0.04 * Math.sin(t * 1.2)).drawCircle(wx, wy, r).endFill();
    }
    const flick = 0.45 + 0.25 * Math.sin(tick * 14) + 0.15 * Math.sin(tick * 23.4);
    a.beginFill(0xffa838, 0.10 * flick).drawCircle(caveCx - 28, caveCy + 4, 10).endFill();
    a.beginFill(0xffa838, 0.10 * flick).drawCircle(caveCx + 28, caveCy + 4, 10).endFill();

    // GATE HEARTH FLICKER
    const gateCx = waypointsData.gate.col * GRID.TILE + GRID.TILE / 2;
    const gateCy = waypointsData.gate.row * GRID.TILE + GRID.TILE / 2;
    const gFlick = 0.5 + 0.25 * Math.sin(tick * 4.3);
    a.beginFill(0xd4af37, 0.12 * gFlick).drawCircle(gateCx, gateCy, 24).endFill();

    // PULSING WAYPOINT RUNES (§8.5)
    // Each checkpoint gets a sin-driven halo. Intensifies on boss waves.
    const wpData = (window as any).__wpData ?? null;
    if (wpData) {
      const intensity = isBossWave ? 0.9 : 0.55;
      for (let i = 0; i < wpData.waypoints.length; i++) {
        const wp = wpData.waypoints[i];
        const cx = wp.topLeft.col * GRID.TILE + GRID.TILE / 2;
        const cy = wp.topLeft.row * GRID.TILE + GRID.TILE / 2;
        const phase = tick * 1.6 + i * 1.05;
        const pulse = 0.5 + 0.5 * Math.sin(phase);
        a.beginFill(0xffd34d, 0.08 * intensity * pulse).drawCircle(cx, cy, 24 + pulse * 6).endFill();
        a.beginFill(0xffd34d, 0.18 * intensity * pulse).drawCircle(cx, cy, 14 + pulse * 3).endFill();
        if (isBossWave) {
          // crimson danger ring
          a.lineStyle(1, 0xee2a2a, 0.4 * pulse).drawCircle(cx, cy, 22 + pulse * 4);
          a.lineStyle(0);
        }
      }
    }

    // 2026-05-19 — Undead Map Overhaul. Animated atmosphere props
    // (pulsing crystals near cave + gate, swaying thorns + flickering
    // graves at the edges). Lazy-built on first call, then per-frame
    // we just nudge alpha + scale + rotation on each sprite. No
    // Pixi allocations per frame; 10 sprites total fits well under
    // the ≤12 cap from the plan. Sprites are anchored at center.
    if (!this.undeadAnimContainer) {
      this.undeadAnimContainer = new Container();
      this.layers.bg.addChild(this.undeadAnimContainer);
      // Hand-picked positions — kept off the path corridor and
      // away from the central play zone so the animations frame
      // the map without competing with tower placement decisions.
      // Cave corner crystals (top-left) — purple-tinged glow.
      // Gate corner crystals (bottom-right) — gold-tinged glow.
      // Thorns + graves scatter along the top + bottom + left edges.
      const placements: Array<{ c: number; r: number; kind: 'crystal' | 'grave' | 'thorn'; phase: number }> = [
        // Cave corner — glowing crystals frame the spawn pit
        { c: 1,  r: 2,  kind: 'crystal', phase: 0.0  },
        { c: 5,  r: 7,  kind: 'crystal', phase: 1.7  },
        // Gate corner — pulsing crystals frame Rome's last bastion
        { c: 36, r: 19, kind: 'crystal', phase: 3.1  },
        { c: 32, r: 24, kind: 'crystal', phase: 4.4  },
        // Top edge — thorny silhouettes sway in cursed wind
        { c: 12, r: 1,  kind: 'thorn',   phase: 0.5  },
        { c: 22, r: 2,  kind: 'thorn',   phase: 2.0  },
        // Bottom-left — flickering graves
        { c: 3,  r: 22, kind: 'grave',   phase: 0.9  },
        { c: 8,  r: 24, kind: 'grave',   phase: 2.7  },
        // Right edge mid — final two pieces
        { c: 36, r: 12, kind: 'thorn',   phase: 1.2  },
        { c: 1,  r: 14, kind: 'grave',   phase: 3.8  },
      ];
      for (const p of placements) {
        const key = p.kind === 'crystal' ? 'UN_ANIM_CRYSTAL'
                  : p.kind === 'grave'   ? 'UN_ANIM_GRAVE'
                  :                        'UN_ANIM_THORN';
        const t0 = tex(key);
        if (!t0) continue;
        const sp = new Sprite(t0);
        sp.anchor.set(0.5);
        sp.x = p.c * GRID.TILE + GRID.TILE / 2;
        sp.y = p.r * GRID.TILE + GRID.TILE / 2;
        // Slightly larger than a regular prop so the animation reads
        // from across the map without dominating the tile.
        const baseSz = p.kind === 'crystal' ? GRID.TILE * 0.85 : GRID.TILE * 0.75;
        sp.width = baseSz; sp.height = baseSz;
        this.undeadAnimContainer.addChild(sp);
        this.undeadAnimSprites.push({ sp, kind: p.kind, phase: p.phase });
      }
    }
    // Per-frame update — sin-driven alpha / scale / rotation tween.
    // Different frequencies per kind so the map doesn't pulse in
    // lockstep (would look mechanical).
    for (const a of this.undeadAnimSprites) {
      const t = tick + a.phase;
      if (a.kind === 'crystal') {
        // 0.5 Hz alpha pulse + light scale breathing
        const s = Math.sin(t * Math.PI);            // -1..1, ~0.5Hz
        a.sp.alpha = 0.65 + 0.30 * (0.5 + 0.5 * s); // 0.65..0.95
        a.sp.scale.x = a.sp.scale.y = 1.0 + 0.08 * s;
      } else if (a.kind === 'grave') {
        // 0.8 Hz alpha flicker — fire-like instability with two
        // overlapping sines so it doesn't read as a simple pulse.
        const s = Math.sin(t * 1.6 * Math.PI) * 0.6 + Math.sin(t * 4.1) * 0.4;
        a.sp.alpha = 0.75 + 0.20 * (0.5 + 0.5 * s); // 0.75..0.95
      } else {
        // Thorn — slow rotation tween, no alpha change.
        a.sp.rotation = Math.sin(t * 1.2) * 0.06;   // ±~3.4°
      }
    }

    // 2026-05-19 — Phase 2: hand-placed feature decorations
    // (large illustrated ruins + SPQR banners). Lazy-built ONCE on
    // first call. Each entry specifies its anchor tile + scale.
    // Sprite-only — no per-frame updates. Z-order: added to bg
    // layer AFTER undeadAnimContainer, so feature pieces sit
    // visually on top of the scatter decor + animated props but
    // still below the tiles/towers/enemies layers.
    if (!this.undeadFeatureContainer) {
      this.undeadFeatureContainer = new Container();
      this.layers.bg.addChild(this.undeadFeatureContainer);
      // Anchored placements per the Phase 2 plan. Each entry sets:
      //   • c, r            — anchor tile (sprite center lands here)
      //   • key             — MANIFEST key
      //   • scale           — multiplied against GRID.TILE for output sprite size
      //   • anchorY         — vertical anchor (0=top, 0.5=center, 1=bottom).
      //                       Tall pieces use 1.0 so they "stand" on
      //                       their anchor tile and rise upward, more
      //                       like in-world geometry than top-down decor.
      const anchors: Array<{ c: number; r: number; key: string; scale: number; anchorY: number }> = [
        // 1. SPQR LAUREL-SKULL STANDARD — hero piece, just inside the gate corner
        { c: 33, r: 22, key: 'UN_FEAT_SPQR_STANDARD',   scale: 2.0, anchorY: 1.0 },
        // 2. SPQR EAGLE BANNER — flanking the gate from above
        { c: 36, r: 19, key: 'UN_FEAT_SPQR_EAGLE',      scale: 1.7, anchorY: 1.0 },
        // 3. SPQR SKULL BANNER — lower-gate flank, mirror anchor
        { c: 30, r: 24, key: 'UN_FEAT_SPQR_SKULL',      scale: 1.7, anchorY: 1.0 },
        // 4. BROKEN COLUMN + GHOST FIRE — cave-corner ruin
        { c: 1,  r: 6,  key: 'UN_FEAT_COLUMN_FIRE',     scale: 1.8, anchorY: 1.0 },
        // 5. STATUE RUIN — left edge mid, fallen Roman effigy
        { c: 2,  r: 11, key: 'UN_FEAT_STATUE_RUIN',     scale: 1.6, anchorY: 1.0 },
        // 6. BIG COLUMN RUIN — top-middle background, replaces the
        //    failed altar pick
        { c: 18, r: 1,  key: 'UN_FEAT_COLUMN_BIG',      scale: 1.8, anchorY: 1.0 },
        // 7. BANNER-ON-PEDESTAL — right edge upper, mirrors the
        //    cave-corner column across the map
        { c: 36, r: 8,  key: 'UN_FEAT_BANNER_PEDESTAL', scale: 1.7, anchorY: 1.0 },
        // 8. RUINED DOORWAY — bottom-middle, sealed portal at the back
        { c: 18, r: 25, key: 'UN_FEAT_DOORWAY',         scale: 1.7, anchorY: 1.0 },
      ];
      for (const f of anchors) {
        const t0 = tex(f.key);
        if (!t0) continue;
        const sp = new Sprite(t0);
        // anchorY=1.0 means the sprite's bottom edge lands on the
        // anchor tile center. Horizontal centered (0.5).
        sp.anchor.set(0.5, f.anchorY);
        sp.x = f.c * GRID.TILE + GRID.TILE / 2;
        sp.y = f.r * GRID.TILE + GRID.TILE / 2;
        // Scale uniformly so the sprite's larger dimension equals
        // scale × GRID.TILE. Native PNG aspect ratio is preserved.
        const target = GRID.TILE * f.scale;
        const longSide = Math.max(t0.width, t0.height);
        const k = longSide > 0 ? (target / longSide) : 1;
        sp.scale.set(k, k);
        this.undeadFeatureContainer.addChild(sp);
      }
    }
  }

  // Cache reference to current tiles array so grass wind can skip non-grass cells.
  setTileRef(tiles: number[][]) { (this as any).__lastTileRef = tiles; }

  // Combo emergence — animated rune circle + radiant burst at the result tile (§9.2)
  private comboFxGfx?: Graphics;
  drawComboFx(state: GameStateShape, tick: number) {
    if (!this.comboFxGfx) {
      this.comboFxGfx = new Graphics();
      this.layers.fx.addChild(this.comboFxGfx);
    }
    const g = this.comboFxGfx;
    g.clear();
    const queue = (state as any).comboFxQueue as any[] | undefined;
    if (!queue) return;
    // Drop expired effects (>1.4 seconds)
    while (queue.length > 0 && tick - queue[0].bornTick > 1.4) queue.shift();
    for (const fx of queue) {
      const t = (tick - fx.bornTick) / 1.4; // 0..1 progress
      const color = fx.resultTier >= 5 ? 0xff5555 : fx.resultTier >= 4 ? 0xffd34d : 0xc0c0c0;
      // Expanding rune ring
      const r = 8 + t * 60;
      const alpha = (1 - t) * 0.85;
      g.lineStyle(3, color, alpha).drawCircle(fx.x, fx.y, r);
      g.lineStyle(2, 0xffffff, alpha * 0.8).drawCircle(fx.x, fx.y, r * 0.6);
      // Radial spokes
      const spokes = 6;
      for (let i = 0; i < spokes; i++) {
        const ang = (i / spokes) * Math.PI * 2 + tick * 4;
        const r1 = 6 + t * 28;
        const r2 = r;
        const x1 = fx.x + Math.cos(ang) * r1, y1 = fx.y + Math.sin(ang) * r1;
        const x2 = fx.x + Math.cos(ang) * r2, y2 = fx.y + Math.sin(ang) * r2;
        g.lineStyle(2, color, alpha * 0.7).moveTo(x1, y1).lineTo(x2, y2);
      }
      // Center flare
      g.lineStyle(0);
      g.beginFill(color, alpha).drawCircle(fx.x, fx.y, 4 * (1 - t)).endFill();
      g.beginFill(0xffffff, alpha * 0.85).drawCircle(fx.x, fx.y, 2 * (1 - t)).endFill();
    }
  }

  // 2026-05-19 v2 — AURA BUFF TILES (5 fixed positions). Each frame the
  // tile pulses its colored ring; when a tower sits on top, the
  // glow brightens + rotating spokes appear to signal the buff is live.
  // Visual stack (drawn back-to-front so the strongest layers land on
  // top):
  //   1. OUTER HALO — large, fuzzy radial glow extending past the tile
  //      edge so the tile reads as "magic ground" from a few tiles away.
  //   2. INNER HALO — smaller denser radial.
  //   3. TILE FILL — saturated translucent color wash inside the tile
  //      rect (0.28 baseline, +0.10 with pulse).
  //   4. SOLID BORDER — 1.5px tile outline at 0.95 alpha so the tile
  //      always reads as special even when the pulse hits its trough.
  //   5. INNER RING — main pulsing accent ring + white contrast ring.
  //   6. OCCUPIED EXTRAS — secondary outer ring + 4 rotating spokes when
  //      a tower is sitting on the tile (buff is live).
  //   7. CORNER ACCENTS — 4 bigger dots with white hotspots so the tile
  //      reads as anchored to the grid square.
  //   8. CENTER PIP — small pulsing dot at the tile center.
  // Tooltips are implemented in main.ts via hit-test on hover; the
  // renderer just paints the visual cue.
  drawAuraTiles(_state: GameStateShape, tick: number): void {
    const gfx = this.auraTileGfx;
    gfx.clear();
    const towerTilesOccupied = new Set<string>();
    for (const t of _state.towers.values()) {
      if (t.pending) continue;
      towerTilesOccupied.add(`${t.tileX},${t.tileY}`);
    }
    for (const a of AURA_TILES) {
      const eff = AURA_TILE_EFFECTS[a.kind];
      const x0 = a.col * GRID.TILE;
      const y0 = a.row * GRID.TILE;
      const cx = x0 + GRID.TILE / 2;
      const cy = y0 + GRID.TILE / 2;
      const occupied = towerTilesOccupied.has(`${a.col},${a.row}`);
      // Slow 0.9 Hz pulse so the eye picks the tile up without it
      // becoming visually noisy.
      const pulse = 0.5 + 0.5 * Math.sin(tick * 1.8 + a.col * 0.3 + a.row * 0.27);

      // ── 1. OUTER HALO (large soft glow, bleeds past tile edge) ──
      gfx.beginFill(eff.color, 0.08 + 0.05 * pulse);
      gfx.drawCircle(cx, cy, GRID.TILE * 0.85 + pulse * 6);
      gfx.endFill();

      // ── 2. INNER HALO (denser, smaller) ──
      gfx.beginFill(eff.color, 0.14 + 0.06 * pulse);
      gfx.drawCircle(cx, cy, GRID.TILE * 0.62 + pulse * 4);
      gfx.endFill();

      // ── 3. TILE FILL (saturated color wash — 2.3× stronger than before) ──
      gfx.beginFill(eff.color, 0.28 + 0.10 * pulse);
      gfx.drawRect(x0, y0, GRID.TILE, GRID.TILE);
      gfx.endFill();

      // ── 4. SOLID BORDER (always visible — won't fade with pulse) ──
      gfx.lineStyle(1.5, eff.color, 0.95);
      gfx.drawRect(x0 + 0.75, y0 + 0.75, GRID.TILE - 1.5, GRID.TILE - 1.5);

      // ── 5. INNER RING (main pulsing accent — 1.5× stronger alpha) ──
      const ringR = GRID.TILE * 0.40 + pulse * 2.5;
      gfx.lineStyle(2.5, eff.color, 0.75 + 0.20 * pulse);
      gfx.drawCircle(cx, cy, ringR);
      // White contrast ring just inside so the colored ring "pops"
      gfx.lineStyle(1.5, 0xffffff, 0.18 + 0.12 * pulse);
      gfx.drawCircle(cx, cy, ringR - 2);

      // ── 6. OCCUPIED EXTRAS (buff-is-live indicator) ──
      if (occupied) {
        // Secondary brighter ring outside the main one
        gfx.lineStyle(2, eff.color, 0.70 + 0.20 * pulse);
        gfx.drawCircle(cx, cy, GRID.TILE * 0.55 + pulse * 3);
        // 4 rotating spokes (slow clockwise drift — signals "active power")
        gfx.lineStyle(2, eff.color, 0.65);
        const spokeR0 = GRID.TILE * 0.58 + pulse * 2;
        const spokeR1 = spokeR0 + 4;
        const ang0 = (tick * 0.025) % (Math.PI * 2);
        for (let i = 0; i < 4; i++) {
          const a1 = ang0 + i * (Math.PI / 2);
          const cosA = Math.cos(a1); const sinA = Math.sin(a1);
          gfx.moveTo(cx + cosA * spokeR0, cy + sinA * spokeR0);
          gfx.lineTo(cx + cosA * spokeR1, cy + sinA * spokeR1);
        }
      }

      // ── 7. CORNER ACCENTS (bigger dots, white hotspots) ──
      const dotR = 2.5;
      gfx.beginFill(eff.color, 0.90);
      gfx.drawCircle(x0 + 3, y0 + 3, dotR);
      gfx.drawCircle(x0 + GRID.TILE - 3, y0 + 3, dotR);
      gfx.drawCircle(x0 + 3, y0 + GRID.TILE - 3, dotR);
      gfx.drawCircle(x0 + GRID.TILE - 3, y0 + GRID.TILE - 3, dotR);
      gfx.endFill();
      // White hot-spot in each corner dot — sells the "glowing" look
      gfx.beginFill(0xffffff, 0.60);
      gfx.drawCircle(x0 + 3, y0 + 3, 0.9);
      gfx.drawCircle(x0 + GRID.TILE - 3, y0 + 3, 0.9);
      gfx.drawCircle(x0 + 3, y0 + GRID.TILE - 3, 0.9);
      gfx.drawCircle(x0 + GRID.TILE - 3, y0 + GRID.TILE - 3, 0.9);
      gfx.endFill();

      // ── 8. CENTER PIP (pulsing anchor dot) ──
      gfx.beginFill(eff.color, 0.70 + 0.20 * pulse);
      gfx.drawCircle(cx, cy, 2 + pulse * 0.6);
      gfx.endFill();
      gfx.beginFill(0xffffff, 0.35 + 0.20 * pulse);
      gfx.drawCircle(cx, cy, 1);
      gfx.endFill();
    }
  }

  // Checkpoint-heal pulse — green expanding ring + "+25%" plus-sign cross
  // drawn at the enemy's tile each time it heals on a waypoint. Effects
  // expire after 0.9s.
  private checkpointHealFxGfx?: Graphics;
  drawCheckpointHealFx(state: GameStateShape, tick: number) {
    if (!this.checkpointHealFxGfx) {
      this.checkpointHealFxGfx = new Graphics();
      this.layers.fx.addChild(this.checkpointHealFxGfx);
    }
    const g = this.checkpointHealFxGfx;
    g.clear();
    const queue = (state as any).checkpointHealFxQueue as any[] | undefined;
    if (!queue) return;
    while (queue.length > 0 && tick - queue[0].bornTick > 0.9) queue.shift();
    for (const fx of queue) {
      const t = (tick - fx.bornTick) / 0.9;
      const alpha = (1 - t) * 0.95;
      const r = 6 + t * 22;
      // Outer ring + inner glow in healing green
      g.lineStyle(2.5, 0x66ff88, alpha).drawCircle(fx.x, fx.y - 14, r);
      g.lineStyle(1.5, 0xbbffcc, alpha * 0.7).drawCircle(fx.x, fx.y - 14, r * 0.55);
      // Rising plus-sign cross, lifts upward with t
      const cy = fx.y - 14 - t * 14;
      const armLen = 5 + (1 - t) * 3;
      g.lineStyle(3, 0x66ff88, alpha);
      g.moveTo(fx.x - armLen, cy).lineTo(fx.x + armLen, cy);
      g.moveTo(fx.x, cy - armLen).lineTo(fx.x, cy + armLen);
      g.lineStyle(1.5, 0xffffff, alpha * 0.85);
      g.moveTo(fx.x - armLen * 0.55, cy).lineTo(fx.x + armLen * 0.55, cy);
      g.moveTo(fx.x, cy - armLen * 0.55).lineTo(fx.x, cy + armLen * 0.55);
    }
  }

  // Reanimation portal — purple/green swirling vortex with rising bones
  // pillar. Plays at every death tile on necromancy waves, exactly the
  // 1.2-second window during which the risen enemy is locked in place.
  // The runtime queues entries via `state.reanimationFxQueue`.
  private reanimationFxGfx?: Graphics;
  drawReanimationFx(state: GameStateShape, tick: number) {
    if (!this.reanimationFxGfx) {
      this.reanimationFxGfx = new Graphics();
      this.layers.fx.addChild(this.reanimationFxGfx);
    }
    const g = this.reanimationFxGfx;
    g.clear();
    const queue = (state as any).reanimationFxQueue as any[] | undefined;
    if (!queue) return;
    while (queue.length > 0 && tick - queue[0].bornTick > (queue[0].riseDuration ?? 1.2) + 0.4) queue.shift();
    for (const fx of queue) {
      const dur = fx.riseDuration ?? 1.2;
      const t = Math.min(1, (tick - fx.bornTick) / dur); // 0..1
      const fade = t < 0.85 ? 1 : 1 - (t - 0.85) / 0.15;
      // SPRITE-TYPE COLOR: skeleton = bone white, zombie = sickly green,
      // lich = vivid emerald. Falls back to purple for unknown spawns.
      const COLOR_BY_SPAWN: Record<string, number> = {
        REANIMATED_SKELETON: 0xddccaa,
        REANIMATED_ZOMBIE: 0x88dd66,
        REANIMATED_LICH: 0x44ff88
      };
      const mainColor = COLOR_BY_SPAWN[fx.spawnType] ?? 0xaa55ff;
      const outerR = 14 + t * 12;
      // Ground portal — two swirling rings spinning opposite directions
      const a1 = tick * 6;
      const a2 = -tick * 9;
      for (let i = 0; i < 8; i++) {
        const ang = a1 + (i / 8) * Math.PI * 2;
        const r = outerR + Math.sin(tick * 8 + i) * 2.5;
        const px = fx.x + Math.cos(ang) * r;
        const py = fx.y + Math.sin(ang) * r * 0.4;     // flatten — ground portal
        g.beginFill(0x6633aa, 0.6 * fade).drawCircle(px, py, 2.2).endFill();
        g.beginFill(mainColor, 0.7 * fade).drawCircle(px, py - 1, 1.3).endFill();
      }
      // Inner sigil ring
      g.lineStyle(2, mainColor, 0.85 * fade);
      g.drawEllipse(fx.x, fx.y, outerR * 0.85, outerR * 0.35);
      g.lineStyle(1.5, 0xffffff, 0.55 * fade);
      g.drawEllipse(fx.x, fx.y, outerR * 0.55, outerR * 0.22);
      // Rising bones pillar — vertical column of upward-streaming flecks
      const pillarH = outerR * 1.6;
      for (let i = 0; i < 10; i++) {
        const py = fx.y - (i / 10) * pillarH * t;
        const px = fx.x + Math.sin((tick * 4) + i * 0.7) * 4;
        const alpha = (1 - i / 10) * 0.85 * fade;
        g.beginFill(mainColor, alpha).drawRect(px - 1, py - 1, 2, 2).endFill();
        g.beginFill(0xffffff, alpha * 0.5).drawRect(px - 0.5, py - 0.5, 1, 1).endFill();
      }
      // Secondary radial spokes — divine-summon flair, eases out
      const spokeAlpha = (1 - t) * 0.6;
      g.lineStyle(1.5, 0xeeccff, spokeAlpha);
      for (let i = 0; i < 5; i++) {
        const ang = a2 + (i / 5) * Math.PI * 2;
        const r0 = outerR * 0.4;
        const r1 = outerR + 6;
        g.moveTo(fx.x + Math.cos(ang) * r0, fx.y + Math.sin(ang) * r0 * 0.4);
        g.lineTo(fx.x + Math.cos(ang) * r1, fx.y + Math.sin(ang) * r1 * 0.4);
      }
    }
  }

  // JUPITER'S WRATH chain-lightning arcs — jagged white-blue bolts drawn
  // between each chain segment, plus a brief impact pulse at the strike
  // points. Each entry lives ~0.35s. The runtime queues entries from
  // CombatResolver every time the chain procs.
  private chainLightningFxGfx?: Graphics;
  drawChainLightningFx(state: GameStateShape, tick: number) {
    if (!this.chainLightningFxGfx) {
      this.chainLightningFxGfx = new Graphics();
      this.layers.fx.addChild(this.chainLightningFxGfx);
    }
    const g = this.chainLightningFxGfx;
    g.clear();
    const queue = (state as any).chainLightningFxQueue as any[] | undefined;
    if (!queue) return;
    while (queue.length > 0 && tick - queue[0].bornTick > 0.35) queue.shift();
    for (const fx of queue) {
      const age = tick - fx.bornTick;
      const t = age / 0.35;                  // 0..1
      const alpha = 1 - t;
      // Build a jagged poly-line between (x1,y1) and (x2,y2) with random
      // perpendicular jitter at each segment so the bolt reads as
      // electric, not a flat ruler line. Deterministic from bornTick so
      // every frame within the lifespan renders the same path.
      const dx = fx.x2 - fx.x1;
      const dy = fx.y2 - fx.y1;
      const len = Math.max(1, Math.hypot(dx, dy));
      const nx = -dy / len, ny = dx / len;   // perpendicular unit
      const segments = 7;
      const seed = (fx.bornTick * 7919) | 0;
      const rand = (i: number) => {
        const x = Math.sin(seed + i * 13.37) * 43758.5453;
        return x - Math.floor(x);
      };
      const pts: { x: number; y: number }[] = [];
      pts.push({ x: fx.x1, y: fx.y1 });
      for (let i = 1; i < segments; i++) {
        const u = i / segments;
        const jx = fx.x1 + dx * u;
        const jy = fx.y1 + dy * u;
        const offset = (rand(i) - 0.5) * 14;
        pts.push({ x: jx + nx * offset, y: jy + ny * offset });
      }
      pts.push({ x: fx.x2, y: fx.y2 });
      // Outer glow bolt
      g.lineStyle(5, 0x66aaff, alpha * 0.45);
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      // Mid layer
      g.lineStyle(2.5, 0xaaccff, alpha * 0.85);
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      // Hot white core
      g.lineStyle(1.2, 0xffffff, alpha);
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
      // Impact rings at both endpoints
      g.lineStyle(0);
      const r = 6 + (1 - alpha) * 8;
      g.beginFill(0xffffff, alpha * 0.55).drawCircle(fx.x1, fx.y1, r * 0.5).endFill();
      g.beginFill(0xaaccff, alpha * 0.85).drawCircle(fx.x2, fx.y2, r * 0.7).endFill();
      g.beginFill(0xffffff, alpha).drawCircle(fx.x2, fx.y2, r * 0.35).endFill();
    }
  }

  // Persistent boss HP bar (Boss Doc §4.4 / §7) — stays at top of canvas while any boss enemy is alive
  private bossBarGfx?: Graphics;
  private bossBarText?: Text;
  // BOSS LOW-HP PULSE AURA (2026-05 v6 polish):
  // For every live boss under 25% HP, draw a soft red ring around them
  // that pulses with the boss HP-bar tempo (sin at ~3Hz). Shared
  // Graphics, cleared each frame, no per-boss allocations. Multiple
  // bosses on screen (twin/ambush boss waves) all share the gfx.
  //
  // 2026-05-17 v2 — Removed the always-on passive red halo that used
  // to wrap every boss at full health. The persistent glow was visual
  // noise; bosses already announce themselves via the top-of-screen
  // HP bar + the boss-arrival banner. Only the LOW-HP URGENCY RING
  // remains — kicks in below 25% HP to signal the kill window. Bosses
  // at full / mid HP now render exactly like other enemies (no halo).
  drawBossLowHpAura(state: GameStateShape) {
    const g = this.bossAuraGfx;
    g.clear();
    for (const e of state.enemies.values()) {
      if (!e.isBoss) continue;
      if (e.hp <= 0) continue;
      const ratio = e.hp / e.maxHp;
      // ONLY render when the boss is below 25% HP. No passive glow.
      if (ratio >= 0.25) continue;
      const dangerT = 1 - (ratio / 0.25);     // 0 at 25%, 1 at death
      const pulse = 0.5 + 0.5 * Math.sin(state.tick * 3 * Math.PI);
      const baseR = GRID.TILE * 1.6;
      const r = baseR * (1 + 0.10 * pulse + 0.06 * dangerT);
      const alpha = (0.25 + 0.35 * pulse) * (0.6 + 0.4 * dangerT);
      g.beginFill(0xff2222, alpha * 0.18);
      g.drawCircle(e.x, e.y, r * 1.18);
      g.endFill();
      g.lineStyle(3 + dangerT * 2, 0xff3030, alpha);
      g.drawCircle(e.x, e.y, r);
      g.lineStyle(0);
    }
  }
  // BOSS-FIGHT VIGNETTE (2026-05 v6 polish):
  // Lazy-bake the corner vignette once, then fade alpha 0 ↔ target
  // depending on whether we're in a boss wave. Single Graphics, drawn
  // exactly once, alpha-tweened per frame (free). Target alpha is set
  // by setBossWaveActive() from main on wave start / wave end.
  drawBossVignette(_state: GameStateShape, dt: number) {
    if (!this.bossVignetteBaked) {
      const g = this.bossVignetteGfx;
      g.clear();
      const W = GRID.CANVAS_W;
      const H = GRID.CANVAS_H;
      const band = 110;
      // Subtle red-shifted dark corners. Heavier than the existing static
      // bg vignette in drawStatic but still under 20% alpha at peak.
      g.beginFill(0x18020a, 0.55).drawRect(0, 0, W, band).endFill();
      g.beginFill(0x18020a, 0.55).drawRect(0, H - band, W, band).endFill();
      g.beginFill(0x18020a, 0.45).drawRect(0, 0, band, H).endFill();
      g.beginFill(0x18020a, 0.45).drawRect(W - band, 0, band, H).endFill();
      // Inner gradient feathering via stacked thinner bands. Keeps the
      // overlay GPU-cheap (no shader, no mask) while still reading as
      // a soft falloff instead of a hard edge.
      for (let i = 0; i < 6; i++) {
        const a = 0.10 - i * 0.014;
        if (a <= 0) break;
        g.beginFill(0x18020a, a).drawRect(0, band + i * 8, W, 8).endFill();
        g.beginFill(0x18020a, a).drawRect(0, H - band - (i + 1) * 8, W, 8).endFill();
        g.beginFill(0x18020a, a * 0.7).drawRect(band + i * 8, 0, 8, H).endFill();
        g.beginFill(0x18020a, a * 0.7).drawRect(W - band - (i + 1) * 8, 0, 8, H).endFill();
      }
      this.bossVignetteBaked = true;
    }
    // Tween alpha toward target. ~0.35s fade in/out feels natural.
    const target = this.bossVignetteTargetAlpha;
    const cur = this.bossVignetteGfx.alpha;
    const step = Math.min(Math.abs(target - cur), dt * 2.8);
    this.bossVignetteGfx.alpha = cur + Math.sign(target - cur) * step;
  }
  // Called by main.ts on wave start / wave end to drive the vignette tween.
  setBossWaveActive(active: boolean) {
    this.bossVignetteTargetAlpha = active ? 0.32 : 0;
  }
  drawBossBar(state: GameStateShape) {
    if (!this.bossBarGfx) {
      this.bossBarGfx = new Graphics();
      this.bossBarText = new Text('', new TextStyle({ fontFamily: 'Courier New', fontSize: 11, fontWeight: 'bold', fill: 0xffd34d, stroke: 0x000000, strokeThickness: 2, letterSpacing: 2 }));
      this.bossBarText.anchor.set(0.5, 0);
      this.layers.hud.addChild(this.bossBarGfx);
      this.layers.hud.addChild(this.bossBarText);
    }
    const g = this.bossBarGfx;
    const t = this.bossBarText!;
    g.clear();
    // Iterate-and-break instead of Array.from(...).find — saves the per-frame
    // array allocation when this is called every frame.
    let boss: any = null;
    for (const e of state.enemies.values()) {
      if (e.isBoss) { boss = e; break; }
    }
    if (!boss) { t.visible = false; return; }
    // Bar positioned at the BOTTOM of the play area so it doesn't compete
    // with the wave-banner stack at the top. Sits ~10px above the canvas
    // bottom edge with the label *above* the bar (so the bar reads as the
    // "floor" of the field).
    // 2026-05-17 — moved UP from y = CANVAS_H - 14 - 14 to leave clearance
    // for the world-zoom crop. Bar now sits ~52px above the bottom edge so
    // the zoomed viewport never clips the label or the bar body.
    const w = 360, h = 14;
    const x = (GRID.CANVAS_W - w) / 2;
    const y = GRID.CANVAS_H - h - 52;
    const frac = Math.max(0, boss.hp / boss.maxHp);
    // Outer frame
    g.beginFill(0x000000, 0.65).drawRect(x - 4, y - 4, w + 8, h + 8).endFill();
    g.lineStyle(2, 0xffd34d, 1).drawRect(x - 4, y - 4, w + 8, h + 8);
    g.lineStyle(0);
    // Inner track
    g.beginFill(0x1a0a08).drawRect(x, y, w, h).endFill();
    // Fill (red gradient simulated with two stops)
    const fillW = w * frac;
    g.beginFill(0xaa1010).drawRect(x, y, fillW, h).endFill();
    g.beginFill(0xee5555, 0.55).drawRect(x, y, fillW, h * 0.45).endFill();
    // Tick marks at 25/50/75%
    g.lineStyle(1, 0x000000, 0.5);
    for (const f of [0.25, 0.5, 0.75]) {
      g.moveTo(x + w * f, y + 2).lineTo(x + w * f, y + h - 2);
    }
    g.lineStyle(0);
    // Label
    const enDef: any = (window as any).__enemiesData?.[boss.type];
    const name = enDef?.name ?? boss.type;
    t.text = `⚔ ${name.toUpperCase()} — ${Math.ceil(boss.hp).toLocaleString()} / ${Math.ceil(boss.maxHp).toLocaleString()} HP`;
    t.x = GRID.CANVAS_W / 2;
    t.y = y - 12;       // label ABOVE bar (bar is at bottom of canvas now)
    t.visible = true;
  }

  // Per-projectile sprite pool. Renders the actual PROJ_* sprite with rotation,
  // plus a procedural trail behind it for motion clarity.
  private projSprites: Map<string, Sprite> = new Map();
  drawProjectiles(state: GameStateShape) {
    this.projGfx.clear();
    const seen = new Set<string>();
    for (const p of state.projectiles as any[]) {
      seen.add(p.id);
      // Trail color keyed by projectile family (so even sprite-less fallbacks read).
      const color = p.spriteKey === 'PROJ_BARREL' ? 0xff8a22
        : p.spriteKey === 'PROJ_STAFF' ? 0xffd34d
        : p.spriteKey === 'PROJ_BALLISTA' ? 0xa07050
        : p.spriteKey === 'PROJ_JAVELIN' ? 0xddc888
        : p.spriteKey === 'PROJ_PILUM' ? 0xeeddaa
        : p.spriteKey === 'PROJ_HASTA' ? 0xc8a868
        : p.spriteKey === 'PROJ_ARROW' ? 0xddccaa
        : p.spriteKey === 'PROJ_POISON_CLOUD' ? 0x44dd44       // sickly green
        : 0xc8c8c8;
      // 2026-05 v10 — VISUAL DAMAGE-CLASS DIFFERENTIATION
      //
      // Splash projectiles: faint outer ring sweeping the splash radius
      //   so the player sees "this projectile has AoE" before impact.
      //   Drawn under the sprite at low alpha + a pulsing radius.
      //
      // Divine projectiles (damageType === DIVINE): gold radiant halo
      //   with rotating sun-ray spikes. Stamps "this is divine" on every
      //   divine cast regardless of which sprite the tower uses. Stacks
      //   with the splash ring for divine-splash combos (Flamen, Legate,
      //   Solar Priest, Augur, Haruspex, Pontifex Maximus, Imperium
      //   Eternum, Consular Fatebinder).
      const isDivine = p.damageType === DamageType.DIVINE;
      const splashR = (p.splash ?? 0);
      if (splashR > 0) {
        // Outer pulsing ring at the splash radius (scaled to tile-units).
        const px = (splashR * GRID.TILE);
        const pulse = 0.35 + 0.25 * Math.sin(state.tick * 6 + (p.id?.charCodeAt?.(2) ?? 0));
        this.projGfx.lineStyle(1.2, color, 0.45 * pulse);
        this.projGfx.drawCircle(p.x, p.y, px * 0.35);
        this.projGfx.lineStyle(0.8, color, 0.20 * pulse);
        this.projGfx.drawCircle(p.x, p.y, px * 0.55);
        this.projGfx.lineStyle(0);
      }
      if (isDivine) {
        // Gold halo + 4 rotating sun-ray spikes. Color is fixed gold so
        // every divine projectile shares the same identity regardless of
        // the underlying spriteKey/trail color.
        const halo = 0.55 + 0.30 * Math.sin(state.tick * 5);
        this.projGfx.beginFill(0xffe066, 0.16 * halo).drawCircle(p.x, p.y, 14).endFill();
        this.projGfx.beginFill(0xffd34d, 0.30 * halo).drawCircle(p.x, p.y, 9).endFill();
        // Four spikes rotating slowly around the orb.
        const rotBase = state.tick * 2.4;
        this.projGfx.lineStyle(1.8, 0xffe066, 0.85);
        for (let k = 0; k < 4; k++) {
          const a = rotBase + (k / 4) * Math.PI * 2;
          const r1 = 6;
          const r2 = 13;
          this.projGfx.moveTo(p.x + Math.cos(a) * r1, p.y + Math.sin(a) * r1);
          this.projGfx.lineTo(p.x + Math.cos(a) * r2, p.y + Math.sin(a) * r2);
        }
        this.projGfx.lineStyle(0);
      }
      // Trail: 3 fading shadow segments behind the projectile
      const len = 12;
      for (let s = 1; s <= 3; s++) {
        const tx = p.x - Math.cos(p.rotation) * (len * s * 0.7);
        const ty = p.y - Math.sin(p.rotation) * (len * s * 0.7);
        const alpha = (4 - s) / 8;
        // Divine projectiles get a brighter gold trail dot on top of the
        // family-keyed dot for unmistakable identity.
        const trailColor = isDivine ? 0xffe066 : color;
        this.projGfx.beginFill(trailColor, alpha).drawCircle(tx, ty, isDivine ? 2.0 : 1.6).endFill();
      }
      // Real sprite (rotated to flight direction)
      let sp = this.projSprites.get(p.id);
      const t = tex(p.spriteKey);
      if (t) {
        if (!sp) {
          sp = new Sprite(t);
          sp.anchor.set(0.5);
          // PROJ_BARREL is the bulkiest; siege bolts and javelins are slimmer.
          // PROJ_POISON_CLOUD is the s_poison status sprite repurposed —
          // tint it green so it reads as a flask of toxin in flight rather
          // than the orange status badge.
          const big = p.spriteKey === 'PROJ_BARREL';
          const isPoisonCloud = p.spriteKey === 'PROJ_POISON_CLOUD';
          sp.width = big ? 22 : isPoisonCloud ? 20 : 18;
          sp.height = big ? 22 : isPoisonCloud ? 20 : 18;
          if (isPoisonCloud) sp.tint = 0x66dd44;
          this.layers.fx.addChild(sp);
          this.projSprites.set(p.id, sp);
        }
        sp.x = p.x;
        sp.y = p.y;
        sp.rotation = p.rotation;
      } else {
        // Fallback: thin line + tip dot (only if texture missing).
        const dx = Math.cos(p.rotation) * len;
        const dy = Math.sin(p.rotation) * len;
        this.projGfx.lineStyle(2, color, 1).moveTo(p.x - dx * 0.5, p.y - dy * 0.5).lineTo(p.x + dx * 0.5, p.y + dy * 0.5);
        this.projGfx.lineStyle(0);
        this.projGfx.beginFill(color).drawCircle(p.x + dx * 0.5, p.y + dy * 0.5, 2).endFill();
      }
    }
    // Drop sprites for projectiles that have impacted/expired.
    for (const [id, sp] of this.projSprites) {
      if (!seen.has(id)) {
        sp.destroy();
        this.projSprites.delete(id);
      }
    }
  }

  // ─── DRUID SLEEP DARTS (2026-05 v9) ────────────────────────────────────
  // Druids cast a slow orb at a target tower; on hit, that tower sleeps
  // for 3s. Each in-flight dart renders as a pulsing cyan/purple orb
  // trailing soft halos so the player can read the cast and rush the
  // druid before the dart lands. Lives on the fx layer using the
  // procedural sleep-orb graphics — no sprite texture required.
  drawDruidSleepDarts(state: GameStateShape) {
    this.druidDartGfx.clear();
    const darts: any[] = (state as any).__druidSleepDarts ?? [];
    for (const d of darts) {
      // Two-tone halo: outer dim purple, inner cyan core. Color depends
      // on the casting faction so undead druids read different from the
      // living celts.
      const outer = d.faction === 'undead' ? 0x55ffaa : 0xaa88ff;
      const inner = d.faction === 'undead' ? 0xccffee : 0xddeeff;
      const pulse = 0.7 + Math.sin(state.tick * 8 + (d.bornTick ?? 0) * 13) * 0.3;
      // Trailing wisps to suggest motion + magic.
      for (let s = 1; s <= 3; s++) {
        const tx = d.x - d.vx * 0.04 * s;
        const ty = d.y - d.vy * 0.04 * s;
        this.druidDartGfx.beginFill(outer, (4 - s) / 16).drawCircle(tx, ty, 4 - s).endFill();
      }
      // Glow / orb body.
      this.druidDartGfx.beginFill(outer, 0.25 * pulse).drawCircle(d.x, d.y, 10).endFill();
      this.druidDartGfx.beginFill(outer, 0.55 * pulse).drawCircle(d.x, d.y, 6).endFill();
      this.druidDartGfx.beginFill(inner, 0.95).drawCircle(d.x, d.y, 3).endFill();
      // Tiny "Z" mark drifting beside the orb so its purpose is unmistakable.
      const zo = Math.sin(state.tick * 4 + (d.bornTick ?? 0) * 3) * 2;
      this.druidDartGfx.lineStyle(1.5, inner, 0.9);
      this.druidDartGfx.moveTo(d.x + 4, d.y - 5 + zo).lineTo(d.x + 8, d.y - 5 + zo);
      this.druidDartGfx.lineTo(d.x + 4, d.y - 1 + zo).lineTo(d.x + 8, d.y - 1 + zo);
      this.druidDartGfx.lineStyle(0);
    }
  }

  // ─── ELEPHANT DUST-SHIELD AURA (2026-05 v10) ────────────────────────
  // Each living war elephant emits a ranged-protection dome around it.
  // Render it as a layered dusty-brown circle with a slow rotating arc
  // overlay, plus a tiny shimmer on every enemy currently protected by
  // it — so the player can read at a glance "these guys are immune to
  // ranged until the elephant dies".
  drawElephantAura(state: GameStateShape) {
    this.elephantAuraGfx.clear();
    // 2026-05-17 — Re-validate sources against state.enemies every frame
    // so a stale __elephantAuraSources (e.g. left over from a tick where
    // tickEnemies didn't run) can't draw a ghost aura. Walk state.enemies
    // directly for the canonical list of live war/undead elephants. If
    // none are alive, gfx stays cleared and we bail.
    const liveElephants: Array<{ x: number; y: number; r: number; isUndead: boolean }> = [];
    const ELEPHANT_TYPES = new Set(['WAR_ELEPHANT', 'UNDEAD_WAR_ELEPHANT']);
    for (const e of state.enemies.values()) {
      if (!ELEPHANT_TYPES.has(e.type)) continue;
      if (e.hp <= 0) continue;
      liveElephants.push({
        x: e.x,
        y: e.y,
        r: GRID.TILE * 2.0,
        isUndead: e.type === 'UNDEAD_WAR_ELEPHANT'
      });
    }
    if (liveElephants.length === 0) return;
    const sources = liveElephants;
    for (const src of sources) {
      // Two-tone dome: outer thin brown ring + inner dust haze.
      const dustOuter = src.isUndead ? 0x88aa99 : 0xc09060;
      const dustInner = src.isUndead ? 0x668877 : 0xa07a4a;
      const pulse = 0.55 + Math.sin(state.tick * 2.4 + src.x * 0.03) * 0.20;
      // Soft dusty body (fills the protected zone with a low-alpha disc).
      this.elephantAuraGfx.beginFill(dustInner, 0.12 * pulse).drawCircle(src.x, src.y, src.r).endFill();
      this.elephantAuraGfx.beginFill(dustOuter, 0.20 * pulse).drawCircle(src.x, src.y, src.r * 0.82).endFill();
      // Outer ring boundary — 2 dashed-feel arcs (drawn as two arc strokes
      // 180° apart, rotating in opposite directions for a swirling effect).
      const t = state.tick;
      const halfArc = 0.55 * Math.PI;
      this.elephantAuraGfx.lineStyle(2, dustOuter, 0.75);
      this.elephantAuraGfx.arc(src.x, src.y, src.r, t * 0.6, t * 0.6 + halfArc);
      this.elephantAuraGfx.lineStyle(1.5, dustInner, 0.55);
      this.elephantAuraGfx.arc(src.x, src.y, src.r * 0.92, Math.PI - t * 0.7, Math.PI - t * 0.7 + halfArc);
      this.elephantAuraGfx.lineStyle(0);
      // A handful of swirling dust mote dots inside the dome — fixed-
      // count loop (deterministic offsets) so the cost is bounded
      // regardless of how many elephants are alive.
      for (let i = 0; i < 6; i++) {
        const ang = t * 1.2 + (i / 6) * Math.PI * 2;
        const rad = (src.r * 0.55) * (0.6 + 0.35 * Math.sin(t * 1.5 + i * 1.7));
        const mx = src.x + Math.cos(ang) * rad;
        const my = src.y + Math.sin(ang) * rad * 0.7;     // squashed = perspective dome
        this.elephantAuraGfx.beginFill(dustOuter, 0.55).drawCircle(mx, my, 2).endFill();
      }
    }
    // Sparkle a small "PROTECTED" badge on every enemy currently
    // shielded. Reads on the enemy itself so the player can see which
    // units the aura is covering. Keep it cheap — single arc + dot.
    const pulse2 = 0.65 + Math.sin(state.tick * 5) * 0.30;
    for (const e of state.enemies.values()) {
      if (!((e as any).__rangedProtected)) continue;
      this.elephantAuraGfx.lineStyle(1.5, 0xffe6aa, 0.7 * pulse2);
      this.elephantAuraGfx.arc(e.x, e.y - 14, 4, 0, Math.PI * 2);
      this.elephantAuraGfx.lineStyle(0);
      this.elephantAuraGfx.beginFill(0xffe6aa, 0.6 * pulse2).drawCircle(e.x, e.y - 14, 1.5).endFill();
    }
  }

  // Melee slash VFX: short-lived rotated sprite at the impact point. Uses the
  // PROJ_SLASH sword-slash asset so melee swings have a real visual punch.
  // Heavy-melee swings (size > 1) also drop an expanding white impact ring on
  // the ground for extra weight.
  private slashes: { sp: Sprite; born: number; life: number; size: number }[] = [];
  private impactRings: { x: number; y: number; born: number; life: number; maxR: number; color: number }[] = [];
  triggerMeleeSlash(x: number, y: number, angle: number, tick: number, size = 1, cleaver = false) {
    const t = tex('PROJ_SLASH');
    if (t) {
      const sp = new Sprite(t);
      sp.anchor.set(0.5);
      sp.x = x; sp.y = y;
      sp.rotation = angle;
      // 2026-05-18 — Slash VFX restored to be visible/satisfying again.
      // The v11 perf trim went too far — slashes were barely on-screen
      // (0.16s life, 18px) and felt invisible during combat. New tuning
      // is a middle ground between the original (30px / 0.22s / 0.95α)
      // and the perf-trimmed (18px / 0.16s / 0.85α). Still cheaper to
      // render than the original but the player can actually SEE the
      // melee swing.
      //   • Base size  18 → 26  (44% bigger footprint per slash)
      //   • Life       0.16 → 0.22  (37% longer on screen)
      //   • Alpha      0.85 → 0.92  (more punch, still avoids pure-white pile)
      //   • Heavy mult bumped in main.ts caller (1.3 → 1.5)
      //
      // 2026-05 v10 — CLEAVER VISUAL: cleave-capable towers (Hastati,
      // Triarius, Cohort Guard, Praetorian Wall, Imperator Guard,
      // Vexillation, Triumphator, Triplex Acies, or anyone carrying
      // FALX_BLADE) get a WIDER primary slash + a SECOND echo slash at
      // a slightly offset angle. The two-slash arc reads as a sweeping
      // cleave swing even when only one target is in range, so the
      // player can identify a cleaver at a glance.
      const widthMult = cleaver ? 1.4 : 1.0;
      const baseW = 26 * size * widthMult;
      sp.width = baseW; sp.height = baseW;
      sp.alpha = 0.92;
      this.layers.fx.addChild(sp);
      this.slashes.push({ sp, born: tick, life: 0.22, size: baseW });
      if (cleaver) {
        // Echo slash — narrower, slightly offset angle, shorter life so it
        // reads as a trailing follow-through rather than two distinct hits.
        const echo = new Sprite(t);
        echo.anchor.set(0.5);
        echo.x = x; echo.y = y;
        echo.rotation = angle + 0.35;     // ~20° offset
        echo.width = baseW * 0.85;
        echo.height = baseW * 0.85;
        echo.alpha = 0.65;
        this.layers.fx.addChild(echo);
        this.slashes.push({ sp: echo, born: tick, life: 0.18, size: baseW * 0.85 });
      }
    }
    // Heavy hits get a ground impact shockwave ring + dust. Threshold
    // dropped to 1.25 so the trimmed-down heavy multiplier (1.3) still
    // triggers the ring; radius pulled back to 0.4 × tile to match the
    // smaller slash footprint. Cleavers also drop a faint arc-trace ring
    // even at light size so the visual marker is consistent.
    if (size >= 1.25) {
      this.impactRings.push({ x, y, born: tick, life: 0.26, maxR: GRID.TILE * 0.4 * size, color: 0xffffff });
    } else if (cleaver) {
      // Soft tan arc ring on every cleave swing (smaller than heavy-hit
      // ring) so even a light cleaver leaves a visible AoE trace.
      this.impactRings.push({ x, y, born: tick, life: 0.20, maxR: GRID.TILE * 0.35, color: 0xeed8a0 });
    }
  }
  // Generic ranged "muzzle flash" at the tower's firing tip, plus a brief recoil.
  // Color keyed to damage flavor so divine hits look different from siege.
  private muzzleFlashes: { x: number; y: number; born: number; life: number; color: number }[] = [];
  triggerMuzzleFlash(x: number, y: number, color: number, tick: number) {
    // 2026-05-18 — life 0.14 → 0.22 so the tip flash is actually
    // perceivable when ranged towers fire. Still short enough that
    // rapid-fire units (Velites, Eques, Pugio) don't get a continuous
    // glow at the firing tip.
    this.muzzleFlashes.push({ x, y, born: tick, life: 0.22, color });
  }
  // Generic ground ring (used by heavy melee + boss death).
  triggerImpactRing(x: number, y: number, tick: number, maxR = 24, color = 0xffffff) {
    this.impactRings.push({ x, y, born: tick, life: 0.32, maxR, color });
  }
  // Telegraph rings — used to warn the player before a boss mechanic fires.
  // Unlike impact rings (which expand outward from impact), these SHRINK
  // toward the target over the duration so the player can read the
  // countdown and time burst damage on the windup.
  private telegraphRings: { x: number; y: number; born: number; life: number; maxR: number; color: number }[] = [];
  triggerTelegraphRing(x: number, y: number, tick: number, duration = 1.0, maxR = 64, color = 0xff2222) {
    this.telegraphRings.push({ x, y, born: tick, life: duration, maxR, color });
  }
  // BOSS-DEATH BLOOD RAIN (2026-05 v6 polish):
  // When a boss falls, spawn N falling blood Sprites scattered across the
  // map. Each drop accelerates downward, rotates slowly, then "lands" at
  // its target Y — at which point it becomes a permanent stain on the
  // ground. Uses the four existing v_blood_*.png stain sprites; we tint
  // randomly across them for visual variety. Visceral payoff that reads
  // immediately on every boss kill without affecting any combat path.
  triggerBloodRain(tick: number, dropCount = 110, intensity = 1.0) {
    const stainTextures = ['BLOOD_LIGHT', 'BLOOD_MEDIUM', 'BLOOD_HEAVY', 'BLOOD_SATURATED'];
    for (let i = 0; i < dropCount; i++) {
      const key = stainTextures[Math.floor(Math.random() * stainTextures.length)];
      const t = tex(key);
      if (!t) continue;
      const sp = new Sprite(t);
      sp.anchor.set(0.5);
      const sz = (10 + Math.random() * 16) * intensity;
      sp.width = sz; sp.height = sz;
      // Spawn ABOVE the canvas top so the rain reads as falling INTO the
      // play area from offscreen. Scatter X across the full grid width.
      sp.x = Math.random() * GRID.CANVAS_W;
      sp.y = -20 - Math.random() * 220;       // staggered offscreen so drops land over ~1.2s
      sp.alpha = 0.92;
      sp.rotation = Math.random() * Math.PI * 2;
      // Random tint nudge — slight maroon variation to break up uniformity.
      const tintRoll = Math.random();
      sp.tint = tintRoll < 0.33 ? 0xaa1818 : tintRoll < 0.66 ? 0xc62828 : 0x880000;
      // Land at a random Y BELOW the cave area but ABOVE the gate so
      // drops settle on the play field, not on UI margins.
      const targetY = 40 + Math.random() * (GRID.CANVAS_H - 80);
      const vy = 280 + Math.random() * 180;
      const rotSpeed = (Math.random() - 0.5) * 4.0;
      this.layers.fx.addChild(sp);
      this.bloodRainDrops.push({ sp, vy, targetY, rotSpeed, landed: false, bornTick: tick });
    }
  }
  // Per-frame tick. Animates falling drops; on landing the drop FADES
  // OUT and destroys itself rather than persisting as a permanent
  // ground stain. The boss-death rain remains a celebration of the
  // moment without cluttering the map for the rest of the run.
  tickBloodRain(dt: number) {
    if (this.bloodRainDrops.length === 0) return;
    for (let i = this.bloodRainDrops.length - 1; i >= 0; i--) {
      const d = this.bloodRainDrops[i];
      if (d.landed) {
        // 2026-05 v6: fade landed drop and remove. Was previously a
        // permanent stain that accumulated across boss kills.
        d.sp.alpha = Math.max(0, d.sp.alpha - dt * 1.2);     // ~0.83s fadeout
        if (d.sp.alpha <= 0.01) {
          d.sp.destroy();
          this.bloodRainDrops.splice(i, 1);
        }
        continue;
      }
      d.sp.y += d.vy * dt;
      d.sp.rotation += d.rotSpeed * dt;
      d.vy += 380 * dt;       // gravity accelerates the fall
      if (d.sp.y >= d.targetY) {
        d.sp.y = d.targetY;
        d.sp.alpha = 0.55 + Math.random() * 0.20;     // brief stain before fade
        d.sp.rotation = Math.random() * Math.PI * 2;
        d.landed = true;
        // Skip stashing — the fade-and-destroy above handles cleanup.
      }
    }
  }
  // Kept as a no-op for backwards compatibility (was previously the
  // explicit reset hook for accumulated stains).
  clearBloodRainStains() {
    for (const sp of this.bloodRainLanded) sp.destroy();
    this.bloodRainLanded.length = 0;
  }
  drawMeleeSlashes(tick: number) {
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i];
      const age = tick - s.born;
      if (age >= s.life) {
        s.sp.destroy();
        this.slashes.splice(i, 1);
        continue;
      }
      const t = age / s.life;
      // 2026-05 v11 PERF: alpha 0.95 → 0.85, scale-during-life 1+t*0.45 →
      // 1+t*0.25, so the slash blooms less and overlapping slashes don't
      // amount to a heavy translucent band over the playfield.
      s.sp.alpha = 0.85 * (1 - t);
      const scale = 1 + t * 0.25;
      s.sp.width = s.size * scale;
      s.sp.height = s.size * scale;
      s.sp.rotation += 0.14;     // swing arc — slowed slightly to match shorter life
    }
    // Muzzle flashes — tiny bright burst at firing tip.
    if (!(this as any).muzzleGfx) {
      (this as any).muzzleGfx = new Graphics();
      this.layers.fx.addChild((this as any).muzzleGfx);
    }
    const mg = (this as any).muzzleGfx as Graphics;
    mg.clear();
    for (let i = this.muzzleFlashes.length - 1; i >= 0; i--) {
      const m = this.muzzleFlashes[i];
      const age = tick - m.born;
      if (age >= m.life) { this.muzzleFlashes.splice(i, 1); continue; }
      const t = age / m.life;
      const r = 8 * (1 + t * 0.6);
      const a = 0.95 * (1 - t);
      mg.beginFill(m.color, a).drawCircle(m.x, m.y, r).endFill();
      mg.beginFill(0xffffff, a * 0.8).drawCircle(m.x, m.y, r * 0.5).endFill();
      // 4-pointed star spikes for muzzle flash silhouette
      mg.lineStyle(2, m.color, a);
      const len = r * 1.8;
      mg.moveTo(m.x - len, m.y).lineTo(m.x + len, m.y);
      mg.moveTo(m.x, m.y - len).lineTo(m.x, m.y + len);
      mg.lineStyle(0);
    }
    // Impact rings expand + fade out
    for (let i = this.impactRings.length - 1; i >= 0; i--) {
      const ir = this.impactRings[i];
      const age = tick - ir.born;
      if (age >= ir.life) { this.impactRings.splice(i, 1); continue; }
      const t = age / ir.life;
      const r = ir.maxR * (0.3 + t * 0.7);
      const a = 0.85 * (1 - t);
      mg.lineStyle(3 * (1 - t * 0.5), ir.color, a);
      mg.drawCircle(ir.x, ir.y, r);
      // dust puff inside
      mg.beginFill(ir.color, a * 0.18).drawCircle(ir.x, ir.y, r * 0.5).endFill();
      mg.lineStyle(0);
    }
    // Telegraph rings SHRINK toward the target — opposite motion to
    // impact rings so the player reads them as "incoming windup" rather
    // than "something just landed". Used by boss mechanic warnings.
    // The ring also pulses 4x over the duration for added urgency.
    for (let i = this.telegraphRings.length - 1; i >= 0; i--) {
      const tr = this.telegraphRings[i];
      const age = tick - tr.born;
      if (age >= tr.life) { this.telegraphRings.splice(i, 1); continue; }
      const t = age / tr.life;                  // 0 → 1
      const r = tr.maxR * (1 - t * 0.85);       // shrinks from maxR to 0.15×maxR
      const pulse = 0.5 + 0.5 * Math.sin(age * Math.PI * 8);
      const a = (0.55 + 0.45 * pulse) * (1 - t * 0.4);
      // Outer thick warning ring
      mg.lineStyle(4 + 2 * (1 - t), tr.color, a);
      mg.drawCircle(tr.x, tr.y, r);
      // Inner thinner ring to read as a "shrinking target lock"
      mg.lineStyle(1.5, tr.color, a * 0.6);
      mg.drawCircle(tr.x, tr.y, r * 0.55);
      mg.lineStyle(0);
      // Crosshair marks at cardinal points so the player sees the lock-on
      const cl = r * 1.15;
      mg.lineStyle(2, tr.color, a * 0.8);
      mg.moveTo(tr.x - cl, tr.y).lineTo(tr.x - cl + 6, tr.y);
      mg.moveTo(tr.x + cl - 6, tr.y).lineTo(tr.x + cl, tr.y);
      mg.moveTo(tr.x, tr.y - cl).lineTo(tr.x, tr.y - cl + 6);
      mg.moveTo(tr.x, tr.y + cl - 6).lineTo(tr.x, tr.y + cl);
      mg.lineStyle(0);
    }
  }

  attachTo(parent: HTMLElement) {
    parent.appendChild(this.app.view as HTMLCanvasElement);
    (this.app.view as HTMLCanvasElement).style.imageRendering = 'pixelated';
    // 2026-05-17 — Apply world zoom + center offset. With the BORDER tree/
    // boulder perimeter no longer rendered, we reclaim that real estate by
    // zooming the play area in by ~1 tile-width per side. Stage is the
    // only Pixi root we transform; mouse handlers inverse-transform via
    // WORLD.OFFSET_X/Y + WORLD.ZOOM so clicks still land on the right tile.
    this.app.stage.scale.set(WORLD.ZOOM);
    this.app.stage.x = WORLD.OFFSET_X;
    this.app.stage.y = WORLD.OFFSET_Y;
  }

  // Screen shake (Animation Doc §10.5) — set by triggerShake, applied each frame to stage transform
  private shakeRemaining = 0;
  private shakeMagnitude = 0;
  triggerShake(magnitude: number, durationSec: number) {
    this.shakeMagnitude = Math.max(this.shakeMagnitude, magnitude);
    this.shakeRemaining = Math.max(this.shakeRemaining, durationSec);
  }

  // Gate impact flash (Animation Doc §22.2) — set when an enemy leaks, decays over 0.4s
  private gateImpactT = 0;
  triggerGateImpact() {
    this.gateImpactT = 0.4;
    this.triggerShake(2, 0.18);
  }

  // Cave spawn puff queue (Animation Doc §22.1)
  private spawnPuffs: Array<{ x: number; y: number; born: number }> = [];
  triggerSpawnPuff(x: number, y: number, tick: number) {
    this.spawnPuffs.push({ x, y, born: tick });
    if (this.spawnPuffs.length > 12) this.spawnPuffs.shift();
  }

  // Apply per-frame shake + gate impact decay. Call once per frame after all draws.
  // 2026-05-17 — Shake offsets are added to the world-zoom baseline (WORLD.OFFSET_X/Y)
  // instead of overwriting stage.x/y to 0. Without this the shake would yank the
  // camera back to (0, 0) every frame, undoing the zoom-in centering.
  applyShake(dt: number, tick: number) {
    if (this.shakeRemaining > 0) {
      this.shakeRemaining = Math.max(0, this.shakeRemaining - dt);
      const a = this.shakeRemaining / 0.18;
      this.app.stage.x = WORLD.OFFSET_X + (Math.random() - 0.5) * 2 * this.shakeMagnitude * a;
      this.app.stage.y = WORLD.OFFSET_Y + (Math.random() - 0.5) * 2 * this.shakeMagnitude * a;
      if (this.shakeRemaining <= 0) { this.app.stage.x = WORLD.OFFSET_X; this.app.stage.y = WORLD.OFFSET_Y; this.shakeMagnitude = 0; }
    }
    if (this.gateImpactT > 0) this.gateImpactT = Math.max(0, this.gateImpactT - dt);
    // Decay spawn puffs
    this.spawnPuffs = this.spawnPuffs.filter(p => tick - p.born < 0.5);
  }

  // Draw gate impact flash + spawn puffs into the ambient layer.
  drawImpactOverlays(tick: number) {
    if (!this.ambientGfx) return;
    const a = this.ambientGfx;
    // Gate red flash
    if (this.gateImpactT > 0) {
      const alpha = (this.gateImpactT / 0.4) * 0.55;
      const gateCx = waypointsData.gate.col * GRID.TILE + GRID.TILE / 2;
      const gateCy = waypointsData.gate.row * GRID.TILE + GRID.TILE / 2;
      a.beginFill(0xff2020, alpha).drawCircle(gateCx, gateCy, 56).endFill();
      a.lineStyle(2, 0xff5555, alpha).drawCircle(gateCx, gateCy, 70);
      a.lineStyle(0);
    }
    // Spawn puffs
    for (const puff of this.spawnPuffs) {
      const t = (tick - puff.born) / 0.5;
      const r = 8 + t * 20;
      const alpha = (1 - t) * 0.5;
      a.beginFill(0x6b3aa0, alpha * 0.4).drawCircle(puff.x, puff.y, r).endFill();
      a.beginFill(0xffffff, alpha * 0.3).drawCircle(puff.x, puff.y, r * 0.4).endFill();
    }
  }

  // Initial static draw: grass background, border decorations, waypoint coins.
  drawStatic(state: GameStateShape) {
    const g = this.bgGfx;
    g.clear();
    // TERRAIN-STABILITY FIX (2026-05 v6): dirt-vs-grass sprite decisions
    // now bake against the IMMUTABLE ghost path (pristine initial route),
    // NOT the live state.groundPath. Reason: state.groundPath reroutes
    // every time a tower or stone is placed, but drawStatic only re-runs
    // at game init + after combos. That meant the accumulated path drift
    // from a dozen tower placements would suddenly snap into view on the
    // first combo's drawStatic call — the "all of a sudden more brown
    // ground tiles" glitch. Pinning the dirt layout to the ghost path
    // keeps the terrain visually consistent for the entire run; the live
    // path's actual route is still shown by the brown ghost-stripe overlay
    // drawn below (lines ~812-836) and by enemy movement.
    const terrainPath: { col: number; row: number }[] = (state as any).ghostPath ?? state.groundPath;
    const pathSet = new Set<string>();
    for (const t of terrainPath) {
      const tt = state.tiles[t.row]?.[t.col];
      if (tt === TileType.EMPTY || tt === TileType.SPAWN) pathSet.add(`${t.col},${t.row}`);
    }
    // ─── REAL TILED TERRAIN ───────────────────────────────────────────
    // 2026-05-19 — UNDEAD NECROPOLIS map overhaul. Roman dp_* props
    // are RETAINED in the manifest because the gate-corner zone
    // (col >= 30, row >= 18) re-uses them as Roman war-camp remnants
    // — see the decoration block below. The base ground + path pools
    // swap to un_* keys (cursed cracked stone, bone-cobble path).
    // Each tile picks deterministically via the same hash so reload
    // looks identical run-to-run.
    const grassTiles = ['UN_GROUND_A', 'UN_GROUND_B', 'UN_GROUND_C', 'UN_GROUND_D'];
    const dirtTiles  = ['UN_PATH_A',   'UN_PATH_B',   'UN_PATH_C'];
    // Two prop pools — UNDEAD covers most of the map, ROMAN covers
    // the gate-corner war-camp zone. The decoration block selects
    // between them by (c, r) coordinates.
    const undeadProps = [
      'UN_PROP_BONES_S', 'UN_PROP_BONES_L', 'UN_PROP_THORN_A', 'UN_PROP_THORN_B',
      'UN_PROP_ROCK_A',  'UN_PROP_ROCK_B',  'UN_PROP_GRAVE_A', 'UN_PROP_GRAVE_B',
      'UN_PROP_SKULL_PILE', 'UN_PROP_RUIN',  'UN_PROP_DEAD_TREE',
      'UN_PROP_DEAD_TREE_B', 'UN_PROP_BROKEN_TREE', 'UN_PROP_DEAD_ARM'
    ];
    const romanProps  = ['DP_WOODEN_POST', 'DP_MILESTONE', 'DP_HELMET', 'DP_SCROLL', 'DP_URN'];
    // Weighted picks (cumulative % thresholds).
    const undeadWeights = [
      ['UN_PROP_BONES_S',      20],
      ['UN_PROP_BONES_L',      32],
      ['UN_PROP_THORN_A',      44],
      ['UN_PROP_THORN_B',      54],
      ['UN_PROP_ROCK_A',       64],
      ['UN_PROP_ROCK_B',       72],
      ['UN_PROP_GRAVE_A',      80],
      ['UN_PROP_GRAVE_B',      86],
      ['UN_PROP_SKULL_PILE',   91],
      ['UN_PROP_RUIN',         95],
      ['UN_PROP_DEAD_TREE',    97],   // big trees rare — feature placements
      ['UN_PROP_DEAD_TREE_B',  98],
      ['UN_PROP_BROKEN_TREE',  99],
      ['UN_PROP_DEAD_ARM',    100]
    ] as const;
    const romanWeights = [
      ['DP_WOODEN_POST',   22],
      ['DP_MILESTONE',     40],
      ['DP_HELMET',        58],
      ['DP_SCROLL',        73],
      ['DP_URN',           88],
      ['UN_PROP_BONES_S',  94],   // a few bones bleed through — curse creeping in
      ['UN_PROP_THORN_A', 100]
    ] as const;
    // Reference unused arrays so they're not flagged dead — they
    // remain accessible if a future tuning pass wants the unweighted
    // pool form.
    void undeadProps; void romanProps;
    // Cheap deterministic hash for tile picking — same coords always yield the same sprite.
    const hash = (c: number, r: number, salt = 0) => Math.abs(((c * 73856093) ^ (r * 19349663) ^ (salt * 83492791)) >>> 0);
    // Helper: roll a weighted pick from a cumulative-weight list.
    const pickWeighted = (table: readonly (readonly [string, number])[], h: number): string => {
      const roll = h % 100;
      for (const [key, threshold] of table) {
        if (roll < threshold) return key;
      }
      return table[table.length - 1][0];
    };

    // Fallback base wash — cursed indigo instead of forest green.
    g.beginFill(0x1a0e1a).drawRect(0, 0, GRID.CANVAS_W, GRID.CANVAS_H).endFill();

    // Clear old children but preserve bgGfx and stainGfx (first 2 children of bg layer)
    while (this.layers.bg.children.length > 2) {
      this.layers.bg.removeChildAt(this.layers.bg.children.length - 1);
    }
    const terrainLayer = new Container();
    const decorLayer = new Container();

    for (let r = 0; r < GRID.ROWS; r++) {
      for (let c = 0; c < GRID.COLS; c++) {
        const t = state.tiles[r][c];
        const x = c * GRID.TILE; const y = r * GRID.TILE;
        // 2026-05-17 — BORDER tiles now render as normal grass (no
        // perimeter tree/boulder ring). The world-zoom centers the play
        // area so the cropped border tiles fall outside the visible
        // viewport. Tiles still exist in state as TileType.BORDER (path
        // logic continues to treat them as unbuildable / unreachable),
        // they just look like grass underneath the cropped edge.
        const isPath = pathSet.has(`${c},${r}`);
        // Choose a tile sprite from the appropriate set
        const pool = isPath ? dirtTiles : grassTiles;
        // Path tiles slightly bias toward the basic dirt; grass slightly biases toward plain.
        const h = hash(c, r);
        let key: string;
        if (isPath) {
          // 60% main bone-cobble, 25% cracked-stone variant, 15% weathered
          const roll = h % 100;
          key = roll < 60 ? 'UN_PATH_A' : roll < 85 ? 'UN_PATH_B' : 'UN_PATH_C';
        } else {
          // 45% main cursed-ground, 30% darker slab, 15% mossy, 10% bone-dusted
          const roll = h % 100;
          key = roll < 45 ? 'UN_GROUND_A'
              : roll < 75 ? 'UN_GROUND_B'
              : roll < 90 ? 'UN_GROUND_C'
              :             'UN_GROUND_D';
        }
        const tex0 = tex(key);
        if (tex0) {
          const sp = new Sprite(tex0);
          sp.x = x; sp.y = y;
          sp.width = GRID.TILE; sp.height = GRID.TILE;
          terrainLayer.addChild(sp);
        } else {
          // Fallback to colored rect if texture missing (non-fatal).
          // Undead overhaul: cursed-stone gray for path, deep indigo for ground.
          const fill = isPath ? 0x4a4548 : 0x1a0e1a;
          g.beginFill(fill).drawRect(x, y, GRID.TILE, GRID.TILE).endFill();
        }
        // 2026-05-19 — Edge-weighted decoration placement, zone-aware
        // prop pool. Middle of the map stays sparse (~4%) so the
        // tower-placement grid reads clearly. Density ramps up as
        // tiles approach the perimeter / cave / gate corners — to
        // ~16% at the very edges (map-wide average lands ≈10%, the
        // "moderate bump" target). The gate corner (col >= 30,
        // row >= 18) rolls the Roman war-camp pool instead of the
        // undead pool so the area around Rome's gate reads as
        // "Roman last stand on cursed ground."
        const edgeDist = Math.min(c, GRID.COLS - 1 - c, r, GRID.ROWS - 1 - r);
        const edgeBoost = Math.max(0, 8 - edgeDist) / 8;  // 0..1 (1 at edges)
        const caveCorner = (c < 6 && r < 8);
        const gateCorner = (c >= 30 && r >= 18);
        const cornerBonus = (caveCorner || gateCorner) ? 4 : 0;
        const densityPct = Math.round(4 + edgeBoost * 14 + cornerBonus);
        if (!isPath && t === TileType.EMPTY && (h % 100) < densityPct) {
          const pickHash = hash(c, r, 31337);
          const propKey = gateCorner
            ? pickWeighted(romanWeights, pickHash)
            : pickWeighted(undeadWeights, pickHash);
          const propTex = tex(propKey);
          if (propTex) {
            const dp = new Sprite(propTex);
            dp.anchor.set(0.5);
            dp.x = x + GRID.TILE / 2;
            dp.y = y + GRID.TILE / 2;
            const sz = GRID.TILE * 0.65;
            dp.width = sz; dp.height = sz;
            dp.alpha = 0.95;
            decorLayer.addChild(dp);
          }
        }
      }
    }
    this.layers.bg.addChild(terrainLayer);
    this.layers.bg.addChild(decorLayer);

    // GHOST PATH — the immutable brown stripe showing the unblocked enemy
    // route. Drawn ABOVE the terrain layer (so it shows on top of grass)
    // but BELOW path-edge-shadows / decor / towers. Never changes during
    // the run — captured once at game start.
    const ghostPath: { col: number; row: number }[] | undefined = (state as any).ghostPath;
    if (ghostPath && ghostPath.length >= 2) {
      const ghostGfx = new Graphics();
      // Soft brown stripe under the path tiles
      // 2026-05-19 — Undead overhaul. Was warm brown 0x6b4a2a (dirt road
      // soft underline). Now cracked-stone gray so the bone-cobble path
      // tiles sit on a coherent darker base.
      ghostGfx.lineStyle(GRID.TILE * 0.55, 0x4a4548, 0.32);
      for (let i = 0; i < ghostPath.length; i++) {
        const t0 = ghostPath[i];
        const cx = t0.col * GRID.TILE + GRID.TILE / 2;
        const cy = t0.row * GRID.TILE + GRID.TILE / 2;
        if (i === 0) ghostGfx.moveTo(cx, cy);
        else ghostGfx.lineTo(cx, cy);
      }
      // Dashed brighter inline so the route still reads when towers cover it
      // 2026-05-19 — Undead overhaul. Was 0x8a5a30 warm brown highlight.
      // Now bone-cream so the inline shines like cracked stone catching
      // moonlight against the darker ground.
      ghostGfx.lineStyle(2.5, 0xa89684, 0.62);
      for (let i = 0; i < ghostPath.length - 1; i += 2) {
        const t0 = ghostPath[i];
        const t1 = ghostPath[i + 1];
        if (!t1) break;
        const x0 = t0.col * GRID.TILE + GRID.TILE / 2;
        const y0 = t0.row * GRID.TILE + GRID.TILE / 2;
        const x1 = t1.col * GRID.TILE + GRID.TILE / 2;
        const y1 = t1.row * GRID.TILE + GRID.TILE / 2;
        ghostGfx.moveTo(x0, y0).lineTo(x1, y1);
      }
      this.layers.bg.addChild(ghostGfx);
    }

    // Subtle path edge shadows for depth — drawn as a semi-transparent overlay
    // on top of the dirt-tile sprites. Keeps the path readable as a sunken trail.
    g.lineStyle(0);
    for (const k of pathSet) {
      const [cc, rr] = k.split(',').map(Number);
      const x = cc * GRID.TILE; const y = rr * GRID.TILE;
      g.beginFill(0x000000, 0.18).drawRect(x, y + GRID.TILE - 2, GRID.TILE, 2).endFill();
    }

    // Corner vignette — darkens edges for focus.
    const vg = 64;
    g.beginFill(0x000000, 0.30).drawRect(0, 0, GRID.CANVAS_W, vg).endFill();
    g.beginFill(0x000000, 0.30).drawRect(0, GRID.CANVAS_H - vg, GRID.CANVAS_W, vg).endFill();
    g.beginFill(0x000000, 0.25).drawRect(0, 0, vg, GRID.CANVAS_H).endFill();
    g.beginFill(0x000000, 0.25).drawRect(GRID.CANVAS_W - vg, 0, vg, GRID.CANVAS_H).endFill();
    // 2026-05-17 — Perimeter tree/boulder decor REMOVED. Used to draw
    // alternating BORDER_TREE / BORDER_BOULDER sprites on the outer ring;
    // the world-zoom now crops that ring out of view, so the dressing
    // had no real estate anyway. Removing the loop also saves a 64-sprite
    // Container allocation each drawStatic call (~once per game start +
    // per combo placement).

    // CAVE: dramatic 3x3 entry with rocky frame, dark glow, mist halo.
    const caveCx = waypointsData.spawn.col * GRID.TILE + GRID.TILE / 2;
    const caveCy = waypointsData.spawn.row * GRID.TILE + GRID.TILE / 2;
    const caveFrame = new Graphics();
    // Outer rocky cliff (dark gray, organic shape)
    caveFrame.beginFill(0x2a2622, 1).drawRoundedRect(caveCx - 56, caveCy - 56, 112, 112, 16).endFill();
    caveFrame.beginFill(0x3b342c, 1).drawRoundedRect(caveCx - 50, caveCy - 50, 100, 100, 14).endFill();
    // Inner shadow halo
    caveFrame.beginFill(0x000000, 0.8).drawCircle(caveCx, caveCy, 44).endFill();
    caveFrame.beginFill(0x1a0d2a, 0.85).drawCircle(caveCx, caveCy, 36).endFill();
    // Purple-mist outer aura (signals "danger comes from here")
    caveFrame.beginFill(0x6b3aa0, 0.18).drawCircle(caveCx, caveCy, 80).endFill();
    caveFrame.beginFill(0x6b3aa0, 0.10).drawCircle(caveCx, caveCy, 105).endFill();
    this.layers.bg.addChild(caveFrame);
    const cave = tex('DARK_CAVE');
    if (cave) {
      const cs = new Sprite(cave);
      cs.anchor.set(0.5); cs.x = caveCx; cs.y = caveCy;
      cs.width = 86; cs.height = 86;
      this.layers.bg.addChild(cs);
    }

    // GATE: 2026-05-17 — stone bastion frame REMOVED. The world-zoom was
    // cropping the bastion towers + crenellations off-screen; the player
    // saw a clipped-looking castle. Now we just draw the ROMAN_GATE sprite
    // itself with the soft gold glow underneath. Cleaner read at any zoom.
    const gateCx = waypointsData.gate.col * GRID.TILE + GRID.TILE / 2;
    const gateCy = waypointsData.gate.row * GRID.TILE + GRID.TILE / 2;
    const gateFrame = new Graphics();
    // Gold glow underneath (warmth — civilization to defend). Tightened
    // radius so the glow doesn't bleed into the cropped perimeter.
    gateFrame.beginFill(0xd4af37, 0.20).drawCircle(gateCx, gateCy, 56).endFill();
    gateFrame.beginFill(0xd4af37, 0.12).drawCircle(gateCx, gateCy, 78).endFill();
    this.layers.bg.addChild(gateFrame);
    const gate = tex('ROMAN_GATE');
    if (gate) {
      const gs = new Sprite(gate);
      gs.anchor.set(0.5); gs.x = gateCx; gs.y = gateCy;
      gs.width = 76; gs.height = 76;
      this.layers.bg.addChild(gs);
    }

    // Waypoint coins — now 1-tile checkpoints (smaller, less invasive)
    this.layers.waypoints.removeChildren();
    waypointsData.waypoints.forEach((wp, i) => {
      const cx = wp.topLeft.col * GRID.TILE + GRID.TILE / 2;
      const cy = wp.topLeft.row * GRID.TILE + GRID.TILE / 2;
      const halo = new Graphics();
      halo.beginFill(0xffd34d, 0.12).drawCircle(cx, cy, 22).endFill();
      halo.beginFill(0xffd34d, 0.20).drawCircle(cx, cy, 16).endFill();
      this.layers.waypoints.addChild(halo);
      const t = tex(`WP${i + 1}`);
      if (!t) return;
      const sp = new Sprite(t);
      sp.anchor.set(0.5);
      sp.x = cx;
      sp.y = cy;
      sp.width = GRID.TILE - 2;
      sp.height = GRID.TILE - 2;
      this.layers.waypoints.addChild(sp);
      const ring = new Graphics();
      ring.lineStyle(1.5, 0xffd34d, 0.9).drawCircle(cx, cy, (GRID.TILE - 2) / 2 + 1);
      this.layers.waypoints.addChild(ring);
      // Small numeric label so checkpoints read as a sequence
      const labelStyle = new TextStyle({ fontFamily: 'Courier New', fontSize: 9, fill: 0xffd34d, fontWeight: 'bold' });
      const label = new Text(`${i + 1}`, labelStyle);
      label.anchor.set(0.5);
      label.x = cx;
      label.y = cy + GRID.TILE / 2 + 6;
      this.layers.waypoints.addChild(label);
    });
    // 2026-05-19 fix — re-attach the aura-tile graphics on top of the bg
    // layer. The clear loop above (~line 1263) removes all bg children
    // past index 2, which silently detached `auraTileGfx` and left the
    // five glowing tiles invisible for the entire run. Re-adding here
    // also bumps the graphics object to the END of the bg child list so
    // the glow paints OVER the terrain + decor sprites instead of under
    // them. addChild on an already-parented object moves it, so this is
    // safe to call repeatedly across drawStatic invocations.
    this.layers.bg.addChild(this.auraTileGfx);
  }

  // Render dynamic state each frame.
  drawDynamic(state: GameStateShape) {
    // Tile overlays (stones, towers placed)
    this.layers.tiles.removeChildren();
    for (let r = 0; r < GRID.ROWS; r++) {
      for (let c = 0; c < GRID.COLS; c++) {
        const t = state.tiles[r][c];
        if (t === TileType.STONE) {
          const stone = tex('STONE_BLOCK');
          if (stone) {
            const sp = new Sprite(stone);
            sp.anchor.set(0.5);
            sp.x = c * GRID.TILE + GRID.TILE / 2;
            sp.y = r * GRID.TILE + GRID.TILE / 2;
            sp.width = GRID.TILE; sp.height = GRID.TILE;
            this.layers.tiles.addChild(sp);
          }
        }
      }
    }

    // Towers
    const seenTowerIds = new Set<string>();
    for (const tw of state.towers.values()) {
      seenTowerIds.add(tw.id);
      let entry = this.towerSprites.get(tw.id);
      if (!entry) {
        const t = tex(tw.type);
        const sp = new Sprite(t || undefined);
        sp.anchor.set(0.5);
        // 2026-05-19 — Per-type sprite scale. Most towers render at
        // 1.5× tile. Heroes get a touch more (1.6×) so they read
        // as slightly larger / more important without towering over
        // the field — user feedback: "hero towers a little too small,
        // about the size of everything else." Beast Hunter's source
        // PNG carries tight cropping that makes it appear oversized
        // at 1.5×, so it gets a dedicated 1.25× override to bring it
        // back in line with the rest of the tower roster.
        const isHeroSprite = !!tw.isHero;
        const PER_TYPE_SCALE: Record<string, number> = {
          BEAST_HUNTER: 1.25,
          BEAST_SLAYER: 1.25
        };
        const scale = isHeroSprite
          ? 1.6
          : (PER_TYPE_SCALE[tw.type] ?? 1.5);
        const sz = GRID.TILE * scale;
        sp.width = sz; sp.height = sz;
        if (isHeroSprite) {
          // 2026-05-19 — Tint only when the dedicated hero sprite is
          // missing (asset folder not deployed yet, or build mid-rollout).
          // Higgs-Field generated sprites carry their own per-hero
          // palette so tinting on top would muddy the bronze + cloak
          // colors. Falls back to the tint placeholder only when the
          // monogram fallback below is about to draw.
          if (!t) {
            const heroDef: any = (towersData as any)[tw.type] ?? {};
            const tintHex = (heroDef.tint ?? '#ffd34d').replace('#', '');
            sp.tint = parseInt(tintHex, 16);
          }
        }
        // FALLBACK MONOGRAM: every combo tier now ships a real sprite, but
        // this guard stays as a safety net for any future tower added to
        // towers.json before its sprite is wired into Assets.ts. Paints a
        // tier-colored badge with the tower's first letter so the field
        // doesn't have invisible towers. Stashed on the sprite via
        // __fallback so we can position+destroy it alongside.
        if (!t) {
          const TIER_HEX = [0xaaaaaa, 0xb87333, 0xc0c0c0, 0xffd34d, 0xff5050];
          const tierColor = TIER_HEX[Math.max(0, Math.min(4, tw.qualityTier - 1))];
          const fallback = new Graphics();
          fallback.beginFill(0x1a1410).drawCircle(0, 0, sz * 0.4).endFill();
          fallback.lineStyle(3, tierColor, 1).drawCircle(0, 0, sz * 0.4);
          const letter = String(tw.type).split('_')[0].charAt(0);
          const txt = new Text(letter, new TextStyle({
            fontFamily: 'Courier New', fontSize: 24, fontWeight: 'bold',
            fill: tierColor, stroke: 0x000000, strokeThickness: 3
          }));
          txt.anchor.set(0.5);
          fallback.addChild(txt);
          (sp as any).__fallback = fallback;
          this.layers.towers.addChild(fallback);
        }
        const tierKey = `TIER_${tw.qualityTier}`;
        const tierTex = tex(tierKey);
        const tier = tierTex ? new Sprite(tierTex) : null;
        if (tier) {
          tier.anchor.set(0.5, 1);
          tier.width = 14; tier.height = 14;
        }
        entry = { sp, tier };
        this.towerSprites.set(tw.id, entry);
        this.layers.towers.addChild(sp);
        if (tier) this.layers.towers.addChild(tier);
      }
      const baseX = tw.tileX * GRID.TILE + GRID.TILE / 2;
      const baseY = tw.tileY * GRID.TILE + GRID.TILE / 2;
      const isAttacking = tw.attackFlash > 0;
      // ─── FLOATING IDLE BREATH (2026-05-18 v3) ────────────────────────
      // Kept (non-pending) towers gently bob + sway when NOT attacking so
      // the field reads as "alive" — every Roman is subtly breathing, not
      // a statue. Each tower has its own phase offset hashed from its
      // tile coordinates so a wall of towers doesn't bob in lockstep.
      // Pending prospects keep their pulsing-alpha animation lower in the
      // block; this idle motion only kicks in once KEEP commits the tower.
      // Suppressed during the 0.18 s attackFlash window so the strike
      // motion stays clean — wouldn't want a breathing wobble cancelling
      // the lunge.
      //
      // 2026-05-18 — amplitude bumped 1.6 → 2.6 px vertical, 0.4 → 0.8 px
      // horizontal so the idle is actually visible at the 32-px tile
      // size. The previous values (1.6 / 0.4) were so subtle that at
      // typical viewing distance towers looked frozen. New values land
      // at ~5% of sprite height — visible but still gentle (not a
      // bouncing-mascot wobble). Applies uniformly to EVERY tower
      // including Tesserarius / Optio / combo towers that previously
      // appeared static.
      let idleBob = 0;
      let idleSway = 0;
      if (!tw.pending && !isAttacking) {
        const phase = state.tick * 1.2 + (tw.tileX * 0.7 + tw.tileY * 0.4);
        // 2026-05-19 — Heroes bob ~2× harder than regular towers so
        // their "alive" presence reads from across the map.
        const bobAmp = tw.isHero ? 4.4 : 2.6;
        idleBob = Math.sin(phase) * bobAmp;
        idleSway = Math.cos(phase * 0.7) * 0.8;
      }
      // (The Hastati attack-animation texture cycle and per-frame body
      // swap have been removed — Hastati now uses its base sprite at all
      // times, like every other melee tower. Attack feedback comes from
      // the standard attackFlash tint pulse + the slash VFX rendered at
      // the target's position.)
      // Attack flash + recoil: stronger brightening, scale jump, kickback offset
      // along the firing direction for satisfying combat feel.
      const flashT = tw.attackFlash > 0 ? Math.min(1, tw.attackFlash / 0.18) : 0;
      const baseTint = blendWithWhite(TIER_COLORS[tw.qualityTier] ?? 0xffffff, 0.5);
      // 2026-05 v6: gold-glow window — when an Aerarium or GOLD_PURSE-equipped
      // tower scores a kill, main.ts stamps __goldGlowUntil on the tower for
      // ~0.45s. We tint the sprite toward warm gold during that window so the
      // earn reads instantly on the tower itself (not just the floating "+Xg").
      // Falls through to the normal attackFlash logic when the glow expires.
      const goldGlowUntil = (tw as any).__goldGlowUntil ?? 0;
      const goldGlowT = goldGlowUntil > 0 ? Math.max(0, Math.min(1, (goldGlowUntil - state.tick) / 0.45)) : 0;
      // Strong white pop on flash, more pronounced than before
      if (flashT > 0) {
        entry.sp.tint = blendWithWhite(0xffffff, 1 - flashT);
      } else if (goldGlowT > 0) {
        // Blend toward laurel gold (0xffd34d) with intensity = goldGlowT
        entry.sp.tint = blendWithWhite(0xffd34d, 1 - goldGlowT * 0.55);
      } else {
        entry.sp.tint = baseTint;
      }
      const flashScale = 1 + flashT * 0.20;       // 0.10 → 0.20: bigger pop
      // ─── ATTACK MOVEMENT OFFSET ──────────────────────────────────────
      // Standard recoil for every tower: kicked AWAY from the target on
      // fire. (The Hastati-specific lunge animation was removed; Hastati
      // now uses the same recoil pattern as every other tower so the
      // sprite stays flat against the base texture.)
      let attackOffX = 0, attackOffY = 0;
      if (isAttacking) {
        const recoilDist = flashT * 4.5;
        attackOffX = -Math.cos(tw.rotation) * recoilDist;
        attackOffY = -Math.sin(tw.rotation) * recoilDist;
      }
      entry.sp.x = baseX + idleSway + attackOffX;
      entry.sp.y = baseY + idleBob + attackOffY;
      // Keep the fallback monogram (if any) glued to the sprite position.
      const fb = (entry.sp as any).__fallback as Graphics | undefined;
      if (fb) { fb.x = entry.sp.x; fb.y = entry.sp.y; }
      // 2026-05 v10 — PRESTIGE SCALE REMOVED. Used to grow the tower
      // sprite +5/+10/+15% on kill-milestones and +4-10% per MVP award,
      // but stacked scaling made apex / long-lived towers look comically
      // oversized vs. fresh prospects on adjacent tiles. Visual cues for
      // prestige now live elsewhere: the bronze/silver/gold kill BADGE
      // pinned to the tower corner still marks milestones; the MVP halo
      // (if/when added) reads off state.lastWaveMvpId. Sprite size is
      // pinned to a single tile + the existing attack-flash pop.
      //
      // 2026-05-17 — PROSPECT HOVER HIGHLIGHT. During prospect placement
      // and pick-keeper phases, if the player's cursor is over THIS tower
      // (either via canvas mousemove → hoveredTowerId, or via prospect
      // side-panel hover → selectedTowerId), the sprite gets:
      //   • +15% scale pop so it visually pushes forward
      //   • Pulsing alpha (sin oscillation, range 0.65..1.0) so the focus
      //     reads as "blinking" — the player sees instantly which prospect
      //     they're considering, whether they're hovering on the map or
      //     scrolling the side panel.
      // The effect only fires for PENDING towers (prospects). Kept towers
      // get the standard sprite render so the prospect flow stays clean.
      const isFocusedProspect = tw.pending && (
        tw.id === this.hoveredTowerId || tw.id === this.selectedTowerId
      );
      let focusScale = 1;
      let focusAlpha = 1;
      if (isFocusedProspect) {
        focusScale = 1.15;
        // Pulse between 0.55 and 1.0 alpha at ~3.5 Hz — fast enough to
        // read as a "blink" without being seizure-inducing.
        focusAlpha = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(state.tick * 7));
      }
      const totalScale = flashScale * focusScale;
      // 2026-05-19 — Per-frame scale must honor the same per-type
      // scaling rule used at sprite creation (line ~1564). Heroes
      // run at 1.6× tile; Beast Hunter / Slayer at 1.25× to offset
      // their tight source-PNG cropping; everything else at the
      // canonical 1.5×. Without this branch the per-frame update
      // would silently force every sprite back to 1.5× and undo the
      // creation-time size override.
      const PER_TYPE_SCALE_FRAME: Record<string, number> = {
        BEAST_HUNTER: 1.25,
        BEAST_SLAYER: 1.25
      };
      const baseScale = tw.isHero
        ? 1.6
        : (PER_TYPE_SCALE_FRAME[tw.type] ?? 1.5);
      const tileScale = GRID.TILE * baseScale;
      entry.sp.scale.set((tileScale / (entry.sp.texture?.width  || 1)) * totalScale,
                         (tileScale / (entry.sp.texture?.height || 1)) * totalScale);
      if (isFocusedProspect) {
        entry.sp.alpha = focusAlpha;
      } else if (tw.pending) {
        entry.sp.alpha = 0.7 + 0.2 * (0.5 + 0.5 * Math.sin(state.tick * 6));
      } else {
        entry.sp.alpha = 1;
      }
      if (entry.tier) {
        entry.tier.x = entry.sp.x + GRID.TILE / 2 - 4;
        entry.tier.y = entry.sp.y - GRID.TILE / 2 + 14;
      }
    }
    // Cleanup deleted towers
    for (const [id, entry] of this.towerSprites) {
      if (!seenTowerIds.has(id)) {
        const fb = (entry.sp as any).__fallback as Graphics | undefined;
        if (fb) fb.destroy({ children: true });
        entry.sp.destroy();
        if (entry.tier) entry.tier.destroy();
        this.towerSprites.delete(id);
      }
    }
    // Cooldown progress ring (Animation Doc §16) — only for slow towers (≤0.4 atk/sec)
    // Lazy-init container
    if (!(this as any).cooldownGfx) { (this as any).cooldownGfx = new Graphics(); this.layers.towers.addChild((this as any).cooldownGfx); }
    const cdg = (this as any).cooldownGfx as Graphics;
    cdg.clear();
    for (const tw of state.towers.values()) {
      if (tw.pending) continue;
      if (tw.attackSpeed > 0.4) continue;
      const interval = 1 / Math.max(0.05, tw.attackSpeed);
      const remaining = Math.max(0, tw.attackCooldown);
      const progress = Math.max(0, Math.min(1, 1 - remaining / interval));
      const cx = tw.tileX * GRID.TILE + GRID.TILE / 2;
      const cy = tw.tileY * GRID.TILE + GRID.TILE / 2;
      const r = GRID.TILE * 0.6;
      // Draw an arc representing reload progress (white)
      cdg.lineStyle(2, 0xffffff, 0.55);
      const startAngle = -Math.PI / 2;
      const endAngle = startAngle + progress * Math.PI * 2;
      cdg.arc(cx, cy, r, startAngle, endAngle, false);
      cdg.lineStyle(0);
    }

    // Damage-type indicator dots at tower feet (readability §4.2)
    const TYPE_COLOR = [0xc97070, 0x9bd0ff, 0xb88a4a, 0xff7733, 0xffd34d, 0x666666];
    if (!(this as any).typeDotsGfx) { (this as any).typeDotsGfx = new Graphics(); this.layers.towers.addChild((this as any).typeDotsGfx); }
    const tdg = (this as any).typeDotsGfx as Graphics;
    tdg.clear();
    // Targeting-mode letter badge (§4.2 — tower clarity)
    if (!(this as any).targetBadges) { (this as any).targetBadges = new Map<string, Text>(); }
    const targetBadges = (this as any).targetBadges as Map<string, Text>;
    const seenTargetBadges = new Set<string>();
    // Indexed by TargetingMode enum order: FIRST, LAST, STRONG, CLOSE,
    // FLYERS, WEAKEST, FAST. F/L/S/C/Y are the historical letters; W
    // (weakest) and A (fAst — F is taken by FIRST) are new (2026-05-19).
    const TARGET_LETTER = ['F', 'L', 'S', 'C', 'Y', 'W', 'A'];
    for (const tw of state.towers.values()) {
      if (tw.pending) continue;
      const cx = tw.tileX * GRID.TILE + GRID.TILE / 2;
      const cy = tw.tileY * GRID.TILE + GRID.TILE / 2;
      const color = TYPE_COLOR[tw.damageType as number] ?? 0xffffff;
      tdg.beginFill(0x000000, 0.5).drawCircle(cx - GRID.TILE * 0.3, cy + GRID.TILE * 0.45, 3).endFill();
      tdg.beginFill(color, 1).drawCircle(cx - GRID.TILE * 0.3, cy + GRID.TILE * 0.45, 2).endFill();
      // Target letter at top-left of tile
      seenTargetBadges.add(tw.id);
      let badge = targetBadges.get(tw.id);
      if (!badge) {
        badge = new Text(TARGET_LETTER[tw.targetingMode] ?? 'F', new TextStyle({ fontFamily: 'Courier New', fontSize: 9, fontWeight: 'bold', fill: 0xffd34d, stroke: 0x000000, strokeThickness: 2 }));
        badge.anchor.set(0.5);
        targetBadges.set(tw.id, badge);
        this.layers.towers.addChild(badge);
      }
      badge.text = TARGET_LETTER[tw.targetingMode] ?? 'F';
      badge.x = cx - GRID.TILE * 0.4;
      badge.y = cy - GRID.TILE * 0.4;
      badge.visible = true;
    }
    for (const [id, b] of targetBadges) {
      if (!seenTargetBadges.has(id)) { b.visible = false; }
    }

    // (Kill-milestone badges live in the dedicated overlaySprites pass
    //  further below — sprites pooled per tower id, cleaned up on removal.
    //  Duplicate path removed in 2026-05 v11 QC.)
    for (const tw of state.towers.values()) {
      const cx = tw.tileX * GRID.TILE + GRID.TILE / 2;
      const cy = tw.tileY * GRID.TILE + GRID.TILE / 2;
      // MVP gold star above veterans with ≥1 MVP award (Player Fantasy §4)
      if (tw.mvpAwards > 0) {
        const starId = 'mvp_' + tw.id;
        let starText = this.layers.towers.children.find((c: any) => c.__id === starId) as Text | undefined;
        if (!starText) {
          starText = new Text('★'.repeat(Math.min(3, tw.mvpAwards)), new TextStyle({ fontFamily: 'Courier New', fontSize: 10, fontWeight: 'bold', fill: 0xffd34d, stroke: 0x000000, strokeThickness: 2 }));
          (starText as any).__id = starId;
          starText.anchor.set(0.5);
          this.layers.towers.addChild(starText);
        }
        starText.text = '★'.repeat(Math.min(3, tw.mvpAwards));
        starText.x = cx;
        starText.y = cy - GRID.TILE * 0.65;
      }
      // (Cracked-base sprite for downgraded towers lives in the overlaySprites
      //  pass further below — single pooled sprite per tower, cleaned up on
      //  removal. Duplicate path removed in 2026-05 v11 QC.)
    }

    // Enemies
    const seenEnemyIds = new Set<string>();
    for (const e of state.enemies.values()) {
      seenEnemyIds.add(e.id);
      let entry = this.enemySprites.get(e.id);
      if (!entry) {
        const t = tex(e.type);
        const sp = new Sprite(t || undefined);
        sp.anchor.set(0.5);
        // 2026-05-17 — Initial-claim sizing matches the per-frame
        // sizing logic below so GATES OF HELL spawns don't pop in
        // at the wrong size for the first frame.
        const initIsHellGate = e.type === 'HELL_GATE';
        const initIsFireGiant = e.type === 'FIRE_GIANT';
        const size = initIsHellGate ? GRID.TILE * 3.0
                   : initIsFireGiant ? GRID.TILE * 2.4
                   : e.isBoss ? GRID.TILE * 2.4
                   : GRID.TILE * 1.75;
        sp.width = size; sp.height = size;
        const hp = new Graphics();
        const statusBar = new Container();
        const wounds = new Container();
        entry = { sp, hp, statusBar, displayX: e.x, displayY: e.y, lastTick: state.tick, wounds, woundCount: 0, nextDripTick: 0 };
        this.enemySprites.set(e.id, entry);
        this.layers.enemies.addChild(sp, wounds, hp, statusBar);
      }
      const frameDt = Math.max(0, state.tick - entry.lastTick);
      entry.lastTick = state.tick;
      const smoothing = Math.min(1, Math.max(0.35, frameDt * 28));
      entry.displayX += (e.x - entry.displayX) * smoothing;
      entry.displayY += (e.y - entry.displayY) * smoothing;
      // 2026-05-17 — GATES OF HELL type checks hoisted early so the bob,
      // stride, size, and footstep logic below all share the same flags.
      const isHellGate = e.type === 'HELL_GATE';
      const isFireGiant = e.type === 'FIRE_GIANT';
      // Weight-based bob (game feel §6.2): boss = slow heavy sway, flyer = quick light hover, ground = mid
      const bobFreq = e.isBoss ? 1.4 : (e.isFlyer ? 6.0 : 3.4);
      // 2026-05-17 — FIRE_GIANT gets the slow-heavy boss-tier bob amp
      // so its walk reads as a real giant. HELL_GATE skips the bob
      // entirely (it's a stationary structure).
      const bobAmp  = isHellGate ? 0
                    : isFireGiant ? 2.6
                    : e.isBoss ? 1.8
                    : (e.isFlyer ? 4.0 : 0.8);
      const strideRate = Math.max(2.5, e.currentSpeed * 5.2);
      const stride = Math.sin(state.tick * strideRate + e.pathIndex * 0.7);
      const bobOff = isHellGate ? 0
                   : e.currentSpeed > 0
                     ? Math.abs(stride) * bobAmp
                     : Math.sin(state.tick * bobFreq + (e.x + e.y) * 0.01) * bobAmp * 0.35;
      // 2026-05-17 — FIRE GIANT FOOTSTEP. Drop a dust puff + scorch
      // ember each time the stride completes a step (sin crosses zero
      // descending, roughly twice per stride cycle). Tower-tremor: any
      // tower within 0.6 tiles of the giant's feet feels a brief
      // shake (handled in main.ts; here we just spawn the puff).
      if (isFireGiant && e.currentSpeed > 0) {
        const lastStride = (entry as any).__lastStrideSign ?? stride;
        if (lastStride > 0 && stride <= 0) {
          // Mid-step landing.
          this.spawnEmberParticle(entry.displayX, entry.displayY + GRID.TILE * 0.35, /*warm=*/true);
          this.spawnEmberParticle(entry.displayX + (Math.random() - 0.5) * 16, entry.displayY + GRID.TILE * 0.35, /*warm=*/true);
          // Small ground char ring — reuse triggerImpactRing in a low-key warm tone.
          this.triggerImpactRing(entry.displayX, entry.displayY + GRID.TILE * 0.35, state.tick, 14, 0x884422);
        }
        (entry as any).__lastStrideSign = stride;
      }
      const dirX = (e.dirX ?? Math.sign(e.x - (e.prevX ?? e.x))) || 1;
      const dirY = (e.dirY ?? Math.sign(e.y - (e.prevY ?? e.y))) || 0;
      // 2026-05-17 — GATES OF HELL sprite sizing (isHellGate/isFireGiant
      // declared earlier at the top of the per-enemy block).
      const size = isHellGate ? GRID.TILE * 3.0
                 : isFireGiant ? GRID.TILE * 2.4
                 : e.isBoss ? GRID.TILE * 2.4
                 : GRID.TILE * 1.75;
      const baseScaleX = size / (entry.sp.texture?.width || 1);
      const baseScaleY = size / (entry.sp.texture?.height || 1);
      const runAmt = e.currentSpeed > 0 ? Math.min(1, e.currentSpeed / 2.4) : 0;
      const squash = 1 + Math.abs(stride) * 0.07 * runAmt;
      const stretch = 1 - Math.abs(stride) * 0.05 * runAmt;
      entry.sp.x = entry.displayX;
      // Apply UPRISING ground-rise offset (set by surprise-event emergence
      // VFX above). Defaults to 0 so non-surprise enemies render normally.
      const surpriseRiseOffset = (entry as any).__surpriseRiseOffset ?? 0;
      entry.sp.y = entry.displayY + bobOff + surpriseRiseOffset;
      // Knockback animation: when the enemy is currently inside a
      // knockback impulse window (set by EnemySystem on KNOCKBACK
      // status consumption), apply a brief scale-pulse + lean-back
      // rotation so the recoil reads visually even though the actual
      // path-reversal is small. Window: 0.35 s from impact.
      let kbScale = 1;
      let kbRotKick = 0;
      const kbUntil = (e as any).__knockbackAnimUntil ?? 0;
      if (kbUntil > state.tick) {
        const kbT = Math.max(0, (kbUntil - state.tick) / 0.35);     // 1 → 0
        kbScale = 1 + 0.18 * kbT;            // expand briefly
        kbRotKick = -0.35 * kbT * (dirX < 0 ? -1 : 1);              // lean backward
      }
      entry.sp.scale.set(
        baseScaleX * (dirX < 0 ? -1 : 1) * squash * kbScale,
        baseScaleY * stretch * kbScale
      );
      entry.sp.rotation = (dirY * 0.08 * runAmt) + kbRotKick;
      // Progressive injury: red overlay tint, plus a strong full-bright flash
      // when freshly hit so each blow reads.
      const hpFrac = Math.max(0, e.hp / e.maxHp);
      let tint = 0xffffff;
      if (hpFrac < 0.75) tint = 0xeacaca;
      if (hpFrac < 0.5)  tint = 0xd99999;
      if (hpFrac < 0.25) tint = 0xc06060;
      if (hpFrac < 0.1)  tint = 0xa03030;
      if (e.hpFlashTimer > 0) tint = 0xffffff;
      entry.sp.tint = tint;
      // BLOOD_MOON modifier: every enemy carries a faint crimson outline aura.
      if (state.waveModifier === 'BLOOD_MOON') {
        // approximate "outline" via an extra bigger sprite shadow tinted red;
        // simpler: just shift tint toward red and slightly increase scale.
        entry.sp.tint = blendWithWhite(0xcc1818, 0.55);
      }
      // VEIL modifier: when veiled, fade enemy sprite to ~40% alpha (was
      // 0.25 — the sprite became invisible against dark terrain). DoTs and
      // status effects continue to tick during veil; the player just can't
      // TARGET them with new attacks. Status badges and HP bar stay full
      // alpha so the player sees burns/bleeds chipping away during veil.
      if ((e as any).__veiled) {
        entry.sp.alpha = 0.40;
      } else if (!e.hasRebirthed && entry.sp.alpha < 1) {
        entry.sp.alpha = 1;
      }
      // ─── SURPRISE-EVENT EMERGENCE VFX (2026-05-16) ──────────────────
      // Enemies spawned by INVASION or UPRISING get a 0.4s emergence
      // animation. Honors the player ask: "teleport in" feel for invaders,
      // "rise from the ground" feel for the undead. After 0.4s the
      // animation tags are stripped so normal rendering resumes.
      const surpriseSpawnTick = (e as any).__surpriseSpawnTick;
      if (typeof surpriseSpawnTick === 'number') {
        const emergeT = (state.tick - surpriseSpawnTick) / 0.4;
        if (emergeT >= 1) {
          // Done — clean up tags so the cost is zero on subsequent frames.
          delete (e as any).__surpriseSpawnTick;
          delete (e as any).__surpriseSpawn;
          delete (e as any).__surpriseKind;
          entry.sp.alpha = 1;
          entry.sp.tint = 0xffffff;
        } else {
          const kind = (e as any).__surpriseKind;
          if (kind === 'INVASION') {
            // Teleport-in: alpha 0 → 1 over the window + cyan→white tint blend.
            entry.sp.alpha = Math.max(0.05, emergeT);
            // Cyan tint at t=0, fade to pure white at t=1.
            const teleColor = blendWithWhite(0x66ccff, emergeT);
            entry.sp.tint = teleColor;
          } else if (kind === 'UPRISING') {
            // Ground-rise: enemy y starts +18px below ground, lerps up.
            // Done via sprite y offset (entry.sp.y is set further down in
            // this method; we stamp the offset into a per-entry field
            // that the position assignment respects).
            (entry as any).__surpriseRiseOffset = (1 - emergeT) * 22;
            entry.sp.alpha = Math.max(0.2, emergeT);
          } else if (kind === 'GATES_OF_HELL') {
            // Gates rise dramatically (40px below → up) with a warm
            // red-orange tint that fades to white as they lock into
            // place. Fire giants get the same rise but shorter (28px)
            // and faster (since they emerge AFTER the gate).
            const rise = isHellGate ? 40 : 28;
            (entry as any).__surpriseRiseOffset = (1 - emergeT) * rise;
            entry.sp.alpha = Math.max(0.15, emergeT);
            // Warm orange-red tint blending to white.
            const warmColor = blendWithWhite(0xff5522, emergeT);
            entry.sp.tint = warmColor;
          }
        }
      } else if ((entry as any).__surpriseRiseOffset) {
        (entry as any).__surpriseRiseOffset = 0;
      }
      // Hit knockback jolt — visual-only offset that decays. Set when hpFlashTimer
      // jumps (i.e. fresh hit). Pushes the sprite slightly along the path direction
      // so it reads like the enemy got rocked. Game logic position is unaffected.
      if (e.hpFlashTimer > 0.06 && (entry.knockTimer ?? 0) <= 0) {
        const ang = Math.atan2(dirY, dirX);
        const mag = e.isBoss ? 1.5 : 3.5;       // bosses jolt less
        entry.knockX = Math.cos(ang) * mag;
        entry.knockY = Math.sin(ang) * mag;
        entry.knockTimer = 0.18;
        // Add a persistent wound on hit. Stuck arrows are damage decals
        // (no blood) and always fire; the bloody slash-gash variant is
        // gated by BLEED status — only enemies actively bleeding accrue
        // visible red wounds on their sprite. Cap at 8 wounds total.
        if (entry.wounds && (entry.woundCount ?? 0) < 8) {
          const hasBleed = e.statusEffects.some((s: any) => s.kind === 'BLEED');
          const radius = e.isBoss ? GRID.TILE * 0.7 : GRID.TILE * 0.4;
          const wx = (Math.random() - 0.5) * radius;
          const wy = (Math.random() - 0.5) * radius;
          // Arrow (no-blood damage decal) chance bumped from 30% to 45%
          // since the slash-gash now requires BLEED. Without this bump
          // non-bleeding enemies would accumulate ZERO wounds, losing
          // the "this guy has been shot a lot" visual altogether.
          if (Math.random() < 0.45) {
            entry.woundCount = (entry.woundCount ?? 0) + 1;
            const arrowTex = tex(Math.random() < 0.5 ? 'PROJ_ARROW' : 'PROJ_PILUM');
            if (arrowTex) {
              const arrow = new Sprite(arrowTex);
              arrow.anchor.set(0.5);
              arrow.width = e.isBoss ? 18 : 12;
              arrow.height = e.isBoss ? 18 : 12;
              arrow.x = wx; arrow.y = wy;
              arrow.rotation = Math.random() * Math.PI * 2;
              arrow.alpha = 0.85;
              entry.wounds.addChild(arrow);
            }
          } else if (hasBleed) {
            // Slash gash — only when the target is bleeding. Crimson
            // line + dark scab + blood droplet.
            entry.woundCount = (entry.woundCount ?? 0) + 1;
            const w = new Graphics();
            const len = (e.isBoss ? 9 : 6) + Math.random() * 4;
            const angle = Math.random() * Math.PI * 2;
            const dx = Math.cos(angle) * len * 0.5;
            const dy = Math.sin(angle) * len * 0.5;
            w.lineStyle(2.5, 0x440505, 1).moveTo(wx - dx, wy - dy).lineTo(wx + dx, wy + dy);
            w.lineStyle(1.5, 0xc81818, 1).moveTo(wx - dx * 0.85, wy - dy * 0.85).lineTo(wx + dx * 0.85, wy + dy * 0.85);
            w.lineStyle(0);
            // Small blood droplet near the cut
            w.beginFill(0x9a1010, 0.85).drawCircle(wx + dx * 0.7, wy + dy * 0.7, 1.5).endFill();
            entry.wounds.addChild(w);
          }
          // Non-bleeding non-arrow path: no wound this frame. Quiet.
        }
      }
      // Position wound overlay on the enemy
      if (entry.wounds) {
        entry.wounds.x = entry.sp.x;
        entry.wounds.y = entry.sp.y;
      }
      // 2026-05-17 — STUCK ARROWS REMOVED for perf. Each projectile impact
      // on a boss used to append a Sprite to a per-boss Container that was
      // repositioned every frame and rebuilt on count change. With twin /
      // ambush bosses on screen that's a real frame-budget tax. The hit-
      // spark + typed-impact VFX from drawGore still fires on every
      // projectile landing, so projectile hits read clearly.
      // ─── STATUS BAR RESET (2026-05 perf) ──────────────────────────
      // Clear all per-frame children of statusBar FIRST. Previously the
      // clear ran AFTER the shield/mutation indicators were added (line
      // ~1467 in the old layout), which destroyed both visuals every
      // frame AND burned per-enemy Graphics/Sprite allocs for nothing.
      // Now the clear is up here, before any of the per-frame inserts.
      while (entry.statusBar.children.length > 0) {
        const child = entry.statusBar.children[entry.statusBar.children.length - 1];
        entry.statusBar.removeChild(child);
        if ((child as any).destroy) (child as any).destroy({ children: false });
      }
      // ─── SHIELD INDICATOR — DISABLED (2026-05 v10) ────────────────
      // Bronze scutum overlay above shielded enemies (Carthage Elite
      // Guard, Undead Spearman) used to render here. The user found it
      // visually noisy on the map, so the floating icon is suppressed.
      // The shielded gameplay rule (ranged towers ignored until melee
      // breaks the shield) is fully intact — only the on-enemy badge
      // is hidden. Pre-wave Codex + enemy-inspect modal still flag the
      // SHIELD trait via tooltip / status text. If an enemy carried a
      // shield-bin from a prior session/render, tear it down once.
      if (entry.shieldBin) {
        entry.shieldBin.destroy({ children: true });
        entry.shieldBin = undefined;
        entry.shieldRing = undefined;
        entry.shieldSprite = undefined;
      }
      // ─── ELITE MUTATION VISUAL ─────────────────────────────────────
      // Distinct colored ring + small label so the player can read the
      // mutation type at a glance and respond.
      if (e.mutation) {
        const MUT_COLOR: Record<string, number> = {
          VETERAN: 0xb88a4a, SWIFT: 0x66ff99, BLOATED: 0xaa44cc,
          WARDED: 0x88ccff, AURA_STAR: 0xffd34d
        };
        const MUT_TEX: Record<string, string> = {
          VETERAN: 'MU_VETERAN', SWIFT: 'MU_SWIFT', BLOATED: 'MU_BLOATED',
          WARDED: 'MU_WARDED', AURA_STAR: 'MU_AURA_STAR'
        };
        const color = MUT_COLOR[e.mutation] ?? 0xffffff;
        const pulse = 0.6 + Math.sin(state.tick * 4) * 0.3;
        // Pulsing aura ring (matches enemy's mutation color)
        const ringG = new Graphics();
        const ringR = (e.isBoss ? GRID.TILE * 0.95 : GRID.TILE * 0.55);
        ringG.lineStyle(2.5, color, pulse);
        ringG.drawCircle(entry.displayX, entry.displayY + 2, ringR);
        ringG.lineStyle(1, color, pulse * 0.4);
        ringG.drawCircle(entry.displayX, entry.displayY + 2, ringR * 1.15);
        entry.statusBar.addChild(ringG);
        // Mutation badge sprite above the HP bar (replaces the text label)
        const mTex = tex(MUT_TEX[e.mutation]);
        const bx = entry.displayX;
        const by = entry.displayY - (e.isBoss ? GRID.TILE * 1.0 : GRID.TILE * 0.7);
        if (mTex) {
          const back = new Graphics();
          back.beginFill(0x000000, 0.65).drawCircle(bx, by, 11).endFill();
          back.lineStyle(1.5, color, pulse).drawCircle(bx, by, 11);
          back.lineStyle(0);
          entry.statusBar.addChild(back);
          const sp = new Sprite(mTex);
          sp.anchor.set(0.5);
          sp.x = bx; sp.y = by;
          sp.width = 18; sp.height = 18;
          entry.statusBar.addChild(sp);
        }
      }
      if ((entry.knockTimer ?? 0) > 0) {
        entry.knockTimer = Math.max(0, (entry.knockTimer ?? 0) - frameDt);
        const t = (entry.knockTimer ?? 0) / 0.18;
        entry.sp.x += (entry.knockX ?? 0) * t;
        entry.sp.y += (entry.knockY ?? 0) * t;
      }
      if (e.isFlyer) {
        entry.sp.y -= 6;     // sit higher than ground enemies
        entry.sp.rotation = Math.sin(state.tick * 5 + e.pathIndex) * 0.07;
      }
      // HP bar
      entry.hp.clear();
      if (hpFrac < 1) {
        const w = e.isBoss ? 32 : 18;
        const x = entry.displayX - w / 2;
        const y = entry.displayY - (e.isBoss ? GRID.TILE * 0.85 : GRID.TILE * 0.5) - 6;
        entry.hp.beginFill(0x000000, 0.7).drawRect(x - 1, y - 1, w + 2, 5).endFill();
        const col = hpFrac > 0.5 ? 0x66cc55 : (hpFrac > 0.25 ? 0xeebb22 : 0xcc3322);
        entry.hp.beginFill(col).drawRect(x, y, w * hpFrac, 3).endFill();
      }
      // 2026-05 v7: archetype text labels (ARMORED / RESISTANT / BULKY /
      // ELITE / BOSS) removed from above enemy sprites — they cluttered
      // the field. Archetype info is still visible via click-to-inspect
      // and the wave-preview chip. Hide any existing tag from prior frames.
      if ((entry as any).tag) {
        (entry as any).tag.visible = false;
      }
      // Status effects — much louder visualization than before:
      //   1) bright outline ring around the enemy (color of dominant status, pulsing)
      //   2) row of larger colored badges above the HP bar with single-letter glyphs
      //   3) faint colored tint on the enemy sprite itself
      const STATUS_COLOR: Record<string, number> = {
        SLOW: 0x66ccff, POISON: 0x33cc33, BLEED: 0xaa1f1f, FREEZE: 0xddeeff, BURN: 0xff7733,
        ARMOR_SHRED: 0xb88a4a, STUN: 0xffd34d, HELLFIRE: 0xff5533, FEAR: 0xcccccc,
        KNOCKBACK: 0xffaa55, MARK: 0xff66cc
      };
      const STATUS_GLYPH: Record<string, string> = {
        SLOW: 'S', POISON: 'P', BLEED: 'B', FREEZE: '❄', BURN: '🔥',
        ARMOR_SHRED: 'A', STUN: '⚡', HELLFIRE: 'H', FEAR: '!'
      };
      // (statusBar clear was moved up — see "STATUS BAR RESET" near
      // the top of the per-enemy block. Shield + mutation indicators
      // now persist into the same frame's render instead of being
      // wiped out by this loop.)
      if (e.statusEffects.length > 0) {
        const dominant = e.statusEffects[0].kind;
        const ringColor = STATUS_COLOR[dominant] ?? 0xffffff;
        const pulseT = 0.55 + 0.35 * Math.sin(state.tick * 5);
        const ringG = new Graphics();
        const ringR = (e.isBoss ? GRID.TILE * 0.85 : GRID.TILE * 0.5);
        ringG.lineStyle(2.5, ringColor, pulseT);
        ringG.drawCircle(entry.displayX, entry.displayY, ringR);
        // soft glow inner
        ringG.lineStyle(5, ringColor, pulseT * 0.25);
        ringG.drawCircle(entry.displayX, entry.displayY, ringR * 0.95);
        entry.statusBar.addChild(ringG);
        // tint sprite slightly
        const r = ((ringColor >> 16) & 0xff), g = ((ringColor >> 8) & 0xff), b = (ringColor & 0xff);
        const tintBlend = 0.35;
        const orig = (entry as any).baseSpriteTint ?? 0xffffff;
        const oR = ((orig >> 16) & 0xff), oG = ((orig >> 8) & 0xff), oB = (orig & 0xff);
        const tR = Math.round(oR * (1 - tintBlend) + r * tintBlend);
        const tG = Math.round(oG * (1 - tintBlend) + g * tintBlend);
        const tB = Math.round(oB * (1 - tintBlend) + b * tintBlend);
        entry.sp.tint = (tR << 16) | (tG << 8) | tB;
      }
      // Real status sprites (s_freeze.png, s_burn.png, s_poison.png, etc.) above
      // each affected enemy — large enough to read mid-wave, with a dark backing
      // for contrast and a gentle bob.
      {
        const STATUS_TEX: Record<string, string> = {
          SLOW: 'S_SLOW', POISON: 'S_POISON', BLEED: 'S_POISON', FREEZE: 'S_FREEZE',
          BURN: 'S_BURN', ARMOR_SHRED: 'S_SHRED', STUN: 'S_STUN',
          HELLFIRE: 'S_HELLFIRE', FEAR: 'S_FEAR',
          KNOCKBACK: 'MB_KNOCKBACK',
          MARK: 'MB_MARK'
        };
        const badgeW = 18;
        const yOff = (e.isBoss ? GRID.TILE * 0.95 : GRID.TILE * 0.6) + 18;
        for (let si = 0; si < e.statusEffects.length; si++) {
          const s = e.statusEffects[si];
          const xOff = (si - (e.statusEffects.length - 1) / 2) * (badgeW + 3);
          const cx = entry.displayX + xOff;
          const cy = entry.displayY - yOff + Math.sin(state.tick * 3 + si) * 1.5;
          const sprKey = STATUS_TEX[s.kind];
          const sprTex = sprKey ? tex(sprKey) : null;
          // Dark circular backing for contrast
          const back = new Graphics();
          back.beginFill(0x000000, 0.65).drawCircle(cx, cy, badgeW / 2 + 1).endFill();
          entry.statusBar.addChild(back);
          if (sprTex) {
            const sp = new Sprite(sprTex);
            sp.anchor.set(0.5);
            sp.width = badgeW;
            sp.height = badgeW;
            sp.x = cx; sp.y = cy;
            // BLEED reuses the poison sprite — tint it red so the player can
            // tell bleed from poison at a glance.
            if (s.kind === 'BLEED') sp.tint = 0xff5555;
            entry.statusBar.addChild(sp);
          } else {
            // Fallback colored dot if a status has no sprite mapping
            const color = STATUS_COLOR[s.kind] ?? 0xffffff;
            const dotG = new Graphics();
            dotG.beginFill(color, 1).drawCircle(cx, cy, badgeW / 2 - 1).endFill();
            entry.statusBar.addChild(dotG);
          }
        }
      }
    }
    for (const [id, entry] of this.enemySprites) {
      if (!seenEnemyIds.has(id)) {
        entry.sp.destroy(); entry.hp.destroy(); entry.statusBar.destroy();
        if (entry.wounds) entry.wounds.destroy();
        if (entry.shieldBin) entry.shieldBin.destroy({ children: true });
        // BUGFIX 2026-05: the archetype tag (ARMORED / RESISTANT / BOSS / …)
        // was added directly to this.layers.enemies and stashed on the
        // entry. Cleanup forgot to destroy it, so every dead enemy left
        // a permanent label on screen — which is why labels piled up
        // wave after wave and the layer ballooned. Destroy it here.
        const tag = (entry as any).tag;
        if (tag) { try { tag.destroy(); } catch { /* ignore double-destroy */ } }
        this.enemySprites.delete(id);
      }
    }
  }

  // Continuous blood-drip emitter — 2026-05 v6: GATED by BLEED status.
  // Previously every low-HP enemy dripped blood automatically; now only
  // enemies actively suffering the BLEED status drip, matching the
  // overall rule that visible blood = bleed effect. The drip rate still
  // scales with how hurt they are so a near-death bleeding enemy gushes
  // more than one at 50% HP.
  emitBloodDripsForWounded(state: GameStateShape, gore: any, tick: number) {
    for (const e of state.enemies.values()) {
      const hasBleed = e.statusEffects.some((s: any) => s.kind === 'BLEED');
      if (!hasBleed) continue;             // bleed-only gate
      const hpFrac = e.hp / e.maxHp;
      const entry = this.enemySprites.get(e.id);
      if (!entry) continue;
      // Drip rate scales with how hurt the enemy is (more frequent when near death)
      const dripInterval = 0.10 + Math.max(0, hpFrac) * 0.45;
      if ((entry.nextDripTick ?? 0) <= tick) {
        entry.nextDripTick = tick + dripInterval;
        gore.particles.push({
          x: e.x + (Math.random() - 0.5) * 6,
          y: e.y + 4,
          vx: (Math.random() - 0.5) * 18,
          vy: 30 + Math.random() * 40,
          life: 0.55 + Math.random() * 0.35,
          size: 1.5 + Math.random() * 1.0,
          color: 0xaa1010
        });
      }
    }
  }

  drawSelectedRange(state: GameStateShape) {
    this.rangeGfx.clear();
    // ─── HOVER RANGE (B3, 2026-05 v11) ─────────────────────────────────
    // Paint the hovered tower's range underneath the selected one, in a
    // dimmer copper tone. Skips when hovered == selected so we don't get
    // an awkward double-stroke at the same radius.
    if (this.hoveredTowerId && this.hoveredTowerId !== this.selectedTowerId) {
      const hw = state.towers.get(this.hoveredTowerId);
      if (hw) {
        const hstats = towerEffectiveStats(hw);
        const hpx = hw.tileX * GRID.TILE + GRID.TILE / 2;
        const hpy = hw.tileY * GRID.TILE + GRID.TILE / 2;
        this.rangeGfx.lineStyle(1.5, 0xb87333, 0.7);
        this.rangeGfx.beginFill(0xb87333, 0.04);
        this.rangeGfx.drawCircle(hpx, hpy, hstats.range * GRID.TILE);
        this.rangeGfx.endFill();
        this.rangeGfx.lineStyle(0);
      }
    }
    if (!this.selectedTowerId) return;
    const tw = state.towers.get(this.selectedTowerId);
    if (!tw) return;
    const stats = towerEffectiveStats(tw);
    const px = tw.tileX * GRID.TILE + GRID.TILE / 2;
    const py = tw.tileY * GRID.TILE + GRID.TILE / 2;
    // Full nominal range — gold filled circle
    this.rangeGfx.lineStyle(2, 0xffd34d, 0.9);
    this.rangeGfx.beginFill(0xffd34d, 0.06);
    this.rangeGfx.drawCircle(px, py, stats.range * GRID.TILE);
    this.rangeGfx.endFill();
    // Weather-reduced range — red dashed inner ring so the player can SEE
    // the loss directly on the field. Only drawn when penalty is active.
    const profile = state.weatherKey ? FACTION_WEATHER[state.weatherKey] : null;
    const inten = state.weatherIntensity ?? 1;
    if (profile && profile.rangePenalty > 0 && stats.range > 1.5) {
      // Skip the visual range-cut indicator on melee towers (range 1.5) — they're immune.
      const reducedR = Math.max(1.5, stats.range - profile.rangePenalty * inten) * GRID.TILE;
      const segs = 36;
      this.rangeGfx.lineStyle(2.5, 0xff5555, 0.9);
      for (let i = 0; i < segs; i += 2) {
        const a0 = (i / segs) * Math.PI * 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2;
        this.rangeGfx.moveTo(px + Math.cos(a0) * reducedR, py + Math.sin(a0) * reducedR);
        this.rangeGfx.arc(px, py, reducedR, a0, a1, false);
      }
      this.rangeGfx.lineStyle(0);
      // Subtle red fill in the lost-range donut
      this.rangeGfx.beginFill(0xff5555, 0.04).drawCircle(px, py, stats.range * GRID.TILE).endFill();
      this.rangeGfx.beginFill(0x000000, 0.0).drawCircle(px, py, reducedR).endFill();
    }
  }

  // 2026-05-15 v3 (Sell Stones multi-select): paint a pulsing cyan ring +
  // soft tint over every stone tile currently in the player's sell
  // selection. Runs every frame so the pulse animates smoothly.
  // The overlay re-uses `overlayGfx` and is cleared/redrawn each call to
  // avoid leaking gfx state between frames.
  drawSellStoneSelection(state: GameStateShape, tick: number) {
    const m: any = state as any;
    if (!m.__sellStoneMode) return;
    const sel: Set<string> | undefined = m.__sellStoneSelection;
    if (!sel || sel.size === 0) return;
    const pulse = 0.55 + 0.35 * Math.sin(tick * 5);
    // Use a dedicated graphics object stamp; we draw into overlayGfx
    // alongside the hover ring. drawHover called on mousemove only, so
    // this addition is layered on top each frame.
    const g = this.overlayGfx;
    for (const key of sel) {
      const parts = key.split(',');
      const r = +parts[0]; const c = +parts[1];
      if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
      const x = c * GRID.TILE; const y = r * GRID.TILE;
      // Cyan tile tint
      g.beginFill(0x9be0ff, 0.18 * pulse).drawRect(x + 2, y + 2, GRID.TILE - 4, GRID.TILE - 4).endFill();
      // Pulsing cyan border ring
      g.lineStyle(2, 0x9be0ff, pulse);
      g.drawRect(x + 1, y + 1, GRID.TILE - 2, GRID.TILE - 2);
      g.lineStyle(0);
      // Crosshair tick marks in the corners — readable "selected" symbol
      g.lineStyle(2, 0xffffff, pulse * 0.9);
      const cx = x + GRID.TILE / 2; const cy = y + GRID.TILE / 2;
      g.moveTo(cx - 4, cy).lineTo(cx + 4, cy);
      g.moveTo(cx, cy - 4).lineTo(cx, cy + 4);
      g.lineStyle(0);
    }
  }

  drawHover(col: number, row: number, valid: boolean, previewRangeTiles?: number) {
    this.overlayGfx.clear();
    if (col < 0 || row < 0) return;
    const x = col * GRID.TILE; const y = row * GRID.TILE;
    const cx = x + GRID.TILE / 2;
    const cy = y + GRID.TILE / 2;
    this.overlayGfx.lineStyle(2, valid ? 0x66ff66 : 0xff5555, 0.9);
    this.overlayGfx.beginFill(valid ? 0x66ff66 : 0xff5555, 0.18);
    this.overlayGfx.drawRect(x, y, GRID.TILE, GRID.TILE);
    this.overlayGfx.endFill();
    // Range preview while a card is selected
    if (valid && previewRangeTiles && previewRangeTiles > 0) {
      this.overlayGfx.lineStyle(2, 0xffd34d, 0.8);
      this.overlayGfx.beginFill(0xffd34d, 0.07);
      this.overlayGfx.drawCircle(cx, cy, previewRangeTiles * GRID.TILE);
      this.overlayGfx.endFill();
    }
  }

  // Draw thin connecting lines between ingredients of an available combo,
  // ending at a glowing centroid where the result will appear.
  drawComboLinks(combos: any[], state: GameStateShape, tick: number) {
    for (const cb of combos) {
      const xs = cb.ingredients.map((i: any) => i.tileX * GRID.TILE + GRID.TILE / 2);
      const ys = cb.ingredients.map((i: any) => i.tileY * GRID.TILE + GRID.TILE / 2);
      const cx = xs.reduce((a: number, b: number) => a + b, 0) / xs.length;
      const cy = ys.reduce((a: number, b: number) => a + b, 0) / ys.length;
      const a = 0.55 + 0.35 * Math.sin(tick * 4);
      this.comboGfx.lineStyle(1.5, 0xff8a44, a * 0.7);
      for (let i = 0; i < xs.length; i++) {
        this.comboGfx.moveTo(xs[i], ys[i]).lineTo(cx, cy);
      }
      this.comboGfx.lineStyle(0);
      // Centroid crystal — pulses to suggest "the result will land here"
      this.comboGfx.beginFill(0xff5533, a * 0.55).drawCircle(cx, cy, 7).endFill();
      this.comboGfx.beginFill(0xffaa66, a * 0.85).drawCircle(cx, cy, 4).endFill();
      this.comboGfx.beginFill(0xffffff, a).drawCircle(cx, cy, 1.5).endFill();
    }
  }

  // Visible aura rings for ALL support towers + aura items (2026-05 v6
  // unification). Every local aura source the game actually fires now
  // gets a ring drawn here so the player can read the buffed/debuffed
  // region at a glance. Consistent color scheme:
  //   • Ally-buff auras (dmg / speed / range) → VIOLET (0xc070ff) — keeps
  //     them visually distinct from the gold attack-range circle.
  //   • Enemy-debuff auras (+taken% / slow / mark) → dashed crimson
  //     (0xff5566) — same dashing style as Aquilifer's existing ring.
  //   • Tower-attack-range is always gold (drawSelectedRange) so the
  //     three layers never get confused.
  // Global auras (Triarius +12% global, Caesar +45% global, Triumvirate
  // triple global, Imperium global speed, Consular global) are NOT drawn
  // — they cover the whole map and a giant ring would be useless.
  drawAuras(state: GameStateShape, tick: number) {
    this.auraGfx.clear();
    const pulse = 0.55 + Math.sin(tick * 2.2) * 0.20;
    const ALLY = 0xc070ff;        // violet — ally buff
    const ENEMY = 0xff5566;       // crimson — enemy debuff
    for (const tw of state.towers.values()) {
      if (tw.pending) continue;
      const cx = tw.tileX * GRID.TILE + GRID.TILE / 2;
      const cy = tw.tileY * GRID.TILE + GRID.TILE / 2;

      // ── TOWER-NATIVE LOCAL AURAS ─────────────────────────────────
      // Eagle Standard — local +18% atk speed within 5 tiles (v6 buff).
      if (tw.type === TowerType.EAGLE_STANDARD) {
        this.drawAuraRing(cx, cy, 5 * GRID.TILE, ALLY, pulse);
      }
      // Aquilifer Titan — local enemy +20% taken (5 tiles). 2026-05 v11:
      // dedicated prominent variant so the +20% damage radius is obvious
      // even on cluttered late-game boards. Thicker line, brighter fill,
      // continuous (not dashed) so it stands apart from other auras.
      if (tw.type === TowerType.AQUILIFER_TITAN) {
        this.drawProminentEnemyAuraRing(cx, cy, 5 * GRID.TILE, pulse);
      }
      // Praetorian Wall — adjacent enemies slowed (~1.5 tiles).
      if (tw.type === TowerType.PRAETORIAN_WALL) {
        this.drawAuraRing(cx, cy, 1.5 * GRID.TILE, ENEMY, pulse * 0.8, true);
      }
      // Cohort Guard — +15% damage aura to nearby towers (3 tiles).
      if (tw.type === TowerType.COHORT_GUARD) {
        this.drawAuraRing(cx, cy, 3 * GRID.TILE, ALLY, pulse * 0.85);
      }
      // Triplex Acies super combo — +20% atk speed aura (3 tiles).
      if (tw.type === TowerType.TRIPLEX_ACIES) {
        this.drawAuraRing(cx, cy, 3 * GRID.TILE, ALLY, pulse * 0.85);
      }
      // Legion Prime super combo — +25% damage aura (3 tiles).
      if (tw.type === TowerType.LEGION_PRIME) {
        this.drawAuraRing(cx, cy, 3 * GRID.TILE, ALLY, pulse * 0.9);
      }
      // Sacer Vestal — doubles status durations in range (4.5 tiles).
      if (tw.type === TowerType.SACER_VESTAL) {
        this.drawAuraRing(cx, cy, 4.5 * GRID.TILE, ALLY, pulse * 0.7);
      }

      // ── AURA ITEMS ───────────────────────────────────────────────
      // Item rings re-derive their radius from the same constants used
      // in CombatResolver localAuras so player-visible and player-affected
      // ranges always match.
      if (tw.equippedItems.includes('CENTURIONS_TRUMPET')) {
        this.drawAuraRing(cx, cy, 2 * GRID.TILE, ALLY, pulse * 0.75);
      }
      if (tw.equippedItems.includes('BATTLE_STANDARD')) {
        this.drawAuraRing(cx, cy, 2 * GRID.TILE, ALLY, pulse * 0.75);
      }
      if (tw.equippedItems.includes('WAR_HOUND_COLLAR')) {
        this.drawAuraRing(cx, cy, 2.5 * GRID.TILE, ALLY, pulse * 0.8);
      }
      if (tw.equippedItems.includes('DRUIDS_TORC')) {
        this.drawAuraRing(cx, cy, 2.5 * GRID.TILE, ALLY, pulse * 0.8);
      }
      if (tw.equippedItems.includes('BARCA_WAR_HORN')) {
        this.drawAuraRing(cx, cy, 3 * GRID.TILE, ALLY, pulse * 0.85);
      }
      if (tw.equippedItems.includes('LICH_GENERALS_SEAL')) {
        this.drawAuraRing(cx, cy, 3 * GRID.TILE, ALLY, pulse * 0.85);
      }
      if (tw.equippedItems.includes('AQUILIFER_BANNER')) {
        this.drawAuraRing(cx, cy, 2.5 * GRID.TILE, ALLY, pulse * 0.8);
      }
      // Enemy-debuff item: Cursed Torc — every enemy within 2 tiles takes +18%.
      if (tw.equippedItems.includes('CURSED_TORC')) {
        this.drawAuraRing(cx, cy, 2 * GRID.TILE, ENEMY, pulse * 0.85, true);
      }
    }
  }

  // 2026-05 v11: prominent variant for Aquilifer Titan's "+20% damage to
  // nearby enemies" aura. Bright crimson outer ring, thicker stroke, soft
  // gradient fill, plus a faint inner ring at 0.7r to read as a hot zone
  // rather than just an outline. Continuous (not dashed) for distinction.
  private drawProminentEnemyAuraRing(cx: number, cy: number, r: number, pulse: number) {
    const COLOR = 0xff3344;
    const a = 0.55 + pulse * 0.35;     // 0.55-0.90 range — way brighter than the default ~0.35-0.75
    // Outer fill — soft red haze across the whole zone
    this.auraGfx.beginFill(COLOR, a * 0.12).drawCircle(cx, cy, r).endFill();
    // Inner hot ring at 0.7r — adds depth + reinforces the "kill zone" read
    this.auraGfx.lineStyle(2, COLOR, a * 0.55);
    this.auraGfx.drawCircle(cx, cy, r * 0.7);
    // Main outer ring — thick and bright
    this.auraGfx.lineStyle(4, COLOR, a);
    this.auraGfx.drawCircle(cx, cy, r);
    // Pulsing inner highlight — bright thin line that throbs
    this.auraGfx.lineStyle(1.5, 0xffaa66, a * 0.9);
    this.auraGfx.drawCircle(cx, cy, r - 2);
    this.auraGfx.lineStyle(0);
  }

  private drawAuraRing(cx: number, cy: number, r: number, color: number, alpha: number, dashed = false) {
    if (dashed) {
      // dashed outer ring + soft inner fill
      const segs = 32;
      this.auraGfx.beginFill(color, alpha * 0.06).drawCircle(cx, cy, r).endFill();
      this.auraGfx.lineStyle(2, color, alpha);
      for (let i = 0; i < segs; i += 2) {
        const a0 = (i / segs) * Math.PI * 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2;
        this.auraGfx.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
        this.auraGfx.arc(cx, cy, r, a0, a1, false);
      }
      this.auraGfx.lineStyle(0);
    } else {
      this.auraGfx.beginFill(color, alpha * 0.08).drawCircle(cx, cy, r).endFill();
      this.auraGfx.lineStyle(2, color, alpha * 0.85);
      this.auraGfx.drawCircle(cx, cy, r);
      this.auraGfx.lineStyle(0);
    }
  }

  // Tier pip indicator: 1-5 small colored dots above each tower so the player can
  // read tier without clicking. Pip color = TIER_COLORS[qualityTier].
  // Also overlays kill milestone badges (50/200/500 kills) and a cracked-base
  // sprite on towers that have been downgraded.
  private overlaySprites: Map<string, { badge: Sprite | null; crack: Sprite | null; itemBoost: Text | null }> = new Map();
  // Big floating "T1..T5" labels above pending prospects so the player can
  // read tier from across the board before deciding which tile to place on.
  private pendingTierLabels: Map<string, Text> = new Map();
  drawTierPips(state: GameStateShape) {
    this.tierPipGfx.clear();
    const seen = new Set<string>();
    // Weather slow indicator: when atk speed is reduced, draw a small pulsing
    // gear/cog icon beside the tower so the slowdown is visible per-unit.
    const profile = state.weatherKey ? FACTION_WEATHER[state.weatherKey] : null;
    const slowAffected = !!profile && profile.attackSpeedPenalty > 0;
    const silenceAffected = !!profile;     // any silence event from ghosts handled below
    for (const tw of state.towers.values()) {
      seen.add(tw.id);
      const cx = tw.tileX * GRID.TILE + GRID.TILE / 2;
      const cy = tw.tileY * GRID.TILE + GRID.TILE / 2;
      const tier = tw.qualityTier;
      const color = TIER_COLORS[tier] ?? 0xffffff;
      // Pending prospects get a SUPER-OBVIOUS tier readout: pulsing thick
      // tier-colored halo + the tier-colored pip dots above. This way the
      // player can see at a glance which prospects are T1 vs T5 BEFORE
      // committing them to a tile.
      if (tw.pending) {
        const pulse = 0.55 + 0.45 * Math.sin(state.tick * 5 + cx * 0.01);
        // Outer halo ring — thick, glowing, tier color
        this.tierPipGfx.lineStyle(4, color, 0.55 + 0.35 * pulse);
        this.tierPipGfx.drawCircle(cx, cy, GRID.TILE * 0.55);
        // Inner solid ring
        this.tierPipGfx.lineStyle(2, color, 0.95);
        this.tierPipGfx.drawCircle(cx, cy, GRID.TILE * 0.42);
        this.tierPipGfx.lineStyle(0);
        // Pip dots above the tower.
        const pipSize = 3.5;
        const gap = 8;
        const totalW = (tier - 1) * gap;
        const py = cy - GRID.TILE * 0.62;
        for (let i = 0; i < tier; i++) {
          const px = cx - totalW / 2 + i * gap;
          this.tierPipGfx.beginFill(0x000000, 0.9).drawCircle(px, py, pipSize + 1.5).endFill();
          this.tierPipGfx.beginFill(color, 1).drawCircle(px, py, pipSize).endFill();
        }
        // Big "T#" badge floating to the side — unmistakable from any zoom.
        let lbl = this.pendingTierLabels.get(tw.id);
        if (!lbl) {
          lbl = new Text(`T${tier}`, new TextStyle({
            fontFamily: 'Courier New', fontSize: 11, fontWeight: 'bold',
            fill: color, stroke: 0x000000, strokeThickness: 3, letterSpacing: 1,
            dropShadow: true, dropShadowColor: 0x000000, dropShadowBlur: 3, dropShadowDistance: 0
          }));
          (lbl as any).__tier = tier;
          lbl.anchor.set(0.5);
          this.layers.towers.addChild(lbl);
          this.pendingTierLabels.set(tw.id, lbl);
        } else if ((lbl as any).__tier !== tier) {
          lbl.text = `T${tier}`;
          (lbl.style as TextStyle).fill = color;
          (lbl as any).__tier = tier;
        }
        lbl.x = cx;
        lbl.y = cy + GRID.TILE * 0.78;
        lbl.scale.set(0.95 + 0.08 * pulse);
        continue;
      }
      // Tier-colored ring around tower base
      this.tierPipGfx.lineStyle(2, color, 0.95);
      this.tierPipGfx.drawCircle(cx, cy + GRID.TILE * 0.36, GRID.TILE * 0.42);
      this.tierPipGfx.lineStyle(0);
      // Weather speed-debuff badge: small pulsing icon to the upper-left.
      if (slowAffected) {
        const pulse = 0.55 + Math.sin(state.tick * 4 + cx * 0.01) * 0.30;
        const ix = cx - GRID.TILE * 0.42;
        const iy = cy - GRID.TILE * 0.42;
        this.tierPipGfx.beginFill(0x000000, 0.7).drawCircle(ix, iy, 5).endFill();
        this.tierPipGfx.beginFill(profile!.color, pulse).drawCircle(ix, iy, 4).endFill();
        // Mini "clock-hand" tick to suggest slowing
        this.tierPipGfx.lineStyle(1, 0x000000, 0.9);
        this.tierPipGfx.moveTo(ix, iy).lineTo(ix + Math.cos(state.tick * 0.8) * 3, iy + Math.sin(state.tick * 0.8) * 3);
        this.tierPipGfx.lineStyle(0);
      }
      // 2026-05 v9 — DRUID SLEEP INDICATOR. While `asleepUntil > tick`,
      // the tower is fully inert. Render a pulsing dim cyan halo behind
      // it plus three Zs floating up above (staggered phase + alpha so
      // they read as the classic "sleeping" cartoon stack). The fade is
      // built from how much sleep time is left, so when it's about to
      // expire the Zs visibly grow faint.
      const asleepUntil = (tw as any).asleepUntil ?? 0;
      if (asleepUntil > state.tick) {
        const remain = asleepUntil - state.tick;
        const lifeFade = Math.min(1, remain / 0.5);   // ramp out in the last 0.5s
        // Backing halo on the tower body — gentle cyan-purple breath.
        const halo = 0.30 + 0.25 * Math.sin(state.tick * 3);
        this.tierPipGfx.beginFill(0x8866ff, 0.20 * lifeFade).drawCircle(cx, cy, GRID.TILE * 0.55).endFill();
        this.tierPipGfx.beginFill(0xaaccff, 0.30 * halo * lifeFade).drawCircle(cx, cy - 4, GRID.TILE * 0.35).endFill();
        // ZZZ rising-stack glyphs. Three offset Zs at staggered phase.
        for (let i = 0; i < 3; i++) {
          const phase = state.tick * 1.6 + i * 0.7;
          const yOff = -GRID.TILE * 0.55 - (phase % 1.5) * 18;
          const xOff = Math.sin(phase * 2.0) * 5 + (i * 6 - 6);
          const zAlpha = (1 - (phase % 1.5) / 1.5) * lifeFade;
          if (zAlpha <= 0.02) continue;
          this.tierPipGfx.lineStyle(2.5, 0x000000, 0.55 * zAlpha);
          this.tierPipGfx.moveTo(cx + xOff - 4, cy + yOff - 5);
          this.tierPipGfx.lineTo(cx + xOff + 4, cy + yOff - 5);
          this.tierPipGfx.lineTo(cx + xOff - 4, cy + yOff + 5);
          this.tierPipGfx.lineTo(cx + xOff + 4, cy + yOff + 5);
          this.tierPipGfx.lineStyle(2, 0xddeeff, 0.95 * zAlpha);
          this.tierPipGfx.moveTo(cx + xOff - 4, cy + yOff - 5);
          this.tierPipGfx.lineTo(cx + xOff + 4, cy + yOff - 5);
          this.tierPipGfx.lineTo(cx + xOff - 4, cy + yOff + 5);
          this.tierPipGfx.lineTo(cx + xOff + 4, cy + yOff + 5);
          this.tierPipGfx.lineStyle(0);
        }
      }
      // Tower silence flash (Ghost Rider/Spectral pass) — uses real Higgsfield sprite
      const silencedUntil = (tw as any).silencedUntil ?? 0;
      if (silenceAffected && state.tick < silencedUntil) {
        const ix = cx + GRID.TILE * 0.42;
        const iy = cy - GRID.TILE * 0.42;
        // 2026-05 v6: pulse opacity 0.5 → 1.0 → 0.5 over ~0.6s so the
        // silence reads as a live debuff, not a static decal. sin(t*8) at
        // ~8rad/s = ~1.27Hz which gives a tight ominous flicker.
        const pulse = 0.5 + 0.5 * Math.sin(state.tick * 8);
        const t = (silencedUntil - state.tick) / 0.6 * pulse;
        const sileTex = tex('MU_TOWER_SILENCED');
        if (sileTex) {
          // Drop into the tier-pip layer using the existing graphics is tricky;
          // we'll just stamp a quick procedural backing here and leave the real
          // sprite usage to a future pass — the X-mark still reads.
          this.tierPipGfx.beginFill(0x000000, 0.85).drawCircle(ix, iy, 7).endFill();
          this.tierPipGfx.beginFill(0xff66cc, 0.9 * t).drawCircle(ix, iy, 6).endFill();
          this.tierPipGfx.lineStyle(2, 0x000000, 1);
          this.tierPipGfx.moveTo(ix - 3, iy - 3).lineTo(ix + 3, iy + 3);
          this.tierPipGfx.moveTo(ix + 3, iy - 3).lineTo(ix - 3, iy + 3);
          this.tierPipGfx.lineStyle(0);
        } else {
          this.tierPipGfx.beginFill(0x000000, 0.85).drawCircle(ix, iy, 6).endFill();
          this.tierPipGfx.beginFill(0xff66cc, 0.9 * t).drawCircle(ix, iy, 5).endFill();
          this.tierPipGfx.lineStyle(1.5, 0x000000, 1);
          this.tierPipGfx.moveTo(ix - 2.5, iy - 2.5).lineTo(ix + 2.5, iy + 2.5);
          this.tierPipGfx.moveTo(ix + 2.5, iy - 2.5).lineTo(ix - 2.5, iy + 2.5);
          this.tierPipGfx.lineStyle(0);
        }
      }
      // Pip dots above tower (1 dot per tier)
      const pipSize = 2.2;
      const gap = 5;
      const totalW = (tier - 1) * gap;
      const py = cy - GRID.TILE * 0.55;
      for (let i = 0; i < tier; i++) {
        const px = cx - totalW / 2 + i * gap;
        this.tierPipGfx.beginFill(0x000000, 0.85).drawCircle(px, py, pipSize + 1).endFill();
        this.tierPipGfx.beginFill(color, 1).drawCircle(px, py, pipSize).endFill();
      }

      // Kill milestone badge: 500+ = gold, 200+ = silver, 50+ = bronze. Sprite asset.
      let badgeKey: string | null = null;
      if (tw.killCount >= 500) badgeKey = 'BADGE_GOLD';
      else if (tw.killCount >= 200) badgeKey = 'BADGE_SILVER';
      else if (tw.killCount >= 50) badgeKey = 'BADGE_BRONZE';
      let entry = this.overlaySprites.get(tw.id);
      if (!entry) { entry = { badge: null, crack: null, itemBoost: null }; this.overlaySprites.set(tw.id, entry); }
      // Manage badge sprite
      if (badgeKey) {
        const bTex = tex(badgeKey);
        if (bTex && (!entry.badge || (entry.badge as any).__key !== badgeKey)) {
          if (entry.badge) entry.badge.destroy();
          entry.badge = new Sprite(bTex);
          (entry.badge as any).__key = badgeKey;
          entry.badge.anchor.set(0.5);
          entry.badge.width = 12;
          entry.badge.height = 12;
          this.layers.towers.addChild(entry.badge);
        }
        if (entry.badge) {
          entry.badge.x = cx + GRID.TILE * 0.40;
          entry.badge.y = cy - GRID.TILE * 0.40;
          entry.badge.visible = true;
        }
      } else if (entry.badge) {
        entry.badge.visible = false;
      }
      // Cracked base for downgraded towers
      if (tw.hasBeenDowngraded) {
        const cTex = tex('CRACKED_BASE');
        if (cTex && !entry.crack) {
          entry.crack = new Sprite(cTex);
          entry.crack.anchor.set(0.5);
          entry.crack.width = GRID.TILE * 0.95;
          entry.crack.height = GRID.TILE * 0.95;
          entry.crack.alpha = 0.7;
          this.layers.towers.addChild(entry.crack);
        }
        if (entry.crack) {
          entry.crack.x = cx;
          entry.crack.y = cy + GRID.TILE * 0.10;
          entry.crack.visible = true;
        }
      } else if (entry.crack) {
        entry.crack.visible = false;
      }
      // ITEM-BOOST BADGE removed from map (2026-05): the floating green
      // "+X%" tag cluttered the play area, especially around aura towers.
      // The same number lives in the TowerMenu's "ITEM IMPACT" panel,
      // which appears the moment the player clicks the tower. If any
      // stale Text node still exists from a previous frame, destroy it.
      if (entry.itemBoost) {
        entry.itemBoost.destroy();
        entry.itemBoost = null;
      }
    }
    // Clean up overlays for removed/pending towers
    for (const [id, entry] of this.overlaySprites) {
      if (!seen.has(id)) {
        entry.badge?.destroy();
        entry.crack?.destroy();
        entry.itemBoost?.destroy();
        this.overlaySprites.delete(id);
      }
    }
    // Remove "T#" prospect labels once a tower is committed (no longer pending)
    // or destroyed. We use the same `seen` set: any id that is missing or whose
    // tower is no longer in `pending` state should drop its label.
    for (const [id, lbl] of this.pendingTierLabels) {
      const tw = state.towers.get(id);
      if (!tw || !tw.pending) {
        lbl.destroy();
        this.pendingTierLabels.delete(id);
      }
    }
  }

  // BURNING GROUND — fire-themed tower hits leave a 3s patch at the impact
  // point.
  //
  // PERF REFACTOR (2026-05): was 6 Graphics drawCircle calls + 6 fill state
  // changes per patch per frame (3 rings + 3 procedural embers). At the
  // 80-patch cap that was ~480 GPU state changes / frame just for burn
  // visuals — the primary cause of the user-reported lag once burning
  // ground started accumulating. Now pooled Sprites of `v_burn_zone.png`
  // (which already contains the rings + embers + smoke in the texture),
  // animated via `.tint` + `.alpha` + a slight `.scale` flicker.
  // Sprite batching means hundreds of patches paint in one GPU draw call.
  private burnPatchSprites: Sprite[] = [];
  private burnPatchSpritesIdx = 0;
  // ─── SURPRISE EVENTS (2026-05-16) ───────────────────────────────────
  // Pooled sprites for fire/urn (active event) + scar (post-event burn
  // zone or urn-shadow). One pool per role to avoid texture swaps each
  // frame. Tint overlay is a single Graphics rect over the play area.
  private surpriseActiveSprites: Sprite[] = [];   // fire/urn during active event
  private surpriseScarSprites: Sprite[] = [];     // burn zone / urn-shadow after event
  private surpriseTintGfx?: Graphics;
  private surpriseDustPuffsEmitted = new Set<string>();   // event-id::point-index → one-shot guard
  private surpriseEmberClock = 0;                          // throttle counter for ember emission
  private surpriseAtmosSprites: Sprite[] = [];             // pooled atmospheric prop sprites
  // 2026-05-17 — DEATH UPRISING over-the-top overlay. Single Graphics
  // drawn beneath the urn sprites; carries pulsing dark-aura rings,
  // ground cracks, orbiting floating skulls, and a vertical soul column
  // per urn. Cleared and redrawn every frame the event is alive.
  private uprisingOverlayGfx?: Graphics;
  // 2026-05-17 — GATES OF HELL warm-portal overlay. Mirrors the uprising
  // overlay pattern but uses fire colors. Draws around the live
  // HELL_GATE enemies (which render via the regular enemy sprite path)
  // — ground cracks in red-orange, pulsing fire aura ring, orbiting
  // ember demons, ground-shimmer.
  private gatesOfHellOverlayGfx?: Graphics;
  drawBurnPatches(state: GameStateShape, tick: number) {
    const patches = state.burnPatches;
    // Reset pool index; we'll claim entries as we iterate live patches.
    this.burnPatchSpritesIdx = 0;
    if (patches && patches.length > 0) {
      for (const p of patches) {
        // Grab (or grow) a pool entry. New sprites are created lazily and
        // stay attached to layers.bg between frames — much cheaper than
        // beginFill/endFill churn.
        let sp = this.burnPatchSprites[this.burnPatchSpritesIdx];
        if (!sp) {
          const tx = tex('BURN_ZONE');
          sp = new Sprite(tx || undefined);
          sp.anchor.set(0.5);
          this.layers.bg.addChild(sp);
          this.burnPatchSprites.push(sp);
        }
        // Life curve: fade out smoothly as the patch dies.
        const t = Math.max(0, Math.min(1, p.life / 3.0));
        const flicker = 0.92 + 0.08 * Math.sin(tick * 8 + p.x * 0.05 + p.y * 0.07);
        const baseSize = GRID.TILE * 1.1;
        sp.x = p.x;
        sp.y = p.y;
        sp.width = baseSize * flicker;
        sp.height = baseSize * flicker;
        sp.alpha = t * 0.85;
        sp.visible = true;
        // Tier scaling: higher-tier patches paint slightly larger + redder
        // so the player can read which tower it came from at a glance.
        sp.scale.x *= 1 + (p.sourceTier - 1) * 0.05;
        sp.scale.y *= 1 + (p.sourceTier - 1) * 0.05;
        this.burnPatchSpritesIdx++;
      }
    }
    // Hide unused pool entries (don't destroy — keep them for next frame).
    for (let i = this.burnPatchSpritesIdx; i < this.burnPatchSprites.length; i++) {
      this.burnPatchSprites[i].visible = false;
    }
  }

  // ─── SURPRISE EVENTS — fires, urns, screen tint (v2 polish) ─────────────
  // v2 changes per player feedback:
  //   • Fires actively animate: alternating FIRE_SMALL/FIRE_LARGE frames
  //     every 0.13s, rotation wobble ±4°, scale jitter, ember sparks
  //     ejected upward via the gore particle pool.
  //   • Urns rise from BELOW the tile on appear (y starts +18 below,
  //     lerps up over 0.4s) with a breathing pulse + slow wobble.
  //   • All sprites group by pointId — exactly 4 visual locations even
  //     though the spawn schedule has 8 entries (2 per point).
  //   • Smooth fade-in (rise window) + fade-out (after last spawn fires).
  //   • NO persistent scars — the play area returns to clean as soon as
  //     the spawn schedule drains. Honors "no clutter during the wave."
  //   • Per-enemy emergence VFX:
  //       INVASION → teleport-in: cyan→white→full alpha ramp over 0.3s
  //       UPRISING → ground-rise: enemy y starts +18 below ground, rises
  drawSurpriseEvents(state: GameStateShape, tick: number): void {
    // 2026-05-18 — Iterate primary + extras. In endless mode, up to 3
    // surprise events can stack on the same wave (configured in
    // SurpriseEvents.maybeTriggerEndlessSurpriseEvent). The renderer
    // accumulates sprite-pool + atmos-pool indices across all events
    // so a 2-3 event stack renders each event's visuals without
    // stomping on the others. Overlay Graphics are cleared once at
    // the start and each event's overlay strokes accumulate into them.
    const events = getAllActiveSurpriseEvents(state);
    let activeIdx = 0;
    let atmosIdx = 0;

    // Clear overlay graphics ONCE so multiple events can accumulate.
    if (!this.uprisingOverlayGfx) {
      this.uprisingOverlayGfx = new Graphics();
      this.layers.fx.addChildAt(this.uprisingOverlayGfx, 0);
    }
    this.uprisingOverlayGfx.clear();
    if (!this.gatesOfHellOverlayGfx) {
      this.gatesOfHellOverlayGfx = new Graphics();
      this.layers.fx.addChildAt(this.gatesOfHellOverlayGfx, 0);
    }
    this.gatesOfHellOverlayGfx.clear();

    // ─── PER-EVENT VISUALS (urn/fire sprites, dust puffs, uprising
    //     overlay, atmos props). Iterates each active event so stacked
    //     endless chaos draws all of them. Gates-of-hell overlay sits
    //     after the loop because it iterates LIVE enemies, not points.
    for (const ev of events) {
    // 2026-05-17 — GATES OF HELL doesn't use the surpriseActiveSprites
    // pool (the HELL_GATE enemy renders via the normal enemy sprite
    // pipeline). Skip the sprite-pool loop for this kind so we don't
    // draw a phantom fire/urn over the gate enemy.
    if (ev.kind === SurpriseEventKind.GATES_OF_HELL) {
      // No sprite-pool entries to draw for gates; the live enemy
      // sprite handles it. Skip to the next section.
    } else if (ev) {
      const isInvasion = ev.kind === SurpriseEventKind.INVASION;
      // ── Per-point visual state (one sprite per pointId 0..3) ────────
      // Collect the unique pointIds in this event + the FIRST spawnAt
      // per point (drives fade-in / fade-out timing).
      const pointMeta = new Map<number, { vfxX: number; vfxY: number; firstSpawnAt: number; lastSpawnAt: number; allFired: boolean }>();
      for (const p of ev.spawnPoints) {
        const m = pointMeta.get(p.pointId);
        if (!m) {
          pointMeta.set(p.pointId, { vfxX: p.vfxX, vfxY: p.vfxY, firstSpawnAt: p.spawnAt, lastSpawnAt: p.spawnAt, allFired: p.fired });
        } else {
          m.firstSpawnAt = Math.min(m.firstSpawnAt, p.spawnAt);
          m.lastSpawnAt = Math.max(m.lastSpawnAt, p.spawnAt);
          if (!p.fired) m.allFired = false;
        }
      }

      for (const [pointId, meta] of pointMeta) {
        // Visual lifecycle for this point:
        //   t < firstSpawnAt - RISE       → fade in (alpha 0 → 1)
        //   between first/last spawnAt    → idle animation, full alpha
        //   after vfxFadeOutAt is set     → fade out (alpha 1 → 0)
        const fadeIn = Math.max(0, Math.min(1, (tick - (meta.firstSpawnAt - VFX_TIMING.RISE_SECONDS)) / VFX_TIMING.RISE_SECONDS));
        let alpha = fadeIn;
        if (ev.vfxFadeOutAt > 0) {
          const fadeP = (tick - ev.vfxFadeOutAt) / VFX_TIMING.FADEOUT_SECONDS;
          alpha = Math.max(0, 1 - fadeP);
        }
        if (alpha <= 0.005) continue;

        const sp = this.ensureSurpriseActiveSprite(activeIdx);
        if (isInvasion) {
          // Frame alternation: swap FIRE_SMALL / FIRE_LARGE every 0.13s
          // so the flame itself looks animated, not just a static sprite
          // breathing. Each point uses an offset so they don't all flip
          // on the same frame (avoids the "lock-step" look).
          const phase = (tick * 7.5 + pointId * 0.4) % 2;
          const frameKey = phase < 1 ? 'FIRE_LARGE' : 'FIRE_SMALL';
          const tx = tex(frameKey);
          if (tx) sp.texture = tx;
          // Scale jitter + wobble rotation — fire feels alive.
          const scaleJitter = 0.9 + 0.15 * Math.sin(tick * 11 + pointId * 1.3);
          const baseSize = GRID.TILE * 1.4;
          sp.width = baseSize * scaleJitter;
          sp.height = baseSize * (0.95 + 0.10 * Math.cos(tick * 9 + pointId));
          sp.rotation = Math.sin(tick * 6 + pointId * 0.7) * 0.08;     // ±4.5°
          sp.x = meta.vfxX;
          sp.y = meta.vfxY + GRID.TILE * 0.45;
          sp.anchor.set(0.5, 1.0);
          sp.alpha = alpha;
          sp.visible = true;
          // Ember particles flickering upward — emit every ~6 frames
          // (rate-limited via a hash key per-point so we don't allocate
          // 60 particles/sec). The gore particle pool is capped so this
          // is safe; older embers age out naturally.
          if ((this.surpriseEmberClock += 1) % 4 === 0) {
            this.spawnEmberParticle(meta.vfxX, meta.vfxY, /*warm=*/true);
          }
        } else {
          // UPRISING: urn rises from below over the RISE window.
          // 2026-05-17 — OVER-THE-TOP PASS. Urns are now 1.5× larger
          // (1.3 → 1.95 tile-widths), wobble harder, and the overlay
          // pass below draws orbiting skulls + soul column + aura ring
          // + ground cracks per urn. Spawn impact rings are doubled in
          // radius and ember bursts tripled — Death Uprising should
          // feel like a portal to the underworld is opening, not a
          // polite ceramic pot popping out of the ground.
          const tx = tex('SKULL_URN');
          if (tx) sp.texture = tx;
          // y offset: starts +28 px below (was +22) for a taller rise,
          // lerps to floor over the rise window. After rise, urn
          // breathes harder + wobbles further.
          const riseT = Math.max(0, Math.min(1, (tick - (meta.firstSpawnAt - VFX_TIMING.RISE_SECONDS)) / VFX_TIMING.RISE_SECONDS));
          const yOffset = (1 - riseT) * 28;
          const breathe = 1 + 0.10 * Math.sin(tick * 2.4 + pointId * 0.9);   // 0.06 → 0.10
          const wobble = Math.sin(tick * 1.5 + pointId * 0.6) * 0.10;        // ±3.5° → ±5.7°
          // Pre-spawn "rumble" — in the 0.25s before each spawn at this
          // point, wobble amplitude triples to signal "minion about to
          // emerge". Read by checking remaining time to next un-fired spawn.
          let preSpawnShake = 0;
          for (const p of ev.spawnPoints) {
            if (p.pointId !== pointId || p.fired) continue;
            const remaining = p.spawnAt - tick;
            if (remaining > 0 && remaining < 0.25) {
              preSpawnShake = Math.max(preSpawnShake, (1 - remaining / 0.25));
            }
          }
          const rumble = preSpawnShake * (Math.sin(tick * 40) * 2.5);        // 1.5 → 2.5 px
          const baseSize = GRID.TILE * 1.95;                                  // 1.3 → 1.95
          sp.width = baseSize * breathe;
          sp.height = baseSize * breathe;
          sp.rotation = wobble + preSpawnShake * Math.sin(tick * 35) * 0.18;  // 0.12 → 0.18
          sp.x = meta.vfxX + rumble;
          sp.y = meta.vfxY + GRID.TILE * 0.45 + yOffset;
          sp.anchor.set(0.5, 1.0);
          sp.alpha = alpha;
          sp.visible = true;
          // Mouth glow — purple ember escapes the urn's cavity faster
          // now (every ~3 frames vs 5). Sells the "alive and hungry"
          // feel, contrasts with the slower-burning invasion fires.
          if (riseT > 0.7 && (this.surpriseEmberClock += 1) % 3 === 0) {
            this.spawnEmberParticle(meta.vfxX, meta.vfxY - 4, /*warm=*/false);
            // Occasional "tall" soul wisp — 2x lifespan, slower velocity.
            if (Math.random() < 0.3) {
              this.spawnSoulWisp(meta.vfxX + (Math.random() - 0.5) * 12, meta.vfxY - 8);
            }
          }
        }
        activeIdx++;
      }
    }

    // ── Per-spawn dust puff (one-shot on each enemy emergence) ────────
    {
      const isUprising = ev.kind === SurpriseEventKind.UPRISING;
      for (let i = 0; i < ev.spawnPoints.length; i++) {
        const p = ev.spawnPoints[i];
        if (!p.fired) continue;
        const key = `${ev.startedAt.toFixed(2)}::${i}`;
        if (this.surpriseDustPuffsEmitted.has(key)) continue;
        this.surpriseDustPuffsEmitted.add(key);
        const ringColor = isUprising ? 0xaa66ff : 0xff8844;
        // 2026-05-17 — UPRISING gets a much bigger spawn punch: three
        // rings instead of two, doubled radii, and a triple-color outer
        // ring (deep purple) to read as a portal opening. Invasion path
        // stays as it was — the empire's on fire, no portal cosmology.
        if (isUprising) {
          this.triggerImpactRing(p.vfxX, p.vfxY + GRID.TILE * 0.4, tick,        48, ringColor);
          this.triggerImpactRing(p.vfxX, p.vfxY + GRID.TILE * 0.4, tick + 0.06, 76, ringColor);
          this.triggerImpactRing(p.vfxX, p.vfxY + GRID.TILE * 0.4, tick + 0.12, 110, 0x6622aa);
          // 12-ember burst (was 4) + 6 soul wisps drifting upward.
          for (let k = 0; k < 12; k++) this.spawnEmberParticle(p.vfxX, p.vfxY, false);
          for (let k = 0; k < 6; k++) {
            this.spawnSoulWisp(p.vfxX + (Math.random() - 0.5) * 18, p.vfxY - Math.random() * 6);
          }
          // Brief camera punch for each emergence — sells the moment.
          try { this.triggerShake?.(2, 0.18); } catch { /* renderer may not expose shake yet */ }
        } else {
          this.triggerImpactRing(p.vfxX, p.vfxY + GRID.TILE * 0.4, tick,        24, ringColor);
          this.triggerImpactRing(p.vfxX, p.vfxY + GRID.TILE * 0.4, tick + 0.06, 38, ringColor);
          for (let k = 0; k < 4; k++) this.spawnEmberParticle(p.vfxX, p.vfxY, true);
        }
      }
      if (this.surpriseDustPuffsEmitted.size > 64) {
        const drop = Array.from(this.surpriseDustPuffsEmitted).slice(0, 32);
        for (const k of drop) this.surpriseDustPuffsEmitted.delete(k);
      }
    }

    // ── UPRISING-only over-the-top overlay (skulls, soul columns,
    //    aura rings, ground cracks). Drawn on the shared Graphics
    //    cleared once at the top of the function so multiple uprising
    //    events accumulate into a single batch.
    const ug = this.uprisingOverlayGfx!;
    if (ev.kind === SurpriseEventKind.UPRISING) {
      // Same per-point envelope used by the urn sprite above so the
      // overlay fades in / out in lockstep.
      const pointMeta = new Map<number, { vfxX: number; vfxY: number; firstSpawnAt: number }>();
      for (const p of ev.spawnPoints) {
        const m = pointMeta.get(p.pointId);
        if (!m) pointMeta.set(p.pointId, { vfxX: p.vfxX, vfxY: p.vfxY, firstSpawnAt: p.spawnAt });
        else m.firstSpawnAt = Math.min(m.firstSpawnAt, p.spawnAt);
      }
      for (const [pointId, meta] of pointMeta) {
        const fadeIn = Math.max(0, Math.min(1, (tick - (meta.firstSpawnAt - VFX_TIMING.RISE_SECONDS)) / VFX_TIMING.RISE_SECONDS));
        let envAlpha = fadeIn;
        if (ev.vfxFadeOutAt > 0) {
          const fp = (tick - ev.vfxFadeOutAt) / VFX_TIMING.FADEOUT_SECONDS;
          envAlpha = Math.max(0, 1 - fp);
        }
        if (envAlpha <= 0.01) continue;
        const cx = meta.vfxX;
        const cy = meta.vfxY + GRID.TILE * 0.45;          // urn base y (matches sprite anchor)
        const tilesPulse = 1 + 0.18 * Math.sin(tick * 1.8 + pointId * 0.9);
        // 1. GROUND CRACKS — 8 jagged purple lines radiating from the urn
        //    base. Drawn first so they sit under everything else.
        const crackR = GRID.TILE * 1.4 * tilesPulse;
        const crackAlpha = 0.55 * envAlpha;
        ug.lineStyle(2, 0x5e1a8a, crackAlpha);
        for (let a = 0; a < 8; a++) {
          const baseAng = (a / 8) * Math.PI * 2 + pointId * 0.13;
          const jitter = Math.sin(tick * 3 + pointId + a) * 0.12;
          const ang = baseAng + jitter;
          const x1 = cx + Math.cos(ang) * (GRID.TILE * 0.25);
          const y1 = cy + Math.sin(ang) * (GRID.TILE * 0.10);
          // Two-segment crack: kink halfway out for an organic look.
          const midAng = ang + Math.sin(tick * 2 + a) * 0.30;
          const xm = cx + Math.cos(midAng) * (crackR * 0.55);
          const ym = cy + Math.sin(midAng) * (crackR * 0.30);     // squashed Y → ground perspective
          const xe = cx + Math.cos(ang) * crackR;
          const ye = cy + Math.sin(ang) * crackR * 0.50;
          ug.moveTo(x1, y1).lineTo(xm, ym).lineTo(xe, ye);
        }
        // 2. PULSING DARK-AURA RING — two stacked elliptical rings, the
        //    outer one breathes wider than the inner. Both squashed Y to
        //    sit on the ground plane.
        const innerR = GRID.TILE * 1.05 * tilesPulse;
        const outerR = GRID.TILE * 1.55 * tilesPulse;
        ug.lineStyle(3, 0xaa66ff, 0.45 * envAlpha);
        ug.drawEllipse(cx, cy + 4, innerR, innerR * 0.42);
        ug.lineStyle(2, 0x6622aa, 0.30 * envAlpha);
        ug.drawEllipse(cx, cy + 4, outerR, outerR * 0.42);
        // 3. SOUL COLUMN — vertical column of purple energy rising from
        //    the urn's mouth. Triangular gradient simulated with three
        //    semi-transparent rects of decreasing width.
        const colH = GRID.TILE * 2.6;
        const colTopY = cy - GRID.TILE * 1.95 - Math.sin(tick * 2.5 + pointId) * 4;
        const swell = 1 + 0.15 * Math.sin(tick * 4 + pointId * 1.7);
        const widths = [22, 14, 8];
        const colors = [0x4a1574, 0x8833cc, 0xcc88ff];
        const alphas = [0.18, 0.32, 0.48];
        for (let i = 0; i < widths.length; i++) {
          ug.beginFill(colors[i], alphas[i] * envAlpha);
          ug.drawRect(cx - (widths[i] * swell) / 2, colTopY, widths[i] * swell, colH);
          ug.endFill();
        }
        // Capping ellipse at the bottom of the column for a smooth blend
        // into the urn's mouth.
        ug.beginFill(0x8833cc, 0.40 * envAlpha);
        ug.drawEllipse(cx, cy - GRID.TILE * 0.55, 14, 5);
        ug.endFill();
        // 4. ORBITING FLOATING SKULLS — 4 skulls per urn drifting in an
        //    elliptical orbit. Each skull is drawn with 3 ellipses (head
        //    + jaw bevel + eye sockets) and 1 mouth line.
        const SKULLS_PER_URN = 4;
        for (let s = 0; s < SKULLS_PER_URN; s++) {
          const orbitT = tick * 0.55 + (s / SKULLS_PER_URN) * Math.PI * 2 + pointId * 0.7;
          const orbitR = GRID.TILE * 1.25;
          const sx = cx + Math.cos(orbitT) * orbitR;
          const sy = cy - GRID.TILE * 0.55 + Math.sin(orbitT) * orbitR * 0.42
                       + Math.sin(tick * 2.5 + s) * 2.5;                       // gentle bob
          // Behind-the-urn skulls get half alpha so depth reads correctly.
          const behind = Math.sin(orbitT) < 0;
          const sa = (behind ? 0.35 : 0.85) * envAlpha;
          const sz = 7 + (behind ? -1 : 1);                                    // tiny depth scale
          // Skull body (ivory) — slight purple tint.
          ug.beginFill(0xe8d6a8, sa * 0.92);
          ug.drawEllipse(sx, sy, sz, sz * 1.05);
          ug.endFill();
          // Jaw — narrower ellipse just below.
          ug.beginFill(0xc9b88a, sa * 0.92);
          ug.drawEllipse(sx, sy + sz * 0.55, sz * 0.7, sz * 0.45);
          ug.endFill();
          // Eye sockets — two black ovals.
          ug.beginFill(0x12080c, sa);
          ug.drawEllipse(sx - sz * 0.32, sy - sz * 0.15, sz * 0.22, sz * 0.30);
          ug.drawEllipse(sx + sz * 0.32, sy - sz * 0.15, sz * 0.22, sz * 0.30);
          ug.endFill();
          // Faint purple glow inside the eyes — gives them life.
          ug.beginFill(0xaa66ff, sa * 0.7);
          ug.drawCircle(sx - sz * 0.32, sy - sz * 0.15, sz * 0.10);
          ug.drawCircle(sx + sz * 0.32, sy - sz * 0.15, sz * 0.10);
          ug.endFill();
          // Tiny mouth gap.
          ug.lineStyle(1, 0x3a1a4a, sa);
          ug.moveTo(sx - sz * 0.30, sy + sz * 0.45).lineTo(sx + sz * 0.30, sy + sz * 0.45);
          ug.lineStyle(0);
        }
        // 5. EXTRA ROAMING SKULLS at larger orbits — 2 per urn that
        //    drift slower and wider, so the whole zone reads "haunted"
        //    rather than just "this urn has skulls around it".
        for (let s = 0; s < 2; s++) {
          const orbitT = tick * 0.32 + (s / 2) * Math.PI + pointId * 1.2;
          const orbitR = GRID.TILE * 2.05;
          const sx = cx + Math.cos(orbitT) * orbitR;
          const sy = cy - GRID.TILE * 0.95 + Math.sin(orbitT) * orbitR * 0.36;
          const sa = 0.55 * envAlpha;
          const sz = 5.5;
          ug.beginFill(0xc8b890, sa * 0.9);
          ug.drawEllipse(sx, sy, sz, sz * 1.05);
          ug.endFill();
          ug.beginFill(0x12080c, sa);
          ug.drawEllipse(sx - sz * 0.32, sy - sz * 0.15, sz * 0.20, sz * 0.28);
          ug.drawEllipse(sx + sz * 0.32, sy - sz * 0.15, sz * 0.20, sz * 0.28);
          ug.endFill();
          ug.beginFill(0xaa66ff, sa * 0.6);
          ug.drawCircle(sx - sz * 0.32, sy - sz * 0.15, sz * 0.09);
          ug.drawCircle(sx + sz * 0.32, sy - sz * 0.15, sz * 0.09);
          ug.endFill();
        }
      }
    }

    // ── GATES OF HELL warm-portal overlay (2026-05-17). Drawn around
    //    each live HELL_GATE enemy. Mirrors the uprising overlay layer
    //    pattern but in fire colors. Iterates LIVE enemies (not points)
    //    so it draws for every HELL_GATE on the field regardless of
    //    which event kind they belong to. Cleared once at top.
    const gg = this.gatesOfHellOverlayGfx!;
    if (ev.kind === SurpriseEventKind.GATES_OF_HELL) {
      // Find each live gate by its enemy entry. Stationary, so the
      // overlay sits at the enemy's current x/y.
      for (const e of state.enemies.values()) {
        if (e.type !== 'HELL_GATE') continue;
        // Fade-in factor based on time since spawn (matches the rise
        // window the gate sprite uses).
        const spawnTick = (e as any).__surpriseSpawnTick ?? state.tick;
        const fadeIn = Math.max(0, Math.min(1, (state.tick - spawnTick + VFX_TIMING.RISE_SECONDS) / VFX_TIMING.RISE_SECONDS));
        let envAlpha = fadeIn;
        // HP-based dim: as the gate takes damage, the overlay fades.
        // A near-dead gate has a half-strength overlay.
        const hpFrac = Math.max(0, e.hp / e.maxHp);
        envAlpha *= 0.35 + 0.65 * hpFrac;
        if (ev.vfxFadeOutAt > 0) {
          const fp = (state.tick - ev.vfxFadeOutAt) / VFX_TIMING.FADEOUT_SECONDS;
          envAlpha *= Math.max(0, 1 - fp);
        }
        if (envAlpha <= 0.01) continue;
        const cx = e.x;
        const cy = e.y + GRID.TILE * 0.45;             // ground anchor
        const tilesPulse = 1 + 0.18 * Math.sin(state.tick * 2.2);
        // 1. GROUND CRACKS — 10 jagged red-orange lines radiating from
        //    the gate base. Two-segment with mid-kink for organic feel.
        const crackR = GRID.TILE * 2.0 * tilesPulse;
        gg.lineStyle(2.5, 0xff5511, 0.50 * envAlpha);
        for (let a = 0; a < 10; a++) {
          const baseAng = (a / 10) * Math.PI * 2;
          const jitter = Math.sin(state.tick * 3 + a) * 0.14;
          const ang = baseAng + jitter;
          const x1 = cx + Math.cos(ang) * (GRID.TILE * 0.35);
          const y1 = cy + Math.sin(ang) * (GRID.TILE * 0.12);
          const midAng = ang + Math.sin(state.tick * 2.5 + a) * 0.32;
          const xm = cx + Math.cos(midAng) * (crackR * 0.55);
          const ym = cy + Math.sin(midAng) * (crackR * 0.30);
          const xe = cx + Math.cos(ang) * crackR;
          const ye = cy + Math.sin(ang) * crackR * 0.50;
          gg.moveTo(x1, y1).lineTo(xm, ym).lineTo(xe, ye);
        }
        // 2. PULSING FIRE AURA RING — two stacked elliptical rings,
        //    outer breathes wider than inner.
        const innerR = GRID.TILE * 1.4 * tilesPulse;
        const outerR = GRID.TILE * 2.1 * tilesPulse;
        gg.lineStyle(4, 0xff7733, 0.50 * envAlpha);
        gg.drawEllipse(cx, cy + 4, innerR, innerR * 0.42);
        gg.lineStyle(2.5, 0xaa3311, 0.35 * envAlpha);
        gg.drawEllipse(cx, cy + 4, outerR, outerR * 0.42);
        // 3. FIRE PILLAR through the arch — vertical 3-layer red-
        //    orange gradient rising from the gate's center.
        const colH = GRID.TILE * 3.2;
        const colTopY = cy - GRID.TILE * 2.5 - Math.sin(state.tick * 2.5) * 4;
        const swell = 1 + 0.18 * Math.sin(state.tick * 4.5);
        const widths = [28, 18, 10];
        const colors = [0x551100, 0xaa3311, 0xff7733];
        const alphas = [0.16, 0.30, 0.45];
        for (let i = 0; i < widths.length; i++) {
          gg.beginFill(colors[i], alphas[i] * envAlpha);
          gg.drawRect(cx - (widths[i] * swell) / 2, colTopY, widths[i] * swell, colH);
          gg.endFill();
        }
        // Cap ellipse at the bottom of the pillar.
        gg.beginFill(0xff7733, 0.45 * envAlpha);
        gg.drawEllipse(cx, cy - GRID.TILE * 0.45, 18, 6);
        gg.endFill();
        // 4. ORBITING EMBER DEMONS — 5 small fire orbs drifting in an
        //    elliptical orbit around the gate. Each is just a circle
        //    with a halo, no per-frame allocation.
        const ORBS = 5;
        for (let s = 0; s < ORBS; s++) {
          const orbitT = state.tick * 0.7 + (s / ORBS) * Math.PI * 2;
          const orbitR = GRID.TILE * 1.8;
          const sx = cx + Math.cos(orbitT) * orbitR;
          const sy = cy - GRID.TILE * 0.55 + Math.sin(orbitT) * orbitR * 0.42
                       + Math.sin(state.tick * 2.8 + s) * 2.5;
          const behind = Math.sin(orbitT) < 0;
          const sa = (behind ? 0.4 : 0.85) * envAlpha;
          const sz = 4 + (behind ? -0.5 : 0.5);
          // Outer halo glow
          gg.beginFill(0xff5522, sa * 0.40);
          gg.drawCircle(sx, sy, sz * 1.8);
          gg.endFill();
          // Inner bright core
          gg.beginFill(0xffaa44, sa);
          gg.drawCircle(sx, sy, sz);
          gg.endFill();
          // Brightest center
          gg.beginFill(0xfff0aa, sa * 0.9);
          gg.drawCircle(sx, sy, sz * 0.4);
          gg.endFill();
        }
        // Emit an ember particle every ~5 frames into the gore pool
        // for extra fire-fluff around the gate.
        if ((this.surpriseEmberClock += 1) % 5 === 0) {
          this.spawnEmberParticle(cx + (Math.random() - 0.5) * 14, cy - 8, /*warm=*/true);
        }
      }
    }

    // ── ATMOSPHERIC PROPS (2026-05-16 polish) ──────────────────────────
    // Small scattered fires (Invasion = "city is besieged"), or ritual
    // blood stains + purple smoke drift (Uprising = "burial ground").
    // Fade-in / fade-out tied to the same envelope as the main VFX so
    // the screen returns to clean once spawns drain. Per-prop animation
    // gives the dressing life without dominating attention. atmosIdx
    // accumulates across events (declared once at the top of the
    // function).
    if (ev.atmosProps) {
      // Reuse the same fade envelope the main fire/urn sprites use.
      let envAlpha = Math.max(0, Math.min(1, (tick - (ev.startedAt - 0.1)) / VFX_TIMING.RISE_SECONDS));
      if (ev.vfxFadeOutAt > 0) {
        const fadeP = (tick - ev.vfxFadeOutAt) / VFX_TIMING.FADEOUT_SECONDS;
        envAlpha = Math.max(0, 1 - fadeP);
      }
      if (envAlpha > 0.005) {
        for (const prop of ev.atmosProps) {
          const tx = tex(prop.spriteKey);
          let sp = this.surpriseAtmosSprites[atmosIdx];
          if (!sp) {
            sp = new Sprite(tx || undefined);
            sp.anchor.set(0.5);
            this.layers.fx.addChildAt(sp, 0);
            this.surpriseAtmosSprites.push(sp);
          }
          if (tx) sp.texture = tx;
          // Animation style varies by prop kind.
          let alpha = envAlpha;
          let rot = prop.rotation;
          let scaleMod = 1;
          let yOffset = 0;
          if (prop.kind === 'FIRE') {
            // Small fires: rapid flicker (scale + alpha modulation) and
            // gentle rotation wobble. Smaller than the main breach fires.
            const flick = 0.85 + 0.15 * Math.sin(tick * 12 + prop.flickerSeed);
            scaleMod = flick;
            rot += Math.sin(tick * 5 + prop.flickerSeed) * 0.05;
            alpha *= 0.75 + 0.20 * Math.sin(tick * 8 + prop.flickerSeed);
          } else if (prop.kind === 'STAIN') {
            // Ground stains: subtle alpha pulse only, no movement (they
            // sit ON the ground, no flicker). Slight desaturation pulse.
            scaleMod = 1;
            alpha *= 0.65 + 0.10 * Math.sin(tick * 1.5 + prop.flickerSeed);
          } else if (prop.kind === 'HAZE') {
            // Smoke drift: slow rotation + vertical bob + alpha pulse so
            // the haze feels gas-like instead of static.
            rot += tick * 0.4;
            yOffset = Math.sin(tick * 0.8 + prop.flickerSeed) * 4;
            scaleMod = 0.95 + 0.10 * Math.sin(tick * 0.7 + prop.flickerSeed);
            alpha *= 0.50 + 0.15 * Math.sin(tick * 0.9 + prop.flickerSeed);
          }
          const baseSize = prop.kind === 'FIRE' ? GRID.TILE * 0.9
                         : prop.kind === 'STAIN' ? GRID.TILE * 1.05
                         : GRID.TILE * 1.3;     // HAZE
          sp.x = prop.x;
          sp.y = prop.y + yOffset;
          sp.width = baseSize * prop.scale * scaleMod;
          sp.height = baseSize * prop.scale * scaleMod;
          sp.rotation = rot;
          sp.alpha = Math.max(0, Math.min(1, alpha));
          if (prop.tint !== undefined) sp.tint = prop.tint;
          else sp.tint = 0xffffff;
          sp.visible = true;
          atmosIdx++;
          // Spawn occasional embers from small fires too (rarer than the
          // main breach fires so they don't overwhelm the particle pool).
          if (prop.kind === 'FIRE' && (this.surpriseEmberClock += 1) % 12 === 0) {
            this.spawnEmberParticle(prop.x, prop.y, true);
          }
        }
      }
    }
    }   // ← end per-event for loop

    // ─── POST-LOOP ONE-TIME CLEANUP ───────────────────────────────
    // Hide unused active-sprite pool entries (urn/fire sprites).
    for (let i = activeIdx; i < this.surpriseActiveSprites.length; i++) {
      this.surpriseActiveSprites[i].visible = false;
    }
    // Hide unused atmospheric sprite pool entries.
    for (let i = atmosIdx; i < this.surpriseAtmosSprites.length; i++) {
      this.surpriseAtmosSprites[i].visible = false;
    }
    // v2 — NO PERSISTENT SCAR DRAWING. Any sprites still in the scar
    // pool from a prior frame are hidden.
    for (const sp of this.surpriseScarSprites) sp.visible = false;
    // If no events are active, clear the dust-puff cache so the next
    // event starts fresh (was previously gated by "else" of the
    // per-event check; moved here now that the per-event work is
    // inside the for-loop).
    if (events.length === 0 && this.surpriseDustPuffsEmitted.size > 0) {
      this.surpriseDustPuffsEmitted.clear();
    }

    // ── Screen tint overlay ────────────────────────────────────────────
    if (!this.surpriseTintGfx) {
      this.surpriseTintGfx = new Graphics();
      this.layers.hud.addChildAt(this.surpriseTintGfx, 0);
    }
    const tint = surpriseEventTintRGBA(state);
    this.surpriseTintGfx.clear();
    if (tint) {
      const color = (Math.round(tint.r * 255) << 16) | (Math.round(tint.g * 255) << 8) | Math.round(tint.b * 255);
      this.surpriseTintGfx.beginFill(color, tint.a);
      this.surpriseTintGfx.drawRect(0, 0, GRID.CANVAS_W, GRID.CANVAS_H);
      this.surpriseTintGfx.endFill();
    }
  }

  // Pool helper — grow lazily, never destroy.
  private ensureSurpriseActiveSprite(idx: number): Sprite {
    let sp = this.surpriseActiveSprites[idx];
    if (!sp) {
      sp = new Sprite();
      sp.anchor.set(0.5, 1.0);
      this.layers.fx.addChild(sp);
      this.surpriseActiveSprites.push(sp);
    }
    return sp;
  }

  // Ember particle — feeds the gore particle pool (capped, no allocation).
  // Warm = orange/red (fire); cold = purple (urn).
  private spawnEmberParticle(x: number, y: number, warm: boolean): void {
    // Hook into the gore particle system via a public field that main.ts
    // wires after construction. If not wired, no-op (renderer-only safe).
    const gore: any = (this.app as any).__attachedGore;
    if (!gore) return;
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 0.9;
    const sp = 60 + Math.random() * 80;
    gore.particles.push({
      x: x + (Math.random() - 0.5) * 10,
      y: y - 4,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 0.45 + Math.random() * 0.35,
      size: 1.6 + Math.random() * 1.2,
      color: warm ? (Math.random() < 0.5 ? 0xffaa44 : 0xff5522) : (Math.random() < 0.5 ? 0xcc66ff : 0x8833cc)
    });
    if (gore.particles.length > 400) gore.particles.shift();
  }

  // 2026-05-17 — UPRISING SOUL WISP. Larger, slower, longer-lived particle
  // than a regular ember. Reads as a "released soul" drifting up from the
  // skull urn. Same pool as embers (gore particles) but starts higher,
  // climbs slower, lives longer, and renders brighter/larger.
  private spawnSoulWisp(x: number, y: number): void {
    const gore: any = (this.app as any).__attachedGore;
    if (!gore) return;
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 0.4;     // tighter cone — wisps go up
    const sp = 28 + Math.random() * 22;                        // slower than embers
    gore.particles.push({
      x: x + (Math.random() - 0.5) * 6,
      y: y - 6,
      vx: Math.cos(a) * sp + Math.sin(Math.random() * 6) * 6,  // gentle horizontal drift
      vy: Math.sin(a) * sp,
      life: 1.1 + Math.random() * 0.6,                         // 2-3× ember lifespan
      size: 2.6 + Math.random() * 1.4,                         // larger than embers
      color: Math.random() < 0.5 ? 0xddaaff : 0xb060ff
    });
    if (gore.particles.length > 400) gore.particles.shift();
  }

  // ─── FACTION WEATHER OVERLAY ────────────────────────────────────────────
  // Draws a tinted, animated atmospheric layer over the play area while a
  // weather profile is active. Each particle kind has a distinct motion:
  //   MIST/MIASMA: slow drifting blobs
  //   SAND: fast horizontal sheets
  //   WIND: streak lines
  //   EMBER: rising sparks
  //   DUST: mild scrolling haze
  private weatherGfx?: Graphics;
  private weatherParticles: { x: number; y: number; vx: number; vy: number; size: number; life: number; maxLife: number }[] = [];
  private weatherKeyCache: string | null = null;
  // Real weather sprites per faction — use these instead of bare circles when
  // available. Falls back to procedural shapes if texture missing.
  private weatherSpriteFor(key: string): string | null {
    switch (key) {
      case 'DOGS': return 'WX_PACK_DUST';
      case 'CELTS': return 'WX_DRUIDIC_MIST';
      case 'CARTHAGE': return 'WX_SANDSTORM';
      case 'UNDEAD_CELTS': return 'WX_NECROTIC_MIASMA';
      case 'UNDEAD_CARTHAGE': return 'WX_CURSED_WIND';
      case 'SUPER_DEMONS': return 'WX_HELLSCAPE';
    }
    return null;
  }
  private weatherSpriteContainer?: Container;
  private weatherSpritePool: Sprite[] = [];
  drawWeather(state: GameStateShape, tick: number) {
    if (!this.weatherGfx) {
      this.weatherGfx = new Graphics();
      this.layers.fx.addChildAt(this.weatherGfx, 0);
    }
    if (!this.weatherSpriteContainer) {
      this.weatherSpriteContainer = new Container();
      this.layers.fx.addChildAt(this.weatherSpriteContainer, 1);
    }
    const wg = this.weatherGfx;
    const spriteContainer = this.weatherSpriteContainer;
    wg.clear();
    const key = state.weatherKey ?? null;
    if (key !== this.weatherKeyCache) {
      this.weatherParticles = [];
      // Hide all sprite particles when weather changes
      for (const sp of this.weatherSpritePool) sp.visible = false;
      this.weatherKeyCache = key;
    }
    if (!key) {
      for (const sp of this.weatherSpritePool) sp.visible = false;
      return;
    }
    const profile = FACTION_WEATHER[key];
    if (!profile) return;
    const intensity = state.weatherIntensity ?? 1;
    const W = GRID.CANVAS_W, H = GRID.CANVAS_H;

    // Tint vignette
    wg.beginFill(profile.color, profile.density * 0.18 * intensity).drawRect(0, 0, W, H).endFill();

    // Try to use the real Higgsfield weather sprite for this faction.
    const wxKey = this.weatherSpriteFor(key);
    const wxTex = wxKey ? tex(wxKey) : null;

    // Spawn particles up to a target count for this profile
    const targetCount = Math.floor(80 * profile.density * intensity);
    while (this.weatherParticles.length < targetCount) {
      this.weatherParticles.push(this.spawnWeatherParticle(profile));
    }

    // Ensure pool has enough sprites
    while (this.weatherSpritePool.length < this.weatherParticles.length) {
      const sp = wxTex ? new Sprite(wxTex) : new Sprite();
      sp.anchor.set(0.5);
      spriteContainer.addChild(sp);
      this.weatherSpritePool.push(sp);
    }

    // Tick + draw particles
    for (let i = this.weatherParticles.length - 1; i >= 0; i--) {
      const p = this.weatherParticles[i];
      p.life += 0.016;
      p.x += p.vx * 0.016 * 60;
      p.y += p.vy * 0.016 * 60;
      if (p.x < -50) p.x = W + 50;
      if (p.x > W + 50) p.x = -50;
      if (p.y < -50) p.y = H + 50;
      if (p.y > H + 50) p.y = -50;
      if (p.life > p.maxLife) {
        this.weatherParticles[i] = this.spawnWeatherParticle(profile);
        continue;
      }
      const fade = 1 - Math.abs((p.life / p.maxLife) - 0.5) * 2;
      const alpha = profile.density * fade * 0.8 * intensity;
      const sp = this.weatherSpritePool[i];
      if (wxTex && sp) {
        if (sp.texture !== wxTex) sp.texture = wxTex;
        sp.x = p.x;
        sp.y = p.y;
        sp.width = p.size * 1.5;
        sp.height = p.size * 1.5;
        sp.alpha = Math.min(1, alpha * 1.4);
        sp.visible = true;
        // Add motion-appropriate rotation for wind/sand
        if (profile.particleKind === 'WIND' || profile.particleKind === 'SAND') {
          sp.rotation = Math.atan2(p.vy, p.vx);
        } else {
          sp.rotation = 0;
        }
      } else {
        if (sp) sp.visible = false;
        // Fallback procedural (only if no sprite available)
        switch (profile.particleKind) {
          case 'MIST':
          case 'MIASMA':
          case 'DUST':
            wg.beginFill(profile.color, alpha).drawCircle(p.x, p.y, p.size).endFill();
            break;
          case 'SAND':
            wg.beginFill(profile.color, alpha * 0.6).drawRect(p.x, p.y, p.size * 4, p.size * 0.6).endFill();
            break;
          case 'WIND':
            wg.lineStyle(p.size * 0.4, profile.color, alpha);
            wg.moveTo(p.x, p.y).lineTo(p.x - p.vx * 0.3, p.y - p.vy * 0.3);
            wg.lineStyle(0);
            break;
          case 'EMBER':
            wg.beginFill(0xff6633, alpha).drawCircle(p.x, p.y, p.size * 0.6).endFill();
            wg.beginFill(0xffaa44, alpha * 0.7).drawCircle(p.x, p.y, p.size * 0.3).endFill();
            break;
        }
      }
    }
    // Hide any unused pool sprites
    for (let i = this.weatherParticles.length; i < this.weatherSpritePool.length; i++) {
      this.weatherSpritePool[i].visible = false;
    }
  }
  private spawnWeatherParticle(profile: typeof FACTION_WEATHER[string]) {
    const W = GRID.CANVAS_W, H = GRID.CANVAS_H;
    let vx = 0, vy = 0;
    let size = 8;
    let maxLife = 4;
    switch (profile.particleKind) {
      case 'MIST':
        vx = (Math.random() - 0.5) * 0.2; vy = -0.05; size = 22 + Math.random() * 14; maxLife = 6;
        break;
      case 'MIASMA':
        vx = (Math.random() - 0.5) * 0.3; vy = -0.03; size = 18 + Math.random() * 10; maxLife = 5;
        break;
      case 'DUST':
        vx = -0.3 - Math.random() * 0.2; vy = 0.05; size = 14 + Math.random() * 8; maxLife = 5;
        break;
      case 'SAND':
        vx = -1.2 - Math.random() * 0.6; vy = 0.05; size = 4 + Math.random() * 3; maxLife = 4;
        break;
      case 'WIND':
        vx = -0.8 - Math.random() * 0.4; vy = (Math.random() - 0.5) * 0.2; size = 3 + Math.random() * 2; maxLife = 3;
        break;
      case 'EMBER':
        vx = (Math.random() - 0.5) * 0.4; vy = -0.4 - Math.random() * 0.3; size = 3 + Math.random() * 2; maxLife = 3;
        break;
    }
    return {
      x: Math.random() * W, y: Math.random() * H,
      vx, vy, size, life: 0, maxLife
    };
  }

  // Render any loot orbs sitting on the field (during a wave, before auto-pickup).
  // Uses the real `u_orb_*` sprites with a gentle bob and rarity-tinted glow ring.
  private orbSprites: Map<string, Sprite> = new Map();
  drawLootOrbs(state: GameStateShape, tick: number) {
    const seen = new Set<string>();
    for (const orb of state.lootOrbs) {
      seen.add(orb.id);
      let sp = this.orbSprites.get(orb.id);
      if (!sp) {
        const key = `ORB_${orb.rarity}`;
        const t = tex(key) ?? tex('LOOT_ORB_GENERIC');
        if (!t) continue;
        sp = new Sprite(t);
        sp.anchor.set(0.5);
        sp.width = 22;
        sp.height = 22;
        this.layers.fx.addChild(sp);
        this.orbSprites.set(orb.id, sp);
      }
      const bob = Math.sin(tick * 4 + orb.x * 0.05) * 2;
      sp.x = orb.x;
      sp.y = orb.y - 8 + bob;
      sp.alpha = 0.85 + 0.15 * Math.sin(tick * 6);
    }
    for (const [id, sp] of this.orbSprites) {
      if (!seen.has(id)) {
        sp.destroy();
        this.orbSprites.delete(id);
      }
    }
  }

  // Pulsing red ring + GLITTER SPARKLE around towers that are part of an
  // available combo recipe. 2026-05: the old single ring was too easy to
  // miss in the noise of late-wave combat. The new look layers a rotating
  // 6-point sparkle on top so every combinable tower visibly "flutters".
  drawComboGlow(towerIds: Set<string>, state: GameStateShape, tick: number) {
    this.comboGfx.clear();
    const pulse = 0.5 + Math.sin(tick * 5) * 0.25;
    for (const id of towerIds) {
      const tw = state.towers.get(id); if (!tw) continue;
      const cx = tw.tileX * GRID.TILE + GRID.TILE / 2;
      const cy = tw.tileY * GRID.TILE + GRID.TILE / 2;
      // Base pulsing red ring (kept from previous look).
      this.comboGfx.lineStyle(3, 0xff3030, pulse);
      this.comboGfx.drawCircle(cx, cy, GRID.TILE * 0.65);
      this.comboGfx.lineStyle(0);
      // GLITTER: 6 sparkles rotating around the tower. Color cycles between
      // hot-yellow and white so it pops even against bright tower sprites.
      const sparkles = 6;
      const baseAngle = tick * 1.8;                   // rotation speed
      const orbitR    = GRID.TILE * 0.78;
      for (let s = 0; s < sparkles; s++) {
        const a = baseAngle + (s / sparkles) * Math.PI * 2;
        const sx = cx + Math.cos(a) * orbitR;
        const sy = cy + Math.sin(a) * orbitR;
        // Twinkle: each sparkle has its own out-of-phase pulse.
        const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(tick * 4 + s));
        const color   = s % 2 === 0 ? 0xffe082 : 0xffffff;
        const radius  = 2.0 + 1.5 * twinkle;
        this.comboGfx.beginFill(color, 0.85 * twinkle).drawCircle(sx, sy, radius).endFill();
        // 4-point star streak: tiny cross of pixels for that "shimmer" feel
        this.comboGfx.beginFill(color, 0.5 * twinkle).drawRect(sx - radius * 1.6, sy - 0.4, radius * 3.2, 0.8).endFill();
        this.comboGfx.beginFill(color, 0.5 * twinkle).drawRect(sx - 0.4, sy - radius * 1.6, 0.8, radius * 3.2).endFill();
      }
      // Soft inner gold halo to seal the look.
      this.comboGfx.beginFill(0xffd34d, 0.08 + 0.06 * pulse).drawCircle(cx, cy, GRID.TILE * 0.55).endFill();
    }
    // Pending towers: pulsing GOLD ring + drop shadow
    for (const tw of state.towers.values()) {
      const cx = tw.tileX * GRID.TILE + GRID.TILE / 2;
      const cy = tw.tileY * GRID.TILE + GRID.TILE / 2;
      // Drop shadow under every tower for separation from grass
      this.comboGfx.beginFill(0x000000, 0.35).drawEllipse(cx, cy + GRID.TILE * 0.45, GRID.TILE * 0.42, GRID.TILE * 0.18).endFill();
      if (tw.pending) {
        // RECIPE-READY PROSPECT (2026-05): a pending prospect that's part
        // of an available combo blinks GREEN at a faster cadence to scream
        // "keep me — I complete a recipe!" Saves the player from clicking
        // each tower one by one to check eligibility.
        const completesRecipe = towerIds.has(tw.id);
        const p = 0.55 + Math.sin(tick * (completesRecipe ? 9 : 6)) * 0.35;
        const isBumped = !!(tw as any).duplicateBumped;
        const ringColor = completesRecipe ? 0x66ff88 : (isBumped ? 0x66ddff : 0xffd34d);
        this.comboGfx.lineStyle(3, ringColor, p);
        this.comboGfx.drawCircle(cx, cy, GRID.TILE * 0.7);
        this.comboGfx.lineStyle(2, ringColor, p * 0.6);
        this.comboGfx.drawCircle(cx, cy, GRID.TILE * 0.85);
        if (completesRecipe) {
          // Hot inner glow + 4 corner pip flashes — unmistakable "KEEP ME"
          // signal layered on top of the standard pending-prospect ring.
          this.comboGfx.beginFill(0x66ff88, 0.18 + 0.18 * p).drawCircle(cx, cy, GRID.TILE * 0.6).endFill();
          const pipFlash = 0.55 + Math.sin(tick * 12) * 0.4;
          const pipR = 2.4;
          const off = GRID.TILE * 0.32;
          this.comboGfx.beginFill(0xbbffcc, pipFlash).drawCircle(cx - off, cy - off, pipR).endFill();
          this.comboGfx.beginFill(0xbbffcc, pipFlash).drawCircle(cx + off, cy - off, pipR).endFill();
          this.comboGfx.beginFill(0xbbffcc, pipFlash).drawCircle(cx - off, cy + off, pipR).endFill();
          this.comboGfx.beginFill(0xbbffcc, pipFlash).drawCircle(cx + off, cy + off, pipR).endFill();
        }
        if (isBumped) {
          // extra inner sparkle
          this.comboGfx.beginFill(0xffffff, 0.7 * p).drawCircle(cx + GRID.TILE * 0.35, cy - GRID.TILE * 0.35, 2).endFill();
          this.comboGfx.beginFill(0xffffff, 0.5 * p).drawCircle(cx - GRID.TILE * 0.35, cy + GRID.TILE * 0.30, 1.5).endFill();
        }
        this.comboGfx.lineStyle(0);
      }
    }
  }
}

function blendWithWhite(color: number, t: number): number {
  // t=0 → white, t=1 → color
  const r = (color >> 16) & 0xff, g = (color >> 8) & 0xff, b = color & 0xff;
  const rr = Math.round(255 + (r - 255) * t);
  const gg = Math.round(255 + (g - 255) * t);
  const bb = Math.round(255 + (b - 255) * t);
  return (rr << 16) | (gg << 8) | bb;
}
