import { Tower } from '../types';
import { GameStateShape } from '../GameState';
import { TIER_MULTS, ECONOMY } from '../constants';
import { spendGold } from './EconomySystem';

export function canDowngrade(t: Tower): boolean {
  return t.qualityTier > 1 && !t.hasBeenDowngraded;
}

export function getDowngradeWarningText(t: Tower): string {
  return `Downgrade ${t.type} from T${t.qualityTier} to T${t.qualityTier - 1}? This destroys ${t.killCount} kills and +${t.killBonusFlat.toFixed(1)} flat bonus permanently. Costs 2g.`;
}

export function downgradeTower(state: GameStateShape, t: Tower, returnItem: (id: string) => void): boolean {
  if (!canDowngrade(t)) return false;
  if (!spendGold(state, ECONOMY.DOWNGRADE_COST)) return false;
  // Item slot overflow handling
  const newTier = (t.qualityTier - 1) as 1 | 2 | 3 | 4 | 5;
  const newSlots = TIER_MULTS.itemSlots[newTier];
  while (t.equippedItems.length > newSlots) {
    const removed = t.equippedItems.pop()!;
    returnItem(removed); // back to inventory
  }
  t.qualityTier = newTier;
  t.killCount = 0;
  t.killBonusFlat = 0;
  t.hasBeenDowngraded = true;
  return true;
}
