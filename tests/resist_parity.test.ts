// Resist-layer parity net (2026-07-09 deep QC).
//
// Two real bugs motivated this file:
//   1. EnemyFaction.ROMAN_MYTH was missing from DamageTypeSystem.FACTION_KEYS,
//      so every W25-29 myth enemy silently took FULL damage from every damage
//      type — the exact failure mode the MONGOLS/EGYPTIANS comment warns
//      about. The armor UI (armorProfile reads the JSON row by STRING key)
//      kept showing the resists the engine never applied.
//   2. armorProfile multiplied the faction DIVINE column into the display
//      even though combat's resistanceModifier hard-returns 1.0 for DIVINE,
//      advertising divine damage the engine never deals (and hiding the
//      Daemon Imperator's real per-enemy 0.70 divine RESIST).
//
// These tests pin the whole seam so a new faction / damage type / display
// surface can't silently drift again.
import { describe, expect, it } from 'vitest';
import enemiesData from '../src/data/enemies.json';
import factionRes from '../src/data/factionResistances.json';
import wavesData from '../src/data/waves.json';
import towersData from '../src/data/towers.json';
import combosData from '../src/data/towerCombinations.json';
import { DamageType, EnemyFaction, EnemyType } from '../src/types';
import { resistanceModifier } from '../src/systems/DamageTypeSystem';
import { armorProfile, enemyDamageMultiplier } from '../src/systems/EnemyResistances';

const DAMAGE_TYPES: Array<[string, DamageType]> = [
  ['PHYS_MELEE', DamageType.PHYS_MELEE],
  ['PHYS_RANGED', DamageType.PHYS_RANGED],
  ['SIEGE', DamageType.SIEGE],
  ['ELEMENTAL_FIRE', DamageType.ELEMENTAL_FIRE],
  ['DIVINE', DamageType.DIVINE]
];

// Baseline fake enemy: no wave stamps, not a flyer (the +20% flyer siege
// bonus is a runtime-only stamp the armor UI intentionally omits).
function fakeEnemy(type: string): any {
  return { type, isFlyer: false, isBoss: false, statusEffects: [], mutation: undefined };
}

describe('faction resist wiring', () => {
  it('every enemies.json faction has a factionResistances.json row', () => {
    const factions = new Set(Object.values(enemiesData as any).map((e: any) => e.faction));
    for (const f of factions) {
      expect((factionRes as any)[f as string], `faction ${f} missing from factionResistances.json`).toBeTruthy();
    }
  });

  it('every enemies.json faction maps through the enum into resistanceModifier (no dead rows)', () => {
    const factions = new Set(Object.values(enemiesData as any).map((e: any) => e.faction as string));
    for (const f of factions) {
      const enumVal = (EnemyFaction as any)[f];
      expect(enumVal, `faction string ${f} has no EnemyFaction enum member`).toBeDefined();
      const row = (factionRes as any)[f];
      for (const [key, dt] of DAMAGE_TYPES) {
        const actual = resistanceModifier(enumVal, dt);
        const raw = row[key];
        const expected = dt === DamageType.DIVINE
          ? 1.0 // combat rule: DIVINE ignores the faction layer entirely
          : raw === 'IMMUNE' ? 0
          : typeof raw === 'number' ? 1 + raw
          : 1.0;
        expect(actual, `${f} × ${key}: resistanceModifier returned ${actual}, faction row says ${expected}`).toBeCloseTo(expected, 9);
      }
    }
  });

  it('ROMAN_MYTH faction resists are live (regression: missing FACTION_KEYS entry)', () => {
    expect(resistanceModifier(EnemyFaction.ROMAN_MYTH, DamageType.PHYS_MELEE)).toBeCloseTo(0.85, 9);
    expect(resistanceModifier(EnemyFaction.ROMAN_MYTH, DamageType.SIEGE)).toBeCloseTo(0.80, 9);
  });
});

describe('armor display ↔ combat runtime parity', () => {
  it('armorProfile finalMult equals the baseline combat multiplier for every enemy × damage type', () => {
    for (const type of Object.keys(enemiesData as any)) {
      const rows = armorProfile(type as EnemyType);
      expect(rows.length, `armorProfile empty for ${type}`).toBe(5);
      const def: any = (enemiesData as any)[type];
      const factionEnum = (EnemyFaction as any)[def.faction];
      const enemy = fakeEnemy(type);
      for (const row of rows) {
        const dt = DAMAGE_TYPES.find(([k]) => k === row.damageType)![1];
        const runtime = resistanceModifier(factionEnum, dt) * enemyDamageMultiplier(enemy, dt);
        expect(row.finalMult, `${type} × ${row.damageType}: UI shows ×${row.finalMult}, combat deals ×${runtime}`).toBeCloseTo(runtime, 6);
      }
    }
  });
});

describe('data reference integrity', () => {
  it('every wave spawn type exists in enemies.json', () => {
    for (const wave of wavesData as any[]) {
      for (const group of wave.spawns) {
        expect((enemiesData as any)[group.type], `W${wave.wave} spawns unknown enemy ${group.type}`).toBeTruthy();
      }
    }
  });

  it('every combo recipe result and ingredient exists in towers.json', () => {
    for (const combo of combosData as any[]) {
      expect((towersData as any)[combo.result], `recipe result ${combo.result} missing from towers.json`).toBeTruthy();
      for (const ing of combo.ingredients) {
        expect((towersData as any)[ing.type], `recipe ${combo.result} ingredient ${ing.type} missing from towers.json`).toBeTruthy();
      }
    }
  });
});
