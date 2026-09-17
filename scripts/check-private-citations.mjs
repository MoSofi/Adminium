#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Private-citation gate — no tracked file may point at a document a reader
 * cannot open.
 *
 * ─── What a "private citation" is ──────────────────────────────────────────
 *
 * The work plan that drove this repository lives outside it, and always did.
 * The house convention cited it bare — a document filename, then a section, a
 * decision or a task id — which was exactly right while the plan was the only
 * place the reasoning existed:
 *
 *     Realtime event -> query invalidation map (NN-some-plan.md SEC 2.1).
 *     The hazard matrix - NN-other-plan.md SEC 5, D4.
 *     // Checked-in manifests (NN SEC 10) are data, not code.
 *
 * To anyone outside the repository those are dead ends. Worse, the short forms
 * do not even name the document: a bare section or a bare task id is a pointer
 * into a file the reader has no way to identify, let alone read. The reasoning
 * that was load-bearing now lives in public, one short page per decision, under
 * /anatomy/decisions/ — so a comment either links there or states its intent
 * inline, and the history stays in git.
 *
 * ─── Why this is a ratchet and not a boolean ───────────────────────────────
 *
 * When this was written the repository held **16,293** such references across
 * **2,450 of 3,585** tracked files. That is not one commit's worth of work, and
 * a gate that simply failed until the last one was gone would have been turned
 * off within the hour — which is the failure mode this repo has written down
 * elsewhere: a check you are expected to ignore is a check nobody reads.
 *
 * So the gate enforces the two things that can be true today:
 *
 *  1. **A file with no baseline entry must be clean.** Every new file, and
 *     every file already swept, is held to zero. This is the half that matters
 *     day to day, because it is the half that stops the number growing.
 *  2. **A baseline entry may only shrink.** More references than recorded is
 *     your change. Fewer is progress that has to be recorded, so it cannot be
 *     silently given back later.
 *
 * The escape hatch has its own gate, in both directions: a baseline entry for a
 * file that is now clean, or for a file that no longer exists, fails too. The
 * list cannot rot into an exemption list.
 *
 * ─── Why the patterns are narrow ───────────────────────────────────────────
 *
 * Two of these forms are ambiguous by construction and the false positives are
 * real code, so each is bounded:
 *
 *  - A bare plan number is only a citation when a reference follows it, so the
 *    number must be two digits (the plan numbered its documents that way) and
 *    must not be preceded by a word character or a hyphen. Without that guard
 *    the legitimate W3C citation in packages/tokens/scripts/contrast-check.mjs
 *    ("css-color-5", section 2.1) is reported.
 *  - A bare decision or open-question id (a capital D or O and a number) is NOT
 *    checked at all. There are ~2,750 strings of that shape and many are
 *    ordinary identifiers. They are swept by hand along with the file they sit
 *    in, which is why `--loose` exists: it reports them for a path you name,
 *    without failing.
 *
 * ─── Citing something a reader CAN open ────────────────────────────────────
 *
 * Spell the section out. The AGPL's remote-network-interaction clause, a W3C
 * module, an RFC — all fine to cite, and all written `AGPL section 13` rather
 * than with the section sign, which is the glyph this gate reads. There were
 * nine such citations when it was written and every one of them reads better
 * spelled out anyway.
 *
 * ─── One place that can never be swept ─────────────────────────────────────
 *
 * A meta migration's `up` body is FROZEN BYTES. Its row in
 * `adminium_migrations` holds sha256 over the migration name plus
 * `migration.up.toString()` — the EMITTED function source, comments included —
 * so rewriting a comment inside one makes every deployed instance throw
 * MigrationChecksumDriftError on its next boot. `migration-checksums.test.ts`
 * caught exactly that on `0005_ops`. The file HEADER sits outside the function
 * and is safe; the body is not, and the ~50 references still inside those
 * bodies stay where they are.
 *
 * ─── Usage ─────────────────────────────────────────────────────────────────
 *
 *   pnpm check-private-citations            enforce the ratchet
 *   pnpm check-private-citations --update   re-record the baseline after a sweep
 *   pnpm check-private-citations --report   per-area totals, exit 0
 *   pnpm check-private-citations --list <p> every reference under a path
 *   pnpm check-private-citations --loose <p>  also the unguarded D<n>/O<n> form
 *
 * It runs from the repository root, uncached, in `pnpm preflight` and in CI's
 * `verify` job. It reads tracked files across every package, so a per-package
 * task would replay from turbo's cache after a change in another one.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(repoRoot, 'scripts', 'private-citations-baseline.json');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const valueOf = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : (argv[i + 1] ?? null);
};

/**
 * The forms a private citation takes, as ONE alternation so a reference that
 * matches two of them is counted once. Ordered longest-first for that reason:
 * a full document filename must win over the bare section inside it.
 */
/**
 * The section sign, built rather than written, so this file contains no literal
 * one. A tool that decodes a `\u` escape on write would otherwise put a real
 * section sign in the source below — and then this gate would be citing the
 * very form it forbids, which is both confusing to read and one edit away from
 * reporting itself.
 */
const SEC = String.fromCharCode(0xa7);

const POINTER = new RegExp(
  [
    // A plan document filename: TWO digits, an optional letter, a kebab name.
    // Two and not one-or-two, because the plan numbered its documents 01-49 and
    // a single digit matches things that are not citations at all — the
    // generated `adminium-prompt-run_1-chunk-2of3.md` download name was read as
    // `1-chunk-2of3.md`, which is a filename a reader CAN resolve.
    String.raw`\d{2}[a-z]?-[a-z0-9-]+\.md`,
    // A design comp, which lives in the same place the plan does.
    String.raw`designs\/[^'"\`)\n]*\.dc\.html`,
    // The research annexes the plan was written from.
    String.raw`(?:research\/)?(?:BRIEF|ia-mapping|[a-z-]+-annex)\.md`,
    // A bare plan number, only when a reference follows it.
    String.raw`(?<![\w-])\d{2}[a-z]?(?=\s(?:` + SEC + String.raw`|D\d|O\d))`,
    // A section reference, with or without a document in front of it. Anchored
    // so it stops at the sentence period rather than swallowing it, which keeps
    // the reported token readable.
    SEC + String.raw`\d+(?:\.\d+)*`,
    // A plan task id, and a milestone task id.
    String.raw`(?<![\w-])\d{1,2}[a-z]?-T\d{1,3}\b`,
    String.raw`\bM\d{1,2}-T\d{1,3}\b`,
  ].join('|'),
  'g',
);

/** The unguarded form: a bare decision or open-question id. Reported, never enforced. */
const LOOSE = new RegExp(String.raw`(?<![\w` + SEC + String.raw`.])[DO]\d{1,2}\b`, 'g');

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, maxBuffer: 1 << 28 })
    .toString()
    .split('\0')
    .filter((f) => f.length > 0);
}

/** Every pointer in a file, as {line, text, cite}. Binary files are skipped. */
function pointersIn(file, re = POINTER) {
  let src;
  try {
    src = readFileSync(join(repoRoot, file), 'utf8');
  } catch {
    return [];
  }
  // A NUL makes a file binary as far as every text tool is concerned; reading
  // one as utf8 yields nonsense rather than an error, so check the bytes.
  if (src.includes('\0')) return [];
  const out = [];
  src.split('\n').forEach((line, index) => {
    re.lastIndex = 0;
    for (const m of line.matchAll(re)) out.push({ line: index + 1, text: line.trim(), cite: m[0] });
  });
  return out;
}

const files = trackedFiles();
const counts = new Map();
for (const file of files) {
  const hits = pointersIn(file);
  if (hits.length > 0) counts.set(file, hits.length);
}
const total = [...counts.values()].reduce((a, b) => a + b, 0);

/** `--list <path>` / `--loose <path>`: every reference under a path, then exit. */
const listPath = valueOf('list') ?? valueOf('loose');
if (listPath !== null) {
  const re = flag('loose') ? LOOSE : POINTER;
  let shown = 0;
  for (const file of files) {
    if (!file.startsWith(listPath)) continue;
    for (const hit of pointersIn(file, re)) {
      console.log(`${file}:${String(hit.line)}  [${hit.cite}]  ${hit.text.slice(0, 150)}`);
      shown += 1;
    }
  }
  console.log(`\n${String(shown)} reference(s) under ${listPath}`);
  process.exit(0);
}

/** `--report`: where the remaining references are, without a verdict. */
if (flag('report')) {
  const areas = new Map();
  for (const [file, n] of counts) {
    const parts = file.split('/');
    const key = parts[0] === 'apps' || parts[0] === 'packages' ? `${parts[0]}/${parts[1]}` : '(root)';
    const cur = areas.get(key) ?? { hits: 0, files: 0 };
    cur.hits += n;
    cur.files += 1;
    areas.set(key, cur);
  }
  console.log(`${'area'.padEnd(28)}${'refs'.padStart(7)}${'files'.padStart(7)}`);
  for (const [key, v] of [...areas].sort((a, b) => b[1].hits - a[1].hits)) {
    console.log(`${key.padEnd(28)}${String(v.hits).padStart(7)}${String(v.files).padStart(7)}`);
  }
  console.log(`${'TOTAL'.padEnd(28)}${String(total).padStart(7)}${String(counts.size).padStart(7)}`);
  process.exit(0);
}

/** `--update`: record what is left, so the ratchet cannot be wound back. */
if (flag('update')) {
  const sorted = [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const baseline = {
    comment:
      'Private citations still to be rewritten, per file. Only ever shrinks; ' +
      'see scripts/check-private-citations.mjs. Regenerate with `pnpm check-private-citations --update`.',
    remaining: total,
    files: Object.fromEntries(sorted),
  };
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  console.log(
    `private citations: recorded ${String(total)} reference(s) in ${String(counts.size)} file(s)`,
  );
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error(
    'private citations: no baseline. Run `pnpm check-private-citations --update` to record one.',
  );
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
/** @type {Record<string, number>} */
const recorded = baseline.files ?? {};

const added = []; // a file with no entry, or more references than recorded
const shrunk = []; // fewer than recorded — progress that must be written down
const gone = []; // an entry for a file that is clean, or that no longer exists

for (const [file, n] of counts) {
  const was = recorded[file];
  if (was === undefined) {
    added.push({ file, n, was: 0 });
    continue;
  }
  if (n > was) added.push({ file, n, was });
  else if (n < was) shrunk.push({ file, n, was });
}
const tracked = new Set(files);
for (const [file, was] of Object.entries(recorded)) {
  if (!tracked.has(file)) gone.push({ file, was, why: 'no longer tracked' });
  else if (!counts.has(file)) gone.push({ file, was, why: 'now clean' });
}

if (added.length > 0) {
  console.error(
    `\nprivate citations: ${String(added.length)} file(s) gained a reference to a document a reader cannot open.\n`,
  );
  for (const { file, n, was } of added.slice(0, 40)) {
    console.error(`  ${file}  ${String(was)} -> ${String(n)}`);
    for (const hit of pointersIn(file).slice(0, 6)) {
      console.error(`      :${String(hit.line)}  [${hit.cite}]  ${hit.text.slice(0, 110)}`);
    }
  }
  if (added.length > 40) console.error(`  … and ${String(added.length - 40)} more`);
  console.error(
    '\nSay what the code does and why, and link the decision it rests on:\n' +
      '  https://docs.adminium.dev/anatomy/decisions/\n' +
      'Leave the history to git. See scripts/check-private-citations.mjs for the forms this reads.\n',
  );
  process.exit(1);
}

if (shrunk.length > 0 || gone.length > 0) {
  console.error('\nprivate citations: the baseline is behind the tree.\n');
  for (const { file, n, was } of shrunk.slice(0, 40)) {
    console.error(`  ${file}  ${String(was)} -> ${String(n)}  (progress)`);
  }
  for (const { file, was, why } of gone.slice(0, 40)) {
    console.error(`  ${file}  ${String(was)} -> 0  (${why})`);
  }
  console.error(
    '\nRecord it with `pnpm check-private-citations --update` and commit the baseline,\n' +
      'so the gate holds the new floor.\n',
  );
  process.exit(1);
}

const done = Object.keys(recorded).length - counts.size;
console.log(
  `private citations ok — ${String(total)} reference(s) left in ${String(counts.size)} file(s)` +
    (done > 0 ? `, ${String(done)} file(s) swept` : '') +
    '; no file gained one.',
);
