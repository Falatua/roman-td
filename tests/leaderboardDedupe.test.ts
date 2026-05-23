// Tests for the leaderboard duplicate-submit fix (2026-05-22).
//
// User-reported bug: a single end-of-run submit was creating two
// identical rows in the Hall of Glory (JB Wave 14 30,718 listed twice).
// Root cause: a network hiccup mid-POST caused the client to time out
// after the server had already committed the insert; the retry loop
// then fired again and created a second row. Same dynamic applied to
// the user-facing RETRY button.
//
// These tests validate the two-pronged fix:
//   1. `generateRowId` returns a UUID-shaped string. Used to pre-assign
//      a stable PK so any retry collides on PK uniqueness (Supabase
//      returns 409, which submitScore now treats as success).
//   2. `submissionSignature` produces stable, distinct signatures so
//      `hasBeenSubmitted` / `markSubmitted` can dedupe across page
//      reloads or rapid retry-button clicks.
//   3. `toRemoteRow(entry, mode, hero, id)` now threads the id into
//      the produced row when supplied, and omits it otherwise.
//
// These are pure-function tests — no Supabase, no network.

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';

// vitest runs in 'node' environment by default. Node 22+ ships an
// experimental localStorage stub that throws on setItem unless
// `--localstorage-file` is wired up (which we don't bother to do).
// So `typeof globalThis.localStorage` is "object" but actually using
// it throws. We always replace with an in-memory Map-backed polyfill
// to guarantee the dedupe flag actually persists for THESE tests.
beforeAll(() => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.has(k) ? store.get(k) ?? null : null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  } as Storage;
});

import {
  generateRowId,
  submissionSignature,
  hasBeenSubmitted,
  markSubmitted,
  toRemoteRow,
} from '../src/services/SupabaseLeaderboard';

describe('leaderboard duplicate-submit dedupe', () => {
  beforeEach(() => {
    // Clean localStorage between tests so prior signatures don't leak.
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  describe('generateRowId', () => {
    it('returns a UUID-shaped string', () => {
      const id = generateRowId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('produces distinct ids on repeat calls', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 50; i++) ids.add(generateRowId());
      expect(ids.size).toBe(50);
    });
  });

  describe('submissionSignature + hasBeenSubmitted + markSubmitted', () => {
    const entry = { name: 'JB', score: 30718, wave: 14, ts: 1716163200000 };

    it('produces a stable signature for the same entry', () => {
      const sig1 = submissionSignature(entry, 'campaign');
      const sig2 = submissionSignature(entry, 'campaign');
      expect(sig1).toBe(sig2);
    });

    it('produces distinct signatures for different scores', () => {
      const a = submissionSignature({ ...entry, score: 30718 }, 'campaign');
      const b = submissionSignature({ ...entry, score: 30770 }, 'campaign');
      expect(a).not.toBe(b);
    });

    it('produces distinct signatures for different ts (same name+score+wave)', () => {
      // Two runs same player, same wave, same score, different timestamps.
      // Should NOT be deduped — they're legitimately distinct runs.
      const a = submissionSignature({ ...entry, ts: 1716163200000 }, 'campaign');
      const b = submissionSignature({ ...entry, ts: 1716163300000 }, 'campaign');
      expect(a).not.toBe(b);
    });

    it('produces distinct signatures for different modes', () => {
      const a = submissionSignature(entry, 'campaign');
      const b = submissionSignature(entry, 'endless');
      expect(a).not.toBe(b);
    });

    it('hasBeenSubmitted returns false before markSubmitted', () => {
      const sig = submissionSignature(entry, 'campaign');
      expect(hasBeenSubmitted(sig)).toBe(false);
    });

    it('hasBeenSubmitted returns true after markSubmitted', () => {
      const sig = submissionSignature(entry, 'campaign');
      markSubmitted(sig);
      expect(hasBeenSubmitted(sig)).toBe(true);
    });

    it('hasBeenSubmitted is signature-specific (no cross-contamination)', () => {
      const sigA = submissionSignature(entry, 'campaign');
      const sigB = submissionSignature({ ...entry, score: 99999 }, 'campaign');
      markSubmitted(sigA);
      expect(hasBeenSubmitted(sigA)).toBe(true);
      expect(hasBeenSubmitted(sigB)).toBe(false);
    });
  });

  describe('toRemoteRow id threading', () => {
    const baseEntry = {
      name: 'JB',
      score: 30718,
      wave: 14,
      won: false,
      questsCompleted: 15,
      towersCombined: 13,
      date: 'May 19 2026',
    };

    it('omits id when not supplied (server uses default gen_random_uuid)', () => {
      const row = toRemoteRow(baseEntry, 'campaign', null);
      expect(row.id).toBeUndefined();
    });

    it('includes id when supplied (idempotent retries)', () => {
      const row = toRemoteRow(baseEntry, 'campaign', null, 'abcd1234-5678-4abc-9def-1234567890ab');
      expect(row.id).toBe('abcd1234-5678-4abc-9def-1234567890ab');
    });

    it('preserves hero_id alongside row id', () => {
      const row = toRemoteRow(baseEntry, 'campaign', 'SCIPIO', 'abcd1234-5678-4abc-9def-1234567890ab');
      expect(row.hero_id).toBe('SCIPIO');
      expect(row.id).toBe('abcd1234-5678-4abc-9def-1234567890ab');
    });

    it('still clamps score and wave to safe ranges', () => {
      const row = toRemoteRow({ ...baseEntry, score: 99999999, wave: 99999 }, 'campaign', null);
      expect(row.score).toBe(9999999);
      expect(row.wave).toBe(9999);
    });
  });

  describe('end-to-end dedupe flow (simulates finalize behavior)', () => {
    it('skips duplicate submit when signature already marked', () => {
      const entry = { name: 'JB', score: 30718, wave: 14, ts: Date.now() };
      const sig = submissionSignature(entry, 'campaign');

      // First "submit" — mark as submitted.
      expect(hasBeenSubmitted(sig)).toBe(false);
      markSubmitted(sig);

      // Second "submit" attempt — same entry. finalize() will short-circuit.
      expect(hasBeenSubmitted(sig)).toBe(true);
    });

    it('does NOT dedupe a genuinely different run by the same player', () => {
      const entryA = { name: 'JB', score: 30718, wave: 14, ts: 1716163200000 };
      const entryB = { name: 'JB', score: 30770, wave: 14, ts: 1716163500000 };

      const sigA = submissionSignature(entryA, 'campaign');
      const sigB = submissionSignature(entryB, 'campaign');

      markSubmitted(sigA);

      // Different run → different signature → not deduped.
      expect(hasBeenSubmitted(sigA)).toBe(true);
      expect(hasBeenSubmitted(sigB)).toBe(false);
    });
  });
});
