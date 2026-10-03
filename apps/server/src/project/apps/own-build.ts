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
 * `ADMINIUM_*`, no keys) and a time limit. What it leaves in
 * `<output>/staff` and `<output>/customer` is copied to where the engine's
 * own builds go, so serving is the same for both kinds of app.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

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

const CODE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const IMPORT_SPEC = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])(\.{1,2}\/[^'"\n]*)\1/g;
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
    for (const found of text.matchAll(IMPORT_SPEC)) {
      const spec = (found[2] as string).split(/[?#]/)[0] as string;
      const target = posix.normalize(posix.join(posix.dirname(file), spec)).replace(/\/$/, '');
      if (target === '' || target === '.' || target.startsWith('..') || target.split('/').includes('node_modules')) continue;
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

export type StepRunner = (line: string, cwd: string, signal?: AbortSignal) => Promise<{ ok: boolean; output: string }>;

/** One line, run by the machine's shell in `cwd`. Killed after ten minutes, or when the signal says stop. */
export const runLine: StepRunner = (line, cwd, signal) =>
  new Promise((resolve) => {
    let output = '';
    // Its own process group where there are groups: the shell's children (npm, Vite) end with it.
    const grouped = process.platform !== 'win32';
    const child = spawn(line, { cwd, env: buildEnvironment(process.env), shell: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: grouped });
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
        else child.kill('SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(kill, STEP_TIMEOUT_MS);
    signal?.addEventListener('abort', kill, { once: true });
    const done = (ok: boolean): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', kill);
      resolve({ ok: ok && !killed, output });
    };
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
  const run = opts.run ?? runLine;
  const dir = appDir(root, key);
  const lock = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].map((name) => join(dir, name)).find((file) => existsSync(file));
  const lockHash = lock === undefined ? '' : sha256(readFileSync(lock));
  const stamp = join(dir, 'node_modules', '.adminium-installed');
  const installed = existsSync(stamp) ? readFileSync(stamp, 'utf8') : null;
  if (installed !== lockHash) {
    const done = await run(build.install, dir, opts.signal);
    if (!done.ok) return { problems: [`${APPS_DIR}/${key} — its packages could not be installed (${build.install}):\n${tail(done.output)}`] };
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    writeFileSync(stamp, lockHash);
  }
  const built = await run(build.command, dir, opts.signal);
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
  return problems.length > 0 ? { problems } : { sides };
}
