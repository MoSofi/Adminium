// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `pnpm --filter @adminium/server dev` — the API server's watch loop.
 *
 * Every library package's `dev` is a bare `tsc --watch`, because a library only
 * has to re-emit. The server also has to re-EXECUTE, and nothing was doing
 * that: `apps/server` had no `dev` script at all, so it was the one workspace
 * the root `dev` task never touched. The failure mode is nasty precisely
 * because it is silent — the dashboard hot-reloads, the packages re-emit, and
 * the API keeps serving whatever `dist` it loaded into memory whenever it was
 * last started by hand. A server-side change is then invisible with no error
 * to read, and the symptom (`404 Route GET:/api/v1/… not found`) is
 * indistinguishable from the route never having been written.
 *
 * Two children, deliberately:
 *
 * 1. `tsc --watch` re-emits `dist/` on every source change.
 * 2. `node --watch-path=./dist` re-executes when the emit lands. Node debounces
 *    its own restarts, so a multi-file emit is one restart, not one per file.
 *
 * A blocking `tsc` build runs FIRST. `node --watch` on a missing entrypoint
 * errors on every tick until the file appears, which buries the real startup
 * output in a scroll of ENOENT — one upfront build costs a few seconds and
 * makes the first log line the server's own.
 *
 * Config comes from the ambient environment, or a gitignored `.env` at the repo
 * root (`--env-file-if-exists`, so no `.env` is not an error). `ADMINIUM_SECRET`
 * is deliberately NOT defaulted: it derives the key that encrypts every stored
 * DSN and API key, so a generated-per-run value would silently make previously
 * stored credentials undecryptable. The server's own startup error explains how
 * to set it.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(here, '..');
const repoRoot = resolve(serverDir, '../..');

/**
 * The workspace's own `tsc`, by absolute path.
 *
 * A bare `tsc` only resolves because npm puts `node_modules/.bin` on PATH for
 * the duration of a script — so it works under `pnpm dev` and fails the moment
 * anyone runs this file directly, with npx's "This is not the tsc command you
 * are looking for" banner rather than anything about the server. Resolving the
 * binary here makes the launcher irrelevant; the PATH fallback keeps it working
 * if the layout ever changes.
 */
const LOCAL_TSC = resolve(serverDir, 'node_modules/.bin/tsc');
const TSC = existsSync(LOCAL_TSC) ? LOCAL_TSC : 'tsc';

const children = [];
let shuttingDown = false;

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: serverDir,
    stdio: 'inherit',
    // `shell: false` (the default) keeps argv exact — no quoting surprises in
    // the `--env-file-if-exists` path, which contains the repo root.
    ...options,
  });
  children.push(child);
  child.on('exit', (code, signal) => {
    // A child dying on its own is fatal for the pair: a lone tsc that emits
    // into nothing, or a lone node serving a frozen dist, is worse than a
    // clean stop because it still *looks* like the dev loop is running.
    if (shuttingDown) return;
    shutdown(signal !== null ? 1 : (code ?? 0));
  });
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0));
}

// 1. One blocking build so `node --watch` has an entrypoint to start from.
const build = spawn(TSC, ['-p', 'tsconfig.json'], {
  cwd: serverDir,
  stdio: 'inherit',
});

build.on('exit', (code) => {
  if (code !== 0) {
    // A type error on the very first build means there is nothing to run. Say
    // so rather than dropping into a watch loop against a stale dist.
    process.stderr.write('\n[server:dev] initial build failed — fix the errors above.\n');
    process.exit(code ?? 1);
  }

  run(TSC, ['-p', 'tsconfig.json', '--watch', '--preserveWatchOutput']);
  run('node', [
    '--watch-path=./dist',
    `--env-file-if-exists=${resolve(repoRoot, '.env')}`,
    './dist/cli/index.js',
    // `start`, not the CLI's default. Running the entrypoint bare opens the
    // interactive setup wizard, which needs a TTY it does not have under a
    // turbo dev task — it exits with "The setup wizard needs an interactive
    // terminal", node --watch reports a failed run, and the loop sits there
    // looking broken. Extra argv still overrides, so
    // `pnpm --filter @adminium/server dev -- --port 5000` works.
    ...(process.argv.length > 2 ? process.argv.slice(2) : ['start']),
  ]);
});
