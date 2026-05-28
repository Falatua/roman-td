// Phase 5 — leak detection + circuit routing rules.
import { describe, it, expect } from 'vitest';
import {
  routeLeakNext, secondaryEntryFor, serializeLeak, buildLeakManifest,
  ghostLaneReduce, resolveLeakHop, type LeakableEnemy,
} from '../src/coop/LegionCircuit';
import { QUADRANTS } from '../src/coop/LegionConfig';

const grunt: LeakableEnemy = { type: 'CARTHAGE_SPEARMAN', hp: 42, maxHp: 100, faction: 'CARTHAGE' };
const boss: LeakableEnemy = { type: 'HANNIBAL_BARCA', hp: 5000, maxHp: 20000, faction: 'CARTHAGE', isBoss: true };

describe('Circuit routing (Section 2.3 / 3.4)', () => {
  it('routes clockwise, last quadrant strikes Rome', () => {
    expect(routeLeakNext('NW', 4)).toBe('NE');
    expect(routeLeakNext('NE', 4)).toBe('SE');
    expect(routeLeakNext('SE', 4)).toBe('SW');
    expect(routeLeakNext('SW', 4)).toBe('ROME');
  });

  it('2-player: NW → SE → Rome', () => {
    expect(routeLeakNext('NW', 2)).toBe('SE');
    expect(routeLeakNext('SE', 2)).toBe('ROME');
  });

  it('secondary entry matches quadrant geometry (Section 4.3)', () => {
    expect(secondaryEntryFor('NE')).toEqual(QUADRANTS.NE.secondaryEntry);
  });
});

describe('Leak serialization + HP retention (Section 5.2)', () => {
  it('captures 100% of current HP, no restoration', () => {
    const leak = serializeLeak(grunt, 'NW', false);
    expect(leak.hp).toBe(42);
    expect(leak.maxHp).toBe(100);
    expect(leak.fromQuadrant).toBe('NW');
    expect(leak.isBoss).toBe(false);
  });

  it('flags under-checkpoint leaks (red trail, Section 4.2)', () => {
    expect(serializeLeak(grunt, 'NW', true).underReqCheckpoints).toBe(true);
  });

  it('marks bosses', () => {
    expect(serializeLeak(boss, 'SE', false).isBoss).toBe(true);
  });
});

describe('Ghost-lane reduction (Section 10.2)', () => {
  it('halves leak HP from a ghost lane', () => {
    const leak = serializeLeak(grunt, 'NW', false); // hp 42
    expect(ghostLaneReduce(leak).hp).toBe(21);
  });
});

describe('resolveLeakHop', () => {
  it('returns an entry point for a quadrant destination', () => {
    const leak = serializeLeak(grunt, 'NW', false);
    const hop = resolveLeakHop(leak, 4);
    expect(hop.destination).toBe('NE');
    expect(hop.entry).toEqual(QUADRANTS.NE.secondaryEntry);
  });
  it('returns null entry for a Rome destination', () => {
    const leak = serializeLeak(grunt, 'SW', false);
    const hop = resolveLeakHop(leak, 4);
    expect(hop.destination).toBe('ROME');
    expect(hop.entry).toBeNull();
  });
});

describe('Leak manifest (Section 9.3)', () => {
  it('bundles a wave of leaks compactly', () => {
    const m = buildLeakManifest(7, 'NW', [serializeLeak(grunt, 'NW', false)]);
    expect(m.wave).toBe(7);
    expect(m.fromQuadrant).toBe('NW');
    expect(m.units.length).toBe(1);
  });
});
