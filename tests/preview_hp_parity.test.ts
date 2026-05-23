// Preview-HP parity tests — locks the wave-preview chip's enemy-inspect
// modal HP value to the ACTUAL spawn HP the game produces in tickSpawns.
// Previously the chip showed raw baseHp (so W15 Undead Warlord looked like
// a 2k-HP pushover when he actually spawns at ~121k); after the 2026-05 v8
// fix, `previewSpawnHp` mirrors the canonical formula. These tests walk
// every authored (enemy × wave) combo and verify both sides agree.
import { describe, it, expect, beforeAll } from 'vitest';
import {
  effectiveWaveHpMult,
  lateGameLayerMult,
  previewSpawnHp,
  startWave,
  tickSpawns
} from '../src/systems/WaveManager';

// EnemySystem.spawnEnemy reaches into `window.__renderer` for the spawn
// puff VFX. Vitest runs in Node, so we stub the global before any test
// fires. The renderer hook is a no-op shim — we only care about HP math.
beforeAll(() => {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (globalThis as any).window.__renderer = { triggerSpawnPuff: () => {} };
});
import { createGameState } from '../src/GameState';
import { GamePhase } from '../src/types';
import { initializeGrid } from '../src/systems/GridManager';
import { buildGroundPath, buildFlyerPath } from '../src/systems/PathFinder';
import wavesData from '../src/data/waves.json';
import enemiesData from '../src/data/enemies.json';

function bootstrapState() {
  const s = createGameState();
  initializeGrid(s);
  const path = buildGroundPath(s);
  if (path) s.groundPath = path;
  s.flyerPath = buildFlyerPath();
  return s;
}

// Drive the game to wave N (so state.wave === N) and drain every spawn.
// Returns the list of enemies spawned during that wave.
function runWaveAndCollect(targetWave: number) {
  const s = bootstrapState();
  // Disable random RNG-driven modifiers/twins so spawn HP is deterministic
  // for the parity test. The preview can't know the Blood-Moon roll, so we
  // need to make sure the game state under test doesn't roll one either.
  (s as any).bloodMoonHpMult = 1;
  // Walk waves 1..targetWave. checkWaveEnd transitions back to BUILD_PHASE
  // after each finishes, so we just call startWave + drain spawnQueue.
  for (let w = 1; w <= targetWave; w++) {
    startWave(s);
    // Force-disable any rolled modifier so HP isn't perturbed.
    (s as any).bloodMoonHpMult = 1;
    // Drain the spawn queue in one tick. tickSpawns consumes entries
    // whose spawnAt <= elapsed; setting a huge dt guarantees we burn them
    // all in one shot.
    tickSpawns(s, 1e6);
    if (w < targetWave) {
      // Clear enemies so the next wave starts clean — we only care about
      // the spawn HP, not the lifecycle, so wiping the live set is safe.
      s.enemies.clear();
      // Manually flip back to build phase since we're not running the
      // full wave-end pipeline.
      s.phase = GamePhase.BUILD_PHASE;
    }
  }
  return s;
}

describe('previewSpawnHp parity with actual tickSpawns spawn HP', () => {
  // The big sweep — for every wave, for every spawn group listed in
  // waves.json, confirm previewSpawnHp matches the actual spawned maxHp.
  // Boss waves strip non-boss spawns in the runtime; the preview helper
  // should NOT be called for those (the chip already filters them out),
  // so we mirror that filter here.
  for (let waveNum = 1; waveNum <= 20; waveNum++) {
    const w: any = (wavesData as any[])[waveNum - 1];
    if (!w) continue;
    const isBossWave = w.type === 'B';
    for (const grp of w.spawns) {
      const def: any = (enemiesData as any)[grp.type];
      if (!def) continue;
      if (isBossWave && !def.isBoss) continue;       // stripped at runtime
      it(`W${waveNum} ${grp.type}: previewSpawnHp matches in-game spawn maxHp`, () => {
        const s = runWaveAndCollect(waveNum);
        // From W10 onward, spawnEnemy rolls an elite mutation (Veteran
        // +50% HP, Bloated +120% HP, etc) at ~4-20% chance per spawn. The
        // preview can't know which mutation will roll, so we only assert
        // parity on NON-mutated samples. If the entire group happened to
        // roll a mutation (vanishingly rare even with N=1), we re-spawn
        // up to 6 times until we find a clean sample.
        let cleanSample: any = null;
        for (let attempt = 0; attempt < 6 && !cleanSample; attempt++) {
          const st = attempt === 0 ? s : runWaveAndCollect(waveNum);
          cleanSample = Array.from(st.enemies.values()).find(
            (e: any) => e.type === grp.type && !e.mutation
          );
        }
        expect(cleanSample, `expected at least one non-elite ${grp.type} to spawn on W${waveNum} within 6 attempts`).toBeTruthy();
        const actual = Math.round((cleanSample as any).maxHp);
        const preview = previewSpawnHp(def, waveNum, w.type, w.hpMult);
        expect(preview).toBe(actual);
      });
    }
  }
});

describe('previewSpawnHp formula spot-checks', () => {
  // 2026-05-23 — W1 pin bumped from 100 HP (no hero) / 115 HP (hero) to
  // 300 HP / 350 HP per user feedback that the calibration wave felt
  // trivially easy.
  it('W1 pins every enemy to 300 HP regardless of baseHp (no hero drafted)', () => {
    const dog: any = (enemiesData as any).FERAL_DOG;
    expect(previewSpawnHp(dog, 1, 'G', 1.0)).toBe(300);
  });

  it('W15 Undead Warlord = baseHp × hpMult × aggressive linear × 2.0 solo × W10+1.25 × W11+1.40 boss layers', () => {
    const def: any = (enemiesData as any).UNDEAD_WARLORD;
    // Linear at W15: 1 + 0.10*15 + 0.10*5 (>W10) + 0.15*4 (>W11) = 3.60
    // Layer: W10 boss 1.25 × W11 boss 1.40 = 1.75
    // 2020 × (8.0 × 3.60) × 2.0 solo × 1.75 = 203,616
    const expected = Math.round(def.baseHp * 8.0 * 3.60 * 2.0 * 1.75);
    expect(previewSpawnHp(def, 15, 'B', 8.0)).toBe(expected);
    expect(previewSpawnHp(def, 15, 'B', 8.0)).toBeGreaterThan(150_000);
  });

  it('W20 Daemon Imperator (100M baseHp) scales to billions at endgame', () => {
    const def: any = (enemiesData as any).DAEMON_IMPERATOR;
    const hp = previewSpawnHp(def, 20, 'B', 6.0);
    // 100M baseHp × (6.0 × linear stack) × 2.0 solo × boss layers × 1.20 post-W15
    // Confirms the new HP target is in the billions, not millions.
    expect(hp).toBeGreaterThan(1_000_000_000);
  });

  it('W10 Hannibal Barca solo boss scales by hpMult × linear × 2.0 solo (NO layer yet)', () => {
    const def: any = (enemiesData as any).HANNIBAL_BARCA;
    const w10: any = (wavesData as any[])[9];
    // W10 boss layer: wave>10 false (10 is not >10) → layer = 1.0
    const expected = Math.round(def.baseHp * w10.hpMult * (1 + 0.10 * 10) * 2.0 * 1.0);
    expect(previewSpawnHp(def, 10, w10.type, w10.hpMult)).toBe(expected);
  });

  it('Post-W7 ground mob gets +30% HP layer (2026-05 v9 — was post-W8 +20%)', () => {
    expect(lateGameLayerMult(8, false, false)).toBeCloseTo(1.30, 4);   // W8 now gets the bump
    expect(lateGameLayerMult(9, false, false)).toBeCloseTo(1.30, 4);
    expect(lateGameLayerMult(7, false, false)).toBeCloseTo(1.00, 4);   // W7 unchanged
  });

  it('Post-W10 layer differs by class: ground 1.50, flyer 1.20, boss 1.25 (compounded w/ post-W7 for ground)', () => {
    expect(lateGameLayerMult(11, false, false)).toBeCloseTo(1.30 * 1.50, 4); // post-W7 ground + post-W10 ground
    expect(lateGameLayerMult(11, false, true)).toBeCloseTo(1.20, 4);          // flyer only (post-W10)
    expect(lateGameLayerMult(11, true, false)).toBeCloseTo(1.25, 4);          // boss only (post-W10)
  });

  it('Post-W15 layer adds ×1.20 to every class on top of the W11+ creative buff', () => {
    // W16 ground: W7 1.30 × W10 ground 1.50 × W11 ground 1.30 × W15 1.20 = 3.042
    expect(lateGameLayerMult(16, false, false)).toBeCloseTo(1.30 * 1.50 * 1.30 * 1.20, 4);
    // W16 boss: W10 boss 1.25 × W11 boss 1.40 × W15 1.20 = 2.10
    expect(lateGameLayerMult(16, true, false)).toBeCloseTo(1.25 * 1.40 * 1.20, 4);
  });

  it('effectiveWaveHpMult linear curve includes the W11+ aggressive +15%/wave step', () => {
    expect(effectiveWaveHpMult(1, 1)).toBeCloseTo(1.10, 4);
    // W20 basic: 1+0.10*20 + 0.10*10 (>W10) + 0.15*9 (>W11) = 5.35, ×8.0 doubling
    expect(effectiveWaveHpMult(20, 1)).toBeCloseTo(5.35 * 8.0, 4);
    // W20 boss: 5.35 (no doubling)
    expect(effectiveWaveHpMult(20, 1, true)).toBeCloseTo(5.35, 4);
  });
});
