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
  state.activeHeroId = heroId;
  state.heroXp = 0;
  state.heroTier = 0;
  state.heroLifeHealedThisRun = 0;
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

  for (const ability of def.abilities) {
    if (tier < ability.level) continue;
    const nextFire = hero.__heroCooldowns[ability.id] ?? 0;
    if (state.tick < nextFire) continue;
    // Stamp BEFORE executing so a long-running executor can't double-fire.
    hero.__heroCooldowns[ability.id] = state.tick + (ability.cooldownSec ?? 60);
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
  const params = ability.params ?? {};
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
  fireImpactRing(hero, hooks, state.tick, ability.vfxColor ?? '#cc44ff', 48);
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
  fireImpactRing(hero, hooks, state.tick, ability.vfxColor ?? '#cc44ff', 36);
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
  fireImpactRing(findHeroTower(state) ?? _hero, hooks, state.tick, ability.vfxColor ?? '#ffe066', 80);
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
  fireImpactRing(hero, hooks, state.tick, ability.vfxColor ?? '#5599ff', 40);
}

function executeNAVAL_BOMBARDMENT(state: GameStateShape, hero: Tower, params: any, ability: any, hooks?: HeroHooks): void {
  const shells = params.shellCount ?? 3;
  const splashRadius = (params.splashRadiusTiles ?? 2) * GRID.TILE;
  const stunSec = params.stunSec ?? 1.5;
  const path = state.groundPath;
  if (!path || path.length < 4) return;
  const dmg = heroBasicAttackDamage(state, hero) * 1.6;
  for (let i = 0; i < shells; i++) {
    const idx = Math.floor(Math.random() * path.length);
    const tile = path[idx];
    const cx = tile.col * GRID.TILE + GRID.TILE / 2;
    const cy = tile.row * GRID.TILE + GRID.TILE / 2;
    for (const e of state.enemies.values()) {
      if (Math.hypot(e.x - cx, e.y - cy) <= splashRadius) {
        e.hp = Math.max(0, e.hp - dmg);
        pushStatus(e, StatusEffectKind.STUN, stunSec, 0, hero.qualityTier);
      }
    }
    hooks?.triggerImpactRing?.(cx, cy, state.tick + i * 0.05, splashRadius, hexToInt(ability.vfxColor ?? '#4499ff'));
  }
  hooks?.triggerShake?.(2.0, 0.35);
}

function executeBATTLE_OF_ACTIUM(state: GameStateShape, hero: Tower, params: any, ability: any, hooks?: HeroHooks): void {
  // 2026-05-19 — Wire the JSON-declared rangedShotMultiplier through so
  // tuning passes can edit herodefs.json without code changes. Prior
  // version hardcoded 2.0 and silently ignored the params value.
  (state as any).__actiumUntilTick = state.tick + (ability.durationSec ?? 8);
  (state as any).__actiumRangedSpeedMult = params.rangedShotMultiplier ?? 2.0;
  fireImpactRing(hero, hooks, state.tick, ability.vfxColor ?? '#0077ff', 96);
  hooks?.triggerShake?.(3.0, 0.6);
}

// ── AGRICOLA ──

function executeEAGLE_SCOUT(state: GameStateShape, hero: Tower, params: any, ability: any, hooks?: HeroHooks): void {
  const dur = ability.durationSec ?? 3;
  const dmgMult = 1 + (params.dmgTakenIncreasePercent ?? 60) / 100;
  let n = 0;
  for (const e of state.enemies.values()) {
    if (!e.isFlyer) continue;
    (e as any).__eagleScoutUntilTick = state.tick + dur;
    (e as any).__eagleScoutDmgMult = dmgMult;
    n++;
  }
  if (n === 0) return;
  fireImpactRing(hero, hooks, state.tick, ability.vfxColor ?? '#aaccff', 60);
}

function executeFRONTIER_WALL(state: GameStateShape, hero: Tower, params: any, ability: any, hooks?: HeroHooks): void {
  const dur = ability.durationSec ?? 4;
  (state as any).__frontierWallUntilTick = state.tick + dur;
  (state as any).__frontierWallFlyerSpeedMult = 1 - (params.flyerSpeedReductionPercent ?? 70) / 100;
  (state as any).__frontierWallVsFlyerDmgMult = 1 + (params.dmgVsFlyersIncreasePercent ?? 30) / 100;
  fireImpactRing(hero, hooks, state.tick, ability.vfxColor ?? '#aaccff', 80);
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
  fireImpactRing(hero, hooks, state.tick, ability.vfxColor ?? '#ffffff', 72);
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
  fireImpactRing(hero, hooks, state.tick, ability.vfxColor ?? '#ff8800', 40);
}

function executeCARTHAGO_DELENDA_EST(state: GameStateShape, hero: Tower, params: any, _ability: any, hooks?: HeroHooks): void {
  const pct = (params.maxHpTrueDmgPercent ?? 10) / 100;
  let any = false;
  for (const e of state.enemies.values()) {
    if (!e.isBoss) continue;
    const shave = Math.floor(e.maxHp * pct);
    e.hp = Math.max(0, e.hp - shave);
    any = true;
  }
  if (any) {
    fireImpactRing(hero, hooks, state.tick, '#ff4400', 100);
    hooks?.triggerShake?.(3.5, 0.6);
  }
}

function executeZAMA(state: GameStateShape, hero: Tower, params: any, ability: any, hooks?: HeroHooks): void {
  const dur = ability.durationSec ?? 6;
  (state as any).__zamaUntilTick = state.tick + dur;
  (state as any).__zamaTowerVsBossDmgMult = params.towerDmgVsBossMultiplier ?? 2.0;
  (state as any).__zamaBossSpeedMult = params.bossSpeedMultiplier ?? 0.5;
  fireImpactRing(hero, hooks, state.tick, ability.vfxColor ?? '#c87822', 120);
  hooks?.triggerShake?.(4.0, 0.7);
}

// ── CAESAR ──

function executeSPQR_DECREE(state: GameStateShape, hero: Tower, _params: any, ability: any, hooks?: HeroHooks): void {
  // Force every tower to fire one bonus attack. Implementation: zero out
  // each tower's attackCooldown so the next combat tick fires immediately.
  for (const t of state.towers.values()) {
    if (t.id === hero.id) continue;
    t.attackCooldown = 0;
  }
  fireImpactRing(hero, hooks, state.tick, ability.vfxColor ?? '#ffe066', 200);
}

function executePAX_ROMANA(state: GameStateShape, hero: Tower, params: any, ability: any, hooks?: HeroHooks): void {
  const dur = ability.durationSec ?? 2;
  const mag = (params.enemySpeedReductionPercent ?? 60) / 100;
  for (const e of state.enemies.values()) {
    pushStatus(e, StatusEffectKind.SLOW, dur, mag, hero.qualityTier);
  }
  fireImpactRing(hero, hooks, state.tick, ability.vfxColor ?? '#ffe066', 160);
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
  });
  fireImpactRing(hero, hooks, state.tick, ability.vfxColor ?? '#ffe066', 240);
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
  fireImpactRing(hero, hooks, state.tick, ability.vfxColor ?? '#fff5cc', 32);
}

function executePROSCRIPTION(state: GameStateShape, hero: Tower, _params: any, ability: any, hooks?: HeroHooks): void {
  const dur = ability.durationSec ?? 5;
  (state as any).__proscriptionUntilTick = state.tick + dur;
  fireImpactRing(hero, hooks, state.tick, ability.vfxColor ?? '#ff9900', 80);
}

function executeSULLAS_MARCH(state: GameStateShape, hero: Tower, params: any, ability: any, hooks?: HeroHooks): void {
  const threshold = (params.executeThresholdPercent ?? 25) / 100;
  // Execute any non-boss enemy below the threshold.
  for (const e of state.enemies.values()) {
    if (e.isBoss) continue;
    if (e.hp / Math.max(1, e.maxHp) < threshold) e.hp = 0;
  }
  // Heal the gate, capped at lifetime 20.
  const healed = state.heroLifeHealedThisRun ?? 0;
  const requested = params.healGateAmount ?? 5;
  const cap = params.lifetimeHealCap ?? 20;
  const amount = Math.min(requested, Math.max(0, cap - healed));
  state.lives += amount;
  state.heroLifeHealedThisRun = healed + amount;
  fireImpactRing(hero, hooks, state.tick, ability.vfxColor ?? '#ffffff', 200);
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
