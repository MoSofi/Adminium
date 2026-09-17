#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `pnpm dev`'s first step — make a fresh clone runnable without a checklist.
 *
 * ─── What it is for ────────────────────────────────────────────────────────
 *
 * Contributing used to take five steps and two of them were undocumented
 * guesses. `pnpm install && pnpm dev` gave you a server that refused to start
 * (no ADMINIUM_SECRET, which it is right to refuse) and, once you had one, an
 * empty admin panel with no database to point at. The README said "copy
 * .env.example and fill it in", which is a fine instruction for the second run
 * and a wall for the first.
 *
 * So `pnpm dev` now runs this first, and the whole start is three commands:
 *
 *     corepack enable
 *     pnpm install
 *     pnpm dev
 *
 * ─── The secret is written once and never regenerated ──────────────────────
 *
 * ADMINIUM_SECRET derives, through HKDF, the key that encrypts every stored
 * DSN and API key. A value generated per run would silently make everything
 * already stored undecryptable, which is exactly why the server's dev watcher
 * refuses to default it (see the header of apps/server/scripts/dev.mjs). This
 * respects that: it writes a secret only into a `.env` it is CREATING, or into
 * an `ADMINIUM_SECRET=` line that is present but empty — the case someone
 * lands in by copying `.env.example`. It never replaces a value that exists,
 * and it never touches anything else in the file.
 *
 * ─── The sample database ───────────────────────────────────────────────────
 *
 * The seed is the desktop app's demo company
 * (`apps/desktop/resources/demo/demo-seed.mjs`) — deterministic, and shaped to
 * exercise every page type the generator makes, which is what makes it useful
 * for development rather than just non-empty. It is the same seed
 * `adminium new --sample` uses.
 *
 * `sample-databases/` is NOT the source: it is gitignored working material, so
 * a fresh clone does not have it, and pointing a first-run experience at
 * something absent is how this whole class of problem starts.
 *
 * The URL written is ABSOLUTE. A relative sqlite path resolves against the
 * server's working directory, which is `apps/server` under the dev watcher and
 * not the repo root anyone would be thinking of.
 *
 * ─── It never fails `pnpm dev` ─────────────────────────────────────────────
 *
 * Every step here is a convenience, and a convenience that can block the
 * command it is attached to is worse than no convenience. A missing seed
 * script or an unbuildable database is reported and skipped; the server still
 * starts, and its own first-run wizard still works.
 *
 * Usage:
 *   node scripts/dev-setup.mjs           do it, quietly if there is nothing to do
 *   node scripts/dev-setup.mjs --print   say what it would do, change nothing
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(repoRoot, '.env');
const devDir = join(repoRoot, '.dev');
const samplePath = join(devDir, 'sample.db');

const dryRun = process.argv.includes('--print');
const did = [];
const skipped = [];

/** `.env` as a map, without interpreting anything: we only ever read keys. */
function readEnvFile(path) {
  if (!existsSync(path)) return null;
  const out = new Map();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (m === null) continue;
    out.set(m[1], m[2].trim());
  }
  return out;
}

/** Is this variable already answered, by the file or by the shell? */
function isSet(envFile, key) {
  const shell = process.env[key];
  if (shell !== undefined && shell !== '') return true;
  const inFile = envFile?.get(key);
  return inFile !== undefined && inFile !== '';
}

const existing = readEnvFile(envPath);

// ── 1. the secret ────────────────────────────────────────────────────────────
let createdEnv = false;
if (existing === null) {
  const secret = randomBytes(32).toString('hex');
  const body = [
    '# Local development environment, written by scripts/dev-setup.mjs on the',
    '# first `pnpm dev`. Gitignored, per-machine, and yours to edit — this file',
    '# is never rewritten once it exists, only added to when a key is missing.',
    '#',
    '# `.env.example` documents every variable, including the ones not here.',
    '',
    '# Derives the key that encrypts every stored DSN and API key, so it must',
    '# stay STABLE: changing it makes anything already stored undecryptable.',
    `ADMINIUM_SECRET=${secret}`,
    '',
  ].join('\n');
  if (!dryRun) writeFileSync(envPath, body, { encoding: 'utf8', mode: 0o600 });
  createdEnv = true;
  did.push('wrote .env with a new ADMINIUM_SECRET');
} else if (!isSet(existing, 'ADMINIUM_SECRET')) {
  // Present but empty — the `.env.example` copy. Fill the value in place
  // rather than appending a second line for the same key.
  const secret = randomBytes(32).toString('hex');
  const next = readFileSync(envPath, 'utf8').replace(
    /^(\s*ADMINIUM_SECRET\s*=).*$/m,
    `$1${secret}`,
  );
  const filled = new RegExp(`ADMINIUM_SECRET\\s*=\\s*${secret}`).test(next);
  if (filled) {
    if (!dryRun) writeFileSync(envPath, next, 'utf8');
    did.push('filled in the empty ADMINIUM_SECRET in .env');
  } else {
    if (!dryRun) writeFileSync(envPath, `${next.replace(/\n*$/, '\n')}ADMINIUM_SECRET=${secret}\n`, 'utf8');
    did.push('added ADMINIUM_SECRET to .env');
  }
}

// ── 2. the sample database ───────────────────────────────────────────────────
const SEED_SCRIPT = join(repoRoot, 'apps', 'desktop', 'resources', 'demo', 'demo-seed.mjs');

async function buildSample() {
  if (existsSync(samplePath)) return true;
  if (!existsSync(SEED_SCRIPT)) {
    skipped.push(`the sample database: ${SEED_SCRIPT} is missing`);
    return false;
  }
  let Database;
  try {
    // better-sqlite3 is apps/server's dependency, not the root's.
    const requireFromServer = createRequire(join(repoRoot, 'apps', 'server', 'package.json'));
    Database = requireFromServer('better-sqlite3');
  } catch (error) {
    skipped.push(`the sample database: better-sqlite3 did not load (${String(error)})`);
    return false;
  }
  try {
    const seeder = await import(pathToFileURL(SEED_SCRIPT).href);
    if (typeof seeder.createDemoDatabase !== 'function') {
      skipped.push(`the sample database: ${SEED_SCRIPT} exports no createDemoDatabase()`);
      return false;
    }
    if (dryRun) {
      did.push(`would create ${samplePath}`);
      return true;
    }
    mkdirSync(devDir, { recursive: true });
    const counts = seeder.createDemoDatabase({ file: samplePath, Database });
    const rows = Object.values(counts).reduce((a, b) => a + b, 0);
    did.push(`created .dev/sample.db (${String(rows)} rows across ${String(Object.keys(counts).length)} tables)`);
    return true;
  } catch (error) {
    skipped.push(`the sample database: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

// Only when nothing already answers the question. An operator's own source, in
// the file or in the shell, is never overridden — and a clone that already has
// one does not need a sample database built for it either.
const afterSecret = readEnvFile(envPath);
const sourceAlreadySet = isSet(afterSecret, 'ADMINIUM_SOURCE_URL');
const haveSample = sourceAlreadySet ? false : await buildSample();

// ── 3. point the first boot at it ────────────────────────────────────────────
if (haveSample) {
  const url = `sqlite:${samplePath}`;
  if (!dryRun) {
    const body = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
    const addition = [
      '',
      '# The sample database this clone starts on — the desktop demo company,',
      '# rebuilt by scripts/dev-setup.mjs whenever .dev/sample.db is missing.',
      '# Seeded into a connection on the first boot; delete the line to start',
      '# with no source and use the setup wizard instead.',
      `ADMINIUM_SOURCE_URL=${url}`,
      '',
    ].join('\n');
    writeFileSync(envPath, `${body.replace(/\n*$/, '\n')}${addition}`, 'utf8');
  }
  did.push(`pointed ADMINIUM_SOURCE_URL at the sample database`);
}

// ── say what happened ────────────────────────────────────────────────────────
if (did.length > 0) {
  console.log(`[dev-setup] ${dryRun ? 'would:' : 'ready:'}`);
  for (const line of did) console.log(`  - ${line}`);
  if (createdEnv) {
    console.log('  .env is gitignored and per-machine; `.env.example` lists every variable.');
  }
}
for (const line of skipped) console.log(`[dev-setup] skipped ${line}`);
if (did.length === 0 && skipped.length === 0) {
  console.log('[dev-setup] nothing to do.');
}
