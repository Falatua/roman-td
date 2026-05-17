import { defineConfig } from 'vite';
import fs from 'fs';

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
    }
  ]
});
