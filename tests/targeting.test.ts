// Targeting-mode tests — locks the FIRST / LAST / STRONG / WEAKEST /
// FAST / CLOSE / FLYERS behavior to prevent regressions. The
// pickTarget function is exported from CombatResolver specifically
// for this test file.
import { describe, it, expect } from 'vitest';
import { pickTarget } from '../src/systems/CombatResolver';
import { createTower } from '../src/systems/TowerSystem';
import { createGameState } from '../src/GameState';
import { TowerType, TargetingMode, Enemy, EnemyType, EnemyFaction, DamageType } from '../src/types';
import { GRID } from '../src/constants';

// Minimal Enemy factory — only the fields pickTarget reads.
function fakeEnemy(opts: {
  id: string;
  x: number; y: number;
  pathIndex: number; pathProgress?: number;
  hp: number; maxHp?: number;
  isFlyer?: boolean; isBoss?: boolean;
  type?: EnemyType;
}): Enemy {
  return {
    id: opts.id,
    type: opts.type ?? EnemyType.FERAL_DOG,
    faction: EnemyFaction.DOGS,
    archetype: 'SWARM' as any,
    x: opts.x, y: opts.y,
    prevX: opts.x, prevY: opts.y,
    dirX: 1, dirY: 0,
    pathIndex: opts.pathIndex,
    pathProgress: opts.pathProgress ?? 0,
    hp: opts.hp,
    maxHp: opts.maxHp ?? opts.hp,
    baseSpeed: 1.0,
    currentSpeed: 1.0,
    isFlyer: !!opts.isFlyer,
    isBoss: !!opts.isBoss,
    statusEffects: [],
    livesCost: 1,
    mutation: null as any,
    hpFlashTimer: 0,
    lastDamagedTick: 0,
    shieldBroken: false,
    isBonusBoss: false
  } as any;
}

describe('Tower targeting modes', () => {
  // Tower at tile (5,5) → pixel center (5.5×32, 5.5×32) = (176, 176)
  // Range 10 tiles → 320 px. All test enemies sit within range by design.
  const TX = 5 * GRID.TILE + GRID.TILE / 2;
  const TY = 5 * GRID.TILE + GRID.TILE / 2;

  function setup() {
    const state = createGameState();
    // VELITES is a regular ranged tower (not anti-air-only) — covers
    // both ground and flyers for the FIRST/LAST/STRONG/CLOSE pickers.
    // Sagittarius would filter out ground (antiAirOnly conversion).
    const tower = createTower(TowerType.VELITES, 1, 5, 5, 1);
    // 5 enemies arranged for unambiguous picks:
    //   A — earliest in path (lowest pathIndex), full HP, farthest from tower
    //   B — middle path, MAX HP (strongest), middle distance
    //   C — late path (highest progress, FIRST to leak), low HP, far
    //   D — middle path, low HP, CLOSEST to tower
    //   E — FLYER, mid path, mid HP, mid distance
    const A = fakeEnemy({ id: 'A', x: TX + 200, y: TY,        pathIndex: 0, pathProgress: 0.1,  hp: 500 });
    const B = fakeEnemy({ id: 'B', x: TX - 150, y: TY,        pathIndex: 5, pathProgress: 0.2,  hp: 2000 });
    const C = fakeEnemy({ id: 'C', x: TX + 220, y: TY + 40,   pathIndex: 9, pathProgress: 0.9,  hp: 200 });
    const D = fakeEnemy({ id: 'D', x: TX + 10,  y: TY + 10,   pathIndex: 5, pathProgress: 0.5,  hp: 100 });
    const E = fakeEnemy({ id: 'E', x: TX - 80,  y: TY,        pathIndex: 6, pathProgress: 0.6,  hp: 800, isFlyer: true });
    return { state, tower, enemies: [A, B, C, D, E] };
  }

  it('FIRST picks the enemy furthest along the path (closest to gate)', () => {
    const { state, tower, enemies } = setup();
    tower.targetingMode = TargetingMode.FIRST;
    const picked = pickTarget(state, tower, enemies, 10);
    // C has the highest pathIndex+pathProgress (9.9) — first to leak.
    expect(picked?.id).toBe('C');
  });

  it('LAST picks the enemy earliest in the path (newest spawn)', () => {
    const { state, tower, enemies } = setup();
    tower.targetingMode = TargetingMode.LAST;
    const picked = pickTarget(state, tower, enemies, 10);
    // A has the lowest pathIndex+pathProgress (0.1).
    expect(picked?.id).toBe('A');
  });

  it('STRONG picks the enemy with the highest remaining HP when no priority targets are present', () => {
    const { state, tower, enemies } = setup();
    tower.targetingMode = TargetingMode.STRONG;
    const picked = pickTarget(state, tower, enemies, 10);
    // B has the highest HP (2000).
    expect(picked?.id).toBe('B');
  });

  it('STRONG prioritizes bosses over commanders and stronger regular enemies', () => {
    const { state, tower, enemies } = setup();
    const boss = enemies.find(e => e.id === 'D')!;
    boss.isBoss = true;
    boss.hp = 100;
    const commander = enemies.find(e => e.id === 'E')!;
    commander.type = EnemyType.STANDARD_BEARER_COMMANDER;
    commander.hp = 1500;
    const brute = enemies.find(e => e.id === 'B')!;
    brute.hp = 5000;

    tower.targetingMode = TargetingMode.STRONG;
    const picked = pickTarget(state, tower, enemies, 10);
    expect(picked?.id).toBe('D');
  });

  it('STRONG prioritizes commanders when no bosses are in range', () => {
    const { state, tower, enemies } = setup();
    const commander = enemies.find(e => e.id === 'D')!;
    commander.type = EnemyType.STANDARD_BEARER_COMMANDER;
    commander.hp = 100;
    const brute = enemies.find(e => e.id === 'B')!;
    brute.hp = 5000;

    tower.targetingMode = TargetingMode.STRONG;
    const picked = pickTarget(state, tower, enemies, 10);
    expect(picked?.id).toBe('D');
  });

  it('WEAKEST picks the enemy with the lowest remaining HP', () => {
    const { state, tower, enemies } = setup();
    tower.targetingMode = TargetingMode.WEAKEST;
    const picked = pickTarget(state, tower, enemies, 10);
    // D has the lowest current HP (100) → finisher pick.
    expect(picked?.id).toBe('D');
  });

  it('WEAKEST can pick a boss when it has the lowest current HP', () => {
    const { state, tower, enemies } = setup();
    // Promote B to a boss with 50 HP. WEAKEST is literal now: the lowest
    // current HP enemy wins, even when that enemy is a boss.
    const boss = enemies.find(e => e.id === 'B')!;
    (boss as any).isBoss = true;
    boss.hp = 50;
    tower.targetingMode = TargetingMode.WEAKEST;
    const picked = pickTarget(state, tower, enemies, 10);
    expect(picked?.id).toBe('B');
  });

  it('WEAKEST can pick a commander when it has the lowest current HP', () => {
    const { state, tower, enemies } = setup();
    const commander = enemies.find(e => e.id === 'B')!;
    commander.type = EnemyType.STANDARD_BEARER_COMMANDER;
    commander.hp = 50;
    tower.targetingMode = TargetingMode.WEAKEST;
    const picked = pickTarget(state, tower, enemies, 10);
    expect(picked?.id).toBe('B');
  });

  it('WEAKEST falls back to a boss when nothing else is in range', () => {
    const { state, tower } = setup();
    // Only a boss is in range. WEAKEST must still return SOMETHING
    // rather than null — falling back to the boss is correct.
    const lonelyBoss = fakeEnemy({
      id: 'BOSS', x: TX + 50, y: TY, pathIndex: 4, pathProgress: 0.5,
      hp: 10, maxHp: 100000, isBoss: true,
    });
    tower.targetingMode = TargetingMode.WEAKEST;
    const picked = pickTarget(state, tower, [lonelyBoss], 10);
    expect(picked?.id).toBe('BOSS');
  });

  it('FAST picks the enemy with the highest current speed', () => {
    const { state, tower, enemies } = setup();
    // Override speeds: make E the clear sprinter.
    (enemies.find(e => e.id === 'A') as any).currentSpeed = 1.0;
    (enemies.find(e => e.id === 'B') as any).currentSpeed = 0.6;
    (enemies.find(e => e.id === 'C') as any).currentSpeed = 1.2;
    (enemies.find(e => e.id === 'D') as any).currentSpeed = 0.9;
    (enemies.find(e => e.id === 'E') as any).currentSpeed = 2.4;
    tower.targetingMode = TargetingMode.FAST;
    const picked = pickTarget(state, tower, enemies, 10);
    expect(picked?.id).toBe('E');
  });

  it('FAST respects active slows — a slowed-down enemy is skipped', () => {
    const { state, tower, enemies } = setup();
    // E has the highest BASE speed but is currently slowed to a crawl.
    // C is the next fastest with no slow applied. FAST should pick C.
    (enemies.find(e => e.id === 'A') as any).currentSpeed = 1.0;
    (enemies.find(e => e.id === 'B') as any).currentSpeed = 0.6;
    (enemies.find(e => e.id === 'C') as any).currentSpeed = 1.4;
    (enemies.find(e => e.id === 'D') as any).currentSpeed = 0.9;
    (enemies.find(e => e.id === 'E') as any).baseSpeed = 2.4;
    (enemies.find(e => e.id === 'E') as any).currentSpeed = 0.3;
    tower.targetingMode = TargetingMode.FAST;
    const picked = pickTarget(state, tower, enemies, 10);
    expect(picked?.id).toBe('C');
  });

  it('CLOSE picks the enemy physically closest to the tower', () => {
    const { state, tower, enemies } = setup();
    tower.targetingMode = TargetingMode.CLOSE;
    const picked = pickTarget(state, tower, enemies, 10);
    // D is closest (~14 px from tower center).
    expect(picked?.id).toBe('D');
  });

  it('FLYERS prioritizes flyers, picking the furthest-along flyer', () => {
    const { state, tower, enemies } = setup();
    tower.targetingMode = TargetingMode.FLYERS;
    const picked = pickTarget(state, tower, enemies, 10);
    // Only E is a flyer.
    expect(picked?.id).toBe('E');
  });

  it('FLYERS falls back to non-flyers when no flyer is in range', () => {
    const { state, tower, enemies } = setup();
    const groundOnly = enemies.filter(e => !e.isFlyer);
    tower.targetingMode = TargetingMode.FLYERS;
    const picked = pickTarget(state, tower, groundOnly, 10);
    // Falls back to furthest-along ground: C.
    expect(picked?.id).toBe('C');
  });

  it('Sagittarius, Aquila Venator, and Skyreaper Battery can only target flyers in every targeting mode', () => {
    const { state, enemies } = setup();
    const groundOnly = enemies.filter(e => !e.isFlyer);
    const flyer = enemies.find(e => e.isFlyer)!;
    const modes = [
      TargetingMode.FIRST,
      TargetingMode.LAST,
      TargetingMode.STRONG,
      TargetingMode.WEAKEST,
      TargetingMode.FAST,
      TargetingMode.CLOSE,
      TargetingMode.FLYERS,
    ];

    for (const type of [TowerType.SAGITTARIUS, TowerType.AQUILA_VENATOR, TowerType.SKYREAPER_BATTERY]) {
      const tier = type === TowerType.AQUILA_VENATOR ? 3 : type === TowerType.SKYREAPER_BATTERY ? 4 : 1;
      const tower = createTower(type, tier, 5, 5, 1);
      for (const mode of modes) {
        tower.targetingMode = mode;
        expect(pickTarget(state, tower, enemies, 10)?.id, `${type} ${mode} should pick the flyer`).toBe(flyer.id);
        expect(pickTarget(state, tower, groundOnly, 10), `${type} ${mode} should ignore ground enemies`).toBeNull();
      }
    }
  });

  it('returns null when no enemy is in range', () => {
    const { state, tower } = setup();
    // Move all enemies way out of range.
    const far = [fakeEnemy({ id: 'X', x: TX + 9999, y: TY, pathIndex: 0, hp: 100 })];
    tower.targetingMode = TargetingMode.FIRST;
    const picked = pickTarget(state, tower, far, 5);    // 5-tile range
    expect(picked).toBeNull();
  });

  it('a non-melee tower targets flyers normally', () => {
    const { state, tower, enemies } = setup();
    tower.targetingMode = TargetingMode.FIRST;
    const picked = pickTarget(state, tower, enemies, 10);
    // FIRST still picks C (path-furthest), not E (flyer at mid-path).
    expect(picked?.id).toBe('C');
  });

  it('melee tower cannot pick a flyer by default', () => {
    const { state, tower, enemies } = setup();
    const meleeTower = createTower(TowerType.MILITES, 1, 5, 5, 1);
    meleeTower.targetingMode = TargetingMode.FLYERS;
    const onlyFlyer = enemies.filter(e => e.isFlyer);
    const picked = pickTarget(state, meleeTower, onlyFlyer, 10);
    // No ground enemies + melee can't reach flyer → null.
    expect(picked).toBeNull();
  });

  it('hero towers use the same targeting modes as regular towers', () => {
    const { state, enemies } = setup();
    const hero = createTower(TowerType.HERO_MARIUS, 5, 5, 5, 1);
    hero.isHero = true;
    hero.targetingMode = TargetingMode.CLOSE;
    const picked = pickTarget(state, hero, enemies, 10);
    expect(picked?.id).toBe('D');
  });

  it('physical-ranged towers skip ranged-immune enemies and pick a valid target', () => {
    const { state, tower } = setup();
    tower.targetingMode = TargetingMode.STRONG;
    tower.damageType = DamageType.PHYS_RANGED;
    const immune = fakeEnemy({ id: 'IMMUNE', type: EnemyType.MONGOL_CAPTAIN, x: TX + 20, y: TY, pathIndex: 8, hp: 5000 });
    const valid = fakeEnemy({ id: 'VALID', type: EnemyType.MONGOL_SPEARMAN, x: TX + 30, y: TY, pathIndex: 4, hp: 500 });
    const picked = pickTarget(state, tower, [immune, valid], 10);
    expect(picked?.id).toBe('VALID');
  });

  it('non-physical-ranged towers may still target ranged-immune enemies', () => {
    const { state, tower } = setup();
    tower.targetingMode = TargetingMode.STRONG;
    tower.damageType = DamageType.DIVINE;
    const immune = fakeEnemy({ id: 'IMMUNE', type: EnemyType.MONGOL_CAPTAIN, x: TX + 20, y: TY, pathIndex: 8, hp: 5000 });
    const valid = fakeEnemy({ id: 'VALID', type: EnemyType.MONGOL_SPEARMAN, x: TX + 30, y: TY, pathIndex: 4, hp: 500 });
    const picked = pickTarget(state, tower, [immune, valid], 10);
    expect(picked?.id).toBe('IMMUNE');
  });
});
