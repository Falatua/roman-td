import { GameStateShape } from '../GameState';
import { GRID, RENDER_LIMITS } from '../constants';
import { Enemy } from '../types';

export interface BloodParticle {
  x: number; y: number;
  vx: number; vy: number;
  life: number;     // remaining seconds
  size: number;
  color?: number;   // override; default = red
}

export interface BloodStain {
  x: number; y: number;
  intensity: 1 | 2 | 3 | 4;
  born: number;
}

export interface Corpse {
  x: number; y: number;
  type: string;     // EnemyType
  isFlyer: boolean;
  isBoss: boolean;
  fadeStartTick: number;
}

// Floating damage numbers — readability per Vision §4.2
export interface FloatingNumber {
  x: number; y: number;
  vy: number;
  life: number;
  text: string;
  color: number;
  // 2026-05 v11 (B8 Crit Punch): when true the renderer paints this number
  // larger and in gold so crit hits visually announce themselves. The
  // damage value itself is unchanged — this is purely a visual cue.
  isCrit?: boolean;
}

export interface GoreState {
  particles: BloodParticle[];
  stains: BloodStain[];
  corpses: Corpse[];
  numbers: FloatingNumber[];
}

export function createGoreState(): GoreState {
  return { particles: [], stains: [], corpses: [], numbers: [] };
}

function pushParticle(gore: GoreState, p: BloodParticle) {
  if (gore.particles.length >= RENDER_LIMITS.MAX_PARTICLES) return;
  gore.particles.push(p);
}

export function emitFloatingNumber(gore: GoreState, x: number, y: number, dmg: number, color = 0xffe6a8, isCrit = false) {
  // PERF: drop NEWEST when at cap instead of shifting the oldest.
  // .shift() on an 80-element array is O(80) per overflow push and
  // compounds heavily during multi-target / multi-hit frames.
  if (gore.numbers.length >= 80) return;
  // Crit hits override the color to gold and tag the entry for the
  // renderer to scale up. Caller-supplied color still wins for special
  // cases (status icons, miss labels) — those pass isCrit=false.
  const finalColor = isCrit ? 0xffd34d : color;
  gore.numbers.push({
    x: x + (Math.random() - 0.5) * 6,
    y: y - 6,
    vy: isCrit ? -50 - Math.random() * 20 : -34 - Math.random() * 16,   // crits float a bit higher
    life: isCrit ? 1.05 : 0.85,                                          // crits linger slightly
    // Crits show the bare number — gold tint + 1.6× scale already mark them as crits.
    text: isCrit ? `${Math.round(dmg)}` : (dmg >= 100 ? `${Math.round(dmg)}!` : `${Math.round(dmg)}`),
    color: finalColor,
    isCrit
  });
}

export function emitHitSplatter(gore: GoreState, x: number, y: number, big = false) {
  // 2026-05-18 — non-boss count bumped 6 → 9 to make each kill feel
  // visibly weightier without overrunning the particle pool. Boss
  // splatter unchanged (already meaty at 14).
  const n = big ? 8 : 3;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 40 + Math.random() * (big ? 220 : 90);
    pushParticle(gore, {
      x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30,
      life: 0.45 + Math.random() * 0.3,
      size: 2 + Math.random() * 2
    });
  }
}

// Yellow-white spark burst on impact (game feel §6.2 — distinct from red blood)
// 2026-06-21 perf pass — spark count 6 → 2. Every hit used to add a
// burst, which became a frame-budget tax on dense late waves.
export function emitHitSpark(gore: GoreState, x: number, y: number) {
  for (let i = 0; i < 2; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 80 + Math.random() * 100;
    pushParticle(gore, {
      x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: 0.18 + Math.random() * 0.10,
      size: 1 + Math.random() * 1,
      color: 0xffe85a   // bright yellow-white spark
    });
  }
}

// Damage-type-specific impact burst (Animation Doc §17.3-6).
// Different damage types emit different colored particles for at-a-glance readability.
export function emitTypedImpact(gore: GoreState, x: number, y: number, damageType: number) {
  let color = 0xffe85a;
  let count = 2;
  let speed = 90;
  let life = 0.25;
  switch (damageType) {
    case 2: color = 0xb88a4a; count = 2; speed = 130; life = 0.24; break;  // SIEGE: brown debris
    case 3: color = 0xff7733; count = 3; speed = 80; life = 0.32; break;   // FIRE: orange embers
    case 4: color = 0xfff4a8; count = 4; speed = 60; life = 0.38; break;   // DIVINE: gold-white flash
    default: return; // PHYS_MELEE / PHYS_RANGED already handled by hitSpark
  }
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = speed + Math.random() * (speed * 0.5);
    pushParticle(gore, {
      x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (damageType === 3 ? 30 : 0),
      life: life * (0.7 + Math.random() * 0.5),
      size: 1.5 + Math.random() * 1.5,
      color
    });
  }
}

// Status-specific impact (poison cloud / frost burst). Called when status applied this hit.
export function emitStatusImpact(gore: GoreState, x: number, y: number, kind: string) {
  void gore; void x; void y; void kind;
}

export function emitDeathSplatter(gore: GoreState, e: Enemy, tick: number) {
  if (!e.isBoss) return;
  emitHitSplatter(gore, e.x, e.y, e.isBoss);
  // permanent stain decal
  const intensity = (Math.min(4, 1 + Math.floor((e.maxHp / 100) * (e.isBoss ? 4 : 1)))) as 1 | 2 | 3 | 4;
  gore.stains.push({ x: e.x, y: e.y, intensity, born: tick });
  if (gore.stains.length > RENDER_LIMITS.MAX_BLOOD_STAINS) gore.stains.shift();
  // corpse
  gore.corpses.push({
    x: e.x, y: e.y,
    type: e.type,
    isFlyer: e.isFlyer,
    isBoss: e.isBoss,
    fadeStartTick: -1     // -1 means "wait for wave end"
  });
  // CORPSE CAP (2026-05): waves past W6 accumulate hundreds of bodies that
  // sit on the field until wave end. Bosses stay (their corpses are big
  // and dramatic); mob corpses past the cap get their fade-clock started
  // immediately so they disappear in a few seconds and don't compound the
  // render cost frame after frame. We always evict the oldest non-boss
  // first so the recent battle still reads.
  if (gore.corpses.length > RENDER_LIMITS.MAX_CORPSES) {
    for (let i = 0; i < gore.corpses.length; i++) {
      const c = gore.corpses[i];
      if (!c.isBoss && c.fadeStartTick < 0) { c.fadeStartTick = tick; break; }
    }
  }
}

export function tickGore(gore: GoreState, dt: number) {
  for (let i = gore.particles.length - 1; i >= 0; i--) {
    const p = gore.particles[i];
    p.life -= dt;
    if (p.life <= 0) { gore.particles.splice(i, 1); continue; }
    p.vy += 280 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  for (let i = gore.numbers.length - 1; i >= 0; i--) {
    const n = gore.numbers[i];
    n.life -= dt;
    if (n.life <= 0) { gore.numbers.splice(i, 1); continue; }
    n.y += n.vy * dt;
    n.vy += 18 * dt; // slow gravity
  }
  // PERF (2026-05): also evict corpses whose fade-clock finished mid-tick
  // so the render list stays small. Bosses stick around (fadeStartTick stays
  // -1 until wave-end); only mid-wave-evicted mob corpses come through.
  // Kept lightweight — quick reverse-loop, no .filter() allocation.
}

// Called when wave ends: trigger corpse fade
export function fadeCorpsesAtWaveEnd(gore: GoreState, tick: number) {
  for (const c of gore.corpses) if (c.fadeStartTick < 0) c.fadeStartTick = tick;
}

// Drop fully faded corpses
export function pruneCorpses(gore: GoreState, tick: number, fadeDuration = 3) {
  let write = 0;
  for (let i = 0; i < gore.corpses.length; i++) {
    const c = gore.corpses[i];
    if (c.fadeStartTick < 0 || (tick - c.fadeStartTick) < fadeDuration) {
      gore.corpses[write++] = c;
    }
  }
  gore.corpses.length = write;
}
