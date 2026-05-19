// Hall of Glory — 1970s-arcade-style high-score leaderboard for Roman TD.
//
// Flow on game end:
//   1. showEndSummary(parent, state, won)          ← win/loss recap card
//   2. user presses CONTINUE / Enter
//   3. promptForName(parent)                       ← 12-char alphanumeric, profanity filtered
//   4. saveScore + showLeaderboard(parent, entry)  ← retro CRT high-score table
//
// Persistence: localStorage key `roman_td_leaderboard_v2` — array of entries.
// v2 bumped from v1 (2026-05) — user-requested full leaderboard reset. v1
// entries remain in localStorage but are never read; can be GC'd manually
// via `localStorage.removeItem('roman_td_leaderboard_v1')` if desired.
// Keeps top 20. New entry pulses; top 3 ranks render gold/silver/bronze.

import { GameStateShape } from '../GameState';
import { fetchTopScores, submitScore, toRemoteRow, hasRemoteLeaderboard, getLastFetchMeta } from '../services/SupabaseLeaderboard';

export interface ScoreBreakdown {
  waveBonus: number;       // waves completed
  killBonus: number;       // enemies defeated
  timeBonus: number;       // seconds survived
  efficiencyBonus: number; // fewer towers built = higher
  comboBonus: number;      // towers combined
  questBonus: number;      // quests completed
  rngBonus: number;        // bonus bosses killed + wave modifiers survived
  difficultyMult: number;  // 1.0 for Standard
  final: number;
}

export interface LeaderboardEntry {
  name: string;
  score: number;
  wave: number;
  won: boolean;
  questsCompleted: number;
  towersCombined: number;
  date: string;            // "September 13 2026"
  ts: number;              // ms epoch for tie-break ordering
}

const STORAGE_KEY = 'roman_td_leaderboard_v2';
// Also purge the old v1 entries on first load so they don't linger in
// the user's browser storage. Wrapped in try/catch since localStorage
// access can throw in incognito/strict-storage contexts.
try { localStorage.removeItem('roman_td_leaderboard_v1'); } catch { /* ignore */ }
const MAX_ENTRIES = 20;

// Profanity / vulgarity blocklist. Conservative — substring matched
// case-insensitively. Players who hit the filter are asked for a clean name.
const PROFANITY: string[] = [
  'fuck','shit','bitch','asshole','piss','dick','cunt','cock','pussy','tits',
  'whore','slut','bastard','damn','crap','fag','nigg','niger','wank','jerk',
  'twat','prick','arse','bollocks','spic','chink','kike','retard','rapist',
  'rape','hitler','nazi','kkk'
];

export function isProfane(name: string): boolean {
  const s = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!s) return false;
  for (const word of PROFANITY) {
    if (s.includes(word)) return true;
  }
  return false;
}

export function sanitizeName(input: string): string {
  return (input ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12).toUpperCase();
}

export function computeFinalScoreBreakdown(state: GameStateShape, won: boolean): ScoreBreakdown {
  // ── Score formula ──────────────────────────────────────────────────────
  //   waves completed     × 500    (W20 win = 10,000)
  //   total kills         × 5
  //   seconds survived    × 4      (5 min run ≈ 1,200)
  //   tower efficiency    = max(0, 5000 - towersBuilt * 80)  → fewer towers, bigger bonus
  //   combos built        × 150
  //   quests completed    × 250
  //   ── RNG-event bonuses (2026-05) ──
  //   bonus bosses killed × 2,500  (twin/ambush boss spawns — high reward)
  //   modifier waves      × 1,000  (Blood Moon / Storm Surge / etc. cleared)
  //   ──
  //   win bonus           + 8,000  (only if won)
  //   difficulty mult     × 1.0    (Standard) — multiplied at the end
  const waves       = Math.max(0, won ? state.wave : Math.max(0, state.wave - 1));
  const kills       = state.totalKills ?? 0;
  const startedAt   = state.runStartedAt ?? Date.now();
  const seconds     = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const towersBuilt = state.towersBuilt ?? 0;
  const combosBuilt = state.combosBuilt ?? 0;
  const quests      = (state.completedQuests ?? []).length;
  const bonusBosses = state.bonusBossesKilled ?? 0;
  const modWaves    = state.modifierWavesSurvived ?? 0;

  const waveBonus       = waves * 500;
  const killBonus       = kills * 5;
  const timeBonus       = seconds * 4;
  const efficiencyBonus = Math.max(0, 5000 - towersBuilt * 80);
  const comboBonus      = combosBuilt * 150;
  const questBonus      = quests * 250;
  const rngBonus        = bonusBosses * 2500 + modWaves * 1000;
  const winBonus        = won ? 8000 : 0;

  // Difficulty placeholder — game ships at Standard. Single source of truth
  // so a future setting can plug in without rewiring the formula.
  const difficultyMult = 1.0;

  const base = waveBonus + killBonus + timeBonus + efficiencyBonus + comboBonus + questBonus + rngBonus + winBonus;
  const final = Math.round(base * difficultyMult);
  return { waveBonus, killBonus, timeBonus, efficiencyBonus, comboBonus, questBonus, rngBonus, difficultyMult, final };
}

export function loadLeaderboard(): LeaderboardEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LeaderboardEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLeaderboard(entries: LeaderboardEntry[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES))); } catch { /* ignore */ }
}

export function insertEntry(entry: LeaderboardEntry): LeaderboardEntry[] {
  const list = loadLeaderboard();
  list.push(entry);
  list.sort((a, b) => b.score - a.score || a.ts - b.ts);
  const top = list.slice(0, MAX_ENTRIES);
  saveLeaderboard(top);
  return top;
}

function formatDateLong(d: Date): string {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${months[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
}
function formatDateShort(longDate: string): string {
  // "September 13 2026" → "Sep 13 2026"
  const parts = longDate.split(' ');
  if (parts.length < 3) return longDate;
  return `${parts[0].slice(0, 3)} ${parts[1]} ${parts[2]}`;
}

function roman(n: number): string {
  if (n <= 0) return '';
  const map: [number, string][] = [
    [1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],
    [100,'C'],[90,'XC'],[50,'L'],[40,'XL'],
    [10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']
  ];
  let out = '';
  for (const [v, s] of map) { while (n >= v) { out += s; n -= v; } }
  return out;
}

function ensureStyle() {
  if (document.getElementById('hall-of-glory-style')) return;
  const s = document.createElement('style');
  s.id = 'hall-of-glory-style';
  s.textContent = `
    @keyframes hogTitleFlicker {
      0%, 96%, 100% { opacity: 1; text-shadow: 0 0 12px #ffd34d, 0 0 22px #ffaa33, 2px 2px 0 #1a0808; }
      97% { opacity: 0.55; text-shadow: 0 0 6px #ffd34d; }
      98% { opacity: 0.92; }
      99% { opacity: 0.4; }
    }
    @keyframes hogPrompt {
      0%, 49%, 100% { opacity: 1; }
      50%, 99% { opacity: 0.15; }
    }
    @keyframes hogRowIn {
      0% { opacity: 0; transform: translateY(-14px); }
      60% { transform: translateY(4px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    @keyframes hogPulse {
      0%, 100% { background: #2a0d04; box-shadow: 0 0 12px rgba(255,170,51,0.4) inset; }
      50%      { background: #4a1a06; box-shadow: 0 0 22px rgba(255,211,77,0.8) inset; }
    }
    /* 2026-05-19 — RESPONSIVE PASS. Previously every dimension was
       fixed-px (44px title, 880px content max, 13px row text…), which
       left the leaderboard as a small cluster in the middle of a big
       monitor. All sizes now use clamp() so the leaderboard reads
       BIG on huge screens and still fits on small ones. */
    .hog-overlay {
      /* Mounted on document.body — position:fixed fills the REAL
         viewport on any monitor size, not the scaled #app box. */
      position: fixed; inset: 0; z-index: 200;
      background: radial-gradient(ellipse at center, #1a0808 0%, #0a0202 70%, #000 100%);
      color: #ffd34d; font-family: 'Courier New', monospace;
      display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
      padding: clamp(18px, 2vw, 36px) clamp(24px, 3vw, 48px);
      overflow: hidden;
    }
    .hog-scanlines {
      position: absolute; inset: 0; pointer-events: none;
      background: repeating-linear-gradient(
        to bottom,
        rgba(0,0,0,0) 0px,
        rgba(0,0,0,0) 2px,
        rgba(0,0,0,0.35) 2px,
        rgba(0,0,0,0.35) 3px
      );
      mix-blend-mode: multiply;
      z-index: 1;
    }
    .hog-vignette {
      position: absolute; inset: 0; pointer-events: none;
      background: radial-gradient(ellipse at center, rgba(0,0,0,0) 50%, rgba(0,0,0,0.85) 100%);
      z-index: 1;
    }
    .hog-content {
      position: relative; z-index: 2;
      width: min(1400px, 94vw);
      display: flex; flex-direction: column; align-items: center;
      gap: clamp(14px, 1.5vw, 26px);
      max-height: calc(100% - 36px);
    }
    .hog-title {
      font-size: clamp(44px, 7vw, 96px);
      letter-spacing: clamp(10px, 1.2vw, 18px);
      font-weight: 900;
      color: #ffd34d;
      text-shadow: 0 0 12px #ffd34d, 0 0 22px #ffaa33, 2px 2px 0 #1a0808;
      animation: hogTitleFlicker 4.6s infinite;
      text-align: center;
      padding: 4px 0;
    }
    .hog-subtitle {
      font-size: clamp(12px, 1.3vw, 22px);
      letter-spacing: clamp(6px, 0.7vw, 12px);
      color: #aa4a1a;
      text-shadow: 1px 1px 0 #000;
    }
    .hog-table {
      width: 100%; border-collapse: collapse;
      background: rgba(20,4,4,0.85);
      border: 2px solid #aa1a1a;
      box-shadow: 0 0 24px rgba(170,26,26,0.4), inset 0 0 30px rgba(0,0,0,0.7);
    }
    .hog-table thead th {
      font-size: clamp(11px, 1.1vw, 18px);
      letter-spacing: clamp(2px, 0.25vw, 4px);
      color: #aa6a1a;
      padding: clamp(8px, 0.9vw, 16px) clamp(10px, 1vw, 18px);
      border-bottom: 2px solid #aa1a1a;
      text-align: left; font-weight: 900;
      background: linear-gradient(180deg, #2a0808, #1a0404);
    }
    .hog-table thead th.num { text-align: right; }
    .hog-table tbody tr {
      animation: hogRowIn 0.45s ease-out both;
      border-bottom: 1px dashed rgba(170,26,26,0.3);
    }
    .hog-table tbody td {
      padding: clamp(9px, 1vw, 16px) clamp(10px, 1vw, 18px);
      font-size: clamp(13px, 1.4vw, 22px);
      font-weight: 900;
      letter-spacing: clamp(1px, 0.2vw, 3px);
      text-shadow: 1px 1px 0 #000;
    }
    .hog-table tbody td.num { text-align: right; }
    .hog-table tbody tr.you { animation: hogRowIn 0.45s ease-out both, hogPulse 1.2s ease-in-out infinite; }
    .hog-prompt {
      font-size: clamp(16px, 1.8vw, 28px);
      letter-spacing: clamp(5px, 0.6vw, 10px);
      font-weight: 900;
      color: #ffd34d; animation: hogPrompt 1.0s infinite;
      text-shadow: 0 0 8px #ffd34d, 2px 2px 0 #000;
      margin-top: 8px;
    }
    .hog-rank-1 { color: #ffd34d; }
    .hog-rank-2 { color: #d8d8d8; }
    .hog-rank-3 { color: #cd7f32; }
    .hog-rank-1 td:first-child::before { content: '🏛 '; }
    .hog-table-scroll {
      width: 100%; max-height: 60vh; overflow-y: auto;
      border: 2px solid #aa1a1a;
      scrollbar-width: thin; scrollbar-color: #aa1a1a #1a0404;
    }
    .hog-table-scroll table { border: 0; }
  `;
  document.head.appendChild(s);
}

// ─── End-of-game summary card (win/loss recap, count-up score) ──────────
export function showEndSummary(parent: HTMLElement, state: GameStateShape, won: boolean, onContinue: (finalScore: number) => void) {
  document.getElementById('end-summary')?.remove();
  ensureStyle();
  const breakdown = computeFinalScoreBreakdown(state, won);
  const kills = state.totalKills ?? 0;
  const seconds = Math.max(0, Math.floor((Date.now() - (state.runStartedAt ?? Date.now())) / 1000));
  const mins = Math.floor(seconds / 60), secs = seconds % 60;
  const timeStr = `${mins}m ${secs.toString().padStart(2, '0')}s`;

  const accent = won ? '#ffd34d' : '#ee2a2a';
  const heading = won ? 'ROMA AETERNA' : 'ROME HAS FALLEN';
  const sub = won ? 'THE GATES HELD' : 'THE GATES BROKE';

  const wrap = document.createElement('div');
  wrap.id = 'end-summary';
  // 2026-05-19 — Responsive clamping (Codex pattern).
  wrap.style.cssText = `position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;background:radial-gradient(circle,rgba(20,8,4,0.92),rgba(0,0,0,0.97));z-index:190;padding:16px 8px;box-sizing:border-box;overflow:auto;color:#ffd34d;font-family:'Courier New',monospace;`;
  wrap.innerHTML = `
    <div style="text-align:center;padding:28px 36px;background:#0a0202;border:3px solid ${accent};box-shadow:0 0 36px ${accent}88;width:min(520px,94vw);position:relative">
      <div style="font-size:34px;letter-spacing:8px;color:${accent};text-shadow:0 0 14px ${accent},3px 3px 0 #000;font-weight:900">${heading}</div>
      <div style="font-size:12px;letter-spacing:4px;color:#aa6a1a;margin-top:4px">${sub}</div>
      <div style="margin:22px 0 6px;font-size:11px;letter-spacing:4px;color:#aa6a1a">FINAL SCORE</div>
      <div id="end-score-num" style="font-size:54px;letter-spacing:6px;color:#ffd34d;font-weight:900;text-shadow:0 0 18px #ffd34d,3px 3px 0 #000">0</div>
      <div style="margin-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:8px 18px;font-size:13px;color:#fff8e0;text-align:left;font-weight:900;text-shadow:1px 1px 0 #000">
        <div>Wave reached: <span style="color:${accent}">${state.wave}/20</span></div>
        <div>Enemies defeated: <span style="color:${accent}">${kills}</span></div>
        <div>Time survived: <span style="color:${accent}">${timeStr}</span></div>
        <div>Towers built: <span style="color:${accent}">${state.towersBuilt ?? 0}</span></div>
        <div>Combos forged: <span style="color:${accent}">${state.combosBuilt ?? 0}</span></div>
        <div>Quests cleared: <span style="color:${accent}">${(state.completedQuests ?? []).length}</span></div>
      </div>
      ${(breakdown.rngBonus > 0) ? `
      <div style="margin-top:14px;padding:10px 14px;background:linear-gradient(180deg,rgba(170,74,26,0.18),rgba(0,0,0,0.4));border:2px solid #ffaa33;text-align:left">
        <div style="font-size:10px;letter-spacing:3px;color:#ffaa33;font-weight:900;margin-bottom:6px">★ RNG MASTERY BONUS ★</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;font-size:12px;color:#fff8e0;font-weight:900;text-shadow:1px 1px 0 #000">
          <div>Bonus bosses killed: <span style="color:#ffaa33">${state.bonusBossesKilled ?? 0}</span></div>
          <div>Modifier waves cleared: <span style="color:#ffaa33">${state.modifierWavesSurvived ?? 0}</span></div>
          <div style="grid-column:1 / -1;color:#88ff88;text-align:right">+${breakdown.rngBonus.toLocaleString()} score</div>
        </div>
      </div>` : ''}
      <button id="end-continue" style="margin-top:26px;background:linear-gradient(180deg,${accent},#4a2a08);color:#1a0808;border:3px solid #fff8e0;padding:12px 32px;font-family:inherit;font-size:15px;letter-spacing:4px;cursor:pointer;font-weight:900;box-shadow:0 0 20px ${accent}aa">CONTINUE ▸</button>
      <div style="margin-top:10px;font-size:10px;letter-spacing:3px;color:#aa6a1a">PRESS ENTER</div>
    </div>`;
  parent.appendChild(wrap);

  // Count-up score animation
  const target = breakdown.final;
  const numEl = wrap.querySelector('#end-score-num') as HTMLElement;
  const duration = 1400;
  const start = performance.now();
  function tick(now: number) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const v = Math.round(eased * target);
    numEl.textContent = v.toLocaleString();
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  const finish = () => {
    wrap.remove();
    onContinue(breakdown.final);
  };
  (wrap.querySelector('#end-continue') as HTMLButtonElement).onclick = finish;
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Enter' || ev.key === ' ') { document.removeEventListener('keydown', onKey); finish(); }
  };
  document.addEventListener('keydown', onKey);
}

// ─── Name prompt — alphanumeric, max 12, profanity-blocked ──────────────
export function promptForName(parent: HTMLElement, defaultName: string, onSubmit: (name: string) => void) {
  document.getElementById('name-prompt')?.remove();
  ensureStyle();
  const wrap = document.createElement('div');
  wrap.id = 'name-prompt';
  // 2026-05-19 — Responsive clamping (Codex pattern).
  wrap.style.cssText = `position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;background:rgba(0,0,0,0.85);z-index:195;padding:16px 8px;box-sizing:border-box;overflow:auto;color:#ffd34d;font-family:'Courier New',monospace;`;
  wrap.innerHTML = `
    <div style="background:#0a0202;border:3px solid #ffd34d;box-shadow:0 0 30px rgba(255,211,77,0.5);padding:28px 36px;text-align:center;width:min(420px,94vw);position:relative">
      <div style="font-size:18px;letter-spacing:5px;color:#ffd34d;text-shadow:0 0 10px #ffd34d,2px 2px 0 #000;font-weight:900;margin-bottom:10px">ENTER YOUR NAME</div>
      <div style="font-size:11px;letter-spacing:2px;color:#aa6a1a;margin-bottom:18px">A-Z, 0-9 only · max 12 characters</div>
      <input id="name-input" maxlength="12" autocomplete="off" style="width:100%;background:#1a0404;border:2px solid #aa1a1a;color:#ffd34d;font-family:inherit;font-size:22px;letter-spacing:6px;text-align:center;padding:10px 12px;font-weight:900;text-transform:uppercase;text-shadow:0 0 6px #ffd34d,1px 1px 0 #000;outline:none">
      <div id="name-error" style="min-height:18px;margin-top:8px;font-size:11px;letter-spacing:2px;color:#ee5050;text-shadow:1px 1px 0 #000"></div>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:10px">
        <button id="name-submit" style="background:linear-gradient(180deg,#ffd34d,#7a4a08);color:#1a0808;border:3px solid #fff8e0;padding:10px 22px;font-family:inherit;font-size:13px;letter-spacing:3px;cursor:pointer;font-weight:900">SUBMIT</button>
        <button id="name-skip" style="background:linear-gradient(180deg,#3a3a3a,#1a1a1a);color:#aa9a4a;border:2px solid #5a4a30;padding:10px 22px;font-family:inherit;font-size:13px;letter-spacing:3px;cursor:pointer;font-weight:900">SKIP (${defaultName})</button>
      </div>
    </div>`;
  parent.appendChild(wrap);
  const input = wrap.querySelector('#name-input') as HTMLInputElement;
  const errEl = wrap.querySelector('#name-error') as HTMLElement;
  setTimeout(() => input.focus(), 30);

  // Real-time alphanumeric filter — strips disallowed characters as the
  // player types so they only ever see legal input.
  input.addEventListener('input', () => {
    const cleaned = sanitizeName(input.value);
    if (cleaned !== input.value) input.value = cleaned;
    errEl.textContent = '';
  });

  const submit = () => {
    const raw = sanitizeName(input.value);
    if (!raw) { onSubmit(defaultName); wrap.remove(); return; }
    if (isProfane(raw)) {
      errEl.textContent = '⚠ Choose another name. That word is blocked.';
      input.value = '';
      input.focus();
      return;
    }
    wrap.remove();
    onSubmit(raw);
  };
  const skip = () => { wrap.remove(); onSubmit(defaultName); };
  (wrap.querySelector('#name-submit') as HTMLButtonElement).onclick = submit;
  (wrap.querySelector('#name-skip') as HTMLButtonElement).onclick = skip;
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') submit();
    if (ev.key === 'Escape') skip();
  });
}

// ─── Hall of Glory — full leaderboard screen ────────────────────────────
// 2026-05-19 — Supports a GLOBAL view (Supabase top-N if env vars are
// configured) alongside the LOCAL view (always available via
// localStorage). A LOCAL / GLOBAL tab switch sits above the table so
// the player can flip between their own history and the world ranking.
//
// `opts.loadingMode`: when TRUE, the leaderboard was opened from the
// pre-game loading screen instead of post-run. In that case the
// bottom controls become "ENTER THE GAME" + "← BACK TO COIN SLOT" so
// the player can either commit to playing or return to the loading
// screen. `onRestart` is repurposed as the enter-game callback in
// this mode.
export function showLeaderboard(
  parent: HTMLElement,
  currentEntry: LeaderboardEntry | null,
  onRestart: () => void,
  opts?: { loadingMode?: boolean; onBack?: () => void }
) {
  const isLoadingMode = !!opts?.loadingMode;
  document.getElementById('hall-of-glory')?.remove();
  ensureStyle();
  const entries = loadLeaderboard();
  const remoteAvailable = hasRemoteLeaderboard();

  const wrap = document.createElement('div');
  wrap.id = 'hall-of-glory';
  wrap.className = 'hog-overlay';
  // Tab strip is conditional: if no Supabase config, no tabs (LOCAL only).
  const tabsHtml = remoteAvailable
    ? `<div id="hog-tabs" style="display:flex;justify-content:center;gap:8px;margin:8px 0 12px;font-family:'Courier New',monospace">
         <button id="hog-tab-global" data-active="1" style="background:#ffd34d;color:#1a1410;border:2px solid #ffd34d;padding:8px 18px;letter-spacing:3px;font-weight:bold;cursor:pointer;font-family:inherit">🌐 GLOBAL</button>
         <button id="hog-tab-local"  data-active="0" style="background:transparent;color:#ffd34d;border:2px solid #ffd34d;padding:8px 18px;letter-spacing:3px;font-weight:bold;cursor:pointer;font-family:inherit">📜 LOCAL (this device)</button>
       </div>`
    : `<div style="text-align:center;color:#aa6a1a;letter-spacing:2px;font-size:10px;margin:6px 0 10px">— local scores only · global leaderboard offline —</div>`;
  wrap.innerHTML = `
    <div class="hog-scanlines"></div>
    <div class="hog-vignette"></div>
    <div class="hog-content">
      <div class="hog-title">HALL OF GLORY</div>
      <div class="hog-subtitle" id="hog-subtitle">TOP X LEGIONS OF ROMA</div>
      ${tabsHtml}
      <div class="hog-table-scroll">
        <table class="hog-table">
          <thead>
            <tr>
              <th style="width:54px">RANK</th>
              <th>NAME</th>
              <th class="num">SCORE</th>
              <th>WAVE</th>
              <th class="num">COMBOS</th>
              <th class="num">QUESTS</th>
              <th>W/L</th>
              <th>DATE</th>
            </tr>
          </thead>
          <tbody id="hog-tbody"></tbody>
        </table>
      </div>
      ${isLoadingMode
        ? `<div style="display:flex;flex-direction:column;align-items:center;gap:clamp(10px,1vw,18px);margin-top:clamp(8px,1vw,16px)">
             <div class="hog-prompt">▶ PRESS ENTER TO BEGIN YOUR RUN ▶</div>
             <button id="hog-back-to-loading" type="button" style="background:transparent;border:1px solid #5a4a30;color:#aa9a4a;font-family:'Courier New',monospace;font-size:clamp(10px,0.9vw,14px);letter-spacing:clamp(2px,0.3vw,4px);font-weight:bold;padding:clamp(7px,0.8vw,11px) clamp(14px,1.5vw,22px);cursor:pointer;text-shadow:1px 1px 0 #000">← BACK TO COIN SLOT</button>
           </div>`
        : `<div class="hog-prompt">▶ PRESS ENTER TO PLAY AGAIN ◀</div>`}
    </div>`;
  // 2026-05-19 — Mount the Hall of Glory directly on document.body
  // instead of inside the scaled #app container. This lets the
  // leaderboard fill the actual VIEWPORT instead of being constrained
  // to #app's natural ~900px height + then scaled — on a big monitor
  // the previous setup left the content as a small cluster in the
  // middle of a huge dark frame. Now `position: fixed; inset: 0` in
  // the .hog-overlay CSS works as expected: full viewport coverage.
  document.body.appendChild(wrap);

  const tbody = wrap.querySelector('#hog-tbody') as HTMLElement;
  const subtitle = wrap.querySelector('#hog-subtitle') as HTMLElement;

  // Painter helper — renders either local or remote entries into the
  // shared table body. Both paths use the same row shape so the visual
  // is identical apart from the "◀ YOU" badge (only local can match).
  function paintLocalRows() {
    subtitle.textContent = `TOP ${Math.min(entries.length, 20)} LEGIONS OF ROMA · LOCAL`;
    if (entries.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:#aa6a1a;letter-spacing:3px">— THE HALL AWAITS ITS FIRST CHAMPION —</td></tr>`;
      return;
    }
    tbody.innerHTML = '';
    entries.forEach((e, idx) => {
      const rankNumeral = roman(idx + 1);
      const isYou = !!currentEntry &&
        e.name === currentEntry.name &&
        e.score === currentEntry.score &&
        e.ts === currentEntry.ts;
      const rankClass = idx === 0 ? 'hog-rank-1' : idx === 1 ? 'hog-rank-2' : idx === 2 ? 'hog-rank-3' : '';
      const youClass = isYou ? 'you' : '';
      const wlBadge = e.won
        ? '<span style="color:#88ff88;font-weight:900">W</span>'
        : '<span style="color:#ee5050;font-weight:900">L</span>';
      const tr = document.createElement('tr');
      tr.className = [rankClass, youClass].filter(Boolean).join(' ');
      tr.style.animationDelay = `${idx * 0.06}s`;
      tr.innerHTML = `
        <td class="${rankClass}">${rankNumeral}</td>
        <td class="${rankClass}">${e.name}${isYou ? ' <span style="color:#ffd34d">◀ YOU</span>' : ''}</td>
        <td class="num ${rankClass}">${e.score.toLocaleString()}</td>
        <td class="${rankClass}">Wave ${e.wave}</td>
        <td class="num ${rankClass}">${e.towersCombined}</td>
        <td class="num ${rankClass}">${e.questsCompleted}</td>
        <td class="${rankClass}">${wlBadge}</td>
        <td class="${rankClass}">${formatDateShort(e.date)}</td>`;
      tbody.appendChild(tr);
    });
  }

  // Tracks the currently-active tab so the auto-refresh poller only
  // re-paints the GLOBAL view (and stops painting if the player has
  // switched to LOCAL or closed the modal entirely).
  let activeTab: 'global' | 'local' = remoteAvailable ? 'global' : 'local';

  // 2026-05-19 — Prevent overlapping fetch chains. The 6s timeout × 3
  // retries can take ~18s total. The 15s auto-refresh timer was
  // firing a SECOND chain mid-flight, causing UI flicker and possibly
  // confusing the user about which retry was current. Guard with a
  // simple in-flight flag.
  let remotePaintInFlight = false;

  async function paintRemoteRows() {
    if (remotePaintInFlight) return;
    remotePaintInFlight = true;
    try {
      subtitle.textContent = '🌐 FETCHING GLOBAL LEADERBOARD…';
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:#aa6a1a;letter-spacing:3px">— LOADING —</td></tr>`;
      const rows = await fetchTopScores('campaign', 10);
      const meta = getLastFetchMeta();
      // If the player has switched tabs while we were fetching, don't
      // overwrite their current view.
      if (activeTab !== 'global') return;
      // Four distinct states get four distinct copy treatments so the
      // player can always tell what's happening:
      //   • 'failed'  → both fetch + cache failed (truly offline)
      //   • 'cached'  → fetch failed BUT we have a recent snapshot
      //   • 'empty'   → fetch succeeded, table has no entries yet
      //   • 'fresh'   → live data, table has scores → normal render
      if (rows === null) {
        // 2026-05-19 — DIAGNOSTIC SURFACE. The previous UI showed a
        // generic "cannot reach" message and the player had no way to
        // self-diagnose. Now we show the classified error reason
        // (extension-blocked, timeout, auth rejected, server error)
        // plus the raw error string. If the reason mentions an ad-
        // blocker, the player can disable it and retry without
        // contacting support.
        subtitle.textContent = '🌐 GLOBAL LEADERBOARD · OFFLINE FOR NOW';
        const reason = meta?.errorReason ?? 'Cannot reach the global leaderboard right now.';
        const detail = meta?.errorDetail ? `<div style="font-size:10px;color:#5a8a8a;margin-top:6px;letter-spacing:0;font-family:'Courier New',monospace;background:#0c1010;padding:6px 8px;border:1px solid #1a2424">${meta.errorDetail.replace(/</g, '&lt;')}</div>` : '';
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:left;padding:24px 32px;color:#aa9a4a;letter-spacing:0.5px;line-height:1.7">
          <div style="font-size:13px;color:#ffd34d;letter-spacing:2px;text-align:center;margin-bottom:10px;font-weight:bold">⚠ GLOBAL LEADERBOARD UNREACHABLE</div>
          <div style="font-size:12px;color:#cdb98a;margin-bottom:8px">${reason}</div>
          ${detail}
          <div style="font-size:10px;color:#5a7a7a;margin-top:10px;text-align:center">Your scores are still being saved locally — check the 📜 LOCAL tab. We auto-retry every 15 seconds.</div>
          <div style="text-align:center;margin-top:12px"><button id="hog-retry-now" style="background:#3a2a14;color:#ffd34d;border:2px solid #d4af37;padding:8px 16px;font-family:inherit;font-size:11px;letter-spacing:2px;font-weight:bold;cursor:pointer">↻ RETRY NOW</button></div>
        </td></tr>`;
        const retryBtn = wrap.querySelector('#hog-retry-now') as HTMLButtonElement | null;
        if (retryBtn) retryBtn.onclick = () => paintRemoteRows();
        return;
      }
    if (rows.length === 0) {
      subtitle.textContent = '🌐 GLOBAL LEADERBOARD · WAITING FOR THE FIRST CONQUEROR';
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:#88ff88;letter-spacing:1px;line-height:1.7"><div style="font-size:14px;color:#88ff88;letter-spacing:3px;font-weight:bold;margin-bottom:8px">🏛 NO NAMES IN THE MARBLE YET 🏛</div><div style="font-size:11px;color:#cdb98a">Survive a wave — even one — and your name will be the first the Empire records.</div></td></tr>`;
      return;
    }
    // Cached fallback path — show the data we have, but mark it.
    const isCached = meta?.source === 'cached';
    if (isCached && meta?.cacheAgeMs !== undefined) {
      const ageMin = Math.max(1, Math.round(meta.cacheAgeMs / 60000));
      subtitle.textContent = `🌐 TOP ${rows.length} · CACHED (${ageMin}m ago) · auto-retry…`;
    } else {
      subtitle.textContent = `🌐 TOP ${rows.length} LEGIONS OF ROMA · GLOBAL`;
    }
    tbody.innerHTML = '';
    rows.forEach((e, idx) => {
      const rankNumeral = roman(idx + 1);
      const rankClass = idx === 0 ? 'hog-rank-1' : idx === 1 ? 'hog-rank-2' : idx === 2 ? 'hog-rank-3' : '';
      const wlBadge = e.won
        ? '<span style="color:#88ff88;font-weight:900">W</span>'
        : '<span style="color:#ee5050;font-weight:900">L</span>';
      const tr = document.createElement('tr');
      tr.className = rankClass;
      tr.style.animationDelay = `${idx * 0.06}s`;
      tr.innerHTML = `
        <td class="${rankClass}">${rankNumeral}</td>
        <td class="${rankClass}">${e.name}</td>
        <td class="num ${rankClass}">${e.score.toLocaleString()}</td>
        <td class="${rankClass}">Wave ${e.wave}</td>
        <td class="num ${rankClass}">${e.towers_combined}</td>
        <td class="num ${rankClass}">${e.quests_completed}</td>
        <td class="${rankClass}">${wlBadge}</td>
        <td class="${rankClass}">${formatDateShort(e.date_str)}</td>`;
      tbody.appendChild(tr);
    });
    } finally {
      remotePaintInFlight = false;
    }
  }

  // ─── AUTO-REFRESH (2026-05-19) ────────────────────────────────────
  // Poll the global leaderboard every 15 seconds while the GLOBAL tab
  // is active. Also re-fetch immediately when the player switches back
  // to the tab (visibilitychange). Both are scoped to this modal —
  // when the player closes the leaderboard, the interval + listener
  // are removed so we don't leak handlers.
  let pollTimer: number | null = null;
  const onVisibility = () => {
    if (!document.hidden && activeTab === 'global') paintRemoteRows();
  };
  function startAutoRefresh() {
    stopAutoRefresh();
    pollTimer = window.setInterval(() => {
      if (activeTab === 'global' && !document.hidden) paintRemoteRows();
    }, 15000);
    document.addEventListener('visibilitychange', onVisibility);
  }
  function stopAutoRefresh() {
    if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
    document.removeEventListener('visibilitychange', onVisibility);
  }

  // Initial paint — global is default when remote is configured.
  if (remoteAvailable) {
    paintRemoteRows();
    startAutoRefresh();
    const globalBtn = wrap.querySelector('#hog-tab-global') as HTMLButtonElement;
    const localBtn  = wrap.querySelector('#hog-tab-local')  as HTMLButtonElement;
    const setActive = (which: 'global' | 'local') => {
      activeTab = which;
      const a = which === 'global' ? globalBtn : localBtn;
      const b = which === 'global' ? localBtn  : globalBtn;
      a.style.background = '#ffd34d'; a.style.color = '#1a1410'; a.dataset.active = '1';
      b.style.background = 'transparent'; b.style.color = '#ffd34d'; b.dataset.active = '0';
    };
    globalBtn.onclick = () => { setActive('global'); paintRemoteRows(); };
    localBtn.onclick  = () => { setActive('local');  paintLocalRows(); };
  } else {
    paintLocalRows();
  }

  // ENTER → restart (post-game) OR commit-to-game (loading-mode).
  // Click anywhere on the prompt area also triggers it.
  const restart = () => {
    stopAutoRefresh();
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    onRestart();
  };
  const promptEl = wrap.querySelector('.hog-prompt') as HTMLElement;
  promptEl.style.cursor = 'pointer';
  promptEl.addEventListener('click', restart);
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Enter') restart();
  };
  document.addEventListener('keydown', onKey);
  // 2026-05-19 — In loading mode, the "← BACK TO COIN SLOT" button
  // closes the leaderboard without firing onRestart (which would
  // commit-to-game). Falls back to wrap.remove() so the loading
  // screen sitting underneath becomes interactive again.
  if (isLoadingMode) {
    const backBtn = wrap.querySelector('#hog-back-to-loading') as HTMLButtonElement | null;
    if (backBtn) {
      backBtn.onclick = () => {
        stopAutoRefresh();
        wrap.remove();
        document.removeEventListener('keydown', onKey);
        if (opts?.onBack) opts.onBack();
      };
    }
  }
}

// ─── Convenience: full end-of-game flow (summary → name → leaderboard) ─
// 2026-05 v10: on a victory, after the player commits their name and the
// W20 entry is saved, fire `onPostVictory(name)` instead of dropping
// them into the static leaderboard. Used to chain into Endless mode —
// the leaderboard view is still available via main-menu navigation but
// is NOT the prompt the player sees the moment they beat W20.
export function runEndOfGameFlow(
  parent: HTMLElement,
  state: GameStateShape,
  won: boolean,
  onRestart: () => void,
  onPostVictory?: (name: string) => void
) {
  showEndSummary(parent, state, won, (finalScore) => {
    // The player ALWAYS sets a name in the "etch your name in the history
    // of Rome" cold-start modal before they can start playing, and that
    // name persists in localStorage across sessions. So by the time we
    // reach end-of-run we already know what to record — no second prompt
    // needed. The leaderboard inserts silently and we jump straight to
    // the Hall of Glory with the player's score on the board.
    const savedName: string = ((state as any).playerName ?? '').trim().toUpperCase() || 'UNKNOWN';

    // Build + commit the entry. Local first (source of truth on this
    // device), then AWAIT the remote submit before opening the
    // leaderboard. The previous fire-and-forget had a race condition:
    // showLeaderboard's first fetch could fire BEFORE the player's
    // submit landed on Supabase, so the player wouldn't see their own
    // score on the global tab for ~10-20 seconds. Awaiting closes
    // that gap — by the time we open the leaderboard, the submit has
    // either succeeded (player visible immediately) or its 3 retries
    // have exhausted (the offline diagnostic kicks in instead).
    const finalize = async (name: string) => {
      const entry: LeaderboardEntry = {
        name: name || 'UNKNOWN',
        score: finalScore,
        wave: state.wave,
        won,
        questsCompleted: (state.completedQuests ?? []).length,
        towersCombined: state.combosBuilt ?? 0,
        date: formatDateLong(new Date()),
        ts: Date.now()
      };
      // SANDBOX: skip the local insertEntry too. Dev-mode runs never
      // pollute the local leaderboard so the player's real-mode
      // records stay clean. The "submitting…" overlay still shows
      // briefly below so the post-victory flow looks the same.
      if (!(state as any).sandboxMode) {
        insertEntry(entry);
      }
      // Show a brief "submitting…" overlay while we wait for the
      // remote write. Up to 3 retries × 6s = 18s in the worst case.
      const overlay = document.createElement('div');
      overlay.id = 'submit-score-overlay';
      overlay.style.cssText = `position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.55);z-index:210;font-family:'Courier New',monospace;color:#ffd34d;`;
      overlay.innerHTML = `
        <div style="text-align:center;padding:22px 32px;background:#0a0202;border:3px solid #d4af37;box-shadow:0 0 28px rgba(212,175,55,0.55)">
          <div style="font-size:14px;letter-spacing:4px;font-weight:bold;margin-bottom:8px">📜 SUBMITTING SCORE TO THE EMPIRE…</div>
          <div style="font-size:11px;color:#aa9a4a;letter-spacing:2px">${name || 'UNKNOWN'} · ${finalScore.toLocaleString()} pts</div>
        </div>`;
      document.body.appendChild(overlay);
      // SANDBOX: never submit dev-test scores to the global leaderboard.
      // The whole point of sandbox mode is risk-free testing — a score
      // earned by jumping to W20 with 999k gold and free T5 towers
      // would pollute the Hall of Glory. The local insertEntry above
      // also gets reverted below so even the local board stays clean.
      const sandbox = !!(state as any).sandboxMode;
      if (!sandbox) {
        try {
          await submitScore(toRemoteRow(entry, 'campaign'));
        } catch (err) {
          console.error('[leaderboard] submit threw:', err);
        }
      }
      overlay.remove();
      // If a post-victory hook is wired (Endless transition), invoke it
      // INSTEAD of showing the static leaderboard. The leaderboard is
      // still reachable from the main menu after the run ends.
      if (won && onPostVictory) {
        onPostVictory(entry.name);
        return;
      }
      showLeaderboard(parent, entry, onRestart);
    };

    // Safety fallback: if somehow the player has no saved name (cleared
    // localStorage mid-run, etc.), fall back to the legacy prompt so
    // their score still gets attributed instead of vanishing as
    // "UNKNOWN". In the normal flow this branch is skipped.
    if (savedName === 'UNKNOWN') {
      promptForName(parent, savedName, finalize);
    } else {
      finalize(savedName);
    }
  });
}

// ─── ENDLESS LEADERBOARD (2026-05 v10) ─────────────────────────────────
// Separate storage key + entry shape. Endless entries track:
//   • name
//   • endless wave reached (when they ran out of lives)
//   • cumulative endless score
//   • timestamp + date string for sorting
const ENDLESS_STORAGE_KEY = 'roman_td_endless_leaderboard_v1';
export interface EndlessLeaderboardEntry {
  name: string;
  endlessWave: number;
  endlessScore: number;
  date: string;
  ts: number;
}
export function loadEndlessLeaderboard(): EndlessLeaderboardEntry[] {
  try {
    const raw = localStorage.getItem(ENDLESS_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
export function saveEndlessLeaderboard(entries: EndlessLeaderboardEntry[]) {
  try { localStorage.setItem(ENDLESS_STORAGE_KEY, JSON.stringify(entries.slice(0, 50))); } catch { /* ignore */ }
}
export function insertEndlessEntry(entry: EndlessLeaderboardEntry): EndlessLeaderboardEntry[] {
  const all = loadEndlessLeaderboard();
  all.push(entry);
  all.sort((a, b) => b.endlessScore - a.endlessScore);
  saveEndlessLeaderboard(all);
  return all;
}

// Show the Endless leaderboard as a styled panel. Mirrors the main
// leaderboard look so the player feels the same arcade vibe but knows
// they're in the chaos-mode hall of fame.
export function showEndlessLeaderboard(parent: HTMLElement, currentEntry: EndlessLeaderboardEntry | null, onRestart: () => void) {
  const all = loadEndlessLeaderboard();
  const top = all.slice(0, 15);
  document.getElementById('endless-leaderboard')?.remove();
  const modal = document.createElement('div');
  modal.id = 'endless-leaderboard';
  // 2026-05-19 — Responsive clamping (Codex pattern).
  modal.style.cssText = `position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;background:rgba(0,0,0,0.85);z-index:200;padding:16px 8px;box-sizing:border-box;overflow:auto;font-family:'Courier New',monospace`;
  const panel = document.createElement('div');
  panel.style.cssText = `width:min(640px,94vw);background:linear-gradient(180deg,#1a0c14,#0c0608);border:3px solid #ff5050;padding:24px;color:#fff8e0;box-shadow:0 0 40px rgba(255,80,80,0.55)`;
  let rows = '';
  for (let i = 0; i < top.length; i++) {
    const e = top[i];
    const isYou = currentEntry && e.ts === currentEntry.ts;
    rows += `<tr style="${isYou ? 'background:rgba(255,210,77,0.18);color:#ffd34d;font-weight:bold' : ''}">
      <td style="padding:5px 8px;text-align:center">${i + 1}</td>
      <td style="padding:5px 8px">${e.name}</td>
      <td style="padding:5px 8px;text-align:right">${e.endlessScore.toLocaleString()}</td>
      <td style="padding:5px 8px;text-align:center">E${e.endlessWave}</td>
      <td style="padding:5px 8px;text-align:right;color:#aa9a4a;font-size:10px">${e.date}</td>
    </tr>`;
  }
  if (top.length === 0) rows = `<tr><td colspan="5" style="padding:20px;text-align:center;color:#aa9a4a">No Endless runs yet. Be the first.</td></tr>`;
  panel.innerHTML = `
    <div style="font-size:18px;letter-spacing:4px;color:#ff5050;font-weight:bold;text-align:center;margin-bottom:6px">⚔ ENDLESS HALL OF MAYHEM ⚔</div>
    <div style="font-size:11px;color:#cdb98a;text-align:center;margin-bottom:18px">Scored by cumulative endless wave clear value. Top 15 shown.</div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;background:#0c0608">
      <thead><tr style="border-bottom:2px solid #ff5050">
        <th style="padding:6px 8px;text-align:center;color:#ff5050">#</th>
        <th style="padding:6px 8px;text-align:left;color:#ff5050">Name</th>
        <th style="padding:6px 8px;text-align:right;color:#ff5050">Endless Score</th>
        <th style="padding:6px 8px;text-align:center;color:#ff5050">Wave</th>
        <th style="padding:6px 8px;text-align:right;color:#ff5050">Date</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="margin-top:22px;display:flex;justify-content:center">
      <button id="endless-leaderboard-close" style="padding:10px 28px;background:linear-gradient(180deg,#ff5050,#aa1a1a);color:#fff;border:2px solid #ff7777;font-family:inherit;font-size:13px;letter-spacing:3px;font-weight:bold;cursor:pointer">PLAY AGAIN</button>
    </div>
  `;
  modal.appendChild(panel);
  parent.appendChild(modal);
  panel.querySelector<HTMLButtonElement>('#endless-leaderboard-close')!.onclick = () => {
    modal.remove();
    onRestart();
  };
}
