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
//   • Wave jump button lets the player hard-reset to any wave 1-20
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
import { ECONOMY, GRID, TIER_MULTS } from '../constants';
import { createTower } from './TowerSystem';
import towersData from '../data/towers.json';

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
  state.lives = ECONOMY.STARTING_LIVES;
  state.hasKeptAnyTowerEver = true;   // skip the W1 first-keep guard
}

// SANDBOX: Convenience for the "+1000g" button. Just bumps gold.
export function sandboxAddGold(state: GameStateShape, amount: number = 1000): void {
  if (!state.sandboxMode) return;     // defensive — only fires in sandbox
  state.gold += amount;
}

// SANDBOX: Returns the full list of placeable tower types with each
// available tier. Used by the tower picker to surface every entry in
// towers.json at every tier T1-T5. Combo towers are included so
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
      tiers: [1, 2, 3, 4, 5]
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
  if (tileY < 0 || tileY >= GRID.ROWS) return null;
  if (tileX < 0 || tileX >= GRID.COLS) return null;
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

// SANDBOX: Hard-reset to the start of a target wave. Clears every
// in-flight enemy, projectile, loot orb, tower, and burn patch, then
// pins the wave number so the next startWave call uses the chosen
// wave's spawn config. Tile grid is reset to empty (path-rebuild
// happens on the next reach into PathFinder via initializeGrid in
// the caller).
//
// Used by the JUMP TO WAVE button. The caller is main.ts which then
// re-runs the build → startWave flow with the new wave number.
export function sandboxResetForWave(state: GameStateShape, targetWave: number): void {
  if (!state.sandboxMode) return;
  state.wave = Math.max(1, Math.min(20, Math.floor(targetWave)));
  state.tick = 0;
  state.phase = GamePhase.BUILD_PHASE;
  state.gold = 999_999;
  state.lives = ECONOMY.STARTING_LIVES;
  state.score = 0;
  state.totalKills = 0;
  state.enemiesKilledThisWave = 0;
  state.enemiesLeakedThisWave = 0;
  state.enemies.clear();
  state.projectiles.length = 0;
  state.lootOrbs.length = 0;
  state.towers.clear();
  state.spawnQueue.length = 0;
  state.spawnElapsed = 0;
  if (state.burnPatches) state.burnPatches.length = 0;
  state.draw.length = 0;
  state.prospectQueue.length = 0;
  state.prospectsPlaced = 0;
  state.keepsRemainingThisRound = 999;
  state.goldTowerCount = 0;
  state.gameOverAt = -1;
  state.victoryAt = -1;
  state.activeSurpriseEvent = null;
  state.extraSurpriseEvents = [];
  state.pendingSurpriseReward = null;
  state.weatherKey = null;
  state.weatherIntensity = 1;
  state.waveModifier = null;
  state.bossRespawnQueue = [];
  state.bossesKilled = 0;
  state.bonusBossesKilled = 0;
  state.surpriseEventsCompleted = 0;
  void TIER_MULTS;     // import preserved for future tier-related logic
}

// SANDBOX: Endless mode trigger. Stamps the endless flag and forces
// the wave counter to 21 so the procedural endless generator picks
// up where the campaign ends.
export function sandboxJumpToEndless(state: GameStateShape): void {
  if (!state.sandboxMode) return;
  sandboxResetForWave(state, 20);
  state.wave = 21;
  state.endlessMode = true;
  state.endlessWave = 1;
}
