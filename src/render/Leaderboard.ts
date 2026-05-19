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
import { fetchTopScores, submitScore, toRemoteRow, hasRemoteLeaderboard } from '../services/SupabaseLeaderboard';

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
    .hog-overlay {
      position: absolute; inset: 0; z-index: 200;
      background: radial-gradient(ellipse at center, #1a0808 0%, #0a0202 70%, #000 100%);
      color: #ffd34d; font-family: 'Courier New', monospace;
      display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
      padding: 18px 24px;
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
      position: relative; z-index: 2; width: min(880px, 96%);
      display: flex; flex-direction: column; align-items: center; gap: 14px;
      max-height: calc(100% - 36px);
    }
    .hog-title {
      font-size: 44px; letter-spacing: 10px; font-weight: 900;
      color: #ffd34d;
      text-shadow: 0 0 12px #ffd34d, 0 0 22px #ffaa33, 2px 2px 0 #1a0808;
      animation: hogTitleFlicker 4.6s infinite;
      text-align: center;
      padding: 4px 0;
    }
    .hog-subtitle {
      font-size: 12px; letter-spacing: 6px; color: #aa4a1a;
      text-shadow: 1px 1px 0 #000;
    }
    .hog-table {
      width: 100%; border-collapse: collapse;
      background: rgba(20,4,4,0.85);
      border: 2px solid #aa1a1a;
      box-shadow: 0 0 24px rgba(170,26,26,0.4), inset 0 0 30px rgba(0,0,0,0.7);
    }
    .hog-table thead th {
      font-size: 11px; letter-spacing: 2px;
      color: #aa6a1a; padding: 8px 10px;
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
      padding: 9px 10px; font-size: 13px; font-weight: 900;
      letter-spacing: 1px;
      text-shadow: 1px 1px 0 #000;
    }
    .hog-table tbody td.num { text-align: right; }
    .hog-table tbody tr.you { animation: hogRowIn 0.45s ease-out both, hogPulse 1.2s ease-in-out infinite; }
    .hog-prompt {
      font-size: 16px; letter-spacing: 5px; font-weight: 900;
      color: #ffd34d; animation: hogPrompt 1.0s infinite;
      text-shadow: 0 0 8px #ffd34d, 2px 2px 0 #000;
      margin-top: 8px;
    }
    .hog-rank-1 { color: #ffd34d; }
    .hog-rank-2 { color: #d8d8d8; }
    .hog-rank-3 { color: #cd7f32; }
    .hog-rank-1 td:first-child::before { content: '🏛 '; }
    .hog-table-scroll {
      width: 100%; max-height: 50vh; overflow-y: auto;
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
  wrap.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle,rgba(20,8,4,0.92),rgba(0,0,0,0.97));z-index:190;color:#ffd34d;font-family:'Courier New',monospace;`;
  wrap.innerHTML = `
    <div style="text-align:center;padding:28px 36px;background:#0a0202;border:3px solid ${accent};box-shadow:0 0 36px ${accent}88;width:min(520px,92%);position:relative">
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
  wrap.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);z-index:195;color:#ffd34d;font-family:'Courier New',monospace;`;
  wrap.innerHTML = `
    <div style="background:#0a0202;border:3px solid #ffd34d;box-shadow:0 0 30px rgba(255,211,77,0.5);padding:28px 36px;text-align:center;width:min(420px,92%);position:relative">
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
export function showLeaderboard(parent: HTMLElement, currentEntry: LeaderboardEntry | null, onRestart: () => void) {
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
      <div class="hog-prompt">▶ PRESS ENTER TO PLAY AGAIN ◀</div>
    </div>`;
  parent.appendChild(wrap);

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

  async function paintRemoteRows() {
    subtitle.textContent = '🌐 FETCHING GLOBAL LEADERBOARD…';
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:#aa6a1a;letter-spacing:3px">— LOADING —</td></tr>`;
    const rows = await fetchTopScores('campaign', 10);
    // Three distinct states get three distinct copy treatments so the
    // player can tell what's actually happening:
    //   1. rows === null    → couldn't reach the server (real error)
    //   2. rows.length === 0 → reached the server, table is empty
    //   3. rows.length > 0   → normal render path below
    if (rows === null) {
      subtitle.textContent = '🌐 GLOBAL LEADERBOARD · OFFLINE FOR NOW';
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:#aa9a4a;letter-spacing:1px;line-height:1.7"><div style="font-size:13px;color:#cdb98a;margin-bottom:8px">Cannot reach the global leaderboard right now.</div><div style="font-size:11px;color:#88aaaa">Your scores are still being saved locally — check the 📜 LOCAL tab. Global scores will sync the next time you load the game.</div></td></tr>`;
      return;
    }
    if (rows.length === 0) {
      subtitle.textContent = '🌐 GLOBAL LEADERBOARD · WAITING FOR THE FIRST CONQUEROR';
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:#88ff88;letter-spacing:1px;line-height:1.7"><div style="font-size:14px;color:#88ff88;letter-spacing:3px;font-weight:bold;margin-bottom:8px">🏛 NO NAMES IN THE MARBLE YET 🏛</div><div style="font-size:11px;color:#cdb98a">Survive a wave — even one — and your name will be the first the Empire records.</div></td></tr>`;
      return;
    }
    subtitle.textContent = `🌐 TOP ${rows.length} LEGIONS OF ROMA · GLOBAL`;
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
  }

  // Initial paint — global is default when remote is configured.
  if (remoteAvailable) {
    paintRemoteRows();
    const globalBtn = wrap.querySelector('#hog-tab-global') as HTMLButtonElement;
    const localBtn  = wrap.querySelector('#hog-tab-local')  as HTMLButtonElement;
    const setActive = (which: 'global' | 'local') => {
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

  // ENTER → restart. Click anywhere on the prompt area also restarts.
  const restart = () => { wrap.remove(); document.removeEventListener('keydown', onKey); onRestart(); };
  const promptEl = wrap.querySelector('.hog-prompt') as HTMLElement;
  promptEl.style.cursor = 'pointer';
  promptEl.addEventListener('click', restart);
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Enter') restart();
  };
  document.addEventListener('keydown', onKey);
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
    // 2026-05-19 — Pre-fill the end-of-run name prompt with the
    // player's saved "etched" name from the cold-start modal. They
    // can still change it before submitting; the default just means
    // SKIP commits to the same name they used at the start.
    const savedName: string = ((state as any).playerName ?? '').trim() || 'UNKNOWN';
    promptForName(parent, savedName, (name) => {
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
      insertEntry(entry);
      // 2026-05-19 — Also submit to the remote leaderboard if Supabase
      // is configured. Fire-and-forget: never blocks the UI flow, the
      // local insert above is the source-of-truth for the player's
      // own device. Network failures are silent (logged via the
      // service's null-return contract); the GLOBAL tab in
      // showLeaderboard below will still try to fetch even if the
      // submit failed.
      submitScore(toRemoteRow(entry, 'campaign'));
      // If a post-victory hook is wired (Endless transition), invoke it
      // INSTEAD of showing the static leaderboard. The leaderboard is
      // still reachable from the main menu after the run ends.
      if (won && onPostVictory) {
        onPostVictory(entry.name);
        return;
      }
      showLeaderboard(parent, entry, onRestart);
    });
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
  modal.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.85);z-index:200;font-family:'Courier New',monospace`;
  const panel = document.createElement('div');
  panel.style.cssText = `width:min(640px,92%);max-height:88vh;overflow:auto;background:linear-gradient(180deg,#1a0c14,#0c0608);border:3px solid #ff5050;padding:24px;color:#fff8e0;box-shadow:0 0 40px rgba(255,80,80,0.55)`;
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
