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
 * same manifest surgery, the same X-ray), installs them the way npx does — into
 * a prefix directory, not the one you run from — and hands you a command that
 * runs the CLI from a directory it has never seen, with its own HOME.
 *
 * ── THE GATE THAT MATTERS: NO REGISTRY LEAK ─────────────────────────────────
 * Installing the flagship tarball alone LOOKS right and is not. Its internal
 * deps are published aliases (`"@adminium/engine": "npm:@adminiumjs/engine@X"`),
 * so npm fetches all fourteen of them from the registry — a rehearsal that
 * pairs your local CLI with the last RELEASE of every library it calls, and
 * silently passes while an unreleased bug in `meta` or `engine` sits
 * unexercised. Measured, the first time this script was written: 1 package from
 * the local tarball, 14 from registry.npmjs.org. `overrides` pins every one to
 * a file: path, and the install is then asserted to have reached the network
 * for none of them.
 *
 * Usage:
 *   node scripts/release/rehearse-npx.mjs            # pack, install, print how to run
 *   node scripts/release/rehearse-npx.mjs --wizard   # …then run the setup wizard
 *   node scripts/release/rehearse-npx.mjs --start    # …then run `adminium start`
 *   node scripts/release/rehearse-npx.mjs --skip-pack --wizard   # reuse the tarballs
 *   node scripts/release/rehearse-npx.mjs --build    # `turbo run build` first
 *   node scripts/release/rehearse-npx.mjs --run-dir ~/scratch/try --wizard
 *   node scripts/release/rehearse-npx.mjs --home ~/scratch/home --run-dir .
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

import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
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

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const SKIP_PACK = has('--skip-pack');
const RUN_WIZARD = has('--wizard');
const RUN_START = has('--start');
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

const PORT = value('--port', '4600');
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

/** `@adminiumjs/engine` is published FROM `@adminium/engine`; the flagship is renamed. */
function sourceName(publishedName) {
  return publishedName === '@adminiumjs/adminium'
    ? '@adminium/server'
    : publishedName.replace(/^@adminiumjs\//, '@adminium/');
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

// ── 1. The tarballs ──────────────────────────────────────────────────────────

if (has('--build') && SKIP_PACK) {
  die('--build with --skip-pack would compile new dists and then install the OLD tarballs.');
}

if (has('--build')) {
  log('▸ building every workspace dist');
  run('pnpm', ['turbo', 'run', 'build'], { cwd: ROOT });
}

if (!SKIP_PACK) {
  // Every tarball in the directory is installed below, and the pack does not
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
 * One version per package, or no rehearsal. With two, `find` below takes the
 * FIRST flagship while the overrides keep the LAST of each library, so the
 * install is a mix of releases that no user will ever have. That only happens
 * with --skip-pack now (the pack clears the directory), which is exactly when
 * nobody is looking at what is in it.
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

const flagship = packages.find((p) => p.name === '@adminiumjs/adminium');
if (flagship === undefined) die('no @adminiumjs/adminium tarball — the flagship did not pack.');

// ── 2. The install, the way npx does it ──────────────────────────────────────

rmSync(PREFIX, { recursive: true, force: true });
if (MANAGED_RUN_DIR) rmSync(RUN_DIR, { recursive: true, force: true });
if (MANAGED_HOME && !KEEP_HOME) rmSync(FAKE_HOME, { recursive: true, force: true });
for (const dir of [PREFIX, RUN_DIR, FAKE_HOME]) mkdirSync(dir, { recursive: true });

// Every internal package pinned to its local tarball. The keys are the SOURCE
// names, because that is what the published manifests depend on — the alias is
// the VALUE (`npm:@adminiumjs/engine@X`), and npm keys overrides by dependency
// name, not by what the range resolves to.
const overrides = Object.fromEntries(
  packages.map((p) => [sourceName(p.name), `file:${p.file}`]),
);
writeFileSync(
  join(PREFIX, 'package.json'),
  `${JSON.stringify({ name: 'adminium-rehearsal', private: true, overrides }, null, 2)}\n`,
);

log(`▸ installing ${flagship.name}@${flagship.version} from ${String(packages.length)} local tarballs`);
run('npm', ['install', flagship.file, '--no-audit', '--no-fund'], { cwd: PREFIX });

// ── 3. The gate: nothing internal may have come from the registry ────────────

const lockPath = join(PREFIX, 'node_modules/.package-lock.json');
if (!existsSync(lockPath)) die('npm wrote no .package-lock.json — cannot verify the install.');
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const internal = Object.entries(lock.packages ?? {}).filter(([path]) =>
  /@adminium(js)?\//.test(path),
);
const leaked = internal.filter(([, meta]) => !String(meta.resolved ?? '').startsWith('file:'));
if (leaked.length > 0) {
  console.error('\nrehearse-npx: these resolved from the REGISTRY, not from local code:');
  for (const [path, meta] of leaked) console.error(`  ${path}@${String(meta.version)} ← ${String(meta.resolved)}`);
  die('the rehearsal would have tested published libraries. Overrides did not take.');
}
log(`✓ ${String(internal.length)} internal package(s) installed, 0 from the registry`);

// ── 4. Hand it over ──────────────────────────────────────────────────────────

const bin = join(PREFIX, 'node_modules/.bin/adminium');
if (!existsSync(bin)) die('the tarball installed no `adminium` bin.');

const secretFromEnv = process.env.ADMINIUM_SECRET !== undefined;
const secret = process.env.ADMINIUM_SECRET ?? randomBytes(32).toString('hex');
/**
 * What to PRINT for the secret. When it came from the environment it is the
 * operator's real one, and the command below is meant to be copied — into a
 * terminal, and from there into scrollback, a screen share or a pasted bug
 * report. Echo the variable instead of its value; the shell expands it and the
 * secret never reaches stdout. A generated one is a throwaway for this
 * rehearsal and is safe to show, which is the whole point of printing it.
 */
const secretForDisplay = secretFromEnv ? '$ADMINIUM_SECRET' : secret;
const childEnv = {
  ...process.env,
  HOME: FAKE_HOME,
  USERPROFILE: FAKE_HOME,
  ADMINIUM_SECRET: secret,
  PORT,
  // Nothing inherited that would flatter the rehearsal: an ADMINIUM_DATA_DIR or
  // meta URL in the shell would hide exactly the defaults being rehearsed.
  ADMINIUM_DATA_DIR: undefined,
  ADMINIUM_META_URL: undefined,
  ADMINIUM_STATIC_ROOT: undefined,
};
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

if (RUN_WIZARD || RUN_START) {
  const args = RUN_START ? ['start'] : [];
  log(`▸ ${bin} ${args.join(' ')}\n`);
  const result = spawnSync(bin, args, { cwd: RUN_DIR, env: childEnv, stdio: 'inherit' });
  process.exit(result.status ?? 0);
}

log('Run it — a real terminal, so the TTY paths (the TUI, pretty logs) are exercised:');
log('');
log(`  cd ${RUN_DIR} \\`);
log(`    && HOME=${FAKE_HOME} ADMINIUM_SECRET=${secretForDisplay} \\`);
log(`       ${bin}`);
log('');
log('or let this script do it:  node scripts/release/rehearse-npx.mjs --skip-pack --wizard');
log('');
