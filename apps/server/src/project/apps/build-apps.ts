// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Building the apps a project carries, so a server can run them from the folder.
 *
 * `adminium build` (and `adminium dev`, on every change) does for each
 * `apps/<key>/` what a person would do by hand before an upload: check it,
 * put its manifest together, build its screens. The result goes under
 * `.adminium/build/apps/<key>/`:
 *
 *   app.json            the composed manifest, as it passed the check
 *   staff/ customer/    the built sides
 *
 * and the build manifest lists each app with a hash of each half. A running
 * server reads that list and nothing else: it never builds, so a production
 * image needs no bundler.
 *
 * An app with a problem is LISTED WITH ITS PROBLEMS and nothing of it is
 * rewritten: what the last good build left stays on disk and keeps serving.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { LOCAL_PUBLISHER_ID } from '@adminium/manifest';

import type { FolderApp } from '../../apps/app-files.js';
import { BUILD_DIR } from '../build-shared.js';
import type { ClientBundler as Bundler } from '../client-build.js';
import { checkApp, type AppFinding } from './check-app.js';
import { APPS_DIR, MANIFEST_FILE, MANIFEST_PARTS_DIR, SIDES, appDir, listAppKeys, type AppSide } from './read-app.js';
import { hasOwnBuild, isBuildApproved, readAppBuild, runOwnBuild, unapprovedProblem, type StepRunner } from './own-build.js';
import { buildAppSides } from './side-build.js';

/** The composed manifest of a built app, beside its sides. */
export const APP_BUILD_FILE = 'app.json';

export interface BuiltProjectApp {
  key: string;
  /** The manifest's version; null when the app has problems and nothing was built. */
  version: string | null;
  /** sha256 of `app.json`; null with problems. Changes when the manifest does. */
  hash: string | null;
  /** The sides that were built, in serve order. */
  sides: AppSide[];
  /** A hash over every built side's files; '' with no side. Changes when a screen does. */
  sidesHash: string;
  /** Why this app was not built, one line each. Absent when it was. */
  problems?: string[];
}

export interface AppsBuild {
  /** Changes whenever any app's manifest, sides or problems change; '' with no app. */
  digest: string;
  apps: BuiltProjectApp[];
  /** A hash over every file of every app's manifest and screens, as they were when this was built. */
  sources: string;
  /** sha256 of every project file a side's build read outside the app's own folder. */
  inputs: Record<string, string>;
}

export const EMPTY_APPS_BUILD: AppsBuild = { digest: '', apps: [], sources: '', inputs: {} };

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/** Where a built app goes: `.adminium/build/apps/<key>`. */
export function appBuildDir(root: string, key: string): string {
  return join(root, BUILD_DIR, APPS_DIR, key);
}

/** Every plain file under `dir`, relative with `/`, sorted; dot files, links and `node_modules` left out. */
function filesUnder(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...filesUnder(join(dir, entry.name), path));
    else if (entry.isFile()) out.push(path);
  }
  return out.sort();
}

/** The folders of an app that a build reads: its manifest and its screens. Sample data is read when it is added, not built. */
function builtFrom(root: string, key: string): string[] {
  const dir = appDir(root, key);
  const files: string[] = [];
  if (existsSync(join(dir, MANIFEST_FILE))) files.push(MANIFEST_FILE);
  for (const folder of [MANIFEST_PARTS_DIR, ...SIDES]) {
    files.push(...filesUnder(join(dir, folder)).map((file) => `${folder}/${file}`));
  }
  // An app with a build of its own is built from its whole source, wherever its build reads it.
  if (hasOwnBuild(root, key)) {
    const output = readAppBuild(root, key);
    const made = output !== null && 'output' in output ? `${output.output.split('/')[0] ?? ''}/` : null;
    for (const file of filesUnder(dir)) {
      if (files.includes(file) || (made !== null && file.startsWith(made)) || file.startsWith('seeds/')) continue;
      files.push(file);
    }
  }
  return files;
}

/**
 * A hash over everything the apps are built from. A file added, removed or
 * changed under any app's manifest or screens changes it, and so does an app
 * folder appearing or going.
 */
export function appSourcesHash(root: string): string {
  const keys = listAppKeys(root);
  if (keys.length === 0) return '';
  const hash = createHash('sha256');
  for (const key of keys) {
    hash.update(`app:${key}\n`);
    for (const file of builtFrom(root, key)) {
      hash.update(`${file}:${sha256(readFileSync(join(appDir(root, key), file)))}\n`);
    }
  }
  return hash.digest('hex');
}

/** Every folder and file `dev` watches for the apps: `apps/`, each folder under it, and each file. */
export function appWatchedPaths(root: string): string[] {
  const top = join(root, APPS_DIR);
  const out: string[] = [top];
  // What an app's own build writes is not watched: a build would wake itself.
  const made = new Set(
    listAppKeys(root).flatMap((key) => {
      const own = readAppBuild(root, key);
      return own !== null && 'output' in own ? [join(appDir(root, key), own.output.split('/')[0] ?? '')] : [];
    }),
  );
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = join(dir, entry.name);
      if (made.has(path)) continue;
      if (entry.isDirectory()) {
        out.push(path);
        walk(path);
      } else if (entry.isFile()) out.push(path);
    }
  };
  walk(top);
  return out;
}

const findingText = (finding: AppFinding): string =>
  `${finding.path === '' ? finding.file : `${finding.file}: ${finding.path}`} — ${finding.message}`;

function writeAtomically(file: string, text: string): void {
  const temp = `${file}.${String(process.pid)}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, file);
}

/** A hash of what one app's built sides hold. */
function sidesHashOf(root: string, key: string, sides: readonly AppSide[]): string {
  if (sides.length === 0) return '';
  const hash = createHash('sha256');
  for (const side of sides) {
    const dir = join(appBuildDir(root, key), side);
    for (const file of filesUnder(dir)) hash.update(`${side}/${file}:${sha256(readFileSync(join(dir, file)))}\n`);
  }
  return hash.digest('hex');
}

export interface BuildAppsOptions {
  /** The Adminium doing the build. */
  version: string;
  /** The project's esbuild, or null when it has none: an app with screens then has a problem, one without builds. */
  bundler: Bundler | null;
  /** Readable sides with a source map. */
  dev?: boolean;
  /** The engine's side module; tests pass their own. */
  sideModule?: string;
  /** How an app's own build command is run; tests pass their own. */
  runBuild?: StepRunner;
  /** Ends an app's own build command that is running: the Designer's Stop. */
  signal?: AbortSignal;
}

/** Build one app, or say why not. Never throws for what is in the app's files. */
async function buildOne(root: string, key: string, opts: BuildAppsOptions): Promise<{ app: BuiltProjectApp; inputs: Record<string, string> }> {
  const failed = (problems: string[]): { app: BuiltProjectApp; inputs: Record<string, string> } => ({
    app: { key, version: null, hash: null, sides: [], sidesHash: '', problems },
    inputs: {},
  });

  const check = checkApp(root, key, { version: opts.version });
  const errors = check.findings.filter((finding) => finding.level === 'error').map(findingText);
  // A folder app is the person's own: a publisher's app arrives as a package.
  if (check.manifest !== null && check.manifest.publisher.id !== LOCAL_PUBLISHER_ID) {
    errors.push(
      `apps/${key}: publisher.id — is "${check.manifest.publisher.id}". An app in a project folder is "${LOCAL_PUBLISHER_ID}".`,
    );
  }
  if (errors.length > 0 || check.manifest === null || check.folder.document === null) return failed(errors);

  const inputs: Record<string, string> = {};
  const own = readAppBuild(root, key);
  if (own !== null) {
    if ('problem' in own) return failed([own.problem]);
    // A command runs only once a person approved its exact words.
    if (!isBuildApproved(root, key, own)) return failed([unapprovedProblem(key, own)]);
    const ran = await runOwnBuild(root, key, own, { sides: check.sides, ...(opts.runBuild === undefined ? {} : { run: opts.runBuild }), ...(opts.signal === undefined ? {} : { signal: opts.signal }) });
    if ('problems' in ran) return failed(ran.problems);
  } else if (check.sides.length > 0 && opts.bundler === null) {
    return failed([`apps/${key} — its screens need esbuild to build, and this project does not have it. Install it:  npm install --save-dev esbuild`]);
  }
  try {
    // The sides first: a side that does not build leaves the last whole build as it was.
    const built =
      opts.bundler === null || own !== null
        ? []
        : await buildAppSides({
            root,
            key,
            name: check.manifest.name,
            bundler: opts.bundler,
            sides: check.sides,
            ...(opts.dev === true ? { dev: true } : {}),
            ...(opts.sideModule === undefined ? {} : { sideModule: opts.sideModule }),
          });
    for (const side of built) {
      for (const [path, hash] of Object.entries(side.inputs)) {
        // The app's own files are covered by the sources hash; what a side reads from elsewhere is listed.
        if (!path.startsWith(`${APPS_DIR}/${key}/`)) inputs[path] = hash;
      }
    }
  } catch (error) {
    return failed([error instanceof Error ? error.message : String(error)]);
  }

  const out = appBuildDir(root, key);
  mkdirSync(out, { recursive: true });
  // One document, with `kind` said outright, exactly as a package carries it.
  const text = `${JSON.stringify({ kind: 'app', ...check.folder.document }, null, 2)}\n`;
  writeAtomically(join(out, APP_BUILD_FILE), text);
  return {
    app: { key, version: check.manifest.version, hash: sha256(text), sides: [...check.sides], sidesHash: sidesHashOf(root, key, check.sides) },
    inputs,
  };
}

/** Build every app in the project. The build folder of an app whose folder is gone is removed. */
export async function buildProjectApps(root: string, opts: BuildAppsOptions): Promise<AppsBuild> {
  const sources = appSourcesHash(root);
  const keys = listAppKeys(root);
  const apps: BuiltProjectApp[] = [];
  const inputs: Record<string, string> = {};
  for (const key of keys) {
    const built = await buildOne(root, key, opts);
    apps.push(built.app);
    Object.assign(inputs, built.inputs);
  }

  const buildRoot = join(root, BUILD_DIR, APPS_DIR);
  if (existsSync(buildRoot)) {
    for (const entry of readdirSync(buildRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && !keys.includes(entry.name)) rmSync(join(buildRoot, entry.name), { recursive: true, force: true });
    }
  }

  const digest =
    apps.length === 0 ? '' : sha256(JSON.stringify(apps.map((app) => [app.key, app.hash, app.sidesHash, app.problems ?? null])));
  return { digest, apps, sources, inputs };
}

/** Why the built apps are out of date, or null when they are not. */
export function appsStaleReason(root: string, built: AppsBuild | undefined): string | null {
  const sources = appSourcesHash(root);
  if (built === undefined) return sources === '' ? null : 'its apps have not been built';
  if (built.sources !== sources) return 'a file under apps/ changed since the last build';
  for (const app of built.apps) {
    if (app.problems !== undefined) continue;
    if (!existsSync(join(appBuildDir(root, app.key), APP_BUILD_FILE))) return `the build of apps/${app.key} is missing`;
  }
  for (const [path, hash] of Object.entries(built.inputs)) {
    const file = join(root, ...path.split('/'));
    if (!existsSync(file) || !statSync(file).isFile() || sha256(readFileSync(file)) !== hash) return `${path} changed since the last build`;
  }
  return null;
}

/** The apps a build lists, read from the build folder; null when the manifest cannot be read. */
export function readAppsBuild(buildDir: string): AppsBuild | null {
  try {
    const manifest = JSON.parse(readFileSync(join(buildDir, 'manifest.json'), 'utf8')) as { apps?: AppsBuild };
    return manifest.apps ?? EMPTY_APPS_BUILD;
  } catch {
    return null;
  }
}

/**
 * The apps a project's build lists, read again only when the build manifest
 * was rewritten: a server asks this for every installed app on every list.
 */
export function createAppsBuildReader(root: string): () => AppsBuild | null {
  const dir = join(root, BUILD_DIR);
  let seen = '';
  let built: AppsBuild | null = null;
  return () => {
    let stamp = 'missing';
    try {
      const stat = statSync(join(dir, 'manifest.json'));
      stamp = `${String(stat.mtimeMs)}:${String(stat.size)}`;
    } catch {
      // No build yet: nothing is listed.
    }
    if (stamp !== seen) {
      seen = stamp;
      built = stamp === 'missing' ? null : readAppsBuild(dir);
    }
    return built;
  };
}

/**
 * The apps whose files a server answers from the folder: every app the build
 * lists that has a whole build on disk — one with a problem now still has
 * the build made before the problem.
 */
export function folderAppsOf(root: string, built: AppsBuild | null): FolderApp[] {
  return (built?.apps ?? [])
    .filter((app) => existsSync(join(appBuildDir(root, app.key), APP_BUILD_FILE)))
    .map((app) => ({ key: app.key, sourceDir: appDir(root, app.key), buildDir: appBuildDir(root, app.key) }));
}
