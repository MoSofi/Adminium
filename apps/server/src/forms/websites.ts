// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE WEBSITES THAT MAY SHOW A FORM IN A FRAME ("Your websites").
 *
 * The list feeds two things and nothing else: the `frame-ancestors` of a form
 * drawn in frame mode, and the origins the frame-mode page answers the
 * website loader's messages from. It never opens the public API and never
 * reaches the credentialed CORS list: the frame's own calls go to its own
 * host, same-origin.
 *
 * Kept in the meta settings (`publicPages.websites`), beside the privacy
 * notice: each entry an origin (`https://shop.example`, lower case, no path,
 * no default port), who listed it and when; at most fifty. The Privacy page
 * adds several at once, every line checked with the one check the page uses
 * as it is typed (`@adminium/add-on-contracts/forms/websites`), all or none.
 *
 * Read for every framed form, so it is kept for {@link WEBSITES_CACHE_MS}: one
 * cache per meta store, shared by every reader, and dropped by a save on this
 * server, so the Privacy page's change takes effect at once here and within
 * that time on any other server process. No restart, ever.
 *
 * An add or a remove reads the whole list and writes it back, so each runs in
 * one transaction that first locks the list's settings row (`FOR UPDATE` on
 * Postgres and MySQL; SQLite's writes already queue on its one connection).
 * Two staff members adding at the same moment then both keep their websites:
 * the second waits, reads the list with the first one's in it, and adds to it.
 */
import { checkWebsiteLine, checkWebsiteLines, WEBSITES_MAX, type WebsiteLine } from '@adminium/add-on-contracts/forms/websites';
import { readJsonFrom, settingsRepo, SETTINGS_REGISTRY, type MetaDb } from '@adminium/meta';

import { normalizePublicOrigin } from '../security/public-origin.js';

/** The listed websites' origins, as a page's policy names them. */
export type ListedWebsites = () => Promise<readonly string[]>;

/** One listed website, as kept. */
export interface ListedWebsite {
  origin: string;
  /** The staff member who listed it; null when they were not known. */
  addedBy: string | null;
  addedAt: number;
}

/** How long a read of the list is kept. */
export const WEBSITES_CACHE_MS = 5_000;

interface Cached {
  origins: readonly string[];
  until: number;
}

/** One cache per meta store: the forms door and the Privacy page's saves share it. */
const caches = new WeakMap<MetaDb, Cached>();

/** The list as kept, in the order it was listed. */
export async function readWebsites(meta: MetaDb): Promise<ListedWebsite[]> {
  return (await settingsRepo(meta).get('publicPages.websites')).map((site) => ({ ...site }));
}

/** The list kept for this install, read at most every few seconds. */
export function listedWebsitesOf(meta: MetaDb, now: () => number = Date.now): ListedWebsites {
  return async () => {
    const held = caches.get(meta);
    if (held !== undefined && now() < held.until) return held.origins;
    const origins = (await readWebsites(meta)).map((site) => site.origin);
    caches.set(meta, { origins, until: now() + WEBSITES_CACHE_MS });
    return origins;
  };
}

/** Drop the kept read, so the next one sees a save at once. */
export function forgetListedWebsites(meta: MetaDb): void {
  caches.delete(meta);
}

/** This server's own address, as the check compares it: null while none is set. */
async function selfOrigin(meta: MetaDb): Promise<string | null> {
  const stored = await settingsRepo(meta).get('system.publicOrigin');
  return typeof stored === 'string' ? normalizePublicOrigin(stored) : null;
}

const WEBSITES_KEY = 'publicPages.websites';

/**
 * Run a change to the list in one transaction, holding the list's settings
 * row locked from the read to the write, so a change made meanwhile by
 * another request is never written over. `change` answers the new list
 * (null to write nothing) and what to return.
 */
async function changeWebsites<T>(
  meta: MetaDb,
  by: { userId: string | null; at: number },
  change: (before: ListedWebsite[]) => Promise<{ websites: ListedWebsite[] | null; answer: T }>,
): Promise<T> {
  // A lock needs a row: the first change of an install writes the empty list first. Two
  // first changes race to insert it; the loser's insert fails on the key and it goes on.
  const exists = async () => (await meta.db.selectFrom('adminium_settings').select('key').where('key', '=', WEBSITES_KEY).executeTakeFirst()) !== undefined;
  if (!(await exists())) {
    try {
      await meta.db.insertInto('adminium_settings').values({ key: WEBSITES_KEY, value: JSON.stringify([]), updatedAt: by.at, updatedBy: by.userId }).execute();
    } catch (error) {
      if (!(await exists())) throw error;
    }
  }
  const answer = await meta.db.transaction().execute(async (trx) => {
    const tmeta: MetaDb = { db: trx, dialect: meta.dialect };
    // The locking read itself carries the value: on MySQL a plain read after it would see the
    // transaction's first snapshot, not the list another change has just committed.
    const read = trx.selectFrom('adminium_settings').select('value').where('key', '=', WEBSITES_KEY);
    const row = await (meta.dialect === 'sqlite' ? read : read.forUpdate()).executeTakeFirst();
    const before = row === undefined ? [] : SETTINGS_REGISTRY[WEBSITES_KEY].schema.parse(readJsonFrom(meta, row.value)).map((site) => ({ ...site }));
    const next = await change(before);
    if (next.websites !== null) await settingsRepo(tmeta).set(WEBSITES_KEY, next.websites, { updatedBy: by.userId, at: by.at });
    return next.answer;
  });
  forgetListedWebsites(meta);
  return answer;
}

/** What an add answers: the list after it, or each line with what is wrong with it (nothing was added). */
export type AddWebsites =
  | { ok: true; added: string[]; websites: ListedWebsite[] }
  | { ok: false; lines: WebsiteLine[]; tooMany: boolean };

/**
 * Add several websites at once, all or none: every line is checked in order
 * (one website per line, https, an address, no path, not this server, not
 * listed), and the list may not grow past fifty.
 */
export async function addWebsites(meta: MetaDb, lines: readonly string[], by: { userId: string | null; at: number }): Promise<AddWebsites> {
  const self = await selfOrigin(meta);
  return changeWebsites<AddWebsites>(meta, by, async (before) => {
    const checked = checkWebsiteLines(lines, { self, listed: before.map((site) => site.origin) });
    const tooMany = before.length + checked.length > WEBSITES_MAX;
    if (lines.length === 0 || tooMany || checked.some((line) => line.code !== 'ok')) return { websites: null, answer: { ok: false, lines: checked, tooMany } };
    const added = checked.map((line) => line.origin!);
    const websites = [...before, ...added.map((origin) => ({ origin, addedBy: by.userId, addedAt: by.at }))];
    return { websites, answer: { ok: true, added, websites } };
  });
}

/**
 * The origin a remove names, reduced the way an add reduces a line
 * (`https://Shop.example/` is `https://shop.example`); as given when it does
 * not read as a website on its own.
 */
function originToRemove(origin: string): string {
  const read = checkWebsiteLine(origin, { self: null, listed: [] });
  return read.code === 'ok' && read.origin !== null ? read.origin : origin.trim();
}

/** What a remove answers: whether it was listed, the origin it named once reduced, and the list after. */
export interface RemoveWebsite {
  removed: boolean;
  origin: string;
  websites: ListedWebsite[];
}

/** Take one website off the list; false when it was not on it. `origin` is the one taken off. */
export async function removeWebsite(
  meta: MetaDb,
  origin: string,
  by: { userId: string | null; at: number },
): Promise<RemoveWebsite> {
  const target = originToRemove(origin);
  // Nothing is listed until the list's row exists: no need to make it only to find nothing.
  const listed = await readWebsites(meta);
  if (listed.every((site) => site.origin !== target)) return { removed: false, origin: target, websites: listed };
  return changeWebsites<RemoveWebsite>(meta, by, async (before) => {
    const websites = before.filter((site) => site.origin !== target);
    if (websites.length === before.length) return { websites: null, answer: { removed: false, origin: target, websites: before } };
    return { websites, answer: { removed: true, origin: target, websites } };
  });
}
