export function campaignPressureHpMult(waveNumber: number): number {
  if (waveNumber <= 5) return 1;
  return 1 + Math.min(0.25, (waveNumber - 5) * 0.012);
}

export const CAMPAIGN_RESISTANCE_GAIN_PER_WAVE = 0.015;
export const CAMPAIGN_FINAL_WAVE = 30;

// One shared, readable resistance curve for the whole 30-wave campaign.
// Wave 1 has no campaign resistance. Every later wave adds exactly 1.5
// percentage points, reaching 43.5% on Wave 30. Faction and per-enemy
// profiles still compose with this multiplier, and hard immunities remain
// authoritative in the resistance pipeline.
export function campaignPressureResistMult(waveNumber: number): number {
  const wave = Math.max(1, Math.min(CAMPAIGN_FINAL_WAVE, Math.floor(waveNumber)));
  return 1 - (wave - 1) * CAMPAIGN_RESISTANCE_GAIN_PER_WAVE;
}

export function campaignPressureResistancePct(waveNumber: number): number {
  return 1 - campaignPressureResistMult(waveNumber);
}
