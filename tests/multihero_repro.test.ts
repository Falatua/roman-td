// Long-running reproductions for the Solo multi-hero wave-start freeze.
// These run the real hero, enemy, and combat systems across every legal
// starter/Champion pairing plus the full six-hero council.
import { describe, it, expect } from 'vitest';
import { tickHeroAbilities } from '../src/systems/HeroSystem';
import { createTower } from '../src/systems/TowerSystem';
import { tickCombat } from '../src/systems/CombatResolver';
import { tickEnemies } from '../src/systems/EnemySystem';
import { startWave } from '../src/systems/WaveManager';
import { initializeGrid } from '../src/systems/GridManager';
import { buildFlyerPath, buildGroundPath } from '../src/systems/PathFinder';
import { createGameState, GameStateShape } from '../src/GameState';
import { Enemy, EnemyType, EnemyFaction, GamePhase, TowerType } from '../src/types';
import { HERO_IDS, championForHero } from '../src/systems/HeroIdentity';

function enemy(id: string, col: number): Enemy {
  return {
    id,
    type: EnemyType.FERAL_DOG,
    faction: EnemyFaction.DOGS,
    hp: 50_000,
    maxHp: 50_000,
    baseSpeed: 0.15,
    currentSpeed: 0.15,
    isFlyer: false,
    x: col * 32 + 16,
    y: 12 * 32 + 16,
    pathIndex: Math.max(0, col - 5),
    pathProgress: 0,
    statusEffects: [],
    hasFeared: false,
    livesCost: 1,
    isBoss: false,
    reward: 0,
    archetype: 'SWARM',
    hpFlashTimer: 0
  };
}

function scenario(starterType: TowerType, championTypes: TowerType[]): GameStateShape {
  const state = createGameState();
  initializeGrid(state);
  state.groundPath = buildGroundPath(state) ?? [];
  state.flyerPath = buildFlyerPath();
  state.phase = GamePhase.BUILD_PHASE;
  state.tick = 100;
  state.wave = 8;
  state.activeHeroId = String(starterType) as any;
  state.heroTier = 4;

  const starter = createTower(starterType, 5, 15, 10, 8);
  state.activeHeroTowerId = starter.id;
  state.towers.set(starter.id, starter);
  championTypes.forEach((type, idx) => {
    const champion = createTower(type, 5, 17 + idx, 10, 8);
    champion.heroTier = 4;
    champion.heroXp = 1300;
    state.towers.set(champion.id, champion);
  });
  const fillers = [TowerType.MILITES, TowerType.SAGITTARIUS, TowerType.SCORPIO, TowerType.VELITES];
  for (let idx = 0; idx < 20; idx++) {
    const tower = createTower(fillers[idx % fillers.length], 5, 7 + (idx % 10), 15 + Math.floor(idx / 10), 8);
    state.towers.set(tower.id, tower);
  }
  for (let idx = 0; idx < 12; idx++) {
    const target = enemy(`enemy-${idx}`, 10 + idx);
    state.enemies.set(target.id, target);
  }
  startWave(state);
  return state;
}

function runFrames(state: GameStateShape, frames: number): { casts: Set<string>; combatActivity: boolean } {
  const casts = new Set<string>();
  let combatActivity = false;
  for (let frame = 0; frame < frames; frame++) {
    tickHeroAbilities(state, { onAbilityCast: id => casts.add(id), triggerHeroAbilityFx: () => {} });
    tickEnemies(state, 0.016, () => {}, leaked => state.enemies.delete(leaked.id));
    tickCombat(state, 0.016, {
      onHit: (tower, _enemy, damage) => { if (tower) tower.totalDamageDealt += damage; },
      onMeleeSwing: () => {},
      onProjectileFire: () => {},
      onKill: killed => state.enemies.delete(killed.id)
    });
    combatActivity = combatActivity || state.projectiles.length > 0 || [...state.towers.values()].some(tower => tower.totalDamageDealt > 0);
    if (state.enemies.size < 4) {
      for (let idx = 0; idx < 12; idx++) {
        const target = enemy(`refill-${frame}-${idx}`, 10 + idx);
        state.enemies.set(target.id, target);
      }
    }
    state.tick += 0.016;
  }
  return { casts, combatActivity };
}

describe('multi-hero wave-start matrix', () => {
  it('runs every legal starter plus Mercator Champion pairing through live combat frames', () => {
    for (const starterId of HERO_IDS) {
      for (const partnerId of HERO_IDS) {
        if (partnerId === starterId) continue;
        const champion = championForHero(partnerId) as TowerType;
        const state = scenario(starterId as TowerType, [champion]);
        const starterTowerId = state.activeHeroTowerId;
        const { casts, combatActivity } = runFrames(state, 320);

        expect(state.phase, `${starterId} + ${champion}`).toBe(GamePhase.WAVE_PHASE);
        expect(state.activeHeroTowerId, `${starterId} + ${champion}`).toBe(starterTowerId);
        expect(casts.size, `${starterId} + ${champion}`).toBeGreaterThan(0);
        expect(combatActivity, `${starterId} + ${champion}`).toBe(true);
        expect(((state as any).__heroTimedEvents ?? []).length, `${starterId} + ${champion}`).toBeLessThan(96);
      }
    }
  }, 20_000);

  it('runs the full six-hero council for 30 simulated seconds without queue growth or pointer corruption', () => {
    const champions = HERO_IDS.slice(1).map(id => championForHero(id) as TowerType);
    const state = scenario(TowerType.HERO_MARIUS, champions);
    const starterTowerId = state.activeHeroTowerId;
    const { casts } = runFrames(state, 1_875);

    expect(state.activeHeroTowerId).toBe(starterTowerId);
    expect(casts.size).toBe(12);
    expect(((state as any).__heroTimedEvents ?? []).length).toBeLessThan(96);
    expect([...state.towers.values()].filter(tower => tower.isHero).length).toBe(6);
  }, 20_000);
});
