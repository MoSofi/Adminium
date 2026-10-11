// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's phone side: `apps/<key>/mobile/`, an Expo project.
 *
 * It is a side of the app and not a web side. The server's bundler never
 * reads it; Expo builds it, and Expo's build runs code where the bundler only
 * reads it. So this file holds the three things that keep that safe:
 *
 *  - the SHAPE the folder must have ({@link phoneShapeProblems}): no file
 *    Expo, Metro or Babel would run as configuration, none of the fields that
 *    name one, nothing that leaves the folder;
 *  - the APPROVAL ({@link isPhoneApproved}): a person's yes, kept where an own
 *    build's is kept, of the exact files that decide what is installed and
 *    run. A change to any of them asks again;
 *  - where things are ({@link phoneDir}, {@link phoneBuildDir}): the preview's
 *    build has a folder of its own, which `start`, `build` and `pack` never
 *    read, so a phone preview is never served as a website.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { PHONE_SIDE } from '@adminium/manifest';

import { BUILD_DIR } from '../build-shared.js';
import { NPM_REGISTRY } from '../programs.js';
import { approvalsFile } from './own-build.js';
import { APPS_DIR, appDir } from './read-app.js';

export { PHONE_SIDE };

/** The phone side's folder, under the app's. */
export const phoneDir = (root: string, key: string): string => join(appDir(root, key), PHONE_SIDE);

/** Where the phone preview's build is kept: beside the apps' builds, never inside them. */
export const PHONE_BUILD_DIR = 'phone';
export const phoneBuildDir = (root: string, key: string): string => join(root, BUILD_DIR, PHONE_BUILD_DIR, key);

/** The screen a phone side starts from. */
const PHONE_ENTRY = 'App.tsx';
/** The lock a phone side's install writes. */
export const PHONE_LOCK = 'package-lock.json';

/** Whether the app has a phone side's code. */
export const hasPhoneCode = (root: string, key: string): boolean => existsSync(join(phoneDir(root, key), PHONE_ENTRY));

/**
 * A file Expo, Metro, Babel or PostCSS runs or reads as configuration, by its
 * name. Refused in the phone side's folder and in the app's (Metro looks for
 * its own upward from the project it bundles).
 */
const CONFIG_NAME = /^(metro\.config|babel\.config|app\.config|react-native\.config|postcss\.config)\.[a-z]+$|^\.babelrc(\.[a-z]+)?$/i;

/** A version or a range of versions, as the registry reads one: `57.0.27`, `~57.0.3`, `^0.3.25`, `0.3.26-rc.0`. */
const PLAIN_VERSION = /^[~^]?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** The fields of `package.json` that name code to run, or a configuration. */
const PACKAGE_FIELDS = ['scripts', 'babel', 'metro', 'expo', 'workspaces', 'overrides', 'resolutions'] as const;

/** A problem with a phone side's folder, said against a file. */
export interface PhoneProblem {
  file: string;
  message: string;
}

const where = (key: string, ...parts: string[]): string => [APPS_DIR, key, PHONE_SIDE, ...parts].join('/');

function json(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Every file and folder under `dir`, as paths from it, leaving `node_modules` and Expo's own `.expo` out. */
function walk(dir: string, prefix = '', out: { path: string; link: boolean; folder: boolean }[] = []): { path: string; link: boolean; folder: boolean }[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names.sort()) {
    if (name === 'node_modules' || name === '.expo') continue;
    const path = prefix === '' ? name : `${prefix}/${name}`;
    const stat = lstatSync(join(dir, name));
    out.push({ path, link: stat.isSymbolicLink(), folder: stat.isDirectory() });
    // A link is never followed: where it leads is not the app's.
    if (stat.isDirectory() && !stat.isSymbolicLink()) walk(join(dir, name), path, out);
  }
  return out;
}

/**
 * What is wrong with the phone side's folder, or nothing. Every entry is a
 * way for a file to be run by Expo's build without a person having said yes
 * to it, or to reach outside the folder.
 */
export function phoneShapeProblems(root: string, key: string): PhoneProblem[] {
  const dir = phoneDir(root, key);
  const problems: PhoneProblem[] = [];
  if (!existsSync(dir)) return problems;

  // Metro looks for its configuration upward: the app's own folder counts.
  for (const name of readdirSync(appDir(root, key))) {
    if (CONFIG_NAME.test(name)) problems.push({ file: `${APPS_DIR}/${key}/${name}`, message: 'is a file Expo would run as configuration. An app with a phone side has none: take it out.' });
  }
  const above = json(join(appDir(root, key), 'package.json'));
  for (const field of ['metro', 'babel'] as const) {
    if (above !== null && above[field] !== undefined) problems.push({ file: `${APPS_DIR}/${key}/package.json`, message: `has "${field}", which Expo would read as configuration. Take it out.` });
  }

  for (const entry of walk(dir)) {
    const name = entry.path.split('/').pop() as string;
    if (entry.link) {
      problems.push({ file: where(key, entry.path), message: 'is a link. A phone side holds its own files only.' });
      continue;
    }
    if (CONFIG_NAME.test(name)) {
      problems.push({ file: where(key, entry.path), message: 'is a file Expo would run as configuration. A phone side has none: take it out.' });
    } else if (name.startsWith('.') && name !== '.gitignore') {
      // `.env*` is loaded into the build's own environment; any other dot file is somebody's configuration.
      problems.push({ file: where(key, entry.path), message: 'is a dot file. A phone side has none but .gitignore: Expo loads .env files into its build.' });
    } else if (name === 'package.json' && entry.path !== 'package.json') {
      problems.push({ file: where(key, entry.path), message: 'is a second package.json. A phone side has one, at its top.' });
    }
  }

  const pkg = json(join(dir, 'package.json'));
  if (pkg === null) {
    problems.push({ file: where(key, 'package.json'), message: 'is missing or does not read. A phone side is an Expo project: add it with  adminium app new <key> --mobile  or the Designer.' });
  } else {
    for (const field of PACKAGE_FIELDS) {
      if (pkg[field] !== undefined) problems.push({ file: where(key, 'package.json'), message: `has "${field}", which names code to run or a configuration. Take it out.` });
    }
    if (pkg['main'] !== 'index.ts') problems.push({ file: where(key, 'package.json'), message: 'its "main" is "index.ts", the file the phone side starts from.' });
    const deps = pkg['dependencies'];
    if (deps === null || typeof deps !== 'object' || (deps as Record<string, unknown>)['expo'] === undefined) {
      problems.push({ file: where(key, 'package.json'), message: 'does not list "expo". A phone side is an Expo project.' });
    }
    // A package is named by a version of the registry's: an address, a git or a file is code from somewhere nobody was shown.
    for (const [name, spec] of Object.entries({ ...(pkg['dependencies'] as Record<string, unknown> | undefined), ...(pkg['devDependencies'] as Record<string, unknown> | undefined) })) {
      if (typeof spec !== 'string' || !PLAIN_VERSION.test(spec)) {
        problems.push({ file: where(key, 'package.json'), message: `lists "${name.slice(0, 60)}" by something other than a version (${typeof spec === 'string' ? spec.slice(0, 60) : 'not text'}). A phone side's packages come from the registry, by version.` });
      }
    }
    for (const field of ['optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies'] as const) {
      if (pkg[field] !== undefined) problems.push({ file: where(key, 'package.json'), message: `has "${field}". A phone side lists its packages under "dependencies" and "devDependencies".` });
    }
    // The lock says where each package is fetched from: the registry, and nowhere else.
    const lock = json(join(dir, PHONE_LOCK));
    const elsewhere = lock === null ? [] : Object.entries((lock['packages'] ?? {}) as Record<string, { resolved?: unknown } | null>).filter(([, entry]) => typeof entry?.resolved === 'string' && !entry.resolved.startsWith(NPM_REGISTRY)).map(([name]) => name);
    if (elsewhere.length > 0) {
      problems.push({ file: where(key, PHONE_LOCK), message: `fetches ${String(elsewhere.length)} package(s) from somewhere other than the npm registry (${elsewhere.slice(0, 3).map((name) => name.replace(/^node_modules\//, '').slice(0, 40)).join(', ')}). Remove the lock file, or the packages.` });
    }
  }

  const app = json(join(dir, 'app.json'));
  const expo = app === null ? null : app['expo'];
  if (expo === null || typeof expo !== 'object' || Array.isArray(expo)) {
    problems.push({ file: where(key, 'app.json'), message: 'is missing or has no "expo" block.' });
  } else {
    for (const field of ['hooks', 'updates'] as const) {
      if ((expo as Record<string, unknown>)[field] !== undefined) problems.push({ file: where(key, 'app.json'), message: `has "${field}", which runs code in Expo's build or sends the app elsewhere. Take it out.` });
    }
    // A plugin is code Expo runs. One that is a package the phone side lists is part of what a person approved; a file is not.
    const listed = pkg === null ? {} : { ...(pkg['dependencies'] as Record<string, unknown> | undefined), ...(pkg['devDependencies'] as Record<string, unknown> | undefined) };
    const plugins = (expo as Record<string, unknown>)['plugins'];
    for (const plugin of Array.isArray(plugins) ? (plugins as unknown[]) : plugins === undefined ? [] : [plugins]) {
      const name = Array.isArray(plugin) ? plugin[0] : plugin;
      if (typeof name !== 'string' || !/^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) || listed[name] === undefined) {
        problems.push({ file: where(key, 'app.json'), message: `has a plugin (${typeof name === 'string' ? name.slice(0, 60) : 'not a name'}) that is not a package the phone side lists. A plugin is a package by its name, never a file.` });
      }
    }
  }

  const ts = json(join(dir, 'tsconfig.json'));
  if (ts !== null) {
    const options = ts['compilerOptions'];
    if (options !== null && typeof options === 'object' && ((options as Record<string, unknown>)['paths'] !== undefined || (options as Record<string, unknown>)['baseUrl'] !== undefined)) {
      problems.push({ file: where(key, 'tsconfig.json'), message: 'has "paths" or "baseUrl": a phone side imports its own files by their place, and packages by name.' });
    }
    if (ts['extends'] !== undefined && ts['extends'] !== 'expo/tsconfig.base') problems.push({ file: where(key, 'tsconfig.json'), message: 'may extend "expo/tsconfig.base" only.' });
  }

  if (!existsSync(join(dir, PHONE_ENTRY))) problems.push({ file: where(key, PHONE_ENTRY), message: 'does not exist. It is the phone side’s first screen.' });
  if (!existsSync(join(dir, 'index.ts'))) problems.push({ file: where(key, 'index.ts'), message: 'does not exist. It starts the phone side.' });
  return problems;
}

// ── the approval ─────────────────────────────────────────────────────────────

/** The name a phone side's approval is kept under, beside the app's own build's. */
const approvalName = (key: string): string => `${key}#${PHONE_SIDE}`;

/** What Expo's install and build are run as: said to the person who approves, and part of what is approved. */
export const PHONE_INSTALL_WORDS = 'npm install (no install scripts)';
export const PHONE_BUILD_WORDS = 'expo export --platform web';

const sha256 = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');

/**
 * What an approval is of: the two lines, and the bytes of the files that
 * decide what is installed and run. A change to any of them, by a person, a
 * model or whoever sent the folder, asks again.
 */
export function phoneFingerprint(root: string, key: string): string {
  const dir = phoneDir(root, key);
  const parts = [PHONE_INSTALL_WORDS, PHONE_BUILD_WORDS];
  for (const file of ['package.json', PHONE_LOCK, 'app.json', 'index.ts', 'tsconfig.json']) {
    let bytes: Buffer | null = null;
    try {
      bytes = readFileSync(join(dir, file));
    } catch {
      bytes = null;
    }
    parts.push(`${file}:${bytes === null ? '-' : sha256(bytes)}`);
  }
  return sha256(parts.join('\n'));
}

function approvals(root: string): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(approvalsFile(root), 'utf8')) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Whether a person approved this phone side as it reads now. */
export const isPhoneApproved = (root: string, key: string): boolean => approvals(root)[approvalName(key)] === phoneFingerprint(root, key);

/** Record that a person approved this app's phone side as it reads now. */
export function approvePhone(root: string, key: string): void {
  const file = approvalsFile(root);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ ...approvals(root), [approvalName(key)]: phoneFingerprint(root, key) }, null, 2)}\n`, { mode: 0o600 });
}

/** The packages a phone side lists, by name: what its install brings, said to the person who is asked. */
export function phonePackages(root: string, key: string): string[] {
  const pkg = json(join(phoneDir(root, key), 'package.json'));
  if (pkg === null) return [];
  return Object.keys({ ...(pkg['dependencies'] as Record<string, unknown> | undefined), ...(pkg['devDependencies'] as Record<string, unknown> | undefined) })
    .filter((name) => /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name))
    .sort()
    .slice(0, 60);
}

/** The files an approval covers but an install does not write, each as its hash: the same before and after an install means nothing of them changed meanwhile. */
export function phoneSettingsHash(root: string, key: string): string {
  const dir = phoneDir(root, key);
  return ['package.json', 'app.json', 'index.ts', 'tsconfig.json']
    .map((file) => {
      try {
        return `${file}:${sha256(readFileSync(join(dir, file)))}`;
      } catch {
        return `${file}:-`;
      }
    })
    .join('\n');
}

/** The sentence an unapproved phone side is noted with: what a person is asked to approve. */
export const phoneUnapprovedWords = (key: string): string =>
  `${APPS_DIR}/${key}/${PHONE_SIDE} is not approved, so its phone preview was not built. It would install Expo's packages (about 350 MB) and build with Expo on this computer. Approve it with:  adminium app approve-build ${key}`;
