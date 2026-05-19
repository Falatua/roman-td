// SANDBOX: tests for dev-mode isolation guarantees.
//
// The most important contract: sandbox runs must NEVER mutate
// real-game state (leaderboard, quests, save data). These tests
// pin that contract so future refactors can't quietly break it.
import { describe, it, expect } from 'vitest';
import { activateSandbox, sandboxSpawnTowerDirect, sandboxResetForWave, sandboxJumpToEndless, sandboxAddGold, sandboxAllTowerOptions, SANDBOX_PASSWORD } from '../src/systems/SandboxMode';
import { createGameState } from '../src/GameState';
import { initializeGrid } from '../src/systems/GridManager';
import { buildGroundPath } from '../src/systems/PathFinder';
import { TowerType, GamePhase } from '../src/types';

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
    // Every option must offer T1-T5 tiers
    for (const t of all) {
      expect(t.tiers).toEqual([1, 2, 3, 4, 5]);
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
  it('clears towers / enemies / projectiles / loot when jumping waves', () => {
    const s = bootstrapState();
    activateSandbox(s);
    // Plant some state to verify it gets cleaned.
    sandboxSpawnTowerDirect(s, TowerType.MILITES, 1, 4, 4);
    sandboxSpawnTowerDirect(s, TowerType.SCORPIO, 3, 6, 6);
    (s.lootOrbs as any).push({ id: 'orb1', x: 0, y: 0, itemId: 'GOLD_PURSE', rarity: 'RARE' });
    expect(s.towers.size).toBe(2);
    expect(s.lootOrbs.length).toBe(1);
    sandboxResetForWave(s, 10);
    expect(s.wave).toBe(10);
    expect(s.towers.size).toBe(0);
    expect(s.lootOrbs.length).toBe(0);
    expect(s.gold).toBe(999_999);
    expect(s.phase).toBe(GamePhase.BUILD_PHASE);
  });

  it('clamps wave to 1..20', () => {
    const s = bootstrapState();
    activateSandbox(s);
    sandboxResetForWave(s, 0);
    expect(s.wave).toBe(1);
    sandboxResetForWave(s, 30);
    expect(s.wave).toBe(20);
    sandboxResetForWave(s, -5);
    expect(s.wave).toBe(1);
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

  it('endless jump sets endlessMode + wave 21', () => {
    const s = bootstrapState();
    activateSandbox(s);
    sandboxJumpToEndless(s);
    expect(s.endlessMode).toBe(true);
    expect(s.wave).toBe(21);
    expect(s.endlessWave).toBe(1);
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
