import { describe, expect, it, afterEach } from 'vitest';
import sharp from 'sharp';
import { join } from 'node:path';
import { createGameState } from '../src/GameState';
import { DamageType, Enemy, EnemyFaction, EnemyType, StatusEffectKind, TowerType } from '../src/types';
import { createTower } from '../src/systems/TowerSystem';
import { applyDamageAndStatus, CombatHooks } from '../src/systems/CombatResolver';
import { spawnProjectile } from '../src/systems/ProjectileSystem';
import {
  ELEMENTAL_VFX_ASSET,
  elementalProjectileSpriteKey,
  elementalVfxFamiliesForTower,
  triggerElementalHitVfx
} from '../src/systems/ElementalVfx';

const ASSET_FILES = ['lightning', 'fire', 'poison', 'water', 'ice', 'bleed'];

function enemy(id: string, x: number, y = 160): Enemy {
  return {
    id,
    type: EnemyType.FERAL_DOG,
    faction: EnemyFaction.DOGS,
    hp: 1_000_000,
    maxHp: 1_000_000,
    baseSpeed: 1,
    currentSpeed: 1,
    isFlyer: false,
    x,
    y,
    pathIndex: 0,
    pathProgress: 0,
    statusEffects: [],
    hasFeared: false,
    livesCost: 1,
    isBoss: false,
    reward: 0,
    archetype: 'SWARM',
    hpFlashTimer: 0
  } as Enemy;
}

const hooks: CombatHooks = {
  onKill: () => {},
  onHit: () => {},
  onMeleeSwing: () => {},
  onProjectileFire: () => {}
};

afterEach(() => {
  delete (globalThis as any).__renderer;
});

describe('Elemental VFX classification and projectiles', () => {
  it('classifies native and item-granted elemental identities', () => {
    expect(elementalVfxFamiliesForTower(createTower(TowerType.STORMCALLER, 4, 1, 1, 10))).toContain('LIGHTNING');
    expect(elementalVfxFamiliesForTower(createTower(TowerType.FROZEN_LEGION, 4, 1, 1, 10))).toContain('ICE');
    expect(elementalVfxFamiliesForTower(createTower(TowerType.PLAGUE_LOBBER, 4, 1, 1, 10))).toEqual(expect.arrayContaining(['FIRE', 'POISON']));
    expect(elementalVfxFamiliesForTower(createTower(TowerType.CHARYBDIS_VORTEX, 4, 1, 1, 10))).toContain('WATER');

    const itemTower = createTower(TowerType.SAGITTARIUS, 3, 1, 1, 10);
    itemTower.equippedItems = ['BARBED_GLADIUS', 'VESTAL_PYRE'];
    expect(elementalVfxFamiliesForTower(itemTower)).toEqual(expect.arrayContaining(['BLEED', 'FIRE']));
  });

  it('uses animated travel sheets while preserving native combat damage types', () => {
    const tower = createTower(TowerType.SAGITTARIUS, 3, 1, 1, 10);
    tower.equippedItems = ['JUPITERS_WRATH'];
    expect(elementalProjectileSpriteKey(tower, 'PROJ_ARROW')).toBe(ELEMENTAL_VFX_ASSET.LIGHTNING);
    expect(tower.damageType).toBe(DamageType.PHYS_RANGED);

    tower.equippedItems = ['FIRE_OIL_FLASK'];
    expect(elementalProjectileSpriteKey(tower, 'PROJ_ARROW')).toBe(ELEMENTAL_VFX_ASSET.FIRE);
    tower.equippedItems = ['VENOM_TIPPED_ARROWS'];
    expect(elementalProjectileSpriteKey(tower, 'PROJ_ARROW')).toBe(ELEMENTAL_VFX_ASSET.POISON);
    tower.equippedItems = ['NEPTUNES_TRIDENT'];
    expect(elementalProjectileSpriteKey(tower, 'PROJ_ARROW')).toBe(ELEMENTAL_VFX_ASSET.WATER);
  });

  it('puts the selected animated sprite on a real projectile', () => {
    const state = createGameState();
    state.wave = 10;
    const tower = createTower(TowerType.SAGITTARIUS, 3, 1, 1, 10);
    tower.equippedItems = ['VESTAL_PYRE'];
    const target = enemy('target', 220);
    spawnProjectile(state, tower, target, 100);
    expect(state.projectiles).toHaveLength(1);
    expect(state.projectiles[0].spriteKey).toBe(ELEMENTAL_VFX_ASSET.FIRE);
    expect(state.projectiles[0].damageType).toBe(DamageType.PHYS_RANGED);
  });

  it('routes impact animation through the capped renderer effect API', () => {
    const calls: any[][] = [];
    (globalThis as any).__renderer = { triggerSpriteImpact: (...args: any[]) => calls.push(args) };
    const tower = createTower(TowerType.PLAGUE_LOBBER, 4, 1, 1, 10);
    triggerElementalHitVfx(tower, 100, 120, 4);
    expect(calls).toHaveLength(2);
    expect(calls.map(call => call[3])).toEqual(expect.arrayContaining([ELEMENTAL_VFX_ASSET.FIRE, ELEMENTAL_VFX_ASSET.POISON]));
    expect(calls.every(call => call.slice(6).join(',') === '128,128,6,3,3')).toBe(true);
  });

  it('renders and applies an Inferno Standard aura burn on an allied tower hit', () => {
    const calls: any[][] = [];
    (globalThis as any).__renderer = { triggerSpriteImpact: (...args: any[]) => calls.push(args) };
    const state = createGameState();
    state.wave = 10;
    state.tick = 4;
    const ally = createTower(TowerType.SAGITTARIUS, 3, 1, 1, 10);
    (ally as any).__infernoStandardAura = true;
    const target = enemy('inferno-aura-target', 180);
    state.enemies.set(target.id, target);

    applyDamageAndStatus(state, ally, target, 100, hooks);
    expect(target.statusEffects.some(status => status.kind === StatusEffectKind.BURN)).toBe(true);
    expect(calls.some(call => call[3] === ELEMENTAL_VFX_ASSET.FIRE)).toBe(true);
  });
});

describe('Stormcaller chain animation contract', () => {
  it('queues four sequential enemy-to-enemy lightning jumps', () => {
    const state = createGameState();
    state.wave = 10;
    state.tick = 12;
    const tower = createTower(TowerType.STORMCALLER, 4, 2, 2, 10);
    const enemies = [enemy('e0', 120), enemy('e1', 145), enemy('e2', 170), enemy('e3', 195), enemy('e4', 220)];
    for (const e of enemies) state.enemies.set(e.id, e);

    applyDamageAndStatus(state, tower, enemies[0], 100, hooks);
    const queue = (state as any).chainLightningFxQueue;
    expect(queue).toHaveLength(4);
    expect(queue.map((fx: any) => fx.bornTick)).toEqual([12, 12.035, 12.07, 12.105]);
    expect(queue[0]).toMatchObject({ x1: 120, x2: 145 });
    expect(queue[3]).toMatchObject({ x1: 195, x2: 220 });
  });
});

describe('Elemental VFX sprite-sheet integrity', () => {
  for (const family of ASSET_FILES) {
    it(`${family} is a clean transparent 3x3 sheet`, async () => {
      const file = join(process.cwd(), 'public', 'assets', 'sprites', `vfx_element_${family}_sheet.png`);
      const image = sharp(file).ensureAlpha();
      const meta = await image.metadata();
      expect(meta.width).toBe(384);
      expect(meta.height).toBe(384);
      expect(meta.hasAlpha).toBe(true);

      const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
      let transparent = 0;
      let magenta = 0;
      for (let i = 0; i < data.length; i += info.channels) {
        if (data[i + 3] === 0) transparent++;
        if (data[i] > 230 && data[i + 1] < 45 && data[i + 2] > 230 && data[i + 3] > 0) magenta++;
      }
      expect(transparent / (info.width * info.height)).toBeGreaterThan(0.80);
      expect(magenta).toBe(0);
    });
  }
});
