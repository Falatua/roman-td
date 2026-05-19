-- Roman TD — Supabase leaderboard schema (v1, 2026-05-19)
--
-- Run this in the Supabase SQL editor to set up the cross-player
-- leaderboard. Reads + writes happen with the project's ANON key —
-- no auth required, but row-level security keeps the table safe:
--   • SELECT is open (anyone can read scores)
--   • INSERT is open BUT validated (length/score ranges)
--   • UPDATE + DELETE are blocked at the policy level
--
-- The client always sorts by `score DESC` + filters by `mode`,
-- so a single composite index covers the hot read path.

-- ─── TABLE ───────────────────────────────────────────────────────────
create table if not exists public.scores (
  id              uuid          primary key default gen_random_uuid(),
  name            text          not null check (length(name) between 1 and 12),
  score           integer       not null check (score between 0 and 9999999),
  wave            integer       not null check (wave between 0 and 9999),
  won             boolean       not null,
  quests_completed integer      not null default 0 check (quests_completed >= 0),
  towers_combined integer       not null default 0 check (towers_combined >= 0),
  date_str        text          not null,
  mode            text          not null default 'campaign'
                                check (mode in ('campaign', 'endless')),
  created_at      timestamptz   not null default now()
);

-- ─── INDEXES ─────────────────────────────────────────────────────────
-- Top-N retrieval per mode hits this. Created if not already there.
create index if not exists idx_scores_mode_score
  on public.scores (mode, score desc, created_at desc);

-- ─── ROW-LEVEL SECURITY ──────────────────────────────────────────────
alter table public.scores enable row level security;

-- Anyone can read every score row.
drop policy if exists "Public read" on public.scores;
create policy "Public read"
  on public.scores
  for select
  using (true);

-- Anyone can insert a row. The check constraints above + this policy's
-- WITH CHECK clause enforce the validation. Notably no other policies
-- exist, so UPDATE and DELETE are denied automatically.
drop policy if exists "Public insert" on public.scores;
create policy "Public insert"
  on public.scores
  for insert
  with check (
    length(name)            between 1 and 12
    and score               between 0 and 9999999
    and wave                between 0 and 9999
    and quests_completed   >= 0
    and towers_combined    >= 0
  );

-- ─── MIGRATIONS ──────────────────────────────────────────────────────
-- 2026-05-19 — Hero System v1. Adds an optional hero_id column so
-- each score row records which hero the player drafted that run.
-- Idempotent (uses `if not exists`) so re-running this whole file
-- on an existing project is safe. Nullable: pre-hero rows stay
-- null and the Hall of Glory renders them unchanged.
--
-- Allowed values are enforced client-side from herodefs.json so we
-- don't add a CHECK constraint here — that would force a schema
-- migration every time we add a hero. Worst case a malformed
-- hero_id string lands in the DB and the Hall renders no suffix
-- for that row (renderHeroSuffix returns empty when the lookup misses).
alter table public.scores
  add column if not exists hero_id text null;

-- ─── HOUSEKEEPING (optional) ─────────────────────────────────────────
-- Trim the table to the top 500 per mode periodically. Not strictly
-- required (Supabase free tier handles tens of millions of rows) but
-- keeps queries snappy and the table small.
--
-- Uncomment + run as a cron (e.g. weekly) in Supabase's pg_cron
-- extension if the table grows past ~10k rows:
--
-- with ranked as (
--   select id,
--          row_number() over (partition by mode order by score desc, created_at desc) rn
--   from public.scores
-- )
-- delete from public.scores
-- using ranked
-- where public.scores.id = ranked.id
--   and ranked.rn > 500;
