// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A FORM'S `landing` ENDING, AS A STRANGER IS SERVED IT.
 *
 * A form may end on one of the business's own landing pages, named by the
 * page's row key in a pages add-on (`{ kind: 'landing', page, addOn }`,
 * `@adminium/add-on-contracts/forms`). The address is never stored: each
 * time the form is served, the engine looks the page up and writes its
 * address on the host the form is being served on. So a page's new address,
 * a new host, or an install served over plain http in development never
 * breaks the ending.
 *
 * The page is found when all of this holds:
 *  - the add-on the ending names is installed (on the form's own database
 *    first, else the first other one that has it) and switched on, and its
 *    package is vouched as a door's is;
 *  - its pages table holds a row with that key;
 *  - that row is `live`, its slug keeps the landing slug rule, and its
 *    published copy parses whole and carries no assistant's mark.
 *
 * Else the ending is BROKEN: the stranger is shown the form's default thanks
 * (an ending of words with none of the owner's), and a staff read says the
 * ending is broken. A lookup is kept a few seconds, as a form's is: a flood of
 * answers reads the page's row once every few seconds, not once a request.
 */
import { hasMiloMarks, isLandingSlug, parseLandingPage } from '@adminium/add-on-contracts/landing';
import type { FormDefinition, FormEnding } from '@adminium/add-on-contracts/forms';
import type { AddOnManifest } from '@adminium/manifest';
import type { MetaDb } from '@adminium/meta';

import type { AddOnInstalls } from '../apps/table-ref.js';
import type { DataHandle } from '../connections/manager.js';
import { FORM_CACHE_MS, jsonOf } from '../forms/catalog.js';
import { landingAddOnOn } from './installed.js';

/** Where a landing ending leads now: a live page's slug, or nowhere. */
export type LandingEndingTarget = { state: 'live'; slug: string } | { state: 'broken' };

/** The ending a stranger is served in its place: a page's address, or the default thanks. */
export type ServedEnding = Exclude<FormEnding, { kind: 'landing' }>;

/** The most lookups kept at once. */
const CACHE_MAX = 500;

/** A live landing page's address on a host: the pages door's own path. */
export function landingPageAddress(origin: string, slug: string): string {
  return `${origin}/x/pages/${slug}`;
}

/** The ending a broken landing ending is served as: the form's default thanks, with none of the owner's words. */
export const DEFAULT_THANKS: ServedEnding = { kind: 'words', words: {} };

/** A form's ending as a stranger is served it, its landing page looked up already (`target`) on the host `origin`. */
export function servedEnding(ending: FormEnding, target: LandingEndingTarget | null, origin: string | null): ServedEnding {
  if (ending.kind !== 'landing') return ending;
  return target?.state === 'live' && origin !== null ? { kind: 'page', url: landingPageAddress(origin, target.slug) } : DEFAULT_THANKS;
}

export interface LandingEndingsDeps {
  meta: MetaDb;
  installs: () => Promise<AddOnInstalls>;
  data: (connectionId: string) => Promise<Pick<DataHandle, 'db'>>;
  /** Whether a pages package may serve its pages: a door's vouch. Every package is, until the server says. */
  vouched?: (pkg: { key: string; version: string; manifest: AddOnManifest }) => boolean | Promise<boolean>;
  now?: () => number;
}

export function createLandingEndings(deps: LandingEndingsDeps) {
  const now = deps.now ?? Date.now;
  const vouched = deps.vouched ?? (() => true);
  const cache = new Map<string, { at: number; target: Promise<LandingEndingTarget> }>();

  /** The databases the add-on `key` is installed on. */
  async function databasesOf(key: string): Promise<string[]> {
    const rows = await deps.meta.db.selectFrom('adminium_manifests').select('connectionId').where('kind', '=', 'add-on').where('manifestKey', '=', key).where('status', '=', 'installed').execute();
    return rows.flatMap((row) => (row.connectionId === null ? [] : [row.connectionId])).sort();
  }

  async function lookUp(addOnKey: string, page: string, near: string): Promise<LandingEndingTarget> {
    const broken: LandingEndingTarget = { state: 'broken' };
    const installs = await deps.installs();
    const databases = await databasesOf(addOnKey);
    const ordered = [...(databases.includes(near) ? [near] : []), ...databases.filter((one) => one !== near)];
    const found = ordered.map((connectionId) => landingAddOnOn(installs, connectionId, addOnKey)).find((one) => one !== null) ?? null;
    if (found === null || !found.on || found.pages === null || found.pagesKey === null) return broken;
    if (!(await vouched({ key: found.key, version: found.version, manifest: found.manifest }))) return broken;
    let row: Record<string, unknown> | undefined;
    try {
      const { db } = await deps.data(found.connectionId);
      row = (await db
        .selectFrom(found.pages)
        .select([db.dynamic.ref(found.pagesKey), db.dynamic.ref('slug'), db.dynamic.ref('state'), db.dynamic.ref('published')] as never)
        .where(db.dynamic.ref(found.pagesKey), '=', page)
        .executeTakeFirst()) as Record<string, unknown> | undefined;
    } catch {
      // A key the column cannot hold (letters for a number), a database switched off: no page.
      return broken;
    }
    // The row the key names, and no other: a database that reads `12abc` as 12 is not taken at its word.
    if (row === undefined || String(row[found.pagesKey]) !== page) return broken;
    if (row['state'] !== 'live' || !isLandingSlug(row['slug'])) return broken;
    const parsed = parseLandingPage(jsonOf(row['published']));
    if (!parsed.ok || hasMiloMarks(parsed.page)) return broken;
    return { state: 'live', slug: row['slug'] as string };
  }

  /** Where a landing ending leads now, its page looked up from the form's own database `near` (kept a few seconds). */
  async function target(ending: Extract<FormEnding, { kind: 'landing' }>, near: string): Promise<LandingEndingTarget> {
    const at = now();
    const id = `${near} ${ending.addOn} ${ending.page}`;
    const kept = cache.get(id);
    if (kept !== undefined && at - kept.at < FORM_CACHE_MS) return kept.target;
    if (cache.size >= CACHE_MAX) {
      for (const [one, entry] of cache) if (at - entry.at >= FORM_CACHE_MS) cache.delete(one);
      if (cache.size >= CACHE_MAX) cache.clear();
    }
    const looked = lookUp(ending.addOn, ending.page, near);
    cache.set(id, { at, target: looked });
    // A read that failed is not kept: the next request asks again.
    looked.catch(() => cache.delete(id));
    return looked;
  }

  /**
   * A form's definition as a stranger is served it on the host `origin` (null:
   * a host no address can be written for): a `landing` ending turned into its
   * page's address, or the default thanks. Any other ending is left as it is.
   */
  async function serve(definition: FormDefinition, near: string, origin: string | null): Promise<FormDefinition> {
    if (definition.ending.kind !== 'landing') return definition;
    return { ...definition, ending: servedEnding(definition.ending, await target(definition.ending, near), origin) };
  }

  return { target, serve, forget: () => cache.clear() };
}

export type LandingEndings = ReturnType<typeof createLandingEndings>;
