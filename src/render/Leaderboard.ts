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
import { WAVE } from '../constants';
import { displayWaveNumber } from '../systems/TestYourMightLabels';
// 2026-05-22 — Mobile detection for swapping "Press ENTER" prompts to
// touch-friendly "Tap" equivalents on phones / tablets. Desktop string
// is unchanged.
import { isMobile as isMobileDevice } from '../Mobile';
import { fetchTopScores, submitScore, toRemoteRow, hasRemoteLeaderboard, getLastFetchMeta, getLeaderboardDiagnostics, setLeaderboardProxyOverride, generateRowId, submissionSignature, hasBeenSubmitted, markSubmitted, type SubmitResult } from '../services/SupabaseLeaderboard';
import HERO_DEFS_FOR_LB from '../data/herodefs.json';

// 2026-05-19 — Hero suffix helper. Reads the run's heroId off the
// row, looks up the display name from herodefs.json, and renders a
// muted-gold "⚔ HeroName" chip that sits after the player name in
// the NAME column. Smaller and dimmer than the player name so it
// never competes for the eye. Returns empty string for null/unknown
// heroId so pre-hero entries render unchanged.
function renderHeroSuffix(heroId: string | null | undefined): string {
  if (!heroId) return '';
  const def = (HERO_DEFS_FOR_LB as any)[heroId];
  const heroName: string = def?.name ?? '';
  if (!heroName) return '';
  // Sanitize to avoid HTML injection on the off chance a future
  // herodefs entry contains markup. Player names go through their
  // own sanitizer (A-Z, 0-9 only) so they don't need this guard.
  const safe = heroName.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  } as Record<string, string>)[c] ?? c);
  return ` <span class="hero-suffix" style="color:#aa9a4a;font-size:0.78em;letter-spacing:1.5px;font-weight:600;margin-left:6px;text-shadow:none">⚔ ${safe}</span>`;
}

export interface ScoreBreakdown {
  waveBonus: number;       // waves completed × SCORE_PER_WAVE
  comboBonus: number;      // towers combined × SCORE_PER_COMBO
  questBonus: number;      // quests completed × SCORE_PER_QUEST
  winBonus: number;        // SCORE_WIN_BONUS only if the run beat W30
  final: number;
  // 2026-05-25 — Legacy breakdown fields. The simplified formula no
  // longer uses kills / time-survived / tower-efficiency / RNG-event /
  // lives-penalty, but the fields are kept on the interface (always 0)
  // so any external reader or saved end-screen markup doesn't break.
  killBonus: number;
  timeBonus: number;
  efficiencyBonus: number;
  rngBonus: number;
  livesPenalty: number;
  difficultyMult: number;
}

// ── SIMPLIFIED SCORING (2026-05-25) ─────────────────────────────────
// Player feedback: the old formula let a slow early-death run out-score
// a deep run (a W10 LOSS hit the 54K sanity cap and ranked #1 above a
// legit W19 run at 43.7K). Root cause: unbounded kills/time/efficiency
// components rewarded farming + idling instead of progression.
//
// New model — three additive parts plus a true-campaign win bump, nothing else:
//   • flat points for each wave you COMPLETE
//   • points per combo tower you build
//   • points per quest you finish
//   • a big flat bonus for beating the current 30-wave campaign
//
// Progression dominates: 1 extra wave (2,000) outweighs 4 combos or
// 5 quests, so reaching a deeper wave is the main lever. Legacy W20 rows
// may keep their W badge, but no longer receive the victory bump now that
// the campaign ends on W30.
export const SCORE_PER_WAVE = 2000;
export const SCORE_PER_COMBO = 500;
export const SCORE_PER_QUEST = 400;
export const SCORE_WIN_BONUS = 40000;

export function isScoringVictory(opts: { wave: number; won: boolean }): boolean {
  return !!opts.won && opts.wave >= WAVE.TOTAL;
}

// Single source of truth for the score formula. Takes raw run
// components so it can score BOTH a live run (end screen) AND a stored
// leaderboard entry (recompute-on-render, healing old-formula scores).
export function computeScore(opts: { wave: number; won: boolean; combos: number; quests: number }): number {
  // A loss at wave N means N-1 waves were cleared (died during wave N).
  // A W/L badge win means all `wave` waves cleared; only W30 also earns the
  // victory bonus. This lets old W20 rows keep their W badge while losing
  // the old 20-wave win factor.
  const wavesCompleted = opts.won ? opts.wave : Math.max(0, opts.wave - 1);
  const waveBonus = wavesCompleted * SCORE_PER_WAVE;
  const comboBonus = Math.max(0, opts.combos) * SCORE_PER_COMBO;
  const questBonus = Math.max(0, opts.quests) * SCORE_PER_QUEST;
  const winBonus = isScoringVictory(opts) ? SCORE_WIN_BONUS : 0;
  return waveBonus + comboBonus + questBonus + winBonus;
}

export function computeLeaderboardScoreForState(state: GameStateShape, currentWaveCleared: boolean): number {
  return computeScore({
    wave: state.wave,
    won: currentWaveCleared,
    combos: state.combosBuilt ?? 0,
    quests: (state.completedQuests ?? []).length
  });
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
  // 2026-05-19 — Optional hero pick from the run. Pre-hero entries
  // stored before this build land as undefined, which the Hall of
  // Glory render treats as "no suffix" so legacy rows look the same.
  heroId?: string | null;
}

const STORAGE_KEY = 'roman_td_leaderboard_v2';
// Also purge the old v1 entries on first load so they don't linger in
// the user's browser storage. Wrapped in try/catch since localStorage
// access can throw in incognito/strict-storage contexts.
try { localStorage.removeItem('roman_td_leaderboard_v1'); } catch { /* ignore */ }
const MAX_ENTRIES = 20;

// June 29 pre-balance W30 rows were produced before the late campaign was
// correctly tuned. Keep them out of the displayed global Hall of Glory without
// relying on public clients having DELETE rights against Supabase.
export const INVALIDATED_GLOBAL_SCORE_IDS = new Set([
  '59674466-f16b-4022-bcc5-731d2c827a9a',
  '0f32dab9-abcb-4cd0-843b-fb216ddffaf4',
  '7ae16acf-e27c-4485-9118-e6baaa23c20f'
]);

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
  // 2026-05-25 — SIMPLIFIED. See computeScore() above for the model.
  // Just waves + combos + quests + W30 win bump. No kills, no time-survived,
  // no tower-efficiency, no RNG-event bonus, no lives penalty, no sanity
  // cap — the formula is bounded by design so it can't be gamed by slow
  // play, and a deeper run always out-scores a shallow one.
  const wavesCompleted = won ? state.wave : Math.max(0, state.wave - 1);
  const combos = state.combosBuilt ?? 0;
  const quests = (state.completedQuests ?? []).length;

  const waveBonus  = wavesCompleted * SCORE_PER_WAVE;
  const comboBonus = Math.max(0, combos) * SCORE_PER_COMBO;
  const questBonus = Math.max(0, quests) * SCORE_PER_QUEST;
  const winBonus   = isScoringVictory({ wave: state.wave, won }) ? SCORE_WIN_BONUS : 0;
  const final      = waveBonus + comboBonus + questBonus + winBonus;

  return {
    waveBonus, comboBonus, questBonus, winBonus, final,
    // Legacy fields — always 0 under the simplified formula.
    killBonus: 0, timeBonus: 0, efficiencyBonus: 0, rngBonus: 0,
    livesPenalty: 0, difficultyMult: 1.0,
  };
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
  // 2026-05-20 — Dedup by ts. Players reported seeing the same score
  // twice on the LOCAL tab; root cause was finalize() firing twice
  // (Enter pressed on the end-summary, then again on the leaderboard
  // post-render, or a tab-blur autosave colliding with the manual
  // submit). ts is Date.now() at insertion so two entries with the
  // same ts ARE the same run; collapse them. Also defends against
  // any future double-call from new code paths.
  if (list.some(e => e.ts === entry.ts && e.score === entry.score && e.name === entry.name)) {
    // Already inserted — return the existing list unchanged.
    return list.slice(0, MAX_ENTRIES);
  }
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
       BIG on huge screens and still fits on small ones.
       2026-05-20 v4 — DENSITY PASS. The 60vh table cap + generous row
       padding meant the player could only see 2-3 rows per scroll on
       common laptop screens. Tightened row padding, trimmed the title
       block, and bumped the table cap to 78vh so all 10 (in fact all
       25) entries fit on one screen at 1080p+ without scrolling. */
    .hog-overlay {
      /* Mounted on document.body — position:fixed fills the REAL
         viewport on any monitor size, not the scaled #app box. */
      position: fixed; inset: 0; z-index: 200;
      background: radial-gradient(ellipse at center, #1a0808 0%, #0a0202 70%, #000 100%);
      color: #ffd34d; font-family: 'Courier New', monospace;
      display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
      padding: clamp(10px, 1.2vw, 20px) clamp(18px, 2.2vw, 36px);
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
      width: min(1500px, 96vw);
      display: flex; flex-direction: column; align-items: center;
      gap: clamp(4px, 0.6vw, 10px);
      /* Let the content stretch the full viewport; the table itself
         is the scrollable region. Removing the previous calc(100% -
         36px) cap so a small banner up top doesn't steal table rows. */
      max-height: 100%;
      width: min(1500px, 96vw);
    }
    .hog-title {
      font-size: clamp(28px, 4vw, 56px);
      letter-spacing: clamp(6px, 0.9vw, 14px);
      font-weight: 900;
      color: #ffd34d;
      text-shadow: 0 0 12px #ffd34d, 0 0 22px #ffaa33, 2px 2px 0 #1a0808;
      animation: hogTitleFlicker 4.6s infinite;
      text-align: center;
      padding: 0;
      margin: 0;
      line-height: 1.15;
    }
    .hog-subtitle {
      font-size: clamp(10px, 1vw, 16px);
      letter-spacing: clamp(4px, 0.55vw, 9px);
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
      font-size: clamp(10px, 0.95vw, 14px);
      letter-spacing: clamp(2px, 0.22vw, 3px);
      color: #aa6a1a;
      padding: clamp(6px, 0.7vw, 11px) clamp(8px, 0.8vw, 14px);
      border-bottom: 2px solid #aa1a1a;
      text-align: left; font-weight: 900;
      background: linear-gradient(180deg, #2a0808, #1a0404);
      position: sticky; top: 0; z-index: 3;
    }
    .hog-table thead th.num { text-align: right; }
    .hog-table tbody tr {
      animation: hogRowIn 0.45s ease-out both;
      border-bottom: 1px dashed rgba(170,26,26,0.3);
    }
    .hog-table tbody td {
      /* 2026-05-20 v4 — Tightened from clamp(9px, 1vw, 16px)
         × clamp(13px, 1.4vw, 22px). At 1080p the previous values made
         each row ~54px tall — only ~12 rows fit in 60vh ≈ 648px. New
         values produce ~32px rows so all 25 fetched entries fit in
         ~80vh without scrolling on standard monitors. */
      padding: clamp(5px, 0.55vw, 9px) clamp(8px, 0.8vw, 14px);
      font-size: clamp(12px, 1.1vw, 17px);
      font-weight: 900;
      letter-spacing: clamp(1px, 0.18vw, 2.5px);
      text-shadow: 1px 1px 0 #000;
    }
    .hog-table tbody td.num { text-align: right; }
    .hog-table tbody tr.you { animation: hogRowIn 0.45s ease-out both, hogPulse 1.2s ease-in-out infinite; }
    .hog-prompt {
      font-size: clamp(13px, 1.4vw, 20px);
      letter-spacing: clamp(4px, 0.5vw, 8px);
      font-weight: 900;
      color: #ffd34d; animation: hogPrompt 1.0s infinite;
      text-shadow: 0 0 8px #ffd34d, 2px 2px 0 #000;
      margin-top: 4px;
    }
    .hog-rank-1 { color: #ffd34d; }
    .hog-rank-2 { color: #d8d8d8; }
    .hog-rank-3 { color: #cd7f32; }
    .hog-rank-1 td:first-child::before { content: '🏛 '; }
    .hog-table-scroll {
      /* 2026-05-20 v4 — Bumped 60vh → 78vh so all 25 entries fit on
         a 1080p screen without scrolling. Sticky header (above)
         keeps the column labels visible if the player does scroll
         (e.g. when extra footer content trims the available room
         on a smaller monitor). */
      width: 100%; max-height: 78vh; overflow-y: auto;
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
      <!-- 2026-05-25 — Score breakdown rewritten to mirror the
           simplified formula EXACTLY so the player can see how their
           score was built: waves + combos + quests + W30 win bump. The
           old grid mixed in stats that no longer affect score (kills,
           time, towers), which was misleading. -->
      <div style="margin-top:16px;padding:12px 16px;background:rgba(0,0,0,0.35);border:1px solid #5a4a30;text-align:left;font-size:13px;color:#fff8e0;font-weight:900;text-shadow:1px 1px 0 #000">
        <div style="font-size:10px;letter-spacing:3px;color:#aa6a1a;margin-bottom:8px;font-weight:bold">⚖ SCORE BREAKDOWN</div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Waves cleared (${won ? state.wave : Math.max(0, state.wave - 1)} × ${SCORE_PER_WAVE.toLocaleString()})</span><span style="color:${accent}">+${breakdown.waveBonus.toLocaleString()}</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Combos forged (${state.combosBuilt ?? 0} × ${SCORE_PER_COMBO})</span><span style="color:${accent}">+${breakdown.comboBonus.toLocaleString()}</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span>Quests cleared (${(state.completedQuests ?? []).length} × ${SCORE_PER_QUEST})</span><span style="color:${accent}">+${breakdown.questBonus.toLocaleString()}</span></div>
        ${breakdown.winBonus > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:4px;color:#88ff88"><span>★ ROMA AETERNA — W30 campaign beaten!</span><span>+${breakdown.winBonus.toLocaleString()}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between;border-top:1px solid #5a4a30;margin-top:6px;padding-top:6px;font-size:14px"><span>TOTAL</span><span style="color:#ffd34d">${breakdown.final.toLocaleString()}</span></div>
      </div>
      <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;font-size:11px;color:#cdb98a;text-align:left;font-weight:700">
        <div>Wave reached: <span style="color:${accent}">${displayWaveNumber(state)}/${WAVE.TOTAL}</span></div>
        <div>Enemies defeated: <span style="color:${accent}">${kills}</span></div>
        <div>Time survived: <span style="color:${accent}">${timeStr}</span></div>
        <div>Towers built: <span style="color:${accent}">${state.towersBuilt ?? 0}</span></div>
      </div>
      <button id="end-continue" style="margin-top:26px;background:linear-gradient(180deg,${accent},#4a2a08);color:#1a0808;border:3px solid #fff8e0;padding:12px 32px;font-family:inherit;font-size:15px;letter-spacing:4px;cursor:pointer;font-weight:900;box-shadow:0 0 20px ${accent}aa">CONTINUE ▸</button>
      <div class="desktop-hotkey-hint" style="margin-top:10px;font-size:10px;letter-spacing:3px;color:#aa6a1a">PRESS ENTER</div>
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
  opts?: { loadingMode?: boolean; onBack?: () => void; onEndlessJoin?: () => void }
) {
  const isLoadingMode = !!opts?.loadingMode;
  const onEndlessJoin = opts?.onEndlessJoin;
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
  // 2026-05-20 v3 — Submission-status banner. Shown right after a run
  // ends and the player lands on the Hall of Glory. Reads the
  // `__submitStatus` stash set by runEndOfGameFlow to tell the player
  // CLEARLY whether their score made it into the global table or not.
  // The previous flow ignored submitScore's return value — a silent
  // failure looked identical to "didn't crack the top 10", which is
  // exactly the bug a user reported (friend's wave-8 score never
  // appeared and there was no way to tell if it had been saved).
  let submitBannerHtml = '';
  const submitStatus = currentEntry ? (currentEntry as any).__submitStatus : null;
  const submitDetail: SubmitResult | null = currentEntry ? ((currentEntry as any).__submitDetail ?? null) : null;
  if (submitStatus === 'success') {
    // 2026-05-20 — Success-with-warning case. submitScore now auto-
    // strips schema-missing columns (PGRST204 fallback) so the run
    // saves anyway, just without the dropped field (typically
    // hero_id). The errorReason carries the warning text in this
    // case — surface it under the green banner so the maintainer
    // knows to run the migration when convenient.
    const warning = submitDetail?.errorReason ?? '';
    const warningRow = warning
      ? `<div style="background:#2a1f08;border:1px dashed #d4af37;color:#cdb98a;font-size:10px;letter-spacing:0.5px;padding:6px 12px;margin-top:4px;text-align:left;line-height:1.45"><b style="color:#ffd34d">⚠ NOTE:</b> ${warning}</div>`
      : '';
    submitBannerHtml = `<div style="background:linear-gradient(180deg,#0a2a0a,#061806);border:2px solid #66ff88;padding:6px 12px;margin:4px 0;text-align:center;color:#88ff88;font-family:'Courier New',monospace;font-size:12px;letter-spacing:2px;font-weight:bold;box-shadow:0 0 12px rgba(102,255,136,0.35)">
      ✓ SCORE SUBMITTED TO THE EMPIRE
    </div>${warningRow}`;
  } else if (submitStatus === 'failed') {
    // 2026-05-20 v4 — Real diagnostics in the failure banner. Surfaces
    // the actual HTTP status, the endpoint kind, and the URL hit so
    // the player (or maintainer) can self-diagnose without DevTools.
    // Most common diagnostic outcomes:
    //   • status 404 + endpoint "direct" → Supabase URL is wrong or
    //     RLS dropped the table; check VITE_SUPABASE_URL / schema.sql
    //   • status 401/403 → anon key wrong or RLS denied insert
    //   • no status + "Failed to fetch" → ad-blocker / network block
    //     → use localStorage override to point at a Cloudflare Worker
    //   • status 0 / abort → 5 retries all timed out
    const reason = submitDetail?.errorReason ?? 'See console for details.';
    const status = submitDetail?.status;
    const endpoint = submitDetail?.endpoint ?? 'direct';
    const host = submitDetail?.url ? (() => { try { return new URL(submitDetail.url).host; } catch { return ''; } })() : '';
    const endpointBadge = endpoint === 'override'  ? '🛠 localStorage override'
                       : endpoint === 'env-proxy'  ? '🛡 Cloudflare Worker proxy'
                       : endpoint === 'direct'     ? '🔗 direct to supabase.co'
                       :                              '— not configured —';
    submitBannerHtml = `<div id="hog-fail-banner" style="background:linear-gradient(180deg,#2a0a0a,#180606);border:2px solid #ee5050;padding:8px 12px;margin:4px 0;text-align:left;color:#ff8888;font-family:'Courier New',monospace;font-size:11px;letter-spacing:1px;box-shadow:0 0 12px rgba(238,80,80,0.35);max-width:1100px;margin-left:auto;margin-right:auto">
      <div style="font-size:12px;font-weight:bold;letter-spacing:2px;text-align:center;margin-bottom:4px">✗ GLOBAL SUBMISSION FAILED — saved locally only</div>
      <div style="font-size:10px;color:#cdb98a;line-height:1.45;margin-top:4px">
        <b style="color:#ffd34d">Why:</b> ${reason}
      </div>
      <div style="font-size:10px;color:#aa9a4a;margin-top:4px;display:flex;flex-wrap:wrap;gap:10px;justify-content:center">
        <span><b>Endpoint:</b> ${endpointBadge}${host ? ` · <span style="color:#88ddff">${host}</span>` : ''}</span>
        ${typeof status === 'number' ? `<span><b>HTTP:</b> ${status}</span>` : ''}
        <span><b>Attempts:</b> ${submitDetail?.attempts ?? '?'}/5</span>
      </div>
      <div style="display:flex;gap:6px;justify-content:center;margin-top:6px;flex-wrap:wrap">
        <button id="hog-fail-retry" type="button" style="background:#3a2a14;color:#ffd34d;border:1px solid #d4af37;padding:4px 10px;font-family:inherit;font-size:10px;letter-spacing:1.5px;font-weight:bold;cursor:pointer">↻ RETRY SUBMIT</button>
        <button id="hog-fail-proxy" type="button" style="background:#1a2a2a;color:#88ddff;border:1px solid #2a5a5a;padding:4px 10px;font-family:inherit;font-size:10px;letter-spacing:1.5px;font-weight:bold;cursor:pointer" title="Route leaderboard requests through a Cloudflare Worker URL.">🛠 SET PROXY URL</button>
      </div>
      <div style="font-size:9px;color:#5a7a7a;text-align:center;margin-top:4px">Switch to LOCAL tab to see your run · open DevTools console for the full request trace.</div>
    </div>`;
  } else if (submitStatus === 'no-remote') {
    submitBannerHtml = `<div style="background:#1a1410;border:1px dashed #5a4a30;padding:4px 12px;margin:4px 0;text-align:center;color:#aa9a4a;font-family:'Courier New',monospace;font-size:11px;letter-spacing:2px">
      ⓘ GLOBAL LEADERBOARD NOT CONFIGURED · saved to LOCAL tab
    </div>`;
  }
  // 2026-05-20 v4 — Even on success show a small "endpoint" footer
  // when the diagnostics aren't on the screen, so the player can
  // confirm which path their submission took on a successful run.
  // Helpful for verifying the proxy is engaged after a setup change.
  void getLeaderboardDiagnostics;
  wrap.innerHTML = `
    <div class="hog-scanlines"></div>
    <div class="hog-vignette"></div>
    <div class="hog-content">
      <div class="hog-title">HALL OF GLORY</div>
      <div class="hog-subtitle" id="hog-subtitle">TOP X LEGIONS OF ROMA</div>
      ${submitBannerHtml}
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
      <div id="hog-your-rank" style="margin:4px 0;text-align:center;color:#cdb98a;font-family:'Courier New',monospace;font-size:11px;letter-spacing:2px;min-height:14px"></div>
      ${isLoadingMode
        ? `<div style="display:flex;flex-direction:column;align-items:center;gap:clamp(10px,1vw,18px);margin-top:clamp(8px,1vw,16px)">
             <div class="hog-prompt">▶ ${isMobileDevice() ? 'TAP TO BEGIN YOUR RUN' : 'PRESS ENTER TO BEGIN YOUR RUN'} ▶</div>
             <button id="hog-back-to-loading" type="button" style="background:transparent;border:1px solid #5a4a30;color:#aa9a4a;font-family:'Courier New',monospace;font-size:clamp(10px,0.9vw,14px);letter-spacing:clamp(2px,0.3vw,4px);font-weight:bold;padding:clamp(7px,0.8vw,11px) clamp(14px,1.5vw,22px);cursor:pointer;text-shadow:1px 1px 0 #000">← BACK TO COIN SLOT</button>
           </div>`
        : onEndlessJoin
          // 2026-05-20 legacy Endless view. Solo no longer wires this,
          // but old call sites can still provide onEndlessJoin.
          // 2026-05-22 — Mobile swap: prompts say "Tap" instead of "Press ENTER".
          ? `<div style="display:flex;flex-direction:column;align-items:center;gap:clamp(8px,1vw,14px);margin-top:clamp(6px,0.8vw,12px)">
               <button id="hog-join-endless" type="button" style="background:linear-gradient(180deg,#5a1a8a,#3a0a5a);color:#ff66ff;border:3px solid #aa55ff;font-family:'Courier New',monospace;font-size:clamp(14px,1.6vw,22px);letter-spacing:clamp(4px,0.6vw,10px);font-weight:900;padding:clamp(10px,1.2vw,18px) clamp(24px,3vw,48px);cursor:pointer;box-shadow:0 0 22px rgba(170,85,255,0.55);text-shadow:0 0 8px #aa55ff,2px 2px 0 #000">⚔ JOIN ENDLESS MODE ⚔</button>
               <div class="hog-prompt" style="font-size:clamp(12px,1.2vw,18px)">▶ ${isMobileDevice() ? 'Tap to play campaign again' : 'Press ENTER to play campaign again'} ◀</div>
             </div>`
          : `<div class="hog-prompt">▶ ${isMobileDevice() ? 'TAP TO PLAY AGAIN' : 'PRESS ENTER TO PLAY AGAIN'} ◀</div>`}
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
    // 2026-05-25 — RECOMPUTE-ON-RENDER. Entries stored under the old
    // (broken) formula carry stale inflated scores. Rather than trust
    // the saved `score`, recompute every entry from its raw components
    // (wave / won / combos / quests) with the new simplified formula,
    // then re-sort. This heals the whole board in one shot — a W10 LOSS
    // that was stored at 54K drops to its true ~22K and sorts below a
    // legit W19 run. The stored score becomes display-irrelevant.
    const sortedEntries = entries
      .map(e => ({ ...e, score: computeScore({ wave: e.wave, won: e.won, combos: e.towersCombined, quests: e.questsCompleted }) }))
      .sort((a, b) => b.score - a.score || a.ts - b.ts);
    sortedEntries.forEach((e, idx) => {
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
        <td class="${rankClass}">${e.name}${renderHeroSuffix(e.heroId)}${isYou ? ' <span style="color:#ffd34d">◀ YOU</span>' : ''}</td>
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
      // 2026-05-20 v3 — Bumped fetch limit 10 → 25. Player feedback:
      // wave 8-10 runs felt like they "should" make the leaderboard
      // but never appeared because the top 10 was saturated with
      // wave-20 victory runs. Showing the top 25 gives mid-run scores
      // (wave 8-15) a real chance to land while still keeping the
      // table scannable. The table itself is scrollable so 25 rows
      // fit fine in the modal.
      // 2026-05-25 — Fetch 100 (was 25) so recompute-on-render below
      // has enough rows to surface the TRUE top 25 by the new formula.
      // Stale entries stored under the old broken formula carry
      // inflated scores; if we only fetched the stored-score top 25,
      // an inflated W10 LOSS could occupy a slot a legit run deserves.
      // Pulling 100 then re-sorting by recomputed score fixes that.
      const rawRows = await fetchTopScores('campaign', 100);
      const meta = getLastFetchMeta();
      // RECOMPUTE-ON-RENDER: re-score every fetched row from its raw
      // components with the simplified formula, re-sort, and cut to the
      // top 25 for display. Heals every old-formula entry (e.g. a W10
      // LOSS stored at 54K drops to ~22K and sorts below a W19 run).
      const rows = rawRows === null ? null : rawRows
        .filter(r => !r.id || !INVALIDATED_GLOBAL_SCORE_IDS.has(r.id))
        .map(r => ({ ...r, score: computeScore({ wave: r.wave, won: r.won, combos: r.towers_combined, quests: r.quests_completed }) }))
        .sort((a, b) => b.score - a.score || new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime())
        .slice(0, 25);
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
      // 2026-05-20 v3 — "TOP 25" max to match the bumped fetch limit.
      // Players with wave 8-15 runs now have visible spots to compete
      // for instead of being shut out by the wave-20 victory rows.
      subtitle.textContent = `🌐 TOP ${rows.length} LEGIONS OF ROMA · GLOBAL`;
    }
    tbody.innerHTML = '';
    // 2026-05-20 v3 — Find the player's row in the global results so
    // we can highlight it (◀ YOU) and compute their rank for the
    // footer callout. Matches by score+wave since multiple players
    // may share a name; the score+wave+won tuple is essentially
    // unique per run. Won't match if the player's submission failed
    // (banner above explains that case).
    const youIdx = currentEntry ? rows.findIndex(e =>
      e.name === currentEntry.name &&
      e.score === currentEntry.score &&
      e.wave === currentEntry.wave &&
      e.won === currentEntry.won
    ) : -1;
    rows.forEach((e, idx) => {
      const rankNumeral = roman(idx + 1);
      const rankClass = idx === 0 ? 'hog-rank-1' : idx === 1 ? 'hog-rank-2' : idx === 2 ? 'hog-rank-3' : '';
      const isYou = idx === youIdx;
      const wlBadge = e.won
        ? '<span style="color:#88ff88;font-weight:900">W</span>'
        : '<span style="color:#ee5050;font-weight:900">L</span>';
      const tr = document.createElement('tr');
      tr.className = [rankClass, isYou ? 'you' : ''].filter(Boolean).join(' ');
      tr.style.animationDelay = `${idx * 0.06}s`;
      tr.innerHTML = `
        <td class="${rankClass}">${rankNumeral}</td>
        <td class="${rankClass}">${e.name}${renderHeroSuffix(e.hero_id)}${isYou ? ' <span style="color:#ffd34d">◀ YOU</span>' : ''}</td>
        <td class="num ${rankClass}">${e.score.toLocaleString()}</td>
        <td class="${rankClass}">Wave ${e.wave}</td>
        <td class="num ${rankClass}">${e.towers_combined}</td>
        <td class="num ${rankClass}">${e.quests_completed}</td>
        <td class="${rankClass}">${wlBadge}</td>
        <td class="${rankClass}">${formatDateShort(e.date_str)}</td>`;
      tbody.appendChild(tr);
    });
    // 2026-05-20 v3 — "Your rank" footer. Tells the player at a
    // glance where they landed: in the top 25 highlighted, just
    // below the cutoff (rank > 25, would need to crack X points),
    // or "submission failed — see LOCAL tab." Eliminates the
    // ambiguity the previous UI created where a missing player name
    // could mean either "submit failed" or "didn't rank."
    const yourRankEl = wrap.querySelector('#hog-your-rank') as HTMLElement | null;
    if (yourRankEl && currentEntry) {
      const status = (currentEntry as any).__submitStatus;
      if (status === 'success' && youIdx >= 0) {
        yourRankEl.innerHTML = `<span style="color:#88ff88;font-weight:bold">▶ YOU LANDED RANK ${roman(youIdx + 1)} (#${youIdx + 1}) ON THE GLOBAL BOARD ◀</span>`;
      } else if (status === 'success' && youIdx < 0) {
        const lastScore = rows.length > 0 ? rows[rows.length - 1].score : 0;
        const gap = Math.max(0, lastScore - currentEntry.score + 1);
        yourRankEl.innerHTML = `<span style="color:#cdb98a">Your score was saved (${currentEntry.score.toLocaleString()} pts) but didn't crack the top ${rows.length}. Need <span style="color:#ffd34d">+${gap.toLocaleString()}</span> more to land rank ${rows.length}.</span>`;
      } else if (status === 'failed') {
        yourRankEl.innerHTML = `<span style="color:#ee8888">Your score didn't submit to the global board — see the banner above and the LOCAL tab.</span>`;
      } else {
        yourRankEl.innerHTML = '';
      }
    }
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

  // 2026-05-20 v4 — Wire the failure-banner diagnostic buttons.
  // RETRY SUBMIT — re-fires submitScore() with the current entry and
  // re-paints the global table when it succeeds. Lets the player
  // retry without replaying the whole run after fixing whatever was
  // wrong (e.g. disabling an ad-blocker, setting the proxy URL).
  // SET PROXY URL — window.prompt for a Cloudflare Worker URL,
  // writes it to localStorage, and reloads. Non-technical players
  // get a fix path without DevTools.
  const retryBtn = wrap.querySelector('#hog-fail-retry') as HTMLButtonElement | null;
  if (retryBtn && currentEntry) {
    retryBtn.onclick = async () => {
      // 2026-05-22 — Disable on click to prevent rapid double-clicks
      // creating multiple submitScore calls before the first resolves.
      // Even though the row id is now stable, multiple in-flight POSTs
      // would still each round-trip to Supabase before the PK
      // uniqueness kicks in — cheap to prevent client-side.
      if (retryBtn.disabled) return;
      retryBtn.disabled = true;
      retryBtn.textContent = '… RETRYING';
      try {
        const heroIdForRow: string | null = (currentEntry as any).heroId ?? null;
        // 2026-05-22 — DUPLICATE-SUBMIT FIX. Use the same __submitId
        // that was generated by finalize() (or generate one now if
        // somehow missing — defense in depth for legacy entries that
        // didn't go through the new finalize path). Carrying the
        // SAME UUID across the retry guarantees that if the original
        // submit actually landed server-side before the client timed
        // out, this retry hits the PK uniqueness and returns 409,
        // which submitScore now treats as success.
        let rowId: string | undefined = (currentEntry as any).__submitId;
        if (!rowId) {
          rowId = generateRowId();
          (currentEntry as any).__submitId = rowId;
        }
        // Skip the POST entirely if a previous retry already
        // succeeded but the user is impatiently clicking again.
        const sig = submissionSignature(currentEntry, 'campaign');
        let result: SubmitResult;
        if (hasBeenSubmitted(sig)) {
          result = { ok: true, attempts: 0, url: '', endpoint: 'direct', status: 200, errorReason: 'Already submitted earlier — duplicate retry absorbed locally.' };
        } else {
          result = await submitScore(toRemoteRow(currentEntry, 'campaign', heroIdForRow, rowId));
          if (result.ok) markSubmitted(sig);
        }
        // Update the banner in place so the player can see what
        // happened without re-opening the leaderboard.
        const banner = wrap.querySelector('#hog-fail-banner') as HTMLElement | null;
        if (banner && result.ok) {
          banner.outerHTML = `<div style="background:linear-gradient(180deg,#0a2a0a,#061806);border:2px solid #66ff88;padding:6px 12px;margin:4px 0;text-align:center;color:#88ff88;font-family:'Courier New',monospace;font-size:12px;letter-spacing:2px;font-weight:bold">✓ SCORE SUBMITTED ON RETRY</div>`;
          // Re-paint global so the row appears.
          paintRemoteRows();
        } else if (banner) {
          // Re-render the failure banner with the latest detail.
          (currentEntry as any).__submitDetail = result;
          retryBtn.disabled = false;
          retryBtn.textContent = `↻ RETRY (HTTP ${result.status ?? '—'})`;
        }
      } catch (err) {
        console.error('[leaderboard] retry threw:', err);
        retryBtn.disabled = false;
        retryBtn.textContent = '↻ RETRY SUBMIT';
      }
    };
  }
  const proxyBtn = wrap.querySelector('#hog-fail-proxy') as HTMLButtonElement | null;
  if (proxyBtn) {
    proxyBtn.onclick = () => {
      const diag = getLeaderboardDiagnostics();
      const current = diag.kind === 'override' ? diag.base : '';
      const next = window.prompt(
        'Cloudflare Worker URL — routes leaderboard requests through your Worker\n' +
        'instead of supabase.co. Leave blank to clear the override.\n\n' +
        'Example: https://roman-td-leaderboard.your-name.workers.dev',
        current
      );
      if (next === null) return;   // cancelled
      const trimmed = next.trim();
      setLeaderboardProxyOverride(trimmed || null);
      // Reload so the bundle reads the new override on the next
      // import-time pass. The CSS + localStorage survive the reload.
      window.location.reload();
    };
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
  // Legacy JOIN ENDLESS button. Only rendered when onEndlessJoin is provided.
  const endlessBtn = wrap.querySelector('#hog-join-endless') as HTMLButtonElement | null;
  if (endlessBtn && onEndlessJoin) {
    endlessBtn.onclick = () => {
      stopAutoRefresh();
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      onEndlessJoin();
    };
  }
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
// 2026-05 v10 legacy: on victory, callers could chain into Endless instead
// of showing the static leaderboard. Solo no longer wires Endless, but the
// optional callback stays for compatibility.
export function runEndOfGameFlow(
  parent: HTMLElement,
  state: GameStateShape,
  won: boolean,
  onRestart: () => void,
  onPostVictory?: (name: string) => void,
  // 2026-05-20 legacy 6th parameter. If onEndlessJoin is wired, the Hall
  // can render a "JOIN ENDLESS" button; Solo campaign leaves it undefined.
  onEndlessJoin?: (name: string) => void
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
        ts: Date.now(),
        // 2026-05-19 — Stamp the hero pick on the local entry so the
        // LOCAL tab of the Hall of Glory renders the same "⚔ HeroName"
        // suffix as the GLOBAL tab. Null on pre-hero runs (and on any
        // run where the player somehow skipped the draft).
        heroId: ((state as any).activeHeroId as string | null | undefined) ?? null
      };
      // 2026-05-22 — DUPLICATE-SUBMIT FIX. Pre-compute a stable UUID
      // for this row and stash it on the entry. Every submitScore
      // call (initial + retries inside the function + user's RETRY
      // button) reuses the same UUID, so the Supabase 'scores'
      // table's PK uniqueness rejects any duplicate as 409 Conflict,
      // which submitScore now treats as success. This closes the
      // race where a network hiccup after server-commit caused the
      // client to retry and create a second identical row in the
      // Hall of Glory (user-reported bug: JB Wave 14 30,718 listed twice).
      (entry as any).__submitId = generateRowId();
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
      // earned by jumping to a late wave with 999k gold and free T5 towers
      // would pollute the Hall of Glory. The local insertEntry above
      // also gets reverted below so even the local board stays clean.
      const sandbox = !!(state as any).sandboxMode;
      // 2026-05-20 v4 — Capture the full structured SubmitResult so
      // the Hall of Glory banner can surface the actual failure
      // reason + endpoint + HTTP status when something goes wrong.
      // The previous boolean result couldn't tell the player whether
      // the URL was wrong, the anon key was rejected, an ad-blocker
      // intercepted, or RLS denied the insert — every failure looked
      // identical and the maintainer had to dig into DevTools to
      // figure it out.
      let submitStatus: 'success' | 'failed' | 'sandbox' | 'no-remote' = 'sandbox';
      let submitDetail: SubmitResult | null = null;
      if (!sandbox) {
        if (!hasRemoteLeaderboard()) {
          submitStatus = 'no-remote';
        } else {
          // 2026-05-22 — Belt-and-suspenders dedupe. If this exact
          // entry signature was already submitted recently (e.g. the
          // player reloaded the page after a successful submit and
          // somehow hit the end-of-run flow again), don't fire a
          // second POST. The local entry is already in the Hall
          // of Glory via insertEntry above.
          const sig = submissionSignature(entry, 'campaign');
          if (hasBeenSubmitted(sig)) {
            console.log('[leaderboard] signature already submitted recently — skipping POST');
            submitStatus = 'success';
            submitDetail = { ok: true, attempts: 0, url: '', endpoint: 'direct', status: 200, errorReason: 'Already submitted — local dedupe absorbed the duplicate.' };
          } else {
            submitStatus = 'failed';
            try {
              // 2026-05-19 — Thread the active hero pick through so the
              // Hall of Glory can render the "⚔ HeroName" suffix on the
              // NAME column. Pre-hero runs land as null and render the
              // unchanged player-name only row.
              const heroIdForRow: string | null = ((state as any).activeHeroId as string | null | undefined) ?? null;
              // 2026-05-22 — Pass the pre-computed __submitId so retries
              // are idempotent (see comment on entry.__submitId above).
              const rowId: string = (entry as any).__submitId as string;
              submitDetail = await submitScore(toRemoteRow(entry, 'campaign', heroIdForRow, rowId));
              if (submitDetail.ok) {
                submitStatus = 'success';
                markSubmitted(sig);
              }
            } catch (err) {
              console.error('[leaderboard] submit threw:', err);
            }
          }
        }
      }
      overlay.remove();
      // Stash the submit status + detail on the entry so showLeaderboard
      // can surface the failure reason without changing every signature.
      (entry as any).__submitStatus = submitStatus;
      (entry as any).__submitDetail = submitDetail;
      // 2026-05-20 — Post-victory routing rewritten. Old behavior:
      // if onPostVictory was wired, the Hall of Glory was bypassed
      // and Endless launched immediately. New behavior: ALWAYS show
      // the Hall after submitting; if onEndlessJoin is wired, the
      // Hall renders a "▶ JOIN ENDLESS MODE" button that fires the
      // callback. onPostVictory remains the legacy bypass for
      // anywhere that explicitly wants no-leaderboard flow.
      if (won && onPostVictory) {
        onPostVictory(entry.name);
        return;
      }
      showLeaderboard(parent, entry, onRestart, {
        onEndlessJoin: (won && onEndlessJoin) ? () => onEndlessJoin(entry.name) : undefined
      });
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
  // 2026-05-20 v4 — Mounted as fixed full-viewport overlay, not the
  // scaled #app box, so the modal stretches the real screen. Panel
  // now spans ~min(1200px, 92vw) with a tall table region so all 15
  // endless entries are visible at once on common laptop monitors.
  modal.style.cssText = `position:fixed;inset:0;display:flex;align-items:flex-start;justify-content:center;background:rgba(0,0,0,0.88);z-index:200;padding:clamp(12px,1.4vw,24px);box-sizing:border-box;overflow:auto;font-family:'Courier New',monospace`;
  const panel = document.createElement('div');
  panel.style.cssText = `width:min(1200px,94vw);max-height:96vh;display:flex;flex-direction:column;background:linear-gradient(180deg,#1a0c14,#0c0608);border:3px solid #ff5050;padding:clamp(14px,1.4vw,22px);color:#fff8e0;box-shadow:0 0 40px rgba(255,80,80,0.55)`;
  let rows = '';
  for (let i = 0; i < top.length; i++) {
    const e = top[i];
    const isYou = currentEntry && e.ts === currentEntry.ts;
    rows += `<tr style="${isYou ? 'background:rgba(255,210,77,0.18);color:#ffd34d;font-weight:bold' : ''}">
      <td style="padding:clamp(5px,0.55vw,9px) clamp(8px,0.8vw,14px);text-align:center;font-size:clamp(12px,1.05vw,16px);font-weight:bold">${i + 1}</td>
      <td style="padding:clamp(5px,0.55vw,9px) clamp(8px,0.8vw,14px);font-size:clamp(12px,1.05vw,16px);font-weight:bold;letter-spacing:1.5px">${e.name}</td>
      <td style="padding:clamp(5px,0.55vw,9px) clamp(8px,0.8vw,14px);text-align:right;font-size:clamp(12px,1.05vw,16px);font-weight:bold">${e.endlessScore.toLocaleString()}</td>
      <td style="padding:clamp(5px,0.55vw,9px) clamp(8px,0.8vw,14px);text-align:center;font-size:clamp(12px,1.05vw,16px)">E${e.endlessWave}</td>
      <td style="padding:clamp(5px,0.55vw,9px) clamp(8px,0.8vw,14px);text-align:right;color:#aa9a4a;font-size:clamp(10px,0.85vw,13px)">${e.date}</td>
    </tr>`;
  }
  if (top.length === 0) rows = `<tr><td colspan="5" style="padding:20px;text-align:center;color:#aa9a4a">No Endless runs yet. Be the first.</td></tr>`;
  panel.innerHTML = `
    <div style="font-size:clamp(18px,2vw,30px);letter-spacing:clamp(3px,0.4vw,6px);color:#ff5050;font-weight:bold;text-align:center;margin-bottom:6px">⚔ ENDLESS HALL OF MAYHEM ⚔</div>
    <div style="font-size:clamp(10px,0.95vw,14px);color:#cdb98a;text-align:center;margin-bottom:clamp(8px,1vw,14px)">Scored by cumulative endless wave clear value. Top 15 shown.</div>
    <div style="flex:1;overflow-y:auto;border:1px solid rgba(255,80,80,0.3)">
      <table style="width:100%;border-collapse:collapse;background:#0c0608">
        <thead><tr style="border-bottom:2px solid #ff5050;position:sticky;top:0;background:#1a0c14">
          <th style="padding:clamp(6px,0.7vw,10px) clamp(8px,0.8vw,14px);text-align:center;color:#ff5050;font-size:clamp(10px,0.95vw,14px);letter-spacing:2px">#</th>
          <th style="padding:clamp(6px,0.7vw,10px) clamp(8px,0.8vw,14px);text-align:left;color:#ff5050;font-size:clamp(10px,0.95vw,14px);letter-spacing:2px">Name</th>
          <th style="padding:clamp(6px,0.7vw,10px) clamp(8px,0.8vw,14px);text-align:right;color:#ff5050;font-size:clamp(10px,0.95vw,14px);letter-spacing:2px">Endless Score</th>
          <th style="padding:clamp(6px,0.7vw,10px) clamp(8px,0.8vw,14px);text-align:center;color:#ff5050;font-size:clamp(10px,0.95vw,14px);letter-spacing:2px">Wave</th>
          <th style="padding:clamp(6px,0.7vw,10px) clamp(8px,0.8vw,14px);text-align:right;color:#ff5050;font-size:clamp(10px,0.95vw,14px);letter-spacing:2px">Date</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="margin-top:clamp(12px,1.4vw,22px);display:flex;justify-content:center">
      <button id="endless-leaderboard-close" style="padding:clamp(8px,0.9vw,14px) clamp(20px,2.2vw,36px);background:linear-gradient(180deg,#ff5050,#aa1a1a);color:#fff;border:2px solid #ff7777;font-family:inherit;font-size:clamp(11px,1.1vw,15px);letter-spacing:3px;font-weight:bold;cursor:pointer">PLAY AGAIN</button>
    </div>
  `;
  modal.appendChild(panel);
  // 2026-05-20 v4 — Mount on document.body, not the scaled #app box,
  // so position:fixed actually fills the real viewport instead of
  // being clipped to #app's pre-scale ~900px frame on big monitors.
  // The `parent` arg is preserved on the signature for backward
  // compat but no longer used for mounting.
  void parent;
  document.body.appendChild(modal);
  panel.querySelector<HTMLButtonElement>('#endless-leaderboard-close')!.onclick = () => {
    modal.remove();
    onRestart();
  };
}
