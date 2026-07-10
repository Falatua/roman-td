import { Tower, Enemy, DamageType, TowerType } from '../types';
import { GameStateShape } from '../GameState';
import { GRID, RENDER_LIMITS, AURA_TILE_EFFECTS } from '../constants';
import { towerAuraTileKind } from './TowerSystem';

export interface FlyingProjectile {
  id: string;
  spriteKey: string;          // Asset key: PROJ_ARROW, etc.
  x: number; y: number;
  spawnX: number; spawnY: number;
  targetId: string;
  damage: number;
  damageType: DamageType;
  sourceTowerId: string;
  speed: number;              // px/sec
  arc: boolean;
  totalTime: number;          // total flight duration (sec) for arc
  travelTime: number;         // accumulator
  rotation: number;
  alive: boolean;
  splash: number;             // tile radius for AoE on hit (0 = single target)
  // Embed metadata for arrow-stick effect
  embedAfter: boolean;
  // COSMETIC flag (2026-05): visual-only projectiles spawned alongside an
  // attack that already resolved damage at swing time (SPEAR OF MARS,
  // JUPITER'S WRATH chain bolt). The impact handler skips damage/status
  // application so we don't double-apply on-hit effects.
  cosmetic?: boolean;
}

let nextId = 1;
function newId(): string { return `pj${nextId++}`; }

// Each tower's projectile is keyed to its unit silhouette. Light units throw
// PROJ_LIGHT_JAVELIN, heavy infantry throws PROJ_PILUM, cavalry/late-tier
// officers throw the heavier PROJ_JAVELIN, archers fire PROJ_ARROW, ballistas
// shoot PROJ_BALLISTA, divine casters cast PROJ_STAFF, and fire/siege engines
// lob PROJ_BARREL. Spear units throw PROJ_HASTA. PROJ_SLASH is reserved for
// melee impact VFX (handled separately, not here).
const PROJ_FOR_TOWER: Partial<Record<TowerType, { key: string; arc: boolean; speed: number; splash: number; embed: boolean }>> = {
  // T1 base
  [TowerType.VELITES]:        { key: 'PROJ_LIGHT_JAVELIN', arc: false, speed: 520, splash: 0,   embed: true },
  [TowerType.HASTATI]:        { key: 'PROJ_PILUM',         arc: true,  speed: 480, splash: 0.8, embed: true },
  [TowerType.SAGITTARIUS]:    { key: 'PROJ_ARROW',         arc: true,  speed: 560, splash: 0,   embed: true },
  [TowerType.SCORPIO]:        { key: 'PROJ_BALLISTA',      arc: false, speed: 800, splash: 0,   embed: true },
  [TowerType.TRIARIUS]:       { key: 'PROJ_HASTA',         arc: true,  speed: 480, splash: 0,   embed: true },
  [TowerType.LEGATE]:         { key: 'PROJ_STAFF',         arc: false, speed: 540, splash: 1.0, embed: true },
  // T1 band extras
  // FUNDIBULUS — slinger sprite, throws compact projectile in a high arc
  // (PROJ_LIGHT_JAVELIN is the closest sling-stone-shaped asset; no
  // dedicated PROJ_STONE exists, but a light dart at a steep arc reads as
  // "sling stone in flight" at game scale).
  [TowerType.FUNDIBULUS]:     { key: 'PROJ_LIGHT_JAVELIN', arc: true,  speed: 470, splash: 0.45, embed: false },
  [TowerType.RORARIUS]:       { key: 'PROJ_LIGHT_JAVELIN', arc: false, speed: 660, splash: 0,   embed: true },
  [TowerType.LIBRITOR]:       { key: 'PROJ_HASTA',         arc: true,  speed: 430, splash: 0.65, embed: true },
  // T2 band
  // RETIARIUS (renamed from LANCEARIUS in 2026-05 v9) sits in MELEE_TYPES
  // at melee range — the gladiator stabs with his trident and snares with
  // the net. The combat-resolver melee path applies damage instantly with
  // the slash VFX; no projectile entry needed.
  [TowerType.BALLISTARIUS]:   { key: 'PROJ_BALLISTA',      arc: false, speed: 760, splash: 1.1, embed: true },
  [TowerType.OPTIO]:          { key: 'PROJ_LIGHT_JAVELIN', arc: false, speed: 610, splash: 0,   embed: true },
  // ARCUBALLISTA — single-archer sprite now (was 2-crew ballista). Fires
  // a heavy arrow with crit-lean instead of a ballista bolt.
  [TowerType.ARCUBALLISTA]:   { key: 'PROJ_ARROW',         arc: false, speed: 820, splash: 0,   embed: true },
  // T3 band
  // VENATOR — Scythian Archer sprite (post-v10), bow archer on foot.
  // Fires standard arrows in an arc.
  [TowerType.VENATOR]:        { key: 'PROJ_ARROW',         arc: true,  speed: 600, splash: 0,   embed: true },
  [TowerType.IGNIFER]:        { key: 'PROJ_BARREL',        arc: true,  speed: 420, splash: 1.0, embed: false },
  // SPECULATOR — cloaked spy sprite (no bow). Flings a marker dart at the
  // mark target. PROJ_LIGHT_JAVELIN reads as "thrown blade" at game scale.
  [TowerType.SPECULATOR]:     { key: 'PROJ_LIGHT_JAVELIN', arc: false, speed: 680, splash: 0,   embed: true },
  [TowerType.FLAMEN]:         { key: 'PROJ_STAFF',         arc: false, speed: 560, splash: 0.8, embed: true },
  [TowerType.CARROBALLISTA]:  { key: 'PROJ_BALLISTA',      arc: true,  speed: 500, splash: 1.4, embed: true },
  [TowerType.AQUILA_VENATOR]: { key: 'PROJ_ARROW',         arc: true,  speed: 620, splash: 0,   embed: true },
  // T4 band — divine casters now fire thematic projectiles instead of
  // the generic war-staff bolt.
  // AUGUR — reads bird-omens, flings a blue divination orb.
  [TowerType.AUGUR]:          { key: 'PROJ_OMEN_ORB',      arc: false, speed: 620, splash: 0.65, embed: false },
  // HARUSPEX — entrail-reader, hurls a prophecy scroll that strikes home.
  [TowerType.HARUSPEX]:       { key: 'PROJ_SIBYL_SCROLL',  arc: true,  speed: 540, splash: 0.95, embed: false },
  // 2026-05 v7: CLIBANARIUS retired from PROJ_FOR_TOWER — heavy cataphract
  // melee charge now, instant-damage on swing.
  // T5 band
  // PRAEFECTUS — dark-armor commander w/ eagle scepter sprite. Fires a
  // divine command-bolt from the scepter (PROJ_STAFF) rather than a
  // physical javelin. Still classified PHYS_RANGED — the scepter cast is
  // cosmetic, not divine damage type.
  [TowerType.PRAEFECTUS]:     { key: 'PROJ_STAFF',         arc: false, speed: 650, splash: 0,   embed: true },
  [TowerType.VULCAN_ENGINEER]:{ key: 'PROJ_BARREL',        arc: true,  speed: 360, splash: 2.0, embed: false },
  // SOLAR_PRIEST — radiant sun bursts from his lituus. Slight arc fits
  // the "celestial pulse" cast, and embed=false because the sun-flare
  // hits and dissipates rather than sticking like a physical bolt.
  [TowerType.SOLAR_PRIEST]:   { key: 'PROJ_SOLAR_FLARE',   arc: true,  speed: 560, splash: 1.15, embed: false },
  [TowerType.COLOSSUS_ONAGER]:{ key: 'PROJ_BARREL',        arc: true,  speed: 320, splash: 2.4, embed: false },
  // Combination towers
  [TowerType.SCORPION_BOLT]:  { key: 'PROJ_BALLISTA',      arc: false, speed: 800, splash: 0,   embed: true },
  [TowerType.WAR_CHARIOT]:    { key: 'PROJ_BALLISTA',      arc: true,  speed: 540, splash: 2.5, embed: true },
  [TowerType.NUMIDIAN_CAVALRY]: { key: 'PROJ_JAVELIN',     arc: false, speed: 640, splash: 0,   embed: true },
  [TowerType.AERARIUM]:       { key: 'PROJ_LIGHT_JAVELIN', arc: false, speed: 520, splash: 0,   embed: true },
  // FROZEN_LEGION — frost-themed combo, lobs a snowflake shard that
  // applies freeze on hit. Mechanically still a single-target throw.
  [TowerType.FROZEN_LEGION]:  { key: 'PROJ_FROST_SHARD',   arc: true,  speed: 580, splash: 0,   embed: false },
  [TowerType.SIEGE_ONAGER]:   { key: 'PROJ_BARREL',        arc: true,  speed: 380, splash: 3.0, embed: false },
  // 2026-05 v7: Plague Cart now hurls a slow, arcing POISON CLOUD flask
  // (re-uses s_poison sprite, tinted green in drawProjectiles). Arc on,
  // slower speed so the player visibly sees the lob, no embed.
  [TowerType.PLAGUE_CART]:    { key: 'PROJ_POISON_CLOUD',  arc: true,  speed: 320, splash: 1.2, embed: false },
  [TowerType.INFERNO_CART]:   { key: 'PROJ_BARREL',        arc: false, speed: 440, splash: 1.5, embed: false },
  [TowerType.HANNIBALS_NIGHTMARE]: { key: 'PROJ_JAVELIN',  arc: false, speed: 760, splash: 0,   embed: true },
  // JULIUS_CAESAR — imperial divine power, throws an orange-flame orb.
  [TowerType.JULIUS_CAESAR]:  { key: 'PROJ_IMPERIAL_ORB',  arc: false, speed: 700, splash: 1.5, embed: false },
  // GOD_OF_WAR — stamps HELLFIRE on every hit, so the projectile IS a
  // flaming hellfire sigil. Big visible flame matches the on-hit DoT.
  [TowerType.GOD_OF_WAR]:     { key: 'PROJ_HELLFIRE_BOLT', arc: false, speed: 720, splash: 2.0, embed: false },
  // ── Single combos (tc_*) ─────────────────────────────────────────────
  // Tesserarius — fast blood-marked pilum throws, applies Bleed
  [TowerType.TESSERARIUS]:    { key: 'PROJ_PILUM',         arc: false, speed: 640, splash: 0,    embed: true },
  // Scout Vexillum — light javelin chip support
  [TowerType.SCOUT_VEXILLUM]: { key: 'PROJ_LIGHT_JAVELIN', arc: false, speed: 600, splash: 0,    embed: true },
  // Stormcaller — chain lightning priest, throws a thunder bolt itself
  [TowerType.STORMCALLER]:    { key: 'PROJ_STORM_BOLT',    arc: false, speed: 720, splash: 0.4,  embed: false },
  // Sacer Vestal — tosses her sacred-flame bowl (Vestal Blessing) at
  // the target. Slow, glowing, single-target — fits the "support presence
  // anointing the front line" theme.
  [TowerType.SACER_VESTAL]:   { key: 'PROJ_VESTAL_BLESSING', arc: true, speed: 540, splash: 0,    embed: false },
  // Tribunus Laticlavius — heavy senatorial hasta, slow arc with gravitas
  [TowerType.TRIBUNUS_LATICLAVIUS]: { key: 'PROJ_HASTA',   arc: true,  speed: 540, splash: 0.3,  embed: true },
  // Nemesis Engine — anti-air sky-ripper bolt. Fast, no arc (aims UP)
  [TowerType.NEMESIS_ENGINE]: { key: 'PROJ_BALLISTA',      arc: false, speed: 900, splash: 1.8,  embed: true },
  // Pontifex Maximus — boss-slayer divine bolt
  [TowerType.PONTIFEX_MAXIMUS]: { key: 'PROJ_STAFF',       arc: false, speed: 660, splash: 0.6,  embed: true },
  // ── Cross-combos (tcc_*) ─────────────────────────────────────────────
  // Aurora Legion — divine piercing-line arrow
  [TowerType.AURORA_LEGION]:  { key: 'PROJ_ARROW',         arc: false, speed: 720, splash: 0,    embed: true },
  // Storm Vexillation — banner of lightning, chain bolts
  [TowerType.STORM_VEXILLATION]: { key: 'PROJ_STORM_BOLT', arc: false, speed: 740, splash: 0.4,  embed: false },
  // Imperium Eternum — apex divine. Hurls a gold-purple unique-tier orb
  // that quakes the field 3 tiles on impact.
  [TowerType.IMPERIUM_ETERNUM]: { key: 'PROJ_DIVINE_APEX_ORB', arc: false, speed: 700, splash: 0.6, embed: false },
  // Carthage Scourge — six-bolt repeating ballista volley
  [TowerType.CARTHAGE_SCOURGE]: { key: 'PROJ_BALLISTA',    arc: false, speed: 820, splash: 0.5,  embed: true },
  // ── Super combos (ts_*) ──────────────────────────────────────────────
  // Legion Prime — heavy divine artillery (slow barrel arc)
  [TowerType.LEGION_PRIME]:   { key: 'PROJ_BARREL',        arc: true,  speed: 400, splash: 1.8,  embed: false },
  // Mars Victor — DIVINE apex: a radiant smiting orb with a wide holy splash.
  [TowerType.MARS_VICTOR]:    { key: 'PROJ_DIVINE_APEX_ORB', arc: false, speed: 720, splash: 1.0, embed: false },
  // 2026-06-28 — 4 new ranged combos.
  [TowerType.STORM_BALLISTA]:    { key: 'PROJ_BALLISTA',       arc: false, speed: 780, splash: 1.4, embed: true  },
  [TowerType.SKYREAPER_BATTERY]: { key: 'PROJ_ARROW',          arc: true,  speed: 640, splash: 0,   embed: true  },
  [TowerType.PLAGUE_LOBBER]:     { key: 'PROJ_POISON_CLOUD',   arc: true,  speed: 340, splash: 1.2, embed: false },
  [TowerType.AUGURS_WRATH]:      { key: 'PROJ_DIVINE_APEX_ORB', arc: true, speed: 600, splash: 1.0, embed: false },
  // 2026-06-28 — 2 new combos + 2 new super-combos.
  [TowerType.EXPLORATORES]:      { key: 'PROJ_ARROW',          arc: true,  speed: 700, splash: 0,   embed: true  },
  [TowerType.VULCAN_BOMBARD]:    { key: 'PROJ_BARREL',         arc: true,  speed: 360, splash: 2.6, embed: false },
  [TowerType.VANGUARD_WING]:     { key: 'PROJ_ARROW',          arc: true,  speed: 730, splash: 0,   embed: true  },
  [TowerType.VULCAN_COLOSSUS]:   { key: 'PROJ_BARREL',         arc: true,  speed: 380, splash: 3.5, embed: false },
  [TowerType.SKY_DOMINION]:      { key: 'PROJ_STORM_BOLT',     arc: true,  speed: 780, splash: 0.4, embed: false },
  [TowerType.INFERNAL_COLOSSUS]: { key: 'PROJ_BARREL',         arc: true,  speed: 360, splash: 4.0, embed: false },
  // ── Harbor / Tideforged towers ──────────────────────────────────────
  // These towers are not cosmetic callers: their damage is delivered on
  // projectile impact. Keep every ranged naval/tideforged type here so
  // the visual shot, actual HP loss, and leaderboard damage credit stay
  // locked together.
  [TowerType.TRIREME_BALLISTA]:      { key: 'PROJ_BALLISTA',        arc: false, speed: 800, splash: 0.8, embed: true  },
  [TowerType.RAMMING_QUINQUEREME]:   { key: 'PROJ_DIVINE_APEX_ORB', arc: false, speed: 660, splash: 1.0, embed: false },
  [TowerType.CHARYBDIS_VORTEX]:      { key: 'PROJ_OMEN_ORB',        arc: false, speed: 620, splash: 0.8, embed: false },
  [TowerType.NEREID_ORACLE]:         { key: 'PROJ_OMEN_ORB',        arc: false, speed: 680, splash: 0.35, embed: false },
  [TowerType.PRAETORIAN_FLEET]:      { key: 'PROJ_BALLISTA',        arc: false, speed: 840, splash: 1.1, embed: true  },
  [TowerType.ORACLE_LIGHTHOUSE]:     { key: 'PROJ_OMEN_ORB',        arc: false, speed: 720, splash: 0.55, embed: false },
  [TowerType.ABYSSAL_ONAGER]:        { key: 'PROJ_POISON_CLOUD',    arc: true,  speed: 360, splash: 2.2, embed: false },
  [TowerType.MARS_TIDAL_BASTION]:    { key: 'PROJ_DIVINE_APEX_ORB', arc: false, speed: 700, splash: 1.2, embed: false },
  [TowerType.GIANT_KILLER]:          { key: 'PROJ_GIANT_ARROW',     arc: true,  speed: 760, splash: 0.55, embed: true  },
  // Consular Fatebinder — every shot strikes every enemy on the map
  // (true damage map-wide handled separately). The visible cast is a
  // fate-binding apex orb to the primary target — cosmetic anchor for the
  // map-wide strike. embed:false because true-damage hits don't stick.
  [TowerType.CONSULAR_FATEBINDER]: { key: 'PROJ_DIVINE_APEX_ORB', arc: false, speed: 820, splash: 0, embed: false },
  // ── Heroes ───────────────────────────────────────────────────────────
  // Projectile silhouette matches each hero's kit so the visual reads as
  // a named hero attack rather than another generic tower shot.
  //
  // HERO_MARIUS (PHYS_MELEE), HERO_SCIPIO (PHYS_MELEE), and HERO_CAESAR (DIVINE melee) stay OUT
  // of this map — they're in MELEE_TYPES (CombatResolver:113) and use
  // the slash-arc VFX. Caesar's slash is tinted gold at the call site
  // in main.ts to read as a DIVINE swing.
  //
  // Projectile picks:
  //   Agrippa  (SIEGE)         → hero ballista bolt + dust-burst impact.
  //   Agricola (PHYS_RANGED)   → hero blue arrow + frost-blue impact star.
  //   Sulla    (ELEMENTAL_FIRE)→ hero meteor + fiery impact burst.
  [TowerType.HERO_AGRIPPA]:   { key: 'HERO_PROJ_AGRIPPA_BOLT',   arc: true,  speed: 540, splash: 0.8, embed: true  },
  [TowerType.HERO_AGRICOLA]:  { key: 'HERO_PROJ_AGRICOLA_ARROW', arc: true,  speed: 600, splash: 0.8, embed: true  },
  [TowerType.HERO_SULLA]:     { key: 'HERO_PROJ_SULLA_METEOR',   arc: true,  speed: 560, splash: 1.2, embed: false },
  [TowerType.CHAMPION_AGRIPPA]:  { key: 'HERO_PROJ_AGRIPPA_BOLT',   arc: true,  speed: 540, splash: 0.8, embed: true  },
  [TowerType.CHAMPION_AGRICOLA]: { key: 'HERO_PROJ_AGRICOLA_ARROW', arc: true,  speed: 600, splash: 0.8, embed: true  },
  [TowerType.CHAMPION_SULLA]:    { key: 'HERO_PROJ_SULLA_METEOR',   arc: true,  speed: 560, splash: 1.2, embed: false }
  // ──────────────────────────────────────────────────────────────────
  // Pure-aura support towers — intentionally NOT in this map because
  // they never call spawnProjectile (`CombatResolver` routes them
  // straight to global-aura buff logic): EAGLE_STANDARD, AQUILIFER_TITAN,
  // TRIUMVIRATE. (AERARIUM does fire — it's a treasury combo with light
  // javelin attacks plus a +1g per kill rider, see entry above.)
};

export function getTowerProjectileProfile(type: TowerType) {
  return PROJ_FOR_TOWER[type] ?? null;
}

export function spawnProjectile(state: GameStateShape, tower: Tower, target: Enemy, damage: number) {
  const def = PROJ_FOR_TOWER[tower.type];
  if (!def) return; // melee — no projectile (handled separately as slash VFX)
  const siegeSplash = tower.damageType === DamageType.SIEGE ? 0.8 : 0;

  // ITEM-DRIVEN PROJECTILE SWAPS (2026-05): the projectile sprite reads
  // the tower's equipped legendaries / themed items so the visual matches
  // the effect being applied. Priority order picks the most-dramatic
  // swap when multiple items would qualify (JUPITER'S WRATH wins over
  // STORM_JAVELIN; STORM swaps win over FIRE_OIL_FLASK). Stat stays on
  // the tower's normal profile — only the silhouette changes.
  const usesStormBolt = tower.equippedItems.includes('JUPITERS_WRATH')
                     || tower.equippedItems.includes('STORM_JAVELIN');
  // FIRE_OIL_FLASK only swaps in for non-staff non-barrel sprites — a
  // Solar Priest casting a fire-barrel of oil would look silly. Limits
  // the swap to physical-projectile towers (pilum / arrow / javelin /
  // hasta / light-javelin) where the sprite swap reads as oil-soaked.
  const fireOilEligible = tower.equippedItems.includes('FIRE_OIL_FLASK')
    && (def.key === 'PROJ_PILUM' || def.key === 'PROJ_ARROW'
        || def.key === 'PROJ_JAVELIN' || def.key === 'PROJ_LIGHT_JAVELIN'
        || def.key === 'PROJ_HASTA');
  const spriteKey = usesStormBolt
    ? 'PROJ_STORM_BOLT'
    : (fireOilEligible ? 'PROJ_BARREL' : def.key);

  const sx = tower.tileX * GRID.TILE + GRID.TILE / 2;
  const sy = tower.tileY * GRID.TILE + GRID.TILE / 2;
  const dx = target.x - sx, dy = target.y - sy;
  const dist = Math.hypot(dx, dy);
  const totalTime = dist / def.speed;

  if (state.projectiles.length >= RENDER_LIMITS.PROJECTILE_POOL) {
    // pool full — drop oldest
    state.projectiles.shift();
  }

  state.projectiles.push({
    id: newId(),
    spriteKey,
    x: sx, y: sy,
    spawnX: sx, spawnY: sy,
    targetId: target.id,
    damage,
    damageType: tower.damageType,
    sourceTowerId: tower.id,
    speed: def.speed,
    arc: def.arc,
    totalTime,
    travelTime: 0,
    rotation: Math.atan2(dy, dx),
    alive: true,
    // 2026-06-27 — Every SIEGE attacker now carries at least a small blast,
    // while existing artillery keeps its larger tuned radius. AMBER (BLAST)
    // tile and Concussive Warhead remain minimum-radius upgrades on top.
    splash: Math.max(
      def.splash,
      siegeSplash,
      tower.equippedItems.includes('CONCUSSIVE_WARHEAD') ? 1.6 : 0,   // 2026 v2 legendary splash
      (() => { const k = towerAuraTileKind(tower); return (k && AURA_TILE_EFFECTS[k].splashBonus) || 0; })()
    ),
    embedAfter: def.embed && !usesStormBolt && !fireOilEligible   // storm/fire-oil don't stick
  });
}

// COSMETIC PROJECTILE — used by SPEAR OF MARS (melee tower throws a visible
// spear so the +5 tile reach reads) and JUPITER'S WRATH (visible thunder
// bolt swap). Damage was already applied at swing time; this projectile
// carries 0 damage so its impact handler is a no-op visual finish.
// `damage:0 splash:0 embedAfter:false` means the projectile pings to the
// target, vanishes, and that's it. Skips the pool-eviction churn for the
// real-damage projectile queue.
export function spawnCosmeticProjectile(state: GameStateShape, tower: Tower, target: Enemy, spriteKey: string, speed = 620) {
  const sx = tower.tileX * GRID.TILE + GRID.TILE / 2;
  const sy = tower.tileY * GRID.TILE + GRID.TILE / 2;
  const dx = target.x - sx, dy = target.y - sy;
  const dist = Math.hypot(dx, dy);
  const totalTime = dist / speed;
  if (state.projectiles.length >= RENDER_LIMITS.PROJECTILE_POOL) {
    state.projectiles.shift();
  }
  state.projectiles.push({
    id: newId(),
    spriteKey,
    x: sx, y: sy,
    spawnX: sx, spawnY: sy,
    targetId: target.id,
    damage: 0,
    damageType: tower.damageType,
    sourceTowerId: tower.id,
    speed,
    arc: false,
    totalTime,
    travelTime: 0,
    rotation: Math.atan2(dy, dx),
    alive: true,
    splash: 0,
    embedAfter: false,
    cosmetic: true
  });
}

export interface ProjectileHooks {
  onImpact: (p: FlyingProjectile, target: Enemy | null, hitX: number, hitY: number) => void;
}

export function tickProjectiles(state: GameStateShape, dt: number, hooks: ProjectileHooks) {
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i] as FlyingProjectile;
    if (!p.alive) { state.projectiles.splice(i, 1); continue; }
    const target = state.enemies.get(p.targetId);
    p.travelTime += dt;
    const t = Math.min(1, p.travelTime / Math.max(0.001, p.totalTime));
    // Track current target if alive; otherwise hit the original projected impact spot.
    if (target) {
      p.x = p.spawnX + (target.x - p.spawnX) * t;
      p.y = p.spawnY + (target.y - p.spawnY) * t;
      p.rotation = Math.atan2(target.y - p.spawnY, target.x - p.spawnX);
      // Arc adds a parabolic vertical offset for visual flavor
      if (p.arc) p.y -= Math.sin(t * Math.PI) * 24;
    } else {
      // target dead — keep flying in original direction
      p.x = p.spawnX + Math.cos(p.rotation) * p.speed * p.travelTime;
      p.y = p.spawnY + Math.sin(p.rotation) * p.speed * p.travelTime;
      if (p.arc) p.y -= Math.sin(t * Math.PI) * 24;
    }
    if (t >= 1) {
      p.alive = false;
      hooks.onImpact(p, target ?? null, p.x, p.y);
      state.projectiles.splice(i, 1);
    }
  }
}
