import { describe, expect, it } from 'vitest';
import enemiesData from '../src/data/enemies.json';
import { campaignPressureResistMult } from '../src/systems/CampaignDifficulty';
import { scaledEnemyRegenRate } from '../src/systems/EnemyHealing';
import { enemyResistanceProfile, statusEffectiveness } from '../src/systems/EnemyResistances';
import { EnemyFaction, EnemyType, StatusEffectKind } from '../src/types';

describe('Wave 29 Nether Amphibious Giant counterplay', () => {
  it('makes Poison its decisive late-wave weakness', () => {
    const def: any = (enemiesData as any).NETHER_AMPHIBIOUS_GIANT;
    const wave29Enemy: any = {
      type: EnemyType.NETHER_AMPHIBIOUS_GIANT,
      faction: EnemyFaction.OCEAN,
      mutation: undefined,
      __lateResistMult: campaignPressureResistMult(29),
      __lateStatusGuard: 0.35
    };

    expect(def.poisonWeaknessPct).toBe(400);
    expect(def.immunePoison).not.toBe(true);
    expect(def.dotImmune).not.toBe(true);
    expect(enemyResistanceProfile(EnemyType.NETHER_AMPHIBIOUS_GIANT).poison).toBe(5);
    expect(statusEffectiveness(wave29Enemy, StatusEffectKind.POISON)).toBeCloseTo(0.812, 6);
    expect(statusEffectiveness(wave29Enemy, StatusEffectKind.POISON)).toBeGreaterThan(
      statusEffectiveness(wave29Enemy, StatusEffectKind.BLEED) * 20
    );
    expect(statusEffectiveness(wave29Enemy, StatusEffectKind.BURN)).toBe(0);
  });

  it('shows exactly 0.25 percent always-on regeneration after the shared reduction', () => {
    const def: any = (enemiesData as any).NETHER_AMPHIBIOUS_GIANT;

    expect(def.regenPctPerSec).toBe(0.003125);
    expect(scaledEnemyRegenRate(def.regenPctPerSec)).toBeCloseTo(0.0025, 10);
  });
});
