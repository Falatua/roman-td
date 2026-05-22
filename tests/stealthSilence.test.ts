// Tests for the 2026-05-21 stealth + silence enemy mechanics:
//   S1 — Ambush stealth: ground enemies with `ambushStealth: true` are
//        untargetable for the first `ambushStealthSec` seconds of each
//        wave. Carthage Spearman + Undead Berserker are the picks.
//   S2 — Silence aura: enemies with `silenceAuraRadiusTiles` field
//        continuously silence towers inside the radius. Zombie Druid
//        (1.5 tiles, mid-game) and Architectus (1.5 tiles, end-game).
//
// Strategy: drive EnemySystem.tickEnemies with crafted enemy/tower
// arrangements and assert on the runtime flags the renderer/targeting
// code reads (`__veiled` for stealth, `silencedUntil` for silence).
// Tower state setup is minimal — we only need silencedUntil/pending
// for the silence-aura assertions.

import { describe, it, expect, beforeAll } from 'vitest';
import { createGameState } from '../src/GameState';
import { tickEnemies } from '../src/systems/EnemySystem';
import { Enemy, EnemyFaction, EnemyType, Tower, TowerType, DamageType, TargetingMode } from '../src/types';
import { GRID } from '../src/constants';

beforeAll(() => {
  if (typeof (globalThis as any).window === 'undefined') {
    (globalThis as any).window = {};
  }
});

function makeEnemy(type: EnemyType, faction: EnemyFaction, x: number, y: number, maxHp = 1000): Enemy {
  return {
    id: 'e' + Math.random().toString(36).slice(2, 7),
    type, faction,
    hp: maxHp, maxHp,
    baseSpeed: 0, currentSpeed: 0,
    isFlyer: false,
    x, y, pathIndex: 0, pathProgress: 0,
    statusEffects: [],
    hasFeared: false, livesCost: 1, isBoss: false, reward: 0,
    archetype: 'SWARM',
    hpFlashTimer: 0,
    lastDamagedTick: -999
  } as Enemy;
}

function makeTower(id: string, tileX: number, tileY: number): Tower {
  return {
    id, type: TowerType.MILITES,
    tileX, tileY,
    damageType: DamageType.PHYS_MELEE,
    baseDps: 25,
    attackSpeed: 1.5,
    range: 1.5,
    qualityTier: 1,
    pending: false,
    placedTick: 0,
    attackCooldown: 0,
    killBonusFlat: 0,
    killCount: 0,
    builtFrom: [],
    equippedItems: [],
    targetingMode: TargetingMode.FIRST,
    costPaid: 2,
    silencedUntil: 0
  } as Tower;
}

describe('S1 — Ambush stealth on selected ground enemies', () => {
  it('Carthage Spearman is __veiled during the first 15s of the wave', () => {
    const s = createGameState();
    (s as any).__waveStartTick = 0;
    s.tick = 5;                   // 5 seconds into the wave (< 15)
    const e = makeEnemy(EnemyType.CARTHAGE_SPEARMAN, EnemyFaction.CARTHAGE, 320, 320);
    s.enemies.set(e.id, e);
    tickEnemies(s, 0.016, () => {}, () => {});
    expect((e as any).__veiled).toBe(true);
  });

  it('Undead Berserker is __veiled during the first 15s of the wave', () => {
    const s = createGameState();
    (s as any).__waveStartTick = 0;
    s.tick = 1;
    const e = makeEnemy(EnemyType.UNDEAD_BERSERKER, EnemyFaction.UNDEAD_CELTS, 320, 320);
    s.enemies.set(e.id, e);
    tickEnemies(s, 0.016, () => {}, () => {});
    expect((e as any).__veiled).toBe(true);
  });

  it('ambush stealth lifts at exactly 15s — enemy becomes targetable', () => {
    const s = createGameState();
    (s as any).__waveStartTick = 0;
    s.tick = 15.5;                // past the 15s window
    const e = makeEnemy(EnemyType.CARTHAGE_SPEARMAN, EnemyFaction.CARTHAGE, 320, 320);
    s.enemies.set(e.id, e);
    tickEnemies(s, 0.016, () => {}, () => {});
    // After the window, __veiled is NOT set true by ambush. The flag
    // remains whatever the prior stealth code (or default) left it.
    expect((e as any).__veiled).toBeFalsy();
  });

  it('enemy WITHOUT ambushStealth flag is not affected', () => {
    const s = createGameState();
    (s as any).__waveStartTick = 0;
    s.tick = 3;                   // well inside the window
    const e = makeEnemy(EnemyType.FERAL_DOG, EnemyFaction.DOGS, 320, 320);
    s.enemies.set(e.id, e);
    tickEnemies(s, 0.016, () => {}, () => {});
    expect((e as any).__veiled).toBeFalsy();
  });

  it('ambush stealth uses the per-enemy ambushStealthSec override (default 15)', () => {
    // Carthage Spearman in enemies.json explicitly sets ambushStealthSec: 15.
    // Confirm the duration matches by sampling at the boundary.
    const s = createGameState();
    (s as any).__waveStartTick = 0;
    s.tick = 14.9;                // just inside the window
    const e = makeEnemy(EnemyType.CARTHAGE_SPEARMAN, EnemyFaction.CARTHAGE, 320, 320);
    s.enemies.set(e.id, e);
    tickEnemies(s, 0.016, () => {}, () => {});
    expect((e as any).__veiled).toBe(true);
  });
});

describe('S2 — Movement-silence aura on selected enemies', () => {
  function towerCenter(t: Tower) {
    return { x: t.tileX * GRID.TILE + GRID.TILE / 2, y: t.tileY * GRID.TILE + GRID.TILE / 2 };
  }

  it('Zombie Druid silences a tower inside its 1.5-tile aura', () => {
    const s = createGameState();
    s.tick = 20;
    const tw = makeTower('tw1', 10, 10);
    s.towers.set(tw.id, tw);
    const tc = towerCenter(tw);
    // Place the Zombie Druid right on top of the tower so distance = 0
    const e = makeEnemy(EnemyType.ZOMBIE_DRUID, EnemyFaction.UNDEAD_CELTS, tc.x, tc.y);
    s.enemies.set(e.id, e);
    tickEnemies(s, 0.016, () => {}, () => {});
    // silencedUntil should be stamped beyond current tick
    expect(tw.silencedUntil).toBeGreaterThan(s.tick);
    // And the stamp is ~0.6s ahead
    expect(tw.silencedUntil).toBeLessThanOrEqual(s.tick + 0.65);
    expect(tw.silencedUntil).toBeGreaterThanOrEqual(s.tick + 0.5);
  });

  it('Architectus silences a tower inside its 1.5-tile aura', () => {
    const s = createGameState();
    s.tick = 20;
    const tw = makeTower('tw2', 10, 10);
    s.towers.set(tw.id, tw);
    const tc = towerCenter(tw);
    const e = makeEnemy(EnemyType.ARCHITECTUS, EnemyFaction.UNDEAD_CARTHAGE, tc.x, tc.y);
    s.enemies.set(e.id, e);
    tickEnemies(s, 0.016, () => {}, () => {});
    expect(tw.silencedUntil).toBeGreaterThan(s.tick);
  });

  it('tower OUTSIDE the 1.5-tile aura is NOT silenced', () => {
    const s = createGameState();
    s.tick = 20;
    const tw = makeTower('tw3', 10, 10);
    s.towers.set(tw.id, tw);
    const tc = towerCenter(tw);
    // Place the druid 5 tiles away — well outside the 1.5-tile aura
    const e = makeEnemy(EnemyType.ZOMBIE_DRUID, EnemyFaction.UNDEAD_CELTS, tc.x + GRID.TILE * 5, tc.y);
    s.enemies.set(e.id, e);
    tickEnemies(s, 0.016, () => {}, () => {});
    expect(tw.silencedUntil ?? 0).toBe(0);
  });

  it('enemy WITHOUT silenceAuraRadiusTiles flag does not silence towers in proximity', () => {
    const s = createGameState();
    s.tick = 20;
    const tw = makeTower('tw4', 10, 10);
    s.towers.set(tw.id, tw);
    const tc = towerCenter(tw);
    // FERAL_DOG sits on the tower but has no silence aura
    const e = makeEnemy(EnemyType.FERAL_DOG, EnemyFaction.DOGS, tc.x, tc.y);
    s.enemies.set(e.id, e);
    tickEnemies(s, 0.016, () => {}, () => {});
    expect(tw.silencedUntil ?? 0).toBe(0);
  });

  it('silence stamp expires naturally after the enemy leaves the aura', () => {
    const s = createGameState();
    s.tick = 20;
    const tw = makeTower('tw5', 10, 10);
    s.towers.set(tw.id, tw);
    const tc = towerCenter(tw);
    // Tick 1: druid in range, silence stamp lands
    const e = makeEnemy(EnemyType.ZOMBIE_DRUID, EnemyFaction.UNDEAD_CELTS, tc.x, tc.y);
    s.enemies.set(e.id, e);
    tickEnemies(s, 0.016, () => {}, () => {});
    const firstStamp = tw.silencedUntil ?? 0;
    expect(firstStamp).toBeGreaterThan(s.tick);

    // Tick 2: druid teleports out of range, advance state.tick past
    // the original stamp's expiry. silencedUntil is NOT refreshed.
    e.x = tc.x + GRID.TILE * 10;
    s.tick = firstStamp + 0.1;     // past the original stamp
    tickEnemies(s, 0.016, () => {}, () => {});
    // The stamp is unchanged (no refresh while out of range) and is
    // now in the past, so any silence-check in the engine will treat
    // the tower as un-silenced.
    expect(tw.silencedUntil).toBe(firstStamp);
    expect(s.tick).toBeGreaterThan(tw.silencedUntil!);
  });

  it('pending tower is not silenced (silence aura skips pending prospects)', () => {
    const s = createGameState();
    s.tick = 20;
    const tw = makeTower('tw6', 10, 10);
    tw.pending = true;
    s.towers.set(tw.id, tw);
    const tc = towerCenter(tw);
    const e = makeEnemy(EnemyType.ZOMBIE_DRUID, EnemyFaction.UNDEAD_CELTS, tc.x, tc.y);
    s.enemies.set(e.id, e);
    tickEnemies(s, 0.016, () => {}, () => {});
    expect(tw.silencedUntil ?? 0).toBe(0);
  });

  it('silence aura actually blocks firing (attackCooldown enforced)', () => {
    // The audit flagged that prior tests only verified `silencedUntil`
    // was stamped, NOT that the stamp actually prevents the tower
    // from firing. The mechanism is: the silence aura also sets
    // `t.attackCooldown` to at least 0.6s ahead. The CombatResolver
    // combat loop ticks down attackCooldown and only fires when it
    // hits 0. As long as the enemy stays in range, attackCooldown is
    // refreshed every frame and the tower can never reach 0. Verify
    // both the silencedUntil stamp AND the attackCooldown clamp.
    const s = createGameState();
    s.tick = 20;
    const tw = makeTower('tw_silence_fire', 10, 10);
    tw.attackCooldown = 0;     // tower would be ready to fire this frame
    s.towers.set(tw.id, tw);
    const tc = towerCenter(tw);
    const e = makeEnemy(EnemyType.ZOMBIE_DRUID, EnemyFaction.UNDEAD_CELTS, tc.x, tc.y);
    s.enemies.set(e.id, e);
    tickEnemies(s, 0.016, () => {}, () => {});
    // Both gates must be active for silence to read as "tower
    // cannot fire": the silencedUntil future-stamp drives the
    // visual + targeting overrides, and the attackCooldown clamp
    // is what the CombatResolver actually reads before firing.
    expect(tw.silencedUntil).toBeGreaterThan(s.tick);
    expect(tw.attackCooldown).toBeGreaterThanOrEqual(0.5);
  });

  it('silence aura attackCooldown clamp is NOT applied to towers out of range', () => {
    // Pairs with the prior firing-block test: confirm that a tower
    // outside the silence aura keeps its existing attackCooldown
    // (zero in this setup, so it can fire freely). Prevents a
    // regression where the silence-aura loop accidentally clamps
    // every tower's cooldown regardless of distance.
    const s = createGameState();
    s.tick = 20;
    const tw = makeTower('tw_out_of_range', 10, 10);
    tw.attackCooldown = 0;
    s.towers.set(tw.id, tw);
    const tc = towerCenter(tw);
    const e = makeEnemy(EnemyType.ZOMBIE_DRUID, EnemyFaction.UNDEAD_CELTS, tc.x + GRID.TILE * 5, tc.y);
    s.enemies.set(e.id, e);
    tickEnemies(s, 0.016, () => {}, () => {});
    expect(tw.silencedUntil ?? 0).toBe(0);
    expect(tw.attackCooldown).toBe(0);
  });
});

describe('S3 — Sanity: data flags in enemies.json wire to the runtime', () => {
  it('Carthage Spearman has ambushStealth in JSON', () => {
    const enemies = require('../src/data/enemies.json');
    expect(enemies.CARTHAGE_SPEARMAN.ambushStealth).toBe(true);
    expect(enemies.CARTHAGE_SPEARMAN.ambushStealthSec).toBe(15);
  });

  it('Undead Berserker has ambushStealth in JSON', () => {
    const enemies = require('../src/data/enemies.json');
    expect(enemies.UNDEAD_BERSERKER.ambushStealth).toBe(true);
    expect(enemies.UNDEAD_BERSERKER.ambushStealthSec).toBe(15);
  });

  it('Zombie Druid has silenceAuraRadiusTiles in JSON', () => {
    const enemies = require('../src/data/enemies.json');
    expect(enemies.ZOMBIE_DRUID.silenceAuraRadiusTiles).toBe(1.5);
  });

  it('Architectus has silenceAuraRadiusTiles in JSON', () => {
    const enemies = require('../src/data/enemies.json');
    expect(enemies.ARCHITECTUS.silenceAuraRadiusTiles).toBe(1.5);
  });
});
