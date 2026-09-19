// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Importing an add-on's page module (51c).
 *
 * The bundle is served by `GET /api/v1/add-ons/<key>/bundle/<path>`, behind the
 * session cookie, and the add-ons list reply carries the URL together with the
 * integrity the server recorded when it unpacked the package.
 *
 * ─── Integrity, and why a link tag does the work ───────────────────────────
 *
 * `import()` takes no integrity option. So the hash goes on a
 * `<link rel="modulepreload" integrity="…">` first: the browser fetches the
 * module, checks the hash, and puts it in its module map — which is where the
 * `import()` afterwards finds it. The code that runs is the code that was
 * checked, and a tampered package fails the preload rather than executing. This
 * is `project/client.ts`'s mechanism, and it is deliberately the same one: two
 * ways to load untrusted code in one product would mean two places to get it
 * wrong.
 *
 * A failed load is FORGOTTEN, so a retry fetches again — an add-on upgraded in
 * another tab should not be permanently broken in this one.
 */

export interface AddOnModuleRef {
  /** `/api/v1/add-ons/<key>/bundle/<path>`, from the add-ons list reply. */
  url: string;
  /** `sha256-…`, recorded at unpack and re-checked on every read. */
  integrity: string;
}

export type ImportModule = (url: string) => Promise<unknown>;

// `@vite-ignore`: the URL is data — Vite must not try to resolve it at build.
const nativeImport: ImportModule = (url) => import(/* @vite-ignore */ url);

let importModule: ImportModule = nativeImport;

/** Test seam: happy-dom cannot import from a URL. Returns a restore function. */
export function setAddOnModuleImporter(importer: ImportModule): () => void {
  importModule = importer;
  return () => {
    importModule = nativeImport;
  };
}

function preload(ref: AddOnModuleRef): void {
  if (typeof document === 'undefined') return;
  for (const existing of document.head.querySelectorAll('link[data-adminium-add-on]')) {
    if (existing.getAttribute('href') === ref.url) return;
  }
  const link = document.createElement('link');
  link.setAttribute('rel', 'modulepreload');
  link.setAttribute('href', ref.url);
  link.setAttribute('integrity', ref.integrity);
  link.setAttribute('data-adminium-add-on', '');
  document.head.append(link);
}

const loaded = new Map<string, Promise<unknown>>();

/**
 * Import one add-on page module and return its default export. Loads are shared
 * per URL; the integrity is part of the key, so an upgraded package (same URL,
 * new hash) loads again instead of serving the old module from this map.
 */
export function loadAddOnModule(ref: AddOnModuleRef): Promise<unknown> {
  const key = `${ref.url} ${ref.integrity}`;
  const existing = loaded.get(key);
  if (existing !== undefined) return existing;
  const pending = (async () => {
    // The runtime first: a bundle reads it as its first module initialises.
    const { ensureAddOnRuntime } = await import('./runtime.js');
    await ensureAddOnRuntime();
    preload(ref);
    const mod = (await importModule(ref.url)) as { default?: unknown } | null;
    return mod?.default;
  })();
  loaded.set(key, pending);
  pending.catch(() => {
    if (loaded.get(key) === pending) loaded.delete(key);
  });
  return pending;
}

/** Test seam. */
export function forgetAddOnModules(): void {
  loaded.clear();
}

export function isComponent(value: unknown): value is (props: never) => unknown {
  return (
    typeof value === 'function' ||
    (typeof value === 'object' && value !== null && '$$typeof' in value)
  );
}
