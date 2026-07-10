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
import { deadUprisingTitanTypesForWave, GATES_OF_HELL_MIN_HEALTH, maybeTriggerSurpriseEventForWave, SURPRISE_EVENT_SCHEDULE, spawnAtSurpriseEventPoint, surpriseEventHpMult, tickSurpriseEvents } from '../src/systems/SurpriseEvents';
import { EnemyType, SurpriseEventKind, TileType, TowerType } from '../src/types';
import { createGameState } from '../src/GameState';
import { GRID } from '../src/constants';
import { initializeGrid } from '../src/systems/GridManager';
import { buildGroundPath } from '../src/systems/PathFinder';
import { createTower } from '../src/systems/TowerSystem';
import { spawnEnemy, tickEnemies } from '../src/systems/EnemySystem';
import waypointsData from '../src/data/waypoints.json';
import enemiesData from '../src/data/enemies.json';

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

function makeEventState(wave: number) {
  const s = createGameState();
  initializeGrid(s);
  s.wave = wave;
  s.tick = 0;
  s.groundPath = buildGroundPath(s) ?? [];
  return s;
}

function blockTowerTile(s: any, type: TowerType, col: number, row: number) {
  const t = createTower(type, 1, col, row, s.wave);
  s.towers.set(t.id, t);
  s.tiles[row][col] = TileType.TOWER;
  return t;
}

function assertEventPointsAvoidPlayerTiles(s: any) {
  const ev = s.activeSurpriseEvent;
  expect(ev).toBeTruthy();
  for (const point of ev.spawnPoints) {
    const col = Math.floor(point.vfxX / GRID.TILE);
    const row = Math.floor(point.vfxY / GRID.TILE);
    expect(s.tiles[row]?.[col], `event point ${col},${row}`).toBe(TileType.EMPTY);
    for (const tower of s.towers.values()) {
      expect(`${col},${row}`).not.toBe(`${tower.tileX},${tower.tileY}`);
    }
  }
  for (const prop of ev.atmosProps ?? []) {
    const col = Math.floor(prop.x / GRID.TILE);
    const row = Math.floor(prop.y / GRID.TILE);
    expect(s.tiles[row]?.[col], `atmos prop ${col},${row}`).toBe(TileType.EMPTY);
  }
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
    const ground = { ...fakeEnemy({ isFlyer: false }), hp: 1000, maxHp: 1000 };
    const ok = spawnAtSurpriseEventPoint(s, ground, 0);
    expect(ok).toBe(true);
    // The redirect did run — pathIndex pinned to the urn's path entry.
    expect(ground.pathIndex).toBe(30);
    expect(ground.maxHp).toBeCloseTo(1650, 4);
    expect(ground.hp).toBeCloseTo(1650, 4);
  });

  it('event enemies get stronger HP profiles by event type', () => {
    expect(surpriseEventHpMult(SurpriseEventKind.INVASION)).toBeCloseTo(1.50, 4);
    expect(surpriseEventHpMult(SurpriseEventKind.UPRISING)).toBeCloseTo(1.65, 4);
    expect(surpriseEventHpMult(SurpriseEventKind.GATES_OF_HELL)).toBeCloseTo(1.35, 4);
  });

  it('keeps Gates of Hell structures and Fire Giants above the 2M health floor', () => {
    for (const type of [EnemyType.HELL_GATE, EnemyType.FIRE_GIANT]) {
      const def = (enemiesData as any)[type];
      expect(def.baseHp, `${type} keeps scalable event base HP`).toBeLessThan(GATES_OF_HELL_MIN_HEALTH);
      expect(def.skipMutation, `${type} should remain deterministic`).toBe(true);

      const s: any = makeEventState(16);
      s.activeSurpriseEvent = {
        kind: SurpriseEventKind.GATES_OF_HELL,
        waveOverride: false,
        spawnPoints: [{
          vfxX: 100,
          vfxY: 100,
          pathTileX: 5,
          pathTileY: 5,
          pathIndex: 4,
          spawnAt: 0,
          enemyType: type,
          fired: false,
          pointId: 0,
        }],
        spawnedEnemyIds: new Set(),
        lastSpawnFiredAt: 0,
        vfxFadeOutAt: 0,
        startedAt: 0,
      };
      tickSurpriseEvents(s);
      const enemy = [...s.enemies.values()].find((candidate: any) => candidate.type === type) as any;

      expect(enemy, `${type} should spawn from Gates of Hell`).toBeTruthy();
      expect(enemy.maxHp, `${type} event HP`).toBeGreaterThanOrEqual(GATES_OF_HELL_MIN_HEALTH);
      expect(enemy.maxHp, `${type} receives Gates HP multiplier and wave scaling`).toBeGreaterThan(def.baseHp);
    }
  });

  it('adds late-campaign surprise events as mechanic checks', () => {
    expect(SURPRISE_EVENT_SCHEDULE[23]).toBe(SurpriseEventKind.UPRISING);
    expect(SURPRISE_EVENT_SCHEDULE[27]).toBe(SurpriseEventKind.GATES_OF_HELL);
    expect(SURPRISE_EVENT_SCHEDULE[29]).toBe(SurpriseEventKind.INVASION);
  });

  it('late surprise enemies gain sustain and status pressure, not just HP', () => {
    const s = makeState();
    s.wave = 23;
    s.activeSurpriseEvent.kind = SurpriseEventKind.UPRISING;
    const ground = { ...fakeEnemy({ isFlyer: false }), hp: 1000, maxHp: 1000 };
    const ok = spawnAtSurpriseEventPoint(s, ground, 0);
    expect(ok).toBe(true);
    expect(ground.maxHp).toBeCloseTo(1650, 4);
    expect((ground as any).__lateResistMult).toBeLessThan(1);
    expect((ground as any).__lateStatusGuard).toBeLessThanOrEqual(0.45);
    expect((ground as any).outOfCombatRegen).toBeGreaterThanOrEqual(0.04);
    expect((ground as any).checkpointHealPct).toBeGreaterThanOrEqual(0.10);
  });

  it('adds scaling undead giant and cyclops elites to Dead Uprising waves', () => {
    expect(deadUprisingTitanTypesForWave(11)).toEqual([
      EnemyType.UNDEAD_GIANT,
      EnemyType.UNDEAD_CYCLOPS,
      EnemyType.UNDEAD_CYCLOPS,
      EnemyType.UNDEAD_CYCLOPS,
      EnemyType.UNDEAD_CYCLOPS,
      EnemyType.UNDEAD_CYCLOPS
    ]);
    expect(deadUprisingTitanTypesForWave(14)).toEqual([EnemyType.UNDEAD_GIANT, EnemyType.UNDEAD_CYCLOPS]);
    expect(deadUprisingTitanTypesForWave(23)).toEqual([EnemyType.DREAD_UNDEAD_GIANT, EnemyType.DREAD_UNDEAD_CYCLOPS]);

    const checks: Array<{ wave: number; expected: EnemyType[] }> = [
      { wave: 11, expected: [EnemyType.UNDEAD_GIANT, EnemyType.UNDEAD_CYCLOPS] },
      { wave: 14, expected: [EnemyType.UNDEAD_GIANT, EnemyType.UNDEAD_CYCLOPS] },
      { wave: 23, expected: [EnemyType.DREAD_UNDEAD_GIANT, EnemyType.DREAD_UNDEAD_CYCLOPS] }
    ];
    for (const { wave, expected } of checks) {
      const s: any = makeEventState(wave);
      s.spawnQueue = Array.from({ length: 8 }, () => ({ type: EnemyType.UNDEAD_CELT, spawnAt: 0 }));
      maybeTriggerSurpriseEventForWave(s);
      const queuedTypes = s.spawnQueue.map((item: any) => item.type);
      for (const type of expected) {
        expect(queuedTypes).toContain(type);
        const def = (enemiesData as any)[type];
        expect(def.isBoss, type).toBe(false);
        expect(def.isElite, type).toBe(true);
        expect(def.livesCost, type).toBe(5);
      }
      if (wave === 11) {
        expect(queuedTypes.filter((type: EnemyType) => type === EnemyType.UNDEAD_CYCLOPS)).toHaveLength(5);
      }
    }
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

  it('Dead Uprising never places its urn or atmosphere on a tower or stone', () => {
    const s: any = makeEventState(11);
    const midCol = Math.floor(GRID.COLS / 2);
    const midRow = Math.floor(GRID.ROWS / 2);
    const tower = blockTowerTile(s, TowerType.MILITES, midCol, midRow);
    s.tiles[midRow - 1][midCol] = TileType.STONE;
    s.tiles[midRow][midCol + 1] = TileType.STONE;

    maybeTriggerSurpriseEventForWave(s);

    expect(s.towers.get(tower.id)).toBe(tower);
    expect(tower.tileX).toBe(midCol);
    expect(tower.tileY).toBe(midRow);
    expect(s.tiles[midRow][midCol]).toBe(TileType.TOWER);
    expect(s.tiles[midRow - 1][midCol]).toBe(TileType.STONE);
    expect(s.tiles[midRow][midCol + 1]).toBe(TileType.STONE);
    assertEventPointsAvoidPlayerTiles(s);
  });

  it('Wave 11 Dead Uprising redirects ground enemies to a fair path entry, not an instant leak', () => {
    const s: any = makeEventState(11);
    s.spawnQueue = Array.from({ length: 8 }, () => ({ type: EnemyType.UNDEAD_CELT, spawnAt: 0 }));

    maybeTriggerSurpriseEventForWave(s);

    const ev = s.activeSurpriseEvent;
    expect(ev).toBeTruthy();
    const maxSafeIndex = s.groundPath.length - 1 - 8;
    for (const point of ev.spawnPoints) {
      expect(point.pathIndex).toBeGreaterThanOrEqual(0);
      expect(point.pathIndex).toBeLessThanOrEqual(maxSafeIndex);
    }

    for (let i = 0; i < ev.spawnPoints.length; i++) {
      const e: any = spawnEnemy(s, EnemyType.UNDEAD_CELT, 1, false, false);
      const ok = spawnAtSurpriseEventPoint(s, e, i);
      expect(ok).toBe(true);
      expect(e.pathIndex).toBeLessThanOrEqual(maxSafeIndex);
    }

    let leaks = 0;
    tickEnemies(s, 0.016, () => { leaks++; }, () => {});
    expect(leaks).toBe(0);
  });

  it('Invasion perimeter fires avoid towers and stones', () => {
    const s: any = makeEventState(7);
    s.spawnQueue = Array.from({ length: 32 }, () => ({ type: 'CELTIC_FOOTMAN', spawnAt: 0 }));
    const tower = blockTowerTile(s, TowerType.SAGITTARIUS, 1, 4);
    s.tiles[1][6] = TileType.STONE;
    s.tiles[GRID.ROWS - 2][10] = TileType.STONE;

    maybeTriggerSurpriseEventForWave(s);

    expect(s.towers.get(tower.id)).toBe(tower);
    expect(s.tiles[tower.tileY][tower.tileX]).toBe(TileType.TOWER);
    expect(s.tiles[1][6]).toBe(TileType.STONE);
    expect(s.tiles[GRID.ROWS - 2][10]).toBe(TileType.STONE);
    assertEventPointsAvoidPlayerTiles(s);
  });

  it('Gates of Hell relocates gate anchors instead of covering towers or stones', () => {
    const s: any = makeEventState(16);
    const wp3 = (waypointsData as any).waypoints.find((w: any) => w.index === 3);
    const wp4 = (waypointsData as any).waypoints.find((w: any) => w.index === 4);
    const blocked = [
      { col: wp3.topLeft.col - 1, row: wp3.topLeft.row },
      { col: wp3.topLeft.col + 1, row: wp3.topLeft.row },
      { col: wp4.topLeft.col - 1, row: wp4.topLeft.row },
      { col: wp4.topLeft.col + 1, row: wp4.topLeft.row }
    ];
    const towers = blocked.slice(0, 2).map((p, idx) => blockTowerTile(s, idx === 0 ? TowerType.MILITES : TowerType.SAGITTARIUS, p.col, p.row));
    for (const p of blocked.slice(2)) s.tiles[p.row][p.col] = TileType.STONE;

    maybeTriggerSurpriseEventForWave(s);

    for (const tower of towers) {
      expect(s.towers.get(tower.id)).toBe(tower);
      expect(s.tiles[tower.tileY][tower.tileX]).toBe(TileType.TOWER);
    }
    for (const p of blocked.slice(2)) expect(s.tiles[p.row][p.col]).toBe(TileType.STONE);
    assertEventPointsAvoidPlayerTiles(s);
  });
});
