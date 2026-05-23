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
// 2026-05-19 — Hardened against env-var foot-guns:
//   • trim() to strip stray whitespace / newlines that some CI/CD
//     systems leave when injecting secrets
//   • strip a single trailing slash so the URL builder doesn't
//     accidentally produce a `//rest/v1/scores` double-slash that
//     SOME PostgREST setups reject with PGRST125 "Invalid path".
const SUPABASE_URL = ((import.meta as any).env?.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const SUPABASE_ANON_KEY = ((import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? '').trim();
// 2026-05-19 — Optional Cloudflare Worker proxy override. When the
// player's network mishandles requests to *.supabase.co (real
// PGRST125 reports + curl-from-cellular confirming server-side
// rejection), route through a Worker on workers.dev which presents
// as generic Cloudflare traffic. Setup steps + Worker code live
// in cloudflare-worker/. If the env var is empty, we fall back to
// the direct Supabase URL (existing behavior).
const LEADERBOARD_PROXY_URL_ENV = ((import.meta as any).env?.VITE_LEADERBOARD_PROXY_URL ?? '').trim().replace(/\/+$/, '');

// 2026-05-20 v4 — Runtime proxy override. Lets a player (or the host
// admin) point the bundle at a Cloudflare Worker via localStorage WITHOUT
// rebuilding. Usage:
//   localStorage.setItem('roman_td_leaderboard_proxy_override',
//     'https://your-worker.workers.dev');
//   // reload the page
// Set to '' or remove the key to fall back to env / direct mode.
// Helpful when the GitHub-Actions secret hasn't been wired yet, or
// when a player wants to try a different proxy for diagnostics.
const PROXY_OVERRIDE_KEY = 'roman_td_leaderboard_proxy_override';
function getProxyOverride(): string {
  try {
    const raw = localStorage.getItem(PROXY_OVERRIDE_KEY) ?? '';
    return raw.trim().replace(/\/+$/, '');
  } catch { return ''; }
}
export function setLeaderboardProxyOverride(url: string | null): void {
  try {
    if (!url) localStorage.removeItem(PROXY_OVERRIDE_KEY);
    else localStorage.setItem(PROXY_OVERRIDE_KEY, url.trim());
  } catch { /* private-mode: silently ignore */ }
}
function effectiveApiBase(): string {
  const override = getProxyOverride();
  return override || LEADERBOARD_PROXY_URL_ENV || SUPABASE_URL;
}
function endpointKind(): 'override' | 'env-proxy' | 'direct' | 'none' {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return 'none';
  if (getProxyOverride()) return 'override';
  if (LEADERBOARD_PROXY_URL_ENV) return 'env-proxy';
  return 'direct';
}
/** Diagnostics for the UI: which endpoint is the bundle hitting? */
export function getLeaderboardDiagnostics(): { base: string; kind: ReturnType<typeof endpointKind>; hasAuth: boolean } {
  return { base: effectiveApiBase(), kind: endpointKind(), hasAuth: !!SUPABASE_ANON_KEY };
}

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
  // 2026-05-19 — Hero pick recorded with the run. Nullable for
  // backward compat with pre-hero rows. Hall of Glory renders a
  // "⚔ HeroName" suffix in the NAME column when non-null.
  hero_id?: string | null;
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

  // 2026-05-19 — Switched to URLSearchParams to guarantee proper
  // RFC-3986 encoding. The previous hand-concatenated URL worked in
  // every test I ran, but a player reported PGRST125 "Invalid path
  // specified in request URL" — Supabase rejecting the URL. Going
  // through URLSearchParams normalizes commas, spaces, and any
  // other special chars the same way every browser does.
  // Also explicitly setting `select=*` so PostgREST returns rows
  // even if a future project-level default policy gates SELECT.
  const params = new URLSearchParams({
    select: '*',
    mode: `eq.${mode}`,
    order: 'score.desc,created_at.desc',
    limit: String(limit),
  });
  const url = `${effectiveApiBase()}/rest/v1/scores?${params.toString()}`;
  // Verbose log so a player reporting "still doesn't work" can paste
  // the exact URL their browser is calling — eliminates guesswork.
  // eslint-disable-next-line no-console
  console.log('[leaderboard] GET', url);

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

/** Structured result of a submitScore call. The previous boolean return
 *  meant the UI couldn't tell the player WHY a submission failed. With
 *  this shape the failure banner surfaces the actual reason + endpoint
 *  hit so the player (or the maintainer) can self-diagnose without
 *  digging into DevTools. */
export interface SubmitResult {
  ok: boolean;
  attempts: number;
  url: string;
  endpoint: 'override' | 'env-proxy' | 'direct' | 'none';
  /** Last HTTP status if any attempt reached the server. */
  status?: number;
  /** Short human-readable reason for failure. */
  errorReason?: string;
  /** Raw error string from the last attempt (for diagnostics). */
  errorDetail?: string;
  /** Server-returned body on the last failed attempt (Supabase often
   *  returns a JSON error message that helps pinpoint the cause). */
  serverBody?: string;
}

// Insert a single score row. Returns a structured SubmitResult so the
// caller can show the player a meaningful failure banner instead of a
// generic "failed". Retries up to 5 times with exponential backoff so
// a transient network hiccup doesn't lose a player's score. Each
// attempt has a 10-second timeout (write reliability matters more
// than first-paint speed).
//
// 2026-05-20 v4 — retries 3 → 5, per-attempt timeout 6s → 10s, return
// changed from boolean → SubmitResult.
export async function submitScore(
  row: Omit<RemoteScoreRow, 'id' | 'created_at'>
): Promise<SubmitResult> {
  const kind = endpointKind();
  const base = effectiveApiBase();
  const url = `${base}/rest/v1/scores`;
  if (kind === 'none') {
    return { ok: false, attempts: 0, url, endpoint: kind, errorReason: 'Global leaderboard not configured for this build (missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY).' };
  }
  // 2026-05-20 — SCHEMA-MISSING COLUMN FALLBACK. PostgREST returns
  // HTTP 400 with code PGRST204 when the payload references a column
  // that doesn't exist on the table (e.g. hero_id when the
  // hero-system migration hasn't been run against the live
  // Supabase project). Stripping the offending column from the
  // payload and retrying is strictly better than failing — the
  // run still records under the player's name, just without the
  // hero suffix. The migration SQL is in supabase/schema.sql plus
  // a one-liner in LEADERBOARD_SETUP.md for the maintainer to run
  // when convenient; this fallback bridges the gap until then.
  let payload: any = { ...row };
  let droppedColumns: string[] = [];
  const body = () => JSON.stringify(payload);
  const MAX_ATTEMPTS = 5;
  const TIMEOUT_MS = 10_000;
  let lastStatus: number | undefined;
  let lastErrorDetail = '';
  let lastServerBody = '';
  // eslint-disable-next-line no-console
  console.log(`[leaderboard] POST ${url} (endpoint=${kind})`);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const r = await fetchWithTimeout(url, {
        method: 'POST',
        headers: writeHeaders({ 'Prefer': 'return=minimal' }),
        body: body()
      }, TIMEOUT_MS);
      if (r.ok) {
        return {
          ok: true, attempts: attempt, url, endpoint: kind, status: r.status,
          errorReason: droppedColumns.length > 0
            ? `Saved — but the live Supabase 'scores' table is missing column(s) ${droppedColumns.join(', ')}, so hero info wasn't recorded. Run the ALTER TABLE in supabase/schema.sql to enable full hero tracking.`
            : undefined
        };
      }
      lastStatus = r.status;
      // Try to capture the server's response body — Supabase usually
      // returns a JSON payload with `code` + `message` describing why
      // the insert was rejected (RLS, check constraint, schema mismatch).
      try {
        lastServerBody = (await r.text()).slice(0, 600);
      } catch { /* ignore */ }
      lastErrorDetail = `HTTP ${r.status}${lastServerBody ? ` · ${lastServerBody.slice(0, 200)}` : ''}`;
      console.error(`[leaderboard] INSERT attempt ${attempt}/${MAX_ATTEMPTS} → HTTP ${r.status}`, lastServerBody);
      // 2026-05-22 — IDEMPOTENT DEDUPE. When the caller supplies an `id`
      // (UUID) on the row, a duplicate insert returns HTTP 409 (PK
      // conflict) — that's the signal that an earlier attempt already
      // committed the row server-side and we're seeing a retry collide
      // with itself. Treat as success: the row IS in the table under
      // the requested id, the player's score IS recorded, the only
      // thing we "lost" was the response from the original attempt.
      //   ALSO: PostgREST surfaces the same condition as 400 with code
      // PGRST109 ("duplicate key value violates unique constraint") on
      // some setups. Match both so the fix is robust across PostgREST
      // versions / project configs.
      if (r.status === 409 || (r.status === 400 && /duplicate key|unique constraint|PGRST109/i.test(lastServerBody))) {
        console.warn(`[leaderboard] INSERT attempt ${attempt}/${MAX_ATTEMPTS} → ${r.status} duplicate-key — treating as success (row already in table).`);
        return {
          ok: true, attempts: attempt, url, endpoint: kind, status: r.status,
          errorReason: droppedColumns.length > 0
            ? `Saved — but the live Supabase 'scores' table is missing column(s) ${droppedColumns.join(', ')}, so hero info wasn't recorded. Run the ALTER TABLE in supabase/schema.sql to enable full hero tracking.`
            : 'Row already recorded — duplicate-submit detected and absorbed by the server.'
        };
      }
      // PGRST204 = "Could not find the 'X' column of 'Y' in the schema cache."
      // Parse the message, strip the missing column from payload, retry
      // immediately (without burning the retry-backoff budget).
      if (r.status === 400 && lastServerBody.includes('PGRST204')) {
        const m = /Could not find the '([^']+)' column/.exec(lastServerBody);
        if (m && m[1] && Object.prototype.hasOwnProperty.call(payload, m[1])) {
          const col = m[1];
          delete payload[col];
          droppedColumns.push(col);
          console.warn(`[leaderboard] Schema cache missing column '${col}' — stripping from payload and retrying without backoff.`);
          continue;     // skip the sleep below — retry immediately
        }
      }
    } catch (err) {
      lastErrorDetail = (err as any)?.message || String(err);
      console.error(`[leaderboard] INSERT attempt ${attempt}/${MAX_ATTEMPTS} failed:`, err);
    }
    if (attempt < MAX_ATTEMPTS) await sleep(400 * Math.pow(2, attempt - 1)); // 0.4, 0.8, 1.6, 3.2s
  }
  // Classify the failure so the UI can give the player a useful hint.
  let reason = 'Network request failed after 5 retries.';
  const lo = lastErrorDetail.toLowerCase();
  if (lastStatus === 401 || lastStatus === 403) {
    reason = `Supabase rejected the write with HTTP ${lastStatus}. Common causes: the anon key is wrong/expired, or the RLS policy on the scores table no longer allows public INSERT. Run supabase/schema.sql to refresh policies.`;
  } else if (lastStatus === 400 && lastServerBody.includes('PGRST204')) {
    // Couldn't auto-strip — the column exists in our payload but
    // we couldn't reduce further (every required column already
    // tried). Tell the user to run the migration.
    const colMatch = /Could not find the '([^']+)' column/.exec(lastServerBody);
    const col = colMatch?.[1] ?? 'a required column';
    reason = `Supabase schema is missing the '${col}' column. Run the latest supabase/schema.sql (specifically the ALTER TABLE adding ${col}) in your Supabase SQL editor to enable submissions.`;
  } else if (lastStatus === 404) {
    reason = `Endpoint returned HTTP 404 — the URL ${url} doesn't exist. Verify the Supabase project URL / Cloudflare Worker is deployed and pointed at the right project.`;
  } else if (lastStatus && lastStatus >= 500) {
    reason = `Supabase returned HTTP ${lastStatus}. The backend is having issues — try again in a minute.`;
  } else if (lo.includes('failed to fetch') || lo.includes('networkerror')) {
    reason = `Browser blocked the request. Most likely an ad-blocker or privacy extension is blocking ${new URL(url).host}. Try disabling it for this site or open in an incognito window.`;
  } else if (lo.includes('abort') || lo.includes('timeout')) {
    reason = 'Connection timed out 5 times in a row. Likely slow internet or a regional Supabase issue.';
  } else if (lo) {
    reason = `Fetch error: ${lastErrorDetail.slice(0, 240)}`;
  }
  return { ok: false, attempts: MAX_ATTEMPTS, url, endpoint: kind, status: lastStatus, errorReason: reason, errorDetail: lastErrorDetail, serverBody: lastServerBody };
}

// Convenience: build a remote-row from the existing local
// LeaderboardEntry shape. Keeps the data flow simple — the caller
// passes the same entry shape used for localStorage and we map it
// once here.
//
// 2026-05-19 — Optional heroId param threads the active hero pick
// through to the row. Pass `null` (or omit) for runs that pre-date
// the hero system so the DB column stays null and the Hall of Glory
// renders no hero suffix for legacy entries.
//
// 2026-05-22 — Optional `id` (UUID) param. When supplied, the row is
// inserted with that primary key instead of letting the DB generate
// one via `default gen_random_uuid()`. This is the linchpin of the
// duplicate-submit fix: every retry attempt (and the user's RETRY
// button) targets the same UUID, so a duplicate row is rejected by
// the PK uniqueness constraint and submitScore treats the 409 as
// success. The caller (Leaderboard.ts finalize) generates this UUID
// once per entry and stashes it on the entry object so subsequent
// re-submits reuse it.
export function toRemoteRow(
  entry: { name: string; score: number; wave: number; won: boolean; questsCompleted: number; towersCombined: number; date: string },
  mode: LeaderboardMode = 'campaign',
  heroId: string | null = null,
  id?: string | null
): Omit<RemoteScoreRow, 'created_at'> {
  const row: Omit<RemoteScoreRow, 'created_at'> = {
    name: entry.name,
    score: Math.max(0, Math.min(9999999, Math.round(entry.score))),
    wave: Math.max(0, Math.min(9999, entry.wave)),
    won: !!entry.won,
    quests_completed: Math.max(0, entry.questsCompleted),
    towers_combined: Math.max(0, entry.towersCombined),
    date_str: entry.date,
    mode,
    hero_id: heroId
  };
  if (id) row.id = id;
  return row;
}

// 2026-05-22 — Browser UUID v4 generator. Used by callers that want
// to pre-compute a stable row id so retries are idempotent. Prefers
// crypto.randomUUID() (every modern browser); falls back to a
// Math.random-based generator on ancient browsers that lack it. The
// fallback is NOT cryptographically secure but UUID v4 for a
// leaderboard row doesn't need to be — uniqueness is enough.
export function generateRowId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
      return (crypto as any).randomUUID();
    }
  } catch { /* fall through */ }
  // RFC4122 v4 fallback.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// 2026-05-22 — localStorage flag tracking which entries have already
// been submitted to Supabase. Belt-and-suspenders against the
// duplicate-submit problem: even if the user reloads + the retry
// button somehow fires again, this flag prevents a second POST.
// Signature combines name+score+wave+ts so two legitimately-different
// runs by the same player never collide. Auto-expires after 7 days
// to keep localStorage from growing unbounded.
const SUBMITTED_PREFIX = 'roman_td_lb_submitted_v1_';
const SUBMITTED_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export function submissionSignature(entry: { name: string; score: number; wave: number; ts: number }, mode: LeaderboardMode): string {
  return `${mode}|${entry.name}|${entry.score}|${entry.wave}|${entry.ts}`;
}
export function hasBeenSubmitted(sig: string): boolean {
  try {
    const raw = localStorage.getItem(SUBMITTED_PREFIX + sig);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    if (Date.now() - ts > SUBMITTED_TTL_MS) {
      // Stale entry — clean it up.
      try { localStorage.removeItem(SUBMITTED_PREFIX + sig); } catch { /* ignore */ }
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
export function markSubmitted(sig: string): void {
  try { localStorage.setItem(SUBMITTED_PREFIX + sig, String(Date.now())); } catch { /* private mode — skip */ }
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
