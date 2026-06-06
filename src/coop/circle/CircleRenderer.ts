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

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { tex } from '../../render/Assets';
import { biomeForWave, BIOMES } from '../../render/Biomes';
import { realizableCombos } from '../../systems/CombinationEngine';
import { towerEffectiveStats } from '../../systems/TowerSystem';
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

// Faint pair tints by quadrant (NW teal, NE purple, SE orange, SW yellow).
const PAIR_TINT = [0x00b4aa, 0xaa5adc, 0xeb8228, 0xebc83c];

export function renderCircleMap(parent: Container, g: CircleMapGeometry, tile: number, wave = 1, auraTiles: AuraTile[] = []): void {
  const ground = new Container();
  const overlay = new Container();
  const features = new Container();
  const tintLayer = new Graphics();
  parent.addChild(ground, overlay, features, tintLayer);

  // 1) Grass over the whole interior (build zones + under the path).
  const lo = g.margin, hi = g.size - 1 - g.margin;
  for (let row = lo; row <= hi; row++) {
    for (let col = lo; col <= hi; col++) {
      const t = tex((col * 7 + row * 13) % 2 === 0 ? 'GRASS_A' : 'GRASS_B');
      if (!t) continue;
      const s = new Sprite(t);
      s.x = col * tile; s.y = row * tile; s.width = tile + 1; s.height = tile + 1;
      ground.addChild(s);
    }
  }

  // 2) Faint pair-color wash per quadrant so the 4 team territories read.
  const wash = new Graphics();
  for (let row = lo; row <= hi; row++) {
    for (let col = lo; col <= hi; col++) {
      if (g.isPath(col, row)) continue;
      wash.beginFill(PAIR_TINT[quadrantOf({ col, row }, g.size)], 0.10);
      wash.drawRect(col * tile, row * tile, tile, tile);
      wash.endFill();
    }
  }
  overlay.addChild(wash);

  // 3) Procedural cobblestone spiral path (sandstone base + mortar + cobbles).
  const pathG = new Graphics();
  for (const p of g.path) {
    const x = p.col * tile, y = p.row * tile;
    pathG.beginFill(0xb89a6a).drawRect(x, y, tile, tile).endFill();
    pathG.beginFill(0xc8aa7a).drawRect(x + 2, y + 2, tile / 2 - 2, tile / 2 - 2).endFill();
    pathG.beginFill(0xa88a5a).drawRect(x + tile / 2, y + tile / 2, tile / 2 - 2, tile / 2 - 2).endFill();
    pathG.lineStyle(1, 0x6a5436, 0.7).drawRect(x + 0.5, y + 0.5, tile - 1, tile - 1).lineStyle(0);
  }
  ground.addChild(pathG);

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

  // 6) Per-wave biome tint wash over everything (warm sun -> hellscape).
  const biome = BIOMES[biomeForWave(wave)];
  if (biome && biome.tint && biome.tint.alpha > 0) {
    tintLayer.beginFill(biome.tint.color, biome.tint.alpha);
    tintLayer.drawRect(0, 0, g.size * tile, g.size * tile);
    tintLayer.endFill();
  }
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
      s.x = cx; s.y = cy;
      s.width = s.height = tile * 0.96;
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
    const size = (e.isBoss ? tile * 1.7 : tile * 0.82);
    if (tx) {
      const s = new Sprite(tx);
      s.anchor.set(0.5);
      s.x = e.x; s.y = e.y;
      s.width = s.height = size;
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

  // Boss HP bar — big bar across the top during boss waves (readability).
  let boss = null as any;
  for (const e of state.enemies.values()) if (e.isBoss && (!boss || e.maxHp > boss.maxHp)) boss = e;
  if (boss) {
    const mapW = g.size * tile;
    const bw = mapW * 0.6, bh = 14, bx = (mapW - bw) / 2, by = tile * 0.6;
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
}
