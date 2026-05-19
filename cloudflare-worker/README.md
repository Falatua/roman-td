# Roman TD — Cloudflare Worker leaderboard proxy

The game's global leaderboard talks to Supabase directly by default. For most players this works perfectly. But some networks / DNS providers / browser environments mishandle requests to `*.supabase.co` and return synthetic 404s (we've seen real `PGRST125 "Invalid path"` responses where the same URL works fine from other machines).

This Cloudflare Worker is a tiny pass-through proxy. The game routes leaderboard requests through `https://your-worker.workers.dev/rest/v1/...` instead of `https://your-project.supabase.co/rest/v1/...`. The traffic looks like generic Cloudflare Worker traffic, which every network treats as standard cloud infrastructure.

You only need to deploy this if players are reporting the leaderboard staying stuck in "OFFLINE FOR NOW" / `Fetch error: http 404` after they've tried hard-refresh + incognito.

---

## 5-minute deploy (no CLI needed)

1. **Sign in to Cloudflare.** Go to <https://dash.cloudflare.com> and sign in (free account works). If you don't have one, sign up — the leaderboard usage will sit comfortably inside the free tier (100,000 requests/day; this game uses < 1,000/day even with heavy play).

2. **Create a new Worker.**
   - Left sidebar → **Workers & Pages**
   - Click **Create application** → **Create Worker** (or "Hello World" → Create)
   - Name it `roman-td-leaderboard` (or whatever you want — the name becomes part of the URL)
   - Click **Deploy** (it deploys a hello-world starter)

3. **Replace the code.**
   - On the Worker's overview page, click **Edit code**
   - Delete everything in the editor
   - Paste the entire contents of `leaderboard-proxy.js` from this folder
   - Click **Save and deploy**

4. **Copy your Worker URL.**
   - It'll look like `https://roman-td-leaderboard.YOURNAME.workers.dev`
   - Copy the whole URL (no trailing slash)

5. **Add it to GitHub Actions secrets.**
   - GitHub → your `roman-td` repo → **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `VITE_LEADERBOARD_PROXY_URL`
   - Value: paste your Worker URL from step 4
   - Click **Add secret**

6. **Trigger a rebuild.**
   - Either: push any small commit to `main`
   - Or: go to the Actions tab → **Deploy to GitHub Pages** workflow → **Run workflow** → main branch → green button
   - When the deploy finishes (~40 seconds), the new bundle will route through the Worker

7. **Hard refresh the live site** (`Cmd+Shift+R` on Mac) and the leaderboard should load.

---

## Verifying it works

After deploying:

1. Open the live site → Hall of Glory → GLOBAL tab
2. Open DevTools → **Console** tab
3. Watch for the line `[leaderboard] GET https://...`
4. If the URL starts with your Worker domain (`workers.dev`) and the leaderboard table populates, the proxy is live.
5. If you still see `supabase.co` in the URL, the env var didn't make it into the bundle — re-check the secret name (must be exactly `VITE_LEADERBOARD_PROXY_URL`, case-sensitive).

---

## Reverting to direct Supabase

If you want to stop using the proxy at any time:

1. **GitHub → Settings → Secrets and variables → Actions**
2. Delete the `VITE_LEADERBOARD_PROXY_URL` secret (or just leave it blank)
3. Trigger a rebuild
4. The bundle reverts to talking directly to `cqenkgkhfbhegkmvniow.supabase.co`

The Worker stays deployed (free, so it costs nothing to leave it sitting there) — you can flip back to it any time by re-adding the secret.

---

## Updating the Supabase project URL

If you ever migrate the Supabase project (different `ref`), edit `leaderboard-proxy.js` line ~27 (`SUPABASE_PROJECT_URL`) and redeploy via the dashboard. Five seconds of edit + click "Save and deploy."
