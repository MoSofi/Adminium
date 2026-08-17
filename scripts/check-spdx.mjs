#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SPDX header gate — every first-party source file must declare the licence.
 *
 * Adminium is AGPL-3.0-only. That is asserted in LICENSE and in every
 * package.json, and until now in not one of the ~1,950 source files it covers.
 * A file with no header is not a licensing crisis on its own; the problem is
 * that AGPL's obligations travel with the SOURCE, and source travels — pasted
 * into an issue, vendored into a fork, lifted into a downstream generator,
 * scraped into a training set. `SPDX-License-Identifier` is the one line that
 * survives all of those, and it is the line every automated licence scanner
 * (REUSE, ScanCode, GitHub's dependency graph, an acquirer's audit tool) reads.
 * We publish 15 packages to npm; the tarballs ship `dist`, and `dist` inherits
 * whatever the sources carry.
 *
 * ─── WHY THIS IS A STANDALONE SCRIPT AND NOT AN ESLINT RULE ─────────────────
 *
 * The obvious home for "every file starts with X" is a lint rule, and it is the
 * wrong home here. Every package's lint script is `eslint src`, and there is no
 * root `eslint.config.js` at all — so 263 tracked source files are outside any
 * ESLint invocation no matter what globs a flat config declares: 111 in
 * `apps/server/test`, 23 in `packages/meta/test`, 18 in `packages/engine/test`,
 * 10 in `packages/schema-import/test`, this `scripts/` directory, every
 * `vitest.config.ts`, every `eslint.config.js`. `packages/config`'s own lint
 * script is `echo 'self-lint skipped'`, so a rule living there could not even
 * check itself. A gate that misses 13% of the tree is not a gate.
 *
 * `git ls-files` has none of those blind spots: it is the definition of "a file
 * we ship", it needs no resolver, no parser and no config, and it runs in well
 * under a second over the whole repo.
 *
 * ─── WHAT COUNTS ────────────────────────────────────────────────────────────
 *
 * Tracked `.ts/.tsx/.js/.mjs/.cjs` — the executable, copyrightable surface.
 * JSON, Markdown, CSS, YAML and fonts are excluded: JSON has no comment syntax,
 * and the rest are either data or already covered by the repo-level LICENSE.
 * Nothing is vendored into this repo (checked: no third-party copyright header
 * exists in any tracked source file), so there is no exemption list — and that
 * is deliberate. An exemption list is where a gate goes to die.
 *
 * ─── THE TWO TRAPS ──────────────────────────────────────────────────────────
 *
 * 1. GENERATED FILES SELF-REVERT. Three scripts rewrite tracked `.ts` files
 *    from scratch with hardcoded header templates:
 *      - `packages/i18n/scripts/gen-resources.mjs`  → 40 locale mirrors
 *      - `packages/i18n/scripts/gen-a11y-keys.mjs`  → `src/a11y-keys.ts`
 *      - `packages/ui/scripts/gen-barrel.mjs`       → `packages/ui/src/index.ts`
 *    A `--fix` run inserts a header; the next generator run deletes it again.
 *    The last one is the nastiest, because `gen-barrel` is chained into
 *    `@adminium/ui`'s `build` AND `typecheck` — so an ordinary `pnpm turbo run
 *    typecheck` silently reverts it and the next CI run is red with no diff
 *    anyone made. The fix is upstream: all three templates now emit the SPDX
 *    line themselves, so `--fix` and the generators agree and this file needs
 *    no exemption for them. If you add a fourth generator, put the header in
 *    its template rather than an exemption here.
 *
 *    (`packages/i18n/scripts/meta.mjs` also writes a tracked `.ts` file, but it
 *    does a surgical regex replace INSIDE `src/review-status.ts` rather than
 *    rewriting it, so a header at the top survives untouched. Verified.)
 *
 * 2. SHEBANGS. Root `scripts/`, plus per-package `scripts` directories, hold
 *    node entrypoints beginning with `#!/usr/bin/env node`. Inserting at offset 0
 *    puts a comment ahead of the shebang, which stops the kernel recognising it
 *    and breaks execution. `--fix` inserts AFTER the shebang line. (There are
 *    no `'use strict'` / `'use client'` prologues and no BOMs in this tree —
 *    both checked — so the shebang is the only ordering constraint.)
 *
 * A note on detection: a marker-based exemption ("skip anything saying
 * @generated") would be a disaster here. 200+ hand-written files mention
 * "generated" or "do not edit" in prose, because generating an admin panel is
 * what this product DOES. Membership is decided by the extension and nothing
 * else.
 *
 * Usage:
 *   node scripts/check-spdx.mjs                      check every tracked source
 *   node scripts/check-spdx.mjs --fix                insert the missing headers
 *   node scripts/check-spdx.mjs packages/llm         restrict to a path prefix
 *   node scripts/check-spdx.mjs --fix --skip apps/server/src
 *
 * Wired as `pnpm run check-spdx`, called by `.github/workflows/ci.yml`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The one licence this repo ships under. Must match LICENSE + every package.json. */
const LICENSE_ID = 'AGPL-3.0-only';

/** The exact line `--fix` inserts. Line comments work in all five extensions. */
const HEADER_LINE = `// SPDX-License-Identifier: ${LICENSE_ID}`;

const SPDX_TAG = 'SPDX-License-Identifier:';

/** Executable, copyrightable source. See "WHAT COUNTS" above. */
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);

/**
 * How many leading lines may hold the tag. One would be too strict — a shebang
 * takes line 1, and a header written inside the leading `/** … *\/` block (` *
 * SPDX-License-Identifier: …`) is a perfectly good and common spelling. Five is
 * enough for both while still meaning "at the top of the file" rather than
 * "somewhere in a 600-line module".
 */
const HEADER_WINDOW = 5;

/**
 * Read the licence id a file declares, if any.
 *
 * Returns `null` when there is no tag in the window, or the raw id string when
 * there is — so a file carrying the WRONG licence is reported differently from
 * one carrying none. That distinction matters: a missing header is an
 * oversight `--fix` can repair, whereas an `MIT` header in an AGPL repo is
 * someone's copy-paste from another project and needs a human.
 */
function declaredLicense(text) {
  const lines = text.split('\n', HEADER_WINDOW);
  for (const line of lines) {
    const at = line.indexOf(SPDX_TAG);
    if (at === -1) continue;
    const rest = line.slice(at + SPDX_TAG.length).trim();
    // Stop at whitespace or a comment terminator: ` * SPDX-…: AGPL-3.0-only */`.
    return rest.split(/\s|\*\//)[0] ?? '';
  }
  return null;
}

/**
 * The file's content with the header inserted in the only legal position.
 *
 * After a `#!` line when there is one (trap 2), at offset 0 otherwise. The
 * file's own newline convention is preserved so a `--fix` run cannot smuggle a
 * line-ending change past review.
 */
function withHeader(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  if (text.length === 0) return `${HEADER_LINE}${eol}`;

  const firstBreak = text.indexOf('\n');
  const firstLine = firstBreak === -1 ? text : text.slice(0, firstBreak);
  if (firstLine.startsWith('#!')) {
    const rest = firstBreak === -1 ? '' : text.slice(firstBreak + 1);
    return `${firstLine}${eol}${HEADER_LINE}${eol}${rest}`;
  }
  return `${HEADER_LINE}${eol}${text}`;
}

/** Every tracked source file, repo-relative, in git's order. */
function trackedSources() {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split('\0')
    .filter((file) => file.length > 0 && SOURCE_EXTENSIONS.has(extname(file).toLowerCase()));
}

function parseArgs(argv) {
  const only = [];
  const skip = [];
  let fix = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--fix') {
      fix = true;
    } else if (arg === '--skip') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--skip needs a path prefix');
      skip.push(value.replace(/\/+$/, ''));
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        [
          'node scripts/check-spdx.mjs [--fix] [--skip <prefix>]... [<path prefix>]...',
          '',
          `  Asserts every tracked ${[...SOURCE_EXTENSIONS].join('/')} file opens with`,
          `  "${HEADER_LINE}".`,
          '',
          '  --fix            insert the header where it is missing (after any shebang)',
          '  --skip <prefix>  exclude a path prefix (repeatable)',
          '  <path prefix>    restrict the scan to these prefixes (repeatable)',
        ].join('\n'),
      );
      process.exit(0);
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown flag ${arg}`);
    } else {
      only.push(arg.replace(/\/+$/, ''));
    }
  }
  return { fix, only, skip };
}

/** A prefix matches a whole path segment, so `apps/server` never matches `apps/server-x`. */
function underPrefix(file, prefix) {
  return file === prefix || file.startsWith(`${prefix}/`);
}

/**
 * The repo's declared licence must be the one we stamp. Cheap, and it closes
 * the loop the whole gate rests on: if the project ever relicenses, this fails
 * immediately rather than stamping ~1,950 files with a stale identifier.
 */
function assertRootLicense() {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
  if (pkg.license !== LICENSE_ID) {
    console.error(
      `[spdx] root package.json says license "${pkg.license}" but this gate stamps "${LICENSE_ID}".`,
    );
    console.error('  Relicensing means updating LICENSE, every package.json, and LICENSE_ID here.');
    process.exit(1);
  }
}

function main() {
  const { fix, only, skip } = parseArgs(process.argv.slice(2));
  assertRootLicense();

  const files = trackedSources().filter((file) => {
    if (skip.some((prefix) => underPrefix(file, prefix))) return false;
    return only.length === 0 || only.some((prefix) => underPrefix(file, prefix));
  });

  if (files.length === 0) {
    console.error('[spdx] nothing to check — the path filters matched no tracked source file.');
    console.error('  Refusing to pass: a scan with nothing to scan is not a check.');
    process.exit(1);
  }

  const missing = [];
  const wrong = [];
  let fixed = 0;

  for (const file of files) {
    const absolute = resolve(repoRoot, file);
    // A tracked-but-deleted path is a staged deletion, not a licensing problem.
    if (!existsSync(absolute)) continue;

    const text = readFileSync(absolute, 'utf8');
    const declared = declaredLicense(text);
    if (declared === LICENSE_ID) continue;

    if (declared !== null) {
      // Never rewritten by --fix: a foreign identifier is a provenance
      // question, and silently overwriting it is how a licence violation gets
      // laundered into the tree.
      wrong.push({ file, declared });
      continue;
    }
    if (fix) {
      writeFileSync(absolute, withHeader(text));
      fixed += 1;
    } else {
      missing.push(file);
    }
  }

  if (wrong.length > 0) {
    console.error(`\n[spdx] ${wrong.length} file(s) declare a licence that is not ${LICENSE_ID}:\n`);
    for (const entry of wrong) console.error(`  ✗ ${entry.file} — declares "${entry.declared}"`);
    console.error(
      '\nThese are NOT auto-fixed. Either the file is third-party (it needs a documented' +
        '\nexemption and an entry in the notices) or the header is a copy-paste from another' +
        `\nproject and should read ${LICENSE_ID}.\n`,
    );
    process.exit(1);
  }

  if (missing.length > 0) {
    // Group by package/app: one missing header is a slip, a whole directory of
    // them is a new package nobody ran the fixer on, and the report should make
    // that visible at a glance instead of scrolling 300 identical lines.
    const byArea = new Map();
    for (const file of missing) {
      const segments = file.split('/');
      // `apps/server`, `packages/ui`, `scripts` — the workspace unit, never the
      // file itself (which is what slicing blindly gives for a root-level file).
      const area =
        segments.length > 2
          ? segments.slice(0, 2).join('/')
          : segments.length === 2
            ? segments[0]
            : '(repo root)';
      byArea.set(area, [...(byArea.get(area) ?? []), file]);
    }

    console.error(`\n[spdx] ${missing.length} file(s) have no SPDX-License-Identifier header\n`);
    for (const [area, list] of [...byArea].sort()) {
      console.error(`  ${area} — ${list.length} file(s)`);
      for (const file of list.slice(0, 5)) console.error(`    ✗ ${file}`);
      if (list.length > 5) console.error(`    … and ${list.length - 5} more`);
    }
    console.error(`\nEvery source file this project ships must open with:\n  ${HEADER_LINE}\n`);
    console.error('Insert them all with:\n  pnpm run check-spdx --fix\n');
    process.exit(1);
  }

  if (fix) {
    console.log(`[spdx] ok — inserted ${fixed} header(s); ${files.length} tracked source file(s).`);
    return;
  }
  console.log(`[spdx] ok — ${files.length} tracked source file(s) declare ${LICENSE_ID}.`);
}

main();
