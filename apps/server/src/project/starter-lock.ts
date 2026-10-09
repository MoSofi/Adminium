// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The lockfile a new project starts with, inside the desktop app.
 *
 * A new project's `package.json` names ranges ("^19.2.0"), so two people who
 * make a project a month apart get different packages, and a release that was
 * walked through and found good installs something else the week after. The
 * app therefore carries the lockfile its release was tried with: made at
 * release for exactly what a new project lists (`scripts/release/
 * starter-lockfile.mjs`), and laid into a new project so its first install is
 * `npm ci`, which installs what the lockfile says or refuses.
 *
 * It is used only when it FITS: the new project's dependencies must be, name
 * for name and range for range, what the lockfile was made for. A project
 * made with a flag that changes them simply installs the ordinary way.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DESIGNER_REACT_VERSION } from '../designer/needs.js';
import { PUBLIC_CLIENT_PACKAGE } from './apps/scaffold-app.js';
import { desktopPrograms } from './programs.js';

/** The two files of a carried starter: the lockfile, and what it was made for. */
export const STARTER_LOCK = 'package-lock.json';
export const STARTER_MANIFEST = 'starter.json';

/** The React a project's screens are built with: what the Designer adds to a project it makes. */
export const STARTER_REACT_VERSION = DESIGNER_REACT_VERSION;

type Dependencies = Record<string, string>;
interface Listed {
  dependencies: Dependencies;
  devDependencies: Dependencies;
}

const record = (value: unknown): Dependencies => (typeof value === 'object' && value !== null ? { ...(value as Dependencies) } : {});
const same = (a: Dependencies, b: Dependencies): boolean => {
  const keys = Object.keys(a).sort();
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};
const readJson = (file: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** What a project lists, as a lockfile is made for it. */
export function listedDependencies(manifest: Record<string, unknown>): Listed {
  return { dependencies: record(manifest['dependencies']), devDependencies: record(manifest['devDependencies']) };
}

/**
 * Add what an app's own screens are built with (React, and Adminium's public
 * client at the engine's own version), exact, to a project's `package.json`.
 * The Designer adds the same three to a project it makes on a terminal; here
 * they are written before the first install, so that install is the only one.
 */
export function addScreenPackagesTo(root: string, version: string): void {
  const file = join(root, 'package.json');
  const manifest = readJson(file);
  if (manifest === null) return;
  const dependencies = record(manifest['dependencies']);
  dependencies['react'] = STARTER_REACT_VERSION;
  dependencies['react-dom'] = STARTER_REACT_VERSION;
  dependencies[PUBLIC_CLIENT_PACKAGE] = version;
  manifest['dependencies'] = dependencies;
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * The carried lockfile's text for the project in `root`, with the project's
 * own name on it, or `null`: there is none, the project already has a
 * lockfile, or the lockfile was made for other dependencies.
 */
export function starterLockFor(root: string, starterDir: string): string | null {
  if (existsSync(join(root, STARTER_LOCK))) return null;
  const project = readJson(join(root, 'package.json'));
  const madeFor = readJson(join(starterDir, STARTER_MANIFEST));
  const lock = readJson(join(starterDir, STARTER_LOCK));
  if (project === null || madeFor === null || lock === null) return null;
  const wants = listedDependencies(project);
  const has = listedDependencies(madeFor);
  if (!same(wants.dependencies, has.dependencies) || !same(wants.devDependencies, has.devDependencies)) return null;
  const packages = typeof lock['packages'] === 'object' && lock['packages'] !== null ? (lock['packages'] as Record<string, Record<string, unknown>>) : null;
  const top = packages?.[''];
  if (packages === null || top === undefined) return null;
  const name = typeof project['name'] === 'string' ? project['name'] : 'project';
  const version = typeof project['version'] === 'string' ? project['version'] : undefined;
  lock['name'] = name;
  if (version === undefined) delete lock['version'];
  else lock['version'] = version;
  packages[''] = { ...top, name, ...(version === undefined ? {} : { version }) };
  if (version === undefined) delete packages['']['version'];
  return `${JSON.stringify(lock, null, 2)}\n`;
}

/** Lay the carried lockfile into a new project, when the app carries one that fits. Says whether it did. */
export function applyStarterLock(root: string, env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const starter = desktopPrograms(env)?.starter ?? null;
  if (starter === null) return false;
  const text = starterLockFor(root, starter);
  if (text === null) return false;
  writeFileSync(join(root, STARTER_LOCK), text);
  return true;
}
