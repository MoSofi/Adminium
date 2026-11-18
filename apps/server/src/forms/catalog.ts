// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FINDING A FORM: which published form a stranger's address names.
 *
 * A form lives in a forms add-on's own table (the add-on block's `forms`
 * word names it, `@adminium/manifest` `formsOf`), on the add-on's own
 * connection. The engine reads it there for a stranger; no add-on code runs.
 * A slug finds a form only when all of this holds:
 *
 *  - an add-on that declares `addOn.forms` is installed (status `installed`)
 *    on a connection, and switched on for at least one place it is attached
 *    to (an add-on attached nowhere, or switched off everywhere, is off);
 *  - its package is vouched (`vouched`, which the answer door fills with the
 *    same trust the sandboxed deciders need; until then every package is);
 *  - its forms table is there, and holds a row with that slug;
 *  - that row is `live`, and its `published` JSON (the definition and the
 *    settings frozen at publish, `{ definition, settings }`) parses whole with
 *    the forms vocabulary's `parseForm`;
 *  - the privacy notice is set (a public form is refused until it is).
 *
 * A `closed` row answers "closed" (the page shows the business's contact).
 * Everything else, a draft, a slug nobody has, an add-on switched off, a
 * definition that no longer parses, answers one same "not available", so the
 * answer never tells which forms exist.
 *
 * A lookup is kept for at most {@link FORM_CACHE_MS}: a page and its API ask
 * for the same form within moments, and a flood of requests for one form
 * reads its row once every few seconds, not once a request. A change by staff
 * (published, closed, switched off) reaches strangers within that time.
 */
import { formsOf, type AddOnManifest } from '@adminium/manifest';
import { isFormSlug, parseForm, type Form } from '@adminium/add-on-contracts/forms';
import type { MetaDb } from '@adminium/meta';

import type { AddOnInstalls } from '../apps/table-ref.js';
import type { DataHandle } from '../connections/manager.js';
import { privacyNoticeReady } from '../privacy/business.js';

/** The longest a lookup is kept. */
export const FORM_CACHE_MS = 5_000;
/** The most slugs kept at once: a flood of made-up slugs cannot grow the cache past this. */
const CACHE_MAX = 500;

/** The slug rule, shared with the forms add-on's builder (`@adminium/add-on-contracts/forms`). */
export { FORM_SLUG } from '@adminium/add-on-contracts/forms';

/** A live form, as the engine serves it. */
export interface LiveForm {
  /** The form row's key, as text: what a proof for this form is bound to. */
  id: string;
  slug: string;
  /** The add-on that holds it, and the connection its tables are on. */
  addOn: string;
  connectionId: string;
  form: Form;
  /** The add-on install that holds it (its `adminium_manifests` id): what its views are counted under. */
  installId?: string | undefined;
}

export type FormLookup = { state: 'live'; live: LiveForm } | { state: 'closed' } | { state: 'unavailable' };

/** What a vouching decision is asked about. */
export interface FormsPackage {
  key: string;
  version: string;
  manifest: AddOnManifest;
}

export interface FormsCatalogDeps {
  meta: MetaDb;
  /** What is installed where, read fresh (`keepAddOnInstalls`). */
  installs: () => Promise<AddOnInstalls>;
  /** The data handle of a connection (`ConnectionManager.data`). */
  data: (connectionId: string) => Promise<Pick<DataHandle, 'db'>>;
  /**
   * Whether a package that declares forms may serve them: the same trust the
   * sandboxed deciders need. Every package is, until the answer door says.
   */
  vouched?: (pkg: FormsPackage) => boolean | Promise<boolean>;
  now?: () => number;
}

/** A JSON column as the engine reads it back: parsed on Postgres and MySQL, text on SQLite. */
export function jsonOf(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

/** The primary-key column of one of the add-on's own tables, by the manifest. */
function primaryKeyOf(manifest: AddOnManifest, ref: string): string | null {
  const table = (manifest.requiredSchema?.tables ?? []).find((candidate) => candidate.ref === ref);
  return table?.columns.find((column) => column.role === 'pk')?.ref ?? null;
}

export function createFormsCatalog(deps: FormsCatalogDeps) {
  const now = deps.now ?? Date.now;
  const vouched = deps.vouched ?? (() => true);
  const cache = new Map<string, { at: number; lookup: Promise<FormLookup> }>();

  /** Every installed add-on that declares forms, with its connection: oldest install first. */
  async function formsAddOns(): Promise<{ key: string; installId: string; connectionId: string; manifest: AddOnManifest; version: string; on: boolean }[]> {
    const rows = await deps.meta.db
      .selectFrom('adminium_manifests')
      .select(['id', 'manifestKey', 'connectionId'])
      .where('kind', '=', 'add-on')
      .where('status', '=', 'installed')
      .orderBy('installedAt')
      .orderBy('manifestKey')
      .execute();
    const installs = await deps.installs();
    const out: { key: string; installId: string; connectionId: string; manifest: AddOnManifest; version: string; on: boolean }[] = [];
    for (const row of rows) {
      if (row.connectionId === null) continue;
      const installed = installs.installed(row.connectionId, row.manifestKey);
      if (installed === null || installed.status !== 'installed' || formsOf(installed.manifest) === null) continue;
      out.push({ key: row.manifestKey, installId: row.id, connectionId: row.connectionId, manifest: installed.manifest, version: installed.version, on: [...installed.hosts.values()].some(Boolean) });
    }
    return out;
  }

  type FormsAddOn = Awaited<ReturnType<typeof formsAddOns>>[number];

  /** Whether a form row an add-on holds is served to strangers now, and as what (see the header). */
  async function judge(addOn: FormsAddOn, pk: string, row: Record<string, unknown>): Promise<FormLookup> {
    const unavailable: FormLookup = { state: 'unavailable' };
    if (!addOn.on || !(await vouched({ key: addOn.key, version: addOn.version, manifest: addOn.manifest }))) return unavailable;
    if (!(await privacyNoticeReady(deps.meta))) return unavailable;
    if (row['state'] === 'closed') return { state: 'closed' };
    if (row['state'] !== 'live') return unavailable;
    const slug = row['slug'];
    if (!isFormSlug(slug)) return unavailable;
    const published = jsonOf(row['published']);
    if (published === null || typeof published !== 'object' || Array.isArray(published)) return unavailable;
    const { definition, settings } = published as { definition?: unknown; settings?: unknown };
    const parsed = parseForm(definition, settings);
    if (!parsed.ok) return unavailable;
    const id = row[pk];
    if (typeof id !== 'string' && typeof id !== 'number' && typeof id !== 'bigint') return unavailable;
    return { state: 'live', live: { id: String(id), slug, addOn: addOn.key, connectionId: addOn.connectionId, form: parsed.form, installId: addOn.installId } };
  }

  /** The row of an add-on's forms table one column names, with what judging it reads; undefined when none, or it cannot be read. */
  async function formRow(addOn: FormsAddOn, by: 'slug' | 'key', value: string): Promise<{ pk: string; row: Record<string, unknown> } | undefined> {
    const installs = await deps.installs();
    const block = formsOf(addOn.manifest)!;
    const tableId = installs.tableOf(addOn.connectionId, addOn.key, block.forms);
    const pk = primaryKeyOf(addOn.manifest, block.forms);
    if (tableId === null || pk === null) return undefined;
    try {
      const { db } = await deps.data(addOn.connectionId);
      const row = (await db
        .selectFrom(tableId)
        .select([db.dynamic.ref(pk), db.dynamic.ref('slug'), db.dynamic.ref('state'), db.dynamic.ref('published')] as never)
        .where(db.dynamic.ref(by === 'slug' ? 'slug' : pk), '=', value)
        .executeTakeFirst()) as Record<string, unknown> | undefined;
      return row === undefined ? undefined : { pk, row };
    } catch {
      // A connection switched off, a table that cannot be read, a key of the wrong type: as a form that is not there.
      return undefined;
    }
  }

  async function lookUp(slug: string): Promise<FormLookup> {
    // A slug the rule refuses, a reserved word among them, is never a form: the builder refuses it too.
    if (!isFormSlug(slug)) return { state: 'unavailable' };
    for (const addOn of await formsAddOns()) {
      const found = await formRow(addOn, 'slug', slug);
      // The first add-on that holds the slug answers for it, whatever its row says.
      if (found !== undefined) return judge(addOn, found.pk, found.row);
    }
    return { state: 'unavailable' };
  }

  /**
   * A form by its add-on and its row's key, as strangers are served it now:
   * what a landing page's Form block names (kept a few seconds, as a slug's
   * lookup). The same judgement as by its slug, of the oldest install of
   * that add-on.
   */
  async function byKey(addOnKey: string, key: string): Promise<FormLookup> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(key)) return { state: 'unavailable' };
    const cacheKey = `key:${addOnKey}:${key}`;
    const at = now();
    const kept = cache.get(cacheKey);
    if (kept !== undefined && at - kept.at < FORM_CACHE_MS) return kept.lookup;
    const lookup = (async (): Promise<FormLookup> => {
      const addOn = (await formsAddOns()).find((one) => one.key === addOnKey);
      const found = addOn === undefined ? undefined : await formRow(addOn, 'key', key);
      return addOn === undefined || found === undefined ? { state: 'unavailable' } : judge(addOn, found.pk, found.row);
    })();
    remember(cacheKey, at, lookup);
    return lookup;
  }

  /** Keep a lookup, the cache bounded. */
  function remember(cacheKey: string, at: number, lookup: Promise<FormLookup>): void {
    if (cache.size >= CACHE_MAX) {
      for (const [one, entry] of cache) if (at - entry.at >= FORM_CACHE_MS) cache.delete(one);
      if (cache.size >= CACHE_MAX) cache.clear();
    }
    cache.set(cacheKey, { at, lookup });
    // A read that failed is not kept: the next request asks again.
    lookup.catch(() => cache.delete(cacheKey));
  }

  /** The form a slug names, as strangers are served it now (kept a few seconds). */
  async function find(slug: string): Promise<FormLookup> {
    const at = now();
    const kept = cache.get(slug);
    if (kept !== undefined && at - kept.at < FORM_CACHE_MS) return kept.lookup;
    const lookup = lookUp(slug);
    remember(slug, at, lookup);
    return lookup;
  }

  /**
   * A form's saved draft by its slug, whatever its state, for its preview:
   * the add-on that holds it, its forms table's id (what a reader's grant is
   * asked on), and the draft's definition and settings as stored. Not served
   * to strangers: the preview route asks the reader's grant first. No cache:
   * staff ask as they type.
   */
  async function draft(slug: string): Promise<{ addOn: string; connectionId: string; formsTable: string; definition: unknown; settings: unknown } | null> {
    if (!isFormSlug(slug)) return null;
    const installs = await deps.installs();
    for (const addOn of await formsAddOns()) {
      const block = formsOf(addOn.manifest)!;
      const tableId = installs.tableOf(addOn.connectionId, addOn.key, block.forms);
      if (tableId === null) continue;
      let row: Record<string, unknown> | undefined;
      try {
        const { db } = await deps.data(addOn.connectionId);
        row = (await db
          .selectFrom(tableId)
          .select([db.dynamic.ref('definition'), db.dynamic.ref('settings')] as never)
          .where(db.dynamic.ref('slug'), '=', slug)
          .executeTakeFirst()) as Record<string, unknown> | undefined;
      } catch {
        continue;
      }
      if (row === undefined) continue;
      return { addOn: addOn.key, connectionId: addOn.connectionId, formsTable: tableId, definition: jsonOf(row['definition']), settings: jsonOf(row['settings']) };
    }
    return null;
  }

  /** The live forms, for a screen that lists their addresses (no cache: staff ask rarely). */
  async function liveSlugs(): Promise<{ addOn: string; slug: string }[]> {
    const installs = await deps.installs();
    const out: { addOn: string; slug: string }[] = [];
    for (const addOn of await formsAddOns()) {
      if (!addOn.on) continue;
      const block = formsOf(addOn.manifest)!;
      const tableId = installs.tableOf(addOn.connectionId, addOn.key, block.forms);
      if (tableId === null) continue;
      try {
        const { db } = await deps.data(addOn.connectionId);
        const rows = (await db
          .selectFrom(tableId)
          .select(db.dynamic.ref('slug') as never)
          .where(db.dynamic.ref('state'), '=', 'live')
          .execute()) as { slug?: unknown }[];
        // Only a slug the door serves: a reserved word is no form's address.
        for (const row of rows) if (isFormSlug(row.slug)) out.push({ addOn: addOn.key, slug: row.slug });
      } catch {
        continue;
      }
    }
    return out;
  }

  return { find, byKey, draft, liveSlugs, forget: (slug?: string) => (slug === undefined ? cache.clear() : cache.delete(slug)) };
}

export type FormsCatalog = ReturnType<typeof createFormsCatalog>;
