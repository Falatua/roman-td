// Roman TD — Supabase leaderboard client (2026-05-19 v2 RESILIENT).
//
// Talks to a Supabase Postgres table over the REST API using the
// project's ANON key. No SDK — bundle stays lean and there's no
// dependency to track / update.
//
// Activation: set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY in
// `.env.local` (dev) or as GitHub Actions secrets injected into the
// build (production). When either is missing the leaderboard
// silently falls back to localStorage — the game stays fully
// playable without remote infrastructure.
//
// Resilience features (v2):
//   • 3-attempt retry with exponential backoff on every fetch
//   • 6-second per-attempt timeout (prevents indefinite hangs)
//   • localStorage cache of the last successful read (24h TTL)
//     — fetchTopScores returns the cache if all 3 attempts fail
//   • getLastFetchMeta() exposes whether the last result was fresh,
//     cached, or failed so the UI can show the appropriate message
//
// See `supabase/schema.sql` for the table layout + RLS policies.

// Vite exposes import.meta.env at build time. Both vars MUST start
// with VITE_ to make it into the bundle. The dev-mode default fall-
// back is empty strings (= no remote leaderboard).
const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? '';

export type LeaderboardMode = 'campaign' | 'endless';

export interface RemoteScoreRow {
  id?: string;
  name: string;
  score: number;
  wave: number;
  won: boolean;
  quests_completed: number;
  towers_combined: number;
  date_str: string;
  mode: LeaderboardMode;
  created_at?: string;
}

// ─── PUBLIC API ─────────────────────────────────────────────────────

// Whether the remote leaderboard is configured. Used by the UI to
// decide between a "GLOBAL" badge or a "LOCAL ONLY" badge on the
// leaderboard panel — and to skip the round-trip when there's no
// chance of success.
export function hasRemoteLeaderboard(): boolean {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// Where the last fetched data came from. The UI uses this to decide
// what status message to display:
//   • 'fresh'  → just-fetched from the live server, fully current
//   • 'cached' → all retries failed; serving from local cache
//   • 'failed' → all retries failed AND no cache available
//   • 'empty'  → fetch succeeded but the table is empty
//   • 'disabled' → env vars missing — no remote configured
export type FetchSource = 'fresh' | 'cached' | 'failed' | 'empty' | 'disabled';
export interface FetchMeta {
  source: FetchSource;
  ts: number;          // when this result was produced (ms epoch)
  cacheAgeMs?: number; // if source==='cached', age of the cache snapshot
  attempts?: number;   // how many retries were burned (0-3)
  errorReason?: string;// short user-readable hint about WHY all retries failed
  errorDetail?: string;// raw error string from the last failure (for the diagnostic)
  lastStatus?: number; // last HTTP status code if any retry returned a non-OK response
}

let lastFetchMeta: FetchMeta | null = null;

// Read the metadata of the most recent fetchTopScores call. The UI
// reads this AFTER fetchTopScores resolves so it can render the
// right status banner (fresh vs cached vs offline).
export function getLastFetchMeta(): FetchMeta | null {
  return lastFetchMeta;
}

// Fetch the top N scores for a given mode. Returns rows array on
// success (or cache hit), or null only if both fetch + cache fail.
// Empty array is distinct from null and means "table is empty".
// Whichever path was taken is reflected in getLastFetchMeta().
export async function fetchTopScores(
  mode: LeaderboardMode = 'campaign',
  limit = 10
): Promise<RemoteScoreRow[] | null> {
  if (!hasRemoteLeaderboard()) {
    console.warn('[leaderboard] Remote disabled — VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing from this build.');
    lastFetchMeta = { source: 'disabled', ts: Date.now() };
    return null;
  }

  const url = `${SUPABASE_URL}/rest/v1/scores`
    + `?mode=eq.${encodeURIComponent(mode)}`
    + `&order=score.desc,created_at.desc`
    + `&limit=${limit}`;

  // 3 attempts with exponential backoff (0ms, 400ms, 1200ms). Each
  // attempt has a 6-second timeout via AbortController so a network
  // stall can't hang the whole leaderboard view.
  const MAX_ATTEMPTS = 3;
  let lastErrorDetail = '';
  let lastStatus: number | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const r = await fetchWithTimeout(url, { method: 'GET', headers: authHeaders() }, 6000);
      if (!r.ok) {
        lastStatus = r.status;
        lastErrorDetail = `HTTP ${r.status}`;
        console.error(`[leaderboard] Attempt ${attempt}/${MAX_ATTEMPTS} → HTTP ${r.status}`);
        if (attempt < MAX_ATTEMPTS) await sleep(400 * Math.pow(3, attempt - 1));
        continue;
      }
      const rows = await r.json() as RemoteScoreRow[];
      // Cache the successful read so a future fetch-failure can show
      // a (potentially slightly-stale) snapshot instead of "offline".
      writeRemoteCache(mode, rows);
      lastFetchMeta = {
        source: rows.length === 0 ? 'empty' : 'fresh',
        ts: Date.now(),
        attempts: attempt
      };
      return rows;
    } catch (err) {
      const errStr = (err as any)?.message || String(err);
      lastErrorDetail = errStr;
      console.error(`[leaderboard] Attempt ${attempt}/${MAX_ATTEMPTS} failed:`, err);
      if (attempt < MAX_ATTEMPTS) await sleep(400 * Math.pow(3, attempt - 1));
    }
  }

  // Classify the failure so the UI can give the player a useful hint.
  let reason = 'Network request failed.';
  const errLow = lastErrorDetail.toLowerCase();
  if (lastStatus === 401 || lastStatus === 403) {
    reason = 'Authentication rejected by Supabase (HTTP ' + lastStatus + '). Check that VITE_SUPABASE_ANON_KEY is current in GitHub Actions secrets.';
  } else if (lastStatus && lastStatus >= 500) {
    reason = 'Supabase returned HTTP ' + lastStatus + '. The leaderboard backend is having issues — try again in a minute.';
  } else if (errLow.includes('failed to fetch') || errLow.includes('networkerror')) {
    reason = 'Browser blocked the request to supabase.co. Most common cause: an ad-blocker or privacy extension (uBlock Origin, Brave Shields, Privacy Badger) is blocking *.supabase.co. Try disabling it for this site, or open the leaderboard in an incognito window.';
  } else if (errLow.includes('abort') || errLow.includes('timeout')) {
    reason = 'Connection to supabase.co timed out 3 times in a row. Likely slow internet or a regional Supabase issue.';
  } else if (errLow) {
    reason = 'Fetch error: ' + errLow;
  }

  // All attempts failed — try the cache as a graceful fallback so the
  // player at least sees recent leaderboard data instead of nothing.
  const cached = readRemoteCache(mode);
  if (cached) {
    console.warn(`[leaderboard] All attempts failed — serving cache from ${new Date(cached.ts).toISOString()}`);
    lastFetchMeta = {
      source: 'cached',
      ts: Date.now(),
      cacheAgeMs: Date.now() - cached.ts,
      attempts: MAX_ATTEMPTS,
      errorReason: reason,
      errorDetail: lastErrorDetail,
      lastStatus
    };
    return cached.rows;
  }

  lastFetchMeta = {
    source: 'failed',
    ts: Date.now(),
    attempts: MAX_ATTEMPTS,
    errorReason: reason,
    errorDetail: lastErrorDetail,
    lastStatus
  };
  return null;
}

// Insert a single score row. Returns true on success. Retries up to
// 3 times so a transient network hiccup doesn't lose a player's
// score. Quietly fails (returns false) if remote isn't configured
// or every retry fails; the caller treats false as "local only".
export async function submitScore(
  row: Omit<RemoteScoreRow, 'id' | 'created_at'>
): Promise<boolean> {
  if (!hasRemoteLeaderboard()) return false;
  const url = `${SUPABASE_URL}/rest/v1/scores`;
  const body = JSON.stringify(row);
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const r = await fetchWithTimeout(url, {
        method: 'POST',
        headers: writeHeaders({ 'Prefer': 'return=minimal' }),
        body
      }, 6000);
      if (r.ok) return true;
      console.error(`[leaderboard] INSERT attempt ${attempt}/${MAX_ATTEMPTS} → HTTP ${r.status}`);
    } catch (err) {
      console.error(`[leaderboard] INSERT attempt ${attempt}/${MAX_ATTEMPTS} failed:`, err);
    }
    if (attempt < MAX_ATTEMPTS) await sleep(400 * Math.pow(3, attempt - 1));
  }
  return false;
}

// Convenience: build a remote-row from the existing local
// LeaderboardEntry shape. Keeps the data flow simple — the caller
// passes the same entry shape used for localStorage and we map it
// once here.
export function toRemoteRow(
  entry: { name: string; score: number; wave: number; won: boolean; questsCompleted: number; towersCombined: number; date: string },
  mode: LeaderboardMode = 'campaign'
): Omit<RemoteScoreRow, 'id' | 'created_at'> {
  return {
    name: entry.name,
    score: Math.max(0, Math.min(9999999, Math.round(entry.score))),
    wave: Math.max(0, Math.min(9999, entry.wave)),
    won: !!entry.won,
    quests_completed: Math.max(0, entry.questsCompleted),
    towers_combined: Math.max(0, entry.towersCombined),
    date_str: entry.date,
    mode
  };
}

// ─── INTERNAL ───────────────────────────────────────────────────────

// Auth headers (apikey + Bearer) for ALL requests. RLS reads these
// to recognize the call as authenticated by the anon role.
function authHeaders(): Record<string, string> {
  return {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
  };
}

// Write-request headers — add Content-Type when sending a body.
function writeHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...authHeaders(),
    'Content-Type': 'application/json',
    ...(extra ?? {}),
  };
}

// fetch() with a per-request timeout. Returns a rejected promise if
// the timeout fires before the response. AbortController is the
// idiomatic browser approach; falls back to a manual timer in case
// AbortController isn't available (very old browsers).
function fetchWithTimeout(url: string, opts: RequestInit, timeoutMs: number): Promise<Response> {
  if (typeof AbortController !== 'undefined') {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    return fetch(url, { ...opts, signal: ac.signal })
      .finally(() => clearTimeout(timer));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    fetch(url, opts)
      .then(r => { clearTimeout(timer); resolve(r); })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ─── localStorage cache (offline fallback) ──────────────────────────
// We keep the last successful SELECT result around so a transient
// network failure still produces a usable leaderboard view. Cache TTL
// is 24 hours; past that we discard so a player who's offline for
// days doesn't see ancient scores.
const CACHE_KEY = 'roman_td_leaderboard_cache_v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedScores { ts: number; rows: RemoteScoreRow[] }

function writeRemoteCache(mode: LeaderboardMode, rows: RemoteScoreRow[]) {
  try {
    const all = readAllCachedScores();
    all[mode] = { ts: Date.now(), rows };
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    // QuotaExceeded / private-mode write fail — non-fatal, just lose
    // the cache benefit. The game still works.
  }
}

function readRemoteCache(mode: LeaderboardMode): CachedScores | null {
  try {
    const all = readAllCachedScores();
    const entry = all[mode];
    if (!entry || !Array.isArray(entry.rows)) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) return null;
    return entry;
  } catch {
    return null;
  }
}

function readAllCachedScores(): Record<string, CachedScores> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (typeof parsed === 'object' && parsed) ? parsed : {};
  } catch {
    return {};
  }
}
