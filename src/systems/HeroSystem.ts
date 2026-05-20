// ─────────────────────────────────────────────────────────────────────
// HERO SYSTEM — 6 heroes, 3-card draft, kill-based XP, auto-pulse abilities.
//
// Architecture: every numeric value (XP threshold, ability cooldown, aura
// radius, banner copy) lives in src/data/herodefs.json. This module reads
// from that single source — no hardcoded magic numbers. Tuning passes
// edit the JSON file only; this file is mechanical wiring.
//
// Public API consumed by main.ts:
//   - draftHeroChoices(lastHeroId)     : pick 3 of 6 via Fisher-Yates
//   - pickHero(state, heroId)          : commit selection + queue placement
//   - awardHeroXp(state, isBoss)       : called from kill handler
//   - getHeroTier(state)               : current tier 0..4
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
import { Tower, Enemy, GamePhase, StatusEffectKind, TileType } from '../types';
import { GRID } from '../constants';
import { pushStatus } from './CombatResolver';
import { setTile } from './GridManager';
import { buildGroundPath } from './PathFinder';

// 6-hero pool (locked design). The draft picks 3 of these per run.
export const HERO_POOL = [
  'HERO_MARIUS',
  'HERO_AGRIPPA',
  'HERO_AGRICOLA',
  'HERO_SCIPIO',
  'HERO_CAESAR',
  'HERO_SULLA'
] as const;
export type HeroId = typeof HERO_POOL[number];

// Side-effect hooks provided by main.ts so HeroSystem stays decoupled
// from the renderer + DOM. All hooks are optional — missing hooks
// degrade gracefully (no VFX / no banner), system logic still runs.
export interface HeroHooks {
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
// 320, 620g per path maxed). Per-tap cost is much cheaper at the
// start so players can sample the system early, but ramps hard at
// the top to keep maxing out a real commitment. Sum across all
// three paths maxed = 1,860g (down from 4,500g).
export const HERO_FORGE_CAP = 5;

/** Returns the cost of the NEXT tap on this path, or null when MAXED. */
export function heroForgeNextCost(stacks: number): number | null {
  if (stacks >= HERO_FORGE_CAP) return null;
  return 20 * Math.pow(2, stacks); // 20/40/80/160/320
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
 * like javelinCount/eagleCount), boolean flags, string overrides, and
 * the `lifetimeHealCap` static cap. `bossSpeedMultiplier` is inverse-
 * scaled (divided) so a higher EMPOWER stack slows bosses MORE during
 * Scipio's Zama window. Pure function — returns a new object so caller
 * can safely use it without mutating the JSON-loaded source.
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

/** Fisher-Yates shuffle the 6-pool, return the first 3. Pure function. */
export function draftHeroChoices(_lastHeroId?: string | null): HeroId[] {
  const pool = [...HERO_POOL] as HeroId[];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, 3);
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
  if (!state.activeHeroId || !state.activeHeroTowerId) return;
  const hero = state.towers.get(state.activeHeroTowerId);
  if (!hero) return;
  const def: any = (HERO_DEFS as any)[state.activeHeroId];
  if (!def?.abilities) return;
  const tier = getHeroTier(state);
  // Initialize cooldown scratchpad on first access.
  if (!hero.__heroCooldowns) hero.__heroCooldowns = {};

  // 2026-05-20 v2 — Hero Forge Path B (HASTEN). Multiply this fire's
  // cooldown stamp by the forge CD scalar so abilities come up faster
  // as the player invests gold. Computed once per tick so all three
  // ability slots see the same scalar this frame.
  const cdMult = heroForgeCooldownMult(state);
  for (const ability of def.abilities) {
    if (tier < ability.level) continue;
    const nextFire = hero.__heroCooldowns[ability.id] ?? 0;
    if (state.tick < nextFire) continue;
    // Stamp BEFORE executing so a long-running executor can't double-fire.
    hero.__heroCooldowns[ability.id] = state.tick + (ability.cooldownSec ?? 60) * cdMult;
    dispatchAbility(state, hero, ability, hooks);
  }

  // Drain timed events (Triarii Wall revert, eagle expiry, etc.)
  tickHeroTimedEvents(state, hooks);

  // 2026-05-19 — Spectral eagle ticker. Agricola's tier-3 ult populates
  // __spectralEagles in executeAQUILA_SQUADRON but without this consumer
  // the eagles just sat on state and never killed anything. Each eagle
  // homes toward the nearest live flyer, instakills on contact, retires
  // after killsPerEagle hits or the expiry tick — whichever lands first.
  tickSpectralEagles(state, hooks);
}

// ─── Ability dispatch ────────────────────────────────────────────────

function dispatchAbility(state: GameStateShape, hero: Tower, ability: any, hooks?: HeroHooks): void {
  // 2026-05-20 v2 — Hero Forge Path C (EMPOWER). Scale every numeric
  // magnitude in the params block by the forge magnitude scalar. Counts,
  // booleans, strings, and lifetimeHealCap are skipped (see scaleParams).
  // Each executor reads from `params.X` so the scaled values land
  // transparently without per-executor code changes.
  const params = scaleParams(ability.params ?? {}, heroForgeMagnitudeMult(state));
  switch (ability.id) {
    // MARIUS
    case 'MARIAN_FORMATION':   return executeMARIAN_FORMATION(state, hero, params, ability, hooks);
    case 'TRIARII_WALL':       return executeTRIARII_WALL(state, hero, params, ability, hooks);
    case 'TRIUMPH':            return executeTRIUMPH(state, hero, params, ability, hooks);
    // AGRIPPA
    case 'PILUM_VOLLEY':       return executePILUM_VOLLEY(state, hero, params, ability, hooks);
    case 'NAVAL_BOMBARDMENT':  return executeNAVAL_BOMBARDMENT(state, hero, params, ability, hooks);
    case 'BATTLE_OF_ACTIUM':   return executeBATTLE_OF_ACTIUM(state, hero, params, ability, hooks);
    // AGRICOLA
    case 'EAGLE_SCOUT':        return executeEAGLE_SCOUT(state, hero, params, ability, hooks);
    case 'FRONTIER_WALL':      return executeFRONTIER_WALL(state, hero, params, ability, hooks);
    case 'AQUILA_SQUADRON':    return executeAQUILA_SQUADRON(state, hero, params, ability, hooks);
    // SCIPIO
    case 'CORNU_CHARGE':       return executeCORNU_CHARGE(state, hero, params, ability, hooks);
    case 'CARTHAGO_DELENDA_EST': return executeCARTHAGO_DELENDA_EST(state, hero, params, ability, hooks);
    case 'ZAMA':               return executeZAMA(state, hero, params, ability, hooks);
    // CAESAR
    case 'SPQR_DECREE':        return executeSPQR_DECREE(state, hero, params, ability, hooks);
    case 'PAX_ROMANA':         return executePAX_ROMANA(state, hero, params, ability, hooks);
    case 'IDES_OF_MARCH':      return executeIDES_OF_MARCH(state, hero, params, ability, hooks);
    // SULLA
    case 'FORTUNES_BOLT':      return executeFORTUNES_BOLT(state, hero, params, ability, hooks);
    case 'PROSCRIPTION':       return executePROSCRIPTION(state, hero, params, ability, hooks);
    case 'SULLAS_MARCH':       return executeSULLAS_MARCH(state, hero, params, ability, hooks);
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
  if (!state.activeHeroId) return hero.baseDps;
  const def: any = (HERO_DEFS as any)[state.activeHeroId];
  const scale = def?.basicAtkScalePerTier?.[getHeroTier(state)] ?? 1.0;
  // Per-tier damage scale × baseDps. attackSpeed not factored in — Cornu
  // Charge is a single-shot ability, not a damage-per-second slot.
  return hero.baseDps * scale;
}

// ─── Ability executors ──────────────────────────────────────────────
//
// Each executor implements the ability's mechanic. State-flag windows
// (e.g. __triumphUntilTick) are read by CombatResolver and EnemySystem
// to modulate damage / speed / status during the active window.
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
    if (t.damageType !== ('PHYS_MELEE' as any) && (t as any).mode !== 0) continue;
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
  for (const t of picked) {
    (t as any).__marianFormationUntilTick = until;
    (t as any).__marianSpeedMult = speedMult;
    if (params.shareCrit) (t as any).__marianSharedCrit = maxCrit;
  }
  // Signature VFX: purple connecting lines from Marius to each
  // buffed melee tower + small ring-burst at every node.
  fireAbilityFx(hero, hooks, state.tick, ability, '#cc44ff', 0.7, {
    targets: picked.map(t => ({ x: t.tileX * GRID.TILE + GRID.TILE / 2, y: t.tileY * GRID.TILE + GRID.TILE / 2 }))
  });
}

function executeTRIARII_WALL(state: GameStateShape, hero: Tower, params: any, ability: any, hooks?: HeroHooks): void {
  // Pick the farthest path tile from the gate. state.groundPath is
  // ordered start → gate, so index 0 is the cave entry; we want the
  // tile that maximizes pre-gate distance while still being walkable.
  // To force a U-turn, drop a wall on a mid-path tile that has a
  // detour available — fallback to a tile near the middle of the path.
  const path = state.groundPath;
  if (!path || path.length < 6) return;
  const mid = Math.floor(path.length / 2);
  let chosen: { col: number; row: number } | null = null;
  // Try mid first, then expand outward — only pick a tile we can revert.
  const candidates = [mid, mid - 1, mid + 1, mid - 2, mid + 2].filter(i => i >= 1 && i < path.length - 1);
  for (const i of candidates) {
    const p = path[i];
    if (state.tiles[p.row]?.[p.col] !== TileType.EMPTY && state.tiles[p.row]?.[p.col] !== TileType.SPAWN) continue;
    chosen = p;
    break;
  }
  if (!chosen) return;
  // Save the tile's prior value so we can restore it on revert.
  const priorTile = state.tiles[chosen.row][chosen.col];
  // Place a TOWER tile (acts as path blocker via the standard path
  // refresh). STONE works too but TOWER makes the tile visibly the
  // hero's intervention.
  setTile(state, chosen.col, chosen.row, TileType.STONE);
  const newPath = buildGroundPath(state);
  if (!newPath) {
    // The chosen tile would seal Rome's gate. Roll back.
    setTile(state, chosen.col, chosen.row, priorTile);
    return;
  }
  state.groundPath = newPath;
  hooks?.resnapEnemiesToPath?.(newPath);
  // Signature VFX: stone slab rising from the wall tile + dust shock-
  // wave outward. The wall is the SLAB tile (chosen above), not Marius.
  const wallCx = chosen!.col * GRID.TILE + GRID.TILE / 2;
  const wallCy = chosen!.row * GRID.TILE + GRID.TILE / 2;
  fireAbilityFx(hero, hooks, state.tick, ability, '#cc44ff', 1.6, { wall: { x: wallCx, y: wallCy } });
  // Schedule the revert.
  scheduleHeroTimedEvent(state, state.tick + (params.wallDurationSec ?? 5), () => {
    if (state.tiles[chosen!.row]?.[chosen!.col] === TileType.STONE) {
      setTile(state, chosen!.col, chosen!.row, priorTile);
      const restored = buildGroundPath(state);
      if (restored) {
        state.groundPath = restored;
        hooks?.resnapEnemiesToPath?.(restored);
      }
    }
  });
}

function executeTRIUMPH(state: GameStateShape, _hero: Tower, params: any, ability: any, hooks?: HeroHooks): void {
  const dur = ability.durationSec ?? 8;
  (state as any).__triumphUntilTick = state.tick + dur;
  // Stamp the damage multiplier so CombatResolver can read it.
  (state as any).__triumphMeleeDmgMult = 1 + (params.meleeDmgMultPercent ?? 100) / 100;
  // Signature VFX: massive purple laurel-wreath ring + golden sparks
  // rising up. Reads as "Roman triumph parade."
  const hero = findHeroTower(state) ?? _hero;
  fireAbilityFx(hero, hooks, state.tick, ability, '#cc44ff', 1.2, null);
  hooks?.triggerShake?.(2.5, 0.5);
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

function executeBATTLE_OF_ACTIUM(state: GameStateShape, hero: Tower, params: any, ability: any, hooks?: HeroHooks): void {
  // 2026-05-19 — Wire the JSON-declared rangedShotMultiplier through so
  // tuning passes can edit herodefs.json without code changes. Prior
  // version hardcoded 2.0 and silently ignored the params value.
  (state as any).__actiumUntilTick = state.tick + (ability.durationSec ?? 8);
  (state as any).__actiumRangedSpeedMult = params.rangedShotMultiplier ?? 2.0;
  // Signature VFX: teal banner-ripple sweeping outward in concentric
  // waves with a vertical banner accent above each wave.
  fireAbilityFx(hero, hooks, state.tick, ability, '#0077ff', 1.0, null);
  hooks?.triggerShake?.(3.0, 0.6);
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

function executeAQUILA_SQUADRON(state: GameStateShape, hero: Tower, params: any, ability: any, hooks?: HeroHooks): void {
  const count = params.eagleCount ?? 4;
  const maxKills = params.killsPerEagle ?? 6;
  const dur = params.eagleDurationSec ?? 12;
  (state as any).__spectralEagles = (state as any).__spectralEagles ?? [];
  for (let i = 0; i < count; i++) {
    (state as any).__spectralEagles.push({
      id: `eagle-${state.tick}-${i}`,
      killCount: 0,
      maxKills,
      expiresAtTick: state.tick + dur,
      // Eagles spawn at hero position, move toward nearest flyer each frame
      x: hero.tileX * GRID.TILE + GRID.TILE / 2,
      y: hero.tileY * GRID.TILE + GRID.TILE / 2,
    });
  }
  // Signature VFX: 6 golden eagle silhouettes burst outward from
  // Agricola in a fan. Central ring at origin.
  fireAbilityFx(hero, hooks, state.tick, ability, '#ffffff', 0.9, null);
  hooks?.triggerShake?.(3.0, 0.5);
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

function executeCARTHAGO_DELENDA_EST(state: GameStateShape, hero: Tower, params: any, ability: any, hooks?: HeroHooks): void {
  const pct = (params.maxHpTrueDmgPercent ?? 10) / 100;
  // Stamp X marks on each boss as the visual + record their positions
  // so the signature VFX can draw across each one.
  const bossPositions: Array<{ x: number; y: number }> = [];
  for (const e of state.enemies.values()) {
    if (!e.isBoss) continue;
    const shave = Math.floor(e.maxHp * pct);
    e.hp = Math.max(0, e.hp - shave);
    bossPositions.push({ x: e.x, y: e.y });
  }
  if (bossPositions.length > 0) {
    // Signature VFX: red X destruction mark slashes across each boss,
    // plus a Scipio-origin SPQR seal ring.
    for (const pos of bossPositions) {
      fireAbilityFx(hero, hooks, state.tick, ability, '#ff4400', 0.8, { target: pos });
    }
    hooks?.triggerShake?.(3.5, 0.6);
  }
}

function executeZAMA(state: GameStateShape, hero: Tower, params: any, ability: any, hooks?: HeroHooks): void {
  const dur = ability.durationSec ?? 6;
  (state as any).__zamaUntilTick = state.tick + dur;
  (state as any).__zamaTowerVsBossDmgMult = params.towerDmgVsBossMultiplier ?? 2.0;
  (state as any).__zamaBossSpeedMult = params.bossSpeedMultiplier ?? 0.5;
  // Signature VFX: massive blood-red battlefield ring with crossed-gladii
  // icons at four cardinal positions, gold pommel dots — "famous battle"
  fireAbilityFx(hero, hooks, state.tick, ability, '#c87822', 1.4, null);
  hooks?.triggerShake?.(4.0, 0.7);
}

// ── CAESAR ──

function executeSPQR_DECREE(state: GameStateShape, hero: Tower, _params: any, ability: any, hooks?: HeroHooks): void {
  // Force every tower to fire one bonus attack. Implementation: zero out
  // each tower's attackCooldown so the next combat tick fires immediately.
  const towerPositions: Array<{ x: number; y: number }> = [];
  for (const t of state.towers.values()) {
    if (t.id === hero.id) continue;
    t.attackCooldown = 0;
    towerPositions.push({ x: t.tileX * GRID.TILE + GRID.TILE / 2, y: t.tileY * GRID.TILE + GRID.TILE / 2 });
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

function executeIDES_OF_MARCH(state: GameStateShape, hero: Tower, params: any, ability: any, hooks?: HeroHooks): void {
  const dur = ability.durationSec ?? 6;
  (state as any).__idesUntilTick = state.tick + dur;
  (state as any).__idesTowerSpeedMult = params.towerSpeedMultiplier ?? 2.0;
  // Schedule the execute pulse at the END of the window.
  scheduleHeroTimedEvent(state, state.tick + dur, () => {
    const threshold = (params.executeThresholdPercent ?? 30) / 100;
    for (const e of state.enemies.values()) {
      if (e.isBoss) continue;
      if (e.hp / Math.max(1, e.maxHp) < threshold) e.hp = 0;
    }
    // Re-fire the dagger animation at the end of the window so the
    // execute moment also gets a strong VFX beat.
    const heroNow = findHeroTower(state);
    if (heroNow) {
      hooks?.triggerHeroAbilityFx?.({
        ability: 'IDES_OF_MARCH',
        x: heroNow.tileX * GRID.TILE + GRID.TILE / 2,
        y: heroNow.tileY * GRID.TILE + GRID.TILE / 2,
        tick: state.tick,
        life: 0.9,
        color: 0xffe066
      });
    }
  });
  // Signature VFX: gold-white screen flash + 7 dagger stab lines
  // converging on Caesar's tile from the surrounding senators.
  fireAbilityFx(hero, hooks, state.tick, ability, '#ffe066', 1.1, null);
  hooks?.triggerShake?.(5.0, 0.8);
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
  // Apply DIVINE damage. Tag the enemy so EnemySystem's kill handler
  // can credit the gate-heal if this hit lands the killing blow.
  const dmg = heroBasicAttackDamage(state, hero) * 1.5;
  const prevHp = nearest.hp;
  nearest.hp = Math.max(0, nearest.hp - dmg);
  if (nearest.hp === 0 && prevHp > 0) {
    // Heal cap enforced here too (belt + suspenders with EnemySystem).
    const healed = state.heroLifeHealedThisRun ?? 0;
    if (healed < 20) {
      state.lives += 1;
      state.heroLifeHealedThisRun = healed + 1;
    }
  }
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
  const towerPositions: Array<{ x: number; y: number }> = [];
  for (const t of state.towers.values()) {
    if (t.id === hero.id || t.pending) continue;
    towerPositions.push({ x: t.tileX * GRID.TILE + GRID.TILE / 2, y: t.tileY * GRID.TILE + GRID.TILE / 2 });
  }
  fireAbilityFx(hero, hooks, state.tick, ability, '#ff9900', 1.2, { towers: towerPositions });
}

function executeSULLAS_MARCH(state: GameStateShape, hero: Tower, params: any, ability: any, hooks?: HeroHooks): void {
  const threshold = (params.executeThresholdPercent ?? 25) / 100;
  // Execute any non-boss enemy below the threshold.
  for (const e of state.enemies.values()) {
    if (e.isBoss) continue;
    if (e.hp / Math.max(1, e.maxHp) < threshold) e.hp = 0;
  }
  // Heal the gate, capped at lifetime 20.
  // 2026-05-20 — Floor to integer. Hero Forge Path C (EMPOWER) scales
  // healGateAmount by 1.05^stacks, which produces floats (5 → 5.25 →
  // 5.5125 …). Adding floats to state.lives was bleeding floating-
  // point noise into the HUD ("LIVES 19.04999999…") and overflowing
  // the HUD chip on W11 because the long string blew out the column
  // width. Floor here keeps the heal integer, the cap math sane, and
  // the HUD aligned. Round-down loses < 1 life vs. the float math —
  // acceptable since the cap is already 20 and the base heal is 5.
  const healed = state.heroLifeHealedThisRun ?? 0;
  const requestedRaw = params.healGateAmount ?? 5;
  const requested = Math.max(0, Math.floor(requestedRaw));
  const cap = params.lifetimeHealCap ?? 20;
  const amount = Math.min(requested, Math.max(0, cap - healed));
  state.lives += amount;
  state.heroLifeHealedThisRun = healed + amount;
  // Signature VFX: white-gold light column descending over Sulla with
  // crossed-swords at the top + a heal cross above the gate tile.
  const gateCol = (GRID as any).COLS - 1;
  const gateRow = Math.floor((GRID as any).ROWS / 2);
  const gateX = gateCol * GRID.TILE + GRID.TILE / 2;
  const gateY = gateRow * GRID.TILE + GRID.TILE / 2;
  fireAbilityFx(hero, hooks, state.tick, ability, '#ffffff', 1.4, {
    gate: { x: gateX, y: gateY }
  });
  hooks?.triggerShake?.(4.0, 0.7);
}

// ─── Timed events (Triarii Wall revert, Ides delayed execute) ────────

interface HeroTimedEvent { atTick: number; action: () => void; }

function scheduleHeroTimedEvent(state: GameStateShape, atTick: number, action: () => void): void {
  (state as any).__heroTimedEvents = (state as any).__heroTimedEvents ?? [];
  ((state as any).__heroTimedEvents as HeroTimedEvent[]).push({ atTick, action });
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
  for (const ev of ready) {
    try { ev.action(); } catch (err) { console.error('[hero] timed event failed:', err); }
  }
}

// Eagle shape stored on state.__spectralEagles. Kept as a private
// interface here so the rest of the code can treat the array as opaque.
interface SpectralEagle {
  id: string;
  killCount: number;
  maxKills: number;
  expiresAtTick: number;
  x: number;
  y: number;
}

function tickSpectralEagles(state: GameStateShape, hooks?: HeroHooks): void {
  const eagles: SpectralEagle[] | undefined = (state as any).__spectralEagles;
  if (!eagles || eagles.length === 0) return;

  // Eagle homing speed in world-units per tick. Roughly 1 tile per 8
  // ticks at the canonical 60 fps. Fast enough that flyers can't
  // outrun them once locked, slow enough that the VFX reads as a
  // chasing eagle rather than a teleport-strike.
  const SPEED = (GRID.TILE / 8);
  const CONTACT_R = GRID.TILE * 0.45;
  const remaining: SpectralEagle[] = [];

  for (const eagle of eagles) {
    // Retire on expiry OR kills exhausted.
    if (state.tick >= eagle.expiresAtTick) continue;
    if (eagle.killCount >= eagle.maxKills) continue;

    // Pick nearest live flyer. Fall back to drifting forward if no
    // flyers are around — the eagle just floats until one spawns.
    let nearest: Enemy | null = null;
    let nearestD = Infinity;
    for (const e of state.enemies.values()) {
      if (!e.isFlyer || e.hp <= 0) continue;
      const d = Math.hypot(e.x - eagle.x, e.y - eagle.y);
      if (d < nearestD) { nearestD = d; nearest = e; }
    }

    if (nearest && nearestD <= CONTACT_R) {
      // Instakill the flyer in-place. Damage zeroes HP so the existing
      // kill handler in main.ts sees it on the next pass and emits XP /
      // gold / banner / VFX as usual.
      nearest.hp = 0;
      eagle.killCount++;
      if (hooks?.triggerImpactRing) {
        hooks.triggerImpactRing(nearest.x, nearest.y, state.tick, 32, 0xffffff);
      }
    } else if (nearest) {
      // Home toward it. Normalize the delta vector by remaining distance
      // so we move SPEED per tick regardless of how far the flyer is.
      const dx = nearest.x - eagle.x;
      const dy = nearest.y - eagle.y;
      const inv = 1 / (Math.hypot(dx, dy) || 1);
      eagle.x += dx * inv * SPEED;
      eagle.y += dy * inv * SPEED;
    }
    // (No flyers: eagle holds position — would be visually weird if it
    //  drifted off-map. Hold pose is fine and matches "circling overhead".)

    remaining.push(eagle);
  }
  (state as any).__spectralEagles = remaining;
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
// EAGLE_SCOUT, tower lists for SPQR_DECREE + PROSCRIPTION, the gate
// position for SULLAS_MARCH, etc. Each renderer reads only what its
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
