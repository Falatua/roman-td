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
import { ENEMY_BALANCE, GRID, RENDER_LIMITS } from '../constants';
import { GameStateShape, isWaveModifierActive } from '../GameState';
import enemiesData from '../data/enemies.json';
import waypointsData from '../data/waypoints.json';
import wavesData from '../data/waves.json';
import { isHellfireImmune, statusEffectiveness } from './EnemyResistances';
import { buildGroundPathB } from './PathFinder';
import { campaignRelicEnemyHpMult, campaignRelicEnemySpeedMult } from './CampaignRelicSystem';
import { commanderSpeedMult, isCommanderType, tickCommanderSupport } from './CommanderSystem';
import { campaignPressureResistMult } from './CampaignDifficulty';

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

interface SleepCasterProfile {
  rangeTiles: number;
  cooldownSec: number;
  channelSec: number;
  travelTilesPerSec: number;
  durationSec: number;
  landOnly: boolean;
  dartFaction: 'celt' | 'undead' | 'naga';
}

function sleepCasterProfile(type: string): SleepCasterProfile | null {
  const def: any = (enemiesData as any)[type] ?? {};
  if (typeof def.sleepDartRangeTiles === 'number') {
    return {
      rangeTiles: def.sleepDartRangeTiles,
      cooldownSec: def.sleepDartCooldownSec ?? 5.0,
      channelSec: def.sleepDartChannelSec ?? 0.5,
      travelTilesPerSec: def.sleepDartTravelTilesPerSec ?? 5.0,
      durationSec: def.sleepDartDurationSec ?? 3.0,
      landOnly: !!def.sleepDartLandOnly,
      dartFaction: 'naga'
    };
  }
  if (type === 'GALLIC_DRUID' || type === 'ZOMBIE_DRUID') {
    return {
      rangeTiles: 3.0,
      cooldownSec: 5.0,
      channelSec: 0.5,
      travelTilesPerSec: 5.0,
      durationSec: 3.0,
      landOnly: false,
      dartFaction: type === 'ZOMBIE_DRUID' ? 'undead' : 'celt'
    };
  }
  return null;
}

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
  MONGOL_SCOUT: 'RUNNER', MONGOL_SHAMAN: 'ELITE', MONGOL_CAPTAIN: 'RESISTANT',
  STANDARD_BEARER_COMMANDER: 'ELITE',
  PATHFINDER_COMMANDER: 'RUNNER',
  ANUBIS_PRIEST_COMMANDER: 'ELITE',
  NAGA_ADEPT: 'ELITE',
  NAGA_SLEEPWEAVER: 'ELITE',
  NAGA_ORACLE: 'ELITE',
  SIEGE_CAPTAIN_COMMANDER: 'ARMORED',
  SKY_STANDARD_COMMANDER: 'ELITE',
  SKY_PATHFINDER_COMMANDER: 'RUNNER',
  SKY_ANUBIS_COMMANDER: 'ELITE',
  TIDECALLER_COMMANDER: 'ELITE',
  STORMTIDE_WYVERN_COMMANDER: 'ELITE',
  SEA_GIANT: 'BULKY',
  SEA_GIANT_WARBRINGER: 'BULKY',
  NETHER_AMPHIBIOUS_GIANT: 'RESISTANT',
  // 2026-06-26 variety roster
  SIEGE_WAGON: 'BULKY', SKY_BARGE: 'BULKY', DUNE_STALKER: 'RUNNER', STONE_JUGGERNAUT: 'ARMORED'
};

// 2026 v2 spec — TIMED tower attack-speed debuff (Dive Bomb / Ground Slam /
// Fire Breath / Shriek / Titan Stomp). CombatResolver MAX-combines this with
// the proximity aura debuff. Refresh keeps the stronger pct while active.
export function applyTowerAtkSpeedDebuff(t: any, pct: number, durationSec: number, tick: number): void {
  const active = tick < (t.__atkSpeedDebuffUntil ?? 0);
  t.__atkSpeedDebuffPct = active ? Math.max(t.__atkSpeedDebuffPct ?? 0, pct) : pct;
  t.__atkSpeedDebuffUntil = Math.max(active ? (t.__atkSpeedDebuffUntil ?? 0) : 0, tick + durationSec);
}

export function spawnEnemy(state: GameStateShape, type: EnemyType, hpMult: number, derived?: boolean, caveB?: boolean): Enemy {
  const def: any = (enemiesData as any)[type];
  if (!def) {
    // Defensive: if a wave references an unknown enemy type, fall back to
    // FERAL_DOG so the spawn never crashes the loop. Logged for the dev to fix.
    console.warn(`[Roman TD][EnemySystem] Unknown enemy type "${type}" — falling back to FERAL_DOG.`);
    return spawnEnemy(state, EnemyType.FERAL_DOG, hpMult);
  }
  const factionEnum = factionFromString(def.faction);
  const flyer: boolean = !!def.isFlyer;
  // 2026 v2 spec Ch7 — Cave B routes GROUND enemies down the second lane.
  const useCaveB = !!caveB && !flyer && state.groundPathB.length > 0;
  const path = useCaveB ? state.groundPathB : state.groundPath;
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
  // HERO HP COMPENSATION (2026-05-19): a run with an active hero gets an
  // effectively-free extra tower from the moment the draft completes,
  // and that hero grows into a ~30% map-wide damage multiplier by DIVUS.
  // Bump enemy HP +15% across the board (regular + boss) to offset the
  // free-tower contribution without crushing the curve. Gated on
  // `state.activeHeroId` so non-hero runs (sandbox tests, pre-hero
  // save migration) keep the original curve. Bosses get the same +15%
  // — Scipio's +25% vs-boss already nets them slightly harder against
  // his roster pick so a uniform bump is the right call.
  const heroComp = state.activeHeroId ? 1.15 : 1.00;
  const relicHpMult = campaignRelicEnemyHpMult(state, def);
  const flyerHpMult = flyer ? ENEMY_BALANCE.FLYER_HEALTH_MULT : 1.0;
  const finalHp = def.baseHp * hpMult * moonBoost * basicHpBuff * heroComp * relicHpMult * flyerHpMult;
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
  if (isCommanderType(type as any)) {
    (e as any).isCommander = true;
    (e as any).__commanderSpawnWave = state.wave;
  }
  // ─── ELITE MUTATIONS ────────────────────────────────────────────────
  // Late-wave spawns roll a small chance to be "elites" — single-modifier
  // champions with a tactical wrinkle. Bosses are exempt.
  // 2026-05-17 — `skipMutation` flag exempts surprise-event spawns
  // (HELL_GATE, FIRE_GIANT) so the player gets exactly the threat the
  // event was designed around, not a random +50% HP veteran gate.
  // 2026-05-18 v2 — ENDLESS-MODE ONLY. The 20-wave campaign is fully
  // deterministic (no RNG per the design rule). Elite mutations only
  // roll in Endless. Roll rate ramps with endlessWave: 4% at endless
  // start (W21+), 12% at W30, 20% at W50.
  if (!e.isBoss && !def.skipMutation && state.endlessMode) {
    const ew = state.endlessWave ?? 1;
    const eliteChance = Math.min(0.20, 0.04 + ew * 0.005);
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
  // through W30. Multiplies into every damage-type mult AND DoT
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
    if (w >= 16) mult -= 0.04;  // W16 is now a bridge wave, not a cliff
    if (w >= 18) mult -= 0.04;  // W18+ restores the full late-campaign bite
    if (w >= 21) mult -= 0.07;  // W21+ second-cave era
    if (w >= 25) mult -= 0.06;  // W25+ mythic finale
    if (e.isBoss) mult -= (w >= 21 ? 0.15 : 0.10); // bosses always tougher than ground
    mult = Math.max(w >= 25 ? 0.34 : w >= 21 ? 0.38 : 0.45, mult);
    (e as any).__lateResistMult = mult;
  }
  // Smooth post-W5 campaign pressure. The existing stamps above create
  // authored difficulty breakpoints; this adds a small linear layer so W6+
  // health/resistance pressure rises every wave instead of only at milestones.
  if (!derived && (state.wave ?? 1) > 5) {
    const pressure = campaignPressureResistMult(state.wave ?? 1, e.isFlyer);
    (e as any).__lateResistMult = ((e as any).__lateResistMult ?? 1) * pressure;
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
  // W16-W30 campaign pressure kit. Primary spawns gain varied march speeds
  // plus mechanics that force tactical answers beyond raw DPS: late elites
  // heal at checkpoints, shielded cohorts punish ranged-only mazes, and
  // bosses resist status while regenerating if the player lets pressure drop.
  if (!derived && (state.wave ?? 1) >= 16) {
    const w = state.wave ?? 1;
    const band = w >= 25 ? 3 : w >= 21 ? 2 : w >= 18 ? 1 : 0;
    const variance = (w < 18 ? [0.96, 1.00, 1.06, 1.10] : [0.94, 1.00, 1.10, 1.18])[state.enemies.size % 4];
    const classSpeed = e.isBoss ? (1 + 0.04 * band) : e.isFlyer ? (1 + 0.03 * band) : (1 + 0.05 * band);
    e.baseSpeed *= classSpeed * variance;
    e.currentSpeed = e.baseSpeed;

    if (!e.isFlyer && !e.isBoss) {
      (e as any).outOfCombatRegen = Math.max((e as any).outOfCombatRegen ?? def.outOfCombatRegen ?? 0, 0.025 + 0.01 * band);
      if (w >= 21 && (e.livesCost >= 2 || (def as any).isElite || ARCHETYPE[type] === 'ARMORED' || ARCHETYPE[type] === 'BULKY')) {
        e.checkpointHealPct = Math.max(e.checkpointHealPct ?? 0, 0.10 + 0.02 * band);
      }
      if (w >= 21) (e as any).__lateRangedBlock = Math.max((e as any).__lateRangedBlock ?? 0, 0.08 + 0.04 * band);
      if (w >= 25) (e as any).__lateStatusGuard = Math.min((e as any).__lateStatusGuard ?? 1, 0.35);
    }

    if (e.isFlyer && w >= 21) {
      (e as any).__lateStatusGuard = Math.min((e as any).__lateStatusGuard ?? 1, 0.55);
    }

    if (e.isBoss) {
      (e as any).outOfCombatRegen = Math.max((e as any).outOfCombatRegen ?? def.outOfCombatRegen ?? 0, 0.025 + 0.01 * band);
      (e as any).__lateStatusGuard = Math.min((e as any).__lateStatusGuard ?? 1, w >= 25 ? 0.20 : 0.35);
      if (w >= 25) e.checkpointHealPct = Math.max(e.checkpointHealPct ?? 0, 0.10);
    }
  }
  // 2026-05-23 — W8 RANGED-BLOCK STAMP. Per user request: "Give enemies
  // on wave eight a 20% chance to block all ranged attacks." Every enemy
  // spawned during W8 (including derived/reanimated children) carries a
  // 20% per-hit block roll against PHYS_RANGED + SIEGE damage. Stacks
  // multiplicatively with the existing per-enemy `dodgeChance` and
  // `shieldBlockChance` paths in CombatResolver. Numidian Rider with
  // 0.15 dodge + 0.20 W8 block → ~32% effective ranged whiff rate.
  if ((state.wave ?? 1) === 8) {
    (e as any).__w8RangedBlock = 0.20;
    // 2026-05-29 — W8 OUT-OF-COMBAT REGEN CUT. Per user request: "decrease
    // the out-of-combat health regen on Wave 8 by 1.5%." Subtractive 1.5
    // percentage points off whatever OOC regen the enemy already has,
    // floored at 0 (read in tickEnemies). Only the Carthage Elite Guard
    // carries OOC regen on W8 (4.9%/s → 3.4%/s); the Spearman + Numidian
    // Rider have none, so the floor leaves them untouched (no regen is
    // granted to enemies that never had it). Wave-scoped on purpose: the
    // Elite Guard also spawns on W9 and in Endless, where it keeps the
    // full 4.9%/s — editing the per-enemy def would bleed the cut into
    // both, so we stamp at spawn exactly like __w8RangedBlock above.
    (e as any).__w8OocRegenCut = 0.015;
  }
  // 2026-05-25 — W7 MELEE-RESIST STAMP. Per user request: "give enemies
  // on wave 7 slightly more melee resistance - 10%." Every enemy spawned
  // during W7 takes 10% less PHYS_MELEE damage (effectiveness × 0.90).
  // Wave-scoped on purpose: the W7 roster (Carthage Spearman, Numidian
  // Rider) also shows up on W8-W9, so editing their per-enemy RESIST
  // profile would bleed the buff into later waves. Stamping at spawn
  // keeps it strictly W7. Read in EnemyResistances.enemyDamageMultiplier,
  // multiplies on top of the per-enemy melee resist (Spearman 0.75 →
  // 0.675) AND the __lateResistMult stamp, so all three stack cleanly.
  if ((state.wave ?? 1) === 7) {
    (e as any).__w7MeleeResist = 0.90;
  }
  // 2026-05-22 — ENDLESS MODE BUFFS. Per user request: triple HP,
  // crazy resistances, crazy regen, full DoT immunity.
  //
  //   • HP × 2.0 on top of the EndlessMode hpMult formula (which
  //     already triples by E5). Stamp the multiplier on maxHp + hp
  //     directly here so it applies uniformly to every endless spawn
  //     including boss honor-guards.
  //   • __dotImmune flag — tickEnemies zeroes the DoT contribution
  //     before the aggregate cap, so DoT becomes COSMETIC. Direct
  //     damage is unaffected.
  //   • OOC regen bumped to 4%/sec (was 3% on W11+, was per-enemy
  //     def on others). Multiplied with the existing oocRegen so
  //     bosses still scale higher.
  //   • __lateResistMult set lower (= more reduction) — endless
  //     enemies take 35 % LESS direct damage on top of the existing
  //     resist scale. Stacks with wave-level enemyDamageReductPct.
  if (!derived && state.endlessMode) {
    const ENDLESS_HP_BONUS = 2.0;     // doubles maxHp on top of EndlessMode formula (≈ 3× total at low E)
    e.maxHp *= ENDLESS_HP_BONUS;
    e.hp *= ENDLESS_HP_BONUS;
    (e as any).__dotImmune = true;
    (e as any).outOfCombatRegen = Math.max((e as any).outOfCombatRegen ?? 0, 0.04);
    const existingResist: number = (e as any).__lateResistMult ?? 1.0;
    (e as any).__lateResistMult = existingResist * 0.65;     // multiplies again — 35 % more reduction
  }
  // 2026 v2 spec Ch10-13 — elite flag drives the universal #E87020 glow;
  // bigGlow = the larger Typhon / Super-Giant aura (read by RenderEngine).
  if ((def as any).isElite) (e as any).isElite = true;
  if ((def as any).bigGlow) { (e as any).__bigGlow = true; (e as any).__glowScale = 1.4; }
  if ((def as any).renderScale) (e as any).__renderScale = (def as any).renderScale;
  if (useCaveB) (e as any).__caveB = true;
  state.enemies.set(e.id, e);
  // Trigger spawn-emergence puff at spawn pixel (Animation Doc §22.1)
  const renderer = (globalThis as any).__renderer;
  if (renderer?.triggerSpawnPuff) renderer.triggerSpawnPuff(startX, startY, state.tick);
  return e;
}

function groundPathPixels(state: GameStateShape, caveB = false): { x: number; y: number }[] {
  const tiles = caveB ? state.groundPathB : state.groundPath;
  return tiles.map(t => ({ x: t.col * GRID.TILE + GRID.TILE / 2, y: t.row * GRID.TILE + GRID.TILE / 2 }));
}

function anchorDeathBurstChildOnPath(state: GameStateShape, parent: Enemy, child: Enemy, minRunwayTiles = 8): { x: number; y: number } {
  if (!!(parent as any).__caveB) {
    const gpB = buildGroundPathB(state);
    if (gpB) state.groundPathB = gpB;
  }
  const useCaveB = !!(parent as any).__caveB && state.groundPathB.length > 0;
  const path = groundPathPixels(state, useCaveB);
  if (useCaveB) (child as any).__caveB = true;
  if (path.length === 0) {
    child.pathIndex = Math.max(0, parent.pathIndex ?? 0);
    child.pathProgress = Math.max(0, Math.min(0.99, parent.pathProgress ?? 0));
    return { x: parent.x, y: parent.y };
  }

  const inheritedIndex = Math.max(0, Math.min(parent.pathIndex ?? 0, path.length - 1));
  const inheritedProgress = Math.max(0, Math.min(0.99, parent.pathProgress ?? 0));
  const maxSafeIndex = Math.max(0, path.length - 1 - minRunwayTiles);
  const tooCloseToGate = inheritedIndex > maxSafeIndex || (inheritedIndex === maxSafeIndex && inheritedProgress > 0.65);
  child.pathIndex = tooCloseToGate ? maxSafeIndex : inheritedIndex;
  child.pathProgress = tooCloseToGate ? 0 : inheritedProgress;

  const a = path[child.pathIndex] ?? path[0] ?? { x: parent.x, y: parent.y };
  const b = path[Math.min(child.pathIndex + 1, path.length - 1)] ?? a;
  const t = child.pathProgress;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t
  };
}

function anchorFlyerCargoBurstOnGroundPath(state: GameStateShape, parent: Enemy, child: Enemy): { x: number; y: number } {
  const path = groundPathPixels(state);
  if (path.length < 2 || state.flyerPath.length < 2) {
    child.pathIndex = Math.max(0, parent.pathIndex ?? 0);
    child.pathProgress = Math.max(0, Math.min(0.99, parent.pathProgress ?? 0));
    return { x: parent.x, y: parent.y };
  }
  const flyerTotal = Math.max(1, state.flyerPath.length - 1);
  const flyerPos = Math.max(0, Math.min(flyerTotal - 0.001, (parent.pathIndex ?? 0) + (parent.pathProgress ?? 0)));
  const routeRatio = flyerPos / flyerTotal;
  const groundTotal = Math.max(1, path.length - 1);
  const groundPos = Math.max(0, Math.min(groundTotal - 0.001, routeRatio * groundTotal));
  child.pathIndex = Math.max(0, Math.min(path.length - 2, Math.floor(groundPos)));
  child.pathProgress = Math.max(0, Math.min(0.99, groundPos - child.pathIndex));
  const a = path[child.pathIndex] ?? path[0] ?? { x: parent.x, y: parent.y };
  const b = path[Math.min(child.pathIndex + 1, path.length - 1)] ?? a;
  return {
    x: a.x + (b.x - a.x) * child.pathProgress,
    y: a.y + (b.y - a.y) * child.pathProgress
  };
}

export function triggerEnemyDeathBurst(state: GameStateShape, e: Enemy): number {
  const deathBurst = (enemiesData as any)[e.type]?.deathBurst;
  const burstTypes = deathBurst
    ? (Array.isArray(deathBurst.types) ? deathBurst.types : deathBurst.type ? [deathBurst.type] : [])
    : [];
  if (!deathBurst || burstTypes.length === 0 || (deathBurst.count | 0) <= 0) return 0;
  if (e.__reanimated || (e as any).__deathBurstTriggered) return 0;

  (e as any).__deathBurstTriggered = true;
  const bCount = Math.min(60, deathBurst.count | 0);
  const bHpFrac = typeof deathBurst.hpFrac === 'number' ? deathBurst.hpFrac : 0.5;
  const isAirDrop = !!deathBurst.groundFromFlyer && e.isFlyer;
  for (let i = 0; i < bCount; i++) {
    const childType = burstTypes[i % burstTypes.length] as EnemyType;
    const child = spawnEnemy(state, childType, bHpFrac, /*derived=*/true);
    const anchor = isAirDrop ? anchorFlyerCargoBurstOnGroundPath(state, e, child) : anchorDeathBurstChildOnPath(state, e, child);
    const ang = (i / bCount) * Math.PI * 2 + Math.random() * 0.5;
    const dist = i === 0 ? 0 : (isAirDrop ? 4 + Math.random() * 10 : 6 + Math.random() * 14);
    child.x = anchor.x + Math.cos(ang) * dist;
    child.y = anchor.y + Math.sin(ang) * dist;
    child.prevX = child.x;
    child.prevY = child.y;
    child.__reanimated = true;
    if ((deathBurst as any).oceanSpawn || (e as any).__oceanSpawn) (child as any).__oceanSpawn = true;
    child.risingUntil = state.tick + 0.2 + Math.min(0.45, i * 0.015);
  }
  state.hint = typeof deathBurst.message === 'string'
    ? deathBurst.message.replace('{count}', String(bCount))
    : isAirDrop
      ? `SKY BARGE DOWN - ${bCount} melee passengers crash onto the road!`
      : `THE SIEGE WAGON SHATTERS - ${bCount} skirmishers pour out!`;
  return bCount;
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
    case 'ROMAN_MYTH': return EnemyFaction.ROMAN_MYTH;
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
    // BURNING GROUND is the SOLE DoT from fire towers (the redundant BURN
    // status was removed from the fire tower signatures). One clean DoT.
    //
    // 2026-05-19 — Per-tier base rate trimmed 5% → 4% (Vulcan Engineer
    // nerf pass). Scaling kept identical so the curve still rewards tier
    // progression, just at slightly lower absolute output.
    //   Per-tier tick rates: T1 4.0% · T2 4.6% · T3 5.2% · T4 5.8% · T5 7.0%
    //
    // Boss DoT reduction (×0.18) applies to burning ground.
    //
    // 2026-05-20 — FIRE-DAMAGE CATEGORIZATION. The burning-ground tick
    // is FIRE damage by nature (Ignifer / Inferno Cart / Colossus
    // Onager / Vulcan Engineer all carry damageType=ELEMENTAL_FIRE
    // and stamp these patches via burnsGround). Previously the tick
    // ran flat true-damage and bypassed every fire interaction —
    // Fire Giants and Daemon Imperator (both immuneFire=true) took
    // the same DoT as a regular grunt. That broke the "fire-immune
    // enemy" contract. Now we honor:
    //   • def.immuneFire === true → 0 damage
    //   • burn-resist multiplier (statusEffectiveness BURN) → scales
    //     the tick (Demon Hellhound burn:0 → 0; Celtic Berserker
    //     burn:0.85 → 85% effective)
    // Direct BURN status ticks (Draconarius proximity, etc.) already
    // ran through statusEffectiveness — burning ground is now
    // consistent with that path.
    const def: any = (enemiesData as any)[e.type];
    if (def?.immuneFire) continue;
    const burnMult = statusEffectiveness(e, StatusEffectKind.BURN);
    if (burnMult <= 0) continue;
    const bossMod = e.isBoss ? 0.18 : 1.0;
    const dps = e.maxHp * 0.04 * (1 + (bestTier - 1) * 0.15) * bossMod * burnMult;
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
  // 2026-05-20 — Endless stacks modifiers; honor the full active set
  // via isWaveModifierActive instead of reading only the primary slot.
  // VEIL + STORM_SURGE can now both fire on the same wave if late
  // Endless rolls them together.
  if (isWaveModifierActive(state, 'VEIL')) {
    const cyclePos = (state.tick % 6.0);
    const veiled = cyclePos < 0.8;
    for (const e of state.enemies.values()) (e as any).__veiled = veiled;
  }
  if (isWaveModifierActive(state, 'STORM_SURGE')) {
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
    if ((e as any).__testYourMightNoStealth) { (e as any).__veiled = false; continue; }
    const stealth = (enemiesData as any)[e.type]?.stealthInterval;
    if (!stealth) continue;
    const period = stealth.period ?? 8;
    const duration = stealth.duration ?? 1.2;
    const offset = ((e as any).__stealthOffset ??= (parseInt(e.id.slice(-2) || '0', 16) % 100) / 100 * period);
    const cyclePos = (state.tick + offset) % period;
    (e as any).__veiled = cyclePos < duration;
  }
  // ─── AMBUSH STEALTH (2026-05-21, bug-fixed 2026-05-22 V22): selected
  //   ground enemies (Carthage Spearman, Undead Berserker) emerge from
  //   cover during the opening seconds of their wave — untargetable
  //   until wave-elapsed-time crosses `ambushStealthSec` (default 10s).
  //   After that window all instances become targetable simultaneously.
  //
  //   V22 BUG FIX: previous code only set `__veiled = true` during the
  //   window and never cleared it after. For ambush enemies without a
  //   stealthInterval cycle (Carthage Spearman) the flag was stuck on
  //   forever — players reported they could not hit these enemies even
  //   after the timer expired. Fix: explicitly assign true/false based
  //   on the window so the veil clears the instant the timer ends.
  //
  //   Order: AMBUSH runs AFTER the VEIL-of-Proscripti modifier and the
  //   per-enemy stealthInterval cycle. By writing last, ambush is the
  //   authoritative source for these specific enemies — modifier/cycle
  //   stealth doesn't currently coincide with W7/W13/W15 ambush waves.
  //
  //   `state.__waveStartTick` is stamped by main.ts at each wave start.
  const waveStart = (state as any).__waveStartTick ?? state.tick;
  const waveElapsed = state.tick - waveStart;
  for (const e of state.enemies.values()) {
    if ((e as any).__testYourMightNoStealth) { (e as any).__veiled = false; continue; }
    const def = (enemiesData as any)[e.type];
    if (!def?.ambushStealth) continue;
    const ambushSec = def.ambushStealthSec ?? 10;
    (e as any).__veiled = waveElapsed < ambushSec;
  }
  // ─── WAVE-LEVEL FLYER INITIAL STEALTH (2026-05-22): some waves
  //   stamp `flyerInitialStealthSec` in waves.json. While
  //   waveElapsed < that value, every FLYER on the field is
  //   untargetable (reuses the __veiled flag). After the window
  //   the veil clears wave-wide. Currently used by W18 (Ghost Rider
  //   flyer-only wave — first 15 s give the player a tense "they
  //   are HERE but invisible" beat before the cloud reveals).
  const _waveDefForFlyerStealth: any = (wavesData as any[])[(state.wave ?? 1) - 1];
  const flyerStealthSec = _waveDefForFlyerStealth?.flyerInitialStealthSec ?? 0;
  if (flyerStealthSec > 0) {
    const veil = waveElapsed < flyerStealthSec;
    for (const e of state.enemies.values()) {
      if (!e.isFlyer) continue;
      if ((e as any).__testYourMightNoStealth) { (e as any).__veiled = false; continue; }
      (e as any).__veiled = veil;
    }
  }
  // ─── HEALER ENEMIES (2026-05): enemies with healAllyPctPerSec emit a
  //   gentle 1.5-tile heal ring that restores HP to nearby living allies
  //   (NOT themselves). Doesn't heal bosses to avoid trivializing them.
  //
  //   2026-05-22 NON-STACKING. Previously the heal was applied additively
  //   per nearby healer per target. With Zombie Druid clusters of 10-20
  //   on W11/W13/W14, each druid was healing each of the OTHER druids,
  //   so cumulative regen scaled at N × 1.8 % HP/sec — at N=10 that's
  //   16 % HP/sec, at N=20 it's 34 % HP/sec, faster than most tower
  //   builds can damage. Now we take the MAX pct among in-range
  //   healers instead of the sum, so a cluster of 20 druids still
  //   restores at the same 1.8 % HP/sec a single druid would. The
  //   pressure shifts back to focus-fire instead of damage-soak.
  const HEAL_RADIUS = GRID.TILE * 1.8;
  const healers: { src: Enemy; pct: number }[] = [];
  for (const e of state.enemies.values()) {
    const p = (enemiesData as any)[e.type]?.healAllyPctPerSec;
    if (p) healers.push({ src: e, pct: p });
  }
  if (healers.length > 0) {
    for (const target of state.enemies.values()) {
      if (target.isBoss) continue;       // never heal bosses
      let bestPct = 0;
      for (const h of healers) {
        if (h.src.id === target.id) continue;
        if (Math.hypot(h.src.x - target.x, h.src.y - target.y) <= HEAL_RADIUS) {
          if (h.pct > bestPct) bestPct = h.pct;
        }
      }
      if (bestPct > 0) {
        target.hp = Math.min(target.maxHp, target.hp + target.maxHp * bestPct * dt);
      }
    }
  }
  // ─── AURA-STAR mutation: nearby allies move +30% faster ─────────────────
  // Pre-compute a per-enemy buff factor based on whether any AURA_STAR enemy
  // is within 3 tiles. Applied to currentSpeed below.
  const auraStars: Enemy[] = [];
  for (const e of state.enemies.values()) if (e.mutation === 'AURA_STAR') auraStars.push(e);
  tickCommanderSupport(state, dt);
  // ─── ELEPHANT RANGED-PROTECTION AURA (2026-05 v10) ────────────────────
  // Living + Undead war elephants project a 4-tile dust shield that
  // makes nearby GROUND enemies untargetable by ranged towers until the
  // elephant dies. The elephant itself stays targetable (you have to be
  // able to kill it somehow). Flyers are never sheltered — they fly
  // above the dust.
  //
  // 2026-05-23 — Radius bumped 2 → 4 tiles per user feedback that the
  // shield felt too small to protect a real ground-army segment.
  // Doubled the radius so a single elephant can shelter the whole
  // marching column behind it instead of just adjacent neighbors.
  //
  // Clear all stamps at the top of frame, then re-stamp only the
  // protected enemies. Cheap O(elephants × nearby) — typically ≤ 5
  // elephants on screen and the loop bails fast on distance.
  const ELEPHANTS = new Set(['WAR_ELEPHANT','UNDEAD_WAR_ELEPHANT']);
  const ELEPHANT_AURA_RADIUS = GRID.TILE * 4.0;
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
  // ─── PRESENCE-SILENCE AURA (2026-05-21): selected enemies with
  //   silenceAuraRadiusTiles set on their data continuously silence
  //   towers inside that radius. Mid-game: Zombie Druid (1.5 tiles,
  //   extends its existing debuff identity). End-game: Architectus
  //   (1.5 tiles, gives the Carthage engineer real "sabotage"
  //   threat). Refreshes `t.silencedUntil` every frame the enemy is
  //   in range; the 0.6s stamp naturally expires one frame after the
  //   enemy walks out, so towers wake up as soon as the threat
  //   moves on. Distinct from the SILENCERS set below (Spectral Scout
  //   / Ghost Rider pass-by silence): that's a one-shot pulse on
  //   passing within 1.0 tile, this is sustained while in range.
  for (const e of state.enemies.values()) {
    const radiusTiles = (enemiesData as any)[e.type]?.silenceAuraRadiusTiles;
    if (!radiusTiles) continue;
    const radiusPx = GRID.TILE * radiusTiles;
    const radiusPxSq = radiusPx * radiusPx;
    for (const t of state.towers.values()) {
      if (t.pending) continue;
      const cx = t.tileX * GRID.TILE + GRID.TILE / 2;
      const cy = t.tileY * GRID.TILE + GRID.TILE / 2;
      const dx = cx - e.x, dy = cy - e.y;
      if (dx * dx + dy * dy <= radiusPxSq) {
        // 0.6s stamp matches the Spectral Scout / Ghost Rider pass-
        // silence cadence, so existing render code (pink X-mark)
        // works without changes. Each frame in range refreshes the
        // stamp so the silence persists while the enemy hovers. One
        // frame after the enemy leaves the radius, the stamp expires
        // naturally and the tower fires again.
        const until = t.silencedUntil ?? 0;
        if (state.tick > until - 0.4) {
          t.silencedUntil = state.tick + 0.6;
          if (t.attackCooldown < 0.6) t.attackCooldown = 0.6;
        }
      }
    }
  }
  // ─── NULLIFYING AURA (2026-06-25): selected late-game (post-W15) enemies,
  //   minions, commanders, and bosses carry a constant 2-tile aura that
  //   temporarily DISABLES any tower standing inside it. Reuses the silence
  //   stamp (tower cooldown pinned + silencedUntil → X-mark) refreshed every
  //   frame the tower is in range, so a tower wakes the instant the carrier
  //   leaves its radius. A live violet ring is drawn around each carrier via
  //   __nullifyAuraSources. Wider + visually distinct from the 1.5-tile
  //   presence-silence above.
  const nullSources: { x: number; y: number; r: number }[] = [];
  for (const e of state.enemies.values()) {
    const radiusTiles = (enemiesData as any)[e.type]?.nullifyAuraRadiusTiles;
    if (!radiusTiles) continue;
    const radiusPx = GRID.TILE * radiusTiles;
    nullSources.push({ x: e.x, y: e.y, r: radiusPx });
    const radiusPxSq = radiusPx * radiusPx;
    for (const t of state.towers.values()) {
      if (t.pending) continue;
      const cx = t.tileX * GRID.TILE + GRID.TILE / 2;
      const cy = t.tileY * GRID.TILE + GRID.TILE / 2;
      const dx = cx - e.x, dy = cy - e.y;
      if (dx * dx + dy * dy <= radiusPxSq) {
        const until = t.silencedUntil ?? 0;
        if (state.tick > until - 0.4) {
          t.silencedUntil = state.tick + 0.5;
          if (t.attackCooldown < 0.5) t.attackCooldown = 0.5;
        }
      }
    }
  }
  (state as any).__nullifyAuraSources = nullSources;
  // ─── TOWER SILENCE: Spectral Scout / Ghost Rider passing within 1.0 tile
  // of a tower forces the tower into a 0.6s cooldown spike. They literally
  // walk past and disrupt the legion's rhythm.
  const SILENCERS = new Set(['SPECTRAL_SCOUT','GHOST_RIDER']);
  for (const e of state.enemies.values()) {
    if (!SILENCERS.has(e.type)) continue;
    for (const t of state.towers.values()) {
      if (t.pending) continue;
      const cx = t.tileX * GRID.TILE + GRID.TILE / 2;
      const cy = t.tileY * GRID.TILE + GRID.TILE / 2;
      // 2026-05-17 — Silence radius tightened 1.2 → 1.0 tile per
      // user direction. Spectral Scout / Ghost Rider now have to pass
      // directly adjacent to a tower (within 1 tile) to silence it,
      // instead of the previous wider 1.2-tile aura that could clip
      // off-path towers.
      if (Math.hypot(cx - e.x, cy - e.y) <= GRID.TILE * 1.0) {
        const until = t.silencedUntil ?? 0;
        if (state.tick > until - 0.2) {
          t.silencedUntil = state.tick + 0.6;
          t.attackCooldown = Math.max(t.attackCooldown, 0.6);
        }
      }
    }
  }
  // ─── SLEEP CASTERS (Druids + Naga): sleep casters channel a visible orb
  // at the nearest awake tower. Naga profiles are data-driven and target
  // only land towers; water/ocean towers are immune to their sleep magic.
  for (const e of state.enemies.values()) {
    const sleepProfile = sleepCasterProfile(e.type);
    if (!sleepProfile) continue;
    if (e.hp <= 0) continue;
    // STUNNED / FROZEN sleep casters can't cast. Reuse standard status checks.
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
    const castRadius = GRID.TILE * sleepProfile.rangeTiles;
    for (const t of state.towers.values()) {
      if (t.pending) continue;
      if ((t.asleepUntil ?? 0) > state.tick) continue;     // already asleep
      if (sleepProfile.landOnly && (t as any).placedOnWater) continue;
      const cx = t.tileX * GRID.TILE + GRID.TILE / 2;
      const cy = t.tileY * GRID.TILE + GRID.TILE / 2;
      const d = Math.hypot(cx - e.x, cy - e.y);
      if (d > castRadius) continue;
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
    if (state.tick - channelStart < sleepProfile.channelSec) continue;
    // Channel complete — spawn the dart.
    const tx = bestT.tileX * GRID.TILE + GRID.TILE / 2;
    const ty = bestT.tileY * GRID.TILE + GRID.TILE / 2;
    const dx = tx - e.x;
    const dy = ty - e.y;
    const dist = Math.max(1, Math.hypot(dx, dy));
    // 2026-05-20 — dart speed bumped 2.2 → 5.0 tiles/sec per player
    // feedback that the slow projectile felt frustrating (the dart
    // crawled across the screen even after the 0.5s channel ended).
    // The 0.5s channel + the druid's currentSpeed=0 root during it
    // remain the player's reaction window — the dart itself no
    // longer adds dead time on top. 3-tile max cast range now
    // resolves in ~0.6s of dart flight instead of ~1.4s.
    const speed = GRID.TILE * sleepProfile.travelTilesPerSec;
    const darts = (state as any).__druidSleepDarts ?? ((state as any).__druidSleepDarts = []);
    darts.push({
      x: e.x,
      y: e.y - 6,
      vx: (dx / dist) * speed,
      vy: (dy / dist) * speed,
      targetTowerId: bestT.id,
      bornTick: state.tick,
      ttl: Math.max(1.2, sleepProfile.rangeTiles / Math.max(1, sleepProfile.travelTilesPerSec) + 1.0),
      faction: sleepProfile.dartFaction,
      sleepDurationSec: sleepProfile.durationSec,
      landOnly: sleepProfile.landOnly
    });
    (e as any).__nextSleepCastTick = state.tick + sleepProfile.cooldownSec;
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
          const sleepDuration = typeof d.sleepDurationSec === 'number' ? d.sleepDurationSec : 3.0;
          tw.asleepUntil = state.tick + sleepDuration;
          tw.attackCooldown = Math.max(tw.attackCooldown, sleepDuration);
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
  // 2026-05-22 V38 — Performance: hoist the ground-path pixel
  // conversion to ONCE per frame, not once per enemy. The previous
  // code rebuilt this array inside the per-enemy movement loop at
  // line ~1089, which at W15+ (100-200 enemies on screen during
  // necromancy waves + Gates of Hell + Hellscape) was eating
  // 6000-12000 array allocations per second, each holding 20-40
  // tiny objects. The pixel conversion only depends on
  // state.groundPath (which mutates only when a tower/stone is
  // placed or removed — rare event), so caching it across enemies
  // in the same tick is always correct.
  const groundPathPx: { x: number; y: number }[] = [];
  for (const t of state.groundPath) {
    groundPathPx.push({ x: t.col * GRID.TILE + GRID.TILE / 2, y: t.row * GRID.TILE + GRID.TILE / 2 });
  }
  // 2026 v2 spec Ch7 — Cave B lane, cached the same way. buildGroundPathB is
  // sticky so this only does real A* work when a tower/stone alters the lane.
  const gpB = buildGroundPathB(state);
  if (gpB) state.groundPathB = gpB;
  const groundPathBPx: { x: number; y: number }[] = [];
  for (const t of state.groundPathB) {
    groundPathBPx.push({ x: t.col * GRID.TILE + GRID.TILE / 2, y: t.row * GRID.TILE + GRID.TILE / 2 });
  }
  const anchorDeathChildOnPath = (parent: Enemy, child: Enemy, minRunwayTiles = 8) => {
    const useCaveB = !!(parent as any).__caveB && groundPathBPx.length > 0;
    const path = useCaveB ? groundPathBPx : groundPathPx;
    if (useCaveB) (child as any).__caveB = true;
    if (path.length === 0) {
      child.pathIndex = Math.max(0, parent.pathIndex ?? 0);
      child.pathProgress = Math.max(0, Math.min(0.99, parent.pathProgress ?? 0));
      return { x: parent.x, y: parent.y };
    }

    const inheritedIndex = Math.max(0, Math.min(parent.pathIndex ?? 0, path.length - 1));
    const inheritedProgress = Math.max(0, Math.min(0.99, parent.pathProgress ?? 0));
    const maxSafeIndex = Math.max(0, path.length - 1 - minRunwayTiles);
    const tooCloseToGate = inheritedIndex > maxSafeIndex || (inheritedIndex === maxSafeIndex && inheritedProgress > 0.65);
    child.pathIndex = tooCloseToGate ? maxSafeIndex : inheritedIndex;
    child.pathProgress = tooCloseToGate ? 0 : inheritedProgress;

    const a = path[child.pathIndex] ?? path[0] ?? { x: parent.x, y: parent.y };
    const b = path[Math.min(child.pathIndex + 1, path.length - 1)] ?? a;
    const t = child.pathProgress;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t
    };
  };
  const anchorFlyerCargoOnGroundPath = (parent: Enemy, child: Enemy) => {
    if (groundPathPx.length < 2 || state.flyerPath.length < 2) {
      child.pathIndex = Math.max(0, parent.pathIndex ?? 0);
      child.pathProgress = Math.max(0, Math.min(0.99, parent.pathProgress ?? 0));
      return { x: parent.x, y: parent.y };
    }
    const flyerTotal = Math.max(1, state.flyerPath.length - 1);
    const flyerPos = Math.max(0, Math.min(flyerTotal - 0.001, (parent.pathIndex ?? 0) + (parent.pathProgress ?? 0)));
    const routeRatio = flyerPos / flyerTotal;
    const groundTotal = Math.max(1, groundPathPx.length - 1);
    const groundPos = Math.max(0, Math.min(groundTotal - 0.001, routeRatio * groundTotal));
    child.pathIndex = Math.max(0, Math.min(groundPathPx.length - 2, Math.floor(groundPos)));
    child.pathProgress = Math.max(0, Math.min(0.99, groundPos - child.pathIndex));
    const a = groundPathPx[child.pathIndex] ?? groundPathPx[0] ?? { x: parent.x, y: parent.y };
    const b = groundPathPx[Math.min(child.pathIndex + 1, groundPathPx.length - 1)] ?? a;
    return {
      x: a.x + (b.x - a.x) * child.pathProgress,
      y: a.y + (b.y - a.y) * child.pathProgress
    };
  };
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
      // 2026-05-22 V30 — POST-W6 FLYER → GROUND CONVERSION (V30b refined).
      // When a flyer dies on a PURE-FLYER WAVE (W12 Spectral Scout, W18
      // Ghost Rider in campaign; any type:'F' wave in endless), the
      // corpse drops and spawns a SINGLE thematic ground unit that now
      // walks the ACTUAL MAZE the player has built — same A*-routed
      // ground path everyone else uses, including the player's stones.
      //
      // V30b — pure-flyer-only gate: the previous V30 also fired on
      // hybrid waves (W7, W8, W13, W14, W17, W19), which doubled up the
      // ground threat on waves that already had ground units. User
      // feedback: "only flyer-specific waves, not hybrid waves."
      // Now gated on currentWave.type === 'F'.
      //
      // Mapping (per enemies.json `groundConvertAs`):
      //   CELTIC_SCOUT        → CELTIC_FOOTMAN   (W6 pre-gate, endless)
      //   NUMIDIAN_RIDER      → CARTHAGE_SPEARMAN  (endless only — hybrid in campaign)
      //   SPECTRAL_SCOUT      → UNDEAD_CELT      (W12 ✓ pure flyer)
      //   GHOST_RIDER         → UNDEAD_SPEARMAN  (W18 ✓ pure flyer)
      //   SHADOW_CAVALRY      → DEMON_HELLHOUND  (endless only — hybrid in campaign)
      //   SPHINX              → EGYPTIAN_SPEARMAN  (endless)
      //   MONGOL_HORSE_ARCHER → MONGOL_FOOTMAN   (endless)
      //   MONGOL_SPEAR_RIDER  → MONGOL_SPEARMAN  (endless)
      //
      // Uses the SAME __reanimated guard as the necromancy block so a
      // converted ground unit can't chain-convert / chain-reanimate.
      const _waveForFlyerConvert: any = wavesData[(state.wave ?? 1) - 1];
      const isPureFlyerWave = !!(_waveForFlyerConvert && _waveForFlyerConvert.type === 'F');
      const groundConvertAs = (enemiesData as any)[e.type]?.groundConvertAs;
      if (e.isFlyer && (state.wave ?? 0) > 6 && isPureFlyerWave && groundConvertAs && !e.__reanimated) {
        const ground = spawnEnemy(state, groundConvertAs as EnemyType, 1.0, /*derived=*/true);
        // Project the flyer's death (x, y) onto the current ground
        // path so the convert lands ON the maze, not in mid-air over
        // it. This is the same projection math PathFinder.resnapEnemies
        // uses, inlined to avoid the import. Result: pick the nearest
        // ground-path segment to where the flyer fell, snap position
        // AND path-index there, then let standard ground movement
        // carry the unit along the player's maze toward the gate.
        let snapX = e.x;
        let snapY = e.y;
        let snapI = 0;
        let snapProg = 0;
        const gp = state.groundPath;
        if (gp && gp.length >= 2) {
          let bestD2 = Infinity;
          for (let i = 0; i < gp.length - 1; i++) {
            const ax = gp[i].col * GRID.TILE + GRID.TILE / 2;
            const ay = gp[i].row * GRID.TILE + GRID.TILE / 2;
            const bx = gp[i + 1].col * GRID.TILE + GRID.TILE / 2;
            const by = gp[i + 1].row * GRID.TILE + GRID.TILE / 2;
            const dx = bx - ax, dy = by - ay;
            const segLen2 = dx * dx + dy * dy;
            if (segLen2 < 1) continue;
            let t = ((e.x - ax) * dx + (e.y - ay) * dy) / segLen2;
            if (t < 0) t = 0; else if (t > 1) t = 1;
            const cx = ax + dx * t, cy = ay + dy * t;
            const d2 = (e.x - cx) * (e.x - cx) + (e.y - cy) * (e.y - cy);
            if (d2 < bestD2) { bestD2 = d2; snapI = i; snapProg = t; snapX = cx; snapY = cy; }
          }
        }
        // Snap position AND path-state to the same point so there's no
        // single-frame teleport when the movement loop kicks in next
        // tick. The visual jump from (flyer death) → (maze) is at most
        // a few tiles and reads as "the corpse falls onto the road."
        ground.x = snapX;
        ground.y = snapY;
        ground.prevX = snapX;
        ground.prevY = snapY;
        ground.pathIndex = snapI;
        ground.pathProgress = snapProg;
        ground.__reanimated = true;        // block further conversion/chain reanim
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
        // 2026-05-25 — W11 REANIMATION HP BUMP. Per user request:
        // enemies reanimated on wave 11 get +25% health. Wave-scoped to
        // W11 only — necromancy also fires on W13 and on every undead-
        // faction kill across the late game, but this bump is W11-
        // specific. Multiplies the risen HP fraction by 1.25 before it
        // flows into spawnEnemy's finalHp (def.baseHp × hpMult × …).
        const reanimHpBump = (state.wave ?? 0) === 11 ? 1.25 : 1.0;
        const rfq = (state as any).reanimationFxQueue = (state as any).reanimationFxQueue ?? [];
        for (let i = 0; i < count; i++) {
          // 2026-05 v6: risen HP fraction 70-90% → 85-100% so a reanim
          // is nearly the full unit, not a chip-damage filler.
          const hpFrac = (0.85 + Math.random() * 0.15) * reanimHpBump;
          const risen = spawnEnemy(state, reanimateAs as EnemyType, hpFrac, /*derived=*/true);
          const anchor = anchorDeathChildOnPath(e, risen, 8);
          // Cluster near death point with a small random offset so the
          // sprites don't all overlap to one pixel.
          const ang = (i / count) * Math.PI * 2 + Math.random() * 0.6;
          const dist = i === 0 ? 0 : (4 + Math.random() * 6);
          risen.x = anchor.x + Math.cos(ang) * dist;
          risen.y = anchor.y + Math.sin(ang) * dist;
          risen.prevX = risen.x;
          risen.prevY = risen.y;
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
      // ─── UNDEAD WARLORD DEATH RATTLE (2026-05-23) ─────────────────────
      // Per user request: "When an undead warlord dies, have them spawn
      // 20 more undead enemies at a fraction of the undead warlord's
      // health." Mix of UNDEAD_BERSERKER (heavier hitters) + UNDEAD_CELT
      // (chaff) so the final burst feels like a real necromantic last
      // gasp — not just 20 of the same grunt. Each spawn carries
      // `__reanimated = true` so the standard necromancy chain on death
      // (line 877 below) can't compound — otherwise a single warlord
      // death could cascade into 120+ risen units. Risen units inherit
      // the warlord's path position + cluster around the death point.
      //
      // HP fraction is intentionally low (0.30) so the swarm is a
      // pressure moment, not a wave-extending grind. Each minion is
      // ~30% of a normal UNDEAD_CELT/BERSERKER's max HP at the current
      // wave's hpMult.
      if (e.type === 'UNDEAD_WARLORD' && !e.__reanimated) {
        const rattleCount = 20;
        const hpFrac = 0.30;
        const currentWaveCfg: any = wavesData[state.wave - 1];
        const _hpMult: number = (currentWaveCfg?.hpMult ?? 1) * hpFrac;
        const rfq = (state as any).reanimationFxQueue = (state as any).reanimationFxQueue ?? [];
        for (let i = 0; i < rattleCount; i++) {
          // ~30% berserkers (6 of 20), ~70% celts (14 of 20). Berserker
          // is the threat-anchor type; celts swarm and fill the screen.
          const spawnType = (i < 6) ? EnemyType.UNDEAD_BERSERKER : EnemyType.UNDEAD_CELT;
          const risen = spawnEnemy(state, spawnType, _hpMult, /*derived=*/true);
          const anchor = anchorDeathChildOnPath(e, risen, 8);
          const ang = (i / rattleCount) * Math.PI * 2 + Math.random() * 0.4;
          const dist = i === 0 ? 0 : (5 + Math.random() * 9);
          risen.x = anchor.x + Math.cos(ang) * dist;
          risen.y = anchor.y + Math.sin(ang) * dist;
          risen.prevX = risen.x;
          risen.prevY = risen.y;
          risen.__reanimated = true;
          // 1.2s rising window — same VFX cue as the necromancy reanim
          // path below. Stagger by 60ms so the swarm emerges in a wave
          // rather than all at once.
          risen.risingUntil = state.tick + 1.2 + i * 0.06;
          rfq.push({
            x: risen.x, y: risen.y,
            bornTick: state.tick + i * 0.06,
            riseDuration: 1.2,
            spawnType
          });
          if (rfq.length > 32) rfq.shift();
        }
        state.hint = '💀 THE WARLORD\'S CURSE — 20 undead rise from the corpse!';
      }
      triggerEnemyDeathBurst(state, e);
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
      if (s.kind === StatusEffectKind.HELLFIRE && !isHellfireImmune(e)) { const v = e.maxHp * (s.magnitude || 0.01) * dotBossMod; dotDps += v; dotByKind.HELLFIRE += v; }
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
    let statusWrite = 0;
    for (let si = 0; si < e.statusEffects.length; si++) {
      const s = e.statusEffects[si];
      if (s.remaining > 0) e.statusEffects[statusWrite++] = s;
    }
    e.statusEffects.length = statusWrite;
    // 2026-05-21 — DoT AGGREGATE CAP. Sum of all DoT ticks on one enemy
    // is clamped to a fraction of maxHP/sec, with HELLFIRE carving out
    // a tighter sub-cap. Caps the "stack 4 DoT sources and melt
    // anything" pattern. Boss `dotBossMod = 0.18` is already folded
    // into dotByKind above — this caps the FINAL tick.
    //
    // 2026-05-22 — Caps halved. Player reported killing the W20 boss
    // in ~5 s on DoT alone, even after the prior 8% cap. New caps:
    //   AGGREGATE  8 % → 4 %  maxHP/sec
    //   HELLFIRE   2 % → 1 %  maxHP/sec
    // A 1 M HP boss now takes at MOST 40 000/sec from DoT (was
    // 80 000), so DoT alone takes ~25 s to chip through (was ~12 s).
    // Direct damage stays untouched.
    // 2026-05-22 — WAVE-LEVEL DOT RESIST. Wave defs with
    // `enemyDotResistPct` further reduce the post-aggregate DoT tick
    // by that fraction. Stacks multiplicatively with the 4 % aggregate
    // cap. Used by W13/W18/W19 to make DoT-stack builds less dominant
    // on specific late-game beats. Endless mode replaces this with
    // full DoT immunity (see __endlessDotImmune below).
    const _dotResistWave: any = (wavesData as any[])[(state.wave ?? 1) - 1];
    const dotResistPct = _dotResistWave?.enemyDotResistPct ?? 0;
    if (dotResistPct > 0 && dotDps > 0) {
      const mult = 1 - dotResistPct;
      dotDps *= mult;
      dotByKind.BURN *= mult;
      dotByKind.POISON *= mult;
      dotByKind.BLEED *= mult;
      dotByKind.HELLFIRE *= mult;
    }
    // 2026-05-22 — ENDLESS DOT IMMUNITY. Every enemy spawned in
    // Endless mode is fully DoT-immune (per user spec: "make them
    // immune to dots"). Set on spawn via state.endlessMode check;
    // here we zero the tick contribution. Direct damage is unaffected.
    if ((e as any).__dotImmune && dotDps > 0) {
      dotDps = 0;
      dotByKind.BURN = 0;
      dotByKind.POISON = 0;
      dotByKind.BLEED = 0;
      dotByKind.HELLFIRE = 0;
    }
    if (dotDps > 0) {
      // 2026-06-29 — caps raised (4%→7% aggregate, 1%→2% Hellfire) so the
      // fire/poison DoT archetype scales past a single tower. A 2nd-3rd DoT
      // source now adds real value before the ceiling binds, while still
      // preventing pure-DoT boss cheese.
      const HELLFIRE_CAP = 0.02 * e.maxHp;     // 2%/sec ceiling
      const AGGREGATE_CAP = 0.07 * e.maxHp;    // 7%/sec ceiling
      const hellfireCapped = Math.min(dotByKind.HELLFIRE, HELLFIRE_CAP);
      const nonHellfireRaw = dotByKind.BURN + dotByKind.POISON + dotByKind.BLEED;
      const aggregateRaw = hellfireCapped + nonHellfireRaw;
      const aggregateCapped = Math.min(aggregateRaw, AGGREGATE_CAP);
      if (aggregateCapped < dotDps) {
        // Two-stage rescale: first apply the Hellfire sub-cap, then
        // scale the entire bucket down to the aggregate ceiling.
        if (dotByKind.HELLFIRE > hellfireCapped) {
          dotByKind.HELLFIRE = hellfireCapped;
        }
        const postSubCap = dotByKind.BURN + dotByKind.POISON + dotByKind.BLEED + dotByKind.HELLFIRE;
        if (postSubCap > AGGREGATE_CAP && postSubCap > 0) {
          const scale = AGGREGATE_CAP / postSubCap;
          dotByKind.BURN     *= scale;
          dotByKind.POISON   *= scale;
          dotByKind.BLEED    *= scale;
          dotByKind.HELLFIRE *= scale;
        }
        dotDps = aggregateCapped;
      }
    }
    if (dotDps > 0) {
      e.hp -= dotDps * dt;
      // 2026-05-21 — DoT ticks NO LONGER refresh lastDamagedTick.
      // Background: the previous behaviour used lastDamagedTick as a
      // proxy for "DoTs suppress regen" — refreshing it every DoT tick
      // kept the OOC quiet-window pinned open forever, fully blocking
      // OOC regen. Now suppression is handled explicitly via the
      // `regenMult` multiplier in the regen block below (0.5× during
      // DoT, 1.0× otherwise), so a DoT no longer needs to gate the
      // OOC quiet-window. lastDamagedTick now means strictly
      // "last DIRECT damage tick" — used by BossScripts.recentlyHit
      // and the OOC quiet-window gate. This is the change that lets
      // Hannibal + Daemon Imperator OOC regen actually flow at 50%
      // during DoT instead of being silently locked at 0%.
    }
    // 2026-05-22 V34 — DOT floating-number emit removed per user
    // feedback. The POISON green numbers read as healing rather than
    // damage, and BURN/BLEED/HELLFIRE all together cluttered the
    // screen during W11+ undead waves. Status effects still tick and
    // apply damage normally — the HP bar drain + status-effect icons
    // over the enemy already communicate "this enemy is taking DoT."
    // (Direct-hit damage numbers, crits, +gold floaters, item-drop
    // labels, kill-streak milestones all kept — those mark active
    // player actions, not ambient tick damage.)
    e.currentSpeed = (frozen || stunned) ? 0 : e.baseSpeed * speedMult;
    // 2026-05-19 — HERO ABILITY WINDOWS that mutate enemy speed:
    //   • Frontier Wall (Agricola Tier 2): flyers slowed during window
    // 2026-05-21 — Zama (Scipio Tier 3) removed alongside the tier-3
    // ability deletion; its boss-speed reader is gone.
    const frontierUntil = (state as any).__frontierWallUntilTick ?? 0;
    if (state.tick < frontierUntil && e.isFlyer) {
      e.currentSpeed *= (state as any).__frontierWallFlyerSpeedMult ?? 0.3;
    }

    // Regen for special enemies — both constant and out-of-combat
    // varieties. DoT suppression rule: if the enemy has ANY active
    // damage-over-time status (burn / poison / bleed / hellfire),
    // regen ticks at a softened rate.
    //
    // 2026-05-21 — Suppression softened from 100% (full block) to
    // 50% (half rate). Background: a single applied DoT used to fully
    // shut down Hannibal + Daemon Imperator healing, making them
    // trivial for any DoT build. Now DoTs reduce regen by half, so
    // the player needs both DoT AND direct damage to outpace regen
    // bosses. Hannibal + Daemon Imperator keep their full base regen
    // rates (1.68% and 2.8% OOC respectively); only the
    // DoT-active multiplier changes.
    //
    // EXEMPTION (2026-05 v9 confirm): the CHECKPOINT touch heal
    // (`checkpointHealPct`) is intentionally NOT suppressed by DoT.
    // The coin-touch heal is a wave-design lever that punishes letting
    // enemies through; it must always fire when the enemy reaches the
    // coin so the player feels the design pressure regardless of
    // whether they happened to have a DoT ticking on the unit. The
    // checkpoint block lives further down (search `WAYPOINT_CENTERS`)
    // and is deliberately outside this regen logic.
    const def: any = (enemiesData as any)[e.type];
    const hasActiveDot = e.statusEffects.some(s =>
      s.remaining > 0 && (
        s.kind === StatusEffectKind.BURN ||
        s.kind === StatusEffectKind.POISON ||
        s.kind === StatusEffectKind.BLEED ||
        s.kind === StatusEffectKind.HELLFIRE
      )
    );
    const regenMult = hasActiveDot ? 0.5 : 1.0;
    // Constant regen (always-on, e.g. Iron Phalanx / Architectus).
    if (def.regenPctPerSec) {
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * def.regenPctPerSec * regenMult * dt);
    }
    // 2026-05-22 — WAVE-LEVEL REGEN. Some W11+ waves stamp
    // `enemyRegenPctPerSec` on the wave def to give every spawn on
    // that wave a passive regen tick (independent of per-enemy
    // outOfCombatRegen). Same DoT-suppression rule (50% under DoT).
    const _curWave: any = (wavesData as any[])[(state.wave ?? 1) - 1];
    const waveRegen = _curWave?.enemyRegenPctPerSec ?? 0;
    if (waveRegen > 0) {
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * waveRegen * regenMult * dt);
    }
    // 2026-05-22 — WAVE-LEVEL SPEED BOOST. Wave defs with
    // `enemySpeedBoostPct` apply a flat speed multiplier to every
    // enemy on the wave AFTER per-status modifiers (freeze/slow
    // win because they multiply to 0). Used by W14/W18 to add
    // urgency on top of the HP bump.
    const waveSpeedBoost = _curWave?.enemySpeedBoostPct ?? 0;
    if (waveSpeedBoost > 0 && e.currentSpeed > 0) {
      e.currentSpeed *= (1 + waveSpeedBoost);
    }
    // OUT-OF-COMBAT REGEN: ramps up after 1.0s of not taking DIRECT
    // damage. Per-enemy override (set by spawnEnemy for W11+ creative
    // buff) wins when present and is HIGHER than the JSON value.
    // 2026-05-21 — DoT ticks no longer refresh lastDamagedTick, so
    // the gate reads pure "no direct damage in the last quiet window."
    // A DoT-only attack DOES satisfy the gate, and OOC regen then
    // ticks at the softened 50% rate via regenMult below. This is how
    // Hannibal + Daemon Imperator actually heal at half rate during
    // DoT instead of being fully locked down by a single Poisoned Blade.
    // 2026-05-22 V28 — Quiet-window doubled 0.5s → 1.0s per user
    // tuning. Half a second wasn't enough breathing room for the
    // player to commit to a target before the enemy started healing;
    // a full second gives a clearer "if I stop hitting it, NOW it
    // heals" beat. Affects every enemy with regenPctPerSec or
    // outOfCombatRegen, including bosses.
    let oocRegen = Math.max(def.outOfCombatRegen ?? 0, (e as any).outOfCombatRegen ?? 0);
    // W8 OOC-regen cut (wave-scoped, stamped at spawn). Subtractive and
    // floored at 0 so enemies with no OOC regen stay at 0 — never granted
    // regen by the reduction.
    const w8OocCut = (e as any).__w8OocRegenCut ?? 0;
    if (w8OocCut > 0 && oocRegen > 0) oocRegen = Math.max(0, oocRegen - w8OocCut);
    if (oocRegen > 0) {
      const sinceHit = state.tick - (e.lastDamagedTick ?? -999);
      if (sinceHit > 1.0) {
        e.hp = Math.min(e.maxHp, e.hp + e.maxHp * oocRegen * regenMult * dt);
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
    if (isWaveModifierActive(state, 'GROUP_MARCH')) {
      let near = 0;
      for (const o of state.enemies.values()) {
        if (o.id === e.id) continue;
        if (Math.hypot(o.x - e.x, o.y - e.y) <= 2 * GRID.TILE) { near++; if (near >= 2) break; }
      }
      if (near >= 2) e.currentSpeed *= 1.20;
    }
    e.currentSpeed *= campaignRelicEnemySpeedMult(state, e) * commanderSpeedMult(state, e);

    // Move along path. Preserve leftover distance across segment boundaries so
    // fast enemies glide through turns instead of pausing on tile centers.
    e.prevX = e.x;
    e.prevY = e.y;
    // V38 — Use the cached groundPathPx (built once at top of
    // tickEnemies). state.flyerPath is already pixel-coords so no
    // conversion needed.
    const usesOceanGroundRoute = !!(e as any).__oceanRouteGroundPath;
    const path = e.isFlyer && !usesOceanGroundRoute ? state.flyerPath : ((e as any).__caveB ? groundPathBPx : groundPathPx);
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
    // 2026-05-17 — FREEZE is now a HARD STOP: while an enemy is frozen it
    // cannot be displaced by knockback either. The whole "encased in ice
    // for the duration" read should be literal — currentSpeed is already
    // zeroed above (line ~771); this matching gate ensures even one-shot
    // knockback impulses don't slide a frozen target. Stun-knockback is
    // intentionally left intact: a stunned enemy tripping backward still
    // reads. (User-confirmed.)
    if (knockbackImpulse > 0 && !frozen) {
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
    // 2026-05-19 — INVASION APPROACH MODE. When an invasion enemy is
    // spawned at a perimeter tile, it gets `__approachActive` + a
    // target (the path-entry tile, e.g. WP3). We override the normal
    // path-follow loop with a straight-line walk toward the target.
    // Once the enemy is within ~0.5 tile of the target, we clear the
    // approach flag and the next frame snaps onto the path. The enemy
    // can be hit by towers during the approach (no invulnerability —
    // forward-perimeter tower placements should pay off).
    if ((e as any).__approachActive) {
      const tx = (e as any).__approachTargetX as number;
      const ty = (e as any).__approachTargetY as number;
      const ddx = tx - e.x;
      const ddy = ty - e.y;
      const distToTarget = Math.hypot(ddx, ddy);
      const arriveR = GRID.TILE * 0.5;
      if (distToTarget <= arriveR) {
        // Arrived. Snap to the path tile cleanly. Path-follow takes
        // over on this frame's remaining motion.
        e.x = tx;
        e.y = ty;
        e.prevX = e.x;
        e.prevY = e.y;
        (e as any).__approachActive = false;
      } else {
        // Walk straight toward target at currentSpeed. Direction is
        // remembered for the renderer's facing logic.
        const inv = 1 / distToTarget;
        e.dirX = ddx * inv;
        e.dirY = ddy * inv;
        const step = e.currentSpeed * GRID.TILE * dt;
        const moveDist = Math.min(step, distToTarget);
        e.x += e.dirX * moveDist;
        e.y += e.dirY * moveDist;
        // Skip the path-follow loop this frame — we're still
        // approaching the path-entry tile.
        if (e.hpFlashTimer > 0) e.hpFlashTimer = Math.max(0, e.hpFlashTimer - dt);
        continue;
      }
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
              if (gore.particles.length >= RENDER_LIMITS.MAX_PARTICLES) continue;
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
    //
    // 2026-05-20 — Per-wave OVERRIDE. A wave entry can carry
    // `disableCheckpointHeal: true` in waves.json to suppress this
    // mechanic for the wave. Currently used on W11 where the 42x
    // Undead Celt + necromancy reanim stack was already a slog;
    // the heal on top of reanim made the wave drag without
    // serving any teaching purpose (the heal mechanic itself is
    // still introduced cleanly on W7 Celtic Berserker + W8 Sacred
    // Band, and reinforced on W14/W15 Undead Celts where the
    // field stays on the enemy).
    const currentWaveDef: any = (wavesData as any[])[state.wave - 1];
    const checkpointHealSuppressed = !!currentWaveDef?.disableCheckpointHeal;
    const w9WarElephantCheckpointHeal = state.wave === 9 && e.type === EnemyType.WAR_ELEPHANT;
    if (!e.isFlyer && (!e.isBoss || w9WarElephantCheckpointHeal) && e.checkpointHealPct && e.checkpointHealPct > 0 && !checkpointHealSuppressed) {
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
