// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION MODE — Match orchestrator (entry point for an active game)
//
// The lobby hands off here once the host starts. This module owns the
// client-side Legion game loop: it holds the LegionState, drives prep/wave
// phases, routes leaks through the circuit (Phase 5), tracks Rome (Phase 6)
// and economy (Phase 7), and mounts the board render + HUD (Phase 9).
//
// Built incrementally across phases. This file establishes the handoff
// contract and the match-state scaffold; later phases fill in the loop.
// ─────────────────────────────────────────────────────────────────────

import type { LegionNetTransport } from './LegionTypes';
import type { SessionConfig } from './LegionSession';
import { POSITION_TITLES, FLAVOR, type QuadrantId } from './LegionConfig';

export interface CoopMatchArgs {
  transport: LegionNetTransport;
  cfg: SessionConfig;
  assignments: Record<string, QuadrantId | null>;
  myQuadrant: QuadrantId;
}

const OVERLAY_ID = 'legion-overlay';

/**
 * Entry point for an active Co-op Legion match. Phases 4-9 expand the body
 * into the full prep/wave loop + render. For now it confirms the handoff
 * and shows the muster-complete screen so the lobby → match transition is
 * verifiable end to end.
 */
export function startCoopMatch(args: CoopMatchArgs): void {
  const { myQuadrant, cfg, transport } = args;
  const title = POSITION_TITLES[myQuadrant];

  document.getElementById(OVERLAY_ID)?.remove();
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.style.cssText = `position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle,rgba(20,12,4,0.97),rgba(0,0,0,0.99));font-family:'Courier New',monospace;color:#d4af37`;
  overlay.innerHTML = `
    <div style="text-align:center;max-width:520px;padding:0 20px">
      <div style="font-size:26px;letter-spacing:5px;font-weight:900;text-shadow:0 0 14px #d4af37">⚔ ${FLAVOR.waveStart}</div>
      <div style="margin-top:14px;font-size:14px;color:#fff8e0">You hold the <b style="color:#ffd34d">${title.title}</b> flank — quadrant <b>${myQuadrant}</b>.</div>
      <div style="margin-top:8px;font-size:11px;color:#cdb98a;line-height:1.5">${title.role}</div>
      <div style="margin-top:14px;font-size:11px;color:#aa9a4a">${cfg.players}-legion muster · Rome ${cfg.romeStartHp} HP · ${cfg.circuitShape}</div>
      <div style="margin-top:22px;font-size:11px;color:#88ff88;letter-spacing:2px">ROOM ${transport.roomCode}</div>
      <div style="margin-top:18px;font-size:10px;color:#5a8a5a;letter-spacing:1px">The battlefield (wave loop + circuit + Rome) mounts across Phases 4-9.</div>
      <button id="legion-quit-match" style="margin-top:22px;background:#3a2010;color:#cdb98a;border:2px solid #7a5a1a;padding:9px 24px;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:2px;font-weight:bold">◀ LEAVE LEGION</button>
    </div>`;
  document.body.appendChild(overlay);
  (overlay.querySelector('#legion-quit-match') as HTMLElement).onclick = () => {
    transport.leave();
    overlay.remove();
  };
}
