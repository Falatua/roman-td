import { beforeAll, describe, expect, it } from 'vitest';
import enemiesData from '../src/data/enemies.json';
import { createGameState } from '../src/GameState';
import { isBossEnemy } from '../src/systems/EnemyClassification';
import {
  BOSS_DOT_DAMAGE_MULTIPLIER,
  BOSS_DOT_DAMAGE_TAKEN_PCT,
  BOSS_DOT_RESISTANCE_PCT,
  bossDotDamageMultiplier
} from '../src/systems/EnemyResistances';
import { tickBurnPatches, tickEnemies } from '../src/systems/EnemySystem';
import { Enemy, EnemyFaction, EnemyType, StatusEffectKind } from '../src/types';

beforeAll(() => {
  if (typeof (globalThis as any).window === 'undefined') {
    (globalThis as any).window = {};
  }
});

const bossEntries = Object.entries(enemiesData)
  .filter(([, def]) => (def as any).isBoss === true);

function factionFor(def: any): EnemyFaction {
  return EnemyFaction[def.faction as keyof typeof EnemyFaction];
}

function makeEnemy(
  type: EnemyType,
  faction: EnemyFaction,
  isBoss: boolean,
  id: string
): Enemy {
  return {
    id,
    type,
    faction,
    hp: 100_000,
    maxHp: 100_000,
    baseSpeed: 0,
    currentSpeed: 0,
    isFlyer: false,
    x: 320,
    y: 320,
    pathIndex: 0,
    pathProgress: 0,
    statusEffects: [],
    hasFeared: false,
    livesCost: isBoss ? 10 : 1,
    isBoss,
    reward: 0,
    archetype: isBoss ? 'BOSS' : 'SWARM',
    hpFlashTimer: 0,
    lastDamagedTick: -999
  } as Enemy;
}

function statusDamage(
  type: EnemyType,
  faction: EnemyFaction,
  kind: StatusEffectKind,
  isBoss: boolean
): number {
  const state = createGameState();
  const enemy = makeEnemy(type, faction, isBoss, `${type}-${kind}-${isBoss}`);
  enemy.statusEffects.push({
    kind,
    magnitude: 0.001,
    remaining: 10,
    sourceTier: 1
  } as any);
  state.enemies.set(enemy.id, enemy);
  tickEnemies(state, 1, () => {}, () => {});
  return enemy.maxHp - enemy.hp;
}

describe('authoritative boss damage-over-time ward', () => {
  it('keeps the player-facing percentages tied to the runtime multiplier', () => {
    expect(BOSS_DOT_DAMAGE_MULTIPLIER).toBe(0.18);
    expect(BOSS_DOT_DAMAGE_TAKEN_PCT).toBe(18);
    expect(BOSS_DOT_RESISTANCE_PCT).toBe(82);
  });

  it('covers every authored boss and leaves ordinary enemies unmodified', () => {
    expect(bossEntries.length).toBeGreaterThan(0);

    for (const [type, def] of bossEntries) {
      expect(isBossEnemy(type), type).toBe(true);
      expect(bossDotDamageMultiplier({ isBoss: (def as any).isBoss }), type)
        .toBe(BOSS_DOT_DAMAGE_MULTIPLIER);
    }

    expect(bossDotDamageMultiplier({ isBoss: false })).toBe(1);
  });

  it.each([
    StatusEffectKind.BURN,
    StatusEffectKind.POISON,
    StatusEffectKind.BLEED,
    StatusEffectKind.HELLFIRE
  ])('reduces %s ticks for every boss unless that boss is fully immune', kind => {
    for (const [type, def] of bossEntries) {
      const faction = factionFor(def);
      const ordinaryDamage = statusDamage(type as EnemyType, faction, kind, false);
      const bossDamage = statusDamage(type as EnemyType, faction, kind, true);

      if (ordinaryDamage === 0) {
        expect(bossDamage, `${type} ${kind}`).toBe(0);
      } else {
        expect(bossDamage / ordinaryDamage, `${type} ${kind}`)
          .toBeCloseTo(BOSS_DOT_DAMAGE_MULTIPLIER, 5);
      }
    }
  });

  it('applies the same boss ward to burning ground', () => {
    const ordinaryState = createGameState();
    const ordinary = makeEnemy(EnemyType.FERAL_DOG, EnemyFaction.DOGS, false, 'ordinary');
    ordinaryState.enemies.set(ordinary.id, ordinary);
    ordinaryState.burnPatches = [{
      id: 'ordinary-patch',
      x: ordinary.x,
      y: ordinary.y,
      born: 0,
      life: 3,
      sourceTier: 1
    }];

    const bossState = createGameState();
    const boss = makeEnemy(EnemyType.FERAL_DOG, EnemyFaction.DOGS, true, 'boss');
    bossState.enemies.set(boss.id, boss);
    bossState.burnPatches = [{
      id: 'boss-patch',
      x: boss.x,
      y: boss.y,
      born: 0,
      life: 3,
      sourceTier: 1
    }];

    tickBurnPatches(ordinaryState, 1);
    tickBurnPatches(bossState, 1);

    const ordinaryDamage = ordinary.maxHp - ordinary.hp;
    const bossDamage = boss.maxHp - boss.hp;
    expect(bossDamage / ordinaryDamage).toBeCloseTo(BOSS_DOT_DAMAGE_MULTIPLIER, 5);
  });
});
