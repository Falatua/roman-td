import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createGameState } from '../src/GameState';
import { GRID } from '../src/constants';
import enemiesData from '../src/data/enemies.json';
import wavesData from '../src/data/waves.json';
import { effectiveTowerCritChance } from '../src/systems/CombatResolver';
import { isCasterEnemy } from '../src/systems/EnemyClassification';
import { tickEnemies } from '../src/systems/EnemySystem';
import {
  DamageType,
  Enemy,
  EnemyFaction,
  EnemyType,
  TargetingMode,
  Tower,
  TowerType
} from '../src/types';

beforeAll(() => {
  if (typeof (globalThis as any).window === 'undefined') {
    (globalThis as any).window = {};
  }
});

function makeTower(type = TowerType.SAGITTARIUS, tileX = 10, tileY = 10): Tower {
  return {
    id: `tower-${type}`,
    type,
    qualityTier: 1,
    tileX,
    tileY,
    damageType: DamageType.PHYS_RANGED,
    baseDps: 100,
    attackSpeed: 1,
    range: 5,
    targetingMode: TargetingMode.FIRST,
    killCount: 0,
    killBonusFlat: 0,
    hasBeenDowngraded: false,
    builtFrom: [],
    equippedItems: [],
    equippedItemRarities: [],
    placedAtWave: 1,
    attackCooldown: 0,
    rotation: 0,
    isAerarium: false,
    pending: false,
    attackFlash: 0,
    bossDamageDealt: 0,
    totalDamageDealt: 0,
    killsThisWave: 0,
    damageThisWave: 0,
    mvpAwards: 0
  };
}

function makeEnemy(type: EnemyType, x: number, y: number, isBoss = false): Enemy {
  return {
    id: `enemy-${type}-${Math.random()}`,
    type,
    faction: EnemyFaction.EGYPTIANS,
    hp: 1000,
    maxHp: 1000,
    baseSpeed: 0,
    currentSpeed: 0,
    isFlyer: false,
    x,
    y,
    pathIndex: 0,
    pathProgress: 0,
    statusEffects: [],
    hasFeared: false,
    livesCost: isBoss ? 10 : 1,
    isBoss,
    reward: 0,
    archetype: 'SWARM',
    hpFlashTimer: 0,
    lastDamagedTick: -999
  } as Enemy;
}

function towerCenter(tower: Tower): { x: number; y: number } {
  return {
    x: tower.tileX * GRID.TILE + GRID.TILE / 2,
    y: tower.tileY * GRID.TILE + GRID.TILE / 2
  };
}

describe('post-W15 Tomb Omen crit suppression', () => {
  it('uses the two otherwise-plain Wave 18 Egyptian units as the only carriers', () => {
    const carriers = Object.entries(enemiesData as Record<string, any>)
      .filter(([, def]) => def.auraTowerCritPenalty > 0)
      .map(([type]) => type)
      .sort();

    expect(carriers).toEqual(['EGYPTIAN_ARCHER', 'EGYPTIAN_SPEARMAN']);
    expect((enemiesData as any).EGYPTIAN_ARCHER).toMatchObject({
      auraTowerCritPenalty: 0.10,
      auraTowerCritRadiusTiles: 2.5,
      auraTowerCritName: 'EVIL-EYE VOLLEY'
    });
    expect((enemiesData as any).EGYPTIAN_SPEARMAN).toMatchObject({
      auraTowerCritPenalty: 0.15,
      auraTowerCritRadiusTiles: 2,
      auraTowerCritName: 'TOMB-WARD FORMATION'
    });

    for (const type of carriers) {
      const appearances = (wavesData as any[])
        .filter(wave => (wave.spawns ?? []).some((spawn: any) => spawn.type === type))
        .map(wave => wave.wave);
      expect(Math.min(...appearances), type).toBe(18);
      expect(appearances.every(wave => wave > 15), type).toBe(true);
      expect(isCasterEnemy(type as EnemyType), `${type} should be focusable with CASTER targeting`).toBe(true);
    }
  });

  it('stamps the strongest nearby aura without stacking and clears it after carriers leave', () => {
    const state = createGameState();
    state.tick = 20;
    const tower = makeTower();
    state.towers.set(tower.id, tower);
    const center = towerCenter(tower);
    const archer = makeEnemy(EnemyType.EGYPTIAN_ARCHER, center.x, center.y);
    state.enemies.set(archer.id, archer);

    tickEnemies(state, 0.016, () => {}, () => {});
    expect(tower.__critChancePenalty).toBe(0.10);
    expect(tower.__critChancePenaltySource).toBe('EVIL-EYE VOLLEY');

    const spearman = makeEnemy(EnemyType.EGYPTIAN_SPEARMAN, center.x, center.y);
    state.enemies.set(spearman.id, spearman);
    tickEnemies(state, 0.016, () => {}, () => {});
    expect(tower.__critChancePenalty).toBe(0.15);
    expect(tower.__critChancePenaltySource).toBe('TOMB-WARD FORMATION');

    archer.x = center.x + GRID.TILE * 8;
    spearman.x = center.x + GRID.TILE * 8;
    tickEnemies(state, 0.016, () => {}, () => {});
    expect(tower.__critChancePenalty).toBe(0);
    expect(tower.__critChancePenaltySource).toBeUndefined();
  });

  it('reduces final standard crit chance after boss and Marian bonuses and clamps at zero', () => {
    const state = createGameState();
    state.tick = 50;
    const ordinaryTarget = makeEnemy(EnemyType.FERAL_DOG, 0, 0);

    const archerTower = makeTower(TowerType.SAGITTARIUS);
    archerTower.__critChancePenalty = 0.10;
    expect(effectiveTowerCritChance(state, archerTower, ordinaryTarget)).toBeCloseTo(0.12, 6);

    const legionPrime = makeTower(TowerType.LEGION_PRIME);
    legionPrime.__critChancePenalty = 0.15;
    const bossTarget = makeEnemy(EnemyType.ALPHA_DOG, 0, 0, true);
    expect(effectiveTowerCritChance(state, legionPrime, bossTarget)).toBeCloseTo(0.65, 6);

    const marianTower = makeTower(TowerType.MILITES);
    marianTower.__marianFormationUntilTick = 60;
    marianTower.__marianSharedCrit = 0.50;
    marianTower.__critChancePenalty = 0.15;
    expect(effectiveTowerCritChance(state, marianTower, ordinaryTarget)).toBeCloseTo(0.35, 6);

    marianTower.__marianFormationUntilTick = 0;
    expect(effectiveTowerCritChance(state, marianTower, ordinaryTarget)).toBe(0);
  });

  it('keeps the ability readable in battle, previews, inspect, and Codex surfaces', () => {
    const render = readFileSync('src/render/RenderEngine.ts', 'utf8');
    const inspect = readFileSync('src/render/EnemyInspect.ts', 'utf8');
    const codex = readFileSync('src/render/Codex.ts', 'utf8');
    const previews = readFileSync('src/render/UIManager.ts', 'utf8');
    const towerMenu = readFileSync('src/render/TowerMenu.ts', 'utf8');

    expect(render).toContain('critSuppressionAuraGfx');
    expect(inspect).toContain('percentage points of standard CRIT chance');
    expect(codex).toContain('✦ Tomb Omen');
    expect(previews).toContain('CRIT-SUPPRESS');
    expect(towerMenu).toContain('__critChancePenaltySource');
  });
});
