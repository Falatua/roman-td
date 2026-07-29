import { DamageType, Enemy, EnemyFaction, EnemyType, Tower } from '../types';
import { GRID } from '../constants';
import { GameStateShape } from '../GameState';

export interface MidCampaignEnemyAbility {
  id: string;
  name: string;
  description: string;
  threatTag: string;
  color: string;
}

const ABILITIES: Partial<Record<EnemyType, MidCampaignEnemyAbility[]>> = {
  [EnemyType.MONGOL_FOOTMAN]: [{
    id: 'SHIELD_BROTHERHOOD',
    name: 'SHIELD BROTHERHOOD',
    description: 'Near at least 2 other Hun Footmen, takes 18% less direct damage. Damage-over-time bypasses the formation.',
    threatTag: 'FORMATION',
    color: '#d6b36a'
  }],
  [EnemyType.MONGOL_SCOUT]: [{
    id: 'BREAKAWAY_AMBUSH',
    name: 'BREAKAWAY AMBUSH',
    description: 'When revealed after stealth, gains +35% movement speed for 1.5 seconds.',
    threatTag: 'AMBUSH-BURST',
    color: '#a78bd4'
  }],
  [EnemyType.MONGOL_HORSE_ARCHER]: [{
    id: 'PARTHIAN_VOLLEY',
    name: 'PARTHIAN VOLLEY',
    description: 'Once every 8 seconds, the pack suppresses its highest-damage ranged or siege tower within 5.5 tiles, slowing attacks by 30% for 3 seconds.',
    threatTag: 'TOWER-SUPPRESS',
    color: '#e09a55'
  }],
  [EnemyType.MONGOL_SPEAR_RIDER]: [{
    id: 'STEPPE_TEMPER',
    name: 'STEPPE TEMPER',
    description: 'Every 8 seconds alive, grows larger and gains +4% speed and 5% direct resistance, up to 4 times. Damage-over-time bypasses the resistance.',
    threatTag: 'HARDENS',
    color: '#e47a56'
  }],
  [EnemyType.MONGOL_CAPTAIN]: [{
    id: 'NOYANS_PACE',
    name: 'NOYAN\'S PACE',
    description: 'Nearby Mongol allies within 3 tiles move 15% faster. Multiple captains do not stack.',
    threatTag: 'SPEED-AURA',
    color: '#f0c55f'
  }],
  [EnemyType.EGYPTIAN_CHARIOT]: [{
    id: 'SUNWHEEL_CHARGE',
    name: 'SUNWHEEL CHARGE',
    description: 'At each quarter of its route, surges 40% faster for 2.25 seconds.',
    threatTag: 'ROUTE-SURGE',
    color: '#ffd15a'
  }],
  [EnemyType.PHARAOH_GUARD]: [{
    id: 'ROYAL_BODYGUARD',
    name: 'ROYAL BODYGUARD',
    description: 'Near an allied caster, commander, or boss within 2.75 tiles, takes 25% less direct damage. Damage-over-time bypasses the guard.',
    threatTag: 'BODYGUARDS',
    color: '#d9b44a'
  }],
  [EnemyType.SOBEK_WARRIOR]: [{
    id: 'RIVER_HUNGER',
    name: 'RIVER HUNGER',
    description: 'At each quarter of its route, permanently grows larger and gains +7% movement speed, up to 4 times.',
    threatTag: 'GROWS',
    color: '#49b88a'
  }]
};

const SPATIAL_BUCKET_SIZE = GRID.TILE * 3;

export function midCampaignAbilitiesFor(type: EnemyType | string): MidCampaignEnemyAbility[] {
  return ABILITIES[type as EnemyType] ?? [];
}

export function midCampaignDirectDamageMultiplier(enemy: Enemy): number {
  const value = enemy.__midDirectDamageMult;
  return typeof value === 'number' ? value : 1;
}

export function midCampaignEnemySpeedMultiplier(enemy: Enemy): number {
  const value = enemy.__midSpeedMult;
  return typeof value === 'number' ? value : 1;
}

export function midCampaignEnemyVisualScale(enemy: Enemy): number {
  const value = enemy.__midVisualScale;
  return typeof value === 'number' ? value : 1;
}

function routeProgress(state: GameStateShape, enemy: Enemy): number {
  const usesOceanGroundRoute = !!(enemy as any).__oceanRouteGroundPath;
  const pathLength = enemy.isFlyer && !usesOceanGroundRoute
    ? state.flyerPath.length
    : ((enemy as any).__caveB ? state.groundPathB.length : state.groundPath.length);
  if (pathLength <= 1) return 0;
  return Math.max(0, Math.min(1, (enemy.pathIndex + enemy.pathProgress) / (pathLength - 1)));
}

function applyTowerAttackSuppression(tower: Tower, pct: number, duration: number, tick: number): void {
  const target = tower as Tower & { __atkSpeedDebuffPct?: number; __atkSpeedDebuffUntil?: number };
  const active = tick < (target.__atkSpeedDebuffUntil ?? 0);
  target.__atkSpeedDebuffPct = active ? Math.max(target.__atkSpeedDebuffPct ?? 0, pct) : pct;
  target.__atkSpeedDebuffUntil = Math.max(active ? (target.__atkSpeedDebuffUntil ?? 0) : 0, tick + duration);
}

export function tickMidCampaignEnemyAbilities(state: GameStateShape): void {
  const enemies = Array.from(state.enemies.values());
  if (enemies.length === 0) return;

  const buckets = new Map<string, Enemy[]>();
  const bucketKey = (x: number, y: number) =>
    `${Math.floor(x / SPATIAL_BUCKET_SIZE)},${Math.floor(y / SPATIAL_BUCKET_SIZE)}`;
  for (const enemy of enemies) {
    enemy.__midDirectDamageMult = 1;
    enemy.__midSpeedMult = 1;
    enemy.__midVisualScale = 1;
    const key = bucketKey(enemy.x, enemy.y);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(enemy);
    else buckets.set(key, [enemy]);
  }

  const nearby = (source: Enemy, radiusTiles: number, predicate: (candidate: Enemy) => boolean): Enemy[] => {
    const radius = radiusTiles * GRID.TILE;
    const radiusSq = radius * radius;
    const bx = Math.floor(source.x / SPATIAL_BUCKET_SIZE);
    const by = Math.floor(source.y / SPATIAL_BUCKET_SIZE);
    const bucketReach = Math.ceil(radius / SPATIAL_BUCKET_SIZE);
    const result: Enemy[] = [];
    for (let dy = -bucketReach; dy <= bucketReach; dy++) {
      for (let dx = -bucketReach; dx <= bucketReach; dx++) {
        const bucket = buckets.get(`${bx + dx},${by + dy}`);
        if (!bucket) continue;
        for (const candidate of bucket) {
          if (candidate.id === source.id || !predicate(candidate)) continue;
          const px = candidate.x - source.x;
          const py = candidate.y - source.y;
          if (px * px + py * py <= radiusSq) result.push(candidate);
        }
      }
    }
    return result;
  };

  for (const enemy of enemies) {
    enemy.__midAbilitySpawnTick ??= state.tick;

    if (enemy.type === EnemyType.MONGOL_SCOUT) {
      const veiled = !!(enemy as any).__veiled;
      if (enemy.__midWasVeiled === true && !veiled) {
        enemy.__midBurstUntil = state.tick + 1.5;
        enemy.hpFlashTimer = Math.max(enemy.hpFlashTimer, 0.18);
      }
      enemy.__midWasVeiled = veiled;
      if (state.tick < (enemy.__midBurstUntil ?? 0)) {
        enemy.__midSpeedMult = (enemy.__midSpeedMult ?? 1) * 1.35;
      }
    }

    if (enemy.type === EnemyType.MONGOL_SPEAR_RIDER) {
      const age = Math.max(0, state.tick - enemy.__midAbilitySpawnTick);
      const stacks = Math.min(4, Math.floor(age / 8));
      enemy.__midDirectDamageMult = (enemy.__midDirectDamageMult ?? 1) * (1 - stacks * 0.05);
      enemy.__midSpeedMult = (enemy.__midSpeedMult ?? 1) * (1 + stacks * 0.04);
      enemy.__midVisualScale = (enemy.__midVisualScale ?? 1) * (1 + stacks * 0.04);
    }

    if (enemy.type === EnemyType.EGYPTIAN_CHARIOT) {
      const stage = Math.min(4, Math.floor(routeProgress(state, enemy) * 4));
      const previousStage = enemy.__midRouteStage ?? 0;
      if (stage > previousStage) {
        enemy.__midRouteStage = stage;
        enemy.__midBurstUntil = state.tick + 2.25;
        enemy.hpFlashTimer = Math.max(enemy.hpFlashTimer, 0.18);
      }
      if (state.tick < (enemy.__midBurstUntil ?? 0)) {
        enemy.__midSpeedMult = (enemy.__midSpeedMult ?? 1) * 1.40;
      }
    }

    if (enemy.type === EnemyType.SOBEK_WARRIOR) {
      const stage = Math.min(4, Math.floor(routeProgress(state, enemy) * 4));
      enemy.__midRouteStage = Math.max(enemy.__midRouteStage ?? 0, stage);
      enemy.__midSpeedMult = (enemy.__midSpeedMult ?? 1) * (1 + enemy.__midRouteStage * 0.07);
      enemy.__midVisualScale = (enemy.__midVisualScale ?? 1) * (1 + enemy.__midRouteStage * 0.03);
    }
  }

  for (const footman of enemies) {
    if (footman.type !== EnemyType.MONGOL_FOOTMAN) continue;
    const formation = nearby(
      footman,
      1.6,
      candidate => candidate.type === EnemyType.MONGOL_FOOTMAN
    );
    if (formation.length >= 2) {
      footman.__midDirectDamageMult = (footman.__midDirectDamageMult ?? 1) * 0.82;
    }
  }

  for (const captain of enemies) {
    if (captain.type !== EnemyType.MONGOL_CAPTAIN) continue;
    for (const ally of nearby(
      captain,
      3,
      candidate => candidate.faction === EnemyFaction.MONGOLS
    )) {
      ally.__midSpeedMult = Math.max(ally.__midSpeedMult ?? 1, 1.15);
    }
  }

  for (const guard of enemies) {
    if (guard.type !== EnemyType.PHARAOH_GUARD) continue;
    const protectedCharge = nearby(
      guard,
      2.75,
      candidate =>
        candidate.faction === EnemyFaction.EGYPTIANS &&
        !!(candidate.isCaster || candidate.isCommander || candidate.isBoss)
    );
    if (protectedCharge.length > 0) {
      guard.__midDirectDamageMult = (guard.__midDirectDamageMult ?? 1) * 0.75;
    }
  }

  const horseArchers = enemies
    .filter(enemy => enemy.type === EnemyType.MONGOL_HORSE_ARCHER)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (horseArchers.length > 0) {
    const cooldowns = ((state as any).__midCampaignPackCooldowns ??= {}) as Record<string, number>;
    const key = `PARTHIAN_VOLLEY_W${state.wave}`;
    if (cooldowns[key] == null) {
      cooldowns[key] = state.tick + 8;
    } else if (state.tick >= cooldowns[key]) {
      cooldowns[key] = state.tick + 8;
      const leader = horseArchers[0];
      const radiusSq = (5.5 * GRID.TILE) ** 2;
      let target: Tower | undefined;
      for (const tower of state.towers.values()) {
        if (tower.pending) continue;
        if (tower.damageType !== DamageType.PHYS_RANGED && tower.damageType !== DamageType.SIEGE) continue;
        const tx = tower.tileX * GRID.TILE + GRID.TILE / 2;
        const ty = tower.tileY * GRID.TILE + GRID.TILE / 2;
        const dx = tx - leader.x;
        const dy = ty - leader.y;
        if (dx * dx + dy * dy > radiusSq) continue;
        if (!target || tower.totalDamageDealt > target.totalDamageDealt) target = tower;
      }
      if (target) {
        applyTowerAttackSuppression(target, 0.30, 3, state.tick);
        leader.hpFlashTimer = Math.max(leader.hpFlashTimer, 0.24);
        const renderer = (globalThis as any).__renderer;
        renderer?.triggerImpactRing?.(
          target.tileX * GRID.TILE + GRID.TILE / 2,
          target.tileY * GRID.TILE + GRID.TILE / 2,
          state.tick,
          28,
          0xd6a15b
        );
      }
    }
  }
}
