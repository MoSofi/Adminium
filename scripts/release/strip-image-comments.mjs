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
 * with its comments taken out (found by TypeScript's parser, so nothing inside
 * a string, template or regular expression is touched). Untouched:
 *   - the meta migrations: the migrator checks each one by a hash of its
 *     function's source text, and a reprinted migration would read as an
 *     edited one and stop the boot;
 *   - licence comments, wherever they stand: those starting `/*!` and those
 *     naming `SPDX-` or `@license` (`// SPDX-License-Identifier: …` heads every
 *     file; the code is AGPL-3.0);
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

// TypeScript (its parser) is the server's own build tool, so it is in every build of the image.
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

/** A comment that carries a licence: kept in the stripped file, as is every `/*!` comment. */
const LICENCE = /SPDX-|@license/;

const LINE_BREAK = /[\n\r\u2028\u2029]/;

/**
 * Every comment in `source`, in order. Found through the parsed file (the
 * trivia before each token, the end of the file's included), so text inside a
 * string, a template or a regular expression is never taken for one.
 */
function commentRanges(source, fileName) {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const ranges = new Map();
  const visit = (node) => {
    // A JSDoc node lies inside the comment it was read from.
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    // Comments on the line a token's trivia starts on are the "trailing" ones, those after a line break "leading".
    for (const range of [...(ts.getTrailingCommentRanges(source, node.pos) ?? []), ...(ts.getLeadingCommentRanges(source, node.pos) ?? [])]) ranges.set(range.pos, range);
    for (const child of node.getChildren(file)) visit(child);
  };
  visit(file);
  return [...ranges.values()].sort((a, b) => a.pos - b.pos);
}

/**
 * `source` without its comments, licence comments kept. Nothing else is
 * touched: a removed comment leaves what the language reads it as, a line
 * break where it held one and a space otherwise, so no two tokens join and no
 * statement's end moves.
 */
function stripComments(source, fileName) {
  let out = '';
  let at = 0;
  for (const range of commentRanges(source, fileName)) {
    if (range.pos < at) continue;
    const text = source.slice(range.pos, range.end);
    const keep = text.startsWith('/*!') || LICENCE.test(text);
    out += source.slice(at, range.pos);
    if (keep) out += text;
    else if (range.kind === ts.SyntaxKind.MultiLineCommentTrivia) out += LINE_BREAK.test(text) ? '\n' : ' ';
    at = range.end;
  }
  return out + source.slice(at);
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
      const out = stripComments(source, e.name);
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
