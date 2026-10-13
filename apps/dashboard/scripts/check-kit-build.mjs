// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The kit for an app's own screens, as built: run as the last step of
 * `pnpm build`.
 *
 * What it holds to (vite.config.ts makes it, src/kit-host/ is its source):
 *
 *  - `dist/assets/kit/kit.json` names the door, and the door is a file there
 *    that exports `mount`;
 *  - the door is small: a screen that mounts one part pays for one, so no
 *    part, no React and no words may be in it;
 *  - every file the door reaches, by a static or a dynamic import, is in
 *    `dist/assets/`: a mapped staff host passes only that directory through;
 *  - the dashboard's own page loads none of the kit's files;
 *  - the words files are the catalogues' (`gen-kit-words.mjs --check`).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
/** The door's ceiling, gzipped. It is about 0.8 KiB today. */
const DOOR_GZ_BYTES = 3 * 1024;

function fail(message) {
  console.error(`check-kit-build: FAIL: ${message}`);
  process.exit(1);
}

const manifestPath = join(dist, 'assets', 'kit', 'kit.json');
if (!existsSync(manifestPath)) fail('dist/assets/kit/kit.json is missing. Did the build run?');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.contract !== 1) fail(`kit.json says contract ${String(manifest.contract)}, expected 1.`);
if (typeof manifest.entry !== 'string' || !/^kit-[\w-]+\.js$/.test(manifest.entry)) fail(`kit.json names no door (${String(manifest.entry)}).`);
if (manifest.styles !== null && (typeof manifest.styles !== 'string' || !existsSync(join(dist, 'assets', 'kit', manifest.styles)))) fail(`kit.json names a sheet that is not there (${String(manifest.styles)}).`);

const door = `assets/kit/${manifest.entry}`;
if (!existsSync(join(dist, door))) fail(`${door} is missing.`);
const doorSource = readFileSync(join(dist, door), 'utf8');
if (!/export\{[^}]*\bas mount\b|export\{[^}]*\bmount\b/.test(doorSource)) fail(`${door} does not export mount.`);
const doorGz = gzipSync(doorSource).length;
if (doorGz > DOOR_GZ_BYTES) fail(`${door} is ${String(doorGz)} bytes gz, over ${String(DOOR_GZ_BYTES)}: a part or a library is in the door. Load it with a dynamic import.`);

// Everything the door reaches.
const seen = new Set();
const queue = [door];
while (queue.length > 0) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);
  if (!file.startsWith('assets/')) fail(`${file} is outside assets/: a mapped staff host would not serve it.`);
  if (!existsSync(join(dist, file))) fail(`${file} is imported by the kit and is not in the build.`);
  if (!file.endsWith('.js')) continue;
  const source = readFileSync(join(dist, file), 'utf8');
  for (const found of source.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) queue.push(posix.join(posix.dirname(file), found[1]));
  for (const found of source.matchAll(/["'](assets\/[^"']+\.(?:js|css))["']/g)) queue.push(found[1]);
}

const html = readFileSync(join(dist, 'index.html'), 'utf8');
if (html.includes('/assets/kit/')) fail('dist/index.html loads a file of the kit: the dashboard must not pay for it.');

const words = spawnSync(process.execPath, [join(root, 'scripts', 'gen-kit-words.mjs'), '--check'], { encoding: 'utf8' });
if (words.status !== 0) fail(`the kit's words are out of date. Run \`node scripts/gen-kit-words.mjs\`.\n${words.stderr}`);

const kitFiles = [...seen].filter((file) => file.startsWith('assets/kit/')).length;
console.log(`check-kit-build: OK: door ${(doorGz / 1024).toFixed(1)} KiB gz, ${String(seen.size)} files reached (${String(kitFiles)} the kit's own), words in step`);
