export const SOLO_GAME_SPEEDS = [1, 2, 4] as const;

export type SoloGameSpeed = (typeof SOLO_GAME_SPEEDS)[number];

// Hero selection is the player's entry into a Solo run, so new runs begin
// at the commonly used 2x pace while 1x remains available in the cycle.
export const SOLO_DEFAULT_GAME_SPEED: SoloGameSpeed = 2;

export function nextSoloGameSpeed(current: number): SoloGameSpeed {
  const index = SOLO_GAME_SPEEDS.indexOf(current as SoloGameSpeed);
  if (index < 0) return SOLO_DEFAULT_GAME_SPEED;
  return SOLO_GAME_SPEEDS[(index + 1) % SOLO_GAME_SPEEDS.length];
}

export function soloGameSpeedPresentation(speed: SoloGameSpeed): {
  label: string;
  background: string;
} {
  if (speed === 4) return { label: '▶▶▶ 4×', background: '#7a5a14' };
  if (speed === 2) return { label: '▶▶ 2×', background: '#5a3a1a' };
  return { label: '▶ 1×', background: '#222' };
}
