// SANDBOX: tests for dev-mode isolation guarantees.
//
// The most important contract: sandbox runs must NEVER mutate
// real-game state (leaderboard, quests, save data). These tests
// pin that contract so future refactors can't quietly break it.
import { describe, it, expect } from 'vitest';
import { activateSandbox, sandboxSpawnTowerDirect, sandboxResetForWave, sandboxJumpToEndless, sandboxAddGold, sandboxAllTowerOptions, sandboxWipeAllTowers, sandboxArmTestYourMight, SANDBOX_PASSWORD } from '../src/systems/SandboxMode';
import { createGameState } from '../src/GameState';
import { initializeGrid } from '../src/systems/GridManager';
import { buildGroundPath } from '../src/systems/PathFinder';
import { TowerType, GamePhase, TileType } from '../src/types';
import { startWave } from '../src/systems/WaveManager';
import { displayWaveNumber } from '../src/systems/TestYourMightSystem';
import { WATER_ZONE } from '../src/constants';

function bootstrapState() {
  const s = createGameState();
  initializeGrid(s);
  const p = buildGroundPath(s);
  if (p) s.groundPath = p;
  return s;
}

describe('Sandbox foundation', () => {
  it('createGameState defaults sandboxMode=false', () => {
    const s = createGameState();
    expect(s.sandboxMode).toBe(false);
  });

  it('activateSandbox flips the flag + sets dev-friendly defaults', () => {
    const s = createGameState();
    activateSandbox(s);
    expect(s.sandboxMode).toBe(true);
    expect(s.gold).toBe(999_999);
    expect(s.heroLevel).toBe(5);
    expect(s.keepsRemainingThisRound).toBe(999);
    expect(s.hasKeptAnyTowerEver).toBe(true);   // skip the W1 first-keep guard
  });

  it('SANDBOX_PASSWORD is 1027', () => {
    expect(SANDBOX_PASSWORD).toBe('1027');
  });
});

describe('Sandbox tower spawning', () => {
  it('refuses when sandboxMode is false (defensive)', () => {
    const s = bootstrapState();
    s.sandboxMode = false;
    const t = sandboxSpawnTowerDirect(s, TowerType.SCORPIO, 3, 5, 5);
    expect(t).toBeNull();
  });

  it('drops a tower on an empty tile when sandbox is active', () => {
    const s = bootstrapState();
    activateSandbox(s);
    const t = sandboxSpawnTowerDirect(s, TowerType.SCORPIO, 3, 5, 5);
    expect(t).not.toBeNull();
    expect(t!.type).toBe(TowerType.SCORPIO);
    expect(t!.qualityTier).toBe(3);
    expect(s.towers.size).toBe(1);
  });

  it('refuses direct tower placement during an active wave, including paused combat', () => {
    const s = bootstrapState();
    activateSandbox(s);
    // Pausing freezes the loop without changing WAVE_PHASE, so this same
    // boundary governs both moving and paused combat.
    s.phase = GamePhase.WAVE_PHASE;
    const before = s.tiles[5][5];

    const t = sandboxSpawnTowerDirect(s, TowerType.SCORPIO, 3, 5, 5);

    expect(t).toBeNull();
    expect(s.towers.size).toBe(0);
    expect(s.tiles[5][5]).toBe(before);
  });

  it('refuses to overwrite a non-empty tile', () => {
    const s = bootstrapState();
    activateSandbox(s);
    const first = sandboxSpawnTowerDirect(s, TowerType.MILITES, 1, 5, 5);
    expect(first).not.toBeNull();
    const second = sandboxSpawnTowerDirect(s, TowerType.SCORPIO, 5, 5, 5);
    expect(second).toBeNull();
    expect(s.towers.size).toBe(1);
  });

  it('exposes every tower in towers.json via sandboxAllTowerOptions', () => {
    const all = sandboxAllTowerOptions();
    expect(all.length).toBeGreaterThan(20);   // base + combo towers
    for (const t of all) {
      const expectedTiers = [1, 2, 3, 4, 5].filter(tier => {
        if (t.type === TowerType.VELITES || t.type === TowerType.SCORPIO) return tier <= 4;
        return true;
      });
      expect(t.tiers).toEqual(expectedTiers);
    }
    // BASE entries appear before COMBO entries (UI scan order).
    const firstCombo = all.findIndex(t => t.kind === 'COMBO');
    const lastBase = (() => {
      let last = -1;
      all.forEach((t, i) => { if (t.kind === 'BASE') last = i; });
      return last;
    })();
    if (firstCombo >= 0 && lastBase >= 0) expect(firstCombo).toBeGreaterThan(lastBase);
  });
});

describe('Sandbox wave reset', () => {
  // 2026-05-19 (UPDATED CONTRACT): wave jump PRESERVES towers + tiles.
  // The dev workflow is "build a maze, test it against multiple
  // different waves." Clearing the maze on every jump made that
  // impossible. The dedicated WIPE TOWERS button (sandboxWipeAllTowers
  // below) is the path for explicitly clearing the maze.
  it('PRESERVES towers + tiles when jumping waves; clears only runtime state', () => {
    const s = bootstrapState();
    activateSandbox(s);
    // Plant some state.
    sandboxSpawnTowerDirect(s, TowerType.MILITES, 1, 4, 4);
    sandboxSpawnTowerDirect(s, TowerType.SCORPIO, 3, 6, 6);
    (s.lootOrbs as any).push({ id: 'orb1', x: 0, y: 0, itemId: 'GOLD_PURSE', rarity: 'RARE' });
    expect(s.towers.size).toBe(2);
    expect(s.lootOrbs.length).toBe(1);
    sandboxResetForWave(s, 10);
    // 2026-05-19 (bugfix) — state.wave is the LAST COMPLETED wave;
    // startWave's first action is state.wave += 1, so sandboxResetForWave
    // sets state.wave to targetWave - 1 so the next START WAVE plays
    // the requested wave. Click W10 → state.wave = 9 → next START
    // WAVE runs W10.
    expect(s.wave).toBe(9);
    // CRITICAL: towers survive the jump (the user-facing contract).
    expect(s.towers.size).toBe(2);
    expect(s.tiles[4][4]).not.toBe(0);    // tile still marked TOWER
    expect(s.tiles[6][6]).not.toBe(0);
    // Runtime state IS cleared.
    expect(s.lootOrbs.length).toBe(0);
    expect(s.gold).toBe(999_999);
    expect(s.phase).toBe(GamePhase.BUILD_PHASE);
    // Per-tower per-wave counters reset (each tower starts the new wave fresh).
    for (const t of s.towers.values()) {
      expect(t.killsThisWave).toBe(0);
      expect(t.damageThisWave).toBe(0);
    }
  });

  it('clamps wave to 1..30 (with the -1 startWave-compensation offset)', () => {
    const s = bootstrapState();
    activateSandbox(s);
    sandboxResetForWave(s, 0);
    expect(s.wave).toBe(0);     // clamped to 1, then -1 for startWave-compensation
    sandboxResetForWave(s, 30);
    expect(s.wave).toBe(29);    // clamped to 30, then -1 for startWave-compensation
    sandboxResetForWave(s, -5);
    expect(s.wave).toBe(0);     // clamped to 1, then -1
  });

  it('refuses to act when sandboxMode is false', () => {
    const s = bootstrapState();
    s.sandboxMode = false;
    sandboxSpawnTowerDirect(s, TowerType.MILITES, 1, 4, 4);   // ignored
    const goldBefore = s.gold;
    sandboxResetForWave(s, 15);
    expect(s.wave).toBe(0);     // unchanged from createGameState default
    expect(s.gold).toBe(goldBefore);
  });

  it('endless jump sets endlessMode + wave clamped at 20 (startWave will not bump it)', () => {
    const s = bootstrapState();
    activateSandbox(s);
    sandboxJumpToEndless(s);
    expect(s.endlessMode).toBe(true);
    expect(s.wave).toBe(20);
    expect(s.endlessWave).toBe(0);  // generator increments to 1 on first START WAVE
  });

  it('clears stale Test Your Might flags on normal wave jumps', () => {
    const s = bootstrapState();
    activateSandbox(s);
    s.testYourMightOffered = true;
    s.testYourMightDeclined = true;
    s.testYourMightAccepted = true;
    s.testYourMightActive = true;
    s.testYourMightCleared = true;
    s.testYourMightFailed = true;
    (s as any).__testYourMightOpen = true;
    (s as any).__testYourMightRewardPaid = true;
    (s as any).__testYourMightLegendaryDrops = 1;

    sandboxResetForWave(s, 12);

    expect(s.testYourMightOffered).toBe(false);
    expect(s.testYourMightDeclined).toBe(false);
    expect(s.testYourMightAccepted).toBe(false);
    expect(s.testYourMightActive).toBe(false);
    expect(s.testYourMightCleared).toBe(false);
    expect(s.testYourMightFailed).toBe(false);
    expect((s as any).__testYourMightOpen).toBe(false);
    expect((s as any).__testYourMightRewardPaid).toBe(false);
    expect((s as any).__testYourMightLegendaryDrops).toBe(0);
  });
});

describe('Sandbox Test Your Might helper', () => {
  it('arms W10.5 directly while preserving prep until START WAVE', () => {
    const s = bootstrapState();
    activateSandbox(s);
    sandboxSpawnTowerDirect(s, TowerType.MILITES, 1, 5, 5);

    sandboxArmTestYourMight(s);

    expect(s.wave).toBe(10);
    expect(s.phase).toBe(GamePhase.BUILD_PHASE);
    expect(s.testYourMightOffered).toBe(true);
    expect(s.testYourMightAccepted).toBe(true);
    expect(s.testYourMightActive).toBe(false);
    expect(s.spawnQueue.length).toBe(0);
    expect(s.towers.size).toBe(1);
    expect(s.tiles[5][5]).toBe(TileType.TOWER);
    expect(displayWaveNumber(s)).toBe('10');

    startWave(s);

    expect(s.wave).toBe(10);
    expect(s.phase).toBe(GamePhase.WAVE_PHASE);
    expect(s.testYourMightAccepted).toBe(false);
    expect(s.testYourMightActive).toBe(true);
    expect(displayWaveNumber(s)).toBe('10.5');
    expect(s.spawnQueue.length).toBeGreaterThan(0);
  });
});

describe('Sandbox water restrictions', () => {
  it('does not allow direct tower spawns on water but allows shoreline grass', () => {
    const s = bootstrapState();
    activateSandbox(s);

    expect(sandboxSpawnTowerDirect(s, TowerType.MILITES, 1, WATER_ZONE.col + 1, WATER_ZONE.row + 1)).toBeNull();
    expect(sandboxSpawnTowerDirect(s, TowerType.MILITES, 1, WATER_ZONE.col + 5, WATER_ZONE.row)).not.toBeNull();
    expect(s.towers.size).toBe(1);
  });
});

describe('Sandbox wipe all towers (explicit dev action)', () => {
  it('wipes every tower + resets TOWER/STONE tiles to EMPTY', () => {
    const s = bootstrapState();
    activateSandbox(s);
    sandboxSpawnTowerDirect(s, TowerType.MILITES, 1, 5, 5);
    sandboxSpawnTowerDirect(s, TowerType.SCORPIO, 3, 7, 7);
    // Place a stone too via the tile array directly (simulates the
    // pre-game stones-as-walls placement).
    s.tiles[3][3] = TileType.STONE;
    expect(s.towers.size).toBe(2);
    sandboxWipeAllTowers(s);
    expect(s.towers.size).toBe(0);
    expect(s.tiles[5][5]).toBe(TileType.EMPTY);
    expect(s.tiles[7][7]).toBe(TileType.EMPTY);
    expect(s.tiles[3][3]).toBe(TileType.EMPTY);  // stone wiped too
    expect(s.goldTowerCount).toBe(0);
  });

  it('refuses when sandboxMode is false', () => {
    const s = bootstrapState();
    s.sandboxMode = false;
    // We can't use sandboxSpawnTowerDirect (it also refuses outside
    // sandbox), so place via the tile array + towers map directly.
    s.tiles[5][5] = TileType.TOWER;
    sandboxWipeAllTowers(s);
    expect(s.tiles[5][5]).toBe(TileType.TOWER);   // unchanged
  });
});

describe('Sandbox gold helper', () => {
  it('+1000 default bump only when sandbox is active', () => {
    const s = bootstrapState();
    s.sandboxMode = false;
    s.gold = 100;
    sandboxAddGold(s);
    expect(s.gold).toBe(100);   // defensive: ignored outside sandbox

    activateSandbox(s);
    sandboxAddGold(s);
    expect(s.gold).toBe(999_999 + 1000);   // sandbox baseline + bump
  });
});
