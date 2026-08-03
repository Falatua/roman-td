import type { Tower } from '../types';
import { towerHasEnemySpellWard } from './ItemRules';

const SPELL_WARD_FLASH_SECONDS = 0.45;

export function markTowerEnemySpellBlocked(tower: Tower, tick: number): void {
  tower.__spellWardBlockedUntil = Math.max(tower.__spellWardBlockedUntil ?? 0, tick + SPELL_WARD_FLASH_SECONDS);
}

function blockEnemySpell(tower: Tower, tick: number): boolean {
  if (!towerHasEnemySpellWard(tower)) return false;
  markTowerEnemySpellBlocked(tower, tick);
  return true;
}

export function applyTowerAtkSpeedDebuff(
  tower: Tower,
  pct: number,
  durationSec: number,
  tick: number
): boolean {
  if (blockEnemySpell(tower, tick)) return false;
  const active = tick < (tower.__atkSpeedDebuffUntil ?? 0);
  tower.__atkSpeedDebuffPct = active ? Math.max(tower.__atkSpeedDebuffPct ?? 0, pct) : pct;
  tower.__atkSpeedDebuffUntil = Math.max(active ? (tower.__atkSpeedDebuffUntil ?? 0) : 0, tick + durationSec);
  return true;
}

export function applyTowerAuraSpeedDebuff(tower: Tower, pct: number, tick: number): boolean {
  if (blockEnemySpell(tower, tick)) return false;
  tower.__auraSpeedDebuff = Math.max(tower.__auraSpeedDebuff ?? 0, pct);
  return true;
}

export function applyTowerCritChancePenalty(
  tower: Tower,
  pct: number,
  source: string,
  tick: number
): boolean {
  if (blockEnemySpell(tower, tick)) return false;
  if (pct <= (tower.__critChancePenalty ?? 0)) return false;
  tower.__critChancePenalty = pct;
  tower.__critChancePenaltySource = source;
  return true;
}

export function applyTowerSilence(tower: Tower, durationSec: number, tick: number): boolean {
  if (blockEnemySpell(tower, tick)) return false;
  tower.silencedUntil = Math.max(tower.silencedUntil ?? 0, tick + durationSec);
  tower.attackCooldown = Math.max(tower.attackCooldown, durationSec);
  return true;
}

export function applyTowerSleep(tower: Tower, durationSec: number, tick: number): boolean {
  if (blockEnemySpell(tower, tick)) return false;
  tower.asleepUntil = Math.max(tower.asleepUntil ?? 0, tick + durationSec);
  tower.attackCooldown = Math.max(tower.attackCooldown, durationSec);
  return true;
}

export function applyTowerCooldownDisruption(
  tower: Tower,
  durationSec: number,
  tick: number,
  mode: 'ADD' | 'MAX' = 'MAX'
): boolean {
  if (blockEnemySpell(tower, tick)) return false;
  tower.attackCooldown = mode === 'ADD'
    ? tower.attackCooldown + durationSec
    : Math.max(tower.attackCooldown, durationSec);
  return true;
}
