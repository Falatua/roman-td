import { describe, expect, it } from 'vitest';
import { EnemyType } from '../src/types';
import {
  classifyEnemy,
  isBeastEnemy,
  isBossEnemy,
  isCasterEnemy,
  isCommanderEnemy,
  isEliteEnemy,
  isEventStructure,
  isGiantEnemy,
  isOceanEnemy
} from '../src/systems/EnemyClassification';

describe('authoritative enemy classification', () => {
  it('separates elephant elites from true bosses', () => {
    expect(classifyEnemy(EnemyType.WAR_ELEPHANT)).toMatchObject({ boss: false, elite: true, beast: true });
    expect(classifyEnemy(EnemyType.UNDEAD_WAR_ELEPHANT)).toMatchObject({ boss: false, elite: true, beast: true });
    expect(isBossEnemy(EnemyType.HANNIBAL_BARCA)).toBe(true);
    expect(isEliteEnemy(EnemyType.HANNIBAL_BARCA)).toBe(false);
  });

  it('provides one shared answer for tactical families', () => {
    expect(isCommanderEnemy(EnemyType.STORMTIDE_WYVERN_COMMANDER)).toBe(true);
    expect(isCasterEnemy(EnemyType.NAGA_SLEEPWEAVER)).toBe(true);
    expect(isGiantEnemy(EnemyType.DREAD_UNDEAD_CYCLOPS)).toBe(true);
    expect(isBeastEnemy(EnemyType.DEMON_HELLHOUND)).toBe(true);
    expect(isOceanEnemy(EnemyType.NAGA_ORACLE)).toBe(true);
    expect(isEventStructure(EnemyType.HELL_GATE)).toBe(true);
  });

  it('honors runtime flags for generated enemies and test doubles', () => {
    expect(isBossEnemy({ type: 'GENERATED_BOSS', isBoss: true } as any)).toBe(true);
    expect(isEliteEnemy({ type: EnemyType.FERAL_DOG, isElite: true } as any)).toBe(true);
    expect(isCommanderEnemy({ type: EnemyType.FERAL_DOG, isCommander: true } as any)).toBe(true);
  });
});
