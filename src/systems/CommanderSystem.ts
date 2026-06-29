import { EnemyType } from '../types';
import { GRID } from '../constants';
import { GameStateShape } from '../GameState';

export type CommanderType =
  | 'STANDARD_BEARER_COMMANDER'
  | 'PATHFINDER_COMMANDER'
  | 'ANUBIS_PRIEST_COMMANDER'
  | 'SIEGE_CAPTAIN_COMMANDER';

export const COMMANDER_TYPES = new Set<string>([
  'STANDARD_BEARER_COMMANDER',
  'PATHFINDER_COMMANDER',
  'ANUBIS_PRIEST_COMMANDER',
  'SIEGE_CAPTAIN_COMMANDER'
]);

const CAMPAIGN_COMMANDERS: Record<number, CommanderType> = {
  21: 'PATHFINDER_COMMANDER',
  23: 'ANUBIS_PRIEST_COMMANDER',
  26: 'STANDARD_BEARER_COMMANDER',
  29: 'SIEGE_CAPTAIN_COMMANDER',
  30: 'STANDARD_BEARER_COMMANDER'
};

export function isCommanderType(type: string | EnemyType | undefined): boolean {
  return !!type && COMMANDER_TYPES.has(String(type));
}

export function injectCampaignCommanders(state: GameStateShape, queue: { type: string; spawnAt: number }[]): void {
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
  for (const commander of activeCommanders(state, 'STANDARD_BEARER_COMMANDER')) {
    if (Math.hypot(commander.x - target.x, commander.y - target.y) <= 4 * GRID.TILE) {
      return (state.wave ?? 1) >= 21 ? 0.80 : 0.85;
    }
  }
  return 1;
}

export function commanderSpeedMult(state: GameStateShape, enemy: any): number {
  if (!enemy || enemy.hp <= 0 || isCommanderType(enemy.type)) return 1;
  if (activeCommanders(state, 'PATHFINDER_COMMANDER').length === 0) return 1;
  return (state.wave ?? 1) >= 25 ? 1.20 : (state.wave ?? 1) >= 21 ? 1.16 : 1.12;
}

export function commanderTrapRadiusDisabled(state: GameStateShape, x: number, y: number): boolean {
  for (const commander of activeCommanders(state, 'SIEGE_CAPTAIN_COMMANDER')) {
    if (Math.hypot(commander.x - x, commander.y - y) <= 4 * GRID.TILE) return true;
  }
  return false;
}

export function tickCommanderSupport(state: GameStateShape, dt: number): void {
  if (dt <= 0) return;
  for (const commander of activeCommanders(state, 'ANUBIS_PRIEST_COMMANDER')) {
    const next = (commander as any).__anubisPulseAt ?? 0;
    if (state.tick < next) continue;
    (commander as any).__anubisPulseAt = state.tick + 3.5;
    for (const e of state.enemies.values()) {
      if (e.hp <= 0 || e.isBoss || isCommanderType(e.type as any)) continue;
      if (Math.hypot(e.x - commander.x, e.y - commander.y) > 3.5 * GRID.TILE) continue;
      const healPct = (state.wave ?? 1) >= 21 ? 0.08 : 0.06;
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * healPct);
      (e as any).__commanderHealedUntil = state.tick + 0.35;
    }
  }
}
