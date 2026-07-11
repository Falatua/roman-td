import { EnemyType } from '../types';

export const DEFAULT_ENEMY_SPRITE_SIZE_TILES = 1.75;
export const BOSS_ENEMY_SPRITE_SIZE_TILES = 2.4;
export const HELL_GATE_SPRITE_SIZE_TILES = 3.0;

export const GIANT_CLASS_ENEMY_SPRITE_SIZE_TILES: Partial<Record<EnemyType, number>> = {
  [EnemyType.CYCLOPS]: 2.3,
  [EnemyType.GIANT_GIGAS]: 2.35,
  [EnemyType.SUPER_GIANT_COLOSSUS]: 2.7,
  [EnemyType.UNDEAD_GIANT]: 2.25,
  [EnemyType.UNDEAD_CYCLOPS]: 2.25,
  [EnemyType.DREAD_UNDEAD_GIANT]: 2.35,
  [EnemyType.DREAD_UNDEAD_CYCLOPS]: 2.35,
  [EnemyType.BONEWING_DRAKE]: 2.6,
  [EnemyType.GRAVE_LEGION_DRAGON]: 2.8,
  [EnemyType.DREAD_UPRISING_DRAGON]: 3.0,
  [EnemyType.FIRE_GIANT]: 2.45,
  [EnemyType.SEA_GIANT]: 2.35,
  [EnemyType.SEA_GIANT_WARBRINGER]: 2.5,
  [EnemyType.NETHER_AMPHIBIOUS_GIANT]: 2.55
};

export function isGiantClassEnemyType(type: EnemyType | string): boolean {
  return Object.prototype.hasOwnProperty.call(GIANT_CLASS_ENEMY_SPRITE_SIZE_TILES, type);
}

export function enemySpriteSizeTiles(enemy: { type: EnemyType | string; isBoss?: boolean }): number {
  if (enemy.type === EnemyType.HELL_GATE) return HELL_GATE_SPRITE_SIZE_TILES;
  const giantSize = GIANT_CLASS_ENEMY_SPRITE_SIZE_TILES[enemy.type as EnemyType];
  if (giantSize) return giantSize;
  return enemy.isBoss ? BOSS_ENEMY_SPRITE_SIZE_TILES : DEFAULT_ENEMY_SPRITE_SIZE_TILES;
}
