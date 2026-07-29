import { beforeAll, describe, expect, it } from 'vitest';
import { createGameState } from '../src/GameState';
import { GRID } from '../src/constants';
import wavesData from '../src/data/waves.json';
import { initializeGrid } from '../src/systems/GridManager';
import {
  midCampaignAbilitiesFor,
  midCampaignDirectDamageMultiplier,
  midCampaignEnemySpeedMultiplier,
  midCampaignEnemyVisualScale,
  tickMidCampaignEnemyAbilities
} from '../src/systems/MidCampaignEnemyAbilities';
import { buildFlyerPath, buildGroundPath, buildGroundPathB } from '../src/systems/PathFinder';
import { spawnEnemy } from '../src/systems/EnemySystem';
import { createTower } from '../src/systems/TowerSystem';
import { enemyDamageMultiplier, statusEffectiveness } from '../src/systems/EnemyResistances';
import { DamageType, EnemyType, StatusEffectKind, TowerType } from '../src/types';

beforeAll(() => {
  if (typeof (globalThis as any).window === 'undefined') {
    (globalThis as any).window = {};
  }
});

function stateForWave(wave = 17) {
  const state = createGameState();
  initializeGrid(state);
  state.groundPath = buildGroundPath(state) ?? [];
  state.groundPathB = buildGroundPathB(state) ?? [];
  state.flyerPath = buildFlyerPath();
  state.wave = wave;
  return state;
}

function placeNear(enemy: ReturnType<typeof spawnEnemy>, x: number, y: number): void {
  enemy.x = x;
  enemy.y = y;
}

describe('Waves 15-24 active enemy abilities', () => {
  it('defines eight distinct, player-facing and counterable abilities', () => {
    const types = [
      EnemyType.MONGOL_FOOTMAN,
      EnemyType.MONGOL_SCOUT,
      EnemyType.MONGOL_HORSE_ARCHER,
      EnemyType.MONGOL_SPEAR_RIDER,
      EnemyType.MONGOL_CAPTAIN,
      EnemyType.EGYPTIAN_CHARIOT,
      EnemyType.PHARAOH_GUARD,
      EnemyType.SOBEK_WARRIOR
    ];
    const abilities = types.flatMap(midCampaignAbilitiesFor);

    expect(abilities).toHaveLength(8);
    expect(new Set(abilities.map(ability => ability.id)).size).toBe(8);
    for (const ability of abilities) {
      expect(ability.description.length).toBeGreaterThan(35);
      expect(ability.description).not.toMatch(/immune to all|invulnerable/i);
      expect(ability.threatTag.length).toBeGreaterThan(2);
    }
  });

  it('places the new mechanics across the quiet roster gaps from W15 through W23', () => {
    const abilityWaves: number[] = [];
    for (let wave = 15; wave <= 23; wave++) {
      const definition: any = (wavesData as any[])[wave - 1];
      const hasNewAbility = definition.spawns.some(
        (spawn: any) => midCampaignAbilitiesFor(spawn.type).length > 0
      );
      if (hasNewAbility) abilityWaves.push(wave);
    }

    expect(abilityWaves).toEqual([15, 16, 17, 19, 20, 21, 22, 23]);
  });

  it('makes Hun Footman formation defense require three nearby footmen', () => {
    const state = stateForWave(15);
    const a = spawnEnemy(state, EnemyType.MONGOL_FOOTMAN, 1);
    const b = spawnEnemy(state, EnemyType.MONGOL_FOOTMAN, 1);
    const c = spawnEnemy(state, EnemyType.MONGOL_FOOTMAN, 1);
    placeNear(a, 300, 300);
    placeNear(b, 320, 300);
    placeNear(c, 340, 300);

    tickMidCampaignEnemyAbilities(state);
    expect(midCampaignDirectDamageMultiplier(a)).toBeCloseTo(0.82, 8);

    placeNear(c, 600, 600);
    tickMidCampaignEnemyAbilities(state);
    expect(midCampaignDirectDamageMultiplier(a)).toBe(1);
  });

  it('applies formation defense to direct hits without reducing damage-over-time', () => {
    const state = stateForWave(15);
    const a = spawnEnemy(state, EnemyType.MONGOL_FOOTMAN, 1);
    const b = spawnEnemy(state, EnemyType.MONGOL_FOOTMAN, 1);
    const c = spawnEnemy(state, EnemyType.MONGOL_FOOTMAN, 1);
    const control = spawnEnemy(state, EnemyType.MONGOL_FOOTMAN, 1);
    placeNear(a, 300, 300);
    placeNear(b, 320, 300);
    placeNear(c, 340, 300);
    placeNear(control, 700, 700);

    tickMidCampaignEnemyAbilities(state);

    expect(enemyDamageMultiplier(a, DamageType.PHYS_MELEE)).toBeCloseTo(
      enemyDamageMultiplier(control, DamageType.PHYS_MELEE) * 0.82,
      8
    );
    expect(statusEffectiveness(a, StatusEffectKind.POISON)).toBeCloseTo(
      statusEffectiveness(control, StatusEffectKind.POISON),
      8
    );
  });

  it('gives Scouts a short speed burst only when they leave stealth', () => {
    const state = stateForWave(15);
    const scout = spawnEnemy(state, EnemyType.MONGOL_SCOUT, 1);
    (scout as any).__veiled = true;
    tickMidCampaignEnemyAbilities(state);
    expect(midCampaignEnemySpeedMultiplier(scout)).toBe(1);

    state.tick = 1;
    (scout as any).__veiled = false;
    tickMidCampaignEnemyAbilities(state);
    expect(midCampaignEnemySpeedMultiplier(scout)).toBeCloseTo(1.35, 8);

    state.tick = 2.6;
    tickMidCampaignEnemyAbilities(state);
    expect(midCampaignEnemySpeedMultiplier(scout)).toBe(1);
  });

  it('caps Spear Rider survival hardening and visible growth at four stages', () => {
    const state = stateForWave(17);
    const rider = spawnEnemy(state, EnemyType.MONGOL_SPEAR_RIDER, 1);

    state.tick = 80;
    tickMidCampaignEnemyAbilities(state);

    expect(midCampaignDirectDamageMultiplier(rider)).toBeCloseTo(0.80, 8);
    expect(midCampaignEnemySpeedMultiplier(rider)).toBeCloseTo(1.16, 8);
    expect(midCampaignEnemyVisualScale(rider)).toBeCloseTo(1.16, 8);
  });

  it('applies a non-stacking Mongol speed aura from Captains', () => {
    const state = stateForWave(17);
    const captainA = spawnEnemy(state, EnemyType.MONGOL_CAPTAIN, 1);
    const captainB = spawnEnemy(state, EnemyType.MONGOL_CAPTAIN, 1);
    const ally = spawnEnemy(state, EnemyType.MONGOL_SCOUT, 1);
    const outsider = spawnEnemy(state, EnemyType.EGYPTIAN_CHARIOT, 1);
    placeNear(captainA, 300, 300);
    placeNear(captainB, 320, 300);
    placeNear(ally, 340, 300);
    placeNear(outsider, 340, 320);

    tickMidCampaignEnemyAbilities(state);

    expect(midCampaignEnemySpeedMultiplier(ally)).toBeCloseTo(1.15, 8);
    expect(midCampaignEnemySpeedMultiplier(outsider)).toBe(1);
  });

  it('makes Chariots surge and Sobek Warriors permanently grow at route quarters', () => {
    const state = stateForWave(19);
    const chariot = spawnEnemy(state, EnemyType.EGYPTIAN_CHARIOT, 1);
    const sobek = spawnEnemy(state, EnemyType.SOBEK_WARRIOR, 1);
    const quarterIndex = Math.ceil((state.groundPath.length - 1) * 0.26);
    chariot.pathIndex = quarterIndex;
    sobek.pathIndex = quarterIndex;

    tickMidCampaignEnemyAbilities(state);

    expect(midCampaignEnemySpeedMultiplier(chariot)).toBeCloseTo(1.40, 8);
    expect(midCampaignEnemySpeedMultiplier(sobek)).toBeCloseTo(1.07, 8);
    expect(midCampaignEnemyVisualScale(sobek)).toBeCloseTo(1.03, 8);

    state.tick = 3;
    chariot.pathIndex = 0;
    sobek.pathIndex = 0;
    tickMidCampaignEnemyAbilities(state);
    expect(midCampaignEnemySpeedMultiplier(chariot)).toBe(1);
    expect(midCampaignEnemySpeedMultiplier(sobek)).toBeCloseTo(1.07, 8);
  });

  it('protects Pharaoh Guards only while they escort an Egyptian priority unit', () => {
    const state = stateForWave(23);
    const guard = spawnEnemy(state, EnemyType.PHARAOH_GUARD, 1);
    const priest = spawnEnemy(state, EnemyType.ANUBIS_PRIEST, 1);
    placeNear(guard, 300, 300);
    placeNear(priest, 340, 300);

    tickMidCampaignEnemyAbilities(state);
    expect(midCampaignDirectDamageMultiplier(guard)).toBeCloseTo(0.75, 8);

    placeNear(priest, 700, 700);
    tickMidCampaignEnemyAbilities(state);
    expect(midCampaignDirectDamageMultiplier(guard)).toBe(1);
  });

  it('uses one pack-level Parthian Volley against the highest-damage ranged or siege tower', () => {
    const state = stateForWave(16);
    const archerA = spawnEnemy(state, EnemyType.MONGOL_HORSE_ARCHER, 1);
    const archerB = spawnEnemy(state, EnemyType.MONGOL_HORSE_ARCHER, 1);
    placeNear(archerA, 10 * GRID.TILE, 10 * GRID.TILE);
    placeNear(archerB, 10 * GRID.TILE + 12, 10 * GRID.TILE);

    const ranged = createTower(TowerType.VELITES, 1, 10, 11, state.wave);
    const siege = createTower(TowerType.SCORPIO, 1, 11, 10, state.wave);
    const melee = createTower(TowerType.MILITES, 1, 10, 9, state.wave);
    ranged.totalDamageDealt = 500;
    siege.totalDamageDealt = 900;
    melee.totalDamageDealt = 10_000;
    expect(ranged.damageType).toBe(DamageType.PHYS_RANGED);
    expect(siege.damageType).toBe(DamageType.SIEGE);
    expect(melee.damageType).toBe(DamageType.PHYS_MELEE);
    state.towers.set(ranged.id, ranged);
    state.towers.set(siege.id, siege);
    state.towers.set(melee.id, melee);

    tickMidCampaignEnemyAbilities(state);
    state.tick = 8;
    tickMidCampaignEnemyAbilities(state);

    expect((siege as any).__atkSpeedDebuffPct).toBeCloseTo(0.30, 8);
    expect((siege as any).__atkSpeedDebuffUntil).toBe(11);
    expect((ranged as any).__atkSpeedDebuffPct).toBeUndefined();
    expect((melee as any).__atkSpeedDebuffPct).toBeUndefined();
  });
});
