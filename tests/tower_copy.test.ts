import { describe, expect, it } from 'vitest';
import towersData from '../src/data/towers.json';
import { towerBriefHtml, towerBriefText, towerMechanicsSummary } from '../src/render/TowerCopy';

describe('canonical player-facing tower field notes', () => {
  it('keeps every tower note concise, readable, and available from one shared source', () => {
    for (const [type, def] of Object.entries(towersData as Record<string, any>)) {
      const mechanics = towerMechanicsSummary(type, def);
      const brief = towerBriefText(type, def);
      const html = towerBriefHtml(type, def);

      expect(mechanics.length, type).toBeGreaterThan(0);
      expect(mechanics.split(/\s+/).length, type).toBeLessThanOrEqual(48);
      expect(mechanics, type).not.toMatch(/<[^>]+>/);
      expect(brief, type).toContain(mechanics);
      expect(html, type).toContain('FIELD NOTE:');
      expect(html, type).toContain('title=');
    }
  });

  it('preserves the defining mechanic in complex late-game examples', () => {
    expect(towerMechanicsSummary('GIANT_KILLER', (towersData as any).GIANT_KILLER)).toMatch(/giant|cyclops/i);
    expect(towerMechanicsSummary('HANNIBALS_NIGHTMARE', (towersData as any).HANNIBALS_NIGHTMARE)).toMatch(/elephant/i);
    expect(towerMechanicsSummary('ROMAN_TRANSFORMER', (towersData as any).ROMAN_TRANSFORMER)).toMatch(/25%|slash|immolation/i);
  });
});
