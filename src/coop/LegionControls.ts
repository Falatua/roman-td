// ─────────────────────────────────────────────────────────────────────
// CO-OP LEGION — shared base-parity build controls.
//
// Adds the base Roman TD sidebar buttons that apply to a Legion board —
// UPGRADE POOL, TARGET ALL (with the same 7-mode picker), and PAUSE —
// wired to the REAL systems on a RomanBoard, with base labels/copy. Both
// the solo test harness and the multiplayer runtime mount this so their
// controls match single-player.
// ─────────────────────────────────────────────────────────────────────

import { TargetingMode } from '../types';
import type { RomanBoard } from './RomanBoard';

const MODES: { mode: TargetingMode; label: string; tip: string }[] = [
  { mode: TargetingMode.FIRST,   label: 'FIRST',   tip: 'Furthest along the path (closest to leaking)' },
  { mode: TargetingMode.LAST,    label: 'LAST',    tip: 'Earliest in the path (newest spawn)' },
  { mode: TargetingMode.STRONG,  label: 'STRONG',  tip: 'Highest HP — bosses get priority' },
  { mode: TargetingMode.WEAKEST, label: 'WEAKEST', tip: 'Lowest HP grunt — finisher mode' },
  { mode: TargetingMode.CLOSE,   label: 'CLOSE',   tip: 'Physically closest enemy' },
  { mode: TargetingMode.FLYERS,  label: 'FLYERS',  tip: 'Flyers first, then ground' },
  { mode: TargetingMode.FAST,    label: 'FAST',    tip: 'Highest current speed — catch sprinters' },
];

export interface BuildControls { refresh: () => void; }

/** Append PAUSE / UPGRADE POOL / TARGET ALL to `parent`, wired to `board`. */
export function mountBuildControls(parent: HTMLElement, board: RomanBoard): BuildControls {
  let curMode: TargetingMode = TargetingMode.FIRST; // matches createTower default

  const pauseBtn = mk('⏸ PAUSE', '#222', '#cdb98a');
  pauseBtn.title = 'Pause the wave.';
  pauseBtn.onclick = () => { board.paused = !board.paused; pauseBtn.textContent = board.paused ? '▶ RESUME' : '⏸ PAUSE'; };

  const poolBtn = mk('UPGRADE POOL', '#10243a', '#9fd0ff');
  poolBtn.title = 'Improve your tower-draw pool. Higher levels raise the odds of rolling rarer, stronger prospects.';
  poolBtn.onclick = () => { board.upgradePool(); refreshPool(); };

  // TARGET ALL + inline 7-mode picker (same modes/order as the base sidebar).
  const targetWrap = document.createElement('div');
  targetWrap.style.cssText = 'position:relative;display:inline-block';
  const targetBtn = mk('🎯 TARGET ALL · FIRST', '#3a1a2a', '#ffb3d9');
  targetBtn.title = 'Bulk-retarget EVERY placed tower at once. Pick a mode and all your towers switch to it.';
  const picker = document.createElement('div');
  picker.style.cssText = 'display:none;position:absolute;bottom:46px;left:0;background:#1a0f18;border:1px solid #5a3a4a;padding:6px;flex-direction:column;gap:4px;min-width:130px;z-index:40';
  MODES.forEach((m) => {
    const b = document.createElement('button');
    b.textContent = m.label; b.title = m.tip;
    b.style.cssText = 'background:#2a1a25;color:#ffb3d9;border:1px solid #5a3a4a;padding:5px 8px;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:1px;text-align:left';
    b.onclick = () => { curMode = m.mode; board.setAllTargeting(m.mode); targetBtn.textContent = '🎯 TARGET ALL · ' + m.label; paintPicker(); picker.style.display = 'none'; };
    picker.appendChild(b);
  });
  function paintPicker(): void {
    Array.from(picker.children).forEach((node, i) => {
      const el = node as HTMLElement;
      const active = MODES[i].mode === curMode;
      el.style.background = active ? '#3a5520' : '#2a1a25';
      el.style.color = active ? '#d4af37' : '#ffb3d9';
      el.textContent = (active ? '✓ ' : '') + MODES[i].label;
    });
  }
  targetBtn.onclick = () => { const open = picker.style.display !== 'none'; picker.style.display = open ? 'none' : 'flex'; if (!open) paintPicker(); };
  targetWrap.append(picker, targetBtn);

  function refreshPool(): void {
    const c = board.poolUpgradeCost();
    poolBtn.textContent = c == null ? `POOL L${board.state.poolLevel} · MAX` : `UPGRADE POOL · ${c}g`;
    const afford = c != null && board.state.gold >= c;
    poolBtn.style.opacity = (c == null || !afford) ? '0.55' : '1';
    poolBtn.style.cursor = (c == null || !afford) ? 'not-allowed' : 'pointer';
  }

  parent.append(pauseBtn, poolBtn, targetWrap);
  refreshPool();
  return { refresh: refreshPool };
}

function mk(label: string, bg: string, fg: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = `background:${bg};color:${fg};border:2px solid ${fg};border-radius:6px;padding:9px 14px;cursor:pointer;font-family:inherit;font-size:12px;letter-spacing:1px;font-weight:bold`;
  return b;
}
