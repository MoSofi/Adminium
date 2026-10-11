// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Installing and building an app's phone side with Expo.
 *
 * Two programs are started here, and never through a shell: the package
 * manager (always npm, in the phone side's own folder) and Expo's own
 * command line, as a file given to Node. Both are found by the one resolver
 * (`project/programs.ts`), so the desktop app runs them with the Node and npm
 * it carries.
 *
 * What is built is the PREVIEW: Expo's export for the web, kept in a folder of
 * its own (`.adminium/build/phone/<key>/`) that only a project being designed
 * serves. Nothing here runs without a person's yes ({@link isPhoneApproved}),
 * and what is wrong with a phone side is a NOTICE: the app's tables, pages and
 * web sides build and apply as before.
 *
 * Expo's build runs code where the server's bundler only reads it. So it is
 * given a Metro configuration of the engine's own by path (nothing it finds by
 * looking upward is used), an environment built here, the read guard an own
 * build has, and caches inside the phone side's folder.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { runChild, type ChildResult } from '../../designer/child.js';
import { DESKTOP_PROGRAMS_ENV, nodeProgram, packageManagerProgram, type Launch } from '../programs.js';
import { guardEnvironment } from './own-build.js';
import { PHONE_LOCK, PHONE_SIDE, approvePhone, hasPhoneCode, isPhoneApproved, phoneBuildDir, phoneDir, phonePackages, phoneSettingsHash, phoneShapeProblems, phoneUnapprovedWords } from './phone.js';
import { APPS_DIR } from './read-app.js';

/** How long an install may take: Expo's packages are about 350 MB. */
export const PHONE_INSTALL_TIMEOUT_MS = 10 * 60_000;
/** How long a build may take. A first one is about five seconds, a later one under one. */
export const PHONE_BUILD_TIMEOUT_MS = 5 * 60_000;

/** The engine's own Metro configuration, written into the phone side's `node_modules` (never the app's to write). */
export const PHONE_METRO_CONFIG = join('node_modules', '.adminium', 'metro.config.cjs');
const INSTALL_STAMP = join('node_modules', '.adminium', 'installed');
/** What the last build was of, kept beside what it built. */
const BUILD_STAMP = 'adminium-phone.json';

const METRO_CONFIG_SOURCE = `// Written by Adminium at every build of the phone side. Not the app's: a change here is written over.
const path = require('node:path');
const dir = path.resolve(__dirname, '..', '..');
const { getDefaultConfig } = require(path.join(dir, 'node_modules', 'expo', 'metro-config'));
const config = getDefaultConfig(dir);
// The phone side's own folder, and nothing above it.
config.watchFolders = [dir];
// Metro's caches, kept in the phone side's own folder: the build reads nothing outside it.
const cache = path.join(dir, 'node_modules', '.cache', 'adminium-metro');
try {
  const { FileStore } = require(path.join(dir, 'node_modules', 'metro-cache'));
  config.cacheStores = [new FileStore({ root: path.join(cache, 'transform') })];
} catch {
  // Metro's own place then: a slower build, the same result.
}
config.fileMapCacheDirectory = path.join(cache, 'file-map');
module.exports = config;
`;

/** What a phone side is, to whoever shows it. */
export type PhoneBuild =
  /** The app has no phone side. */
  | { state: 'none' }
  /** Its folder holds something Expo would run unasked, or lacks what a phone side has. */
  | { state: 'shape'; words: string }
  /** Nobody said yes to installing and building it on this computer. `packages` is what its install would bring, by name. */
  | { state: 'unapproved'; words: string; packages: string[] }
  /** Approved; its packages are not installed (or its package list changed since). */
  | { state: 'no-packages'; words: string }
  /** Expo's build stopped. */
  | { state: 'failed'; words: string }
  /** Built: the preview is in {@link phoneBuildDir}. `build` moves when it was built again. */
  | { state: 'built'; build: string };

/** One program run: the engine's default is {@link runChild}; a test gives its own. */
export type PhoneRunner = (launch: Launch, opts: { cwd: string; timeoutMs: number; signal?: AbortSignal | undefined; env: Record<string, string> }) => Promise<ChildResult>;

const run: PhoneRunner = (launch, opts) =>
  runChild(launch.command, launch.args, { cwd: opts.cwd, timeoutMs: opts.timeoutMs, ...(opts.signal === undefined ? {} : { signal: opts.signal }), env: { ...opts.env, ...launch.env } });

const sha256 = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');

const tail = (output: string, lines = 14): string =>
  output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
    .slice(-lines)
    .join('\n');

/** The environment Expo and npm get: where programs are, and nothing of this server's. */
export function phoneEnvironment(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'SystemRoot', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'ComSpec', 'PATHEXT', DESKTOP_PROGRAMS_ENV]) {
    const value = env[name];
    if (value !== undefined) out[name] = value;
  }
  // Expo asks nobody anything and tells nobody anything; it changes no file of the app's; it bundles this folder alone.
  out['EXPO_OFFLINE'] = '1';
  out['EXPO_NO_TELEMETRY'] = '1';
  out['EXPO_NO_TYPESCRIPT_SETUP'] = '1';
  out['EXPO_NO_METRO_WORKSPACE_ROOT'] = '1';
  out['EXPO_NO_DOTENV'] = '1';
  return out;
}

/** What the phone side's install is of: its package list and its lock. */
function installHash(dir: string): string {
  const read = (file: string): string => {
    try {
      return sha256(readFileSync(join(dir, file)));
    } catch {
      return '-';
    }
  };
  return `${read('package.json')}\n${read(PHONE_LOCK)}`;
}

/** Whether the phone side's packages are the ones its package list asks for. */
export function phoneInstalled(root: string, key: string): boolean {
  const dir = phoneDir(root, key);
  try {
    return existsSync(join(dir, 'node_modules', 'expo', 'bin', 'cli')) && readFileSync(join(dir, INSTALL_STAMP), 'utf8') === installHash(dir);
  } catch {
    return false;
  }
}

/** Every source file of the phone side, hashed: what a build is of. */
function sourcesHash(dir: string): string {
  const hash = createHash('sha256');
  const walk = (folder: string, prefix: string): void => {
    let names: string[];
    try {
      names = readdirSync(folder).sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (name === 'node_modules' || name === '.expo' || name === 'dist') continue;
      const path = join(folder, name);
      const stat = statSync(path, { throwIfNoEntry: false });
      if (stat === undefined) continue;
      if (stat.isDirectory()) walk(path, `${prefix}${name}/`);
      else hash.update(`${prefix}${name}\0${String(stat.size)}\0`).update(readFileSync(path));
    }
  };
  walk(dir, '');
  return hash.digest('hex');
}

function readStamp(root: string, key: string): { sources: string; build: string } | null {
  try {
    const parsed = JSON.parse(readFileSync(join(phoneBuildDir(root, key), BUILD_STAMP), 'utf8')) as { sources?: unknown; build?: unknown };
    return typeof parsed.sources === 'string' && typeof parsed.build === 'string' ? { sources: parsed.sources, build: parsed.build } : null;
  } catch {
    return null;
  }
}

/** Where the last failed build of a phone side is remembered: beside its preview, never inside it. */
const failedFile = (root: string, key: string): string => `${phoneBuildDir(root, key)}.failed.json`;

/** The build of the phone side that is on disk now, or null. Starts nothing. */
export function builtPhone(root: string, key: string): { build: string } | null {
  const stamp = readStamp(root, key);
  return stamp !== null && existsSync(join(phoneBuildDir(root, key), 'index.html')) ? { build: stamp.build } : null;
}

/** One at a time for an app: a second build waits for the first, an install for a build. */
const queue = new Map<string, Promise<unknown>>();
function inTurn<T>(root: string, key: string, work: () => Promise<T>): Promise<T> {
  const name = `${root}\0${key}`;
  const next = (queue.get(name) ?? Promise.resolve()).then(work, work);
  const settled = next.catch(() => undefined);
  queue.set(name, settled);
  void settled.then(() => {
    if (queue.get(name) === settled) queue.delete(name);
  });
  return next;
}

export interface PhoneOptions {
  signal?: AbortSignal | undefined;
  /** A test's stand-in for starting a program. */
  run?: PhoneRunner | undefined;
}

/**
 * Install the phone side's packages: npm, in its own folder, with no install
 * scripts. Only for a phone side a person approved. The approval is of the
 * package list and its lock, and an install writes the lock: so a yes given
 * before the install holds after it.
 */
export function installPhone(root: string, key: string, opts: PhoneOptions = {}): Promise<{ ok: true } | { ok: false; words: string }> {
  return inTurn(root, key, async () => {
    const dir = phoneDir(root, key);
    if (!isPhoneApproved(root, key)) return { ok: false, words: phoneUnapprovedWords(key) };
    // What the person approved, apart from the lock an install writes: it must read the same when the install ends.
    const approved = phoneSettingsHash(root, key);
    const program = packageManagerProgram(dir, { [DESKTOP_PROGRAMS_ENV]: process.env[DESKTOP_PROGRAMS_ENV] }, 'npm');
    const args = [existsSync(join(dir, PHONE_LOCK)) ? 'ci' : 'install', '--ignore-scripts', '--no-audit', '--no-fund'];
    const result = await (opts.run ?? run)(program.launch(args), { cwd: dir, timeoutMs: PHONE_INSTALL_TIMEOUT_MS, signal: opts.signal, env: phoneEnvironment() });
    if (result.code !== 0) {
      const why = result.stopped ? 'It was stopped.' : result.timedOut ? 'It took more than ten minutes.' : tail(result.output);
      return { ok: false, words: `${APPS_DIR}/${key}/${PHONE_SIDE} — its packages could not be installed (npm ${args.join(' ')}). This needs the network.\n${why}` };
    }
    mkdirSync(dirname(join(dir, INSTALL_STAMP)), { recursive: true });
    writeFileSync(join(dir, INSTALL_STAMP), installHash(dir));
    // The lock is new or moved: the yes was to this package list, and stays. A package list or a setting that
    // changed while the install ran is not what was approved: the person is asked again.
    if (phoneSettingsHash(root, key) === approved) approvePhone(root, key);
    return { ok: true };
  });
}

/**
 * Build the phone side's preview, when it may be built. Never installs: a
 * phone side whose packages are missing is said as that, and a person (or the
 * command they ran) installs them.
 */
export function buildPhone(root: string, key: string, opts: PhoneOptions = {}): Promise<PhoneBuild> {
  if (!hasPhoneCode(root, key)) return Promise.resolve({ state: 'none' });
  return inTurn(root, key, async (): Promise<PhoneBuild> => {
    const dir = phoneDir(root, key);
    const shape = phoneShapeProblems(root, key);
    if (shape.length > 0) return { state: 'shape', words: shape.map((problem) => `${problem.file} ${problem.message}`).join('\n') };
    if (!isPhoneApproved(root, key)) return { state: 'unapproved', words: phoneUnapprovedWords(key), packages: phonePackages(root, key) };
    if (!phoneInstalled(root, key)) {
      return { state: 'no-packages', words: `${APPS_DIR}/${key}/${PHONE_SIDE} — its packages are not installed, so its phone preview was not built. Install them with:  adminium app approve-build ${key}` };
    }
    const to = phoneBuildDir(root, key);
    const sources = sourcesHash(dir);
    const last = readStamp(root, key);
    // Nothing of the phone side changed since its last build, and that build is still there.
    if (last !== null && last.sources === sources && existsSync(join(to, 'index.html'))) return { state: 'built', build: last.build };

    mkdirSync(dirname(join(dir, PHONE_METRO_CONFIG)), { recursive: true });
    writeFileSync(join(dir, PHONE_METRO_CONFIG), METRO_CONFIG_SOURCE);
    const staging = `${to}.staging`;
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(dirname(staging), { recursive: true });
    const guard = guardEnvironment(root, dir);
    // The guard as an argument: a child started here gets no NODE_OPTIONS, and a signed Mac app would drop one.
    const launch = nodeProgram(['--require', guard['ADMINIUM_BUILD_GUARD'] as string, join(dir, 'node_modules', 'expo', 'bin', 'cli'), 'export', '--platform', 'web', '--output-dir', staging, '--max-workers', '2']);
    const result = await (opts.run ?? run)(launch, {
      cwd: dir,
      timeoutMs: PHONE_BUILD_TIMEOUT_MS,
      signal: opts.signal,
      env: {
        ...phoneEnvironment(),
        CI: '1',
        ADMINIUM_BUILD_ROOT: guard['ADMINIUM_BUILD_ROOT'] as string,
        ADMINIUM_BUILD_GUARD: guard['ADMINIUM_BUILD_GUARD'] as string,
        EXPO_OVERRIDE_METRO_CONFIG: join(dir, PHONE_METRO_CONFIG),
      },
    });
    if (result.code !== 0 || !existsSync(join(staging, 'index.html'))) {
      rmSync(staging, { recursive: true, force: true });
      const why = result.stopped ? 'It was stopped.' : result.timedOut ? 'It took more than five minutes.' : tail(result.output);
      const words = `${APPS_DIR}/${key}/${PHONE_SIDE} — the phone app did not build:\n${why}`;
      // Kept, so whoever asks how the phone side stands is told it did not build, though an older preview is still there.
      if (!result.stopped) {
        mkdirSync(dirname(failedFile(root, key)), { recursive: true });
        writeFileSync(failedFile(root, key), `${JSON.stringify({ sources, words })}\n`);
      }
      return { state: 'failed', words };
    }
    // Swapped in whole: a half-written preview is never served.
    const build = sha256(`${sources}\n${String(Date.now())}`).slice(0, 16);
    writeFileSync(join(staging, BUILD_STAMP), `${JSON.stringify({ sources, build })}\n`);
    rmSync(to, { recursive: true, force: true });
    renameSync(staging, to);
    rmSync(failedFile(root, key), { force: true });
    return { state: 'built', build };
  });
}

/** Take the phone side's preview away (the app has none any more, or is going). */
export function removePhoneBuild(root: string, key: string): void {
  rmSync(failedFile(root, key), { force: true });
  rmSync(phoneBuildDir(root, key), { recursive: true, force: true });
  rmSync(`${phoneBuildDir(root, key)}.staging`, { recursive: true, force: true });
}

/** What the phone side is now, read from the disk: starts nothing. */
export function phoneNow(root: string, key: string): PhoneBuild {
  if (!hasPhoneCode(root, key)) return { state: 'none' };
  const shape = phoneShapeProblems(root, key);
  if (shape.length > 0) return { state: 'shape', words: shape.map((problem) => `${problem.file} ${problem.message}`).join('\n') };
  if (!isPhoneApproved(root, key)) return { state: 'unapproved', words: phoneUnapprovedWords(key), packages: phonePackages(root, key) };
  if (!phoneInstalled(root, key)) return { state: 'no-packages', words: `${APPS_DIR}/${key}/${PHONE_SIDE} — its packages are not installed.` };
  // The files as they are now did not build: said, though the preview of an earlier build is still served.
  try {
    const failed = JSON.parse(readFileSync(failedFile(root, key), 'utf8')) as { sources?: unknown; words?: unknown };
    if (typeof failed.words === 'string' && failed.sources === sourcesHash(phoneDir(root, key))) return { state: 'failed', words: failed.words };
  } catch {
    // No build of these files failed.
  }
  const built = builtPhone(root, key);
  return built === null ? { state: 'failed', words: `${APPS_DIR}/${key}/${PHONE_SIDE} — it is not built yet.` } : { state: 'built', build: built.build };
}
