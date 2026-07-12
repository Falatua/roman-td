import { EnemyType } from '../types';
import { GRID } from '../constants';
import { GameStateShape } from '../GameState';
import { COMMANDER_ENEMY_TYPES, isCommanderEnemy } from './EnemyClassification';

export type CommanderType =
  | 'STANDARD_BEARER_COMMANDER'
  | 'PATHFINDER_COMMANDER'
  | 'ANUBIS_PRIEST_COMMANDER'
  | 'SIEGE_CAPTAIN_COMMANDER'
  | 'SKY_STANDARD_COMMANDER'
  | 'SKY_PATHFINDER_COMMANDER'
  | 'SKY_ANUBIS_COMMANDER'
  | 'TIDECALLER_COMMANDER'
  | 'STORMTIDE_WYVERN_COMMANDER';

export const COMMANDER_TYPES = COMMANDER_ENEMY_TYPES;

const CAMPAIGN_COMMANDERS: Record<number, CommanderType> = {
  8: 'SKY_PATHFINDER_COMMANDER',
  18: 'SKY_STANDARD_COMMANDER',
  21: 'PATHFINDER_COMMANDER',
  23: 'ANUBIS_PRIEST_COMMANDER',
  24: 'SKY_ANUBIS_COMMANDER',
  26: 'STANDARD_BEARER_COMMANDER',
  28: 'SKY_PATHFINDER_COMMANDER',
  29: 'SIEGE_CAPTAIN_COMMANDER',
  30: 'STANDARD_BEARER_COMMANDER'
};

const BOSS_ESCORT_COMMANDERS: Record<number, CommanderType[]> = {
  5: ['PATHFINDER_COMMANDER', 'STANDARD_BEARER_COMMANDER'],
  10: ['PATHFINDER_COMMANDER', 'STANDARD_BEARER_COMMANDER', 'SIEGE_CAPTAIN_COMMANDER'],
  20: ['SKY_PATHFINDER_COMMANDER', 'STANDARD_BEARER_COMMANDER', 'ANUBIS_PRIEST_COMMANDER', 'SIEGE_CAPTAIN_COMMANDER'],
  21: ['PATHFINDER_COMMANDER', 'STANDARD_BEARER_COMMANDER', 'SIEGE_CAPTAIN_COMMANDER', 'SKY_PATHFINDER_COMMANDER'],
  24: ['SKY_ANUBIS_COMMANDER', 'STANDARD_BEARER_COMMANDER', 'PATHFINDER_COMMANDER', 'SIEGE_CAPTAIN_COMMANDER', 'SKY_PATHFINDER_COMMANDER'],
  30: ['STANDARD_BEARER_COMMANDER', 'PATHFINDER_COMMANDER', 'SIEGE_CAPTAIN_COMMANDER', 'ANUBIS_PRIEST_COMMANDER', 'SKY_STANDARD_COMMANDER', 'SKY_PATHFINDER_COMMANDER']
};

export function isCommanderType(type: string | EnemyType | undefined): boolean {
  return !!type && isCommanderEnemy(String(type));
}

export function bossEscortCommandersForWave(wave: number): CommanderType[] {
  return BOSS_ESCORT_COMMANDERS[wave] ? [...BOSS_ESCORT_COMMANDERS[wave]] : [];
}

export function injectBossEscortCommanders(state: GameStateShape, queue: { type: string; spawnAt: number; bossEscort?: boolean; caveB?: boolean }[]): void {
  if (state.endlessMode) return;
  const escort = bossEscortCommandersForWave(state.wave);
  if (escort.length === 0) return;
  const desiredCount = escort.length;
  let commanderCount = queue.filter(q => isCommanderType(q.type)).length;
  const queuedTypes = new Set(queue.map(q => q.type));
  let spawnAt = Math.max(1.8, Math.min(8.0, state.wave <= 10 ? 2.8 : 4.0));
  for (const type of escort) {
    if (commanderCount >= desiredCount) break;
    if (queuedTypes.has(type)) continue;
    queue.push({ type, spawnAt, bossEscort: true });
    queuedTypes.add(type);
    commanderCount++;
    spawnAt += state.wave <= 10 ? 1.2 : 1.0;
  }
  queue.sort((a, b) => a.spawnAt - b.spawnAt);
}

export function injectCampaignCommanders(state: GameStateShape, queue: { type: string; spawnAt: number; bossEscort?: boolean; caveB?: boolean }[]): void {
  if (state.endlessMode) return;
  const commander = CAMPAIGN_COMMANDERS[state.wave];
  if (!commander) return;
  if (queue.some(q => q.type === commander)) return;
  queue.push({ type: commander, spawnAt: 4.5 });
  queue.sort((a, b) => a.spawnAt - b.spawnAt);
}

function activeCommanders(state: GameStateShape, type?: CommanderType): any[] {
  const out: any[] = [];
  for (const e of state.enemies.values()) {
    if (e.hp <= 0) continue;
    if (!isCommanderType(e.type as any)) continue;
    if (type && e.type !== type) continue;
    out.push(e);
  }
  return out;
}

export function commanderDamageTakenMult(state: GameStateShape, target: any): number {
  if (!target || target.hp <= 0 || target.isBoss || isCommanderType(target.type)) return 1;
  let mult = 1;
  for (const commander of activeCommanders(state, 'STANDARD_BEARER_COMMANDER')) {
    if (Math.hypot(commander.x - target.x, commander.y - target.y) <= 4 * GRID.TILE) {
      mult = Math.min(mult, (state.wave ?? 1) >= 21 ? 0.80 : 0.85);
    }
  }
  for (const commander of activeCommanders(state, 'SKY_STANDARD_COMMANDER')) {
    if (Math.hypot(commander.x - target.x, commander.y - target.y) <= 4.5 * GRID.TILE) {
      mult = Math.min(mult, target.isFlyer ? 0.82 : 0.92);
    }
  }
  for (const commander of activeCommanders(state, 'TIDECALLER_COMMANDER')) {
    if (!(target as any).__oceanSpawn) continue;
    if (Math.hypot(commander.x - target.x, commander.y - target.y) <= 5 * GRID.TILE) {
      mult = Math.min(mult, (state.wave ?? 1) >= 25 ? 0.80 : 0.88);
    }
  }
  for (const commander of activeCommanders(state, 'STORMTIDE_WYVERN_COMMANDER')) {
    if (!target.isFlyer && !(target as any).__oceanSpawn) continue;
    if (Math.hypot(commander.x - target.x, commander.y - target.y) <= 5 * GRID.TILE) {
      const wave = state.wave ?? 1;
      mult = Math.min(mult, wave >= 25 ? 0.76 : wave >= 16 ? 0.80 : 0.86);
    }
  }
  return mult;
}

export function commanderSpeedMult(state: GameStateShape, enemy: any): number {
  if (!enemy || enemy.hp <= 0 || isCommanderType(enemy.type)) return 1;
  let mult = 1;
  if (activeCommanders(state, 'PATHFINDER_COMMANDER').length > 0) {
    mult *= (state.wave ?? 1) >= 25 ? 1.20 : (state.wave ?? 1) >= 21 ? 1.16 : 1.12;
  }
  if (enemy.isFlyer && activeCommanders(state, 'SKY_PATHFINDER_COMMANDER').length > 0) {
    mult *= (state.wave ?? 1) >= 21 ? 1.13 : 1.08;
  }
  if ((enemy as any).__oceanSpawn && activeCommanders(state, 'TIDECALLER_COMMANDER').length > 0) {
    mult *= (state.wave ?? 1) >= 25 ? 1.14 : 1.09;
  }
  if ((enemy.isFlyer || (enemy as any).__oceanSpawn) && activeCommanders(state, 'STORMTIDE_WYVERN_COMMANDER').length > 0) {
    const wave = state.wave ?? 1;
    mult *= wave >= 25 ? 1.14 : wave >= 16 ? 1.10 : 1.06;
  }
  return mult;
}

export function commanderTrapRadiusDisabled(state: GameStateShape, x: number, y: number): boolean {
  for (const commander of activeCommanders(state, 'SIEGE_CAPTAIN_COMMANDER')) {
    if (Math.hypot(commander.x - x, commander.y - y) <= 4 * GRID.TILE) return true;
  }
  return false;
}

export function tickCommanderSupport(state: GameStateShape, dt: number): void {
  if (dt <= 0) return;
  const healers = [
    ...activeCommanders(state, 'ANUBIS_PRIEST_COMMANDER').map(commander => ({ commander, sky: false })),
    ...activeCommanders(state, 'SKY_ANUBIS_COMMANDER').map(commander => ({ commander, sky: true }))
  ];
  for (const { commander, sky } of healers) {
    const next = (commander as any).__anubisPulseAt ?? 0;
    if (state.tick < next) continue;
    (commander as any).__anubisPulseAt = state.tick + 3.5;
    for (const e of state.enemies.values()) {
      if (e.hp <= 0 || e.isBoss || isCommanderType(e.type as any)) continue;
      if (sky && !e.isFlyer) continue;
      if (Math.hypot(e.x - commander.x, e.y - commander.y) > (sky ? 4.5 : 3.5) * GRID.TILE) continue;
      const healPct = sky ? ((state.wave ?? 1) >= 21 ? 0.07 : 0.045) : ((state.wave ?? 1) >= 21 ? 0.08 : 0.06);
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * healPct);
      (e as any).__commanderHealedUntil = state.tick + 0.35;
    }
  }
  for (const commander of activeCommanders(state, 'TIDECALLER_COMMANDER')) {
    const next = (commander as any).__tidePulseAt ?? 0;
    if (state.tick < next) continue;
    (commander as any).__tidePulseAt = state.tick + 3.25;
    for (const e of state.enemies.values()) {
      if (e.hp <= 0 || e.isBoss || isCommanderType(e.type as any)) continue;
      if (!(e as any).__oceanSpawn) continue;
      if (Math.hypot(e.x - commander.x, e.y - commander.y) > 5 * GRID.TILE) continue;
      const healPct = (state.wave ?? 1) >= 25 ? 0.075 : 0.055;
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * healPct);
      (e as any).__commanderHealedUntil = state.tick + 0.35;
      (e as any).__tidecalledUntil = state.tick + 0.55;
    }
  }
  for (const commander of activeCommanders(state, 'STORMTIDE_WYVERN_COMMANDER')) {
    const next = (commander as any).__stormtidePulseAt ?? 0;
    if (state.tick < next) continue;
    (commander as any).__stormtidePulseAt = state.tick + 3.6;
    for (const e of state.enemies.values()) {
      if (e.hp <= 0 || e.isBoss || isCommanderType(e.type as any)) continue;
      if (!e.isFlyer && !(e as any).__oceanSpawn) continue;
      if (Math.hypot(e.x - commander.x, e.y - commander.y) > 5 * GRID.TILE) continue;
      const healPct = (state.wave ?? 1) >= 25 ? 0.07 : (state.wave ?? 1) >= 16 ? 0.055 : 0.04;
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * healPct);
      (e as any).__commanderHealedUntil = state.tick + 0.35;
      (e as any).__stormtideUntil = state.tick + 0.65;
    }
  }
}
