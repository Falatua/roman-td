// EnemySystem — enemy spawning + per-frame movement + status effect ticking.
//
// Responsibilities:
//   1. spawnEnemy: create a fresh enemy from data, apply elite mutation roll,
//      set initial path/position, trigger spawn VFX.
//   2. tickEnemies (per frame):
//      - Apply wave-modifier global effects (VEIL untargetable, STORM_SURGE
//        random-target boost, AURA-STAR ally speed buff, GROUP_MARCH).
//      - Detect tower silence by Spectral Scout / Ghost Rider proximity.
//      - Tick status effects: SLOW, FREEZE, STUN, BURN, POISON, BLEED,
//        HELLFIRE, KNOCKBACK impulse.
//      - Apply OOC regen (Hannibal, Druids, etc.) when no recent damage.
//      - Apply low-HP speed burst (Berserker, Hellhound, Rabid).
//      - Move enemies along their precomputed path (ground or flyer).
//      - Phoenix rebirth: Spectral Scout / Fire Demon revive once on death.
//      - Fire onLeak / onDeath callbacks for the game-loop to handle.

import { Enemy, EnemyType, EnemyFaction, StatusEffectKind } from '../types';
import { GRID } from '../constants';
import { GameStateShape } from '../GameState';
import enemiesData from '../data/enemies.json';
import waypointsData from '../data/waypoints.json';
import wavesData from '../data/waves.json';
import { statusEffectiveness } from './EnemyResistances';

// Pre-computed waypoint centers in WORLD pixel coordinates, used by the
// per-frame proximity test so the checkpoint heal fires the instant an
// enemy *touches* a coin — no longer waiting for the pathIndex to step
// onto the waypoint tile. Radius is half-tile so the heal corresponds
// visually to overlapping the gold coin sprite.
const WAYPOINT_CENTERS: Array<{ idx: number; x: number; y: number; r2: number }> = (() => {
  const out: Array<{ idx: number; x: number; y: number; r2: number }> = [];
  for (const wp of (waypointsData as any).waypoints) {
    const cx = wp.topLeft.col * GRID.TILE + GRID.TILE / 2;
    const cy = wp.topLeft.row * GRID.TILE + GRID.TILE / 2;
    // Touch radius = half-tile (16px on a 32px grid). Squared for cheap distance check.
    const r = GRID.TILE * 0.55;
    out.push({ idx: wp.index, x: cx, y: cy, r2: r * r });
  }
  return out;
})();

let nextId = 1;
function newId(): string { return `e${nextId++}`; }

// Classify each enemy type into one of the archetypes from the difficulty doc §7.
// Used for visible labels and (eventually) damage-analysis suggestions.
const ARCHETYPE: Record<string, Enemy['archetype']> = {
  FERAL_DOG: 'SWARM', RABID_DOG: 'RUNNER', ALPHA_DOG: 'BOSS',
  CELTIC_FOOTMAN: 'SWARM', CELTIC_BERSERKER: 'RUNNER', GALLIC_DRUID: 'ELITE',
  CELTIC_SCOUT: 'RUNNER', CELTIC_WARLORD: 'BOSS',
  CARTHAGE_SPEARMAN: 'ARMORED', NUMIDIAN_RIDER: 'RUNNER',
  CARTHAGE_ELITE_GUARD: 'ARMORED', WAR_ELEPHANT: 'BULKY', HANNIBAL_BARCA: 'BOSS',
  UNDEAD_CELT: 'SWARM', ZOMBIE_DRUID: 'ELITE', UNDEAD_BERSERKER: 'RESISTANT',
  SPECTRAL_SCOUT: 'RUNNER', UNDEAD_WARLORD: 'BOSS',
  UNDEAD_SPEARMAN: 'RESISTANT', GHOST_RIDER: 'RUNNER',
  UNDEAD_WAR_ELEPHANT: 'BULKY',
  DEMON_HELLHOUND: 'RUNNER', CELTIC_FIRE_DEMON: 'RESISTANT',
  SHADOW_CAVALRY: 'RUNNER', DEMON_LEGATE: 'ELITE', DAEMON_IMPERATOR: 'BOSS',
  IRON_PHALANX: 'RESISTANT',
  // 2026-05 v6 audit fix: ARCHITECTUS was falling through to default 'SWARM'.
  // Heavy plate + regen + requiresMeleeBreak → ARMORED is the right archetype
  // for damage-type bonuses (Praefectus etc.).
  ARCHITECTUS: 'ARMORED',
  // Reanimated variants — archetype affects bonus-vs-archetype hits.
  REANIMATED_SKELETON: 'RUNNER', REANIMATED_ZOMBIE: 'SWARM', REANIMATED_LICH: 'ELITE',
  // ─── ENDLESS MODE (2026-05 v10) ───────────────────────────────────────
  EGYPTIAN_ARCHER: 'RUNNER', EGYPTIAN_SPEARMAN: 'SWARM', EGYPTIAN_CHARIOT: 'RUNNER',
  PHARAOH_GUARD: 'ARMORED', ANUBIS_PRIEST: 'ELITE', SOBEK_WARRIOR: 'BULKY',
  MUMMY_WARRIOR: 'RESISTANT', SPHINX: 'ELITE', ANUBIS_KING: 'BOSS',
  MONGOL_HORSE_ARCHER: 'RUNNER', MONGOL_SPEAR_RIDER: 'RUNNER', KHAN_RIDER: 'BOSS',
  MONGOL_FOOTMAN: 'SWARM', MONGOL_SPEARMAN: 'ARMORED', MONGOL_BERSERKER: 'RUNNER',
  MONGOL_SCOUT: 'RUNNER', MONGOL_SHAMAN: 'ELITE', MONGOL_CAPTAIN: 'RESISTANT'
};

export function spawnEnemy(state: GameStateShape, type: EnemyType, hpMult: number, derived?: boolean): Enemy {
  const def: any = (enemiesData as any)[type];
  if (!def) {
    // Defensive: if a wave references an unknown enemy type, fall back to
    // FERAL_DOG so the spawn never crashes the loop. Logged for the dev to fix.
    console.warn(`[Roman TD][EnemySystem] Unknown enemy type "${type}" — falling back to FERAL_DOG.`);
    return spawnEnemy(state, EnemyType.FERAL_DOG, hpMult);
  }
  const factionEnum = factionFromString(def.faction);
  const path = state.groundPath;
  const flyer: boolean = !!def.isFlyer;
  const startTile = path[0];
  const startX = (flyer ? state.flyerPath[0].x : startTile.col * GRID.TILE + GRID.TILE / 2);
  const startY = (flyer ? state.flyerPath[0].y : startTile.row * GRID.TILE + GRID.TILE / 2);
  // BLOOD_MOON wave modifier: +25% HP on every spawn this wave.
  const moonBoost = (state as any).bloodMoonHpMult ?? 1;
  // BASIC-ENEMY HEALTH BUFF (2026-05 v4): non-boss enemies get a flat +70%
  // HP at spawn. Every trash mob now demands real damage commitment plus
  // the relevant mechanic counter (DoT for regen, melee for shielded,
  // ranged for phalanx, etc). Bosses are balanced separately, untouched.
  const basicHpBuff = def.isBoss ? 1.0 : 1.70;
  const finalHp = def.baseHp * hpMult * moonBoost * basicHpBuff;
  const e: Enemy = {
    id: newId(),
    type,
    faction: factionEnum,
    hp: finalHp,
    maxHp: finalHp,
    baseSpeed: def.speed,
    currentSpeed: def.speed,
    isFlyer: flyer,
    x: startX,
    y: startY,
    prevX: startX,
    prevY: startY,
    dirX: 1,
    dirY: 0,
    pathIndex: 0,
    pathProgress: 0,
    statusEffects: [],
    hasFeared: false,
    livesCost: def.livesCost ?? 1,
    isBoss: !!def.isBoss,
    reward: 0,
    archetype: ARCHETYPE[type] ?? 'SWARM',
    hpFlashTimer: 0,
    // CHECKPOINT HEAL: per-type opt-in from enemies.json. Boss enemies and
    // flyers are barred regardless of the data flag — see tickEnemies guard.
    checkpointHealPct: def.checkpointHealPct,
    healedCheckpoints: []
  };
  // ─── ELITE MUTATIONS ────────────────────────────────────────────────
  // Late-wave spawns roll a small chance to be "elites" — single-modifier
  // champions with a tactical wrinkle. Bosses are exempt; ramp starts at W10.
  // Roll rate: 0% before W10, 4% at W10, 12% at W30, 20% at W50.
  if (!e.isBoss && state.wave >= 10) {
    const eliteChance = Math.min(0.20, 0.04 + (state.wave - 10) * 0.005);
    if (Math.random() < eliteChance) {
      const pool: Array<NonNullable<Enemy['mutation']>> = ['VETERAN','SWIFT','BLOATED','WARDED','AURA_STAR'];
      const m = pool[Math.floor(Math.random() * pool.length)];
      e.mutation = m;
      switch (m) {
        case 'VETERAN':   // +50% HP, tankier across the board
          e.maxHp *= 1.5; e.hp = e.maxHp;
          break;
        case 'SWIFT':     // +50% speed — outruns slow towers
          e.baseSpeed *= 1.5; e.currentSpeed = e.baseSpeed;
          break;
        case 'BLOATED':   // +120% HP, splits into 3 minions on death (handled below)
          e.maxHp *= 2.2; e.hp = e.maxHp;
          break;
        case 'WARDED':    // status-resistant — no actual change here, read in CombatResolver
          break;
        case 'AURA_STAR': // grants nearby allies +30% speed (read each frame)
          break;
      }
    }
  }
  // W11+ creative difficulty buffs (apply to PRIMARY spawns only —
  // derived children skip these so necromancy / split chains don't
  // double-stack the buff onto every reanimated grunt).
  //   • Ground non-boss: gains 3% maxHP/sec out-of-combat regen on top
  //     of whatever the JSON specifies. If the enemy already has a
  //     higher regen value the JSON wins. Makes mid-tier waves require
  //     sustained DPS instead of chip-and-wait clears.
  //   • Bosses: gain +20% base speed. Bosses already have lots of HP;
  //     the extra speed means leak-pressure is real and the player
  //     can't just sit on top of them safely.
  // Late-game resistance stamp — starts ramping at W6 and gets harsher
  // through W20. Multiplies into every damage-type mult AND DoT
  // effectiveness via EnemyResistances. Flyers stay at 1.0 (no stamp)
  // since they're already balanced against ranged-only counterplay.
  if (!derived && !e.isFlyer && (state.wave ?? 1) >= 6) {
    const w = state.wave ?? 1;
    let mult = 1.0;
    // Tiered staircase. Each milestone wave shaves a chunk off — the
    // result is a smooth curve across W6-W20 rather than a sudden
    // cliff at W11.
    if (w >= 6) mult -= 0.04;   // W6  → 0.96
    if (w >= 7) mult -= 0.04;   // W7  → 0.92  (W7-W9 resist bump)
    if (w >= 11) mult -= 0.07;  // W11 → 0.85  (existing breakpoint)
    if (w >= 16) mult -= 0.05;  // W16 → 0.80
    if (e.isBoss) mult -= 0.10; // bosses always tougher than ground
    mult = Math.max(0.50, mult);
    (e as any).__lateResistMult = mult;
  }
  // Other W11+ creative buffs — OOC regen + boss speed.
  if (!derived && (state.wave ?? 1) >= 11) {
    if (!e.isFlyer && !e.isBoss) {
      // Per-enemy OOC regen override — read by the regen path in
      // tickEnemies which takes max(def.outOfCombatRegen, e.outOfCombatRegen).
      (e as any).outOfCombatRegen = Math.max(def.outOfCombatRegen ?? 0, 0.03);
    }
    if (e.isBoss) {
      e.baseSpeed *= 1.20;
      e.currentSpeed = e.baseSpeed;
    }
  }
  state.enemies.set(e.id, e);
  // Trigger spawn-emergence puff at spawn pixel (Animation Doc §22.1)
  const renderer = (window as any).__renderer;
  if (renderer?.triggerSpawnPuff) renderer.triggerSpawnPuff(startX, startY, state.tick);
  return e;
}

function factionFromString(s: string): EnemyFaction {
  switch (s) {
    case 'DOGS': return EnemyFaction.DOGS;
    case 'CELTS': return EnemyFaction.CELTS;
    case 'CARTHAGE': return EnemyFaction.CARTHAGE;
    case 'UNDEAD_CELTS': return EnemyFaction.UNDEAD_CELTS;
    case 'UNDEAD_CARTHAGE': return EnemyFaction.UNDEAD_CARTHAGE;
    case 'SUPER_DEMONS': return EnemyFaction.SUPER_DEMONS;
    case 'MONGOLS': return EnemyFaction.MONGOLS;
    case 'EGYPTIANS': return EnemyFaction.EGYPTIANS;
    default: return EnemyFaction.DOGS;
  }
}

// Tick + decay every burn patch on the field. Enemies whose center is inside
// any patch take BURN damage each frame (small, scaled with patch source tier).
// Patches expire when life <= 0 and are spliced out.
export function tickBurnPatches(state: GameStateShape, dt: number) {
  const patches = state.burnPatches;
  if (!patches || patches.length === 0) return;
  // Decay (reverse loop, splice in-place)
  for (let i = patches.length - 1; i >= 0; i--) {
    patches[i].life -= dt;
    if (patches[i].life <= 0) patches.splice(i, 1);
  }
  if (patches.length === 0) return;
  // PERF (2026-05): early-exit on squared-distance to skip Math.hypot, and
  // bail the inner loop as soon as a hit is found — most enemies will be
  // touched by at most one patch and we can break instead of scanning all.
  // Was O(N×M) hypot every frame; now O(N×M) cheap dx*dx+dy*dy with break.
  const PATCH_RADIUS = 24;     // pixels, ~0.75 tile
  const R2 = PATCH_RADIUS * PATCH_RADIUS;
  for (const e of state.enemies.values()) {
    let bestTier = 0;
    for (let i = 0; i < patches.length; i++) {
      const p = patches[i];
      const dx = e.x - p.x, dy = e.y - p.y;
      if (dx * dx + dy * dy > R2) continue;
      if (p.sourceTier > bestTier) bestTier = p.sourceTier;
    }
    if (bestTier === 0) continue;
    // 2026-05 v11: BURNING GROUND is now the SOLE DoT from fire towers
    // (the redundant BURN status was removed from the fire tower
    // signatures). Patch base damage bumped 3% → 5% and tier scaling kept,
    // so totals across a single application are comparable to the old
    // status + patch combined but presented as ONE clean DoT effect.
    //
    // Per-tier tick rates: T1 5.0% · T2 5.75% · T3 6.5% · T4 7.25% · T5 8.0%
    //
    // Boss DoT reduction (×0.18) now applies to burning ground as well —
    // previously bypassed, which would have let the boosted patch melt
    // bosses too quickly.
    const bossMod = e.isBoss ? 0.18 : 1.0;
    const dps = e.maxHp * 0.05 * (1 + (bestTier - 1) * 0.15) * bossMod;
    e.hp -= dps * dt;
    e.lastDamagedTick = state.tick;
    if (e.hpFlashTimer <= 0) e.hpFlashTimer = 0.06;
  }
}

// Boss-wave hazards REMOVED 2026-05. Earlier versions stamped lightning
// bolts / meteor rings / earthquake shake / blood rain / hellfire over
// boss waves. These were cosmetic-only but added clutter and obscured
// readability — gone now. The function is kept as a no-op so callers in
// main.ts don't need to be patched.
export function tickBossHazards(_state: GameStateShape, _dt: number) {
  // intentional no-op (boss hazards removed)
}

// ─── PHOENIX REBIRTH (2026-05 v2) ─────────────────────────────────────
// Used by both the EnemySystem death path (DOT kills) and the
// CombatResolver direct-hit path. Old behavior: the dying enemy
// revived once at rebirthAtPct HP. New behavior: the original dies for
// real (kill counts), and 3 minions of the same type spawn at the
// death tile, each at rebirthAtPct HP with `hasRebirthed: true` so they
// can't trigger their own phoenix and chain forever. Each minion
// inherits the parent's path progress + a small radial offset so they
// don't all stack on the same pixel. Returns true when minions
// actually spawned so the caller can fire the visual flair.
export function spawnPhoenixMinions(state: GameStateShape, parent: Enemy, tick: number): boolean {
  const def: any = (enemiesData as any)[parent.type];
  const rebirthAtPct = def?.rebirthAtPct;
  if (!rebirthAtPct || parent.hasRebirthed) return false;
  const count = 3;
  for (let i = 0; i < count; i++) {
    const minion = spawnEnemy(state, parent.type as EnemyType, rebirthAtPct, /*derived=*/true);
    // No phoenix chain — minions cannot rebirth again.
    minion.hasRebirthed = true;
    // Radial cluster around the death tile so they don't overlap.
    const ang = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 6 + Math.random() * 4;
    minion.x = parent.x + Math.cos(ang) * dist;
    minion.y = parent.y + Math.sin(ang) * dist;
    minion.prevX = minion.x;
    minion.prevY = minion.y;
    // Inherit path so they continue the march from the parent's spot.
    minion.pathIndex = parent.pathIndex;
    minion.pathProgress = parent.pathProgress;
    minion.statusEffects = [];
    minion.hpFlashTimer = 0.4;
    minion.lastDamagedTick = tick;
  }
  // Visual flair — orange impact ring marks the rebirth flash. Same
  // hue as the original single-revive ring, larger to reflect 3-way pop.
  const renderer = (window as any).__renderer;
  if (renderer?.triggerImpactRing) renderer.triggerImpactRing(parent.x, parent.y, tick, 40, 0xffaa66);
  return true;
}

export function tickEnemies(state: GameStateShape, dt: number, onLeak: (e: Enemy) => void, onDeath: (e: Enemy) => void) {
  // ─── WAVE MODIFIERS ─────────────────────────────────────────────────────
  // VEIL: every 6s of wave time, all enemies become "untargetable" for 0.8s.
  //       We reuse hpFlashTimer-style transparency by setting a flag the
  //       CombatResolver targeting filter reads.
  // STORM_SURGE: every 8s, pick a random enemy and grant +50% speed for 3s.
  // GROUP_MARCH: any enemy within 2 tiles of 2+ others gets +20% speed.
  // DEATH_PACT: handled in onDeath callback (heals all surviving 4%).
  // REVENANT: handled in onDeath callback.
  const mod = state.waveModifier;
  if (mod === 'VEIL') {
    const cyclePos = (state.tick % 6.0);
    const veiled = cyclePos < 0.8;
    for (const e of state.enemies.values()) (e as any).__veiled = veiled;
  }
  if (mod === 'STORM_SURGE') {
    const next = state.waveModifierTick ?? 0;
    if (state.tick >= next) {
      state.waveModifierTick = state.tick + 8;
      const list = Array.from(state.enemies.values());
      if (list.length > 0) {
        const target = list[Math.floor(Math.random() * list.length)];
        (target as any).__stormBoostUntil = state.tick + 3;
        // Visual flash via hpFlashTimer + a quick particle burst from the renderer
        target.hpFlashTimer = 0.3;
        const renderer = (window as any).__renderer;
        if (renderer?.triggerImpactRing) renderer.triggerImpactRing(target.x, target.y, state.tick, 32, 0x66aaff);
      }
    }
  }
  // ─── PER-ENEMY STEALTH (2026-05): enemies with stealthInterval cycle
  //   between visible (period seconds) and stealthed (duration seconds).
  //   While stealthed they're untargetable (reuses the __veiled flag the
  //   targeting filter already reads). Phase offset by enemy id so the
  //   whole pack doesn't blink simultaneously.
  for (const e of state.enemies.values()) {
    const stealth = (enemiesData as any)[e.type]?.stealthInterval;
    if (!stealth) continue;
    const period = stealth.period ?? 8;
    const duration = stealth.duration ?? 1.2;
    const offset = ((e as any).__stealthOffset ??= (parseInt(e.id.slice(-2) || '0', 16) % 100) / 100 * period);
    const cyclePos = (state.tick + offset) % period;
    (e as any).__veiled = cyclePos < duration;
  }
  // ─── HEALER ENEMIES (2026-05): enemies with healAllyPctPerSec emit a
  //   gentle 1.5-tile heal ring that restores HP to nearby living allies
  //   (NOT themselves). Doesn't heal bosses to avoid trivializing them.
  const HEAL_RADIUS = GRID.TILE * 1.8;
  const healers: { src: Enemy; pct: number }[] = [];
  for (const e of state.enemies.values()) {
    const p = (enemiesData as any)[e.type]?.healAllyPctPerSec;
    if (p) healers.push({ src: e, pct: p });
  }
  if (healers.length > 0) {
    for (const target of state.enemies.values()) {
      if (target.isBoss) continue;       // never heal bosses
      for (const h of healers) {
        if (h.src.id === target.id) continue;
        if (Math.hypot(h.src.x - target.x, h.src.y - target.y) <= HEAL_RADIUS) {
          target.hp = Math.min(target.maxHp, target.hp + target.maxHp * h.pct * dt);
        }
      }
    }
  }
  // ─── AURA-STAR mutation: nearby allies move +30% faster ─────────────────
  // Pre-compute a per-enemy buff factor based on whether any AURA_STAR enemy
  // is within 3 tiles. Applied to currentSpeed below.
  const auraStars: Enemy[] = [];
  for (const e of state.enemies.values()) if (e.mutation === 'AURA_STAR') auraStars.push(e);
  // ─── ELEPHANT RANGED-PROTECTION AURA (2026-05 v10) ────────────────────
  // Living + Undead war elephants project a 2-tile dust shield that
  // makes nearby GROUND enemies untargetable by ranged towers until the
  // elephant dies. The elephant itself stays targetable (you have to be
  // able to kill it somehow). Flyers are never sheltered — they fly
  // above the dust.
  //
  // Clear all stamps at the top of frame, then re-stamp only the
  // protected enemies. Cheap O(elephants × nearby) — typically ≤ 5
  // elephants on screen and the loop bails fast on distance.
  const ELEPHANTS = new Set(['WAR_ELEPHANT','UNDEAD_WAR_ELEPHANT']);
  const ELEPHANT_AURA_RADIUS = GRID.TILE * 2.0;
  for (const e of state.enemies.values()) {
    (e as any).__rangedProtected = false;
  }
  const liveElephants: Enemy[] = [];
  for (const e of state.enemies.values()) {
    if (ELEPHANTS.has(e.type) && e.hp > 0) liveElephants.push(e);
  }
  if (liveElephants.length > 0) {
    for (const ally of state.enemies.values()) {
      if (ally.hp <= 0) continue;
      if (ally.isFlyer) continue;
      // Elephants themselves are NOT protected by the aura — otherwise
      // ranged builds could never tag them. They project the shield,
      // they don't benefit from it.
      if (ELEPHANTS.has(ally.type)) continue;
      for (const el of liveElephants) {
        const dx = ally.x - el.x;
        const dy = ally.y - el.y;
        if (dx * dx + dy * dy <= ELEPHANT_AURA_RADIUS * ELEPHANT_AURA_RADIUS) {
          (ally as any).__rangedProtected = true;
          break;
        }
      }
    }
  }
  // Stash elephant centers for the renderer to read each frame and draw
  // the dust-shield dome. Cleared and rewritten here so it stays in
  // sync with combat state without the renderer needing to filter.
  (state as any).__elephantAuraSources = liveElephants.map(el => ({
    x: el.x,
    y: el.y,
    r: ELEPHANT_AURA_RADIUS,
    isUndead: el.type === 'UNDEAD_WAR_ELEPHANT'
  }));
  // ─── TOWER SILENCE: Spectral Scout / Ghost Rider passing within 1.2 tiles
  // of a tower forces the tower into a 0.6s cooldown spike. They literally
  // walk past and disrupt the legion's rhythm.
  const SILENCERS = new Set(['SPECTRAL_SCOUT','GHOST_RIDER']);
  for (const e of state.enemies.values()) {
    if (!SILENCERS.has(e.type)) continue;
    for (const t of state.towers.values()) {
      if (t.pending) continue;
      const cx = t.tileX * GRID.TILE + GRID.TILE / 2;
      const cy = t.tileY * GRID.TILE + GRID.TILE / 2;
      if (Math.hypot(cx - e.x, cy - e.y) <= GRID.TILE * 1.2) {
        const until = t.silencedUntil ?? 0;
        if (state.tick > until - 0.2) {
          t.silencedUntil = state.tick + 0.6;
          t.attackCooldown = Math.max(t.attackCooldown, 0.6);
        }
      }
    }
  }
  // ─── DRUID SLEEP CURSE (2026-05 v9): Gallic Druid + Zombie Druid cast a
  // slow-moving sleep dart at the nearest awake tower within 3 tiles. The
  // dart travels for ~0.8s then puts the tower to sleep for 3 seconds —
  // during which the tower is completely inert (no targeting, no shots).
  // Cooldown is 5 seconds per druid so it isn't a constant lockdown, and
  // the slow projectile + 0.5s telegraphed channel gives the player time
  // to kill the druid before the dart lands. Sleep is on top of the
  // existing auraTowerSlow passive — that's the "ambient slow" while the
  // dart cast is the "active threat".
  const DRUIDS = new Set(['GALLIC_DRUID','ZOMBIE_DRUID']);
  const DRUID_CAST_RADIUS = GRID.TILE * 3.0;
  const DRUID_CAST_COOLDOWN = 5.0;    // seconds between successful casts
  const DRUID_CHANNEL_TIME = 0.5;     // brief telegraph before dart spawn
  const SLEEP_DART_TTL = 1.8;         // fail-safe — dart fades if it can't reach
  for (const e of state.enemies.values()) {
    if (!DRUIDS.has(e.type)) continue;
    if (e.hp <= 0) continue;
    // STUNNED / FROZEN druids can't cast. Reuse standard status checks.
    const incapacitated = e.statusEffects.some(s =>
      s.remaining > 0 &&
      (s.kind === StatusEffectKind.FREEZE || s.kind === StatusEffectKind.STUN)
    );
    if (incapacitated) continue;
    // While CHANNELING (the 0.5s telegraph) the druid roots in place and
    // glows — slow attack animation made literal. We clamp currentSpeed
    // to a crawl so the player can spot the windup and rush the druid
    // before the dart fires.
    const channelStartCheck = (e as any).__sleepChannelStartTick;
    if (typeof channelStartCheck === 'number') {
      e.currentSpeed = 0;
    }
    const nextCast = (e as any).__nextSleepCastTick ?? -999;
    if (state.tick < nextCast) continue;
    // Find the nearest non-sleeping tower in range.
    let bestT = null as any;
    let bestD = Infinity;
    for (const t of state.towers.values()) {
      if (t.pending) continue;
      if ((t.asleepUntil ?? 0) > state.tick) continue;     // already asleep
      const cx = t.tileX * GRID.TILE + GRID.TILE / 2;
      const cy = t.tileY * GRID.TILE + GRID.TILE / 2;
      const d = Math.hypot(cx - e.x, cy - e.y);
      if (d > DRUID_CAST_RADIUS) continue;
      if (d < bestD) { bestD = d; bestT = t; }
    }
    if (!bestT) continue;
    // Telegraph: stamp a channel-end tick. The dart actually spawns when
    // the channel completes, so the player sees the druid pause and glow
    // briefly before the orb appears.
    const channelStart = (e as any).__sleepChannelStartTick;
    if (typeof channelStart !== 'number') {
      (e as any).__sleepChannelStartTick = state.tick;
      (e as any).__sleepChannelTargetId = bestT.id;
      continue;
    }
    if (state.tick - channelStart < DRUID_CHANNEL_TIME) continue;
    // Channel complete — spawn the dart.
    const tx = bestT.tileX * GRID.TILE + GRID.TILE / 2;
    const ty = bestT.tileY * GRID.TILE + GRID.TILE / 2;
    const dx = tx - e.x;
    const dy = ty - e.y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const speed = GRID.TILE * 3.5; // travels ~3.5 tiles/sec — slow, dodgeable
    const darts = (state as any).__druidSleepDarts ?? ((state as any).__druidSleepDarts = []);
    darts.push({
      x: e.x,
      y: e.y - 6,
      vx: (dx / dist) * speed,
      vy: (dy / dist) * speed,
      targetTowerId: bestT.id,
      bornTick: state.tick,
      ttl: SLEEP_DART_TTL,
      faction: e.type === 'ZOMBIE_DRUID' ? 'undead' : 'celt'
    });
    (e as any).__nextSleepCastTick = state.tick + DRUID_CAST_COOLDOWN;
    (e as any).__sleepChannelStartTick = undefined;
    (e as any).__sleepChannelTargetId = undefined;
  }
  // Advance & resolve any in-flight sleep darts. Each frame, walk them
  // toward their stamped target tower. Land = within 8px of tower center
  // OR ttl exhausted (whichever first). On land, stamp asleepUntil and
  // hard-clamp attackCooldown so the very next-frame combat tick sees
  // the tower as inert.
  const dartArr: any[] = (state as any).__druidSleepDarts;
  if (Array.isArray(dartArr) && dartArr.length > 0) {
    for (let i = dartArr.length - 1; i >= 0; i--) {
      const d = dartArr[i];
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.ttl -= dt;
      const tw = state.towers.get(d.targetTowerId);
      let hit = false;
      if (tw) {
        const cx = tw.tileX * GRID.TILE + GRID.TILE / 2;
        const cy = tw.tileY * GRID.TILE + GRID.TILE / 2;
        // Re-aim mid-flight so a slow dart still tracks (mild homing).
        const ddx = cx - d.x;
        const ddy = cy - d.y;
        const dd = Math.hypot(ddx, ddy);
        if (dd <= 10) {
          tw.asleepUntil = state.tick + 3.0;
          tw.attackCooldown = Math.max(tw.attackCooldown, 3.0);
          hit = true;
          // Queue a render-side "zzz" pop so the player gets a juicy
          // confirmation frame. Cap the queue size to avoid runaway growth.
          const fxq = (state as any).__sleepFxQueue ?? ((state as any).__sleepFxQueue = []);
          fxq.push({ x: cx, y: cy - 16, bornTick: state.tick });
          if (fxq.length > 16) fxq.shift();
        } else {
          // Mild homing: blend current velocity toward bearing on the tower.
          const speed = Math.hypot(d.vx, d.vy);
          const desiredVx = (ddx / dd) * speed;
          const desiredVy = (ddy / dd) * speed;
          d.vx = d.vx * 0.85 + desiredVx * 0.15;
          d.vy = d.vy * 0.85 + desiredVy * 0.15;
        }
      }
      if (hit || d.ttl <= 0) {
        dartArr.splice(i, 1);
      }
    }
  }
  for (const e of Array.from(state.enemies.values())) {
    if (e.hp <= 0) {
      // SPLIT-ON-DEATH (2026-05): some enemies (Demon Hellhound, Fire
      // Demon, etc.) shatter into N weaker copies of a different type on
      // death. The copies inherit the parent's path position so they
      // continue the march, and they spawn at reduced HP multiplier so
      // they're a real follow-up threat but not a full second wave.
      const split = (enemiesData as any)[e.type]?.splitOnDeath;
      if (split && typeof split === 'object' && split.type && !e.isBoss) {
        const count = split.count ?? 2;
        const hpFraction = split.hpFraction ?? 0.4;
        for (let i = 0; i < count; i++) {
          const child = spawnEnemy(state, split.type as EnemyType, hpFraction, /*derived=*/true);
          child.x = e.x + (Math.random() - 0.5) * 12;
          child.y = e.y + (Math.random() - 0.5) * 12;
          child.prevX = child.x;
          child.prevY = child.y;
          child.pathIndex = e.pathIndex;
          child.pathProgress = e.pathProgress;
        }
      }
      // NECROMANCY REANIMATION (2026-05): on waves tagged `necromancy: true`
      // in waves.json, every ground non-boss enemy with a `reanimateAs`
      // target spits out MULTIPLE reanimated undead at its death tile.
      // Risen entities inherit the parent's path progress so they continue
      // the march from where the original fell. They DON'T chain — a
      // reanim never reanimates again, otherwise the wave never ends.
      //
      // Spawn count (2026-05 v2): 2-3 risen per death, randomized so
      // necromancy waves feel like a real swarm rather than a 1:1 ledger.
      // Each risen spawns at slightly reduced HP (70-90%) and a small
      // pixel offset so they don't all stack on the same pixel.
      const currentWave: any = wavesData[state.wave - 1];
      const isNecroWave = !!(currentWave && currentWave.necromancy);
      const reanimateAs = (enemiesData as any)[e.type]?.reanimateAs;
      // Undead minions now ALWAYS proc the necromancy reanim on death,
      // regardless of whether the wave is tagged. Living factions
      // (CELTS, CARTHAGE, DOGS) still gate on the wave's necromancy
      // flag so the early-game waves stay clean. The `!e.__reanimated`
      // guard prevents reanim products from chain-reanimating, so the
      // wave still ends.
      const enemyFaction: string | undefined = (enemiesData as any)[e.type]?.faction;
      const isUndeadFaction = enemyFaction === 'UNDEAD_CELTS' || enemyFaction === 'UNDEAD_CARTHAGE';
      const shouldReanim = (isNecroWave || isUndeadFaction) && reanimateAs && !e.isBoss && !e.isFlyer && !e.__reanimated;
      if (shouldReanim) {
        // 2026-05 v10: necromancy bumped 4-6 → 6-9 per kill. Distribution:
        //   45% → 6 risen
        //   35% → 7 risen
        //   15% → 8 risen
        //   5%  → 9 risen
        // The cursed-gauntlet fantasy of "kill one, fight seven" is the
        // whole point of necromancy waves — pre-bump it felt like a 2x
        // ledger, now it actually swarms.
        const r = Math.random();
        const count = r < 0.45 ? 6 : r < 0.80 ? 7 : r < 0.95 ? 8 : 9;
        const rfq = (state as any).reanimationFxQueue = (state as any).reanimationFxQueue ?? [];
        for (let i = 0; i < count; i++) {
          // 2026-05 v6: risen HP fraction 70-90% → 85-100% so a reanim
          // is nearly the full unit, not a chip-damage filler.
          const hpFrac = 0.85 + Math.random() * 0.15;
          const risen = spawnEnemy(state, reanimateAs as EnemyType, hpFrac, /*derived=*/true);
          // Cluster near death point with a small random offset so the
          // sprites don't all overlap to one pixel.
          const ang = (i / count) * Math.PI * 2 + Math.random() * 0.6;
          const dist = i === 0 ? 0 : (4 + Math.random() * 6);
          risen.x = e.x + Math.cos(ang) * dist;
          risen.y = e.y + Math.sin(ang) * dist;
          risen.prevX = risen.x;
          risen.prevY = risen.y;
          risen.pathIndex = e.pathIndex;
          risen.pathProgress = e.pathProgress;
          risen.__reanimated = true;
          // 1.2s rising window — the renderer paints a portal swirl + bones
          // pillar over the sprite during this time, and the move loop
          // below skips path advancement until the rising completes.
          // Stagger the rises by a few hundred ms so they don't all
          // emerge in lockstep — the cluster reads like a real wave.
          risen.risingUntil = state.tick + 1.2 + i * 0.25;
          rfq.push({
            x: risen.x, y: risen.y,
            bornTick: state.tick + i * 0.25,
            riseDuration: 1.2,
            spawnType: reanimateAs
          });
          if (rfq.length > 24) rfq.shift();        // perf cap (2026-05)
        }
      }
      onDeath(e);
      state.enemies.delete(e.id);
      continue;
    }
    // 2026-05-15 v3: DPS-check dummy is fully immune to every status
    // effect — slow, freeze, stun, all DoT (burn/bleed/poison/hellfire),
    // knockback, mark, fear, armor shred. Wipe any status that got
    // pushed last frame, before the per-kind handlers run, so the
    // HELLFIRE branch (which bypasses statusEffectiveness) can't sneak
    // damage through. Speed stays at baseSpeed because speedMult won't
    // be multiplied by any SLOW status. Net: dummy is a true control
    // variable for the maze-throughput measurement.
    if ((e as any).isDpsCheck) {
      e.statusEffects = [];
      // 2026-05-15 audit fix: DRAGON_MARK is stamped on a separate
      // field (__dragonMark) and bypassed the statusEffects = [] wipe,
      // so a Draconarius in the maze was permanently amplifying its
      // own (and every other tower's) damage on the dummy by up to
      // +75%. Skewed all DPS reads with a Draconarius present.
      (e as any).__dragonMark = undefined;
    }
    // Status effects: tick
    let speedMult = 1;
    let frozen = false;
    let stunned = false;
    let dotDps = 0;
    let knockbackImpulse = 0;
    // Per-kind DOT damage breakdown so the renderer can pop colored floating
    // numbers (POISON green, BLEED red, BURN orange, HELLFIRE dark red) at
    // a regular cadence while the status is active.
    const dotByKind = { BURN: 0, POISON: 0, BLEED: 0, HELLFIRE: 0 };
    for (const s of e.statusEffects) {
      s.remaining -= dt;
      if (s.kind === StatusEffectKind.SLOW) speedMult *= (1 - s.magnitude * statusEffectiveness(e, StatusEffectKind.SLOW));
      if (s.kind === StatusEffectKind.FREEZE) frozen = true;
      if (s.kind === StatusEffectKind.STUN) stunned = true;
      // BOSS DOT REDUCTION: % maxHP DOTs were trivializing bosses (a 2× HP
      // boss with poison = 14% maxHP/sec = ~50% HP gone in 4s). Bosses now
      // take 30% effectiveness from all percent-based DOTs so the boss
      // identity matters and players still need direct damage to finish them.
      // DOT vs BOSS (2026-05 v6): bosses were melting under stacked DOTs
      // late game. Trimmed boss DOT effectiveness from 30% → 18% so bosses
      // need direct damage to fall, not just a poisoned blade and patience.
      const dotBossMod = e.isBoss ? 0.18 : 1.0;
      // BURN nerf (2026-05): 8% → 6%/sec to match the smaller DOT family
      // (poison was 7→6, bleed 1.2→1.0). Tick honors s.magnitude so any
      // future variant can scale around the new baseline.
      if (s.kind === StatusEffectKind.BURN) { const v = e.maxHp * (s.magnitude || 0.06) * statusEffectiveness(e, StatusEffectKind.BURN) * dotBossMod; dotDps += v; dotByKind.BURN += v; }
      // Poison = burst DOT (high DPS, short duration set at application).
      // Bleed  = slow DOT (low DPS, long duration set at application).
      // POISON / BLEED tuning (2026-05): each tick now honors the
      // status's own `magnitude` value (was hardcoded). Application sites
      // already pass tuned numbers — Barbed Gladius @ 1.0%, Falcata @
      // 1.6% (heavy), default ticks fall back to base values that match
      // the small per-second haircut requested by the player.
      // Poison: 7% → 6% baseline. Bleed: 1.2% → 1.0% baseline.
      if (s.kind === StatusEffectKind.POISON) { const v = e.maxHp * (s.magnitude || 0.06) * statusEffectiveness(e, StatusEffectKind.POISON) * dotBossMod; dotDps += v; dotByKind.POISON += v; }
      if (s.kind === StatusEffectKind.BLEED)  { const v = e.maxHp * (s.magnitude || 0.010) * statusEffectiveness(e, StatusEffectKind.BLEED) * dotBossMod; dotDps += v; dotByKind.BLEED += v; }
      // HELLFIRE: previously hardcoded to 4% maxHP/sec. Now reads
      // s.magnitude so the per-tower setting drives the bite (God of War
      // = 1%/sec post-v10). Fall-back default 0.01 if magnitude unset.
      if (s.kind === StatusEffectKind.HELLFIRE) { const v = e.maxHp * (s.magnitude || 0.01) * dotBossMod; dotDps += v; dotByKind.HELLFIRE += v; }
      // KNOCKBACK is a one-shot impulse: take its magnitude as path-
      // reversal then expire the status. Bosses are cut to 25% so they
      // aren't trolled. Per-enemy lifetime cap: max 5 knockbacks each.
      // Once the cap is reached the impulse is consumed (status expires)
      // but no displacement is applied — the enemy becomes
      // "knockback-fatigued" and walks forward unimpeded.
      if (s.kind === StatusEffectKind.KNOCKBACK) {
        const used = ((e as any).__knockbackCount ?? 0) as number;
        if (used < 5) {
          knockbackImpulse += s.magnitude * (e.isBoss ? 0.25 : 1);
          (e as any).__knockbackCount = used + 1;
          // Visual cue: knockback animation flag (recoil flash). The
          // renderer reads __knockbackAnimUntil and applies a brief
          // sprite scale-pulse + back-flash for the duration.
          (e as any).__knockbackAnimUntil = state.tick + 0.35;
        }
        s.remaining = 0;       // consume immediately, even if capped
      }
      // MARK has no per-tick effect; the +damage multiplier is read in CombatResolver.
    }
    e.statusEffects = e.statusEffects.filter(s => s.remaining > 0);
    if (dotDps > 0) {
      e.hp -= dotDps * dt;
      // DOT COUNTERS REGEN (2026-05): any active burn/poison/bleed/hellfire
      // tick refreshes the "took damage" timestamp, so out-of-combat regen
      // never gets to ramp up while a status is burning the target. This
      // is how DoT builds counter Hannibal / Daemon / druid regen.
      e.lastDamagedTick = state.tick;
    }
    // ─── DOT FLOATING NUMBERS ───────────────────────────────────────────
    // Pop a colored floating number every ~0.45s per active DOT kind so the
    // player sees damage being inflicted by status effects in real-time.
    // Colors: POISON green, BLEED red, BURN orange, HELLFIRE dark red.
    // Numbers stop appearing as soon as the status duration runs out (the
    // dotByKind accumulator is empty next tick once the effect filters out).
    const gore = (window as any).__gore;
    const emit = (window as any).__emitFloatingNumber;
    if (gore && emit) {
      const lastDot = ((e as any).__lastDotTick ??= { BURN: 0, POISON: 0, BLEED: 0, HELLFIRE: 0 });
      const tick = state.tick;
      const CADENCE = 0.45;
      const COLORS: Record<string, number> = { POISON: 0x88ff88, BLEED: 0xff5555, BURN: 0xff8833, HELLFIRE: 0xaa1010 };
      for (const kind of ['POISON','BLEED','BURN','HELLFIRE'] as const) {
        const dps = dotByKind[kind];
        if (dps <= 0) continue;
        if (tick - lastDot[kind] < CADENCE) continue;
        lastDot[kind] = tick;
        const perTick = dps * CADENCE;       // damage that landed since last popup
        if (perTick < 0.5) continue;          // skip noise
        emit(gore, e.x, e.y - 14, perTick, COLORS[kind]);
      }
    }
    e.currentSpeed = (frozen || stunned) ? 0 : e.baseSpeed * speedMult;

    // Regen for special enemies — both constant and out-of-combat
    // varieties. DoT suppression rule: if the enemy has ANY active
    // damage-over-time status (burn / poison / bleed / hellfire), both
    // forms of regen are nullified this frame. This makes any DoT
    // source a hard counter to regen-heavy enemies (Hannibal, druids,
    // hellhounds, Daemon Imperator) — applying poison or bleed is no
    // longer just chip damage, it actively holds the enemy's healing
    // shut while it ticks down.
    //
    // EXEMPTION (2026-05 v9 confirm): the CHECKPOINT touch heal
    // (`checkpointHealPct`) is intentionally NOT suppressed by DoT.
    // The coin-touch heal is a wave-design lever that punishes letting
    // enemies through; it must always fire when the enemy reaches the
    // coin so the player feels the design pressure regardless of
    // whether they happened to have a DoT ticking on the unit. The
    // checkpoint block lives further down (search `WAYPOINT_CENTERS`)
    // and is deliberately outside this `if (!hasActiveDot)` guard.
    const def: any = (enemiesData as any)[e.type];
    const hasActiveDot = e.statusEffects.some(s =>
      s.remaining > 0 && (
        s.kind === StatusEffectKind.BURN ||
        s.kind === StatusEffectKind.POISON ||
        s.kind === StatusEffectKind.BLEED ||
        s.kind === StatusEffectKind.HELLFIRE
      )
    );
    if (!hasActiveDot) {
      // Constant regen (always-on, e.g. Iron Phalanx / Architectus).
      if (def.regenPctPerSec) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * def.regenPctPerSec * dt);
      // OUT-OF-COMBAT REGEN: ramps up after 0.5s of not taking damage.
      // Per-enemy override (set by spawnEnemy for W11+ creative buff)
      // wins when present and is HIGHER than the JSON value.
      const oocRegen = Math.max(def.outOfCombatRegen ?? 0, (e as any).outOfCombatRegen ?? 0);
      if (oocRegen > 0) {
        const sinceHit = state.tick - (e.lastDamagedTick ?? -999);
        if (sinceHit > 0.5) {
          e.hp = Math.min(e.maxHp, e.hp + e.maxHp * oocRegen * dt);
        }
      }
    }
    // LOW-HP SPEED BOOST: berserker / hellhound / rabid surge to the gate when wounded.
    if (def.lowHpSpeedBoost && e.hp / e.maxHp < 0.30) {
      e.currentSpeed *= def.lowHpSpeedBoost;
    }
    // SWIFT mutation already baked into baseSpeed at spawn; AURA_STAR proximity
    // grants a per-frame +30% speed buff to non-self allies within 3 tiles.
    if (auraStars.length > 0 && e.mutation !== 'AURA_STAR') {
      for (const star of auraStars) {
        if (Math.hypot(star.x - e.x, star.y - e.y) <= 3 * GRID.TILE) {
          e.currentSpeed *= 1.30;
          break;
        }
      }
    }
    // TRIBUNUS_LATICLAVIUS — TIME WARP: enemies in any Tribunus's range
    // tick at 70% game speed. Stacks multiplicatively with Slow.
    for (const tw of state.towers.values()) {
      if (tw.type !== 'TRIBUNUS_LATICLAVIUS' || tw.pending) continue;
      const cx = tw.tileX * GRID.TILE + GRID.TILE / 2;
      const cy = tw.tileY * GRID.TILE + GRID.TILE / 2;
      const r = (tw.range ?? 5.0) * GRID.TILE;
      if (Math.hypot(e.x - cx, e.y - cy) <= r) {
        e.currentSpeed *= 0.70;
        break;
      }
    }
    // STORM_SURGE: random enemy gets +50% speed boost for 3s
    if ((e as any).__stormBoostUntil && state.tick < (e as any).__stormBoostUntil) {
      e.currentSpeed *= 1.5;
    }
    // GROUP_MARCH: bunched enemies move faster
    if (state.waveModifier === 'GROUP_MARCH') {
      let near = 0;
      for (const o of state.enemies.values()) {
        if (o.id === e.id) continue;
        if (Math.hypot(o.x - e.x, o.y - e.y) <= 2 * GRID.TILE) { near++; if (near >= 2) break; }
      }
      if (near >= 2) e.currentSpeed *= 1.20;
    }

    // Move along path. Preserve leftover distance across segment boundaries so
    // fast enemies glide through turns instead of pausing on tile centers.
    e.prevX = e.x;
    e.prevY = e.y;
    const path = e.isFlyer ? state.flyerPath : state.groundPath.map(t => ({ x: t.col * GRID.TILE + GRID.TILE / 2, y: t.row * GRID.TILE + GRID.TILE / 2 }));
    if (e.pathIndex >= path.length - 1) {
      // reached gate
      onLeak(e);
      // BOSS REBIRTH ON LEAK (2026-05 v6): bosses that reach Rome pay
      // their 10-lives toll (already applied via onLeak) and then DIE
      // at the gate. They are queued to be REBORN at full HP on the
      // NEXT wave's start. This replaces the prior infinite-loop-at-
      // same-HP behavior which let a player who'd whittled a boss to
      // 5% HP keep that progress across many "loops" — now leaking
      // resets that progress entirely. The boss is essentially saying
      // "you didn't kill me in time. I'm coming back fresh next wave."
      if (e.isBoss) {
        if (!state.bossRespawnQueue) state.bossRespawnQueue = [];
        // 2026-05 v6: carry the HP across rebirth. Cap to 1 so a quirky
        // overheal can't bank > 100%. fraction recorded for the banner
        // copy / pre-wave alert; hpAtLeak is the authoritative payload.
        // 2026-05 v11: also carry the `isScheduledBoss` flag so the
        // legendary-drop guarantee survives carry-over to a non-B wave.
        const hpAtLeak = Math.max(1, Math.round(e.hp));
        const hpFraction = Math.max(0.01, Math.min(1, e.hp / e.maxHp));
        state.bossRespawnQueue.push({ type: e.type, hpAtLeak, hpFraction, wasScheduled: !!e.isScheduledBoss });
      }
      state.enemies.delete(e.id);
      continue;
    }
    // Apply knockback as a path-progress reversal. Magnitude is "path units"
    // (e.g. 0.6 ≈ slightly more than half a tile). Stops at the segment start.
    if (knockbackImpulse > 0) {
      let kb = knockbackImpulse;
      while (kb > 0 && (e.pathIndex > 0 || e.pathProgress > 0)) {
        if (e.pathProgress >= kb) {
          e.pathProgress -= kb;
          kb = 0;
        } else {
          kb -= e.pathProgress;
          e.pathProgress = 1;
          e.pathIndex = Math.max(0, e.pathIndex - 1);
        }
      }
    }
    // NECROMANCY RISE: while this enemy is still emerging from the ground,
    // it stays glued to the spawn tile and shrugs off incoming damage so
    // the reanimation cinematic finishes cleanly. The renderer is what
    // makes the sprite read as untargetable (faded + bones pillar over it).
    if (e.risingUntil != null && state.tick < e.risingUntil) {
      // Re-use the existing VEIL-untargetable flag so the targeting code
      // in CombatResolver already excludes rising units without changes.
      (e as any).__veiled = true;
      continue;
    }
    // Clear the rise-veil the frame the rising completes.
    if (e.risingUntil != null && state.tick >= e.risingUntil) {
      (e as any).__veiled = false;
      e.risingUntil = undefined;
    }
    let remainingDist = e.currentSpeed * GRID.TILE * dt;
    while (remainingDist > 0 && e.pathIndex < path.length - 1) {
      const a = path[e.pathIndex];
      const b = path[e.pathIndex + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const segLen = Math.max(1e-3, Math.hypot(dx, dy));
      const distLeft = (1 - e.pathProgress) * segLen;
      e.dirX = dx / segLen;
      e.dirY = dy / segLen;
      if (remainingDist >= distLeft) {
        remainingDist -= distLeft;
        e.pathIndex++;
        e.pathProgress = 0;
        e.x = b.x;
        e.y = b.y;
        // HEAVY-UNIT TILE-CROSS DUST (2026-05 v6 polish): each time a
        // ponderous unit crosses an integer tile boundary, it kicks up
        // 1-2 brown dust particles at its feet. Visceral weight without
        // any per-frame cost — particles use the existing pooled gore
        // system and are evicted automatically at the MAX_PARTICLES cap.
        const HEAVY = new Set(['WAR_ELEPHANT','UNDEAD_WAR_ELEPHANT','HANNIBAL_BARCA','ARCHITECTUS']);
        if (HEAVY.has(e.type) && !e.isFlyer) {
          const gore = (window as any).__gore;
          if (gore?.particles) {
            const count = e.isBoss ? 2 : 1;
            for (let i = 0; i < count; i++) {
              const angle = Math.PI + (Math.random() - 0.5) * 1.4;        // mostly behind
              const sp = 20 + Math.random() * 30;
              gore.particles.push({
                x: e.x + (Math.random() - 0.5) * 6,
                y: e.y + 6 + Math.random() * 3,
                vx: Math.cos(angle) * sp,
                vy: -10 - Math.random() * 12,
                life: 0.45 + Math.random() * 0.25,
                size: 1.5 + Math.random() * 1.5,
                color: 0xa67a4a                                            // dust brown
              });
            }
          }
        }
      } else {
        e.pathProgress += remainingDist / segLen;
        remainingDist = 0;
        const t = Math.min(1, e.pathProgress);
        e.x = a.x + dx * t;
        e.y = a.y + dy * t;
      }
    }
    if (e.hpFlashTimer > 0) e.hpFlashTimer = Math.max(0, e.hpFlashTimer - dt);

    // CHECKPOINT HEAL — TOUCH-BASED (2026-05 v9): ground-only, non-boss
    // enemies tagged with `checkpointHealPct` heal the INSTANT their
    // center enters the coin's touch radius (~0.55 tiles). Per-frame
    // proximity scan fires before the next pathIndex step, so even a
    // fast unit that would have flashed past the waypoint tile in a
    // single tick still gets caught at the moment of overlap.
    // `healedCheckpoints` log dedupes — each waypoint heals once per
    // enemy lifetime regardless of knockback / path-resnap loops.
    //
    // IMPORTANT: this heal fires regardless of DoT state. Unlike
    // regenPctPerSec / outOfCombatRegen above (which are nullified
    // while burn/poison/bleed/hellfire ticks), the checkpoint touch
    // heal is part of the wave-design contract — letting an enemy
    // reach a coin must always restore HP so the cost of leaks is
    // legible. Stacking three DoTs on the unit does NOT block it.
    if (!e.isFlyer && !e.isBoss && e.checkpointHealPct && e.checkpointHealPct > 0) {
      for (let i = 0; i < WAYPOINT_CENTERS.length; i++) {
        const wp = WAYPOINT_CENTERS[i];
        const dxw = e.x - wp.x;
        const dyw = e.y - wp.y;
        if (dxw * dxw + dyw * dyw <= wp.r2) {
          const log = e.healedCheckpoints ?? (e.healedCheckpoints = []);
          if (!log.includes(wp.idx)) {
            const before = e.hp;
            e.hp = Math.min(e.maxHp, e.hp + e.maxHp * e.checkpointHealPct);
            if (e.hp > before) {
              log.push(wp.idx);
              e.hpFlashTimer = 0.35;
              const chq = (state as any).checkpointHealFxQueue = (state as any).checkpointHealFxQueue ?? [];
              chq.push({ x: e.x, y: e.y, bornTick: state.tick });
              if (chq.length > 24) chq.shift();
            }
          }
        }
      }
    }

    if (e.hp <= 0) {
      // PHOENIX REBIRTH (2026-05 v2): instead of reviving the original
      // enemy, spawn 3 reduced-HP minions of the same type at the death
      // tile. The original dies for real — onDeath fires below — so the
      // kill counts. Minions are flagged `hasRebirthed` so the chain
      // can't continue indefinitely.
      spawnPhoenixMinions(state, e, state.tick);
      onDeath(e);
      state.enemies.delete(e.id);
    }
  }
}
