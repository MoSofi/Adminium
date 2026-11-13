// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Take the comments out of Adminium's own built JavaScript, for the Docker
 * image only.
 *
 * WHY. V8 keeps the source text of every module it loads for as long as the
 * process runs (it compiles functions lazily, from that text). The engine's
 * sources carry long explanatory comments, and many of them use characters
 * outside Latin-1 (dashes, box lines), which makes V8 hold the whole file as
 * two bytes a character. Measured on 0.3.56: about 56 MB of the ~170 MB heap a
 * started server holds is module source, and taking the comments out cuts the
 * heap by about 18 MB, every container, for nothing at run time. The npm package
 * keeps its comments; only the image's copy is stripped.
 *
 * WHAT. Every `.js` file under `dist/` of each `@adminium/*` package found in
 * the tree given (the deployed `/app`, with its injected workspace packages),
 * printed again by TypeScript with `removeComments`. Untouched:
 *   - the meta migrations: the migrator checks each one by a hash of its
 *     function's source text, and a reprinted migration would read as an
 *     edited one and stop the boot;
 *   - comments starting `/*!`, which TypeScript keeps (licence notices);
 *   - everything that is not an `@adminium/*` package's `dist/`.
 *
 * Source maps no longer match the stripped files, so they are deleted beside
 * them: a stack trace then names the stripped file's own lines rather than a
 * wrong place in the original.
 *
 *   node scripts/release/strip-image-comments.mjs /app
 */
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2];
if (root === undefined) {
  console.error('usage: strip-image-comments.mjs <deployed tree>');
  process.exit(1);
}

// TypeScript is the server's own build tool, so it is in every build of the image.
const require = createRequire(fileURLToPath(new URL('../../apps/server/package.json', import.meta.url)));
const ts = require('typescript');

/** Folders whose files are never reprinted, relative to a package root. */
const KEEP = [join('dist', 'migrations')];

/** Every `@adminium/*` package root under `dir` (node_modules included, symlinks not followed). */
function packageRoots(dir, found = new Set()) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  if (entries.some((e) => e.isFile() && e.name === 'package.json')) {
    try {
      const name = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name;
      if (typeof name === 'string' && name.startsWith('@adminium/')) found.add(dir);
    } catch {
      // not a package we can read: not ours
    }
  }
  for (const e of entries) {
    if (e.isDirectory() && e.name !== 'dist' && e.name !== '.git') packageRoots(join(dir, e.name), found);
  }
  return found;
}

let files = 0;
let before = 0;
let after = 0;

function strip(dir, pkgRoot) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) {
      if (KEEP.some((keep) => path === join(pkgRoot, keep))) continue;
      strip(path, pkgRoot);
    } else if (e.isFile() && e.name.endsWith('.js')) {
      const source = readFileSync(path, 'utf8');
      const out = ts.transpileModule(source, {
        fileName: e.name,
        compilerOptions: {
          allowJs: true,
          removeComments: true,
          target: ts.ScriptTarget.ESNext,
          module: ts.ModuleKind.ESNext,
          // Keep every import as written: nothing is elided as "type only".
          verbatimModuleSyntax: true,
          sourceMap: false,
        },
        reportDiagnostics: false,
      }).outputText;
      writeFileSync(path, out);
      rmSync(`${path}.map`, { force: true });
      files += 1;
      before += source.length;
      after += out.length;
    }
  }
}

const roots = [...packageRoots(root)];
for (const pkgRoot of roots) {
  const dist = join(pkgRoot, 'dist');
  try {
    if (!statSync(dist).isDirectory()) continue;
  } catch {
    continue;
  }
  strip(dist, pkgRoot);
}
const mb = (n) => (n / 1048576).toFixed(1);
console.log(`stripped comments from ${String(files)} files in ${String(roots.length)} packages: ${mb(before)} MB -> ${mb(after)} MB`);
if (files === 0) {
  // A tree with no Adminium package in it is a wrong argument, not a clean result.
  console.error(`no @adminium/* dist found under ${root}${sep}`);
  process.exit(1);
}
