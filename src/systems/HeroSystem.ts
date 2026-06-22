// ─────────────────────────────────────────────────────────────────────
// HERO SYSTEM — 6 heroes, all-6 horizontal-scroll draft, kill-based XP,
// auto-pulse abilities.
//
// Architecture: every numeric value (XP threshold, ability cooldown, aura
// radius, banner copy) lives in src/data/herodefs.json. This module reads
// from that single source — no hardcoded magic numbers. Tuning passes
// edit the JSON file only; this file is mechanical wiring.
//
// Public API consumed by main.ts:
//   - draftHeroChoices(lastHeroId)     : returns all 6 (shuffled order)
//   - pickHero(state, heroId)          : commit selection + queue placement
//   - awardHeroXp(state, isBoss)       : called from kill handler
//   - getHeroTier(state)               : current tier 0..4
//   - prepareHeroAbilitiesForWave(state): stagger ready casts at wave start
//   - tickHeroAbilities(state, hooks)  : per-frame ability dispatcher
//
// Cooldown idiom: each ability stamps its next-fire tick onto the hero
// tower's __heroCooldowns scratchpad. Mirrors the existing
// __nextCaesarStunTick pattern from CombatResolver. No timers, no
// setInterval — pure tick-driven state.
// ─────────────────────────────────────────────────────────────────────

import HERO_DEFS from '../data/herodefs.json';
import towersData from '../data/towers.json';
import { GameStateShape } from '../GameState';
import { Tower, Enemy, DamageType, GamePhase, StatusEffectKind, TileType } from '../types';
import { GRID } from '../constants';
import { pushStatus } from './CombatResolver';
import { setTile } from './GridManager';
import { buildGroundPath } from './PathFinder';
import { HERO_IDS, HeroIdentityId, heroIdForTowerType, isMercatorChampionType } from './HeroIdentity';
import { heroBasicAttackScaleForTier, heroBasicAttackScaleForTower } from './HeroScaling';

// 6-hero pool (locked design). The draft surfaces ALL 6 every run
// (shuffled for a fresh layout) — players choose freely from the full
// roster instead of being handed a random subset.
export const HERO_POOL = [
  ...HERO_IDS
] as const;
export type HeroId = typeof HERO_POOL[number];

const HERO_WAKEUP_ORDER: Record<string, number> = Object.fromEntries(
  HERO_IDS.map((id, idx) => [id, idx])
) as Record<string, number>;

// Side-effect hooks provided by main.ts so HeroSystem stays decoupled
// from the renderer + DOM. All hooks are optional — missing hooks
// degrade gracefully (no VFX / no banner), system logic still runs.
export interface HeroHooks {
  onAbilityCast?: (abilityId: string) => void;
  triggerImpactRing?: (x: number, y: number, tick: number, maxR: number, color: number) => void;
  triggerShake?: (intensity: number, duration: number) => void;
  pushTierUpBanner?: (text: string) => void;
  resnapEnemiesToPath?: (path: { col: number; row: number }[]) => void;
  // 2026-05-19 v2 — Hero ability VFX dispatcher. Each ability calls
  // this with its `ability` id + origin + ability-specific `extras`
  // (target list, affected towers, etc.) and the renderer's
  // `triggerHeroAbilityFx` queues a signature animation.
  triggerHeroAbilityFx?: (spec: {
    ability: string;
    x: number; y: number;
    tick: number;
    life?: number;
    color?: number;
    extras?: any;
  }) => void;
}

// ─── HERO FORGE (2026-05-20 v2) ──────────────────────────────────────
// Pay-to-upgrade hero system. Three independent paths tapped at the
// gate shop, each cap-5 with a doubling cost ramp starting at 20g.
// Runs entirely independent of the XP/tier ladder — natural
// progression is untouched. Stacks live on state.heroForgeStacks;
// 50% gold refund on hero re-pick handled inside pickHero further
// down.
//
// 2026-05-20 v3 — cost ramp lowered from linear-steep (100/200/300/
// 400/500, 1500g per path maxed) to doubling-from-20g (20/40/80/160/
// 320, 620g per path maxed).
// 2026-05-22 V25 — cost ramp bumped 1.5× (30/60/120/240/480 per tap,
// 930g per path maxed, 2,790g for all three) after the difficulty
// audit. The previous 620g/path ceiling was reachable by W10-W12 on
// most successful runs, which let the hero's Path A + C compound
// damage stack hit ~1.625× by mid-game — a big swing the enemy HP
// scaling didn't track. Steepening the curve slows late-game power
// growth without erasing the "sample cheaply" feel: the first tap
// is still 30g (under one wave's gold), but the L4 → L5 tap costs
// 480g, a meaningful commitment late in the run.
export const HERO_FORGE_CAP = 5;

/** Returns the cost of the NEXT tap on this path, or null when MAXED. */
export function heroForgeNextCost(stacks: number): number | null {
  if (stacks >= HERO_FORGE_CAP) return null;
  return 30 * Math.pow(2, stacks); // 30/60/120/240/480 (V25 — was 20/40/80/160/320)
}

/** Path A SHARPEN — +6% basic-attack damage per tap. */
export function heroForgeDmgMult(state: GameStateShape): number {
  const n = state.heroForgeStacks?.dmg ?? 0;
  return 1 + 0.06 * n;            // 5 taps = 1.30×
}
/** Path B HASTEN — −5% ability cooldown per tap. Compounding decay. */
export function heroForgeCooldownMult(state: GameStateShape): number {
  const n = state.heroForgeStacks?.cd ?? 0;
  return Math.pow(0.95, n);       // 5 taps ≈ 0.7738×
}
/** Path C EMPOWER — +5% to all numeric magnitudes in every ability. */
export function heroForgeMagnitudeMult(state: GameStateShape): number {
  const n = state.heroForgeStacks?.aura ?? 0;
  return 1 + 0.05 * n;            // 5 taps = 1.25×
}

/**
 * Scale all numeric MAGNITUDE-shape fields in an ability's params by the
 * supplied multiplier. Skips integer COUNT fields (game-design integers
 * like javelinCount/shellCount), boolean flags, string overrides, and
 * the `lifetimeHealCap` static cap. `bossSpeedMultiplier` is inverse-
 * scaled (divided) — kept as a generic inverse-key handler in case
 * future abilities use a slow-bosses-more shape. Pure function —
 * returns a new object so caller can safely use it without mutating
 * the JSON-loaded source.
 */
export function scaleParams(params: any, magnitudeMult: number): any {
  if (!params || magnitudeMult === 1) return params;
  const out: any = {};
  for (const [key, val] of Object.entries(params)) {
    // Game-design integers — counts of things, not magnitudes.
    if (/Count$/i.test(key)) { out[key] = val; continue; }
    // Static caps + booleans + strings stay untouched.
    if (typeof val !== 'number' || key === 'lifetimeHealCap') {
      out[key] = val;
      continue;
    }
    // bossSpeedMultiplier is INVERSE — higher empower = slower bosses.
    if (key === 'bossSpeedMultiplier') {
      out[key] = val / magnitudeMult;
      continue;
    }
    out[key] = val * magnitudeMult;
  }
  return out;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Fisher-Yates shuffle the 6-pool and return all 6. Pure function.
 *
 * 2026-05-21 — Used to slice to 3 random heroes; now returns the full
 * roster every time. The horizontal-scroll picker in ChooseHeroModal
 * lets the player browse the entire lineup and pick whichever hero
 * fits their planned build, removing the "the RNG didn't give me my
 * hero" frustration. Shuffle preserved so the display order still
 * varies run-to-run — a fresh layout reads differently even when the
 * cast is fixed.
 */
export function draftHeroChoices(_lastHeroId?: string | null): HeroId[] {
  const pool = [...HERO_POOL] as HeroId[];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

/** Commit hero selection. Queues the hero as a placement token. */
export function pickHero(state: GameStateShape, heroId: HeroId): void {
  // 2026-05-20 v2 — HERO FORGE REFUND. If the player previously had a
  // hero AND spent gold on forge upgrades, refund 50% of that gold
  // before resetting the stacks. Pays out immediately so the player
  // can re-invest into the new hero. Skipped when this is the very
  // first hero pick of the run (no prior activeHeroId).
  const prevSpend = state.heroForgeGoldSpent ?? 0;
  if (state.activeHeroId && prevSpend > 0) {
    const refund = Math.floor(prevSpend * 0.5);
    state.gold = (state.gold ?? 0) + refund;
    state.hint = `⚒ Forge refund: +${refund}g returned from the previous hero's investment.`;
  }
  state.activeHeroId = heroId;
  state.heroXp = 0;
  state.heroTier = 0;
  state.heroLifeHealedThisRun = 0;
  state.heroForgeStacks = { dmg: 0, cd: 0, aura: 0 };
  state.heroForgeGoldSpent = 0;
  state.pendingPurchasedTowers = state.pendingPurchasedTowers ?? [];
  state.pendingPurchasedTowers.push({ type: heroId, tier: 1, source: 'hero' });
  // SANDBOX-safe: localStorage write skipped in sandbox so dev runs
  // don't overwrite the player's last-hero memory.
  if (!state.sandboxMode) {
    try { localStorage.setItem('roman_td_last_hero_id', heroId); } catch { /* ignore */ }
  }
}

/** Award XP for a kill. +1 non-boss, +20 boss. Triggers tier-up if crossed. */
export function awardHeroXp(state: GameStateShape, isBoss: boolean, hooks?: HeroHooks): void {
  if (!state.activeHeroId) return;
  state.heroXp = (state.heroXp ?? 0) + (isBoss ? 20 : 1);
  updateHeroTier(state, hooks);
}

/** Current hero tier (0..4). Cached on state. */
export function getHeroTier(state: GameStateShape): 0 | 1 | 2 | 3 | 4 {
  return (state.heroTier ?? 0) as 0 | 1 | 2 | 3 | 4;
}

/** Recompute tier from XP. Fires banner + ring burst on increase. */
function updateHeroTier(state: GameStateShape, hooks?: HeroHooks): void {
  if (!state.activeHeroId) return;
  const def: any = (HERO_DEFS as any)[state.activeHeroId];
  if (!def) return;
  const xp = state.heroXp ?? 0;
  const thresholds: number[] = def.xpThresholds ?? [0, 75, 280, 650, 1300];
  let newTier: 0 | 1 | 2 | 3 | 4 = 0;
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (xp >= thresholds[i]) { newTier = i as 0 | 1 | 2 | 3 | 4; break; }
  }
  const oldTier = (state.heroTier ?? 0) as 0 | 1 | 2 | 3 | 4;
  if (newTier > oldTier) {
    state.heroTier = newTier;
    const banners: string[] = def.bannerCopy ?? [];
    if (hooks?.pushTierUpBanner && banners[newTier]) {
      hooks.pushTierUpBanner(banners[newTier]);
    }
    // Tier-up ring burst at the hero tower position.
    const hero = findHeroTower(state);
    if (hero && hooks?.triggerImpactRing) {
      const cx = hero.tileX * GRID.TILE + GRID.TILE / 2;
      const cy = hero.tileY * GRID.TILE + GRID.TILE / 2;
      const color = hexToInt(def.visual?.tierUpColor ?? '#ffd34d');
      hooks.triggerImpactRing(cx, cy, state.tick, 56, color);
    }
  }
}

/** Per-frame ability dispatcher. Called once per WAVE_PHASE tick. */
export function tickHeroAbilities(state: GameStateShape, hooks?: HeroHooks): void {
  if (state.phase !== GamePhase.WAVE_PHASE) return;
  let castsThisTick = 0;
  let deferredCasts = 0;
  for (const hero of state.towers.values()) {
    const heroId = heroIdForTowerType(String(hero.type));
    if (!heroId) continue;
    const isStarterHero = hero.id === state.activeHeroTowerId && heroId === state.activeHeroId;
    const isMercatorChampion = isMercatorChampionType(String(hero.type));
    if (!isStarterHero && !isMercatorChampion) continue;
    const def: any = (HERO_DEFS as any)[heroId];
    if (!def?.abilities) continue;
    const tier = isStarterHero ? getHeroTier(state) : 4;
    // Initialize cooldown scratchpad on first access.
    if (!hero.__heroCooldowns) hero.__heroCooldowns = {};
    if (isMercatorChampion && !(hero as any).__championAbilityWakeupDone) {
      initializeChampionAbilityWakeup(hero, def, heroId, state.tick);
    }

    // Starter heroes use the run's forge investment. Mercator Champions
    // arrive as fully trained T5 recruit forms but do not consume or alter
    // the starter hero's XP/forge ladder.
    const cdMult = isStarterHero ? heroForgeCooldownMult(state) : 1;
    (hero as any).__heroAbilityContext = {
      heroId,
      tier,
      magnitudeMult: isStarterHero ? heroForgeMagnitudeMult(state) : 1
    };
    for (const ability of def.abilities) {
      if (tier < ability.level) continue;
      const nextFire = hero.__heroCooldowns[ability.id] ?? 0;
      if (state.tick < nextFire) continue;
      // Hero abilities are heavyweight, often touching every enemy/tower and
      // spawning signature VFX. Cooldown reductions and long build phases can
      // align several of them on one frame, so serialize collisions without
      // dropping a cast. The short offsets are imperceptible in play.
      if (castsThisTick >= 1) {
        hero.__heroCooldowns[ability.id] = state.tick + 0.12 + deferredCasts * 0.08;
        deferredCasts++;
        continue;
      }
      // Stamp BEFORE executing so a long-running executor can't double-fire.
      hero.__heroCooldowns[ability.id] = state.tick + (ability.cooldownSec ?? 60) * cdMult;
      dispatchAbility(state, hero, ability, hooks);
      hooks?.onAbilityCast?.(ability.id);
      castsThisTick++;
    }
  }

  // Drain timed events (Capite Censi per-throw damage events, etc.).
  tickHeroTimedEvents(state, hooks);
}

/**
 * Re-arm overdue hero abilities at every wave boundary.
 *
 * The global game clock advances during build/shop time, so cooldowns that
 * were safely spread during the previous wave can all become overdue before
 * the next wave starts. Interleave those ready casts across the opening
 * seconds while preserving any cooldown that is still genuinely in flight.
 */
export function prepareHeroAbilitiesForWave(state: GameStateShape): void {
  (state as any).__heroTimedEvents = [];

  const heroes: Array<{
    hero: Tower;
    heroId: HeroIdentityId;
    abilities: any[];
  }> = [];

  for (const hero of state.towers.values()) {
    if (hero.pending) continue;
    const heroId = heroIdForTowerType(String(hero.type));
    if (!heroId) continue;
    const isStarterHero = hero.id === state.activeHeroTowerId && heroId === state.activeHeroId;
    const isMercatorChampion = isMercatorChampionType(String(hero.type));
    if (!isStarterHero && !isMercatorChampion) continue;

    const def: any = (HERO_DEFS as any)[heroId];
    const tier = isStarterHero ? getHeroTier(state) : 4;
    const abilities = (def?.abilities ?? []).filter((ability: any) => tier >= ability.level);
    if (abilities.length === 0) continue;
    if (!hero.__heroCooldowns) hero.__heroCooldowns = {};
    heroes.push({ hero, heroId, abilities });
    if (isMercatorChampion) (hero as any).__championAbilityWakeupDone = true;
  }

  heroes.sort((a, b) => (HERO_WAKEUP_ORDER[a.heroId] ?? 0) - (HERO_WAKEUP_ORDER[b.heroId] ?? 0));

  // Every placed tower starts life with attackCooldown=0. High-range heroes
  // can see the cave immediately, so a council used to fire every basic
  // attack on the first enemy in the same frame. Give each hero a distinct
  // opening beat. This does not change attack speed after the first shot.
  heroes.forEach(({ hero }, idx) => {
    const openingDelay = 0.12 + idx * 0.11;
    hero.attackCooldown = Math.max(hero.attackCooldown, openingDelay);
  });

  const ready: Array<{ hero: Tower; ability: any }> = [];
  const maxAbilityCount = Math.max(0, ...heroes.map(entry => entry.abilities.length));
  // Ability-slot-first ordering prevents one hero from launching both of its
  // abilities back-to-back before the rest of the council gets a turn.
  for (let abilityIdx = 0; abilityIdx < maxAbilityCount; abilityIdx++) {
    for (const entry of heroes) {
      const ability = entry.abilities[abilityIdx];
      if (!ability?.id) continue;
      if ((entry.hero.__heroCooldowns?.[ability.id] ?? 0) <= state.tick) {
        ready.push({ hero: entry.hero, ability });
      }
    }
  }

  const FIRST_CAST_DELAY = 0.75;
  const CAST_SPACING = 0.55;
  ready.forEach(({ hero, ability }, idx) => {
    hero.__heroCooldowns![ability.id] = state.tick + FIRST_CAST_DELAY + idx * CAST_SPACING;
  });
}

function initializeChampionAbilityWakeup(hero: Tower, def: any, heroId: HeroIdentityId, tick: number): void {
  if (!hero.__heroCooldowns) hero.__heroCooldowns = {};
  const heroOffset = HERO_WAKEUP_ORDER[heroId] ?? 0;
  const baseDelay = 0.75 + heroOffset * 0.7;
  const abilities: any[] = def?.abilities ?? [];
  abilities.forEach((ability, idx) => {
    if (!ability?.id) return;
    if ((hero.__heroCooldowns![ability.id] ?? 0) <= tick) {
      hero.__heroCooldowns![ability.id] = tick + baseDelay + idx * 0.45;
    }
  });
  (hero as any).__championAbilityWakeupDone = true;
}

// ─── Ability dispatch ────────────────────────────────────────────────

function dispatchAbility(state: GameStateShape, hero: Tower, ability: any, hooks?: HeroHooks): void {
  // 2026-05-20 v2 — Hero Forge Path C (EMPOWER). Scale every numeric
  // magnitude in the params block by the forge magnitude scalar. Counts,
  // booleans, strings, and lifetimeHealCap are skipped (see scaleParams).
  // Each executor reads from `params.X` so the scaled values land
  // transparently without per-executor code changes.
  const magnitudeMult = (hero as any).__heroAbilityContext?.magnitudeMult ?? heroForgeMagnitudeMult(state);
  const params = scaleParams(ability.params ?? {}, magnitudeMult);
  switch (ability.id) {
    // MARIUS
    case 'MARIAN_FORMATION':   return executeMARIAN_FORMATION(state, hero, params, ability, hooks);
    case 'CAPITE_CENSI':       return executeCAPITE_CENSI(state, hero, params, ability, hooks);
    // AGRIPPA
    case 'PILUM_VOLLEY':       return executePILUM_VOLLEY(state, hero, params, ability, hooks);
    case 'NAVAL_BOMBARDMENT':  return executeNAVAL_BOMBARDMENT(state, hero, params, ability, hooks);
    // AGRICOLA
    case 'EAGLE_SCOUT':        return executeEAGLE_SCOUT(state, hero, params, ability, hooks);
    case 'FRONTIER_WALL':      return executeFRONTIER_WALL(state, hero, params, ability, hooks);
    // SCIPIO
    case 'CORNU_CHARGE':       return executeCORNU_CHARGE(state, hero, params, ability, hooks);
    case 'SCIPIO_BRAND':       return executeSCIPIO_BRAND(state, hero, params, ability, hooks);
    // CAESAR
    case 'SPQR_DECREE':        return executeSPQR_DECREE(state, hero, params, ability, hooks);
    case 'PAX_ROMANA':         return executePAX_ROMANA(state, hero, params, ability, hooks);
    // SULLA
    case 'FORTUNES_BOLT':      return executeFORTUNES_BOLT(state, hero, params, ability, hooks);
    case 'PROSCRIPTION':       return executePROSCRIPTION(state, hero, params, ability, hooks);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

export function findHeroTower(state: GameStateShape): Tower | null {
  if (!state.activeHeroTowerId) return null;
  return state.towers.get(state.activeHeroTowerId) ?? null;
}

function distanceTiles(a: { tileX: number; tileY: number }, b: { tileX: number; tileY: number }): number {
  return Math.hypot(a.tileX - b.tileX, a.tileY - b.tileY);
}

function hexToInt(hex: string): number {
  const h = hex.replace('#', '');
  return parseInt(h, 16);
}

/** Hero tower's effective basic-attack damage at current tier. Used by Cornu Charge. */
function heroBasicAttackDamage(state: GameStateShape, hero: Tower): number {
  const ctx = (hero as any).__heroAbilityContext as { heroId?: HeroIdentityId; tier?: 0 | 1 | 2 | 3 | 4 } | undefined;
  const heroId = ctx?.heroId ?? state.activeHeroId;
  if (!heroId) return hero.baseDps;
  const scale = ctx?.tier !== undefined
    ? heroBasicAttackScaleForTier(heroId, ctx.tier)
    : heroBasicAttackScaleForTower(state, hero);
  // Per-tier damage scale × baseDps. attackSpeed not factored in — Cornu
  // Charge is a single-shot ability, not a damage-per-second slot.
  return hero.baseDps * scale;
}

// ─── Ability executors ──────────────────────────────────────────────
//
// Each executor implements the ability's mechanic. State-flag windows
// (e.g. __frontierWallUntilTick) are read by CombatResolver and
// EnemySystem to modulate damage / speed / status during the active
// window.
//
// Visual flair: each ability fires a triggerImpactRing on the hero's
// tile at minimum. Richer per-style VFX (sweeps, screen flashes,
// projectile fans) ship in commit C7 (RenderEngine pass).

// ── MARIUS ──

function executeMARIAN_FORMATION(state: GameStateShape, hero: Tower, params: any, ability: any, hooks?: HeroHooks): void {
  // Find the nearest N melee towers (excluding the hero itself).
  const need = params.nearestMeleeTowers ?? 3;
  const candidates: Array<{ t: Tower; d: number }> = [];
  for (const t of state.towers.values()) {
    if (t.id === hero.id) continue;
    if (t.damageType !== DamageType.PHYS_MELEE && (t as any).mode !== 0) continue;
    candidates.push({ t, d: distanceTiles(t, hero) });
  }
  candidates.sort((a, b) => a.d - b.d);
  const picked = candidates.slice(0, need).map(c => c.t);
  if (picked.length === 0) return;
  // Apply timed speed buff + shared-crit flag. CombatResolver reads
  // these per-tower flags during damage resolution.
  const dur = ability.durationSec ?? 3;
  const until = state.tick + dur;
  const speedMult = 1 + (params.atkSpeedMultPercent ?? 40) / 100;
  let maxCrit = 0;
  // critChance lives on the tower DEFINITION (towers.json), not on
  // the instance — same lookup CombatResolver uses at line 903.
  for (const t of picked) {
    const def: any = (towersData as any)[t.type];
    maxCrit = Math.max(maxCrit, def?.critChance ?? 0);
  }
  // 2026-05-22 — Damage rider added. Per-tower __marianDmgMult flag
  // read by CombatResolver during damage resolution alongside the
  // existing speed mult.
  const dmgMult = 1 + (params.dmgBonusPercent ?? 0) / 100;
  for (const t of picked) {
    (t as any).__marianFormationUntilTick = until;
    (t as any).__marianSpeedMult = speedMult;
    (t as any).__marianDmgMult = dmgMult;
    if (params.shareCrit) (t as any).__marianSharedCrit = maxCrit;
  }
  // Signature VFX: purple connecting lines from Marius to each
  // buffed melee tower + small ring-burst at every node.
  fireAbilityFx(hero, hooks, state.tick, ability, '#cc44ff', 0.7, {
    targets: picked.map(t => ({ x: t.tileX * GRID.TILE + GRID.TILE / 2, y: t.tileY * GRID.TILE + GRID.TILE / 2 }))
  });
}

// 2026-05-24 — Replaced Triarii Wall with CAPITE_CENSI (Head-Count Levy).
// Historical note: Triarii were the third-line veterans of the pre-Marian
// MANIPLE army, and Marius is famously the general who ABOLISHED that
// distinction when he replaced maniples with uniform cohorts. Naming a
// Marius ability "Triarii Wall" was the historical opposite of his
// signature. Capite Censi (the head-count poor) is the reform he is
// actually most famous for — opening the legions to property-less
// citizens, which created the professional standing army and set up
// every subsequent civil war.
//
// Mechanic: 14s CD, ~6s active. Picks N (default 3) empty grass tiles
// within ~5 tiles of Marius, spawns a phantom auxiliary at each that
// throws a pilum at the closest enemy every `throwIntervalSec` for
// `throwsPerAuxiliary` shots. Each pilum deals `damagePctOfBasic` of
// Marius's basic attack damage. Damage routes as instant PHYS_RANGED
// (no AoE) so it stacks cleanly with existing combat math.
function executeCAPITE_CENSI(state: GameStateShape, hero: Tower, params: any, ability: any, hooks?: HeroHooks): void {
  const count = params.auxiliaryCount ?? 3;
  const throws = params.throwsPerAuxiliary ?? 6;
  const intervalSec = params.throwIntervalSec ?? 1.0;
  const dmgPct = (params.damagePctOfBasic ?? 75) / 100;
  const radiusTiles = params.spawnRadiusTiles ?? 1.5;
  // 2026-05-24 — Per player feedback the VFX was sprawling across the
  // whole map. Pila are now range-capped to `targetRangeTiles` from
  // their auxiliary so distant enemies don't drag the projectile arcs
  // across the field. Combined with the spawnRadius drop from 5 → 1.5,
  // the entire ability now stays within ~2.5 tiles of Marius.
  const targetRangeTiles = params.targetRangeTiles ?? 2.5;
  const targetRangePx = targetRangeTiles * GRID.TILE;
  const targetRangeSq = targetRangePx * targetRangePx;
  const dmgPerThrow = heroBasicAttackDamage(state, hero) * dmgPct;
  // Build candidate spawn tiles — empty grass within radius, not on path,
  // not occupied by a tower (including pending placements).
  const occupied = new Set<string>();
  for (const o of state.towers.values()) {
    occupied.add(`${o.tileX},${o.tileY}`);
  }
  const cands: Array<{ x: number; y: number; col: number; row: number }> = [];
  // 2026-05-24 — Use Math.ceil(radiusTiles) as the integer loop bound
  // so a FLOAT radius (e.g. 1.5) still iterates the right integer
  // tile offsets. Previously `for (let dr = -1.5; dr <= 1.5; dr++)`
  // would step -1.5 → -0.5 → 0.5 → 1.5, producing non-integer tile
  // coords that always failed the `state.tiles[r]?.[c]` lookup. The
  // hypot check below still uses the float radius for distance.
  const intR = Math.ceil(radiusTiles);
  for (let dr = -intR; dr <= intR; dr++) {
    for (let dc = -intR; dc <= intR; dc++) {
      if (dc === 0 && dr === 0) continue;
      const c = hero.tileX + dc;
      const r = hero.tileY + dr;
      if (r < 0 || r >= state.tiles.length) continue;
      const row = state.tiles[r];
      if (!row || c < 0 || c >= row.length) continue;
      if (Math.hypot(dc, dr) > radiusTiles) continue;
      if (row[c] !== TileType.EMPTY) continue;
      if (occupied.has(`${c},${r}`)) continue;
      cands.push({
        x: c * GRID.TILE + GRID.TILE / 2,
        y: r * GRID.TILE + GRID.TILE / 2,
        col: c,
        row: r,
      });
    }
  }
  if (cands.length === 0) return;
  // Fisher-Yates shuffle, take the first `count` positions.
  for (let i = cands.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = cands[i]; cands[i] = cands[j]; cands[j] = tmp;
  }
  const picked = cands.slice(0, Math.min(count, cands.length));
  const lifetimeSec = throws * intervalSec;
  // Long-form ghost-rise VFX — one shot, 6s lifetime, payload carries
  // every auxiliary position so the renderer draws all 3 silhouettes.
  fireAbilityFx(hero, hooks, state.tick, ability, '#d4a76a', lifetimeSec, {
    auxiliaries: picked.map(p => ({ x: p.x, y: p.y })),
    lifetimeSec,
  });
  // Schedule per-aux throw events. Each fires a closest-enemy hit and
  // a short pilum-arc VFX from the aux to the target.
  for (const aux of picked) {
    for (let i = 0; i < throws; i++) {
      // 0.5s offset on first throw so the aux is visibly "up" before
      // the first projectile flies. Subsequent throws stagger by
      // intervalSec.
      const throwTick = state.tick + 0.5 + i * intervalSec;
      scheduleHeroTimedEvent(state, throwTick, () => {
        let closest: Enemy | null = null;
        let bestDsq = Infinity;
        for (const e of state.enemies.values()) {
          if (e.hp <= 0) continue;
          const dx = e.x - aux.x;
          const dy = e.y - aux.y;
          const dsq = dx * dx + dy * dy;
          // 2026-05-24 — Range cap. If the closest enemy is outside
          // targetRangeTiles, the auxiliary holds fire instead of
          // hurling a pilum across the map. Keeps the VFX localized
          // to the area around Marius.
          if (dsq > targetRangeSq) continue;
          if (dsq < bestDsq) { bestDsq = dsq; closest = e; }
        }
        if (!closest) return;
        // Instant damage (matches PILUM_VOLLEY pattern — no resistance
        // routing). Floor at 0 so we never go negative.
        closest.hp = Math.max(0, closest.hp - dmgPerThrow);
        // Per-throw pilum-arc VFX. Short lifetime so each arc draws
        // cleanly without overlapping the next throw.
        fireAbilityFx(hero, hooks, throwTick, ability, '#d4a76a', 0.45, {
          pilumArc: { from: { x: aux.x, y: aux.y }, to: { x: closest.x, y: closest.y } },
        });
      });
    }
  }
}

// ── AGRIPPA ──

function executePILUM_VOLLEY(state: GameStateShape, hero: Tower, params: any, ability: any, hooks?: HeroHooks): void {
  const count = params.javelinCount ?? 5;
  const targets = pickHighestHpEnemies(state, count);
  if (targets.length === 0) return;
  // Apply direct damage to each (the spec says "fires projectiles" but
  // for v1 we resolve as instant damage so the VFX is the only thing
  // gated on the renderer. Polish C7 swaps in actual flying projectiles.)
  const dmg = heroBasicAttackDamage(state, hero) * 0.9;
  for (const e of targets) {
    e.hp = Math.max(0, e.hp - dmg);
  }
  // Signature VFX: 5 blue arc-trails fly from Agrippa to each high-HP
  // enemy. Visible "volley" of javelins.
  fireAbilityFx(hero, hooks, state.tick, ability, '#5599ff', 0.7, {
    targets: targets.map(e => ({ x: e.x, y: e.y }))
  });
}

function executeNAVAL_BOMBARDMENT(state: GameStateShape, hero: Tower, params: any, ability: any, hooks?: HeroHooks): void {
  const shells = params.shellCount ?? 3;
  const splashRadius = (params.splashRadiusTiles ?? 2) * GRID.TILE;
  const stunSec = params.stunSec ?? 1.5;
  const path = state.groundPath;
  if (!path || path.length < 4) return;
  const dmg = heroBasicAttackDamage(state, hero) * 1.6;
  const impacts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < shells; i++) {
    const idx = Math.floor(Math.random() * path.length);
    const tile = path[idx];
    const cx = tile.col * GRID.TILE + GRID.TILE / 2;
    const cy = tile.row * GRID.TILE + GRID.TILE / 2;
    impacts.push({ x: cx, y: cy });
    for (const e of state.enemies.values()) {
      if (Math.hypot(e.x - cx, e.y - cy) <= splashRadius) {
        e.hp = Math.max(0, e.hp - dmg);
        pushStatus(e, StatusEffectKind.STUN, stunSec, 0, hero.qualityTier);
      }
    }
  }
  // Signature VFX: shells falling from above-screen onto each impact
  // point + splash burst. Lifetime longer so the falling animation reads.
  fireAbilityFx(hero, hooks, state.tick, ability, '#4499ff', 1.2, { impacts });
  hooks?.triggerShake?.(2.0, 0.35);
}

// ── AGRICOLA ──

function executeEAGLE_SCOUT(state: GameStateShape, hero: Tower, params: any, ability: any, hooks?: HeroHooks): void {
  const dur = ability.durationSec ?? 3;
  const dmgMult = 1 + (params.dmgTakenIncreasePercent ?? 60) / 100;
  const tgts: Array<{ x: number; y: number }> = [];
  for (const e of state.enemies.values()) {
    if (!e.isFlyer) continue;
    (e as any).__eagleScoutUntilTick = state.tick + dur;
    (e as any).__eagleScoutDmgMult = dmgMult;
    tgts.push({ x: e.x, y: e.y });
  }
  if (tgts.length === 0) return;
  // Signature VFX: small green eagle silhouettes dart to each flyer +
  // lingering crosshair on each marked target.
  fireAbilityFx(hero, hooks, state.tick, ability, '#aaccff', 1.0, { targets: tgts });
}

function executeFRONTIER_WALL(state: GameStateShape, hero: Tower, params: any, ability: any, hooks?: HeroHooks): void {
  const dur = ability.durationSec ?? 4;
  (state as any).__frontierWallUntilTick = state.tick + dur;
  (state as any).__frontierWallFlyerSpeedMult = 1 - (params.flyerSpeedReductionPercent ?? 70) / 100;
  (state as any).__frontierWallVsFlyerDmgMult = 1 + (params.dmgVsFlyersIncreasePercent ?? 30) / 100;
  // Signature VFX: three green pillars rise into a frontier-fence
  // shape around Agricola, connected by a horizontal beam.
  fireAbilityFx(hero, hooks, state.tick, ability, '#aaccff', 1.4, null);
}

// ── SCIPIO ──

function executeCORNU_CHARGE(state: GameStateShape, hero: Tower, params: any, ability: any, hooks?: HeroHooks): void {
  // Find boss with highest current HP.
  let boss: Enemy | null = null;
  for (const e of state.enemies.values()) {
    if (!e.isBoss) continue;
    if (!boss || e.hp > boss.hp) boss = e;
  }
  if (!boss) return;
  const dmg = heroBasicAttackDamage(state, hero) * (params.dmgMultiplier ?? 5.0);
  boss.hp = Math.max(0, boss.hp - dmg);   // ignoreResistances: write directly to HP
  // Signature VFX: curved horn-blast wave + red arrow flying to boss.
  fireAbilityFx(hero, hooks, state.tick, ability, '#ff8800', 0.8, {
    target: { x: boss.x, y: boss.y }
  });
}

function executeSCIPIO_BRAND(state: GameStateShape, hero: Tower, params: any, ability: any, hooks?: HeroHooks): void {
  // 2026-05-21 — Replaced CARTHAGO_DELENDA_EST. The previous ability
  // dealt 10% maxHP TRUE damage to every boss — an instant percent-of-
  // health chunk that read as an execute-flavored mechanic ("instantly
  // loses 10% maxHP, bypasses all resistances"). The replacement is a
  // pure debuff: every boss on the field receives a MARK status for
  // the ability's `durationSec` with magnitude `dmgTakenIncreasePercent`.
  // No direct damage, no resistance bypass, no execute energy. The mark
  // is read by CombatResolver.ts:809 on every direct hit and multiplies
  // damage by (1 + magnitude). Stacks WITH Scipio's +25% boss passive
  // (separate damage line) and with FREEZE/STUN amp (also separate).
  const dur = ability.durationSec ?? 6;
  const mag = (params.dmgTakenIncreasePercent ?? 30) / 100;
  const bossPositions: Array<{ x: number; y: number }> = [];
  for (const e of state.enemies.values()) {
    if (!e.isBoss) continue;
    pushStatus(e, StatusEffectKind.MARK, dur, mag, hero.qualityTier);
    bossPositions.push({ x: e.x, y: e.y });
  }
  if (bossPositions.length > 0) {
    // Signature VFX: red banner brand on each boss + Scipio-origin
    // ring sweep. Re-uses the per-target `extras.target` payload the
    // CARTHAGO_DELENDA_EST renderer already drew across each boss.
    for (const pos of bossPositions) {
      fireAbilityFx(hero, hooks, state.tick, ability, '#ff4400', 0.8, { target: pos });
    }
    hooks?.triggerShake?.(2.5, 0.4);
  }
}

// ── CAESAR ──

function executeSPQR_DECREE(state: GameStateShape, hero: Tower, _params: any, ability: any, hooks?: HeroHooks): void {
  // Force every combat tower to fire one bonus attack. Do not zero every
  // cooldown on the same frame: a late board can emit hundreds of hits,
  // projectiles, sounds, and on-hit effects at once and stall the browser.
  // The decree now travels across the formation over a short command wave,
  // preserving one early attack per tower without a single-frame burst.
  const MAX_TOWER_RELAY_FX = 28;
  const towerPositions: Array<{ x: number; y: number }> = [];
  const commanded = Array.from(state.towers.values())
    .filter(t => t.id !== hero.id && !t.pending && t.damageType !== DamageType.NONE)
    .sort((a, b) => a.placedAtWave - b.placedAtWave || a.tileY - b.tileY || a.tileX - b.tileX || a.id.localeCompare(b.id));
  const spacing = Math.min(0.06, 1.35 / Math.max(1, commanded.length));
  for (let idx = 0; idx < commanded.length; idx++) {
    const t = commanded[idx];
    t.attackCooldown = 0.08 + idx * spacing;
    if (towerPositions.length < MAX_TOWER_RELAY_FX) {
      towerPositions.push({ x: t.tileX * GRID.TILE + GRID.TILE / 2, y: t.tileY * GRID.TILE + GRID.TILE / 2 });
    }
  }
  // Signature VFX: massive gold ring sweep from Caesar + a small gold
  // flare on every tower as the decree reaches them.
  fireAbilityFx(hero, hooks, state.tick, ability, '#ffe066', 0.9, { towers: towerPositions });
}

function executePAX_ROMANA(state: GameStateShape, hero: Tower, params: any, ability: any, hooks?: HeroHooks): void {
  const dur = ability.durationSec ?? 2;
  const mag = (params.enemySpeedReductionPercent ?? 60) / 100;
  for (const e of state.enemies.values()) {
    pushStatus(e, StatusEffectKind.SLOW, dur, mag, hero.qualityTier);
  }
  // Signature VFX: pale gold cross-hatch grid overlays the entire map
  // with a slow drift + a pulsing ring at Caesar — "Roman roads quiet
  // the field."
  fireAbilityFx(hero, hooks, state.tick, ability, '#ffe066', 1.6, null);
}

// ── SULLA ──

function executeFORTUNES_BOLT(state: GameStateShape, hero: Tower, _params: any, ability: any, hooks?: HeroHooks): void {
  // Find the nearest enemy in hero's range.
  const rangePx = (hero.range ?? 3.5) * GRID.TILE;
  const hx = hero.tileX * GRID.TILE + GRID.TILE / 2;
  const hy = hero.tileY * GRID.TILE + GRID.TILE / 2;
  let nearest: Enemy | null = null;
  let bestD = rangePx + 1;
  for (const e of state.enemies.values()) {
    const d = Math.hypot(e.x - hx, e.y - hy);
    if (d <= rangePx && d < bestD) { bestD = d; nearest = e; }
  }
  if (!nearest) return;
  // Apply DIVINE damage. 2026-05-20 — the kill-bonus gate-heal was
  // removed per design ask ("get rid of the part where Sulla can
  // restore lives"). The hit still deals 1.5× hero basic-attack damage
  // and lands as a divine bolt VFX; it just no longer pays out a
  // life on the killing blow. heroLifeHealedThisRun is intentionally
  // left on the state shape for save-load compatibility with older
  // entries; no code path increments it any more.
  const dmg = heroBasicAttackDamage(state, hero) * 1.5;
  nearest.hp = Math.max(0, nearest.hp - dmg);
  // Signature VFX: vertical white-gold divine bolt strikes from above
  // onto the target, with impact burst on landing.
  fireAbilityFx(hero, hooks, state.tick, ability, '#fff5cc', 0.6, {
    target: { x: nearest.x, y: nearest.y }
  });
}

function executePROSCRIPTION(state: GameStateShape, hero: Tower, _params: any, ability: any, hooks?: HeroHooks): void {
  const dur = ability.durationSec ?? 5;
  (state as any).__proscriptionUntilTick = state.tick + dur;
  // Signature VFX: orange X-mark above every tower (the "proscription
  // list") + Sulla-origin pulsing ring. Each tower carries a brand for
  // the duration of the window.
  const MAX_TOWER_RELAY_FX = 28;
  const towerPositions: Array<{ x: number; y: number }> = [];
  for (const t of state.towers.values()) {
    if (t.id === hero.id || t.pending) continue;
    if (towerPositions.length >= MAX_TOWER_RELAY_FX) break;
    towerPositions.push({ x: t.tileX * GRID.TILE + GRID.TILE / 2, y: t.tileY * GRID.TILE + GRID.TILE / 2 });
  }
  fireAbilityFx(hero, hooks, state.tick, ability, '#ff9900', 1.2, { towers: towerPositions });
}

// ─── Timed events (Capite Censi per-throw pilum events, etc.) ────────

interface HeroTimedEvent { atTick: number; action: () => void; }

function scheduleHeroTimedEvent(state: GameStateShape, atTick: number, action: () => void): void {
  (state as any).__heroTimedEvents = (state as any).__heroTimedEvents ?? [];
  const queue = (state as any).__heroTimedEvents as HeroTimedEvent[];
  const MAX_HERO_TIMED_EVENTS = 96;
  if (queue.length >= MAX_HERO_TIMED_EVENTS) {
    queue.splice(0, queue.length - MAX_HERO_TIMED_EVENTS + 1);
  }
  queue.push({ atTick, action });
}

function tickHeroTimedEvents(state: GameStateShape, _hooks?: HeroHooks): void {
  const queue: HeroTimedEvent[] | undefined = (state as any).__heroTimedEvents;
  if (!queue || queue.length === 0) return;
  const ready: HeroTimedEvent[] = [];
  const remaining: HeroTimedEvent[] = [];
  for (const ev of queue) {
    if (state.tick >= ev.atTick) ready.push(ev);
    else remaining.push(ev);
  }
  (state as any).__heroTimedEvents = remaining;
  const MAX_READY_EVENTS_PER_TICK = 24;
  const readyNow = ready.slice(0, MAX_READY_EVENTS_PER_TICK);
  const deferred = ready.slice(MAX_READY_EVENTS_PER_TICK);
  if (deferred.length > 0) {
    const nextTick = state.tick + 0.016;
    remaining.unshift(...deferred.map(ev => ({ ...ev, atTick: nextTick })));
    (state as any).__heroTimedEvents = remaining;
  }
  for (const ev of readyNow) {
    try { ev.action(); } catch (err) { console.error('[hero] timed event failed:', err); }
  }
}

// ─── Utilities ──────────────────────────────────────────────────────

function pickHighestHpEnemies(state: GameStateShape, n: number): Enemy[] {
  const all = Array.from(state.enemies.values());
  all.sort((a, b) => b.hp - a.hp);
  return all.slice(0, n);
}

function fireImpactRing(hero: Tower, hooks: HeroHooks | undefined, tick: number, color: string, maxR: number): void {
  if (!hooks?.triggerImpactRing) return;
  const cx = hero.tileX * GRID.TILE + GRID.TILE / 2;
  const cy = hero.tileY * GRID.TILE + GRID.TILE / 2;
  hooks.triggerImpactRing(cx, cy, tick, maxR, hexToInt(color));
}

// 2026-05-19 v2 — fireAbilityFx: queues the per-ability signature
// animation on the renderer. Falls back to a generic impact ring when
// the hook isn't wired (test env / pre-renderer init). The `extras`
// payload rides the ability-specific data — target lists for VOLLEY +
// EAGLE_SCOUT, tower lists for SPQR_DECREE + PROSCRIPTION, etc. Each renderer reads only what its
// ability cares about, so passing undefined/null for unrelated fields
// is fine.
function fireAbilityFx(
  hero: Tower,
  hooks: HeroHooks | undefined,
  tick: number,
  ability: any,
  fallbackColor: string,
  life: number,
  extras: any
): void {
  const cx = hero.tileX * GRID.TILE + GRID.TILE / 2;
  const cy = hero.tileY * GRID.TILE + GRID.TILE / 2;
  const color = hexToInt(ability?.vfxColor ?? fallbackColor);
  if (hooks?.triggerHeroAbilityFx) {
    hooks.triggerHeroAbilityFx({
      ability: ability.id,
      x: cx, y: cy,
      tick,
      life,
      color,
      extras
    });
  } else if (hooks?.triggerImpactRing) {
    // Pre-renderer fallback so tests still see something queued and
    // ability execution stays observable in non-render environments.
    hooks.triggerImpactRing(cx, cy, tick, 48, color);
  }
}
