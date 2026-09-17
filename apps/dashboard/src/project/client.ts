// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The loader that imports the project's browser code
 * (49-developer-projects.md §6.3); `bootstrapProject.ts` reads where it is.
 *
 * A server that runs a project folder lists its built pages and widgets in
 * `bootstrap.project.client`: for each one, the ES module to import, the
 * chunks that module imports, and its stylesheets, every file with an
 * integrity hash. File names carry a content hash, so a rebuilt page has a new
 * URL and `project-changed` (a bootstrap refetch) is all a dashboard needs to
 * pick it up.
 *
 * ─── Integrity ──────────────────────────────────────────────────────────────
 *
 * Before importing, the loader adds a `<link rel="modulepreload">` with the
 * file's hash for the module and every chunk it imports. The browser fetches
 * them once, checks the hash, and keeps them in its module map, which is where
 * `import()` then finds them: the code that runs is the code that was checked.
 * A mismatch fails the preload, and the import after it fails too. The CSP
 * needs nothing new: these are same-origin modules under `'self'`.
 */

import type { ProjectClientEntry, ProjectClientFile } from './bootstrapProject.js';
import { ensureProjectRuntime } from './runtime.js';

export type ImportModule = (url: string) => Promise<unknown>;

// `@vite-ignore`: the URL is data, and Vite must leave this import alone.
const nativeImport: ImportModule = (url) => import(/* @vite-ignore */ url);

let importModule: ImportModule = nativeImport;

/** Test seam: happy-dom cannot import from a URL. Returns a restore function. */
export function setProjectModuleImporter(importer: ImportModule): () => void {
  importModule = importer;
  return () => {
    importModule = nativeImport;
  };
}

function addLink(rel: 'modulepreload' | 'stylesheet', file: ProjectClientFile): void {
  if (typeof document === 'undefined') return;
  for (const existing of document.head.querySelectorAll('link[data-adminium-project]')) {
    if (existing.getAttribute('href') === file.url && existing.getAttribute('rel') === rel) return;
  }
  const link = document.createElement('link');
  link.setAttribute('rel', rel);
  link.setAttribute('href', file.url);
  link.setAttribute('integrity', file.integrity);
  link.setAttribute('data-adminium-project', '');
  document.head.append(link);
}

const loaded = new Map<string, Promise<unknown>>();

/**
 * Import one page or widget and return its default export. Loads are shared
 * per URL; a failed one is forgotten, so a retry fetches again.
 */
export function loadProjectModule(entry: ProjectClientEntry): Promise<unknown> {
  const key = entry.module.url;
  const existing = loaded.get(key);
  if (existing !== undefined) return existing;
  const pending = (async () => {
    // The runtime first: a bundle reads it as its first module initialises.
    await ensureProjectRuntime();
    for (const style of entry.styles) addLink('stylesheet', style);
    for (const file of [...entry.imports, entry.module]) addLink('modulepreload', file);
    const mod = (await importModule(entry.module.url)) as { default?: unknown } | null;
    return mod?.default;
  })();
  loaded.set(key, pending);
  pending.catch(() => {
    if (loaded.get(key) === pending) loaded.delete(key);
  });
  return pending;
}

/** Test seam. */
export function forgetProjectModules(): void {
  loaded.clear();
}

export function isComponent(value: unknown): value is (props: never) => unknown {
  return typeof value === 'function' || (typeof value === 'object' && value !== null && '$$typeof' in value);
}
