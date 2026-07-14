// ─────────────────────────────────────────────────────────────────
// SANDBOX MODE — developer-only testing environment.
//
// ENTRY: loading screen → "🧪 DEV SANDBOX" button → password modal
// (1027) → game starts with state.sandboxMode = true.
//
// EFFECTS WHEN ACTIVE:
//   • state.gold = 999_999 (effectively unlimited)
//   • state.poolLevel = max + state.heroLevel = max (no level gating)
//   • state.keepsRemainingThisRound = 999 (effectively unlimited keeps)
//   • Leaderboard submission is suppressed (no score upload)
//   • Quest progress is suppressed (no quest grants)
//   • localStorage writes for saved name / last hero / hard-refresh
//     flag are suppressed (sandbox sessions never overwrite real
//     player data)
//   • A persistent banner stamps the screen "🧪 SANDBOX MODE"
//   • Free tower placement bypasses prospects + combos
//   • Wave jump button lets the player hard-reset to any campaign wave
//     or trigger endless mode
//
// CLEANUP RECIPE (when sandbox mode is no longer wanted):
//   1. `grep -rn "// SANDBOX:" src/ tests/` lists every touched line.
//   2. Delete those code paths + this file + the loading-screen
//      sandbox button block in index.html + tests/sandbox.test.ts.
//   3. Drop the `sandboxMode` field from GameState.ts.
//   4. Run `npx tsc --noEmit && npx vitest run` to confirm green.
//
// SECURITY HONESTY: The password "1027" lives in the JS bundle and
// is theoretically discoverable by view-source. This is a soft
// barrier to keep casual players out of the dev menu, not a real
// cryptographic gate. Don't treat the sandbox flag as a trust
// boundary — treat it as a developer-convenience switch.
// ─────────────────────────────────────────────────────────────────

import { GameStateShape } from '../GameState';
import { TowerType, Tower, TileType, GamePhase } from '../types';
import { ECONOMY, GRID, SOLO_STARTING_LIVES, TIER_MULTS, WAVE } from '../constants';
import { createTower, maxQualityTierForTower } from './TowerSystem';
import towersData from '../data/towers.json';
import { TEST_YOUR_MIGHT_AFTER_WAVE } from './TestYourMightLabels';
import { isWaterPlacementRestrictedTile } from './GridManager';
import { canPlaceTowersOrProspects } from './PlacementPhase';

// SANDBOX: Password gate. Plaintext string compared at the loading
// screen entry. See file-level comment for the security honesty.
export const SANDBOX_PASSWORD = '1027';

// SANDBOX: Stamps the state with everything a tester needs out of
// the gate. Called once at sandbox entry (NOT on every wave reset).
export function activateSandbox(state: GameStateShape): void {
  state.sandboxMode = true;
  state.gold = 999_999;
  state.poolLevel = ECONOMY.POOL_MAX_LEVEL;
  state.heroLevel = 5;
  state.keepsRemainingThisRound = 999;
  state.lives = SOLO_STARTING_LIVES;
  state.hasKeptAnyTowerEver = true;   // skip the W1 first-keep guard
}

// SANDBOX: Convenience for the "+1000g" button. Just bumps gold.
export function sandboxAddGold(state: GameStateShape, amount: number = 1000): void {
  if (!state.sandboxMode) return;     // defensive — only fires in sandbox
  state.gold += amount;
}

// SANDBOX: Returns the full list of placeable tower types with each
// available tier. Used by the tower picker to surface every entry in
// towers.json at every legal tier. Combo towers are included so
// testers can spawn an Imperium Eternum without going through the
// 5-ingredient recipe.
export function sandboxAllTowerOptions(): Array<{ type: TowerType; name: string; tiers: number[]; kind: string }> {
  const out: Array<{ type: TowerType; name: string; tiers: number[]; kind: string }> = [];
  for (const [id, def] of Object.entries(towersData as any)) {
    const d = def as any;
    if (!d.name) continue;
    out.push({
      type: id as TowerType,
      name: d.name,
      kind: d.kind ?? 'BASE',
      tiers: [1, 2, 3, 4, 5].filter(tier => tier <= maxQualityTierForTower(id))
    });
  }
  // Sort: BASE first by name, then COMBO by name. Easier scanning.
  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'BASE' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

// SANDBOX: Direct tower spawn — bypasses the prospect/combo flow.
// Caller chooses tile + type + tier; this builds the Tower object
// and drops it on the grid. Returns the new tower so the caller can
// hook into camera focus etc.
export function sandboxSpawnTowerDirect(
  state: GameStateShape,
  type: TowerType,
  tier: 1 | 2 | 3 | 4 | 5,
  tileX: number,
  tileY: number
): Tower | null {
  if (!state.sandboxMode) return null;        // defensive
  if (!canPlaceTowersOrProspects(state.phase)) return null;
  if (tileY < 0 || tileY >= GRID.ROWS) return null;
  if (tileX < 0 || tileX >= GRID.COLS) return null;
  if (isWaterPlacementRestrictedTile(tileX, tileY)) return null;
  if (state.tiles[tileY][tileX] !== TileType.EMPTY) return null;
  const def: any = (towersData as any)[type];
  if (!def) return null;
  // Delegate to createTower so every field (including future
  // additions) gets the same initialization a normal placement does.
  // Pending=false so it's instantly kept.
  const t = createTower(type, tier, tileX, tileY, state.wave, false);
  state.tiles[tileY][tileX] = TileType.TOWER;
  state.towers.set(t.id, t);
  if (t.isAerarium) state.goldTowerCount += 1;
  return t;
}

// SANDBOX: Soft-reset to the start of a target wave. Clears every
// in-flight RUNTIME entity (enemies, projectiles, loot orbs, spawn
// queue, burn patches, status effects) so the new wave spawns fresh.
//
// PRESERVES (intentional, per user request 2026-05-19):
//   • state.towers — keep the player's tower placements between jumps
//   • state.tiles — keep the tower-tile + stone-wall layout
//   • state.goldTowerCount — preserve Aerarium count
//   • state.combosBuilt / kill counters on towers — kept
//
// The dev workflow: build a maze at W15, jump to W19, the SAME maze
// is now defending W19 enemies. Wipe via the dedicated WIPE TOWERS
// button when a clean slate is actually wanted.
//
// Used by the JUMP TO WAVE button. The caller is main.ts which then
// re-runs the build → startWave flow with the new wave number.
export function sandboxResetForWave(state: GameStateShape, targetWave: number): void {
  if (!state.sandboxMode) return;
  // 2026-05-19 (bugfix) — WaveManager.startWave begins with
  // `state.wave += 1`, which means whatever we set here gets bumped by
  // 1 the moment the player presses START WAVE. To make "click W19 →
  // play W19" actually work, we set state.wave = targetWave - 1 so
  // the increment lands on targetWave. The banner display logic
  // (updateSandboxBanner) shows state.wave + 1 during pre-wave
  // phases so the tester never sees the "off by one" number.
  const clamped = Math.max(1, Math.min(WAVE.TOTAL, Math.floor(targetWave)));
  state.wave = clamped - 1;
  state.tick = 0;
  state.phase = GamePhase.BUILD_PHASE;
  state.gold = 999_999;
  state.lives = SOLO_STARTING_LIVES;
  state.score = 0;
  state.totalKills = 0;
  state.enemiesKilledThisWave = 0;
  state.enemiesLeakedThisWave = 0;
  state.enemies.clear();
  state.projectiles.length = 0;
  state.lootOrbs.length = 0;
  // SANDBOX 2026-05-19: towers + tiles + goldTowerCount intentionally
  // NOT cleared so the maze survives wave jumps. Use
  // sandboxWipeAllTowers() for a clean slate.
  state.spawnQueue.length = 0;
  state.spawnElapsed = 0;
  if (state.burnPatches) state.burnPatches.length = 0;
  state.draw.length = 0;
  state.prospectQueue.length = 0;
  state.prospectsPlaced = 0;
  state.keepsRemainingThisRound = 999;
  state.gameOverAt = -1;
  state.victoryAt = -1;
  state.activeSurpriseEvent = null;
  state.extraSurpriseEvents = [];
  state.pendingSurpriseReward = null;
  state.weatherKey = null;
  state.weatherIntensity = 1;
  state.waveModifier = null;
  state.testYourMightOffered = false;
  state.testYourMightDeclined = false;
  state.testYourMightAccepted = false;
  state.testYourMightActive = false;
  state.testYourMightCleared = false;
  state.testYourMightFailed = false;
  (state as any).__testYourMightOpen = false;
  (state as any).__testYourMightRewardPaid = false;
  (state as any).__testYourMightLegendaryDrops = 0;
  state.bossRespawnQueue = [];
  state.bossesKilled = 0;
  state.bonusBossesKilled = 0;
  state.surpriseEventsCompleted = 0;
  // Per-tower per-wave counters reset so each new wave starts fresh
  // stats. Lifetime kill counts + flat kill bonus carry over (they
  // represent the maze's accumulated experience).
  for (const t of state.towers.values()) {
    t.killsThisWave = 0;
    t.damageThisWave = 0;
    t.attackFlash = 0;
    t.attackCooldown = 0;
  }
  void TIER_MULTS;     // import preserved for future tier-related logic
}

// SANDBOX: Arms the optional Test Your Might bonus wave directly.
// It uses the real accepted-challenge path, so the tester still gets
// build/trap/rampart prep time and then clicks START WAVE to launch
// W10.5 exactly like a normal campaign run.
export function sandboxArmTestYourMight(state: GameStateShape): void {
  if (!state.sandboxMode) return;
  sandboxResetForWave(state, TEST_YOUR_MIGHT_AFTER_WAVE);
  state.wave = TEST_YOUR_MIGHT_AFTER_WAVE;
  state.phase = GamePhase.BUILD_PHASE;
  state.endlessMode = false;
  state.testYourMightOffered = true;
  state.testYourMightDeclined = false;
  state.testYourMightAccepted = true;
  state.testYourMightActive = false;
  state.testYourMightCleared = false;
  state.testYourMightFailed = false;
  state.spawnQueue.length = 0;
  state.spawnElapsed = 0;
  state.enemies.clear();
  state.projectiles.length = 0;
  state.hint = '🧪 SANDBOX → Test Your Might armed. Prep, then click START WAVE for W10.5.';
}

// SANDBOX: Wipe every tower + reset the tile grid to its empty
// baseline. Used by the dedicated "WIPE TOWERS" button when the dev
// actually wants to start over with a blank maze. Path is rebuilt
// after this returns — the caller should call buildGroundPath().
export function sandboxWipeAllTowers(state: GameStateShape): void {
  if (!state.sandboxMode) return;
  // Convert every TOWER / STONE tile back to EMPTY. Keep SPAWN,
  // GATE, WAYPOINT, BORDER intact so the path skeleton survives.
  for (let r = 0; r < state.tiles.length; r++) {
    const row = state.tiles[r];
    for (let c = 0; c < row.length; c++) {
      if (row[c] === TileType.TOWER || row[c] === TileType.STONE) {
        row[c] = TileType.EMPTY;
      }
    }
  }
  state.towers.clear();
  state.goldTowerCount = 0;
  state.projectiles.length = 0;
}

// SANDBOX: Endless mode trigger. Stamps the endless flag and forces
// the wave counter to 21 so the procedural endless generator picks
// up where the campaign ends.
export function sandboxJumpToEndless(state: GameStateShape): void {
  if (!state.sandboxMode) return;
  sandboxResetForWave(state, 20);
  // sandboxResetForWave set state.wave to 19 (one less than targetWave
  // 20) so the next startWave lands on W20. For Endless we want the
  // generator's first wave to be Endless W1 with state.wave clamped
  // at 20 — set explicitly.
  state.wave = 20;
  state.endlessMode = true;
  state.endlessWave = 0;
}
