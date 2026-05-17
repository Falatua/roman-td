import { defineConfig } from 'vite';
import fs from 'fs';

export default defineConfig({
  base: './',
  server: { port: 5173, host: '127.0.0.1' },
  build: { target: 'es2020', sourcemap: true },
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
