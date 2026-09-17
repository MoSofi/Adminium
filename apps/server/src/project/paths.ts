// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Where a project keeps its pages and schema customizations, and how a path
 * names what it holds. Paths are always written with `/`, whatever the
 * operating system, because they are stored and compared as keys.
 */

import path from 'node:path';

import { PROJECT_KEY_PATTERN } from './config.js';

export const PAGES_DIR = 'pages';
export const SCHEMA_DIR = 'schema';

/** A page slug, as the page routes accept it: kebab-case, at most 31 characters. */
export const PAGE_SLUG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const PAGE_SLUG_MAX = 31;

export type ProjectFileKind = { kind: 'page'; slug: string } | { kind: 'schema'; key: string };

export function pagePath(slug: string): string {
  return `${PAGES_DIR}/${slug}.json`;
}

export function schemaPath(key: string): string {
  return `${SCHEMA_DIR}/${key}.json`;
}

export function isPageSlug(slug: string): boolean {
  return slug.length <= PAGE_SLUG_MAX && PAGE_SLUG_PATTERN.test(slug);
}

/**
 * What a project path holds, or null for a file the sync does not read
 * (`pages/README.md`, a `.gitkeep`, a hand-written `pages/revenue.tsx`).
 * A `.json` file whose name is not a valid slug or key still counts, with
 * `valid: false`, so `check` can say what is wrong with it.
 */
export function parseProjectPath(path: string): (ProjectFileKind & { valid: boolean }) | null {
  const match = /^(pages|schema)\/([^/]+)\.json$/.exec(path);
  if (match === null) return null;
  const [, dir, name] = match as unknown as [string, string, string];
  // `_nav.json` and other underscore files are reserved for later formats.
  if (name.startsWith('_') || name.startsWith('.')) return null;
  if (dir === PAGES_DIR) return { kind: 'page', slug: name, valid: isPageSlug(name) };
  return { kind: 'schema', key: name, valid: PROJECT_KEY_PATTERN.test(name) };
}

/** The path functions of one platform; tests pass `path.win32`. */
export type PathApi = Pick<typeof path, 'relative' | 'sep' | 'join' | 'dirname' | 'basename'>;

/** `absolute` as a project path: relative to `root`, with `/`. */
export function toProjectPath(root: string, absolute: string, api: PathApi = path): string {
  return api.relative(root, absolute).split(api.sep).join('/');
}

/** A project path as a file-system path under `root`. */
export function fromProjectPath(root: string, projectPath: string, api: PathApi = path): string {
  return api.join(root, ...projectPath.split('/'));
}
