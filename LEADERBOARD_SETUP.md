# Roman TD — Cross-player leaderboard setup

The game ships with two leaderboards:

- **LOCAL** — saved to the player's `localStorage`. Always available, never lost between sessions on the same device. No setup required.
- **GLOBAL** — saved to a shared Supabase Postgres table. Visible to every player on every device. Requires a 5-minute setup walkthrough below.

When the global leaderboard isn't configured, the in-game Hall of Glory transparently falls back to LOCAL only — no errors, no warnings, the game just shows "local scores only" instead of the GLOBAL / LOCAL tab switch.

---

## What you'll set up

A free Supabase project with one table (`public.scores`) and three row-level security policies. The leaderboard is **public read + validated public insert**, no signups, no auth — players just submit their name + score at the end of a run.

The client only ever uses the project's **anon (public)** key. The anon key ships in the build bundle and is safe to expose. Row-level security policies (see `supabase/schema.sql`) prevent abuse — the only thing the anon key can do is INSERT a row that passes our validation constraints, or SELECT rows for display.

---

## Step 1 — Create the Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in (free GitHub auth works).
2. Click **New project**. Pick a name like `roman-td-leaderboard`. Save the database password somewhere — you won't need it for this game, but Supabase requires it.
3. Choose any region (closer = faster for your players). Wait ~2 minutes for the project to spin up.

## Step 2 — Run the schema migration

1. In the Supabase dashboard, open **SQL Editor** (left sidebar).
2. Click **New query**.
3. Paste the entire contents of `supabase/schema.sql` from this repo into the editor.
4. Click **Run**. You should see "Success. No rows returned." That's correct — the migration creates the table + policies but doesn't insert any data.

Verify by clicking **Table Editor** → you should see a new `scores` table with the right columns.

## Step 3 — Grab your project credentials

1. Open **Project Settings** (gear icon, bottom left) → **API**.
2. Copy two values:
   - **Project URL** — looks like `https://abcdefg.supabase.co`
   - **Project API keys → anon public** — long string starting with `eyJ...` (a JWT)

These are the two values the game needs.

## Step 4 — Wire them into the build

### Local development

Create `.env.local` in the project root (it's already in `.gitignore` so it won't leak):

```bash
VITE_SUPABASE_URL=https://abcdefg.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...your-anon-key...
```

Then `npm run dev` picks them up automatically. Play through a run, submit a score, refresh the page — you should see the GLOBAL tab in the Hall of Glory with your score on it.

### GitHub Pages deployment

The game deploys via GitHub Actions to GitHub Pages. The env vars need to be in the workflow's environment:

1. In your GitHub repo, **Settings → Secrets and variables → Actions → New repository secret**.
2. Add two secrets:
   - Name: `VITE_SUPABASE_URL`, Value: your URL
   - Name: `VITE_SUPABASE_ANON_KEY`, Value: your anon key
3. Edit `.github/workflows/deploy.yml` and add these to the `env` block of the build step (see the workflow file — it's already structured to pull from secrets, you just need to add the two lines).

Once both are set, push any commit. The deploy will bake the env vars into the bundle, and the live game at `https://falatua.github.io/roman-td/` will use the global leaderboard.

---

## Step 5 — Test it

Open the deployed game (or `npm run dev`). Play any run to completion (win or lose). At the end of the run, the Hall of Glory should:

1. Pop the end-summary card.
2. Prompt for a name (defaulting to whatever you etched at game start).
3. Submit the score to Supabase.
4. Open the leaderboard with **🌐 GLOBAL** active by default + a **📜 LOCAL** tab beside it.

Go to your Supabase dashboard → **Table Editor → scores** to confirm the row landed.

---

## Resetting the leaderboard

To wipe the global leaderboard (e.g., during balance testing), run this in the Supabase SQL editor:

```sql
truncate public.scores;
```

To wipe a single player's entries:

```sql
delete from public.scores where name = 'TROLL';
```

To wipe local entries on your own device, clear localStorage in the browser devtools (`Application → Local Storage → roman_td_leaderboard_v2`).

---

## What happens if you skip this setup

The game works exactly the same — the player sees:

- The "etch your name in the history of Rome" prompt at game start.
- The end-of-run name prompt + score submission.
- The Hall of Glory with their saved scores.

The only difference is the leaderboard only shows scores from **this device's localStorage**, not from every player. The "🌐 GLOBAL / 📜 LOCAL" tab switch is hidden — there's only the LOCAL view. No error toasts, no failed network requests visible to the player.

You can configure Supabase at any time later — existing localStorage entries stay on the player's device, and new runs start landing in the global table immediately.

---

## Diagnosing submission failures (2026-05-20 v4)

When a global submission fails, the Hall of Glory now shows a red banner with:

- **Why** — the actual reason (HTTP status decoded, network block detected, etc.)
- **Endpoint** — which path the bundle is hitting:
  - 🛠 `localStorage override` — a runtime override was set (see below)
  - 🛡 `Cloudflare Worker proxy` — the `VITE_LEADERBOARD_PROXY_URL` secret is wired
  - 🔗 `direct to supabase.co` — no proxy; bundle talks straight to Supabase
- **HTTP** — last server status code (only shown if any attempt reached the server)
- **Attempts** — how many retries were burned (max 5)
- **↻ RETRY SUBMIT** button — re-fires the insert without replaying the run
- **🛠 SET PROXY URL** button — opens a prompt; paste a Cloudflare Worker URL and the bundle uses it on the next reload

### Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `HTTP 401 / 403` | Anon key wrong or RLS denies insert | Refresh `VITE_SUPABASE_ANON_KEY` in GitHub Actions; re-run `supabase/schema.sql` |
| `HTTP 400` + `PGRST204` + "Could not find the 'hero_id' column" | Live `scores` table predates the hero migration — column wasn't added | Run the **HOT FIX SQL** below in Supabase SQL editor (one ALTER TABLE statement) |
| `HTTP 404` | Wrong project URL or table dropped | Verify `VITE_SUPABASE_URL`; re-run schema |
| `Failed to fetch` / `NetworkError` | Ad-blocker / privacy extension is blocking `*.supabase.co` | Click **🛠 SET PROXY URL** in the banner and point at your Cloudflare Worker (see `cloudflare-worker/README.md`) |
| Times out 5 times | Slow internet or regional Supabase issue | Retry later, or use the Worker proxy |

### HOT FIX: missing hero_id column

If the failure banner reads `PGRST204 ... Could not find the 'hero_id' column of 'scores' in the schema cache`, the live Supabase project is one migration behind. The hero system added a `hero_id text null` column to the schema but the migration was never run against the deployed project. The client now auto-strips `hero_id` from the payload and retries (so submits still succeed — just without hero info recorded), but the proper fix is to run the migration in Supabase:

1. Supabase dashboard → **SQL Editor** → **New query**
2. Paste:
   ```sql
   alter table public.scores
     add column if not exists hero_id text null;
   ```
3. Click **Run**. Idempotent (`if not exists`), safe to run multiple times.
4. Wait ~10 seconds for the PostgREST schema cache to refresh, then submit a new score. The failure banner should now show ✓ SCORE SUBMITTED and the hero suffix should appear next to your name.

After running this once, future hero-bearing submissions land cleanly with the `⚔ HeroName` suffix in the NAME column.

### Runtime proxy override (no rebuild required)

If the `VITE_LEADERBOARD_PROXY_URL` GitHub secret isn't wired yet (or you want to test a different proxy URL fast), open DevTools console and run:

```js
localStorage.setItem(
  'roman_td_leaderboard_proxy_override',
  'https://your-worker.your-name.workers.dev'
);
location.reload();
```

The override takes priority over the build-time env var. Clear it with:

```js
localStorage.removeItem('roman_td_leaderboard_proxy_override');
location.reload();
```

The **🛠 SET PROXY URL** button on the failure banner does exactly this — for non-technical players who hit the issue.
