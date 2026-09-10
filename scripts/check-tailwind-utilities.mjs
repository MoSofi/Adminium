#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tailwind utility gate — every `className` in the themed surfaces names a
 * utility that actually compiles to CSS.
 *
 * ─── The failure this exists to catch ──────────────────────────────────────
 *
 * Tailwind emits NOTHING for a utility whose token is undefined. Not a warning,
 * not a build error — the class simply produces no rule and the element falls
 * back to the CSS initial value. On 2026-09-10 a sweep found **30 call sites**
 * across sixteen undefined utilities, every one of them shipping:
 *
 *   text-h1 / text-h2 / text-h3   the type scale is SEMANTIC (display, title,
 *                                 modal, section, …) and has no numbered tiers,
 *                                 so the desktop first-run `<h1>` and the
 *                                 record-page hero both rendered at body size
 *   text-body-lg / -xs, -title-md the same scale has no size modifiers
 *   bg-surface-1                  six card components with NO background at all
 *   border-line, border-*-border  black borders, because the initial value of
 *                                 `border-color` is `currentColor`
 *   text-danger-fg                black text on `bg-danger` — 4.01:1, a WCAG AA
 *                                 FAILURE that shipped looking deliberate
 *
 * None of it was catchable by anything the repo already ran. `tsc` and eslint
 * never read the inside of a string; no unit test, snapshot or VRT baseline
 * asserts on a class name; and Storybook is blind for a separate reason
 * (packages/ui/src/styles/storybook.css does not `@source` widgets/charts). The
 * only signal was visual, on screens nobody had opened lately.
 *
 * ─── Why this asks Tailwind instead of pattern-matching ────────────────────
 *
 * The obvious implementation — regex the class names out, diff them against the
 * `--color-*` / `--text-*` tokens — was written first and was unusable: it
 * reported 101 problems of which 3 were real. Tailwind's own built-ins are the
 * noise (`border-b`, `ring-offset-surface`, `outline-offset-2`,
 * `bg-gradient-to-b` all *look* like token references and are not), and any
 * hand-maintained allowlist of them starts rotting the day Tailwind ships a new
 * utility.
 *
 * So this asks the compiler. `__unstable__loadDesignSystem` builds the real
 * design system from the app's real CSS entry, and `candidatesToCss` returns
 * `null` for exactly the candidates that would produce no rule. That is the
 * same oracle the editor tooling uses, it needs no list, and it is correct by
 * construction for variants (`hover:`), arbitrary values (`text-[23px]`) and
 * opacity (`bg-surface/40`) without a line of code here knowing they exist.
 *
 * ─── Why the namespace-root filter ─────────────────────────────────────────
 *
 * Tailwind's scanner is deliberately liberal, and a `className` expression
 * legitimately contains strings that are not classes at all: `cn(status ===
 * 'saved' && 'text-pos')` yields `saved`, and the repo has real hand-written CSS
 * classes (`adm-chart-*` in packages/charts/src/styles.css, `nb-*` in the
 * dashboard entry) that Tailwind rightly knows nothing about. Flagging every
 * non-compiling string would bury the signal.
 *
 * The filter is derived, not written down: every namespace root Tailwind itself
 * publishes in `getClassList()` (150 of them, from 25k classes). A candidate is
 * only ever reported when its root IS a Tailwind namespace — so `border-line`
 * is checked and `adm-chart-fade`, `nb-scroll`, `single-choice` and `saved` are
 * not, without naming any of them. The cost is deliberate: an unknown root is
 * skipped, so this trades a possible false negative for a zero false-positive
 * rate. A gate people learn to ignore catches nothing.
 *
 * ─── Scope comes from the build, not from here ─────────────────────────────
 *
 * The files scanned are the ones the dashboard's Tailwind entry declares in its
 * `@source` globs — dashboard, ui, widgets, charts. Those four are what share
 * this theme; apps/docs has its own stylesheets and is deliberately out of
 * scope. Deriving it means adding a `@source` extends this gate automatically
 * and a stale hardcoded list is impossible.
 *
 * Usage:
 *   pnpm run check-tailwind-utilities
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDir = path.join(root, 'apps', 'dashboard');
const entryCss = path.join(appDir, 'src', 'styles.css');

const require = createRequire(path.join(appDir, 'noop.js'));

/** Tailwind is a dependency of apps/dashboard, not of the root workspace. */
let loadDesignSystem;
let tailwindDir;
try {
  const entryJs = require.resolve('tailwindcss');
  const mod = await import(entryJs);
  loadDesignSystem = (mod.default ?? mod).__unstable__loadDesignSystem;
  tailwindDir = path.resolve(path.dirname(entryJs), '..');
} catch (cause) {
  console.error(
    'Tailwind utility gate: could not load `tailwindcss` from apps/dashboard.\n' +
      `  ${cause instanceof Error ? cause.message : String(cause)}\n` +
      'Run `pnpm install` first — this gate compiles against the real design system.',
  );
  process.exit(1);
}
if (typeof loadDesignSystem !== 'function') {
  console.error(
    'Tailwind utility gate: `__unstable__loadDesignSystem` is gone from this tailwindcss build.\n' +
      'It is an unstable export by name and may be renamed across major versions. Re-point this\n' +
      'script at whatever replaced it, or fall back to compiling a probe stylesheet — do NOT\n' +
      'replace the oracle with a hand-written allowlist (see the header).',
  );
  process.exit(1);
}

/** Resolve `@import` the way the app's bundler does. */
async function loadStylesheet(id, base) {
  let file;
  if (id === 'tailwindcss') file = path.join(tailwindDir, 'index.css');
  else if (id.startsWith('tailwindcss/')) file = path.join(tailwindDir, id.slice('tailwindcss/'.length));
  else if (id.startsWith('@adminium/')) file = require.resolve(id, { paths: [appDir] });
  else file = path.resolve(base, id);
  return { path: file, base: path.dirname(file), content: fs.readFileSync(file, 'utf8') };
}

const entrySource = fs.readFileSync(entryCss, 'utf8');
const design = await loadDesignSystem(entrySource, {
  base: path.join(appDir, 'src'),
  loadStylesheet,
  loadModule: async () => {
    throw new Error('this entry uses no JS config');
  },
});

/** Every namespace root Tailwind publishes — the false-positive filter. */
const roots = new Set();
const validClasses = [];
for (const entry of design.getClassList()) {
  const name = Array.isArray(entry) ? entry[0] : entry;
  validClasses.push(name);
  if (name.includes('-')) roots.add(name.slice(0, name.indexOf('-')));
}

/** The files the app's Tailwind entry says it generates utilities for. */
function sourceDirs() {
  const dirs = [];
  const base = path.join(appDir, 'src');
  for (const m of entrySource.matchAll(/@source\s+"([^"]+)"/g)) {
    const glob = m[1];
    const star = glob.indexOf('**');
    if (star === -1) continue;
    const exts = /\{([^}]+)\}/.exec(glob);
    const dir = path.resolve(base, glob.slice(0, star));
    dirs.push({
      glob,
      dir: fs.existsSync(dir) ? fs.realpathSync(dir) : dir,
      exts: (exts === null ? ['ts', 'tsx'] : exts[1].split(',')).map((e) => `.${e.trim()}`),
    });
  }
  return dirs;
}

function walk(dir, exts, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.add(full);
  }
  return out;
}

const dirs = sourceDirs();
const missing = dirs.filter((d) => !fs.existsSync(d.dir));
const files = new Set();
for (const d of dirs) walk(d.dir, d.exts, files);

if (files.size === 0) {
  console.error(
    'Tailwind utility gate: the @source globs in apps/dashboard/src/styles.css matched no files.\n' +
      'Either the globs changed shape or the workspace is not installed. Refusing to report a\n' +
      'green run over an empty scan.',
  );
  process.exit(1);
}

/**
 * Candidates from `className`/`class` only. A blanket scan of the file would
 * also pick up prose in comments — `text-embedding-3-small` is a real example
 * from this repo, and its root `text` IS a Tailwind namespace, so the filter
 * below would not save us. Scoping to the attribute is what makes this quiet.
 */
const ATTR = /\bclass(?:Name)?\s*=\s*/g;

/**
 * Index of the `}` closing the `{` at `open`, skipping over strings, template
 * literals and comments. A regex cannot do this: `className={`a ${x ? 'b' :
 * 'c'}`}` closes on its SECOND brace, and a non-greedy `\{.*?\}` truncates at
 * the first — losing every class after the interpolation.
 */
function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i);
      if (i === -1) return -1;
    } else if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2);
      if (i === -1) return -1;
      i += 1;
    } else if (c === '"' || c === "'" || c === '`') {
      i = skipString(src, i);
      if (i === -1) return -1;
    } else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Index of the closing quote of the string starting at `start`. */
function skipString(src, start) {
  const quote = src[start];
  for (let i = start + 1; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') i++;
    else if (c === quote) return i;
    else if (quote === '`' && c === '$' && src[i + 1] === '{') {
      const end = matchBrace(src, i + 1);
      if (end === -1) return -1;
      i = end;
    } else if (quote !== '`' && c === '\n') return -1;
  }
  return -1;
}

/**
 * The class-bearing string literals inside a `className={…}` expression.
 *
 * A template literal keeps its literal spans: `` `text-h1 font-bold ${cond ? …}` ``
 * really does apply `text-h1`, and that exact shape was one of the thirty
 * defects this gate was written for. Each `${…}` becomes a sentinel so the
 * token it was glued to (`bg-${tone}`) is dropped as a fragment rather than
 * reported as an undefined utility.
 */
const GLUE = '￿';
function literalsIn(expr) {
  const out = [];
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '/' && expr[i + 1] === '/') {
      i = expr.indexOf('\n', i);
      if (i === -1) break;
    } else if (c === '/' && expr[i + 1] === '*') {
      i = expr.indexOf('*/', i + 2);
      if (i === -1) break;
      i += 1;
    } else if (c === '"' || c === "'" || c === '`') {
      const end = skipString(expr, i);
      if (end === -1) break;
      const raw = expr.slice(i + 1, end);
      out.push(c === '`' ? raw.replace(/\$\{(?:[^{}]|\{[^}]*\})*\}/g, GLUE) : raw);
      i = end;
    }
  }
  return out;
}

/** Strip variants, `!`, negation and the `/opacity` suffix to find the root. */
function rootOf(candidate) {
  const bare = candidate.slice(candidate.lastIndexOf(':') + 1).replace(/^!/, '').replace(/^-/, '');
  const stem = bare.slice(0, bare.indexOf('/') === -1 ? bare.length : bare.indexOf('/'));
  return stem.includes('-') ? stem.slice(0, stem.indexOf('-')) : null;
}

const sightings = new Map(); // candidate -> [{ file, line }]
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file);
  ATTR.lastIndex = 0;
  let m;
  while ((m = ATTR.exec(src)) !== null) {
    const at = m.index + m[0].length;
    const opener = src[at];
    let pieces;
    if (opener === '"' || opener === "'") {
      const end = skipString(src, at);
      if (end === -1) continue;
      pieces = [src.slice(at + 1, end)];
      ATTR.lastIndex = end + 1;
    } else if (opener === '{') {
      const end = matchBrace(src, at);
      if (end === -1) continue;
      pieces = literalsIn(src.slice(at + 1, end));
      ATTR.lastIndex = end + 1;
    } else continue;

    const line = src.slice(0, m.index).split('\n').length;
    for (const piece of pieces) {
      for (const cls of piece.split(/\s+/)) {
        // A token glued to an interpolation (`bg-${tone}`) is a fragment, not a
        // class name — the sentinel is how we tell the two apart.
        if (cls === '' || cls.includes(GLUE) || /[<>()]/.test(cls)) continue;
        const nsRoot = rootOf(cls);
        if (nsRoot === null || !roots.has(nsRoot)) continue;
        const seen = sightings.get(cls) ?? sightings.set(cls, []).get(cls);
        seen.push({ file: rel, line });
      }
    }
  }
}

const candidates = [...sightings.keys()];
const compiled = design.candidatesToCss(candidates);
const broken = candidates.filter((_, i) => compiled[i] === null).sort();

/**
 * Which theme namespaces a root draws its values from. Suggesting out of the
 * right one is the difference between "did you mean text-title" and the
 * edit-distance-over-everything answer, which for `text-h2` was `text-bg`.
 */
const NAMESPACES = {
  text: ['--text', '--color'],
  font: ['--font', '--font-weight'],
  leading: ['--leading'],
  tracking: ['--tracking'],
  rounded: ['--radius'],
  shadow: ['--shadow'],
  bg: ['--color'],
  border: ['--color'],
  divide: ['--color'],
  ring: ['--color'],
  outline: ['--color'],
  fill: ['--color'],
  stroke: ['--color'],
  decoration: ['--color'],
  accent: ['--color'],
  caret: ['--color'],
  from: ['--color'],
  via: ['--color'],
  to: ['--color'],
};

/** Tailwind's own `--text` keys, so the report can name OURS specifically. */
const STOCK_TEXT = new Set(['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl']);

function poolFor(nsRoot) {
  const spaces = NAMESPACES[nsRoot];
  if (spaces === undefined) return validClasses.filter((c) => c.startsWith(`${nsRoot}-`));
  const keys = design.theme.keysInNamespaces(spaces);
  return keys.map((k) => `${nsRoot}-${k}`);
}

/** Nearest valid utility from the right namespace, so the report says what to use. */
function suggest(candidate) {
  const nsRoot = rootOf(candidate);
  const stem = candidate.slice(candidate.lastIndexOf(':') + 1);
  let best = null;
  let bestScore = Infinity;
  for (const c of poolFor(nsRoot)) {
    const score = distance(stem, c);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore <= 6 ? best : null;
}

/**
 * The project's own type scale, printed whenever a `text-*` size is invented.
 * That is the recurring mistake — `h1`/`h2`/`h3` and `-lg`/`-md`/`-xs` are what
 * people reach for, and none of them exist here — so the fix is worth spelling
 * out rather than leaving to one nearest-neighbour guess.
 */
function typeScaleNote() {
  const ours = design.theme.keysInNamespaces(['--text']).filter((k) => !STOCK_TEXT.has(k));
  return `      the type scale is: ${ours.map((k) => `text-${k}`).join(', ')}`;
}

function distance(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (a[i - 1] === b[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[b.length];
}

if (missing.length > 0) {
  for (const d of missing) {
    console.warn(`Tailwind utility gate: @source "${d.glob}" resolves to a path that does not exist — not scanned.`);
  }
}

if (broken.length > 0) {
  const total = broken.reduce((n, c) => n + sightings.get(c).length, 0);
  console.error(
    `Tailwind utility gate FAILED — ${String(broken.length)} undefined ` +
      `${broken.length === 1 ? 'utility' : 'utilities'} at ${String(total)} call ` +
      `${total === 1 ? 'site' : 'sites'}.\n` +
      'Each of these compiles to NO CSS, so the element silently renders at the inherited\n' +
      'value: a heading at body size, a card with no background, a black border.\n',
  );
  let sawTextSize = false;
  for (const cls of broken) {
    const where = sightings.get(cls);
    const hint = suggest(cls);
    console.error(`  ${cls}${hint === null ? '' : `   — did you mean \`${hint}\`?`}`);
    for (const w of where.slice(0, 6)) console.error(`      ${w.file}:${String(w.line)}`);
    if (where.length > 6) console.error(`      …and ${String(where.length - 6)} more`);
    if (rootOf(cls) === 'text') sawTextSize = true;
    console.error('');
  }
  if (sawTextSize) console.error(`${typeScaleNote()}\n`);
  console.error(
    'The scale is semantic, not numbered: packages/tokens/src/tailwind.css is the list of\n' +
      'what exists. If a tier is genuinely missing, add the token there rather than inventing\n' +
      'a class name at the call site.',
  );
  process.exit(1);
}

console.log(
  `Tailwind utilities OK — ${String(candidates.length)} token-namespaced ` +
    `${candidates.length === 1 ? 'class' : 'classes'} across ${String(files.size)} files, ` +
    'all compile against the real design system.',
);
