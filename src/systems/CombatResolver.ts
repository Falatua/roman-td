// CombatResolver — the heart of the game.
//
// Responsibilities:
//   1. Each frame, scan all (non-pending) towers and decide if they can attack.
//   2. Pick a target per tower's targetingMode (FIRST/LAST/STRONG/CLOSE/FLYERS).
//   3. Apply support auras (Eagle Standard, Aquilifer Titan, item auras).
//   4. Compute per-attack damage including faction resistances, mark debuffs,
//      tower signature bonuses (Backstab, Trident & Net, Solar Flare etc.),
//      weather miss-chance, and attack-speed penalties.
//   5. Spawn projectiles for ranged towers OR apply instant damage for melee.
//   6. Cleave melee hits secondary targets at 70%.
//   7. Multi-shot ranged fires at top-N targets per attack.
//   8. Apply on-hit status effects via applyOnHitEffects.
//   9. Resolve kills + Phoenix rebirth + bonus boss gold reward via hooks.
//
// Pure data; no DOM/Pixi imports. Tested in tests/damage.test.ts +
// tests/towers.test.ts.

import { Tower, Enemy, TargetingMode, DamageType, StatusEffectKind, EntityType, TowerType, EnemyType, EnemyFaction } from '../types';
import { GameStateShape } from '../GameState';
import { GRID, KILL_BONUS_RATE, KILL_BONUS_MAX_PCT, FACTION_WEATHER } from '../constants';
import { towerEffectiveStats, towerPerAttackDamageBase, towerAuraTileKind } from './TowerSystem';
import { resistanceModifier } from './DamageTypeSystem';
import { spawnPhoenixMinions } from './EnemySystem';
import { spawnProjectile, spawnCosmeticProjectile } from './ProjectileSystem';
import { enemyDamageMultiplier, statusEffectiveness } from './EnemyResistances';
import { campaignRelicDamageMult } from './CampaignRelicSystem';
import { bossTrophyDamageMult } from './BossTrophySystem';
import { commanderDamageTakenMult } from './CommanderSystem';
import { heroIdForTowerType, isMercatorChampionType } from './HeroIdentity';
import enemiesData from '../data/enemies.json';
import towersData from '../data/towers.json';
import wavesData from '../data/waves.json';

// 2026-05-20 — Per-wave resistance relief lookup. A wave entry can carry
// an optional `resistReduction` field (0-1) that brings the effective
// resistance multiplier 15% closer to 1.0 (no extra damage taken from
// values >1, so weakness is unaffected). Currently used only on W8,
// which stacks faction resistance with shield block + meleeBreak +
// regen and was reading as the hardest non-boss wave. Adding this as a
// general field keeps the door open for future per-wave tuning.
const RESIST_REDUCTION_BY_WAVE = new Map<number, number>();
for (const w of (wavesData as any[])) {
  if (typeof w?.resistReduction === 'number' && w.resistReduction > 0) {
    RESIST_REDUCTION_BY_WAVE.set(w.wave, w.resistReduction);
  }
}

// Module-local counter for burn-patch IDs (unique per session).
let nextBurnPatchId = 1;
function newBurnPatchId(): string { return `bp${nextBurnPatchId++}`; }

// BURNING GROUND — fire-themed towers stamp a 3-second patch at the impact
// point. Any enemy within the patch radius takes burn DoT each frame.
// Patches stack additively but each patch decays independently.
function spawnBurnPatch(state: GameStateShape, x: number, y: number, sourceTier: number) {
  if (!state.burnPatches) state.burnPatches = [];
  state.burnPatches.push({
    id: newBurnPatchId(),
    x, y,
    born: state.tick,
    life: 4.0,                 // 2026-05 v11: 3s → 4s — single-DoT consolidation
    sourceTier
  });
  // Cap patches to avoid runaway accumulation (rare, but defensive).
  // 2026-05 perf: dropped cap 200 → 80. Each patch costs an O(N) scan
  // every tickBurnPatches frame; 200 patches × 30 enemies = 6000 distance
  // checks every frame. 80 keeps the late-wave visuals dense without
  // melting the per-frame budget.
  if (state.burnPatches.length > 80) state.burnPatches.shift();
}

function towerBurnsGround(towerType: string): boolean {
  return !!(towersData as any)[towerType]?.burnsGround;
}

function isMeleeImmune(enemyType: string): boolean {
  return !!(enemiesData as any)[enemyType]?.meleeImmune;
}
// 2026-05-19 v3 — UNDEAD_WARLORD (W15 boss) + IRON_PHALANX (W17 elite)
// carry `meleeImmune: true` in enemies.json to block physical
// sword-strikes — bone bodies and shield walls shrug off blade impacts.
// But the previous gate blocked the ENTIRE melee swing path regardless
// of damage type, which meant divine melee towers (Pontifex Maximus,
// God of War, Hero Caesar) and any future fire-melee or siege-melee
// unit couldn't damage them either. Per design intent, only PHYS_MELEE
// damage should be blocked — DIVINE retribution and FIRE/SIEGE smashes
// delivered at sword reach still pierce.
//
// 2026-05-23 — Corrected the stale Zombie Druid mention in this
// comment: ZOMBIE_DRUID does NOT carry `meleeImmune` (verified in
// enemies.json). Its toughness comes from the broader undead-faction
// damage profile + its 30% ranged-dodge plus the sleep-curse mechanic,
// not melee immunity. UNDEAD_WARLORD is the actual `meleeImmune: true`
// undead unit on its wave.
function meleeImmuneBlocksTower(enemyType: string, towerDmgType: DamageType): boolean {
  if (!isMeleeImmune(enemyType)) return false;
  return towerDmgType === DamageType.PHYS_MELEE;
}
function requiresMeleeBreak(enemyType: string): boolean {
  return !!(enemiesData as any)[enemyType]?.requiresMeleeBreak;
}

// Phoenix rebirth (2026-05 v2): the dying enemy stays dead, but 3
// reduced-HP minions of the same type spawn at the death tile. The
// original kill still counts (this returns `false` so the caller fires
// `hooks.onKill`). Minions flagged `hasRebirthed` so they can't trigger
// their own phoenix. Implementation lives in EnemySystem alongside
// spawnEnemy; this is just the call-site shim used by direct-hit kills.
function checkRebirth(state: GameStateShape, target: Enemy, tick: number): boolean {
  spawnPhoenixMinions(state, target, tick);
  return false;
}

export interface CombatHooks {
  onKill: (tower: Tower, enemy: Enemy) => void;       // for kill-bonus + score + Aerarium
  onHit: (tower: Tower, enemy: Enemy, damage: number, resMod?: number, isCrit?: boolean) => void;
  onMeleeSwing: (tower: Tower, target: Enemy, damage: number) => void;
  onProjectileFire: (tower: Tower, target: Enemy, damage: number) => void;
}

// 2026-05-17 — BEAST_ENEMY_TYPES: animal-faction enemies that take +200%
// damage from Beast Hunter + Beast Slayer towers. Covers the early-game
// dog pressure (W1-W3), the W9-W10 elephant pair, the W14 undead elephant
// rebirth, and the W19 hellhound demon swarm.
const BEAST_ENEMY_TYPES = new Set<EnemyType>([
  EnemyType.FERAL_DOG,
  EnemyType.RABID_DOG,
  EnemyType.ALPHA_DOG,
  EnemyType.DEMON_HELLHOUND,
  EnemyType.WAR_ELEPHANT,
  EnemyType.UNDEAD_WAR_ELEPHANT,
]);

// Tower types that fight in melee (no projectile, instant damage with slash VFX).
const MELEE_TYPES = new Set<TowerType>([
  TowerType.MILITES, TowerType.HASTATI, TowerType.TRIARIUS, TowerType.CENTURION,
  TowerType.PRIMUS_PILUS, TowerType.HORSEMAN, TowerType.COHORT_GUARD, TowerType.PRAETORIAN_WALL,
  TowerType.AUXILIA, TowerType.ACCENSUS, TowerType.PUGIO_ASSASSIN, TowerType.CATAPHRACT,
  TowerType.EVOCATUS, TowerType.IMPERATOR_GUARD,
  TowerType.VEXILLATION, TowerType.TRIUMPHATOR, TowerType.TRIPLEX_ACIES,
  TowerType.TURMA_LANCERS,
  // 2026-05-17 — Pontifex Maximus converted to melee. The High Priest now
  // wields a sanctified ritual blade; the Rite of Doom + Hellfire curse
  // applies on melee strike rather than from divine range.
  TowerType.PONTIFEX_MAXIMUS,
  // 2026-05-17 — Beast-hunter pair (T1 + T2). Dual-blade gladiators
  // specializing in killing animals; standalone (no combo recipes).
  TowerType.BEAST_HUNTER, TowerType.BEAST_SLAYER,
  // 2026-05-17 v2 — Librator (T3 base) + War Chariot (T2 combo)
  // reclassified to melee per design feedback. Librator now wields a
  // polearm (the historical librator carried sling + dagger; we lean
  // into the dagger here for the melee identity), War Chariot rolls
  // adjacent to the path like Horseman / Turma Lancers. Both keep
  // range 2.0 (polearm reach) so they stay useful as second-rank melee.
  TowerType.LIBRITOR, TowerType.WAR_CHARIOT,
  // 2026-05-17 v3 — Draconarius (T4 combo) now melee. The dragon-
  // standard bearer charges into close range with a fire-breath cone
  // at polearm reach 2.0 instead of standing back. DRAGON MARK + cone
  // damage + proximity burn aura intact; just routed through the
  // melee swing path (slash arc + melee sword SFX).
  TowerType.SIGNIFERS_DRACONARIUS,
  // RETIARIUS (renamed from LANCEARIUS in 2026-05 v9 along with a sprite
  // swap to the trident+net gladiator) and CLIBANARIUS are both melee.
  // Retiarius keeps the first-hit ×2 signature (now flavored as the net
  // pinning the target before the trident strike) and Armor Shred on
  // every hit. Clibanarius is the Roman heavy cavalry shock unit.
  TowerType.RETIARIUS, TowerType.CLIBANARIUS,
  // 2026-05-15 CRITICAL FIX: BESTIARIUS was missing from this set so
  // every melee gating (isMeleeRange, isMelee in pickTarget, isMeleeRow
  // in tickCombat) read false. It fell into the ranged else-branch with
  // no PROJ_FOR_TOWER entry — spawned no projectile, applied no damage,
  // never reached the fury gauge code. Adding it here flips on the
  // entire melee swing path including the FRENZY/STUN logic.
  TowerType.BESTIARIUS,
  // 2026-05-17 — MURMILLO (T4 mid-game combo). Roman heavy gladiator
  // with scutum + gladius; Punic Hunter damage bonus + Scutum Bash stun-
  // and-knockback every 4th swing. Pure melee, range 1.5.
  TowerType.MURMILLO,
  // 2026-05 v9: Consular Fatebinder converted from ranged DIVINE to a
  // melee strike (still keeps TRUE-damage primary + map-wide 60% splash
  // + global aura). The melee identity matches its character art (consul
  // brandishing the gladius) and makes positioning matter: it has to sit
  // on the lane to deliver the primary, but the splash still nukes
  // everyone everywhere — pure apex tower fantasy.
  TowerType.CONSULAR_FATEBINDER,
  // 2026-05 v9: God of War converted from ranged DIVINE to melee. Keeps
  // permanent HELLFIRE stamp, burning ground, 10% DIVINE EXECUTE, and
  // true damage — all hardcoded by tower type, no resist/damageType
  // dependency. Now has to sit on the lane to deliver the strike.
  TowerType.GOD_OF_WAR,
  // 2026-05 v9: Julius Caesar — gladius-wielding consul now strikes in
  // melee. Keeps +45% global damage aura and the 3s magisterial stun
  // pulse (pulse radius pinned to 5.5 tiles in the aura block so the
  // command-presence reach isn't tied to the sword's reach).
  TowerType.JULIUS_CAESAR,
  // 2026-05-19 — HERO_MARIUS is configured in towers.json as
  // `damageType: PHYS_MELEE`, `melee: true`, range 1.5 — but the
  // combat resolver gates the melee swing path on MELEE_TYPES set
  // membership (not the def's `melee` flag). Without this entry his
  // attacks fell through to the ranged else-branch — no projectile
  // ever shipped because there's no PROJ_FOR_TOWER entry for
  // HERO_MARIUS either, so he attacked invisibly. Adding him here
  // restores the slash-arc swing VFX + melee sword SFX + weather
  // range immunity + meleeHitsFlyers gating, same path every other
  // melee tower uses.
  TowerType.HERO_MARIUS,
  // 2026-05-19 v2 — HERO_CAESAR converted from ranged DIVINE to MELEE
  // DIVINE at range 1.6 to mirror the JULIUS_CAESAR combo tower's
  // post-v9 melee identity. The previous ranged build shipped a
  // PROJ_IMPERIAL_ORB projectile but enemies didn't visibly take
  // damage from it under live play — the projectile path made
  // damage feel disconnected. Converting to melee routes damage
  // through the direct-hit branch (target.hp -= damage) with the
  // gladius slash arc + sword swing SFX, plus a gold DIVINE impact
  // ring on every swing for the imperial flair. Caesar must now be
  // positioned next to the path like every other melee hero, but
  // his hits land reliably and the swing rhythm reads from any
  // distance.
  TowerType.HERO_CAESAR,
  TowerType.CHAMPION_MARIUS,
  TowerType.CHAMPION_CAESAR
]);

// Towers that ONLY hit flyers — useless on ground waves, devastating on air ones.
export const ANTI_AIR_ONLY_TYPES = new Set<TowerType>([
  TowerType.AQUILA_VENATOR,
  // 2026-05 v7: Sagittarius converted to anti-air specialist. Heavier
  // base damage to compensate for losing ground targets. Its +45%-vs-
  // flyer modifier (per-tower bonus below) stacks on top.
  TowerType.SAGITTARIUS,
  // 2026-05-19 v3 — Numidian Cavalry (displayed as "Eques") converted
  // from generalist anti-air-leaning to flyer-only apex combo per
  // user direction. Recipe now pairs the two flyer-only base towers
  // (Aquila Venator + Sagittarius) with the Decurion cavalry officer,
  // so the ingredients telegraph the anti-air identity. baseDps
  // bumped 34 → 85 in towers.json to compensate for losing every
  // ground target; the +40% vs-flyer rider was bumped to +75% (see
  // the damage-block per-tower bonuses below).
  TowerType.NUMIDIAN_CAVALRY
]);

// Cleave melee — these towers hit ALL enemies in their melee range per swing,
// not just one. Cleave damage on secondary targets is reduced to 70%.
const CLEAVE_MELEE = new Set<TowerType>([
  TowerType.HASTATI, TowerType.TRIARIUS, TowerType.COHORT_GUARD,
  TowerType.PRAETORIAN_WALL, TowerType.IMPERATOR_GUARD,
  TowerType.VEXILLATION, TowerType.TRIUMPHATOR, TowerType.TRIPLEX_ACIES
]);

// 2026-05-15 cleave/multi-shot item helpers. The FALX_BLADE item adds
// cleave to any melee tower; native cleavers also get an upgrade from
// the standard 0.70 secondary multiplier to 0.90 (item-buff stacks on
// top of native cleave). VOLLEY_QUIVER adds +1 shot to any ranged
// tower's multi-shot count.
export function hasCleave(t: Tower): boolean {
  // 2026 v2 — every HERO gets cleave on melee strikes (ranged heroes get
  // projectile splash via ProjectileSystem instead).
  return CLEAVE_MELEE.has(t.type) || t.equippedItems.includes('FALX_BLADE') || !!t.isHero;
}
// Maximum targets a melee tower can hit per swing (primary + cleave
// secondaries). FALX_BLADE extends the cap by +2 since its identity is
// "wide arcing swing." Item-only cleavers without FALX hit only the
// default cap.
function meleeHitCap(t: Tower): number {
  const base = 6;
  const bonus = t.equippedItems.includes('FALX_BLADE') ? 2 : 0;
  return base + bonus;
}

function cleaveSecondaryMult(t: Tower): number {
  // Native cleave: 70% on secondaries. With FALX_BLADE equipped, bumps
  // to 90% — meaningful enough to justify the UNCOMMON slot but still
  // below primary damage. Non-native cleavers (item-only) also start
  // at 60% so they're a step below natives without the item.
  if (CLEAVE_MELEE.has(t.type)) {
    return t.equippedItems.includes('FALX_BLADE') ? 0.90 : 0.70;
  }
  // Item-only cleaver (not native): secondaries take 60%.
  return 0.60;
}
function multiShotCountFor(t: Tower): number {
  const base = MULTI_SHOT_COUNT[t.type] ?? 1;
  const bonus = t.equippedItems.includes('VOLLEY_QUIVER') ? 1 : 0;
  return base + bonus;
}
// 2026-05-15 anti-demon damage multiplier from SIGIL_OF_SOL_INVICTUS.
// Returns 1.85 if the tower has the sigil AND target is in the demon
// roster; otherwise 1. Demon roster pulled from the SUPER_DEMONS
// faction roster — Hellhound, Fire Demon, Shadow Cavalry, Demon
// Legate, Daemon Imperator.
const DEMON_TYPES = new Set([
  'DEMON_HELLHOUND', 'CELTIC_FIRE_DEMON', 'SHADOW_CAVALRY',
  'DEMON_LEGATE', 'DAEMON_IMPERATOR'
]);
function sigilOfSolMult(t: Tower, target: Enemy): number {
  if (!t.equippedItems.includes('SIGIL_OF_SOL_INVICTUS')) return 1;
  return DEMON_TYPES.has(target.type as string) ? 1.85 : 1;
}

// 2026-05-23 — SECONDARY HIT BLOCK ROLL. Re-runs the dodge / W8-block /
// shield-block / all-attack-block rolls for damage paths that bypass
// tickCombat's primary block-roll: cleave secondaries, splash, cone
// sweeps, multi-shot non-primary targets. Without this, UNDEAD_SPEARMAN
// + IRON_PHALANX's allAttackBlockChance and W8's __w8RangedBlock would
// only fire on the very first target of every attack; the splash / cone
// / cleave sprays would land for full no matter how many block flags
// the enemy had stamped on it.
//
// Returns true if the hit is blocked. Caller is expected to set
// `target.__weatherMissTick` and skip damage application.
function secondaryHitBlocked(t: Tower, target: Enemy, state: GameStateShape): boolean {
  if (target.hp <= 0) return false;
  const isRangedClass = t.damageType === DamageType.PHYS_RANGED || t.damageType === DamageType.SIEGE;
  // Per-enemy permanent dodge (Numidian Rider, Shadow Cavalry) — ranged only.
  const dodgeChance: number = (enemiesData as any)[target.type]?.dodgeChance ?? 0;
  if (dodgeChance > 0 && isRangedClass && Math.random() < dodgeChance) return true;
  // W8-only ranged block — every W8 spawn gets a 20% per-hit ranged whiff.
  const w8Block: number = (target as any).__w8RangedBlock ?? 0;
  if (w8Block > 0 && isRangedClass && Math.random() < w8Block) return true;
  // Shield block — Carthage Elite Guard, Undead Spearman — until shield broken.
  const shieldBlockChance: number = (enemiesData as any)[target.type]?.shieldBlockChance ?? 0;
  if (shieldBlockChance > 0 && !target.shieldBroken && isRangedClass &&
      Math.random() < shieldBlockChance) return true;
  // All-attack block — UNDEAD_SPEARMAN, IRON_PHALANX — fires on ANY type.
  const allBlockChance: number = (enemiesData as any)[target.type]?.allAttackBlockChance ?? 0;
  if (allBlockChance > 0 && Math.random() < allBlockChance) return true;
  return false;
}

// Multi-shot ranged — fires N projectiles at N distinct targets per attack.
// Eques already fires at ground+air; Scorpion Bolt fires a 3-bolt spread.
const MULTI_SHOT_COUNT: Partial<Record<TowerType, number>> = {
  [TowerType.SCORPION_BOLT]: 3,
  [TowerType.NUMIDIAN_CAVALRY]: 3,   // 2 → 3 (2026-05-15 v2 buff): TRIPLE VOLLEY upgrade
  [TowerType.DECURION]: 2,
  [TowerType.CARROBALLISTA]: 2,
  [TowerType.HANNIBALS_NIGHTMARE]: 2,
  [TowerType.AURORA_LEGION]: 4,                // pierces 4 in line (2026-05 v11 buff)
  [TowerType.CARTHAGE_SCOURGE]: 6              // SIX-bolt volley
};

// Process all towers vs enemies for one frame.
export function tickCombat(state: GameStateShape, dt: number, hooks: CombatHooks) {
  // Stash state on window so the pushStatus helper (and other free functions)
  // can read live tower data without changing every signature. Cheap and safe.
  (window as any).__lastState = state;
  // Sort towers by placement age for deterministic kill credit (oldest first).
  // Pending towers (Gem TD pre-keep) don't fight.
  const towers = Array.from(state.towers.values()).filter(t => !t.pending).sort((a, b) => a.placedAtWave - b.placedAtWave);

  // ─── TRUESIGHT REVEAL (2026-05-22 V23, reworked 2026-05-23) ───────────
  // TRUESIGHT_LENS (item) used to be a global "everyone sees every stealth
  // enemy" toggle as long as one copy existed on the map. Per user
  // direction: "If a tower has the ability to see stealth enemies due to
  // the item that allows them to see stealth enemies, once they are seen,
  // they are now able to be seen by all towers for the rest of the wave."
  //
  // New model:
  //   1. Each frame, every truesight tower scans its own range. Any enemy
  //      inside (regardless of veil state) gets tagged `__truesightRevealed
  //      = true`. The tag persists for the rest of the wave — the
  //      EnemySystem spawn path doesn't reset it, and the per-frame stealth
  //      update only flips `__veiled`, not the reveal tag.
  //   2. The targeting filter checks `e.__truesightRevealed` (per-enemy)
  //      instead of `__truesightActive` (global), so non-truesight towers
  //      gain the ability to acquire ONLY the enemies that have crossed
  //      the truesight tower's threshold.
  //   3. Enemies that enter range one by one get revealed in order.
  //
  // Implication: a single truesight tower no longer auto-reveals every
  // stealth enemy on the map. You need actual range coverage. The pay-off
  // is that everyone behind the truesight tower benefits too.
  // 2026-05-24 perf: scan truesight towers with squared-distance compare
  // (skip sqrt) and iterate `state.enemies.values()` directly without
  // materialising an Array.from snapshot. Per-frame alloc → zero. With
  // ~200 enemies × 1-2 truesight towers, this trims ~200 hypots/frame
  // = 12K/sec plus a per-frame array alloc.
  let truesightCount = 0;
  for (const tw of towers) {
    if (tw.equippedItems.includes('TRUESIGHT_LENS')) {
      truesightCount++;
      const stats = towerEffectiveStats(tw);
      const tx = tw.tileX * GRID.TILE + GRID.TILE / 2;
      const ty = tw.tileY * GRID.TILE + GRID.TILE / 2;
      const rPx = stats.range * GRID.TILE;
      const rPx2 = rPx * rPx;
      for (const e of state.enemies.values()) {
        if ((e as any).__truesightRevealed) continue;
        const dx = e.x - tx;
        const dy = e.y - ty;
        if (dx * dx + dy * dy <= rPx2) (e as any).__truesightRevealed = true;
      }
    }
  }
  (state as any).__truesightActive = truesightCount > 0;     // legacy flag for render hooks

  // SUPPORT AURA scan (Vision §9 / build expression §12).
  // Eagle Standard:    global +18% damage, +10% atk speed within 4 tiles
  // Aquilifer Titan:   global +30% damage; enemies near it take +20% from all sources
  // Item: Centurion's Trumpet → 2-tile aura, +10% atk speed to nearby towers
  // Item: Battle Standard    → 2-tile aura, +8% damage to nearby towers
  // ─── ADDITIVE GLOBAL DAMAGE STACK ──────────────────────────────────────
  // Previously every global-aura tower (Eagle Standard, Aquilifer Titan,
  // Julius Caesar, Triumvirate, Consular Fatebinder) and the pool-level
  // bonus all multiplied together. Stacking 1.18 × 1.30 × 1.45 × 1.35 × 1.30
  // × 1.30 × 1.30 = 5.06× *before* per-tower buffs — which made late-game
  // DPS impossible to predict and trivialized many encounters.
  //
  // New model: collect everyone's CONTRIBUTION, sum them, apply once.
  // Pool +30% + EagleStandard +18% + AquiliferTitan +30% + JuliusCaesar +45%
  // + Triumvirate +35% + ConsularFatebinder +30% = 1 + 1.88 = 2.88× max,
  // a meaningful but legible cap.
  // Pool damage bonus — starts at pool level 2 (the FIRST upgrade past L1
  // is what grants damage). L0 and L1 = +0%, then +3% per level after that.
  // L10 caps at +27%. L1 only gives the probability shift, no damage.
  let globalDmgBonus = 0.03 * Math.max(0, (state.poolLevel ?? 0) - 1);
  let globalSpeedMult = 1;
  // ── HERO PASSIVE AURAS (2026-05-19, balance-tuned 2026-05-22 V19,
  // restored to +10% 2026-05-22 to match the hero card art) ──
  // Caesar: +10% damage and +10% attack speed for every tower while
  // he's active. (Earlier V19 trim took this 10→8 over a DPS audit,
  // but the baked-in card art reads "+10% dmg and +10% atk speed" so
  // the description card mismatched what the engine applied. Restored
  // to 10 to keep the card / passive description / engine math aligned.)
  // Scipio: +25% damage vs Bosses globally — applied later in the
  // damage resolution loop where target.isBoss is known. (Was +30% in
  // earlier builds, tuned to +25% in commit ~f959055.)
  const heroAuraSources: Array<{ heroId: string; tower: Tower }> = [];
  for (const t of towers) {
    const heroId = heroIdForTowerType(String(t.type));
    if (!heroId) continue;
    if (t.id === state.activeHeroTowerId || isMercatorChampionType(String(t.type))) {
      heroAuraSources.push({ heroId, tower: t });
    }
  }
  const activeHeroKinds = new Set(heroAuraSources.map(h => h.heroId));

  if (activeHeroKinds.has('HERO_CAESAR')) {
    globalDmgBonus += 0.10;
    globalSpeedMult *= 1.10;
  }
  const scipioActive = activeHeroKinds.has('HERO_SCIPIO');
  // 2026 v2 — Mars Victor fuses the 6 hero passives into one global buff while
  // it stands on the board (its own DPS is already capstone-tier). Computed
  // once; the dmg/speed halves apply in the aura loop below, the vs-boss +
  // melee-vs-flyers halves in the damage/targeting passes.
  const marsVictorActive = towers.some(t => t.type === TowerType.MARS_VICTOR);
  // Stash for pickTarget() (a separate function) so melee-vs-flyers can read it.
  (state as any).__marsVictorActive = marsVictorActive;
  // Resolve hero tower position ONCE for per-tower local-aura checks
  // below. Avoids a per-tower state.towers.get lookup.
  const localAuras: Array<{ x: number; y: number; r: number; dmg?: number; spd?: number }> = [];
  const enemyTakenAuras: Array<{ x: number; y: number; r: number; pct: number }> = [];
  // AURA NULLIFIER enemies (Architectus on W16): if alive AND within 2 tiles
  // of an aura-emitting tower, that tower's aura contributions are silently
  // skipped this tick. The aura comes back the instant the enemy walks out
  // of range. Periodic triggered effects (Hannibal/Carthage Scourge freeze
  // pulses, Caesar stun pulse) are NOT auras and still fire normally.
  const nullifierEnemies: { x: number; y: number }[] = [];
  for (const e of state.enemies.values()) {
    if (e.hp <= 0) continue;
    const def: any = (enemiesData as any)[e.type];
    if (def?.auraNullifier) nullifierEnemies.push({ x: e.x, y: e.y });
  }
  const NULLIFIER_RADIUS = 2 * GRID.TILE;
  function isAuraNullified(cx: number, cy: number): boolean {
    if (nullifierEnemies.length === 0) return false;
    for (const n of nullifierEnemies) {
      if (Math.hypot(n.x - cx, n.y - cy) <= NULLIFIER_RADIUS) return true;
    }
    return false;
  }
  for (const t of towers) {
    const cx = t.tileX * GRID.TILE + GRID.TILE / 2;
    const cy = t.tileY * GRID.TILE + GRID.TILE / 2;
    // Cache the per-tower suppression flag once per iteration.
    // 2026-05 v10 — DRUID SLEEP CURSE also drops auras: a sleeping
    // tower is "fully inert" per the design contract, which includes
    // its aura contributions. Same downstream flag (`auraOff`) so all
    // the existing `&& !auraOff` checks below cover both cases without
    // an additional gate per emitter.
    const asleep = (t.asleepUntil ?? 0) > state.tick;
    const auraOff = asleep || isAuraNullified(cx, cy);
    // Stamp on the tower so the render layer can dim the aura ring as a
    // visual cue that this tower is currently silenced.
    (t as any).__auraNullified = auraOff;
    if (t.type === TowerType.EAGLE_STANDARD && !auraOff) {
      // Aura-only support tower. Global damage 15% base (scales +5% per
      // tier — T5 lands at ~+19.5% global damage). Local atk-speed +18%
      // in 5 tiles. Stacks multiplicatively with same-tier-merge bonus,
      // items, and pool damage. Suppressed entirely if an aura-nullifier
      // enemy is within 2 tiles.
      globalDmgBonus += 0.15 * (1 + 0.05 * (t.qualityTier - 1));
      localAuras.push({ x: cx, y: cy, r: 5 * GRID.TILE, spd: 0.18 });
    }
    if (t.type === TowerType.AQUILIFER_TITAN && !auraOff) {
      globalDmgBonus += 0.30 * (1 + 0.05 * (t.qualityTier - 1));
      enemyTakenAuras.push({ x: cx, y: cy, r: 5 * GRID.TILE, pct: 0.20 });
    }
    if (t.type === TowerType.MARS_VICTOR && !auraOff) {
      // The fused war-god aura: Caesar's global tempo + the legions' offense,
      // granted to EVERY tower on the board (the vs-boss + melee-vs-flyers
      // halves of the fusion fire in the damage / targeting passes below).
      globalDmgBonus += 0.25;
      globalSpeedMult *= 1.15;
    }
    // JULIUS_CAESAR (2026-05 v6 audit fix): the +45% global damage aura
    // was only wired into the stat-breakdown UI, not the combat math.
    // Wire it into globalDmgBonus here so the aura actually fires. Also
    // pulse a 3s AoE stun and apply ARMOR_SHRED (~50% magnitude) on bosses
    // in range, matching the tower card's full ability text.
    if (t.type === TowerType.JULIUS_CAESAR) {
      // The +45% global damage aura is suppressed when nullified, but the
      // periodic 3s stun pulse below still fires under nullification —
      // it's a triggered AoE ability, not a continuous aura. SLEEP is
      // different: a sleeping Caesar can't pulse (he's asleep).
      if (!auraOff) globalDmgBonus += 0.45;
      const nextStun = (t as any).__nextCaesarStunTick ?? 0;
      if (state.tick >= nextStun && !asleep) {
        (t as any).__nextCaesarStunTick = state.tick + 3.0;
        // 2026-05 v9: Caesar is now a melee strike tower (range 1.5),
        // but the magisterial stun pulse is the COMMAND PRESENCE — a
        // shockwave that should keep its original ~5.5-tile authority
        // regardless of the gladius reach. Hardcoded so making him
        // melee doesn't accidentally shrink his signature ability.
        const r = 5.5 * GRID.TILE;
        for (const e of state.enemies.values()) {
          if (e.hp <= 0) continue;
          if (Math.hypot(e.x - cx, e.y - cy) <= r) {
            pushStatus(e, StatusEffectKind.STUN, 0.8, 0, t.qualityTier);
            if (e.isBoss) pushStatus(e, StatusEffectKind.ARMOR_SHRED, 3, 0, t.qualityTier);
          }
        }
      }
    }
    if (t.type === TowerType.TRIUMVIRATE && !auraOff) {
      // TRIPLE-AURA: +35% global dmg, +25% global atk speed, +25% enemy taken globally.
      globalDmgBonus += 0.35;
      globalSpeedMult *= 1.25;
      enemyTakenAuras.push({ x: cx, y: cy, r: 999 * GRID.TILE, pct: 0.25 });
    }
    if (t.type === TowerType.IMPERIUM_ETERNUM && !auraOff) {
      // APEX: +20% atk speed aura globally.
      globalSpeedMult *= 1.20;
    }
    // 2026-05 audit pass: tower UI claims these auras; wire them up.
    if (t.type === TowerType.TRIARIUS && !auraOff) {
      // "+12% global damage aura" per tower card.
      globalDmgBonus += 0.12;
    }
    if (t.type === TowerType.COHORT_GUARD && !auraOff) {
      // "+15% damage aura" — implement as local 3-tile to keep positioning relevant.
      localAuras.push({ x: cx, y: cy, r: 3 * GRID.TILE, dmg: 0.15 });
    }
    // HANNIBALS_NIGHTMARE — periodic AoE freeze every 10s.
    if (t.type === TowerType.HANNIBALS_NIGHTMARE) {
      const next = (t as any).__nextNightmareFreezeTick ?? 0;
      if (state.tick >= next && !asleep) {
        (t as any).__nextNightmareFreezeTick = state.tick + 10.0;
        const r = (t.range ?? 6.5) * GRID.TILE;
        for (const e of state.enemies.values()) {
          if (e.hp <= 0) continue;
          if (Math.hypot(e.x - cx, e.y - cy) <= r) {
            pushStatus(e, StatusEffectKind.FREEZE, 1.5, 0, t.qualityTier);
          }
        }
      }
    }
    // CARTHAGE_SCOURGE — periodic AoE freeze every 8s.
    if (t.type === TowerType.CARTHAGE_SCOURGE) {
      const next = (t as any).__nextScourgeFreezeTick ?? 0;
      if (state.tick >= next && !asleep) {
        (t as any).__nextScourgeFreezeTick = state.tick + 8.0;
        const r = (t.range ?? 7) * GRID.TILE;
        for (const e of state.enemies.values()) {
          if (e.hp <= 0) continue;
          if (Math.hypot(e.x - cx, e.y - cy) <= r) {
            pushStatus(e, StatusEffectKind.FREEZE, 1.5, 0, t.qualityTier);
          }
        }
      }
    }
    // FROZEN_LEGION — GLACIAL PULSE: every 10s, freeze EVERY enemy on the
    // field for 2.5s, no range cap. This is the headline mechanic of the
    // combo (separate from its per-hit freeze, which lands in the
    // per-tower status-effect switch below). Pairs with the global Frozen
    // Synergy rule (frozen enemies take +50% damage from all sources), so
    // a single Frozen Legion on the field turns every 10-second window
    // into a battlefield-wide damage amp. Tower-tier scales the FREEZE
    // duration via pushStatus.
    if (t.type === TowerType.FROZEN_LEGION) {
      const next = (t as any).__nextFrozenLegionPulseTick ?? 0;
      if (state.tick >= next && !asleep) {
        (t as any).__nextFrozenLegionPulseTick = state.tick + 10.0;
        for (const e of state.enemies.values()) {
          if (e.hp <= 0) continue;
          pushStatus(e, StatusEffectKind.FREEZE, 2.5, 0, t.qualityTier);
        }
      }
    }
    // SUPER COMBOS — 5-base-tower mega recipes
    if (t.type === TowerType.TRIPLEX_ACIES && !auraOff) {
      // +20% atk-speed aura to towers within 3 tiles.
      localAuras.push({ x: cx, y: cy, r: 3 * GRID.TILE, spd: 0.20 });
    }
    if (t.type === TowerType.LEGION_PRIME && !auraOff) {
      // +25% damage aura to towers within 3 tiles.
      localAuras.push({ x: cx, y: cy, r: 3 * GRID.TILE, dmg: 0.25 });
    }
    if (t.type === TowerType.CONSULAR_FATEBINDER && !auraOff) {
      // APEX OF APEXES: +30% global atk speed, +30% global damage.
      globalSpeedMult *= 1.30;
      globalDmgBonus += 0.30;
    }
    // Item auras — same suppression rule. If a nullifier enemy is within
    // 2 tiles of THIS tower, the tower's item aura silently drops out.
    if (t.equippedItems.includes('CENTURIONS_TRUMPET') && !auraOff) {
      localAuras.push({ x: cx, y: cy, r: 2 * GRID.TILE, spd: 0.12 });
    }
    if (t.equippedItems.includes('BATTLE_STANDARD') && !auraOff) {
      localAuras.push({ x: cx, y: cy, r: 2 * GRID.TILE, dmg: 0.10 });
    }
    if (t.equippedItems.includes('WAR_HOUND_COLLAR') && !auraOff) {
      localAuras.push({ x: cx, y: cy, r: 2.5 * GRID.TILE, spd: 0.18 });
    }
    if (t.equippedItems.includes('DRUIDS_TORC') && !auraOff) {
      localAuras.push({ x: cx, y: cy, r: 2.5 * GRID.TILE, dmg: 0.18 });
    }
    if (t.equippedItems.includes('BARCA_WAR_HORN') && !auraOff) {
      localAuras.push({ x: cx, y: cy, r: 3 * GRID.TILE, dmg: 0.12, spd: 0.10 });
    }
    if (t.equippedItems.includes('LICH_GENERALS_SEAL') && !auraOff) {
      localAuras.push({ x: cx, y: cy, r: 3 * GRID.TILE, dmg: 0.12, spd: 0.15 });
    }
    if (t.equippedItems.includes('CURSED_TORC') && !auraOff) {
      enemyTakenAuras.push({ x: cx, y: cy, r: 2 * GRID.TILE, pct: 0.18 });
    }
    if (t.equippedItems.includes('AQUILIFER_BANNER') && !auraOff) {
      localAuras.push({ x: cx, y: cy, r: 2.5 * GRID.TILE, dmg: 0.14, spd: 0.10 });
    }
    // 2026-05-18 — OPTIO_WHISTLE (Epic): +12% attack speed aura, 2-tile
    // radius. Drill-master's command — gives allies the crisp tempo
    // boost without a damage bonus. Cheap, broadly useful, sits cleanly
    // below Centurion's Trumpet's RARE version (+12% spd same radius
    // but different family).
    if (t.equippedItems.includes('OPTIO_WHISTLE') && !auraOff) {
      localAuras.push({ x: cx, y: cy, r: 2 * GRID.TILE, spd: 0.12 });
    }
    // 2026-05-18 — EVENT-EXCLUSIVE AURAS.
    // NECROMANCERS_LANTERN (uprising): enemies in 3 tiles take +25%
    // damage from all sources. Regen-block is enforced separately
    // in EnemySystem via the existing __regenBlocked flag (set below
    // when this aura is active).
    // HELLGATE_BRAND immunity to silence/tower-slow is set on the
    // tower as __silenceImmune so EnemySystem's silence loop skips it.
    // INFERNO_STANDARD: +25% damage aura, 3 tiles. Burn-on-hit handled
    // in the on-hit pass.
    if (t.equippedItems.includes('NECROMANCERS_LANTERN') && !auraOff) {
      enemyTakenAuras.push({ x: cx, y: cy, r: 3 * GRID.TILE, pct: 0.25 });
    }
    if (t.equippedItems.includes('INFERNO_STANDARD') && !auraOff) {
      localAuras.push({ x: cx, y: cy, r: 3 * GRID.TILE, dmg: 0.25 });
    }
    // SCOUT_VEXILLUM — every 4 seconds, mass-mark every enemy in range.
    if (t.type === TowerType.SCOUT_VEXILLUM) {
      const next = (t as any).__nextMarkTick ?? 0;
      if (state.tick >= next && !asleep) {
        (t as any).__nextMarkTick = state.tick + 4.0;
        const r = (t.range ?? 4.8) * GRID.TILE;
        for (const e of state.enemies.values()) {
          if (e.hp <= 0) continue;
          if (Math.hypot(e.x - cx, e.y - cy) <= r) {
            pushStatus(e, StatusEffectKind.MARK, 4.5, 0.20, t.qualityTier);
          }
        }
      }
    }
    // SACER_VESTAL — passive sanctum: nothing to push here (status durations
    // are doubled at apply time inside pushStatus when the target is in range).
  }
  // Cache effective multipliers per tower
  const towerDmgMult = new Map<string, number>();
  const towerSpeedMult = new Map<string, number>();
  // Convert the additive bonus to a single multiplier here so the existing
  // per-tower aura math (which stays multiplicative for LOCAL auras) reads
  // the same `dm` variable downstream without further refactor.
  const globalDmgMult = 1 + globalDmgBonus;
  // 2026-05 v7: AURA STACKING CAP. Auras stack multiplicatively as before
  // (multiple sources compound rather than override), but the combined
  // damage and speed multipliers from ALL aura sources (global + local)
  // are capped at 2.00× per tower. Players who stack Eagle Standard +
  // Aquilifer Titan + Triumvirate + Julius Caesar + Imperium Eternum +
  // Druid's Torc + Lich General's Seal + Barca War Horn + Battle Standard
  // were previously hitting 4-6× combined multipliers, trivializing
  // encounters. The +100% cap (2.00× total) keeps aura stacking
  // meaningful without breaking the game's damage curve.
  const AURA_CAP = 2.00;
  for (const t of towers) {
    let dm = globalDmgMult;
    let sm = globalSpeedMult;
    const cx = t.tileX * GRID.TILE + GRID.TILE / 2;
    const cy = t.tileY * GRID.TILE + GRID.TILE / 2;
    for (const a of localAuras) {
      if (Math.hypot(a.x - cx, a.y - cy) <= a.r) {
        if (a.dmg) dm *= 1 + a.dmg;
        if (a.spd) sm *= 1 + a.spd;
      }
    }
    // ── HERO LOCAL AURAS (2026-05-19) ────────────────────────────────
    // Mirrors the Cohort-Guard distance scan above but filters by the
    // tower's damage type. Hero must be placed (heroTowerForAura set)
    // for any of these to fire. Skip the hero itself.
    for (const source of heroAuraSources) {
      if (t.id === source.tower.id) continue;
      const sx = source.tower.tileX * GRID.TILE + GRID.TILE / 2;
      const sy = source.tower.tileY * GRID.TILE + GRID.TILE / 2;
      const dh = Math.hypot(sx - cx, sy - cy);
      if (source.heroId === 'HERO_MARIUS'
          && t.damageType === DamageType.PHYS_MELEE
          && dh <= 5 * GRID.TILE) {
        dm *= 1.30;
      }
      if (source.heroId === 'HERO_AGRIPPA'
          && t.damageType === DamageType.SIEGE
          && dh <= 5 * GRID.TILE) {
        dm *= 1.30;
      }
      // 2026-05-22 — Agricola local +20% ranged-tower damage aura
      // removed per user feedback that it stacked too strongly with
      // the global anti-air passive. He now contributes ONLY the
      // "melee can hit flyers" global effect, no per-tower damage
      // multiplier. Kept the surrounding `if heroTowerForAura` scaffold
      // intact for Marius/Agrippa/Sulla which still use local auras.
      // 2026-05-22 V19 — SULLA PASSIVE BALANCE ADJUSTMENT. Original
      // V92 rework dropped the damage rider entirely (TYPE-only), which
      // left Sulla as the only hero whose passive contributed zero
      // damage value to its aura targets. The balance audit (V19) put
      // him as the weakest of the 6 by a wide margin. Restored as a
      // smaller +15% rider on top of the FIRE conversion (not the old
      // +35%) and bumped the radius 2 → 3 tiles for parity with the
      // other local-aura heroes at that time. 2026-05-24 audit note —
      // Marius + Agrippa were since rebumped to 5 tiles (task #222) and
      // Agricola is GLOBAL (no local aura at all); Sulla still sits at
      // 3 tiles by design (his FIRE-conversion is more impactful than
      // a flat damage rider, so the smaller radius is the balance lever).
      // Type conversion still happens at the per-attack site below.
      if (source.heroId === 'HERO_SULLA' && dh <= 3 * GRID.TILE) {
        dm *= 1.15;
      }
    }
    // Marian Formation per-tower stamp: N nearest melee get +X% speed,
    // +Y% damage, and shared-crit access during the window. Crit comes
    // from the Tower's own crit application later; here we compound
    // speed + damage.
    // 2026-05-22 — Damage rider added (was speed-only). Drives the
    // new dmgBonusPercent param on the ability.
    const marianUntil = (t as any).__marianFormationUntilTick ?? 0;
    if (state.tick < marianUntil) {
      const sMult = (t as any).__marianSpeedMult ?? 1.0;
      const dMult = (t as any).__marianDmgMult ?? 1.0;
      sm *= sMult;
      dm *= dMult;
    }
    // 2026-05-21 — Tier-3 ability windows removed (Ides of March,
    // Battle of Actium). Their speed-multiplier readers used to live
    // here; deleted with the abilities. Cap the aggregate aura
    // multipliers at 2.00× (max +100% bonus).
    if (dm > AURA_CAP) dm = AURA_CAP;
    if (sm > AURA_CAP) sm = AURA_CAP;
    towerDmgMult.set(t.id, dm);
    towerSpeedMult.set(t.id, sm);
  }
  // ─── FACTION WEATHER PENALTIES ──────────────────────────────────────
  // Read once per frame and apply uniformly to every tower attack this tick.
  const weather = state.weatherKey ? FACTION_WEATHER[state.weatherKey] : null;
  const wInt = state.weatherIntensity ?? 1;
  const wMissChance       = weather ? weather.missChance       * wInt : 0;
  const wRangePenalty     = weather ? weather.rangePenalty     * wInt : 0;
  const wAtkSpeedPenalty  = weather ? weather.attackSpeedPenalty * wInt : 0;
  const enemies = Array.from(state.enemies.values());
  if (enemies.length === 0) {
    for (const t of towers) t.attackCooldown = Math.max(0, t.attackCooldown - dt);
    return;
  }

  for (const t of towers) {
    if (t.damageType === DamageType.NONE) continue; // pure support
    // 2026-05 v9 — DRUID SLEEP CURSE: towers hit by a druid's sleep dart
    // are fully inert until asleepUntil clears. Skip targeting, skip
    // shots, and DON'T decrement cooldown so the tower wakes up with
    // the same cooldown it slept with (the cooldown was already
    // clamped to >=3s by the sleep stamp anyway). We DO want the
    // facing rotation to stay frozen for visual coherence — the
    // sleeping tower shouldn't snap-rotate to a different enemy each
    // frame while it dreams.
    if ((t.asleepUntil ?? 0) > state.tick) {
      continue;
    }
    t.attackCooldown -= dt;
    // 2026-05-15 BESTIARIUS BEAST FURY decay: if the Bestiarius has been
    // sitting idle (no hit) for >4 s, reset its accumulated rage so the
    // FRENZY payoff has to be earned in a fresh streak. Same idea as
    // Triumphator's NOVA counter, scoped to one target+tower pair.
    if (t.type === TowerType.BESTIARIUS) {
      const lastHit = (t as any).__furyLastHitTick;
      if (typeof lastHit === 'number' && state.tick - lastHit > 4) {
        (t as any).__furyStacks = 0;
        (t as any).__furyTarget = undefined;
      }
    }
    // 2026-05-15 DRACONARIUS PROXIMITY BURN: the dragon-banner unit is
    // hot enough that any enemy within its 2-tile fire-radius is auto-
    // ignited every tick, regardless of whether the cone is firing.
    // Uses the BURN status the same way burn-patches do (6% maxHP/sec
    // tick via existing DoT pipeline), and refreshes the duration every
    // tick the enemy is in range so the burn never lapses. Throttled
    // to once per 0.5 s to avoid spamming pushStatus 60×/sec — burn is
    // a state, not a re-trigger.
    if (t.type === TowerType.SIGNIFERS_DRACONARIUS) {
      const lastTouch = (t as any).__lastFireAuraTick ?? -999;
      if (state.tick - lastTouch >= 0.5) {
        (t as any).__lastFireAuraTick = state.tick;
        const cx = tilePxX(t);
        const cy = tilePxY(t);
        const radPx = 2.0 * GRID.TILE;
        for (const enemy of state.enemies.values()) {
          if (enemy.hp <= 0) continue;
          // INTENTIONALLY do NOT skip __veiled enemies here — the entire
          // VEILED-BY-DOT wave mechanic relies on the Draconarius's
          // proximity burn being able to LAND on veiled foes and tick
          // the DoT that breaks their veil. Skipping veiled here would
          // make the Draconarius useless on Wave 11. The TARGETING
          // filter still skips veiled for normal attack acquisition;
          // only this passive burn ignores the veil.
          if (Math.hypot(enemy.x - cx, enemy.y - cy) > radPx) continue;
          // Apply / refresh BURN. Magnitude 0.06 = 6% maxHP/sec, matches
          // the JSON-tuned baseline. Use pushStatus so existing status
          // immunities + boss-mod work uniformly.
          pushStatus(enemy, StatusEffectKind.BURN, 2.0, 0.06, t.qualityTier);
        }
      }
    }
    const stats = towerEffectiveStats(t);
    // Weather: shrink effective range — but ONLY for ranged towers.
    // Melee towers are immune to weather range debuffs since otherwise
    // they'd be unable to reach passing enemies. 2026-05 v10: gate is
    // MELEE_TYPES membership (not range <= 1.5) because spear/lance
    // melee now sit at range 2.0 but should still get weather immunity.
    const isMeleeRange = MELEE_TYPES.has(t.type);
    const effRange = isMeleeRange
      ? stats.range
      : Math.max(1.5, stats.range - wRangePenalty);
    const target = pickTarget(state, t, enemies, effRange);
    if (!target) {
      // smooth idle rotation - leave as-is
      continue;
    }
    // face target
    t.rotation = Math.atan2(target.y - tilePxY(t), target.x - tilePxX(t));
    if (t.attackCooldown <= 0) {
      // 2026 v2 spec — attack-speed debuff = MAX of the continuous proximity
      // aura debuff and any TIMED ability debuff (Dive Bomb / Ground Slam /
      // Fire Breath / Shriek / Titan Stomp set __atkSpeedDebuffUntil + Pct via
      // applyTowerAtkSpeedDebuff). Take the worst, don't stack, so overlapping
      // sources can't zero a tower out.
      const auraDebuff = ((t as any).__auraSpeedDebuff ?? 0) as number;
      const timedDebuff = (state.tick < ((t as any).__atkSpeedDebuffUntil ?? 0))
        ? (((t as any).__atkSpeedDebuffPct ?? 0) as number) : 0;
      const debuff = Math.min(0.85, Math.max(auraDebuff, timedDebuff));
      const supportSpeed = towerSpeedMult.get(t.id) ?? 1;
      const supportDmg = towerDmgMult.get(t.id) ?? 1;
      // Weather: reduce attack speed
      const effSpeed = Math.max(0.05, stats.attackSpeed * (1 - debuff) * supportSpeed * (1 - wAtkSpeedPenalty));
      const interval = 1 / effSpeed;
      t.attackCooldown = interval;
      const perAttackBase = towerPerAttackDamageBase(t);
      const armorShred = target.statusEffects.some(s => s.kind === StatusEffectKind.ARMOR_SHRED);
      // 2026-05-19 — Proscription (Sulla Tier 2) overrides this attack's
      // damage type to DIVINE for the duration.
      let effectiveDmgType = t.damageType;
      // 2026-05-22 V19 — SULLA PASSIVE: any tower within 3 tiles of the
      // active Sulla hero converts its damage type to ELEMENTAL_FIRE
      // for this attack (bumped from 2 → 3 for cohort parity). The +15%
      // damage rider is applied earlier in the aura loop, so this block
      // only handles the type override. Applied BEFORE Proscription so
      // the ult's DIVINE override still wins during its window. Skips
      // the hero tower itself (Sulla is already FIRE; no-op). Skipped
      // when Sulla isn't the active hero or his tower isn't placed yet.
      const sullaSources = heroAuraSources.filter(h => h.heroId === 'HERO_SULLA' && h.tower.id !== t.id);
      if (sullaSources.length > 0) {
        const tcx2 = tilePxX(t), tcy2 = tilePxY(t);
        if (sullaSources.some(h => Math.hypot(tilePxX(h.tower) - tcx2, tilePxY(h.tower) - tcy2) <= 3 * GRID.TILE)) {
          effectiveDmgType = DamageType.ELEMENTAL_FIRE;
        }
      }
      const proscriptionUntil = (state as any).__proscriptionUntilTick ?? 0;
      if (state.tick < proscriptionUntil) effectiveDmgType = DamageType.DIVINE;
      let resMod: number;
      if (t.type === TowerType.MARS_VICTOR) {
        // 2026 v2 — Mars Victor strikes as BOTH Siege and Divine: resolve
        // against whichever type the target resists least, so it is never
        // walled by a single resistance.
        const rS = resistanceModifier(target.faction, DamageType.SIEGE, armorShred) * enemyDamageMultiplier(target, DamageType.SIEGE);
        const rD = resistanceModifier(target.faction, DamageType.DIVINE, armorShred) * enemyDamageMultiplier(target, DamageType.DIVINE);
        resMod = Math.max(rS, rD);
      } else {
        resMod = resistanceModifier(target.faction, effectiveDmgType, armorShred) * enemyDamageMultiplier(target, effectiveDmgType);
      }
      // 2026-05-21 — Battle of Actium resistance-bypass window
      // removed alongside the tier-3 ability deletion.
      // 2026-05 v9: post-W7 GROUND units get +25% ranged resistance — they
      // take 25% less damage from PHYS_RANGED + SIEGE. Forces the player
      // to diversify into melee or magic damage types from W8 onward.
      // (Gate was W8 prior to v9; moved up alongside the HP layer bump
      // because mid-game ground still felt too soft.) Bosses + flyers are
      // exempt (flyers are already a ranged-only problem; bosses have
      // their own scaling layer).
      if ((state.wave ?? 1) > 7 && !target.isBoss && !target.isFlyer &&
          (t.damageType === DamageType.PHYS_RANGED || t.damageType === DamageType.SIEGE)) {
        resMod *= 0.75;
      }
      if (t.equippedItems.includes('IRON_TIP') && (t.damageType === DamageType.PHYS_MELEE || t.damageType === DamageType.PHYS_RANGED) && resMod < 1) {
        resMod += (1 - resMod) * 0.2;
      }
      // 2026-05-20 — Per-wave resistance relief. If the current wave
      // carries a `resistReduction` value, bring the effective resMod
      // 15% closer to 1.0 — but only when the enemy is RESISTANT
      // (resMod < 1). Weaknesses (resMod > 1) are intentionally left
      // alone so this never *reduces* damage. Applied after every
      // other resistance layer so it captures the stack: faction
      // table × per-enemy modifier × Actium bypass × post-W7 +25%
      // ranged shield × IRON_TIP shred. Wave 8 currently uses 0.15.
      const waveResistReduction = RESIST_REDUCTION_BY_WAVE.get(state.wave ?? 1);
      if (waveResistReduction && resMod < 1) {
        resMod = 1 - (1 - resMod) * (1 - waveResistReduction);
      }
      // Aquilifer Titan vulnerability: +20% taken if enemy is near the Titan
      let takenMult = 1;
      for (const a of enemyTakenAuras) {
        if (Math.hypot(a.x - target.x, a.y - target.y) <= a.r) takenMult *= 1 + a.pct;
      }
      // LATE-WAVE DAMAGE SCALING (20-WAVE CAMPAIGN, 2026-05): mirrors the
      // ×1.50 per-cleared-boss HP step in WaveManager.effectiveWaveHpMult.
      // Without a matching tower buff, base/non-combo towers fall off
      // every 5 waves. We bump damage +50% per cleared 5-wave boss so
      // towers stay relevant through the final wave.
      const bossesCleared = Math.max(0, Math.floor(((state.wave ?? 1) - 1) / 5));
      const lateWaveDmgScale = Math.pow(1.50, bossesCleared);
      let damage = (perAttackBase * resMod * supportDmg * takenMult * lateWaveDmgScale) + t.killBonusFlat;
      damage *= campaignRelicDamageMult(state, t, target) * bossTrophyDamageMult(state, t, target) * commanderDamageTakenMult(state, target);
      // MARK debuff: marked targets take +mag% damage from ANY tower.
      const markS = target.statusEffects.find(s => s.kind === StatusEffectKind.MARK);
      if (markS) damage *= 1 + markS.magnitude;
      // 2026-05-21 — HARD-CC DAMAGE AMP. Frozen + stunned enemies take
      // +10% damage per status (additive: frozen+stunned = +20%). Only
      // applies to direct hits resolved in this CombatResolver path —
      // DoT ticks (BURN / POISON / BLEED / HELLFIRE) fire via
      // EnemySystem.ts (`e.hp -= dotDps * dt`) and bypass this chain
      // entirely, so DoTs do NOT benefit from the amp. Purpose: give
      // status-control builds (Augur, Frozen Legion, Stormcaller,
      // Imperator Guard, Librator, Naval Bombardment, etc.) a viable
      // late-game carry alternative to the DoT meta. Stacks
      // multiplicatively with MARK, ARMOR_SHRED resist relief, and
      // per-tower archetype bonuses below.
      let ccAmp = 0;
      if (target.statusEffects.some(s => s.kind === StatusEffectKind.FREEZE && s.remaining > 0)) ccAmp += 0.10;
      if (target.statusEffects.some(s => s.kind === StatusEffectKind.STUN   && s.remaining > 0)) ccAmp += 0.10;
      if (ccAmp > 0) damage *= (1 + ccAmp);
      // Per-tower archetype/role bonuses + signatures
      if (t.type === TowerType.RORARIUS && target.archetype === 'RUNNER') damage *= 1.35;
      if ((t.type === TowerType.SAGITTARIUS || t.type === TowerType.VENATOR) && target.isFlyer) damage *= 1.45;
      if (t.type === TowerType.AQUILA_VENATOR && target.isFlyer) damage *= 1.75;
      if (t.equippedItems.includes('FLYER_BANE') && target.isFlyer) damage *= 1.30;
      // 2026 v2 — anti-air item suite (any tower; range/speed halves live in TowerSystem).
      if (t.equippedItems.includes('SKYPIERCER_BOLTS') && target.isFlyer) damage *= 1.55;     // EPIC
      if (t.equippedItems.includes('JUPITERS_SKYFIRE') && target.isFlyer) damage *= 1.95;     // LEGENDARY nuke
      if (t.equippedItems.includes('STORM_AQUILA_TALONS') && target.isFlyer) damage *= 1.55;  // LEGENDARY enabler
      // 2026-05-17 — BEAST-BANE. Beast Hunter (T1) + Beast Slayer (T2)
      // deal +200% damage (×3 total) to animal-faction enemies: dogs
      // (Feral / Rabid / Alpha), Demon Hellhound, and both elephant
      // variants. Standalone early-game answer to the W1-W3 dog wave
      // and the W9-W10 + W14 elephant pressure. Stacks multiplicatively
      // with marks, items, and other riders.
      if ((t.type === TowerType.BEAST_HUNTER || t.type === TowerType.BEAST_SLAYER) && BEAST_ENEMY_TYPES.has(target.type)) {
        damage *= 3.0;
      }
      // 2026-05-17 — PUNIC HUNTER. The Murmillo gladiator's signature
      // anti-Carthage rage. +75% damage vs CARTHAGE faction (W7-W10 living
      // Punic columns) and +50% damage vs UNDEAD_CARTHAGE (W16-W18 risen
      // Sacred Band lines). Stacks multiplicatively with the faction
      // melee-resistance row (-30% for CARTHAGE, -25% for UNDEAD_CARTHAGE
      // = those factions already take more melee damage) and any item /
      // mark / aura multipliers. Other factions take normal damage from
      // the Murmillo, so this combo is a deliberate counter-pick — strong
      // on Punic Wars waves, fine elsewhere.
      if (t.type === TowerType.MURMILLO) {
        if (target.faction === EnemyFaction.CARTHAGE)              damage *= 1.75;
        else if (target.faction === EnemyFaction.UNDEAD_CARTHAGE)  damage *= 1.50;
      }
      // 2026-05-15 SIGIL OF SOL INVICTUS — +85% damage vs any Demon-
      // faction enemy. Anti-late-game-Super-Demons carry. Stacks
      // multiplicatively with other archetype riders and items.
      damage *= sigilOfSolMult(t, target);
      // 2026-05-15 TYRANT'S LAUREL legendary: +75% damage vs Bosses.
      // Dedicated boss-hunter item, occupies the DAMAGE slot. Stacks
      // multiplicatively with native per-tower boss bonuses (Primus
      // Pilus, Scorpio, Triumphator, Eques, etc.).
      if (t.equippedItems.includes('TYRANTS_LAUREL') && target.isBoss) damage *= 1.75;
      // 2026-05 v6 Mercator-exclusive items:
      if (t.equippedItems.includes('TYRIAN_DYE') && (target.archetype === 'ELITE' || target.isBoss)) {
        damage *= 1.25;
      }
      if (t.equippedItems.includes('SCIPIO_PLAYBOOK')) {
        // +20% vs the highest-HP enemy in this tower's range.
        let topHp = -1; let topId = '';
        const tcx0 = tilePxX(t), tcy0 = tilePxY(t), rPx0 = stats.range * GRID.TILE;
        for (const e of state.enemies.values()) {
          if (e.hp <= 0) continue;
          if (Math.hypot(e.x - tcx0, e.y - tcy0) > rPx0) continue;
          if (e.hp > topHp) { topHp = e.hp; topId = e.id; }
        }
        if (topId && target.id === topId) damage *= 1.20;
      }
      // BOSS-DAMAGE TROPHIES (2026-05): per-hit multipliers that only fire
      // against bosses. Stack multiplicatively if a tower somehow holds
      // multiple, but the family system already gates duplicates.
      if (target.isBoss && t.equippedItems.includes('ELEPHANT_TUSK'))        damage *= 1.30;
      if (target.isBoss && t.equippedItems.includes('WARLORDS_WAR_PAINT'))   damage *= 1.40;
      if (target.isBoss && t.equippedItems.includes('UNDEAD_ELEPHANT_BONE')) damage *= 1.50;
      // 2026-05-19 — AURA TILE: TYRANT TILE (RED). Tower on a red tile
      // deals +50% damage vs bosses. Stacks with the trophies above.
      if (target.isBoss && towerAuraTileKind(t) === 'RED') damage *= 1.50;
      // ── HERO PASSIVES + ABILITY WINDOWS (2026-05-19) ──────────────
      // Scipio passive: every tower deals +25% damage vs Bosses.
      // Tuned 30% → 25% to avoid runaway compound stacking with
      // Pontifex (3.0×), Tyrant's Laurel (1.75×), and the RED-tile
      // aura — the curve was producing 8× boss kills late-game.
      if (scipioActive && target.isBoss) damage *= 1.25;
      if (marsVictorActive && target.isBoss) damage *= 1.25;   // Mars Victor fuses Scipio's vs-boss passive
      // 2026-05-21 — Zama (Scipio tier-3) + Triumph (Marius tier-3)
      // damage windows removed alongside the tier-3 ability deletion.
      // The Scipio passive boss bonus above still fires; the per-
      // ability burst window is gone.
      // Frontier Wall (Agricola Tier 2): tower damage vs flyers
      // increases during window. Stacks with Eagle Scout's per-enemy
      // mark.
      const frontierUntil = (state as any).__frontierWallUntilTick ?? 0;
      if (state.tick < frontierUntil && target.isFlyer) {
        damage *= (state as any).__frontierWallVsFlyerDmgMult ?? 1.30;
      }
      // Eagle Scout (Agricola Tier 1): flyers carry an
      // __eagleScoutUntilTick + __eagleScoutDmgMult stamp for 3s.
      const eagleUntil = (target as any).__eagleScoutUntilTick ?? 0;
      if (state.tick < eagleUntil) {
        damage *= (target as any).__eagleScoutDmgMult ?? 1.60;
      }
      // 2026-05-18 — EVENT-EXCLUSIVE LEGENDARIES.
      //
      // INVASION rewards:
      //   • VANGUARD_PILUM: +35% damage (range +1 is applied in stats)
      //   • AQUILA_RAMPART: +50% damage vs enemies above 70% HP
      //   • PERIMETER_TORCH: +25% damage (atk speed in stats)
      if (t.equippedItems.includes('VANGUARD_PILUM')) damage *= 1.35;
      if (t.equippedItems.includes('AQUILA_RAMPART') && (target.hp / target.maxHp) > 0.70) damage *= 1.50;
      if (t.equippedItems.includes('PERIMETER_TORCH')) damage *= 1.25;
      //
      // UPRISING rewards:
      //   • GRAVEKEEPERS_SCYTHE: +60% damage vs UNDEAD-faction enemies
      //   • SOULFIRE_BRAND: HELLFIRE applied separately in attack-hook
      //   • NECROMANCERS_LANTERN: aura mark (applied via debuff loop)
      if (t.equippedItems.includes('GRAVEKEEPERS_SCYTHE')) {
        const fk = String(target.faction ?? '');
        // EnemyFaction enum stringifies to 'UNDEAD_CELTS' / 'UNDEAD_CARTHAGE'
        // for those factions; numeric enum values won't string-equal, so we
        // also accept the numeric form by checking target.type prefix as a
        // fallback for reanimated forms.
        const isUndead = fk === 'UNDEAD_CELTS' || fk === 'UNDEAD_CARTHAGE'
          || fk === '3' || fk === '4'
          || String(target.type ?? '').startsWith('REANIMATED_');
        if (isUndead) damage *= 1.60;
      }
      //
      // GATES OF HELL rewards:
      //   • HELLGATE_BRAND: +50% damage (atk speed in stats, silence imm in flag)
      //   • DEMONSWORN_CROWN: +100% vs demons, +50% vs bosses (stacks)
      //   • INFERNO_STANDARD: aura applied separately
      if (t.equippedItems.includes('HELLGATE_BRAND')) damage *= 1.50;
      if (t.equippedItems.includes('DEMONSWORN_CROWN')) {
        if (DEMON_TYPES.has(target.type as string)) damage *= 2.0;
        if (target.isBoss) damage *= 1.50;
      }
      if (t.type === TowerType.PRAEFECTUS && (target.archetype === 'ELITE' || target.archetype === 'BOSS')) damage *= 1.25;
      // ─── NEW COMBOS: identity damage multipliers ─────────────────────
      if (t.type === TowerType.NEMESIS_ENGINE && target.isFlyer) damage *= 3.0;          // SKY-RIPPER: +200% vs flyers
      if (t.type === TowerType.PONTIFEX_MAXIMUS && target.isBoss) damage *= 3.0;         // RITE OF DOOM: +200% vs bosses
      if (t.type === TowerType.AURORA_LEGION && target.archetype === 'ELITE') damage *= 1.50;   // 2026-05 v11: 1.30 → 1.50
      if (t.type === TowerType.CARTHAGE_SCOURGE && target.isBoss) damage *= 3.5;         // +250% vs bosses
      if (t.type === TowerType.TURMA_LANCERS && !target.isFlyer) damage *= 1.30;         // +30% vs ground
      // ─── 2026-05 AUDIT: damage modifiers claimed by tower UI ─────────
      if (t.type === TowerType.SCORPIO && target.isBoss) damage *= 1.40;                 // +40% vs Bosses
      // SCORPIO anti-air buff (2026-05-15): +30% vs Flyers, stacks
      // multiplicatively with the +40% boss bonus on flying bosses
      // (1.40 × 1.30 = 1.82× total). Heavy ballista bolt now reads as
      // a pierce-everything-large specialist — bosses + flyers both
      // take meaningful punishment from the slow-fire profile.
      if (t.type === TowerType.SCORPIO && target.isFlyer) damage *= 1.30;
      if (t.type === TowerType.HORSEMAN && !target.isFlyer) damage *= 1.20;              // +20% vs ground
      // FIRST SPEAR — Primus Pilus is THE boss-killer base tower. Tier-
      // scaled boss bonus so T4/T5 Primus Pilus genuinely flatten bosses.
      // 2026-05 v11 BOOST: boss-killer melee buffed across the board:
      //   T1-T3: +50% vs Bosses (was +25%)
      //   T4:    +125% vs Bosses (was +75%)
      //   T5:    +250% vs Bosses (was +150%)
      if (t.type === TowerType.PRIMUS_PILUS && target.isBoss) {
        const tier = (t as any).qualityTier ?? 1;
        const bossMult = tier >= 5 ? 3.50 : tier >= 4 ? 2.25 : 1.50;
        damage *= bossMult;
      }
      // 2026-05 v11: TRIUMPHATOR now also gets a meaningful vs-boss bonus
      // — fits "apex melee combo with nova + crit profile" identity. +40%
      // baseline, ramps with tier (combos roll up via merge ladder too).
      if (t.type === TowerType.TRIUMPHATOR && target.isBoss) {
        const tier = (t as any).qualityTier ?? 5;
        const bossMult = tier >= 5 ? 1.55 : 1.40;
        damage *= bossMult;
      }
      // SCORPION_BOLT — split into TWO distinct multipliers (2026-05-15 buff):
      // +35% vs Flyers + +50% vs Bosses, multiplicative. A flying boss
      // takes the full +102.5% stack (1.35 × 1.50 = 2.025×). Earlier
      // history: the +30% combined was trimmed to +12% in May 2026 v5
      // (too dominant on every flyer + boss wave). This pass restores
      // the specialist identity at higher per-archetype numbers but
      // keeps the multiplicative split so anti-Flyer and anti-Boss
      // contributions are independently auditable.
      if (t.type === TowerType.SCORPION_BOLT) {
        if (target.isFlyer) damage *= 1.35;
        if (target.isBoss)  damage *= 1.50;
      }
      if (t.type === TowerType.WAR_CHARIOT && target.isBoss) damage *= 1.50;             // +50% vs Bosses
      // CLIBANARIUS — mid-game COMBO retheme (2026-05-15 v13). Dedicated
      // boss hunter: +75% damage vs Bosses baseline. AND every 4th hit on
      // a Boss is a CHARGED LANCE EXECUTE that deals 3× the swing's
      // damage (the rhythm: 3 normal stabs → 1 thunderous lance strike).
      // Counter lives on the TOWER so each Clibanarius has its own
      // 4-attack cadence. Counter only ticks on boss hits.
      if (t.type === TowerType.CLIBANARIUS && target.isBoss) {
        damage *= 1.75;
        const hits = (((t as any).__clibanariusBossHits ?? 0) as number) + 1;
        (t as any).__clibanariusBossHits = hits;
        if (hits % 4 === 0) damage *= 3.0;
      }
      // CLIBANARIUS — BEAST RIDER (2026-05-20 v2). The heavy lance also
      // skewers four-legged beasts: +100% damage vs every enemy in the
      // BEAST_ENEMY_TYPES set (dogs, hellhound, war elephants — same
      // roster Beast Hunter / Beast Slayer use, so the beast definition
      // stays consistent across the gladiator family). Stacks with the
      // boss multiplier above on the rare flying-beast-boss case (none
      // currently exist in campaign — flag for future cross-overlap).
      if (t.type === TowerType.CLIBANARIUS && BEAST_ENEMY_TYPES.has(target.type)) {
        damage *= 2.0;
      }
      // HANNIBALS_NIGHTMARE — apex anti-siege T5. 2026-05-15 v3 (today):
      // the +200% anti-elephant hook now applies to BOTH living and undead
      // war elephants. Previously only WAR_ELEPHANT matched; the undead
      // variant got nothing despite being the same archetype. v2 also
      // layered an anti-Flyer multiplier (heavy javelins arc up at sky
      // targets) and a small anti-Boss bump. Each bonus is independent so
      // the combat tooltip can surface them line-by-line.
      if (t.type === TowerType.HANNIBALS_NIGHTMARE) {
        if (target.type === 'WAR_ELEPHANT' || target.type === 'UNDEAD_WAR_ELEPHANT') damage *= 3.0;   // +200% vs ALL elephant variants
        if (target.isFlyer)                 damage *= 1.60;  // +60% vs Flyers
        if (target.isBoss)                  damage *= 1.30;  // +30% vs Bosses
      }
      // 2026-05-17 — Frozen Synergy (+50% damage on frozen targets) removed
      // per user request. FREEZE is now purely a hard-stop crowd-control
      // effect: target locks in place for the full duration with no
      // additional damage amplification.
      // ─── DIFFERENTIATED RESIST-BREAKERS ──────────────────────────────
      // Three towers used to all "ignore resists" identically. Now each
      // has its own flavor so they don't dilute each other:
      //   IMPERIUM_ETERNUM      — main hit goes through normal resist; the
      //                           3-tile QUAKE on hit (in applyDamageAndStatus)
      //                           is the true-damage piece. Quake does the
      //                           apex damage; the primary projectile no longer
      //                           ignores resist.
      //   CONSULAR_FATEBINDER   — keeps universal TRUE damage as the apex
      //                           super-combo's defining trait.
      //   SOLAR_PRIEST          — only ignores ELEMENTAL resists (the
      //                           ELEMENTAL_FIRE / DIVINE / SIEGE families
      //                           that some demon factions stack), not
      //                           PHYS resists. Specialty, not universal.
      if (t.type === TowerType.CONSULAR_FATEBINDER) {
        damage = (perAttackBase * supportDmg * takenMult) + t.killBonusFlat;
      }
      if (t.type === TowerType.TRIBUNUS_LATICLAVIUS && target.archetype === 'ELITE') damage *= 1.20;
      if (t.type === TowerType.VEXILLATION) {
        // MOB CRUSHER: +18% damage per OTHER enemy in melee range, capped at +90%.
        let nearby = 0;
        for (const e of state.enemies.values()) {
          if (e.id === target.id || e.hp <= 0) continue;
          if (Math.hypot(e.x - t.tileX * GRID.TILE - GRID.TILE / 2, e.y - t.tileY * GRID.TILE - GRID.TILE / 2) <= 1.5 * GRID.TILE) nearby++;
        }
        damage *= 1 + Math.min(0.90, nearby * 0.18);
      }
      if (t.type === TowerType.PUGIO_ASSASSIN && target.archetype === 'RUNNER') damage *= 1.5;          // BACKSTAB
      if (t.type === TowerType.ACCENSUS && target.hp / target.maxHp > 0.85) damage *= 1.6;              // BRUTAL OPENER
      // 2026-05 v11 — DECURION EXECUTE: +250% damage vs enemies below 15% HP.
      // The execute multiplier stacks multiplicatively with the every-5th-hit
      // ×3 crit below, so a 5th-hit landing on a sub-15% target deals 10.5×
      // base — a real finisher swing. Bosses are guarded by isBoss so the
      // execute can't trivialize them (boss-HP fractions take longer to
      // reach 15% anyway, but explicit guard keeps the bonus honest).
      if (t.type === TowerType.DECURION && !target.isBoss && target.hp / target.maxHp < 0.15) damage *= 3.5;
      if (t.type === TowerType.SOLAR_PRIEST && resMod < 1) {
        // ELEMENTAL SPECIALIST: only ignores resist when the target was
        // RESISTING this tower's damage type. If the enemy is neutral or
        // weak, normal damage applies. Caps the cheese vs phys-resist races.
        damage = (perAttackBase * supportDmg * takenMult) + t.killBonusFlat;
      }
      // Periodic-burst signatures (every Nth attack)
      const hitN = (((t as any).__hitCount = ((t as any).__hitCount ?? 0) + 1));
      if (t.type === TowerType.DECURION && hitN % 5 === 0) damage *= 3;                                 // existing crit
      if (t.type === TowerType.SCORPIO && hitN % 5 === 0) damage *= 3;                                  // HEAVY BOLT
      if (t.type === TowerType.RETIARIUS && (t as any).__lastTargetId !== target.id) damage *= 2;      // TRIDENT & NET first-hit
      (t as any).__lastTargetId = target.id;
      // Eques crits = 3× per spec (2026-05 v11: rate 15% → 25%).
      // NUMIDIAN_CAVALRY signature crit (2026-05-15 v2 buff): 25%→30%.
      if (t.type === TowerType.NUMIDIAN_CAVALRY && Math.random() < 0.30) damage *= 3;
      // NUMIDIAN_CAVALRY ("Eques") rider — 2026-05-19 v3 converted to
      // FLYER-ONLY (membership in ANTI_AIR_ONLY_TYPES gates ground
      // targets out at the inRange filter). vs-Flyer bonus bumped
      // 1.40 → 1.75 (2026-05-19), then 1.75 → 2.10 (2026-05-25 per
      // user direction "make Eques 20% stronger against flyers" —
      // multiplicative on the existing rider, so +75% → +110% flat).
      // Anti-boss rider removed because the tower can't shoot ground
      // bosses anymore — only the rare flying-boss case would have
      // benefited, and the +110% vs flyers already amplifies those.
      // baseDps was simultaneously bumped 34 → 85 in towers.json to
      // pay for losing every ground target.
      if (t.type === TowerType.NUMIDIAN_CAVALRY && target.isFlyer) {
        damage *= 2.10;
      }
      // Evocatus tactical stacks: +5% per kill (cap 50%)
      if (t.type === TowerType.EVOCATUS) {
        const stacks = Math.min(10, ((t as any).__tacticalStacks ?? 0));
        damage *= 1 + stacks * 0.05;
      }
      // 2026-05 v7: Triumphator TRIUMPHAL WREATH — +1.5% damage per
      // kill this wave, capped at +30%. Stacks reset on wave start.
      if (t.type === TowerType.TRIUMPHATOR) {
        const wreath = Math.min(20, ((t as any).__triumphalWreath ?? 0));
        damage *= 1 + wreath * 0.015;
      }
      // Haruspex foresight: 20% chance to double-strike
      if (t.type === TowerType.HARUSPEX && Math.random() < 0.20) damage *= 2;
      // ─── PER-TOWER CRIT CHANCE ─────────────────────────────────────────
      // Each tower carries a baseline crit chance (set in towers.json). On
      // a crit roll, damage is multiplied by the tower's critMult. Strategic
      // dimension: scouts/skirmishers crit often for small bonuses; heavy
      // siege rarely but for huge multipliers; combo towers usually crit
      // higher than their base counterparts.
      const towerDef: any = (towersData as any)[t.type];
      let critChance = towerDef?.critChance ?? 0;
      const critMult   = towerDef?.critMult ?? 1.5;
      // 2026-05-20 — LEGION PRIME signature: +60% crit chance vs bosses.
      // Base critChance stays 20% on non-bosses; against any isBoss
      // target it caps at 80% (0.20 base + 0.60 bonus) so boss kills
      // feel like a real "heavy siege artillery breaks armor" moment.
      // Crit mult is 2.5 — so a Legion Prime boss-crit deals 2.5× the
      // already-AoE shell. Stacks with the slow/armor-shred on every
      // hit so the combined boss pressure is significant.
      if (t.type === TowerType.LEGION_PRIME && target.isBoss) {
        critChance = Math.min(1, critChance + 0.60);
      }
      // 2026-05-23 — MARIAN FORMATION shared crit. Marius's passive
      // ability stamps `__marianSharedCrit` (the highest crit chance
      // among the 5 nearest melee towers) on every buffed tower so a
      // low-crit T1 inherits Caesar's 50% during the 5-second window.
      // Without reading the flag here the ability docs lied — the
      // shared-crit promise was inert until 2026-05-23.
      const marianUntil = (t as any).__marianFormationUntilTick ?? 0;
      if (state.tick < marianUntil) {
        const shared = (t as any).__marianSharedCrit;
        if (typeof shared === 'number' && shared > critChance) critChance = shared;
      }
      if (critChance > 0 && Math.random() < critChance) {
        damage *= critMult;
        (t as any).__lastWasCrit = true;
      } else {
        (t as any).__lastWasCrit = false;
      }
      // WEATHER: miss chance — sets damage to 0 for this attack. Visual stays
      // (the projectile still flies), but no damage is applied on impact.
      const missed = wMissChance > 0 && Math.random() < wMissChance;
      if (missed) {
        damage = 0;
        // Mark the target so the on-hit hook can render a "MISS!" floater.
        (target as any).__weatherMissTick = state.tick;
      }
      // ENEMY DODGE (2026-05): Numidian Riders / Shadow Cavalry have a
      // dodgeChance flag. RANGED attacks only — melee can't be dodged.
      // Sets damage to 0 and flashes a "DODGED" floater color via the same
      // weather-miss path so the renderer treats it identically.
      const targetDodge: number = (enemiesData as any)[target.type]?.dodgeChance ?? 0;
      const dodged = !missed && targetDodge > 0 &&
                     (t.damageType === DamageType.PHYS_RANGED || t.damageType === DamageType.SIEGE) &&
                     Math.random() < targetDodge;
      if (dodged) {
        damage = 0;
        (target as any).__weatherMissTick = state.tick;
      }
      // W8 RANGED-BLOCK (2026-05-23): every enemy spawned on W8 carries
      // a 20% per-hit chance to block any PHYS_RANGED + SIEGE strike.
      // The flag is stamped at spawn time in EnemySystem.spawnEnemy. The
      // chance is independent of per-enemy `dodgeChance` and the
      // `shieldBlockChance` rolls below, so a Numidian Rider on W8
      // effectively whiffs ~32% of incoming ranged.
      const w8Block: number = (target as any).__w8RangedBlock ?? 0;
      const w8Blocked = !missed && !dodged && w8Block > 0 &&
                        (t.damageType === DamageType.PHYS_RANGED || t.damageType === DamageType.SIEGE) &&
                        Math.random() < w8Block;
      if (w8Blocked) {
        damage = 0;
        (target as any).__weatherMissTick = state.tick;
      }
      // SHIELD BLOCK (2026-05): shielded enemies (Carthage Elite Guard,
      // Undead Spearman) have a per-hit chance to deflect ranged / siege
      // attacks WHILE their shield is unbroken. Once a melee tower cracks
      // the shield (`shieldBroken: true`), the block chance is gone and
      // ranged fire lands normally — the design intent is "crack first
      // with melee, then volley". Different from dodge: shield block is
      // conditional on the shield, dodge is a permanent trait.
      const shieldBlockChance: number = (enemiesData as any)[target.type]?.shieldBlockChance ?? 0;
      const shieldBlocked = !missed && !dodged && !w8Blocked && shieldBlockChance > 0 && !target.shieldBroken &&
                            (t.damageType === DamageType.PHYS_RANGED || t.damageType === DamageType.SIEGE) &&
                            Math.random() < shieldBlockChance;
      if (shieldBlocked) {
        damage = 0;
        (target as any).__weatherMissTick = state.tick;
      }
      // ALL-ATTACK BLOCK (2026-05-23): some elite enemies (UNDEAD_SPEARMAN,
      // IRON_PHALANX) carry a per-hit chance to deflect ANY incoming
      // attack — ranged, melee, siege, fire, divine. Unlike
      // shieldBlockChance which only catches PHYS_RANGED + SIEGE while
      // the shield is intact, this fires across every damage type and
      // never expires. Stacks multiplicatively with the dodge / W8
      // block / shield-block rolls above. Per user: "Undead Spearmen and
      // Iron Flanks have a 20% chance to block all attacks."
      const allBlockChance: number = (enemiesData as any)[target.type]?.allAttackBlockChance ?? 0;
      const allBlocked = !missed && !dodged && !w8Blocked && !shieldBlocked && allBlockChance > 0 &&
                         Math.random() < allBlockChance;
      if (allBlocked) {
        damage = 0;
        (target as any).__weatherMissTick = state.tick;
      }
      t.attackFlash = 0.18;     // game-feel flash on every attack
      // Compute "in melee/range" enemies once for cleave + multi-shot lookups.
      const tcx = tilePxX(t);
      const tcy = tilePxY(t);
      const rPx = stats.range * GRID.TILE;
      const isMeleeRow = MELEE_TYPES.has(t.type);
      // AQUILA TALONS unlocks anti-air for melee towers — eagle talons let
      // the gladius claw down passing flyers at melee range.
      // 2026-05-19 — AETHER TILE (CYAN) also unlocks anti-air for any
      // melee tower placed on it, regardless of equipped items. Cheap
      // alternative to the legendary item.
      // 2026-05-19 — Agricola hero passive extends the CYAN/AQUILA_TALONS
      // melee-vs-flyer unlock to EVERY tower on the map. Same pipeline
      // — just sets the flag map-wide while Agricola is active.
      const agricolaActive = activeHeroKinds.has('HERO_AGRICOLA');
      const meleeHitsFlyers = isMeleeRow && (
        agricolaActive ||
        (state as any).__marsVictorActive ||
        t.equippedItems.includes('AQUILA_TALONS') ||
        t.equippedItems.includes('STORM_AQUILA_TALONS') ||
        towerAuraTileKind(t) === 'CYAN'
      );
      const inRange: Enemy[] = enemies.filter((e: Enemy) => {
        if (Math.hypot(e.x - tcx, e.y - tcy) > rPx) return false;
        if (isMeleeRow && e.isFlyer && !meleeHitsFlyers) return false;
        if (ANTI_AIR_ONLY_TYPES.has(t.type)) return e.isFlyer;
        // 2026-05-19 v3 — meleeImmune now only blocks PHYS_MELEE
        // damage. Divine / fire / siege melee towers still hit. See
        // meleeImmuneBlocksTower comment for the design rationale.
        if (isMeleeRow && meleeImmuneBlocksTower(e.type, t.damageType)) return false;
        return true;
      });
      // BURNING GROUND: fire-themed towers stamp a 3s burn patch at impact
      // (target's current position). Applied to melee primary and ranged
      // projectile-impact paths alike. Cleave secondaries and multi-shot
      // projectile impacts call applyDamageAndStatus instead, which also
      // spawns its own patch — so every hit produces one patch.
      if (towerBurnsGround(t.type)) {
        spawnBurnPatch(state, target.x, target.y, t.qualityTier);
      }
      if (isMeleeRow) {
        // SPEAR OF MARS — when the melee tower carries this legendary, fire
        // a visible thrown-spear projectile from the tower to the target so
        // the +5 tile reach reads. The damage still resolves immediately
        // (preserves all the cleave / nova / phase-hit logic below); the
        // projectile is cosmetic with a 0-damage payload so it doesn't
        // double-strike or re-trigger status hooks on impact.
        if (t.equippedItems.includes('SPEAR_OF_MARS')) {
          spawnCosmeticProjectile(state, t, target, 'PROJ_HASTA');
        }
        // PHASE-HITS check (mirrors applyDamageAndStatus for melee path).
        let phasedThisHit = false;
        if (damage > 0 && !target.isBoss) {
          const phaseMax: number = (enemiesData as any)[target.type]?.phaseHits ?? 0;
          if (phaseMax > 0) {
            if ((target as any).__phasesLeft === undefined) (target as any).__phasesLeft = phaseMax;
            if ((target as any).__phasesLeft > 0) {
              (target as any).__phasesLeft -= 1;
              (target as any).__weatherMissTick = state.tick;
              phasedThisHit = true;
              damage = 0;
            }
          }
        }
        // ─── SHIELD BASH (2026-05 v10) ─────────────────────────────────
        // Melee swings into a still-up shielded enemy deal +50% damage —
        // the legionary slams his pommel into the scutum and follows
        // through. Doubles as a thematic explanation for why melee
        // breaks the shield: it's a deliberate bash, not just a poke.
        // Bonus stacks multiplicatively with everything else (faction
        // resist, item bonuses, armor shred). Only fires on the FIRST
        // hit while the shield is still up — the bash that breaks it.
        const shieldedTarget = requiresMeleeBreak(target.type) && !target.shieldBroken;
        if (shieldedTarget) damage *= 1.50;
        // ─── BESTIARIUS BEAST FURY (2026-05-15) ────────────────────────
        // Per-target rage gauge. Each consecutive hit on the SAME enemy
        // adds 1 stack (or 2 on a boss); at 8 stacks the next strike
        // becomes a FRENZY: 6× damage + 1s STUN (8× damage on bosses).
        // Stacks reset when the target dies, when the Bestiarius
        // re-targets, or 4s of no-hit decay. State stored on the tower
        // as __furyTarget (id) + __furyStacks (0-8) so it survives across
        // tick frames without leaking onto unrelated enemies.
        let bestiariusFrenzyStun = false;
        if (t.type === TowerType.BESTIARIUS && !phasedThisHit && damage > 0) {
          const ft = (t as any).__furyTarget as string | undefined;
          const cur = (t as any).__furyStacks ?? 0;
          let stacks = (ft === target.id) ? cur : 0;
          const stackGain = target.isBoss ? 2 : 1;
          stacks = Math.min(8, stacks + stackGain);
          if (stacks >= 8) {
            // FRENZY STRIKE — payoff hit, then reset.
            const frenzyMult = target.isBoss ? 8.0 : 6.0;
            damage *= frenzyMult;
            bestiariusFrenzyStun = true;
            stacks = 0;
            // Visual punch — extra gold impact ring so the player sees
            // the burst land. Reuses the existing tower-render shake
            // path via attackFlash, no new VFX wiring needed.
            const r: any = (window as any).__renderer;
            if (r?.triggerImpactRing) r.triggerImpactRing(target.x, target.y, state.tick, 40, 0xffd34d);
          }
          (t as any).__furyTarget = target.id;
          (t as any).__furyStacks = stacks;
          (t as any).__furyLastHitTick = state.tick;
        }
        // Primary target hit
        if (!phasedThisHit) {
          // 2026-05-15 DRAGON MARK amp on melee primary — keeps the
          // Draconarius synergy consistent regardless of which tower
          // lands the follow-up damage. Mark amp is +25% × stacks
          // (cap +75%); expired marks are wiped lazily.
          const dmm: any = (target as any).__dragonMark;
          if (dmm && dmm.stacks > 0) {
            if (state.tick >= dmm.expiresAt) {
              (target as any).__dragonMark = undefined;
            } else {
              damage *= (1 + 0.25 * dmm.stacks);
            }
          }
          target.hp -= damage;
          target.hpFlashTimer = 0.16;
          target.lastDamagedTick = state.tick;
          // 2026-05-19 — DAMNATIO MEMORIAE execute: after damage lands,
          // any non-boss enemy that's now below 25% maxHp is instantly
          // killed by this tower's attacks. Bosses are immune. MELEE
          // only (equip-gated in ItemRules so a ranged tower can't
          // mount it; the damageType guard below is a defense-in-depth
          // belt to match the player-facing copy "MELEE ONLY").
          if (target.hp > 0 && !target.isBoss && t.equippedItems.includes('DAMNATIO_MEMORIAE') && t.damageType === DamageType.PHYS_MELEE) {
            if (target.hp / target.maxHp < 0.25) {
              target.hp = 0;
            }
          }
          // Apply the 1s STUN from a frenzy strike, after damage so kill
          // detection still fires on the same hit (a stunned-but-dead
          // enemy still counts as killed). Route through pushStatus so
          // boss-stun immunity, DR, and statusEffectiveness work
          // uniformly — direct array.push would bypass all of that.
          // Bosses are stun-immune by design (see pushStatus internals).
          if (bestiariusFrenzyStun && target.hp > 0) {
            pushStatus(target, StatusEffectKind.STUN, 1.0, 0, t.qualityTier);
          }
        }
        // Melee always breaks shielded units' guard so ranged can take over.
        if (requiresMeleeBreak(target.type) && !target.shieldBroken) {
          target.shieldBroken = true;
          // Visual: brief impact ring at the shield-break moment — bigger
          // + golder for the +50% bash hit so it reads as a real moment.
          const renderer = (window as any).__renderer;
          if (renderer?.triggerImpactRing) renderer.triggerImpactRing(target.x, target.y, state.tick, 32, 0xffe066);
        }
        hooks.onHit(t, target, damage, resMod, !!(t as any).__lastWasCrit);
        hooks.onMeleeSwing(t, target, damage);
        applyOnHitEffects(t, target);
        // JUPITER'S WRATH on melee hits — same chain logic as the ranged
        // path. Skips on phased hits (damage was zeroed above).
        if (!phasedThisHit && t.equippedItems.includes('JUPITERS_WRATH')) {
          fireJupitersWrathChain(state, t, target, damage, hooks, resMod);
        }
        if (target.hp <= 0 && !checkRebirth(state, target, state.tick)) hooks.onKill(t, target);
        // TRIUMPHATOR — every 5th hit, radial NOVA: 4× damage to everything in 2.5 tiles.
        if (t.type === TowerType.TRIUMPHATOR) {
          const hc = (t as any).__hitCount ?? 0;
          if (hc > 0 && hc % 5 === 0) {
            const novaR = 2.5 * GRID.TILE;
            const novaDmg = damage * 4;
            for (const e of state.enemies.values()) {
              if (e.hp <= 0) continue;
              if (Math.hypot(e.x - target.x, e.y - target.y) > novaR) continue;
              e.hp -= novaDmg;
              e.hpFlashTimer = 0.20;
              e.lastDamagedTick = state.tick;
              hooks.onHit(t, e, novaDmg, resMod);
              if (e.hp <= 0 && !checkRebirth(state, e, state.tick)) hooks.onKill(t, e);
            }
          }
        }
        // AURORA LEGION — PROVIDENCE BLAST: every 4th attack, divine nova
        // in 1.8-tile radius around primary target, dealing 2.5× damage to
        // every enemy inside. 2026-05 v11 — new signature on the buff pass.
        if (t.type === TowerType.AURORA_LEGION) {
          const hc = (t as any).__hitCount ?? 0;
          if (hc > 0 && hc % 4 === 0) {
            const novaR = 1.8 * GRID.TILE;
            const novaDmg = damage * 2.5;
            for (const e of state.enemies.values()) {
              if (e.hp <= 0) continue;
              if (Math.hypot(e.x - target.x, e.y - target.y) > novaR) continue;
              e.hp -= novaDmg;
              e.hpFlashTimer = 0.20;
              e.lastDamagedTick = state.tick;
              hooks.onHit(t, e, novaDmg, resMod);
              if (e.hp <= 0 && !checkRebirth(state, e, state.tick)) hooks.onKill(t, e);
            }
            // Fire an impact ring so the player sees the blast visually.
            const r: any = (window as any).__renderer;
            if (r?.triggerImpactRing) r.triggerImpactRing(target.x, target.y, state.tick, 32, 0xffe6a8);
          }
        }
        // Cleave melee — hit every other enemy in melee range. Native
        // cleavers default to 70% on secondaries; FALX_BLADE bumps that
        // to 90% for natives or grants 60% cleave to any other melee
        // tower (item-only cleave). 2026-05-15 hasCleave + multiplier
        // helper at the top of this file are the source of truth.
        // Shield Bash also applies to cleave secondaries: a wide swing
        // that happens to hit a shielded enemy gets the same +50% bash
        // bonus on that target before the shield breaks.
        if (hasCleave(t)) {
          const secondaryMult = cleaveSecondaryMult(t);
          // Cap total melee targets per swing (primary already counted).
          // Default 6 (= 1 primary + 5 secondaries); FALX_BLADE pushes
          // to 8. Once the cap is reached, remaining in-range enemies
          // are skipped for this swing only.
          const hitCap = meleeHitCap(t);
          let hitsThisSwing = 1; // the primary above counts as 1
          for (const other of inRange) {
            if (other.id === target.id || other.hp <= 0) continue;
            if (hitsThisSwing >= hitCap) break;
            hitsThisSwing++;
            // 2026-05-23 — Cleave secondaries skip block rolls
            // historically. Add the roll so UNDEAD_SPEARMAN +
            // IRON_PHALANX 20% all-block (and any other relevant
            // block flag) actually fires on cleave hits.
            if (secondaryHitBlocked(t, other, state)) {
              (other as any).__weatherMissTick = state.tick;
              continue;
            }
            let cleaveDmg = damage * secondaryMult;
            const otherShielded = requiresMeleeBreak(other.type) && !other.shieldBroken;
            if (otherShielded) cleaveDmg *= 1.50;
            other.hp -= cleaveDmg;
            other.hpFlashTimer = 0.14;
            other.lastDamagedTick = state.tick;
            if (otherShielded) {
              other.shieldBroken = true;
              const renderer = (window as any).__renderer;
              if (renderer?.triggerImpactRing) renderer.triggerImpactRing(other.x, other.y, state.tick, 32, 0xffe066);
            }
            hooks.onHit(t, other, cleaveDmg, resMod);
            hooks.onMeleeSwing(t, other, cleaveDmg);
            applyOnHitEffects(t, other);
            if (other.hp <= 0 && !checkRebirth(state, other, state.tick)) hooks.onKill(t, other);
          }
        }
      } else if (t.type === TowerType.SIGNIFERS_DRACONARIUS) {
        // ─── DRACO BREATH (CONE ATTACK, 2026-05-15) ─────────────────────
        // The Draconarius is the FIRST tower with a cone-shaped attack.
        // Mechanics: pick a forward direction (toward the primary target
        // chosen by the player's TargetingMode), then sweep a 60° arc
        // out to full range — every enemy whose center is inside that
        // cone takes FULL damage, not splash-decayed damage. This makes
        // chokepoints with 3+ stacked enemies extremely valuable for
        // this tower, and rewards picking a path tile that lines up
        // the cone with the longest line of enemies.
        //
        // Every cone-hit applies DRAGON MARK (stacks to 3, +25% damage
        // taken each, 3s base / 5s on bosses) — wired as a stamped
        // counter on the enemy that the damage-amp path reads.
        //
        // Vs Bosses: +60% base damage. The mark amp is on top.
        const aimDx = target.x - tcx;
        const aimDy = target.y - tcy;
        const aimAngle = Math.atan2(aimDy, aimDx);
        const coneHalfRad = (60 / 2) * Math.PI / 180;     // 60° → ±30° half-angle
        const cosHalf = Math.cos(coneHalfRad);
        // Cosmetic fire projectile from tower → primary target so the
        // breath direction reads visually; damage already resolves
        // instantly via cone sweep below, so the projectile is a 0-dmg
        // visual flag only. 2026-05-15 v2 — swapped from PROJ_BARREL
        // (oily orange splash) to PROJ_HELLFIRE_BOLT (stamped flame
        // sprite) so the dragon-breath reads as fire, not a thrown
        // bottle. Plus the per-tick proximity-burn passive below.
        spawnCosmeticProjectile(state, t, target, 'PROJ_HELLFIRE_BOLT');
        for (const candidate of enemies) {
          if (candidate.hp <= 0) continue;
          // 2026-05-22 V23 — Truesight Lens lets the cone sweep land on
          // veiled targets too. Without the item, veil blocks acquisition.
          if ((candidate as any).__veiled && !(candidate as any).__truesightRevealed) continue;
          const cdx = candidate.x - tcx;
          const cdy = candidate.y - tcy;
          const cdist = Math.hypot(cdx, cdy);
          if (cdist > rPx) continue;
          // Dot-product angle test: candidate is inside the cone if the
          // unit vector to it dotted with the aim-unit vector exceeds
          // cos(half-angle). Cheaper than full Math.atan2 + diff.
          const dot = (cdx * aimDx + cdy * aimDy) / (cdist * Math.hypot(aimDx, aimDy) || 1);
          if (dot < cosHalf) continue;
          // Boss damage bonus (+60% at T4, scales per tier band).
          const bossMult = candidate.isBoss ? 1.60 : 1.0;
          const coneDmg = damage * bossMult;
          // Apply damage + DRAGON MARK + on-hit effects via the shared
          // applyDamageAndStatus helper so all the existing pipelines
          // (phase-hits, weather miss, kill bonus, etc.) keep working.
          applyDamageAndStatus(state, t, candidate, coneDmg, hooks);
          // Stamp / refresh DRAGON MARK on the hit enemy. Stacks 0-3.
          const cur = (candidate as any).__dragonMark ?? { stacks: 0, expiresAt: 0 };
          cur.stacks = Math.min(3, cur.stacks + 1);
          cur.expiresAt = state.tick + (candidate.isBoss ? 5.0 : 3.0);
          (candidate as any).__dragonMark = cur;
          hooks.onProjectileFire(t, candidate, coneDmg);
        }
        (target as any).__lastResMod = resMod;
      } else {
        // Multi-shot ranged — pick the top N distinct targets by path
        // progress. 2026-05-15: helper consults `MULTI_SHOT_COUNT` AND
        // adds +1 if VOLLEY_QUIVER is equipped. A single-shot tower
        // becomes dual-shot with the item; existing 3-shot combos like
        // Scorpion Bolt and Eques become 4-shot.
        const shots = multiShotCountFor(t);
        if (shots > 1) {
          const ordered = inRange.slice().sort((a: Enemy, b: Enemy) => (b.pathIndex + b.pathProgress) - (a.pathIndex + a.pathProgress));
          const targets = ordered.slice(0, shots);
          for (const tgt of targets) {
            spawnProjectile(state, t, tgt, damage);
            (tgt as any).__lastResMod = resMod;
            hooks.onProjectileFire(t, tgt, damage);
          }
        } else {
          spawnProjectile(state, t, target, damage);
          (target as any).__lastResMod = resMod;
          hooks.onProjectileFire(t, target, damage);
        }
      }
    }
    if (t.attackFlash > 0) t.attackFlash = Math.max(0, t.attackFlash - dt);
  }
}

function tilePxX(t: Tower): number { return t.tileX * GRID.TILE + GRID.TILE / 2; }
function tilePxY(t: Tower): number { return t.tileY * GRID.TILE + GRID.TILE / 2; }

// Exported for testing — tests/targeting.test.ts asserts behavior per
// TargetingMode. Production code calls this only from tickCombat above.
export function pickTarget(state: GameStateShape, t: Tower, enemies: Enemy[], rangeTiles: number): Enemy | null {
  const tx = tilePxX(t);
  const ty = tilePxY(t);
  const rangePx = rangeTiles * GRID.TILE;
  const isMelee = MELEE_TYPES.has(t.type);
  // AQUILA TALONS — melee towers carrying this legendary can target flyers
  // in their range too. Mirrors the same flag used in the per-tick attack
  // loop above so target-acquisition and damage-application agree.
  // 2026-05-19 — AETHER TILE (CYAN) also enables melee anti-air, same
  // as AQUILA_TALONS.
  // 2026-05-19 — Agricola hero global passive extends the
  // CYAN/AQUILA_TALONS unlock to ALL melee towers map-wide.
  const meleeAirEnabled = isMelee && (
    state.activeHeroId === 'HERO_AGRICOLA' ||
    Array.from(state.towers.values()).some(tw => heroIdForTowerType(String(tw.type)) === 'HERO_AGRICOLA' && (tw.id === state.activeHeroTowerId || isMercatorChampionType(String(tw.type)))) ||
    (state as any).__marsVictorActive ||   // Mars Victor fuses Agricola's all-towers-strike-flyers passive
    t.equippedItems.includes('AQUILA_TALONS') ||
    t.equippedItems.includes('STORM_AQUILA_TALONS') ||   // 2026 v2 — legendary grants ANY tower anti-air
    towerAuraTileKind(t) === 'CYAN'
  );
  const canHitFlyers = !isMelee || meleeAirEnabled;
  const antiAirOnly = ANTI_AIR_ONLY_TYPES.has(t.type);
  let inRange = enemies.filter(e => {
    if (Math.hypot(e.x - tx, e.y - ty) > rangePx) return false;
    // 2026-05-22 V23 (reworked 2026-05-23) — Truesight Lens reveals
    // enemies on a per-enemy basis. An enemy gets `__truesightRevealed`
    // when it walks into range of any truesight tower (see the tickCombat
    // reveal scan). Once tagged, every tower — not just the truesight
    // one — can acquire it through the veil.
    const revealed = !!(e as any).__truesightRevealed;
    if (antiAirOnly) return e.isFlyer && (revealed || !(e as any).__veiled);
    if (!canHitFlyers && e.isFlyer) return false;
    // 2026-05-19 v3 — Only PHYS_MELEE damage is blocked by meleeImmune.
    // Divine / fire / siege melee towers still acquire these targets.
    if (isMelee && meleeImmuneBlocksTower(e.type, t.damageType)) return false;
    if ((e as any).__veiled && !revealed) return false;       // VEIL modifier: untargetable
    // SHIELDED units: ranged towers cannot target until a melee tower has
    // broken the shield. Melee towers can always hit and will set the flag.
    if (!isMelee && requiresMeleeBreak(e.type) && !e.shieldBroken) return false;
    // 2026-05 v10 — ELEPHANT RANGED PROTECTION: ground enemies near a
    // living war elephant are untargetable by ranged towers. The aura
    // drops the moment the elephant dies. Melee towers ignore the
    // shield (they're inside the dust cloud anyway).
    if (!isMelee && (e as any).__rangedProtected) return false;
    return true;
  });
  if (inRange.length === 0) return null;
  // NEMESIS_ENGINE always prioritizes flyers if any are in range, regardless
  // of the player's selected targeting mode. (It's a sky-ripper.)
  if (t.type === TowerType.NEMESIS_ENGINE) {
    const fl = inRange.filter(e => e.isFlyer);
    if (fl.length > 0) inRange = fl;
  }
  // Phase-through: SPECTRAL_SCOUT phases first 2 hits — for simplicity ignore here; combat still hits
  switch (t.targetingMode) {
    case TargetingMode.LAST: {
      let best: Enemy | null = null; let bestProg = Infinity;
      for (const e of inRange) { const p = e.pathIndex + e.pathProgress; if (p < bestProg) { bestProg = p; best = e; } }
      return best;
    }
    case TargetingMode.STRONG: {
      // 2026-05-19 — Bosses get priority. If ANY boss is in range,
      // pick the highest-HP boss (locks the tower onto the most
      // dangerous threat regardless of incidental grunts). Only if
      // no boss is present do we fall back to the raw highest-HP
      // enemy. Without this, a chip-damaged boss whose HP dropped
      // below a fresh War Elephant minion would lose the tower's
      // attention mid-fight — confusing and bad for boss DPS.
      let bestBoss: Enemy | null = null; let bestBossHp = -1;
      let bestAny:  Enemy | null = null; let bestAnyHp  = -1;
      for (const e of inRange) {
        if (e.isBoss && e.hp > bestBossHp) { bestBossHp = e.hp; bestBoss = e; }
        if (e.hp > bestAnyHp)              { bestAnyHp  = e.hp; bestAny  = e; }
      }
      return bestBoss ?? bestAny;
    }
    case TargetingMode.WEAKEST: {
      // 2026-05-19 — Mirror of STRONG. Picks the LOWEST-current-HP
      // enemy in range — the finisher mode. Useful for high-fire-rate
      // low-damage towers to maximize kill count (XP / gold), and
      // pairs cleanly with the DAMNATIO_MEMORIAE legendary that
      // executes non-Boss enemies under 25% HP. Bosses are
      // deliberately EXCLUDED from WEAKEST consideration unless
      // they're the only thing in range — a boss with chip damage
      // shouldn't pull every "finisher" tower off its actual job
      // of mopping up grunts.
      let bestGrunt: Enemy | null = null; let bestGruntHp = Infinity;
      let bestAny:   Enemy | null = null; let bestAnyHp   = Infinity;
      for (const e of inRange) {
        if (!e.isBoss && e.hp < bestGruntHp) { bestGruntHp = e.hp; bestGrunt = e; }
        if (e.hp < bestAnyHp)                { bestAnyHp   = e.hp; bestAny   = e; }
      }
      return bestGrunt ?? bestAny;
    }
    case TargetingMode.FAST: {
      // 2026-05-19 — Pick the enemy whose CURRENT speed is highest
      // (currentSpeed reflects active slows — a slowed-down tank
      // shouldn't pull the FAST-mode tower off a sprinter that's
      // about to leak). Ties broken by path progress so we still
      // prefer the one closer to the gate among equally-fast units.
      let best: Enemy | null = null; let bestSpeed = -1; let bestProg = -1;
      for (const e of inRange) {
        const s = e.currentSpeed ?? e.baseSpeed ?? 0;
        const p = e.pathIndex + e.pathProgress;
        if (s > bestSpeed || (s === bestSpeed && p > bestProg)) {
          bestSpeed = s; bestProg = p; best = e;
        }
      }
      return best;
    }
    case TargetingMode.CLOSE: {
      let best: Enemy | null = null; let bestD = Infinity;
      for (const e of inRange) { const d = Math.hypot(e.x - tx, e.y - ty); if (d < bestD) { bestD = d; best = e; } }
      return best;
    }
    case TargetingMode.FLYERS: {
      const fl = inRange.filter(e => e.isFlyer);
      if (fl.length > 0) return pickByFurthest(fl);
      return pickByFurthest(inRange);
    }
    case TargetingMode.FIRST:
    default:
      return pickByFurthest(inRange);
  }
}

function pickByFurthest(arr: Enemy[]): Enemy | null {
  let best: Enemy | null = null; let bestProg = -1;
  for (const e of arr) { const p = e.pathIndex + e.pathProgress; if (p > bestProg) { bestProg = p; best = e; } }
  return best;
}

// Public — used by projectile-impact resolver
export function applyDamageAndStatus(state: GameStateShape, t: Tower, target: Enemy, damage: number, hooks: CombatHooks) {
  // 2026-05-23 — SECONDARY BLOCK ROLL. Re-rolls dodge / W8-block /
  // shield-block / all-attack-block here so splash / cone / multi-shot
  // secondary impacts that bypass the primary tickCombat roll still
  // honor the block flags. Primary hits that already passed the
  // tickCombat block path get a fresh roll too — UNDEAD_SPEARMAN +
  // IRON_PHALANX's all-attack 20% block ends up at ~36% effective on
  // ranged primaries, which matches the user-asked "20% chance to
  // block all attacks" plus the existing per-type rolls. Skipped when
  // damage is already 0 (the primary path zeroed it out).
  if (damage > 0 && secondaryHitBlocked(t, target, state)) {
    (target as any).__weatherMissTick = state.tick;
    return;
  }
  // PHASE-HITS (2026-05): some enemies (Spectral Scout, Iron Phalanx,
  // Undead Spearman, Undead Berserker, etc.) phase through the first N
  // hits, taking no damage. Counter lazy-initializes from enemies.json.
  // Phasing also consumes the would-be flash so the player sees the shot
  // pass through clean (no number, no impact pulse).
  if (damage > 0 && !target.isBoss) {
    const phaseMax: number = (enemiesData as any)[target.type]?.phaseHits ?? 0;
    if (phaseMax > 0) {
      if ((target as any).__phasesLeft === undefined) (target as any).__phasesLeft = phaseMax;
      if ((target as any).__phasesLeft > 0) {
        (target as any).__phasesLeft -= 1;
        (target as any).__weatherMissTick = state.tick;     // shows MISS floater
        return;
      }
    }
  }
  // 2026-05-15 DRAGON MARK amp: any damage applied to an enemy with an
  // active Draconarius DRAGON_MARK takes +25% per stack (cap 3 = +75%).
  // Expired marks are wiped lazily so a stale stack never lingers past
  // its expiresAt tick. The Draconarius itself benefits from the marks
  // it stacks (cone hits all share the same target-mark amp).
  const dm: any = (target as any).__dragonMark;
  if (dm && dm.stacks > 0) {
    if (state.tick >= dm.expiresAt) {
      (target as any).__dragonMark = undefined;
    } else {
      damage *= (1 + 0.25 * dm.stacks);
    }
  }
  // 2026-05-22 — WAVE-LEVEL DAMAGE REDUCTION. Wave defs with
  // `enemyDamageReductPct` reduce direct damage taken by every spawn
  // on that wave by that fraction. Used by W12/W16/W17 to add a
  // "resistance" layer on top of the HP bump so the late game
  // doesn't just feel like a numbers-up grind. Applies AFTER all
  // other amps (DRAGON_MARK, FREEZE/STUN amp, etc.) so the resist
  // is the final word.
  const _curWaveDef: any = (wavesData as any[])[(state.wave ?? 1) - 1];
  const waveDmgReduct = _curWaveDef?.enemyDamageReductPct ?? 0;
  if (waveDmgReduct > 0 && damage > 0) {
    damage *= (1 - waveDmgReduct);
  }
  damage *= campaignRelicDamageMult(state, t, target) * bossTrophyDamageMult(state, t, target) * commanderDamageTakenMult(state, target);
  target.hp -= damage;
  target.hpFlashTimer = 0.16;
  target.lastDamagedTick = state.tick;
  // 2026-05-19 — DAMNATIO MEMORIAE execute (see line ~1055 for the
  // primary hit-site copy). Bosses immune. MELEE only.
  if (target.hp > 0 && !target.isBoss && t.equippedItems.includes('DAMNATIO_MEMORIAE') && t.damageType === DamageType.PHYS_MELEE) {
    if (target.hp / target.maxHp < 0.25) {
      target.hp = 0;
    }
  }
  // Stamp a burn patch at the impact location for fire-themed towers
  if (towerBurnsGround(t.type)) {
    spawnBurnPatch(state, target.x, target.y, t.qualityTier);
  }
  const resMod = (target as any).__lastResMod ?? 1;
  hooks.onHit(t, target, damage, resMod, !!(t as any).__lastWasCrit);
  applyOnHitEffects(t, target);
  if (target.hp <= 0 && !checkRebirth(state, target, state.tick)) hooks.onKill(t, target);
  // CONSULAR_FATEBINDER — every shot strikes EVERY enemy on the map. The
  // initial target gets the full hit; every other enemy alive takes 60% of
  // the damage as a parallel strike. Counts toward kills/credit normally.
  if (t.type === TowerType.CONSULAR_FATEBINDER) {
    const splash = damage * 0.6;
    for (const e of state.enemies.values()) {
      if (e.id === target.id || e.hp <= 0) continue;
      e.hp -= splash;
      e.hpFlashTimer = 0.18;
      e.lastDamagedTick = state.tick;
      hooks.onHit(t, e, splash, 1);
      if (e.hp <= 0 && !checkRebirth(state, e, state.tick)) hooks.onKill(t, e);
    }
  }
  // LEGION_PRIME — heavy AoE divine: 2.5-tile splash on every hit at 70%.
  if (t.type === TowerType.LEGION_PRIME) {
    const r = 2.5 * GRID.TILE;
    const splash = damage * 0.70;
    for (const e of state.enemies.values()) {
      if (e.id === target.id || e.hp <= 0) continue;
      if (Math.hypot(e.x - target.x, e.y - target.y) > r) continue;
      e.hp -= splash;
      e.hpFlashTimer = 0.16;
      e.lastDamagedTick = state.tick;
      hooks.onHit(t, e, splash, 1);
      pushStatus(e, StatusEffectKind.SLOW, 2.5, 0.55, t.qualityTier);
      pushStatus(e, StatusEffectKind.ARMOR_SHRED, 3, 0, t.qualityTier);
      if (e.hp <= 0 && !checkRebirth(state, e, state.tick)) hooks.onKill(t, e);
    }
  }
  // IMPERIUM_ETERNUM — divine quake on every hit: 3-tile AoE, true damage.
  if (t.type === TowerType.IMPERIUM_ETERNUM) {
    const r = 3 * GRID.TILE;
    const aoe = damage * 0.65;
    for (const e of state.enemies.values()) {
      if (e.id === target.id || e.hp <= 0) continue;
      if (Math.hypot(e.x - target.x, e.y - target.y) > r) continue;
      e.hp -= aoe;
      e.hpFlashTimer = 0.18;
      e.lastDamagedTick = state.tick;
      hooks.onHit(t, e, aoe, 1);
      if (e.hp <= 0 && !checkRebirth(state, e, state.tick)) hooks.onKill(t, e);
    }
  }
  // STORM_VEXILLATION — wider chain lightning (6 jumps) on every hit.
  if (t.type === TowerType.STORM_VEXILLATION) {
    let prevX = target.x, prevY = target.y;
    let chainDmg = damage * 0.85;
    const visited = new Set<string>([target.id]);
    for (let jump = 0; jump < 6; jump++) {
      let nearest: Enemy | null = null; let bestD = 4 * GRID.TILE;
      for (const e of state.enemies.values()) {
        if (e.hp <= 0 || visited.has(e.id)) continue;
        const d = Math.hypot(e.x - prevX, e.y - prevY);
        if (d < bestD) { bestD = d; nearest = e; }
      }
      if (!nearest) break;
      visited.add(nearest.id);
      nearest.hp -= chainDmg;
      nearest.hpFlashTimer = 0.18;
      nearest.lastDamagedTick = state.tick;
      hooks.onHit(t, nearest, chainDmg, resMod);
      if (nearest.hp <= 0 && !checkRebirth(state, nearest, state.tick)) hooks.onKill(t, nearest);
      prevX = nearest.x; prevY = nearest.y;
      chainDmg *= 0.80;
    }
  }
  // JUPITER'S WRATH (legendary item) — handled by the shared helper so
  // both ranged-impact and melee-swing paths run the same chain.
  if (t.equippedItems.includes('JUPITERS_WRATH')) {
    fireJupitersWrathChain(state, t, target, damage, hooks, resMod);
  }
  // STORMCALLER — chain lightning: 4 jumps, decaying 25% per jump.
  if (t.type === TowerType.STORMCALLER) {
    let prevX = target.x, prevY = target.y;
    let chainDmg = damage * 0.75;
    const visited = new Set<string>([target.id]);
    for (let jump = 0; jump < 4; jump++) {
      let nearest: Enemy | null = null; let bestD = 3.5 * GRID.TILE;
      for (const e of state.enemies.values()) {
        if (e.hp <= 0 || visited.has(e.id)) continue;
        const d = Math.hypot(e.x - prevX, e.y - prevY);
        if (d < bestD) { bestD = d; nearest = e; }
      }
      if (!nearest) break;
      visited.add(nearest.id);
      nearest.hp -= chainDmg;
      nearest.hpFlashTimer = 0.18;
      nearest.lastDamagedTick = state.tick;
      hooks.onHit(t, nearest, chainDmg, resMod);
      if (nearest.hp <= 0 && !checkRebirth(state, nearest, state.tick)) hooks.onKill(t, nearest);
      prevX = nearest.x; prevY = nearest.y;
      chainDmg *= 0.75;
    }
  }
}

// JUPITER'S WRATH chain helper — invoked from both melee and ranged hit
// paths so the chain fires on every attack regardless of damage delivery
// method. 3 jumps, 60% damage decay, 0.4s stun on primary + 0.25s stun on
// each jump target. Queues a lightning-arc VFX entry per jump so the
// renderer can draw the bolt.
function fireJupitersWrathChain(
  state: GameStateShape, t: Tower, target: Enemy, damage: number,
  hooks: CombatHooks, resMod: number
) {
  pushStatus(target, StatusEffectKind.STUN, 0.4, 0, t.qualityTier);
  (state as any).chainLightningFxQueue = (state as any).chainLightningFxQueue ?? [];
  let prevX = target.x, prevY = target.y;
  let chainDmg = damage * 0.40;
  const visited = new Set<string>([target.id]);
  for (let jump = 0; jump < 3; jump++) {
    let nearest: Enemy | null = null; let bestD = 3 * GRID.TILE;
    for (const e of state.enemies.values()) {
      if (e.hp <= 0 || visited.has(e.id)) continue;
      const d = Math.hypot(e.x - prevX, e.y - prevY);
      if (d < bestD) { bestD = d; nearest = e; }
    }
    if (!nearest) break;
    visited.add(nearest.id);
    nearest.hp -= chainDmg;
    nearest.hpFlashTimer = 0.18;
    nearest.lastDamagedTick = state.tick;
    hooks.onHit(t, nearest, chainDmg, resMod);
    pushStatus(nearest, StatusEffectKind.STUN, 0.25, 0, t.qualityTier);
    const fxq = (state as any).chainLightningFxQueue;
    fxq.push({ x1: prevX, y1: prevY, x2: nearest.x, y2: nearest.y, bornTick: state.tick });
    // Hard cap so a packed wave with multiple chain-towers can't blow up
    // the FX list (each arc lives ~0.35s so without a cap a burst could
    // pile up dozens before the cleanup loop catches them).
    if (fxq.length > 60) fxq.shift();
    if (nearest.hp <= 0 && !checkRebirth(state, nearest, state.tick)) hooks.onKill(t, nearest);
    prevX = nearest.x; prevY = nearest.y;
    chainDmg *= 0.40;
  }
}

function applyOnHitEffects(t: Tower, target: Enemy) {
  // Apply baseline status effects per tower archetype.
  const tier = t.qualityTier;
  const dur = (base: number) => base * (1 + 0.15 * tier);
  switch (t.type) {
    case TowerType.VELITES:
      // Slow-buff pass v6.2: 35% → 50%. Velites stays the flagship slow.
      pushStatus(target, StatusEffectKind.SLOW, dur(3.5), 0.50, tier);
      break;
    case TowerType.FUNDIBULUS:
      // Slow-buff pass v6.2: 32% → 45%.
      pushStatus(target, StatusEffectKind.SLOW, dur(3), 0.45, tier);
      break;
    case TowerType.LEGATE:
      // Slow-buff pass v6.2: 25% → 40%.
      pushStatus(target, StatusEffectKind.SLOW, dur(2.5), 0.40, tier);
      break;
    case TowerType.PLAGUE_CART:
      // Plague Cart — poison is a burst DOT, slow is the kicker.
      // Slow-buff pass v6.2: 35% → 50%.
      pushStatus(target, StatusEffectKind.POISON, dur(2.5), 0.06, tier);
      pushStatus(target, StatusEffectKind.SLOW, dur(3), 0.50, tier);
      break;
    case TowerType.INFERNO_CART:
    case TowerType.IGNIFER:
    case TowerType.VULCAN_ENGINEER:
      // 2026-05 v11: BURNING GROUND consolidation. These towers stamp a
      // burn patch at the impact point (auto-fired by the burnsGround flag
      // in tickCombat); the redundant BURN STATUS that previously applied
      // on top has been removed so the player sees ONE DoT. Patch damage
      // boosted in EnemySystem.tickBurnPatches to compensate.
      break;
    case TowerType.SIEGE_ONAGER:
      // Siege Onager keeps its STUN (not a DoT) but no longer also applies
      // BURN — the burning-ground patch covers the fire DoT cleanly.
      pushStatus(target, StatusEffectKind.STUN, dur(0.7), 0, tier);
      break;
    case TowerType.FROZEN_LEGION:
      pushStatus(target, StatusEffectKind.FREEZE, dur(2.5), 0, tier);
      break;
    case TowerType.JULIUS_CAESAR:
      // 0.5s stun on every primary strike — matches the divine-priest
      // cluster below.
      pushStatus(target, StatusEffectKind.STUN, dur(0.5), 0, tier);
      // 2026-05-25 — IMPERIAL EXECUTE. Caesar instantly kills any
      // target left at ≤10% maxHp after his hit. Same pattern as
      // GOD_OF_WAR's DIVINE EXECUTE (~line 2049): bosses, ground, AND
      // flyers all eligible. The "only flyers with the item" constraint
      // the player asked for is enforced AUTOMATICALLY by the existing
      // melee-vs-flyer targeting gate — Caesar is range 1.5 melee, so
      // he can ONLY land a hit on a flyer when AQUILA_TALONS is
      // equipped, the tower sits on the CYAN aura tile, or the Agricola
      // hero is active and extending CYAN map-wide. No flyer hit =
      // no execute, naturally. hp>0 guard skips already-dead targets
      // so we never double-credit a kill that the swing itself just
      // resolved. Downstream onKill hook fires normally so gold +
      // quests + score all credit Caesar correctly.
      if (target.hp > 0 && target.hp <= 0.10 * target.maxHp) {
        target.hp = 0;
      }
      break;
    case TowerType.AUGUR:
    case TowerType.FLAMEN:
    case TowerType.HARUSPEX:
    case TowerType.SOLAR_PRIEST:
      pushStatus(target, StatusEffectKind.STUN, dur(0.5), 0, tier);
      break;
    case TowerType.GOD_OF_WAR:
      // 2026-05 v10: HELLFIRE magnitude 0.04 → 0.01 (4% → 1% maxHP/sec).
      // The God of War still stamps a permanent true-damage DoT on every
      // hit, but the per-tick bite is gentler so it's a slow-burn pressure
      // tool rather than a stack-and-melt nuke.
      pushStatus(target, StatusEffectKind.HELLFIRE, 999, 0.01, tier);
      // 2026-05-15 v16 DIVINE EXECUTE — after the calling path has
      // already applied this hit's damage to target.hp, if the target is
      // now at or below 10% maxHp, snap it to 0. The downstream
      // `target.hp <= 0 → hooks.onKill` check in the caller fires
      // normally so gold/quest/loot/score all credit correctly. Applies
      // to BOSSES too (apex T5 combo earns the boss-cleanup tool). The
      // hp > 0 guard skips already-dead targets so we never double-
      // credit a kill if the hit itself was lethal.
      if (target.hp > 0 && target.hp <= 0.10 * target.maxHp) {
        target.hp = 0;
      }
      break;
    case TowerType.CENTURION:
    case TowerType.RETIARIUS:
    case TowerType.OPTIO:
      pushStatus(target, StatusEffectKind.ARMOR_SHRED, dur(3), 0, tier);
      break;
    case TowerType.SPECULATOR:
      // SPOTTER: armor shred AND mark (+15% damage taken)
      pushStatus(target, StatusEffectKind.ARMOR_SHRED, dur(3), 0, tier);
      pushStatus(target, StatusEffectKind.MARK, dur(3), 0.15, tier);
      break;
    case TowerType.VENATOR:
      // MARKED PREY: marks flyers for +25% damage taken
      if (target.isFlyer) pushStatus(target, StatusEffectKind.MARK, dur(3), 0.25, tier);
      break;
    case TowerType.PRAETORIAN_WALL: {
      // Slow on every hit (45% magnitude). LAST STAND (2026-05 v7):
      // every 10th attack knocks the target backward along the path —
      // a heavy shield-wall shove that interrupts checkpoint-heals and
      // creates a brief breathing room behind the line.
      pushStatus(target, StatusEffectKind.SLOW, dur(2.5), 0.45, tier);
      const hc = (t as any).__hitCount ?? 0;
      if (hc > 0 && hc % 10 === 0) {
        pushStatus(target, StatusEffectKind.KNOCKBACK, 0.05, 0.6, tier);
      }
      break;
    }
    case TowerType.COLOSSUS_ONAGER:
      // EARTHSHATTER: knocks every target back along the path
      pushStatus(target, StatusEffectKind.KNOCKBACK, 0.05, 0.7, tier);
      break;
    case TowerType.BALLISTARIUS: {
      // SIEGE KICKBACK: every 3rd hit knocks back. Guard against count===0
      // (which can happen for cleave secondaries that share applyOnHitEffects).
      const hc = (t as any).__hitCount ?? 0;
      if (hc > 0 && hc % 3 === 0) pushStatus(target, StatusEffectKind.KNOCKBACK, 0.05, 0.45, tier);
      break;
    }
    case TowerType.LIBRITOR: {
      // BOULDER: every 4th attack stuns briefly.
      const hc = (t as any).__hitCount ?? 0;
      if (hc > 0 && hc % 4 === 0) pushStatus(target, StatusEffectKind.STUN, dur(0.5), 0, tier);
      break;
    }
    case TowerType.AUGUR: {
      // OMEN: every 6th hit drops a small freeze on top of the standard stun.
      pushStatus(target, StatusEffectKind.STUN, dur(0.5), 0, tier);
      const hc = (t as any).__hitCount ?? 0;
      if (hc > 0 && hc % 6 === 0) pushStatus(target, StatusEffectKind.FREEZE, 1.5, 0, tier);
      break;
    }
    case TowerType.WAR_CHARIOT: {
      // CHARIOT TRAMPLE: every 4th attack stuns ground + KNOCKBACK.
      const hc = (t as any).__hitCount ?? 0;
      if (hc > 0 && hc % 4 === 0 && !target.isFlyer) {
        pushStatus(target, StatusEffectKind.STUN, dur(0.6), 0, tier);
        pushStatus(target, StatusEffectKind.KNOCKBACK, 0.05, 0.5, tier);
      }
      break;
    }
    case TowerType.MURMILLO: {
      // 2026-05-17 — SCUTUM BASH. Every 4th swing the Murmillo slams his
      // heavy rectangular scutum into the target: a HEAVY 1.2s STUN + a
      // HEAVY 0.8-tile knockback. The damage bonus vs Carthage / Undead-
      // Carthage is applied separately in the damage pipeline (PUNIC
      // HUNTER block). Bosses are stun-immune by design so the stun lands
      // only on non-bosses; the knockback still pushes bosses but at the
      // standard 25% boss-effectiveness scale (handled in EnemySystem),
      // so a boss bash translates to roughly 0.2 tile of slip. The combined
      // long stun + long push is uniquely heavy compared to War Chariot's
      // (0.6s / 0.5 tile) and Praetorian Wall's (0 stun / 0.6 tile every
      // 10th hit) — Murmillo's mechanic is the heaviest single-shot CC in
      // the melee roster.
      const hc = (t as any).__hitCount ?? 0;
      if (hc > 0 && hc % 4 === 0) {
        pushStatus(target, StatusEffectKind.STUN, dur(1.2), 0, tier);
        pushStatus(target, StatusEffectKind.KNOCKBACK, 0.05, 0.8, tier);
      }
      break;
    }
    case TowerType.HORSEMAN:
      // CHARGE: marks the target so the next hit (from anyone) hits +20% harder.
      // 2026-05-17 — POISON ADDITION: every Horseman strike now also applies
      // a 4-second poison DoT (5% maxHP/sec, scales with tier). The poison
      // ticks through other DoTs because it's a per-tower signature, not an
      // equipped item slot — stacks with marks, burns, and bleeds. Lore: the
      // cavalryman's lance tip is smeared with venom from the Pontic herbal
      // tradition (a real practice in late-Republican mercenary cavalry).
      pushStatus(target, StatusEffectKind.MARK, dur(2), 0.20, tier);
      pushStatus(target, StatusEffectKind.POISON, dur(4), 0.05, tier);
      break;
    case TowerType.TURMA_LANCERS:
      // CHARGE: heavier double-stack mark (+35% vs +20% Horseman baseline).
      pushStatus(target, StatusEffectKind.MARK, dur(2.5), 0.35, tier);
      break;
    case TowerType.COHORT_GUARD:
      // SHIELD WALL: passing enemies are slowed.
      // Slow-buff pass v6.2: 28% → 40%.
      pushStatus(target, StatusEffectKind.SLOW, dur(2.5), 0.40, tier);
      break;
    // ─── NEW COMBO TOWERS ────────────────────────────────────────────────
    case TowerType.TESSERARIUS:
      // 2026-05 v7: TESSERARIUS is RANGED, so its old per-hit Bleed
      // violated the "bleed = melee only" rule. ARMOR_SHRED is the
      // every-hit base signature — fits the standard-bearer-marks-the-
      // target theme without invoking blood loss from thrown javelins.
      pushStatus(target, StatusEffectKind.ARMOR_SHRED, dur(3), 0, tier);
      // 2026-05-15 v11 BOSS MARK retheme: replaces the every-6th-kill
      // AoE mark pulse with a per-boss hit counter. Every 3rd Tesserarius
      // hit on a BOSS plants a 6s MARK (+20%) on that boss. MARK is
      // read in the per-attack damage path (CombatResolver:499-501)
      // and intentionally bypassed by DoT ticks in EnemySystem
      // (statusEffects loop), so the mark amplifies DIRECT damage from
      // every tower on the boss but does NOT inflate burn/poison/bleed/
      // hellfire ticks. Counter lives on the enemy so multiple
      // Tesserarius towers all contribute to the same 3-hit threshold.
      if (target.isBoss) {
        const cur = (((target as any).__tesserariusHits ?? 0) as number) + 1;
        (target as any).__tesserariusHits = cur;
        if (cur % 3 === 0) {
          pushStatus(target, StatusEffectKind.MARK, dur(6), 0.20, tier);
        }
      }
      break;
    case TowerType.STORMCALLER:
      // ARC LIGHTNING: stun the primary target. Chain damage handled in tick.
      pushStatus(target, StatusEffectKind.STUN, dur(0.4), 0, tier);
      break;
    case TowerType.TRIBUNUS_LATICLAVIUS:
      // TIME WARP: heavy slow status as a passive readable effect.
      // Slow-buff pass v6.2: 45% → 60% (apex slow — targets crawl).
      pushStatus(target, StatusEffectKind.SLOW, dur(2.5), 0.60, tier);
      break;
    case TowerType.NEMESIS_ENGINE:
      // SKY-RIPPER: knock flyers back, stun briefly.
      if (target.isFlyer) {
        pushStatus(target, StatusEffectKind.STUN, dur(0.5), 0, tier);
        pushStatus(target, StatusEffectKind.MARK, dur(2), 0.20, tier);
      }
      break;
    case TowerType.TRIUMPHATOR:
      // VICTOR'S SWEEP: applies bleed on every hit; nova every 5th hit
      // handled in tickCombat. TRIUMPHAL WREATH (2026-05 v7): +1.5%
      // damage per kill this wave, capped at +30%, applied in damage
      // computation (see awardKillBonus + per-attack mult below).
      // Identity: gets scarier the more it kills.
      pushStatus(target, StatusEffectKind.BLEED, 6, 0.012, tier);
      break;
    case TowerType.PONTIFEX_MAXIMUS:
      // RITE OF DOOM: stacking true-damage curse via HELLFIRE on bosses.
      if (target.isBoss) {
        pushStatus(target, StatusEffectKind.HELLFIRE, 999, 0.01 * tier, tier);
      } else {
        pushStatus(target, StatusEffectKind.STUN, dur(0.4), 0, tier);
      }
      break;
    case TowerType.LEGION_PRIME:
      // SUPER COMBO: applies SLOW + ARMOR_SHRED on every hit.
      // Slow-buff pass v6.2: 40% → 55% on primary + AoE.
      pushStatus(target, StatusEffectKind.SLOW, dur(2.5), 0.55, tier);
      pushStatus(target, StatusEffectKind.ARMOR_SHRED, dur(3), 0, tier);
      break;
    case TowerType.CONSULAR_FATEBINDER:
      // APEX SUPER: stun on hit (doesn't matter much, every enemy is hit anyway).
      pushStatus(target, StatusEffectKind.STUN, dur(0.4), 0, tier);
      break;
    // VEXILLATION, SACER_VESTAL handled via passive logic outside the
    // per-hit switch (cleave + sanctum auras).
    // 2026-05-17 — SCOUT_VEXILLUM also gets a per-hit POISON now. Its
    // passive 4-second mass-mark aura still fires from the passive
    // logic above; this per-hit poison stacks on top. 4s duration,
    // 5% maxHP/sec, scales with tier. Lore: javelin shafts dipped in
    // distilled bog-poison (a documented Celtic skirmisher trick that
    // Roman scout regiments adopted for frontier patrols).
    case TowerType.SCOUT_VEXILLUM:
      pushStatus(target, StatusEffectKind.POISON, dur(4), 0.05, tier);
      break;
  }
  // Item-granted status effects. These previously gated on melee-only — that
  // was confusing because the player would equip a "Poisoned Blade" on a
  // ranged tower and see nothing happen. Items now apply on ANY damage-dealing
  // tower so the badge always renders on the target when the tower hits it.
  // (Pure support towers with damageType NONE still skip — they don't hit.)
  const canApplyItems = t.damageType !== DamageType.NONE;
  if (canApplyItems) {
    // 2026-05 v6: FIRE_OIL_FLASK is ranged-only (gated in ItemRules) and
    // applies a burn to the target PLUS splashes the same burn to enemies
    // within 1 tile of impact. Bigger envelope, lower per-target DPS than
    // POISONED_BLADE. Identity: AoE "oil ignition" wave.
    if (t.equippedItems.includes('FIRE_OIL_FLASK')) {
      pushStatus(target, StatusEffectKind.BURN, 3, 0.04, tier);
      const splashR = 32 * 1;     // 1-tile splash
      const stateRef = (window as any).__lastState;
      if (stateRef?.enemies) {
        for (const other of stateRef.enemies.values()) {
          if (other.id === target.id || other.hp <= 0) continue;
          if (Math.hypot(other.x - target.x, other.y - target.y) <= splashR) {
            pushStatus(other, StatusEffectKind.BURN, 3, 0.04, tier);
          }
        }
      }
    }
    // POISONED_BLADE (2026-05 v6): melee-only (gated in ItemRules).
    // Single-target but deeper — 6% HP/sec for 4s vs the old 2s. Identity:
    // sustained single-target finisher applied with every cut.
    if (t.equippedItems.includes('POISONED_BLADE')) pushStatus(target, StatusEffectKind.POISON, 4, 0.06, tier);
    // 2026-05-18 — UPRISING-exclusive SOULFIRE_BRAND: stamps HELLFIRE
    // on the target. HELLFIRE bypasses every resistance and immunity
    // (it's divine fire) so this is the dedicated answer to anything
    // that shrugs off normal burns — fire-immune undead, regenerators,
    // bosses. 4% maxHP/sec for 4s = 16% maxHP per application; stacks
    // with the in-system HELLFIRE-on-hit from RITE OF DOOM towers.
    if (t.equippedItems.includes('SOULFIRE_BRAND')) {
      pushStatus(target, StatusEffectKind.HELLFIRE, 4, 0.04, tier);
    }
    // 2026-05-18 — GATES OF HELL-exclusive INFERNO_STANDARD: aura
    // damage buff is handled in the localAuras pass; the on-hit
    // BURN ride-along stamps a BURN status on every direct hit.
    if (t.equippedItems.includes('INFERNO_STANDARD')) {
      pushStatus(target, StatusEffectKind.BURN, 3, 0.05, tier);
    }
    // 2026-05 v11 BLEED BOOST: bleed items felt under-tuned relative to the
    // poison / burn family. Each tier doubled-ish to make bleed a real
    // competitive DoT path. Total bleed damage per application:
    //   BARBED_GLADIUS    : 10s × 2.0% = 20% maxHP (was 10%)
    //   FALCATA_BLADE     :  8s × 3.0% = 24% maxHP (was 17.6%) — "hot bleed"
    //   ALPHA_PACK_FANG   : 14s × 2.4% = 33.6% maxHP (was 22.4%) — "heavy bleed"
    if (t.equippedItems.includes('BARBED_GLADIUS')) pushStatus(target, StatusEffectKind.BLEED, 10, 0.020, tier);
    // FALCATA_BLADE: front-loaded variant, shorter / hottest tick of the three.
    if (t.equippedItems.includes('FALCATA_BLADE')) pushStatus(target, StatusEffectKind.BLEED, 8, 0.030, tier);
    // ALPHA PACK FANG: longest envelope, highest total damage.
    if (t.equippedItems.includes('ALPHA_PACK_FANG')) pushStatus(target, StatusEffectKind.BLEED, 14, 0.024, tier);
    // VESTAL PYRE: every-tower fire DoT. Applies BURN on hit. Magnitude
    // 5% maxHP/sec × 3s = 15% maxHP total per application. Lower
    // single-tower throughput than FIRE_OIL_FLASK but unrestricted
    // by class (any tower can carry it).
    if (t.equippedItems.includes('VESTAL_PYRE')) pushStatus(target, StatusEffectKind.BURN, 3, 0.05, tier);
    // 2026-05 v9 — three new POISON-family items closing the gap with
    // burn/bleed which already had multiple options.
    //   VENOM_TIPPED_ARROWS : RANGED-only · 5%/sec × 4s = 20% maxHP total
    //   SERPENT_AMULET      : ANY tower   · 3%/sec × 5s = 15% maxHP total
    //   WITCHS_VENOM        : RARE, ANY   · 8%/sec × 5s = 40% maxHP total
    // The DOT_POISON sub-family rule means a tower can carry at most ONE
    // of these (+ POISONED_BLADE) — they don't stack on the same tower.
    if (t.equippedItems.includes('VENOM_TIPPED_ARROWS')) pushStatus(target, StatusEffectKind.POISON, 4, 0.05, tier);
    if (t.equippedItems.includes('SERPENT_AMULET'))      pushStatus(target, StatusEffectKind.POISON, 5, 0.03, tier);
    if (t.equippedItems.includes('WITCHS_VENOM'))        pushStatus(target, StatusEffectKind.POISON, 5, 0.08, tier);
  }
}

// Read at module scope so pushStatus can adjust durations from weather.
function getWeatherStatusPenalty(): number {
  // Lazily fetch from window-stashed game state — keeps signature unchanged.
  const gs = (window as any).__game;
  if (!gs?.weatherKey) return 0;
  const w = FACTION_WEATHER[gs.weatherKey];
  if (!w) return 0;
  return w.statusDurationPenalty * (gs.weatherIntensity ?? 1);
}
export function pushStatus(e: Enemy, kind: StatusEffectKind, duration: number, magnitude: number, sourceTier: number) {
  if (statusEffectiveness(e, kind) <= 0) return;
  // BOSSES ARE IMMUNE TO STUN. Stuns paired with splash/cleave were locking
  // bosses in place — boss mechanics (rebirth, stampede, summons) need the
  // boss to ACT, and the player has plenty of % HP DOT + direct damage to
  // pressure them. Bosses still take FREEZE on freeze-specific procs (e.g.
  // Frozen Legion, Augur's omen) but at half duration.
  if (e.isBoss && kind === StatusEffectKind.STUN) return;
  if (e.isBoss && kind === StatusEffectKind.FREEZE) duration *= 0.5;
  // 2026-05 v11: STUN / FREEZE LOCKDOWN DIMINISHING RETURNS.
  // Without DR, multi-tower compositions (e.g. two Cohort Guards + a
  // Frozen Legion) would refresh stuns every frame and lock enemies in
  // place permanently. To preserve each tower's individual mechanic but
  // stop the infinite chain, every enemy carries a `__lockdownDRUntil`
  // tick stamp. When a new STUN or FREEZE arrives while the stamp is in
  // the future, the new application is ignored (the existing lockdown is
  // already covering that span). When the stamp has passed, the new
  // lockdown applies normally and arms a fresh post-stun immunity window
  // equal to its own duration (capped 1.5s). Net effect: enemies are
  // locked at most ~50% of the time under heavy lockdown pressure, so
  // damage still pours in but they never freeze in place. Towers'
  // mechanics, durations, and trigger conditions are untouched.
  if (kind === StatusEffectKind.STUN || kind === StatusEffectKind.FREEZE) {
    const tickNow = (window as any).__lastState?.tick ?? 0;
    const drUntil = (e as any).__lockdownDRUntil ?? 0;
    if (tickNow < drUntil) {
      // Still in the active lockdown window OR in the post-lockdown
      // immunity grace. Drop the new attempt entirely — the enemy is
      // already either frozen or in their guaranteed mobile beat.
      return;
    }
    // Arm next DR window: stun runs for `duration`, then immunity for
    // min(1.5, duration). Half-on / half-off cadence under stun pressure.
    const immunity = Math.min(1.5, duration);
    (e as any).__lockdownDRUntil = tickNow + duration + immunity;
  }
  // Weather shortens status durations (Cursed Wind / Hellscape).
  const penalty = getWeatherStatusPenalty();
  if (penalty > 0) duration *= (1 - penalty);
  // SACER_VESTAL — VESTAL SANCTUM: doubles status duration on enemies inside
  // any Vestal's range. Read live tower set off the global state ref.
  const stateRef = (window as any).__lastState;
  if (stateRef?.towers) {
    for (const tw of stateRef.towers.values()) {
      if (tw.type !== TowerType.SACER_VESTAL || tw.pending) continue;
      const cx = tw.tileX * GRID.TILE + GRID.TILE / 2;
      const cy = tw.tileY * GRID.TILE + GRID.TILE / 2;
      const r = (tw.range ?? 4.5) * GRID.TILE;
      if (Math.hypot(e.x - cx, e.y - cy) <= r) { duration *= 2.0; break; }
    }
  }
  // Refresh if same kind exists
  const existing = e.statusEffects.find(s => s.kind === kind);
  if (existing) {
    existing.remaining = Math.max(existing.remaining, duration);
    existing.magnitude = Math.max(existing.magnitude, magnitude);
    return;
  }
  e.statusEffects.push({ kind, remaining: duration, magnitude, sourceTier });
}

// Kill bonus accumulator
export function awardKillBonus(t: Tower) {
  t.killCount += 1;
  // 2026-05 v6: Mercator-exclusive Punic Ledger doubles the per-kill ramp
  // so the +10% cap arrives twice as fast on towers that carry it.
  const rate = t.equippedItems.includes('PUNIC_LEDGER') ? KILL_BONUS_RATE * 2 : KILL_BONUS_RATE;
  t.killBonusFlat = Math.min(t.baseDps * KILL_BONUS_MAX_PCT, t.killBonusFlat + t.baseDps * rate);
  // Evocatus signature: tactical stacks accumulate, capped at 10.
  if (t.type === TowerType.EVOCATUS) {
    (t as any).__tacticalStacks = Math.min(10, ((t as any).__tacticalStacks ?? 0) + 1);
  }
  // 2026-05 v7: TRIUMPHATOR — TRIUMPHAL WREATH. +1.5% damage per kill
  // this wave, capped at +30% (20 kills). Wreath resets between waves
  // (set on wave start in main.ts). Different from Evocatus's tactical
  // stacks: the wreath builds faster (1.5% vs Evocatus's 5%) and caps
  // lower (30% vs 50%) — Triumphator's identity is "scariest tower on
  // the field by mid-wave".
  if (t.type === TowerType.TRIUMPHATOR) {
    (t as any).__triumphalWreath = Math.min(20, ((t as any).__triumphalWreath ?? 0) + 1);
  }
}
