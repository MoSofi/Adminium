#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Run the gates CI runs, here, before pushing.
 *
 * ─── Why this exists ───────────────────────────────────────────────────────
 *
 * Of the six things that reddened main across 2026-09-08/09, THREE were plainly
 * reproducible on a laptop and were pushed anyway, because there was no single
 * command that ran what `verify` runs: the entry-chunk ratchet
 * (`check-entry-budget`, inside `turbo run build`), the offline-asset gate, and
 * `@adminium/engine`'s coverage floor. Each cost a full CI round trip —
 * ~15 minutes of wall clock and a chunk of the Actions budget — to learn
 * something a local run would have said in three.
 *
 * Every one of those gates already had a root script. What was missing was the
 * LIST: which ones CI runs, in what order, with what environment. That is all
 * this file is.
 *
 * ─── Why it reports what it did NOT check ──────────────────────────────────
 *
 * The failure mode this script could easily introduce is worse than the one it
 * fixes: a green "preflight ok" read as "CI will pass". Four of CI's legs cannot
 * run here — the S3 conformance leg needs Docker, the postgres/mysql legs need
 * their services, VRT baselines are Linux-only by construction
 * (packages/ui/playwright.config.ts omits the `{platform}` suffix so one baseline
 * set is shared, and re-recording on macOS produces font-rasterization diffs
 * across the whole matrix), and the dashboard's CPU-starvation flake needs a
 * runner with fewer cores than a dev box has. So this prints an explicit
 * NOT CHECKED block on success. A tool that overstates its own coverage is how
 * "green but broken" happens, and this repo has that lesson written down in
 * several places already.
 *
 * ─── Why there is a baseline ───────────────────────────────────────────────
 *
 * A gate that is ALREADY red on main makes this whole script useless: it goes
 * red for everybody, on every run, for something they did not do — and a check
 * you are expected to ignore is a check nobody reads. That happened the day this
 * was written. `pnpm audit` was failing on three advisories that predated the
 * branch, so the first real run went red, and the honest-but-useless options
 * were "fix an unrelated CVE before you may push" or "learn to ignore preflight".
 *
 * So a failing gate named in KNOWN_RED does not fail the run. It is reported
 * loudly, by name, with the reason and the commit it was observed at, and the
 * remaining gates still run. A failure NOT on that list exits non-zero, because
 * that one is yours.
 *
 * The list cannot rot: if a KNOWN_RED gate PASSES, this exits non-zero and tells
 * you to delete the entry. Same discipline as the drift guard below — the
 * escape hatch has its own gate.
 *
 * ─── Why the drift guard ───────────────────────────────────────────────────
 *
 * A preflight list that falls behind ci.yml is a preflight list that lies. So
 * before running anything, this parses `.github/workflows/ci.yml`, extracts every
 * `pnpm …` command in the `verify` and `dep-graph` jobs, and fails if one is
 * neither in STEPS nor in NOT_COVERED with a stated reason. Adding a gate to CI
 * therefore forces a decision here rather than silently widening the gap.
 *
 * Usage:
 *   pnpm preflight              the full local-runnable set (what `verify` +
 *                               `dep-graph` cover, minus the service legs)
 *   pnpm preflight --quick      the fast gates only: spdx, tailwind utilities,
 *                               the a11y-key and icon-core lists, the
 *                               cross-package tests that need no build, lint,
 *                               typecheck
 *   pnpm preflight --with-a11y  adds the axe sweep (slow: needs a built ui)
 *   pnpm preflight --with-e2e   adds the sqlite e2e leg (slowest; needs dists)
 *   pnpm preflight --list       print the plan and exit
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = new Set(process.argv.slice(2));
const quick = argv.has('--quick');
const withA11y = argv.has('--with-a11y');
const withE2e = argv.has('--with-e2e');
const listOnly = argv.has('--list');

/**
 * The order is CI's, and it is deliberate: the cheap gates that fail in seconds
 * go first, so a missing SPDX header does not cost a four-minute build to learn.
 */
const STEPS = [
  { id: 'check-spdx', cmd: 'pnpm run check-spdx', why: 'every tracked source file declares AGPL-3.0-only', tier: 'quick' },
  {
    // In `quick` because it is a text scan over tracked files: 1.5 s, no build.
    // It has to run from the root and uncached — it reads every package, so a
    // per-package task would replay from turbo's cache after a change in
    // another one, which is exactly how a gate starts lying.
    id: 'check-private-citations',
    cmd: 'pnpm run check-private-citations',
    why: 'no file gained a citation of a document a reader cannot open (and the ratchet is recorded)',
    tier: 'quick',
  },
  {
    // In `quick` because it costs under a second and catches something no other
    // gate here can see: tsc and eslint do not read the inside of a string, so
    // an undefined Tailwind utility compiles to nothing and ships looking
    // deliberate. Thirty such call sites were found on 2026-09-10.
    id: 'check-tailwind-utilities',
    cmd: 'pnpm run check-tailwind-utilities',
    why: 'every className names a utility that actually compiles (no silently-inert classes)',
    tier: 'quick',
  },
  {
    // In `quick` for the same reason: about a second, no build, and the only
    // gate that sees a new accessible-name call site the list does not protect.
    id: 'a11y-keys-check',
    cmd: 'pnpm run a11y-keys-check',
    why: 'every key in an accessible-name position is on the list the server refuses to blank',
    tier: 'quick',
  },
  {
    // In `quick` too: 0.3 s measured, no build (it reads source and the
    // installed lucide-react, never a workspace dist). The `test` step cannot
    // stand in for it — @adminium/ui's copy of this check replays from turbo's
    // cache, locally as on CI, after a change confined to the dashboard.
    id: 'icon-core-check',
    cmd: 'pnpm run icon-core-check',
    why: 'every icon the product renders by name is a static import in icon-core.ts, not a lazy catalogue fetch',
    tier: 'quick',
  },
  {
    // In `quick` as well: about 5 s, and green in a fresh clone with nothing built.
    // Same reason the `test` step cannot stand in for it: each file's package
    // suite replays from turbo's cache, locally as on CI, after a change
    // confined to the file it reads (the script's table names them).
    id: 'cross-package-tests',
    cmd: 'pnpm run cross-package-tests-check',
    why: 'the unit tests that read outside their package re-run uncached (the five that need no build)',
    tier: 'quick',
  },
  {
    // Split out of the `turbo` step below so `--quick` is what its name says.
    // Same tasks, so turbo's cache makes the full run pay for them only once.
    id: 'lint+typecheck',
    cmd: 'pnpm turbo run lint typecheck',
    why: 'eslint and tsc across every workspace — the two that catch a typo without building anything',
    tier: 'quick',
  },
  {
    id: 'build',
    cmd: 'pnpm turbo run lint typecheck build',
    why: 'every package build — this is where check-entry-budget and check-offline-assets fire',
    tier: 'full',
  },
  {
    // `--concurrency=2` mirrors ci.yml exactly, and mirroring it is the point:
    // the bound is what keeps the timing-sensitive dashboard suite off a
    // starved CPU, so a local run without it is not running CI's arrangement.
    id: 'test',
    cmd: 'pnpm turbo run test --concurrency=2',
    why: 'every unit suite with its coverage floors, at CI\'s bounded concurrency',
    tier: 'full',
  },
  {
    // Straight after `test`, as in ci.yml: these six need built packages.
    id: 'cross-package-dist-tests',
    cmd: 'pnpm run cross-package-dist-tests-check',
    why: 'the same, for the six that need a built workspace package',
    tier: 'full',
  },
  { id: 'check-offline-assets', cmd: 'pnpm run check-offline-assets', why: 'no remote URL in the shipped bundles outside the reviewed allowlist', tier: 'full' },
  { id: 'check-email-block-vocab', cmd: 'pnpm run check-email-block-vocab', why: 'the email block vocabulary matches canvas and renderer', tier: 'full' },
  { id: 'check-invoice-block-vocab', cmd: 'pnpm run check-invoice-block-vocab', why: 'same, for invoices', tier: 'full' },
  { id: 'check-invoice-money-fixture', cmd: 'pnpm run check-invoice-money-fixture', why: 'the invoice money fixture is current', tier: 'full' },
  { id: 'openapi-check', cmd: 'pnpm run openapi-check', why: 'openapi.json matches the route tree (it reads dist, so it needs the build above)', tier: 'full' },
  { id: 'server-runtime-deps-check', cmd: 'pnpm run server-runtime-deps-check', why: "the published CLI's traced dependency list is current (reads dist)", tier: 'full' },
  { id: 'ir-schema-check', cmd: 'pnpm run ir-schema-check', why: 'the published IR JSON Schema is current', tier: 'full' },
  { id: 'project-schemas-check', cmd: 'pnpm run project-schemas-check', why: "the project file schemas the package ships are current (reads dist)", tier: 'full' },
  { id: 'rest-api-docs-check', cmd: 'pnpm run rest-api-docs-check', why: 'the REST reference covers every operation', tier: 'full' },
  { id: 'i18n-check', cmd: 'pnpm run i18n-check', why: 'no locale drift across the eight locales', tier: 'full' },
  { id: 'generate-notices', cmd: 'pnpm run generate-notices', why: 'third-party notices regenerate without a diff', tier: 'full' },
  { id: 'desktop-icons', cmd: 'pnpm --filter @adminium/desktop run icons', why: 'the desktop icon derivation still runs (release-path smoke)', tier: 'full' },
  { id: 'check-deps', cmd: 'pnpm run check-deps', why: "dependency-cruiser: the dep-graph job's gate", tier: 'full' },
  {
    id: 'audit',
    cmd: 'pnpm audit --prod --audit-level high',
    why: "the codeql workflow's audit leg — pure metadata, so it is as valid here as on a runner",
    tier: 'full',
  },
  { id: 'a11y', cmd: 'pnpm --filter @adminium/ui a11y', why: 'the axe ratchet over every story', tier: 'a11y' },
  { id: 'e2e', cmd: 'pnpm turbo run e2e --filter=@adminium/e2e', why: "the sqlite e2e leg — the same one that runs in e2e.yml's sqlite job", tier: 'e2e' },
];

/**
 * CI commands this cannot run, and why. Each entry is a claim that the gap is
 * STRUCTURAL rather than unfinished work — the drift guard below accepts these
 * as covered decisions, so a wrong reason here is how a real gap would hide.
 */
const NOT_COVERED = [
  {
    match: /docker run .*minio/,
    why: 'the S3 conformance leg needs Docker and a MinIO container. It is the only place SigV4 is checked against a server that verifies it, so it cannot be faked. Run it on CI, or start MinIO yourself and set TEST_S3_URL.',
  },
  {
    match: /pnpm --filter @adminium\/ui vrt$/,
    why: 'VRT compares against baselines recorded on ubuntu-latest. packages/ui/playwright.config.ts deliberately omits the {platform} suffix so CI and every developer share ONE baseline set, which means a macOS run reports font-rasterization diffs across the whole matrix rather than real regressions. Record baselines with the vrt-baselines workflow, never here.',
  },
  {
    match: /pnpm install --frozen-lockfile/,
    why: 'a local tree is already installed; the lockfile is checked by CI on a clean checkout, where the claim actually means something.',
  },
];

/**
 * Gates already failing on `main`, which therefore do NOT fail this run.
 *
 * Each entry is a debt with a name on it, not a mute button: `since` is the
 * commit where it was observed, so a stale entry is obvious. Keep this SHORT —
 * an entry here is a gate nobody is enforcing.
 *
 * Worked example, and the reason this exists: on 2026-09-09 this held
 * `{ id: 'audit', since: 'ab6314e', why: 'three HIGH advisories — nodemailer,
 * fast-uri, js-yaml — all in the lockfile before the branch' }`. The entry was
 * deleted the same day when the three were bumped, which is exactly the
 * lifecycle intended: an entry appears when a red is inherited and disappears
 * when somebody fixes it. The anti-rot check below is what forces the deletion.
 */
const KNOWN_RED = [];

/**
 * Legs that exist only on a runner. Printed on success so a green preflight is
 * never mistaken for a green CI.
 */
const UNCHECKED_HERE = [
  'the S3 conformance leg (files-drivers.test.ts) — skipped without TEST_S3_URL; needs Docker + MinIO',
  'the postgres and mysql legs of the unit suites and of e2e — skipped without TEST_POSTGRES_URL / TEST_MYSQL_URL',
  'VRT — baselines are recorded on ubuntu-latest by the vrt-baselines workflow and must not be re-recorded here',
  'the dashboard suite under CI CPU pressure — a 4-vCPU runner starves renders that pass comfortably on a dev box',
  'CodeQL analysis itself (the audit leg above IS covered)',
];

/** Every `pnpm …` line CI's verify + dep-graph jobs run, in order. */
function ciCommands() {
  const yml = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  // The two jobs whose gates are meant to be runnable locally. `a11y` and `vrt`
  // are matched too, so adding a gate to either still forces a decision here.
  const out = [];
  for (const line of yml.split('\n')) {
    const m = /^\s*(?:run:\s*)?(pnpm [^\n#]*)$/.exec(line.trimEnd());
    if (m) out.push(m[1].trim());
    const d = /^\s*(docker run [^\n#]*)$/.exec(line.trimEnd());
    if (d) out.push(d[1].trim());
  }
  return [...new Set(out)];
}

function driftGuard() {
  const known = new Set(STEPS.map((s) => s.cmd));
  const unknown = [];
  for (const cmd of ciCommands()) {
    if (known.has(cmd)) continue;
    if (NOT_COVERED.some((n) => n.match.test(cmd))) continue;
    // Multi-line shell (the MinIO block) arrives as its first line only.
    if (/^pnpm turbo run build$/.test(cmd)) continue; // subsumed by the `turbo` step
    unknown.push(cmd);
  }
  return unknown;
}

const plan = STEPS.filter((s) => {
  if (s.tier === 'quick') return true;
  if (quick) return false;
  if (s.tier === 'a11y') return withA11y;
  if (s.tier === 'e2e') return withE2e;
  return true;
});

const drift = driftGuard();
if (drift.length > 0) {
  console.error('preflight: ci.yml runs commands this script does not know about:\n');
  for (const c of drift) console.error(`  $ ${c}`);
  console.error(
    '\nAdd each to STEPS (if it can run locally) or to NOT_COVERED with the reason it cannot.\n' +
      'This check exists so the local list cannot fall behind CI silently.',
  );
  process.exit(1);
}

if (listOnly) {
  console.log(`preflight plan (${plan.length} step${plan.length === 1 ? '' : 's'}):\n`);
  for (const s of plan) console.log(`  ${s.id.padEnd(28)} ${s.cmd}\n  ${''.padEnd(28)} ${s.why}\n`);
  console.log('NOT run here:');
  for (const u of UNCHECKED_HERE) console.log(`  - ${u}`);
  process.exit(0);
}

const started = Date.now();
const results = [];
let failed = null;

for (const step of plan) {
  const at = Date.now();
  process.stdout.write(`\n[1m▶ ${step.id}[0m  ${step.cmd}\n`);
  const r = spawnSync(step.cmd, { cwd: repoRoot, shell: true, stdio: 'inherit' });
  const secs = ((Date.now() - at) / 1000).toFixed(1);
  const ok = r.status === 0;
  const baseline = KNOWN_RED.find((k) => k.id === step.id);
  results.push({ id: step.id, ok, secs, baseline });
  if (ok && baseline !== undefined) {
    // The escape hatch's own gate: a debt that has been paid must be struck off,
    // or the next inherited red hides behind a stale entry.
    console.error(
      `\npreflight: [1m${step.id}[0m is listed in KNOWN_RED but PASSED.\n` +
        `Delete that entry (added for: ${baseline.why}) — a baseline nobody prunes is a gate nobody runs.\n`,
    );
    process.exit(1);
  }
  if (!ok && baseline === undefined) {
    failed = { step, secs };
    break;
  }
}

const total = ((Date.now() - started) / 1000).toFixed(1);
console.log('\n' + '─'.repeat(72));
for (const r of results) console.log(`  ${r.ok ? '[32mok  [0m' : '[31mFAIL[0m'}  ${r.id.padEnd(28)} ${r.secs}s`);
console.log('─'.repeat(72));

if (failed !== null) {
  console.error(`\npreflight: FAILED at [1m${failed.step.id}[0m after ${total}s — ${failed.step.why}`);
  console.error(`Re-run just that gate with:\n  ${failed.step.cmd}\n`);
  process.exit(1);
}

const inherited = results.filter((r) => !r.ok && r.baseline !== undefined);
console.log(`\npreflight: ok — ${results.length} gate(s) in ${total}s.\n`);
if (inherited.length > 0) {
  console.log(`\u001b[33m${inherited.length} gate(s) marked red* were ALREADY failing on main and did not fail this run:\u001b[0m`);
  for (const r of inherited) console.log(`  - ${r.id}: ${r.baseline.why} (seen at ${r.baseline.since})`);
  console.log('  They are still broken. This says only that they are not YOUR breakage.\n');
}
console.log('NOT CHECKED HERE (a green run above does not mean CI is green):');
for (const u of UNCHECKED_HERE) console.log(`  - ${u}`);
if (quick) console.log('\n  …and this was --quick: the build, the unit suites and every generated-artifact check that runs after them were skipped.');
if (!withE2e) console.log('\n  Add --with-e2e for the sqlite end-to-end leg, --with-a11y for the axe sweep.');
console.log('');
