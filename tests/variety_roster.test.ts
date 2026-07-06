import { describe, expect, it, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import enemiesData from '../src/data/enemies.json';
import { createGameState } from '../src/GameState';
import { initializeGrid } from '../src/systems/GridManager';
import { buildFlyerPath, buildGroundPath, buildGroundPathB } from '../src/systems/PathFinder';
import { enemyDamageMultiplier, statusEffectiveness } from '../src/systems/EnemyResistances';
import { spawnEnemy, tickEnemies } from '../src/systems/EnemySystem';
import { DamageType, EnemyType, StatusEffectKind } from '../src/types';

function bootstrapState() {
  const state = createGameState();
  initializeGrid(state);
  const path = buildGroundPath(state);
  if (path) state.groundPath = path;
  const pathB = buildGroundPathB(state);
  if (pathB) state.groundPathB = pathB;
  state.flyerPath = buildFlyerPath();
  state.wave = 23;
  return state;
}

function enemyAssetMap(): Record<string, string> {
  const source = readFileSync(path.join(process.cwd(), 'src/render/Assets.ts'), 'utf8');
  const out: Record<string, string> = {};
  for (const match of source.matchAll(/\b([A-Z0-9_]+):\s*'([^']+\.png)'/g)) {
    out[match[1]] = match[2];
  }
  return out;
}

function alphaBounds(data: Buffer, width: number, height: number) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[((y * width + x) * 4) + 3];
      if (alpha > 8) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY, width: Math.max(0, maxX - minX + 1), height: Math.max(0, maxY - minY + 1) };
}

describe('late-campaign variety roster', () => {
  beforeEach(() => {
    (globalThis as any).window = (globalThis as any).window ?? {};
    (globalThis as any).window.__renderer = { triggerSpawnPuff: () => {} };
  });

  it('has real data and sprite files for the new enemy trio', () => {
    const expected = [
      ['SIEGE_WAGON', 'e3_siege_wagon.png'],
      ['DUNE_STALKER', 'e3_dune_stalker.png'],
      ['STONE_JUGGERNAUT', 'e3_stone_juggernaut.png']
    ] as const;

    for (const [type, file] of expected) {
      expect((enemiesData as any)[type], `${type} data missing`).toBeTruthy();
      expect(existsSync(path.join(process.cwd(), 'public/assets/sprites', file)), `${file} missing`).toBe(true);
    }
    expect((enemiesData as any).DUNE_STALKER.lowHpSpeedBoost).toBeGreaterThan(1);
    expect((enemiesData as any).SIEGE_WAGON.deathBurst).toMatchObject({
      type: 'DUNE_STALKER',
      count: 30,
      hpFrac: 0.4
    });
  });

  it('maps every authored enemy to a real sprite file', () => {
    const assets = enemyAssetMap();
    for (const type of Object.keys(enemiesData as any)) {
      const file = assets[type];
      expect(file, `${type} is missing an Assets.ts sprite mapping`).toBeTruthy();
      expect(existsSync(path.join(process.cwd(), 'public/assets/sprites', file)), `${type} -> ${file}`).toBe(true);
    }
  });

  it('keeps Cyclops as an uncropped full-body enemy sprite', async () => {
    const sharp = (await import('sharp')).default;
    const file = path.join(process.cwd(), 'public/assets/sprites/e3_cyclops.png');
    const meta = await sharp(file).metadata();
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const bounds = alphaBounds(data, info.width, info.height);
    const corners = [
      data[3],
      data[((info.width - 1) * 4) + 3],
      data[(((info.height - 1) * info.width) * 4) + 3],
      data[(((info.height * info.width) - 1) * 4) + 3]
    ];

    expect(meta.hasAlpha, 'Cyclops should keep transparent sprite corners').toBe(true);
    expect(Math.max(...corners), 'Cyclops corners should stay transparent').toBeLessThanOrEqual(8);
    expect(bounds.minX, 'Cyclops should have left padding, not a side-cropped bust').toBeGreaterThan(4);
    expect(bounds.minY, 'Cyclops should have top padding, not a top-cropped bust').toBeGreaterThan(4);
    expect(bounds.maxX, 'Cyclops should have right padding, not a side-cropped bust').toBeLessThan(info.width - 5);
    expect(bounds.maxY, 'Cyclops should have bottom padding for visible feet').toBeLessThan(info.height - 5);
    expect(bounds.height / info.height, 'Cyclops should read as a tall full-body giant').toBeGreaterThan(0.82);
  });

  it('keeps leak costs readable by threat tier: bosses 10, elites and commanders 5', () => {
    for (const [type, def] of Object.entries(enemiesData as any)) {
      if (def.isBoss) {
        expect(def.livesCost, `${type} boss leak cost`).toBe(10);
        continue;
      }
      const isCommander = type.includes('COMMANDER');
      const isEliteThreat = def.isElite === true || type === 'FIRE_GIANT';
      if (isCommander || isEliteThreat) {
        expect(def.livesCost, `${type} elite/commander leak cost`).toBe(5);
      }
    }
  });

  it('keeps Hun minions visually in the normal enemy size band', () => {
    const expectedScales: Record<string, number> = {
      MONGOL_HORSE_ARCHER: 0.86,
      MONGOL_SPEAR_RIDER: 0.86,
      MONGOL_FOOTMAN: 0.82,
      MONGOL_SPEARMAN: 0.82,
      MONGOL_BERSERKER: 0.82,
      MONGOL_SCOUT: 0.82,
      MONGOL_SHAMAN: 0.82,
      MONGOL_CAPTAIN: 0.9
    };

    for (const [type, scale] of Object.entries(expectedScales)) {
      expect((enemiesData as any)[type].renderScale, `${type} render scale`).toBe(scale);
      expect((enemiesData as any)[type].isBoss, `${type} should remain a minion`).toBe(false);
    }
  });

  it('wires the intended counters for the new enemy trio', () => {
    const state = bootstrapState();
    const wagon = spawnEnemy(state, EnemyType.SIEGE_WAGON, 1);
    const stalker = spawnEnemy(state, EnemyType.DUNE_STALKER, 1);
    const juggernaut = spawnEnemy(state, EnemyType.STONE_JUGGERNAUT, 1);

    expect(enemyDamageMultiplier(wagon, DamageType.SIEGE)).toBeGreaterThan(1);
    expect(enemyDamageMultiplier(juggernaut, DamageType.DIVINE)).toBeGreaterThan(1);
    expect(statusEffectiveness(stalker, StatusEffectKind.SLOW)).toBeLessThan(1);
  });

  it('cracks Siege Wagons into thirty non-chaining Dune Stalkers', () => {
    const state = bootstrapState();
    const wagon = spawnEnemy(state, EnemyType.SIEGE_WAGON, 1);
    wagon.pathIndex = 3;
    wagon.pathProgress = 0.4;
    wagon.hp = 0;

    const deaths: EnemyType[] = [];
    tickEnemies(state, 0.016, () => {}, enemy => { deaths.push(enemy.type); });

    const stalkers = Array.from(state.enemies.values()).filter(e => e.type === EnemyType.DUNE_STALKER);
    expect(deaths).toEqual([EnemyType.SIEGE_WAGON]);
    expect(stalkers).toHaveLength(30);
    expect(stalkers.every(e => e.__reanimated)).toBe(true);
    expect(stalkers.every(e => e.pathIndex === 3 && e.pathProgress === 0.4)).toBe(true);
    expect(state.hint).toContain('30 skirmishers');
  });
});
