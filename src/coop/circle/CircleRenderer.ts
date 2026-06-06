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

import { Container, Graphics, Sprite } from 'pixi.js';
import { tex } from '../../render/Assets';
import { biomeForWave, BIOMES } from '../../render/Biomes';
import type { CircleMapGeometry } from './CircleMap';
import { quadrantOf } from './CircleMap';

// Faint pair tints by quadrant (NW teal, NE purple, SE orange, SW yellow).
const PAIR_TINT = [0x00b4aa, 0xaa5adc, 0xeb8228, 0xebc83c];

export function renderCircleMap(parent: Container, g: CircleMapGeometry, tile: number, wave = 1): void {
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

  // 6) Per-wave biome tint wash over everything (warm sun -> hellscape).
  const biome = BIOMES[biomeForWave(wave)];
  if (biome && biome.tint && biome.tint.alpha > 0) {
    tintLayer.beginFill(biome.tint.color, biome.tint.alpha);
    tintLayer.drawRect(0, 0, g.size * tile, g.size * tile);
    tintLayer.endFill();
  }
}
