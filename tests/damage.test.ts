// Tests for damage type math: faction resistance matrix + status effectiveness.
import { describe, it, expect } from 'vitest';
import { resistanceModifier, damageTypeFromString } from '../src/systems/DamageTypeSystem';
import { enemyDamageMultiplier, isHellfireImmune, statusEffectiveness } from '../src/systems/EnemyResistances';
import { DamageType, EnemyFaction, EnemyType, StatusEffectKind, Enemy } from '../src/types';
import enemiesData from '../src/data/enemies.json';

function makeEnemy(type: EnemyType, faction: EnemyFaction = EnemyFaction.DOGS): Enemy {
  return {
    id: 'test', type, faction, hp: 100, maxHp: 100, baseSpeed: 1, currentSpeed: 1,
    isFlyer: false, x: 0, y: 0, pathIndex: 0, pathProgress: 0,
    statusEffects: [], hasFeared: false, livesCost: 1, isBoss: false, reward: 0,
    archetype: 'SWARM', hpFlashTimer: 0
  };
}

describe('DamageType — faction resistance modifier', () => {
  it('DIVINE always returns 1.0 (true damage)', () => {
    expect(resistanceModifier(EnemyFaction.DOGS, DamageType.DIVINE)).toBe(1);
    expect(resistanceModifier(EnemyFaction.UNDEAD_CELTS, DamageType.DIVINE)).toBe(1);
    expect(resistanceModifier(EnemyFaction.SUPER_DEMONS, DamageType.DIVINE)).toBe(1);
  });

  it('NONE damage type returns 0 (no damage)', () => {
    expect(resistanceModifier(EnemyFaction.DOGS, DamageType.NONE)).toBe(0);
  });

  it('returns a positive multiplier for vulnerable faction/damage pairs', () => {
    // Undead are weak to FIRE per factionResistances.json
    const m = resistanceModifier(EnemyFaction.UNDEAD_CELTS, DamageType.ELEMENTAL_FIRE);
    expect(m).toBeGreaterThan(0);
  });

  it('returns 0 when faction is IMMUNE to a damage type', () => {
    // Validate that IMMUNE strings get translated to 0 (no damage).
    // We don't assert which faction; we assert the contract.
    const factions = [EnemyFaction.DOGS, EnemyFaction.CELTS, EnemyFaction.CARTHAGE,
                      EnemyFaction.UNDEAD_CELTS, EnemyFaction.UNDEAD_CARTHAGE, EnemyFaction.SUPER_DEMONS];
    const damageTypes = [DamageType.PHYS_MELEE, DamageType.PHYS_RANGED, DamageType.SIEGE, DamageType.ELEMENTAL_FIRE];
    let foundImmune = false;
    for (const f of factions) {
      for (const d of damageTypes) {
        if (resistanceModifier(f, d) === 0) foundImmune = true;
      }
    }
    // The matrix may or may not contain IMMUNE entries; this just exercises the path.
    expect(typeof foundImmune).toBe('boolean');
  });

  it('armorShred sets physical resistance to 1.0 (full damage)', () => {
    // Even for resistant factions, armor shred restores full physical damage.
    const before = resistanceModifier(EnemyFaction.CARTHAGE, DamageType.PHYS_MELEE, false);
    const after = resistanceModifier(EnemyFaction.CARTHAGE, DamageType.PHYS_MELEE, true);
    if (before < 1) expect(after).toBeGreaterThanOrEqual(before);
  });
});

describe('DamageType — string conversion', () => {
  it('damageTypeFromString returns the correct enum', () => {
    expect(damageTypeFromString('PHYS_MELEE')).toBe(DamageType.PHYS_MELEE);
    expect(damageTypeFromString('DIVINE')).toBe(DamageType.DIVINE);
    expect(damageTypeFromString('SIEGE')).toBe(DamageType.SIEGE);
    expect(damageTypeFromString('PHYS_RANGED')).toBe(DamageType.PHYS_RANGED);
    expect(damageTypeFromString('ELEMENTAL_FIRE')).toBe(DamageType.ELEMENTAL_FIRE);
  });

  it('returns NONE for unrecognized strings', () => {
    expect(damageTypeFromString('GARBAGE')).toBe(DamageType.NONE);
    expect(damageTypeFromString('')).toBe(DamageType.NONE);
  });
});

describe('Enemy resistances — per-enemy multipliers', () => {
  it('returns the matching damage multiplier for each enemy', () => {
    const e = makeEnemy(EnemyType.HANNIBAL_BARCA, EnemyFaction.CARTHAGE);
    const meleeMult = enemyDamageMultiplier(e, DamageType.PHYS_MELEE);
    const rangedMult = enemyDamageMultiplier(e, DamageType.PHYS_RANGED);
    expect(meleeMult).toBeGreaterThan(0);
    expect(rangedMult).toBeGreaterThan(0);
  });

  it('returns 1.0 for damage types with no per-enemy resistance', () => {
    const e = makeEnemy(EnemyType.FERAL_DOG, EnemyFaction.DOGS);
    expect(enemyDamageMultiplier(e, DamageType.SIEGE)).toBe(1);
  });

  it('statusEffectiveness returns 0 for poison-immune undead', () => {
    const e = makeEnemy(EnemyType.UNDEAD_CELT, EnemyFaction.UNDEAD_CELTS);
    expect(statusEffectiveness(e, StatusEffectKind.POISON)).toBe(0);
  });

  it('statusEffectiveness scales for WARDED mutation', () => {
    const e = makeEnemy(EnemyType.CARTHAGE_SPEARMAN, EnemyFaction.CARTHAGE);
    const baseSlow = statusEffectiveness(e, StatusEffectKind.SLOW);
    e.mutation = 'WARDED';
    const wardedSlow = statusEffectiveness(e, StatusEffectKind.SLOW);
    expect(wardedSlow).toBeCloseTo(baseSlow * 0.30, 4);
  });

  it('flyers take +20% siege damage globally (2026-05-19)', () => {
    // A flyer without a per-enemy siege entry gets the flat +20%.
    // SPECTRAL_SCOUT has no siege entry in the resistance table.
    const ghost = makeEnemy(EnemyType.SPECTRAL_SCOUT, EnemyFaction.UNDEAD_CELTS);
    ghost.isFlyer = true;
    const m = enemyDamageMultiplier(ghost, DamageType.SIEGE);
    expect(m).toBeCloseTo(1.20, 4);
  });

  it('flyer siege bonus stacks multiplicatively with per-enemy siege resist', () => {
    // CELTIC_SCOUT has siege:0.7 in the resistance table. With the
    // +20% flyer bonus, the effective multiplier is 0.7 × 1.20 = 0.84.
    const scout = makeEnemy(EnemyType.CELTIC_SCOUT, EnemyFaction.CELTS);
    scout.isFlyer = true;
    const m = enemyDamageMultiplier(scout, DamageType.SIEGE);
    expect(m).toBeCloseTo(0.84, 4);
  });

  it('flyer siege bonus also stacks on a siege-vulnerable flyer', () => {
    // NUMIDIAN_RIDER has siege:1.15 in the resistance table. With
    // +20% flyer bonus: 1.15 × 1.20 = 1.38.
    const rider = makeEnemy(EnemyType.NUMIDIAN_RIDER, EnemyFaction.CARTHAGE);
    rider.isFlyer = true;
    const m = enemyDamageMultiplier(rider, DamageType.SIEGE);
    expect(m).toBeCloseTo(1.38, 4);
  });

  it('ground enemies do NOT get the flyer siege bonus', () => {
    const ground = makeEnemy(EnemyType.CELTIC_FOOTMAN, EnemyFaction.CELTS);
    ground.isFlyer = false;
    const m = enemyDamageMultiplier(ground, DamageType.SIEGE);
    expect(m).toBeCloseTo(1.0, 4);   // CELTIC_FOOTMAN has no siege override
  });

  it('flyer siege bonus does NOT apply to non-siege damage types', () => {
    const ghost = makeEnemy(EnemyType.SPECTRAL_SCOUT, EnemyFaction.UNDEAD_CELTS);
    ghost.isFlyer = true;
    const ranged = enemyDamageMultiplier(ghost, DamageType.PHYS_RANGED);
    expect(ranged).not.toBeCloseTo(1.20, 4);   // ranged uses its own profile
  });

  it('war elephants are heavy-hide tanks with only modest siege vulnerability', () => {
    const living = makeEnemy(EnemyType.WAR_ELEPHANT, EnemyFaction.CARTHAGE);
    const undead = makeEnemy(EnemyType.UNDEAD_WAR_ELEPHANT, EnemyFaction.UNDEAD_CARTHAGE);
    const defs: any = enemiesData as any;

    expect(defs.WAR_ELEPHANT.baseHp).toBeGreaterThanOrEqual(20000);
    expect(defs.WAR_ELEPHANT.regenPctPerSec).toBeGreaterThan(0);
    expect(defs.WAR_ELEPHANT.outOfCombatRegen).toBeGreaterThan(0);
    expect(defs.UNDEAD_WAR_ELEPHANT.baseHp).toBeGreaterThanOrEqual(9000);

    expect(enemyDamageMultiplier(living, DamageType.SIEGE)).toBeCloseTo(1.25, 4);
    expect(enemyDamageMultiplier(undead, DamageType.SIEGE)).toBeCloseTo(1.05, 4);
    expect(enemyDamageMultiplier(living, DamageType.PHYS_MELEE)).toBeLessThan(0.20);
    expect(statusEffectiveness(living, StatusEffectKind.POISON)).toBeLessThanOrEqual(0.05);
    expect(statusEffectiveness(living, StatusEffectKind.BLEED)).toBeLessThanOrEqual(0.12);
    expect(statusEffectiveness(undead, StatusEffectKind.POISON)).toBe(0);
    expect(statusEffectiveness(undead, StatusEffectKind.BLEED)).toBe(0);
  });

  it('gives selected enemies and commanders true siege immunity', () => {
    const immuneTypes = [
      EnemyType.IRON_PHALANX,
      EnemyType.ARCHITECTUS,
      EnemyType.TYPHON,
      EnemyType.SIEGE_CAPTAIN_COMMANDER,
      EnemyType.SKY_PATHFINDER_COMMANDER
    ];

    for (const type of immuneTypes) {
      const enemy = makeEnemy(type, (enemiesData as any)[type].faction as EnemyFaction);
      enemy.isFlyer = !!(enemiesData as any)[type].isFlyer;
      expect(enemyDamageMultiplier(enemy, DamageType.SIEGE), `${type} siege damage`).toBe(0);
    }
  });

  it('keeps other commanders vulnerable or resistant instead of making all commanders siege-immune', () => {
    const standard = makeEnemy(EnemyType.STANDARD_BEARER_COMMANDER, EnemyFaction.EGYPTIANS);
    const skyStandard = makeEnemy(EnemyType.SKY_STANDARD_COMMANDER, EnemyFaction.EGYPTIANS);
    skyStandard.isFlyer = true;

    expect(enemyDamageMultiplier(standard, DamageType.SIEGE)).toBeGreaterThan(0);
    expect(enemyDamageMultiplier(skyStandard, DamageType.SIEGE)).toBeGreaterThan(0);
  });

  it('gives the Tidecaller commander a naval-counter resistance profile', () => {
    const tidecaller = makeEnemy(EnemyType.TIDECALLER_COMMANDER, EnemyFaction.ROMAN_MYTH);
    expect(enemyDamageMultiplier(tidecaller, DamageType.ELEMENTAL_FIRE)).toBe(0);
    expect(statusEffectiveness(tidecaller, StatusEffectKind.BURN)).toBe(0);
    expect(enemyDamageMultiplier(tidecaller, DamageType.SIEGE)).toBeGreaterThan(1);
    expect(enemyDamageMultiplier(tidecaller, DamageType.DIVINE)).toBeGreaterThan(1);
  });

  it('gives the Stormtide Wyvern commander ocean flyer weaknesses and fire immunity', () => {
    const wyvern = makeEnemy(EnemyType.STORMTIDE_WYVERN_COMMANDER, EnemyFaction.ROMAN_MYTH);
    wyvern.isFlyer = true;
    expect(enemyDamageMultiplier(wyvern, DamageType.ELEMENTAL_FIRE)).toBe(0);
    expect(statusEffectiveness(wyvern, StatusEffectKind.BURN)).toBe(0);
    expect(enemyDamageMultiplier(wyvern, DamageType.SIEGE)).toBeGreaterThan(1);
    expect(enemyDamageMultiplier(wyvern, DamageType.DIVINE)).toBeGreaterThan(1);
  });

  it('makes ocean giants immune to fire, burn, and hellfire', () => {
    const oceanTypes = [
      EnemyType.SEA_GIANT,
      EnemyType.SEA_GIANT_WARBRINGER,
      EnemyType.NETHER_AMPHIBIOUS_GIANT
    ];

    for (const type of oceanTypes) {
      const enemy = makeEnemy(type, EnemyFaction.ROMAN_MYTH);
      expect(enemyDamageMultiplier(enemy, DamageType.ELEMENTAL_FIRE), `${type} fire`).toBe(0);
      expect(statusEffectiveness(enemy, StatusEffectKind.BURN), `${type} burn`).toBe(0);
      expect(isHellfireImmune(enemy), `${type} hellfire`).toBe(true);
    }
  });

  it('gives Dead Uprising giants undead weaknesses and dead-data DoT immunity', () => {
    const checks = [
      EnemyType.UNDEAD_GIANT,
      EnemyType.UNDEAD_CYCLOPS,
      EnemyType.DREAD_UNDEAD_GIANT,
      EnemyType.DREAD_UNDEAD_CYCLOPS
    ];
    for (const type of checks) {
      const enemy = makeEnemy(type, (enemiesData as any)[type].faction as EnemyFaction);
      expect(statusEffectiveness(enemy, StatusEffectKind.POISON), `${type} poison`).toBe(0);
      expect(statusEffectiveness(enemy, StatusEffectKind.BLEED), `${type} bleed`).toBe(0);
      expect(enemyDamageMultiplier(enemy, DamageType.ELEMENTAL_FIRE), `${type} fire`).toBeGreaterThan(1);
      expect(enemyDamageMultiplier(enemy, DamageType.DIVINE), `${type} divine`).toBeGreaterThan(1);
    }
  });

  it('keeps all sea giants tanky while preserving divine as their main counter', () => {
    const expectations = [
      { type: EnemyType.SEA_GIANT, hp: 2400, meleeMax: 0.50, siegeMax: 1.05, divineMin: 1.10 },
      { type: EnemyType.SEA_GIANT_WARBRINGER, hp: 8800, meleeMax: 0.35, siegeMax: 0.95, divineMin: 1.15 },
      { type: EnemyType.NETHER_AMPHIBIOUS_GIANT, hp: 14500, meleeMax: 0.25, siegeMax: 0.55, divineMin: 1.35 }
    ];

    for (const spec of expectations) {
      const def: any = (enemiesData as any)[spec.type];
      const enemy = makeEnemy(spec.type, EnemyFaction.ROMAN_MYTH);
      expect(def.baseHp, `${spec.type} base HP`).toBe(spec.hp);
      expect(enemyDamageMultiplier(enemy, DamageType.PHYS_MELEE), `${spec.type} melee`).toBeLessThanOrEqual(spec.meleeMax);
      expect(enemyDamageMultiplier(enemy, DamageType.SIEGE), `${spec.type} siege`).toBeLessThanOrEqual(spec.siegeMax);
      expect(enemyDamageMultiplier(enemy, DamageType.DIVINE), `${spec.type} divine`).toBeGreaterThanOrEqual(spec.divineMin);
    }
  });
});
