#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Rehearse `npx @adminiumjs/adminium` against LOCAL code, without publishing.
 *
 * WHY THIS EXISTS. A published version number is immutable, so the first person
 * to find out that the tarball is broken must not be a user. The dev tree
 * cannot tell you: it resolves through pnpm's workspace links, runs from a
 * checkout that is obviously "a project", has every devDependency installed and
 * serves `apps/dashboard/dist` rather than the bundled copy. Every one of those
 * differences has hidden a real defect — a devDependency loaded by NAME at
 * runtime (`pino-pretty`, see apps/server/package.json's `//dependencies`), a
 * data directory chosen from the working directory, a stale `dashboard/`.
 *
 * So this builds the ACTUAL release tarballs (publish-npm.mjs --dry-run: the
 * same manifest surgery, the same X-ray), installs the flagship the way npx
 * does — into a prefix directory, not the one you run from — and hands you a
 * command that runs the CLI from a directory it has never seen, with its own
 * HOME.
 *
 * ── THE GATES ────────────────────────────────────────────────────────────────
 * The flagship carries its internal packages inside its tarball,
 * so it is installed ALONE and must not need anything Adminium from the
 * registry. After the install this checks, and fails loudly otherwise:
 *   - every `@adminium/*` / `@adminiumjs/*` package came from the local tarball
 *     or from inside it (`inBundle`), none from registry.npmjs.org;
 *   - the bundled packages are exactly the ones server-runtime-deps.json lists;
 *   - no dashboard-only library (React, Radix, Leaflet, …) was installed;
 *   - every dependency the flagship declares loads from inside the installed
 *     package, where the server loads it from, and React does not;
 * and it prints the installed size.
 *
 * Usage:
 *   node scripts/release/rehearse-npx.mjs            # pack, install, check, print how to run
 *   node scripts/release/rehearse-npx.mjs --smoke    # …then boot it, probe it, stop it
 *   node scripts/release/rehearse-npx.mjs --wizard   # …then run the setup wizard
 *   node scripts/release/rehearse-npx.mjs --start    # …then run `adminium start`
 *   node scripts/release/rehearse-npx.mjs --skip-pack --wizard   # reuse the tarballs
 *   node scripts/release/rehearse-npx.mjs --build    # `turbo run build` first
 *   node scripts/release/rehearse-npx.mjs --run-dir ~/scratch/try --wizard
 *   node scripts/release/rehearse-npx.mjs --home ~/scratch/home --run-dir .
 *
 * `--smoke` runs `adminium start` on 127.0.0.1 (port 4697 unless `--port` says
 * otherwise, because an owner's own instance usually holds 4600), waits for
 * `/api/v1/healthz` to answer `ok: true`, checks that `/` serves the dashboard,
 * stops the process and checks the port is free again.
 *
 * Run it from anywhere — every path it uses is derived from this file's own
 * location, so `node /path/to/adminium/scripts/release/rehearse-npx.mjs` works
 * with any working directory.
 *
 * The rehearsal lives under scripts/release/out/rehearsal/ (gitignored) and is
 * rebuilt from scratch each run. `--keep-home` preserves the fake HOME between
 * runs, so a second run finds the instance the first one created. `--run-dir`
 * and `--home` point those two elsewhere — at a real project, to rehearse the
 * other branch of the data-dir default, or at a directory you want to poke at
 * afterwards. Neither is ever deleted when you named it yourself.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = join(ROOT, 'scripts/release/out');
const REHEARSAL = join(OUT_DIR, 'rehearsal');
/** What npx has: a prefix holding the install, and nothing in the cwd. */
const PREFIX = join(REHEARSAL, 'prefix');
/** Default place the command is RUN from — not a project, and empty. `--run-dir` moves it. */
const DEFAULT_RUN_DIR = join(REHEARSAL, 'run');
/** Default HOME, so a rehearsal never writes to the real ~/.adminium. `--home` moves it. */
const DEFAULT_HOME = join(REHEARSAL, 'home');
const FLAGSHIP_NAME = '@adminiumjs/adminium';
const RUNTIME_DEPS = JSON.parse(readFileSync(join(ROOT, 'scripts/release/server-runtime-deps.json'), 'utf8'));

/** Dashboard-only libraries that must never be installed with the CLI. */
const BROWSER_ONLY = [/^react$/, /^react-dom$/, /^lucide-react$/, /^leaflet$/, /^@radix-ui\//, /^@dnd-kit\//, /^@tanstack\//, /^d3-/];

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const SKIP_PACK = has('--skip-pack');
const RUN_WIZARD = has('--wizard');
const RUN_START = has('--start');
const RUN_SMOKE = has('--smoke');
const KEEP_HOME = has('--keep-home');

const log = (message) => void console.log(message);
const die = (message) => {
  console.error(`\nrehearse-npx: ${message}\n`);
  process.exit(1);
};

/** A `--flag value` pair. A missing value would otherwise swallow the NEXT flag. */
function value(flag, fallback) {
  const i = argv.indexOf(flag);
  if (i === -1) return fallback;
  const given = argv[i + 1];
  if (given === undefined || given.startsWith('--')) die(`${flag} needs a value.`);
  return given;
}

const PORT = value('--port', RUN_SMOKE ? '4697' : '4600');
const RUN_DIR_FLAG = value('--run-dir', null);
const HOME_FLAG = value('--home', null);
const RUN_DIR = RUN_DIR_FLAG === null ? DEFAULT_RUN_DIR : resolve(RUN_DIR_FLAG);
const FAKE_HOME = HOME_FLAG === null ? DEFAULT_HOME : resolve(HOME_FLAG);
/**
 * ONLY a directory this script invented may be deleted.
 *
 * The reset below is `rm -rf`, and `--run-dir ~/work` is a thing somebody will
 * type. A directory the user named is created if missing and otherwise left
 * exactly as found — which is also what makes `--run-dir` useful: pointing it
 * at a real project is how you rehearse the `./data` branch of the data-dir
 * default (`apps/server/src/cli/data-dir.ts`) instead of the `~/.adminium` one.
 */
const MANAGED_RUN_DIR = RUN_DIR_FLAG === null;
const MANAGED_HOME = HOME_FLAG === null;

if ([RUN_WIZARD, RUN_START, RUN_SMOKE].filter(Boolean).length > 1) {
  die('--wizard, --start and --smoke are alternatives; pick one.');
}

/** Read `name` + `version` out of a packed tarball, without unpacking it to disk. */
function tarballIdentity(file) {
  const json = execFileSync('tar', ['-xOf', file, 'package/package.json'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const pkg = JSON.parse(json);
  return { name: pkg.name, version: pkg.version };
}

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...opts });
  if (result.status !== 0) {
    die(`\`${command} ${args.join(' ')}\` exited ${String(result.status ?? 'by signal')}`);
  }
}

/** Total size of the files under `dir`, without following links. */
function diskBytes(dir) {
  let total = 0;
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) total += lstatSync(child).size;
    }
  };
  walk(dir);
  return total;
}

// ── 1. The tarballs ──────────────────────────────────────────────────────────

if (has('--build') && SKIP_PACK) {
  die('--build with --skip-pack would compile new dists and then install the OLD tarballs.');
}

if (has('--build')) {
  log('▸ building every workspace dist');
  run('pnpm', ['turbo', 'run', 'build'], { cwd: ROOT });
}

if (!SKIP_PACK) {
  // Every tarball in the directory is considered below, and the pack does not
  // clear the last run's: rehearsing 0.2.6 beside 0.2.5's leftovers installed
  // the 0.2.5 CLI over 0.2.6 libraries, and passed.
  for (const file of existsSync(OUT_DIR) ? readdirSync(OUT_DIR) : []) {
    if (file.endsWith('.tgz')) rmSync(join(OUT_DIR, file), { force: true });
  }
  log('▸ packing the release tarballs (publish-npm.mjs --dry-run)');
  // Its X-ray is part of the rehearsal: compiled test files, a missing LICENSE
  // or an unpublishable range fails HERE rather than on the registry.
  run('node', [join(ROOT, 'scripts/release/publish-npm.mjs'), '--dry-run'], { cwd: ROOT });
}

const tarballs = existsSync(OUT_DIR)
  ? readdirSync(OUT_DIR)
      .filter((file) => file.endsWith('.tgz'))
      .map((file) => join(OUT_DIR, file))
  : [];
if (tarballs.length === 0) die('no tarballs in scripts/release/out — drop --skip-pack.');

/**
 * The one way `--skip-pack` lies: reusing tarballs that predate the dists.
 *
 * Skipping the pack is what makes iterating on the RUN side bearable, and it is
 * a false pass waiting to happen — the install and the boot both succeed, on
 * last hour's bytes. So compare against what packing actually consumes (every
 * `dist/`, plus the dashboard build `prepack` copies in) and say so. A warning
 * and not an error: reusing them deliberately is the whole point of the flag.
 */
function warnIfStale() {
  const newest = (dir) => {
    let latest = 0;
    const walk = (path) => {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const child = join(path, entry.name);
        if (entry.isDirectory()) walk(child);
        else latest = Math.max(latest, statSync(child).mtimeMs);
      }
    };
    if (existsSync(dir)) walk(dir);
    return latest;
  };
  const dists = [...readdirSync(join(ROOT, 'apps')).map((n) => join(ROOT, 'apps', n, 'dist')),
    ...readdirSync(join(ROOT, 'packages')).map((n) => join(ROOT, 'packages', n, 'dist'))];
  const builtAt = Math.max(...dists.map(newest), 0);
  const packedAt = Math.min(...tarballs.map((file) => statSync(file).mtimeMs));
  if (builtAt <= packedAt) return;
  const minutes = Math.round((builtAt - packedAt) / 60000);
  log('');
  log(`  ! the tarballs are ${String(minutes)} min older than the newest dist/ — --skip-pack is`);
  log('    rehearsing stale bytes. Drop it (or pass --build) to pack what you just built.');
  log('');
}
if (SKIP_PACK) warnIfStale();

const packages = tarballs.map((file) => ({ file, ...tarballIdentity(file) }));

/*
 * One version per package, or no rehearsal. With two, `find` below could pick
 * last release's flagship. That only happens with --skip-pack now (the pack
 * clears the directory), which is exactly when nobody is looking at what is in
 * it.
 */
const versionsOf = new Map();
for (const p of packages) versionsOf.set(p.name, [...(versionsOf.get(p.name) ?? []), p.version]);
const mixed = [...versionsOf].filter(([, versions]) => versions.length > 1);
if (mixed.length > 0) {
  die(
    `scripts/release/out holds more than one version of ${mixed
      .map(([name, versions]) => `${name} (${versions.join(', ')})`)
      .join('; ')} — drop --skip-pack to repack, or delete the stale tarballs.`,
  );
}

const flagship = packages.find((p) => p.name === FLAGSHIP_NAME);
if (flagship === undefined) die(`no ${FLAGSHIP_NAME} tarball — the flagship did not pack.`);

// ── 2. The install, the way npx does it: the flagship, and nothing else ──────

rmSync(PREFIX, { recursive: true, force: true });
if (MANAGED_RUN_DIR) rmSync(RUN_DIR, { recursive: true, force: true });
if (MANAGED_HOME && !KEEP_HOME) rmSync(FAKE_HOME, { recursive: true, force: true });
for (const dir of [PREFIX, RUN_DIR, FAKE_HOME]) mkdirSync(dir, { recursive: true });

writeFileSync(
  join(PREFIX, 'package.json'),
  `${JSON.stringify({ name: 'adminium-rehearsal', private: true }, null, 2)}\n`,
);

log(`▸ installing ${flagship.name}@${flagship.version} from its tarball alone`);
run('npm', ['install', flagship.file, '--no-audit', '--no-fund'], { cwd: PREFIX });

// ── 3. The gates ─────────────────────────────────────────────────────────────

const lockPath = join(PREFIX, 'node_modules/.package-lock.json');
if (!existsSync(lockPath)) die('npm wrote no .package-lock.json — cannot verify the install.');
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const installed = Object.entries(lock.packages ?? {}).filter(([path]) => path !== '');
const FLAGSHIP_PATH = `node_modules/${FLAGSHIP_NAME}`;
const BUNDLE_PREFIX = `${FLAGSHIP_PATH}/node_modules/@adminium/`;
/** The package name a lockfile path installs: whatever follows its last node_modules/. */
const nameOf = (path) => path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
/** `node_modules/@adminiumjs/adminium/node_modules/@adminium/<name>`, and nothing nested under it. */
const isBundledPackage = (path) => path.startsWith(BUNDLE_PREFIX) && !path.slice(BUNDLE_PREFIX.length).includes('/');

// 3a. Nothing Adminium from the registry.
const leaked = installed.filter(([path, meta]) => {
  if (!/@adminium(js)?\//.test(path)) return false;
  if (path === FLAGSHIP_PATH) return !String(meta.resolved ?? '').startsWith('file:');
  return !(isBundledPackage(path) && meta.inBundle === true);
});
if (leaked.length > 0) {
  console.error('\nrehearse-npx: these did not come from the flagship tarball:');
  for (const [path, meta] of leaked) console.error(`  ${path}@${String(meta.version)} ← ${String(meta.resolved ?? '(no resolved)')}`);
  die('the install reached for Adminium packages outside the flagship.');
}

// 3b. Exactly the bundled packages.
const bundledInstalled = installed
  .filter(([path]) => isBundledPackage(path))
  .map(([path]) => `@adminium/${path.slice(BUNDLE_PREFIX.length)}`)
  .sort();
const bundledExpected = [...RUNTIME_DEPS.bundled].sort();
if (JSON.stringify(bundledInstalled) !== JSON.stringify(bundledExpected)) {
  die(
    `bundled packages installed: [${bundledInstalled.join(', ')}]\n` +
      `server-runtime-deps.json expects: [${bundledExpected.join(', ')}]`,
  );
}
log(`✓ ${String(bundledInstalled.length)} bundled package(s) inside ${FLAGSHIP_NAME}, 0 Adminium packages from the registry`);

// 3c. No dashboard-only library anywhere in the tree.
const browserOnly = installed.filter(([path]) => BROWSER_ONLY.some((pattern) => pattern.test(nameOf(path))));
if (browserOnly.length > 0) {
  die(`dashboard-only libraries were installed:\n  ${browserOnly.map(([path]) => path).join('\n  ')}`);
}
log('✓ no dashboard-only library installed');

// 3d. What the server imports loads from where the server loads it; React does
// not. For a bundled package that means the entry points the server uses, not
// its root: @adminium/widgets' root is the dashboard's React code.
const flagshipDir = join(PREFIX, FLAGSHIP_PATH);
const declared = JSON.parse(readFileSync(join(flagshipDir, 'package.json'), 'utf8'));
const toLoad = [
  ...Object.keys({ ...declared.dependencies, ...declared.optionalDependencies }).filter(
    (name) => !name.startsWith('@adminium/'),
  ),
  ...RUNTIME_DEPS.entryPoints,
].sort();
const probePath = join(flagshipDir, '.rehearsal-probe.mjs');
writeFileSync(
  probePath,
  `const names = ${JSON.stringify(toLoad)};
const failed = [];
for (const name of names) {
  try { await import(name); } catch (error) { failed.push(name + ': ' + (error?.code ?? '') + ' ' + String(error?.message ?? error).split('\\n')[0]); }
}
let reactLoaded = false;
try { await import('react'); reactLoaded = true; } catch {}
console.log(JSON.stringify({ loaded: names.length - failed.length, failed, reactLoaded }));
`,
);
let probe;
try {
  probe = JSON.parse(
    execFileSync(process.execPath, [probePath], { cwd: flagshipDir, encoding: 'utf8' }).trim().split('\n').pop(),
  );
} finally {
  rmSync(probePath, { force: true });
}
if (probe.failed.length > 0) die(`declared dependencies that do not load:\n  ${probe.failed.join('\n  ')}`);
if (probe.reactLoaded) die('`react` loads from inside the flagship — something installed it.');
log(`✓ all ${String(probe.loaded)} declared dependencies load from inside ${FLAGSHIP_NAME}; react does not`);

const megabytes = (bytes) => (bytes / 1024 / 1024).toFixed(1);
log(
  `  installed size: ${megabytes(diskBytes(join(PREFIX, 'node_modules')))} MB in ${String(installed.length)} packages ` +
    `(${megabytes(diskBytes(flagshipDir))} MB of it is ${FLAGSHIP_NAME} itself)`,
);

// ── 4. Hand it over ──────────────────────────────────────────────────────────

const bin = join(PREFIX, 'node_modules/.bin/adminium');
if (!existsSync(bin)) die('the tarball installed no `adminium` bin.');

const secret = process.env.ADMINIUM_SECRET ?? randomBytes(32).toString('hex');
const childEnv = {
  ...process.env,
  HOME: FAKE_HOME,
  USERPROFILE: FAKE_HOME,
  ADMINIUM_SECRET: secret,
  PORT,
};
// Nothing inherited that would flatter the rehearsal: an ADMINIUM_DATA_DIR or
// meta URL in the shell would hide exactly the defaults being rehearsed.
delete childEnv.ADMINIUM_DATA_DIR;
delete childEnv.ADMINIUM_META_URL;
delete childEnv.ADMINIUM_STATIC_ROOT;

log('');
log(`  installed  ${PREFIX}`);
log(
  `  runs from  ${RUN_DIR}` +
    (MANAGED_RUN_DIR ? "  (empty, not a project — as a user's shell would be)" : '  (yours — left as found)'),
);
log(
  `  fake HOME  ${FAKE_HOME}` +
    (MANAGED_HOME ? "  (so ~/.adminium here is the rehearsal's, not yours)" : '  (yours — left as found)'),
);
if (FAKE_HOME === homedir()) {
  log('');
  log('  ! --home is your REAL home: this run writes a real ~/.adminium.');
}
log('');

/** Resolves true once nothing accepts connections on 127.0.0.1:port. */
function portIsFree(port) {
  return new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port: Number(port) });
    socket.once('connect', () => {
      socket.destroy();
      done(false);
    });
    socket.once('error', () => done(true));
  });
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function smoke() {
  if (!(await portIsFree(PORT))) die(`port ${PORT} is already in use — pass --port <free port>.`);
  const base = `http://127.0.0.1:${PORT}`;
  log(`▸ ${bin} start  (HOST=127.0.0.1 PORT=${PORT})`);
  const child = spawn(bin, ['start'], {
    cwd: RUN_DIR,
    env: { ...childEnv, HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const exited = new Promise((done) => child.once('exit', (code, signal) => done({ code, signal })));

  let failure = null;
  try {
    let healthy = false;
    for (const deadline = Date.now() + 90_000; Date.now() < deadline && !healthy; ) {
      if (child.exitCode !== null) throw new Error(`adminium start exited with ${String(child.exitCode)}`);
      try {
        const response = await fetch(`${base}/api/v1/healthz`);
        healthy = response.ok && (await response.json())?.ok === true;
      } catch {
        // not listening yet
      }
      if (!healthy) await sleep(500);
    }
    if (!healthy) throw new Error('/api/v1/healthz did not answer ok: true within 90 s');
    const page = await fetch(`${base}/`);
    const html = await page.text();
    if (!page.ok || !html.includes('<div id="root">')) {
      throw new Error(`GET / did not serve the dashboard (HTTP ${String(page.status)})`);
    }
    log(`✓ smoke: /api/v1/healthz answered ok and / served the dashboard on ${base}`);
  } catch (error) {
    failure = error;
  } finally {
    child.kill('SIGTERM');
    const stopped = await Promise.race([exited, sleep(15_000).then(() => null)]);
    if (stopped === null) {
      child.kill('SIGKILL');
      await exited;
      log('  ! the server ignored SIGTERM for 15 s and was killed');
    }
  }
  if (failure) {
    console.error(`\n--- server output (last 4000 characters) ---\n${output.slice(-4000)}`);
    die(String(failure?.message ?? failure));
  }
  if (!(await portIsFree(PORT))) die(`port ${PORT} still accepts connections after the server stopped.`);
  log(`✓ smoke: the server stopped and port ${PORT} is free again`);
}

if (RUN_SMOKE) {
  await smoke();
  process.exit(0);
}

if (RUN_WIZARD || RUN_START) {
  const args = RUN_START ? ['start'] : [];
  log(`▸ ${bin} ${args.join(' ')}\n`);
  const result = spawnSync(bin, args, { cwd: RUN_DIR, env: childEnv, stdio: 'inherit' });
  process.exit(result.status ?? 0);
}

log('Run it — a real terminal, so the TTY paths (the TUI, pretty logs) are exercised:');
log('');
log(`  cd ${RUN_DIR} \\`);
log(`    && HOME=${FAKE_HOME} ADMINIUM_SECRET=${secret} \\`);
log(`       ${bin}`);
log('');
log('or let this script do it:  node scripts/release/rehearse-npx.mjs --skip-pack --wizard');
log('');
