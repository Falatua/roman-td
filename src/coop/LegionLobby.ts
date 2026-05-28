// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION MODE — Entry + Lobby shell (Phase 1; netcode wired Phase 3)
//
// Self-contained DOM UI. Lazy-loaded from the loading screen so the base
// bundle is unaffected. Phase 1 delivers: the password gate (1027), the
// mode-intro/lobby screen, create/join room shell, and player-count select.
// Phase 3 replaces the stubbed create/join handlers with live Supabase
// Realtime room logic; Phase 9 swaps the "starting…" placeholder for the
// real board mount.
// ─────────────────────────────────────────────────────────────────────

import { COOP_PASSWORD, FLAVOR, PLAYER_COUNT_CONFIG } from './LegionConfig';

const OVERLAY_ID = 'legion-overlay';

function el(tag: string, css: string, html?: string): HTMLElement {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function removeOverlay() {
  document.getElementById(OVERLAY_ID)?.remove();
}

/**
 * Public entry point. Called by the loading-screen "CO-OP LEGION" button.
 * Shows the password gate first; on the correct code (1027) it opens the
 * Legion lobby. Wrong code → shake + stay.
 */
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
    if (input.value.trim() === COOP_PASSWORD) {
      removeOverlay();
      onOk();
    } else {
      errEl.textContent = '✗ WRONG CODE';
      box.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(0)' }], { duration: 260 });
      input.value = '';
      input.focus();
    }
  };
  (box.querySelector('#legion-pw-ok') as HTMLElement).onclick = tryOk;
  (box.querySelector('#legion-pw-back') as HTMLElement).onclick = removeOverlay;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryOk(); });
  setTimeout(() => input.focus(), 30);
}

// ─── LOBBY SHELL ───────────────────────────────────────────────────────
// Phase 1: visual shell + player-count select + create/join inputs. The
// create/join buttons currently route to the Phase-3 net handlers, which
// are stubbed until that phase lands.
function openLegionLobby(): void {
  removeOverlay();
  const overlay = el('div', `position:fixed;inset:0;z-index:300;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle,rgba(20,12,4,0.96),rgba(0,0,0,0.99));font-family:'Courier New',monospace;overflow:auto;padding:20px`);
  overlay.id = OVERLAY_ID;

  const countButtons = Object.values(PLAYER_COUNT_CONFIG)
    .map(c => `<button class="legion-count" data-count="${c.players}" style="background:#1a1410;color:#cdb98a;border:2px solid #5a4a30;padding:8px 16px;cursor:pointer;font-family:inherit;font-size:13px;letter-spacing:2px;font-weight:bold">${c.players}P</button>`)
    .join('');

  const box = el('div', `width:min(560px,94vw);text-align:center;padding:28px 32px;background:linear-gradient(180deg,#1a1410,#0c0a08);border:3px solid #d4af37;box-shadow:0 0 40px rgba(212,175,55,0.5)`);
  box.innerHTML = `
    <div style="font-size:26px;letter-spacing:6px;color:#d4af37;font-weight:900;text-shadow:0 0 14px #d4af37,2px 2px 0 #000">⚔ CO-OP LEGION ⚔</div>
    <div style="margin-top:6px;font-size:12px;color:#aa9a4a;font-style:italic;letter-spacing:1px">${FLAVOR.lobbyWaiting}</div>

    <div style="margin-top:20px;text-align:left;background:rgba(0,0,0,0.35);border-left:3px solid #d4af37;padding:12px 16px;font-size:11.5px;color:#cdb98a;line-height:1.6">
      Four legions defend Rome from a shared circuit. Hold your quadrant.
      What leaks past you circles to your neighbors — and if it completes the
      loop, it strikes <b style="color:#ffd34d">Rome</b> itself. Requires
      <b style="color:#fff8e0">2-4 players</b>.
    </div>

    <div style="margin-top:18px;font-size:10px;letter-spacing:3px;color:#aa9a4a">LEGION SIZE</div>
    <div style="margin-top:8px;display:flex;gap:10px;justify-content:center" id="legion-count-row">${countButtons}</div>

    <div style="margin-top:22px;display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div style="background:#0c0a08;border:1px solid #3a3025;padding:14px">
        <div style="font-size:12px;letter-spacing:2px;color:#88ff88;font-weight:bold;margin-bottom:8px">★ CREATE ROOM</div>
        <div style="font-size:10px;color:#aa9a4a;line-height:1.5;margin-bottom:10px">Host a new legion. You'll get a room code to share.</div>
        <button id="legion-create" style="width:100%;background:#3a5520;color:#fff8e0;border:2px solid #88ff88;padding:9px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:2px;font-weight:bold">CREATE</button>
      </div>
      <div style="background:#0c0a08;border:1px solid #3a3025;padding:14px">
        <div style="font-size:12px;letter-spacing:2px;color:#66ccff;font-weight:bold;margin-bottom:8px">★ JOIN ROOM</div>
        <input id="legion-join-code" maxlength="6" placeholder="CODE" autocomplete="off" style="width:100%;box-sizing:border-box;background:#1a1410;border:2px solid #5a4a30;color:#ffd34d;font-family:inherit;font-size:16px;letter-spacing:4px;text-align:center;text-transform:uppercase;padding:6px;outline:none;margin-bottom:8px" />
        <button id="legion-join" style="width:100%;background:#1a3a4a;color:#cfe8ff;border:2px solid #66ccff;padding:9px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:2px;font-weight:bold">JOIN</button>
      </div>
    </div>

    <div id="legion-status" style="height:18px;margin-top:14px;font-size:11px;color:#aa9a4a;letter-spacing:1px"></div>
    <button id="legion-back" style="margin-top:6px;background:#3a2010;color:#cdb98a;border:2px solid #7a5a1a;padding:8px 24px;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:2px;font-weight:bold">◀ BACK TO MAIN</button>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  let selectedCount = 4;
  const countRow = box.querySelector('#legion-count-row') as HTMLElement;
  const paintCount = () => {
    countRow.querySelectorAll('.legion-count').forEach((b) => {
      const btn = b as HTMLElement;
      const on = Number(btn.dataset.count) === selectedCount;
      btn.style.background = on ? '#3a5520' : '#1a1410';
      btn.style.borderColor = on ? '#88ff88' : '#5a4a30';
      btn.style.color = on ? '#fff8e0' : '#cdb98a';
    });
  };
  countRow.querySelectorAll('.legion-count').forEach((b) => {
    (b as HTMLElement).onclick = () => { selectedCount = Number((b as HTMLElement).dataset.count); paintCount(); };
  });
  paintCount();

  const status = box.querySelector('#legion-status') as HTMLElement;
  // Phase-3 hook points. Replaced with live Supabase Realtime room logic.
  (box.querySelector('#legion-create') as HTMLElement).onclick = () => {
    status.textContent = '⏳ Realtime lobby connects in Phase 3…';
    onCreateRoom(selectedCount);
  };
  (box.querySelector('#legion-join') as HTMLElement).onclick = () => {
    const code = (box.querySelector('#legion-join-code') as HTMLInputElement).value.trim().toUpperCase();
    if (code.length < 4) { status.textContent = '✗ Enter a valid room code'; return; }
    status.textContent = '⏳ Realtime lobby connects in Phase 3…';
    onJoinRoom(code);
  };
  (box.querySelector('#legion-back') as HTMLElement).onclick = removeOverlay;
}

// ─── PHASE-3 NET HOOKS (stubbed for now) ───────────────────────────────
// These are intentionally thin. Phase 3 (Supabase Realtime) replaces the
// bodies with real room creation / join + presence wiring, then routes into
// the in-room lobby roster view.
function onCreateRoom(_playerCount: number): void {
  // TODO(Phase 3): create Supabase Realtime room, generate code, show roster.
}
function onJoinRoom(_code: string): void {
  // TODO(Phase 3): join Supabase Realtime room by code, show roster.
}
