import { describe, expect, it } from 'vitest';
import {
  nextSoloGameSpeed,
  SOLO_DEFAULT_GAME_SPEED,
  soloGameSpeedPresentation
} from '../src/GameSpeed';

describe('Solo game speed', () => {
  it('starts new runs at 2x with matching HUD presentation', () => {
    expect(SOLO_DEFAULT_GAME_SPEED).toBe(2);
    expect(soloGameSpeedPresentation(SOLO_DEFAULT_GAME_SPEED)).toEqual({
      label: '▶▶ 2×',
      background: '#5a3a1a'
    });
  });

  it('retains the 2x to 4x to 1x speed cycle', () => {
    const afterDefault = nextSoloGameSpeed(SOLO_DEFAULT_GAME_SPEED);
    const afterFast = nextSoloGameSpeed(afterDefault);
    const afterNormal = nextSoloGameSpeed(afterFast);

    expect([afterDefault, afterFast, afterNormal]).toEqual([4, 1, 2]);
  });

  it('recovers an invalid speed to the Solo default', () => {
    expect(nextSoloGameSpeed(3)).toBe(SOLO_DEFAULT_GAME_SPEED);
  });
});
