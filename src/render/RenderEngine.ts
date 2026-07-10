import { Application, Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import { GRID, TIER_COLORS, FACTION_WEATHER, WAVE_MODIFIERS, WORLD, AURA_TILES, AURA_TILE_EFFECTS, WATER_ZONE } from '../constants';
import { TileType, GamePhase, TowerType, DamageType } from '../types';
import { GameStateShape, isWaveModifierActive } from '../GameState';
import { GoreState } from '../systems/GoreSystem';
import { towerEffectiveStats } from '../systems/TowerSystem';
import { tex, texFrame, texGridFrame } from './Assets';
import { biomeForWave, BIOMES, pickGrassTile, STATIC_BATTLE_DEBRIS } from './Biomes';
import waypointsData from '../data/waypoints.json';
import enemiesData from '../data/enemies.json';
// 2026-05-19 — Hero sprite tinting reads off towers.json `tint` field.
import towersData from '../data/towers.json';
// 2026-05-22 — Hero passive aura range rings read from herodefs. Each
// hero with a LOCAL_AURA / DUAL.local / DAMAGE_TYPE_RIDER passive
// gets a radius-sized ring on the map. GLOBAL_AURA heroes (Caesar /
// Scipio) get no ring because the effect has no spatial extent.
import HERO_DEFS_FOR_AURA from '../data/herodefs.json';
import { surpriseEventTintRGBA, VFX_TIMING, getAllActiveSurpriseEvents } from '../systems/SurpriseEvents';
import { SurpriseEventKind } from '../types';
import { heroIdForTowerType } from '../systems/HeroIdentity';
import { baseTowerAttackFlashWindow, isBaseTowerAttackAnimated } from '../systems/BaseTowerAttackAnimation';
import { isWaterPlacementBufferTile } from '../systems/GridManager';
import { enemySpriteSizeTiles } from './EnemySpriteScale';

// 2026-05-20 v2 — Per-hero halo ring assignment. Each ring style was
// hand-picked to match the hero's color tint + thematic identity:
//   • Caesar  → SUN HALO         (imperial / divine kingship — gold)
//   • Marius  → CROSSED SWORDS   (military reformer — blue + steel)
//   • Agrippa → RUNIC BLUE       (admiral / divination — naval blue)
//   • Agricola→ LAUREL WREATH    (frontier governor — peace + green)
//   • Scipio  → GOLD ROPE        (conqueror of Carthage — gold triumph)
//   • Sulla   → FLAME RED        (fire passive — pyre ward red)
// The remaining 3 ring styles (CRIMSON_DRIP, SKULL_SILVER, PLAIN_WHITE)
// are reserved for future additions / special states.
const HERO_RING_FOR: Record<string, string> = {
  HERO_CAESAR:   'HERO_RING_SUN_HALO',
  HERO_MARIUS:   'HERO_RING_CROSSED_SWORDS',
  HERO_AGRIPPA:  'HERO_RING_RUNIC_BLUE',
  HERO_AGRICOLA: 'HERO_RING_LAUREL_WREATH',
  HERO_SCIPIO:   'HERO_RING_GOLD_ROPE',
  HERO_SULLA:    'HERO_RING_FLAME_RED'
};

const HERO_ATTACK_SHEET_FOR: Record<string, string> = {
  HERO_MARIUS: 'HERO_ATTACK_MARIUS',
  HERO_AGRIPPA: 'HERO_ATTACK_AGRIPPA',
  HERO_AGRICOLA: 'HERO_ATTACK_AGRICOLA',
  HERO_SCIPIO: 'HERO_ATTACK_SCIPIO',
  HERO_CAESAR: 'HERO_ATTACK_CAESAR',
  HERO_SULLA: 'HERO_ATTACK_SULLA'
};

const HERO_ATTACK_FRAME_SIZE = 256;
const HERO_ATTACK_FRAME_COUNT = 9;
const BASE_TOWER_ATTACK_FRAME_SIZE = 128;
const BASE_TOWER_ATTACK_FRAME_COUNT = 9;
const ATTACK_SHEET_COLUMNS = 3;
const HERO_ATTACK_WINDOW = 0.50;

const MAX_TRANSIENT_SLASHES = 72;
const MAX_TRANSIENT_MUZZLE_FLASHES = 96;
const MAX_TRANSIENT_IMPACT_RINGS = 96;
const MAX_TRANSIENT_SPRITE_IMPACTS = 72;
const MAX_TRANSIENT_TELEGRAPH_RINGS = 32;
const MAX_TRANSIENT_CHARYBDIS_CURRENTS = 48;
const MAX_HERO_ABILITY_FX = 28;

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
  // Hero-only attack animation prototype. This is the first "Green TD /
  // Warcraft III" style pass: short release/recover overlays around the
  // hero sprite instead of full body spritesheets. Cleared every frame.
  heroAttackGfx: Graphics;
  // 2026-05 v9: dedicated Graphics for the druid sleep-dart trail
  // ribbons + orb glows. Cleared and redrawn every frame in
  // drawDruidSleepDarts().
  druidDartGfx: Graphics;
  // 2026-05 v10: dust-shield dome rendered behind elephants + soft
  // shimmer over protected ground allies. Cleared each frame.
  elephantAuraGfx: Graphics;
  // 2026-06-25 — constant violet "Nullifying Aura" dome around late-game
  // carriers that disable towers standing inside it. Cleared each frame.
  nullifyAuraGfx: Graphics;
  // 2026-05 v6 polish
  bossAuraGfx: Graphics;
  bossVignetteGfx: Graphics;
  // 2026-05-19 — Aura tile glow layer.
  auraTileGfx: Graphics;
  // 2026-05-21 V13 — Sprite container for the ornate Higgsfield-generated
  // aura medallions. Drawn ABOVE auraTileGfx (so the procedural halo
  // glow + occupied ring sits underneath, and the medallion artwork
  // sits on top). Populated once at construction; re-attached after
  // drawStatic's child-clearing pass.
  auraTileSprites!: Container;
  auraTileSpritesBuilt = false;
  // V27 — stone-tile rendering cache. Stone tile positions only change
  // on tower-sell / stone-sell events (a few times per wave), but
  // drawDynamic was rebuilding the entire tile layer + Aquila-stamp
  // Graphics every frame at 60 FPS. We hash the current stone set
  // each frame; if the hash matches the previous frame, we skip the
  // rebuild entirely. The hash uses 53-bit doubles so collisions are
  // effectively impossible at this grid size (988 cells).
  private __lastStoneHash = -1;
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
    daemonPortal?: Sprite;
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
  // 2026-05-20 v2 — Hero towers carry an optional `ring` sprite drawn
  // UNDER the hero so the player sees at a glance "this is the hero
  // unit." Ring is created once at tower-sprite construction and
  // position-synced + slowly rotated every frame.
  towerSprites: Map<string, { sp: Sprite; tier: Sprite | null; ring?: Sprite }>;
  selectedTowerId: string | null = null;
  // 2026-05 v11 (B3 Hover range): a second tower id whose range circle
  // renders in a dimmer color underneath the selected one. Driven by
  // canvas-mousemove + prospect-sidebar hover handlers in main.ts.
  hoveredTowerId: string | null = null;
  private lastAuraDrawTick = -Infinity;

  constructor() {
    this.app = new Application({
      width: GRID.CANVAS_W,
      height: GRID.CANVAS_H,
      background: '#1f4422',
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
    this.heroAttackGfx = new Graphics();
    this.druidDartGfx = new Graphics();
    this.layers.fx.addChild(this.druidDartGfx);   // above projectiles, with the rest of fx
    // 2026-05 v10: dedicated Graphics for the war-elephant dust shield
    // dome + protected-ally shimmer. Sits BELOW enemies on the overlay
    // layer so the dome reads behind the units it's protecting.
    this.elephantAuraGfx = new Graphics();
    this.layers.overlay.addChild(this.elephantAuraGfx);
    // 2026-06-25 — Nullifying Aura dome, sits just above the elephant dome
    // on the overlay so the violet ring reads clearly under the carriers.
    this.nullifyAuraGfx = new Graphics();
    this.layers.overlay.addChild(this.nullifyAuraGfx);
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
    // 2026-05-21 V13 — Sprite container for ornate aura medallions.
    // Populated lazily in drawAuraTiles (so the tex() lookup happens
    // after asset loading completes). Lives above auraTileGfx so the
    // animated halo glow sits underneath each medallion.
    this.auraTileSprites = new Container();
    this.layers.bg.addChild(this.auraTileSprites);
    this.layers.fx.addChild(this.bloodGfx);
    this.layers.fx.addChild(this.projGfx);
    this.layers.overlay.addChild(this.auraGfx, this.comboGfx, this.overlayGfx, this.rangeGfx);
    this.layers.overlay.addChild(this.bossAuraGfx);     // below enemies (overlay < enemies)
    this.layers.hud.addChild(this.bossVignetteGfx);     // above everything except UI
    this.layers.towers.addChild(this.tierPipGfx);
    this.layers.fx.addChild(this.heroAttackGfx);
    this.enemySprites = new Map();
    this.towerSprites = new Map();
  }

  private drawHeroAttackAnimation(g: Graphics, tw: any, cx: number, cy: number, angle: number, flashT: number) {
    const heroId = heroIdForTowerType(String(tw.type));
    if (!heroId || flashT <= 0) return;
    const age = 1 - flashT;
    const fade = Math.max(0, flashT);
    const forwardX = Math.cos(angle);
    const forwardY = Math.sin(angle);
    const rightX = Math.cos(angle + Math.PI / 2);
    const rightY = Math.sin(angle + Math.PI / 2);
    const tipX = cx + forwardX * (GRID.TILE * (0.45 + age * 0.35));
    const tipY = cy + forwardY * (GRID.TILE * (0.45 + age * 0.35));
    const c = (towersData as any)[tw.type]?.tint
      ? parseInt(String((towersData as any)[tw.type].tint).replace('#', ''), 16)
      : 0xffd34d;
    g.beginFill(c, 0.14 * fade).drawCircle(cx, cy, GRID.TILE * (0.62 + age * 0.18)).endFill();
    g.lineStyle(2.5 * fade, c, 0.58 * fade).drawCircle(cx, cy, GRID.TILE * (0.74 + age * 0.20));
    g.lineStyle(0);

    const drawSlash = (color: number, radius: number, width = 3, offset = 0) => {
      const sweep = 0.95 + age * 0.55;
      const a0 = angle - sweep * 0.5 + offset;
      const a1 = angle + sweep * 0.5 + offset;
      g.lineStyle((width + 5) * fade, color, 0.22 * fade);
      g.arc(cx + forwardX * 8, cy + forwardY * 8, radius, a0, a1, false);
      g.lineStyle(width * fade, color, 0.90 * fade);
      g.arc(cx + forwardX * 8, cy + forwardY * 8, radius, a0, a1, false);
      g.lineStyle(Math.max(1.5, width * 0.45) * fade, 0xffffff, 0.75 * fade);
      g.arc(cx + forwardX * 8, cy + forwardY * 8, radius - 5, a0 + 0.05, a1 - 0.05, false);
      g.lineStyle(0);
    };

    switch (heroId) {
      case 'HERO_MARIUS':
        drawSlash(0xd8e8ff, GRID.TILE * 0.72, 4, -0.08);
        drawSlash(0xffffff, GRID.TILE * 0.48, 2, 0.22);
        break;
      case 'HERO_SCIPIO':
        g.lineStyle(10 * fade, 0xffaa44, 0.18 * fade);
        g.moveTo(cx - forwardX * 8, cy - forwardY * 8);
        g.lineTo(tipX + forwardX * 26, tipY + forwardY * 26);
        g.lineStyle(4 * fade, 0xffd18a, 0.95 * fade);
        g.moveTo(cx - forwardX * 4, cy - forwardY * 4);
        g.lineTo(tipX + forwardX * 18, tipY + forwardY * 18);
        g.lineStyle(2 * fade, 0xffffff, 0.70 * fade);
        g.moveTo(cx + rightX * 4, cy + rightY * 4);
        g.lineTo(tipX + forwardX * 14 + rightX * 4, tipY + forwardY * 14 + rightY * 4);
        g.lineStyle(0);
        g.beginFill(0xfff0c0, 0.75 * fade).drawCircle(tipX + forwardX * 20, tipY + forwardY * 20, 5 + age * 5).endFill();
        break;
      case 'HERO_CAESAR':
        drawSlash(0xffd34d, GRID.TILE * 0.78, 4, 0.02);
        g.beginFill(0xfff4a8, 0.45 * fade).drawCircle(tipX, tipY, 5 + age * 6).endFill();
        for (let i = 0; i < 5; i++) {
          const a = angle - 0.45 + i * 0.225;
          g.lineStyle(1.5 * fade, 0xfff4a8, 0.7 * fade);
          g.moveTo(cx + Math.cos(a) * 12, cy + Math.sin(a) * 12);
          g.lineTo(cx + Math.cos(a) * 24, cy + Math.sin(a) * 24);
        }
        g.lineStyle(0);
        break;
      case 'HERO_AGRIPPA':
        g.beginFill(0x88bbff, 0.16 * fade).drawCircle(tipX, tipY, 10 + age * 8).endFill();
        g.lineStyle(9 * fade, 0x3366ff, 0.18 * fade);
        g.moveTo(cx - forwardX * 12, cy - forwardY * 12);
        g.lineTo(tipX + forwardX * 30, tipY + forwardY * 30);
        g.lineStyle(3 * fade, 0x88bbff, 0.9 * fade);
        g.moveTo(cx - forwardX * 10, cy - forwardY * 10);
        g.lineTo(tipX + forwardX * 22, tipY + forwardY * 22);
        g.lineStyle(1.5 * fade, 0xffffff, 0.65 * fade);
        g.moveTo(cx - forwardX * 4 + rightX * 5, cy - forwardY * 4 + rightY * 5);
        g.lineTo(tipX + forwardX * 18 + rightX * 5, tipY + forwardY * 18 + rightY * 5);
        g.lineStyle(0);
        break;
      case 'HERO_AGRICOLA':
        g.beginFill(0xaaccff, 0.16 * fade).drawCircle(tipX, tipY, 8 + age * 7).endFill();
        g.lineStyle(8 * fade, 0x6fc8ff, 0.18 * fade);
        g.arc(cx, cy, GRID.TILE * 0.56, angle - 1.05, angle + 1.05, false);
        g.lineStyle(3 * fade, 0xaaccff, 0.9 * fade);
        g.arc(cx, cy, GRID.TILE * 0.48, angle - 0.95, angle + 0.95, false);
        g.lineStyle(2 * fade, 0xe8f8ff, 0.85 * fade);
        g.moveTo(cx - rightX * 11, cy - rightY * 11);
        g.lineTo(tipX + forwardX * 18, tipY + forwardY * 18);
        g.lineStyle(0);
        break;
      case 'HERO_SULLA':
        g.beginFill(0xff7733, 0.42 * fade).drawCircle(cx, cy, GRID.TILE * (0.42 + age * 0.35)).endFill();
        g.beginFill(0xffd34d, 0.20 * fade).drawCircle(tipX, tipY, 10 + age * 10).endFill();
        g.lineStyle(8 * fade, 0xff5522, 0.20 * fade);
        g.arc(cx, cy, GRID.TILE * 0.66, angle - 0.85, angle + 0.85, false);
        g.lineStyle(3 * fade, 0xffb066, 0.9 * fade);
        g.arc(cx, cy, GRID.TILE * 0.58, angle - 0.75, angle + 0.75, false);
        g.lineStyle(0);
        for (let i = 0; i < 4; i++) {
          const a = angle - 0.5 + i * 0.33;
          g.beginFill(i % 2 ? 0xffd34d : 0xff5522, 0.55 * fade)
            .drawCircle(cx + Math.cos(a) * (15 + age * 12), cy + Math.sin(a) * (15 + age * 12), 2.5)
            .endFill();
        }
        break;
      default:
        g.lineStyle(8 * fade, c, 0.18 * fade);
        g.arc(cx, cy, GRID.TILE * 0.66, angle - 0.8, angle + 0.8, false);
        g.lineStyle(3 * fade, c, 0.85 * fade);
        g.arc(cx, cy, GRID.TILE * 0.58, angle - 0.7, angle + 0.7, false);
        g.lineStyle(0);
    }
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
  private oceanAmbientGfx?: Graphics;
  private oceanLivingSprites: { sp: Sprite; baseX: number; baseY: number; baseAlpha: number; phase: number; ampX: number; ampY: number }[] = [];
  drawAmbient(tick: number, wave: number = 0, isBossWave: boolean = false, caveBActive: boolean = false) {
    // 2026 v2 spec Ch7 — Cave B stays HIDDEN until its first enemy emerges
    // (caveBActive, set in the spawn loop). The frame it activates, the
    // archway bursts into view with a one-time eruption (triple molten ring +
    // screen shake), keeping the second front a genuine surprise. Visibility
    // is driven every frame so a fresh run / sandbox jump re-hides it.
    const caveBData = (waypointsData as any).caveB;
    if (caveBData) {
      const cbGfx = (this as any).__caveBGfx as Graphics | undefined;
      const cbSpr = (this as any).__caveBSprite as Sprite | undefined;
      if (cbGfx) cbGfx.visible = caveBActive;
      if (cbSpr) cbSpr.visible = caveBActive;
      if (!caveBActive) (this as any).__caveBErupted = false;
      else if (!(this as any).__caveBErupted) {
        (this as any).__caveBErupted = true;
        const ex = caveBData.col * GRID.TILE + GRID.TILE / 2;
        const ey = caveBData.row * GRID.TILE + GRID.TILE / 2;
        this.triggerImpactRing(ex, ey, tick, 40, 0xff5522);
        this.triggerImpactRing(ex, ey, tick + 0.08, 72, 0xffaa33);
        this.triggerImpactRing(ex, ey, tick + 0.16, 110, 0xff3018);
        this.triggerShake(5, 0.4);
      }
    }
    if (!this.ambientGfx) {
      this.ambientGfx = new Graphics();
      this.layers.fx.addChildAt(this.ambientGfx, 0);
    }
    if (!this.grassWindGfx) {
      // Grass wind sits above bg but below towers, so it doesn't obscure paths/units.
      this.grassWindGfx = new Graphics();
      this.layers.bg.addChild(this.grassWindGfx);
    }
    if (!this.grassWindGfx.parent) this.layers.bg.addChild(this.grassWindGfx);
    if (!this.oceanAmbientGfx) {
      this.oceanAmbientGfx = new Graphics();
      this.layers.bg.addChild(this.oceanAmbientGfx);
    }
    if (!this.oceanAmbientGfx.parent) this.layers.bg.addChild(this.oceanAmbientGfx);
    const a = this.ambientGfx;
    const g = this.grassWindGfx;
    const ocean = this.oceanAmbientGfx;
    a.clear();
    g.clear();
    ocean.clear();

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

    // OCEAN LIVING MOTION — a few low-alpha wave glints and tiny detail
    // bobs so the cove breathes without redrawing tile sprites every frame.
    const tileRef = (this as any).__lastTileRef as TileType[][] | undefined;
    if (tileRef) {
      const reduced = !!(window as any).__reduceMotion;
      const waveSpeed = reduced ? 0.22 : 0.72;
      const gameState: any = (globalThis as any).__lastState ?? (globalThis as any).__game ?? null;
      const surgeT = Math.max(0, Math.min(1, (((gameState as any)?.__oceanSurgeUntil ?? 0) - tick) / 6.0));
      const warnT = Math.max(0, Math.min(1, (((gameState as any)?.__oceanWarningUntil ?? 0) - tick) / 7.5));
      const harborAwake = !!(gameState as any)?.harborUnlocked;
      for (let r = WATER_ZONE.row; r < WATER_ZONE.row + WATER_ZONE.height; r++) {
        for (let pass = 0; pass < 2; pass++) {
          const y = r * GRID.TILE + 8 + ((r * 5 + pass * 13) % 16);
          const phase = tick * waveSpeed * (1 + surgeT * 2.2 + warnT * 0.8) + r * 0.41 + pass * 1.7;
          for (let c = WATER_ZONE.col; c < WATER_ZONE.col + WATER_ZONE.width; c += 2) {
            if (tileRef[r]?.[c] !== TileType.WATER) continue;
            const neighborWater = tileRef[r]?.[c + 1] === TileType.WATER;
            const x = c * GRID.TILE + 5 + Math.sin(phase + c * 0.52) * (2.4 + surgeT * 3.6);
            const len = neighborWater ? 17 : 9;
            const pulse = 0.52 + 0.48 * Math.sin(phase * 1.35 + c * 0.8);
            const alpha = (pass === 0 ? 0.115 : 0.075) * pulse + warnT * 0.035 + surgeT * 0.075;
            const color = surgeT > 0.05 ? 0xb9f7ff : warnT > 0.05 ? 0x76e3ff : 0xd8fff6;
            ocean.beginFill(color, alpha).drawRect(Math.round(x), Math.round(y), len + Math.round(surgeT * 8), 1).endFill();
            if ((c + r + pass) % 4 === 0) {
              ocean.beginFill(0x0a3148, 0.055 + 0.035 * pulse).drawRect(Math.round(x + 4), Math.round(y + 3), Math.max(4, len - 6), 1).endFill();
            }
          }
        }
      }
      if (warnT > 0 || surgeT > 0 || harborAwake) {
        const x = WATER_ZONE.col * GRID.TILE + 8;
        const y = (WATER_ZONE.row + WATER_ZONE.height - 3.35) * GRID.TILE;
        const glow = Math.max(harborAwake ? 0.16 : 0, warnT * 0.28, surgeT * 0.48);
        ocean.beginFill(surgeT > 0.05 ? 0xb9f7ff : 0x5fe6ff, glow)
          .drawEllipse(x + GRID.TILE * 2.25, y + GRID.TILE * 1.65, GRID.TILE * (2.5 + surgeT), GRID.TILE * (0.85 + surgeT * 0.45))
          .endFill();
        if (surgeT > 0.05) {
          const foamY = y + GRID.TILE * 1.55 + Math.sin(tick * 9) * 3;
          ocean.lineStyle(3, 0xdffff7, 0.35 * surgeT);
          ocean.moveTo(x + 8, foamY);
          ocean.bezierCurveTo(x + 42, foamY - 14, x + 86, foamY + 14, x + 132, foamY - 4);
          ocean.lineStyle(0);
        }
      }
    }
    for (const entry of this.oceanLivingSprites) {
      const breath = Math.sin(tick * 0.9 + entry.phase);
      const drift = Math.sin(tick * 0.45 + entry.phase * 1.7);
      entry.sp.x = entry.baseX + drift * entry.ampX;
      entry.sp.y = entry.baseY + breath * entry.ampY;
      entry.sp.alpha = entry.baseAlpha * (0.88 + 0.12 * Math.sin(tick * 0.65 + entry.phase));
      entry.sp.rotation = Math.sin(tick * 0.35 + entry.phase) * 0.018;
    }

    // 2026-05-21 — BIOME TINT OVERLAY (visual overhaul phase V3).
    // Replaces the smooth wave-progression brown overlay with a
    // discrete per-biome tint that snaps at wave-band boundaries
    // (W1-3 / W4-6 / W7-10 / W11-15 / W16-18 / W19-20). Each biome
    // contributes its own color + alpha so the map's mood shifts
    // visibly as the campaign progresses, even before the new
    // Higgsfield sprites land. Tint is intentionally subtle
    // (alpha 0.04-0.18) so the underlying terrain still reads
    // clearly — stronger tints would make the map look gel-filtered.
    const biomeTint = BIOMES[biomeForWave(wave)].tint;
    if (biomeTint.alpha > 0.005) {
      a.beginFill(biomeTint.color, biomeTint.alpha).drawRect(0, 0, GRID.CANVAS_W, GRID.CANVAS_H).endFill();
    }

    // 2026-05-22 V15 — STORM CLOUDS scaling with wave progression.
    // Slow drifting dark blobs that pass over the playfield. Both the
    // count and the per-cloud darkness scale with wave number, so the
    // sky visibly thickens as the campaign turns from sunny grassland
    // (W1-3) into stormy hellscape (W19-20). Each cloud is composed
    // of 3 overlapping ellipses for a natural lumpy silhouette.
    //
    // Wave scaling:
    //   count  = clamp(2 + floor(wave/3), 2, 12)   // 2 @ W1 → 12 @ W30+
    //   alphaB = 0.06 + min(0.10, wave * 0.006)    // 0.066 → 0.18
    //   tint   = warm gray (W<=6) → cool slate (W7-15) → ash crimson (W16+)
    //
    // Clouds sit in the same fx layer as the biome tint so they
    // additively darken the playfield. Local (per-ellipse) rather
    // than a flat overlay so towers + enemies still read clearly
    // between cloud passes.
    {
      // 2026-05-22 M5 — On mobile, halve cloud count (W20 goes from
       // 8 clouds → 4). Each cloud is 3 overlapping ellipses re-drawn
       // every frame, so this is a real CPU + fill-rate saving on
       // phones without losing the atmospheric layered look.
      const mobilePerf = !!(window as any).__isMobile;
      const cloudCount = Math.max(2, Math.min(mobilePerf ? 6 : 12, 2 + Math.floor(wave / (mobilePerf ? 5 : 3))));
      const alphaBase = 0.06 + Math.min(0.10, wave * 0.006);
      // Tint shifts colder/darker as the campaign progresses
      let cloudColor: number;
      if (wave <= 6)       cloudColor = 0x4a4438;     // warm overcast gray
      else if (wave <= 15) cloudColor = 0x1e2438;     // cool slate / storm
      else                 cloudColor = 0x180a0a;     // ash + ember crimson
      // Boss waves get a darker, denser pass
      const bossMult = isBossWave ? 1.4 : 1.0;
      for (let i = 0; i < cloudCount; i++) {
        // Per-cloud seeded phase so movement is varied
        const phase = i * 1.31;
        // Slow horizontal drift (one full traversal per ~50s)
        const driftSpeed = 0.018 + (i % 3) * 0.004;
        const driftX = ((tick * driftSpeed + i * 0.27) % 1.3 - 0.15) * (GRID.CANVAS_W + 280);
        // Vertical drift = subtle sine bob
        const baseY = 60 + ((i * 173) % (GRID.CANVAS_H - 120));
        const cy = baseY + Math.sin(tick * 0.18 + phase) * 14;
        const cx = -140 + driftX;
        // Per-cloud size — bigger clouds appear later in the campaign
        const sizeBoost = 1.0 + Math.min(0.7, wave * 0.025);
        const w1 = 110 * sizeBoost, h1 = 40 * sizeBoost;
        const w2 = 80  * sizeBoost, h2 = 32 * sizeBoost;
        const w3 = 60  * sizeBoost, h3 = 28 * sizeBoost;
        // Soft alpha pulse so clouds breathe instead of looking flat
        const aPulse = 0.85 + 0.15 * Math.sin(tick * 0.4 + phase);
        const aTotal = Math.min(0.30, alphaBase * bossMult * aPulse);
        // 3 overlapping ellipses make a lumpy silhouette
        a.beginFill(cloudColor, aTotal).drawEllipse(cx,         cy,         w1, h1).endFill();
        a.beginFill(cloudColor, aTotal * 0.95).drawEllipse(cx - 70,    cy + 8,     w2, h2).endFill();
        a.beginFill(cloudColor, aTotal * 0.90).drawEllipse(cx + 60,    cy - 6,     w3, h3).endFill();
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

    // 2026-05-21 — AMBIENT SPRITE LIFE (visual overhaul phase V10).
    // Procedural Graphics-based animated elements that add motion +
    // narrative without sprite assets: flickering torches at the
    // cave + gate flanks, swaying banners on the gate, a Roman
    // standard near the gate, distant bird shadow drifting across
    // the map, smoke columns from the far corners. All driven by
    // sin-waves; zero per-frame allocation.

    // ── 4 FLICKERING TORCHES ─────────────────────────────────────
    // 2 flank the cave (top-left), 2 flank the gate (bottom-right).
    // Each torch = (1) brass pole rect, (2) flame triangle, (3) glow
    // halo. Flicker via per-torch sin offset so they're not in sync.
    const drawTorch = (px: number, py: number, phase: number) => {
      const fl = 0.55 + 0.25 * Math.sin(tick * 12 + phase) + 0.20 * Math.sin(tick * 23.4 + phase * 1.7);
      // Pole (brass)
      a.beginFill(0x6a4a18, 0.95).drawRect(px - 1.2, py, 2.4, 9).endFill();
      // Flame core (orange)
      a.beginFill(0xff7a18, 0.85 * fl);
      a.moveTo(px - 3.5, py).lineTo(px, py - 9 - fl * 2).lineTo(px + 3.5, py).lineTo(px - 3.5, py);
      a.endFill();
      // Flame highlight (yellow)
      a.beginFill(0xffe066, 0.75 * fl);
      a.moveTo(px - 1.8, py - 1).lineTo(px, py - 6 - fl).lineTo(px + 1.8, py - 1).lineTo(px - 1.8, py - 1);
      a.endFill();
      // Soft glow halo
      a.beginFill(0xff9a30, 0.18 * fl).drawCircle(px, py - 4, 12 + fl * 3).endFill();
    };
    drawTorch(caveCx - 38, caveCy + 10, 0);
    drawTorch(caveCx + 38, caveCy + 10, 1.7);
    drawTorch(gateCx - 36, gateCy - 14, 0.9);
    drawTorch(gateCx + 36, gateCy - 14, 2.4);

    // ── 2 SWAYING BANNERS ON THE GATE ─────────────────────────────
    // Red Roman war banners with gold trim, hung from invisible poles
    // above the gate watchtowers. Sway via x-skew offset.
    const drawBanner = (px: number, py: number, phase: number) => {
      const sway = Math.sin(tick * 1.4 + phase) * 2.2;
      // Pole
      a.beginFill(0x3a2a18, 0.95).drawRect(px - 0.8, py - 16, 1.6, 22).endFill();
      // Pole finial (gold ball)
      a.beginFill(0xffd34d, 0.95).drawCircle(px, py - 17, 1.6).endFill();
      // Banner (red trapezoid w/ sway)
      a.beginFill(0xa01818, 0.92);
      a.moveTo(px + 0.8, py - 14);
      a.lineTo(px + 9 + sway, py - 14 + sway * 0.5);
      a.lineTo(px + 9 + sway, py + 4 + sway * 0.5);
      a.lineTo(px + 0.8, py + 2);
      a.lineTo(px + 0.8, py - 14);
      a.endFill();
      // Gold trim border
      a.lineStyle(0.7, 0xffd34d, 0.95);
      a.moveTo(px + 0.8, py - 14).lineTo(px + 9 + sway, py - 14 + sway * 0.5);
      a.moveTo(px + 9 + sway, py - 14 + sway * 0.5).lineTo(px + 9 + sway, py + 4 + sway * 0.5);
      a.moveTo(px + 9 + sway, py + 4 + sway * 0.5).lineTo(px + 0.8, py + 2);
      a.lineStyle(0);
      // Gold SPQR mark (single dot — too small for real letters)
      a.beginFill(0xffd34d, 0.85).drawCircle(px + 5 + sway * 0.5, py - 5 + sway * 0.3, 1.1).endFill();
    };
    drawBanner(gateCx - 22, gateCy - 24, 0);
    drawBanner(gateCx + 22, gateCy - 24, 0.9);

    // ── 1 ROMAN STANDARD (Aquila eagle on a pole) ────────────────
    const standardX = gateCx;
    const standardY = gateCy - 4;
    {
      const sw = Math.sin(tick * 0.8) * 1.4;
      // Pole
      a.beginFill(0x4a3018, 0.95).drawRect(standardX - 0.7 + sw * 0.2, standardY - 28, 1.4, 26).endFill();
      // Eagle body — diamond
      a.beginFill(0xffd34d, 0.95);
      a.moveTo(standardX + sw, standardY - 30);
      a.lineTo(standardX + 3 + sw, standardY - 26);
      a.lineTo(standardX + sw, standardY - 22);
      a.lineTo(standardX - 3 + sw, standardY - 26);
      a.endFill();
      // Eagle wings (spread V)
      a.lineStyle(1.4, 0xc88a18, 0.95);
      a.moveTo(standardX - 6 + sw, standardY - 27).lineTo(standardX + sw, standardY - 25);
      a.moveTo(standardX + 6 + sw, standardY - 27).lineTo(standardX + sw, standardY - 25);
      a.lineStyle(0);
      // Red tassels
      a.beginFill(0xa01818, 0.85).drawRect(standardX - 2 + sw, standardY - 21, 1, 5).endFill();
      a.beginFill(0xa01818, 0.85).drawRect(standardX + 1 + sw, standardY - 21, 1, 5).endFill();
    }

    // ── BIRD SHADOW DRIFT (crosses map every ~30s) ───────────────
    // Distance from spawn is the time-of-flight phase.
    const birdT = (tick * 0.06) % 1.0;
    const birdX = -20 + birdT * (GRID.CANVAS_W + 40);
    const birdY = 90 + Math.sin(birdT * Math.PI * 2.5) * 30;
    // Bird as 2 swept V-strokes (wings) — black silhouette
    a.lineStyle(1.6, 0x000000, 0.38);
    const wingPhase = Math.sin(tick * 6 + birdX * 0.04);
    a.moveTo(birdX - 5, birdY + wingPhase * 1.5).lineTo(birdX, birdY - 2);
    a.moveTo(birdX, birdY - 2).lineTo(birdX + 5, birdY + wingPhase * 1.5);
    a.lineStyle(0);

    // ── 2 SMOKE COLUMNS (drift from distant corners) ─────────────
    // Far top-right and bottom-left corners. Rising smoke from
    // unseen ruins beyond the map edge.
    const drawSmokeColumn = (px: number, py: number, phase: number) => {
      for (let i = 0; i < 4; i++) {
        const t = tick * 0.4 + i * 0.9 + phase;
        const drift = Math.sin(t * 1.3) * 6;
        const cy = py - (t % 4) * 14;
        const alpha = 0.10 - (i / 4) * 0.06;
        a.beginFill(0x8a8a90, Math.max(0, alpha)).drawCircle(px + drift, cy, 8 + i * 1.2).endFill();
      }
    };
    drawSmokeColumn(GRID.CANVAS_W - 60, 60, 0);
    drawSmokeColumn(60, GRID.CANVAS_H - 80, 1.3);

    // 2026-05-22 V21 — Distant lightning flash removed per design
    // feedback. The full-canvas white flash on boss waves was reading
    // as distracting / disorienting rather than atmospheric. Other
    // ambient cues (storm clouds darkening, biome tint, banner pulse)
    // already carry the boss-wave mood.
    void isBossWave;
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

    // 2026-05-21 V13 — Build the medallion sprite layer once. Each tile
    // gets a Sprite anchored at its center, sized to fill the tile.
    // We rebuild on first call after textures are available, then
    // never touch the sprite positions again (aura tiles are static).
    if (!this.auraTileSpritesBuilt) {
      const auraSpriteKey: Record<string, string> = {
        PURPLE: 'MAP_AURA_PURPLE', BLUE: 'MAP_AURA_BLUE',
        RED: 'MAP_AURA_RED', CYAN: 'MAP_AURA_CYAN',
        GOLD: 'MAP_AURA_GOLD', EMERALD: 'MAP_AURA_EMERALD',
        IVORY: 'MAP_AURA_IVORY', AMBER: 'MAP_AURA_AMBER',
        TIDE: 'MAP_AURA_TIDE',
      };
      let allLoaded = true;
      for (const a of AURA_TILES) {
        const sprKey = auraSpriteKey[a.kind];
        const texx = sprKey ? tex(sprKey) : null;
        if (!texx) { allLoaded = false; break; }
      }
      if (allLoaded) {
        for (const a of AURA_TILES) {
          const sp = new Sprite(tex(auraSpriteKey[a.kind])!);
          sp.anchor.set(0.5);
          sp.x = a.col * GRID.TILE + GRID.TILE / 2;
          sp.y = a.row * GRID.TILE + GRID.TILE / 2;
          // Slightly larger than the tile (1.25× = 40px) so the
          // ornate medallion reads as a raised feature, not flat.
          sp.width = GRID.TILE * 1.25;
          sp.height = GRID.TILE * 1.25;
          this.auraTileSprites.addChild(sp);
        }
        this.auraTileSpritesBuilt = true;
      }
    }

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

      // 2026-05-21 V13 — The ornate sprite medallion now draws the
      // tile face (with its own engraved iconography + gem + bronze
      // rim). The procedural layers below provide ANIMATION only —
      // pulsing color halo around the medallion + occupied-ring +
      // rotating spokes when a tower sits on the tile.
      //
      // ── 1. OUTER HALO (large soft color bloom) ──
      gfx.beginFill(eff.color, 0.16 + 0.10 * pulse);
      gfx.drawCircle(cx, cy, GRID.TILE * 0.95 + pulse * 8);
      gfx.endFill();
      // ── 2. INNER HALO (denser, behind the medallion) ──
      gfx.beginFill(eff.color, 0.22 + 0.10 * pulse);
      gfx.drawCircle(cx, cy, GRID.TILE * 0.70 + pulse * 4);
      gfx.endFill();

      // 2026-05-21 V13 — Sigil overlay + center pip removed. The
      // Higgsfield-generated medallion sprites carry the engraved
      // Roman iconography (SPQR columns, Aquila eagle, crossed swords,
      // wave crests, laurel wreath, watchtower eye) and the central gem
      // already. Procedural overlays at this scale would clash with the
      // raised relief of the sprite. The two pulsing halos above
      // provide all the animation the tiles need.
      // Touching `a`/`eff`/`cx`/`cy`/`occupied`/`pulse` only as inputs;
      // no additional draws on the procedural Graphics layer.
      void a; void eff; void cx; void cy; void occupied; void pulse;
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
  // 2026 v2 spec Ch13 — UNIVERSAL BOSS/ELITE GLOW (name kept for caller
  // stability; behaviour now matches the global standard). Every live boss
  // OR elite (`isElite` flagged on Giants/Cyclops/myth in Phase 7) carries
  // an always-on pulsing orange #E87020 aura: the "this unit is dangerous"
  // signal JB asked to bring back. 1.2s pulse, 60% peak opacity (80% for the
  // biggest units via __bigGlow), ~4px ring (6px biggest). Sits behind/around
  // the sprite, never obscures it. A low-HP pass intensifies it for the kill
  // window. Shared Graphics, cleared each frame, no per-unit allocations.
  drawBossLowHpAura(state: GameStateShape) {
    const g = this.bossAuraGfx;
    g.clear();
    const GLOW = 0xE87020;
    for (const e of state.enemies.values()) {
      if (e.hp <= 0) continue;
      if (!e.isBoss && !(e as any).isElite) continue;
      const big = !!(e as any).__bigGlow;                       // Typhon / Super Giant
      const half = (e.isBoss ? GRID.TILE * 1.2 : GRID.TILE * 0.9) * ((e as any).__glowScale ?? 1);
      const pulse = 0.5 + 0.5 * Math.sin(state.tick * (2 * Math.PI / 1.2));  // 1.2s cycle
      const peak = big ? 0.80 : 0.60;
      const ringPx = big ? 6 : 4;
      const alpha = peak * (0.55 + 0.45 * pulse);
      const r = half + ringPx;
      g.beginFill(GLOW, alpha * 0.20);
      g.drawCircle(e.x, e.y, r * 1.12);
      g.endFill();
      g.lineStyle(ringPx * 0.9, GLOW, alpha);
      g.drawCircle(e.x, e.y, r);
      g.lineStyle(0);
      if (e.hp / e.maxHp < 0.25) {                              // low-HP urgency intensifier
        g.lineStyle(2, GLOW, alpha * 0.9);
        g.drawCircle(e.x, e.y, r * 1.25 * (0.96 + 0.06 * pulse));
        g.lineStyle(0);
      }
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
        : p.spriteKey === 'HERO_PROJ_AGRIPPA_BOLT' ? 0xb88a4a
        : p.spriteKey === 'HERO_PROJ_AGRICOLA_ARROW' ? 0x86d8ff
        : p.spriteKey === 'HERO_PROJ_SULLA_METEOR' ? 0xff7733
        : p.spriteKey === 'PROJ_JAVELIN' ? 0xddc888
        : p.spriteKey === 'PROJ_PILUM' ? 0xeeddaa
        : p.spriteKey === 'PROJ_HASTA' ? 0xc8a868
        : p.spriteKey === 'PROJ_ARROW' ? 0xddccaa
        : p.spriteKey === 'PROJ_GIANT_ARROW' ? 0xf0b95c
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
        const isSullaMeteor = p.spriteKey === 'PROJ_SULLA_METEOR' || p.spriteKey === 'HERO_PROJ_SULLA_METEOR';
        const trailColor = isSullaMeteor ? 0xff7733 : (isDivine ? 0xffe066 : color);
        this.projGfx.beginFill(trailColor, isSullaMeteor ? alpha * 1.45 : alpha)
          .drawCircle(tx, ty, isSullaMeteor ? 3.2 : (isDivine ? 2.0 : 1.6))
          .endFill();
        if (isSullaMeteor) {
          this.projGfx.beginFill(0xffd34d, alpha * 0.45).drawCircle(tx + 2, ty - 1, 1.8).endFill();
        }
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
          const isSullaMeteor = p.spriteKey === 'PROJ_SULLA_METEOR' || p.spriteKey === 'HERO_PROJ_SULLA_METEOR';
          const isPoisonCloud = p.spriteKey === 'PROJ_POISON_CLOUD';
          const isHeroBolt = p.spriteKey === 'HERO_PROJ_AGRIPPA_BOLT';
          const isHeroArrow = p.spriteKey === 'HERO_PROJ_AGRICOLA_ARROW';
          sp.width = isSullaMeteor ? 30 : (isHeroBolt ? 34 : isHeroArrow ? 30 : big ? 22 : isPoisonCloud ? 20 : 18);
          sp.height = isSullaMeteor ? 30 : (isHeroBolt ? 22 : isHeroArrow ? 20 : big ? 22 : isPoisonCloud ? 20 : 18);
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
      const outer = d.faction === 'naga' ? 0x45d9ff : d.faction === 'undead' ? 0x55ffaa : 0xaa88ff;
      const inner = d.faction === 'naga' ? 0xf0e0ff : d.faction === 'undead' ? 0xccffee : 0xddeeff;
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
    // ─── NULLIFYING AURA dome (2026-06-25) ──────────────────────────────
    // Constant violet "magic-null" ring around every live carrier (data
    // flag nullifyAuraRadiusTiles). Re-derived from state.enemies each frame
    // so a stale source list can't leave a ghost ring. Towers inside are
    // disabled (see EnemySystem) and show the silence X-mark.
    this.nullifyAuraGfx.clear();
    for (const e of state.enemies.values()) {
      const nr = (enemiesData as any)[e.type]?.nullifyAuraRadiusTiles;
      if (!nr || e.hp <= 0) continue;
      const rad = GRID.TILE * nr;
      const pulse = 0.55 + Math.sin(state.tick * 3.0 + e.x * 0.04) * 0.22;
      this.nullifyAuraGfx.beginFill(0x6a1fb0, 0.10 * pulse).drawCircle(e.x, e.y, rad).endFill();
      this.nullifyAuraGfx.beginFill(0xa64dff, 0.13 * pulse).drawCircle(e.x, e.y, rad * 0.74).endFill();
      const tk = state.tick;
      const halfArc = 0.5 * Math.PI;
      this.nullifyAuraGfx.lineStyle(2.5, 0xcc88ff, 0.85);
      this.nullifyAuraGfx.arc(e.x, e.y, rad, tk * 0.9, tk * 0.9 + halfArc);
      this.nullifyAuraGfx.arc(e.x, e.y, rad, tk * 0.9 + Math.PI, tk * 0.9 + Math.PI + halfArc);
      this.nullifyAuraGfx.lineStyle(1.5, 0x9933ff, 0.6);
      this.nullifyAuraGfx.arc(e.x, e.y, rad * 0.9, Math.PI - tk * 1.0, Math.PI - tk * 1.0 + halfArc);
      this.nullifyAuraGfx.lineStyle(0);
    }
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
  private charybdisCurrents: { x: number; y: number; born: number; life: number; radius: number; spin: number }[] = [];
  private spriteImpacts: { sp: Sprite; key: string; born: number; life: number; size: number; frameW: number; frameH: number; frames: number }[] = [];
  private trimSlashQueue(): void {
    while (this.slashes.length > MAX_TRANSIENT_SLASHES) {
      const old = this.slashes.shift();
      old?.sp.destroy();
    }
  }
  private trimSpriteImpactQueue(): void {
    while (this.spriteImpacts.length > MAX_TRANSIENT_SPRITE_IMPACTS) {
      const old = this.spriteImpacts.shift();
      old?.sp.destroy();
    }
  }
  private trimPlainFxQueue<T>(queue: T[], max: number): void {
    if (queue.length > max) queue.splice(0, queue.length - max);
  }
  triggerMeleeSlash(x: number, y: number, angle: number, tick: number, size = 1, cleaver = false, tint?: number) {
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
      // 2026-05-20 — Optional damage-type tint. Caesar's DIVINE melee
      // gets a gold slash (0xffd34d), matching the gate-shop hero card
      // gold theme. Default (undefined) leaves the slash white/silver
      // for plain PHYS_MELEE swings.
      if (tint !== undefined) sp.tint = tint;
      this.layers.fx.addChild(sp);
      this.slashes.push({ sp, born: tick, life: 0.22, size: baseW });
      this.trimSlashQueue();
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
        if (tint !== undefined) echo.tint = tint;
        this.layers.fx.addChild(echo);
        this.slashes.push({ sp: echo, born: tick, life: 0.18, size: baseW * 0.85 });
        this.trimSlashQueue();
      }
    }
    // Heavy hits get a ground impact shockwave ring + dust. Threshold
    // dropped to 1.25 so the trimmed-down heavy multiplier (1.3) still
    // triggers the ring; radius pulled back to 0.4 × tile to match the
    // smaller slash footprint. Cleavers also drop a faint arc-trace ring
    // even at light size so the visual marker is consistent.
    // 2026-05-20 — Impact ring color also honors the slash tint when
    // supplied, so a Caesar heavy swing rings out in gold instead of
    // white. Falls back to white (heavy) or tan (cleaver) defaults.
    if (size >= 1.25) {
      this.impactRings.push({ x, y, born: tick, life: 0.26, maxR: GRID.TILE * 0.4 * size, color: tint ?? 0xffffff });
    } else if (cleaver) {
      this.impactRings.push({ x, y, born: tick, life: 0.20, maxR: GRID.TILE * 0.35, color: tint ?? 0xeed8a0 });
    }
    this.trimPlainFxQueue(this.impactRings, MAX_TRANSIENT_IMPACT_RINGS);
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
    this.trimPlainFxQueue(this.muzzleFlashes, MAX_TRANSIENT_MUZZLE_FLASHES);
  }
  // Generic ground ring (used by heavy melee + boss death).
  triggerImpactRing(x: number, y: number, tick: number, maxR = 24, color = 0xffffff) {
    this.impactRings.push({ x, y, born: tick, life: 0.32, maxR, color });
    this.trimPlainFxQueue(this.impactRings, MAX_TRANSIENT_IMPACT_RINGS);
  }

  triggerCharybdisCurrent(x: number, y: number, tick: number, radius = GRID.TILE * 1.55) {
    this.charybdisCurrents.push({
      x,
      y,
      born: tick,
      life: 0.92,
      radius,
      spin: Math.random() * Math.PI * 2
    });
    this.trimPlainFxQueue(this.charybdisCurrents, MAX_TRANSIENT_CHARYBDIS_CURRENTS);
  }

  private drawEllipseArc(g: Graphics, x: number, y: number, rx: number, ry: number, start: number, sweep: number, steps = 18): void {
    for (let i = 0; i <= steps; i++) {
      const a = start + sweep * (i / steps);
      const px = x + Math.cos(a) * rx;
      const py = y + Math.sin(a) * ry;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
  }

  triggerSpriteImpact(x: number, y: number, tick: number, key: string, size = 1.2, life = 0.30, frameW = 128, frameH = 128, frames = 6) {
    const t = texFrame(key, 0, frameW, frameH);
    if (!t) return;
    const sp = new Sprite(t);
    sp.anchor.set(0.5);
    sp.x = x;
    sp.y = y;
    const px = GRID.TILE * size;
    sp.width = px;
    sp.height = px;
    sp.alpha = 0.98;
    this.layers.fx.addChild(sp);
    this.spriteImpacts.push({ sp, key, born: tick, life, size, frameW, frameH, frames });
    this.trimSpriteImpactQueue();
  }

  // ─── HERO ABILITY VFX (2026-05-19 v2) ──────────────────────────────
  // Per-ability signature animations. Each of the 12 active hero abilities
  // queues a HeroAbilityFx record on cast; `drawHeroAbilityFx` ticks
  // them every frame, expiring entries past `life` and rendering each
  // ability's distinct shape on the dedicated `heroFxGfx` Graphics.
  //
  // The queue carries shared fields (origin, color, life) plus an
  // ability id that drives which shape draws. Per-ability extras
  // (target list, secondary origins, range tiles) ride on `extras` so
  // we don't need a wide superclass — each renderer reads only what
  // its ability cares about and ignores the rest.
  private heroFxGfx?: Graphics;
  private heroFxQueue: Array<{
    ability: string;
    x: number; y: number;
    born: number; life: number;
    color: number;
    extras?: any;
  }> = [];
  private destroyHeroAbilityFxAssets(fx: { extras?: any }): void {
    const arrayKeys = ['__auxSprites', '__pilumSprites', '__shellSprites', '__eagleSprites'];
    const singleKeys = ['__pilumSprite', '__hornSprite', '__brandSprite', '__aquilaSprite', '__laurelSprite', '__boltSprite', '__meteorSprite', '__meteorImpactSprite', '__marianSprite', '__wallSprite', '__proscriptionSprite'];
    for (const k of arrayKeys) {
      const arr: Sprite[] | undefined = fx.extras?.[k];
      if (arr) {
        for (const sp of arr) {
          this.layers.fx.removeChild(sp);
          sp.destroy();
        }
        fx.extras[k] = undefined;
      }
    }
    for (const k of singleKeys) {
      const sp: Sprite | undefined = fx.extras?.[k];
      if (sp) {
        this.layers.fx.removeChild(sp);
        sp.destroy();
        fx.extras[k] = undefined;
      }
    }
  }
  private trimHeroFxQueue(): void {
    while (this.heroFxQueue.length > MAX_HERO_ABILITY_FX) {
      const old = this.heroFxQueue.shift();
      if (old) this.destroyHeroAbilityFxAssets(old);
    }
  }
  triggerHeroAbilityFx(spec: {
    ability: string;
    x: number; y: number;
    tick: number;
    life?: number;
    color?: number;
    extras?: any;
  }): void {
    this.heroFxQueue.push({
      ability: spec.ability,
      x: spec.x, y: spec.y,
      born: spec.tick,
      life: spec.life ?? 0.9,
      color: spec.color ?? 0xffffff,
      extras: spec.extras
    });
    this.trimHeroFxQueue();
  }
  drawHeroAbilityFx(tick: number): void {
    if (!this.heroFxGfx) {
      this.heroFxGfx = new Graphics();
      this.layers.fx.addChild(this.heroFxGfx);
    }
    const g = this.heroFxGfx;
    g.clear();
    for (let i = this.heroFxQueue.length - 1; i >= 0; i--) {
      const fx = this.heroFxQueue[i];
      const age = tick - fx.born;
      if (age >= fx.life) {
        // 2026-05-24 — Sprite-backed VFX cleanup. Each hero ability
        // that allocates Pixi Sprites caches them on the fx entry's
        // extras so per-frame re-creation isn't needed. On expiry,
        // destroy + detach so the fx layer doesn't accumulate orphan
        // sprites. Sprite-cache keys covered here:
        //   __auxSprites      Capite Censi (Marius) — 3 ghost auxilia
        //   __pilumSprite     Capite Censi (Marius) — single pilum arc
        //   __pilumSprites    Pilum Volley (Agrippa) — 5 javelin arcs
        //   __shellSprites    Naval Bombardment (Agrippa) — 3 shells
        //   __eagleSprites    Eagle Scout (Agricola) — N darting eagles
        //   __hornSprite      Cornu Charge (Scipio) — war horn above hero
        //   __brandSprite     Scipio's Brand (Scipio) — branding iron
        //   __aquilaSprite    SPQR Decree (Caesar) — Roman eagle standard
        //   __laurelSprite    Pax Romana (Caesar) — laurel wreath
        //   __meteorSprite    Meteor Slam (Sulla) — falling meteor sheet
        //   __meteorImpactSprite Meteor Slam (Sulla) — impact/explosion sheet
        this.destroyHeroAbilityFxAssets(fx);
        this.heroFxQueue.splice(i, 1);
        continue;
      }
      const t = Math.max(0, Math.min(1, age / fx.life));
      const fade = 1 - t;
      switch (fx.ability) {
        // ── MARIUS ───────────────────────────────────────────────────
        case 'MARIAN_FORMATION': {
          // Purple ring-burst at Marius + small ring on each buffed melee
          // tower. The previous look ALSO drew connecting lightning lines
          // from Marius to each target, but the user reported the lines
          // were visually noisy ("get rid of them"), so we now lean on the
          // ring-pulse at each buffed tower alone to communicate the buff.
          // Targets is an array of {x,y} for the buffed towers (passed in
          // from the executor).
          const tgts: Array<{ x: number; y: number }> = fx.extras?.targets ?? [];
          // 2026-06-29 — dedicated violet signum standard (HFX_MARIAN_STANDARD)
          // rises at Marius as the formation rallies; the ring-pulses below
          // remain as the buff-aura accent. Lazy-alloc + cached on extras,
          // cleaned up via __marianSprite in destroyHeroAbilityFxAssets.
          if (!fx.extras) fx.extras = {};
          if (!fx.extras.__marianSprite) {
            const stex = tex('HFX_MARIAN_STANDARD');
            if (stex && stex.width > 0) {
              const sp = new Sprite(stex);
              sp.anchor.set(0.5, 0.92);
              const sz = GRID.TILE * 1.6;
              sp.width = sz; sp.height = sz;
              this.layers.fx.addChild(sp);
              fx.extras.__marianSprite = sp;
            }
          }
          const msp = fx.extras.__marianSprite as Sprite | undefined;
          if (msp) {
            const rise = GRID.TILE * 0.35 * (1 - Math.min(1, t * 2.2));
            msp.position.set(fx.x, fx.y + rise);
            msp.alpha = 0.96 * fade;
          }
          const r0 = 36 + t * 36;
          g.lineStyle(3 * fade, fx.color, 0.85 * fade);
          g.drawCircle(fx.x, fx.y, r0);
          g.lineStyle(0);
          for (const tg of tgts) {
            // Small ring at each target — louder ring pulse since we no
            // longer have the connecting line carrying half the signal.
            const rt = 18 + t * 14;
            g.lineStyle(2.5 * fade, fx.color, 0.95 * fade);
            g.drawCircle(tg.x, tg.y, rt);
            g.lineStyle(0);
          }
          break;
        }
        case 'CAPITE_CENSI': {
          // 2026-05-24 — SPRITE-BACKED VFX. Two render modes:
          //   1) `extras.pilumArc` — single PROJ_PILUM sprite flying an
          //      arc from the firing aux to its target. Sprite is
          //      rotated to match the flight tangent so the pilum looks
          //      like it's actually being thrown, not sliding sideways.
          //      Procedural amber-glow trail underneath for impact read.
          //   2) `extras.auxiliaries` — three AUXILIA sprites (reused
          //      from the tower roster) tinted amber as phantom-summon
          //      figures. Rises from below the tile in first ~0.5s,
          //      bobs gently mid-life, dissolves upward in last ~0.6s.
          //      Procedural dust ring + glow pulse at each aux's feet.
          //
          //  Sprite lifecycle: created lazily on the FIRST frame this
          //  fx entry renders (cached on `fx.extras.__auxSprites` /
          //  `__pilumSprite`), updated each frame, destroyed in the
          //  expiry path at the top of the loop. No per-frame churn.
          if (fx.extras?.pilumArc) {
            const { from, to } = fx.extras.pilumArc;
            const arcLift = 32;
            const prog = Math.min(1, t * 1.4);
            // Lazy sprite alloc
            if (!fx.extras.__pilumSprite) {
              const ptex = tex('HFX_CAPITE_PILUM') ?? tex('PROJ_PILUM');
              if (ptex && ptex.width > 0 && ptex.height > 0) {
                const sp = new Sprite(ptex);
                sp.anchor.set(0.5, 0.5);
                // 2026-05-24 v3 — Explicit scale calculation from
                // texture native size. The PROJ_PILUM PNG is 1333×1115
                // pixels native; any scale > ~0.05 renders bigger than
                // a tile. Compute the exact scale we want and set it
                // explicitly so Pixi has no opportunity to misinterpret.
                const pilumSize = GRID.TILE * 0.55;
                sp.scale.set(pilumSize / ptex.width, pilumSize / ptex.height);
                sp.tint = 0xffd99a; // warmer amber than fx.color
                this.layers.fx.addChild(sp);
                fx.extras.__pilumSprite = sp;
              }
            }
            // 2026-05-24 v3 — Defensive per-frame re-size assertion.
            // If anything (Pixi internal, texture late-load, etc) ever
            // resets sp.scale, the next frame snaps it back to the
            // intended small size. Belt-and-suspenders.
            const pilumSizePx = GRID.TILE * 0.55;
            // Current arc position
            const px = from.x + (to.x - from.x) * prog;
            const py = from.y + (to.y - from.y) * prog - Math.sin(prog * Math.PI) * arcLift;
            // Tangent angle for rotation — derivative of the arc curve
            const tdx = (to.x - from.x);
            const tdy = (to.y - from.y) - Math.cos(prog * Math.PI) * arcLift * Math.PI;
            const angle = Math.atan2(tdy, tdx);
            const sp = fx.extras.__pilumSprite as Sprite | undefined;
            if (sp && sp.texture && sp.texture.width > 0) {
              // Re-assert scale every frame — defensive against any
              // Pixi internal that might reset it (e.g. late texture
              // load, plugin interaction). The recomputation is cheap.
              sp.scale.set(pilumSizePx / sp.texture.width, pilumSizePx / sp.texture.height);
              sp.position.set(px, py);
              sp.rotation = angle;
              sp.alpha = 0.95 * fade;
            }
            // Procedural glow trail behind the pilum tip — soft amber
            // motion blur so the eye reads the throw arc.
            const trailSegs = 5;
            for (let s = 1; s <= trailSegs; s++) {
              const back = Math.max(0, prog - s * 0.05);
              const bx = from.x + (to.x - from.x) * back;
              const by = from.y + (to.y - from.y) * back - Math.sin(back * Math.PI) * arcLift;
              const a = (trailSegs - s) / trailSegs * 0.35 * fade;
              g.beginFill(fx.color, a).drawCircle(bx, by, 3 - s * 0.3).endFill();
            }
            // Impact spark when pilum lands
            if (prog >= 1) {
              const sparkR = 6 + (t - 0.7) * 18;
              g.lineStyle(2 * fade, fx.color, 0.85 * fade);
              g.drawCircle(to.x, to.y, Math.max(4, sparkR));
              g.lineStyle(0);
              g.beginFill(fx.color, 0.4 * fade).drawCircle(to.x, to.y, 4).endFill();
            }
          } else {
            const auxiliaries: Array<{ x: number; y: number }> = fx.extras?.auxiliaries ?? [];
            // Lazy sprite alloc for the 3 ghost auxiliaries
            if (!fx.extras.__auxSprites && auxiliaries.length > 0) {
              const auxTex = tex('AUXILIA');
              const sprites: Sprite[] = [];
              // 2026-05-24 v3 — AUXILIA is 256×256 native. Use explicit
              // scale-from-texture-width math instead of sp.width so
              // we have full control over the rendered size regardless
              // of texture load timing. Target: 1.0 tile per phantom.
              const auxSize = GRID.TILE * 1.0;
              for (const aux of auxiliaries) {
                if (!auxTex || auxTex.width <= 0) continue;
                const sp = new Sprite(auxTex);
                // Anchor near feet so the rise animation reads correctly
                // and the body sits on the tile.
                sp.anchor.set(0.5, 0.85);
                sp.scale.set(auxSize / auxTex.width, auxSize / auxTex.height);
                // Amber ghost tint
                sp.tint = 0xe8b878;
                sp.position.set(aux.x, aux.y);
                sp.alpha = 0;
                this.layers.fx.addChild(sp);
                sprites.push(sp);
              }
              fx.extras.__auxSprites = sprites;
            }
            const sprites: Sprite[] = fx.extras.__auxSprites ?? [];
            // Lifetime-phase shape: 0.5s rise → hold → 0.6s dissolve.
            // Mapped to fractions of the total fx.life so it scales
            // cleanly with ability tuning.
            const lifetime = fx.life;
            const ageFrac = lifetime > 0 ? age / lifetime : 1;
            const riseFrac = Math.min(0.18, 0.5 / lifetime);  // first ~0.5s
            const dissolveStart = 1 - Math.min(0.22, 0.6 / lifetime);  // last ~0.6s
            for (let s = 0; s < sprites.length; s++) {
              const sp = sprites[s];
              const aux = auxiliaries[s];
              if (!sp || !aux) continue;
              let alpha = 0.78;
              let yOff = 0;
              if (ageFrac < riseFrac) {
                // Rising up from below the tile — alpha + position
                const r = ageFrac / riseFrac;
                alpha = 0.78 * r;
                yOff = (1 - r) * 22;
              } else if (ageFrac > dissolveStart) {
                // Dissolving upward as wisps
                const r = (ageFrac - dissolveStart) / (1 - dissolveStart);
                alpha = 0.78 * (1 - r);
                yOff = -r * 18;
              }
              // Subtle hover bob — keeps the ghost looking alive
              const bob = Math.sin(age * Math.PI * 1.6 + s * 0.7) * 1.4;
              sp.position.set(aux.x, aux.y + yOff + bob);
              sp.alpha = alpha;
              // Procedural amber dust ring at feet + inner glow.
              // Pulses on a 3 Hz cycle so the eye picks up the figure
              // even when the sprite alpha dips during rise/dissolve.
              const ringR = 16 + Math.sin(age * Math.PI * 3 + s * 1.1) * 2.5;
              const groundA = ageFrac < riseFrac ? (ageFrac / riseFrac) * 0.55
                            : ageFrac > dissolveStart ? (1 - (ageFrac - dissolveStart) / (1 - dissolveStart)) * 0.55
                            : 0.55;
              g.lineStyle(1.5, fx.color, groundA);
              g.drawCircle(aux.x, aux.y + 2, ringR);
              g.lineStyle(0);
              g.beginFill(fx.color, groundA * 0.35).drawCircle(aux.x, aux.y + 2, 11).endFill();
              // Tiny rising-ember motes during the rise phase — sells
              // the "called up from the dust" theme.
              if (ageFrac < riseFrac * 1.6) {
                const motes = 4;
                for (let m = 0; m < motes; m++) {
                  const ma = (Math.sin(age * Math.PI * 2 + m * 1.7 + s) + 1) * 0.5;
                  const mx = aux.x + Math.cos(m * 1.5 + s * 0.3) * (8 + ma * 6);
                  const my = aux.y + 4 - ma * 18;
                  g.beginFill(fx.color, 0.45 * (1 - ma)).drawCircle(mx, my, 1.5).endFill();
                }
              }
            }
          }
          break;
        }
        // ── AGRIPPA ──────────────────────────────────────────────────
        case 'PILUM_VOLLEY': {
          // 2026-05-24 — Sprite-upgraded. 5 rotated PROJ_PILUM sprites
          // arc from Agrippa to each high-HP target, with a procedural
          // amber-glow trail behind the tip. Same lazy-sprite cache
          // pattern as Capite Censi: allocate once on first frame,
          // destroyed in the expiry path. Up to 5 sprites per cast.
          const tgts: Array<{ x: number; y: number }> = fx.extras?.targets ?? [];
          const arcLift = 38;
          if (!fx.extras.__pilumSprites && tgts.length > 0) {
            const ptex = tex('HFX_PILUM_VOLLEY') ?? tex('PROJ_PILUM');
            const sprites: Sprite[] = [];
            // 2026-05-24 v2 — absolute pixel sizing (was scale ratio
            // that blew up on Higgsfield's high-res native textures).
            const pilumSize = GRID.TILE * 0.8;
            for (let i = 0; i < tgts.length; i++) {
              if (!ptex) continue;
              const sp = new Sprite(ptex);
              sp.anchor.set(0.5, 0.5);
              sp.width = pilumSize;
              sp.height = pilumSize;
              sp.tint = 0xa8c8ff; // Agrippa naval blue
              this.layers.fx.addChild(sp);
              sprites.push(sp);
            }
            fx.extras.__pilumSprites = sprites;
          }
          const sprites: Sprite[] = fx.extras.__pilumSprites ?? [];
          for (let i = 0; i < tgts.length; i++) {
            const tg = tgts[i];
            const prog = Math.min(1, t * 1.4);
            const px = fx.x + (tg.x - fx.x) * prog;
            const py = fx.y + (tg.y - fx.y) * prog - Math.sin(prog * Math.PI) * arcLift;
            const tdx = (tg.x - fx.x);
            const tdy = (tg.y - fx.y) - Math.cos(prog * Math.PI) * arcLift * Math.PI;
            const angle = Math.atan2(tdy, tdx);
            const sp = sprites[i];
            if (sp) {
              sp.position.set(px, py);
              sp.rotation = angle;
              sp.alpha = 0.95 * fade;
            }
            // Procedural blue motion-blur trail behind tip
            for (let s = 1; s <= 4; s++) {
              const back = Math.max(0, prog - s * 0.06);
              const bx = fx.x + (tg.x - fx.x) * back;
              const by = fx.y + (tg.y - fx.y) * back - Math.sin(back * Math.PI) * arcLift;
              g.beginFill(fx.color, (4 - s) / 4 * 0.32 * fade).drawCircle(bx, by, 3 - s * 0.4).endFill();
            }
            // Impact spark on landing
            if (prog >= 1) {
              g.lineStyle(2 * fade, fx.color, 0.85 * fade);
              g.drawCircle(tg.x, tg.y, 6 + (t - 0.7) * 16);
              g.lineStyle(0);
            }
          }
          break;
        }
        case 'NAVAL_BOMBARDMENT': {
          // 2026-05-24 — Sprite-upgraded. 3 PROJ_BALLISTA sprites fall
          // from above-screen onto the path with smoke trails and
          // crashing impact rings. The ballista bolt sprite is heavier
          // than a pilum and reads as a true naval-bombardment shell.
          const pts: Array<{ x: number; y: number }> = fx.extras?.impacts ?? [];
          if (!fx.extras.__shellSprites && pts.length > 0) {
            const btex = tex('HFX_NAVAL_SHELL') ?? tex('PROJ_BALLISTA');
            const sprites: Sprite[] = [];
            // 2026-05-24 v2 — absolute pixel sizing (was 1.4 scale ratio).
            const shellSize = GRID.TILE * 1.0;
            for (let i = 0; i < pts.length; i++) {
              if (!btex) continue;
              const sp = new Sprite(btex);
              sp.anchor.set(0.5, 0.5);
              sp.width = shellSize;
              sp.height = shellSize;
              sp.tint = 0x88bbff;
              sp.rotation = Math.PI / 2; // point downward
              this.layers.fx.addChild(sp);
              sprites.push(sp);
            }
            fx.extras.__shellSprites = sprites;
          }
          const sprites: Sprite[] = fx.extras.__shellSprites ?? [];
          for (let i = 0; i < pts.length; i++) {
            const pt = pts[i];
            const fall = Math.min(1, t * 1.6);
            const shellY = pt.y - (1 - fall) * 220;
            // Position the sprite if available
            const sp = sprites[i];
            if (sp) {
              sp.position.set(pt.x, shellY);
              sp.alpha = (fall < 1 ? 0.95 : 0.0) * fade;
              // Slight tumble during fall
              sp.rotation = Math.PI / 2 + Math.sin(fall * Math.PI) * 0.25;
            }
            // Smoke trail (procedural)
            for (let s = 1; s <= 5; s++) {
              const sy = shellY - s * 14;
              g.beginFill(fx.color, (5 - s) * 0.08 * fade).drawCircle(pt.x, sy, 5 - s * 0.5).endFill();
            }
            // Impact splash once landed — double ring + filled core
            if (fall >= 1) {
              const sr = GRID.TILE * 2 * (t - 0.625) * 1.5;
              g.lineStyle(3.5 * fade, fx.color, 0.9 * fade);
              g.drawCircle(pt.x, pt.y, Math.max(10, sr));
              g.lineStyle(2 * fade, 0xffffff, 0.7 * fade);
              g.drawCircle(pt.x, pt.y, Math.max(6, sr * 0.6));
              g.lineStyle(0);
              g.beginFill(0xffffff, 0.35 * fade).drawCircle(pt.x, pt.y, 5).endFill();
            }
          }
          break;
        }
        // ── AGRICOLA ─────────────────────────────────────────────────
        case 'EAGLE_SCOUT': {
          // 2026-05-24 — Sprite-upgraded. Real Aquila Venator eagle
          // sprites dart from Agrippa to each flyer target with a
          // green scout-glow trail. After landing, a crosshair lingers
          // briefly so the player reads which flyer is marked.
          const tgts: Array<{ x: number; y: number }> = fx.extras?.targets ?? [];
          if (!fx.extras.__eagleSprites && tgts.length > 0) {
            const etex = tex('HFX_SCOUT_EAGLE') ?? tex('AQUILA_VENATOR');
            const sprites: Sprite[] = [];
            // 2026-05-24 v2 — absolute pixel sizing. AQUILA_VENATOR is
            // a tower portrait (~512×512 native); the old 0.45× scale
            // rendered each eagle at ~230px = ~7 tiles wide, hence the
            // "screen covering" complaint.
            const eagleSize = GRID.TILE * 0.8;
            for (let i = 0; i < tgts.length; i++) {
              if (!etex) continue;
              const sp = new Sprite(etex);
              sp.anchor.set(0.5, 0.5);
              sp.width = eagleSize;
              sp.height = eagleSize;
              sp.tint = 0x99dd99; // Agricola scout green
              this.layers.fx.addChild(sp);
              sprites.push(sp);
            }
            fx.extras.__eagleSprites = sprites;
          }
          const sprites: Sprite[] = fx.extras.__eagleSprites ?? [];
          for (let i = 0; i < tgts.length; i++) {
            const tg = tgts[i];
            const prog = Math.min(1, t * 1.5);
            const ex = fx.x + (tg.x - fx.x) * prog;
            const ey = fx.y + (tg.y - fx.y) * prog - Math.sin(prog * Math.PI) * 20;
            const sp = sprites[i];
            if (sp) {
              sp.position.set(ex, ey);
              sp.alpha = 0.92 * fade;
              // Eagle rotates to match flight angle so it reads as
              // "swooping" rather than sliding sideways
              sp.rotation = Math.atan2(tg.y - fx.y, tg.x - fx.x) * 0.3;
            }
            // Faint green trail behind the eagle
            for (let s = 1; s <= 3; s++) {
              const back = Math.max(0, prog - s * 0.08);
              const bx = fx.x + (tg.x - fx.x) * back;
              const by = fx.y + (tg.y - fx.y) * back - Math.sin(back * Math.PI) * 20;
              g.beginFill(fx.color, (3 - s) / 3 * 0.25 * fade).drawCircle(bx, by, 3 - s * 0.5).endFill();
            }
            // Crosshair lingers at target once spotted
            if (prog >= 1) {
              g.lineStyle(2 * fade, fx.color, 0.85 * fade);
              g.drawCircle(tg.x, tg.y, 12);
              g.moveTo(tg.x - 14, tg.y).lineTo(tg.x - 8, tg.y);
              g.moveTo(tg.x + 8, tg.y).lineTo(tg.x + 14, tg.y);
              g.moveTo(tg.x, tg.y - 14).lineTo(tg.x, tg.y - 8);
              g.moveTo(tg.x, tg.y + 8).lineTo(tg.x, tg.y + 14);
              g.lineStyle(0);
            }
          }
          break;
        }
        case 'FRONTIER_WALL': {
          // 2026-05-24 — Procedural-but-upgraded. Three timber palisade
          // pillars rise from the ground at Agricola's position, with
          // a connecting crossbeam and inset wood grain so it reads as
          // a frontier-era wood fortification (matches Agricola's
          // historical role at Hadrian's Wall / Caledonia). Stayed
          // procedural since no specific palisade sprite exists.
          // 2026-06-29 — dedicated palisade-rampart sprite (HFX_FRONTIER_WALL)
          // rises from the ground in place of the old procedural pillars; the
          // ground-dust accent below remains. Lazy-alloc + cached on extras,
          // cleaned up via __wallSprite in destroyHeroAbilityFxAssets.
          if (!fx.extras) fx.extras = {};
          if (!fx.extras.__wallSprite) {
            const wtex = tex('HFX_FRONTIER_WALL');
            if (wtex && wtex.width > 0) {
              const sp = new Sprite(wtex);
              sp.anchor.set(0.5, 0.9);
              const sz = GRID.TILE * 2.2;
              sp.width = sz; sp.height = sz;
              this.layers.fx.addChild(sp);
              fx.extras.__wallSprite = sp;
            }
          }
          const wsp = fx.extras.__wallSprite as Sprite | undefined;
          if (wsp) {
            // Rise-in over the first ~40% of life, then settle.
            const rise = GRID.TILE * 0.5 * (1 - Math.min(1, t * 2.5));
            wsp.position.set(fx.x, fx.y + rise);
            wsp.alpha = 0.96 * fade;
          }
          // Ground-impact dust at base — the wall slams in
          if (t < 0.3) {
            const dustR = 24 + t * 60;
            g.lineStyle(2 * (1 - t / 0.3), 0x6a5a3a, 0.65 * (1 - t / 0.3));
            g.drawCircle(fx.x, fx.y + 4, dustR);
            g.lineStyle(0);
          }
          break;
        }
        // ── SCIPIO ───────────────────────────────────────────────────
        case 'CORNU_CHARGE': {
          // 2026-05-24 — Sprite-upgraded. Barca War Horn sprite floats
          // above Scipio (the cornu being blown), three expanding
          // horn-blast rings ripple outward, and a Roman-red arrow
          // streaks to the targeted boss. Combines real sprite plus
          // procedural waves for the audio-shockwave feeling.
          const target = fx.extras?.target;
          if (!fx.extras.__hornSprite) {
            const htex = tex('HFX_CORNU_CHARGE') ?? tex('ITEM_BARCA_WAR_HORN');
            if (htex) {
              const sp = new Sprite(htex);
              sp.anchor.set(0.5, 0.5);
              // 2026-05-24 v2 — absolute size (was 0.55 scale ratio).
              const hornSize = GRID.TILE * 0.9;
              sp.width = hornSize;
              sp.height = hornSize;
              sp.tint = 0xffd34d; // brassy horn
              this.layers.fx.addChild(sp);
              fx.extras.__hornSprite = sp;
            }
          }
          // Horn sprite — bobs above Scipio's head, slight rotation
          // (the "being blown" gesture).
          const sp = fx.extras.__hornSprite as Sprite | undefined;
          if (sp) {
            const hornY = fx.y - 28 - Math.sin(t * Math.PI * 2) * 3;
            sp.position.set(fx.x, hornY);
            sp.rotation = -0.3 + Math.sin(t * Math.PI * 4) * 0.08;
            sp.alpha = 0.95 * fade;
          }
          // Three expanding horn-blast rings (shockwave)
          for (let k = 0; k < 3; k++) {
            const phase = Math.max(0, Math.min(1, t * 1.3 - k * 0.18));
            if (phase <= 0) continue;
            const r = 20 + phase * 95;
            g.lineStyle(3 * (1 - phase), fx.color, 0.85 * (1 - phase));
            g.drawCircle(fx.x, fx.y, r);
            g.lineStyle(0);
          }
          if (target) {
            // Crimson arrow line from Scipio to target — boss focus
            const prog = Math.min(1, t * 1.2);
            const ax = fx.x + (target.x - fx.x) * prog;
            const ay = fx.y + (target.y - fx.y) * prog;
            g.lineStyle(3.5 * fade, fx.color, 0.9 * fade);
            g.moveTo(fx.x, fx.y).lineTo(ax, ay);
            g.lineStyle(0);
            // Arrow head at leading edge
            const angle = Math.atan2(target.y - fx.y, target.x - fx.x);
            g.beginFill(fx.color, 0.95 * fade);
            g.moveTo(ax, ay);
            g.lineTo(ax - Math.cos(angle - 0.4) * 12, ay - Math.sin(angle - 0.4) * 12);
            g.lineTo(ax - Math.cos(angle + 0.4) * 12, ay - Math.sin(angle + 0.4) * 12);
            g.endFill();
          }
          break;
        }
        case 'SCIPIO_BRAND': {
          // 2026-05-24 — Sprite-upgraded. The Soulfire Brand sprite is
          // hammered onto the boss with a flare-of-impact ring + a
          // pulsing crimson aura (telegraphs the +30% damage-taken
          // mark applied via CombatResolver). The brand sprite is the
          // literal branding iron that Scipio uses to mark targets for
          // "the fall of Carthage."
          const target = fx.extras?.target ?? { x: fx.x, y: fx.y };
          const stamp = Math.min(1, t * 1.5);
          if (!fx.extras.__brandSprite) {
            const btex = tex('HFX_SCIPIO_BRAND') ?? tex('ITEM_SOULFIRE_BRAND');
            if (btex) {
              const sp = new Sprite(btex);
              sp.anchor.set(0.5, 0.85); // anchor near brand tip
              // 2026-05-24 v2 — absolute size (was 0.7 scale ratio).
              const brandSize = GRID.TILE * 1.0;
              sp.width = brandSize;
              sp.height = brandSize;
              sp.tint = 0xff6644; // searing red
              this.layers.fx.addChild(sp);
              fx.extras.__brandSprite = sp;
            }
          }
          const sp = fx.extras.__brandSprite as Sprite | undefined;
          if (sp) {
            // Brand strikes downward — slight overshoot on impact
            const strikeY = target.y - 18 - (1 - stamp) * 22;
            sp.position.set(target.x, strikeY);
            sp.rotation = -0.15 + Math.sin(stamp * Math.PI) * 0.1;
            sp.alpha = 0.95 * fade;
          }
          // Crimson searing ring — telegraphs the +30% damage-taken mark
          const auraR = 16 + t * 18;
          g.lineStyle(2.5 * fade, 0xc94040, 0.75 * fade);
          g.drawCircle(target.x, target.y, auraR);
          g.lineStyle(0);
          // Soft inner ember glow pulse
          g.beginFill(fx.color, 0.14 * fade).drawCircle(target.x, target.y, auraR * 0.85).endFill();
          // Spark burst at impact moment (first 0.2s)
          if (stamp >= 0.95 && t < 0.5) {
            const sparks = 6;
            for (let s = 0; s < sparks; s++) {
              const ang = (s / sparks) * Math.PI * 2;
              const sr = 8 + (t - 0.55) * 24;
              g.beginFill(0xffaa44, 0.7 * fade).drawCircle(
                target.x + Math.cos(ang) * sr,
                target.y + Math.sin(ang) * sr,
                2
              ).endFill();
            }
          }
          break;
        }
        // ── CAESAR ───────────────────────────────────────────────────
        case 'SPQR_DECREE': {
          // 2026-05-24 — Sprite-upgraded. The Aquila (eagle standard)
          // rises above Caesar — the literal SPQR sigil being decreed
          // — and golden seal flares pop at every tower he's buffing.
          const tgts: Array<{ x: number; y: number }> = fx.extras?.towers ?? [];
          if (!fx.extras.__aquilaSprite) {
            const atex = tex('HFX_SPQR_DECREE') ?? tex('AR_EAGLE_STANDARD') ?? tex('ITEM_AQUILA_STANDARD');
            if (atex) {
              const sp = new Sprite(atex);
              sp.anchor.set(0.5, 0.85);
              // 2026-05-24 v2 — absolute size (was 0.6 scale ratio).
              const aquilaSize = GRID.TILE * 1.2;
              sp.width = aquilaSize;
              sp.height = aquilaSize;
              sp.tint = 0xffe066; // imperial gold
              this.layers.fx.addChild(sp);
              fx.extras.__aquilaSprite = sp;
            }
          }
          const sp = fx.extras.__aquilaSprite as Sprite | undefined;
          if (sp) {
            // Standard rises out of Caesar's grip
            const liftY = fx.y - 18 - t * 14;
            sp.position.set(fx.x, liftY);
            sp.alpha = 0.95 * fade;
          }
          // Expanding gold ring (the decree spreading)
          const r = 60 + t * 220;
          g.lineStyle(4 * fade, fx.color, 0.9 * fade);
          g.drawCircle(fx.x, fx.y, r);
          g.beginFill(fx.color, 0.12 * fade).drawCircle(fx.x, fx.y, r * 0.8).endFill();
          g.lineStyle(0);
          // Each tower gets a gold seal flare
          for (const tg of tgts) {
            const ringR = 8 + t * 12;
            g.lineStyle(2.5 * fade, fx.color, 0.9 * fade);
            g.drawCircle(tg.x, tg.y, ringR);
            // Cross-line "SPQR seal" crosshair flourish
            g.moveTo(tg.x - ringR * 0.85, tg.y).lineTo(tg.x + ringR * 0.85, tg.y);
            g.moveTo(tg.x, tg.y - ringR * 0.85).lineTo(tg.x, tg.y + ringR * 0.85);
            g.lineStyle(0);
            g.beginFill(fx.color, 0.45 * fade).drawCircle(tg.x, tg.y, ringR * 0.45).endFill();
          }
          break;
        }
        case 'PAX_ROMANA': {
          // 2026-05-24 — Sprite-upgraded. Tyrant's Laurel sprite
          // wreaths Caesar (the literal Pax Romana symbol — peace
          // crowned by force), the pale-gold cross-hatch grid sweeps
          // across the map as the imperial order spreads, and a big
          // gold pulse marks Caesar's center.
          if (!fx.extras.__laurelSprite) {
            const ltex = tex('HFX_PAX_LAUREL') ?? tex('MU_LAUREL') ?? tex('ITEM_TYRANTS_LAUREL');
            if (ltex) {
              const sp = new Sprite(ltex);
              sp.anchor.set(0.5, 0.5);
              // 2026-05-24 v2 — absolute size (was 0.9 scale ratio).
              // Laurel wreathes around Caesar — slightly larger than
              // a tile so it visibly frames him.
              const laurelSize = GRID.TILE * 1.6;
              sp.width = laurelSize;
              sp.height = laurelSize;
              sp.tint = 0xfff4a8; // pale imperial gold
              this.layers.fx.addChild(sp);
              fx.extras.__laurelSprite = sp;
            }
          }
          const sp = fx.extras.__laurelSprite as Sprite | undefined;
          if (sp) {
            sp.position.set(fx.x, fx.y);
            // Slow rotation — laurel wreathes around Caesar
            sp.rotation = t * Math.PI * 0.5;
            sp.alpha = 0.85 * fade;
            // 2026-05-24 v2 — pulse via sp.width/height instead of
            // sp.scale.set(). The original code overwrote the absolute-
            // size scale set at creation, which on a Higgsfield-native-
            // size MU_LAUREL texture inflated the wreath to cover the
            // whole map. Now pulse multiplies the absolute size.
            const pulse = 0.9 + Math.sin(t * Math.PI * 2) * 0.08;
            const sz = GRID.TILE * 1.6 * pulse;
            sp.width = sz;
            sp.height = sz;
          }
          // Pale gold cross-hatch grid overlay sweeping across the map
          const w = GRID.TILE * GRID.COLS;
          const h = GRID.TILE * GRID.ROWS;
          const spacing = GRID.TILE * 2;
          const offset = (t * spacing) % spacing;
          g.lineStyle(1.5 * fade, fx.color, 0.32 * fade);
          for (let lx = -spacing + offset; lx < w; lx += spacing) {
            g.moveTo(lx, 0).lineTo(lx, h);
          }
          for (let ly = -spacing + offset; ly < h; ly += spacing) {
            g.moveTo(0, ly).lineTo(w, ly);
          }
          g.lineStyle(0);
          // Big gold pulse at Caesar
          g.lineStyle(3 * fade, fx.color, 0.7 * fade);
          g.drawCircle(fx.x, fx.y, 40 + t * 100);
          g.lineStyle(0);
          break;
        }
        // ── SULLA ────────────────────────────────────────────────────
        case 'FORTUNES_BOLT': {
          // 2026-06-28 — Meteor Slam. Sulla now calls down a burning
          // meteor sheet instead of a generic divine bolt. The first
          // half is a falling projectile; the second half plays an
          // impact/explosion sheet plus a splash-radius shock ring.
          const target = fx.extras?.target ?? { x: fx.x, y: fx.y };
          const fallT = Math.min(1, t / 0.58);
          const impactT = Math.max(0, Math.min(1, (t - 0.46) / 0.54));
          const topX = target.x - GRID.TILE * 2.8;
          const topY = target.y - GRID.TILE * 5.2;
          const mx = topX + (target.x - topX) * fallT;
          const my = topY + (target.y - topY) * fallT;
          const meteorFrame = Math.min(5, Math.floor(fallT * 6));
          const impactFrame = Math.min(5, Math.floor(impactT * 6));
          const meteorTex = texFrame('SULLA_METEOR_PROJECTILE', meteorFrame, 96, 96);
          const impactTex = texFrame('SULLA_METEOR_IMPACT', impactFrame, 128, 128);
          if (!fx.extras.__meteorSprite && meteorTex) {
            const sp = new Sprite(meteorTex);
            sp.anchor.set(0.5);
            sp.width = GRID.TILE * 1.35;
            sp.height = GRID.TILE * 1.35;
            this.layers.fx.addChild(sp);
            fx.extras.__meteorSprite = sp;
          }
          const meteor = fx.extras.__meteorSprite as Sprite | undefined;
          if (meteor) {
            if (meteorTex) meteor.texture = meteorTex;
            meteor.position.set(mx, my);
            meteor.rotation = Math.atan2(target.y - topY, target.x - topX);
            meteor.alpha = fallT < 0.98 ? 0.98 * fade : 0;
          }
          if (!fx.extras.__meteorImpactSprite && impactTex) {
            const sp = new Sprite(impactTex);
            sp.anchor.set(0.5);
            sp.width = GRID.TILE * 2.35;
            sp.height = GRID.TILE * 2.35;
            this.layers.fx.addChild(sp);
            fx.extras.__meteorImpactSprite = sp;
          }
          const boom = fx.extras.__meteorImpactSprite as Sprite | undefined;
          if (boom) {
            if (impactTex) boom.texture = impactTex;
            boom.position.set(target.x, target.y);
            boom.alpha = impactT > 0 ? 0.95 * fade : 0;
          }
          // Falling ember trail
          g.lineStyle(9 * fade, 0xff4a10, 0.18 * fade);
          g.moveTo(topX, topY).lineTo(mx, my);
          g.lineStyle(4 * fade, 0xffd34d, 0.36 * fade);
          g.moveTo(topX + 8, topY + 8).lineTo(mx, my);
          g.lineStyle(0);
          if (impactT > 0) {
            const radiusTiles = fx.extras?.splashRadiusTiles ?? 1.35;
            const r = radiusTiles * GRID.TILE * (0.55 + impactT * 0.45);
            g.beginFill(0xff4a10, 0.16 * fade * (1 - impactT * 0.35)).drawCircle(target.x, target.y, r).endFill();
            g.lineStyle(4 * fade * (1 - impactT * 0.25), 0xffd34d, 0.75 * fade);
            g.drawCircle(target.x, target.y, r);
            g.lineStyle(2 * fade, 0xffffff, 0.55 * fade);
            g.drawCircle(target.x, target.y, Math.max(8, r * 0.42));
            g.lineStyle(0);
          }
          break;
        }
        case 'PROSCRIPTION': {
          // 2026-05-24 — Procedural-but-upgraded. Each buffed tower
          // gets a glowing proscription mark (a red wax-seal with X)
          // above its head — historically, Sulla's proscription was
          // literally a list of names sealed and posted in the forum.
          // A floating scroll silhouette unfurls from Sulla's position
          // and the seal slams onto each marked tower.
          const tgts: Array<{ x: number; y: number }> = fx.extras?.towers ?? [];
          // 2026-06-29 — dedicated flaming proscription-tablet sprite
          // (HFX_PROSCRIPTION) floats above Sulla in place of the old
          // procedural scroll; the wax-seal stamps + origin ring below
          // remain. Lazy-alloc + cached, cleaned via __proscriptionSprite.
          if (!fx.extras) fx.extras = {};
          if (!fx.extras.__proscriptionSprite) {
            const ptex = tex('HFX_PROSCRIPTION');
            if (ptex && ptex.width > 0) {
              const sp = new Sprite(ptex);
              sp.anchor.set(0.5, 0.5);
              const sz = GRID.TILE * 1.05;
              sp.width = sz; sp.height = sz;
              this.layers.fx.addChild(sp);
              fx.extras.__proscriptionSprite = sp;
            }
          }
          const psp = fx.extras.__proscriptionSprite as Sprite | undefined;
          if (psp) {
            const sy = fx.y - 34 - Math.sin(t * Math.PI) * 5;
            psp.position.set(fx.x, sy);
            psp.alpha = 0.96 * fade;
          }
          // Seal stamp at each marked tower
          for (const tg of tgts) {
            const my = tg.y - GRID.TILE * 0.7;
            const pulse = 0.7 + 0.3 * Math.sin(age * 14);
            // Wax-seal disc — deeper red center, dark rim
            g.beginFill(0x3a0808, 0.9 * fade).drawCircle(tg.x, my, 7).endFill();
            g.beginFill(fx.color, 0.85 * fade * pulse).drawCircle(tg.x, my, 5.5).endFill();
            g.lineStyle(1 * fade, 0x6a0a0a, 0.95 * fade);
            g.drawCircle(tg.x, my, 7);
            g.lineStyle(0);
            // X mark inside (the proscription mark)
            g.lineStyle(1.8 * fade, 0xfff0d0, 0.95 * fade);
            g.moveTo(tg.x - 3, my - 3).lineTo(tg.x + 3, my + 3);
            g.moveTo(tg.x + 3, my - 3).lineTo(tg.x - 3, my + 3);
            g.lineStyle(0);
          }
          // Sulla origin ring (the decree going out)
          g.lineStyle(3 * fade, fx.color, 0.85 * fade);
          g.drawCircle(fx.x, fx.y, 30 + t * 70);
          g.lineStyle(0);
          break;
        }
      }
    }
    g.lineStyle(0);
  }
  // Telegraph rings — used to warn the player before a boss mechanic fires.
  // Unlike impact rings (which expand outward from impact), these SHRINK
  // toward the target over the duration so the player can read the
  // countdown and time burst damage on the windup.
  private telegraphRings: { x: number; y: number; born: number; life: number; maxR: number; color: number }[] = [];
  triggerTelegraphRing(x: number, y: number, tick: number, duration = 1.0, maxR = 64, color = 0xff2222) {
    this.telegraphRings.push({ x, y, born: tick, life: duration, maxR, color });
    this.trimPlainFxQueue(this.telegraphRings, MAX_TRANSIENT_TELEGRAPH_RINGS);
  }
  // BOSS-DEATH BLOOD RAIN (2026-05 v6 polish):
  // When a boss falls, spawn N falling blood Sprites scattered across the
  // map. Each drop accelerates downward, rotates slowly, then "lands" at
  // its target Y — at which point it becomes a permanent stain on the
  // ground. Uses the four existing v_blood_*.png stain sprites; we tint
  // randomly across them for visual variety. Visceral payoff that reads
  // immediately on every boss kill without affecting any combat path.
  triggerBloodRain(tick: number, dropCount = 110, intensity = 1.0) {
    dropCount = Math.min(dropCount, 32);
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
    for (let i = this.spriteImpacts.length - 1; i >= 0; i--) {
      const fx = this.spriteImpacts[i];
      const age = tick - fx.born;
      if (age >= fx.life) {
        fx.sp.destroy();
        this.spriteImpacts.splice(i, 1);
        continue;
      }
      const t = Math.max(0, Math.min(1, age / fx.life));
      const frame = Math.min(fx.frames - 1, Math.floor(t * fx.frames));
      const frameTex = texFrame(fx.key, frame, fx.frameW, fx.frameH);
      if (frameTex) fx.sp.texture = frameTex;
      const px = GRID.TILE * fx.size * (0.88 + t * 0.16);
      fx.sp.width = px;
      fx.sp.height = px;
      fx.sp.alpha = 0.98 * (1 - Math.max(0, t - 0.66) / 0.34);
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
    // Charybdis Vortex slow/current marker. This is deliberately more
    // "current" than "impact": a flattened rotating whirlpool that sits
    // briefly under the affected enemy so players can see the naval slow
    // and pull effect actually took hold.
    for (let i = this.charybdisCurrents.length - 1; i >= 0; i--) {
      const cur = this.charybdisCurrents[i];
      const age = tick - cur.born;
      if (age >= cur.life) { this.charybdisCurrents.splice(i, 1); continue; }
      const p = Math.max(0, Math.min(1, age / cur.life));
      const fade = Math.sin(Math.PI * p);
      const alpha = 0.82 * fade * (1 - p * 0.12);
      const rx = cur.radius * (0.72 + p * 0.18);
      const ry = rx * 0.46;
      const rot = cur.spin + age * 5.8;
      mg.beginFill(0x114a64, 0.15 * alpha).drawEllipse(cur.x, cur.y + 3, rx * 0.82, ry * 0.82).endFill();
      for (let arm = 0; arm < 3; arm++) {
        const start = rot + arm * ((Math.PI * 2) / 3);
        const sweep = Math.PI * 1.08;
        const armRx = rx * (0.48 + arm * 0.17);
        const armRy = ry * (0.48 + arm * 0.17);
        mg.lineStyle(3.6 - arm * 0.45, arm === 0 ? 0xd9fbff : 0x5fe6ff, alpha * (0.9 - arm * 0.12));
        this.drawEllipseArc(mg, cur.x, cur.y + 3, armRx, armRy, start, sweep);
      }
      mg.lineStyle(1.25, 0xd9fbff, alpha * 0.78);
      this.drawEllipseArc(mg, cur.x, cur.y + 3, rx * 0.24, ry * 0.24, -rot, Math.PI * 1.55, 14);
      mg.lineStyle(0);
      mg.beginFill(0x5fe6ff, alpha * 0.58).drawCircle(cur.x, cur.y + 3, 3.0 + 1.9 * fade).endFill();
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

  // Screen shake is intentionally disabled for Solo readability. Many combat
  // systems still call this legacy hook, so keep the API as a no-op.
  private shakeRemaining = 0;
  private shakeMagnitude = 0;
  triggerShake(_magnitude: number, _durationSec: number) {
    this.shakeMagnitude = 0;
    this.shakeRemaining = 0;
    this.app.stage.x = WORLD.OFFSET_X;
    this.app.stage.y = WORLD.OFFSET_Y;
  }

  // Gate impact flash (Animation Doc §22.2) — set when an enemy leaks, decays over 0.4s
  private gateImpactT = 0;
  triggerGateImpact() {
    this.gateImpactT = 0.4;
  }

  // Cave spawn puff queue (Animation Doc §22.1)
  private spawnPuffs: Array<{ x: number; y: number; born: number }> = [];
  triggerSpawnPuff(x: number, y: number, tick: number) {
    this.spawnPuffs.push({ x, y, born: tick });
    if (this.spawnPuffs.length > 12) this.spawnPuffs.shift();
  }

  // Apply gate impact decay. The stage position is always pinned to the
  // world baseline so combat cannot shake the playfield.
  applyShake(dt: number, tick: number) {
    this.shakeRemaining = 0;
    this.shakeMagnitude = 0;
    this.app.stage.x = WORLD.OFFSET_X;
    this.app.stage.y = WORLD.OFFSET_Y;
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
    // Grass and dirt-path sprites (tt_*) replace the flat colored rects.
    // Each tile gets a deterministic hash so reload looks the same.
    // Decorative props (dp_*) sprinkle on a subset of grass tiles.
    //
    // 2026-05-21 — BIOME-AWARE TERRAIN + HEAVY DECOR (visual overhaul).
    // Grass tile picks now read the biome profile's weight table so the
    // map's color identity shifts as the campaign progresses (W1-3
    // sunny, W4-6 woodland, W7-10 arid, W11-15 dark, W16-18 ruins,
    // W19-20 hellscape). Decor density bumped 0.06 → 0.40 with
    // edge-weighting and path-corridor exclusion so the field reads
    // dense at the borders but stays readable near combat lanes. The
    // prop pool comes from the active biome profile, so each era
    // pulls themed flora (Celtic druid stones, Carthage cypresses,
    // undead tombstones, demon charred logs). Until the Phase 4 prop
    // sheets crop, biome-specific keys silently fall back to the
    // existing 9 universal props via the tex(key) ?? null check.
    const biome = BIOMES[biomeForWave(state.wave ?? 1, (state as any).endlessWaveCfg?.faction)];
    const dirtTiles = ['TT_DIRT_A', 'TT_DIRT_RUTS', 'TT_DIRT_FOOTPRINTS'];
    const decorProps = biome.propPool;
    // Cheap deterministic hash for tile picking — same coords always yield the same sprite.
    const hash = (c: number, r: number, salt = 0) => Math.abs(((c * 73856093) ^ (r * 19349663) ^ (salt * 83492791)) >>> 0);

    // Fallback base wash for any tile that fails sprite lookup
    g.beginFill(0x4a7a3a).drawRect(0, 0, GRID.CANVAS_W, GRID.CANVAS_H).endFill();

    // Clear old children but preserve bgGfx and stainGfx (first 2 children of bg layer)
    while (this.layers.bg.children.length > 2) {
      this.layers.bg.removeChildAt(this.layers.bg.children.length - 1);
    }
    const terrainLayer = new Container();
    const decorLayer = new Container();
    const oceanLayer = new Container();
    const shoreLayer = new Container();
    const coastalDetailLayer = new Container();
    const shoreTrimGfx = new Graphics();
    const waterGfx = new Graphics();
    const oceanCurrentGfx = new Graphics();
    if (!this.oceanAmbientGfx) this.oceanAmbientGfx = new Graphics();
    this.oceanLivingSprites = [];
    const waterDeepKeys = ['OCEAN_DEEP_A', 'OCEAN_DEEP_B'];
    const waterMidKeys = ['OCEAN_MID_A', 'OCEAN_MID_B'];
    const waterShallowKeys = ['OCEAN_SHALLOW_A', 'OCEAN_SHALLOW_B'];
    const waterTowerTiles = new Set<string>();
    for (const tw of state.towers.values()) {
      if ((tw as any).placedOnWater) waterTowerTiles.add(`${tw.tileX},${tw.tileY}`);
    }
    const visuallyWater = (col: number, row: number) =>
      state.tiles[row]?.[col] === TileType.WATER || waterTowerTiles.has(`${col},${row}`);
    const immediateShoreGroundKeys = ['OCEAN_SHORE_SHELLS', 'OCEAN_SHORE_PEBBLES', 'OCEAN_SHORE_FOAM_BITS', 'OCEAN_SHORE_WET_ROCKS'];
    const outerShoreGroundKeys = ['OCEAN_SHORE_PEBBLES', 'OCEAN_SHORE_DRIFTWOOD', 'OCEAN_SHORE_SHELLS', 'OCEAN_SHORE_STARFISH'];
    const italyShoreRockKeys = ['OCEAN_SHORE_ITALY_ROCKS_A', 'OCEAN_SHORE_ITALY_ROCKS_B', 'OCEAN_SHORE_ITALY_ROCKS_C'];
    const addTileSprite = (layer: Container, key: string, x: number, y: number, alpha = 1) => {
      const t0 = tex(key);
      if (!t0) return false;
      const sp = new Sprite(t0);
      sp.x = x; sp.y = y;
      sp.width = GRID.TILE; sp.height = GRID.TILE;
      sp.alpha = alpha;
      layer.addChild(sp);
      return true;
    };
    const waterProximity = (col: number, row: number, maxTiles = 2): number => {
      let best = Infinity;
      for (let dr = -maxTiles; dr <= maxTiles; dr++) {
        for (let dc = -maxTiles; dc <= maxTiles; dc++) {
          if (dc === 0 && dr === 0) continue;
          const d = Math.max(Math.abs(dc), Math.abs(dr));
          if (d > maxTiles || d >= best) continue;
          if (visuallyWater(col + dc, row + dr)) best = d;
        }
      }
      return best === Infinity ? 0 : best;
    };

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
        // Path tiles slightly bias toward the basic dirt; grass picks
        // from the biome's weight table via pickGrassTile() below.
        const h = hash(c, r);
        if (t === TileType.WATER || waterTowerTiles.has(`${c},${r}`)) {
          let edgeDist = 0;
          for (let radius = 1; radius <= 4; radius++) {
            let allWater = true;
            for (let dr = -radius; dr <= radius && allWater; dr++) {
              for (let dc = -radius; dc <= radius && allWater; dc++) {
                if (!visuallyWater(c + dc, r + dr)) allWater = false;
              }
            }
            if (!allWater) break;
            edgeDist = radius;
          }
          const centerDepth = Math.max(0, Math.min(1, edgeDist / 3));
          const localC = c - WATER_ZONE.col;
          const localR = r - WATER_ZONE.row;
          const leftEdgeDepth = 1 - Math.min(1, localC / Math.max(1, WATER_ZONE.width - 1));
          const bottomEdgeDepth = Math.min(1, localR / Math.max(1, WATER_ZONE.height - 1));
          const cornerDepth = Math.sqrt(leftEdgeDepth * bottomEdgeDepth);
          const visualDepth = Math.max(centerDepth * 0.58, cornerDepth);
          const keyPool = visualDepth > 0.65 ? waterDeepKeys : visualDepth > 0.30 ? waterMidKeys : waterShallowKeys;
          const waterKey = keyPool[(h >>> 3) % keyPool.length];
          if (!addTileSprite(oceanLayer, waterKey, x, y)) {
            const palette = visualDepth > 0.65
              ? [0x0b2540, 0x0f3150, 0x123b5a]
              : visualDepth > 0.30
                ? [0x123e5d, 0x15506e, 0x1a5d7a]
                : [0x236b7a, 0x2d7e86, 0x3f8b86];
            waterGfx.beginFill(palette[h % palette.length], 1).drawRect(x, y, GRID.TILE, GRID.TILE).endFill();
          }
          if (visualDepth > 0.36) {
            const darkAlpha = 0.06 + Math.min(0.24, (visualDepth - 0.36) * 0.36);
            waterGfx.beginFill(0x03101e, darkAlpha).drawRect(x, y, GRID.TILE, GRID.TILE).endFill();
          }
          const north = !visuallyWater(c, r - 1);
          const east = !visuallyWater(c + 1, r);
          const south = !visuallyWater(c, r + 1);
          const west = !visuallyWater(c - 1, r);
          if (north) addTileSprite(shoreLayer, 'OCEAN_FOAM_N', x, y, 0.95);
          if (east) addTileSprite(shoreLayer, 'OCEAN_FOAM_E', x, y, 0.86);
          if (south) addTileSprite(shoreLayer, 'OCEAN_FOAM_S', x, y, 0.76);
          if (west) addTileSprite(shoreLayer, 'OCEAN_FOAM_W', x, y, 0.74);
          continue;
        }
        if (t === TileType.EMPTY && isWaterPlacementBufferTile(c, r)) {
          const waterN = visuallyWater(c, r - 1);
          const waterE = visuallyWater(c + 1, r);
          const waterS = visuallyWater(c, r + 1);
          const waterW = visuallyWater(c - 1, r);
          const checkpointFacingSouthShore = waterS;
          const checkpointFacingWestShore = waterW;
          const checkpointFacingShore = checkpointFacingSouthShore || checkpointFacingWestShore;
          if (waterN) shoreTrimGfx.beginFill(0xf2d072, 0.82).drawRect(x + 3, y, GRID.TILE - 6, 3).endFill();
          if (waterE) shoreTrimGfx.beginFill(0xf2d072, 0.72).drawRect(x + GRID.TILE - 3, y + 3, 3, GRID.TILE - 6).endFill();
          if (checkpointFacingShore) {
            const rockTex = tex(italyShoreRockKeys[hash(c, r, 92173) % italyShoreRockKeys.length]);
            if (rockTex) {
              const rock = new Sprite(rockTex);
              rock.anchor.set(0.5);
              rock.x = waterW
                ? x + 3 + ((hash(c, r, 92174) % 5) - 2)
                : x + GRID.TILE / 2 + ((hash(c, r, 92175) % 7) - 3);
              rock.y = waterS
                ? y + GRID.TILE - 4 + ((hash(c, r, 92176) % 3) - 1)
                : y + GRID.TILE / 2 + ((hash(c, r, 92177) % 7) - 3);
              const rockScale = waterW ? 0.72 : 0.78;
              rock.width = GRID.TILE * rockScale;
              rock.height = GRID.TILE * rockScale;
              rock.alpha = 0.94;
              if (waterW) rock.rotation = -Math.PI / 2;
              if ((hash(c, r, 92178) % 2) === 1) rock.scale.x *= -1;
              coastalDetailLayer.addChild(rock);
            }
          }
        }
        let key: string;
        if (isPath) {
          // 70% basic dirt, 15% ruts, 15% footprints. Path-tileset
          // replacement lands in a later phase — until then we keep
          // the dirt textures so the route stays readable. Biome
          // tint overlay (drawAmbient) handles the visual era shift
          // on path tiles for now.
          const roll = h % 100;
          key = roll < 70 ? 'TT_DIRT_A' : roll < 85 ? 'TT_DIRT_RUTS' : 'TT_DIRT_FOOTPRINTS';
        } else {
          // Grass tile pick is biome-weighted. pickGrassTile() reads
          // the active biome's weight table so undead waves bias
          // toward dark grass, arid waves toward dry/stones, etc.
          key = pickGrassTile(biome, h);
        }
        const tex0 = tex(key);
        if (tex0) {
          const sp = new Sprite(tex0);
          sp.x = x; sp.y = y;
          sp.width = GRID.TILE; sp.height = GRID.TILE;
          terrainLayer.addChild(sp);
        } else {
          // Fallback to colored rect if texture missing (non-fatal)
          const fill = isPath ? 0x886533 : 0x426f31;
          g.beginFill(fill).drawRect(x, y, GRID.TILE, GRID.TILE).endFill();
        }
        if (!isPath && t === TileType.EMPTY) {
          const shoreDist = waterProximity(c, r, 2);
          if (shoreDist > 0) {
            const directWater = shoreDist === 1;
            const shoreRoll = hash(c, r, 51511) % 100;
            const detailChance = directWater ? 86 : 48;
            if (shoreRoll < detailChance) {
              const shoreKeys = directWater ? immediateShoreGroundKeys : outerShoreGroundKeys;
              const detailKey = shoreKeys[hash(c, r, 77137) % shoreKeys.length];
              const detailTex = tex(detailKey);
              if (detailTex) {
                const sd = new Sprite(detailTex);
                sd.anchor.set(0.5);
                sd.x = x + GRID.TILE / 2 + ((hash(c, r, 9109) % 7) - 3);
                sd.y = y + GRID.TILE / 2 + ((hash(c, r, 9110) % 7) - 3);
                const sz = GRID.TILE * (directWater ? 1.0 : 0.82);
                sd.width = sz; sd.height = sz;
                sd.alpha = directWater ? 0.92 : 0.66;
                if ((hash(c, r, 9111) % 2) === 1) sd.scale.x *= -1;
                coastalDetailLayer.addChild(sd);
              }
            }
            const tintAlpha = directWater ? 0.10 : 0.045;
            const wetColor = directWater ? 0xd6e3a0 : 0xb6d18a;
            const wetCount = directWater ? 3 : 2;
            for (let i = 0; i < wetCount; i++) {
              const hx = x + 4 + (hash(c, r, 62000 + i) % 23);
              const hy = y + 5 + (hash(c, r, 63000 + i) % 21);
              shoreTrimGfx.beginFill(wetColor, tintAlpha).drawRect(hx, hy, directWater ? 5 : 4, 1).endFill();
            }
          }
        }
        // 2026-05-21 — HEAVY DECOR (visual overhaul phase V2). Density
        // bumped 0.06 → 0.40 with edge-weighting + path-corridor
        // exclusion so the field reads dense at the borders but stays
        // visually clean near combat lanes. Prop pool is biome-aware.
        //
        // 2026-05-22 V26 — Player feedback: "the map feels a little
        // too cluttered, especially near the path." Three tuning
        // changes pulled together:
        //   1. Base density 0.40 → 0.28 (30% less overall).
        //   2. Path corridor check widened from manhattan-1 (4 tiles
        //      checked) to manhattan-2 (8 tiles checked + diagonals).
        //   3. Corridor multiplier 0.30 → 0.12 (4× more aggressive
        //      exclusion in the combat lane).
        // Result: combat lanes stay visually clean (~3% prop density
        // within 2 tiles of path), borders + corners stay rich
        // (~30% density), but the total prop count drops ~35%.
        if (!isPath && t === TileType.EMPTY) {
          // Center-vs-edge weight (1.0 at corners, ~0.7 at dead center).
          const cxNorm = (c - GRID.COLS / 2) / (GRID.COLS / 2);
          const cyNorm = (r - GRID.ROWS / 2) / (GRID.ROWS / 2);
          const edgeBias = 0.7 + 0.5 * Math.min(1, cxNorm * cxNorm + cyNorm * cyNorm);
          // Path corridor exclusion — widened to manhattan-2 in V26.
          // Checks 4 cardinal neighbors AND 4 diagonals AND 4
          // 2-tile-out cells, so every tile within 2 of a path tile
          // gets the dim multiplier.
          let nearPath = false;
          for (let dr = -2; dr <= 2 && !nearPath; dr++) {
            for (let dc = -2; dc <= 2 && !nearPath; dc++) {
              if (Math.abs(dr) + Math.abs(dc) > 2) continue;     // manhattan-2 only
              if (dr === 0 && dc === 0) continue;
              if (pathSet.has(`${c + dc},${r + dr}`)) nearPath = true;
            }
          }
          // 2026-05-22 UX8 — Even stricter corridor exclusion on mobile.
          // On a phone the canvas is rendering at ~220×165 logical
          // pixels — every prop within one tile of the path competes
          // visually with tower silhouettes and enemy sprites at that
          // resolution. Drop the corridor multiplier from 0.12 to 0.04
          // on mobile so the path corridor reads cleanly while
          // edges/corners still feel decorated.
          const onMobile = !!(window as any).__isMobile;
          const corridorMult = nearPath ? (onMobile ? 0.04 : 0.12) : 1.0;
          // 2026-05-22 M5 / UX HM — Mobile perf + Reduce-Decoration
          // opt-in (set from the SETTINGS panel) halve / quarter the
          // density respectively. Combined: a phone with Reduce
          // Decoration on renders ~25% of desktop density.
          const reduceDecor = !!(window as any).__reduceDecor
            || (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-decor'));
          const mobileDensityMult = onMobile ? 0.5 : 1.0;
          const reduceDecorMult = reduceDecor ? 0.5 : 1.0;
          const targetDensity = 0.28 * edgeBias * corridorMult * mobileDensityMult * reduceDecorMult;
          // Roll: hash to 0..0.999, compare to target.
          const propRoll = (h % 1000) / 1000;
          if (propRoll < targetDensity) {
            const propKey = decorProps[hash(c, r, 31337) % decorProps.length];
            const propTex = tex(propKey);
            // tex() returns null for unregistered keys (biome-specific
            // sprites that haven't been Higgsfield-generated yet).
            // Silently skip — the universal prop fallbacks in the
            // pool still satisfy most rolls.
            if (propTex) {
              const dp = new Sprite(propTex);
              dp.anchor.set(0.5);
              dp.x = x + GRID.TILE / 2;
              dp.y = y + GRID.TILE / 2;
              // Per-prop size jitter so the field doesn't grid-stamp.
              const sizeJitter = 0.55 + 0.25 * ((hash(c, r, 91171) % 100) / 100);
              const sz = GRID.TILE * sizeJitter;
              dp.width = sz; dp.height = sz;
              dp.alpha = 0.95;
              decorLayer.addChild(dp);
            }
          }
        }
      }
    }
    for (let r = 0; r < GRID.ROWS; r++) {
      let c = 0;
      while (c < GRID.COLS) {
        while (c < GRID.COLS && state.tiles[r]?.[c] !== TileType.WATER) c++;
        const start = c;
        while (c < GRID.COLS && state.tiles[r]?.[c] === TileType.WATER) c++;
        const end = c - 1;
        if (end - start < 1) continue;
        for (let pass = 0; pass < 2; pass++) {
          const baseY = r * GRID.TILE + 7 + ((r * 7 + pass * 11) % 18);
          const x0 = start * GRID.TILE + 3 + ((r * 5 + pass * 9) % 11);
          const x1 = (end + 1) * GRID.TILE - 5;
          const bright = pass === 0;
          for (let x = x0; x < x1; x += bright ? 11 : 14) {
            const col = Math.floor(x / GRID.TILE);
            if (state.tiles[r]?.[col] !== TileType.WATER) continue;
            const yy = baseY + Math.round(Math.sin((x + r * 13 + pass * 19) * 0.12) * 1.4);
            const len = bright ? 7 : 10;
            oceanCurrentGfx
              .beginFill(bright ? 0xdffff7 : 0x062238, bright ? 0.28 : 0.18)
              .drawRect(Math.round(x), yy, len, 1)
              .endFill();
            if (bright && ((x + r + pass) % 3 === 0)) {
              oceanCurrentGfx
                .beginFill(0x7fd8e2, 0.18)
                .drawRect(Math.round(x + 3), yy + 2, Math.max(3, len - 4), 1)
                .endFill();
            }
          }
        }
      }
    }
    this.layers.bg.addChild(terrainLayer);
    this.layers.bg.addChild(oceanLayer);
    this.layers.bg.addChild(shoreLayer);
    this.layers.bg.addChild(shoreTrimGfx);
    this.layers.bg.addChild(waterGfx);
    this.layers.bg.addChild(oceanCurrentGfx);
    this.oceanAmbientGfx.clear();
    this.layers.bg.addChild(this.oceanAmbientGfx);
    const shipwreckTex = tex('OCEAN_SHIPWRECK');
    if (shipwreckTex) {
      const shipwreck = new Sprite(shipwreckTex);
      shipwreck.x = WATER_ZONE.col * GRID.TILE + 4;
      shipwreck.y = (WATER_ZONE.row + WATER_ZONE.height - 3.45) * GRID.TILE;
      shipwreck.width = GRID.TILE * 4.5;
      shipwreck.height = GRID.TILE * 3.375;
      shipwreck.alpha = 0.96;
      coastalDetailLayer.addChild(shipwreck);
    }
    // Sprite-water dressing in the bottom-left reserve. Drawn above terrain
    // and below all gameplay layers, so the cove gains life without hiding towers.
    const waterDetail: Array<{
      col: number;
      row: number;
      key: string;
      terrain: 'water';
      width?: number;
      height?: number;
      alpha?: number;
      xOffset?: number;
      yOffset?: number;
      living?: boolean;
      ampX?: number;
      ampY?: number;
    }> = [
      { col: WATER_ZONE.col + 1, row: WATER_ZONE.row + 8, key: 'OCEAN_ROCK', terrain: 'water' },
      { col: WATER_ZONE.col + 5, row: WATER_ZONE.row + 6, key: 'OCEAN_CORAL', terrain: 'water' },
      { col: WATER_ZONE.col + 7, row: WATER_ZONE.row + 2, key: 'OCEAN_KELP', terrain: 'water' },
      { col: WATER_ZONE.col + 9, row: WATER_ZONE.row + 4, key: 'OCEAN_FISH', terrain: 'water' },
      { col: WATER_ZONE.col + 2, row: WATER_ZONE.row + 1, key: 'OCEAN_FISH', terrain: 'water' },
      {
        col: WATER_ZONE.col + 7,
        row: WATER_ZONE.row + WATER_ZONE.height - 6,
        key: 'OCEAN_SEA_GIANT_HEAD',
        terrain: 'water',
        width: GRID.TILE * 2.85,
        height: GRID.TILE * 2.85,
        alpha: 0.98,
        yOffset: -GRID.TILE * 0.35,
        living: true,
        ampX: 0.2,
        ampY: 0.45
      }
    ];
    for (const d of waterDetail) {
      const x = d.col * GRID.TILE + (d.xOffset ?? 0);
      const y = d.row * GRID.TILE + (d.yOffset ?? 0);
      const tile = state.tiles[d.row]?.[d.col];
      if (d.terrain === 'water' && tile !== TileType.WATER) continue;
      const detailTex = tex(d.key);
      if (!detailTex) continue;
      const sp = new Sprite(detailTex);
      sp.x = x; sp.y = y;
      sp.width = d.width ?? GRID.TILE;
      sp.height = d.height ?? GRID.TILE;
      sp.alpha = d.alpha ?? (d.key === 'OCEAN_FISH' ? 0.78 : 0.95);
      coastalDetailLayer.addChild(sp);
      if (d.living || d.key === 'OCEAN_FISH' || d.key === 'OCEAN_KELP' || d.key === 'OCEAN_CORAL') {
        this.oceanLivingSprites.push({
          sp,
          baseX: x,
          baseY: y,
          baseAlpha: sp.alpha,
          phase: (d.col * 0.73 + d.row * 1.11) % 6.28,
          ampX: d.ampX ?? (d.key === 'OCEAN_FISH' ? 1.6 : 0.6),
          ampY: d.ampY ?? (d.key === 'OCEAN_FISH' ? 1.0 : 0.45)
        });
      }
    }
    this.layers.bg.addChild(coastalDetailLayer);

    // 2026-05-21 — PROCEDURAL COBBLESTONE OVERLAY (visual overhaul
    // phase V7). The biggest "high-fidelity map" lever — draws
    // individual cobblestones with visible mortar lines, soft
    // highlights, and biome-specific stone palettes directly on top
    // of the dirt path tiles. Pure Pixi Graphics, no new sprites.
    //
    // Each path tile is rendered as a 4×4 mini-grid of stones (~7px
    // wide each with 1px mortar). Stone color jitter per-stone +
    // top-left highlight + bottom-right shadow gives each cobble a
    // hand-laid feel. Biome palette swaps automatically — sunny
    // sandstone (W1-10), mossy gray-green (W11-15), scorched
    // black-red (W19-20). The dirt tile underneath provides a base
    // wash so any gaps between stones blend cleanly.
    const cobbleGfx = new Graphics();
    // Biome-specific cobblestone palette.
    const cobblePalette = (() => {
      const id = biome.id;
      if (id === 'BIOME_UNDEAD_FOREST' || id === 'BIOME_UNDEAD_RUINS') {
        return { base: 0x6a6a5a, jitter: [0x5a5a4a, 0x7a7a6a, 0x4a4a3a], mortar: 0x1a1a14, hl: 0x8a8a78, sh: 0x2a2a20 };
      }
      if (id === 'BIOME_HELLSCAPE') {
        return { base: 0x3a2418, jitter: [0x4a1808, 0x2a1408, 0x6a2a18], mortar: 0x0a0400, hl: 0xff5a20, sh: 0x100400 };
      }
      // Sunny Roman default (W1-10)
      return { base: 0xa68a5e, jitter: [0xb89a6e, 0x9c7a4e, 0xa68a5e, 0xc0a880], mortar: 0x3a2a14, hl: 0xd8c098, sh: 0x4a3018 };
    })();
    const COBBLES_PER_SIDE = 4;
    const COBBLE_W = GRID.TILE / COBBLES_PER_SIDE;     // 8px
    for (let r = 0; r < GRID.ROWS; r++) {
      for (let c = 0; c < GRID.COLS; c++) {
        if (!pathSet.has(`${c},${r}`)) continue;
        const tx = c * GRID.TILE;
        const ty = r * GRID.TILE;
        // Mortar base — fills the whole tile with mortar color so
        // any gap between cobbles reads as dark stone joint.
        cobbleGfx.beginFill(cobblePalette.mortar, 0.85).drawRect(tx, ty, GRID.TILE, GRID.TILE).endFill();
        for (let sy = 0; sy < COBBLES_PER_SIDE; sy++) {
          for (let sx = 0; sx < COBBLES_PER_SIDE; sx++) {
            // Per-cobble offset and size jitter for "hand-laid" feel.
            const cobbleHash = hash(c * 16 + sx, r * 16 + sy, 717);
            const sizeJitter = (cobbleHash % 3) - 1;          // -1..+1 px
            const offsetX = ((cobbleHash >>> 4) % 3) - 1;
            const offsetY = ((cobbleHash >>> 8) % 3) - 1;
            const x0 = tx + sx * COBBLE_W + 0.7 + offsetX * 0.4;
            const y0 = ty + sy * COBBLE_W + 0.7 + offsetY * 0.4;
            const w = COBBLE_W - 1.4 + sizeJitter * 0.3;
            const h0 = COBBLE_W - 1.4 + sizeJitter * 0.3;
            // Pick a base shade from the palette jitter list.
            const shade = cobblePalette.jitter[(cobbleHash >>> 12) % cobblePalette.jitter.length];
            // Stone body
            cobbleGfx.beginFill(shade, 1).drawRect(x0, y0, w, h0).endFill();
            // Top-left highlight (1px line)
            cobbleGfx.beginFill(cobblePalette.hl, 0.55).drawRect(x0, y0, w, 0.9).endFill();
            cobbleGfx.beginFill(cobblePalette.hl, 0.45).drawRect(x0, y0, 0.9, h0).endFill();
            // Bottom-right shadow (1px line)
            cobbleGfx.beginFill(cobblePalette.sh, 0.55).drawRect(x0, y0 + h0 - 0.9, w, 0.9).endFill();
            cobbleGfx.beginFill(cobblePalette.sh, 0.45).drawRect(x0 + w - 0.9, y0, 0.9, h0).endFill();
          }
        }
      }
    }
    this.layers.bg.addChild(cobbleGfx);

    // 2026-05-21 — STATIC BATTLE DEBRIS (visual overhaul phase V2).
    // Curated corpse / blood / weapon sprites pre-placed at hand-
    // anchored coordinates near the path. Adds "this gate has been
    // defended for a hundred years" narrative even on Wave 1.
    // Debris layer sits BELOW the regular decor layer so a bush can
    // partially cover a fallen soldier for added depth. Sprite keys
    // (`DBR_*`) crop in Phase 5 — until then tex() returns null and
    // anchors silently skip. The anchor table itself is committed
    // now so the placement positions don't churn later.
    const debrisLayer = new Container();
    // 2026-05-21 — PROCEDURAL BATTLE DEBRIS (visual overhaul phase V7+).
    // Each anchor key falls through to a procedural Graphics draw if
    // the sprite isn't registered yet. This guarantees all 12 anchor
    // positions show SOMETHING — no silent slots — telling the
    // "legions died defending this gate" story from Wave 1.
    const debrisGfx = new Graphics();
    for (const anchor of STATIC_BATTLE_DEBRIS) {
      const cx = anchor.col * GRID.TILE + GRID.TILE / 2;
      const cy = anchor.row * GRID.TILE + GRID.TILE / 2;
      const debrisTex = tex(anchor.key);
      if (debrisTex) {
        const dp = new Sprite(debrisTex);
        dp.anchor.set(0.5);
        dp.x = cx;
        dp.y = cy;
        const sz = GRID.TILE * 0.75;
        dp.width = sz; dp.height = sz;
        dp.alpha = 0.92;
        debrisLayer.addChild(dp);
      } else {
        // Procedural fallback by key family. Each one is a 5-10 op
        // Pixi Graphics draw — cheap and visually distinct from the
        // grass/cobble underneath.
        if (anchor.key.startsWith('DBR_BLOOD')) {
          // Dried blood splotch — irregular dark red circles
          const big = anchor.key === 'DBR_BLOOD_LARGE';
          const r = big ? 9 : 6;
          debrisGfx.beginFill(0x4a0808, 0.8).drawCircle(cx, cy, r).endFill();
          debrisGfx.beginFill(0x6a1010, 0.7).drawCircle(cx - 2, cy + 1, r * 0.6).endFill();
          debrisGfx.beginFill(0x4a0808, 0.75).drawCircle(cx + 3, cy - 2, r * 0.45).endFill();
          if (big) {
            // Drag smear extending to the side
            debrisGfx.beginFill(0x3a0606, 0.6).drawRect(cx + 4, cy - 1, 10, 2.5).endFill();
          }
        } else if (anchor.key === 'DBR_BROKEN_PILUM') {
          // 3 broken javelin shafts at angles
          debrisGfx.lineStyle(1.4, 0x6a4a18, 0.92);
          debrisGfx.moveTo(cx - 7, cy + 4).lineTo(cx + 5, cy - 5);
          debrisGfx.moveTo(cx - 5, cy - 4).lineTo(cx + 7, cy + 5);
          debrisGfx.moveTo(cx - 8, cy).lineTo(cx + 8, cy);
          debrisGfx.lineStyle(0);
          // Iron tips
          debrisGfx.beginFill(0xc8c8c8, 0.95);
          debrisGfx.drawCircle(cx + 5, cy - 5, 1.2);
          debrisGfx.drawCircle(cx + 7, cy + 5, 1.2);
          debrisGfx.drawCircle(cx + 8, cy, 1.2);
          debrisGfx.endFill();
        } else if (anchor.key === 'DBR_GLADIUS') {
          // Lying Roman sword — blade + crossguard + hilt
          debrisGfx.beginFill(0xc8c8c8, 0.95).drawRect(cx - 6, cy - 1, 10, 2).endFill();
          debrisGfx.beginFill(0x6a4a18, 0.95).drawRect(cx + 4, cy - 2, 1.5, 4).endFill();
          debrisGfx.beginFill(0x8a5a2a, 0.95).drawRect(cx + 5.5, cy - 1.5, 3, 3).endFill();
        } else if (anchor.key === 'DBR_BROKEN_SHIELD_CELT') {
          // Round wooden shield broken in half — semicircle with crack
          debrisGfx.beginFill(0x4a3a1a, 0.95).drawCircle(cx, cy, 7).endFill();
          debrisGfx.beginFill(0x2a1a08, 0.95).drawRect(cx - 1, cy - 7, 2, 14).endFill();
          // Center boss
          debrisGfx.beginFill(0x8a6a3a, 0.95).drawCircle(cx, cy, 2).endFill();
        } else if (anchor.key === 'DBR_SKELETAL_REMAINS') {
          // Skull + 2 ribs — pure white-ish
          debrisGfx.beginFill(0xe0d8c8, 0.95).drawCircle(cx - 3, cy, 3).endFill();
          debrisGfx.beginFill(0x1a1410, 1).drawCircle(cx - 3.5, cy - 0.5, 0.6).endFill();
          debrisGfx.beginFill(0x1a1410, 1).drawCircle(cx - 2.5, cy - 0.5, 0.6).endFill();
          debrisGfx.beginFill(0xe0d8c8, 0.85).drawRect(cx + 1, cy - 2, 7, 1.2).endFill();
          debrisGfx.beginFill(0xe0d8c8, 0.85).drawRect(cx + 1, cy + 1, 7, 1.2).endFill();
        } else if (anchor.key === 'DBR_SCATTERED_SCROLLS') {
          // 3 unfurled parchment rectangles + tiny helmet dot
          debrisGfx.beginFill(0xe0c890, 0.92);
          debrisGfx.drawRoundedRect(cx - 7, cy - 4, 6, 4, 1);
          debrisGfx.drawRoundedRect(cx - 1, cy + 1, 6, 4, 1);
          debrisGfx.drawRoundedRect(cx + 2, cy - 3, 5, 4, 1);
          debrisGfx.endFill();
          // Helmet
          debrisGfx.beginFill(0x8a6a3a, 0.95).drawCircle(cx - 5, cy + 5, 2).endFill();
        } else {
          // Fallen-soldier silhouettes (ROMAN_FALLEN_A/B/C, CELTIC_FALLEN, CARTHAGE_FALLEN)
          // Top-down body shape: torso + head + arms outline. Tint
          // varies by faction.
          const tint = anchor.key.includes('CELTIC') ? 0x4a3a2a
                     : anchor.key.includes('CARTHAGE') ? 0x6a5a3a
                     : 0x6a1818;   // Roman red tunic
          // Body
          debrisGfx.beginFill(tint, 0.92).drawRoundedRect(cx - 4, cy - 6, 8, 12, 2).endFill();
          // Head
          debrisGfx.beginFill(0xc8a878, 0.95).drawCircle(cx, cy - 6, 2.4).endFill();
          // Helmet (Roman only)
          if (anchor.key.startsWith('DBR_ROMAN_FALLEN')) {
            debrisGfx.beginFill(0xffd34d, 0.95).drawCircle(cx, cy - 7, 2.6).endFill();
            // Red crest
            debrisGfx.beginFill(0xc02020, 0.92).drawRect(cx - 0.5, cy - 9.5, 1, 3).endFill();
          }
          // Arms outstretched
          debrisGfx.beginFill(tint, 0.85);
          debrisGfx.drawRect(cx - 7, cy - 3, 3, 1.5);
          debrisGfx.drawRect(cx + 4, cy - 3, 3, 1.5);
          debrisGfx.endFill();
          // Tiny blood pool below
          debrisGfx.beginFill(0x4a0808, 0.45).drawCircle(cx, cy + 7, 3).endFill();
        }
      }
    }
    debrisLayer.addChild(debrisGfx);
    this.layers.bg.addChild(debrisLayer);

    // 2026-05-22 — CORNER SHRINES. Player-supplied art sheets cropped
    // into 17 ornate Roman-shrine/SPQR/skull-banner pieces, scattered
    // a handful in the top-right and bottom-left corners of the map
    // for visual flair. These sit in the unbuildable BORDER ring (the
    // 2-tile rim around the play area), so they never overlap with
    // gameplay tiles. Placement is hand-anchored so each corner reads
    // as a deliberate composition rather than random scatter.
    //
    // Top-right cluster — 5 pieces, sized larger than regular decor
    // (1.5 tiles instead of 1). Bottom-left cluster — 4 pieces with
    // the bigger SPQR-banner shrines as the focal anchors.
    const cornerLayer = new Container();
    type CornerAnchor = {
      col: number;
      row: number;
      key: string;
      scale: number;
      xOffset?: number;
      yOffset?: number;
    };
    const CORNERS: CornerAnchor[] = [
      // Top-right corner (rows 0-3, cols 33-37)
      { col: 35, row: 1,  key: 'MAP_CORNER_SHRINE_B3', scale: 1.7 },     // skull-on-laurel SPQR banner
      { col: 33, row: 2,  key: 'MAP_CORNER_SHRINE_A4', scale: 1.4 },     // ornate column
      { col: 36, row: 3,  key: 'MAP_CORNER_SHRINE_A6', scale: 1.3 },     // SPQR banner column
      { col: 34, row: 4,  key: 'MAP_CORNER_SHRINE_B1', scale: 1.3 },     // ruined arch
      { col: 36, row: 0,  key: 'MAP_CORNER_SHRINE_A2', scale: 1.2 },     // small column
      // Bloody Cyclops trophy: anchored to the immutable top border, then
      // nudged inward so world zoom never clips its face or blood pool.
      { col: 36, row: 0, key: 'MAP_CYCLOPS_SEVERED_HEAD', scale: 2.85, xOffset: -24, yOffset: 144 }
    ];
    for (const anchor of CORNERS) {
      const cTex = tex(anchor.key);
      if (!cTex) continue;     // silently skip if texture not loaded
      // Skip if the anchor tile is actually buildable (defensive — these
      // should land in the border ring but the check protects against
      // any future GRID resize misalignment).
      const tile = state.tiles[anchor.row]?.[anchor.col];
      if (tile === TileType.EMPTY) continue;
      const sp = new Sprite(cTex);
      sp.anchor.set(0.5);
      sp.x = anchor.col * GRID.TILE + GRID.TILE / 2 + (anchor.xOffset ?? 0);
      sp.y = anchor.row * GRID.TILE + GRID.TILE / 2 + (anchor.yOffset ?? 0);
      const sz = GRID.TILE * anchor.scale;
      sp.width = sz; sp.height = sz;
      sp.alpha = 0.96;
      cornerLayer.addChild(sp);
    }
    this.layers.bg.addChild(cornerLayer);

    this.layers.bg.addChild(decorLayer);

    // GHOST PATH — the immutable brown stripe showing the unblocked enemy
    // route. Drawn ABOVE the terrain layer (so it shows on top of grass)
    // but BELOW path-edge-shadows / decor / towers. Never changes during
    // the run — captured once at game start.
    const ghostPath: { col: number; row: number }[] | undefined = (state as any).ghostPath;
    if (ghostPath && ghostPath.length >= 2) {
      const ghostGfx = new Graphics();
      // Soft brown stripe under the path tiles
      ghostGfx.lineStyle(GRID.TILE * 0.55, 0x6b4a2a, 0.32);
      for (let i = 0; i < ghostPath.length; i++) {
        const t0 = ghostPath[i];
        const cx = t0.col * GRID.TILE + GRID.TILE / 2;
        const cy = t0.row * GRID.TILE + GRID.TILE / 2;
        if (i === 0) ghostGfx.moveTo(cx, cy);
        else ghostGfx.lineTo(cx, cy);
      }
      // Dashed brighter inline so the route still reads when towers cover it
      ghostGfx.lineStyle(2.5, 0x8a5a30, 0.62);
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

    // CAVE: dramatic 4×4 entry with biome-aware glow + carved-stone frame.
    // 2026-05-21 — Phase V11 upgrade. Sprite render size bumped 86 →
    // 112px (3.5 tiles). Ornate procedural frame layered underneath:
    // rocky cliff cutout, biome-colored portal glow, carved column
    // pilasters flanking the entrance.
    const caveCx = waypointsData.spawn.col * GRID.TILE + GRID.TILE / 2;
    const caveCy = waypointsData.spawn.row * GRID.TILE + GRID.TILE / 2;
    const caveFrame = new Graphics();
    // Biome-aware portal glow color
    const caveGlowColor = (() => {
      switch (biome.id) {
        case 'BIOME_GRASSLAND':       return 0xffaa44;       // warm torch
        case 'BIOME_CELTIC_WOOD':     return 0xddee88;       // pale yellow torch
        case 'BIOME_CARTHAGE_ARID':   return 0xffd078;       // dry desert torch
        case 'BIOME_UNDEAD_FOREST':   return 0x9050ff;       // purple portal
        case 'BIOME_UNDEAD_RUINS':    return 0x60dd80;       // sickly green miasma
        case 'BIOME_HELLSCAPE':       return 0xff3018;       // demon red
      }
    })();
    // Outer rocky cliff (large, organic). Drawn 4×4 = 128px footprint.
    caveFrame.beginFill(0x2a2622, 1).drawRoundedRect(caveCx - 64, caveCy - 64, 128, 128, 18).endFill();
    caveFrame.beginFill(0x3b342c, 1).drawRoundedRect(caveCx - 56, caveCy - 56, 112, 112, 16).endFill();
    // Carved column pilasters (left + right of entrance)
    caveFrame.beginFill(0x5a4a32, 1);
    caveFrame.drawRect(caveCx - 58, caveCy - 50, 7, 96);     // left column
    caveFrame.drawRect(caveCx + 51, caveCy - 50, 7, 96);     // right column
    caveFrame.endFill();
    // Column highlights (subtle vertical line)
    caveFrame.beginFill(0x7a6a48, 0.9);
    caveFrame.drawRect(caveCx - 57, caveCy - 50, 1.4, 96);
    caveFrame.drawRect(caveCx + 56.6, caveCy - 50, 1.4, 96);
    caveFrame.endFill();
    // Column capitals (decorated top + bottom)
    caveFrame.beginFill(0x6a5a3a, 1);
    caveFrame.drawRect(caveCx - 60, caveCy - 52, 11, 4);
    caveFrame.drawRect(caveCx - 60, caveCy + 42, 11, 4);
    caveFrame.drawRect(caveCx + 49, caveCy - 52, 11, 4);
    caveFrame.drawRect(caveCx + 49, caveCy + 42, 11, 4);
    caveFrame.endFill();
    // Inner shadow well — pitch-dark interior
    caveFrame.beginFill(0x000000, 0.85).drawCircle(caveCx, caveCy, 48).endFill();
    caveFrame.beginFill(0x1a0d2a, 0.90).drawCircle(caveCx, caveCy, 38).endFill();
    // Biome-colored portal glow (replaces hardcoded purple)
    caveFrame.beginFill(caveGlowColor, 0.22).drawCircle(caveCx, caveCy, 88).endFill();
    caveFrame.beginFill(caveGlowColor, 0.12).drawCircle(caveCx, caveCy, 118).endFill();
    this.layers.bg.addChild(caveFrame);
    // Biome-aware cave entrance sprite. Sunny biomes (grassland/celtic/
    // carthage) use the user-supplied dramatic skull-cave reference;
    // undead biomes use the craftpix skull-door variants. DARK_CAVE
    // is the universal fallback.
    const caveKey = biome.caveKey;
    const cave = tex(caveKey) ?? tex('DARK_CAVE');
    if (cave) {
      const cs = new Sprite(cave);
      cs.anchor.set(0.5); cs.x = caveCx; cs.y = caveCy;
      // 2026-05-21 — Bumped 86 → 112px (3.5 tile) for visual drama.
      // 2026-05-22 — Reverted off the 160×196 user-supplied size when
      // those reference sprites were rolled back. The 112×112 fits
      // inside the procedural stone frame cleanly.
      cs.width = 112; cs.height = 112;
      this.layers.bg.addChild(cs);
    }

    // 2026 v2 spec Ch7 — CAVE B (second spawn), drawn only when defined. A
    // compact mirror of the main cave so its W21+ enemies emerge from a real
    // archway, not blank ground. Reuses the biome glow color + cave texture.
    const caveB = (waypointsData as any).caveB;
    if (caveB) {
      const bcx = caveB.col * GRID.TILE + GRID.TILE / 2;
      const bcy = caveB.row * GRID.TILE + GRID.TILE / 2;
      const bf = new Graphics();
      bf.beginFill(0x2a2622, 1).drawRoundedRect(bcx - 48, bcy - 48, 96, 96, 14).endFill();
      bf.beginFill(0x3b342c, 1).drawRoundedRect(bcx - 42, bcy - 42, 84, 84, 12).endFill();
      bf.beginFill(0x000000, 0.85).drawCircle(bcx, bcy, 36).endFill();
      bf.beginFill(0x1a0d2a, 0.90).drawCircle(bcx, bcy, 28).endFill();
      bf.beginFill(caveGlowColor, 0.22).drawCircle(bcx, bcy, 66).endFill();
      bf.beginFill(caveGlowColor, 0.12).drawCircle(bcx, bcy, 90).endFill();
      this.layers.bg.addChild(bf);
      // 2026 v2 spec Ch7 — created HIDDEN. drawAmbient reveals it the moment
      // the first enemy emerges from Cave B (state.caveBActive), so it stays a
      // surprise instead of sitting on the map from W1.
      bf.visible = false;
      (this as any).__caveBGfx = bf;
      const caveTexB = tex(biome.caveKey) ?? tex('DARK_CAVE');
      if (caveTexB) {
        const cbs = new Sprite(caveTexB);
        cbs.anchor.set(0.5); cbs.x = bcx; cbs.y = bcy;
        cbs.width = 84; cbs.height = 84;
        cbs.visible = false;
        this.layers.bg.addChild(cbs);
        (this as any).__caveBSprite = cbs;
      }
    }

    // GATE: 4×4 fortress with biome-aware glow + crenellated frame.
    // 2026-05-21 — Phase V11 upgrade. Sprite size 76 → 112px. Added
    // crenellation frame + flanking pilasters + brighter gold halo.
    const gateCx = waypointsData.gate.col * GRID.TILE + GRID.TILE / 2;
    const gateCy = waypointsData.gate.row * GRID.TILE + GRID.TILE / 2;
    const gateFrame = new Graphics();
    // Bigger gold glow underneath (warmth — civilization to defend)
    gateFrame.beginFill(0xd4af37, 0.24).drawCircle(gateCx, gateCy, 72).endFill();
    gateFrame.beginFill(0xd4af37, 0.14).drawCircle(gateCx, gateCy, 100).endFill();
    // Crenellated outer frame (stone color with battlements)
    gateFrame.beginFill(0x3a3025, 1).drawRoundedRect(gateCx - 60, gateCy - 60, 120, 120, 6).endFill();
    gateFrame.beginFill(0x6a5a3a, 1).drawRoundedRect(gateCx - 56, gateCy - 56, 112, 112, 4).endFill();
    // Battlements along the top edge
    for (let bx = -54; bx <= 54; bx += 12) {
      gateFrame.beginFill(0x3a3025, 1).drawRect(gateCx + bx, gateCy - 64, 6, 8).endFill();
    }
    // Inner sandstone wall
    gateFrame.beginFill(0xa68a5e, 1).drawRoundedRect(gateCx - 48, gateCy - 48, 96, 96, 2).endFill();
    // Watchtower pilasters (left + right)
    gateFrame.beginFill(0x3a3025, 1);
    gateFrame.drawRect(gateCx - 56, gateCy - 56, 10, 112);
    gateFrame.drawRect(gateCx + 46, gateCy - 56, 10, 112);
    gateFrame.endFill();
    // Tower pilaster highlights
    gateFrame.beginFill(0x7a6a48, 0.7);
    gateFrame.drawRect(gateCx - 55, gateCy - 56, 1.5, 112);
    gateFrame.drawRect(gateCx + 53.5, gateCy - 56, 1.5, 112);
    gateFrame.endFill();
    this.layers.bg.addChild(gateFrame);
    // 2026-05-22 — Reverted off MAP_GATE_USER_ROME per design feedback.
    // Universal gate render falls back to the procedural ROMAN_GATE
    // sprite (the original Roman fortress art). The crenellated frame
    // + pilasters above provide the architectural setting.
    const gate = tex('ROMAN_GATE');
    if (gate) {
      const gs = new Sprite(gate);
      gs.anchor.set(0.5); gs.x = gateCx; gs.y = gateCy;
      // 2026-05-21 — Bumped 76 → 100px so the gate sprite fills the
      // ornate frame instead of floating in the middle.
      gs.width = 100; gs.height = 100;
      this.layers.bg.addChild(gs);
    }

    // Waypoint coins — 1-tile checkpoints.
    // 2026-05-21 — ORNATE MEDALLION UPGRADE (visual overhaul phase V8).
    // Wraps the existing WP1-WP7 sprite with multi-layer procedural
    // ornament: outer halo, drop-shadow ring, bronze rim with notches,
    // laurel wreath dots, inner darker ring, sprite coin, Roman
    // numeral label. Reads as a proper raised Roman medallion at any
    // zoom level. Pure Pixi Graphics — no new sprite assets needed.
    this.layers.waypoints.removeChildren();
    waypointsData.waypoints.forEach((wp, i) => {
      const cx = wp.topLeft.col * GRID.TILE + GRID.TILE / 2;
      const cy = wp.topLeft.row * GRID.TILE + GRID.TILE / 2;
      const R_OUTER = GRID.TILE / 2 + 3;     // 19px
      const R_RIM   = GRID.TILE / 2 + 1;     // 17px
      const R_INNER = GRID.TILE / 2 - 2;     // 14px
      // ── 1. Soft outer halo (warm gold bleed beyond the medallion) ──
      const halo = new Graphics();
      halo.beginFill(0xffd34d, 0.10).drawCircle(cx, cy, R_OUTER + 6).endFill();
      halo.beginFill(0xffd34d, 0.16).drawCircle(cx, cy, R_OUTER + 2).endFill();
      // ── 2. Drop shadow (gives the medallion physical depth) ──
      halo.beginFill(0x000000, 0.45).drawCircle(cx + 1.5, cy + 2.5, R_OUTER).endFill();
      // ── 3. Bronze rim disk (the medallion edge) ──
      halo.beginFill(0x8a5a2a, 1.0).drawCircle(cx, cy, R_OUTER).endFill();
      // Highlight on the upper-left of the rim — sells the bronze
      // material — by overlaying a slightly-offset lighter circle.
      halo.beginFill(0xd0a868, 0.55).drawCircle(cx - 1.2, cy - 1.2, R_OUTER - 0.5).endFill();
      // ── 4. Inner step — slightly recessed marble inlay color ──
      halo.beginFill(0xc09a4a, 1.0).drawCircle(cx, cy, R_RIM).endFill();
      // ── 5. Bronze notches at 8 cardinal points (engraved rim) ──
      const notchA = 0.85;
      halo.beginFill(0x4a2a14, notchA);
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2;
        const nx = cx + Math.cos(ang) * (R_OUTER - 1.2);
        const ny = cy + Math.sin(ang) * (R_OUTER - 1.2);
        halo.drawRect(nx - 0.6, ny - 0.6, 1.4, 1.4);
      }
      halo.endFill();
      // ── 6. Laurel wreath dots (tiny green leaf cluster around rim) ──
      halo.beginFill(0x5a7a3a, 0.85);
      for (let k = 0; k < 16; k++) {
        if (k % 2 === 0) continue;        // skip alternates for spacing
        const ang = (k / 16) * Math.PI * 2 + 0.1;
        const lx = cx + Math.cos(ang) * (R_OUTER - 2);
        const ly = cy + Math.sin(ang) * (R_OUTER - 2);
        halo.drawCircle(lx, ly, 0.9);
      }
      halo.endFill();
      // ── 7. Inner contrast ring ──
      halo.lineStyle(1.2, 0x4a2a14, 0.85).drawCircle(cx, cy, R_INNER + 0.5);
      this.layers.waypoints.addChild(halo);
      // ── 8. WP sprite coin (existing sprite reused as the medallion face) ──
      const t = tex(`WP${i + 1}`);
      if (t) {
        const sp = new Sprite(t);
        sp.anchor.set(0.5);
        sp.x = cx;
        sp.y = cy - 0.5;          // slight upward bias so the engraving reads
        sp.width = R_INNER * 1.85;
        sp.height = R_INNER * 1.85;
        this.layers.waypoints.addChild(sp);
      }
      // ── 9. Bright outer ring (defines silhouette) ──
      const ring = new Graphics();
      ring.lineStyle(1.5, 0xffd34d, 0.92).drawCircle(cx, cy, R_OUTER);
      this.layers.waypoints.addChild(ring);
      // ── 10. Roman numeral label under the medallion ──
      const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
      const labelStyle = new TextStyle({
        fontFamily: 'Courier New',
        fontSize: 10,
        fill: 0xffd34d,
        stroke: 0x1a0e08,
        strokeThickness: 2,
        fontWeight: 'bold'
      });
      const label = new Text(ROMAN[i] ?? `${i + 1}`, labelStyle);
      label.anchor.set(0.5);
      label.x = cx;
      label.y = cy + R_OUTER + 7;
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
    // 2026-05-21 V13 — Same fix for the ornate medallion sprite layer
    // added in this phase. The bg-child clear in drawStatic would
    // detach the medallion sprites after every static rebuild,
    // re-blanking the aura tiles. Re-add at the end so the medallions
    // paint OVER the procedural halos drawn into auraTileGfx.
    this.layers.bg.addChild(this.auraTileSprites);
  }

  // Render dynamic state each frame.
  drawDynamic(state: GameStateShape) {
    this.heroAttackGfx.clear();
    // 2026-05-22 V27 — Stone-tile rendering is now dirty-checked. The
    // V26 stamp work was being repeated 60×/sec even when the stone
    // set hadn't changed (which is most of every wave). Hash the
    // current stone set; only rebuild on change.
    let stoneHash = 0;
    for (let r = 0; r < GRID.ROWS; r++) {
      for (let c = 0; c < GRID.COLS; c++) {
        if (state.tiles[r][c] === TileType.STONE) {
          // Cantor-pair the (r, c) into a unique integer then xor.
          stoneHash ^= (r * 41 + c) * 2654435761;
        }
      }
    }
    if (stoneHash !== this.__lastStoneHash) {
      this.__lastStoneHash = stoneHash;
      // Tile overlays (stones, towers placed) — full rebuild on change.
      this.layers.tiles.removeChildren();
      // 2026-05-22 V26 — Every STONE tile gets an etched bronze Aquila
      // (Roman eagle medallion) overlay so players can read a stone at
      // a glance versus a grass tile or a built tower. Compound shape:
      //   - Bronze base disc (recessed seal background)
      //   - Inner dark ring (gives the seal physical depth)
      //   - Eagle body diamond + spread V wings
      //   - Tiny red SPQR drip below as the Roman accent
      // No new sprite assets — pure Graphics so it always renders crisp.
      //
      // 2026-07-03 — STONE RAMPARTS: tiles covered by an INTACT rampart
      // (all 5 tiles still STONE) skip the individual block + stamp and get
      // the connected RAMPART_STRIP sprite instead (rotated for vertical).
      // Selling any block of a rampart breaks the strip — those tiles fall
      // back to ordinary stone rendering automatically.
      const rampartCovered = new Set<number>();
      const intactRamparts: { col: number; row: number; orient: 'H' | 'V' | 'D1' | 'D2' }[] = [];
      // Per-orientation unit steps (must mirror RampartSystem.orientStep).
      const RAMP_STEP: Record<string, { dc: number; dr: number }> = {
        H: { dc: 1, dr: 0 }, V: { dc: 0, dr: 1 }, D1: { dc: 1, dr: 1 }, D2: { dc: 1, dr: -1 }
      };
      for (const rp of state.placedRamparts ?? []) {
        const step = RAMP_STEP[rp.orient] ?? RAMP_STEP.H;
        const tiles: { col: number; row: number }[] = [];
        for (let i = -2; i <= 2; i++) {
          tiles.push({ col: rp.col + i * step.dc, row: rp.row + i * step.dr });
        }
        const intact = tiles.every(t => state.tiles[t.row]?.[t.col] === TileType.STONE);
        if (intact && tex('RAMPART_STRIP')) {
          intactRamparts.push(rp);
          for (const t of tiles) rampartCovered.add(t.row * GRID.COLS + t.col);
        }
      }
      for (const rp of intactRamparts) {
        const strip = tex('RAMPART_STRIP')!;
        const sp = new Sprite(strip);
        sp.anchor.set(0.5);
        sp.x = rp.col * GRID.TILE + GRID.TILE / 2;
        sp.y = rp.row * GRID.TILE + GRID.TILE / 2;
        // Rotation per orientation; screen y grows downward, so D1 (↘) is
        // +45° and D2 (↗) is -45°. Diagonal tile centers sit √2·TILE apart,
        // so the diagonal strip stretches its long axis by √2 to keep each
        // of the 5 blocks centered on its own tile.
        const diag = rp.orient === 'D1' || rp.orient === 'D2';
        sp.rotation = rp.orient === 'V' ? Math.PI / 2
          : rp.orient === 'D1' ? Math.PI / 4
          : rp.orient === 'D2' ? -Math.PI / 4
          : 0;
        // width/height are pre-rotation local axes: long axis 5 tiles.
        sp.width = GRID.TILE * 5 * (diag ? Math.SQRT2 : 1);
        sp.height = GRID.TILE;
        this.layers.tiles.addChild(sp);
      }
      const stoneStamp = new Graphics();
      for (let r = 0; r < GRID.ROWS; r++) {
        for (let c = 0; c < GRID.COLS; c++) {
          const t = state.tiles[r][c];
          if (t === TileType.STONE) {
            if (rampartCovered.has(r * GRID.COLS + c)) continue;
            const cx = c * GRID.TILE + GRID.TILE / 2;
            const cy = r * GRID.TILE + GRID.TILE / 2;
            const stone = tex('STONE_BLOCK');
            if (stone) {
              const sp = new Sprite(stone);
              sp.anchor.set(0.5);
              sp.x = cx;
              sp.y = cy;
              sp.width = GRID.TILE; sp.height = GRID.TILE;
              this.layers.tiles.addChild(sp);
            }
            // ── Aquila stamp ─────────────────────────────────────────
            // Bronze base disc (7px radius — about a quarter of the tile)
            stoneStamp.beginFill(0x3a2614, 0.85).drawCircle(cx, cy, 8).endFill();
            stoneStamp.beginFill(0x8a5a2a, 0.95).drawCircle(cx, cy, 7).endFill();
            // Highlight crescent (upper-left bronze sheen)
            stoneStamp.beginFill(0xd0a868, 0.55).drawCircle(cx - 1.2, cy - 1.2, 6.2).endFill();
            // Eagle body diamond
            stoneStamp.beginFill(0xffd34d, 0.95);
            stoneStamp.moveTo(cx,         cy - 4);
            stoneStamp.lineTo(cx + 2,     cy - 1);
            stoneStamp.lineTo(cx,         cy + 2);
            stoneStamp.lineTo(cx - 2,     cy - 1);
            stoneStamp.endFill();
            // Eagle wings (spread V) — dark bronze outline strokes
            stoneStamp.lineStyle(1.3, 0x4a2a14, 0.95);
            stoneStamp.moveTo(cx - 5, cy - 2).lineTo(cx,     cy - 1);
            stoneStamp.moveTo(cx + 5, cy - 2).lineTo(cx,     cy - 1);
            stoneStamp.lineStyle(0);
            // SPQR red drip — single 1px dot below the eagle as the
            // "Senatus Populusque Romanus" mark, no text needed at
            // this scale.
            stoneStamp.beginFill(0xa01818, 0.85).drawCircle(cx, cy + 4, 0.9).endFill();
            // Outer dark ring (sells the engraving depth)
            stoneStamp.lineStyle(1, 0x2a1a0c, 0.9).drawCircle(cx, cy, 7.5);
            stoneStamp.lineStyle(0);
          }
        }
      }
      this.layers.tiles.addChild(stoneStamp);
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
        // 2026-05-24 — Hero scale bumped 1.6 → 1.85 per player feedback
        // that heroes should be visibly larger than regular towers. The
        // old 1.6 vs 1.5 gap was only +7% which barely read on screen;
        // 1.85 is +23% over the tower baseline so heroes pop clearly as
        // "this is the named commander" without becoming cartoonish.
        const scale = isHeroSprite
          ? 1.85
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
        // 2026-05-20 v2 — HERO TOWER RING. Each hero gets a halo
        // matching their tint/theme. Created once per hero placement
        // and layered UNDER the hero sprite so the ring frames the
        // sprite as a clear "I'm the hero" visual marker.
        let ring: Sprite | undefined;
        if (isHeroSprite) {
          const ringKey = HERO_RING_FOR[heroIdForTowerType(String(tw.type)) ?? tw.type] ?? 'HERO_RING_PLAIN_WHITE';
          const ringTex = tex(ringKey);
          if (ringTex) {
            ring = new Sprite(ringTex);
            ring.anchor.set(0.5);
            // Sized slightly bigger than the hero sprite so the ring
            // visually surrounds the character. 2026-05-24 — bumped
            // 2.0 → 2.25 to keep the ~1.25× ratio over the now-1.85×
            // hero sprite (was 1.6×). The ring should always frame the
            // hero, never tightly hug them.
            const ringSize = GRID.TILE * 2.25;
            ring.width = ringSize;
            ring.height = ringSize;
            ring.alpha = 0.85;
          }
        }
        entry = { sp, tier, ring };
        this.towerSprites.set(tw.id, entry);
        // Ring goes in FIRST so it renders BENEATH the hero sprite.
        if (ring) this.layers.towers.addChild(ring);
        this.layers.towers.addChild(sp);
        if (tier) this.layers.towers.addChild(tier);
      }
      const baseX = tw.tileX * GRID.TILE + GRID.TILE / 2;
      const baseY = tw.tileY * GRID.TILE + GRID.TILE / 2;
      const hasBaseAttackSheet = isBaseTowerAttackAnimated(String(tw.type));
      const flashWindow = tw.isHero ? HERO_ATTACK_WINDOW : hasBaseAttackSheet ? baseTowerAttackFlashWindow(String(tw.type)) : 0.18;
      const combatVisualsActive = state.phase === GamePhase.WAVE_PHASE || !!(state as any).__dpsCheckActive;
      if (!combatVisualsActive || !Number.isFinite(tw.attackFlash) || tw.attackFlash < 0) {
        tw.attackFlash = 0;
      } else if (tw.attackFlash > flashWindow) {
        tw.attackFlash = flashWindow;
      }
      const isAttacking = combatVisualsActive && tw.attackFlash > 0;
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
      const flashT = isAttacking ? Math.min(1, tw.attackFlash / flashWindow) : 0;
      const heroIdentity = heroIdForTowerType(String(tw.type));
      let usingHeroAttackSheet = false;
      if (tw.isHero && heroIdentity && flashT > 0) {
        const sheetKey = HERO_ATTACK_SHEET_FOR[heroIdentity];
        const frameAge = Math.max(0, Math.min(0.999, 1 - flashT));
        const frameIndex = Math.min(HERO_ATTACK_FRAME_COUNT - 1, Math.floor(frameAge * HERO_ATTACK_FRAME_COUNT));
        const attackTex = sheetKey
          ? texGridFrame(sheetKey, frameIndex, HERO_ATTACK_FRAME_SIZE, HERO_ATTACK_FRAME_SIZE, ATTACK_SHEET_COLUMNS)
          : null;
        const idleTex = tex(tw.type);
        entry.sp.texture = attackTex ?? idleTex ?? entry.sp.texture;
        usingHeroAttackSheet = !!attackTex;
      } else if (hasBaseAttackSheet && flashT > 0) {
        const frameAge = Math.max(0, Math.min(0.999, 1 - flashT));
        const frameIndex = Math.min(BASE_TOWER_ATTACK_FRAME_COUNT - 1, Math.floor(frameAge * BASE_TOWER_ATTACK_FRAME_COUNT));
        const attackTex = texGridFrame(`ATTACK_${tw.type}`, frameIndex, BASE_TOWER_ATTACK_FRAME_SIZE, BASE_TOWER_ATTACK_FRAME_SIZE, ATTACK_SHEET_COLUMNS);
        const idleTex = tex(tw.type);
        entry.sp.texture = attackTex ?? idleTex ?? entry.sp.texture;
      } else {
        const idleTex = tex(tw.type);
        if (idleTex && entry.sp.texture !== idleTex) entry.sp.texture = idleTex;
      }
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
      let heroAttackRotation = 0;
      let heroAttackSkewX = 0;
      if (isAttacking) {
        const heroId = heroIdentity;
        const meleeHero = heroId === 'HERO_MARIUS' || heroId === 'HERO_SCIPIO' || heroId === 'HERO_CAESAR';
        const recoilDist = flashT * (heroId ? 4.0 : 4.5);
        const dir = meleeHero ? 1 : -1;
        attackOffX = Math.cos(tw.rotation) * recoilDist * dir;
        attackOffY = Math.sin(tw.rotation) * recoilDist * dir;
        if (heroId) {
          const age = 1 - flashT;
          const side = (tw.id.charCodeAt(tw.id.length - 1) % 2 === 0) ? 1 : -1;
          if (usingHeroAttackSheet) {
            // Authored 3x3 sheets already contain body torque, release,
            // follow-through, and idle return. Extra procedural rotation
            // made ranged heroes look like they shrank or stuck mid-swing.
            heroAttackRotation = 0;
            heroAttackSkewX = 0;
          } else if (meleeHero) {
            const windupToRelease = age < 0.46
              ? -0.38 + (age / 0.46) * 0.92
              : 0.54 * Math.max(0, 1 - ((age - 0.46) / 0.54));
            heroAttackRotation = windupToRelease * side;
            heroAttackSkewX = Math.sin(age * Math.PI) * 0.08 * side;
          } else {
            heroAttackRotation = Math.sin(age * Math.PI) * -0.16 * side;
            heroAttackSkewX = Math.sin(age * Math.PI) * 0.05 * side;
          }
        }
      }
      entry.sp.x = baseX + idleSway + attackOffX;
      entry.sp.y = baseY + idleBob + attackOffY;
      entry.sp.rotation = heroAttackRotation;
      entry.sp.skew.x = heroAttackSkewX;
      if (tw.isHero && flashT > 0) {
        this.drawHeroAttackAnimation(this.heroAttackGfx, tw, baseX, baseY, tw.rotation, flashT);
      }
      // Keep the fallback monogram (if any) glued to the sprite position.
      const fb = (entry.sp as any).__fallback as Graphics | undefined;
      if (fb) { fb.x = entry.sp.x; fb.y = entry.sp.y; }
      // 2026-05-20 v2 — Hero ring follows the tile center (NOT the bob)
      // so it stays anchored to the ground while the hero bobs above it.
      // Slow continuous rotation at ~0.25 rad/sec gives the ring an
      // active "magic circle" feel. Pulsing alpha 0.75..1.0 at 0.6Hz
      // adds subtle life without distracting.
      if (entry.ring) {
        entry.ring.x = baseX;
        entry.ring.y = baseY;
        entry.ring.rotation = state.tick * 0.25;
        entry.ring.alpha = 0.75 + 0.20 * (0.5 + 0.5 * Math.sin(state.tick * 3.8));
      }
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
      // 2026-05-24 — Mirror of the creation-time hero scale bump above.
      // Both paths MUST match — the per-frame path runs every tick for
      // re-positioning, and a mismatch would cause heroes to "jump"
      // size between creation and the first redraw.
      const baseScale = tw.isHero
        ? 1.85
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
        if (entry.ring) entry.ring.destroy();
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
    // FLYERS, WEAKEST, FAST, CASTERS. F/L/S/C/Y are the historical
    // letters; W (weakest), A (fAst — F is taken by FIRST), and M
    // (Mage/Caster — C is taken by CLOSE) extend the badge set.
    const TARGET_LETTER = ['F', 'L', 'S', 'C', 'Y', 'W', 'A', 'M'];
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

    // Undead Gladiator King summons — short-lived allied melee bodies.
    if (!(this as any).undeadGladiatorSprites) {
      (this as any).undeadGladiatorSprites = new Map<string, Sprite>();
    }
    const ugSprites = (this as any).undeadGladiatorSprites as Map<string, Sprite>;
    const seenUndeadGladiators = new Set<string>();
    const undeadSummons = Array.isArray((state as any).__undeadGladiators) ? (state as any).__undeadGladiators : [];
    for (const s of undeadSummons) {
      seenUndeadGladiators.add(s.id);
      let sp = ugSprites.get(s.id);
      if (!sp) {
        sp = new Sprite(tex('SUMMON_UNDEAD_GLADIATOR') ?? undefined);
        sp.anchor.set(0.5);
        sp.width = GRID.TILE * 1.22;
        sp.height = GRID.TILE * 1.22;
        sp.alpha = 0.92;
        ugSprites.set(s.id, sp);
        this.layers.towers.addChild(sp);
      }
      sp.x = s.x;
      sp.y = s.y + Math.sin(state.tick * 8 + s.id.length) * 1.2;
      sp.rotation = Math.sin(state.tick * 11 + s.id.length) * 0.05;
      sp.visible = true;
    }
    for (const [id, sp] of ugSprites) {
      if (!seenUndeadGladiators.has(id)) {
        sp.destroy();
        ugSprites.delete(id);
      }
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
        // Initial-claim sizing matches the per-frame sizing logic below
        // so large enemies don't pop in at the wrong size for frame one.
        const size = GRID.TILE * enemySpriteSizeTiles(e);
        sp.width = size; sp.height = size;
        const hp = new Graphics();
        const statusBar = new Container();
        const wounds = new Container();
        const daemonPortal = e.type === 'DAEMON_IMPERATOR' ? new Sprite() : undefined;
        if (daemonPortal) {
          daemonPortal.anchor.set(0.5, 0.72);
          daemonPortal.visible = false;
          daemonPortal.blendMode = 1 as any;
        }
        entry = { sp, hp, statusBar, displayX: e.x, displayY: e.y, lastTick: state.tick, wounds, woundCount: 0, nextDripTick: 0, daemonPortal };
        this.enemySprites.set(e.id, entry);
        if (daemonPortal) this.layers.enemies.addChild(daemonPortal);
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
      // Keep enemy body scale in sync with first-frame spawn sizing.
      const size = GRID.TILE * enemySpriteSizeTiles(e) * ((e as any).__renderScale ?? 1);
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
      if (isWaveModifierActive(state, 'BLOOD_MOON')) {
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
        // 2026-05-21 — Emergence window lengthened 0.4 → 0.55s and
        // the rise distance bumped 22 → 36px for Uprising so enemies
        // visibly climb out of the urn instead of popping into place.
        // Invasion still uses the original 0.4s for its sharper
        // teleport-in feel.
        const kindEarly = (e as any).__surpriseKind;
        const emergeDur = kindEarly === 'UPRISING' ? 0.55 : 0.4;
        const emergeT = (state.tick - surpriseSpawnTick) / emergeDur;
        if (emergeT >= 1) {
          // Done — clean up tags so the cost is zero on subsequent frames.
          delete (e as any).__surpriseSpawnTick;
          delete (e as any).__surpriseSpawn;
          delete (e as any).__surpriseKind;
          entry.sp.alpha = 1;
          entry.sp.tint = 0xffffff;
        } else {
          const kind = kindEarly;
          if (kind === 'INVASION') {
            // Teleport-in: alpha 0 → 1 over the window + cyan→white tint blend.
            entry.sp.alpha = Math.max(0.05, emergeT);
            // Cyan tint at t=0, fade to pure white at t=1.
            const teleColor = blendWithWhite(0x66ccff, emergeT);
            entry.sp.tint = teleColor;
          } else if (kind === 'UPRISING') {
            // Ground-rise: enemy y starts +36px below ground (was 22),
            // lerps up. Larger rise reads as "climbing out of the
            // urn" instead of "popping in slightly low".
            (entry as any).__surpriseRiseOffset = (1 - emergeT) * 36;
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
      if (e.type === 'DAEMON_IMPERATOR' && entry.daemonPortal) {
        const portal = entry.daemonPortal;
        if (typeof (entry as any).__daemonSpawnTick !== 'number') {
          (entry as any).__daemonSpawnTick = state.tick;
          (entry as any).__daemonSeenCheckpoints = new Set<number>();
          (entry as any).__daemonVfxUntil = state.tick + 3.0;
        }
        const seenCheckpoints = (entry as any).__daemonSeenCheckpoints as Set<number>;
        for (const wp of ((waypointsData as any).waypoints ?? [])) {
          const wx = (wp.topLeft.col + 1) * GRID.TILE;
          const wy = (wp.topLeft.row + 1) * GRID.TILE;
          const dist = Math.hypot(e.x - wx, e.y - wy);
          if (dist <= GRID.TILE * 1.35 && !seenCheckpoints.has(wp.index)) {
            seenCheckpoints.add(wp.index);
            (entry as any).__daemonVfxUntil = state.tick + 1.55;
            this.triggerImpactRing(entry.displayX, entry.displayY + GRID.TILE * 0.25, state.tick, 78, 0xff5522);
            this.triggerImpactRing(entry.displayX, entry.displayY + GRID.TILE * 0.25, state.tick + 0.08, 118, 0x8822aa);
            for (let k = 0; k < 8; k++) {
              this.spawnEmberParticle(entry.displayX + (Math.random() - 0.5) * 28, entry.displayY + GRID.TILE * 0.25, true);
            }
          }
        }
        if (e.currentSpeed > 0 && state.tick >= ((entry as any).__daemonNextStepVfx ?? 0)) {
          (entry as any).__daemonNextStepVfx = state.tick + 0.62;
          this.spawnEmberParticle(entry.displayX + (Math.random() - 0.5) * 18, entry.displayY + GRID.TILE * 0.45, true);
          this.spawnEmberParticle(entry.displayX + (Math.random() - 0.5) * 18, entry.displayY + GRID.TILE * 0.45, false);
        }
        const spawnAge = state.tick - ((entry as any).__daemonSpawnTick ?? state.tick);
        const spawnPulse = spawnAge < 3.0 ? Math.max(0, 1 - Math.max(0, spawnAge - 2.15) / 0.85) : 0;
        const checkpointPulse = Math.max(0, (((entry as any).__daemonVfxUntil ?? 0) - state.tick) / 1.55);
        const woundedAura = hpFrac < 0.5 ? 0.12 + (0.5 - hpFrac) * 0.22 : 0;
        const moveAura = e.currentSpeed > 0 ? 0.08 + 0.04 * Math.sin(state.tick * 5.2) : 0;
        const alpha = Math.max(spawnPulse * 0.82, checkpointPulse * 0.72, woundedAura, moveAura);
        const animT = spawnPulse > 0.05
          ? spawnAge
          : checkpointPulse > 0.05
            ? (1.55 - checkpointPulse * 1.55)
            : state.tick * 0.75;
        const frame = Math.max(0, Math.min(8, Math.floor((animT % 1.08) / 0.12)));
        const portalTex = texGridFrame('FINAL_BOSS_DAEMON_PORTAL_SHEET', frame, 256, 256, 3);
        if (portalTex && alpha > 0.025) {
          portal.texture = portalTex;
          portal.x = entry.sp.x;
          portal.y = entry.sp.y + GRID.TILE * 0.55;
          const pulseSize = GRID.TILE * (spawnPulse > 0.05 ? 4.3 : checkpointPulse > 0.05 ? 3.75 : 2.75);
          portal.width = pulseSize;
          portal.height = pulseSize;
          portal.rotation = Math.sin(state.tick * 0.9) * 0.018;
          portal.alpha = Math.max(0, Math.min(0.86, alpha));
          portal.visible = true;
        } else {
          portal.visible = false;
        }
      } else if (entry.daemonPortal) {
        entry.daemonPortal.visible = false;
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
        // PERF: persistent wound/arrow decals were removed. The sprite hit
        // flash + knockback jolt still communicates impact, without adding
        // extra display children that ride along with every living enemy.
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
      // Status effects: tint-only in the hot render loop. The old overhead
      // badge row rebuilt Graphics/Sprites for every statused enemy every
      // frame, which felt laggy on dense waves. Gameplay, HP bars, Codex,
      // and inspect panels still expose the exact status details.
      const STATUS_COLOR: Record<string, number> = {
        SLOW: 0x66ccff, POISON: 0x33cc33, BLEED: 0xaa1f1f, FREEZE: 0xddeeff, BURN: 0xff7733,
        ARMOR_SHRED: 0xb88a4a, STUN: 0xffd34d, HELLFIRE: 0xff5533, FEAR: 0xcccccc,
        KNOCKBACK: 0xffaa55, MARK: 0xff66cc
      };
      // (statusBar clear was moved up — see "STATUS BAR RESET" near
      // the top of the per-enemy block. Shield + mutation indicators
      // now persist into the same frame's render instead of being
      // wiped out by this loop.)
      if (e.statusEffects.length > 0) {
        const dominant = e.statusEffects[0].kind;
        const statusColor = STATUS_COLOR[dominant] ?? 0xffffff;
        const r = ((statusColor >> 16) & 0xff), g = ((statusColor >> 8) & 0xff), b = (statusColor & 0xff);
        const tintBlend = e.isBoss ? 0.22 : 0.32;
        const orig = (entry as any).baseSpriteTint ?? 0xffffff;
        const oR = ((orig >> 16) & 0xff), oG = ((orig >> 8) & 0xff), oB = (orig & 0xff);
        const tR = Math.round(oR * (1 - tintBlend) + r * tintBlend);
        const tG = Math.round(oG * (1 - tintBlend) + g * tintBlend);
        const tB = Math.round(oB * (1 - tintBlend) + b * tintBlend);
        entry.sp.tint = (tR << 16) | (tG << 8) | tB;
      }
    }
    for (const [id, entry] of this.enemySprites) {
      if (!seenEnemyIds.has(id)) {
        entry.sp.destroy(); entry.hp.destroy(); entry.statusBar.destroy();
        if (entry.daemonPortal) entry.daemonPortal.destroy();
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
    void state; void gore; void tick;
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
      // Skip the visual range-cut indicator on melee towers (minimum range 2.0) — they're immune.
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

  drawRampartPreview(tiles: Array<{ col: number; row: number; valid: boolean }>, canCommit: boolean) {
    this.overlayGfx.clear();
    if (!tiles.length) return;
    const color = canCommit ? 0xffd34d : 0xff5555;
    for (const t of tiles) {
      const x = t.col * GRID.TILE;
      const y = t.row * GRID.TILE;
      const tileColor = t.valid ? color : 0xff3030;
      const alpha = t.valid ? 0.28 : 0.36;
      this.overlayGfx.lineStyle(2, tileColor, 0.95);
      this.overlayGfx.beginFill(tileColor, alpha);
      this.overlayGfx.drawRect(x + 2, y + 2, GRID.TILE - 4, GRID.TILE - 4);
      this.overlayGfx.endFill();
      this.overlayGfx.lineStyle(1, 0x1a1006, 0.75);
      this.overlayGfx.moveTo(x + 7, y + GRID.TILE / 2);
      this.overlayGfx.lineTo(x + GRID.TILE - 7, y + GRID.TILE / 2);
      this.overlayGfx.moveTo(x + GRID.TILE / 2, y + 7);
      this.overlayGfx.lineTo(x + GRID.TILE / 2, y + GRID.TILE - 7);
    }
    const first = tiles[0];
    const last = tiles[tiles.length - 1];
    const x1 = first.col * GRID.TILE + GRID.TILE / 2;
    const y1 = first.row * GRID.TILE + GRID.TILE / 2;
    const x2 = last.col * GRID.TILE + GRID.TILE / 2;
    const y2 = last.row * GRID.TILE + GRID.TILE / 2;
    this.overlayGfx.lineStyle(4, canCommit ? 0xffe066 : 0xff3030, 0.85);
    this.overlayGfx.moveTo(x1, y1);
    this.overlayGfx.lineTo(x2, y2);
    this.overlayGfx.lineStyle(0);
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
  // Global auras (Triarius +12% global, Caesar +55% global, Triumvirate
  // triple global, Imperium global speed, Consular global) are NOT drawn
  // — they cover the whole map and a giant ring would be useless.
  drawAuras(state: GameStateShape, tick: number) {
    // Aura ranges are persistent information, not 60 FPS action. Rebuilding
    // several large filled Pixi circles every frame becomes expensive when
    // multiple heroes overlap. Twelve refreshes per second keeps the pulse
    // alive while cutting geometry uploads by about 80%.
    if (tick >= this.lastAuraDrawTick && tick - this.lastAuraDrawTick < 1 / 12) return;
    this.lastAuraDrawTick = tick;
    this.auraGfx.clear();
    const pulse = 0.55 + Math.sin(tick * 2.2) * 0.20;
    const ALLY = 0xc070ff;        // violet — ally buff
    const ENEMY = 0xff5566;       // crimson — enemy debuff
    for (const tw of state.towers.values()) {
      if (tw.pending) continue;
      const cx = tw.tileX * GRID.TILE + GRID.TILE / 2;
      const cy = tw.tileY * GRID.TILE + GRID.TILE / 2;

      // ── HERO PASSIVE AURA RINGS (2026-05-22) ──────────────────────
      // Heroes with a spatial passive (LOCAL_AURA, DUAL.local,
      // DAMAGE_TYPE_RIDER) need their range surfaced so the player
      // can see which towers fall inside the buff radius. The ring is
      // tinted with the hero's own particle color (matches the hero's
      // halo ring + tier-up flash) so each hero reads as a distinct
      // colored ring at a glance.
      //
      // Caesar + Scipio use GLOBAL_AURA — the effect has no radius, so
      // no ring is drawn (a ring on a global aura would lie about
      // where the buff applies).
      if (tw.isHero) {
        const heroId = heroIdForTowerType(String(tw.type)) ?? String(tw.type);
        const hd: any = (HERO_DEFS_FOR_AURA as any)[heroId];
        const passive = hd?.passive;
        if (passive) {
          // Pull radiusTiles from either top-level (LOCAL_AURA /
          // DAMAGE_TYPE_RIDER) or the DUAL.local sub-object.
          const radius: number | undefined =
            (typeof passive.radiusTiles === 'number') ? passive.radiusTiles :
            (typeof passive.local?.radiusTiles === 'number') ? passive.local.radiusTiles :
            undefined;
          if (radius && radius > 0) {
            // Parse the hero's tier-up color into a 0xRRGGBB int. Tier-up
            // color is the brightest of the hero's tint set so the ring
            // pops against the dark biome background. Fallback to ALLY
            // violet if the JSON ever ships without the field.
            const tintHex: string = hd?.visual?.tierUpColor ?? '#c070ff';
            const colorInt = parseInt(tintHex.replace('#', ''), 16);
            this.drawAuraRing(cx, cy, radius * GRID.TILE, colorInt, pulse * 0.92, false, false);
          }
        }
      }

      // ── TOWER-NATIVE LOCAL AURAS ─────────────────────────────────
      // Eagle Standard — local +22% atk speed within 5 tiles.
      if (tw.type === TowerType.EAGLE_STANDARD) {
        this.drawAuraRing(cx, cy, 5 * GRID.TILE, ALLY, pulse);
      }
      // Aquilifer Titan — local enemy +25% taken (5 tiles). 2026-05 v11:
      // dedicated prominent variant so the damage-vulnerability radius is obvious
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
      // Giant's Cohort Guard — stronger local command aura from the awakened shield wall.
      if (tw.type === TowerType.GIANTS_COHORT_GUARD) {
        this.drawAuraRing(cx, cy, 4 * GRID.TILE, ALLY, pulse * 0.9);
      }
      // Triplex Acies super combo — +25% atk speed aura (3 tiles).
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
      // Aureate Tribunal — apex support: global buffs plus local enemy trial zone.
      if (tw.type === TowerType.AUREATE_TRIBUNAL) {
        this.drawAuraRing(cx, cy, 6.5 * GRID.TILE, ALLY, pulse * 0.9);
        this.drawAuraRing(cx, cy, 6.5 * GRID.TILE, ENEMY, pulse * 0.85, true);
      }
      // Glacial Palisade — nearby towers fight behind the frost shield.
      if (tw.type === TowerType.GLACIAL_PALISADE) {
        this.drawAuraRing(cx, cy, 3 * GRID.TILE, ALLY, pulse * 0.8);
      }
      // Roman Transformer — Omega vulnerability field plus close immolation.
      if (tw.type === TowerType.ROMAN_TRANSFORMER) {
        this.drawAuraRing(cx, cy, 6 * GRID.TILE, ENEMY, pulse * 0.9, true);
        this.drawAuraRing(cx, cy, 1.5 * GRID.TILE, 0xff6633, pulse * 0.85, true);
      }
      // Neptune's Leviathan — water-only Omega undertow kill zone.
      if (tw.type === TowerType.NEPTUNES_LEVIATHAN) {
        this.drawAuraRing(cx, cy, 2.5 * GRID.TILE, 0x35d4ff, pulse * 0.95, true);
        this.drawAuraRing(cx, cy, 2.5 * GRID.TILE, ENEMY, pulse * 0.75, true);
      }

      // ── AURA ITEMS ───────────────────────────────────────────────
      // Item rings re-derive their radius from the same constants used
      // in CombatResolver localAuras so player-visible and player-affected
      // ranges always match.
      if (tw.equippedItems.includes('CENTURIONS_TRUMPET')) {
        this.drawAuraRing(cx, cy, 2.5 * GRID.TILE, ALLY, pulse * 0.75);
      }
      if (tw.equippedItems.includes('BATTLE_STANDARD')) {
        this.drawAuraRing(cx, cy, 2.5 * GRID.TILE, ALLY, pulse * 0.75);
      }
      if (tw.equippedItems.includes('WAR_HOUND_COLLAR')) {
        this.drawAuraRing(cx, cy, 3 * GRID.TILE, ALLY, pulse * 0.8);
      }
      if (tw.equippedItems.includes('DRUIDS_TORC')) {
        this.drawAuraRing(cx, cy, 3 * GRID.TILE, ALLY, pulse * 0.8);
      }
      if (tw.equippedItems.includes('BARCA_WAR_HORN')) {
        this.drawAuraRing(cx, cy, 3.5 * GRID.TILE, ALLY, pulse * 0.85);
      }
      if (tw.equippedItems.includes('LICH_GENERALS_SEAL')) {
        this.drawAuraRing(cx, cy, 3.5 * GRID.TILE, ALLY, pulse * 0.85);
      }
      if (tw.equippedItems.includes('AQUILIFER_BANNER')) {
        this.drawAuraRing(cx, cy, 3 * GRID.TILE, ALLY, pulse * 0.8);
      }
      if (tw.equippedItems.includes('OPTIO_WHISTLE')) {
        this.drawAuraRing(cx, cy, 3 * GRID.TILE, ALLY, pulse * 0.8);
      }
      if (tw.equippedItems.includes('INFERNO_STANDARD')) {
        this.drawAuraRing(cx, cy, 3.5 * GRID.TILE, ALLY, pulse * 0.9);
      }
      // Enemy-debuff items: dashed crimson rings mark enemy vulnerability zones.
      if (tw.equippedItems.includes('CURSED_TORC')) {
        this.drawAuraRing(cx, cy, 3 * GRID.TILE, ENEMY, pulse * 0.85, true);
      }
      if (tw.equippedItems.includes('NECROMANCERS_LANTERN')) {
        this.drawAuraRing(cx, cy, 3.5 * GRID.TILE, ENEMY, pulse * 0.9, true);
      }
    }
  }

  // 2026-05 v11: prominent variant for Aquilifer Titan's damage-taken
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

  private drawAuraRing(cx: number, cy: number, r: number, color: number, alpha: number, dashed = false, filled = true) {
    if (dashed) {
      // dashed outer ring + soft inner fill
      const segs = 32;
      if (filled) this.auraGfx.beginFill(color, alpha * 0.06).drawCircle(cx, cy, r).endFill();
      this.auraGfx.lineStyle(2, color, alpha);
      for (let i = 0; i < segs; i += 2) {
        const a0 = (i / segs) * Math.PI * 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2;
        this.auraGfx.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
        this.auraGfx.arc(cx, cy, r, a0, a1, false);
      }
      this.auraGfx.lineStyle(0);
    } else {
      if (filled) this.auraGfx.beginFill(color, alpha * 0.08).drawCircle(cx, cy, r).endFill();
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
      // 2026-06-25 — show the disabled X-mark on ANY silenced/nullified tower,
      // not only on weather-profile waves (the old `silenceAffected` gate hid
      // the Nullifying Aura disable on clear-weather late waves).
      if (state.tick < silencedUntil) {
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
  private oceanEmergenceSprites: Sprite[] = [];             // GPT Images 3x3 shipwreck/ocean emergence
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

  // 2026 v2 — placed consumable traps. Drawn bright + (mostly) pulsing so they
  // are easy to spot, with a glow ring under each. Render info is stashed on
  // the placed-trap entity so this needs no TrapSystem import.
  private trapSprites: Sprite[] = [];
  private trapGlowGfx?: Graphics;
  drawTraps(state: GameStateShape, tick: number) {
    const traps = (state as any).placedTraps as Array<{ x: number; y: number; color: number; spriteKey: string; pulse: boolean }> | undefined;
    if (!this.trapGlowGfx) { this.trapGlowGfx = new Graphics(); this.layers.bg.addChild(this.trapGlowGfx); }
    const glow = this.trapGlowGfx; glow.clear();
    let idx = 0;
    if (traps && traps.length > 0) {
      for (const tr of traps) {
        const p = tr.pulse ? (0.55 + 0.45 * Math.sin(tick * 4 + tr.x * 0.05 + tr.y * 0.05)) : 0.9;
        // Bright glow disc + ring = easy to spot on the map.
        glow.beginFill(tr.color, 0.22 * p).drawCircle(tr.x, tr.y, GRID.TILE * 0.95).endFill();
        glow.lineStyle(2.5, tr.color, 0.75 * p); glow.drawCircle(tr.x, tr.y, GRID.TILE * 0.62); glow.lineStyle(0);
        let sp = this.trapSprites[idx];
        if (!sp) { sp = new Sprite(); sp.anchor.set(0.5); this.layers.bg.addChild(sp); this.trapSprites.push(sp); }
        const tx = tex(tr.spriteKey);
        if (tx) sp.texture = tx;
        const sz = GRID.TILE * (tr.pulse ? (0.90 + 0.10 * Math.sin(tick * 4 + tr.x * 0.05)) : 0.95);
        sp.x = tr.x; sp.y = tr.y; sp.width = sz; sp.height = sz; sp.visible = !!tx;
        idx++;
      }
    }
    for (let i = idx; i < this.trapSprites.length; i++) this.trapSprites[i].visible = false;
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
      const invasionVisualAge = tick - ev.startedAt;
      const invasionVisualAlpha =
        isInvasion
          ? Math.max(0, Math.min(1, 1 - Math.max(0, invasionVisualAge - 2.2) / 0.55))
          : 1;
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
        if (isInvasion) alpha *= invasionVisualAlpha;
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
          if (invasionVisualAlpha > 0.15 && (this.surpriseEmberClock += 1) % 8 === 0) {
            this.spawnEmberParticle(meta.vfxX, meta.vfxY, /*warm=*/true);
          }
        } else {
          // UPRISING: urn rises from below over the RISE window.
          // 2026-05-17 — OVER-THE-TOP PASS. Urns are now 1.5× larger
          // (1.3 → 1.95 tile-widths), wobble harder, and the overlay
          // pass below draws orbiting skulls + soul column + aura ring
          // + ground cracks per urn. Spawn impact rings are doubled in
          // radius and ember bursts tripled — Skeletal Uprising should
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
        } else if (ev.kind === SurpriseEventKind.INVASION && (tick - ev.startedAt) <= 2.85) {
          this.triggerImpactRing(p.vfxX, p.vfxY + GRID.TILE * 0.4, tick,        24, ringColor);
          this.triggerImpactRing(p.vfxX, p.vfxY + GRID.TILE * 0.4, tick + 0.06, 38, ringColor);
          for (let k = 0; k < 2; k++) this.spawnEmberParticle(p.vfxX, p.vfxY, true);
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
        // 1. GROUND CRACKS — 12 jagged purple lines radiating from the urn
        //    base (was 8). Drawn first so they sit under everything else.
        // 2026-05-21 — bumped 8 → 12 + larger radius for more visceral
        // ritual-circle reading per the "more visuals" pass.
        const crackR = GRID.TILE * 1.7 * tilesPulse;
        const crackAlpha = 0.60 * envAlpha;
        ug.lineStyle(2, 0x5e1a8a, crackAlpha);
        for (let a = 0; a < 12; a++) {
          const baseAng = (a / 12) * Math.PI * 2 + pointId * 0.13;
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
        // 4. ORBITING FLOATING SKULLS — 8 skulls per urn drifting in an
        //    elliptical orbit (was 4). Each skull is drawn with 3
        //    ellipses (head + jaw bevel + eye sockets) and 1 mouth line.
        // 2026-05-21 — doubled (4 → 8) for the "more visuals" pass so
        // the ritual ring feels properly haunted.
        const SKULLS_PER_URN = 8;
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
        // 5. EXTRA ROAMING SKULLS at larger orbits — 4 per urn that
        //    drift slower and wider, so the whole zone reads "haunted"
        //    rather than just "this urn has skulls around it".
        // 2026-05-21 — doubled (2 → 4) and orbit radius widened to
        // 2.5 tiles so they roam past the satellite urns.
        for (let s = 0; s < 4; s++) {
          const orbitT = tick * 0.32 + (s / 4) * Math.PI * 2 + pointId * 1.2;
          const orbitR = GRID.TILE * 2.5;
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
      if (ev.kind === SurpriseEventKind.INVASION) {
        const age = tick - ev.startedAt;
        envAlpha *= Math.max(0, Math.min(1, 1 - Math.max(0, age - 2.2) / 0.55));
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

  drawOceanEmergenceFx(state: GameStateShape, tick: number): void {
    const startedAt = Number((state as any).__oceanSurgeStartedAt ?? 0);
    const until = Number((state as any).__oceanSurgeUntil ?? 0);
    let used = 0;
    if (startedAt > 0 && until > tick) {
      const age = Math.max(0, tick - startedAt);
      const fade = Math.max(0, Math.min(1, (until - tick) / 6.0));
      const frame = Math.max(0, Math.min(8, Math.floor(Math.min(age, 1.18) / 0.1475)));
      const tx = texGridFrame('EVENT_OCEAN_EMERGENCE_SHEET', frame, 256, 256, 3);
      if (tx) {
        let sp = this.oceanEmergenceSprites[used];
        if (!sp) {
          sp = new Sprite();
          sp.anchor.set(0.5, 0.60);
          this.layers.fx.addChild(sp);
          this.oceanEmergenceSprites.push(sp);
        }
        sp.texture = tx;
        sp.x = WATER_ZONE.col * GRID.TILE + GRID.TILE * 2.35;
        sp.y = (WATER_ZONE.row + WATER_ZONE.height - 1.95) * GRID.TILE;
        const pulse = 1 + Math.sin(tick * 5.8) * 0.025;
        const size = GRID.TILE * (4.35 + Math.max(0, 1.2 - age) * 0.25);
        sp.width = size * pulse;
        sp.height = size * pulse;
        sp.alpha = Math.min(0.96, 0.46 + fade * 0.50);
        sp.rotation = Math.sin(tick * 0.8) * 0.015;
        sp.visible = true;
        used++;
      }
    }
    for (let i = used; i < this.oceanEmergenceSprites.length; i++) {
      this.oceanEmergenceSprites[i].visible = false;
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
    const reduceWeatherFx = (typeof window !== 'undefined' && (
        !!(window as any).__reduceDecor
        || !!(window as any).__reduceMotion
      ))
      || (typeof document !== 'undefined' && (
        document.documentElement.classList.contains('reduce-decor')
        || document.documentElement.classList.contains('reduce-motion-opt-in')
      ));

    // Tint vignette
    wg.beginFill(profile.color, profile.density * 0.10 * intensity).drawRect(0, 0, W, H).endFill();

    if (reduceWeatherFx) {
      this.weatherParticles = [];
      for (const sp of this.weatherSpritePool) sp.visible = false;
      return;
    }

    // Try to use the real Higgsfield weather sprite for this faction.
    const wxKey = this.weatherSpriteFor(key);
    const wxTex = wxKey ? tex(wxKey) : null;

    // Spawn particles up to a modest target count. Older builds used dozens of
    // translucent weather sprites over the entire board every frame; Carthage's
    // sandstorm around W9/W10 made that overdraw visible as lag on weaker GPUs.
    const targetCount = Math.min(14, Math.max(3, Math.floor(26 * profile.density * intensity)));
    while (this.weatherParticles.length < targetCount) {
      this.weatherParticles.push(this.spawnWeatherParticle(profile));
    }
    while (this.weatherParticles.length > targetCount) this.weatherParticles.pop();

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
        if (orb.rarity === 'EPIC') sp.tint = 0xb86cff;
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
