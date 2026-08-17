#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Third-party notices generator — 11-electron.md §13 (11-T18):
 *
 * > in-app viewer for `resources/THIRD-PARTY-NOTICES.txt`, generated at build by
 * > `scripts/generate-notices.mjs` (walks the production dependency graph incl.
 * > Electron + Chromium notices; build fails on unlicensed deps). CI keeps it
 * > current — never hand-edited.
 *
 * WHY THIS IS A BUILD STEP AND A GATE, NOT A DOCUMENT. AGPL-3.0 is Adminium's own
 * licence (LICENSE); the software it BUNDLES ships under dozens of other licences,
 * and distributing those binaries without their notices is the licence violation
 * this file exists to prevent. A hand-maintained NOTICES file drifts the first
 * time a dependency is added and nobody remembers — so this walks the actual
 * production graph the packaged app ships, and FAILS THE BUILD when a bundled
 * package carries no detectable licence. A missing notice is then a red build, not
 * a legal problem discovered after a release.
 *
 * WIRED, the same way `scripts/check-offline-assets.mjs` is (a gate nobody runs is
 * not a gate — see the repo's "green but broken" lesson):
 *   - `apps/desktop`'s `build` script runs it immediately after `electron-vite
 *     build`, before the offline-assets scan, so the notices land in
 *     `resources/` where §10's `files: [resources/**]` ships them;
 *   - root `package.json` exposes `pnpm run generate-notices`, which
 *     `.github/workflows/ci.yml` calls as a named step after the turbo build —
 *     matching how `check-deps` and `check-offline-assets` are wired.
 *
 * It also stages the bundled LICENSE the §13 About panel's in-app viewer reads
 * (`resources/LICENSE`), copied from the repo root so there is one source of
 * truth. Both outputs are build artifacts (`apps/desktop/.gitignore`).
 *
 * Usage:
 *   node scripts/generate-notices.mjs
 *     Walk apps/desktop's production graph + Electron, write
 *     apps/desktop/resources/{THIRD-PARTY-NOTICES.txt,LICENSE}.
 *   node scripts/generate-notices.mjs --package <dir> [--package <dir>]...
 *     Attribute exactly these package directories instead of resolving a graph.
 *     Used by the test suite to point the generator at fixtures.
 *   Flags: --out <file>  --license-out <file>  --license-src <file>
 *          --check  (validate only; write nothing)
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** apps/desktop is the app that is PACKAGED; its production graph is what ships. */
const DESKTOP_PKG = resolve(repoRoot, 'apps/desktop/package.json');
const DEFAULT_OUT = resolve(repoRoot, 'apps/desktop/resources/THIRD-PARTY-NOTICES.txt');
const DEFAULT_LICENSE_OUT = resolve(repoRoot, 'apps/desktop/resources/LICENSE');
const DEFAULT_LICENSE_SRC = resolve(repoRoot, 'LICENSE');

/**
 * The runtime itself. Electron is a devDependency of `@adminium/desktop` — it is
 * the shell, not something the shell imports — but the packaged app IS Electron
 * (Chromium + Node), so §13's "incl. Electron + Chromium notices" makes it a
 * mandatory attribution. Named explicitly for that reason.
 */
const RUNTIME_PACKAGES = ['electron'];

/**
 * First-party workspace packages. Attributed by the app's own LICENSE (AGPL-3.0),
 * so they are not emitted as third-party notices — but the walk still descends
 * INTO them to reach their external dependencies, which do ship.
 */
const FIRST_PARTY_SCOPE = '@adminium/';

/** Files that, by convention, hold a package's licence text. Highest priority first. */
const LICENSE_FILENAMES = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'LICENCE',
  'LICENCE.md',
  'LICENCE.txt',
  'COPYING',
  'COPYING.md',
  'LICENSE-MIT',
  'LICENSE.BSD',
];

/** A licence text over this is truncated with a pointer — a few packages ship huge ones. */
const MAX_LICENSE_TEXT = 64 * 1024;

/** SPDX-ish string, or null. Handles both `license` and the deprecated `licenses` array. */
function licenseId(pkg) {
  if (typeof pkg.license === 'string' && pkg.license.trim() !== '') return pkg.license.trim();
  if (typeof pkg.license === 'object' && pkg.license !== null && typeof pkg.license.type === 'string') {
    return pkg.license.type;
  }
  if (Array.isArray(pkg.licenses)) {
    const types = pkg.licenses
      .map((entry) => (entry && typeof entry.type === 'string' ? entry.type : null))
      .filter((type) => type !== null);
    if (types.length > 0) return types.join(' OR ');
  }
  return null;
}

/** The licence text bundled in `dir`, or null if the package ships none. */
function licenseText(dir) {
  let names;
  try {
    names = new Set(readdirSync(dir));
  } catch {
    return null;
  }
  // Exact conventional names first, then any file whose name STARTS with LICENSE/
  // LICENCE/COPYING (LICENSE-APACHE, COPYING.LESSER, …).
  for (const candidate of LICENSE_FILENAMES) {
    if (names.has(candidate)) return readCapped(join(dir, candidate));
  }
  for (const name of names) {
    if (/^(licen[sc]e|copying)/i.test(name)) {
      const full = join(dir, name);
      try {
        if (statSync(full).isFile()) return readCapped(full);
      } catch {
        /* unreadable — keep looking */
      }
    }
  }
  return null;
}

function readCapped(file) {
  const text = readFileSync(file, 'utf8');
  if (text.length <= MAX_LICENSE_TEXT) return text;
  return `${text.slice(0, MAX_LICENSE_TEXT)}\n\n[…truncated; full text ships in the package]`;
}

/**
 * The notice for one package directory, or a `missing` marker when it carries
 * NEITHER a licence field NOR a licence file — the exact condition §13 says the
 * build must fail on.
 */
export function readPackageNotice(dir) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  } catch {
    return { dir, missing: true, reason: 'no readable package.json' };
  }
  const name = typeof pkg.name === 'string' ? pkg.name : dir;
  const version = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  const id = licenseId(pkg);
  const text = licenseText(dir);

  // "Unlicensed" is the absence of BOTH signals. A valid SPDX id with no bundled
  // file is fine (most packages do exactly that); a bundled file with no field is
  // fine too. Only a package that declares nothing and ships nothing is a
  // distribution risk.
  const declared = id !== null && id.toUpperCase() !== 'UNLICENSED';
  if (!declared && text === null) {
    return { dir, name, version, missing: true, reason: 'no license field and no license file' };
  }
  return {
    name,
    version,
    license: id ?? 'See bundled licence text',
    text,
    homepage: typeof pkg.homepage === 'string' ? pkg.homepage : null,
  };
}

/**
 * Resolve a package's directory from an anchor package.json, tolerating packages
 * that do not export `./package.json` (resolve the entry, then walk up to the dir
 * that holds a package.json with the right name).
 */
function resolvePackageDir(name, anchorPkgJson) {
  const require = createRequire(anchorPkgJson);
  try {
    return dirname(require.resolve(`${name}/package.json`));
  } catch {
    /* fall through */
  }
  try {
    let cursor = dirname(require.resolve(name));
    for (let i = 0; i < 8; i += 1) {
      const candidate = join(cursor, 'package.json');
      if (existsSync(candidate)) {
        try {
          if (JSON.parse(readFileSync(candidate, 'utf8')).name === name) return cursor;
        } catch {
          /* keep walking */
        }
      }
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  } catch {
    /* not resolvable — an optional dep that is not installed */
  }
  return null;
}

/**
 * Walk the production graph from `apps/desktop` + the Electron runtime, breadth
 * first, deduped by `name@version`. Optional dependencies that are not installed
 * are skipped (pg/mysql2 are optional — a build without them is a valid build);
 * a package with no licence is NOT skipped, it is collected as `missing` so the
 * caller can fail.
 */
export function collectDesktopGraph() {
  const desktopPkg = JSON.parse(readFileSync(DESKTOP_PKG, 'utf8'));
  const entries = [
    ...Object.keys(desktopPkg.dependencies ?? {}),
    ...Object.keys(desktopPkg.optionalDependencies ?? {}),
    ...RUNTIME_PACKAGES,
  ];

  const notices = [];
  const missing = [];
  const seen = new Set();
  // queue items: { name, anchor } — anchor is the package.json to resolve FROM.
  const queue = entries.map((name) => ({ name, anchor: DESKTOP_PKG }));

  while (queue.length > 0) {
    const { name, anchor } = queue.shift();
    const dir = resolvePackageDir(name, anchor);
    if (dir === null) continue;
    const dirKey = `dir:${dir}`;
    if (seen.has(dirKey)) continue;
    seen.add(dirKey);

    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    const anchorPkgJson = join(dir, 'package.json');
    // Descend into every package (first-party included) to reach transitive deps.
    for (const depName of Object.keys(pkg.dependencies ?? {})) {
      queue.push({ name: depName, anchor: anchorPkgJson });
    }

    // First-party workspace code is covered by the app's own AGPL LICENSE.
    if (typeof pkg.name === 'string' && pkg.name.startsWith(FIRST_PARTY_SCOPE)) continue;

    const notice = readPackageNotice(dir);
    if (notice.missing === true) {
      missing.push(notice);
      continue;
    }
    const idKey = `id:${notice.name}@${notice.version}`;
    if (seen.has(idKey)) continue;
    seen.add(idKey);
    notices.push(notice);
  }

  notices.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return { notices, missing };
}

/** Attribute an explicit list of package directories (fixture/test mode). */
export function collectFromDirs(dirs) {
  const notices = [];
  const missing = [];
  for (const dir of dirs) {
    const notice = readPackageNotice(dir);
    if (notice.missing === true) missing.push(notice);
    else notices.push(notice);
  }
  notices.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  return { notices, missing };
}

const RULE = '='.repeat(80);
const SUBRULE = '-'.repeat(80);

/** The Chromium block — §13's "incl. … Chromium notices". */
function chromiumNotice() {
  return [
    RULE,
    'Chromium (bundled inside Electron)',
    SUBRULE,
    'The desktop app embeds the Chromium rendering engine through Electron. Chromium',
    'and its own third-party components ship under the BSD-3-Clause licence and many',
    'others; the complete, authoritative notices are bundled with the packaged',
    "application as Electron's LICENSES.chromium.html, viewable from that file. See",
    'https://chromium.googlesource.com/chromium/src/+/main/LICENSE for the Chromium',
    'licence.',
    '',
  ].join('\n');
}

/** The whole THIRD-PARTY-NOTICES.txt body. Deterministic given the same inputs. */
export function renderNotices(notices, opts = {}) {
  const includeChromium = opts.includeChromium !== false;
  const lines = [
    'Adminium Desktop — Third-Party Notices',
    '',
    'Adminium Desktop is free software under AGPL-3.0-only (see the bundled LICENSE).',
    'It incorporates the third-party software listed below, each under its own',
    'licence. This file is generated by scripts/generate-notices.mjs — do not edit it',
    'by hand.',
    '',
    `${notices.length} bundled package(s).`,
    '',
  ];
  for (const notice of notices) {
    lines.push(RULE);
    lines.push(`${notice.name} ${notice.version}`);
    lines.push(`License: ${notice.license}`);
    if (notice.homepage !== null && notice.homepage !== undefined) {
      lines.push(`Homepage: ${notice.homepage}`);
    }
    lines.push(SUBRULE);
    lines.push(notice.text !== null && notice.text !== undefined
      ? notice.text.replace(/\s+$/, '')
      : `(No licence text is bundled with this package; it declares ${notice.license}.)`);
    lines.push('');
  }
  if (includeChromium) lines.push(chromiumNotice());
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

function parseArgs(argv) {
  const opts = { packages: [], out: DEFAULT_OUT, licenseOut: DEFAULT_LICENSE_OUT, licenseSrc: DEFAULT_LICENSE_SRC, check: false };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--package') opts.packages.push(resolve(argv[++i] ?? ''));
    else if (flag === '--out') opts.out = resolve(argv[++i] ?? '');
    else if (flag === '--license-out') opts.licenseOut = resolve(argv[++i] ?? '');
    else if (flag === '--license-src') opts.licenseSrc = resolve(argv[++i] ?? '');
    else if (flag === '--check') opts.check = true;
    else throw new Error(`unknown argument: ${flag}`);
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  const explicit = opts.packages.length > 0;
  const { notices, missing } = explicit ? collectFromDirs(opts.packages) : collectDesktopGraph();

  if (missing.length > 0) {
    console.error(`\n[notices] ${missing.length} bundled package(s) ship no licence — 11-electron.md §13\n`);
    for (const entry of missing) {
      console.error(`  ✗ ${entry.name ?? entry.dir}`);
      console.error(`    ${entry.reason}`);
      console.error(`    at: ${entry.dir}`);
    }
    console.error(
      '\nEvery bundled dependency must carry a licence we can attribute. Add the licence\n' +
        'to the package, remove the dependency, or (if it is genuinely public domain)\n' +
        'confirm and set its `license` field. Refusing to ship a notice we cannot write.\n',
    );
    process.exit(1);
  }

  const body = renderNotices(notices, { includeChromium: !explicit });

  if (opts.check) {
    console.log(`[notices] ok — ${notices.length} package(s); no unlicensed dependency (not written, --check).`);
    return;
  }

  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, body, 'utf8');

  // Stage the bundled LICENSE the §13 in-app viewer reads. One source of truth
  // (the repo LICENSE); the copy is a build artifact.
  let licenseCopied = false;
  if (existsSync(opts.licenseSrc)) {
    mkdirSync(dirname(opts.licenseOut), { recursive: true });
    copyFileSync(opts.licenseSrc, opts.licenseOut);
    licenseCopied = true;
  }

  console.log(
    `[notices] ok — ${notices.length} package(s) attributed → ${opts.out}` +
      (licenseCopied ? `; bundled LICENSE → ${opts.licenseOut}` : ''),
  );
}

// Spawned as a CLI, imported for its exports by the test suite. `import.meta.url`
// vs `process.argv[1]` distinguishes the two, exactly as a Node script that is
// both a module and an entry point must.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
