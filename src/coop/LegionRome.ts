// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION MODE — Phase 6: Rome HP system (Sections 3.4, 5.4, 11.2)
//
// Rome is the shared objective. Leaks that complete the circuit strike it,
// dealing damage equal to their CURRENT HP at impact (×3 boss, ×1.5 immune).
// Pure state transitions + helpers; the runtime applies the animation delay
// and broadcasts HP to all clients.
// ─────────────────────────────────────────────────────────────────────

import {
  ROME_BOSS_DAMAGE_MULT, ROME_IMMUNE_DAMAGE_MULT,
  ROME_REBUILD_GOLD_PER_STEP, ROME_REBUILD_HP_PER_STEP,
} from './LegionConfig';
import { romeStartingHp } from './LegionScaling';
import type { RomeState, LeakUnit } from './LegionTypes';

/** Fresh Rome at full HP for the player count (Section 5.4). */
export function createRome(playerCount: number): RomeState {
  const max = romeStartingHp(playerCount);
  return { hp: max, maxHp: max, pendingDamage: 0 };
}

/**
 * Damage a single leaked unit deals to Rome (Section 3.4):
 *   base = unit's current HP at impact
 *   ×3 if boss, ×1.5 if immune creep (boss takes precedence)
 */
export function romeDamageFor(unit: LeakUnit): number {
  const base = Math.max(0, unit.hp);
  if (unit.isBoss) return Math.round(base * ROME_BOSS_DAMAGE_MULT);
  if (unit.isImmune) return Math.round(base * ROME_IMMUNE_DAMAGE_MULT);
  return Math.round(base);
}

/**
 * Queue damage during the animation-delay window (Section 3.4 / Q6 default
 * B). The runtime calls flushPendingDamage after the delay to actually
 * subtract it, so the red-pulse + crumble animation reads before HP drops.
 */
export function queueRomeDamage(rome: RomeState, dmg: number): RomeState {
  return { ...rome, pendingDamage: rome.pendingDamage + Math.max(0, dmg) };
}

/** Apply all queued damage (after the animation delay). Clamps at 0. */
export function flushPendingDamage(rome: RomeState): RomeState {
  const hp = Math.max(0, rome.hp - rome.pendingDamage);
  return { ...rome, hp, pendingDamage: 0 };
}

/** Immediate damage (used when no animation delay is desired). */
export function applyRomeDamage(rome: RomeState, dmg: number): RomeState {
  return { ...rome, hp: Math.max(0, rome.hp - Math.max(0, dmg)) };
}

/** Rome has fallen → DEFEAT (Section 6 / 11.2). */
export function isRomeFallen(rome: RomeState): boolean {
  return rome.hp <= 0;
}

/** Fraction of Rome HP remaining (0..1). */
export function romeHpFraction(rome: RomeState): number {
  return rome.maxHp > 0 ? Math.max(0, Math.min(1, rome.hp / rome.maxHp)) : 0;
}

/**
 * Rome rebuild (Section 6.4): combined gold restores HP in fixed steps.
 * Given total gold contributed this prep, returns the HP restored and any
 * leftover gold (caps at once per prep phase — runtime enforces the cap).
 */
export function rebuildFromGold(gold: number): { hpRestored: number; goldSpent: number } {
  if (gold < ROME_REBUILD_GOLD_PER_STEP) return { hpRestored: 0, goldSpent: 0 };
  return { hpRestored: ROME_REBUILD_HP_PER_STEP, goldSpent: ROME_REBUILD_GOLD_PER_STEP };
}

/** Restore HP (clamped to maxHp) — used by the rebuild flow. */
export function restoreRome(rome: RomeState, hp: number): RomeState {
  return { ...rome, hp: Math.min(rome.maxHp, rome.hp + Math.max(0, hp)) };
}

/**
 * HP-bar gradient color (Section 11.2): green → yellow → red → flashing red.
 * Returns a CSS hex string for the HUD bar.
 */
export function romeBarColor(rome: RomeState): string {
  const f = romeHpFraction(rome);
  if (f > 0.5) return '#66ff88';   // green
  if (f > 0.25) return '#ffd34d';  // yellow
  if (f > 0.10) return '#ff7733';  // red-orange
  return '#ff3030';                // flashing red (runtime adds the flash)
}

/** Whether Rome is in the critical flashing range (<10%). */
export function isRomeCritical(rome: RomeState): boolean {
  return romeHpFraction(rome) <= 0.10 && rome.hp > 0;
}
