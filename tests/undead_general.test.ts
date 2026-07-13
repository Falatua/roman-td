import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createGameState } from '../src/GameState';
import comboData from '../src/data/towerCombinations.json';
import towersData from '../src/data/towers.json';
import { ASSET_KEYS } from '../src/render/Assets';
import {
  applyDamageAndStatus,
  hasCleave,
  undeadGeneralPreyDamageMult,
  UNDEAD_GENERAL_BEAST_DAMAGE_MULT,
  UNDEAD_GENERAL_ELEPHANT_DAMAGE_MULT,
} from '../src/systems/CombatResolver';
import { executeCombo, scanCombos } from '../src/systems/CombinationEngine';
import { initializeGrid, setTile } from '../src/systems/GridManager';
import { buildGroundPath } from '../src/systems/PathFinder';
import { createTower } from '../src/systems/TowerSystem';
import { Enemy, EnemyFaction, EnemyType, GamePhase, StatusEffectKind, TileType, TowerType } from '../src/types';

function setupState() {
  const state = createGameState();
  initializeGrid(state);
  state.groundPath = buildGroundPath(state) ?? [];
  state.phase = GamePhase.BUILD_PHASE;
  state.gold = 1000;
  return state;
}

function addTower(state: ReturnType<typeof setupState>, type: TowerType, tier: 1 | 2 | 3 | 4 | 5, col: number, row: number) {
  const tower = createTower(type, tier, col, row, state.wave);
  state.towers.set(tower.id, tower);
  setTile(state, col, row, TileType.TOWER);
  return tower;
}

function enemy(type: EnemyType): Enemy {
  return {
    id: `target-${type}`,
    type,
    faction: EnemyFaction.DOGS,
    hp: 10000,
    maxHp: 10000,
    baseSpeed: 1,
    currentSpeed: 1,
    isFlyer: false,
    x: 160,
    y: 160,
    pathIndex: 0,
    pathProgress: 0,
    statusEffects: [],
    hasFeared: false,
    livesCost: 1,
    isBoss: false,
    reward: 0,
    archetype: 'ELITE',
    hpFlashTimer: 0,
  };
}

const hooks = {
  onKill: () => {},
  onHit: () => {},
  onMeleeSwing: () => {},
  onProjectileFire: () => {},
};

describe('Undead General combo tower', () => {
  it('uses exactly Primus Pilus T4 and Evocatus T4 for a standard 50g Tier 4 recipe', () => {
    const recipe = (comboData as any[]).find(entry => entry.result === TowerType.UNDEAD_GENERAL);
    expect(recipe).toEqual({
      result: TowerType.UNDEAD_GENERAL,
      tier: 4,
      cost: 50,
      ingredients: [
        { type: TowerType.PRIMUS_PILUS, minTier: 4 },
        { type: TowerType.EVOCATUS, minTier: 4 },
      ],
    });

    const state = setupState();
    const primus = addTower(state, TowerType.PRIMUS_PILUS, 4, 8, 8);
    addTower(state, TowerType.EVOCATUS, 4, 9, 8);
    const combo = scanCombos(state).find(entry => entry.result === TowerType.UNDEAD_GENERAL);
    expect(combo).toBeTruthy();
    expect(executeCombo(state, combo!, primus.id)).toBe(true);
    const result = Array.from(state.towers.values()).find(tower => tower.type === TowerType.UNDEAD_GENERAL);
    expect(result?.qualityTier).toBe(4);
    expect(result?.tileX).toBe(8);
    expect(result?.tileY).toBe(8);
  });

  it('has the stronger command cadence and three-tile melee-cleave reach', () => {
    const general = (towersData as any)[TowerType.UNDEAD_GENERAL];
    const scorpionBolt = (towersData as any)[TowerType.SCORPION_BOLT];
    expect(general.baseDps).toBe(120.0);
    expect(general.baseDps).toBeGreaterThan(scorpionBolt.baseDps);
    expect(general.attackSpeed).toBe(1.4);
    expect(general.range).toBe(3.0);
    expect(general.damageType).toBe('PHYS_MELEE');
    expect(general.melee).toBe(true);
    const tower = createTower(TowerType.UNDEAD_GENERAL, 4, 0, 0, 0);
    expect(hasCleave(tower)).toBe(true);
    expect(tower.range).toBe(3.0);
  });

  it('specializes against beasts and both living and undead elephants', () => {
    expect(UNDEAD_GENERAL_BEAST_DAMAGE_MULT).toBe(2.25);
    expect(UNDEAD_GENERAL_ELEPHANT_DAMAGE_MULT).toBe(3);
    expect(undeadGeneralPreyDamageMult(enemy(EnemyType.FERAL_DOG))).toBe(2.25);
    expect(undeadGeneralPreyDamageMult(enemy(EnemyType.DEMON_HELLHOUND))).toBe(2.25);
    expect(undeadGeneralPreyDamageMult(enemy(EnemyType.WAR_ELEPHANT))).toBe(3);
    expect(undeadGeneralPreyDamageMult(enemy(EnemyType.UNDEAD_WAR_ELEPHANT))).toBe(3);
    expect(undeadGeneralPreyDamageMult(enemy(EnemyType.CELTIC_FOOTMAN))).toBe(1);

    const state = setupState();
    const general = createTower(TowerType.UNDEAD_GENERAL, 4, 4, 4, 0);
    const elephant = enemy(EnemyType.WAR_ELEPHANT);
    applyDamageAndStatus(state, general, elephant, 100, hooks);
    expect(elephant.statusEffects.some(effect => effect.kind === StatusEffectKind.ARMOR_SHRED)).toBe(true);
    expect(elephant.statusEffects.some(effect => effect.kind === StatusEffectKind.SLOW)).toBe(false);
  });

  it('ships a complete transparent GPT Images sprite registered in the manifest', async () => {
    expect(ASSET_KEYS.UNDEAD_GENERAL).toBe('t_undead_general.png');
    const spritePath = path.join(process.cwd(), 'public/assets/sprites/t_undead_general.png');
    expect(fs.existsSync(spritePath)).toBe(true);
    const sharp = (await import('sharp')).default;
    const image = sharp(spritePath);
    const metadata = await image.metadata();
    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(512);
    expect(metadata.hasAlpha).toBe(true);
    const raw = await image.ensureAlpha().raw().toBuffer();
    let transparent = 0;
    for (let i = 3; i < raw.length; i += 4) if (raw[i] < 8) transparent++;
    expect(transparent).toBeGreaterThan(512 * 512 * 0.40);
  });
});
