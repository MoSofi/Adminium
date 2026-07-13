/**
 * serve-static — zero-dependency static file server for the built Storybook.
 *
 * Used two ways:
 *  - as a library: `import { serveStatic } from './serve-static.mjs'` (a11y-sweep)
 *  - as a CLI: `node scripts/serve-static.mjs <dir> <port>` (Playwright webServer)
 *
 * Deliberately dependency-free so the VRT/a11y harness adds no extra
 * devDependencies beyond @playwright/test + @axe-core/playwright.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Serve `rootDir` on 127.0.0.1:`port`.
 * @param {string} rootDir absolute path to the directory to serve
 * @param {number} port
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export function serveStatic(rootDir, port) {
  const root = resolve(rootDir);
  const server = createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    // normalize + containment check: never escape the root directory
    let filePath = normalize(join(root, urlPath));
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, 'index.html');
    }
    if (!existsSync(filePath)) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(filePath).pipe(res);
  });
  return new Promise((resolveServer, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolveServer({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r(undefined))),
      });
    });
  });
}

// CLI mode: node scripts/serve-static.mjs <dir> <port>
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [dir = 'storybook-static', portArg = '6106'] = process.argv.slice(2);
  const abs = resolve(fileURLToPath(new URL('..', import.meta.url)), dir);
  const { url } = await serveStatic(abs, Number(portArg));
  console.log(`[serve-static] serving ${abs} at ${url}`);
}
