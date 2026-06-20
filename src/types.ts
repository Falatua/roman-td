// All shared types for Roman TD. Other files import from here.

export enum TileType {
  EMPTY,
  STONE,
  TOWER,
  WAYPOINT,
  SPAWN,
  GATE,
  TRAP,
  BORDER
}

export enum DamageType {
  PHYS_MELEE,
  PHYS_RANGED,
  SIEGE,
  ELEMENTAL_FIRE,
  DIVINE,
  NONE
}

export enum EnemyFaction {
  DOGS,
  CELTS,
  CARTHAGE,
  UNDEAD_CELTS,
  UNDEAD_CARTHAGE,
  SUPER_DEMONS,
  // 2026-05 v10 — ENDLESS MODE factions. No lore — they just appear when
  // the player crosses into post-W20 Endless. Free-mix with each other
  // and with returning W1-W20 enemies inside the same Endless wave.
  MONGOLS,
  EGYPTIANS,
  // 2026 v2 spec Ch10-11 — Roman-myth elite creatures (W25-29). Tough vs
  // steel/fire, but weak to DIVINE (Rome's gods smite the old monsters).
  ROMAN_MYTH
}

export enum EntityType {
  ENEMY,
  BUILDER,
  TOWER,
  PROJECTILE,
  PARTICLE
}

export enum TowerType {
  // 10 base
  MILITES = 'MILITES',
  VELITES = 'VELITES',
  HASTATI = 'HASTATI',
  SAGITTARIUS = 'SAGITTARIUS',
  SCORPIO = 'SCORPIO',
  TRIARIUS = 'TRIARIUS',
  DECURION = 'DECURION',
  CENTURION = 'CENTURION',
  PRIMUS_PILUS = 'PRIMUS_PILUS',
  LEGATE = 'LEGATE',
  AUXILIA = 'AUXILIA',
  FUNDIBULUS = 'FUNDIBULUS',
  RORARIUS = 'RORARIUS',
  LIBRITOR = 'LIBRITOR',
  ACCENSUS = 'ACCENSUS',
  RETIARIUS = 'RETIARIUS',
  BALLISTARIUS = 'BALLISTARIUS',
  OPTIO = 'OPTIO',
  PUGIO_ASSASSIN = 'PUGIO_ASSASSIN',
  ARCUBALLISTA = 'ARCUBALLISTA',
  VENATOR = 'VENATOR',
  IGNIFER = 'IGNIFER',
  SPECULATOR = 'SPECULATOR',
  FLAMEN = 'FLAMEN',
  CARROBALLISTA = 'CARROBALLISTA',
  CATAPHRACT = 'CATAPHRACT',
  AUGUR = 'AUGUR',
  EVOCATUS = 'EVOCATUS',
  HARUSPEX = 'HARUSPEX',
  CLIBANARIUS = 'CLIBANARIUS',
  PRAEFECTUS = 'PRAEFECTUS',
  VULCAN_ENGINEER = 'VULCAN_ENGINEER',
  IMPERATOR_GUARD = 'IMPERATOR_GUARD',
  SOLAR_PRIEST = 'SOLAR_PRIEST',
  COLOSSUS_ONAGER = 'COLOSSUS_ONAGER',
  AQUILA_VENATOR = 'AQUILA_VENATOR',
  // 16 combinations
  HORSEMAN = 'HORSEMAN',
  SCORPION_BOLT = 'SCORPION_BOLT',
  COHORT_GUARD = 'COHORT_GUARD',
  WAR_CHARIOT = 'WAR_CHARIOT',
  EAGLE_STANDARD = 'EAGLE_STANDARD',
  PLAGUE_CART = 'PLAGUE_CART',
  NUMIDIAN_CAVALRY = 'NUMIDIAN_CAVALRY',
  PRAETORIAN_WALL = 'PRAETORIAN_WALL',
  AERARIUM = 'AERARIUM',
  SIEGE_ONAGER = 'SIEGE_ONAGER',
  AQUILIFER_TITAN = 'AQUILIFER_TITAN',
  INFERNO_CART = 'INFERNO_CART',
  FROZEN_LEGION = 'FROZEN_LEGION',
  JULIUS_CAESAR = 'JULIUS_CAESAR',
  HANNIBALS_NIGHTMARE = 'HANNIBALS_NIGHTMARE',
  GOD_OF_WAR = 'GOD_OF_WAR',
  // 9 new combination towers (3 early, 3 mid, 3 late). See towerCombinations.json.
  VEXILLATION = 'VEXILLATION',
  TESSERARIUS = 'TESSERARIUS',
  SCOUT_VEXILLUM = 'SCOUT_VEXILLUM',
  STORMCALLER = 'STORMCALLER',
  SACER_VESTAL = 'SACER_VESTAL',
  TRIBUNUS_LATICLAVIUS = 'TRIBUNUS_LATICLAVIUS',
  NEMESIS_ENGINE = 'NEMESIS_ENGINE',
  TRIUMPHATOR = 'TRIUMPHATOR',
  PONTIFEX_MAXIMUS = 'PONTIFEX_MAXIMUS',
  // 6 cross-combo towers (combos-of-combos). Hardest recipes in the game.
  TURMA_LANCERS = 'TURMA_LANCERS',
  AURORA_LEGION = 'AURORA_LEGION',
  STORM_VEXILLATION = 'STORM_VEXILLATION',
  IMPERIUM_ETERNUM = 'IMPERIUM_ETERNUM',
  CARTHAGE_SCOURGE = 'CARTHAGE_SCOURGE',
  TRIUMVIRATE = 'TRIUMVIRATE',
  // 3 SUPER combos — each requires 5 base towers. Hard to make, very rewarding.
  TRIPLEX_ACIES = 'TRIPLEX_ACIES',
  LEGION_PRIME = 'LEGION_PRIME',
  CONSULAR_FATEBINDER = 'CONSULAR_FATEBINDER',
  // 2026-05-15 — two new mid-game (T4) combos with unique melee mechanics
  // that don't overlap with existing auras / shred / bleed / brutal-opener
  // designs. Both are intentionally boss-strong.
  //   • SIGNIFERS_DRACONARIUS — first tower with a CONE-shape attack
  //     (60° forward arc) + stacking DRAGON MARK debuff on hit.
  //   • BESTIARIUS — first tower with a RAGE GAUGE that builds per-hit
  //     and unleashes a high-multiplier FRENZY STRIKE + stun.
  SIGNIFERS_DRACONARIUS = 'SIGNIFERS_DRACONARIUS',
  BESTIARIUS = 'BESTIARIUS',
  // 2026-05-17 — two early-game beast-hunter towers (T1 + T2). Specialize
  // in killing animal-faction enemies (dogs, hellhounds, war elephants).
  // Standalone — not part of any combo recipe. Visually a darker-skinned
  // shirtless dual-blade gladiator (Roman DIMACHAERUS class).
  BEAST_HUNTER = 'BEAST_HUNTER',
  BEAST_SLAYER = 'BEAST_SLAYER',
  // 2026-05-17 — MURMILLO (T4 mid-game combo). Roman heavyweight gladiator
  // (the "fish-helmet" type — galea + scutum + gladius). Anti-Carthage
  // specialist: signature PUNIC HUNTER bonus damage vs CARTHAGE +
  // UNDEAD_CARTHAGE factions, plus a SCUTUM BASH every 4th swing (stun +
  // knockback combined — rare control combo). Recipe pulls from the
  // previously-unused base towers: BALLISTARIUS + LIBRITOR + ARCUBALLISTA.
  MURMILLO = 'MURMILLO',
  // ── HEROES (2026-05-19) ──────────────────────────────────────────────
  // 6-hero pool; 3-card draft picks one per run. All historical Roman
  // generals. Heroes are placed towers with their own basic attack +
  // auto-pulse abilities; they earn XP from every kill on the field and
  // tier up through TIRO → LEGATUS → CONSUL → IMPERATOR → DIVUS.
  // Tunable data lives in src/data/herodefs.json; placement rules
  // (no sell / no combine / no move / 2 item slots) live in
  // TowerSystem.createTower.
  HERO_MARIUS   = 'HERO_MARIUS',
  HERO_AGRIPPA  = 'HERO_AGRIPPA',
  HERO_AGRICOLA = 'HERO_AGRICOLA',
  HERO_SCIPIO   = 'HERO_SCIPIO',
  HERO_CAESAR   = 'HERO_CAESAR',
  HERO_SULLA    = 'HERO_SULLA'
}

export enum EnemyType {
  FERAL_DOG = 'FERAL_DOG',
  RABID_DOG = 'RABID_DOG',
  ALPHA_DOG = 'ALPHA_DOG',
  CELTIC_FOOTMAN = 'CELTIC_FOOTMAN',
  CELTIC_BERSERKER = 'CELTIC_BERSERKER',
  GALLIC_DRUID = 'GALLIC_DRUID',
  CELTIC_SCOUT = 'CELTIC_SCOUT',
  CELTIC_WARLORD = 'CELTIC_WARLORD',
  CARTHAGE_SPEARMAN = 'CARTHAGE_SPEARMAN',
  NUMIDIAN_RIDER = 'NUMIDIAN_RIDER',
  CARTHAGE_ELITE_GUARD = 'CARTHAGE_ELITE_GUARD',
  WAR_ELEPHANT = 'WAR_ELEPHANT',
  HANNIBAL_BARCA = 'HANNIBAL_BARCA',
  UNDEAD_CELT = 'UNDEAD_CELT',
  ZOMBIE_DRUID = 'ZOMBIE_DRUID',
  UNDEAD_BERSERKER = 'UNDEAD_BERSERKER',
  SPECTRAL_SCOUT = 'SPECTRAL_SCOUT',
  UNDEAD_WARLORD = 'UNDEAD_WARLORD',
  UNDEAD_SPEARMAN = 'UNDEAD_SPEARMAN',
  GHOST_RIDER = 'GHOST_RIDER',
  UNDEAD_WAR_ELEPHANT = 'UNDEAD_WAR_ELEPHANT',
  DEMON_HELLHOUND = 'DEMON_HELLHOUND',
  CELTIC_FIRE_DEMON = 'CELTIC_FIRE_DEMON',
  SHADOW_CAVALRY = 'SHADOW_CAVALRY',
  DEMON_LEGATE = 'DEMON_LEGATE',
  DAEMON_IMPERATOR = 'DAEMON_IMPERATOR',
  IRON_PHALANX = 'IRON_PHALANX',
  ARCHITECTUS = 'ARCHITECTUS',
  // 2026-05 v11 DPS CHECK: training-dummy enemy used by the DPS CHECK
  // button. Walks the standard path but deals 0 damage on leak and is
  // ignored by wave-end / wave-spawn logic. Lets the player gauge maze
  // throughput between waves with zero risk.
  TRAINING_DUMMY = 'TRAINING_DUMMY',
  // NECROMANCY-RISEN UNDEAD (2026-05): on necromancy waves, killed ground
  // enemies spawn one of these reanimated forms at the death tile. Tagged
  // with `__reanimated:true` on the entity so the renderer can play the
  // rising-bones VFX and the score doesn't double-count the kill.
  REANIMATED_SKELETON = 'REANIMATED_SKELETON',
  REANIMATED_ZOMBIE = 'REANIMATED_ZOMBIE',
  REANIMATED_LICH = 'REANIMATED_LICH',
  // ─── ENDLESS MODE — EGYPTIANS (2026-05 v10) ─────────────────────────
  // Post-W20 chaos roster. Sprites loaded from
  // public/assets/sprites/endless/e_endless_*.png. No lore explanation
  // for their presence — they just appear.
  EGYPTIAN_ARCHER = 'EGYPTIAN_ARCHER',
  EGYPTIAN_SPEARMAN = 'EGYPTIAN_SPEARMAN',
  EGYPTIAN_CHARIOT = 'EGYPTIAN_CHARIOT',
  PHARAOH_GUARD = 'PHARAOH_GUARD',
  ANUBIS_PRIEST = 'ANUBIS_PRIEST',
  SOBEK_WARRIOR = 'SOBEK_WARRIOR',
  MUMMY_WARRIOR = 'MUMMY_WARRIOR',
  SPHINX = 'SPHINX',
  ANUBIS_KING = 'ANUBIS_KING',
  // ─── ENDLESS MODE — MONGOLS ───────────────────────────────────────
  MONGOL_HORSE_ARCHER = 'MONGOL_HORSE_ARCHER',
  MONGOL_SPEAR_RIDER = 'MONGOL_SPEAR_RIDER',
  KHAN_RIDER = 'KHAN_RIDER',
  MONGOL_FOOTMAN = 'MONGOL_FOOTMAN',
  MONGOL_SPEARMAN = 'MONGOL_SPEARMAN',
  MONGOL_BERSERKER = 'MONGOL_BERSERKER',
  MONGOL_SCOUT = 'MONGOL_SCOUT',
  MONGOL_SHAMAN = 'MONGOL_SHAMAN',
  MONGOL_CAPTAIN = 'MONGOL_CAPTAIN',
  // 2026 v2 spec Ch6 — W20 boss flyer (Egyptian undead vulture)
  BOSS_FLYER_VULTURE = 'BOSS_FLYER_VULTURE',
  // 2026 v2 spec Ch10-11 — Roman-myth elite creatures (W25-29 gauntlet)
  CHIMERA = 'CHIMERA',
  CERBERUS = 'CERBERUS',
  TYPHON = 'TYPHON',
  GIANT_GIGAS = 'GIANT_GIGAS',
  CYCLOPS = 'CYCLOPS',
  // ─── GATES OF HELL (2026-05-17 surprise event) ───────────────────────
  // HELL_GATE — stationary "enemy" that anchors the event at WP3/WP4.
  // Has HP, takes tower fire, dies via the regular death path. Its
  // death script dequeues any pending FIRE_GIANT spawns from that gate.
  // FIRE_GIANT — bulky, slow, fire-immune semi-boss that the gates
  // spawn every 2s (alternating between the two gates). Walks the
  // path from its origin waypoint to Rome.
  HELL_GATE = 'HELL_GATE',
  FIRE_GIANT = 'FIRE_GIANT'
}

// ─── SURPRISE EVENTS (2026-05-16) ─────────────────────────────────────
// Mid-wave ambient events that surprise the player. Two kinds: INVASION
// (perimeter fire breaches, any wave) and UPRISING (center-map urn
// portals, undead waves only). Spawned via SurpriseEvents.ts.
// 2026-05-17 — third event kind: GATES_OF_HELL fires on W16. Two
// destructible HELL_GATE structures spawn at the WP3 and WP4 tiles
// and pump out FIRE_GIANT semi-bosses on a 2s alternating cadence
// for 15s. Player can shut it down early by destroying the gates.
export enum SurpriseEventKind { INVASION = 'INVASION', UPRISING = 'UPRISING', GATES_OF_HELL = 'GATES_OF_HELL' }
export interface SurpriseEventSpawnPoint {
  // Pixel position of the visual VFX (fire or urn)
  vfxX: number;
  vfxY: number;
  // Tile position where the actual enemy spawns (snapped to path)
  pathTileX: number;
  pathTileY: number;
  pathIndex: number;
  // When (state.tick) this spawn entry fires
  spawnAt: number;
  // The enemy type to spawn (faction-appropriate)
  enemyType: string;
  // Whether this entry has fired yet (drained by SurpriseEvents tick)
  fired: boolean;
  // Which visual location (0..3) this spawn came from. The renderer
  // groups by pointId to render exactly 4 fires/urns even though the
  // spawn array has 8 entries (2 per point).
  pointId: number;
}
// Atmospheric prop placed around the play area during a surprise event.
// Purely decorative — no spawn purpose, no gameplay interaction. Fades
// in with the event lead-in and fades out with the spawn-completion
// fade-out so the screen never accumulates dressing post-event.
export interface SurpriseAtmosProp {
  spriteKey: string;     // texture key (e.g. 'FIRE_SMALL', 'BLOOD_HEAVY', 'SMOKE_PUFF')
  x: number;
  y: number;
  scale: number;         // 0.4 .. 1.0 — random per prop for natural variation
  rotation: number;      // initial rotation (radians)
  tint?: number;         // optional color tint
  flickerSeed: number;   // per-prop offset so they don't animate in lock-step
  kind: 'FIRE' | 'STAIN' | 'HAZE';   // drives animation style
}
export interface SurpriseEventState {
  kind: SurpriseEventKind;
  startedAt: number;          // state.tick when triggered
  endedAt?: number;           // state.tick when last enemy died → reward fires
  spawnPoints: SurpriseEventSpawnPoint[];
  // Ids of enemies spawned by this event (used to detect "all dead → reward")
  spawnedEnemyIds: Set<string>;
  // Legacy field — kept for back-compat, no longer used (no persistent scars in v2)
  scarPersistsThroughTick: number;
  // Tick when the LAST spawn entry fired. Drives fade-out timing.
  lastSpawnFiredAt: number;
  // Tick when VFX should START fading out. Set by tickSurpriseEvents
  // once all spawn entries have drained.
  vfxFadeOutAt: number;
  // Has the reward modal already fired? (one-shot)
  rewardGiven: boolean;
  // Atmospheric dressing props (small fires / blood stains / smoke haze).
  // Generated at event-schedule time; fade in/out with the main VFX.
  atmosProps: SurpriseAtmosProp[];
  // 2026-05-17 — WAVE OVERRIDE mode. When true, this event takes over the
  // entire wave's spawn flow: every enemy in waves.json spawns at one of
  // the 4 event points (round-robin) instead of from the cave. The wave's
  // spawn queue is tagged with eventPointIdx at startWave; tickSpawns
  // reroutes spawn position accordingly. VFX persists for the whole wave.
  waveOverride: boolean;
}

export enum TowerMode { MELEE, RANGED }
// 2026-05-19 — WEAKEST and FAST appended (kept at the end so existing
// enum values 0..4 don't shift). WEAKEST locks onto the lowest-HP
// enemy in range (cleaner finisher mode, pairs naturally with STRONG
// and synergizes with DAMNATIO_MEMORIAE's <25% HP execute). FAST
// picks the highest-currentSpeed enemy in range — catches sprinters
// (Spectral Scouts, Wolves, fast Druids) before they leak.
export enum TargetingMode { FIRST, LAST, STRONG, CLOSE, FLYERS, WEAKEST, FAST }
export enum GamePhase { BUILD_PHASE, WAVE_PHASE, GAME_OVER, VICTORY, PROSPECT_PLACEMENT, PICK_KEEPER }
export enum StatusEffectKind {
  SLOW = 'SLOW',
  POISON = 'POISON',
  BLEED = 'BLEED',
  FREEZE = 'FREEZE',
  BURN = 'BURN',
  ARMOR_SHRED = 'ARMOR_SHRED',
  STUN = 'STUN',
  HELLFIRE = 'HELLFIRE',
  FEAR = 'FEAR',
  KNOCKBACK = 'KNOCKBACK',   // path-progress reversal, applied as a one-shot impulse
  MARK = 'MARK',             // target takes +magnitude damage from all sources
  // 2026-05-15 — Draconarius signature debuff. Stacks up to 3 times, each
  // stack = +25% damage taken (cap +75%). Lives in MARK's family but
  // tracked separately so it doesn't share decay timing with other marks.
  DRAGON_MARK = 'DRAGON_MARK'
}

export type ItemId = string;

export interface ActiveStatus {
  kind: StatusEffectKind;
  remaining: number;     // seconds
  magnitude: number;     // effect-specific
  sourceTier: number;
}

export interface Tower {
  id: string;
  type: TowerType;
  qualityTier: 1 | 2 | 3 | 4 | 5;
  tileX: number;
  tileY: number;
  damageType: DamageType;
  baseDps: number;          // base at T1 from data
  attackSpeed: number;      // attacks per second at T1
  range: number;            // tiles
  targetingMode: TargetingMode;
  mode?: TowerMode;
  killCount: number;
  killBonusFlat: number;
  hasBeenDowngraded: boolean;
  builtFrom: TowerType[];
  equippedItems: ItemId[];
  // 2026-05-25 — Per-instance rarity for each equipped item. Parallel
  // array to equippedItems (same length, same indexes). Tracks the
  // rarity that was rolled when the item was picked up — boss-drop
  // upgrades, mercator special stock, etc. — so that on UNEQUIP the
  // item returns to inventory at the rarity it actually was, not the
  // base def rarity from items_permanent.json. Without this, a
  // LEGENDARY-rolled item came back as EPIC base and the UI swapped
  // orange→purple. Optional for backward-compat with any in-memory
  // state created before this field existed; UI sites fall back to the
  // def rarity when an entry is missing.
  equippedItemRarities: string[];
  placedAtWave: number;
  attackCooldown: number;   // seconds until next attack
  rotation: number;         // radians
  // Tower silence — set by Spectral Scout / Ghost Rider passing nearby. Adds to
  // attackCooldown so the next shot is delayed. Decremented in CombatResolver.
  silencedUntil?: number;
  // 2026-05 v9 — DRUID SLEEP CURSE: when a Gallic Druid or Zombie Druid
  // lands its sleep dart on this tower, set asleepUntil = state.tick + 3.
  // While asleep the tower is fully inert (no targeting, no shots). A
  // floating Z animation renders above it for the duration.
  asleepUntil?: number;
  // ─── Per-tower combat scratchpad ─────────────────────────────────────
  // These are hot-path counters/flags read every frame in CombatResolver.
  // They were previously stamped with `(t as any).__foo` strings — moved to
  // typed fields for safety. Naming preserved (with __ prefix) only for
  // backward compatibility with existing reads in CombatResolver.
  __hitCount?: number;            // total successful attacks
  __lastTargetId?: string;        // for "first hit on new target" bonuses (Retiarius Trident & Net)
  __tacticalStacks?: number;      // Evocatus tactical stack count
  __auraSpeedDebuff?: number;     // 0..1 multiplier reduction from druid auras
  duplicateBumped?: number;       // tier bump from duplicate-card upgrade
  isAerarium: boolean;      // shortcut
  pending: boolean;         // Gem TD: just-placed, awaiting KEEP-or-convert decision
  attackFlash: number;      // 0..0.18s — set on each attack for visual feedback
  // Gold actually paid to create this tower (place cost, OR combo cost when applicable).
  // Sell refund = floor(costPaid / 2). Defaults to TIER_PLACE_COST[tier] if unknown.
  costPaid?: number;
  // Veteran-tower stats (Player Fantasy §4)
  bossDamageDealt: number;  // lifetime damage to boss-flagged enemies
  totalDamageDealt: number; // lifetime cumulative damage
  killsThisWave: number;    // resets at wave start
  damageThisWave: number;   // resets at wave start
  mvpAwards: number;        // # of waves this tower was MVP
  // 2026-05-19 — Hero flag. Set true for any HERO_* TowerType in
  // TowerSystem.createTower. Heroes are placed towers with their own
  // basic attack + auto-pulse abilities (see HeroSystem.ts). When
  // true: tower cannot be sold / combined / moved / downgraded, has
  // exactly 2 item slots regardless of tier, and is excluded from
  // combine recipe lookups.
  isHero?: boolean;
  // 2026-05-19 — Per-hero ability cooldown scratchpad. Keys are
  // ability ids from herodefs.json; values are the tick at which the
  // ability is next allowed to fire. Same idiom as the existing
  // __nextCaesarStunTick / __nextHannibalFreezeTick scratchpad
  // patterns used throughout CombatResolver.
  __heroCooldowns?: Record<string, number>;
}

export interface Enemy {
  id: string;
  type: EnemyType;
  faction: EnemyFaction;
  hp: number;
  maxHp: number;
  baseSpeed: number;        // tiles/sec
  currentSpeed: number;
  isFlyer: boolean;
  // Pixel position
  x: number;
  y: number;
  prevX?: number;
  prevY?: number;
  dirX?: number;
  dirY?: number;
  // Path progress
  pathIndex: number;
  pathProgress: number;     // 0..1 within current segment
  statusEffects: ActiveStatus[];
  hasFeared: boolean;
  livesCost: number;
  isBoss: boolean;
  reward: number;
  archetype: 'SWARM' | 'RUNNER' | 'ARMORED' | 'RESISTANT' | 'BULKY' | 'ELITE' | 'BOSS';
  // VFX
  hpFlashTimer: number;
  // Out-of-combat regen support: latest game-tick at which this enemy was hit.
  // EnemySystem checks `state.tick - lastDamagedTick > 0.5` and, if the unit's
  // `outOfCombatRegen` flag is set, restores X% maxHp per second.
  lastDamagedTick?: number;
  // One-shot rebirth: when killed, certain enemies restore HP to a fraction of
  // maxHp and keep walking. Only fires once per enemy instance.
  hasRebirthed?: boolean;
  // Bonus boss flag: surprise-spawn extra bosses (waves 20+) reward 2x gold on kill.
  isBonusBoss?: boolean;
  // 2026-05 v11: marks the AUTHORED boss of a scheduled 'B' wave. Tag is
  // attached at spawn and preserved across leak/respawn, so killing the
  // boss ALWAYS drops a legendary — even if it carries over into a later
  // wave. Decouples the legendary reward from the wave-type check.
  isScheduledBoss?: boolean;
  // 2026-05 v11 DPS CHECK: flags this enemy as a training dummy spawned
  // by the DPS CHECK button. Excluded from wave-end checks; deals 0 damage
  // on leak; triggers the DPS-check summary popup when it reaches Rome.
  isDpsCheck?: boolean;
  // Elite mutation: a small % of late-wave enemies spawn with one modifier.
  mutation?: 'VETERAN' | 'SWIFT' | 'BLOATED' | 'WARDED' | 'AURA_STAR';
  // Shielded units (e.g., Carthage Elite Guard) cannot be targeted by ranged
  // towers until a melee tower lands the first hit and breaks their shield.
  // Set to true when the enemy has been struck in melee.
  shieldBroken?: boolean;
  // Stuck arrows/javelins/pilums embedded in the boss after a projectile hit.
  // Cap 5 per boss — oldest is removed when a 6th lands. Each entry stores the
  // (Removed 2026-05-17: stuckArrows field — embedded-shaft visuals were
  // pulled for perf. The hit-spark + typed-impact VFX from onHit still
  // play, so projectile hits read clearly without the per-frame sprite
  // bin rebuild.)
  // CHECKPOINT HEAL: select ground non-boss enemies regain a fraction of maxHp
  // (e.g. 0.25) every time they reach a fresh waypoint tile along the path.
  // The set tracks which waypoint indices have already healed this enemy so
  // crossing the same checkpoint twice (after knockback, after path resnap)
  // doesn't double-dip. Pulled from enemies.json `checkpointHealPct`.
  checkpointHealPct?: number;
  healedCheckpoints?: number[];
  // NECROMANCY (2026-05): when a tagged enemy dies on a `necromancy: true`
  // wave, a reanimated copy spawns at the same path tile. While rising,
  // `risingUntil` holds a future game-tick value during which the enemy
  // cannot be targeted and does not move — the renderer plays a portal +
  // bones-rising VFX over the sprite. `__reanimated` marks the entity so
  // it can't trigger a second necromancy chain (no Lich → Lich → Lich…).
  risingUntil?: number;
  __reanimated?: boolean;
}

export interface Projectile {
  id: string;
  spriteKey: string;
  x: number;
  y: number;
  damage: number;
  damageType: DamageType;
  targetId: string;
  speed: number;
  alive: boolean;
  sourceTowerId: string;
  rotation: number;
  splash: number;
  embedAfter: boolean;
  // For homing
  arc: boolean;
  spawnX: number;
  spawnY: number;
  travelTime: number;
  totalTime: number;
  // COSMETIC (2026-05): visual-only projectile spawned alongside an
  // attack that already resolved damage at swing time (SPEAR OF MARS
  // thrown-spear, JUPITER'S WRATH thunder bolt). Impact handler skips
  // the damage/status application so on-hit effects don't double-fire.
  cosmetic?: boolean;
}

export interface LootOrb {
  id: string;
  x: number;     // pixel
  y: number;
  itemId: ItemId;
  rarity: 'COMMON' | 'UNCOMMON' | 'RARE' | 'EPIC' | 'LEGENDARY' | 'UNIQUE';
}

export interface DrawCard {
  type: TowerType;
  tier: 1 | 2 | 3 | 4 | 5;
}

export interface FactionResistanceRow {
  PHYS_MELEE: number | 'IMMUNE';
  PHYS_RANGED: number | 'IMMUNE';
  SIEGE: number | 'IMMUNE';
  ELEMENTAL_FIRE: number | 'IMMUNE';
  DIVINE: number | 'IMMUNE';
}

export interface Waypoint {
  index: number;
  topLeft: { col: number; row: number };
  centerPx: { x: number; y: number };
  emblem: string;
}
