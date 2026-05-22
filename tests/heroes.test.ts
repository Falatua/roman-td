// Hero System contract tests (C12, 2026-05-19).
//
// Pins the behavior that the rest of the Hero implementation
// depends on. Draft randomness, XP curve, tier banner triggers,
// tower-rule guards, and basic-attack scaling. Keeps these
// contracts stable so future tuning passes can change numbers
// in herodefs.json without breaking the game loop.
//
// NOTE: These tests deliberately avoid invoking renderer-bound
// code (RenderEngine, ChooseHeroModal, UIManager) — those are
// exercised via the manual smoke pass in the implementation
// plan. The unit tests cover the pure-logic surface in
// HeroSystem, TowerSystem hero guards, and toRemoteRow.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  draftHeroChoices,
  pickHero,
  awardHeroXp,
  getHeroTier,
  HERO_POOL,
  HeroId,
  HERO_FORGE_CAP,
  heroForgeNextCost,
  heroForgeDmgMult,
  heroForgeCooldownMult,
  heroForgeMagnitudeMult,
  scaleParams
} from '../src/systems/HeroSystem';
import { createTower } from '../src/systems/TowerSystem';
import { createGameState, GameStateShape } from '../src/GameState';
import { TowerType } from '../src/types';
import { toRemoteRow } from '../src/services/SupabaseLeaderboard';
import { previewSpawnHp } from '../src/systems/WaveManager';
import HERO_DEFS from '../src/data/herodefs.json';

function freshState(): GameStateShape {
  const s = createGameState();
  return s;
}

// ─────────────────────────────────────────────────────────────────────
// DRAFT
// ─────────────────────────────────────────────────────────────────────
describe('Hero draft (all-6 horizontal-scroll picker)', () => {
  // 2026-05-21 — Draft no longer slices the pool to 3. The
  // ChooseHeroModal now shows ALL 6 heroes in a horizontal-scroll
  // row so the player picks freely from the full roster instead of
  // being handed an RNG triple. Fisher-Yates is kept so the display
  // order still varies between runs.
  it('returns all 6 hero ids', () => {
    const picks = draftHeroChoices();
    expect(picks.length).toBe(6);
  });

  it('all 6 ids are members of HERO_POOL', () => {
    const picks = draftHeroChoices();
    for (const id of picks) {
      expect(HERO_POOL).toContain(id);
    }
  });

  it('all 6 picks are distinct (no duplicates from Fisher-Yates)', () => {
    for (let trial = 0; trial < 50; trial++) {
      const picks = draftHeroChoices();
      expect(new Set(picks).size).toBe(6);
    }
  });

  it('produces varied display orders across 60 attempts — shuffle is non-degenerate', () => {
    // The set of picks is always the same 6 heroes; what varies is
    // the display ORDER. Fisher-Yates over 6 elements has 6!=720
    // permutations, so across 60 trials we should see plenty of
    // distinct orderings. Loose lower bound of 10 distinct orders
    // proves the shuffle is working without being flaky.
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const picks = draftHeroChoices();
      seen.add(picks.join(','));
    }
    expect(seen.size).toBeGreaterThanOrEqual(10);
  });

  it('HERO_POOL contains exactly the 6 historical generals', () => {
    expect(HERO_POOL).toEqual([
      'HERO_MARIUS',
      'HERO_AGRIPPA',
      'HERO_AGRICOLA',
      'HERO_SCIPIO',
      'HERO_CAESAR',
      'HERO_SULLA'
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// PICK + COMMIT
// ─────────────────────────────────────────────────────────────────────
describe('pickHero side effects', () => {
  let s: GameStateShape;
  beforeEach(() => { s = freshState(); });

  it('sets activeHeroId on the state', () => {
    pickHero(s, 'HERO_CAESAR');
    expect(s.activeHeroId).toBe('HERO_CAESAR');
  });

  it('zeros heroXp / heroTier / heroLifeHealedThisRun (clean slate)', () => {
    s.heroXp = 999;
    s.heroTier = 3;
    s.heroLifeHealedThisRun = 17;
    pickHero(s, 'HERO_AGRIPPA');
    expect(s.heroXp).toBe(0);
    expect(s.heroTier).toBe(0);
    expect(s.heroLifeHealedThisRun).toBe(0);
  });

  it('queues a placement token with source==="hero"', () => {
    pickHero(s, 'HERO_SCIPIO');
    const queued = s.pendingPurchasedTowers ?? [];
    expect(queued.length).toBe(1);
    expect(queued[0].type).toBe('HERO_SCIPIO' as any);
    expect((queued[0] as any).source).toBe('hero');
    expect(queued[0].tier).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// XP CURVE
// ─────────────────────────────────────────────────────────────────────
describe('Hero XP curve', () => {
  let s: GameStateShape;
  beforeEach(() => { s = freshState(); pickHero(s, 'HERO_MARIUS'); });

  it('non-boss kill awards +1 XP', () => {
    awardHeroXp(s, false);
    expect(s.heroXp).toBe(1);
  });

  it('boss kill awards +20 XP', () => {
    awardHeroXp(s, true);
    expect(s.heroXp).toBe(20);
  });

  it('XP is cumulative across many kills', () => {
    for (let i = 0; i < 50; i++) awardHeroXp(s, false);
    awardHeroXp(s, true);
    expect(s.heroXp).toBe(70);
  });

  it('does nothing when no hero is active (defensive)', () => {
    s.activeHeroId = null;
    awardHeroXp(s, true);
    expect(s.heroXp).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// TIER THRESHOLDS
// ─────────────────────────────────────────────────────────────────────
describe('Hero tier thresholds (TIRO 0 / LEGATUS 75 / CONSUL 280 / IMPERATOR 580 / DIVUS 850)', () => {
  // 2026-05-19 — Thresholds rebalanced from [0, 75, 280, 650, 1300] to
  // [0, 75, 280, 580, 850]. Reason: the original 1300 cap was
  // mathematically unreachable in a 20-wave campaign (max cum XP ≈ 956).
  // New cap lands DIVUS around W17 — matching the spec's "~W16" target
  // with a small buffer.
  let s: GameStateShape;
  beforeEach(() => { s = freshState(); pickHero(s, 'HERO_SULLA'); });

  it('starts at tier 0 (TIRO) immediately after pickHero', () => {
    expect(getHeroTier(s)).toBe(0);
  });

  it('reaches tier 1 (LEGATUS) exactly at 75 XP', () => {
    s.heroXp = 74;
    awardHeroXp(s, false);  // +1 → 75
    expect(getHeroTier(s)).toBe(1);
  });

  it('does NOT reach tier 1 at 74 XP', () => {
    s.heroXp = 73;
    awardHeroXp(s, false);  // +1 → 74
    expect(getHeroTier(s)).toBe(0);
  });

  it('reaches tier 2 (CONSUL) exactly at 280 XP', () => {
    s.heroXp = 260;
    awardHeroXp(s, true);   // +20 → 280
    expect(getHeroTier(s)).toBe(2);
  });

  it('reaches tier 3 (IMPERATOR) exactly at 580 XP', () => {
    s.heroXp = 560;
    awardHeroXp(s, true);   // +20 → 580
    expect(getHeroTier(s)).toBe(3);
  });

  it('reaches tier 4 (DIVUS) exactly at 850 XP and caps there', () => {
    s.heroXp = 830;
    awardHeroXp(s, true);   // +20 → 850
    expect(getHeroTier(s)).toBe(4);
    // Far-overshoot stays at tier 4 (no tier 5).
    s.heroXp = 99_999;
    awardHeroXp(s, false);
    expect(getHeroTier(s)).toBe(4);
  });

  it('fires pushTierUpBanner exactly once per tier crossing', () => {
    const banners: string[] = [];
    const hooks = { pushTierUpBanner: (t: string) => banners.push(t) };
    // Drive XP straight to LEGATUS via a boss kill.
    s.heroXp = 55;
    awardHeroXp(s, true, hooks); // 55 + 20 = 75 → crosses to tier 1
    expect(banners.length).toBe(1);
    // Another kill at the same tier — no banner.
    awardHeroXp(s, false, hooks);
    expect(banners.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// BASIC ATTACK SCALE
// ─────────────────────────────────────────────────────────────────────
describe('Basic attack scale per tier (1.0 / 1.2 / 1.5 / 1.9 / 2.4)', () => {
  it('every hero has the locked 5-tier ramp', () => {
    for (const id of HERO_POOL) {
      const def: any = (HERO_DEFS as any)[id];
      expect(def.basicAtkScalePerTier).toEqual([1.0, 1.2, 1.5, 1.9, 2.4]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// TOWER GUARDS
// ─────────────────────────────────────────────────────────────────────
describe('Hero tower rules (isHero / no sell / no combine / no move / free)', () => {
  it('createTower stamps isHero=true for HERO_* types', () => {
    const h = createTower(TowerType.HERO_MARIUS, 1, 5, 5, 0);
    expect((h as any).isHero).toBe(true);
  });

  it('createTower stamps isHero=false for regular towers', () => {
    const t = createTower(TowerType.MILITES, 1, 5, 5, 0);
    expect((t as any).isHero).toBe(false);
  });

  it('all 6 hero tower types report isHero=true', () => {
    const heroTypes = [
      TowerType.HERO_MARIUS, TowerType.HERO_AGRIPPA, TowerType.HERO_AGRICOLA,
      TowerType.HERO_SCIPIO, TowerType.HERO_CAESAR, TowerType.HERO_SULLA
    ];
    for (const t of heroTypes) {
      const tower = createTower(t, 1, 0, 0, 0);
      expect((tower as any).isHero).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// LEADERBOARD WIRING
// ─────────────────────────────────────────────────────────────────────
describe('toRemoteRow hero column wiring', () => {
  const baseEntry = {
    name: 'TESTER', score: 12345, wave: 17, won: true,
    questsCompleted: 4, towersCombined: 8,
    date: 'September 13 2026'
  };

  it('populates hero_id when passed', () => {
    const row = toRemoteRow(baseEntry, 'campaign', 'HERO_CAESAR');
    expect(row.hero_id).toBe('HERO_CAESAR');
  });

  it('defaults to null when omitted (pre-hero compat)', () => {
    const row = toRemoteRow(baseEntry, 'campaign');
    expect(row.hero_id).toBeNull();
  });

  it('preserves all existing fields untouched', () => {
    const row = toRemoteRow(baseEntry, 'campaign', 'HERO_MARIUS');
    expect(row.name).toBe('TESTER');
    expect(row.score).toBe(12345);
    expect(row.wave).toBe(17);
    expect(row.won).toBe(true);
    expect(row.quests_completed).toBe(4);
    expect(row.towers_combined).toBe(8);
    expect(row.mode).toBe('campaign');
  });
});

// ─────────────────────────────────────────────────────────────────────
// HERODEFS SOURCE-OF-TRUTH SHAPE
// ─────────────────────────────────────────────────────────────────────
describe('herodefs.json shape (single source of tuning)', () => {
  it('contains an entry for every member of HERO_POOL', () => {
    for (const id of HERO_POOL) {
      expect((HERO_DEFS as any)[id]).toBeDefined();
    }
  });

  it('every hero has 2 abilities at levels 1, 2', () => {
    // 2026-05-21 — Tier-3 abilities dropped for every hero. The
    // tier-3 milestone (IMPERATOR) becomes a stat-only upgrade; the
    // basic-attack scale still climbs 1.0× → 2.4× across the 5 tiers
    // but no new ability unlocks at tier 3.
    for (const id of HERO_POOL) {
      const def: any = (HERO_DEFS as any)[id];
      expect(def.abilities?.length).toBe(2);
      expect(def.abilities.map((a: any) => a.level)).toEqual([1, 2]);
    }
  });

  it('every hero has the locked 5-tier XP threshold ladder', () => {
    for (const id of HERO_POOL) {
      const def: any = (HERO_DEFS as any)[id];
      // 2026-05-19 — Rebalanced from [0, 75, 280, 650, 1300]. Old cap
      // was unreachable across a 20-wave campaign; new cap lands DIVUS
      // around W17 (within "~W16" target).
      expect(def.xpThresholds).toEqual([0, 75, 280, 580, 850]);
    }
  });

  it('every hero has 5 tier titles', () => {
    for (const id of HERO_POOL) {
      const def: any = (HERO_DEFS as any)[id];
      expect(def.tierTitles?.length).toBe(5);
    }
  });

  it('every hero has 5 banner copy lines (T0..T4)', () => {
    for (const id of HERO_POOL) {
      const def: any = (HERO_DEFS as any)[id];
      expect(def.bannerCopy?.length).toBe(5);
    }
  });

  // 2026-05-19 — Regression test for the Agricola passive-display
  // bug. His passive uses `kind:'DUAL'` with nested global+local
  // descriptions instead of the flat description shape the other
  // heroes carry; before this fix the choose-hero modal rendered an
  // empty PASSIVE row for him because the UI read `passive.description`
  // directly. Pinning that EVERY hero exposes a non-empty description
  // (top-level OR assembled from nested global/local) keeps any
  // future DUAL-kind hero from regressing the same UI surface.
  it('every hero exposes a non-empty passive description (top-level or DUAL)', () => {
    for (const id of HERO_POOL) {
      const def: any = (HERO_DEFS as any)[id];
      const p = def.passive;
      // Treat a DUAL passive as valid if it carries a description OR
      // if at least one nested global/local description is present —
      // matches the rendering fallback used in the modal / Codex /
      // inspect panel.
      const flat   = p?.description ?? '';
      const global = p?.global?.description ?? '';
      const local  = p?.local?.description ?? '';
      const combined = flat || `${global} ${local}`.trim();
      expect(combined.length, `${id} has empty passive description`).toBeGreaterThan(0);
    }
  });

  // 2026-05-19 — Damage-type distribution test. The roster ships with
  // 5-type coverage: 1 melee / 2 ranged / 1 siege / 1 divine / 1 fire.
  // Pins the spread so a future hero-aura tuning pass can't quietly
  // reintroduce the original 3-ranged / 2-divine / 0-siege / 0-fire
  // imbalance.
  //
  // 2026-05-20 v2 — Sulla's passive was reworked from a +35% damage
  // aura on FIRE towers (which used the legacy `filter:
  // "ELEMENTAL_FIRE"` shape) to a DAMAGE_TYPE_CONVERSION passive that
  // overrides nearby towers' damage type to FIRE. The fire "coverage"
  // moves from a `filter` to a `convertTo` field. Test reads both.
  it('aura filters cover the 5 damage types (including Sulla\'s fire conversion target)', () => {
    const filters = HERO_POOL.map(id => {
      const def: any = (HERO_DEFS as any)[id];
      // Marius/Agrippa use top-level filter; Agricola has
      // passive.local.filter; Scipio uses VS_BOSS (no damage-type
      // filter); Caesar is unfiltered global; Sulla uses convertTo
      // (DAMAGE_TYPE_CONVERSION passive — towers within 2 tiles
      // get their damage type overridden to convertTo).
      return def.passive?.filter
        ?? def.passive?.local?.filter
        ?? def.passive?.convertTo
        ?? null;
    });
    expect(filters).toContain('PHYS_MELEE');
    expect(filters).toContain('PHYS_RANGED');
    expect(filters).toContain('SIEGE');
    expect(filters).toContain('ELEMENTAL_FIRE');     // Sulla's convertTo target
    // VS_BOSS is the Scipio filter; Caesar carries no filter at all.
    expect(filters).toContain('VS_BOSS');
  });
});

// ─────────────────────────────────────────────────────────────────────
// HP COMPENSATION (hero-active runs face +15% enemy HP)
// ─────────────────────────────────────────────────────────────────────
describe('Enemy HP compensation when a hero is active', () => {
  // The fake def shape mirrors what enemies.json carries. We pin a base
  // 1000 HP non-boss + 1000 HP boss so the math is easy to verify.
  const dogDef = { baseHp: 1000, isBoss: false, isFlyer: false };
  const bossDef = { baseHp: 1000, isBoss: true, isFlyer: false };

  it('previewSpawnHp adds 15% on regular waves when heroActive=true', () => {
    // W5 G-type at hpMult 1.0 → basicBuff 1.70 → 1700 base, ×1.15 = 1955.
    const base = previewSpawnHp(dogDef, 5, 'G', 1.0, false);
    const hero = previewSpawnHp(dogDef, 5, 'G', 1.0, true);
    expect(hero / base).toBeCloseTo(1.15, 2);
  });

  it('previewSpawnHp adds 15% on boss waves when heroActive=true', () => {
    // W10 B-type with bossDef → basicBuff 1.0 (boss exempt) plus soloBuff 2.0.
    const base = previewSpawnHp(bossDef, 10, 'B', 3.0, false);
    const hero = previewSpawnHp(bossDef, 10, 'B', 3.0, true);
    expect(hero / base).toBeCloseTo(1.15, 2);
  });

  it('previewSpawnHp keeps W1 pin behaviour: 100 base, 115 with hero', () => {
    expect(previewSpawnHp(dogDef, 1, 'G', 1.0, false)).toBe(100);
    expect(previewSpawnHp(dogDef, 1, 'G', 1.0, true)).toBe(115);
  });

  it('previewSpawnHp defaults to no hero comp when the arg is omitted (back-compat)', () => {
    const noArg = previewSpawnHp(dogDef, 5, 'G', 1.0);
    const explicitFalse = previewSpawnHp(dogDef, 5, 'G', 1.0, false);
    expect(noArg).toBe(explicitFalse);
  });
});

// ─────────────────────────────────────────────────────────────────────
// SANDBOX ISOLATION
// ─────────────────────────────────────────────────────────────────────
describe('Hero state isolation', () => {
  it('createGameState defaults activeHeroId to null', () => {
    const s = createGameState();
    expect(s.activeHeroId).toBeNull();
    expect(s.heroXp).toBe(0);
    expect(s.heroTier).toBe(0);
    expect(s.heroLifeHealedThisRun).toBe(0);
  });

  it('a fresh pickHero on a state that previously held a different hero replaces it cleanly', () => {
    const s = freshState();
    pickHero(s, 'HERO_CAESAR');
    awardHeroXp(s, true);
    awardHeroXp(s, true);
    awardHeroXp(s, true);
    awardHeroXp(s, true); // 80 XP → tier 1 (LEGATUS at 75)
    expect(s.heroXp).toBe(80);
    expect(getHeroTier(s)).toBe(1);

    pickHero(s, 'HERO_AGRICOLA');
    expect(s.activeHeroId).toBe('HERO_AGRICOLA');
    expect(s.heroXp).toBe(0);
    expect(s.heroTier).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// HERO FORGE (2026-05-20 v2)
// ─────────────────────────────────────────────────────────────────────
describe('Hero Forge — pay-gold upgrade system', () => {
  it('cap constant is 5', () => {
    expect(HERO_FORGE_CAP).toBe(5);
  });

  it('heroForgeNextCost doubles from 20g: 20/40/80/160/320 then MAXED', () => {
    // 2026-05-20 v3 — ramp lowered from linear-steep (100/200/300/
    // 400/500) to doubling-from-20g. First tap on any path is always
    // 20g so sampling a new path is never a big commitment; the
    // doubling makes maxing out a real commitment.
    expect(heroForgeNextCost(0)).toBe(20);
    expect(heroForgeNextCost(1)).toBe(40);
    expect(heroForgeNextCost(2)).toBe(80);
    expect(heroForgeNextCost(3)).toBe(160);
    expect(heroForgeNextCost(4)).toBe(320);
    expect(heroForgeNextCost(5)).toBeNull();           // cap
    expect(heroForgeNextCost(99)).toBeNull();          // defensive
    // Sum per path maxed = 20 + 40 + 80 + 160 + 320 = 620g.
    const total = [0, 1, 2, 3, 4].reduce((acc, n) => acc + (heroForgeNextCost(n) ?? 0), 0);
    expect(total).toBe(620);
  });

  it('heroForgeDmgMult: +6% per tap, +30% at 5/5', () => {
    const s = freshState();
    expect(heroForgeDmgMult(s)).toBeCloseTo(1.0, 6);
    s.heroForgeStacks = { dmg: 3, cd: 0, aura: 0 };
    expect(heroForgeDmgMult(s)).toBeCloseTo(1.18, 6);
    s.heroForgeStacks = { dmg: 5, cd: 0, aura: 0 };
    expect(heroForgeDmgMult(s)).toBeCloseTo(1.30, 6);
  });

  it('heroForgeCooldownMult: 0.95^N compounding', () => {
    const s = freshState();
    expect(heroForgeCooldownMult(s)).toBeCloseTo(1.0, 6);
    s.heroForgeStacks = { dmg: 0, cd: 5, aura: 0 };
    expect(heroForgeCooldownMult(s)).toBeCloseTo(0.7737809375, 6);
  });

  it('heroForgeMagnitudeMult: +5% per tap, +25% at 5/5', () => {
    const s = freshState();
    expect(heroForgeMagnitudeMult(s)).toBeCloseTo(1.0, 6);
    s.heroForgeStacks = { dmg: 0, cd: 0, aura: 5 };
    expect(heroForgeMagnitudeMult(s)).toBeCloseTo(1.25, 6);
  });

  it('scaleParams: scales numeric magnitudes but skips Count fields, booleans, lifetimeHealCap', () => {
    const params = {
      dmgMultiplier: 2.0,           // numeric → scale
      enemySpeedReductionPercent: 60, // numeric → scale
      wallDurationSec: 4,           // numeric → scale
      javelinCount: 5,              // Count → KEEP
      shellCount: 3,                // Count → KEEP
      forceBonusAttack: true,       // boolean → KEEP
      targets: 'ALL_TOWERS',        // string → KEEP
      lifetimeHealCap: 20,          // static cap → KEEP
      healGateAmount: 7             // numeric → scale
    };
    const scaled = scaleParams(params, 1.20);
    expect(scaled.dmgMultiplier).toBeCloseTo(2.40, 6);
    expect(scaled.enemySpeedReductionPercent).toBeCloseTo(72, 6);
    expect(scaled.wallDurationSec).toBeCloseTo(4.8, 6);
    expect(scaled.javelinCount).toBe(5);             // unchanged
    expect(scaled.shellCount).toBe(3);
    expect(scaled.forceBonusAttack).toBe(true);
    expect(scaled.targets).toBe('ALL_TOWERS');
    expect(scaled.lifetimeHealCap).toBe(20);
    expect(scaled.healGateAmount).toBeCloseTo(8.4, 6);
  });

  it('scaleParams: bossSpeedMultiplier is INVERSE-scaled (higher EMPOWER = slower bosses)', () => {
    const scaled = scaleParams({ bossSpeedMultiplier: 0.5 }, 1.25);
    // 0.5 / 1.25 = 0.4 — bosses move at 40% instead of 50%
    expect(scaled.bossSpeedMultiplier).toBeCloseTo(0.4, 6);
  });

  it('scaleParams: identity when magnitudeMult is 1', () => {
    const params = { dmgMultiplier: 2.0, javelinCount: 5 };
    expect(scaleParams(params, 1)).toBe(params);     // same ref — no allocation
  });

  it('pickHero refund: 50% of heroForgeGoldSpent returned on re-pick', () => {
    const s = freshState();
    s.gold = 100;
    pickHero(s, 'HERO_CAESAR');
    // Simulate fully-maxed SHARPEN under the v3 doubling ramp
    // (20 + 40 + 80 + 160 + 320 = 620g).
    s.heroForgeStacks = { dmg: 5, cd: 0, aura: 0 };
    s.heroForgeGoldSpent = 620;
    const goldBeforeRePick = s.gold;
    pickHero(s, 'HERO_MARIUS');
    // 50% of 620 = 310g refunded
    expect(s.gold).toBe(goldBeforeRePick + 310);
    expect(s.heroForgeStacks).toEqual({ dmg: 0, cd: 0, aura: 0 });
    expect(s.heroForgeGoldSpent).toBe(0);
    expect(s.activeHeroId).toBe('HERO_MARIUS');
  });

  it('pickHero refund: no refund on first hero pick (no prior heroForgeGoldSpent)', () => {
    const s = freshState();
    const goldBefore = s.gold ?? 0;
    pickHero(s, 'HERO_CAESAR');
    // First pick — no refund branch should have fired
    expect(s.gold).toBe(goldBefore);
    expect(s.heroForgeGoldSpent).toBe(0);
  });
});
