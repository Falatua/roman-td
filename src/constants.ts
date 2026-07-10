// All tunable numbers live here. Never hardcode a balance value in a system file.

export const GRID = {
  // Map widened +10 tiles to 38 columns so the seven checkpoints have room
  // to breathe. Buttons live on the right side of the canvas now, outside
  // the play area. Rows kept at 26.
  COLS: 38,
  ROWS: 26,
  TILE: 32,
  CANVAS_W: 38 * 32, // 1216
  CANVAS_H: 26 * 32  // 832
} as const;

// Bottom-left ocean/pond reserve. This is a true map tile zone, not only
// paint: normal towers, traps, ramparts, and event props treat it as blocked.
// Future water towers can use this rectangle as their placement surface.
export const WATER_ZONE = {
  col: 1,
  row: GRID.ROWS - 13,
  width: 14,
  height: 12
} as const;

// Irregular coastal footprint inside WATER_ZONE. Each local row says which
// local columns are actual deep water; the remaining nearby land stays grass.
export const WATER_ROW_SPANS = [
  { start: 0, end: 0 },
  { start: 0, end: 3 },
  { start: 0, end: 6 },
  { start: 0, end: 9 },
  { start: 0, end: 11 },
  { start: 0, end: 13 },
  { start: 0, end: 13 },
  { start: 0, end: 12 },
  { start: 0, end: 13 },
  { start: 0, end: 13 },
  { start: 0, end: 12 },
  { start: 0, end: 10 }
] as const;

export const WATER_TILE_COUNT = WATER_ROW_SPANS.reduce((sum, span) => sum + (span.end - span.start + 1), 0);

// Visual trim radius only: nearby land stays normal buildable grass, while
// RenderEngine can use this to draw a thin shore accent around water.
export const WATER_BUILD_BUFFER_TILES = 1;

// 2026-05-17 — WORLD ZOOM. The outer 1-tile BORDER ring (trees/boulders)
// is no longer drawn; we use that freed real estate to zoom the play area
// in. Pixi stage is scaled + center-offset at init; mouse coords inverse-
// transform via screenToWorld helper.
//
// v2 tuning: zoom dialed back 1.07 → 1.04 because the heavier 1.07 crop
// was clipping ~18px (≈half a tile) off towers placed on the outermost
// buildable columns/rows. At 1.04 the crop is 16-24px per side — fully
// inside the unbuildable BORDER ring, so no tower or gameplay element
// ever lands in the cropped region. Boss HP bar moved up + gate frame
// simplified in the same pass to prevent any further bottom-edge clips.
export const WORLD = {
  ZOOM: 1.04,                                          // ~4% zoom (subtle but visible)
  OFFSET_X: -((38 * 32) * (1.04 - 1)) / 2,             // ≈ -24.3 px
  OFFSET_Y: -((26 * 32) * (1.04 - 1)) / 2              // ≈ -16.6 px
} as const;

export const ECONOMY = {
  STARTING_LIVES: 30,
  // Hard cap on lives. Quest rewards, shop purchases, and the +1 life from
  // Quest +life rewards clamp to this so the player can't
  // stockpile a cushion. Set to STARTING_LIVES so you can never exceed the
  // amount you started with.
  MAX_LIVES: 30,
  STARTING_GOLD: 100,
  // 30-WAVE CAMPAIGN POOL CURVE. The first 8 levels preserve the current
  // economy feel; L9-L10 are luxury late-run upgrades with premium prices and
  // stronger T5 odds for players who commit hard to prospect quality.
  // 2026-05 v6: pool costs bumped ~35% so reaching the apex of the curve
  // is a real investment, not an inevitability. L8 was 200g; v6 set 270g.
  // 2026-05 v10: another +10% across the board — the 100g starting purse
  // already accelerates the early curve, so the per-step cost needs to
  // rise to keep high-pool investment a real commitment. Rounded to whole gold.
  // 2026-06-23 — prices ~1.85x to match the ~1.86x gold income from the
  // doubled enemy counts (1g/kill). Restores pre-doubling gold pressure.
  // 2026-06-28 — every pool-upgrade tier cut 10% cheaper (×0.9, rounded).
  // 2026-07-07 — economy audit after ocean spawns / larger late waves:
  // +15% on the pool curve keeps full-pool timing meaningful without
  // touching kill gold or making the opener feel stingy.
  // 2026-07-10 — expanded from 8 to 10 levels. L1-L8 unchanged; L9/L10
  // continue the late curve at ~1.5x steps so max pool is powerful but not
  // assumed. Full L10 commitment is now 4,846g.
  POOL_UPGRADE_COSTS: [18, 38, 77, 134, 211, 322, 487, 749, 1124, 1686] as const,
  POOL_MAX_LEVEL: 10,
  AERARIUM_BONUS: 4,
  AERARIUM_MAX_COUNT: 3,
  // 2026-05-19 — Baseline gold awarded on every kill. Always paid out
  // instantaneously by the kill hook, on top of Aerarium / item / aura
  // bonuses. Bosses get this baseline AND their separate scaled boss
  // bounty.
  BASE_GOLD_PER_KILL: 1,
  TIER_PLACE_COST: { 1: 4, 2: 7, 3: 11, 4: 15, 5: 19 } as Record<number, number>,
  TIER_SELL_REFUND: { 1: 1, 2: 3, 3: 5, 4: 7, 5: 9 } as Record<number, number>,
  STONE_COST: 1,
  STONES_PER_DRAW: 4,
  COMBO_COST: 10,
  JULIUS_CAESAR_COST: 20,
  DOWNGRADE_COST: 2
} as const;

export const WAVE = {
  TOTAL: 30,           // 2026 v2 spec Ch4: campaign expanded 20 -> 30 waves; Endless removed.
  SPAWN_INTERVAL: 1.0, // seconds between enemies; keeps the incoming line readable
  POST_WAVE_DELAY: 0.3,
  // 20-WAVE COMPRESSED DIFFICULTY (2026-05):
  //   Every 5 waves: +50% cumulative HP (single step, was +25%/5 + +50%/10).
  //   Boss-cleared step: ×1.50 per cleared 5-wave boss (replaces the
  //   per-decade ×1.30 bump in the 50-wave version).
  //   Composition: hp_mult(w) = baseHpMult * (1 + 0.50*floor(w/5)) * pow(1.50, floor((w-1)/5))
  HP_STEP_PER_5: 0.50,
  HP_STEP_PER_10: 0,
  // Legacy fields kept for any tooltip code that still references them.
  POST_WAVE_5_HP_JUMP: 1.0,
  POST_WAVE_5_HP_STEP: 0,
  POST_WAVE_15_HP_BONUS: 1.0,
  DECADE_HP_MULT: 1.0
} as const;

export const ENEMY_BALANCE = {
  FLYER_HEALTH_MULT: 1.22
} as const;

// Tier multipliers (2026-05 — 20-WAVE CAMPAIGN). Re-introduces a damage
// ladder so rolling a T5 actually feels meaningfully stronger than the
// same tower at T1 — linear-leaning ramp with a big T1→T5 gap (2.5×).
// Combined with the speed bonus (T5 = 1.42×), a T5 same-type tower deals
// roughly 3.55× T1 raw output. Combos still scale on top.
export const TIER_MULTS = {
  damage:    { 1: 1.0, 2: 1.25, 3: 1.55, 4: 1.95, 5: 2.50 } as Record<number, number>,
  speed:     { 1: 1.0, 2: 1.10, 3: 1.20, 4: 1.30, 5: 1.42 } as Record<number, number>,
  // 2026-06-27 — Per user: EVERY tower holds exactly 3 items regardless of
  // tier (T1-T5 all = 3), matching the hero 3-slot kit below. The board now
  // shares one uniform 3-item rule.
  itemSlots: { 1: 3,   2: 3,    3: 3,    4: 3,    5: 3    } as Record<number, number>
} as const;

// 2026-06-24 — Hero towers override the per-tier slot count above and
// carry a compact 3-slot kit. This keeps stacked multi-hero boards from
// turning every hero into a full item mule while still preserving build
// expression through meaningful gear choices.
export const HERO_ITEM_SLOTS = 3;

// Probability draw pool table (rows = pool level 0..10; cols T1..T5).
// L1-L8 preserve the previous curve exactly. L9-L10 are expensive late-run
// refinements: mostly T4/T5, with T5 becoming the dominant apex result.
export const POOL_PROBABILITIES: number[][] = [
  [95,  5,  0,  0,  0],   // 0 — start: almost all T1
  [65, 22, 10,  3,  0],   // 1 — first upgrade teases T3 + T4
  [42, 30, 18,  8,  2],   // 2 — clear T3 territory
  [25, 30, 25, 15,  5],   // 3
  [15, 25, 30, 22,  8],   // 4
  [ 8, 18, 30, 28, 16],   // 5
  [ 4, 12, 28, 34, 22],   // 6
  [ 2,  8, 22, 38, 30],   // 7
  [ 1,  5, 18, 38, 38],   // 8 — old apex: T4 + T5 = 76% of all rolls
  [ 1,  4, 15, 36, 44],   // 9 — luxury: 80% T4/T5, T5 now leads
  [ 0,  3, 12, 35, 50]    // 10 — max: 85% T4/T5, half of all rolls are T5
];

export const KILL_BONUS_RATE = 0.0002; // 0.02% of base T1 DPS per kill, capped at +10%
export const KILL_BONUS_MAX_PCT = 0.10;

// Hero level (Gem TD style): cumulative kills push the effective pool tier weights up.
// Thresholds are cumulative kill counts to reach each level. The kill-only path is
// intentionally slow (3× the previous calibration) — gold-purchased pool upgrades
// are the primary scaling lever; kill-XP is a backstop for very long runs.
export const HERO_XP_THRESHOLDS: number[] = [120, 330, 660, 1140, 1800];

// 2026-07-08 — ordinary random item drops pulled back a bit after the
// larger ocean/late-wave enemy counts made floor loot feel too common.
// Guaranteed boss, commander, event, and ocean-specialist reward rules live
// outside this table and are intentionally unaffected.
export const LOOT_DROP_RATES = {
  GROUND: 0.0015,
  FLYER: 0.003
};

export const DRAW = {
  CARDS_PER_ROUND: 5
} as const;

export const RENDER_LIMITS = {
  // PERF PASS (2026-05): mid-run lag was traced to compounding O(n) cost
  // on .shift() at the caps + corpses accumulating with no eviction. The
  // caps below are tighter so the eviction churn is cheaper AND there's
  // less to redraw each frame. Corpse cap added (was unbounded mid-wave).
  MAX_BLOOD_STAINS: 20,
  MAX_PARTICLES: 120,
  MAX_CORPSES: 8,
  MAX_FX_QUEUE: 24,
  PROJECTILE_POOL: 80
} as const;

export const INVENTORY_SIZE = 25;

export const PHASE_DELAYS = {
  WAVE_START_DELAY: 0.4
} as const;

// Status base durations in seconds
export const STATUS_BASE_DURATION = {
  SLOW: 4,
  POISON: 6,
  FREEZE: 2.5,
  BURN: 5,
  ARMOR_SHRED: 3,
  STUN: 1,
  HELLFIRE: 999, // until exit
  FEAR: 1
} as const;

// Visual tier glow colors
export const TIER_COLORS: Record<number, number> = {
  1: 0x6f6f6f,
  2: 0xb87333,
  3: 0xc0c0c0,
  4: 0xffd34d,
  5: 0xff5050
};

// Pure magenta key used in source sheets
export const MAGENTA_KEY = { r: 255, g: 0, b: 255 };

// Faction display names
export const FACTION_NAMES: Record<number, string> = {
  0: 'Feral Dogs',
  1: 'Celtic Tribes',
  2: 'Carthaginian Army',
  3: 'Undead Celts',
  4: 'Undead Carthage',
  5: 'Super Demons',
  // 2026-05 v10 — Endless mode factions.
  6: 'Mongol Horde',
  7: 'Egyptian Dynasty'
};

// FACTION WEATHER — each faction brings an environmental effect that visually
// transforms the map and mechanically pressures towers for the duration of
// their wave. Boss waves intensify the same effect (×1.5 density + penalties).
//
// Penalties (applied uniformly to all towers while active):
//   missChance: per-shot probability the projectile/melee deals 0 damage
//   rangePenalty: tiles subtracted from every tower's effective range
//   attackSpeedPenalty: % attack speed reduction (0.15 = 15% slower)
//   statusDurationPenalty: % reduction on status effects applied by towers
export interface WeatherProfile {
  name: string;
  blurb: string;
  color: number;        // tint
  density: number;      // 0..1 alpha intensity
  missChance: number;
  rangePenalty: number;
  attackSpeedPenalty: number;
  statusDurationPenalty: number;
  particleKind: 'DUST' | 'MIST' | 'SAND' | 'MIASMA' | 'WIND' | 'EMBER';
}

// WAVE MODIFIERS — random themed wave variants. A wave can roll a modifier
// (currently ~30% chance on non-boss/non-phalanx waves from W6+) which gives
// the wave a distinct mechanical identity beyond just enemy composition.
export type WaveModifierKey =
  | 'BLOOD_MOON'        // +25% HP, red outline
  | 'STORM_SURGE'       // periodic lightning grants +50% speed to a random enemy
  | 'DEATH_PACT'        // each enemy death heals every other enemy 4% HP
  | 'VEIL'              // every 6s enemies briefly untargetable (0.8s)
  | 'REVENANT'          // dying enemies leave 4s ghost that silences nearest tower
  | 'GROUP_MARCH';      // enemies +20% speed when bunched (3+ within 2 tiles)

export interface WaveModifier {
  key: WaveModifierKey;
  name: string;
  blurb: string;
  color: number;
}

export const WAVE_MODIFIERS: WaveModifier[] = [
  { key: 'BLOOD_MOON',  name: 'Blood Moon',  blurb: 'Every enemy in this wave has +25% HP and a crimson aura.', color: 0xcc1818 },
  { key: 'STORM_SURGE', name: 'Storm Surge', blurb: 'Every 8 seconds a lightning bolt strikes a random enemy, granting +50% speed for 3s.', color: 0x66aaff },
  { key: 'DEATH_PACT',  name: 'Death Pact',  blurb: 'When an enemy dies, every surviving enemy heals 4% HP.', color: 0x9966cc },
  { key: 'VEIL',        name: 'Veil',        blurb: 'Every 6 seconds enemies fade into the veil for 0.8s — untargetable, no damage.', color: 0x88ccff },
  { key: 'REVENANT',    name: 'Revenant',    blurb: 'Every dead enemy leaves a drifting ghost. Each ghost silences the nearest tower for 1.5s as it passes.', color: 0xaaaaff },
  { key: 'GROUP_MARCH', name: 'Group March', blurb: 'Enemies bunched within 2 tiles gain +20% speed. Strength in numbers.', color: 0xffaa44 }
];

export const FACTION_WEATHER: Record<string, WeatherProfile> = {
  DOGS: {
    name: 'Pack Dust',
    blurb: 'A thin haze of dust kicked up by the running pack.',
    color: 0xb89065, density: 0.10,
    missChance: 0.03, rangePenalty: 0, attackSpeedPenalty: 0, statusDurationPenalty: 0,
    particleKind: 'DUST'
  },
  CELTS: {
    name: 'Druidic Mist',
    blurb: 'A grey mist rolls in. Towers have a 20% miss chance and lose 0.5 tile range.',
    color: 0x9aaab8, density: 0.30,
    missChance: 0.20, rangePenalty: 0.5, attackSpeedPenalty: 0, statusDurationPenalty: 0,
    particleKind: 'MIST'
  },
  CARTHAGE: {
    name: 'Saharan Sandstorm',
    blurb: 'Stinging sand fills the air. Tower range is reduced by 1 tile.',
    color: 0xc0a070, density: 0.35,
    missChance: 0.05, rangePenalty: 1.0, attackSpeedPenalty: 0, statusDurationPenalty: 0,
    particleKind: 'SAND'
  },
  UNDEAD_CELTS: {
    name: 'Necrotic Miasma',
    blurb: 'A green miasma slows tower fingers. Attack speed reduced by 15%.',
    color: 0x6a9060, density: 0.30,
    missChance: 0, rangePenalty: 0, attackSpeedPenalty: 0.15, statusDurationPenalty: 0,
    particleKind: 'MIASMA'
  },
  UNDEAD_CARTHAGE: {
    name: 'Cursed Wind',
    blurb: 'A cold wind shortens the bite of every status. Status durations reduced by 35%.',
    color: 0x7a6a90, density: 0.28,
    missChance: 0, rangePenalty: 0, attackSpeedPenalty: 0, statusDurationPenalty: 0.35,
    particleKind: 'WIND'
  },
  SUPER_DEMONS: {
    name: 'Hellscape',
    blurb: 'Burning embers warp the air. -10% range, -10% atk speed, 8% miss, -20% status duration.',
    color: 0xaa3010, density: 0.40,
    missChance: 0.08, rangePenalty: 0.5, attackSpeedPenalty: 0.10, statusDurationPenalty: 0.20,
    particleKind: 'EMBER'
  }
};

export const COIN_FOOTPRINT_TILES = 1; // 1x1 waypoint coin footprint (smaller, less invasive)

// 2026-05-19 — AURA BUFF TILES. Five fixed glowing tiles spread across
// the map. A tower placed on one of these tiles inherits the tile's
// effect (stacks multiplicatively with any other source of the same
// stat). Positions are fixed (not random) so every player faces the
// same opportunities + every maze plan can pivot around them.
//
// Min separation ≥11 manhattan tiles so no two glows overlap visually
// or competitively. All positions are off the cave (3,4) and gate
// (35,23), off every waypoint coin, and inside the buildable area
// (col ≤ 31 — HUD button column starts at 32).
export interface AuraTile {
  col: number;
  row: number;
  kind: 'PURPLE' | 'BLUE' | 'RED' | 'CYAN' | 'GOLD' | 'EMERALD' | 'IVORY' | 'AMBER' | 'TIDE';
}
export const AURA_TILES: AuraTile[] = [
  { col: 8,  row: 9,  kind: 'PURPLE'  },  // left            · +30% attack speed (tempo, moved right 2)
  { col: 15, row: 12, kind: 'BLUE'    },  // central         · +30% damage
  { col: 26, row: 9,  kind: 'RED'     },  // right-mid       · +50% damage vs bosses (tyrant, moved up 1 + left 2)
  { col: 24, row: 19, kind: 'CYAN'    },  // bottom-mid      · melee can hit flyers
  { col: 15, row: 16, kind: 'GOLD'    },  // mid-left        · +2 gold per kill (treasury, moved up 3 + right 4)
  // 2026-07-05 — WATCHTOWER (emerald green). Moved from (20,4) to
  // (17,7), three tiles left and three tiles down, while staying on
  // open buildable terrain near the upper-middle approach.
  { col: 17, row: 7,  kind: 'EMERALD' },  // upper-middle · +2 tile range
  // 2026-06-28 — DIVINE (ivory) + BLAST (amber) tiles, dispersed organically
  // instead of stacked in a column. They scatter with the other six rather
  // than lining up, while still anchoring the right-side WP3↔WP4 lanes. Both
  // on open buildable terrain (clear of every waypoint + structure footprint).
  { col: 31, row: 5,  kind: 'IVORY'   },  // upper-right pocket · near WP4 · tower strikes as DIVINE (moved left 1)
  { col: 25, row: 15, kind: 'AMBER'   },  // centre-lower pocket · near WP3 · tower gains splash blast
  { col: 10, row: 16, kind: 'TIDE'    }   // ocean below WP2   · damaged enemies are slowed 30%
];
// Effect lookup table — used by stat math, combat hooks, and tooltips
// so the same numbers come out of one source. Multipliers are applied
// multiplicatively in TowerSystem.towerEffectiveStats and the combat
// hook for the boss-damage variant.
export const AURA_TILE_EFFECTS: Record<AuraTile['kind'], {
  color: number;          // hex color for the glow
  label: string;          // short tooltip header (e.g. "ATTACK SPEED")
  description: string;    // full description shown on hover
  dmgMult?: number;       // optional damage multiplier
  spdMult?: number;       // optional attack-speed multiplier
  bossMult?: number;      // optional vs-boss damage multiplier
  goldPerKill?: number;   // optional gold-per-kill bonus
  meleeFlyer?: boolean;   // optional anti-air for melee towers
  rangeBonus?: number;    // optional flat range bonus in tiles
  divineDamage?: boolean; // optional — tower's attacks resolve as DIVINE damage
  splashBonus?: number;   // optional — minimum splash (AoE) radius in tiles
  hitSlowPct?: number;    // optional — direct-damaged enemies receive SLOW
  hitSlowDuration?: number;
}> = {
  PURPLE:  { color: 0xa060ff, label: 'TEMPO TILE',      description: 'Tower on this tile attacks +30% faster.',                                     spdMult: 1.30 },
  BLUE:    { color: 0x66aaff, label: 'WAR TILE',        description: 'Tower on this tile deals +30% damage.',                                       dmgMult: 1.30 },
  RED:     { color: 0xff5050, label: 'TYRANT TILE',     description: 'Tower on this tile deals +50% damage vs Bosses.',                            bossMult: 1.50 },
  CYAN:    { color: 0x66ffdd, label: 'AETHER TILE',     description: 'Any tower on this tile can target FLYERS, even melee.',                     meleeFlyer: true },
  GOLD:    { color: 0xffd34d, label: 'TREASURY TILE',   description: 'Tower on this tile earns +2 Gold per kill.',                                 goldPerKill: 2 },
  // 2026-05-19 — Watchtower tile. +2 tile range stacks with the
  // Watchtower Lens trophy (+1 range) for a +3 range Scorpio reaching
  // most of the map. Range stacks ADDITIVELY in towerEffectiveStats
  // (line 370), so this lands inside `extraRange` alongside lens and
  // pool-level bonuses.
  EMERALD: { color: 0x66ff88, label: 'WATCHTOWER TILE', description: 'Tower on this tile gains +2 tiles of range — a commanding sight line.', rangeBonus: 2 },
  // 2026-06-27 — Two new keyword tiles. The tower keeps all of its own
  // stats and abilities; the tile only layers the extra effect on top.
  // IVORY converts the attack's damage type to DIVINE (pierces most
  // resistances). AMBER grants a splash blast (applied as a minimum
  // projectile splash radius in ProjectileSystem.spawnProjectile).
  // TIDE is an ocean control tile: it keeps the tower's own identity,
  // but any enemy actually damaged by that tower is slowed.
  IVORY:   { color: 0xfff2cc, label: 'DIVINE TILE',     description: 'Any tower on this tile strikes as DIVINE damage — bypasses most resistances.', divineDamage: true },
  AMBER:   { color: 0xff8a3c, label: 'BLAST TILE',      description: 'Tower on this tile gains a splash blast — every hit also damages enemies within 1.2 tiles.', splashBonus: 1.2 },
  TIDE:    { color: 0x26f6e2, label: 'TIDE TILE',       description: 'Tower on this ocean tile keeps its normal attacks, and any enemy it damages is slowed 30%.', hitSlowPct: 0.30, hitSlowDuration: 2.5 }
};
