#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Every built `.js` file Adminium ships carries the licence line.
 *
 * `check-spdx.mjs` proves every tracked source opens with
 * `// SPDX-License-Identifier: AGPL-3.0-only`. That is not enough on its own,
 * because the line people and scanners read is the one in the npm tarball and
 * the Docker image, and those hold what tsc wrote, not the source.
 *
 * WHY THEY DIFFER. tsc hangs a file's first comments on its first statement.
 * When that statement is erased from the output (an `import type`, an
 * `export type`, an interface), the comments go with it, the licence line
 * included. So each shipped package's build runs scripts/stamp-dist-spdx.mjs
 * after tsc, which writes the line back, and this proves it did. A package
 * this reports needs that step in its `build` script.
 *
 * WHAT IS READ. The `dist/` of every package that ships: each `@adminium/*`
 * workspace that is not `private`, each one the CLI carries inside its
 * tarball (`bundled` in scripts/release/server-runtime-deps.json), and every
 * workspace package those depend on at run time. Given a
 * folder instead (the image's deployed `/app`), it reads the `dist/` of every
 * `@adminium/*` package found under it, so the image build can check its own
 * copy after its comments are taken out.
 *
 * Usage:
 *   node scripts/check-dist-spdx.mjs          check the shipped packages' dists (build first)
 *   node scripts/check-dist-spdx.mjs <tree>   check every @adminium/* dist under a deployed tree
 *
 * Wired as `pnpm run check-dist-spdx`, called by `.github/workflows/ci.yml`
 * after the build, and by the Dockerfile after the image's comments come out.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const HEADER = 'SPDX-License-Identifier: AGPL-3.0-only';

/** Lines the header may sit in: a shebang can take the first. Same window as check-spdx. */
const HEADER_WINDOW = 5;

const WORKSPACE_GROUPS = ['apps', 'packages'];

const STAMP = 'scripts/stamp-dist-spdx.mjs';
const STAMP_CALL = `tsc -p tsconfig.json && node ../../${STAMP}`;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Fields whose packages are installed beside a package that ships. */
const RUNTIME_DEP_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies'];

/**
 * The package roots whose `dist/` ships, from this repo's manifests: the
 * published and bundled ones, and every workspace package they depend on at
 * run time (the image installs those too, `@adminium/charts` among them).
 */
function shippedPackages() {
  const workspaces = new Map();
  for (const group of WORKSPACE_GROUPS) {
    for (const entry of readdirSync(join(repoRoot, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const root = join(repoRoot, group, entry.name);
      if (!existsSync(join(root, 'package.json'))) continue;
      const pkg = readJson(join(root, 'package.json'));
      if (typeof pkg.name === 'string' && pkg.name.startsWith('@adminium/')) workspaces.set(pkg.name, { root, pkg });
    }
  }
  const bundled = readJson(join(repoRoot, 'scripts/release/server-runtime-deps.json')).bundled;
  const queue = [...[...workspaces.values()].filter(({ pkg }) => pkg.private !== true).map(({ pkg }) => pkg.name), ...bundled];
  const shipped = new Set();
  while (queue.length > 0) {
    const name = queue.pop();
    if (shipped.has(name) || !workspaces.has(name)) continue;
    shipped.add(name);
    const { pkg } = workspaces.get(name);
    for (const field of RUNTIME_DEP_FIELDS) queue.push(...Object.keys(pkg[field] ?? {}).filter((dep) => workspaces.has(dep)));
  }
  return [...shipped].sort().map((name) => workspaces.get(name).root);
}

/** Every `@adminium/*` package root under a deployed tree (symlinks not followed). */
function deployedPackages(dir, found = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  if (entries.some((e) => e.isFile() && e.name === 'package.json')) {
    try {
      const { name } = readJson(join(dir, 'package.json'));
      if (typeof name === 'string' && name.startsWith('@adminium/')) found.push(dir);
    } catch {
      // not a manifest we can read: not ours
    }
  }
  for (const e of entries) {
    if (e.isDirectory() && e.name !== 'dist' && e.name !== '.git') deployedPackages(join(dir, e.name), found);
  }
  return found;
}

function jsFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) jsFiles(path, out);
    else if (e.isFile() && e.name.endsWith('.js')) out.push(path);
  }
  return out;
}

function hasHeader(text) {
  return text.split('\n', HEADER_WINDOW).some((line) => line.includes(HEADER));
}

function main() {
  const trees = process.argv.slice(2);
  if (trees.length > 1 || trees.some((arg) => arg.startsWith('-'))) {
    console.error('usage: check-dist-spdx.mjs [<deployed tree>]');
    process.exit(1);
  }

  const roots = trees.length === 1 ? deployedPackages(resolve(trees[0])) : shippedPackages();
  const base = trees.length === 1 ? resolve(trees[0]) : repoRoot;

  // In the repo, every shipped package's build must run the stamp, even one
  // whose files all keep their header today: the next `import type` on a
  // first line would otherwise only show up here, after the fact.
  if (trees.length === 0) {
    const unstamped = roots.filter((root) => !String(readJson(join(root, 'package.json')).scripts?.build ?? '').includes(STAMP));
    if (unstamped.length > 0) {
      console.error(`[dist-spdx] the build of ${unstamped.map((root) => relative(repoRoot, root)).join(', ')} does not run ${STAMP}.`);
      console.error(`Add it after tsc:
  ${STAMP_CALL}`);
      process.exit(1);
    }
  }

  const unbuilt = [];
  const missing = [];
  let files = 0;
  for (const root of roots) {
    const dist = join(root, 'dist');
    if (!existsSync(dist) || !statSync(dist).isDirectory()) {
      unbuilt.push(relative(base, root));
      continue;
    }
    for (const file of jsFiles(dist)) {
      files += 1;
      if (!hasHeader(readFileSync(file, 'utf8'))) missing.push(file);
    }
  }

  if (unbuilt.length > 0 && trees.length === 0) {
    // A shipped package with no dist is a run before the build, not a pass.
    console.error(`[dist-spdx] no dist/ in ${unbuilt.join(', ')}. Build first: pnpm turbo run build`);
    process.exit(1);
  }
  if (files === 0) {
    console.error(`[dist-spdx] no built .js file found under ${base}. A scan of nothing is not a check.`);
    process.exit(1);
  }

  if (missing.length > 0) {
    console.error(`\n[dist-spdx] ${String(missing.length)} of ${String(files)} built file(s) have no "${HEADER}" line:\n`);
    for (const file of missing.slice(0, 20)) console.error(`  ✗ ${relative(base, file)}`);
    if (missing.length > 20) console.error(`  … and ${String(missing.length - 20)} more`);
    console.error(
      '\ntsc drops a header that sits right above a statement it erases (an `import type`, a type).' +
        `\nThe package's \`build\` script must run the stamp after tsc, and rebuild:\n  ${STAMP_CALL}\n`,
    );
    process.exit(1);
  }

  console.log(`[dist-spdx] ok: ${String(files)} built file(s) in ${String(roots.length)} package(s) carry ${HEADER}.`);
}

main();
