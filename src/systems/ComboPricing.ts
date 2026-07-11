import { TowerType } from '../types';

export const BASE_COMBO_RECIPE_COST = 50;
export const SUPER_COMBO_RECIPE_COST = 200;
export const OMEGA_COMBO_RECIPE_COST = 500;

// Item-triggered evolutions are intentionally absent: the item already pays
// their conversion cost. This list covers authored, gold-paid recipes only.
export const SUPER_COMBO_RECIPE_RESULTS = new Set<string>([
  TowerType.TURMA_LANCERS,
  TowerType.AURORA_LEGION,
  TowerType.STORM_VEXILLATION,
  TowerType.IMPERIUM_ETERNUM,
  TowerType.CARTHAGE_SCOURGE,
  TowerType.TRIUMVIRATE,
  TowerType.TRIPLEX_ACIES,
  TowerType.LEGION_PRIME,
  TowerType.CONSULAR_FATEBINDER,
  TowerType.JULIUS_CAESAR,
  TowerType.HANNIBALS_NIGHTMARE,
  TowerType.GOD_OF_WAR,
  TowerType.NEMESIS_ENGINE,
  TowerType.TRIUMPHATOR,
  TowerType.PONTIFEX_MAXIMUS,
  TowerType.VANGUARD_WING,
  TowerType.VULCAN_COLOSSUS,
  TowerType.SKY_DOMINION,
  TowerType.AUREATE_TRIBUNAL,
  TowerType.GLACIAL_PALISADE,
  TowerType.INFERNAL_COLOSSUS,
  TowerType.MARS_VICTOR
]);

export const OMEGA_COMBO_RECIPE_RESULTS = new Set<string>([
  TowerType.ROMAN_TRANSFORMER,
  TowerType.NEPTUNES_LEVIATHAN
]);

export function comboRecipeCost(result: TowerType | string): number {
  if (OMEGA_COMBO_RECIPE_RESULTS.has(result)) return OMEGA_COMBO_RECIPE_COST;
  if (SUPER_COMBO_RECIPE_RESULTS.has(result)) return SUPER_COMBO_RECIPE_COST;
  return BASE_COMBO_RECIPE_COST;
}
