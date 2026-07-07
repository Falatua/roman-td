import { GameStateShape } from '../GameState';

export const TRAP_PURCHASE_CAP_PER_TYPE = 5;

function cleanQty(qty: number): number {
  return Math.max(0, Math.floor(qty));
}

export function trapsPurchasedByType(state: GameStateShape, id: string): number {
  return Math.max(0, Math.floor((state.trapPurchasesByType ?? {})[id] ?? 0));
}

export function trapPurchasesRemaining(state: GameStateShape, id: string): number {
  return Math.max(0, TRAP_PURCHASE_CAP_PER_TYPE - trapsPurchasedByType(state, id));
}

export function grantTrapInventory(state: GameStateShape, id: string, qty: number): number {
  const desired = cleanQty(qty);
  if (desired <= 0) return 0;
  const granted = Math.min(desired, trapPurchasesRemaining(state, id));
  if (granted <= 0) return 0;
  state.trapInventory = state.trapInventory ?? {};
  state.trapPurchasesByType = state.trapPurchasesByType ?? {};
  state.trapInventory[id] = (state.trapInventory[id] ?? 0) + granted;
  state.trapPurchasesByType[id] = trapsPurchasedByType(state, id) + granted;
  state.trapsPurchased = (state.trapsPurchased ?? 0) + granted;
  return granted;
}

export function recordTrapDamage(state: GameStateShape, id: string, damage: number): void {
  const dealt = Math.max(0, damage);
  if (dealt <= 0) return;
  state.trapDamageByType = state.trapDamageByType ?? {};
  state.trapDamageThisWaveByType = state.trapDamageThisWaveByType ?? {};
  state.trapHitsThisWaveByType = state.trapHitsThisWaveByType ?? {};
  state.trapDamageByType[id] = (state.trapDamageByType[id] ?? 0) + dealt;
  state.trapDamageThisWaveByType[id] = (state.trapDamageThisWaveByType[id] ?? 0) + dealt;
  state.trapHitsThisWaveByType[id] = (state.trapHitsThisWaveByType[id] ?? 0) + 1;
}
