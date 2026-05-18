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
