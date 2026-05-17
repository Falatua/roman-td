// EndlessMode — post-W20 chaos mode generator (2026-05 v10).
//
// After the player clears W20, they transition into Endless mode where
// each "wave" is a fresh procedurally-generated assault. Normal
// difficulty / faction-cadence / theming rules don't apply: the goal
// here is mayhem. Difficulty scales aggressively per Endless wave
// (linear coefficients are large; basic enemies become threats in a
// handful of waves and near-unkillable within 10).
//
// Output shape mimics the wavesData JSON entries so the existing
// startWave path can chew through it without divergence.

import enemiesData from '../data/enemies.json';
import { EnemyType } from '../types';

export interface EndlessWaveConfig {
  wave: number;           // 21+ for display (state.wave stays frozen at 20)
  endlessIdx: number;     // 1-based endless wave number
  type: 'G' | 'M' | 'F' | 'B';
  faction: string;        // dominant faction tag — UI uses it for weather + banners
  hpMult: number;         // applied on top of the existing wave-curve helpers
  speedMult: number;      // Endless layers a speed scalar on the spawned enemy too
  resistBoost: number;    // late-stage `__lateResistMult` style stamp boost
  gold: number;
  spawns: { type: string; count: number }[];
  necromancy: boolean;
  combinedMechanics: string[];   // free-form flags surfaced in pre-wave brief
}

// New-faction (Mongol + Egyptian) rosters — these get the heavier
// rotation per the design brief. Each entry is the canonical enemy id.
const ENDLESS_FACTION_ROSTER: { faction: string; types: string[] }[] = [
  {
    faction: 'EGYPTIANS',
    types: [
      'EGYPTIAN_ARCHER', 'EGYPTIAN_SPEARMAN', 'EGYPTIAN_CHARIOT',
      'PHARAOH_GUARD', 'ANUBIS_PRIEST', 'SOBEK_WARRIOR',
      'MUMMY_WARRIOR', 'SPHINX'
    ]
  },
  {
    faction: 'MONGOLS',
    types: [
      'MONGOL_HORSE_ARCHER', 'MONGOL_SPEAR_RIDER', 'MONGOL_FOOTMAN',
      'MONGOL_SPEARMAN', 'MONGOL_BERSERKER', 'MONGOL_SCOUT',
      'MONGOL_SHAMAN', 'MONGOL_CAPTAIN'
    ]
  }
];

// Returning W1-W20 roster — basics only, bosses pulled in at higher
// Endless waves. Filters out the dummy and reanim chain types.
const RETURNING_NON_BOSS: string[] = [
  'FERAL_DOG','RABID_DOG',
  'CELTIC_FOOTMAN','CELTIC_BERSERKER','GALLIC_DRUID','CELTIC_SCOUT',
  'CARTHAGE_SPEARMAN','NUMIDIAN_RIDER','CARTHAGE_ELITE_GUARD','WAR_ELEPHANT',
  'UNDEAD_CELT','ZOMBIE_DRUID','UNDEAD_BERSERKER','SPECTRAL_SCOUT',
  'UNDEAD_SPEARMAN','GHOST_RIDER','UNDEAD_WAR_ELEPHANT','IRON_PHALANX','ARCHITECTUS',
  'DEMON_HELLHOUND','CELTIC_FIRE_DEMON','SHADOW_CAVALRY','DEMON_LEGATE'
];

const RETURNING_BOSSES: string[] = [
  'ALPHA_DOG', 'CELTIC_WARLORD', 'HANNIBAL_BARCA',
  'UNDEAD_WARLORD', 'DAEMON_IMPERATOR'
];

const ENDLESS_BOSSES: string[] = [
  'ANUBIS_KING', 'KHAN_RIDER'
];

// Faction tag fallback when a returning enemy doesn't fit cleanly. The
// pre-wave banner reads this for weather + theming, but Endless waves
// intentionally mix factions so this is only a "dominant flavor".
function dominantFaction(idx: number): string {
  // Cycle through the new factions with returning sprinkled in.
  const order = ['EGYPTIANS', 'MONGOLS', 'EGYPTIANS', 'MONGOLS', 'SUPER_DEMONS', 'UNDEAD_CARTHAGE'];
  return order[idx % order.length];
}

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Aggressive linear scaling — by Endless wave 5 the basics feel like
// boss-tier; by Endless 10 they're nearly unkillable. The exponent on
// the speed and resist scalars stays low enough that even outrageous
// HP still leaves SOME counterplay window for the player's tower DPS.
function endlessHpMult(idx: number): number {
  // Linear ramp 1.50 + 0.45×idx, then compounding 1.18^(idx-1) after
  // E5 to bend the curve into "impossible" territory by E10.
  const linear = 1.5 + 0.45 * idx;
  const compound = idx >= 5 ? Math.pow(1.18, idx - 4) : 1;
  return linear * compound;
}

function endlessSpeedMult(idx: number): number {
  // Mild — too much speed makes the game unplayable. Cap at +60%.
  return Math.min(1.6, 1 + 0.04 * idx);
}

function endlessResistMult(idx: number): number {
  // Drops as wave climbs — 1.0 at E1, 0.55 at E10 (45% damage reduction).
  // Multiplies through `__lateResistMult` on spawn.
  return Math.max(0.45, 1 - 0.06 * idx);
}

// Spawn-count budget — each new-faction picker gets a base count,
// returning W1-20 picks get less so the new sprites dominate per spec.
function newFactionCount(idx: number): number {
  return Math.round(8 + idx * 0.85);
}
function returningCount(idx: number): number {
  return Math.round(3 + idx * 0.45);
}

export function generateEndlessWave(endlessIdx: number): EndlessWaveConfig {
  // Boss cadence: every 5 Endless waves a boss anchors the assault.
  const isBossWave = endlessIdx % 5 === 0;
  const hasFlyers = Math.random() < 0.55;            // most waves include air
  const isNecromancy = Math.random() < (0.20 + endlessIdx * 0.02);

  // ─── Spawns ─────────────────────────────────────────────────────────
  const spawns: { type: string; count: number }[] = [];

  // Always emit 2-3 distinct new-faction groups for visual rotation.
  // Faction picks are random — no rule against mixing Egyptian + Mongol
  // in the same wave.
  const newPicks = 2 + Math.floor(Math.random() * 2);
  const newTypeSet = new Set<string>();
  while (newTypeSet.size < newPicks) {
    const f = rand(ENDLESS_FACTION_ROSTER);
    newTypeSet.add(rand(f.types));
  }
  for (const t of newTypeSet) {
    spawns.push({ type: t, count: Math.max(3, Math.round(newFactionCount(endlessIdx) / newPicks)) });
  }

  // 1-2 returning W1-W20 types for nostalgia + chaos.
  const returningPicks = 1 + Math.floor(Math.random() * 2);
  const returnedSet = new Set<string>();
  while (returnedSet.size < returningPicks) {
    returnedSet.add(rand(RETURNING_NON_BOSS));
  }
  for (const t of returnedSet) {
    spawns.push({ type: t, count: Math.max(2, Math.round(returningCount(endlessIdx) / returningPicks)) });
  }

  // Flyer guarantee — at least one flyer group if the dice rolled in.
  if (hasFlyers) {
    const allFlyers = ['SPHINX', 'MONGOL_HORSE_ARCHER', 'MONGOL_SPEAR_RIDER', 'SPECTRAL_SCOUT', 'GHOST_RIDER', 'SHADOW_CAVALRY'];
    const fl = rand(allFlyers);
    if (!spawns.some(s => s.type === fl)) {
      spawns.push({ type: fl, count: Math.max(3, Math.round(4 + endlessIdx * 0.4)) });
    }
  }

  // Boss anchor. ANUBIS_KING and KHAN_RIDER are the new endless bosses;
  // returning bosses also rotate in for chaos. Boss waves replace the
  // normal mob horde with the boss + a smaller swarm.
  if (isBossWave) {
    const bossPool = endlessIdx <= 10
      ? [...ENDLESS_BOSSES, ...RETURNING_BOSSES.slice(0, 3)]
      : [...ENDLESS_BOSSES, ...RETURNING_BOSSES];
    const bossType = rand(bossPool);
    // Cap the boss wave to JUST the boss + a small honor-guard so the
    // boss isn't lost in the noise.
    spawns.length = 0;
    spawns.push({ type: bossType, count: 1 });
    // Honor-guard mobs (new-faction only, smaller).
    const guard = rand(ENDLESS_FACTION_ROSTER);
    spawns.push({ type: rand(guard.types), count: Math.round(4 + endlessIdx * 0.3) });
    // Late-Endless: TWIN bosses. Two-boss waves past E10.
    if (endlessIdx >= 10 && Math.random() < 0.4) {
      const second = rand(bossPool);
      if (second !== bossType) spawns.push({ type: second, count: 1 });
    }
  }

  // Combined mechanics flags — used for pre-wave banner copy. Endless
  // explicitly mixes mechanics that the main game keeps separate.
  const combinedMechanics: string[] = [];
  if (isNecromancy) combinedMechanics.push('NECROMANCY active — kills spit reanimated minions');
  if (spawns.some(s => /WAR_ELEPHANT|SOBEK_WARRIOR/.test(s.type))) combinedMechanics.push('DUST-SHIELD AURA: ranged blocked near elephants');
  if (spawns.some(s => /DRUID|SHAMAN|PRIEST|LEGATE/.test(s.type))) combinedMechanics.push('TOWER-SLOW + SLEEP CURSE — caster auras stacked');
  if (spawns.some(s => /SPECTRAL_SCOUT|GHOST_RIDER|MONGOL_SCOUT/.test(s.type))) combinedMechanics.push('TOWER SILENCE + STEALTH cycles');
  if (endlessIdx >= 6) combinedMechanics.push(`+${Math.round((endlessHpMult(endlessIdx) - 1) * 100)}% HP scaling vs. authored baselines`);

  const config: EndlessWaveConfig = {
    wave: 20 + endlessIdx,
    endlessIdx,
    type: isBossWave ? 'B' : (hasFlyers && spawns.length === 1 ? 'F' : 'M'),
    faction: dominantFaction(endlessIdx),
    // hpMult applied on top of effectiveWaveHpMult — but Endless freezes
    // state.wave at 20 so effectiveWaveHpMult sees w=20 baseline. Our
    // hpMult here carries the entire Endless scaling on top.
    hpMult: endlessHpMult(endlessIdx),
    speedMult: endlessSpeedMult(endlessIdx),
    resistBoost: endlessResistMult(endlessIdx),
    gold: Math.round(20 + endlessIdx * 4 + Math.random() * 18),   // unstable
    spawns,
    necromancy: isNecromancy,
    combinedMechanics
  };
  return config;
}

// Helper: total enemy count for sanity / UI display.
export function endlessWaveTotalCount(cfg: EndlessWaveConfig): number {
  return cfg.spawns.reduce((s, g) => s + g.count, 0);
}

// Endless score formula — each cleared wave grants score equal to:
//   base 100 × endlessIdx + sum(enemy livesCost × 4) + boss bonus 200
// Capped at a sane value per wave so single huge waves don't pop the
// leaderboard, and added to state.endlessScore cumulatively.
export function endlessClearScore(cfg: EndlessWaveConfig): number {
  let s = 100 * cfg.endlessIdx;
  for (const grp of cfg.spawns) {
    const def: any = (enemiesData as any)[grp.type];
    if (!def) continue;
    s += grp.count * (def.livesCost ?? 1) * 4;
    if (def.isBoss) s += 200;
  }
  return Math.min(s, 6000);
}

// Re-export type-checkable EnemyType references so other modules can
// pull the Endless roster without a string-literal soup. Not needed by
// the generator above (it uses strings to match the JSON-driven path).
export const ENDLESS_NEW_ENEMY_TYPES: EnemyType[] = [
  EnemyType.EGYPTIAN_ARCHER, EnemyType.EGYPTIAN_SPEARMAN, EnemyType.EGYPTIAN_CHARIOT,
  EnemyType.PHARAOH_GUARD, EnemyType.ANUBIS_PRIEST, EnemyType.SOBEK_WARRIOR,
  EnemyType.MUMMY_WARRIOR, EnemyType.SPHINX, EnemyType.ANUBIS_KING,
  EnemyType.MONGOL_HORSE_ARCHER, EnemyType.MONGOL_SPEAR_RIDER, EnemyType.KHAN_RIDER,
  EnemyType.MONGOL_FOOTMAN, EnemyType.MONGOL_SPEARMAN, EnemyType.MONGOL_BERSERKER,
  EnemyType.MONGOL_SCOUT, EnemyType.MONGOL_SHAMAN, EnemyType.MONGOL_CAPTAIN
];
