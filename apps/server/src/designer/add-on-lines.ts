// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The add-ons a Designer model can name: the ones this server has, and the
 * ones its cached catalogue lists. Read from disk; nothing is fetched.
 */
import { manifestsRepo, type MetaDb } from '@adminium/meta';

import type { AddOnStore } from '../add-ons/store.js';
import { catalogSchema, isCurrentCatalogFormat, pickLocalized } from '../add-ons/catalog.js';
import type { AddOnLine } from './tools.js';

/** The shapes a manifest document defines, as an app names them: `invoice@1`. */
function shapesOf(document: unknown): string[] {
  const shapes = (document as { addOn?: { shapes?: { name?: unknown; version?: unknown }[] } } | null)?.addOn?.shapes ?? [];
  return shapes.flatMap((shape) => (typeof shape.name === 'string' && typeof shape.version === 'number' ? [`${shape.name}@${String(shape.version)}`] : []));
}

/** An add-on's manifest: the installed one, else the newest in this server's store. Null when it is neither. */
export async function readAddOnManifest(
  deps: { meta: MetaDb; credentialCrypto: { encrypt(value: string): string; decrypt(value: string): string }; store: AddOnStore },
  key: string,
): Promise<unknown> {
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(key)) return null;
  const installed = await manifestsRepo(deps.meta, deps.credentialCrypto).findByKey(key);
  if (installed !== null && installed.row.kind === 'add-on') return installed.document;
  try {
    const version = (await deps.store.versions(key)).at(-1);
    return version === undefined ? null : (JSON.parse((await deps.store.readFile(key, version, 'manifest.json')).toString('utf8')) as unknown);
  } catch {
    return null;
  }
}

export async function addOnLines(deps: {
  meta: MetaDb;
  credentialCrypto: { encrypt(value: string): string; decrypt(value: string): string };
  store: AddOnStore;
  networkFeatures: boolean;
}): Promise<AddOnLine[]> {
  const out = new Map<string, AddOnLine>();
  for (const installed of await manifestsRepo(deps.meta, deps.credentialCrypto).list('add-on')) {
    const document = (installed.document ?? {}) as { name?: unknown; description?: { fallback?: unknown } };
    out.set(installed.row.manifestKey, {
      key: installed.row.manifestKey,
      name: typeof document.name === 'string' ? document.name : installed.row.manifestKey,
      version: installed.row.version,
      line: typeof document.description?.fallback === 'string' ? document.description.fallback : '',
      state: 'installed',
      shapes: shapesOf(installed.document),
    });
  }
  // On disk and not installed: bundled with this server, or downloaded, or uploaded.
  for (const key of await deps.store.keys()) {
    if (out.has(key)) continue;
    const version = (await deps.store.versions(key)).at(-1);
    if (version === undefined) continue;
    let name = key;
    let line = '';
    let shapes: string[] = [];
    try {
      const document = JSON.parse((await deps.store.readFile(key, version, 'manifest.json')).toString('utf8')) as { name?: unknown; description?: { fallback?: unknown } };
      shapes = shapesOf(document);
      if (typeof document.name === 'string') name = document.name;
      if (typeof document.description?.fallback === 'string') line = document.description.fallback;
    } catch {
      // Listed by its key.
    }
    out.set(key, { key, name, version, line, state: 'available', shapes });
  }
  // What the catalogue listed when it was last read. Only offered where it can be downloaded.
  if (deps.networkFeatures) {
    const cached = await deps.store.readCatalogCache();
    if (cached !== null && isCurrentCatalogFormat(cached.document)) {
      const parsed = catalogSchema.safeParse(cached.document);
      if (parsed.success) {
        for (const entry of parsed.data.addOns) {
          if (out.has(entry.key)) continue;
          out.set(entry.key, { key: entry.key, name: pickLocalized(entry.name, 'en-US') ?? entry.key, version: entry.version, line: pickLocalized(entry.tagline, 'en-US') ?? '', state: 'available' });
        }
      }
    }
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
}
