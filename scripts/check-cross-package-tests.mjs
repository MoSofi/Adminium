#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Re-run, outside turbo, the unit tests whose verdict depends on a file their
 * own package's turbo cache key never hashes.
 *
 *   node scripts/check-cross-package-tests.mjs --phase=source   needs no build
 *   node scripts/check-cross-package-tests.mjs --phase=dist     after the build
 *   node scripts/check-cross-package-tests.mjs --list
 *
 * ─── Why a package suite can replay a pass it no longer earns ─────────────
 *
 * turbo.json declares no `inputs`, so `<pkg>#test` is keyed on that package's
 * own files plus the `^build` hash of each workspace DEPENDENCY (verified with
 * `pnpm turbo run test --filter=<pkg> --dry=json`: no input outside the package,
 * and `globalCacheInputs.files` is empty, so no root file is hashed anywhere).
 * ci.yml restores `.turbo/cache` with restore-keys that fall back to earlier
 * SHAs. A test that reads a dependency's source is therefore covered — that
 * dependency's build hash moves. A test that reads a DEPENDENT package, an
 * unrelated one, or a root file (Dockerfile, .github/, scripts/) replays its
 * last pass after a change confined to that file, on CI and locally alike.
 *
 * The rows below were found on 2026-09-14 by running every vitest suite under a
 * preload that logged each file it opened, then classifying each path by the
 * package that owns it. A grep found nine of the eleven: the other two build
 * their paths from segments (`'..', '..', 'desktop', 'resources'`, and
 * `'apps',` / `'docs',` on separate lines) that no search for a repo-relative
 * path matches. Re-trace rather than grep when auditing again.
 *
 * ─── Why two phases ────────────────────────────────────────────────────────
 *
 * Eight of these files need a built workspace package (engine, widgets, meta,
 * i18n, the adapters), so they can only run once `turbo run build` has. The
 * other five touch no workspace `dist/` at all: traced, including existence
 * probes, and run green in a fresh clone with no build. generate-notices.test.ts
 * imports no dist either, yet its verdict changes without one (see its row), so
 * it runs after the build.
 *
 * ─── What it refuses to do: pass by silence ───────────────────────────────
 *
 * - A row whose test file, or any path it lists under `reads`, is gone fails.
 *   The tree moved and this list is describing a test that no longer exists.
 * - A listed file vitest did not report, or reported with no passing test,
 *   fails — a collection error or a filter that matched nothing.
 * - A listed file with a skipped or todo test fails. A skipped test in this
 *   list is exactly the check the cache was already failing to run.
 *
 * What it does NOT do is find the next such test. A new cross-package read in
 * an unlisted file is invisible here, as it was before this existed.
 *
 * Not chosen: declaring these paths as `$TURBO_ROOT$/…` inputs, which turbo
 * 2.10 honours. That fixes the key rather than re-running the file, but it
 * re-runs whole suites — the server's on every docs or Dockerfile edit — and
 * is one more hand-kept list that drifts from what the test reads.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `dir` is the package, `file` the test inside it, `reads` what the file reads
 * from outside that package's turbo key (repo-relative; a directory means the
 * test walks it).
 */
const TESTS = [
  // ── phase: source ────────────────────────────────────────────────────────
  {
    // The dashboard's hand-copied RESERVED_GRANTS may not import
    // @adminium/meta, so meta reads the file. 2 of the file's 6 tests.
    dir: 'packages/meta',
    file: 'test/system-action-keys.test.ts',
    reads: ['apps/dashboard/src/team/rolesApi.ts'],
    phase: 'source',
  },
  {
    // Every literal `t()` key in product source must exist in the bundle.
    // @adminium/i18n depends on none of the five trees it scans.
    dir: 'packages/i18n',
    file: 'src/key-coverage.test.ts',
    reads: [
      'apps/dashboard/src',
      'apps/desktop/src/renderer',
      'packages/ui/src',
      'packages/widgets/src',
      'packages/charts/src',
    ],
    phase: 'source',
  },
  {
    // The generated IR schema is served at the URL the guide publishes.
    // ir-schema-check covers this file's other four tests; not this one.
    dir: 'packages/engine',
    file: 'test/ir-json-schema.test.ts',
    reads: [
      'apps/docs/src/pages/schemas/ir-v1.json.ts',
      'apps/docs/src/content/docs/guides/schema-import/json-ir.md',
    ],
    phase: 'source',
  },
  {
    // In-app help links resolve to real docs pages, and the docs describe the
    // build that shipped. rest-api-docs-check covers 2 of its 16 tests.
    dir: 'apps/server',
    file: 'test/docs-contract.test.ts',
    reads: [
      'apps/docs/src/content/docs',
      'apps/docs/src/pages/openapi.json.ts',
      'apps/docs/astro.config.mjs',
      'apps/dashboard/src/kb',
      'apps/dashboard/src/changelog/ChangelogPage.tsx',
    ],
    phase: 'source',
  },
  {
    // The fixtures that prove the offline-asset gate can FAIL. CI's own run of
    // the script only sees real bundles, which pass whether or not it detects.
    dir: 'apps/desktop',
    file: 'src/test/check-offline-assets.test.ts',
    reads: ['scripts/check-offline-assets.mjs'],
    phase: 'source',
  },
  {
    // The `pnpm dev` setup step. It spawns a COPY of the root script in a temp
    // dir, and also asserts the wiring that makes it run at all — the root
    // `dev` script, `turbo.json`'s `dev` -> `^build` edge, `.gitignore` and
    // CONTRIBUTING.md's three commands. None of that is in this package's
    // cache key, and the rule it holds (a secret is written once and NEVER
    // regenerated) fails in a way nobody would notice for weeks.
    dir: 'apps/server',
    file: 'test/dev-setup.test.ts',
    reads: [
      'scripts/dev-setup.mjs',
      'package.json',
      'turbo.json',
      '.gitignore',
      'CONTRIBUTING.md',
      'apps/desktop/resources/demo/demo-seed.mjs',
    ],
    phase: 'source',
  },
  // ── phase: dist ──────────────────────────────────────────────────────────
  {
    // Same, for the notices generator's refusal to ship an unlicensed dep. It
    // imports no dist, but its real-graph `--check` test resolves each
    // first-party package through its built entry. Without a build
    // `require.resolve` throws, the walk skips that package, and the test
    // passes over a graph with every workspace package missing — seen in a
    // fresh clone, where this file went green and its five neighbours red.
    dir: 'apps/desktop',
    file: 'src/test/generate-notices.test.ts',
    reads: ['scripts/generate-notices.mjs'],
    phase: 'dist',
  },
  {
    // No raw-HTML sink on a surface that renders LLM copy (1 of 9 tests).
    // ui, widgets and charts are dependencies; dashboard and desktop are not.
    dir: 'packages/llm',
    file: 'src/injection.test.ts',
    reads: ['apps/dashboard/src', 'apps/desktop/src/renderer'],
    phase: 'dist',
  },
  {
    // The block-* canvas against the one money fixture.
    // check-invoice-money-fixture holds the copies byte-identical but never
    // runs computeTotals, so a fixture change copied to every tree replays.
    dir: 'packages/widgets',
    file: 'src/families/domain/block-money.test.ts',
    reads: ['apps/dashboard/src/invoices/model/money-fixture.json'],
    phase: 'dist',
  },
  {
    // Every JSON example on the IR guide imports through the real parser.
    dir: 'packages/schema-import',
    file: 'test/docs-json-ir.test.ts',
    reads: ['apps/docs/src/content/docs/guides/schema-import/json-ir.md'],
    phase: 'dist',
  },
  {
    // The Docker distribution contract. Every file it pins is at the repo
    // root, which no package's key hashes.
    dir: 'apps/server',
    file: 'test/docker-contract.test.ts',
    reads: [
      'Dockerfile',
      '.dockerignore',
      'docker-compose.yml',
      '.github/workflows',
      '.github/actions',
      'apps/docs/src/content/docs/self-hosting/docker-compose.md',
    ],
    phase: 'dist',
  },
  {
    // The acceptance test seeds with the REAL desktop demo script.
    // apps/desktop depends on apps/server, not the other way round.
    dir: 'apps/server',
    file: 'test/desktop-demo.test.ts',
    reads: ['apps/desktop/resources/demo/demo-seed.mjs'],
    phase: 'dist',
  },
  {
    // The Node floor: the root `engines.node` must equal the server's (1 of
    // the file's tests). The rest of the file reads only its own package and
    // meta, a dependency.
    dir: 'apps/server',
    file: 'test/m10-regressions.test.ts',
    reads: ['package.json'],
    phase: 'dist',
  },
  {
    // `adminium new --sample` seeds with the desktop demo script, as a
    // published package does from its bundled copy (1 of the file's tests).
    dir: 'apps/server',
    file: 'test/cli-project.test.ts',
    reads: ['apps/desktop/resources/demo/demo-seed.mjs'],
    phase: 'dist',
  },
  {
    // 49 acceptance 8: a project page and cell, built by the server's own
    // build code (its source, with the kit module it bundles), render in the
    // dashboard with one React. The dashboard does not depend on the server.
    // Needs add-on-contracts' and widgets' dist.
    dir: 'apps/dashboard',
    file: 'src/project/project-bundle.test.tsx',
    reads: [
      'apps/server/src/project/client-build.ts',
      'apps/server/src/project/paths.ts',
      'apps/server/src/project/config.ts',
      'apps/server/src/cli/exit.ts',
      'apps/server/src/ui/index.ts',
    ],
    phase: 'dist',
  },
];

const PHASES = ['source', 'dist'];
const args = process.argv.slice(2);

if (args.includes('--list')) {
  for (const phase of PHASES) {
    console.log(`phase ${phase}:`);
    for (const t of TESTS.filter((row) => row.phase === phase)) {
      console.log(`  ${t.dir}/${t.file}`);
      for (const read of t.reads) console.log(`      reads ${read}`);
    }
  }
  process.exit(0);
}

const phase = args.find((arg) => arg.startsWith('--phase='))?.slice('--phase='.length);
if (!PHASES.includes(phase ?? '')) {
  console.error(`usage: check-cross-package-tests.mjs --phase=${PHASES.join('|')} | --list`);
  process.exit(2);
}

const rows = TESTS.filter((row) => row.phase === phase);
const problems = [];

// The list must still describe the tree before any of it runs.
for (const row of rows) {
  if (!existsSync(join(repoRoot, row.dir, row.file))) {
    problems.push(`${row.dir}/${row.file} does not exist — the test moved; update its row`);
  }
  for (const read of row.reads) {
    if (!existsSync(join(repoRoot, read))) {
      problems.push(`${row.dir}/${row.file}: ${read} does not exist — re-trace what the test reads`);
    }
  }
}
if (problems.length > 0) {
  console.error('Cross-package test list is stale:\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

// One vitest per package, run in sequence: the suites share the CPU otherwise,
// which is the contention ci.yml's `--concurrency=2` exists to prevent.
const byDir = new Map();
for (const row of rows) byDir.set(row.dir, [...(byDir.get(row.dir) ?? []), row]);

const reportDir = mkdtempSync(join(tmpdir(), 'adminium-cross-package-tests-'));
const started = Date.now();
const results = [];
try {
  for (const [dir, group] of byDir) {
    const cwd = join(repoRoot, dir);
    const vitestPkg = createRequire(join(cwd, 'package.json')).resolve('vitest/package.json');
    const bin = join(dirname(vitestPkg), JSON.parse(readFileSync(vitestPkg, 'utf8')).bin.vitest);
    const report = join(reportDir, `${dir.replace('/', '-')}.json`);
    console.log(`\n▶ ${dir}: ${group.map((row) => row.file).join(' ')}`);
    const run = spawnSync(
      process.execPath,
      [bin, 'run', ...group.map((row) => row.file), '--reporter=default', '--reporter=json', `--outputFile.json=${report}`],
      { cwd, stdio: 'inherit' },
    );
    const json = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8')) : null;
    const groupResults = group.map((row) => {
      const abs = join(cwd, row.file);
      const entry = json?.testResults.find((result) => result.name === abs);
      const counts = { passed: 0, failed: 0, skipped: 0 };
      for (const assertion of entry?.assertionResults ?? []) {
        const key = assertion.status === 'passed' || assertion.status === 'failed' ? assertion.status : 'skipped';
        counts[key] += 1;
      }
      let verdict = null;
      if (json === null) verdict = `vitest wrote no report (exit ${String(run.status)})`;
      else if (entry === undefined) verdict = 'vitest did not run this file';
      else if (counts.failed > 0) verdict = `${String(counts.failed)} failed`;
      else if (counts.skipped > 0) verdict = `${String(counts.skipped)} skipped or todo — a skipped check here is one nobody runs`;
      else if (entry.status !== 'passed') verdict = `the file did not run: ${(entry.message ?? '').split('\n')[0] || entry.status}`;
      else if (counts.passed === 0) verdict = 'no test passed — nothing was checked';
      return { row, counts, verdict };
    });
    results.push(...groupResults);
    if (run.status !== 0 && groupResults.every((result) => result.verdict === null)) {
      // A non-zero exit no row explains (an extra file the filter matched, a
      // reporter error) must still fail the gate rather than hide behind green.
      results.push({ row: { dir, file: '(vitest)', reads: [] }, counts: null, verdict: `exited ${String(run.status)}` });
    }
  }
} finally {
  rmSync(reportDir, { recursive: true, force: true });
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
const failed = results.filter((result) => result.verdict !== null);
console.log(`\ncross-package tests, ${phase} phase: ${String(rows.length)} file(s) in ${String(byDir.size)} package(s), ${secs}s`);
for (const { row, counts, verdict } of results) {
  const tally = counts === null ? '' : ` (${String(counts.passed)} passed)`;
  console.log(`  ${verdict === null ? 'ok  ' : 'FAIL'}  ${row.dir}/${row.file}${tally}${verdict === null ? '' : ` — ${verdict}`}`);
  if (verdict !== null) for (const read of row.reads) console.log(`          reads ${read}`);
}
if (failed.length > 0) {
  console.error(
    `\n${String(failed.length)} failed. Each reads a file its package's turbo cache key does not hash, so this` +
      '\nfailure can follow a green `turbo run test`: the package suite replayed a pass from before the' +
      '\nchange to that file. Fix what the test asserts about, not this list.' +
      (phase === 'dist' && failed.some((result) => result.verdict.startsWith('the file did not run'))
        ? '\nA file that did not run in this phase usually means the workspace is not built: `pnpm turbo run build`.'
        : ''),
  );
  process.exit(1);
}
