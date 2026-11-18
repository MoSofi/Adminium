// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FINDING A LANDING PAGE: which published page a stranger's address names
 * (`/x/pages/<slug>`).
 *
 * A page lives in a landing pages add-on's own pages table (the add-on
 * block's `landing` word names it, `@adminium/manifest` `landingOf`), on the
 * add-on's own connection. The engine reads it there for a stranger; no
 * add-on code runs. A slug finds a page only when all of this holds:
 *
 *  - the slug keeps the landing slug rule (a reserved word, `api` or a
 *    sign-in-like one, is never a page);
 *  - an add-on that declares `addOn.landing` is installed (status
 *    `installed`) on a connection, and switched on for at least one place it
 *    is attached to;
 *  - its package is vouched for (`vouched`: the trust the sandboxed deciders
 *    need, `forms/vouched.ts`); a package uploaded by hand serves nothing;
 *  - its pages table is there, and holds a row with that slug;
 *  - that row is `live`, and its `published` copy parses whole with the
 *    page vocabulary (`parseLandingPage`, read at every lookup) and carries
 *    none of the assistant's marks;
 *  - the privacy notice is set (a public page is refused until it is).
 *
 * Everything else, a draft, a page switched off, a slug nobody has, an
 * add-on switched off, a copy that no longer parses, answers one same "not
 * available", so the answer never tells which pages exist. The first add-on
 * (oldest install) that holds a slug answers for it, whatever its row says.
 *
 * A lookup is kept for at most {@link PAGE_CACHE_MS}: a page and its data
 * ask for the same slug within moments, and a flood of requests for one page
 * reads its row once every few seconds. A change by staff (published,
 * switched off) reaches strangers within that time.
 */
import { hasMiloMarks, isLandingSlug, parseLandingPage, type LandingPage } from '@adminium/add-on-contracts/landing';
import { landingOf, type AddOnLanding, type AddOnManifest } from '@adminium/manifest';
import type { MetaDb } from '@adminium/meta';

import type { AddOnInstalls } from '../apps/table-ref.js';
import type { DataHandle } from '../connections/manager.js';
import { jsonOf } from '../forms/catalog.js';
import { privacyNoticeReady } from '../privacy/business.js';

/** The longest a lookup is kept. */
export const PAGE_CACHE_MS = 5_000;
/** The most slugs kept at once: a flood of made-up slugs cannot grow the cache past this. */
const CACHE_MAX = 500;
/** An add-on key as a manifest may spell one. */
const ADD_ON_KEY = /^[a-z][a-z0-9-]{1,79}$/;
/** A row key as a link or a preview names one (the page vocabulary's). */
const ROW_KEY = /^[A-Za-z0-9_-]{1,64}$/;
/** The most live pages of one add-on read to resolve the links between them. */
const LINKED_PAGES_MAX = 1_000;

/** A live page, as the engine serves it. */
export interface LivePage {
  /** The page row's key, as text: what links, funnels and its pictures name it by. */
  key: string;
  slug: string;
  /** The add-on that holds it, its install, and the connection its tables are on. */
  addOn: string;
  installId: string;
  connectionId: string;
  /** The pages table's id on that connection: what a reader's grant is asked on, and what its pictures hang on. */
  pagesTable: string;
  /** The pages table's key column. */
  pk: string;
  /** The one language the page is written in (a BCP 47 tag, as stored). */
  language: string;
  page: LandingPage;
}

export type PageLookup = { state: 'live'; live: LivePage } | { state: 'unavailable' };

/** What a vouching decision is asked about. */
export interface LandingPackage {
  key: string;
  version: string;
  manifest: AddOnManifest;
}

/** A landing pages add-on as staff reach it: installed with its pages table, whether or not it is on or vouched for. */
export interface LandingAddOn {
  addOn: string;
  installId: string;
  name: string;
  version: string;
  connectionId: string;
  manifest: AddOnManifest;
  block: AddOnLanding;
  /** The pages table's id, and its key column. */
  pagesTable: string;
  pk: string;
  /** Switched on for at least one place it is attached to. */
  on: boolean;
}

/** One page row, read whole, for staff and for a preview. */
export interface PageRow {
  key: string;
  slug: unknown;
  state: unknown;
  language: unknown;
  /** The column values as stored: an object, or its text on SQLite. */
  draft: unknown;
  published: unknown;
}

export interface LandingCatalogDeps {
  meta: MetaDb;
  /** What is installed where, read fresh (`keepAddOnInstalls`). */
  installs: () => Promise<AddOnInstalls>;
  /** The data handle of a connection (`ConnectionManager.data`). */
  data: (connectionId: string) => Promise<Pick<DataHandle, 'db'>>;
  /** Whether a package that declares landing pages may serve them: the same trust the sandboxed deciders need. */
  vouched: (pkg: LandingPackage) => boolean | Promise<boolean>;
  now?: () => number;
}

/** The primary-key column of one of the add-on's own tables, by the manifest. */
function primaryKeyOf(manifest: AddOnManifest, ref: string): string | null {
  const table = (manifest.requiredSchema?.tables ?? []).find((candidate) => candidate.ref === ref);
  return table?.columns.find((column) => column.role === 'pk')?.ref ?? null;
}

/** A row key as text, or null for a value that is no key. */
function keyText(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' ? String(value) : null;
}

/** The page vocabulary's language tag as a page may hold one: a BCP 47 tag of letters, digits and dashes, else null. */
export function pageLanguageOf(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(value) ? value : null;
}

export function createLandingCatalog(deps: LandingCatalogDeps) {
  const now = deps.now ?? Date.now;
  const cache = new Map<string, { at: number; lookup: Promise<PageLookup> }>();

  /** Every installed add-on that declares landing pages, with its pages table: oldest install first. `only` narrows to one key (and one install). */
  async function landingAddOns(only?: { addOn: string; installId?: string | undefined }): Promise<LandingAddOn[]> {
    let query = deps.meta.db.selectFrom('adminium_manifests').select(['id', 'manifestKey', 'connectionId']).where('kind', '=', 'add-on').where('status', '=', 'installed');
    if (only !== undefined) query = query.where('manifestKey', '=', only.addOn);
    if (only?.installId !== undefined) query = query.where('id', '=', only.installId);
    const rows = await query.orderBy('installedAt').orderBy('manifestKey').execute();
    const installs = await deps.installs();
    const out: LandingAddOn[] = [];
    for (const row of rows) {
      if (row.connectionId === null) continue;
      const installed = installs.installed(row.connectionId, row.manifestKey);
      const block = installed === null ? null : landingOf(installed.manifest);
      if (installed === null || installed.status !== 'installed' || block === null) continue;
      const pagesTable = installs.tableOf(row.connectionId, row.manifestKey, block.pages);
      const pk = primaryKeyOf(installed.manifest, block.pages);
      if (pagesTable === null || pk === null) continue;
      out.push({
        addOn: row.manifestKey,
        installId: row.id,
        name: typeof installed.manifest.name === 'string' ? installed.manifest.name : row.manifestKey,
        version: installed.version,
        connectionId: row.connectionId,
        manifest: installed.manifest,
        block,
        pagesTable,
        pk,
        on: [...installed.hosts.values()].some(Boolean),
      });
    }
    return out;
  }

  /**
   * A row of `addOn`'s pages table, read whole: by its slug (the live one
   * first: a draft may share a live page's slug until it goes live, which the
   * seal refuses), and also by its key when `key` is given. Null when none, or
   * the table cannot be read.
   */
  async function readRow(addOn: LandingAddOn, by: { slug?: string; key?: string }): Promise<PageRow | null> {
    let row: Record<string, unknown> | undefined;
    try {
      const { db } = await deps.data(addOn.connectionId);
      let query = db.selectFrom(addOn.pagesTable).select([db.dynamic.ref(addOn.pk), db.dynamic.ref('slug'), db.dynamic.ref('state'), db.dynamic.ref('language'), db.dynamic.ref('draft'), db.dynamic.ref('published')] as never);
      if (by.slug !== undefined) query = query.where(db.dynamic.ref('slug'), '=', by.slug);
      if (by.key !== undefined) query = query.where(db.dynamic.ref(addOn.pk), '=', by.key);
      const rows = (await query.limit(20).execute()) as Record<string, unknown>[];
      row = rows.find((one) => one['state'] === 'live') ?? rows[0];
    } catch {
      // A connection switched off, a table that cannot be read, a key of the wrong type: as a page that is not there.
      return null;
    }
    if (row === undefined) return null;
    const key = keyText(row[addOn.pk]);
    if (key === null) return null;
    return { key, slug: row['slug'], state: row['state'], language: row['language'], draft: row['draft'], published: row['published'] };
  }

  async function lookUp(slug: string): Promise<PageLookup> {
    const unavailable: PageLookup = { state: 'unavailable' };
    // A slug the rule refuses, a reserved word among them, is never a page: the seal refuses it too.
    if (!isLandingSlug(slug)) return unavailable;
    for (const addOn of await landingAddOns()) {
      const row = await readRow(addOn, { slug });
      if (row === null) continue;
      // The first add-on that holds the slug answers for it, whatever its row says.
      if (!addOn.on || !(await deps.vouched({ key: addOn.addOn, version: addOn.version, manifest: addOn.manifest }))) return unavailable;
      if (!(await privacyNoticeReady(deps.meta))) return unavailable;
      if (row.state !== 'live') return unavailable;
      const language = pageLanguageOf(row.language);
      if (language === null) return unavailable;
      // Read whole at every draw: a copy written past the seal (by hand, by an older engine) that does not parse draws nothing.
      const parsed = parseLandingPage(jsonOf(row.published) ?? null);
      if (!parsed.ok || hasMiloMarks(parsed.page)) return unavailable;
      return { state: 'live', live: { key: row.key, slug, addOn: addOn.addOn, installId: addOn.installId, connectionId: addOn.connectionId, pagesTable: addOn.pagesTable, pk: addOn.pk, language, page: parsed.page } };
    }
    return unavailable;
  }

  /** The page a slug names, as strangers are served it now (kept a few seconds). */
  async function find(slug: string): Promise<PageLookup> {
    const at = now();
    const kept = cache.get(slug);
    if (kept !== undefined && at - kept.at < PAGE_CACHE_MS) return kept.lookup;
    if (cache.size >= CACHE_MAX) {
      for (const [key, entry] of cache) if (at - entry.at >= PAGE_CACHE_MS) cache.delete(key);
      if (cache.size >= CACHE_MAX) cache.clear();
    }
    const lookup = lookUp(slug);
    cache.set(slug, { at, lookup });
    // A read that failed is not kept: the next request asks again.
    lookup.catch(() => cache.delete(slug));
    return lookup;
  }

  /**
   * A page's row by its slug, whatever its state, with the add-on that holds
   * it, for its preview: not served to strangers (the preview asks the
   * reader's grant on the pages table first). `key` picks the editor's own
   * row where two share the slug. No cache: staff ask as they type.
   */
  async function draft(slug: string, key?: string): Promise<{ addOn: LandingAddOn; row: PageRow } | null> {
    if (!isLandingSlug(slug) || (key !== undefined && !ROW_KEY.test(key))) return null;
    for (const addOn of await landingAddOns()) {
      const row = await readRow(addOn, { slug, ...(key === undefined ? {} : { key }) });
      if (row !== null) return { addOn, row };
    }
    return null;
  }

  /** The live pages, for a screen that lists their addresses (no cache: staff ask rarely). */
  async function liveSlugs(): Promise<{ addOn: string; slug: string; key: string }[]> {
    const out: { addOn: string; slug: string; key: string }[] = [];
    for (const addOn of await landingAddOns()) {
      if (!addOn.on) continue;
      for (const page of await livePagesOf(addOn)) out.push({ addOn: addOn.addOn, ...page });
    }
    return out;
  }

  /** The live pages of one add-on, by key and slug: what a link to another page of it resolves to. */
  async function livePagesOf(addOn: Pick<LandingAddOn, 'connectionId' | 'pagesTable' | 'pk'>): Promise<{ key: string; slug: string }[]> {
    try {
      const { db } = await deps.data(addOn.connectionId);
      const rows = (await db
        .selectFrom(addOn.pagesTable)
        .select([db.dynamic.ref(addOn.pk), db.dynamic.ref('slug')] as never)
        .where(db.dynamic.ref('state'), '=', 'live')
        .limit(LINKED_PAGES_MAX)
        .execute()) as Record<string, unknown>[];
      const out: { key: string; slug: string }[] = [];
      // Only a slug the door serves: a reserved word is no page's address.
      for (const row of rows) {
        const key = keyText(row[addOn.pk]);
        if (key !== null && isLandingSlug(row['slug'])) out.push({ key, slug: row['slug'] });
      }
      return out;
    } catch {
      return [];
    }
  }

  /**
   * A landing pages add-on by its key, for staff: installed with its pages
   * table, whether or not it is switched on or vouched for; on the install
   * `installId` names, when given. Never cached.
   */
  async function forStaff(addOn: string, installId?: string): Promise<LandingAddOn | null> {
    if (!ADD_ON_KEY.test(addOn)) return null;
    return (await landingAddOns({ addOn, installId }))[0] ?? null;
  }

  /** One page of a staff add-on, by its key; null when there is none. */
  async function pageByKey(addOn: LandingAddOn, key: string): Promise<PageRow | null> {
    if (!ROW_KEY.test(key)) return null;
    return readRow(addOn, { key });
  }

  return { find, draft, liveSlugs, livePagesOf, forStaff, pageByKey, forget: (slug?: string) => (slug === undefined ? cache.clear() : cache.delete(slug)) };
}

export type LandingCatalog = ReturnType<typeof createLandingCatalog>;
