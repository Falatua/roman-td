import { describe, expect, it } from 'vitest';
import {
  BOSS_ENEMY_SPRITE_SIZE_TILES,
  DEFAULT_ENEMY_SPRITE_SIZE_TILES,
  enemySpriteSizeTiles,
  GIANT_CLASS_ENEMY_SPRITE_SIZE_TILES,
  HELL_GATE_SPRITE_SIZE_TILES,
  isGiantClassEnemyType
} from '../src/render/EnemySpriteScale';
import { EnemyType } from '../src/types';

describe('enemy sprite scale', () => {
  it('renders every cyclops and giant class enemy larger than normal minions', () => {
    const giantTypes = [
      EnemyType.CYCLOPS,
      EnemyType.GIANT_GIGAS,
      EnemyType.SUPER_GIANT_COLOSSUS,
      EnemyType.UNDEAD_GIANT,
      EnemyType.UNDEAD_CYCLOPS,
      EnemyType.DREAD_UNDEAD_GIANT,
      EnemyType.DREAD_UNDEAD_CYCLOPS,
      EnemyType.BONEWING_DRAKE,
      EnemyType.GRAVE_LEGION_DRAGON,
      EnemyType.DREAD_UPRISING_DRAGON,
      EnemyType.STORMTIDE_WYVERN_COMMANDER,
      EnemyType.FIRE_GIANT,
      EnemyType.SEA_GIANT,
      EnemyType.SEA_GIANT_WARBRINGER,
      EnemyType.NETHER_AMPHIBIOUS_GIANT
    ];

    for (const type of giantTypes) {
      expect(isGiantClassEnemyType(type)).toBe(true);
      expect(enemySpriteSizeTiles({ type })).toBeGreaterThan(DEFAULT_ENEMY_SPRITE_SIZE_TILES);
    }
  });

  it('keeps the visual hierarchy distinct inside the giant family', () => {
    expect(enemySpriteSizeTiles({ type: EnemyType.SUPER_GIANT_COLOSSUS }))
      .toBeGreaterThan(enemySpriteSizeTiles({ type: EnemyType.CYCLOPS }));
    expect(enemySpriteSizeTiles({ type: EnemyType.NETHER_AMPHIBIOUS_GIANT }))
      .toBeGreaterThan(enemySpriteSizeTiles({ type: EnemyType.SEA_GIANT }));
    expect(enemySpriteSizeTiles({ type: EnemyType.SEA_GIANT_WARBRINGER }))
      .toBeGreaterThan(enemySpriteSizeTiles({ type: EnemyType.UNDEAD_GIANT }));
    expect(enemySpriteSizeTiles({ type: EnemyType.GRAVE_LEGION_DRAGON }))
      .toBeGreaterThan(enemySpriteSizeTiles({ type: EnemyType.BONEWING_DRAKE }));
    expect(enemySpriteSizeTiles({ type: EnemyType.DREAD_UPRISING_DRAGON }))
      .toBeGreaterThan(enemySpriteSizeTiles({ type: EnemyType.GRAVE_LEGION_DRAGON }));
  });

  it('gives every dragon-class enemy a clearly oversized map footprint', () => {
    expect(enemySpriteSizeTiles({ type: EnemyType.BONEWING_DRAKE })).toBe(3.0);
    expect(enemySpriteSizeTiles({ type: EnemyType.GRAVE_LEGION_DRAGON })).toBe(3.3);
    expect(enemySpriteSizeTiles({ type: EnemyType.DREAD_UPRISING_DRAGON })).toBe(3.6);
    expect(enemySpriteSizeTiles({ type: EnemyType.STORMTIDE_WYVERN_COMMANDER })).toBe(2.5);
  });

  it('preserves special non-giant sizing fallbacks', () => {
    expect(enemySpriteSizeTiles({ type: EnemyType.HELL_GATE })).toBe(HELL_GATE_SPRITE_SIZE_TILES);
    expect(enemySpriteSizeTiles({ type: EnemyType.FERAL_DOG })).toBe(DEFAULT_ENEMY_SPRITE_SIZE_TILES);
    expect(enemySpriteSizeTiles({ type: EnemyType.FERAL_DOG, isBoss: true })).toBe(BOSS_ENEMY_SPRITE_SIZE_TILES);
    expect(GIANT_CLASS_ENEMY_SPRITE_SIZE_TILES[EnemyType.HELL_GATE]).toBeUndefined();
  });
});
