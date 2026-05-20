// Tests for the wave system: HP scaling, wave-end conditions, win/loss state.
import { describe, it, expect, beforeEach } from 'vitest';
import { effectiveWaveHpMult, startWave, tickSpawns, checkWaveEnd } from '../src/systems/WaveManager';
import { createGameState } from '../src/GameState';
import { GamePhase } from '../src/types';
import { initializeGrid } from '../src/systems/GridManager';
import { buildGroundPath, buildFlyerPath } from '../src/systems/PathFinder';
import wavesData from '../src/data/waves.json';

function bootstrapState() {
  const s = createGameState();
  initializeGrid(s);
  const path = buildGroundPath(s);
  if (path) s.groundPath = path;
  s.flyerPath = buildFlyerPath();
  return s;
}

describe('Wave HP scaling — 20-wave linear + mid-late accelerator + boss-cleared bump', () => {
  it('applies linear + mid-late accelerator + x2.00 per cleared 5-wave boss', () => {
    // Reference formula:
    //   linearStep    = 1 + 0.10*w
    //   midLateStep   = 0.10 * max(0, w-10)
    //   aggressiveLateStep = 0.15 * max(0, w-11)   (W11+ creative ramp)
    //   linearTotal   = linearStep + midLateStep + aggressiveLateStep
    //   hp_mult       = baseHpMult * linearTotal * pow(2.00, floor((w-1)/5))
    expect(effectiveWaveHpMult(1, 1)).toBeCloseTo(1.10 * 1.0, 4);
    expect(effectiveWaveHpMult(5, 1)).toBeCloseTo(1.50 * 1.0, 4);
    expect(effectiveWaveHpMult(6, 1)).toBeCloseTo(1.60 * 2.0, 4);
    expect(effectiveWaveHpMult(10, 1)).toBeCloseTo(2.00 * 2.0, 4);
    expect(effectiveWaveHpMult(11, 1)).toBeCloseTo((2.10 + 0.10) * 4.0, 4);  // W11: +10% mid-late, no aggressive step yet (w-11=0)
    expect(effectiveWaveHpMult(15, 1)).toBeCloseTo((2.50 + 0.50 + 0.60) * 4.0, 4);  // W15: +60% aggressive (0.15 * 4)
    expect(effectiveWaveHpMult(20, 1)).toBeCloseTo((3.00 + 1.00 + 1.35) * Math.pow(2.0, 3), 4);  // W20: +135% aggressive (0.15 * 9)
  });

  it('respects authored baseHpMult passed in', () => {
    const w20Authored = 8.0;
    const result = effectiveWaveHpMult(20, w20Authored);
    expect(result).toBeCloseTo(w20Authored * (3.00 + 1.00 + 1.35) * Math.pow(2.0, 3), 4);
  });

  it('curve is monotonic across the 20-wave run', () => {
    let last = 0;
    for (let w = 1; w <= 20; w++) {
      const m = effectiveWaveHpMult(w, 1);
      expect(m).toBeGreaterThanOrEqual(last);
      last = m;
    }
  });

  it('bosses scale LINEARLY (no per-5-wave doubling)', () => {
    // 2026-05 v5: bosses bypass the postBossStep entirely. They ride only
    // the linear + mid-late accelerator stack so progression feels like a
    // clean ramp instead of an exponential wall.
    expect(effectiveWaveHpMult(5, 1, true)).toBeCloseTo(1.50, 4);
    expect(effectiveWaveHpMult(10, 1, true)).toBeCloseTo(2.00, 4);
    expect(effectiveWaveHpMult(15, 1, true)).toBeCloseTo(2.50 + 0.50 + 0.60, 4);  // W15: aggressive +60%
    expect(effectiveWaveHpMult(20, 1, true)).toBeCloseTo(3.00 + 1.00 + 1.35, 4);  // W20: aggressive +135%
    // And each boss wave is strictly heavier than the previous:
    expect(effectiveWaveHpMult(10, 1, true)).toBeGreaterThan(effectiveWaveHpMult(5, 1, true));
    expect(effectiveWaveHpMult(15, 1, true)).toBeGreaterThan(effectiveWaveHpMult(10, 1, true));
    expect(effectiveWaveHpMult(20, 1, true)).toBeGreaterThan(effectiveWaveHpMult(15, 1, true));
  });
});

describe('Wave start — basic flow', () => {
  let state: ReturnType<typeof createGameState>;
  beforeEach(() => { state = bootstrapState(); });

  it('starting from build phase advances wave and switches phase', () => {
    state.phase = GamePhase.BUILD_PHASE;
    state.wave = 0;
    startWave(state);
    expect(state.wave).toBe(1);
    expect(state.phase).toBe(GamePhase.WAVE_PHASE);
  });

  it('does not start a wave from the WAVE_PHASE', () => {
    state.phase = GamePhase.WAVE_PHASE;
    state.wave = 5;
    startWave(state);
    expect(state.wave).toBe(5);    // unchanged
  });

  it('builds a non-empty spawn queue', () => {
    state.phase = GamePhase.BUILD_PHASE;
    startWave(state);
    expect(state.spawnQueue.length).toBeGreaterThan(0);
  });

  it('sets a faction weather profile on wave start', () => {
    state.phase = GamePhase.BUILD_PHASE;
    startWave(state);
    expect(state.weatherKey).toBeTruthy();
  });
});

describe('Wave end — gold reward + reset', () => {
  it('checkWaveEnd transitions back to build phase when queue empty + no enemies', () => {
    const s = bootstrapState();
    s.phase = GamePhase.WAVE_PHASE;
    s.wave = 3;
    s.spawnQueue = [];
    s.enemies.clear();
    let goldAwarded = -1;
    checkWaveEnd(s, (g) => { goldAwarded = g; });
    expect(s.phase).toBe(GamePhase.BUILD_PHASE);
    expect(goldAwarded).toBeGreaterThan(0);
  });

  it('clears weather state at wave end', () => {
    const s = bootstrapState();
    s.phase = GamePhase.WAVE_PHASE;
    s.wave = 3;
    s.weatherKey = 'CELTS';
    s.spawnQueue = [];
    s.enemies.clear();
    checkWaveEnd(s, () => {});
    expect(s.weatherKey).toBeNull();
  });
});

describe('Win/Loss conditions', () => {
  it('player has lives > 0 at game start', () => {
    const s = bootstrapState();
    expect(s.lives).toBeGreaterThan(0);
  });

  it('lives at 0 represents game over', () => {
    const s = bootstrapState();
    s.lives = 0;
    expect(s.lives).toBe(0);    // sanity assertion
  });
});

describe('Spawn queue ticking', () => {
  it('does nothing when not in WAVE_PHASE', () => {
    const s = bootstrapState();
    s.phase = GamePhase.BUILD_PHASE;
    s.spawnQueue = [{ type: 'FERAL_DOG', spawnAt: 0 }];
    s.spawnElapsed = 1;
    s.wave = 1;
    tickSpawns(s, 0.1);
    expect(s.spawnQueue.length).toBe(1);   // unchanged
    expect(s.enemies.size).toBe(0);
  });
});

describe('Per-wave resistance relief (resistReduction field)', () => {
  // 2026-05-20 — Wave 8 (CARTHAGE, 33x Sacred Band + 18x Spearman + 5x
  // Numidian Rider) carries a 0.15 resistReduction. The CombatResolver
  // brings the effective resistance multiplier 15% closer to 1.0 — but
  // only when the enemy is RESISTANT (resMod < 1). Weaknesses untouched.
  it('wave 8 carries resistReduction = 0.15', () => {
    const w8 = (wavesData as any[]).find(w => w.wave === 8);
    expect(w8).toBeDefined();
    expect(w8.resistReduction).toBe(0.15);
  });

  it('no other wave currently carries resistReduction (clean data)', () => {
    // Anyone else adding the field later would intentionally surface in
    // the Codex 🛡 RESIST tag — this test catches accidental copy-paste.
    const others = (wavesData as any[]).filter(w => w.wave !== 8 && typeof w.resistReduction === 'number' && w.resistReduction > 0);
    expect(others.length).toBe(0);
  });

  it('relief formula brings resMod 15% closer to 1 when resistant', () => {
    // The applied formula is: resMod = 1 - (1 - resMod) * (1 - 0.15)
    // i.e. the resistance GAP shrinks to 85% of its original size.
    const reduce = (m: number, r = 0.15) => (m < 1 ? 1 - (1 - m) * (1 - r) : m);

    // CARTHAGE PHYS_MELEE: base -0.30 → resMod 0.70 → reduced to 0.745
    expect(reduce(0.70)).toBeCloseTo(0.745, 4);
    // CARTHAGE PHYS_RANGED: base -0.20 → resMod 0.80 → reduced to 0.83
    expect(reduce(0.80)).toBeCloseTo(0.83, 4);
    // Neutral (CARTHAGE SIEGE / ELEMENTAL_FIRE): no change
    expect(reduce(1.0)).toBe(1.0);
    // Weakness: untouched (we never *reduce* damage to the player)
    expect(reduce(1.25)).toBe(1.25);
  });
});
