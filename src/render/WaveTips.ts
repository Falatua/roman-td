// WaveTips — non-intrusive teaching tips that appear during the pre-wave
// phase for waves 1-6 only. Each tip covers one core concept (mazing,
// checkpoints, combinations, codex, wave brief, shop/Mercator). Players
// can collapse the tip body (caret) or permanently dismiss the tip for
// that wave (X). Dismissal persists across runs via localStorage.
//
// Positioning: top-center, just below the HUD chip. Deliberately chosen
// because:
//   - bottom-left is the wave brief
//   - bottom-center is the hero placement banner (W1)
//   - bottom-right is the Mercator tab (W4)
// Top-center is the one quadrant that has no existing UI during the
// pre-wave phase. z-index 55 sits BELOW the pre-wave-tip boss-warning
// modal (z=70) so when a big boss-prep popup appears it visually covers
// the small wave tip, no positioning conflict.
//
// Style intentionally borrows the dark-gold Courier language of the wave
// brief and Mercator tab so the player reads it as part of the same UI
// family, not a popup intrusion.

// 2026-05-24 — Initial cut covers W1-W6. Six tips, six topics, one tip
// per wave. Copy is short (≤2 short sentences), references in-game
// surfaces by their actual position so the player can find them.
interface WaveTip {
  wave: number;
  title: string;
  body: string;
  icon: string;
}

const TIPS: WaveTip[] = [
  {
    wave: 1,
    icon: '🧱',
    title: 'BUILD A MAZE',
    body: 'Force enemies to zig-zag. Place towers so the path winds back and forth between the cave and the gate instead of running straight through. Long paths = more shots per enemy.',
  },
  {
    wave: 2,
    icon: '🎯',
    title: 'MAZE THE CHECKPOINTS',
    body: 'Your highest-leverage move: stretch the path BETWEEN waypoint coins. Long runs between checkpoints means each enemy eats more shots while crossing your kill zone.',
  },
  {
    wave: 3,
    icon: '⚒',
    title: 'COMBINATIONS WIN RUNS',
    body: 'Three same-tier towers auto-merge into the next tier. Cross-tower recipes (e.g. Hastati + Sagittarius) unlock named combos that hit far harder than the singles.',
  },
  {
    wave: 4,
    icon: '📜',
    title: 'OPEN THE CODEX',
    body: 'Top-right corner. The COMBINATIONS tab lists every recipe — plan your build BEFORE the prospect roller hands you the wrong towers. LEGIONS tab shows raw DPS.',
  },
  {
    wave: 5,
    icon: '🛡',
    title: 'READ THE WAVE BRIEF',
    body: 'Bottom-left of the screen. Lists every threat coming this wave — flyers, bosses, faction resists, surprise events. Prep flyer-killers and siege BEFORE the boss waves (W5/10/15/20).',
  },
  {
    wave: 6,
    icon: '⚱',
    title: 'STOCK THE SHOP',
    body: 'Top-right SHOP button. Buy items between waves to fill tower slots — even commons add real damage. The MERCATOR (W4/9/14/19) sells T5 towers and trophies you can\'t get anywhere else.',
  },
];

const TIP_ID = 'wave-tip';
const STYLE_ID = 'wave-tip-style';
const DISMISSED_KEY = 'roman_td_wave_tips_dismissed_v1';
const COLLAPSED_KEY = 'roman_td_wave_tip_collapsed_v1';

function isWaveDismissed(wave: number): boolean {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return false;
    return raw.split(',').includes(String(wave));
  } catch { return false; }
}
function markWaveDismissed(wave: number): void {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY) ?? '';
    const set = new Set(raw ? raw.split(',') : []);
    set.add(String(wave));
    localStorage.setItem(DISMISSED_KEY, Array.from(set).join(','));
  } catch { /* ignore */ }
}
function isCollapsedPref(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
}
function setCollapsedPref(v: boolean): void {
  try { localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0'); } catch { /* ignore */ }
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
    @keyframes waveTipEnter {
      0%   { opacity: 0; transform: translateX(-50%) translateY(-8px); }
      100% { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    #${TIP_ID} {
      position: absolute;
      top: 90px;
      left: 50%;
      transform: translateX(-50%);
      width: min(380px, 78%);
      background: linear-gradient(180deg, rgba(26,20,16,0.92), rgba(12,10,8,0.92));
      border: 1.5px solid rgba(212,175,55,0.85);
      box-shadow: 0 4px 14px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.03);
      color: #e8d6a8;
      font-family: 'Courier New', monospace;
      font-size: 11.5px;
      z-index: 55;
      pointer-events: auto;
      animation: waveTipEnter 0.32s ease-out both;
    }
    #${TIP_ID}.is-collapsed { width: auto; }
    #${TIP_ID} .wt-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 5px 6px 5px 10px;
      background: linear-gradient(180deg, rgba(42,29,14,0.85), rgba(26,18,9,0.85));
      border-bottom: 1px solid rgba(212,175,55,0.35);
    }
    #${TIP_ID}.is-collapsed .wt-head { border-bottom: none; padding: 4px 5px 4px 9px; }
    #${TIP_ID} .wt-title {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 11px;
      letter-spacing: 2px;
      font-weight: bold;
      color: #ffd34d;
      text-shadow: 1px 1px 0 #000;
    }
    #${TIP_ID} .wt-icon { font-size: 14px; line-height: 1; }
    #${TIP_ID} .wt-controls { display: flex; gap: 3px; flex-shrink: 0; }
    #${TIP_ID} .wt-btn {
      background: rgba(0,0,0,0.25);
      border: 1px solid rgba(212,175,55,0.35);
      color: #cdb98a;
      font-family: inherit;
      font-size: 10px;
      line-height: 1;
      padding: 3px 6px;
      cursor: pointer;
      letter-spacing: 0;
      min-width: 22px;
    }
    #${TIP_ID} .wt-btn:hover {
      color: #ffd34d;
      border-color: #d4af37;
      background: rgba(212,175,55,0.10);
    }
    #${TIP_ID} .wt-body {
      padding: 8px 12px 10px;
      line-height: 1.5;
      color: #e8d6a8;
      font-size: 11px;
    }
    #${TIP_ID}.is-collapsed .wt-body { display: none; }
  `;
  document.head.appendChild(s);
}

/**
 * Per-frame call. Mounts the wave tip when the wave is in 1..6, the
 * player is in the pre-wave phase, and the tip for THIS wave hasn't
 * been permanently dismissed.
 *
 * No-op (and removes any existing tip) when the wave is past W6, the
 * combat phase has started, or the wave was previously X'd out.
 */
export function updateWaveTip(parent: HTMLElement, wave: number, isPreWave: boolean): void {
  const tip = TIPS.find(t => t.wave === wave);
  const shouldShow = isPreWave && !!tip && !isWaveDismissed(wave);
  const existing = document.getElementById(TIP_ID) as HTMLElement | null;
  if (!shouldShow) {
    if (existing) existing.remove();
    return;
  }
  // Same wave already mounted — leave it (avoids per-frame rebuild
  // erasing the user's mid-frame interaction state).
  if (existing && existing.dataset.wave === String(wave)) return;
  if (existing) existing.remove();
  ensureStyle();
  const startCollapsed = isCollapsedPref();
  const el = document.createElement('div');
  el.id = TIP_ID;
  el.dataset.wave = String(wave);
  if (startCollapsed) el.classList.add('is-collapsed');
  el.innerHTML = `
    <div class="wt-head">
      <div class="wt-title">
        <span class="wt-icon">${tip!.icon}</span>
        <span>W${wave} · ${tip!.title}</span>
      </div>
      <div class="wt-controls">
        <button class="wt-btn wt-collapse" title="Collapse / expand">${startCollapsed ? '▸' : '▾'}</button>
        <button class="wt-btn wt-close" title="Dismiss this tip permanently">✕</button>
      </div>
    </div>
    <div class="wt-body">${tip!.body}</div>
  `;
  const collapseBtn = el.querySelector('.wt-collapse') as HTMLButtonElement;
  const closeBtn = el.querySelector('.wt-close') as HTMLButtonElement;
  collapseBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const nowCollapsed = !el.classList.contains('is-collapsed');
    if (nowCollapsed) el.classList.add('is-collapsed');
    else el.classList.remove('is-collapsed');
    setCollapsedPref(nowCollapsed);
    collapseBtn.textContent = nowCollapsed ? '▸' : '▾';
  });
  closeBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    markWaveDismissed(wave);
    el.remove();
  });
  parent.appendChild(el);
}

export function hideWaveTip(): void {
  document.getElementById(TIP_ID)?.remove();
}
