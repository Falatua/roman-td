// SANDBOX: in-game dev panel.
//
// Mounted on the right-panel when state.sandboxMode is true. Provides:
//   • A persistent "🧪 SANDBOX MODE" banner at the top of the screen
//     so the player can never forget they're in dev-test mode.
//   • JUMP TO WAVE button → modal with W1-W20 buttons + ENDLESS.
//   • SPAWN TOWER button → modal listing every tower at every tier.
//     Click a tower → it goes into a placement queue, click any
//     empty tile to drop it.
//   • +1000g button — quick gold top-up for testing economy.
//
// CLEANUP RECIPE: delete this entire file + the import in main.ts +
// the mountSandboxPanel() call + every `// SANDBOX:` comment.

import { GameStateShape } from '../GameState';
import { TowerType } from '../types';
import { sandboxAllTowerOptions } from '../systems/SandboxMode';

export interface SandboxPanelHooks {
  // Called when the player picks a wave from the JUMP TO WAVE modal.
  // wave = 1..20 OR -1 for endless.
  onJumpToWave: (wave: number) => void;
  // Called when the player picks a tower from the SPAWN TOWER modal.
  // Loads the picked tower+tier into a placement queue; the
  // next empty-tile click in main.ts drops it.
  onPickTower: (type: TowerType, tier: 1 | 2 | 3 | 4 | 5) => void;
  // Called when the player clicks the +1000g button.
  onAddGold: () => void;
  // SANDBOX 2026-05-19: full tower wipe. Wave jumps preserve towers
  // by default; this is the explicit "start over with a blank maze"
  // button. Called after a confirm() prompt in the panel itself.
  onWipeAllTowers: () => void;
}

// Mount the persistent banner + right-panel buttons. Idempotent —
// safe to call multiple times (later calls are no-ops).
export function mountSandboxPanel(state: GameStateShape, hooks: SandboxPanelHooks): void {
  if (!state.sandboxMode) return;
  if (document.getElementById('sandbox-banner')) return;   // already mounted

  // ── Pinned top banner ──
  const banner = document.createElement('div');
  banner.id = 'sandbox-banner';
  banner.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:175;background:linear-gradient(90deg,#5a1a4a,#ff5cc8,#5a1a4a);color:#1a0820;padding:6px 18px;font-family:"Courier New",monospace;font-size:11px;letter-spacing:3px;font-weight:bold;box-shadow:0 4px 14px rgba(255,92,200,0.4);border-bottom:2px solid #ff5cc8;pointer-events:none';
  // Initial text — updateSandboxBanner() fills in the current wave on
  // the first render tick.
  banner.textContent = '🧪 SANDBOX MODE · TESTING ONLY · NO LEADERBOARD';
  document.body.appendChild(banner);

  // ── Right-panel button block ──
  const rightPanel = document.getElementById('right-panel');
  if (!rightPanel) return;

  const panel = document.createElement('div');
  panel.id = 'sandbox-panel';
  panel.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:6px;margin-top:6px;background:linear-gradient(180deg,#2a0820,#1a0410);border:2px dashed #ff5cc8;box-shadow:inset 0 0 12px rgba(255,92,200,0.2)';
  // Header + live wave readout. The #sandbox-current-wave span is
  // refreshed by updateSandboxBanner() each render tick so the
  // tester can glance at the panel and see W14 / W19 / ENDLESS W3
  // without scrolling up to the banner.
  panel.innerHTML = '<div style="font-size:9px;color:#ff5cc8;letter-spacing:2px;text-align:center;font-weight:bold;margin-bottom:2px">🧪 DEV TOOLS</div>' +
    '<div id="sandbox-current-wave" style="font-size:13px;color:#ffd34d;letter-spacing:2px;text-align:center;font-weight:bold;background:#0c0410;border:1px solid #ff5cc8;padding:4px 6px;margin-bottom:4px">— W? —</div>';

  const mkSbBtn = (label: string, onClick: () => void, tooltip?: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'background:#2a1a25;border:1px solid #ff5cc8;color:#ff5cc8;padding:6px 8px;font-family:inherit;font-size:11px;letter-spacing:1px;font-weight:bold;cursor:pointer;text-align:center';
    if (tooltip) b.title = tooltip;
    b.onmouseenter = () => { b.style.background = '#3a2535'; };
    b.onmouseleave = () => { b.style.background = '#2a1a25'; };
    b.onclick = onClick;
    return b;
  };

  panel.appendChild(mkSbBtn('▶ JUMP TO WAVE', () => showWavePicker(hooks),
    'Hard-reset to any wave 1-20 or jump into Endless mode. Clears enemies, projectiles, loot, and surprise-event state. Towers and the maze are PRESERVED (use WIPE TOWERS for a clean slate).'));
  panel.appendChild(mkSbBtn('+ SPAWN TOWER', () => showTowerPicker(hooks),
    'Direct tower spawn — pick any tower at any tier (T1-T5, base or combo). Bypasses the prospect / recipe flow entirely. Click an empty tile to drop. Free.'));
  panel.appendChild(mkSbBtn('💰 +1000g', () => hooks.onAddGold(),
    'Add 1000 gold to your treasury. Sandbox starts with 999,999g so you rarely need it — useful for testing exact buy thresholds.'));
  // SANDBOX 2026-05-19: red-bordered wipe button. Visually distinct
  // (red instead of pink) so it can't be confused with the
  // additive actions above. confirm() guards against accidental
  // wipe after building a complicated maze.
  const wipeBtn = mkSbBtn('🗑 WIPE TOWERS', () => {
    if (!confirm('Wipe ALL towers and stones? The path will be reset to its empty baseline. This is irreversible.')) return;
    hooks.onWipeAllTowers();
  }, 'Wipe every tower and stone-wall on the map and rebuild the path to its empty baseline. Use when you want a clean maze. Confirms before firing — irreversible.');
  wipeBtn.style.borderColor = '#ff5050';
  wipeBtn.style.color = '#ff8080';
  wipeBtn.onmouseenter = () => { wipeBtn.style.background = '#3a1a1a'; };
  wipeBtn.onmouseleave = () => { wipeBtn.style.background = '#2a1a25'; };
  panel.appendChild(wipeBtn);
  rightPanel.appendChild(panel);
}

// SANDBOX 2026-05-19: live-update the banner with the current wave +
// phase so the tester always knows what they're testing. Called from
// main.ts every render tick alongside other HUD updates. No-op
// outside sandbox or before the banner exists. Phase tag:
//   BUILD_PHASE → " · BUILD"
//   WAVE_PHASE  → " · IN COMBAT"
//   GAME_OVER   → " · RUN ENDED" (sandbox skips the actual game-over
//                 ceremony so this only flashes briefly before
//                 sandboxResetForWave fires)
export function updateSandboxBanner(state: GameStateShape): void {
  if (!state.sandboxMode) return;
  // GamePhase enum order (kept inline so this module doesn't need the
  // import — easier to delete later): BUILD=0, WAVE=1, GAME_OVER=2,
  // VICTORY=3, PROSPECT_PLACEMENT=4, PICK_KEEPER=5.
  // 2026-05-19 — During pre-wave phases (BUILD/PROSPECT/PICK_KEEPER),
  // state.wave is the LAST COMPLETED wave (or one-less than the jump
  // target because startWave bumps it on START WAVE). To show the
  // tester the wave they're about to play, we display state.wave + 1
  // in pre-wave phases. During WAVE_PHASE state.wave is already the
  // current wave, so no offset is needed.
  const isPreWave = state.phase === 0 || state.phase === 4 || state.phase === 5;
  const displayWaveNum = isPreWave ? Math.min(20, (state.wave || 0) + 1) : (state.wave || 1);
  const wave = (state as any).endlessMode
    ? `ENDLESS W${(state as any).endlessWave ?? 1}`
    : `W${displayWaveNum}`;
  const phaseTag = state.phase === 1 ? ' · IN COMBAT'
    : state.phase === 0 ? ' · BUILD'
    : state.phase === 4 ? ' · PLACING PROSPECTS'
    : state.phase === 5 ? ' · PICK KEEPER'
    : state.phase === 2 ? ' · RUN ENDED'
    : state.phase === 3 ? ' · CLEARED' : '';
  const banner = document.getElementById('sandbox-banner');
  if (banner) banner.textContent = `🧪 SANDBOX · ${wave}${phaseTag} · NO LEADERBOARD`;
  // Mirror the wave readout into the right-panel dev block so the
  // tester can see it without looking up at the banner.
  const panelWaveEl = document.getElementById('sandbox-current-wave');
  if (panelWaveEl) panelWaveEl.textContent = `— ${wave}${phaseTag.replace(' · ', ' / ')} —`;
}

// ── WAVE PICKER MODAL ──
// 4x5 grid of W1-W20 buttons + ENDLESS button at the bottom.
function showWavePicker(hooks: SandboxPanelHooks): void {
  const existing = document.getElementById('sandbox-wave-picker');
  if (existing) { existing.remove(); return; }
  const modal = document.createElement('div');
  modal.id = 'sandbox-wave-picker';
  modal.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);z-index:230;font-family:"Courier New",monospace';
  const panel = document.createElement('div');
  panel.style.cssText = 'width:min(440px,94vw);padding:18px 22px;background:linear-gradient(180deg,#1a0820,#0c0410);border:3px solid #ff5cc8;color:#ffb3d9;box-shadow:0 0 32px rgba(255,92,200,0.5);max-height:92vh;overflow:auto';
  panel.innerHTML = `
    <div style="font-size:14px;letter-spacing:3px;font-weight:bold;color:#ff5cc8;margin-bottom:4px">▶ JUMP TO WAVE</div>
    <div style="font-size:10px;color:#aa6090;margin-bottom:14px;letter-spacing:1px">Hard reset: clears towers, enemies, projectiles. Fresh wave spawn.</div>`;
  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:14px';
  for (let w = 1; w <= 20; w++) {
    const b = document.createElement('button');
    b.textContent = `W${w}`;
    b.style.cssText = 'padding:8px 4px;background:#2a1a25;border:1px solid #5a3a4a;color:#ffb3d9;font-family:inherit;font-size:12px;font-weight:bold;letter-spacing:1px;cursor:pointer';
    b.onmouseenter = () => { b.style.background = '#3a2535'; b.style.borderColor = '#ff5cc8'; };
    b.onmouseleave = () => { b.style.background = '#2a1a25'; b.style.borderColor = '#5a3a4a'; };
    b.onclick = () => { hooks.onJumpToWave(w); modal.remove(); };
    grid.appendChild(b);
  }
  panel.appendChild(grid);

  const endless = document.createElement('button');
  endless.textContent = '∞ ENDLESS MODE';
  endless.style.cssText = 'width:100%;padding:10px;background:#1a0440;border:2px solid #c070ff;color:#c070ff;font-family:inherit;font-size:12px;font-weight:bold;letter-spacing:2px;cursor:pointer;margin-bottom:8px';
  endless.onmouseenter = () => { endless.style.background = '#2a0660'; };
  endless.onmouseleave = () => { endless.style.background = '#1a0440'; };
  endless.onclick = () => { hooks.onJumpToWave(-1); modal.remove(); };
  panel.appendChild(endless);

  const close = document.createElement('button');
  close.textContent = 'CANCEL';
  close.style.cssText = 'width:100%;padding:8px;background:#2a1a25;border:1px solid #5a3a4a;color:#aa6090;font-family:inherit;font-size:11px;letter-spacing:2px;cursor:pointer';
  close.onclick = () => modal.remove();
  panel.appendChild(close);

  modal.appendChild(panel);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

// ── TOWER PICKER MODAL ──
// Two-step: 1) pick a tower from the full list, 2) pick a tier T1-T5.
function showTowerPicker(hooks: SandboxPanelHooks): void {
  const existing = document.getElementById('sandbox-tower-picker');
  if (existing) { existing.remove(); return; }
  const modal = document.createElement('div');
  modal.id = 'sandbox-tower-picker';
  modal.style.cssText = 'position:fixed;inset:0;display:flex;align-items:flex-start;justify-content:center;background:rgba(0,0,0,0.6);z-index:230;font-family:"Courier New",monospace;padding:30px 12px;box-sizing:border-box;overflow:auto';
  const panel = document.createElement('div');
  panel.style.cssText = 'width:min(620px,96vw);padding:18px 22px;background:linear-gradient(180deg,#1a0820,#0c0410);border:3px solid #ff5cc8;color:#ffb3d9;box-shadow:0 0 32px rgba(255,92,200,0.5)';
  panel.innerHTML = `
    <div style="font-size:14px;letter-spacing:3px;font-weight:bold;color:#ff5cc8;margin-bottom:4px">+ SPAWN TOWER</div>
    <div style="font-size:10px;color:#aa6090;margin-bottom:10px;letter-spacing:1px">Click a tower, pick its tier, then click any empty tile to place. Free.</div>`;

  // Step 1: tower list
  const list = document.createElement('div');
  list.style.cssText = 'max-height:50vh;overflow:auto;border:1px solid #5a3a4a;background:#0c0410;padding:6px;margin-bottom:10px';
  const towers = sandboxAllTowerOptions();
  let currentTowerType: TowerType | null = null;
  const tierRowEl = document.createElement('div');
  for (const t of towers) {
    const row = document.createElement('button');
    row.style.cssText = 'display:flex;justify-content:space-between;width:100%;padding:5px 8px;margin-bottom:2px;background:#1a0820;border:1px solid #3a2535;color:#ffb3d9;font-family:inherit;font-size:11px;letter-spacing:1px;cursor:pointer;text-align:left';
    row.innerHTML = `<span>${t.name}</span><span style="color:${t.kind === 'COMBO' ? '#c070ff' : '#aa6090'};font-size:9px;letter-spacing:2px">${t.kind}</span>`;
    row.onmouseenter = () => { row.style.background = '#2a1a25'; };
    row.onmouseleave = () => { row.style.background = currentTowerType === t.type ? '#3a2535' : '#1a0820'; };
    row.onclick = () => {
      currentTowerType = t.type;
      // Highlight selected
      Array.from(list.children).forEach(c => ((c as HTMLElement).style.background = '#1a0820'));
      row.style.background = '#3a2535';
      // Render tier row
      tierRowEl.innerHTML = `<div style="font-size:11px;color:#cdb98a;margin-bottom:6px">Pick tier for <b style="color:#ff5cc8">${t.name}</b>:</div>`;
      const tierRow = document.createElement('div');
      tierRow.style.cssText = 'display:flex;gap:6px;justify-content:center';
      for (const tier of [1, 2, 3, 4, 5] as const) {
        const tb = document.createElement('button');
        tb.textContent = `T${tier}`;
        tb.style.cssText = 'flex:1;padding:8px;background:#1a0440;border:2px solid #c070ff;color:#c070ff;font-family:inherit;font-size:14px;font-weight:bold;letter-spacing:2px;cursor:pointer';
        tb.onmouseenter = () => { tb.style.background = '#2a0660'; };
        tb.onmouseleave = () => { tb.style.background = '#1a0440'; };
        tb.onclick = () => {
          hooks.onPickTower(t.type, tier);
          modal.remove();
        };
        tierRow.appendChild(tb);
      }
      tierRowEl.appendChild(tierRow);
    };
    list.appendChild(row);
  }
  panel.appendChild(list);
  panel.appendChild(tierRowEl);

  const close = document.createElement('button');
  close.textContent = 'CANCEL';
  close.style.cssText = 'width:100%;padding:8px;margin-top:10px;background:#2a1a25;border:1px solid #5a3a4a;color:#aa6090;font-family:inherit;font-size:11px;letter-spacing:2px;cursor:pointer';
  close.onclick = () => modal.remove();
  panel.appendChild(close);

  modal.appendChild(panel);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}
