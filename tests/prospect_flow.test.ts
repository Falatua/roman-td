import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('Prospect keep flow', () => {
  const mainSource = fs.readFileSync('src/main.ts', 'utf8');

  it('keeps placement open after saving the only revealed prospect when rolls remain', () => {
    expect(mainSource).toContain('const canPlaceMoreProspects = state.prospectsPlaced < 10;');
    expect(mainSource).toContain('state.keepsRemainingThisRound > 0 && (hasPendingTowers() || canPlaceMoreProspects)');
    expect(mainSource).toContain('state.phase = canPlaceMoreProspects ? GamePhase.PROSPECT_PLACEMENT : GamePhase.PICK_KEEPER;');
    expect(mainSource).toContain('empty grass clicks continue');
    expect(mainSource).toContain('Keep placing - ${rollsLeft} roll');
  });

  it('clears unrevealed prospect cards once the keep budget is exhausted', () => {
    const exhaustedIndex = mainSource.indexOf('// Keeps exhausted');
    const queueClearIndex = mainSource.indexOf('state.prospectQueue = [];', exhaustedIndex);
    const buildPhaseIndex = mainSource.indexOf('state.phase = GamePhase.BUILD_PHASE;', queueClearIndex);

    expect(exhaustedIndex).toBeGreaterThan(0);
    expect(queueClearIndex).toBeGreaterThan(exhaustedIndex);
    expect(buildPhaseIndex).toBeGreaterThan(queueClearIndex);
  });

  it('uses the cumulative Solo roster draw for every campaign prospect refresh', () => {
    expect(mainSource).toContain("import { BASE_TOWER_TYPES, createTower, rollSoloDraw");
    expect(mainSource.match(/rollSoloDraw\(state, BASE_TOWER_TYPES\)/g)?.length).toBe(6);
    expect(mainSource).not.toContain('rollDraw(state, BASE_TOWER_TYPES)');
  });

  it('uses the full authored Legion roster for Solo Mercator armory refreshes', () => {
    expect(mainSource).toContain('fullLegionRoster: true');
  });
});
