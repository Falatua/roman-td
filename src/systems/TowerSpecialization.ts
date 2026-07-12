import { TowerType } from '../types';

const GIANT_KILLER_TARGET_TYPES = new Set<string>([
  'SEA_GIANT',
  'SEA_GIANT_WARBRINGER',
  'NETHER_AMPHIBIOUS_GIANT',
  'FIRE_GIANT',
  'GIANT_GIGAS',
  'CYCLOPS',
  'SUPER_GIANT_COLOSSUS',
  'UNDEAD_GIANT',
  'UNDEAD_CYCLOPS',
  'DREAD_UNDEAD_GIANT',
  'DREAD_UNDEAD_CYCLOPS'
]);

const GIANT_KILLER_ELEPHANT_TYPES = new Set<string>([
  'WAR_ELEPHANT',
  'UNDEAD_WAR_ELEPHANT'
]);

export const GIANT_KILLER_GIANT_DAMAGE_MULT = 5.5;
export const GIANT_KILLER_ELEPHANT_DAMAGE_MULT = 3.5;
export const HANNIBALS_NIGHTMARE_ELEPHANT_DAMAGE_MULT = 5.0;
export const HANNIBALS_NIGHTMARE_FLYER_DAMAGE_MULT = 1.60;
export const HANNIBALS_NIGHTMARE_BOSS_DAMAGE_MULT = 1.30;
export const HANNIBALS_NIGHTMARE_TARGET_COUNT = 2;

type PreyTarget = {
  type: string;
  isFlyer?: boolean;
  isBoss?: boolean;
};

export function isGiantKillerTarget(target: Pick<PreyTarget, 'type'>): boolean {
  return GIANT_KILLER_TARGET_TYPES.has(String(target.type));
}

export function giantKillerPreyDamageMult(target: Pick<PreyTarget, 'type'>): number {
  if (isGiantKillerTarget(target)) return GIANT_KILLER_GIANT_DAMAGE_MULT;
  if (GIANT_KILLER_ELEPHANT_TYPES.has(String(target.type))) return GIANT_KILLER_ELEPHANT_DAMAGE_MULT;
  return 1;
}

export function hannibalsNightmarePreyDamageMult(target: PreyTarget): number {
  let multiplier = 1;
  if (GIANT_KILLER_ELEPHANT_TYPES.has(String(target.type))) {
    multiplier *= HANNIBALS_NIGHTMARE_ELEPHANT_DAMAGE_MULT;
  }
  if (target.isFlyer) multiplier *= HANNIBALS_NIGHTMARE_FLYER_DAMAGE_MULT;
  if (target.isBoss) multiplier *= HANNIBALS_NIGHTMARE_BOSS_DAMAGE_MULT;
  return multiplier;
}

export type SpecialistDpsRow = {
  label: string;
  dps: number;
  multiplier: number;
  detail: string;
};

// These are sheet-DPS estimates. Crits, enemy resistance, marks, and other
// target-side effects remain separate so the displayed math matches General DPS.
export function towerSpecialistDpsRows(type: TowerType, generalDps: number): SpecialistDpsRow[] {
  if (type === TowerType.GIANT_KILLER) {
    return [
      {
        label: 'Giant-family DPS',
        dps: generalDps * GIANT_KILLER_GIANT_DAMAGE_MULT,
        multiplier: GIANT_KILLER_GIANT_DAMAGE_MULT,
        detail: 'Sea, fire, undead giants and Cyclopses'
      },
      {
        label: 'Elephant DPS',
        dps: generalDps * GIANT_KILLER_ELEPHANT_DAMAGE_MULT,
        multiplier: GIANT_KILLER_ELEPHANT_DAMAGE_MULT,
        detail: 'Living and undead war elephants'
      }
    ];
  }

  if (type === TowerType.HANNIBALS_NIGHTMARE) {
    const elephantPerTargetMult = HANNIBALS_NIGHTMARE_ELEPHANT_DAMAGE_MULT
      * HANNIBALS_NIGHTMARE_BOSS_DAMAGE_MULT;
    return [
      {
        label: 'Elephant DPS / target',
        dps: generalDps * elephantPerTargetMult,
        multiplier: elephantPerTargetMult,
        detail: 'Includes the elephant and boss bonuses'
      },
      {
        label: '2-elephant volley',
        dps: generalDps * elephantPerTargetMult * HANNIBALS_NIGHTMARE_TARGET_COUNT,
        multiplier: elephantPerTargetMult * HANNIBALS_NIGHTMARE_TARGET_COUNT,
        detail: 'Maximum combined DPS with two targets'
      }
    ];
  }

  return [];
}
