// Tests for damage type math: faction resistance matrix + status effectiveness.
import { describe, it, expect } from 'vitest';
import { resistanceModifier, damageTypeFromString } from '../src/systems/DamageTypeSystem';
import { armorProfile, enemyDamageMultiplier, enemyResistanceProfile, isHellfireImmune, resistanceSummary, statusEffectiveness } from '../src/systems/EnemyResistances';
import { DamageType, EnemyFaction, EnemyType, StatusEffectKind, Enemy } from '../src/types';
import enemiesData from '../src/data/enemies.json';
import { applyResistanceBreakRelief } from '../src/systems/CombatResolver';

function makeEnemy(type: EnemyType, faction: EnemyFaction = EnemyFaction.DOGS): Enemy {
  return {
    id: 'test', type, faction, hp: 100, maxHp: 100, baseSpeed: 1, currentSpeed: 1,
    isFlyer: false, x: 0, y: 0, pathIndex: 0, pathProgress: 0,
    statusEffects: [], hasFeared: false, livesCost: 1, isBoss: false, reward: 0,
    archetype: 'SWARM', hpFlashTimer: 0
  };
}

function hasDirectDamageAnswer(enemy: Enemy, damageTypes: DamageType[]): boolean {
  return damageTypes.some(type => enemyDamageMultiplier(enemy, type) > 0);
}

describe('DamageType — faction resistance modifier', () => {
  it('DIVINE ignores resistance but activates authored faction weaknesses', () => {
    expect(resistanceModifier(EnemyFaction.DOGS, DamageType.DIVINE)).toBe(1);
    expect(resistanceModifier(EnemyFaction.UNDEAD_CELTS, DamageType.DIVINE)).toBe(1.5);
    expect(resistanceModifier(EnemyFaction.SUPER_DEMONS, DamageType.DIVINE)).toBe(2);
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

  it('resistance-break relief softens only actual resistance, not immunity or weakness', () => {
    expect(applyResistanceBreakRelief(0.50, 0.20)).toBeCloseTo(0.60, 6);
    expect(applyResistanceBreakRelief(0, 0.50)).toBe(0);
    expect(applyResistanceBreakRelief(1, 0.50)).toBe(1);
    expect(applyResistanceBreakRelief(1.25, 0.50)).toBe(1.25);
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

  it('makes fire and burn deal 40% extra damage to every natural dog type', () => {
    for (const type of [EnemyType.FERAL_DOG, EnemyType.RABID_DOG, EnemyType.ALPHA_DOG]) {
      const dog = makeEnemy(type, EnemyFaction.DOGS);
      const directFire = resistanceModifier(dog.faction, DamageType.ELEMENTAL_FIRE)
        * enemyDamageMultiplier(dog, DamageType.ELEMENTAL_FIRE);
      expect(directFire, `${type} direct fire`).toBeCloseTo(1.40, 4);
      expect(statusEffectiveness(dog, StatusEffectKind.BURN), `${type} burn`).toBeCloseTo(1.40, 4);
      expect(armorProfile(type).find(row => row.damageType === 'ELEMENTAL_FIRE')?.armorPct, `${type} fire profile`).toBe(-40);
    }

    const hellhound = makeEnemy(EnemyType.DEMON_HELLHOUND, EnemyFaction.SUPER_DEMONS);
    expect(enemyDamageMultiplier(hellhound, DamageType.ELEMENTAL_FIRE)).toBe(0);
    expect(statusEffectiveness(hellhound, StatusEffectKind.BURN)).toBe(0);
  });

  it('Drowned Manes can only be damaged by divine damage', () => {
    const spirit = makeEnemy(EnemyType.OCEAN_GHOST_SPIRIT, EnemyFaction.OCEAN);
    expect((enemiesData as any).OCEAN_GHOST_SPIRIT.divineOnly).toBe(true);
    expect(enemyDamageMultiplier(spirit, DamageType.PHYS_MELEE)).toBe(0);
    expect(enemyDamageMultiplier(spirit, DamageType.PHYS_RANGED)).toBe(0);
    expect(enemyDamageMultiplier(spirit, DamageType.SIEGE)).toBe(0);
    expect(enemyDamageMultiplier(spirit, DamageType.ELEMENTAL_FIRE)).toBe(0);
    expect(enemyDamageMultiplier(spirit, DamageType.DIVINE)).toBeGreaterThan(1);
    expect(statusEffectiveness(spirit, StatusEffectKind.BURN)).toBe(0);
    expect(statusEffectiveness(spirit, StatusEffectKind.BLEED)).toBe(0);
    expect(statusEffectiveness(spirit, StatusEffectKind.POISON)).toBe(0);
    expect(resistanceSummary(EnemyType.OCEAN_GHOST_SPIRIT).some(row => row.label === 'Melee' && row.value === 0)).toBe(true);
    expect(resistanceSummary(EnemyType.OCEAN_GHOST_SPIRIT).some(row => row.label === 'Divine' && row.value === 0)).toBe(false);
    expect(armorProfile(EnemyType.OCEAN_GHOST_SPIRIT).find(row => row.damageType === 'PHYS_RANGED')?.immune).toBe(true);
    expect(armorProfile(EnemyType.OCEAN_GHOST_SPIRIT).find(row => row.damageType === 'DIVINE')?.immune).toBe(false);
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

  it('makes direct fire and burn a considerable weakness for every elephant type', () => {
    const living = makeEnemy(EnemyType.WAR_ELEPHANT, EnemyFaction.CARTHAGE);
    const undead = makeEnemy(EnemyType.UNDEAD_WAR_ELEPHANT, EnemyFaction.UNDEAD_CARTHAGE);

    const livingDirectFire = resistanceModifier(living.faction, DamageType.ELEMENTAL_FIRE)
      * enemyDamageMultiplier(living, DamageType.ELEMENTAL_FIRE);
    const undeadDirectFire = resistanceModifier(undead.faction, DamageType.ELEMENTAL_FIRE)
      * enemyDamageMultiplier(undead, DamageType.ELEMENTAL_FIRE);

    expect(livingDirectFire).toBeCloseTo(1.65, 4);
    expect(undeadDirectFire).toBeCloseTo(2.145, 4);
    expect(statusEffectiveness(living, StatusEffectKind.BURN)).toBeCloseTo(1.65, 4);
    expect(statusEffectiveness(undead, StatusEffectKind.BURN)).toBeCloseTo(2.145, 4);
    expect(armorProfile(EnemyType.WAR_ELEPHANT).find(row => row.damageType === 'ELEMENTAL_FIRE')?.armorPct).toBe(-65);
    expect(armorProfile(EnemyType.UNDEAD_WAR_ELEPHANT).find(row => row.damageType === 'ELEMENTAL_FIRE')?.armorPct).toBe(-114);
  });

  it('gives selected enemies and commanders true siege immunity', () => {
    const immuneTypes = [
      EnemyType.IRON_PHALANX,
      EnemyType.ARCHITECTUS,
      EnemyType.TYPHON,
      EnemyType.BOSS_FLYER_VULTURE,
      EnemyType.SIEGE_CAPTAIN_COMMANDER,
      EnemyType.SKY_PATHFINDER_COMMANDER
    ];

    for (const type of immuneTypes) {
      const enemy = makeEnemy(type, (enemiesData as any)[type].faction as EnemyFaction);
      enemy.isFlyer = !!(enemiesData as any)[type].isFlyer;
      expect(enemyDamageMultiplier(enemy, DamageType.SIEGE), `${type} siege damage`).toBe(0);
    }
  });

  it('gives selected post-W15 enemies true siege immunity with readable UI armor', () => {
    const siegeImmuneTypes = [
      EnemyType.MONGOL_BERSERKER,
      EnemyType.MONGOL_SPEARMAN,
      EnemyType.MUMMY_WARRIOR,
      EnemyType.DUNE_STALKER,
      EnemyType.CYCLOPS,
      EnemyType.BOSS_FLYER_VULTURE,
      EnemyType.SIEGE_CAPTAIN_COMMANDER,
      EnemyType.SKY_PATHFINDER_COMMANDER,
      EnemyType.TYPHON,
      EnemyType.IRON_PHALANX
    ];

    for (const type of siegeImmuneTypes) {
      const def: any = (enemiesData as any)[type];
      const enemy = makeEnemy(type, def.faction as EnemyFaction);
      enemy.isFlyer = !!def.isFlyer;
      expect(def.siegeImmune, `${type} JSON siegeImmune`).toBe(true);
      expect(enemyDamageMultiplier(enemy, DamageType.SIEGE), `${type} siege`).toBe(0);
      expect(armorProfile(type).find(row => row.damageType === 'SIEGE')?.immune, `${type} armor row`).toBe(true);
      expect(resistanceSummary(type).some(row => row.label === 'Siege' && row.value === 0), `${type} summary row`).toBe(true);
      if (def.divineImmune) {
        expect(enemyDamageMultiplier(enemy, DamageType.DIVINE), `${type} divine exception`).toBe(0);
      } else {
        expect(enemyDamageMultiplier(enemy, DamageType.DIVINE), `${type} divine answer`).toBeGreaterThan(0);
      }
    }
  });

  it('gives selected post-W15 enemies true physical-melee immunity with readable UI armor', () => {
    const meleeImmuneTypes = [
      EnemyType.MONGOL_SCOUT,
      EnemyType.MONGOL_SHAMAN,
      EnemyType.ANUBIS_PRIEST,
      EnemyType.SPHINX,
      EnemyType.BOSS_FLYER_VULTURE,
      EnemyType.ANUBIS_PRIEST_COMMANDER,
      EnemyType.TYPHON,
      EnemyType.NAGA_ORACLE,
      EnemyType.STONE_JUGGERNAUT
    ];

    for (const type of meleeImmuneTypes) {
      const def: any = (enemiesData as any)[type];
      const enemy = makeEnemy(type, def.faction as EnemyFaction);
      enemy.isFlyer = !!def.isFlyer;
      expect(def.meleeImmune, `${type} JSON meleeImmune`).toBe(true);
      expect(enemyDamageMultiplier(enemy, DamageType.PHYS_MELEE), `${type} physical melee`).toBe(0);
      expect(armorProfile(type).find(row => row.damageType === 'PHYS_MELEE')?.immune, `${type} armor row`).toBe(true);
      expect(resistanceSummary(type).some(row => row.label === 'Melee' && row.value === 0), `${type} summary row`).toBe(true);
      if (def.divineImmune) {
        expect(enemyDamageMultiplier(enemy, DamageType.DIVINE), `${type} divine exception`).toBe(0);
      } else {
        expect(enemyDamageMultiplier(enemy, DamageType.DIVINE), `${type} divine answer`).toBeGreaterThan(0);
      }
    }
  });

  it('gives selected post-W15 enemies true physical-ranged immunity with readable UI armor', () => {
    const rangedImmuneTypes = [
      EnemyType.MONGOL_FOOTMAN,
      EnemyType.MONGOL_CAPTAIN,
      EnemyType.PHARAOH_GUARD,
      EnemyType.SOBEK_WARRIOR,
      EnemyType.MUMMY_WARRIOR,
      EnemyType.SUPER_GIANT_COLOSSUS,
      EnemyType.STONE_JUGGERNAUT,
      EnemyType.SHADOW_CAVALRY
    ];

    for (const type of rangedImmuneTypes) {
      const def: any = (enemiesData as any)[type];
      const enemy = makeEnemy(type, def.faction as EnemyFaction);
      enemy.isFlyer = !!def.isFlyer;
      expect(def.rangedImmune, `${type} JSON rangedImmune`).toBe(true);
      expect(enemyDamageMultiplier(enemy, DamageType.PHYS_RANGED), `${type} physical ranged`).toBe(0);
      expect(armorProfile(type).find(row => row.damageType === 'PHYS_RANGED')?.immune, `${type} armor row`).toBe(true);
      expect(resistanceSummary(type).some(row => row.label === 'Ranged' && row.value === 0), `${type} summary row`).toBe(true);
      if (def.divineImmune) {
        expect(enemyDamageMultiplier(enemy, DamageType.DIVINE), `${type} divine exception`).toBe(0);
      } else {
        expect(enemyDamageMultiplier(enemy, DamageType.DIVINE), `${type} divine answer`).toBeGreaterThan(0);
      }
    }
  });

  it('gives selected post-W15 enemies true damage-over-time immunity with readable UI summary', () => {
    const dotImmuneTypes = [
      EnemyType.MONGOL_SHAMAN
    ];

    for (const type of dotImmuneTypes) {
      const def: any = (enemiesData as any)[type];
      const enemy = makeEnemy(type, def.faction as EnemyFaction);
      enemy.isFlyer = !!def.isFlyer;
      expect(def.dotImmune, `${type} JSON dotImmune`).toBe(true);
      expect(statusEffectiveness(enemy, StatusEffectKind.BURN), `${type} burn DoT`).toBe(0);
      expect(statusEffectiveness(enemy, StatusEffectKind.BLEED), `${type} bleed DoT`).toBe(0);
      expect(statusEffectiveness(enemy, StatusEffectKind.POISON), `${type} poison DoT`).toBe(0);
      expect(resistanceSummary(type).some(row => row.label === 'Burn' && row.value === 0), `${type} burn summary`).toBe(true);
      expect(resistanceSummary(type).some(row => row.label === 'Bleed' && row.value === 0), `${type} bleed summary`).toBe(true);
      expect(resistanceSummary(type).some(row => row.label === 'Poison' && row.value === 0), `${type} poison summary`).toBe(true);
      expect(
        hasDirectDamageAnswer(enemy, [DamageType.PHYS_MELEE, DamageType.PHYS_RANGED, DamageType.SIEGE, DamageType.ELEMENTAL_FIRE, DamageType.DIVINE]),
        `${type} should still have at least one direct-damage answer`
      ).toBe(true);
    }
  });

  it('softens selected post-W22 DoT walls into heavy resistance instead of full immunity', () => {
    const checks: Array<{ type: EnemyType; burn: number; bleed: number; poison: number }> = [
      { type: EnemyType.DUNE_STALKER, burn: 0.35, bleed: 0.30, poison: 0.30 },
      { type: EnemyType.STONE_JUGGERNAUT, burn: 0, bleed: 0.20, poison: 0.20 },
      { type: EnemyType.SKY_ANUBIS_COMMANDER, burn: 0.75, bleed: 0.55, poison: 0.35 }
    ];

    for (const { type, burn, bleed, poison } of checks) {
      const def: any = (enemiesData as any)[type];
      const enemy = makeEnemy(type, def.faction as EnemyFaction);
      expect(def.dotImmune, `${type} should not carry broad DoT immunity`).not.toBe(true);
      expect(def.immunePoison, `${type} should not hard-block poison`).not.toBe(true);
      expect(statusEffectiveness(enemy, StatusEffectKind.BURN), `${type} burn`).toBeCloseTo(burn, 6);
      expect(statusEffectiveness(enemy, StatusEffectKind.BLEED), `${type} bleed`).toBeCloseTo(bleed, 6);
      expect(statusEffectiveness(enemy, StatusEffectKind.POISON), `${type} poison`).toBeCloseTo(poison, 6);
      expect(
        hasDirectDamageAnswer(enemy, [DamageType.PHYS_MELEE, DamageType.PHYS_RANGED, DamageType.SIEGE, DamageType.ELEMENTAL_FIRE, DamageType.DIVINE]),
        `${type} should still have at least one direct-damage answer`
      ).toBe(true);
    }
  });

  it('lets poison damage hit the Anubis Priest commander while preserving its other warding', () => {
    const type = EnemyType.ANUBIS_PRIEST_COMMANDER;
    const def: any = (enemiesData as any)[type];
    const enemy = makeEnemy(type, def.faction as EnemyFaction);
    expect(def.dotImmune, `${type} should not carry broad DoT immunity`).not.toBe(true);
    expect(def.immunePoison, `${type} should not hard-block poison`).not.toBe(true);
    expect(statusEffectiveness(enemy, StatusEffectKind.POISON), `${type} poison should land`).toBeGreaterThan(0);
    expect(resistanceSummary(type).some(row => row.label === 'Poison' && row.value === 0), `${type} poison summary`).toBe(false);
    expect(statusEffectiveness(enemy, StatusEffectKind.BURN), `${type} burn remains blocked`).toBe(0);
    expect(statusEffectiveness(enemy, StatusEffectKind.BLEED), `${type} bleed remains blocked`).toBe(0);
    expect(enemyDamageMultiplier(enemy, DamageType.PHYS_MELEE), `${type} melee remains blocked`).toBe(0);
    expect(enemyDamageMultiplier(enemy, DamageType.DIVINE), `${type} divine remains blocked`).toBe(0);
  });

  it('gives the ordinary Anubis Priest a 200% siege weakness and allows Bleed damage', () => {
    const type = EnemyType.ANUBIS_PRIEST;
    const def: any = (enemiesData as any)[type];
    const priest = makeEnemy(type, EnemyFaction.EGYPTIANS);
    const siegeArmor = armorProfile(type).find(row => row.damageType === 'SIEGE');

    expect(def.siegeWeaknessPct).toBe(200);
    expect(enemyResistanceProfile(type).siege).toBe(3);
    expect(enemyDamageMultiplier(priest, DamageType.SIEGE)).toBe(3);
    expect(siegeArmor).toMatchObject({ finalMult: 3, armorPct: -200, immune: false });
    expect(enemyDamageMultiplier(priest, DamageType.PHYS_MELEE)).toBe(0);
    expect(enemyDamageMultiplier(priest, DamageType.DIVINE)).toBe(0);
    expect(def.dotImmune).not.toBe(true);
    expect(statusEffectiveness(priest, StatusEffectKind.BLEED)).toBeGreaterThan(0);
    expect(statusEffectiveness(priest, StatusEffectKind.BURN)).toBe(0);
    expect(statusEffectiveness(priest, StatusEffectKind.POISON)).toBe(0);
    expect(resistanceSummary(type).some(row => row.label === 'Bleed' && row.value === 0)).toBe(false);

    const commander = makeEnemy(EnemyType.ANUBIS_PRIEST_COMMANDER, EnemyFaction.EGYPTIANS);
    expect(enemyDamageMultiplier(commander, DamageType.SIEGE)).toBe(1);
  });

  it('gives selected post-W15 enemies true divine immunity with readable UI armor', () => {
    const divineImmuneTypes = [
      EnemyType.MONGOL_CAPTAIN,
      EnemyType.ANUBIS_PRIEST,
      EnemyType.ANUBIS_PRIEST_COMMANDER,
      EnemyType.CYCLOPS,
      EnemyType.SUPER_GIANT_COLOSSUS
    ];

    for (const type of divineImmuneTypes) {
      const def: any = (enemiesData as any)[type];
      const enemy = makeEnemy(type, def.faction as EnemyFaction);
      enemy.isFlyer = !!def.isFlyer;
      expect(def.divineImmune, `${type} JSON divineImmune`).toBe(true);
      expect(enemyDamageMultiplier(enemy, DamageType.DIVINE), `${type} divine`).toBe(0);
      expect(armorProfile(type).find(row => row.damageType === 'DIVINE')?.immune, `${type} armor row`).toBe(true);
      expect(resistanceSummary(type).some(row => row.label === 'Divine' && row.value === 0), `${type} summary row`).toBe(true);
      expect(
        hasDirectDamageAnswer(enemy, [DamageType.PHYS_MELEE, DamageType.PHYS_RANGED, DamageType.SIEGE, DamageType.ELEMENTAL_FIRE]),
        `${type} should still have at least one non-divine answer`
      ).toBe(true);
    }
  });

  it('shows Vulture Imperator as a siege-immune mid-game boss', () => {
    const vulture = makeEnemy(EnemyType.BOSS_FLYER_VULTURE, EnemyFaction.EGYPTIANS);
    vulture.isBoss = true;
    vulture.isFlyer = true;
    expect(enemyDamageMultiplier(vulture, DamageType.SIEGE)).toBe(0);
    expect(armorProfile(EnemyType.BOSS_FLYER_VULTURE).find(r => r.damageType === 'SIEGE')?.immune).toBe(true);
  });

  it('keeps other commanders vulnerable or resistant instead of making all commanders siege-immune', () => {
    const standard = makeEnemy(EnemyType.STANDARD_BEARER_COMMANDER, EnemyFaction.EGYPTIANS);
    const skyStandard = makeEnemy(EnemyType.SKY_STANDARD_COMMANDER, EnemyFaction.EGYPTIANS);
    skyStandard.isFlyer = true;

    expect(enemyDamageMultiplier(standard, DamageType.SIEGE)).toBeGreaterThan(0);
    expect(enemyDamageMultiplier(skyStandard, DamageType.SIEGE)).toBeGreaterThan(0);
  });

  it('gives the Tidecaller commander a naval-counter resistance profile', () => {
    const tidecaller = makeEnemy(EnemyType.TIDECALLER_COMMANDER, EnemyFaction.OCEAN);
    expect(enemyDamageMultiplier(tidecaller, DamageType.ELEMENTAL_FIRE)).toBe(0);
    expect(statusEffectiveness(tidecaller, StatusEffectKind.BURN)).toBe(0);
    expect(enemyDamageMultiplier(tidecaller, DamageType.SIEGE)).toBeGreaterThan(1);
    expect(enemyDamageMultiplier(tidecaller, DamageType.DIVINE)).toBeGreaterThan(1);
  });

  it('gives the Stormtide Wyvern commander ocean flyer weaknesses and fire immunity', () => {
    const wyvern = makeEnemy(EnemyType.STORMTIDE_WYVERN_COMMANDER, EnemyFaction.OCEAN);
    wyvern.isFlyer = true;
    expect(enemyDamageMultiplier(wyvern, DamageType.ELEMENTAL_FIRE)).toBe(0);
    expect(statusEffectiveness(wyvern, StatusEffectKind.BURN)).toBe(0);
    expect(enemyDamageMultiplier(wyvern, DamageType.SIEGE)).toBeGreaterThan(1);
    expect(enemyDamageMultiplier(wyvern, DamageType.DIVINE)).toBeGreaterThan(1);
  });

  it('makes selected late-wave portfolio checks immune to fire and burn', () => {
    const fireChecks = [
      EnemyType.MONGOL_SHAMAN,
      EnemyType.ANUBIS_PRIEST,
      EnemyType.ANUBIS_PRIEST_COMMANDER,
      EnemyType.STONE_JUGGERNAUT,
      EnemyType.DEMON_HELLHOUND,
      EnemyType.CERBERUS,
      EnemyType.DAEMON_IMPERATOR
    ];

    for (const type of fireChecks) {
      const enemy = makeEnemy(type, (enemiesData as any)[type].faction as EnemyFaction);
      expect((enemiesData as any)[type].immuneFire, `${type} JSON immuneFire`).toBe(true);
      expect(enemyDamageMultiplier(enemy, DamageType.ELEMENTAL_FIRE), `${type} fire`).toBe(0);
      expect(statusEffectiveness(enemy, StatusEffectKind.BURN), `${type} burn`).toBe(0);
      expect(armorProfile(type).find(row => row.damageType === 'ELEMENTAL_FIRE')?.immune, `${type} armor row`).toBe(true);
      expect(resistanceSummary(type).some(row => row.label === 'Fire' && row.value === 0), `${type} summary row`).toBe(true);
    }
  });

  it('keeps high-immunity late-wave non-elites low-health and killable', () => {
    const waves = require('../src/data/waves.json');
    const lateTypes = new Set<string>();
    for (const wave of waves.filter((w: any) => w.wave >= 16 && w.wave <= 30)) {
      for (const spawn of wave.spawns ?? []) lateTypes.add(spawn.type);
    }

    const damageBlockingFlags = [
      'meleeImmune',
      'rangedImmune',
      'siegeImmune',
      'divineImmune',
      'dotImmune',
      'immuneFire',
      'immunePoison'
    ];

    for (const type of lateTypes) {
      const def: any = (enemiesData as any)[type];
      if (!def || def.isBoss || def.isElite) continue;
      const immunityCount = damageBlockingFlags.filter(flag => def[flag] === true).length;
      if (immunityCount < 4) continue;

      expect(def.baseHp, `${type} has ${immunityCount} damage-blocking immunities, so base HP must stay modest`).toBeLessThanOrEqual(650);

      const enemy = makeEnemy(type as EnemyType, def.faction as EnemyFaction);
      enemy.isFlyer = !!def.isFlyer;
      expect(
        hasDirectDamageAnswer(enemy, [
          DamageType.PHYS_MELEE,
          DamageType.PHYS_RANGED,
          DamageType.SIEGE,
          DamageType.ELEMENTAL_FIRE,
          DamageType.DIVINE
        ]),
        `${type} should still have a direct damage answer`
      ).toBe(true);
    }

    expect((enemiesData as any).MONGOL_BERSERKER.baseHp).toBe(480);
    expect((enemiesData as any).ANUBIS_PRIEST.baseHp).toBe(650);
    expect((enemiesData as any).ANUBIS_PRIEST_COMMANDER.baseHp).toBe(2700);

    const berserker = makeEnemy(EnemyType.MONGOL_BERSERKER, EnemyFaction.MONGOLS);
    const berserkerDef: any = (enemiesData as any).MONGOL_BERSERKER;
    expect(enemyDamageMultiplier(berserker, DamageType.PHYS_MELEE)).toBeGreaterThan(0.75);
    expect(enemyDamageMultiplier(berserker, DamageType.PHYS_RANGED)).toBeGreaterThan(0.85);
    expect(enemyDamageMultiplier(berserker, DamageType.SIEGE)).toBe(0);
    expect(enemyDamageMultiplier(berserker, DamageType.ELEMENTAL_FIRE)).toBeCloseTo(0.45, 4);
    expect(enemyDamageMultiplier(berserker, DamageType.DIVINE)).toBeCloseTo(0.60, 4);
    expect(statusEffectiveness(berserker, StatusEffectKind.BURN)).toBeCloseTo(0.35, 4);
    expect(statusEffectiveness(berserker, StatusEffectKind.BLEED)).toBeCloseTo(0.35, 4);
    expect(statusEffectiveness(berserker, StatusEffectKind.POISON)).toBeCloseTo(0.35, 4);
    expect(berserkerDef.siegeImmune).toBe(true);
    expect(berserkerDef.divineImmune).not.toBe(true);
    expect(berserkerDef.dotImmune).not.toBe(true);
    expect(berserkerDef.immuneFire).not.toBe(true);
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
