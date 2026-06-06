// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION — Green Circle map renderer (Roman TD art on the circle)
//
// Draws the circular spiral map in Roman TD's visual vocabulary, reusing
// the real sprites: GRASS_A/B for the build zones, a procedural cobblestone
// spiral path (the same sandstone-and-mortar look the base map uses), the
// DARK_CAVE sprite at each of the 4 corner spawns, the ROMAN_GATE sprite as
// Rome at the center, and the per-wave biome tint. A faint pair-color wash
// over each quadrant keeps the 4 team territories readable.
//
// Static map layer only (no creeps/towers yet). Position-based, so the
// existing combat/enemy systems can later draw on top using their own
// sprite layers.
// ─────────────────────────────────────────────────────────────────────

import { Container, Graphics, Sprite, Text, Texture, BLEND_MODES } from 'pixi.js';
import { tex } from '../../render/Assets';
import { biomeForWave, BIOMES } from '../../render/Biomes';
import { realizableCombos } from '../../systems/CombinationEngine';
import { towerEffectiveStats } from '../../systems/TowerSystem';
import { isSurpriseEventActive, getAllActiveSurpriseEvents } from '../../systems/SurpriseEvents';
import { AURA_TILE_EFFECTS, type AuraTile } from '../../constants';
import { GamePhase } from '../../types';
import type { GameStateShape } from '../../GameState';
import type { CircleMapGeometry } from './CircleMap';
import { quadrantOf } from './CircleMap';

/** Dominant status-effect tint for an enemy sprite (combat readability cue). */
const STATUS_TINT: Record<string, number> = {
  FREEZE: 0x8fd6ff, SLOW: 0x6fb6ff, STUN: 0xffffff, POISON: 0x8fe06a,
  BURN: 0xff8a3a, HELLFIRE: 0xff5a2a, BLEED: 0xff6b6b, ARMOR_SHRED: 0xffd24f, FEAR: 0xc89cff,
};

export interface CircleEntityOpts {
  selectedTowerId?: string | null;
  hover?: { col: number; row: number; valid: boolean } | null;
}

/** Stable per-entity animation phase from its id (so they don't sync up). */
function hashPhase(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 1000) / 1000) * Math.PI * 2;
}

// Muted Graveyard-Keeper-palette quadrant tints (NW slate-teal, NE dusty mauve,
// SE aged amber, SW pale gold) — desaturated so they mark ownership without
// breaking the somber atmosphere.
const PAIR_TINT = [0x4f8f88, 0x8a5f9a, 0xb07a4a, 0xb0a050];

// Soft radial-gradient glow texture (built once), used additively for the
// Graveyard-Keeper torch/lantern lighting so warm light pools through the gloom.
let _glowTex: Texture | null = null;
function glowTexture(): Texture {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.42)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  }
  _glowTex = Texture.from(c);
  return _glowTex;
}

// Per-biome mood grade. Real Graveyard Keeper is NOT uniformly dark — its
// overworld is warm + bright daylight, its witch's-land is cool desaturated
// fog, and only its morgue/dungeon is the dark torch-lit gloom. One fixed
// dark wash made every wave a dungeon; this spans GK's actual tonal range.
//   grade/alpha = full-map wash · vig = vignette strength · light = torch ×.
const BIOME_MOOD: Record<string, { grade: number; alpha: number; vig: number; light: number }> = {
  BIOME_GRASSLAND:     { grade: 0x000000, alpha: 0.00, vig: 0.05, light: 0.5 },  // warm GK daylight
  BIOME_CELTIC_WOOD:   { grade: 0x10180f, alpha: 0.08, vig: 0.06, light: 0.7 },  // dappled woodland
  BIOME_CARTHAGE_ARID: { grade: 0x000000, alpha: 0.00, vig: 0.06, light: 0.5 },  // bright arid sun
  BIOME_UNDEAD_FOREST: { grade: 0x121826, alpha: 0.18, vig: 0.07, light: 1.0 },  // cool witch's fog
  BIOME_UNDEAD_RUINS:  { grade: 0x181226, alpha: 0.20, vig: 0.07, light: 1.0 },  // purple gloom
  BIOME_HELLSCAPE:     { grade: 0x1c0a08, alpha: 0.20, vig: 0.07, light: 1.0 },  // ember-dark morgue
};

export function renderCircleMap(parent: Container, g: CircleMapGeometry, tile: number, wave = 1, auraTiles: AuraTile[] = [], ownedQuads: number[] = [0, 1, 2, 3]): void {
  const ground = new Container();
  const overlay = new Container();
  const decorLayer = new Container();   // cozy scatter props (above wash, below towers)
  const features = new Container();
  const tintLayer = new Graphics();
  const lightLayer = new Container();   // GK torch/lantern glow (above the mood grade)
  lightLayer.name = 'gk-lights';        // named so the frame loop can flicker it
  parent.addChild(ground, overlay, decorLayer, features, tintLayer, lightLayer);
  const lanternPos: { x: number; y: number }[] = [];

  // 1) Cozy Stardew/FF1 grass over the whole interior (build zones + under path).
  const lo = g.margin, hi = g.size - 1 - g.margin;
  for (let row = lo; row <= hi; row++) {
    for (let col = lo; col <= hi; col++) {
      const t = tex((col * 7 + row * 13) % 2 === 0 ? 'COZY_GRASS_A' : 'COZY_GRASS_B') ?? tex('GRASS_A');
      if (!t) continue;
      const s = new Sprite(t);
      s.x = col * tile; s.y = row * tile; s.width = tile + 1; s.height = tile + 1;
      ground.addChild(s);
    }
  }

  // 1b) Graveyard-Keeper decoration scatter — sparse, edge-weighted, deterministic.
  //     Sits on grass under the entity layer, so a placed tower simply covers it.
  //     Skips the path, aura tiles, and the area around Rome so nothing reads as
  //     buildable-but-blocked. Somber medieval-graveyard dressing.
  const COZY_DECOR = ['GK_GRAVESTONE', 'GK_CROSS', 'GK_DEADTREE', 'GK_BOULDER', 'GK_MUSHROOMS',
    'GK_DEADBUSH', 'GK_STUMP', 'GK_URN', 'GK_LANTERN', 'GK_BARREL', 'GK_CRATES', 'GK_FENCE',
    'GK_WHEEL', 'GK_SLAB', 'GK_POND', 'GK_WELL'];
  const auraSet = new Set(auraTiles.map((a) => a.row * 1000 + a.col));
  const dhash = (a: number, b: number) => { let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) >>> 0; h = (h ^ (h >>> 13)) >>> 0; return h; };
  const cR = g.center.row, cC = g.center.col;
  for (let row = lo; row <= hi; row++) {
    for (let col = lo; col <= hi; col++) {
      if (g.isPath(col, row)) continue;
      if (auraSet.has(row * 1000 + col)) continue;
      if (Math.abs(row - cR) <= 3 && Math.abs(col - cC) <= 3) continue;   // keep Rome clear
      let nearPath = false;
      for (let dr = -1; dr <= 1 && !nearPath; dr++) for (let dc = -1; dc <= 1; dc++) if (g.isPath(col + dc, row + dr)) { nearPath = true; break; }
      const h = dhash(col, row);
      const edge = Math.min(col - lo, hi - col, row - lo, hi - row);
      const density = (nearPath ? 0.05 : 0.15) * (edge <= 2 ? 1.7 : 1);   // denser at the rim
      if ((h % 1000) / 1000 > density) continue;
      const decorKey = COZY_DECOR[h % COZY_DECOR.length];
      const t = tex(decorKey);
      if (!t) continue;
      const s = new Sprite(t);
      const aspect = (t.height || 1) / (t.width || 1);
      const w = tile * (1.05 + ((h >>> 9) % 35) / 100);   // 1.05-1.40 tiles wide
      s.anchor.set(0.5, 0.9);                              // "sits" on the tile
      s.width = w; s.height = w * aspect;
      s.x = col * tile + tile / 2; s.y = row * tile + tile * 0.72;
      decorLayer.addChild(s);
      if (decorKey === 'GK_LANTERN') lanternPos.push({ x: s.x, y: s.y - w * aspect * 0.42 });
    }
  }

  // 2) Per-quadrant TERRITORY + BUILD ZONES. Each of the 4 quadrants is a
  //    player's zone in multiplayer (NW teal, NE purple, SE orange, SW gold).
  //    Buildable grass glows in that color with a matching border so players
  //    instantly read whose zone it is and exactly where they can build; the
  //    spiral path stays neutral cobble (the no-build lane). Non-owned zones
  //    (multiplayer restrictBuild) render dimmer so "can't build here" is clear.
  const owned = new Set(ownedQuads);
  const QNAME = ['NW', 'NE', 'SE', 'SW'];
  const wash = new Graphics();
  for (let row = lo; row <= hi; row++) {
    for (let col = lo; col <= hi; col++) {
      if (g.isPath(col, row)) continue;
      const q = quadrantOf({ col, row }, g.size);
      const tint = PAIR_TINT[q];
      const isOwned = owned.has(q);
      wash.beginFill(tint, isOwned ? 0.11 : 0.04).drawRect(col * tile, row * tile, tile, tile).endFill();
      wash.lineStyle(1, tint, isOwned ? 0.38 : 0.12).drawRect(col * tile + 0.5, row * tile + 0.5, tile - 1, tile - 1).lineStyle(0);
    }
  }
  overlay.addChild(wash);

  // 2b) Bold dividers down the quadrant seams so the 4 zones read at a glance.
  const mid = Math.floor(g.size / 2);
  const div = new Graphics();
  div.lineStyle(3, 0xffffff, 0.26);
  div.moveTo(mid * tile, lo * tile); div.lineTo(mid * tile, (hi + 1) * tile);
  div.moveTo(lo * tile, mid * tile); div.lineTo((hi + 1) * tile, mid * tile);
  overlay.addChild(div);

  // 2c) A color-keyed zone label in each quadrant's outer corner.
  const labelAt: { q: number; col: number; row: number }[] = [
    { q: 0, col: lo + (mid - lo) / 2, row: lo + 1.0 },
    { q: 1, col: mid + (hi - mid) / 2, row: lo + 1.0 },
    { q: 2, col: mid + (hi - mid) / 2, row: hi - 0.5 },
    { q: 3, col: lo + (mid - lo) / 2, row: hi - 0.5 },
  ];
  for (const la of labelAt) {
    const owns = owned.has(la.q);
    const label = new Text(`${QNAME[la.q]}${owns ? '' : ' (locked)'}`, {
      fontFamily: 'Courier New, monospace', fontSize: 15, fontWeight: '900',
      fill: PAIR_TINT[la.q], stroke: 0x000000, strokeThickness: 4, letterSpacing: 2,
    });
    label.anchor.set(0.5);
    label.alpha = owns ? 0.9 : 0.5;
    label.x = la.col * tile; label.y = la.row * tile;
    features.addChild(label);
  }

  // 3) Graveyard-Keeper aged cobblestone spiral path (sprite tile; falls back
  //    to a muted procedural cobble if the GK tile is missing).
  const pathTex = tex('GK_PATH');
  if (pathTex) {
    for (const p of g.path) {
      const s = new Sprite(pathTex);
      s.x = p.col * tile; s.y = p.row * tile; s.width = tile + 1; s.height = tile + 1;
      ground.addChild(s);
    }
  } else {
    const pathG = new Graphics();
    for (const p of g.path) {
      const x = p.col * tile, y = p.row * tile;
      pathG.beginFill(0x6f6a60).drawRect(x, y, tile, tile).endFill();
      pathG.beginFill(0x7c776c).drawRect(x + 2, y + 2, tile / 2 - 2, tile / 2 - 2).endFill();
      pathG.beginFill(0x5f5a52).drawRect(x + tile / 2, y + tile / 2, tile / 2 - 2, tile / 2 - 2).endFill();
      pathG.lineStyle(1, 0x3a382f, 0.7).drawRect(x + 0.5, y + 0.5, tile - 1, tile - 1).lineStyle(0);
    }
    ground.addChild(pathG);
  }

  // 4) A DARK_CAVE at each of the 4 corner spawns.
  for (const sp of g.spawns) {
    const t = tex('DARK_CAVE');
    if (!t) continue;
    const s = new Sprite(t);
    s.anchor.set(0.5);
    s.x = sp.col * tile + tile / 2; s.y = sp.row * tile + tile / 2;
    s.width = tile * 3.4; s.height = tile * 3.4;
    features.addChild(s);
  }

  // 5) Rome at the center (the shared life pool the team defends).
  {
    const t = tex('ROMAN_GATE');
    if (t) {
      const s = new Sprite(t);
      s.anchor.set(0.5);
      s.x = g.center.col * tile + tile / 2; s.y = g.center.row * tile + tile / 2;
      s.width = tile * 4.2; s.height = tile * 4.2;
      features.addChild(s);
    }
    // gold glow ring under/over Rome so the objective reads.
    const glow = new Graphics();
    glow.lineStyle(3, 0xffd24f, 0.9);
    glow.drawCircle(g.center.col * tile + tile / 2, g.center.row * tile + tile / 2, tile * 2.6);
    features.addChildAt(glow, 0);
  }

  // 5b) Aura tiles — 6 medallions on grass that buff towers placed on them.
  for (const a of auraTiles) {
    const cx = a.col * tile + tile / 2, cy = a.row * tile + tile / 2;
    const eff = AURA_TILE_EFFECTS[a.kind];
    const glow = new Graphics();
    glow.beginFill(eff.color, 0.16).drawCircle(cx, cy, tile * 0.58).endFill();
    glow.lineStyle(2, eff.color, 0.85).drawCircle(cx, cy, tile * 0.5);
    features.addChild(glow);
    const t = tex('MAP_AURA_' + a.kind);
    if (t) {
      const s = new Sprite(t);
      s.anchor.set(0.5); s.x = cx; s.y = cy; s.width = s.height = tile * 0.86;
      features.addChild(s);
    } else {
      const gem = new Graphics();
      gem.beginFill(eff.color, 0.95).drawCircle(cx, cy, tile * 0.22).endFill();
      gem.lineStyle(1, 0xffffff, 0.6).drawCircle(cx, cy, tile * 0.22);
      features.addChild(gem);
    }
  }

  // 6) Mood grade — biome-aware to span Graveyard Keeper's REAL tonal range:
  //    warm bright daylight early (GK overworld), cool fog mid (witch's land),
  //    dark torch-lit late (the morgue). One fixed dark wash made every wave a
  //    dungeon; this reads the biome so the early game stays warm and inviting.
  //    Map layer only — towers/enemies render above it and stay clear.
  const N = g.size * tile;
  const biomeId = biomeForWave(wave);
  const mood = BIOME_MOOD[biomeId] ?? BIOME_MOOD.BIOME_UNDEAD_FOREST;
  if (mood.alpha > 0) tintLayer.beginFill(mood.grade, mood.alpha).drawRect(0, 0, N, N).endFill();
  for (let k = 0; k < 4; k++) {                       // vignette: darker toward the rim
    const inset = k * tile * 1.2;
    tintLayer.lineStyle(tile * 1.3, 0x0a0b12, mood.vig);
    tintLayer.drawRect(inset, inset, N - inset * 2, N - inset * 2);
  }
  tintLayer.lineStyle(0);

  // 6b) Per-wave biome tint wash over everything (warm sun -> hellscape).
  const biome = BIOMES[biomeId];
  if (biome && biome.tint && biome.tint.alpha > 0) {
    tintLayer.beginFill(biome.tint.color, biome.tint.alpha);
    tintLayer.drawRect(0, 0, N, N).endFill();
  }

  // 7) Graveyard-Keeper dynamic lighting. Warm light pools from every lantern
  //    prop, the four corner caves, and Rome's central hearth; each aura
  //    medallion gets a colored magical glow. Additive blend (lightLayer sits
  //    above the grade, below the live units) so they read as real torchlight.
  //    Intensity scales with the biome's `light` factor — subtle in daylight,
  //    full in the dark biomes, matching GK's morgue torch-pools.
  const glowTex = glowTexture();
  const lx = mood.light;
  const addLight = (x: number, y: number, radius: number, color: number, alpha: number): Sprite => {
    const l = new Sprite(glowTex);
    l.anchor.set(0.5); l.blendMode = BLEND_MODES.ADD; l.tint = color;
    l.x = x; l.y = y; l.width = l.height = radius * 2; l.alpha = alpha;
    (l as any)._base = alpha; (l as any)._phase = lightLayer.children.length * 1.7;   // flicker params
    lightLayer.addChild(l);
    return l;
  };
  for (const p of lanternPos) addLight(p.x, p.y, tile * 2.4, 0xffb45a, 0.5 * lx);            // hanging-lantern flame
  for (const sp of g.spawns)                                                                  // torch-lit cave mouths
    addLight(sp.col * tile + tile / 2, sp.row * tile + tile / 2, tile * 3.2, 0xff8a3a, 0.42 * lx);
  addLight(g.center.col * tile + tile / 2, g.center.row * tile + tile / 2, tile * 4.6, 0xffca92, 0.46 * lx);  // Rome hearth
  for (const a of auraTiles)                                                                   // aura-medallion glow (always lit)
    addLight(a.col * tile + tile / 2, a.row * tile + tile / 2, tile * 1.8, AURA_TILE_EFFECTS[a.kind].color, 0.5);
}

// ─────────────────────────────────────────────────────────────────────
// LIVE ENTITY LAYER — towers, enemies, projectiles, drawn with the REAL
// Roman TD sprites (tex(type) / tex(spriteKey)), rebuilt each frame. The
// circle uses the same enum-to-sprite resolution as the base RenderEngine
// (tw.type, e.type, p.spriteKey), so every base unit renders identically.
// Position-based: enemy.x/y and tower.tileX/tileY are in GRID.TILE coords.
// ─────────────────────────────────────────────────────────────────────
export function renderCircleEntities(layer: Container, state: GameStateShape, g: CircleMapGeometry, tile: number, opts: CircleEntityOpts = {}): void {
  for (const c of layer.removeChildren()) c.destroy({ children: true });

  // Build-tile hover highlight (green = buildable, red = blocked).
  if (opts.hover) {
    const h = new Graphics();
    const col = opts.hover.valid ? 0x6fff8f : 0xff6f6f;
    h.lineStyle(2, col, 0.9).beginFill(col, 0.14)
      .drawRect(opts.hover.col * tile + 1, opts.hover.row * tile + 1, tile - 2, tile - 2).endFill();
    layer.addChild(h);
  }

  // Combo-eligible glow (build phases only — cheap enough, and only when relevant).
  const comboIds = new Set<string>();
  if (state.phase !== GamePhase.WAVE_PHASE) {
    for (const c of realizableCombos(state)) for (const ing of c.ingredients) comboIds.add(ing.id);
  }

  // Towers — real sprite + tier pips + combo glow + selected range ring.
  for (const t of state.towers.values()) {
    const cx = t.tileX * tile + tile / 2;
    const cy = t.tileY * tile + tile / 2;

    if (opts.selectedTowerId === t.id) {
      const range = towerEffectiveStats(t).range;
      const ring = new Graphics();
      ring.lineStyle(2, 0xffd34f, 0.85).drawCircle(cx, cy, range * tile);
      ring.beginFill(0xffd34f, 0.06).drawCircle(cx, cy, range * tile).endFill();
      layer.addChild(ring);
    }
    if (comboIds.has(t.id)) {
      const glow = new Graphics();
      glow.lineStyle(2, 0xff5a5a, 0.9).drawCircle(cx, cy, tile * 0.62);  // red ring = combo-eligible
      layer.addChild(glow);
    }

    const tx = tex(t.type);
    if (tx) {
      const s = new Sprite(tx);
      s.anchor.set(0.5);
      // Bigger + a gentle idle "breathe" so towers read as alive.
      const ph = hashPhase(t.id);
      const breathe = 1 + Math.sin(state.tick * 2.3 + ph) * 0.04;
      const base = tile * 1.14;
      s.width = base * breathe; s.height = base * breathe;
      s.x = cx; s.y = cy + Math.sin(state.tick * 2.3 + ph) * 0.9;
      if (t.pending) s.alpha = 0.55;
      layer.addChild(s);
    }
    // Tier pips (small gold dots, one per tier above the tower).
    const tier = t.qualityTier ?? 1;
    if (tier > 1 && !t.pending) {
      const pips = new Graphics();
      const startX = cx - (tier - 1) * 2.5;
      for (let i = 0; i < tier; i++) pips.beginFill(0xffd34f, 0.95).drawCircle(startX + i * 5, cy - tile / 2 + 2, 1.6).endFill();
      layer.addChild(pips);
    }
  }

  // Enemies — real sprite + status tint + HP bar. Bosses render larger.
  for (const e of state.enemies.values()) {
    const tx = tex(e.type);
    const size = (e.isBoss ? tile * 1.9 : tile * 0.96);   // bigger + livelier
    if (tx) {
      const s = new Sprite(tx);
      s.anchor.set(0.5);
      // Walk-bob + squash/stretch + face the travel direction.
      const t2 = state.tick * 7 + hashPhase(e.id);
      const sq = 1 + Math.sin(t2 * 2) * 0.06;
      const faceSign = (e.dirX ?? 1) < 0 ? -1 : 1;
      s.x = e.x; s.y = e.y + Math.sin(t2) * (size * 0.05);
      s.height = size * sq;
      s.width = (size / sq) * faceSign;     // negative width flips horizontally (facing)
      if ((e as any).__veiled) s.alpha = 0.35;
      // Dominant-status tint (slow/burn/poison/freeze/etc.).
      const st = e.statusEffects?.[0]?.kind as string | undefined;
      if (st && STATUS_TINT[st]) s.tint = STATUS_TINT[st];
      layer.addChild(s);
    }
    if (e.hp < e.maxHp && e.maxHp > 0) {
      const w = size * 0.9, h = 3;
      const frac = Math.max(0, Math.min(1, e.hp / e.maxHp));
      const bar = new Graphics();
      bar.beginFill(0x000000, 0.6).drawRect(e.x - w / 2, e.y - size / 2 - 6, w, h).endFill();
      bar.beginFill(frac > 0.5 ? 0x4fdd6a : frac > 0.25 ? 0xe8c84a : 0xdd4f4f, 0.95)
        .drawRect(e.x - w / 2, e.y - size / 2 - 6, w * frac, h).endFill();
      layer.addChild(bar);
    }
  }

  // Projectiles — real sprite, rotated toward travel.
  for (const p of state.projectiles.values()) {
    const tx = tex(p.spriteKey);
    if (!tx) continue;
    const s = new Sprite(tx);
    s.anchor.set(0.5);
    s.x = p.x; s.y = p.y;
    s.width = s.height = tile * 0.5;
    s.rotation = p.rotation ?? 0;
    layer.addChild(s);
  }

}

/**
 * Screen-fixed HUD layer (boss HP bar). Drawn on a container that lives on
 * app.stage (NOT inside the camera world), so it stays put when the player
 * zooms or pans. `screenW` is the stage width (worldPx).
 */
/**
 * Surprise-event FX on the circle. While Invasion / Uprising / Gates of Hell is
 * active, paints a screen tint + a pulsing breach at each of the four corner
 * caves (the circle's "gates"): fire for INVASION, a skull urn for UPRISING,
 * a hellfire glow for GATES_OF_HELL (the HELL_GATE spawners themselves render
 * as enemies at the corners). Drawn under the entity layer.
 */
export function renderCircleSurprise(layer: Container, state: GameStateShape, g: CircleMapGeometry, tile: number): void {
  for (const c of layer.removeChildren()) c.destroy({ children: true });
  if (!isSurpriseEventActive(state)) return;
  const kind = (state.activeSurpriseEvent?.kind ?? getAllActiveSurpriseEvents(state)[0]?.kind) as string | undefined;
  const color = kind === 'UPRISING' ? 0x8a4ad0 : kind === 'GATES_OF_HELL' ? 0xcc2a10 : 0xff7722;
  const iconKey = kind === 'UPRISING' ? 'SKULL_URN' : kind === 'GATES_OF_HELL' ? null : 'FIRE_LARGE';

  // Screen tint wash over the whole board.
  const tint = new Graphics();
  tint.beginFill(color, 0.10).drawRect(0, 0, g.size * tile, g.size * tile).endFill();
  layer.addChild(tint);

  // Pulsing breach at each of the 4 corner caves.
  const pulse = 0.55 + 0.45 * Math.sin(state.tick * 6);
  for (const sp of g.spawns) {
    const cx = sp.col * tile + tile / 2, cy = sp.row * tile + tile / 2;
    const glow = new Graphics();
    glow.beginFill(color, 0.26 * pulse).drawCircle(cx, cy, tile * 1.7).endFill();
    glow.beginFill(color, 0.18 * pulse).drawCircle(cx, cy, tile * 2.6).endFill();
    layer.addChild(glow);
    if (iconKey) {
      const t = tex(iconKey);
      if (t) {
        const s = new Sprite(t);
        s.anchor.set(0.5); s.x = cx; s.y = cy; s.width = s.height = tile * 1.9 * (0.9 + 0.15 * pulse);
        layer.addChild(s);
      }
    }
  }
}

export function renderCircleHud(layer: Container, state: GameStateShape, screenW: number): void {
  for (const c of layer.removeChildren()) c.destroy({ children: true });
  let boss: any = null;
  for (const e of state.enemies.values()) if (e.isBoss && (!boss || e.maxHp > boss.maxHp)) boss = e;
  if (!boss) return;
  const bw = screenW * 0.6, bh = 14, bx = (screenW - bw) / 2, by = 16;
  const frac = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
  const bar = new Graphics();
  bar.beginFill(0x000000, 0.7).drawRect(bx - 2, by - 2, bw + 4, bh + 4).endFill();
  bar.lineStyle(1, 0x7a2a2a, 1).drawRect(bx, by, bw, bh);
  bar.beginFill(0xcc2a2a, 0.95).drawRect(bx, by, bw * frac, bh).endFill();
  layer.addChild(bar);
  const label = new Text(`${String(boss.type).replace(/_/g, ' ')}   ${Math.ceil(boss.hp).toLocaleString()} / ${boss.maxHp.toLocaleString()}`, {
    fontFamily: 'Courier New, monospace', fontSize: 10, fontWeight: '700', fill: 0xffe9a8, stroke: 0x000000, strokeThickness: 3,
  });
  label.anchor.set(0.5, 0.5);
  label.x = bx + bw / 2; label.y = by + bh / 2;
  layer.addChild(label);
}
