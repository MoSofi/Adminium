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
 */
import { checkWebsiteLines, WEBSITES_MAX, type WebsiteLine } from '@adminium/add-on-contracts/forms/websites';
import { settingsRepo, type MetaDb } from '@adminium/meta';

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
  const before = await readWebsites(meta);
  const checked = checkWebsiteLines(lines, { self: await selfOrigin(meta), listed: before.map((site) => site.origin) });
  const tooMany = before.length + checked.length > WEBSITES_MAX;
  if (lines.length === 0 || tooMany || checked.some((line) => line.code !== 'ok')) return { ok: false, lines: checked, tooMany };
  const added = checked.map((line) => line.origin!);
  const websites = [...before, ...added.map((origin) => ({ origin, addedBy: by.userId, addedAt: by.at }))];
  await settingsRepo(meta).set('publicPages.websites', websites, { updatedBy: by.userId, at: by.at });
  forgetListedWebsites(meta);
  return { ok: true, added, websites };
}

/** Take one website off the list; false when it was not on it. */
export async function removeWebsite(meta: MetaDb, origin: string, by: { userId: string | null; at: number }): Promise<{ removed: boolean; websites: ListedWebsite[] }> {
  const before = await readWebsites(meta);
  const websites = before.filter((site) => site.origin !== origin);
  if (websites.length === before.length) return { removed: false, websites: before };
  await settingsRepo(meta).set('publicPages.websites', websites, { updatedBy: by.userId, at: by.at });
  forgetListedWebsites(meta);
  return { removed: true, websites };
}
