import { TowerType } from '../types';

export type ApexAuraStyle = 'CRIMSON_BLADES' | 'ABYSSAL_TIDE' | 'MOLTEN_FORGE';

export interface ApexAuraProfile {
  style: ApexAuraStyle;
  primary: number;
  secondary: number;
  radiusTiles: number;
  intensity: number;
  omega: boolean;
}

// Omega towers use stronger signature glows than Supercombos. Vulcan
// Colossus is included as an authored apex exception because its giant
// foundry silhouette benefits from the same at-a-glance class language.
export const APEX_AURA_PROFILES: Readonly<Partial<Record<TowerType, ApexAuraProfile>>> = Object.freeze({
  [TowerType.ROMAN_TRANSFORMER]: Object.freeze({
    style: 'CRIMSON_BLADES',
    primary: 0xff2438,
    secondary: 0xffb347,
    radiusTiles: 1.28,
    intensity: 1,
    omega: true
  }),
  [TowerType.NEPTUNES_LEVIATHAN]: Object.freeze({
    style: 'ABYSSAL_TIDE',
    primary: 0x38e7ff,
    secondary: 0x2868ff,
    radiusTiles: 1.38,
    intensity: 1,
    omega: true
  }),
  [TowerType.VULCAN_COLOSSUS]: Object.freeze({
    style: 'MOLTEN_FORGE',
    primary: 0xff6a24,
    secondary: 0xffd35a,
    radiusTiles: 1.18,
    intensity: 0.78,
    omega: false
  })
});

export function apexAuraProfile(towerType: TowerType | string): ApexAuraProfile | null {
  return APEX_AURA_PROFILES[towerType as TowerType] ?? null;
}
