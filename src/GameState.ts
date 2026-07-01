import {
  Tower, Enemy, Projectile, LootOrb, GamePhase, DrawCard, SurpriseEventState
} from './types';
import { ECONOMY, GRID } from './constants';

export interface GameStateShape {
  phase: GamePhase;
  tick: number;
  wave: number;            // current wave number (1..50). 0 = pre-game.
  lives: number;
  gold: number;
  poolLevel: number;       // 0..5 — gold-purchased
  heroLevel: number;       // 0..5 — kill-XP earned (Gem TD style)
  totalKills: number;      // cumulative across run
  score: number;
  goldTowerCount: number;  // Aerarium count
  // Grid: tiles[row][col] = TileType numeric
  tiles: number[][];
  // Towers placed by id
  towers: Map<string, Tower>;
  // Live enemies
  enemies: Map<string, Enemy>;
  // Active projectiles
  projectiles: Projectile[];
  // Loot orbs on the ground
  lootOrbs: LootOrb[];
  // 5-card draw for current build phase
  draw: DrawCard[];
  // Selected card index
  selectedCard: number | null;
  // Prospect-placement queue: unrevealed prospects (each is a {type,tier} card the player will click to place)
  prospectQueue: DrawCard[];
  prospectsPlaced: number;
  // Was wave 1 first round? (for safety: must KEEP at least one before wave 1)
  hasKeptAnyTowerEver: boolean;
  // How many "KEEP" actions are still allowed in the current prospect round.
  // Normally 1. For the very first round before wave 1 it's 2 — a one-time
  // starter bonus so the player can build a small foothold.
  keepsRemainingThisRound: number;
  // UI hint string
  hint: string;
  // Whether wave is currently spawning
  spawnQueue: { type: string; spawnAt: number; bossEscort?: boolean }[];
  spawnElapsed: number;
  // Wave-end accounting
  enemiesKilledThisWave: number;
  enemiesLeakedThisWave: number;
  // Lifetime archetype-leak counter for death analysis (Difficulty §17)
  leaksByArchetype: Record<string, number>;
  // Path geometry: precomputed tile center sequences and pixel sequences
  groundPath: { col: number; row: number }[];
  // 2026 v2 spec Ch7 — Cave B (second spawn) lane; empty when Cave B inactive.
  groundPathB: { col: number; row: number }[];
  // 2026 v2 spec Ch7 — flips true the instant the first enemy emerges from
  // Cave B (W21+). Gates the archway reveal + eruption so the second cave
  // stays a surprise and is never shown sitting on the map beforehand.
  caveBActive?: boolean;
  // 2026 v2 — consumable TRAPS (TrapSystem): owned counts per type, placed
  // traps on the map, and the trap currently selected for placement.
  trapInventory?: Record<string, number>;
  // Lifetime traps purchased this run. Kept separate from inventory because
  // placed traps are consumable and should not erase quest progress.
  trapsPurchased?: number;
  placedTraps?: { id: string; type: string; x: number; y: number; col: number; row: number; born: number; color: number; spriteKey: string; pulse: boolean; nextReadyTick?: number }[];
  selectedTrapType?: string | null;
  flyerPath: { x: number; y: number }[];
  // Game-over flag for animation
  gameOverAt: number;       // tick when lives reached 0
  victoryAt: number;
  // Faction weather currently active (set on wave start, cleared on wave end).
  // Visual overlay + tower penalties read this. Null = clear skies.
  weatherKey?: string | null;
  weatherIntensity?: number;   // 1.0 normal, 1.5 boss-wave amplified
  // Wave modifier — set on wave start, cleared on wave end. Adds a unique
  // mechanical wrinkle on top of the wave's faction composition.
  waveModifier?: string | null;
  waveModifierTick?: number;     // generic timer for modifier-specific cycles
  // 2026-05-20 — Endless stacks MULTIPLE modifiers. Primary one stays
  // on `waveModifier` for backward compat with existing reactive code;
  // anything past the first lands here. Empty in campaign mode (the
  // 20-wave run is deterministic and never carries modifiers). Both
  // arrays cleared together at wave end.
  endlessExtraModifiers?: string[];
  // ─── Game-state scratchpad ──────────────────────────────────────────
  // Previously stuffed via `(state as any).foo`. Moved here for type safety.
  bloodMoonHpMult?: number;          // BLOOD_MOON wave modifier HP multiplier
  pendingBonusBoss?: string | null;  // queued bonus-boss announcement reason
  bonusBossAnnouncement?: string | null;
  comboFxQueue?: { x: number; y: number; bornTick: number; isSameTierMerge?: boolean; resultTier: number }[];
  carriedEnemiesThisWave?: number;
  totalEnemiesThisWave?: number;
  // Persistent burn patches on the ground from fire-tower hits.
  burnPatches?: { id: string; x: number; y: number; born: number; life: number; sourceTier: number }[];
  // QUEST SYSTEM — track per-run progress on goal-oriented challenges.
  // questProgress maps quest id -> current count; completedQuests is the
  // set of quest ids that have already paid out their reward.
  questProgress?: Record<string, number>;
  completedQuests?: string[];
  // 2026-05-17 — Tier completion bonus tracker. Once every quest in a
  // tier (EARLY / MID / LATE) is finished, the player banks a one-time
  // gold bonus. A fourth flag fires when ALL quests are done (grand
  // completion capstone). Storing the tier strings as flags keeps the
  // grant idempotent across save loads.
  questTierBonusGranted?: ('EARLY' | 'MID' | 'LATE' | 'ALL')[];
  bossesKilled?: number;
  combosBuilt?: number;
  combosBuiltUniqueTypes?: string[];
  stonesPlaced?: number;
  // Mercator persistent tower offers — when a Mercator visits, three random
  // tower offers are generated. Player can buy one and a "purchasedTower"
  // gets queued for placement on the next empty-tile click.
  mercatorTowerOffers?: { type: string; tier: number; price: number }[];
  // QUEUE of towers waiting to be placed. Each empty-tile click pops the
  // front of the queue. Both Mercator purchases and quest rewards append
  // here, so neither can overwrite the other.
  // 2026-05-25 — `source` widened to also tag Fortuna gamble wins +
  // generic bonus/gift drops separately from 'mercator' (which now means
  // "T5 purchased at the Mercator vendor" specifically). The placement-
  // confirm modal reads this to label what's being placed accurately
  // (MERCATOR PURCHASE vs FORTUNA WIN vs QUEST REWARD vs TOWER GIFT).
  pendingPurchasedTowers?: { type: string; tier: number; source: 'mercator' | 'quest' | 'hero' | 'fortuna' | 'bonus' | 'gift' | 'relic' }[];
  // Legacy single-slot — kept for back-compat reads but new code uses the
  // queue. Set to null on every place; queue is the source of truth.
  pendingPurchasedTower?: { type: string; tier: number } | null;
  // Boss respawn queue (2026-05 v6): when a boss leaks to Rome it's
  // removed from state.enemies (paying the 10-lives toll once) and
  // queued here with the HP it had at leak time. On the NEXT wave's
  // startWave, every queued boss respawns with that exact HP carried
  // over (capped at the new wave's maxHp) — chip damage you landed
  // before the leak still counts on the next encounter.
  // 2026-05 v11: `wasScheduled` carries the boss's original isScheduledBoss
  // flag through a leak so the reborn instance can be re-tagged on respawn.
  // Ensures the legendary drop guarantee survives carry-over to a non-B wave.
  bossRespawnQueue?: { type: string; hpAtLeak: number; hpFraction: number; wasScheduled?: boolean }[];
  // 2026-05 v11: visual "NEW STOCK" badge on the SHOP button. Set true
  // when the gate-shop rotation refreshes (every 4 waves); cleared when
  // the player opens the shop so the badge fades on first acknowledgment.
  shopRefreshedUnopened?: boolean;
  // Permanent gold-purchased lives this run (caps at 5 to prevent runaway).
  livesBoughtThisRun?: number;
  // Leaderboard tracking (2026-05): cumulative tower placements (every
  // prospect revealed) + the wall-clock timestamp when the run started.
  // Used by the Hall of Glory score formula.
  towersBuilt?: number;
  runStartedAt?: number;
  // RNG-event survival counters (2026-05). Drive the score-formula
  // bonuses for beating random events the run threw at the player.
  bonusBossesKilled?: number;       // twin or ambush bosses defeated
  modifierWavesSurvived?: number;   // waves where state.waveModifier rolled
  // Wave-clear timing (2026-05 v10) — duration (seconds) for each wave
  // that the player has finished. waveDurations[i] = seconds spent on
  // wave i+1 (1-indexed). Drives the SPEED BONUS in the final-score
  // computation: clearing a wave faster awards more points.
  waveDurations?: number[];
  // ─── ENDLESS MODE (2026-05 v10) ─────────────────────────────────────
  // After clearing W20 the player can transition into Endless mode.
  // endlessMode flips on; endlessWave starts at 1 and increments per
  // wave clear (the existing `wave` counter freezes at 20 so all the
  // "wave > N" gates in the rest of the codebase keep behaving). The
  // endless score is tracked separately so it doesn't pollute the
  // main W20 leaderboard.
  endlessMode?: boolean;
  endlessWave?: number;
  endlessScore?: number;
  endlessPlayerName?: string;
  // 2026-05-19 — Player's chosen name from the "etch your name in the
  // history of Rome" cold-start modal. Persisted to localStorage and
  // reused as the default in the end-of-run leaderboard prompt so the
  // player doesn't have to type it twice.
  playerName?: string;
  // ─── SURPRISE EVENTS (2026-05-16) ─────────────────────────────────────
  // INVASION = perimeter fire breaches (any wave from W6+).
  // UPRISING = center-map skull-urn portals (undead waves only).
  // activeSurpriseEvent holds the currently-running event lifecycle.
  // Cleared after the reward modal closes. Past scars (burn zones,
  // urn-shadows) persist independently for the rest of the wave via
  // surpriseEventScars below.
  activeSurpriseEvent?: SurpriseEventState | null;
  // 2026-05-18 — ENDLESS-MODE STACKING. Endless waves can roll 1-2
  // ADDITIONAL surprise events on top of the primary one (rare, ~20%
  // chance to add a second event, ~5% chance to add a third). These
  // live in extraSurpriseEvents so the existing single-event reads
  // and reward-flow on the campaign side stay untouched. The
  // renderer, tick loop, and spawn flow iterate primary + extras
  // via getAllActiveSurpriseEvents() so visuals + behavior stack.
  extraSurpriseEvents?: SurpriseEventState[];
  // Persistent VFX after an event ends — burn zone sprites for invasion,
  // urn silhouettes for uprising. Cleared at wave-end. The renderer reads
  // this array each frame and paints sprites at the recorded pixel coords.
  surpriseEventScars?: { kind: 'INVASION' | 'UPRISING'; x: number; y: number; bornTick: number }[];
  // Last wave that fired any surprise event — for the 3-wave cooldown.
  lastSurpriseEventWave?: number;
  // Pending reward modal — set when an event ends and last enemy dies.
  // main.ts opens the reward modal when this is non-null and pauses.
  pendingSurpriseReward?: { kind: 'INVASION' | 'UPRISING' | 'GATES_OF_HELL' } | null;
  // 2026-05-18 — Stacked endless events can resolve back-to-back; if
  // a second reward fires while the first modal is still open, the
  // second is banked here. The modal-close handler in main.ts pops
  // one off this queue when the player dismisses the current modal.
  queuedSurpriseRewards?: { kind: 'INVASION' | 'UPRISING' | 'GATES_OF_HELL' }[];
  // Number of completed surprise events this run (stats / leaderboard hook).
  surpriseEventsCompleted?: number;
  // SANDBOX: dev-only mode flag. When true, the game runs in an
  // isolated developer-testing environment: no leaderboard submission,
  // no quest progress saved, no localStorage writes (saved name, last
  // hero, hard-refresh flag, etc.). Set ONLY by the loading-screen
  // sandbox entry after the password (1027) is accepted. Every
  // sandbox-only code path is tagged with a `// SANDBOX:` comment so
  // a future cleanup pass can grep and remove them all in one go.
  sandboxMode?: boolean;
  // ── HERO SYSTEM (2026-05-19) ─────────────────────────────────────────
  // Set when the 3-card draft completes at run start. activeHeroId is
  // one of HERO_MARIUS / HERO_AGRIPPA / HERO_AGRICOLA / HERO_SCIPIO /
  // HERO_CAESAR / HERO_SULLA — see src/data/herodefs.json for the
  // single source of tuning.
  //
  // Naming note: the existing `heroLevel` field is per-tower kill-XP
  // (Gem TD style) and is a different concept; the activeHero* prefix
  // keeps the two systems clearly separated.
  activeHeroId?: string | null;        // 'HERO_MARIUS' | ... | null
  activeHeroTowerId?: string | null;   // tower instance id once placed
  heroXp?: number;                     // cumulative XP this run
  heroTier?: 0 | 1 | 2 | 3 | 4;        // cached; recomputed on each XP award
  heroLifeHealedThisRun?: number;      // Sulla cap tracker — max +20 per run
  // HERO FORGE (2026-05-20 v2) — gold-paid upgrades independent of the
  // natural XP/tier ladder. Three independent paths, 5 taps each cap.
  // Cost per tap = 20 × 2^stack (doubling: 20/40/80/160/320). Sum per
  // path maxed = 620g; sum across all three paths maxed = 1,860g.
  // On hero re-pick (destruction → fresh draft), 50% of heroForgeGoldSpent
  // is refunded before the stacks reset to zero.
  heroForgeStacks?: { dmg: number; cd: number; aura: number };
  heroForgeGoldSpent?: number;
  // Campaign Relics + Boss Trophies. These are run-level choices, not tower
  // items, so they live directly on game state.
  campaignRelicIds?: string[];
  campaignRelicId?: string | null;
  campaignRelicOffered?: boolean;
  campaignRelicOfferWaves?: number[];
  campaignRelicSkippedWaves?: number[];
  campaignRelicOffers?: Record<string, string[]>;
  bossTrophies?: string[];
  bossTrophyWavesClaimed?: number[];
  // Test Your Might bonus challenge. Offered once after W10. If accepted,
  // the special wave does not advance the campaign counter, but any leak
  // immediately ends the run.
  testYourMightOffered?: boolean;
  testYourMightDeclined?: boolean;
  testYourMightAccepted?: boolean;
  testYourMightActive?: boolean;
  testYourMightCleared?: boolean;
  testYourMightFailed?: boolean;
}

export function createGameState(): GameStateShape {
  return {
    phase: GamePhase.BUILD_PHASE,
    tick: 0,
    wave: 0,
    lives: ECONOMY.STARTING_LIVES,
    gold: ECONOMY.STARTING_GOLD,
    poolLevel: 0,
    heroLevel: 0,
    totalKills: 0,
    score: 0,
    goldTowerCount: 0,
    tiles: emptyGrid(),
    towers: new Map(),
    enemies: new Map(),
    projectiles: [],
    lootOrbs: [],
    draw: [],
    selectedCard: null,
    prospectQueue: [],
    prospectsPlaced: 0,
    hasKeptAnyTowerEver: false,
    keepsRemainingThisRound: 0,
    hint: '',
    spawnQueue: [],
    spawnElapsed: 0,
    enemiesKilledThisWave: 0,
    enemiesLeakedThisWave: 0,
    leaksByArchetype: {},
    groundPath: [],
    groundPathB: [],
    caveBActive: false,
    trapInventory: {},
    trapsPurchased: 0,
    placedTraps: [],
    selectedTrapType: null,
    flyerPath: [],
    gameOverAt: -1,
    victoryAt: -1,
    weatherKey: null,
    weatherIntensity: 1,
    waveModifier: null,
    waveModifierTick: 0,
    burnPatches: [],
    towersBuilt: 0,
    runStartedAt: Date.now(),
    bonusBossesKilled: 0,
    modifierWavesSurvived: 0,
    // SANDBOX: defaults to false. Only the loading-screen sandbox
    // entry flips this on after the 1027 password is accepted.
    sandboxMode: false,
    // HERO: defaults to null/0. Set by the 3-card draft modal after
    // name entry at run start.
    activeHeroId: null,
    activeHeroTowerId: null,
    heroXp: 0,
    heroTier: 0,
    heroLifeHealedThisRun: 0,
    heroForgeStacks: { dmg: 0, cd: 0, aura: 0 },
    heroForgeGoldSpent: 0,
    campaignRelicIds: [],
    campaignRelicId: null,
    campaignRelicOffered: false,
    campaignRelicOfferWaves: [],
    campaignRelicSkippedWaves: [],
    campaignRelicOffers: {},
    bossTrophies: [],
    bossTrophyWavesClaimed: [],
    testYourMightOffered: false,
    testYourMightDeclined: false,
    testYourMightActive: false,
    testYourMightCleared: false,
    testYourMightFailed: false
  };
}

// 2026-05-20 — Helper that returns true if a given modifier key is in
// the active set. Honors both the primary (state.waveModifier) and the
// Endless extras (state.endlessExtraModifiers). Use this in every
// reactive code path (CombatResolver, EnemySystem, RenderEngine,
// main.ts) so stacked Endless modifiers all fire their effects.
export function isWaveModifierActive(state: GameStateShape, key: string): boolean {
  if (state.waveModifier === key) return true;
  const extras = state.endlessExtraModifiers;
  if (!extras || extras.length === 0) return false;
  for (const k of extras) {
    if (k === key) return true;
  }
  return false;
}

function emptyGrid(): number[][] {
  const g: number[][] = [];
  for (let r = 0; r < GRID.ROWS; r++) {
    g.push(new Array(GRID.COLS).fill(0));
  }
  return g;
}
