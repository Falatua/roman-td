// Roman TD — Supabase leaderboard client (2026-05-19).
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

// Whether the remote leaderboard is configured. Used by the UI to
// decide between a "GLOBAL" badge or a "LOCAL ONLY" badge on the
// leaderboard panel — and to skip the round-trip when there's no
// chance of success.
export function hasRemoteLeaderboard(): boolean {
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}

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

// Fetch the top N scores for a given mode. Returns null if remote
// isn't configured, the network errors, or the API returns a non-OK
// response — every consumer treats null as "fall back to local".
// Successful empty table returns []; that's distinct from null and
// the UI uses the distinction to differentiate "no entries yet" from
// "couldn't reach the server".
export async function fetchTopScores(
  mode: LeaderboardMode = 'campaign',
  limit = 10
): Promise<RemoteScoreRow[] | null> {
  if (!hasRemoteLeaderboard()) {
    // Surface this in the console so a curious player / dev can tell
    // why the GLOBAL tab is silent: the bundle didn't get the env vars.
    console.warn('[leaderboard] Remote disabled — VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing from this build.');
    return null;
  }
  try {
    // PostgREST query format: ?mode=eq.X&order=score.desc&limit=N
    const url = `${SUPABASE_URL}/rest/v1/scores`
      + `?mode=eq.${encodeURIComponent(mode)}`
      + `&order=score.desc,created_at.desc`
      + `&limit=${limit}`;
    // Note: NO Content-Type header on GET — including it triggers a
    // CORS preflight for every read, doubling network round-trips on
    // first leaderboard open. apikey + Authorization are sufficient.
    const r = await fetch(url, { method: 'GET', headers: authHeaders() });
    if (!r.ok) {
      console.error(`[leaderboard] Supabase SELECT returned HTTP ${r.status}`);
      return null;
    }
    return await r.json() as RemoteScoreRow[];
  } catch (err) {
    // Network / CORS / JSON parse failure — fall back to local.
    console.error('[leaderboard] Supabase SELECT failed:', err);
    return null;
  }
}

// Insert a single score row. Returns true on success. Quietly fails
// (returns false) if remote isn't configured or the network is down;
// the caller is responsible for surfacing this to the player as a
// "local only" badge on the leaderboard panel.
export async function submitScore(
  row: Omit<RemoteScoreRow, 'id' | 'created_at'>
): Promise<boolean> {
  if (!hasRemoteLeaderboard()) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/scores`, {
      method: 'POST',
      headers: writeHeaders({ 'Prefer': 'return=minimal' }),
      body: JSON.stringify(row)
    });
    if (!r.ok) {
      console.error(`[leaderboard] Supabase INSERT returned HTTP ${r.status}`);
    }
    return r.ok;
  } catch {
    return false;
  }
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
