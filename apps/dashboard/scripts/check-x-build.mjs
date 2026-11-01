// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The pages a stranger sees at `/x/`, as built: run as the last step of
 * `pnpm build`.
 *
 * What it holds to (vite.x.config.ts makes it, src/x/ is its source):
 *
 *  - `dist/x/index.html` is there, and every script, style and preload it
 *    names is a file under `/x/assets/`: the page's content policy allows
 *    nothing else, so a file named anywhere else would not load;
 *  - every file the page reaches, by a static or a dynamic import, is under
 *    `dist/x/assets/` too, and none is a file of the dashboard's own build;
 *  - the page's first load (its entry, the styles and what the entry imports
 *    at once) stays under its own ceiling, gzipped ({@link FIRST_LOAD_GZ_BYTES},
 *    a ratchet with at least 1 KiB to spare);
 *  - the website loader `dist/x/embed.js` is there and small: under 4 KiB as
 *    it is served, with no `import` and no other global than `adminium`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

/**
 * The page's first load, gzipped: a ratchet like the dashboard's entry
 * budget. Measured 104,345 bytes on 2026-11-01 (React, the page's words
 * loader and English, the form's check without its schemas, the styles),
 * plus 2 KiB of minifier headroom. It may only go down.
 */
export const FIRST_LOAD_GZ_BYTES = 104 * 1024;
/** The loader's ceiling, as served (not gzipped). */
export const LOADER_BYTES = 4 * 1024;

function fail(message) {
  console.error(`check-x-build: FAIL: ${message}`);
  process.exit(1);
}

const pagePath = join(dist, 'x', 'index.html');
if (!existsSync(pagePath)) fail('dist/x/index.html is missing. Did the build run?');
const html = readFileSync(pagePath, 'utf8');
const named = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
if (named.length === 0) fail('dist/x/index.html names no file.');
for (const ref of named) {
  if (!ref.startsWith('/x/assets/')) fail(`dist/x/index.html names ${ref}, outside /x/assets/: the page's policy would refuse it.`);
  if (!existsSync(join(dist, ref.slice(1)))) fail(`dist/x/index.html names ${ref}, which is not in the build.`);
}

// Everything the page reaches, and what its first load is.
const entry = named.filter((ref) => ref.endsWith('.js'));
const first = new Set(named.map((ref) => ref.slice(1)));
const seen = new Set();
const queue = entry.map((ref) => ({ file: ref.slice(1), eager: true }));
while (queue.length > 0) {
  const { file, eager } = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  if (!file.startsWith('x/assets/')) fail(`${file} is reached by the page and is not under x/assets/.`);
  if (!existsSync(join(dist, file))) fail(`${file} is reached by the page and is not in the build.`);
  if (eager) first.add(file);
  if (!file.endsWith('.js')) continue;
  const source = readFileSync(join(dist, file), 'utf8');
  for (const found of source.matchAll(/\bimport\s*["']([^"']+)["']|\bfrom\s*["']([^"']+)["']/g)) {
    const target = found[1] ?? found[2];
    if (target.startsWith('.')) queue.push({ file: posix.join(posix.dirname(file), target), eager });
  }
  for (const found of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    if (found[1].startsWith('.')) queue.push({ file: posix.join(posix.dirname(file), found[1]), eager: false });
  }
  for (const found of source.matchAll(/["'](\/?(?:x\/)?assets\/[^"']+\.(?:js|css))["']/g)) {
    const target = found[1].replace(/^\//, '');
    if (!target.startsWith('x/')) fail(`${file} names ${found[1]}: a file of the dashboard's own build.`);
  }
}

let total = 0;
for (const file of first) total += gzipSync(readFileSync(join(dist, file))).byteLength;
if (total > FIRST_LOAD_GZ_BYTES) fail(`the page's first load is ${String(total)} bytes gz, over ${String(FIRST_LOAD_GZ_BYTES)}. Load the addition when it is needed.`);

const loaderPath = join(dist, 'x', 'embed.js');
if (!existsSync(loaderPath)) fail('dist/x/embed.js is missing: the website loader was not copied.');
const loader = readFileSync(loaderPath, 'utf8');
if (Buffer.byteLength(loader) >= LOADER_BYTES) fail(`the website loader is ${String(Buffer.byteLength(loader))} bytes, not under ${String(LOADER_BYTES)}.`);
if (/\bimport\b/.test(loader.replace(/\/\*[\s\S]*?\*\//g, ''))) fail('the website loader imports something: it is one file, no framework.');

console.log(`check-x-build: ok — first load ${(total / 1024).toFixed(1)} KiB gz (ceiling ${(FIRST_LOAD_GZ_BYTES / 1024).toFixed(1)}), loader ${String(Buffer.byteLength(loader))} bytes`);
