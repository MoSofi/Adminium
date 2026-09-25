// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The records page's search, as the router validates it — apart from
 * `linkFilters.ts` on purpose: the router is in the entry chunk and needs only
 * this, while the rest of the link-filter machinery (its query, its data
 * access) belongs to the lazily loaded records template.
 */

/** The search-param prefix a filter piece rides under (`?f.<column>=<op>:<value>`). */
export const LINK_FILTER_PREFIX = 'f.';

/** The records page's search: every key kept, the `f.` ones read as text. */
export type PageSearch = Record<string, unknown>;

/**
 * `/p/$slug`'s search validator. Every key passes through untouched (an app's
 * own page may read its own), and a filter piece is kept only as text or a
 * list of text: the router's parser reads `?f.x=5` as a number and `?f.x=true`
 * as a boolean, which are not pieces the grammar has — they are spelled back
 * as text so the server can say what it did with them.
 */
export function validatePageSearch(search: Record<string, unknown>): PageSearch {
  const out: PageSearch = {};
  for (const [key, value] of Object.entries(search)) {
    if (!key.startsWith(LINK_FILTER_PREFIX)) {
      out[key] = value;
      continue;
    }
    const spelled = Array.isArray(value) ? value.map(spell).filter((item): item is string => item !== null) : spell(value);
    if (spelled !== null && !(Array.isArray(spelled) && spelled.length === 0)) out[key] = spelled;
  }
  return out;
}

/** A piece's value as text; null for what no piece can be. */
export function spell(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}
