// One global balance lever for passive enemy health recovery. This covers
// continuous, wave-wide, out-of-combat, allied-aura, and scripted boss regen.
// Discrete mechanics such as checkpoint coins, commander pulses, death-pact
// bursts, and phase rebirths keep their authored values.
export const ENEMY_HEALTH_REGEN_MULT = 0.80;

export function scaledEnemyRegenRate(rate: number | null | undefined): number {
  return Math.max(0, Number(rate ?? 0)) * ENEMY_HEALTH_REGEN_MULT;
}
