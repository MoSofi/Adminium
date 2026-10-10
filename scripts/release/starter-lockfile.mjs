#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Make the lockfile a new project starts with inside the desktop app.
 *
 *   node scripts/release/starter-lockfile.mjs
 *
 * It makes a new project exactly as the app does (the built CLI's `new`, then
 * the three packages an app's screens are built with), asks npm to resolve it
 * without installing anything, and writes two files the app carries:
 *
 *   apps/desktop/resources/starter/starter-lock.json   what to install
 *   apps/desktop/resources/starter/starter.json        what it was made for
 *
 * A new project is given this lockfile only when it lists exactly what
 * `starter.json` says (`apps/server/src/project/starter-lock.ts`), and is then
 * installed with `npm ci`: the packages a release was tried with are the
 * packages a person gets, this month and next.
 *
 * RUN IT AFTER THE ENGINE IS ON NPM. A new project pins the engine's exact
 * version, so that version must be published before a lockfile for it can
 * exist; this script asks the registry first and says so plainly when it is
 * not there, because the other way to find out is a person's first project
 * failing to install.
 *
 * It needs the server built (`apps/server/dist`) and the network (package
 * metadata only; nothing is installed). The two files are not committed.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(ROOT, 'apps', 'server', 'dist');
const OUT = join(ROOT, 'apps', 'desktop', 'resources', 'starter');
const REGISTRY = 'https://registry.npmjs.org/';

const fail = (message) => {
  console.error(`starter-lockfile: ${message}`);
  process.exit(1);
};
// On Windows `npm` is `npm.cmd`, which only a shell can start.
const run = (command, args, opts = {}) => spawnSync(command, args, { encoding: 'utf8', shell: process.platform === 'win32' && command === 'npm', ...opts });

let starter;
let version;
try {
  starter = await import(pathToFileURL(join(DIST, 'project', 'starter-lock.js')).href);
  ({ APP_VERSION: version } = await import(pathToFileURL(join(DIST, 'version.js')).href));
} catch {
  fail(`the server is not built (${DIST}). Run \`pnpm --filter @adminium/server build\` first.`);
}

// The engine, and the public client at the same version: both must be on npm (a new project pins them exactly).
for (const name of ['@adminiumjs/adminium', '@adminiumjs/public-client']) {
  const seen = run('npm', ['view', `${name}@${version}`, 'version', '--registry', REGISTRY]);
  if (seen.status !== 0 || seen.stdout.trim() !== version) {
    fail(`${name}@${version} is not on npm. Publish the engine first: a new project in the app installs exactly that version.`);
  }
}

const work = mkdtempSync(join(tmpdir(), 'adminium-starter-'));
try {
  const made = run(process.execPath, [join(DIST, 'cli', 'index.js'), 'new', 'starter', '--yes', '--no-install', '--no-git', '--database', 'sqlite:./data/app.sqlite'], {
    cwd: work,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
  });
  if (made.status !== 0) fail(`\`adminium new\` failed:\n${made.stdout}${made.stderr}`);
  const project = join(work, 'starter');
  starter.addScreenPackagesTo(project, version);

  const locked = run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund', '--registry', REGISTRY], { cwd: project });
  if (locked.status !== 0) fail(`npm could not resolve the starter:\n${locked.stdout}${locked.stderr}`);

  const manifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
  const lock = readFileSync(join(project, 'package-lock.json'), 'utf8');
  const packages = Object.keys(JSON.parse(lock).packages ?? {}).length - 1;
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, starter.STARTER_LOCK), lock);
  writeFileSync(join(OUT, starter.STARTER_MANIFEST), `${JSON.stringify({ engine: version, ...starter.listedDependencies(manifest) }, null, 2)}\n`);
  console.log(`starter-lockfile: ${packages} packages locked for Adminium ${version} → ${OUT}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
