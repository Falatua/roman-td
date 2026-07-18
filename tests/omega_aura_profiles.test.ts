import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import towersData from '../src/data/towers.json';
import { TowerType } from '../src/types';
import { APEX_AURA_PROFILES, apexAuraProfile } from '../src/render/OmegaAuraProfiles';

describe('Omega and apex signature auras', () => {
  it('gives every authored Omega tower a persistent signature profile', () => {
    const omegaTypes = Object.entries(towersData as Record<string, { omega?: boolean }>)
      .filter(([, def]) => def.omega)
      .map(([type]) => type);

    expect(omegaTypes.length).toBeGreaterThan(0);
    for (const type of omegaTypes) {
      const profile = apexAuraProfile(type);
      expect(profile, `${type} needs an apex aura profile`).not.toBeNull();
      expect(profile?.omega, `${type} must receive Omega-level intensity`).toBe(true);
    }
  });

  it('uses distinct archetype shapes and palettes for the two Omegas', () => {
    const roman = apexAuraProfile(TowerType.ROMAN_TRANSFORMER)!;
    const neptune = apexAuraProfile(TowerType.NEPTUNES_LEVIATHAN)!;

    expect(roman.style).toBe('CRIMSON_BLADES');
    expect(roman.primary).toBe(0xff2438);
    expect(neptune.style).toBe('ABYSSAL_TIDE');
    expect(neptune.primary).toBe(0x38e7ff);
    expect(roman.style).not.toBe(neptune.style);
    expect(roman.primary).not.toBe(neptune.primary);
  });

  it('gives Vulcan Colossus a quieter molten Supercombo signature', () => {
    const vulcan = apexAuraProfile(TowerType.VULCAN_COLOSSUS)!;
    expect(vulcan.style).toBe('MOLTEN_FORGE');
    expect(vulcan.omega).toBe(false);
    expect(vulcan.intensity).toBeLessThan(APEX_AURA_PROFILES[TowerType.ROMAN_TRANSFORMER]!.intensity);
  });

  it('renders signature auras through the throttled shared graphics layer', () => {
    const source = fs.readFileSync('src/render/RenderEngine.ts', 'utf8');
    expect(source).toContain('apexAuraProfile(tw.type)');
    expect(source).toContain('drawApexSignatureAura');
    expect(source).toContain('__reduceMotion');
  });

  it('draws amber resistance-break rings for selected Super Combo towers', () => {
    const source = fs.readFileSync('src/render/RenderEngine.ts', 'utf8');
    expect(source).toContain('RESIST_BREAK');
    for (const type of [
      TowerType.LEGION_PRIME,
      TowerType.CONSULAR_FATEBINDER,
      TowerType.AUREATE_TRIBUNAL,
      TowerType.GLACIAL_PALISADE,
      TowerType.INFERNAL_COLOSSUS
    ]) {
      expect(source, `${type} should have a visible resistance-break aura ring`).toContain(`tw.type === TowerType.${type}`);
    }
  });
});
