// Cave B dual-lane pathing (2026 v2 spec Ch7).
// The safety-critical guarantee: buildGroundPath is the SINGLE validation
// chokepoint (canPlaceStone + executeCombo + every main.ts placement gate on
// it != null), and it now validates BOTH the main lane AND the Cave B lane —
// so a player can never wall off Cave B and softlock the run.
import { describe, it, expect } from 'vitest';
import { createGameState } from '../src/GameState';
import { initializeGrid, setTile } from '../src/systems/GridManager';
import { buildFlyerPath, buildGroundPath, buildGroundPathB } from '../src/systems/PathFinder';
import { GamePhase, TileType } from '../src/types';
import { startWave, tickSpawns } from '../src/systems/WaveManager';
import enemiesData from '../src/data/enemies.json';
import wavesData from '../src/data/waves.json';
import waypoints from '../src/data/waypoints.json';

const CB = (waypoints as any).caveB;
function grid() { const s = createGameState(); initializeGrid(s); return s; }
function waveReadyState() {
  const s = grid();
  const path = buildGroundPath(s);
  const pathB = buildGroundPathB(s);
  expect(path).not.toBeNull();
  expect(pathB).not.toBeNull();
  s.groundPath = path!;
  s.groundPathB = pathB!;
  s.flyerPath = buildFlyerPath();
  return s;
}

function authoredCountsForWave(wave: number) {
  const w: any = (wavesData as any[]).find(row => row.wave === wave);
  let groundNonBoss = 0;
  let boss = 0;
  let flyer = 0;
  for (const group of w.spawns) {
    const def = (enemiesData as any)[group.type] ?? {};
    if (def.isBoss) boss += group.count;
    else if (def.isFlyer) flyer += group.count;
    else groundNonBoss += group.count;
  }
  return { groundNonBoss, boss, flyer };
}

describe('Cave B dual-lane (2026 v2 spec Ch7)', () => {
  it('waypoints.json defines a caveB spawn', () => {
    expect(CB).toBeTruthy();
    expect(typeof CB.col).toBe('number');
    expect(typeof CB.row).toBe('number');
  });

  it('initializeGrid marks the caveB tile as SPAWN (reserved, non-buildable)', () => {
    const s = grid();
    expect(s.tiles[CB.row][CB.col]).toBe(TileType.SPAWN);
  });

  it('buildGroundPathB routes from caveB to the gate', () => {
    const s = grid();
    const b = buildGroundPathB(s);
    expect(b).not.toBeNull();
    expect(b!.length).toBeGreaterThan(3);
    expect(b![0]).toEqual({ col: CB.col, row: CB.row });
    expect(b![b!.length - 1]).toEqual({ col: waypoints.gate.col, row: waypoints.gate.row });
  });

  it('buildGroundPath keeps BOTH lanes open on a fresh grid', () => {
    const s = grid();
    expect(buildGroundPath(s)).not.toBeNull();
    expect(buildGroundPathB(s)).not.toBeNull();
  });

  it('CHOKEPOINT: a placement that orphans Cave B is rejected (buildGroundPath null)', () => {
    const s = grid();
    // Wall every walkable neighbor of caveB so lane B has NO route, while the
    // MAIN lane stays fully intact. buildGroundPath must still return null —
    // proving the single chokepoint refuses placements that would softlock B.
    for (const [c, r] of [[CB.col + 1, CB.row], [CB.col - 1, CB.row], [CB.col, CB.row + 1], [CB.col, CB.row - 1]]) {
      if (s.tiles[r] && s.tiles[r][c] !== undefined && s.tiles[r][c] !== TileType.BORDER) {
        s.tiles[r][c] = TileType.STONE;
      }
    }
    expect(buildGroundPathB(s)).toBeNull();   // lane B genuinely orphaned
    expect(buildGroundPath(s)).toBeNull();    // chokepoint rejects the placement
  });

  it('a tower far from both lanes keeps the path valid', () => {
    const s = grid();
    setTile(s, 33, 3, TileType.TOWER);
    expect(buildGroundPath(s)).not.toBeNull();
  });

  it('mirrors W21+ ground non-boss spawns so both gates get the same count', () => {
    const s = waveReadyState();
    s.phase = GamePhase.BUILD_PHASE;
    s.wave = 20;
    startWave(s);

    const authored = authoredCountsForWave(21);
    const mainGround = s.spawnQueue.filter(item => {
      const def = (enemiesData as any)[item.type] ?? {};
      return !item.caveB && !def.isBoss && !def.isFlyer;
    });
    const caveBGround = s.spawnQueue.filter(item => {
      const def = (enemiesData as any)[item.type] ?? {};
      return item.caveB && !def.isBoss && !def.isFlyer;
    });

    expect(s.wave).toBe(21);
    expect(mainGround.length).toBeGreaterThanOrEqual(authored.groundNonBoss);
    expect(caveBGround.length).toBe(mainGround.length);
    for (const item of mainGround) {
      const sameTypeFromCaveB = caveBGround.filter(other => other.type === item.type);
      const sameTypeFromMain = mainGround.filter(other => other.type === item.type);
      expect(sameTypeFromCaveB.length, `${item.type} mirrored to Cave B`).toBe(sameTypeFromMain.length);
    }
  });

  it('spawns equal live ground counts from the main gate and Cave B', () => {
    const s = waveReadyState();
    s.phase = GamePhase.BUILD_PHASE;
    s.wave = 20;
    startWave(s);
    tickSpawns(s, 999);

    const mainGround = [...s.enemies.values()].filter(e => !e.isBoss && !e.isFlyer && !(e as any).__caveB);
    const caveBGround = [...s.enemies.values()].filter(e => !e.isBoss && !e.isFlyer && (e as any).__caveB);
    expect(mainGround.length).toBeGreaterThan(0);
    expect(caveBGround.length).toBe(mainGround.length);
    expect(s.caveBActive).toBe(true);
  });
});
