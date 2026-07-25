import enemiesData from '../data/enemies.json';
import type { Enemy, EnemyType } from '../types';

export type EnemyClassification = {
  boss: boolean;
  elite: boolean;
  commander: boolean;
  caster: boolean;
  giant: boolean;
  beast: boolean;
  ocean: boolean;
  eventStructure: boolean;
};

export const COMMANDER_ENEMY_TYPES = new Set<string>([
  'STANDARD_BEARER_COMMANDER',
  'PATHFINDER_COMMANDER',
  'ANUBIS_PRIEST_COMMANDER',
  'SIEGE_CAPTAIN_COMMANDER',
  'SKY_STANDARD_COMMANDER',
  'SKY_PATHFINDER_COMMANDER',
  'SKY_ANUBIS_COMMANDER',
  'TIDECALLER_COMMANDER',
  'STORMTIDE_WYVERN_COMMANDER'
]);

export const GIANT_ENEMY_TYPES = new Set<string>([
  'SEA_GIANT', 'SEA_GIANT_WARBRINGER', 'NETHER_AMPHIBIOUS_GIANT',
  'FIRE_GIANT', 'GIANT_GIGAS', 'CYCLOPS', 'SUPER_GIANT_COLOSSUS',
  'UNDEAD_GIANT', 'UNDEAD_CYCLOPS', 'DREAD_UNDEAD_GIANT', 'DREAD_UNDEAD_CYCLOPS'
]);

export const BEAST_ENEMY_TYPES = new Set<string>([
  'FERAL_DOG', 'RABID_DOG', 'ALPHA_DOG', 'DEMON_HELLHOUND',
  'WAR_ELEPHANT', 'UNDEAD_WAR_ELEPHANT'
]);

export const OCEAN_ENEMY_TYPES = new Set<string>([
  'OCEAN_FISHLING', 'OCEAN_GHOST_SPIRIT', 'SEA_GIANT',
  'SEA_GIANT_WARBRINGER', 'NETHER_AMPHIBIOUS_GIANT', 'NAGA_ADEPT',
  'NAGA_SLEEPWEAVER', 'NAGA_ORACLE', 'TIDECALLER_COMMANDER',
  'STORMTIDE_WYVERN_COMMANDER'
]);

const ELITE_ENEMY_TYPES = new Set<string>([
  'WAR_ELEPHANT', 'UNDEAD_WAR_ELEPHANT', 'FIRE_GIANT',
  'SEA_GIANT', 'SEA_GIANT_WARBRINGER', 'NETHER_AMPHIBIOUS_GIANT',
  'GIANT_GIGAS', 'CYCLOPS', 'SUPER_GIANT_COLOSSUS',
  'UNDEAD_GIANT', 'UNDEAD_CYCLOPS', 'DREAD_UNDEAD_GIANT',
  'DREAD_UNDEAD_CYCLOPS', 'STONE_JUGGERNAUT', 'SIEGE_WAGON', 'SKY_BARGE'
]);

const CASTER_ENEMY_TYPES = new Set<string>([
  'GALLIC_DRUID', 'ZOMBIE_DRUID', 'REANIMATED_LICH', 'DEMON_LEGATE',
  'ANUBIS_PRIEST', 'ANUBIS_PRIEST_COMMANDER', 'SKY_ANUBIS_COMMANDER',
  'MONGOL_SHAMAN', 'NAGA_ADEPT', 'NAGA_SLEEPWEAVER', 'NAGA_ORACLE',
  'TIDECALLER_COMMANDER'
]);

type EnemyClassifiable = string | EnemyType | Pick<Enemy, 'type'> | null | undefined;

function typeId(value: EnemyClassifiable): string {
  return value && typeof value === 'object' ? String(value.type) : String(value ?? '');
}

export function classifyEnemy(value: EnemyClassifiable): EnemyClassification {
  const type = typeId(value);
  const def: any = (enemiesData as any)[type] ?? {};
  const runtime: any = value && typeof value === 'object' ? value : {};
  const hasAuthoredDef = !!(enemiesData as any)[type];
  return {
    boss: hasAuthoredDef ? def.isBoss === true : runtime.isBoss === true,
    elite: runtime.isElite === true || def.isElite === true || ELITE_ENEMY_TYPES.has(type),
    commander: runtime.isCommander === true || COMMANDER_ENEMY_TYPES.has(type),
    caster: runtime.isCaster === true || def.caster === true || def.towerSleepCaster === true || def.auraNullifier === true || def.auraTowerCritPenalty > 0 || CASTER_ENEMY_TYPES.has(type),
    giant: GIANT_ENEMY_TYPES.has(type),
    beast: BEAST_ENEMY_TYPES.has(type),
    ocean: runtime.isOceanEnemy === true || runtime.__oceanSpawn === true || OCEAN_ENEMY_TYPES.has(type),
    eventStructure: runtime.isEventStructure === true || def.isStructure === true
  };
}

export const isBossEnemy = (value: EnemyClassifiable): boolean => classifyEnemy(value).boss;
export const isEliteEnemy = (value: EnemyClassifiable): boolean => classifyEnemy(value).elite;
export const isCommanderEnemy = (value: EnemyClassifiable): boolean => classifyEnemy(value).commander;
export const isCasterEnemy = (value: EnemyClassifiable): boolean => classifyEnemy(value).caster;
export const isGiantEnemy = (value: EnemyClassifiable): boolean => classifyEnemy(value).giant;
export const isBeastEnemy = (value: EnemyClassifiable): boolean => classifyEnemy(value).beast;
export const isOceanEnemy = (value: EnemyClassifiable): boolean => classifyEnemy(value).ocean;
export const isEventStructure = (value: EnemyClassifiable): boolean => classifyEnemy(value).eventStructure;
