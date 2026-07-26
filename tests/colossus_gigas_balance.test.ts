import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import enemiesData from '../src/data/enemies.json';
import { resistanceModifier } from '../src/systems/DamageTypeSystem';
import {
  armorProfile,
  enemyDamageMultiplier,
  enemyResistanceProfile,
  resistanceSummary
} from '../src/systems/EnemyResistances';
import { DamageType, EnemyFaction, EnemyType } from '../src/types';

function colossus(): any {
  return {
    id: 'colossus-gigas',
    type: EnemyType.SUPER_GIANT_COLOSSUS,
    faction: EnemyFaction.ROMAN_MYTH,
    hp: 100,
    maxHp: 100,
    baseSpeed: 1,
    currentSpeed: 1,
    isFlyer: false,
    x: 0,
    y: 0,
    pathIndex: 0,
    pathProgress: 0,
    statusEffects: [],
    hasFeared: false,
    livesCost: 5,
    isBoss: false,
    reward: 0,
    archetype: 'BULKY',
    hpFlashTimer: 0
  };
}

describe('Colossus Gigas damage counterplay', () => {
  it('takes 3x final Siege damage after its Roman Myth faction ward', () => {
    const def: any = (enemiesData as any).SUPER_GIANT_COLOSSUS;
    const enemy = colossus();
    const perEnemy = enemyDamageMultiplier(enemy, DamageType.SIEGE);
    const final = resistanceModifier(enemy.faction, DamageType.SIEGE) * perEnemy;
    const armor = armorProfile(EnemyType.SUPER_GIANT_COLOSSUS)
      .find(row => row.damageType === 'SIEGE');

    expect(def.siegeWeaknessPct).toBe(275);
    expect(enemyResistanceProfile(enemy.type).siege).toBe(3.75);
    expect(perEnemy).toBe(3.75);
    expect(final).toBeCloseTo(3, 6);
    expect(armor).toMatchObject({ finalMult: 3, armorPct: -200, immune: false });
  });

  it('takes Divine damage with exactly 80% final resistance', () => {
    const def: any = (enemiesData as any).SUPER_GIANT_COLOSSUS;
    const enemy = colossus();
    const final = resistanceModifier(enemy.faction, DamageType.DIVINE)
      * enemyDamageMultiplier(enemy, DamageType.DIVINE);
    const armor = armorProfile(EnemyType.SUPER_GIANT_COLOSSUS)
      .find(row => row.damageType === 'DIVINE');
    const summary = resistanceSummary(EnemyType.SUPER_GIANT_COLOSSUS)
      .find(row => row.label === 'Divine');

    expect(def.divineImmune).not.toBe(true);
    expect(def.divineResistancePct).toBe(80);
    expect(final).toBeCloseTo(0.2, 6);
    expect(armor).toMatchObject({ armorPct: 80, immune: false });
    expect(armor?.finalMult).toBeCloseTo(0.2, 6);
    expect(summary?.label).toBe('Divine');
    expect(summary?.value).toBeCloseTo(0.2, 6);
  });

  it('publishes the exact counter in enemy UI and the Wave 25 warning', () => {
    const inspect = readFileSync('src/render/EnemyInspect.ts', 'utf8');
    const codex = readFileSync('src/render/Codex.ts', 'utf8');
    const warning = readFileSync('src/render/BossWarning.ts', 'utf8');

    expect(inspect).toContain('DIVINE RESISTANCE');
    expect(inspect).toContain('SIEGE WEAKNESS');
    expect(codex).toContain('DIVINE RESISTANCE');
    expect(codex).toContain('SIEGE WEAKNESS');
    expect(codex).toContain('Colossus Gigas is the exception');
    expect(warning).toContain('SIEGE: it deals 3x final damage');
    expect(warning).toContain('DIVINE still lands, but 80% is resisted');
    expect(warning).not.toContain('Bring DIVINE. Bring burst.');
  });
});
