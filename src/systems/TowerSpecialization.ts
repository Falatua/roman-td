import { TowerType } from '../types';
import { isGiantEnemy } from './EnemyClassification';

const GIANT_KILLER_ELEPHANT_TYPES = new Set<string>([
  'WAR_ELEPHANT',
  'UNDEAD_WAR_ELEPHANT'
]);

export const GIANT_KILLER_GIANT_DAMAGE_MULT = 5.5;
export const GIANT_KILLER_ELEPHANT_DAMAGE_MULT = 3.5;
export const GIANT_KILLER_SPLASH_DAMAGE_MULT = 0.5;
export const HANNIBALS_NIGHTMARE_ELEPHANT_DAMAGE_MULT = 6.5;
export const HANNIBALS_NIGHTMARE_FLYER_DAMAGE_MULT = 1.60;
export const HANNIBALS_NIGHTMARE_BOSS_DAMAGE_MULT = 1.30;
export const HANNIBALS_NIGHTMARE_TARGET_COUNT = 2;

// Dedicated combo anti-air should provide a clear payoff over generalist
// ranged towers. These multipliers affect flyers only; ground output is
// intentionally unchanged. Keep this table authoritative for combat, UI copy,
// and balance tests so the specialist ladder cannot drift across systems.
export const COMBO_FLYER_SPECIALIST_DAMAGE_MULT: Readonly<Partial<Record<TowerType, number>>> = {
  [TowerType.SCORPION_BOLT]: 2.00,
  [TowerType.NUMIDIAN_CAVALRY]: 2.50,
  [TowerType.NEMESIS_ENGINE]: 3.20,
  [TowerType.STORM_BALLISTA]: 2.10,
  [TowerType.SKYREAPER_BATTERY]: 3.50,
  [TowerType.SKY_DOMINION]: 4.25,
  [TowerType.JOVIAN_SKY_HUNTER]: 1.35
};

type PreyTarget = {
  type: string;
  isFlyer?: boolean;
  isBoss?: boolean;
};

export function comboFlyerSpecialistDamageMult(
  towerType: TowerType,
  target: Pick<PreyTarget, 'isFlyer'>
): number {
  if (!target.isFlyer) return 1;
  return COMBO_FLYER_SPECIALIST_DAMAGE_MULT[towerType] ?? 1;
}

export function isGiantKillerTarget(target: Pick<PreyTarget, 'type'>): boolean {
  return isGiantEnemy(String(target.type));
}

export function isElephantEnemyTarget(target: Pick<PreyTarget, 'type'>): boolean {
  return GIANT_KILLER_ELEPHANT_TYPES.has(String(target.type));
}

export function giantKillerPreyDamageMult(target: Pick<PreyTarget, 'type'>): number {
  if (isGiantKillerTarget(target)) return GIANT_KILLER_GIANT_DAMAGE_MULT;
  if (isElephantEnemyTarget(target)) return GIANT_KILLER_ELEPHANT_DAMAGE_MULT;
  return 1;
}

export function giantKillerSplashDamage(
  primaryDamage: number,
  primary: Pick<PreyTarget, 'type'>,
  secondary: Pick<PreyTarget, 'type'>
): number {
  const neutralDamage = primaryDamage / giantKillerPreyDamageMult(primary);
  return neutralDamage * giantKillerPreyDamageMult(secondary) * GIANT_KILLER_SPLASH_DAMAGE_MULT;
}

export function hannibalsNightmarePreyDamageMult(target: PreyTarget): number {
  let multiplier = 1;
  const isElephant = isElephantEnemyTarget(target);
  if (isElephant) {
    multiplier *= HANNIBALS_NIGHTMARE_ELEPHANT_DAMAGE_MULT;
  }
  if (target.isFlyer) multiplier *= HANNIBALS_NIGHTMARE_FLYER_DAMAGE_MULT;
  // Elephants have an explicit 6.5x payoff. They are elites, not bosses, and
  // must not regain the old boss multiplier through stale encounter flags.
  if (target.isBoss && !isElephant) multiplier *= HANNIBALS_NIGHTMARE_BOSS_DAMAGE_MULT;
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
    const elephantPerTargetMult = HANNIBALS_NIGHTMARE_ELEPHANT_DAMAGE_MULT;
    return [
      {
        label: 'Elephant DPS / target',
        dps: generalDps * elephantPerTargetMult,
        multiplier: elephantPerTargetMult,
        detail: 'Living and undead war elephants'
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
