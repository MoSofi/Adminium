// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app that builds its screens with a command of its own.
 *
 * A starter app's screens are built by the engine's bundler and by nothing
 * else. An app copied from a published one keeps the build it was written
 * with (Vite), named in `apps/<key>/build.json`:
 *
 *   { "install": "npm ci --ignore-scripts",
 *     "command": "… vite build …",
 *     "output":  "dist-surface/<key>" }
 *
 * A command is a shell. So it runs only once a PERSON approved its exact
 * words, and the approval is kept where no tool that edits an app can reach:
 * `.adminium/approved-builds.json` in the project, never in the app's folder.
 * Change one character of `build.json` and the approval no longer matches.
 * Until it does, the app is listed with that as its problem, and what the
 * last approved build left keeps serving.
 *
 * The build runs in the app's folder with a scrubbed environment (no
 * `ADMINIUM_*`, no keys) and a time limit. It is NOT a sandbox: it runs as
 * the server's user and can read what that user can. Two things stand in
 * for one. What the build runs as code is a person's to change (the config,
 * and with a yes each time what the config imports). And the build's Node
 * processes cannot read a file outside the app's folder (the guard below): a
 * bundler copies whatever a source file imports into the screens it serves.
 * A source file that plainly names such a path stops the build before it
 * starts, with the file's name: that check is the readable message, the
 * guard is the rule. What it leaves in
 * `<output>/staff` and `<output>/customer` is copied to where the engine's
 * own builds go, so serving is the same for both kinds of app.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

import { buildLinePath } from '../programs.js';

import { BUILD_DIR } from '../build-shared.js';
import { APPS_DIR, SIDES, appDir, type AppSide } from './read-app.js';

export const APP_BUILD_JSON = 'build.json';
export const APPROVED_BUILDS_FILE = join('.adminium', 'approved-builds.json');
const STEP_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT = 20_000;

export interface AppBuildFile {
  /** Run once, and again when the lock file changes. Install scripts never run by the command the copy writes. */
  install: string;
  command: string;
  /** Where the build leaves `staff/` and `customer/`, relative to the app's folder. */
  output: string;
}

const sha256 = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');

/** Whether an app builds with a command of its own. */
export const hasOwnBuild = (root: string, key: string): boolean => existsSync(join(appDir(root, key), APP_BUILD_JSON));

/** An app's `build.json`: the three fields, or why it does not read. Null when the app has none. */
export function readAppBuild(root: string, key: string): AppBuildFile | { problem: string } | null {
  const file = join(appDir(root, key), APP_BUILD_JSON);
  if (!existsSync(file)) return null;
  const where = `${APPS_DIR}/${key}/${APP_BUILD_JSON}`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return { problem: `${where} is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const given = (parsed ?? {}) as Record<string, unknown>;
  const text = (name: string): string | null => (typeof given[name] === 'string' && given[name].trim() !== '' && given[name].length <= 2000 && !/[\r\n\0]/.test(given[name]) ? given[name] : null);
  const install = text('install');
  const command = text('command');
  const output = text('output');
  if (install === null || command === null || output === null) return { problem: `${where} needs "install", "command" and "output", each one line of text.` };
  // The output is a folder of the app, by a plain relative path.
  if (output.startsWith('/') || output.includes('\\') || output.split('/').some((part) => part === '' || part === '.' || part === '..' || part.startsWith('.'))) {
    return { problem: `${where}: "output" is a plain folder inside the app, like dist-surface/${key}.` };
  }
  return { install, command, output };
}

/** What an approval is of: the exact words of all three lines. */
export const buildFingerprint = (build: AppBuildFile): string => sha256(`${build.install}\n${build.command}\n${build.output}`);

function approvals(root: string): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(join(root, APPROVED_BUILDS_FILE), 'utf8')) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export const isBuildApproved = (root: string, key: string, build: AppBuildFile): boolean => approvals(root)[key] === buildFingerprint(build);

/** Record that a person approved this app's build as it reads now. */
export function approveBuild(root: string, key: string, build: AppBuildFile): void {
  const file = join(root, APPROVED_BUILDS_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...approvals(root), [key]: buildFingerprint(build) }, null, 2)}\n`, { mode: 0o600 });
}

/** The problem an unapproved build is listed with: the words a person is asked to approve. */
export const unapprovedProblem = (key: string, build: AppBuildFile): string =>
  `${APPS_DIR}/${key} — its build is not approved, so it was not run. It would run, in ${APPS_DIR}/${key}/:  ${build.install}  and then  ${build.command}  Approve it with:  adminium app approve-build ${key}`;

/** `\x2e`, `\u002e`, `\u{2e}` and CSS's `\2e ` read as the character they are: a path is judged as the bundler reads it. */
const unescaped = (text: string): string =>
  text
    .replace(/\\x([0-9a-fA-F]{2})/g, (_all, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (_all, hex: string) => String.fromCodePoint(Math.min(Number.parseInt(hex, 16), 0x10ffff)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_all, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_all, hex: string) => String.fromCodePoint(Math.min(Number.parseInt(hex, 16), 0x10ffff)))
    // A line carried on, and any other character said with a backslash before it (`\.`, `\/`).
    .replace(/\\\r?\n/g, '')
    .replace(/\\([^\n])/g, '$1');
const CODE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];
/** Space, or a comment, where the language allows one between a keyword and what it names. */
const GAP = String.raw`(?:\s|\/\*[^]*?\*\/)*`;
const IMPORT_SPEC = new RegExp(String.raw`(?:\bfrom${GAP}|\bimport${GAP}\(?${GAP}|\brequire${GAP}\(${GAP})(['"\`])(\.{1,2}(?:\/[^'"\`\n]*)?)\1`, 'g');
/**
 * `import type X from`, `import type { A } from`, `export type * from`: erased before anything runs. Not
 * `import type from './x'` (a default import that is named "type"), and never across a statement.
 */
const TYPE_ONLY = /\b(?:import|export)\s+type\s+(?!from\s*['"`])(?:\*\s*as\s+[\w$]+|[\w$]+|\{[^}'"`;]*\}|\*)\s*from\s*(['"`])[^'"`\n]*\1/g;
const MAX_CODE_FILES = 4000;

/** A path inside the app without its last extension, folded: `src/Nav.ts` and `src/nav.tsx` are one stem. */
export const codeStem = (path: string): string => {
  const folded = path.normalize('NFC').toLowerCase();
  const dot = folded.lastIndexOf('.');
  return dot > folded.lastIndexOf('/') && CODE_EXTENSIONS.includes(folded.slice(dot)) ? folded.slice(0, dot) : folded;
};

/**
 * The files an app's build RUNS on this machine, as stems: its Vite config
 * and everything that config imports, by relative path, however deep. Vite
 * bundles the config's imports and executes them in Node before it builds
 * anything, so a change to one of them is a change to what the approved
 * command does.
 *
 * Stems, not files: beside `nav.ts` a new `nav.tsx` would be picked first by
 * the resolver, and beside a folder's `index.ts` a file named as the folder.
 * Every spelling an import could resolve to is in the set, there or not.
 */
export function buildCodeStems(root: string, key: string): Set<string> {
  const dir = appDir(root, key);
  const stems = new Set<string>();
  const seen = new Set<string>();
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((name) => /^vite\.config\.[a-z]+$/i.test(name));
  } catch {
    return stems;
  }
  const isFile = (relative: string): boolean => {
    try {
      return statSync(join(dir, relative)).isFile();
    } catch {
      return false;
    }
  };
  const queue = [...entries];
  while (queue.length > 0 && seen.size < MAX_CODE_FILES) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    stems.add(codeStem(file));
    let text: string;
    try {
      text = readFileSync(join(dir, file), 'utf8');
    } catch {
      continue;
    }
    for (const found of unescaped(text).replace(TYPE_ONLY, '').matchAll(IMPORT_SPEC)) {
      const spec = (found[2] as string).split(/[?#]/)[0] as string;
      const joined = posix.normalize(posix.join(posix.dirname(file), spec)).replace(/\/$/, '');
      // `from '.'` is the folder's own index.
      const target = joined === '.' || joined === '' ? 'index' : joined;
      if (target.startsWith('..') || target.split('/').includes('node_modules')) continue;
      const bare = CODE_EXTENSIONS.some((extension) => target.toLowerCase().endsWith(extension)) ? target.slice(0, target.lastIndexOf('.')) : target;
      stems.add(codeStem(target));
      stems.add(bare.normalize('NFC').toLowerCase());
      stems.add(`${bare.normalize('NFC').toLowerCase()}/index`);
      for (const candidate of [target, ...CODE_EXTENSIONS.flatMap((extension) => [`${bare}${extension}`, `${bare}/index${extension}`, `${target}${extension}`])]) {
        if (!seen.has(candidate) && isFile(candidate)) queue.push(candidate);
      }
    }
  }
  return stems;
}

/** The environment a build gets: where programs are, and nothing of this server's. */
function buildEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'SystemRoot', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'ComSpec', 'PATHEXT']) {
    const value = env[name];
    if (value !== undefined) out[name] = value;
  }
  out['CI'] = '1';
  return out;
}

export type StepRunner = (line: string, cwd: string, signal?: AbortSignal, env?: Readonly<Record<string, string>>) => Promise<{ ok: boolean; output: string }>;

/**
 * Loaded into every Node process of a build before anything else (`NODE_OPTIONS=--require`): reading a file's
 * content outside the app's own folder answers "no such file". A bundler puts whatever a source file imports into
 * the screens it builds, wherever that file is (`../../../.env?raw`, by thirty spellings); with this, there is
 * nothing outside for it to read. Listing and asking whether something exists are left alone, so a tool that
 * looks upward for a config still looks. It is not a sandbox against code the build runs (a person's yes covers
 * that): it is what keeps a file that is only IMPORTED from carrying the machine's files into a public page.
 */
export const BUILD_GUARD_FILE = join('.adminium', 'build-guard.cjs');
const BUILD_GUARD_SOURCE = String.raw`'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { syncBuiltinESMExports } = require('node:module');
const root = process.env.ADMINIUM_BUILD_ROOT;
if (root) {
  const real = fs.realpathSync.native;
  let base;
  try { base = real(root); } catch { base = path.resolve(root); }
  // esbuild hands a large result back through a file of its own in the machine's temporary folder.
  let temp = null;
  try { temp = real(require('node:os').tmpdir()); } catch {}
  const fold = process.platform === 'win32' || process.platform === 'darwin' ? (text) => text.toLowerCase() : (text) => text;
  const inside = (target) => {
    if (typeof target === 'number') return true;
    if (target && typeof target === 'object' && !(target instanceof URL) && !Buffer.isBuffer(target)) return true;
    let file;
    try { file = target instanceof URL ? require('node:url').fileURLToPath(target) : String(target); } catch { return false; }
    file = path.resolve(file);
    // What is not there says so itself; what is there is judged by where it really is, whatever links lead to it.
    try { file = real(file); } catch { return true; }
    if (file.startsWith('/dev/')) return true;
    if (temp !== null && path.dirname(file) === temp && path.basename(file).startsWith('esbuild-')) return true;
    return fold(file) === fold(base) || fold(file).startsWith(fold(base) + path.sep);
  };
  // Whether an open reads: every flag but plain "w" and "a" (and their "x").
  const reads = (flags) => {
    if (flags === undefined || flags === null) return true;
    if (typeof flags === 'number') return (flags & 3) !== 1;
    return !/^[wa]x?$/.test(String(flags).replace(/[bs]/g, ''));
  };
  const gone = (target, call) => Object.assign(new Error("ENOENT: no such file or directory, " + call + " '" + String(target) + "' (it is outside the app, and a copied app's build reads its own folder only)"), { code: 'ENOENT', errno: -2, syscall: call, path: String(target) });
  const refused = (name, target, rest) => !inside(target) && (name.startsWith('open') ? reads(typeof rest[0] === 'function' ? undefined : rest[0]) : true);
  for (const name of ['readFileSync', 'openSync', 'copyFileSync', 'cpSync', 'createReadStream']) {
    const original = fs[name];
    if (typeof original !== 'function') continue;
    fs[name] = function (target, ...rest) {
      if (refused(name, target, rest)) throw gone(target, name);
      return original.call(this, target, ...rest);
    };
  }
  for (const name of ['readFile', 'open', 'copyFile', 'cp']) {
    const original = fs[name];
    if (typeof original === 'function') {
      fs[name] = function (target, ...rest) {
        if (refused(name, target, rest)) {
          const done = rest[rest.length - 1];
          if (typeof done === 'function') process.nextTick(done, gone(target, name));
          return undefined;
        }
        return original.call(this, target, ...rest);
      };
    }
    const promised = fs.promises[name];
    if (typeof promised === 'function') {
      fs.promises[name] = function (target, ...rest) {
        if (refused(name, target, rest)) return Promise.reject(gone(target, name));
        return promised.call(this, target, ...rest);
      };
    }
  }
  syncBuiltinESMExports();
}
`;

/** The environment that puts the guard in front of a build's Node processes, for the app in `dir`. */
export function guardEnvironment(root: string, dir: string): Record<string, string> {
  const file = join(root, BUILD_GUARD_FILE);
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file) || readFileSync(file, 'utf8') !== BUILD_GUARD_SOURCE) writeFileSync(file, BUILD_GUARD_SOURCE);
  // NODE_OPTIONS reads a quoted value, with a backslash before a quote or a backslash.
  return { NODE_OPTIONS: `--require "${file.replace(/[\\"]/g, '\\$&')}"`, ADMINIUM_BUILD_ROOT: dir };
}

/** One line, run by the machine's shell in `cwd`. Killed after ten minutes, or when the signal says stop. */
/** The builds running now, by the way to end each: a server that stops takes them with it. */
const liveBuilds = new Set<() => void>();

/** End every build command that is running (the server is stopping, or the Designer was switched off). */
export function stopOwnBuilds(): void {
  for (const end of [...liveBuilds]) end();
}

export const runLine: StepRunner = (line, cwd, signal, env) =>
  new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve({ ok: false, output: 'Stopped.' });
      return;
    }
    let output = '';
    // Its own process group where there are groups: the shell's children (npm, Vite) end with it.
    const grouped = process.platform !== 'win32';
    const base = buildEnvironment(process.env);
    // In the desktop app `node`, `npm` and `npx` on a build line are the app's own: their folder comes first.
    const path = buildLinePath(base['PATH']);
    const child = spawn(line, { cwd, env: { ...base, ...(path === undefined ? {} : { PATH: path }), ...env }, shell: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: grouped });
    const keep = (chunk: Buffer): void => {
      output = `${output}${chunk.toString('utf8')}`.slice(-MAX_OUTPUT);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    let killed = false;
    const kill = (): void => {
      killed = true;
      try {
        if (grouped && child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
        // Windows has no groups: the shell's whole tree is ended by its own tool.
        else if (child.pid !== undefined) spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true }).on('error', () => child.kill('SIGKILL'));
        else child.kill('SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(kill, STEP_TIMEOUT_MS);
    signal?.addEventListener('abort', kill, { once: true });
    liveBuilds.add(kill);
    let grace: NodeJS.Timeout | undefined;
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      signal?.removeEventListener('abort', kill);
      liveBuilds.delete(kill);
      resolve({ ok: ok && !killed, output });
    };
    // `close` waits for the pipes, which a child of the shell can hold open after it: the exit is enough, a moment later.
    child.on('exit', (code) => {
      grace = setTimeout(() => done(code === 0), 2000);
    });
    child.on('error', (error) => {
      output += `\n${error.message}`;
      done(false);
    });
    child.on('close', (code) => done(code === 0));
  });

/** The end of what a failed step printed, as a few lines. */
const tail = (output: string): string =>
  output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
    .slice(-12)
    .join('\n');

/**
 * Run an approved build and put its sides where the engine's builds go.
 * Returns the sides built, or the problems. The install runs when the app has
 * no `node_modules` yet, or its lock file changed since the last install.
 */
export async function runOwnBuild(
  root: string,
  key: string,
  build: AppBuildFile,
  opts: { run?: StepRunner; signal?: AbortSignal; sides: readonly AppSide[] },
): Promise<{ sides: AppSide[] } | { problems: string[] }> {
  // One build of an app at a time: two would install into, and copy out of, the same folders.
  const dir = appDir(root, key);
  const before = building.get(dir) ?? Promise.resolve();
  const mine = before.then(() => buildNow(root, key, build, opts)).catch((error: unknown) => ({ problems: [`${APPS_DIR}/${key} — its build stopped: ${error instanceof Error ? error.message : String(error)}`] }));
  const settled = mine.then(() => undefined);
  building.set(dir, settled);
  try {
    return await mine;
  } finally {
    if (building.get(dir) === settled) building.delete(dir);
  }
}

const building = new Map<string, Promise<void>>();

/** Everything of an app its build reads: its files, by path and content, without what is installed or built. */
function ownSourcesHash(dir: string, build: AppBuildFile): string {
  const hash = createHash('sha256').update(buildFingerprint(build));
  const outputTop = build.output.split('/')[0] as string;
  const walk = (folder: string, relative: string): void => {
    let entries;
    try {
      entries = readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || (relative === '' && entry.name === outputTop)) continue;
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(join(folder, entry.name), path);
      else if (entry.isFile()) hash.update(`\0${path}\0`).update(readFileSync(join(folder, entry.name)));
    }
  };
  walk(dir, '');
  return hash.digest('hex');
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss', '.sass', '.less', '.styl', '.html', '.vue', '.svelte', '.astro', '.mdx'];
/** Where a bundler reads a path from: an import, a `new URL(…, import.meta.url)`, a stylesheet's `url()` and `@import`. */
const NAMED = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\burl\(\s*|@import\s+(?:url\(\s*)?|\bURL\(\s*)(['"`]?)([./][^'"`)\s]*)\1/g;
/** `import.meta.glob(…)`: every pattern it is given. */
const GLOBBED = /\bglob\(([^)]*)\)/g;
const QUOTED = /(['"`])([^'"`\n]*)\1/g;
const ANYWHERE = /['"`(\s](\/@fs\/[^'"`)\s]*|file:\/[^'"`)\s]*)/;

/**
 * The source files of an app that name a path outside its folder, as problems. A bundler puts what a source file
 * imports into the screens it builds, whatever it is and wherever it is (`../../../.env?raw`): a copied app's
 * build reads its own folder and nothing else.
 */
export function outsideReaches(root: string, key: string, build: AppBuildFile): string[] {
  const dir = appDir(root, key);
  const outputTop = build.output.split('/')[0] as string;
  const problems: string[] = [];
  const walk = (folder: string, relative: string): void => {
    let entries;
    try {
      entries = readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (problems.length >= 5) return;
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || (relative === '' && entry.name === outputTop)) continue;
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(folder, entry.name), path);
        continue;
      }
      const dot = entry.name.lastIndexOf('.');
      if (!entry.isFile() || dot === -1 || !SOURCE_EXTENSIONS.includes(entry.name.slice(dot).toLowerCase())) continue;
      let text: string;
      try {
        text = unescaped(readFileSync(join(folder, entry.name), 'utf8'));
      } catch {
        continue;
      }
      const say = (named: string): void => {
        problems.push(`${APPS_DIR}/${key}/${path} names a path outside the app ("${named.slice(0, 120)}"), so the app was not built. A copied app's build reads its own folder and nothing else.`);
      };
      const at = posix.dirname(path);
      const named = [...text.matchAll(NAMED)].map((match) => match[2] as string);
      for (const call of text.matchAll(GLOBBED)) for (const quoted of (call[1] as string).matchAll(QUOTED)) named.push((quoted[2] as string).replace(/^!/, ''));
      const outside = named.find((spec) => {
        const plain = spec.split(/[?#*{$]/)[0] as string;
        // A leading "/" is the app's own folder to the bundler, and the machine's when nothing is there.
        if (plain.startsWith('/')) return plain.startsWith('/@fs/') || (!existsSync(join(dir, plain)) && existsSync(plain));
        return posix.normalize(posix.join(at, plain)).startsWith('..');
      });
      if (outside !== undefined) {
        say(outside);
        continue;
      }
      const anywhere = ANYWHERE.exec(text);
      if (anywhere !== null) say(anywhere[1] as string);
    }
  };
  walk(dir, '');
  return problems;
}

async function buildNow(
  root: string,
  key: string,
  build: AppBuildFile,
  opts: { run?: StepRunner; signal?: AbortSignal; sides: readonly AppSide[] },
): Promise<{ sides: AppSide[] } | { problems: string[] }> {
  const run = opts.run ?? runLine;
  const dir = appDir(root, key);
  // Nothing of the app changed since its last whole build, and what that left is still there: it is not run again.
  const sources = ownSourcesHash(dir, build);
  const builtStamp = join(dir, 'node_modules', '.adminium-built');
  const wanted = SIDES.filter((side) => opts.sides.includes(side));
  if (
    existsSync(builtStamp) &&
    readFileSync(builtStamp, 'utf8') === `${sources}\n${wanted.join(',')}` &&
    wanted.every((side) => existsSync(join(root, BUILD_DIR, APPS_DIR, key, side, 'index.html')))
  ) {
    return { sides: wanted };
  }
  const reaches = outsideReaches(root, key, build);
  if (reaches.length > 0) return { problems: reaches };
  const lock = ['npm-shrinkwrap.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].map((name) => join(dir, name)).find((file) => existsSync(file));
  const lockHash = lock === undefined ? '' : sha256(readFileSync(lock));
  const stamp = join(dir, 'node_modules', '.adminium-installed');
  const installed = existsSync(stamp) ? readFileSync(stamp, 'utf8') : null;
  if (installed !== lockHash) {
    const done = await run(build.install, dir, opts.signal);
    if (!done.ok) return { problems: [`${APPS_DIR}/${key} — its packages could not be installed (${build.install}):\n${tail(done.output)}`] };
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    writeFileSync(stamp, lockHash);
  }
  // The install reads the machine's own package settings and cache; the build reads the app's folder and nothing else.
  const built = await run(build.command, dir, opts.signal, guardEnvironment(root, dir));
  if (!built.ok) return { problems: [`${APPS_DIR}/${key} — its screens did not build:\n${tail(built.output)}`] };

  const sides: AppSide[] = [];
  const problems: string[] = [];
  for (const side of SIDES) {
    if (!opts.sides.includes(side)) continue;
    const from = join(dir, build.output, side);
    if (!existsSync(join(from, 'index.html'))) {
      problems.push(`${APPS_DIR}/${key} — its build left no ${build.output}/${side}/index.html.`);
      continue;
    }
    // Swapped in whole: a half-copied side is never served.
    const to = join(root, BUILD_DIR, APPS_DIR, key, side);
    const staging = `${to}.staging`;
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(dirname(staging), { recursive: true });
    cpSync(from, staging, { recursive: true, dereference: false, filter: (source) => !source.split(/[\\/]/).pop()?.startsWith('.') });
    rmSync(to, { recursive: true, force: true });
    renameSync(staging, to);
    sides.push(side);
  }
  if (problems.length > 0) return { problems };
  writeFileSync(builtStamp, `${sources}\n${wanted.join(',')}`);
  return { sides };
}
