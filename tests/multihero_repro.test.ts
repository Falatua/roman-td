// Repro harness for JB's "2+ heroes on the map → Start Wave → freeze + crash".
// Runs the REAL per-frame loop in the exact corrupted state the live game
// produces: activeHeroTowerId points at the LAST-placed hero (a Mercator
// champion), while activeHeroId stays the starter. No existing test sets that
// mismatch. If a frame infinite-loops, vitest's timeout fires and localizes it.
import { describe, it, expect } from 'vitest';
import { tickHeroAbilities, prepareHeroAbilitiesForWave } from '../src/systems/HeroSystem';
import { createTower } from '../src/systems/TowerSystem';
import { tickCombat } from '../src/systems/CombatResolver';
import { tickEnemies } from '../src/systems/EnemySystem';
import { createGameState, GameStateShape } from '../src/GameState';
import { Enemy, EnemyType, EnemyFaction, GamePhase, TileType, TowerType } from '../src/types';

function bigMap(s: GameStateShape) {
  s.tiles = Array.from({ length: 30 }, () => Array.from({ length: 40 }, () => TileType.EMPTY));
  s.groundPath = Array.from({ length: 30 }, (_, i) => ({ col: 5 + i, row: 12 }));
}
function enemy(id: string, col: number): Enemy {
  return {
    id, type: EnemyType.FERAL_DOG, faction: EnemyFaction.DOGS,
    hp: 5000, maxHp: 5000, baseSpeed: 1, currentSpeed: 1, isFlyer: false,
    x: col * 32 + 16, y: 12 * 32 + 16, pathIndex: col - 5, pathProgress: 0,
    statusEffects: [], hasFeared: false, livesCost: 1, isBoss: false,
    reward: 0, archetype: 'SWARM', hpFlashTimer: 0
  };
}

function scenario(): GameStateShape {
  const s = createGameState();
  bigMap(s);
  s.phase = GamePhase.WAVE_PHASE;
  s.tick = 100;
  s.wave = 12;
  s.activeHeroId = 'HERO_MARIUS';
  s.heroTier = 4;
  const starter = createTower(TowerType.HERO_MARIUS, 5, 8, 11, 12);
  const champion = createTower(TowerType.CHAMPION_AGRIPPA, 5, 9, 11, 12);
  s.towers.set(starter.id, starter);
  s.towers.set(champion.id, champion);
  // THE BUG STATE: placing the champion last overwrites activeHeroTowerId
  // (main.ts:5743) so it points at the champion, not the starter.
  s.activeHeroTowerId = champion.id;
  for (let c = 14; c < 24; c++) {
    const e = enemy(`e${c}`, c);
    s.enemies.set(e.id, e);
  }
  return s;
}

describe('multi-hero Start Wave freeze repro', () => {
  it('A: prepareHeroAbilitiesForWave + 2000 frames of hero abilities only', () => {
    const s = scenario();
    prepareHeroAbilitiesForWave(s);
    for (let i = 0; i < 2000; i++) {
      tickHeroAbilities(s, { onAbilityCast: () => {}, triggerHeroAbilityFx: () => {} });
      s.tick += 0.016;
    }
    expect(s.tick).toBeGreaterThan(100);
  });

  it('B: full real per-frame loop (heroes + combat + enemies) for 3000 frames', () => {
    const s = scenario();
    prepareHeroAbilitiesForWave(s);
    for (let i = 0; i < 3000; i++) {
      tickHeroAbilities(s, { onAbilityCast: () => {}, triggerHeroAbilityFx: () => {} });
      tickEnemies(s, 0.016, () => {}, (e) => { s.enemies.delete(e.id); });
      tickCombat(s, 0.016, { onHit: () => {}, onMeleeSwing: () => {}, onProjectileFire: () => {}, onKill: () => {} });
      // keep enemies on the board so combat + abilities keep firing
      if (s.enemies.size < 4) {
        for (let c = 14; c < 24; c++) { const e = enemy(`e${c}_${i}`, c); s.enemies.set(e.id, e); }
      }
      s.tick += 0.016;
    }
    expect((s as any).__heroTimedEvents?.length ?? 0).toBeLessThan(200);
  });
});
