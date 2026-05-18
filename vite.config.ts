import { defineConfig } from 'vite';
import fs from 'fs';
import { execSync } from 'child_process';

// 2026-05-17 — Build-time version string baked into index.html via the
// `vite-html-version` plugin below. Format: "v<semver> · YYYY-MM-DD ·
// <short-sha>" so players can confirm at a glance which deploy they're
// running, and the user can compare against the latest commit on GitHub.
//
// All pieces are read at build time, so each `vite build` produces a
// stamp that uniquely identifies the deploy. Failures (missing file,
// no git history, no internet on a stale clone) fall back gracefully.
const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));
let gitSha = '';
try { gitSha = execSync('git rev-parse --short HEAD').toString().trim(); } catch { /* not a git checkout */ }
// 2026-05-17 — Date sourced from the GIT COMMIT date, not the build
// clock. Previously used new Date().toISOString().slice(0, 10) which
// returned UTC; CI servers are always in UTC so a US-evening commit
// showed "tomorrow" on the loading screen. Even using local-timezone
// new Date() doesn't help because CI builds the date wherever it ran.
//
// `git log -1 --format=%cs` returns the short commit date (YYYY-MM-DD)
// in the COMMITTER's local timezone (you, on your laptop). That date
// is baked into the commit and travels with it, so the build date on
// the loading screen always matches the day you actually shipped the
// code regardless of where/when the build runs.
//
// Falls back to local-clock if we're not in a git checkout.
let buildDate: string;
try {
  buildDate = execSync('git log -1 --format=%cs').toString().trim();
} catch {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  buildDate = `${yyyy}-${mm}-${dd}`;
}
const APP_VERSION = `v${pkg.version}${gitSha ? ' · ' + gitSha : ''} · ${buildDate}`;

export default defineConfig({
  base: './',
  server: { port: 5173, host: '127.0.0.1' },
  build: {
    target: 'es2020',
    // 2026-05-17 — Source maps disabled for production. We were shipping
    // a 3.5 MB .js.map alongside every deploy, slowing first-load on
    // GitHub Pages. Source maps only help developers in the browser
    // devtools; players don't need them. Re-enable temporarily if you
    // need to debug a production-only crash.
    sourcemap: false,
    rollupOptions: {
      output: {
        // 2026-05-17 — Split Pixi.js into its own chunk. Pixi is ~600 KB
        // unminified; keeping it separate from the game code lets the
        // browser cache it across deploys (the Pixi chunk's hash only
        // changes when the Pixi version itself changes, while the game
        // chunk re-hashes on every code edit). On the very first load
        // the two chunks download in parallel anyway, so it's a win
        // even before caching kicks in.
        manualChunks: {
          pixi: ['pixi.js']
        }
      }
    }
  },
  plugins: [
    {
      name: 'snap-receiver',
      configureServer(server) {
        server.middlewares.use('/__snap', (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', () => {
            const buf = Buffer.concat(chunks);
            fs.writeFileSync('/tmp/canvas-snap.png', buf);
            res.statusCode = 200; res.end('ok');
          });
        });
      }
    },
    // 2026-05-17 — Substitutes %APP_VERSION% in index.html at build time
    // (and on the dev server) so the loading screen shows the current
    // semver + short git SHA + build date above the eagle banner.
    {
      name: 'html-version',
      transformIndexHtml(html: string) {
        return html.replace(/%APP_VERSION%/g, APP_VERSION);
      }
    }
  ]
});
