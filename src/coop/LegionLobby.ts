// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION MODE — Entry + Lobby (Phases 1 + 3)
//
// Self-contained DOM UI, lazy-loaded from the loading screen so the base
// bundle is unaffected. Flow:
//   loading button → password gate (1027) → mode/lobby screen
//                  → CREATE or JOIN → live room (Supabase Realtime)
//                  → host assigns quadrants (random + swap) → START
//
// Assignment is HOST-AUTHORITATIVE: the host fills present players into the
// active quadrants and broadcasts the authoritative map; everyone renders
// from it. Start is gated on ≥2 players all assigned (Section 8.4).
// The board mount on 'start' is handed to CoopMatch (real-engine runtime, LR5).
// ─────────────────────────────────────────────────────────────────────

import { COOP_PASSWORD, FLAVOR, POSITION_TITLES, type QuadrantId } from './LegionConfig';
import { resolveSessionConfig, canStartLegion, sessionSummary, type SessionConfig } from './LegionSession';
import {
  createRealtimeTransport, createLocalTransport, isRealtimeConfigured,
  generateRoomCode, getOrCreateSelfId,
} from './LegionNet';
import type { LegionNetTransport, LegionPlayer } from './LegionTypes';

const OVERLAY_ID = 'legion-overlay';

function el(tag: string, css: string, html?: string): HTMLElement {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
function removeOverlay() { document.getElementById(OVERLAY_ID)?.remove(); }
function sanitizeName(s: string): string {
  return (s ?? '').replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 12) || 'LEGIONARY';
}

// Persist display name across sessions for convenience.
function savedName(): string {
  try { return localStorage.getItem('legion_name') ?? ''; } catch { return ''; }
}
function setSavedName(n: string) { try { localStorage.setItem('legion_name', n); } catch { /* ignore */ } }

export function openLegionEntry(): void {
  showPasswordGate(() => openLegionLobby());
}

// ─── PASSWORD GATE ─────────────────────────────────────────────────────
function showPasswordGate(onOk: () => void): void {
  removeOverlay();
  const overlay = el('div', `position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle,rgba(20,12,4,0.94),rgba(0,0,0,0.98));font-family:'Courier New',monospace`);
  overlay.id = OVERLAY_ID;
  const box = el('div', `width:min(420px,92vw);text-align:center;padding:26px 30px;background:linear-gradient(180deg,#1a1410,#0c0a08);border:3px solid #d4af37;box-shadow:0 0 36px rgba(212,175,55,0.55)`);
  box.innerHTML = `
    <div style="font-size:13px;letter-spacing:5px;color:#d4af37;font-weight:bold;text-shadow:0 0 8px #d4af3788">⚔ CO-OP LEGION ⚔</div>
    <div style="margin-top:6px;font-size:11px;color:#aa9a4a;font-style:italic;letter-spacing:1px">${FLAVOR.modeSelect}</div>
    <div style="margin-top:18px;font-size:11px;color:#cdb98a;letter-spacing:2px">ENTER LEGION ACCESS CODE</div>
    <input id="legion-pw" type="password" inputmode="numeric" maxlength="8" autocomplete="off"
      style="margin-top:10px;width:60%;background:#0c0a08;border:2px solid #5a4a30;color:#ffd34d;font-family:inherit;font-size:22px;letter-spacing:8px;text-align:center;padding:8px;outline:none" />
    <div id="legion-pw-err" style="height:16px;margin-top:6px;font-size:10px;color:#ff6666;letter-spacing:1px"></div>
    <div style="margin-top:14px;display:flex;gap:10px;justify-content:center">
      <button id="legion-pw-ok" style="background:#3a5520;color:#fff8e0;border:2px solid #88ff88;padding:9px 22px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:2px;font-weight:bold">ENTER</button>
      <button id="legion-pw-back" style="background:#3a2010;color:#cdb98a;border:2px solid #7a5a1a;padding:9px 22px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:2px;font-weight:bold">BACK</button>
    </div>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const input = box.querySelector('#legion-pw') as HTMLInputElement;
  const errEl = box.querySelector('#legion-pw-err') as HTMLElement;
  const tryOk = () => {
    if (input.value.trim() === COOP_PASSWORD) { removeOverlay(); onOk(); }
    else {
      errEl.textContent = '✗ WRONG CODE';
      box.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 260 });
      input.value = ''; input.focus();
    }
  };
  (box.querySelector('#legion-pw-ok') as HTMLElement).onclick = tryOk;
  (box.querySelector('#legion-pw-back') as HTMLElement).onclick = removeOverlay;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryOk(); });
  setTimeout(() => input.focus(), 30);
}

// ─── CREATE / JOIN SCREEN ──────────────────────────────────────────────
function openLegionLobby(): void {
  removeOverlay();
  const overlay = el('div', `position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle,rgba(20,12,4,0.96),rgba(0,0,0,0.99));font-family:'Courier New',monospace;overflow:auto;padding:20px`);
  overlay.id = OVERLAY_ID;
  const offlineNote = isRealtimeConfigured() ? '' :
    `<div style="margin-top:10px;font-size:10px;color:#ffaa55;letter-spacing:0.5px">⚠ Realtime not configured in this build — running in local preview (no remote players).</div>`;
  const box = el('div', `width:min(560px,94vw);text-align:center;padding:28px 32px;background:linear-gradient(180deg,#1a1410,#0c0a08);border:3px solid #d4af37;box-shadow:0 0 40px rgba(212,175,55,0.5)`);
  box.innerHTML = `
    <div style="font-size:26px;letter-spacing:6px;color:#d4af37;font-weight:900;text-shadow:0 0 14px #d4af37,2px 2px 0 #000">⚔ CO-OP LEGION ⚔</div>
    <div style="margin-top:6px;font-size:12px;color:#aa9a4a;font-style:italic;letter-spacing:1px">${FLAVOR.lobbyWaiting}</div>
    <div style="margin-top:18px;text-align:left;background:rgba(0,0,0,0.35);border-left:3px solid #d4af37;padding:12px 16px;font-size:11.5px;color:#cdb98a;line-height:1.6">
      Four legions defend Rome from a shared circuit. Hold your quadrant.
      What leaks past you circles to your neighbors — and if it completes the
      loop, it strikes <b style="color:#ffd34d">Rome</b> itself. Requires
      <b style="color:#fff8e0">2-4 players</b>.
    </div>
    <div style="margin-top:16px;font-size:10px;letter-spacing:2px;color:#aa9a4a">YOUR NAME</div>
    <input id="legion-name" maxlength="12" autocomplete="off" placeholder="LEGIONARY" value="${savedName()}"
      style="margin-top:6px;width:60%;box-sizing:border-box;background:#0c0a08;border:2px solid #5a4a30;color:#ffd34d;font-family:inherit;font-size:16px;letter-spacing:3px;text-align:center;text-transform:uppercase;padding:6px;outline:none" />
    <div style="margin-top:20px;display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div style="background:#0c0a08;border:1px solid #3a3025;padding:14px">
        <div style="font-size:12px;letter-spacing:2px;color:#88ff88;font-weight:bold;margin-bottom:8px">★ CREATE ROOM</div>
        <div style="font-size:10px;color:#aa9a4a;line-height:1.5;margin-bottom:10px">Host a new legion. Share the room code with your cohort.</div>
        <button id="legion-create" style="width:100%;background:#3a5520;color:#fff8e0;border:2px solid #88ff88;padding:9px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:2px;font-weight:bold">CREATE</button>
      </div>
      <div style="background:#0c0a08;border:1px solid #3a3025;padding:14px">
        <div style="font-size:12px;letter-spacing:2px;color:#66ccff;font-weight:bold;margin-bottom:8px">★ JOIN ROOM</div>
        <input id="legion-join-code" maxlength="6" placeholder="CODE" autocomplete="off" style="width:100%;box-sizing:border-box;background:#1a1410;border:2px solid #5a4a30;color:#ffd34d;font-family:inherit;font-size:16px;letter-spacing:4px;text-align:center;text-transform:uppercase;padding:6px;outline:none;margin-bottom:8px" />
        <button id="legion-join" style="width:100%;background:#1a3a4a;color:#cfe8ff;border:2px solid #66ccff;padding:9px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:2px;font-weight:bold">JOIN</button>
      </div>
    </div>
    ${offlineNote}
    <div style="margin-top:16px;border-top:1px dashed #5a4a30;padding-top:12px">
      <button id="legion-solo" style="width:100%;background:#2a3a1a;color:#cfe8b0;border:2px solid #88cc66;padding:9px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:2px;font-weight:bold">▶ SOLO TEST (1 player)</button>
      <div style="font-size:9.5px;color:#aa9a4a;margin-top:5px;line-height:1.5">Temporary: drop into a real Roman TD board solo to test feel + visuals. The teamwork circuit, shared Rome, and live multiplayer land in the next phases.</div>
    </div>
    <div id="legion-status" style="height:18px;margin-top:14px;font-size:11px;color:#aa9a4a;letter-spacing:1px"></div>
    <button id="legion-back" style="margin-top:6px;background:#3a2010;color:#cdb98a;border:2px solid #7a5a1a;padding:8px 24px;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:2px;font-weight:bold">◀ BACK TO MAIN</button>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const nameInput = box.querySelector('#legion-name') as HTMLInputElement;
  const status = box.querySelector('#legion-status') as HTMLElement;
  const self = () => ({ id: getOrCreateSelfId(), name: sanitizeName(nameInput.value) });

  async function connect(roomCode: string, isHost: boolean) {
    setSavedName(sanitizeName(nameInput.value));
    status.textContent = isRealtimeConfigured() ? '⏳ Connecting to the legion…' : '⏳ Opening local preview…';
    try {
      const transport = isRealtimeConfigured()
        ? await createRealtimeTransport({ roomCode, self: self(), isHost })
        : createLocalTransport({ roomCode, self: self(), isHost });
      openRoomView(transport, isHost);
    } catch (err) {
      console.error('[legion] connect failed:', err);
      status.textContent = '✗ Could not reach the legion. Try again.';
    }
  }

  (box.querySelector('#legion-create') as HTMLElement).onclick = () => connect(generateRoomCode(), true);
  (box.querySelector('#legion-join') as HTMLElement).onclick = () => {
    const code = (box.querySelector('#legion-join-code') as HTMLInputElement).value.trim().toUpperCase();
    if (code.length < 4) { status.textContent = '✗ Enter a valid room code'; return; }
    connect(code, false);
  };
  (box.querySelector('#legion-solo') as HTMLElement).onclick = () => {
    removeOverlay();
    import('./CoopSolo').then((m) => m.startSoloLegionTest()).catch((err) => console.error('[legion] solo test failed:', err));
  };
  (box.querySelector('#legion-back') as HTMLElement).onclick = removeOverlay;
  setTimeout(() => nameInput.focus(), 30);
}

// ─── IN-ROOM ROSTER VIEW ───────────────────────────────────────────────
const QUAD_ORDER: QuadrantId[] = ['NW', 'NE', 'SE', 'SW'];

function openRoomView(transport: LegionNetTransport, isHost: boolean): void {
  removeOverlay();
  const overlay = el('div', `position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle,rgba(20,12,4,0.97),rgba(0,0,0,0.99));font-family:'Courier New',monospace;overflow:auto;padding:20px`);
  overlay.id = OVERLAY_ID;
  const box = el('div', `width:min(620px,95vw);padding:26px 30px;background:linear-gradient(180deg,#1a1410,#0c0a08);border:3px solid #d4af37;box-shadow:0 0 40px rgba(212,175,55,0.5)`);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // Host-authoritative assignment map: playerId → quadrant.
  let assignments: Record<string, QuadrantId | null> = {};
  let roster: LegionPlayer[] = transport.presence();

  function activeQuadrantsFor(count: number): QuadrantId[] {
    return resolveSessionConfig(count).active;
  }

  // Host fills present players into the active quadrants in join order,
  // dropping departed players, keeping existing assignments stable.
  function hostReassign() {
    const count = Math.max(2, Math.min(4, roster.length));
    const active = activeQuadrantsFor(count);
    const ids = roster.map((p) => p.id);
    // prune
    for (const id of Object.keys(assignments)) if (!ids.includes(id)) delete assignments[id];
    // ensure unique + within active set
    const taken = new Set<QuadrantId>();
    for (const id of ids) {
      const cur = assignments[id];
      if (cur && active.includes(cur) && !taken.has(cur)) { taken.add(cur); }
      else assignments[id] = null;
    }
    // fill blanks
    for (const id of ids) {
      if (assignments[id]) continue;
      const open = active.find((q) => !taken.has(q));
      if (open) { assignments[id] = open; taken.add(open); }
    }
    transport.send('assign', assignments);
  }

  function render() {
    const count = Math.max(2, Math.min(4, roster.length));
    const cfg = resolveSessionConfig(count);
    const active = cfg.active;
    const allAssigned = roster.length >= 2 && roster.every((p) => assignments[p.id] && active.includes(assignments[p.id]!));
    const canStart = isHost && canStartLegion(roster.length) && allAssigned;

    const seatRows = QUAD_ORDER.map((q) => {
      const isActive = active.includes(q);
      const occupantId = Object.keys(assignments).find((id) => assignments[id] === q);
      const occupant = roster.find((p) => p.id === occupantId);
      const title = POSITION_TITLES[q];
      const youHere = occupant?.id === transport.selfId;
      const bg = !isActive ? '#0a0806' : youHere ? '#2a3a14' : occupant ? '#14110c' : '#0c0a08';
      const border = !isActive ? '#2a2218' : youHere ? '#88ff88' : '#3a3025';
      const occLabel = !isActive ? '<span style="color:#5a4a30">— sealed —</span>'
        : occupant ? `<b style="color:${youHere ? '#88ff88' : '#ffd34d'}">${occupant.name}${occupant.isHost ? ' 👑' : ''}${youHere ? ' (you)' : ''}</b>`
        : '<span style="color:#aa9a4a">open</span>';
      const clickable = isActive && !youHere;
      return `<div class="legion-seat" data-quad="${q}" style="display:flex;align-items:center;gap:12px;padding:9px 12px;margin-bottom:6px;background:${bg};border:2px solid ${border};${clickable ? 'cursor:pointer;' : ''}">
        <div style="min-width:74px;font-size:12px;font-weight:bold;color:${isActive ? '#d4af37' : '#5a4a30'};letter-spacing:1px">${q}</div>
        <div style="min-width:84px;font-size:11px;color:${isActive ? '#cdb98a' : '#5a4a30'};font-weight:bold">${title.title}</div>
        <div style="flex:1;font-size:12px;text-align:right">${occLabel}</div>
      </div>`;
    }).join('');

    box.innerHTML = `
      <div style="text-align:center;font-size:22px;letter-spacing:5px;color:#d4af37;font-weight:900;text-shadow:0 0 12px #d4af37">⚔ LEGION MUSTER ⚔</div>
      <div style="text-align:center;margin-top:6px;font-size:12px;color:#cdb98a;letter-spacing:1px">ROOM CODE: <b style="color:#ffd34d;font-size:18px;letter-spacing:4px">${transport.roomCode}</b></div>
      <div style="text-align:center;margin-top:4px;font-size:10px;color:#aa9a4a">${sessionSummary(cfg)}</div>
      <div style="margin-top:16px">${seatRows}</div>
      <div style="margin-top:8px;font-size:10px;color:#aa9a4a;text-align:center;line-height:1.5">
        ${isActive_help(isHost)}
      </div>
      <div style="margin-top:14px;display:flex;gap:10px;justify-content:center">
        ${isHost ? `<button id="legion-start" ${canStart ? '' : 'disabled'} title="${canStart ? '' : 'Requires at least 2 players, all assigned.'}"
          style="background:${canStart ? '#3a5520' : '#2a2a2a'};color:${canStart ? '#fff8e0' : '#666'};border:2px solid ${canStart ? '#88ff88' : '#444'};padding:10px 26px;cursor:${canStart ? 'pointer' : 'not-allowed'};font-family:inherit;font-size:13px;letter-spacing:2px;font-weight:bold">⚔ START LEGION</button>` : `<div style="font-size:11px;color:#aa9a4a;letter-spacing:1px;padding:10px">Waiting for the host to begin…</div>`}
        <button id="legion-leave" style="background:#3a2010;color:#cdb98a;border:2px solid #7a5a1a;padding:10px 20px;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:2px;font-weight:bold">LEAVE</button>
      </div>`;

    // Seat clicks: a player claims/swaps an active quadrant.
    box.querySelectorAll('.legion-seat').forEach((s) => {
      const quad = (s as HTMLElement).dataset.quad as QuadrantId;
      if (!active.includes(quad)) return;
      (s as HTMLElement).onclick = () => transport.send('claim', { playerId: transport.selfId, quadrant: quad });
    });
    const startBtn = box.querySelector('#legion-start') as HTMLButtonElement | null;
    if (startBtn && canStart) startBtn.onclick = () => {
      transport.send('start', { playerCount: roster.length, assignments });
      // host also transitions locally
      beginMatch(transport, cfg, assignments);
    };
    (box.querySelector('#legion-leave') as HTMLElement).onclick = () => { transport.leave(); removeOverlay(); };
  }

  // Presence changes → roster update → host reassigns.
  transport.on('presence', (m) => {
    roster = (m.payload as LegionPlayer[]) ?? transport.presence();
    if (isHost) hostReassign(); else render();
  });
  // Authoritative assignment broadcast from host.
  transport.on('assign', (m) => { assignments = (m.payload as Record<string, QuadrantId | null>) ?? {}; render(); });
  // A player claims a seat → host resolves (swap if occupied, else move).
  transport.on('claim', (m) => {
    if (!isHost) return;
    const { playerId, quadrant } = m.payload as { playerId: string; quadrant: QuadrantId };
    const prevHolder = Object.keys(assignments).find((id) => assignments[id] === quadrant);
    const claimantOld = assignments[playerId] ?? null;
    if (prevHolder && prevHolder !== playerId) assignments[prevHolder] = claimantOld; // swap
    assignments[playerId] = quadrant;
    transport.send('assign', assignments);
    render();
  });
  // Non-host: host pressed start.
  transport.on('start', (m) => {
    if (isHost) return;
    const { playerCount, assignments: a } = m.payload as { playerCount: number; assignments: Record<string, QuadrantId | null> };
    beginMatch(transport, resolveSessionConfig(playerCount), a);
  });

  roster = transport.presence();
  if (isHost) hostReassign(); else render();
  render();
}

function isActive_help(isHost: boolean): string {
  return isHost
    ? 'Click a quadrant to take a seat or swap. Auto-assigned as players join. The map adapts to the legion size (2-4).'
    : 'Click a quadrant to claim or swap your seat. The host begins when the legion is ready.';
}

// ─── MATCH START (handed to the real-engine CoopMatch runtime, LR5) ────
function beginMatch(transport: LegionNetTransport, cfg: SessionConfig, assignments: Record<string, QuadrantId | null>): void {
  removeOverlay();
  const myQuad = assignments[transport.selfId] ?? cfg.active[0];
  // LR5 — mount the REAL Roman TD board (RomanBoard) for this player's
  // quadrant, wrapped in the Legion teamwork layer (shared Rome, circuit
  // leak routing, scoreboard). Looks + plays exactly like single-player.
  import('./CoopMatch').then((m) => {
    m.startCoopMatch({ transport, cfg, assignments, myQuadrant: myQuad });
  }).catch((err) => {
    console.error('[legion] CoopMatch failed to load:', err);
    const overlay = el('div', `position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.96);font-family:'Courier New',monospace;color:#d4af37`, `
      <div style="text-align:center">
        <div style="font-size:20px;letter-spacing:4px;font-weight:900">⚔ ${FLAVOR.waveStart}</div>
        <div style="margin-top:10px;font-size:12px;color:#cdb98a">Legion forming — you hold the ${POSITION_TITLES[myQuad].title} (${myQuad}).</div>
        <div style="margin-top:8px;font-size:10px;color:#ff8080">Battlefield failed to load. Check the console.</div>
      </div>`);
    overlay.id = OVERLAY_ID;
    document.body.appendChild(overlay);
  });
}
