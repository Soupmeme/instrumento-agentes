import { defineConfig, type Plugin } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';

/**
 * Development server only (never in the build): lets the dev experiments save files into
 * `evidence/`, so the sweep tool (`__exp.sweepShots`) can leave screenshots on disk for the
 * logbook and `__exp.verify()` can leave its report. POST /__evidence?path=sub/dir/file.png with the
 * bytes as the body. It only writes inside `evidence/`, only plain file names, at most 20 MB.
 */
function evidenceSaver(): Plugin {
  const root = resolve('evidence');
  return {
    name: 'evidence-saver',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__evidence', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        const wanted = new URL(req.url ?? '', 'http://localhost').searchParams.get('path') ?? '';
        const target = normalize(join(root, wanted));
        if (!/^[A-Za-z0-9._\-/]+$/.test(wanted) || wanted.includes('..') || !target.startsWith(root + '\\') && !target.startsWith(root + '/')) {
          res.statusCode = 400;
          res.end('bad path');
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (c: Buffer) => {
          size += c.length;
          if (size <= 20_000_000) chunks.push(c);
        });
        req.on('end', () => {
          if (size > 20_000_000) {
            res.statusCode = 413;
            res.end('too large');
            return;
          }
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, Buffer.concat(chunks));
          res.end(`saved ${wanted} (${size} bytes)`);
        });
      });
    },
  };
}

// base './' so the built site works from any GitHub Pages sub-path.
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  plugins: [evidenceSaver()],
});
