// Regression: two heroes on the board must not break a wave (JB, 2026-06-22).
//
// The reported bug was "place a 2nd hero (Mercator Champion), Start Wave →
// freeze + crash". Root cause was a per-frame presentation exception tripping
// the game loop's consecutive-throw halt. This test pins the LOGIC contract:
// with a starter hero + a Mercator champion both on the board — including the
// real corrupted state where activeHeroTowerId points at the champion — a real
// wave must spawn its enemies, resolve them, and END, with no exception or
// hang. (Render/Pixi is exercised by the in-app smoke pass, not unit tests.)
import { describe, it, expect } from 'vitest';
import { tickHeroAbilities } from '../src/systems/HeroSystem';
import { createTower } from '../src/systems/TowerSystem';
import { tickCombat } from '../src/systems/CombatResolver';
import { tickEnemies } from '../src/systems/EnemySystem';
import { startWave, tickSpawns, checkWaveEnd } from '../src/systems/WaveManager';
import { createGameState, GameStateShape } from '../src/GameState';
import { GamePhase, TileType, TowerType } from '../src/types';

// EnemySystem.spawnEnemy reads (window as any).__renderer (guarded) for the
// spawn puff. In the browser `window` exists; in the Node test env it does not.
// Shim it so the wave loop runs as it would in-game (no renderer attached).
if (typeof (globalThis as any).window === 'undefined') (globalThis as any).window = globalThis;

function scenario(): GameStateShape {
  const s = createGameState();
  s.tiles = Array.from({ length: 26 }, () => Array.from({ length: 40 }, () => TileType.EMPTY));
  s.groundPath = Array.from({ length: 34 }, (_, i) => ({ col: 2 + i, row: 12 }));
  s.phase = GamePhase.PROSPECT_PLACEMENT;
  s.wave = 1;
  s.lives = 100;
  s.gold = 0;
  s.activeHeroId = 'HERO_MARIUS';
  s.heroTier = 4;

  // Starter hero + a Mercator champion (= two heroes on the board) plus a
  // couple of regular damage towers lining the lane.
  const starter = createTower(TowerType.HERO_MARIUS, 5, 9, 11, 1);
  const champion = createTower(TowerType.CHAMPION_AGRIPPA, 5, 10, 11, 1);
  const t1 = createTower(TowerType.SCORPIO, 3, 14, 11, 1);
  const t2 = createTower(TowerType.SCORPIO, 3, 20, 11, 1);
  for (const t of [starter, champion, t1, t2]) s.towers.set(t.id, t);

  // THE real corrupted state: placing the champion last made it own
  // activeHeroTowerId (now guarded in main.ts, but pin the contract here too).
  s.activeHeroTowerId = champion.id;
  return s;
}

function runWave(s: GameStateShape, maxFrames = 6000): { frames: number; ended: boolean; error: string | null } {
  let ended = false;
  for (let i = 0; i < maxFrames; i++) {
    try {
      tickSpawns(s, 0.05);
      tickHeroAbilities(s, { onAbilityCast: () => {}, triggerHeroAbilityFx: () => {} });
      tickEnemies(s, 0.05, () => {}, (e) => {
        s.enemies.delete(e.id);
        s.enemiesLeakedThisWave++;
      });
      tickCombat(s, 0.05, {
        onHit: () => {},
        onMeleeSwing: () => {},
        onProjectileFire: () => {},
        onKill: killed => {
          s.enemies.delete(killed.id);
          s.enemiesKilledThisWave++;
        }
      });
      checkWaveEnd(s, () => {});
    } catch (err: any) {
      return { frames: i, ended, error: String((err && err.stack) || err) };
    }
    s.tick += 0.05;
    if (s.phase !== GamePhase.WAVE_PHASE) { ended = true; return { frames: i, ended, error: null }; }
  }
  return { frames: maxFrames, ended, error: null };
}

describe('two heroes on the board — wave still works', () => {
  it('starts a wave, spawns + resolves enemies, and ends — no throw/hang', () => {
    const s = scenario();
    startWave(s);
    expect(s.phase).toBe(GamePhase.WAVE_PHASE);
    const queued = s.spawnQueue.length;
    expect(queued).toBeGreaterThan(0);          // wave built a spawn list

    const r = runWave(s);
    if (r.error) console.error('\n\n==== WAVE LOOP THREW (frame ' + r.frames + ') ====\n' + r.error + '\n');
    expect(r.error).toBeNull();                  // no exception anywhere in the loop
    expect(s.spawnQueue.length).toBe(0);         // every enemy got spawned
    expect(s.enemiesKilledThisWave + s.enemiesLeakedThisWave).toBeGreaterThan(0); // enemies resolved
    expect(r.ended).toBe(true);                  // wave actually finished (phase left WAVE_PHASE)
  });
});
