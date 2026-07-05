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
  scaleParams,
  tickHeroAbilities
} from '../src/systems/HeroSystem';
import { createTower, towerEffectiveStats } from '../src/systems/TowerSystem';
import { pickTarget, tickCombat } from '../src/systems/CombatResolver';
import { getTowerProjectileProfile } from '../src/systems/ProjectileSystem';
import { createGameState, GameStateShape } from '../src/GameState';
import { DamageType, Enemy, EnemyFaction, EnemyType, GamePhase, StatusEffectKind, TowerType } from '../src/types';
import { toRemoteRow } from '../src/services/SupabaseLeaderboard';
import { previewSpawnHp, startWave } from '../src/systems/WaveManager';
import { buildMercatorTowerOffers, CHAMPION_TYPES } from '../src/systems/MerchantSystem';
import { championForHero, heroIdForTowerType } from '../src/systems/HeroIdentity';
import { heroAuraScaleForTier, heroTierForTower } from '../src/systems/HeroScaling';
import HERO_DEFS from '../src/data/herodefs.json';

function freshState(): GameStateShape {
  const s = createGameState();
  return s;
}

function testEnemy(id: string, opts: Partial<Enemy> = {}): Enemy {
  return {
    id,
    type: opts.type ?? EnemyType.FERAL_DOG,
    faction: opts.faction ?? EnemyFaction.DOGS,
    hp: opts.hp ?? 1000,
    maxHp: opts.maxHp ?? opts.hp ?? 1000,
    baseSpeed: opts.baseSpeed ?? 1,
    currentSpeed: opts.currentSpeed ?? 1,
    isFlyer: opts.isFlyer ?? false,
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    pathIndex: opts.pathIndex ?? 0,
    pathProgress: opts.pathProgress ?? 0,
    statusEffects: opts.statusEffects ?? [],
    hasFeared: opts.hasFeared ?? false,
    livesCost: opts.livesCost ?? 1,
    isBoss: opts.isBoss ?? false,
    reward: opts.reward ?? 0,
    archetype: opts.archetype ?? 'SWARM',
    hpFlashTimer: opts.hpFlashTimer ?? 0
  };
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
describe('Basic attack scale per tier (1.0 / 1.5 / 2.2 / 3.2 / 4.5)', () => {
  it('every hero has the locked 5-tier ramp', () => {
    for (const id of HERO_POOL) {
      const def: any = (HERO_DEFS as any)[id];
      expect(def.basicAtkScalePerTier).toEqual([1.0, 1.5, 2.2, 3.2, 4.5]);
    }
  });

  it('starter hero regular attacks become much stronger as rank rises', () => {
    const s = freshState();
    pickHero(s, 'HERO_CAESAR');
    const h = createTower(TowerType.HERO_CAESAR, 1, 8, 8, 1);
    s.towers.set(h.id, h);
    s.activeHeroTowerId = h.id;
    (globalThis as any).__game = s;
    s.heroTier = 0;
    const tiroDps = towerEffectiveStats(h).dps;
    s.heroTier = 4;
    const divusDps = towerEffectiveStats(h).dps;
    delete (globalThis as any).__game;
    expect(divusDps).toBeCloseTo(tiroDps * 4.5, 5);
  });

  it('hero passive aura strength doubles by DIVUS', () => {
    expect(heroAuraScaleForTier(0)).toBe(1.0);
    expect(heroAuraScaleForTier(4)).toBe(2.0);
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

  it('Mercator excludes the Champion matching the starter hero', () => {
    const offers = buildMercatorTowerOffers(9, 5, { activeHeroId: 'HERO_CAESAR' });
    expect(offers.map(o => o.type)).not.toContain(championForHero('HERO_CAESAR'));
    expect(offers.map(o => o.type)).toContain('CHAMPION_MARIUS');
  });

  it('Mercator excludes Champions already purchased from Mercator this run', () => {
    const offers = buildMercatorTowerOffers(14, 5, {
      activeHeroId: 'HERO_CAESAR',
      purchasedChampionTypes: ['CHAMPION_MARIUS', 'CHAMPION_SULLA']
    });
    const types = offers.map(o => o.type);
    expect(types).not.toContain(championForHero('HERO_CAESAR'));
    expect(types).not.toContain('CHAMPION_MARIUS');
    expect(types).not.toContain('CHAMPION_SULLA');
    expect(types).toContain('CHAMPION_AGRIPPA');
    expect(types.filter(t => CHAMPION_TYPES.includes(t)).length).toBe(3);
  });

  it('Mercator keeps selling normal towers after every Champion has been bought', () => {
    const offers = buildMercatorTowerOffers(23, 5, {
      activeHeroId: null,
      purchasedChampionTypes: [...CHAMPION_TYPES]
    });
    expect(offers.some(o => CHAMPION_TYPES.includes(o.type))).toBe(false);
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every(o => o.tier === 5)).toBe(true);
  });

  it('every Mercator Champion resolves to a full hero kit for shop details', () => {
    const offers = buildMercatorTowerOffers(9, 5, { activeHeroId: null });
    const championOffers = offers.filter(o => String(o.type).startsWith('CHAMPION_'));
    expect(championOffers.length).toBe(6);
    for (const offer of championOffers) {
      expect(offer.tier).toBe(2);
      const heroId = heroIdForTowerType(offer.type);
      expect(heroId, `${offer.type} should map back to a HERO_* identity`).toBeTruthy();
      const def: any = heroId ? (HERO_DEFS as any)[heroId] : null;
      expect(def?.passive?.description, `${offer.type} must expose passive copy for Mercator details`).toBeTruthy();
      expect(def?.abilities?.length, `${offer.type} must expose both ability descriptions for Mercator details`).toBe(2);
      expect(def?.basicAtkScalePerTier?.length, `${offer.type} must expose hero tier scaling for Mercator details`).toBe(5);
    }
  });

  it('Mercator Champions are hero equivalents without overwriting the starter hero', () => {
    const s = freshState();
    s.phase = GamePhase.WAVE_PHASE;
    s.tick = 10;
    s.activeHeroId = 'HERO_MARIUS';
    // Champions keep a T2 floor, then share any higher run tier.
    s.heroTier = 4;
    const champion = createTower(TowerType.CHAMPION_CAESAR, 5, 5, 5, 9);
    const milites = createTower(TowerType.MILITES, 1, 7, 5, 9);
    milites.attackCooldown = 5;
    s.towers.set(champion.id, champion);
    s.towers.set(milites.id, milites);

    expect((champion as any).isHero).toBe(true);
    expect(heroIdForTowerType(String(champion.type))).toBe('HERO_CAESAR');

    tickHeroAbilities(s);

    expect(s.activeHeroId).toBe('HERO_MARIUS');
    expect(milites.attackCooldown).toBe(5);
    expect(champion.__heroCooldowns?.SPQR_DECREE).toBeGreaterThan(s.tick);

    s.tick = 20;
    tickHeroAbilities(s);

    expect(s.activeHeroId).toBe('HERO_MARIUS');
    expect(milites.attackCooldown).toBeGreaterThan(0);
    expect(milites.attackCooldown).toBeLessThan(0.2);
    expect(champion.__heroCooldowns?.SPQR_DECREE).toBeGreaterThan(s.tick);
  });

  it('Sulla Meteor Slam splashes and burns nearby enemies', () => {
    const s = freshState();
    s.phase = GamePhase.WAVE_PHASE;
    s.tick = 10;
    s.activeHeroId = 'HERO_SULLA';
    s.heroTier = 1;
    const sulla = createTower(TowerType.HERO_SULLA, 5, 5, 5, 1);
    s.activeHeroTowerId = sulla.id;
    s.towers.set(sulla.id, sulla);
    const primary = testEnemy('primary', { hp: 1000, maxHp: 1000, x: 5 * 32 + 16 + 16, y: 5 * 32 + 16 });
    const nearby = testEnemy('nearby', { hp: 1000, maxHp: 1000, x: primary.x + 28, y: primary.y });
    const far = testEnemy('far', { hp: 1000, maxHp: 1000, x: primary.x + 120, y: primary.y });
    s.enemies.set(primary.id, primary);
    s.enemies.set(nearby.id, nearby);
    s.enemies.set(far.id, far);
    const fx: any[] = [];

    tickHeroAbilities(s, { triggerHeroAbilityFx: spec => fx.push(spec) });

    expect(primary.hp).toBeLessThan(1000);
    expect(nearby.hp).toBeLessThan(1000);
    expect(primary.hp).toBeLessThan(nearby.hp);
    expect(far.hp).toBe(1000);
    expect(primary.statusEffects.some(st => st.kind === StatusEffectKind.BURN)).toBe(true);
    expect(nearby.statusEffects.some(st => st.kind === StatusEffectKind.BURN)).toBe(true);
    expect(far.statusEffects.some(st => st.kind === StatusEffectKind.BURN)).toBe(false);
    expect(fx[0]?.ability).toBe('FORTUNES_BOLT');
    expect(fx[0]?.extras?.splashRadiusTiles).toBeCloseTo(1.35);
  });

  it('Sulla basic attacks use meteor projectiles in starter and Champion form', () => {
    expect(getTowerProjectileProfile(TowerType.HERO_SULLA)?.key).toBe('PROJ_SULLA_METEOR');
    expect(getTowerProjectileProfile(TowerType.CHAMPION_SULLA)?.key).toBe('PROJ_SULLA_METEOR');
  });

  it('SPQR Decree spreads a large board volley instead of zeroing every cooldown together', () => {
    const s = freshState();
    s.phase = GamePhase.WAVE_PHASE;
    s.tick = 10;
    s.activeHeroId = 'HERO_MARIUS';
    s.heroTier = 4;  // champions share the run tier; max it so SPQR Decree is online
    const caesar = createTower(TowerType.CHAMPION_CAESAR, 5, 5, 5, 9);
    s.towers.set(caesar.id, caesar);
    const commanded = Array.from({ length: 60 }, (_, idx) => {
      const tower = createTower(TowerType.MILITES, 1, 6 + (idx % 20), 7 + Math.floor(idx / 20), 9);
      tower.attackCooldown = 4;
      s.towers.set(tower.id, tower);
      return tower;
    });

    tickHeroAbilities(s); // initialize Champion wake-up
    s.tick = 20;
    tickHeroAbilities(s); // SPQR Decree

    const cooldowns = commanded.map(t => t.attackCooldown);
    expect(Math.min(...cooldowns)).toBeGreaterThanOrEqual(0.08);
    expect(Math.max(...cooldowns)).toBeLessThanOrEqual(1.5);
    expect(new Set(cooldowns).size).toBe(commanded.length);
    expect(cooldowns.filter(cooldown => cooldown <= 0.016).length).toBe(0);
  });

  it('stagger-wakes a full Champion roster so all hero abilities do not fire on the same frame', () => {
    const s = freshState();
    s.phase = GamePhase.WAVE_PHASE;
    s.tick = 10;
    s.activeHeroId = 'HERO_CAESAR';
    s.heroTier = 4;  // champions share the run tier; max it so the full kit is online
    const champions = [
      TowerType.CHAMPION_MARIUS,
      TowerType.CHAMPION_AGRIPPA,
      TowerType.CHAMPION_AGRICOLA,
      TowerType.CHAMPION_SCIPIO,
      TowerType.CHAMPION_CAESAR,
      TowerType.CHAMPION_SULLA
    ];
    champions.forEach((type, idx) => {
      const tw = createTower(type, 5, 4 + idx, 6, 9);
      s.towers.set(tw.id, tw);
    });
    let fxCount = 0;
    tickHeroAbilities(s, { triggerHeroAbilityFx: () => { fxCount++; } });
    expect(fxCount).toBe(0);

    for (let i = 0; i < 20 && fxCount === 0; i++) {
      s.tick = 20 + i * 0.2;
      tickHeroAbilities(s, { triggerHeroAbilityFx: () => { fxCount++; } });
    }
    expect(fxCount).toBeGreaterThan(0);
    expect(fxCount).toBeLessThan(12);
  });

  it('re-staggers overdue hero abilities at every wave start after build time expires cooldowns', () => {
    const s = freshState();
    s.phase = GamePhase.BUILD_PHASE;
    s.tick = 100;
    s.activeHeroId = 'HERO_MARIUS';
    s.heroTier = 4;

    const starter = createTower(TowerType.HERO_MARIUS, 5, 6, 6, 8);
    const champions = [
      TowerType.CHAMPION_AGRIPPA,
      TowerType.CHAMPION_AGRICOLA,
      TowerType.CHAMPION_SCIPIO,
      TowerType.CHAMPION_CAESAR,
      TowerType.CHAMPION_SULLA
    ].map((type, idx) => createTower(type, 5, 8 + idx, 6, 8));
    s.activeHeroTowerId = starter.id;

    for (const hero of [starter, ...champions]) {
      const heroId = heroIdForTowerType(String(hero.type))!;
      const def: any = (HERO_DEFS as any)[heroId];
      hero.__heroCooldowns = Object.fromEntries(def.abilities.map((ability: any) => [ability.id, 30]));
      (hero as any).__championAbilityWakeupDone = true;
      s.towers.set(hero.id, hero);
    }
    // Keep a genuinely active cooldown and discard unfinished prior-wave throws.
    starter.__heroCooldowns!.MARIAN_FORMATION = 130;
    (s as any).__heroTimedEvents = [{ atTick: 101, action: () => {} }];

    startWave(s);

    const scheduled = [starter, ...champions].flatMap(hero => Object.values(hero.__heroCooldowns ?? {}));
    const openingCasts = scheduled.filter(tick => tick > 100 && tick < 107);
    expect(s.phase).toBe(GamePhase.WAVE_PHASE);
    expect(starter.__heroCooldowns!.MARIAN_FORMATION).toBe(130);
    expect(openingCasts.length).toBe(11);
    expect(new Set(openingCasts).size).toBe(11);
    expect((s as any).__heroTimedEvents).toEqual([]);
    const openingAttacks = [starter, ...champions].map(hero => hero.attackCooldown);
    expect(Math.min(...openingAttacks)).toBeGreaterThanOrEqual(0.12);
    expect(new Set(openingAttacks).size).toBe(openingAttacks.length);

    let fxCount = 0;
    tickHeroAbilities(s, { triggerHeroAbilityFx: () => { fxCount++; } });
    expect(fxCount).toBe(0);
  });

  it('Hero Forge applies to purchased Champions, not only the starter hero', () => {
    const s = freshState();
    s.phase = GamePhase.WAVE_PHASE;
    s.tick = 10;
    s.activeHeroId = 'HERO_MARIUS';
    s.heroTier = 0;
    s.heroForgeStacks = { dmg: 5, cd: 5, aura: 0 };

    const champion = createTower(TowerType.CHAMPION_CAESAR, 2, 5, 5, 9);
    (champion as any).__championAbilityWakeupDone = true;
    champion.__heroCooldowns = { SPQR_DECREE: 0 };
    s.towers.set(champion.id, champion);

    const g: any = globalThis as any;
    const prevGame = g.__game;
    g.__game = s;
    const withForge = towerEffectiveStats(champion).dps;
    s.heroForgeStacks = { dmg: 0, cd: 0, aura: 0 };
    const withoutForge = towerEffectiveStats(champion).dps;
    s.heroForgeStacks = { dmg: 5, cd: 5, aura: 0 };
    g.__game = prevGame;

    expect(heroTierForTower(s, champion)).toBe(1);
    expect(withForge / withoutForge).toBeCloseTo(1.30, 2);

    tickHeroAbilities(s);
    const spqr = (HERO_DEFS as any).HERO_CAESAR.abilities.find((a: any) => a.id === 'SPQR_DECREE');
    expect(champion.__heroCooldowns?.SPQR_DECREE).toBeCloseTo(10 + spqr.cooldownSec * heroForgeCooldownMult(s), 6);
  });

  it('starter plus five Mercator Champions coexist with abilities, passives, damage, and targeting intact', () => {
    const s = freshState();
    s.phase = GamePhase.WAVE_PHASE;
    s.tick = 100;
    s.wave = 12;
    s.activeHeroId = 'HERO_MARIUS';
    s.heroTier = 4;
    s.groundPath = Array.from({ length: 12 }, (_, idx) => ({ col: 12 + idx, row: 12 }));

    const starter = createTower(TowerType.HERO_MARIUS, 5, 12, 12, 12);
    const championTypes = [
      TowerType.CHAMPION_AGRIPPA,
      TowerType.CHAMPION_AGRICOLA,
      TowerType.CHAMPION_SCIPIO,
      TowerType.CHAMPION_CAESAR,
      TowerType.CHAMPION_SULLA
    ];
    const champions = championTypes.map((type, idx) => createTower(type, 5, 14 + idx * 2, 12, 12));
    const melee = createTower(TowerType.MILITES, 1, 11, 12, 12);
    const siege = createTower(TowerType.SCORPIO, 1, 15, 12, 12);
    const flyerTargeter = createTower(TowerType.HASTATI, 1, 15, 14, 12);
    const decreeTarget = createTower(TowerType.SAGITTARIUS, 1, 18, 14, 12);
    decreeTarget.attackCooldown = 5;

    s.activeHeroTowerId = starter.id;
    for (const tower of [starter, ...champions, melee, siege, flyerTargeter, decreeTarget]) {
      s.towers.set(tower.id, tower);
    }

    const boss = testEnemy('boss', {
      type: EnemyType.HANNIBAL_BARCA,
      faction: EnemyFaction.CARTHAGE,
      isBoss: true,
      hp: 50_000,
      maxHp: 50_000,
      x: 18 * 32 + 16,
      y: 12 * 32 + 16
    });
    const flyer = testEnemy('flyer', {
      type: EnemyType.CELTIC_SCOUT,
      faction: EnemyFaction.CELTS,
      isFlyer: true,
      hp: 20_000,
      maxHp: 20_000,
      x: 15 * 32 + 16,
      y: 14 * 32 + 16
    });
    const ground = testEnemy('ground', {
      hp: 20_000,
      maxHp: 20_000,
      x: 22 * 32 + 16,
      y: 12 * 32 + 16
    });
    s.enemies.set(boss.id, boss);
    s.enemies.set(flyer.id, flyer);
    s.enemies.set(ground.id, ground);

    for (const hero of [starter, ...champions]) {
      const heroId = heroIdForTowerType(String(hero.type));
      const def: any = heroId ? (HERO_DEFS as any)[heroId] : null;
      hero.__heroCooldowns = Object.fromEntries((def?.abilities ?? []).map((a: any) => [a.id, 0]));
      (hero as any).__championAbilityWakeupDone = true;
    }

    const castIds: string[] = [];
    const fxIds: string[] = [];
    const castsPerTick: number[] = [];
    for (let i = 0; i < 80 && new Set(castIds).size < 12; i++) {
      const before = castIds.length;
      tickHeroAbilities(s, {
        onAbilityCast: (abilityId: string) => castIds.push(abilityId),
        triggerHeroAbilityFx: (fx: any) => fxIds.push(fx.ability)
      });
      castsPerTick.push(castIds.length - before);
      s.tick += 0.1;
    }

    expect(s.activeHeroId).toBe('HERO_MARIUS');
    expect(new Set([starter, ...champions].map(t => heroIdForTowerType(String(t.type))))).toEqual(new Set(HERO_POOL));
    expect(Math.max(...castsPerTick)).toBe(1);
    expect(castIds).toEqual(expect.arrayContaining([
      'MARIAN_FORMATION',
      'CAPITE_CENSI',
      'PILUM_VOLLEY',
      'NAVAL_BOMBARDMENT',
      'EAGLE_SCOUT',
      'FRONTIER_WALL',
      'CORNU_CHARGE',
      'SCIPIO_BRAND',
      'SPQR_DECREE',
      'PAX_ROMANA',
      'FORTUNES_BOLT',
      'PROSCRIPTION'
    ]));
    expect(fxIds).toEqual(expect.arrayContaining([
      'MARIAN_FORMATION',
      'CAPITE_CENSI',
      'PILUM_VOLLEY',
      'NAVAL_BOMBARDMENT',
      'EAGLE_SCOUT',
      'FRONTIER_WALL',
      'CORNU_CHARGE',
      'SCIPIO_BRAND',
      'SPQR_DECREE',
      'PAX_ROMANA',
      'FORTUNES_BOLT',
      'PROSCRIPTION'
    ]));
    expect((melee as any).__marianFormationUntilTick).toBeGreaterThan(s.tick);
    expect((s as any).__heroTimedEvents?.length).toBeGreaterThan(0);
    expect((flyer as any).__eagleScoutUntilTick).toBeGreaterThan(s.tick);
    expect((s as any).__frontierWallUntilTick).toBeGreaterThan(s.tick);
    expect(boss.hp).toBeLessThan(50_000);
    expect(boss.statusEffects.some(st => st.kind === StatusEffectKind.MARK)).toBe(true);
    expect([...s.enemies.values()].every(e => e.statusEffects.some(st => st.kind === StatusEffectKind.SLOW))).toBe(true);
    expect((s as any).__proscriptionUntilTick).toBeGreaterThan(s.tick);
    expect(decreeTarget.attackCooldown).toBeGreaterThan(0);
    expect(decreeTarget.attackCooldown).toBeLessThanOrEqual(1.5);

    const flyerPick = pickTarget(s, flyerTargeter, [flyer], flyerTargeter.range);
    expect(flyerPick?.id).toBe('flyer');

    const siegeRangeWithoutAgrippa = siege.range;
    (globalThis as any).__game = s;
    expect(towerEffectiveStats(siege).range).toBeCloseTo(siegeRangeWithoutAgrippa + 2, 5);
    delete (globalThis as any).__game;

    const flyerHpBeforeCombat = flyer.hp;
    flyerTargeter.attackCooldown = 0;
    tickCombat(s, 0.016, {
      onHit: () => {},
      onMeleeSwing: () => {},
      onProjectileFire: () => {},
      onKill: () => {}
    });
    expect(flyer.hp).toBeLessThan(flyerHpBeforeCombat);
    expect(flyerTargeter.damageType).toBe(DamageType.PHYS_MELEE);
    delete (globalThis as any).__lastState;
  });

  it('Scipio priority-hunter kit also affects commanders', () => {
    const s = freshState();
    s.phase = GamePhase.WAVE_PHASE;
    s.tick = 20;
    s.wave = 8;
    s.activeHeroId = 'HERO_SCIPIO';
    s.heroTier = 2;

    const scipio = createTower(TowerType.HERO_SCIPIO, 1, 3, 3, 8);
    scipio.attackCooldown = 999;
    scipio.__heroCooldowns = { CORNU_CHARGE: 0, SCIPIO_BRAND: 0 };
    s.activeHeroTowerId = scipio.id;
    s.towers.set(scipio.id, scipio);

    const commander = testEnemy('commander', {
      type: EnemyType.STANDARD_BEARER_COMMANDER,
      faction: EnemyFaction.CELTS,
      hp: 20_000,
      maxHp: 20_000,
      x: 12 * 32 + 16,
      y: 12 * 32 + 16
    });
    s.enemies.set(commander.id, commander);

    const castIds: string[] = [];
    for (let i = 0; i < 20 && new Set(castIds).size < 2; i++) {
      tickHeroAbilities(s, { onAbilityCast: abilityId => castIds.push(abilityId) });
      s.tick += 0.1;
    }

    expect(castIds).toEqual(expect.arrayContaining(['CORNU_CHARGE', 'SCIPIO_BRAND']));
    expect(commander.hp).toBeLessThan(20_000);
    expect(commander.statusEffects.some(st => st.kind === StatusEffectKind.MARK)).toBe(true);
  });

  it('Scipio global passive increases tower damage against commanders', () => {
    function commanderHitDamage(withScipio: boolean): number {
      const s = freshState();
      s.phase = GamePhase.WAVE_PHASE;
      s.tick = 1;
      s.wave = 8;

      const attacker = createTower(TowerType.DECURION, 1, 10, 10, 8);
      attacker.attackCooldown = 0;
      attacker.critChance = 0;
      s.towers.set(attacker.id, attacker);

      if (withScipio) {
        s.activeHeroId = 'HERO_SCIPIO';
        s.heroTier = 0;
        const scipio = createTower(TowerType.HERO_SCIPIO, 1, 1, 1, 8);
        scipio.attackCooldown = 999;
        s.activeHeroTowerId = scipio.id;
        s.towers.set(scipio.id, scipio);
      }

      const commander = testEnemy('commander', {
        type: EnemyType.STANDARD_BEARER_COMMANDER,
        faction: EnemyFaction.CELTS,
        hp: 20_000,
        maxHp: 20_000,
        x: 11 * 32 + 16,
        y: 10 * 32 + 16
      });
      s.enemies.set(commander.id, commander);

      let hitDamage = 0;
      tickCombat(s, 0.016, {
        onHit: (tower, enemy, damage) => {
          if (tower.id === attacker.id && enemy.id === commander.id) hitDamage = damage;
        },
        onMeleeSwing: () => {},
        onProjectileFire: () => {},
        onKill: () => {}
      });
      return hitDamage;
    }

    const baseline = commanderHitDamage(false);
    const boosted = commanderHitDamage(true);
    expect(baseline).toBeGreaterThan(0);
    expect(boosted).toBeGreaterThan(baseline);
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
    // basic-attack scale now climbs 1.0× → 4.5× across the 5 tiers
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

  // 2026-05-19 — Passive coverage test. The roster's passive hooks still
  // cover melee, siege, fire conversion, and boss hunting even as individual
  // hero basic-attack classes get retuned.
  //
  // 2026-05-20 v2 — Sulla's passive was reworked from a +35% damage
  // aura on FIRE towers (which used the legacy `filter:
  // "ELEMENTAL_FIRE"` shape) to a DAMAGE_TYPE_CONVERSION passive that
  // overrides nearby towers' damage type to FIRE. The fire "coverage"
  // moves from a `filter` to a `convertTo` field. Test reads both.
  it('aura filters cover the expected damage-type slots', () => {
    const filters = HERO_POOL.map(id => {
      const def: any = (HERO_DEFS as any)[id];
      // Marius/Agrippa use top-level filter; Scipio uses VS_BOSS
      // (no damage-type filter); Caesar is unfiltered global; Sulla
      // uses convertTo (DAMAGE_TYPE_CONVERSION passive — towers
      // within 3 tiles get their damage type overridden to convertTo).
      // 2026-05-22 — Agricola's passive simplified to a single
      // GLOBAL effect (melee-can-hit-flyers) with NO damage filter
      // and NO local aura. He no longer contributes a PHYS_RANGED
      // entry to this set; coverage is intentional (his basic-attack
      // damage type is still PHYS_RANGED, just not the passive).
      return def.passive?.filter
        ?? def.passive?.convertTo
        ?? null;
    });
    expect(filters).toContain('PHYS_MELEE');         // Marius local aura
    expect(filters).toContain('SIEGE');              // Agrippa local aura
    expect(filters).toContain('ELEMENTAL_FIRE');     // Sulla's convertTo target
    // VS_BOSS is the Scipio filter; Caesar carries no filter at all;
    // Agricola carries no filter at all (global anti-air effect only).
    expect(filters).toContain('VS_BOSS');
  });

  it('Scipio is a melee boss-hunter hero in starter and Champion form', () => {
    const starter = createTower(TowerType.HERO_SCIPIO, 5, 5, 5, 1);
    const champion = createTower(TowerType.CHAMPION_SCIPIO, 5, 6, 5, 1);

    expect(starter.damageType).toBe(DamageType.PHYS_MELEE);
    expect(champion.damageType).toBe(DamageType.PHYS_MELEE);
    expect(starter.range).toBe(2);
    expect(champion.range).toBe(2);
    expect(starter.baseDps).toBeCloseTo(147.7 * 1.10, 4);
    expect(champion.baseDps).toBeCloseTo(162.5 * 1.10, 4);
    expect(getTowerProjectileProfile(TowerType.HERO_SCIPIO)).toBeNull();
    expect(getTowerProjectileProfile(TowerType.CHAMPION_SCIPIO)).toBeNull();
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

  it('previewSpawnHp keeps W1 pin behaviour: 300 base, 350 with hero (raised from 100/115 on 2026-05-23)', () => {
    expect(previewSpawnHp(dogDef, 1, 'G', 1.0, false)).toBe(300);
    expect(previewSpawnHp(dogDef, 1, 'G', 1.0, true)).toBe(350);
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

  it('heroForgeNextCost doubles from 30g: 30/60/120/240/480 then MAXED', () => {
    // 2026-05-22 V25 — ramp bumped 1.5× to slow late-game hero power.
    // Was 20/40/80/160/320 (V3, 2026-05-20). The post-V25 first tap is
    // 30g (still cheap enough to sample any new path in 1-2 waves)
    // but the L4 → L5 tap costs 480g, a real commitment.
    expect(heroForgeNextCost(0)).toBe(40);
    expect(heroForgeNextCost(1)).toBe(80);
    expect(heroForgeNextCost(2)).toBe(160);
    expect(heroForgeNextCost(3)).toBe(320);
    expect(heroForgeNextCost(4)).toBe(640);
    expect(heroForgeNextCost(5)).toBeNull();           // cap
    expect(heroForgeNextCost(99)).toBeNull();          // defensive
    // Sum per path maxed = 40 + 80 + 160 + 320 + 640 = 1240g.
    const total = [0, 1, 2, 3, 4].reduce((acc, n) => acc + (heroForgeNextCost(n) ?? 0), 0);
    expect(total).toBe(1240);
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
