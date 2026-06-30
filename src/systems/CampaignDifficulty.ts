export function campaignPressureHpMult(waveNumber: number): number {
  if (waveNumber <= 5) return 1;
  return 1 + Math.min(0.20, (waveNumber - 5) * 0.0075);
}

export function campaignPressureResistMult(waveNumber: number, isFlyer = false): number {
  if (waveNumber <= 5) return 1;
  const slope = isFlyer ? 0.0025 : 0.004;
  const floor = isFlyer ? 0.93 : 0.88;
  return Math.max(floor, 1 - (waveNumber - 5) * slope);
}
