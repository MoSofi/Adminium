// SPDX-License-Identifier: AGPL-3.0-only
/**
 * After `build`: the dashboard's page AND the assistant's two files for an
 * app's staff address are in `dist`, and the second build left the first
 * whole.
 *
 * The server adds a tag for `/assets/milo/loader.js` to staff pages when that
 * file is in the static root it serves. A build that silently stopped
 * producing it would take the assistant off every staff address with no
 * error anywhere, and a second build that emptied `dist` would take the
 * dashboard with it. Both are checked here, where the build fails.
 *
 * The loader runs on every load of a page that is not ours: it imports
 * nothing and stays small.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const LOADER_MAX_GZ = 4 * 1024;
const problems = [];

for (const file of ['index.html', 'assets/milo/loader.js', 'assets/milo/panel.html']) {
  if (!existsSync(join(dist, file))) problems.push(`dist/${file} is missing`);
}
if (problems.length === 0) {
  const loader = readFileSync(join(dist, 'assets/milo/loader.js'), 'utf8');
  if (/\bimport\s*["'{*(]|^\s*import\s|\bfrom\s*["']/m.test(loader)) problems.push('dist/assets/milo/loader.js imports another file: it must stand alone');
  const size = gzipSync(loader).length;
  if (size > LOADER_MAX_GZ) problems.push(`dist/assets/milo/loader.js is ${String(size)} bytes gz, over ${String(LOADER_MAX_GZ)}`);
  const panel = readFileSync(join(dist, 'assets/milo/panel.html'), 'utf8');
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(panel)) problems.push('dist/assets/milo/panel.html holds an inline script, which the page’s content policy refuses');
  // One copy of each font: the second build names them as the first did.
  const fonts = readdirSync(join(dist, 'assets')).filter((name) => name.endsWith('.woff2') || name.endsWith('.woff'));
  const families = new Set(fonts.map((name) => name.replace(/-[A-Za-z0-9_-]{8}\.woff2?$/, '')));
  if (fonts.length !== families.size) problems.push(`dist/assets holds ${String(fonts.length)} font files for ${String(families.size)} fonts: a second copy was emitted`);
  if (existsSync(join(dist, 'assets', 'milo', 'assets'))) problems.push('dist/assets/milo/assets exists: the second build wrote its own copy of the assets');
  if (problems.length === 0) console.log(`check-milo-build: OK — loader ${(size / 1024).toFixed(1)} KiB gz, panel.html, ${String(fonts.length)} fonts once each`);
}
if (problems.length > 0) {
  for (const problem of problems) console.error(`check-milo-build: ${problem}`);
  process.exit(1);
}
