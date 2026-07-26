import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import enemiesData from '../src/data/enemies.json';
import { createGameState } from '../src/GameState';
import { tickCommanderSupport } from '../src/systems/CommanderSystem';
import { enemyHealthRecoveryMult, scaleEnemyHealthRecovery } from '../src/systems/EnemyHealing';
import {
  enemyDamageMultiplier,
  enemyResistanceProfile,
  statusEffectiveness
} from '../src/systems/EnemyResistances';
import {
  DamageType,
  EnemyFaction,
  EnemyType,
  StatusEffectKind
} from '../src/types';

const ANUBIS_PRIEST_FAMILY = [
  EnemyType.ANUBIS_PRIEST,
  EnemyType.ANUBIS_PRIEST_COMMANDER,
  EnemyType.SKY_ANUBIS_COMMANDER
] as const;

function resistanceEnemy(type: EnemyType): any {
  const def: any = (enemiesData as any)[type];
  return {
    type,
    faction: EnemyFaction.EGYPTIANS,
    isFlyer: !!def.isFlyer,
    mutation: undefined
  };
}

describe('Anubis Priest family counterplay', () => {
  it('makes Poison the decisive weakness for every base and commander variant', () => {
    for (const type of ANUBIS_PRIEST_FAMILY) {
      const def: any = (enemiesData as any)[type];
      const enemy = resistanceEnemy(type);

      expect(def.poisonWeaknessPct, type).toBe(400);
      expect(def.immunePoison, type).not.toBe(true);
      expect(def.dotImmune, type).not.toBe(true);
      expect(enemyResistanceProfile(type).poison, type).toBe(5);
      expect(statusEffectiveness(enemy, StatusEffectKind.POISON), type).toBeCloseTo(3.75, 6);
      expect(statusEffectiveness(enemy, StatusEffectKind.POISON), type).toBeGreaterThan(
        Math.max(
          statusEffectiveness(enemy, StatusEffectKind.BURN),
          statusEffectiveness(enemy, StatusEffectKind.BLEED),
          enemyDamageMultiplier(enemy, DamageType.SIEGE)
        )
      );
    }
  });

  it('cuts personal health recovery in half for the whole family', () => {
    for (const type of ANUBIS_PRIEST_FAMILY) {
      expect(enemyHealthRecoveryMult(type), type).toBe(0.5);
      expect(scaleEnemyHealthRecovery(type, 10), type).toBe(5);
    }
    expect(enemyHealthRecoveryMult(EnemyType.FERAL_DOG)).toBe(1);
    expect(scaleEnemyHealthRecovery(EnemyType.FERAL_DOG, 10)).toBe(10);
  });

  it('reduces the base priest slow and healing aura', () => {
    expect((enemiesData as any).ANUBIS_PRIEST).toMatchObject({
      auraTowerSlow: 0.15,
      healAllyPctPerSec: 0.01,
      healthRecoveryMult: 0.5,
      poisonWeaknessPct: 400
    });
  });

  it('reduces both commander healing pulses and nullifying auras', () => {
    expect((enemiesData as any).ANUBIS_PRIEST_COMMANDER).toMatchObject({
      nullifyAuraRadiusTiles: 1.5,
      commanderHealPulsePeriodSec: 5,
      commanderHealPulsePct: 0.04,
      commanderHealPulseRadiusTiles: 3
    });
    expect((enemiesData as any).SKY_ANUBIS_COMMANDER).toMatchObject({
      nullifyAuraRadiusTiles: 1.25,
      commanderHealPulsePeriodSec: 5,
      commanderHealPulsePct: 0.035,
      commanderHealPulseRadiusTiles: 4
    });
  });

  it('uses the five-second ground pulse and halves healing received by a base priest', () => {
    const state = createGameState();
    state.tick = 0;
    state.wave = 24;
    const commander: any = {
      id: 'anubis-commander',
      type: EnemyType.ANUBIS_PRIEST_COMMANDER,
      hp: 100,
      maxHp: 100,
      isBoss: false,
      isFlyer: false,
      x: 0,
      y: 0
    };
    const ordinaryTarget: any = {
      id: 'ordinary-target',
      type: EnemyType.FERAL_DOG,
      hp: 50,
      maxHp: 100,
      isBoss: false,
      isFlyer: false,
      x: 32,
      y: 0
    };
    const priestTarget: any = {
      id: 'priest-target',
      type: EnemyType.ANUBIS_PRIEST,
      hp: 50,
      maxHp: 100,
      isBoss: false,
      isFlyer: false,
      x: 64,
      y: 0
    };
    state.enemies.set(commander.id, commander);
    state.enemies.set(ordinaryTarget.id, ordinaryTarget);
    state.enemies.set(priestTarget.id, priestTarget);

    tickCommanderSupport(state, 0.016);
    expect(ordinaryTarget.hp).toBeCloseTo(54, 6);
    expect(priestTarget.hp).toBeCloseTo(52, 6);
    expect(commander.__anubisPulseAt).toBe(5);

    state.tick = 4.99;
    tickCommanderSupport(state, 0.016);
    expect(ordinaryTarget.hp).toBeCloseTo(54, 6);

    state.tick = 5;
    tickCommanderSupport(state, 0.016);
    expect(ordinaryTarget.hp).toBeCloseTo(58, 6);
  });

  it('keeps the new counter and reduced abilities visible in inspect and Codex', () => {
    const inspect = readFileSync('src/render/EnemyInspect.ts', 'utf8');
    const codex = readFileSync('src/render/Codex.ts', 'utf8');

    expect(inspect).toContain('POISON WEAKNESS');
    expect(inspect).toContain('REDUCED HEALTH RECOVERY');
    expect(inspect).toContain('PRIEST HEALING PULSE');
    expect(inspect).toContain('NULLIFYING AURA');
    expect(codex).toContain('Anubis Priest Poison Counter');
    expect(codex).toContain('3.75× Poison effectiveness');
  });
});
