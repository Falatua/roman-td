// Phase 8 — Disconnect / Ghost Lane (Section 10, Option A).
import { describe, it, expect } from 'vitest';
import {
  createLaneConn, markDisconnected, secondsUntilGhost, tickRejoinWindow, rejoin,
  isGhost, isConnected, canBuildInLane, ghostLeakHp, applyGhostReduction,
  connectedPlayerIds, redistributeGold, redistributeGhostPrepGold, type LaneConn,
} from '../src/coop/LegionGhost';
import { REJOIN_WINDOW_SEC } from '../src/coop/LegionConfig';
import type { LeakUnit } from '../src/coop/LegionTypes';

function leak(hp: number): LeakUnit {
  return {
    enemyType: 'X', hp, maxHp: 100, faction: 'F',
    isBoss: false, isImmune: false, fromQuadrant: 'NW', underReqCheckpoints: false,
  };
}

describe('Lane connection lifecycle (Section 10.1 / 10.3)', () => {
  it('starts CONNECTED and buildable', () => {
    const lane = createLaneConn('p1', 'NW', 'Aulus');
    expect(isConnected(lane)).toBe(true);
    expect(canBuildInLane(lane)).toBe(true);
    expect(isGhost(lane)).toBe(false);
  });

  it('disconnect opens the 60s rejoin window and locks building', () => {
    let lane = createLaneConn('p1', 'NW', 'Aulus');
    lane = markDisconnected(lane, 100);
    expect(lane.status).toBe('DISCONNECTED');
    expect(canBuildInLane(lane)).toBe(false);
    expect(secondsUntilGhost(lane, 100)).toBe(REJOIN_WINDOW_SEC);
    expect(secondsUntilGhost(lane, 130)).toBe(REJOIN_WINDOW_SEC - 30);
  });

  it('does not ghost before the window elapses', () => {
    let lane = markDisconnected(createLaneConn('p1', 'NW', 'Aulus'), 100);
    lane = tickRejoinWindow(lane, 100 + REJOIN_WINDOW_SEC - 1);
    expect(lane.status).toBe('DISCONNECTED');
  });

  it('converts to GHOST once the 60s window elapses', () => {
    let lane = markDisconnected(createLaneConn('p1', 'NW', 'Aulus'), 100);
    lane = tickRejoinWindow(lane, 100 + REJOIN_WINDOW_SEC);
    expect(isGhost(lane)).toBe(true);
    expect(canBuildInLane(lane)).toBe(false);
    expect(secondsUntilGhost(lane, 999)).toBe(0);
  });

  it('rejoin within the window restores control', () => {
    let lane = markDisconnected(createLaneConn('p1', 'NW', 'Aulus'), 100);
    lane = rejoin(lane);
    expect(isConnected(lane)).toBe(true);
    expect(canBuildInLane(lane)).toBe(true);
  });

  it('rejoin after GHOST conversion still restores control (towers intact)', () => {
    let lane = markDisconnected(createLaneConn('p1', 'NW', 'Aulus'), 100);
    lane = tickRejoinWindow(lane, 100 + REJOIN_WINDOW_SEC);
    expect(isGhost(lane)).toBe(true);
    lane = rejoin(lane);
    expect(isConnected(lane)).toBe(true);
    expect(canBuildInLane(lane)).toBe(true);
  });

  it('markDisconnected is idempotent (does not restart the clock)', () => {
    let lane = markDisconnected(createLaneConn('p1', 'NW', 'Aulus'), 100);
    const again = markDisconnected(lane, 140);
    expect(again.disconnectedAtSec).toBe(100); // unchanged
  });
});

describe('Ghost-lane leak reduction (Section 10.2)', () => {
  it('halves leak HP (rounded, clamped ≥0)', () => {
    expect(ghostLeakHp(42)).toBe(21);
    expect(ghostLeakHp(41)).toBe(21); // 20.5 → 21
    expect(ghostLeakHp(0)).toBe(0);
  });
  it('only reduces when the source lane is ghosted', () => {
    expect(applyGhostReduction(leak(80), false).hp).toBe(80);
    expect(applyGhostReduction(leak(80), true).hp).toBe(40);
  });
  it('does not mutate the source unit', () => {
    const u = leak(80);
    applyGhostReduction(u, true);
    expect(u.hp).toBe(80);
  });
});

describe('Gold redistribution (Section 10.2)', () => {
  it('splits evenly with deterministic remainder spread', () => {
    expect(redistributeGold(100, ['a', 'b'])).toEqual({ a: 50, b: 50 });
    expect(redistributeGold(101, ['a', 'b'])).toEqual({ a: 51, b: 50 });
    expect(redistributeGold(10, ['a', 'b', 'c'])).toEqual({ a: 4, b: 3, c: 3 });
  });
  it('returns zeros (not omissions) when there is nothing to split', () => {
    expect(redistributeGold(0, ['a', 'b'])).toEqual({ a: 0, b: 0 });
  });
  it('returns empty when there are no recipients', () => {
    expect(redistributeGold(100, [])).toEqual({});
  });

  it('connectedPlayerIds lists only CONNECTED lanes', () => {
    const lanes: LaneConn[] = [
      createLaneConn('a', 'NW', 'A'),
      markDisconnected(createLaneConn('b', 'NE', 'B'), 0),
      { ...createLaneConn('c', 'SE', 'C'), status: 'GHOST' },
    ];
    expect(connectedPlayerIds(lanes)).toEqual(['a']);
  });

  it('pools every non-connected lane\'s prep gold to the survivors', () => {
    const lanes: LaneConn[] = [
      createLaneConn('a', 'NW', 'A'),                                  // connected
      createLaneConn('b', 'NE', 'B'),                                  // connected
      { ...createLaneConn('c', 'SE', 'C'), status: 'GHOST' },          // ghost → forfeits
      markDisconnected(createLaneConn('d', 'SW', 'D'), 0),             // disconnected → forfeits
    ];
    const prep = { a: 100, b: 100, c: 40, d: 20 };
    // ghost+disconnected pooled = 60, split across a & b → 30 each
    expect(redistributeGhostPrepGold(lanes, prep)).toEqual({ a: 30, b: 30 });
  });
});
