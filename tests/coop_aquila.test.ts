// Phase 10 — Aquila Team Combo Tower (Section 7.2).
import { describe, it, expect } from 'vitest';
import {
  createAquila, isZeroLeakRound, grantAquilaReward, canPlaceAquila,
  canPlaceAquilaAt, placeAquila, isAquilaActive, destroyAquila, damageAquila,
  legionCommander, AQUILA_HP,
} from '../src/coop/LegionAquila';
import type { RoundSummaryRow } from '../src/coop/LegionEconomy';

describe('Zero-leak reward unlock (Section 7.2)', () => {
  it('unlocks only when every active quadrant leaked nothing', () => {
    expect(isZeroLeakRound([0, 0, 0, 0])).toBe(true);
    expect(isZeroLeakRound([0, 1, 0])).toBe(false);
    expect(isZeroLeakRound([])).toBe(false);
  });
  it('grants the reward idempotently', () => {
    let a = createAquila();
    expect(a.earned).toBe(false);
    a = grantAquilaReward(a);
    expect(a.earned).toBe(true);
    a = grantAquilaReward(a); // no double-effect
    expect(a.earned).toBe(true);
  });
});

describe('Placement rules (one per game, seam-only exception)', () => {
  it('cannot place before earning', () => {
    expect(canPlaceAquila(createAquila())).toBe(false);
  });
  it('can place once earned, then never again', () => {
    let a = grantAquilaReward(createAquila());
    expect(canPlaceAquila(a)).toBe(true);
    // (17..22) is the seam/cross band; (16,19) is a seam arm tile in 4p.
    a = placeAquila(a, 19, 16, 4);
    expect(a.placed).toBe(true);
    expect(a.hp).toBe(AQUILA_HP);
    expect(canPlaceAquila(a)).toBe(false); // only one per game
  });
  it('seam-placement exception: SEAM tiles only', () => {
    // A quadrant tile (0,0 = NW corner) is rejected; a seam tile is allowed.
    expect(canPlaceAquilaAt(0, 0, 4)).toBe(false);   // QUADRANT
    expect(canPlaceAquilaAt(19, 19, 4)).toBe(false); // ROME (cross intersection)
    expect(canPlaceAquilaAt(16, 19, 4)).toBe(true);  // SEAM arm
  });
  it('rejects placement on a non-seam tile even when earned', () => {
    const a = grantAquilaReward(createAquila());
    const tryQuad = placeAquila(a, 0, 0, 4); // NW quadrant tile
    expect(tryQuad.placed).toBe(false);
  });
});

describe('Fragility — boss impact destroys it (Section 7.2)', () => {
  it('is active after placement', () => {
    const a = placeAquila(grantAquilaReward(createAquila()), 16, 19, 4);
    expect(isAquilaActive(a)).toBe(true);
  });
  it('a boss impact destroys it permanently', () => {
    let a = placeAquila(grantAquilaReward(createAquila()), 16, 19, 4);
    a = destroyAquila(a);
    expect(a.destroyed).toBe(true);
    expect(isAquilaActive(a)).toBe(false);
    expect(canPlaceAquila(a)).toBe(false); // cannot rebuild
  });
  it('chip damage destroys it when HP reaches zero', () => {
    let a = placeAquila(grantAquilaReward(createAquila()), 16, 19, 4);
    a = damageAquila(a, AQUILA_HP - 1);
    expect(isAquilaActive(a)).toBe(true);
    a = damageAquila(a, 5);
    expect(isAquilaActive(a)).toBe(false);
  });
});

describe('Legion Commander selection (Section 7.2)', () => {
  function row(id: string, wk: number, ck: number): RoundSummaryRow {
    return { playerId: id, name: id, quadrantTitle: 'Hastati', waveKills: wk, circuitKills: ck, leaks: 0, romeContributed: 0 };
  }
  it('picks the highest total (wave + circuit) kills', () => {
    expect(legionCommander([row('a', 10, 2), row('b', 8, 9), row('c', 5, 1)])).toBe('b');
  });
  it('returns null for no players', () => {
    expect(legionCommander([])).toBeNull();
  });
});
