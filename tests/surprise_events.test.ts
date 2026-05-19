// Surprise event spawn-redirect guards.
//
// Locks in the W14 instant-death bug fix (2026-05-19): flyer enemies
// MUST NOT be redirected to the urn / perimeter ground-path index by
// Uprising / Invasion events. If they are, the flyer's pathIndex
// (resolved against state.groundPath) gets applied against the much
// shorter state.flyerPath in the EnemySystem move loop, which trips
// the gate-leak check on the very first tick — every flyer leaks
// INSTANTLY on spawn, draining lives before any combat happens.
//
// W14 has 8 SPECTRAL_SCOUTs as part of the wave. Before the guard,
// all 8 leaked on spawn AND the 27 UNDEAD_CELTs reanimated/rebirthed
// cascade pushed the player to 0 lives without a fair shot.
import { describe, it, expect } from 'vitest';
import { spawnAtSurpriseEventPoint } from '../src/systems/SurpriseEvents';
import { SurpriseEventKind } from '../src/types';
import { createGameState } from '../src/GameState';
import { GRID } from '../src/constants';

function makeState() {
  const s: any = createGameState();
  // Fake a ground path of 50 tiles so the surprise event redirect
  // would assign large pathIndex values to anything redirected.
  s.groundPath = Array.from({ length: 50 }, (_, i) => ({
    col: 5 + (i % 10), row: 5 + Math.floor(i / 10)
  }));
  // Fake a flyer path of only 12 tiles — typical for direct
  // cave→gate flight that doesn't follow the maze.
  s.flyerPath = Array.from({ length: 12 }, (_, i) => ({
    x: i * GRID.TILE + GRID.TILE / 2,
    y: 100
  }));
  // Activate an Uprising event in waveOverride mode with 4 urn points.
  s.activeSurpriseEvent = {
    kind: SurpriseEventKind.UPRISING,
    waveOverride: true,
    spawnPoints: [0, 1, 2, 3].map(i => ({
      vfxX: 100 + i * 50, vfxY: 200,
      pathTileX: 0, pathTileY: 0,
      pathIndex: 30,   // a ground-path index that would exceed flyerPath.length-1
      spawnAt: 0,
      enemyType: '',
      fired: false,
      pointId: i,
    })),
    spawnedEnemyIds: new Set(),
    lastSpawnFiredAt: 0,
    vfxFadeOutAt: 0,
  };
  return s;
}

function fakeEnemy(opts: { isFlyer: boolean }) {
  return {
    id: `e-${Math.random()}`, type: 'CELTIC_FOOTMAN',
    x: 0, y: 0, prevX: 0, prevY: 0,
    pathIndex: 0, pathProgress: 0,
    isFlyer: opts.isFlyer,
    baseSpeed: 1, currentSpeed: 1,
    statusEffects: [],
  };
}

describe('Surprise event spawn redirect — flyer guard (2026-05-19)', () => {
  it('flyer enemies are NOT redirected (returns false, state unchanged)', () => {
    const s = makeState();
    const flyer = fakeEnemy({ isFlyer: true });
    const beforeX = flyer.x;
    const beforePathIdx = flyer.pathIndex;
    const ok = spawnAtSurpriseEventPoint(s, flyer, 0);
    expect(ok).toBe(false);
    // The redirect didn't run — flyer state stays untouched.
    expect(flyer.x).toBe(beforeX);
    expect(flyer.pathIndex).toBe(beforePathIdx);
    // Crucially, the flyer's pathIndex was NOT set to a ground-path
    // index that would exceed flyerPath.length-1 (12) and cause an
    // instant leak.
    expect(flyer.pathIndex).toBeLessThan(s.flyerPath.length - 1);
  });

  it('ground enemies ARE redirected normally', () => {
    const s = makeState();
    const ground = fakeEnemy({ isFlyer: false });
    const ok = spawnAtSurpriseEventPoint(s, ground, 0);
    expect(ok).toBe(true);
    // The redirect did run — pathIndex pinned to the urn's path entry.
    expect(ground.pathIndex).toBe(30);
  });

  it('the guard catches ALL queue indices for flyers (not just idx 0)', () => {
    const s = makeState();
    for (let i = 0; i < 12; i++) {
      const flyer = fakeEnemy({ isFlyer: true });
      const ok = spawnAtSurpriseEventPoint(s, flyer, i);
      expect(ok, `queueIdx ${i} should reject`).toBe(false);
      expect(flyer.pathIndex).toBe(0);
    }
  });
});
