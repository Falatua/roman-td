// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION — Green Circle VFX layer (CIRCLE-4 slice 3)
//
// A lightweight stand-in for RenderEngine's combat-VFX surface so the circle
// can reuse BoardPresentation's REAL combat/projectile hooks (which call
// renderer.triggerMeleeSlash / triggerMuzzleFlash / triggerImpactRing /
// triggerShake + emit gore + play SFX). CircleFx implements exactly those
// trigger methods on its own Pixi layers, plus renders the GoreState
// (blood particles, stains, corpses, floating damage numbers) each frame —
// the same visual cues single-player shows, on the circular map.
// ─────────────────────────────────────────────────────────────────────

import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { tex } from '../../render/Assets';
import { GRID } from '../../constants';
import type { GoreState } from '../../systems/GoreSystem';

const SLASH_TTL = 0.18;
const FLASH_TTL = 0.12;
const RING_TTL = 0.32;

interface Fading { node: Sprite | Graphics; life: number; max: number; }
interface Ring { node: Graphics; age: number; maxR: number; color: number; }

/** Implements the RenderEngine VFX surface BoardPresentation's hooks call. */
export class CircleFx {
  readonly fxLayer = new Container();      // transient slash/flash/ring nodes
  readonly goreLayer = new Container();    // blood + numbers + corpses (rebuilt each frame)
  private slashes: Fading[] = [];
  private flashes: Fading[] = [];
  private rings: Ring[] = [];
  private shakeMag = 0;
  private shakeRemaining = 0;
  bossWaveActive = false;

  constructor(private readonly shakeTarget: Container) {}

  // ── RenderEngine VFX surface (the methods the hooks call) ──────────────
  triggerMeleeSlash(x: number, y: number, angle: number, _tick: number, size = 1, _cleaver = false, tint?: number): void {
    const t = tex('PROJ_SLASH');
    let node: Sprite | Graphics;
    if (t) {
      const s = new Sprite(t);
      s.anchor.set(0.5);
      s.rotation = angle;
      s.width = s.height = GRID.TILE * 0.95 * size;
      if (tint != null) s.tint = tint;
      node = s;
    } else {
      const g = new Graphics();
      g.lineStyle(3, tint ?? 0xfff5cc, 0.95);
      g.moveTo(-12 * size, 0); g.lineTo(12 * size, 0);
      g.rotation = angle;
      node = g;
    }
    node.x = x; node.y = y;
    this.fxLayer.addChild(node);
    this.slashes.push({ node, life: SLASH_TTL, max: SLASH_TTL });
  }

  triggerMuzzleFlash(x: number, y: number, color: number, _tick: number): void {
    const g = new Graphics();
    g.beginFill(color, 0.95).drawCircle(0, 0, 5).endFill();
    g.beginFill(0xffffff, 0.8).drawCircle(0, 0, 2).endFill();
    g.x = x; g.y = y;
    this.fxLayer.addChild(g);
    this.flashes.push({ node: g, life: FLASH_TTL, max: FLASH_TTL });
  }

  triggerImpactRing(x: number, y: number, _tick: number, maxR = 24, color = 0xffffff): void {
    const g = new Graphics();
    g.x = x; g.y = y;
    this.fxLayer.addChild(g);
    this.rings.push({ node: g, age: 0, maxR, color });
  }

  triggerShake(mag: number, dur: number): void {
    this.shakeMag = Math.max(this.shakeMag, mag);
    this.shakeRemaining = Math.max(this.shakeRemaining, dur);
  }

  setBossWaveActive(on: boolean): void { this.bossWaveActive = on; }

  // ── Per-frame advance ──────────────────────────────────────────────────
  update(dt: number): void {
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i];
      s.life -= dt;
      s.node.alpha = Math.max(0, s.life / s.max);
      if (s.life <= 0) { s.node.destroy(); this.slashes.splice(i, 1); }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      f.node.alpha = Math.max(0, f.life / f.max);
      f.node.scale.set(1 + (1 - f.life / f.max) * 0.8);
      if (f.life <= 0) { f.node.destroy(); this.flashes.splice(i, 1); }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      const frac = r.age / RING_TTL;
      r.node.clear();
      r.node.lineStyle(2, r.color, Math.max(0, 1 - frac));
      r.node.drawCircle(0, 0, Math.max(1, r.maxR * frac));
      if (frac >= 1) { r.node.destroy(); this.rings.splice(i, 1); }
    }
    if (this.shakeRemaining > 0) {
      this.shakeRemaining -= dt;
      if (this.shakeRemaining <= 0) { this.shakeTarget.position.set(0, 0); this.shakeMag = 0; }
      else { this.shakeTarget.position.set((Math.random() - 0.5) * this.shakeMag, (Math.random() - 0.5) * this.shakeMag); }
    }
  }

  /** Rebuild the gore layer from the GoreState (particles / stains / corpses / numbers). */
  renderGore(gore: GoreState): void {
    for (const c of this.goreLayer.removeChildren()) c.destroy();

    // Persistent-ish stains first (under everything).
    for (const st of gore.stains) {
      const g = new Graphics();
      g.beginFill(0x5a0d0d, 0.18 + st.intensity * 0.06).drawCircle(st.x, st.y, 4 + st.intensity * 2).endFill();
      this.goreLayer.addChild(g);
    }
    // Faded corpses.
    for (const c of gore.corpses) {
      const t = tex(c.type);
      if (!t) continue;
      const s = new Sprite(t);
      s.anchor.set(0.5);
      s.x = c.x; s.y = c.y;
      s.width = s.height = GRID.TILE * (c.isBoss ? 1.5 : 0.8);
      s.alpha = 0.45; s.tint = 0x7a7a7a; s.rotation = 1.4;
      this.goreLayer.addChild(s);
    }
    // Blood / spark particles.
    for (const p of gore.particles) {
      const g = new Graphics();
      g.beginFill(p.color ?? 0xaa1212, Math.min(1, p.life * 3)).drawCircle(p.x, p.y, Math.max(0.5, p.size)).endFill();
      this.goreLayer.addChild(g);
    }
    // Floating damage numbers (the key combat readability cue).
    for (const n of gore.numbers) {
      const txt = new Text(n.text, {
        fontFamily: 'Courier New, monospace',
        fontSize: n.isCrit ? 17 : 11,
        fontWeight: n.isCrit ? '900' : '700',
        fill: n.color,
        stroke: 0x000000,
        strokeThickness: 3,
      });
      txt.anchor.set(0.5);
      txt.x = n.x; txt.y = n.y;
      txt.alpha = Math.min(1, n.life * 2);
      this.goreLayer.addChild(txt);
    }
  }

  destroy(): void {
    for (const c of this.fxLayer.removeChildren()) c.destroy();
    for (const c of this.goreLayer.removeChildren()) c.destroy();
  }
}
