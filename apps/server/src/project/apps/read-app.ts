// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app in a project folder: `apps/<key>/`.
 *
 * Its manifest is either one `manifest.json` or a `manifest/` folder of parts
 * (`@adminium/manifest`'s `composeManifest`). This module reads whichever is
 * there and hands back one document, with where each piece came from so a
 * problem can be said against the file a person edits.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { composeManifest, type PartOrigin } from '@adminium/manifest';

import { CliError } from '../../cli/exit.js';

/** The folder a project keeps its apps in. */
export const APPS_DIR = 'apps';
export const MANIFEST_FILE = 'manifest.json';
export const MANIFEST_PARTS_DIR = 'manifest';

/** An app's key: also its folder name, and a segment of the address its screens are served at. */
export const APP_KEY_PATTERN = /^[a-z][a-z0-9-]{1,79}$/;

export const SIDES = ['staff', 'customer'] as const;
export type AppSide = (typeof SIDES)[number];

export interface AppProblem {
  /** Relative to the project, with `/`: `apps/repairs/manifest/tables/jobs.json`. */
  file: string;
  /** Where in the file, dotted; '' for the file as a whole. */
  path: string;
  message: string;
}

export interface AppFolder {
  key: string;
  /** Absolute. */
  dir: string;
  form: 'file' | 'parts';
  /** The manifest as one document, or null when it could not be put together. */
  document: Record<string, unknown> | null;
  /** Which part each table and page came from; null for the one-file form. */
  origin: PartOrigin | null;
  problems: AppProblem[];
}

export function appDir(root: string, key: string): string {
  return join(root, APPS_DIR, key);
}

/** `apps/<key>/…` as a project-relative path. */
export function appPath(key: string, ...rest: string[]): string {
  return [APPS_DIR, key, ...rest].join('/');
}

/** The apps a project holds: every folder under `apps/` with a manifest in either form. */
export function listAppKeys(root: string): string[] {
  const dir = join(root, APPS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(dir, name, MANIFEST_FILE)) || existsSync(join(dir, name, MANIFEST_PARTS_DIR)))
    .sort();
}

/**
 * The app a command is about: the one named, or the only one there is.
 */
export function resolveAppKey(root: string, named: string | undefined, command: string): string {
  const keys = listAppKeys(root);
  if (named !== undefined) {
    if (keys.includes(named)) return named;
    throw new CliError(`There is no app "${named}" in this project.`, {
      hint: keys.length === 0 ? 'Create one with  adminium app new <key>' : `Apps here: ${keys.join(', ')}`,
    });
  }
  if (keys.length === 1) return keys[0] as string;
  if (keys.length === 0) {
    throw new CliError('This project has no app yet.', { hint: 'Create one with  adminium app new <key>' });
  }
  throw new CliError(`This project has ${String(keys.length)} apps. Say which one:  adminium app ${command} <key>`, {
    hint: `Apps here: ${keys.join(', ')}`,
  });
}

/** Every file under the parts folder, as `tables/jobs.json` → text, and the links found there (a part is a plain file). */
function readPartFiles(dir: string, prefix = ''): { files: { path: string; text: string }[]; links: string[] } {
  const files: { path: string; text: string }[] = [];
  const links: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.name.startsWith('.')) continue;
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) links.push(path);
    else if (entry.isDirectory()) {
      const inner = readPartFiles(full, path);
      files.push(...inner.files);
      links.push(...inner.links);
    } else if (entry.isFile()) files.push({ path, text: readFileSync(full, 'utf8') });
  }
  return { files, links };
}

/** Read `apps/<key>/` and put its manifest together. Never throws for what is in the files. */
export function readAppFolder(root: string, key: string): AppFolder {
  const dir = appDir(root, key);
  const file = join(dir, MANIFEST_FILE);
  const partsDir = join(dir, MANIFEST_PARTS_DIR);
  const hasFile = existsSync(file);
  const hasParts = existsSync(partsDir) && statSync(partsDir).isDirectory();

  if (hasFile && hasParts) {
    return {
      key,
      dir,
      form: 'parts',
      document: null,
      origin: null,
      problems: [
        {
          file: appPath(key),
          path: '',
          message: `has both ${MANIFEST_FILE} and ${MANIFEST_PARTS_DIR}/. Keep one of them.`,
        },
      ],
    };
  }
  if (!hasFile && !hasParts) {
    return {
      key,
      dir,
      form: 'parts',
      document: null,
      origin: null,
      problems: [{ file: appPath(key), path: '', message: `has no manifest: neither ${MANIFEST_FILE} nor ${MANIFEST_PARTS_DIR}/.` }],
    };
  }

  if (hasFile) {
    try {
      const document = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      if (document === null || typeof document !== 'object' || Array.isArray(document)) {
        return { key, dir, form: 'file', document: null, origin: null, problems: [{ file: appPath(key, MANIFEST_FILE), path: '', message: 'must be an object' }] };
      }
      return { key, dir, form: 'file', document: document as Record<string, unknown>, origin: null, problems: [] };
    } catch (error) {
      return {
        key,
        dir,
        form: 'file',
        document: null,
        origin: null,
        problems: [{ file: appPath(key, MANIFEST_FILE), path: '', message: `not valid JSON: ${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }

  const read = readPartFiles(partsDir);
  const linked: AppProblem[] = read.links.map((path) => ({
    file: appPath(key, MANIFEST_PARTS_DIR, path),
    path: '',
    message: 'is a link. A manifest part is a plain file in this folder.',
  }));
  const composed = composeManifest(read.files);
  if (!composed.ok || linked.length > 0) {
    return {
      key,
      dir,
      form: 'parts',
      document: null,
      origin: null,
      problems: [
        ...linked,
        ...(composed.ok ? [] : composed.problems).map((problem) => ({ file: appPath(key, MANIFEST_PARTS_DIR, problem.file), path: '', message: problem.message })),
      ],
    };
  }
  return { key, dir, form: 'parts', document: composed.document, origin: composed.origin, problems: [] };
}

/** The first file among `main.tsx`, `main.ts`, `main.jsx`, `main.js` in a side's `src/`, or null. */
export function sideEntry(root: string, key: string, side: AppSide): string | null {
  for (const name of ['main.tsx', 'main.ts', 'main.jsx', 'main.js']) {
    const file = join(appDir(root, key), side, 'src', name);
    if (existsSync(file)) return file;
  }
  return null;
}
