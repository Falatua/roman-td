export function campaignPressureHpMult(waveNumber: number): number {
  if (waveNumber <= 5) return 1;
  return 1 + Math.min(0.25, (waveNumber - 5) * 0.012);
}

export function campaignPressureResistMult(waveNumber: number, isFlyer = false): number {
  if (waveNumber <= 5) return 1;
  const slope = isFlyer ? 0.0035 : 0.0055;
  const floor = isFlyer ? 0.90 : 0.84;
  return Math.max(floor, 1 - (waveNumber - 5) * slope);
}
