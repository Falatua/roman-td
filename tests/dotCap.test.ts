// Tests for the 2026-05-21 DoT-dependency balance pass:
//   B1 — Aggregate DoT cap (8% maxHp/sec) + HELLFIRE sub-cap (2%/sec)
//   B2 — DoT-suppresses-regen softening (100% → 50%)
//   B3 — FREEZE / STUN direct-damage amp (+10% additive, source code check)
//
// Strategy: drive the EnemySystem.tickEnemies path with pre-applied
// statusEffects so the DoT accumulator + regen block execute exactly
// as they would in-game, then assert on the HP delta. CC-amp is
// behaviourally inside CombatResolver.ts; we smoke-test the source
// here (the full damage chain has no existing unit harness; if this
// becomes flaky a future refactor can pull the amp into a pure helper).
//
// Enemy choice: FERAL_DOG is used as the workhorse target because it
// has NO BURN/BLEED resistance — the BURN tick lands at 1.0× status
// effectiveness so the cap math isolates cleanly from the per-enemy
// resistance system. POISON has FERAL_DOG resist (0.85) so when a
// poison source is used the test explicitly accounts for it.

import { describe, it, expect, beforeAll } from 'vitest';
import { createGameState } from '../src/GameState';
import { tickEnemies } from '../src/systems/EnemySystem';
import { Enemy, EnemyFaction, EnemyType, StatusEffectKind } from '../src/types';

// tickEnemies' DoT-floating-number block reads `window.__gore` and
// `window.__emitFloatingNumber`. Both are absent in the Node test
// environment (vitest config: `environment: 'node'`), and the bare
// `window` reference itself throws ReferenceError. Stub a minimal
// global window so the access succeeds and the guarded `if (gore &&
// emit)` short-circuits cleanly. The DoT damage math is fully
// upstream of this block, so the stub does not affect assertions.
beforeAll(() => {
  if (typeof (globalThis as any).window === 'undefined') {
    (globalThis as any).window = {};
  }
});

function makeEnemy(type: EnemyType, faction: EnemyFaction, maxHp: number, isBoss = false): Enemy {
  return {
    id: 't' + Math.random().toString(36).slice(2, 7),
    type, faction,
    hp: maxHp, maxHp,
    baseSpeed: 0, currentSpeed: 0,
    isFlyer: false,
    x: 320, y: 320,
    pathIndex: 0, pathProgress: 0,
    statusEffects: [],
    hasFeared: false, livesCost: 1, isBoss, reward: 0,
    archetype: 'SWARM',
    hpFlashTimer: 0,
    lastDamagedTick: -999     // OOC quiet-window already passed
  } as Enemy;
}

function setStatus(e: Enemy, kind: StatusEffectKind, magnitude: number, remaining = 10) {
  e.statusEffects.push({ kind, magnitude, remaining, sourceTier: 1 } as any);
}

describe('B1 — DoT aggregate cap (7% maxHp/sec) + HELLFIRE sub-cap (2%/sec)', () => {
  // 2026-06-29 — caps RAISED (4% → 7% aggregate, 1% → 2% Hellfire) to revive
  // the fire/poison DoT archetype so a 2nd-3rd DoT tower scales meaningfully.
  it('single BURN at 3%/sec ticks at full rate (under cap)', () => {
    const s = createGameState();
    const e = makeEnemy(EnemyType.FERAL_DOG, EnemyFaction.DOGS, 1000);
    setStatus(e, StatusEffectKind.BURN, 0.03);
    s.enemies.set(e.id, e);
    tickEnemies(s, 1.0, () => {}, () => {});
    // 3% of 1000 = 30 over 1 second. FERAL_DOG has no burn resist.
    expect(e.hp).toBeGreaterThan(1000 - 31);
    expect(e.hp).toBeLessThan(1000 - 29);
  });

  it('stacked DoTs at 14% raw are clamped to 7% maxHp/sec aggregate', () => {
    // 6% BURN + 6% POISON + 1% BLEED + 1% HELLFIRE = 14% raw stacking.
    // After cap: 7%/sec = 70 HP/sec on a 1000-HP enemy.
    const s = createGameState();
    const e = makeEnemy(EnemyType.FERAL_DOG, EnemyFaction.DOGS, 1000);
    setStatus(e, StatusEffectKind.BURN,     0.06);
    setStatus(e, StatusEffectKind.POISON,   0.06);
    setStatus(e, StatusEffectKind.BLEED,    0.01);
    setStatus(e, StatusEffectKind.HELLFIRE, 0.01);
    s.enemies.set(e.id, e);
    tickEnemies(s, 1.0, () => {}, () => {});
    expect(e.hp).toBeGreaterThan(1000 - 71);
    expect(e.hp).toBeLessThan(1000 - 69);
  });

  it('lone HELLFIRE 5%/sec is clamped to 2%/sec sub-cap', () => {
    const s = createGameState();
    const e = makeEnemy(EnemyType.FERAL_DOG, EnemyFaction.DOGS, 1000);
    setStatus(e, StatusEffectKind.HELLFIRE, 0.05);
    s.enemies.set(e.id, e);
    tickEnemies(s, 1.0, () => {}, () => {});
    // Hellfire sub-cap = 20 HP/sec on a 1000-HP enemy (2% of maxHp).
    expect(e.hp).toBeGreaterThan(1000 - 21);
    expect(e.hp).toBeLessThan(1000 - 19);
  });

  it('two BURN sources at 1.5% each stack additively to 3% (below cap)', () => {
    // Two BURN statuses both land at full FERAL_DOG effectiveness (1.0).
    // Total = 3% well under the 4% cap, so no clamp fires.
    const s = createGameState();
    const e = makeEnemy(EnemyType.FERAL_DOG, EnemyFaction.DOGS, 1000);
    setStatus(e, StatusEffectKind.BURN, 0.015);
    setStatus(e, StatusEffectKind.BURN, 0.015);
    s.enemies.set(e.id, e);
    tickEnemies(s, 1.0, () => {}, () => {});
    expect(e.hp).toBeGreaterThan(1000 - 31);
    expect(e.hp).toBeLessThan(1000 - 29);
  });

  it('aggregate cap binds even when HELLFIRE is at exactly 2% (sub-cap pass-through)', () => {
    // Hellfire 2% (right at the sub-cap) + Burn 6% (above aggregate
    // alone) → raw 8%. Aggregate cap = 7%. After cap: 70 HP/sec.
    const s = createGameState();
    const e = makeEnemy(EnemyType.FERAL_DOG, EnemyFaction.DOGS, 1000);
    setStatus(e, StatusEffectKind.HELLFIRE, 0.02);
    setStatus(e, StatusEffectKind.BURN,     0.06);
    s.enemies.set(e.id, e);
    tickEnemies(s, 1.0, () => {}, () => {});
    expect(e.hp).toBeGreaterThan(1000 - 71);
    expect(e.hp).toBeLessThan(1000 - 69);
  });
});

describe('B2 — DoT-suppresses-regen softening (100% → 50%)', () => {
  it('regen ticks at FULL rate when no DoT is active', () => {
    // Use FERAL_DOG with a synthetic OOC regen override so the math
    // is independent of any boss/DoT-resist interaction. lastDamagedTick
    // is pinned to -999 in makeEnemy so the 0.5s quiet-window has
    // already elapsed and OOC regen is allowed to fire.
    const s = createGameState();
    const e = makeEnemy(EnemyType.FERAL_DOG, EnemyFaction.DOGS, 1000);
    e.hp = 500;
    (e as any).outOfCombatRegen = 0.05;     // 5%/sec synthetic OOC regen
    s.enemies.set(e.id, e);
    tickEnemies(s, 1.0, () => {}, () => {});
    // Authored 5% × global 0.8 = 40 HP regen per second. No DoT
    // present, no recent direct damage → regenMult = 1.0.
    expect(e.hp).toBeGreaterThan(500 + 39);
    expect(e.hp).toBeLessThan(500 + 41);
  });

  it('regen ticks at HALF rate when a DoT is active (~25 HP/sec heal vs 50)', () => {
    const s = createGameState();
    const e = makeEnemy(EnemyType.FERAL_DOG, EnemyFaction.DOGS, 1000);
    e.hp = 500;
    (e as any).outOfCombatRegen = 0.05;     // 5%/sec OOC regen
    setStatus(e, StatusEffectKind.BURN, 0.03);   // 3%/sec BURN = 30 HP/sec damage
    s.enemies.set(e.id, e);
    tickEnemies(s, 1.0, () => {}, () => {});
    // Expected math:
    //   DoT damage = 3% × 1000 = 30 HP/sec
    //   Regen at half = 5% × 0.8 × 0.5 × 1000 = 20 HP/sec
    //   Net = 30 - 20 = -10 HP/sec (enemy loses 10 HP)
    // Under the OLD 100% suppression rule, net would be -30 (full DoT, no regen).
    // Under no suppression, net would be +20 (full regen wins).
    // 50% suppression lands cleanly in the middle.
    expect(e.hp).toBeGreaterThan(500 - 12);     // Allow tolerance for float drift
    expect(e.hp).toBeLessThan(500 - 8);
  });

  it('the DoT alone is not enough to overcome strong regen (DoT + direct damage required)', () => {
    // Mirror of the design intent: applying a single DoT to a heavy-
    // regen enemy should NO LONGER fully shut down its healing. Strong
    // regen (10%) vs weak DoT (2%) under 50% suppression: regen still
    // wins. Player needs to add direct damage to actually break the
    // enemy. This is the core gameplay shift the change delivers.
    const s = createGameState();
    const e = makeEnemy(EnemyType.FERAL_DOG, EnemyFaction.DOGS, 1000);
    e.hp = 500;
    (e as any).outOfCombatRegen = 0.10;     // 10%/sec OOC regen — strong
    setStatus(e, StatusEffectKind.BURN, 0.02);   // 2%/sec BURN = 20 HP/sec damage
    s.enemies.set(e.id, e);
    tickEnemies(s, 1.0, () => {}, () => {});
    // DoT damage = 20 HP/sec. Regen = 10% × 0.8 × 0.5 × 1000 = 40 HP/sec.
    // Net = +20 HP/sec (enemy heals despite DoT ticking).
    // Under the OLD 100% suppression rule this would be -20 (DoT-only
    // wins). The point is: DoT alone is no longer a hard counter.
    expect(e.hp).toBeGreaterThan(500 + 15);
    expect(e.hp).toBeLessThan(500 + 25);
  });

  it('DoT no longer refreshes lastDamagedTick (OOC quiet-window opens with DoT-only attack)', () => {
    // The 2026-05-21 change relies on DoT ticks NOT refreshing
    // lastDamagedTick. If they did, the OOC quiet-window would
    // never pass during DoT and OOC regen would be silently locked
    // at 0% — defeating the 50% suppression intent entirely.
    // Verify: after a DoT-only tick, lastDamagedTick is still its
    // pre-tick value (no refresh), and OOC regen flowed.
    const s = createGameState();
    const e = makeEnemy(EnemyType.FERAL_DOG, EnemyFaction.DOGS, 1000);
    e.hp = 500;
    (e as any).outOfCombatRegen = 0.04;
    setStatus(e, StatusEffectKind.BURN, 0.02);
    s.enemies.set(e.id, e);
    const lastDamagedBefore = e.lastDamagedTick;
    tickEnemies(s, 1.0, () => {}, () => {});
    // lastDamagedTick should NOT have been refreshed by the DoT tick.
    expect(e.lastDamagedTick).toBe(lastDamagedBefore);
    // And the net HP change should reflect regen actually flowing
    // (50% × 4% × global 0.8 = 1.6%/sec heal) minus 2% DoT = -4 HP.
    // Not strict equality due to float math, but should be near 500.
    expect(e.hp).toBeGreaterThan(500 - 5);
    expect(e.hp).toBeLessThan(500 + 5);
  });
});

describe('B3 — FREEZE / STUN direct-damage amp source presence', () => {
  // The amp is implemented inside CombatResolver.tickCombat's damage
  // chain. The full chain requires Tower + State + projectile setup
  // that's expensive to scaffold here. Per the feature_audit pattern,
  // verify the source code carries the expected logic + magnitudes.
  it('CombatResolver.ts contains the FREEZE/STUN amp block with 10% magnitudes', () => {
    const fs = require('fs');
    const cr = fs.readFileSync('src/systems/CombatResolver.ts', 'utf8');
    // ccAmp should be initialized, then bumped 0.10 per matching status.
    expect(cr).toMatch(/let ccAmp = 0/);
    expect(cr).toMatch(/StatusEffectKind\.FREEZE.*?ccAmp \+= 0\.10/s);
    expect(cr).toMatch(/StatusEffectKind\.STUN.*?ccAmp \+= 0\.10/s);
    // The amp should multiply damage when ccAmp > 0.
    expect(cr).toMatch(/if \(ccAmp > 0\) damage \*= \(1 \+ ccAmp\)/);
  });

  it('amp insertion is AFTER the MARK multiplier so it stacks multiplicatively with marks', () => {
    const fs = require('fs');
    const cr = fs.readFileSync('src/systems/CombatResolver.ts', 'utf8');
    // Verify ordering: MARK debuff line comes before the ccAmp block.
    const markIdx = cr.indexOf('damage *= 1 + markS.magnitude');
    const ccAmpIdx = cr.indexOf('let ccAmp = 0');
    expect(markIdx).toBeGreaterThan(0);
    expect(ccAmpIdx).toBeGreaterThan(markIdx);
  });

  it('DoT path stays separate (no CombatResolver ccAmp reference in EnemySystem dotDps block)', () => {
    // The amp should NOT exist in the DoT tick path. DoT ticks live
    // in EnemySystem.ts and apply via `e.hp -= dotDps * dt` with no
    // reference to FREEZE/STUN. This guards against future
    // accidental amp leakage into the DoT pipeline.
    const fs = require('fs');
    const es = fs.readFileSync('src/systems/EnemySystem.ts', 'utf8');
    const dotApplyIdx = es.indexOf('e.hp -= dotDps * dt');
    expect(dotApplyIdx).toBeGreaterThan(0);
    expect(es).not.toMatch(/ccAmp/);
  });
});
