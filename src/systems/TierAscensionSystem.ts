import { Tower } from '../types';
import { maxQualityTierForTower } from './BaseTowerRoster';

export const EAGLE_OF_APOTHEOSIS_ITEM_ID = 'EAGLE_OF_APOTHEOSIS';

export interface TierAscensionEligibility {
  ok: boolean;
  reason?: string;
}

export function canApplyEagleOfApotheosis(tower: Tower): TierAscensionEligibility {
  if (tower.pending) return { ok: false, reason: 'Keep this prospect before using the Eagle.' };
  if (tower.isHero) return { ok: false, reason: 'Heroes advance through experience and cannot consume the Eagle.' };
  if (tower.qualityTier >= 5) return { ok: false, reason: 'This tower is already Tier V.' };
  if (maxQualityTierForTower(tower.type) < 5) {
    return { ok: false, reason: 'This tower line is capped at Tier IV and cannot receive Apotheosis.' };
  }
  return { ok: true };
}

export function applyEagleOfApotheosis(tower: Tower): TierAscensionEligibility {
  const eligibility = canApplyEagleOfApotheosis(tower);
  if (!eligibility.ok) return eligibility;
  tower.qualityTier = 5;
  return { ok: true };
}
