// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The stored reference.
 *
 * When a file is bound to a column, SOMETHING goes in that column. The owner
 * asked for "the link/url/id", and each of the three has a real constituency:
 *
 *   url  a human reading the table, and any app that can open a link
 *   id   apps that call Adminium's API; survives every destination move
 *   key  apps with their own bucket credentials, which presign it themselves
 *
 * The one wrong move is to pick one silently, so the shape is a per-column
 * choice with `url` as the default (D31).
 *
 * PARSING IS DELIBERATELY GENEROUS AND WRITING IS DELIBERATELY NOT. A column
 * may already hold URLs a foreign app wrote, or a mix of shapes from before
 * the column was configured, so the resolver accepts ALL THREE plus "anything
 * else, which is an external link and is left alone". Writing uses exactly the
 * configured shape. That asymmetry is what lets a column be adopted without a
 * migration and abandoned without one.
 *
 * NOTHING HERE TOUCHES THE DATABASE. `parseRef` classifies a string; turning
 * `{kind:'key'}` into a row is the store's job, because only it knows the
 * column's destination. Keeping the parser pure is what makes the twelve
 * foreign-value cases cheap to test.
 */

import { isId } from '@adminium/meta';

/** The three shapes a column may be configured to store (`file.ref`). */
export const REF_SHAPES = ['url', 'id', 'key'] as const;
export type RefShape = (typeof REF_SHAPES)[number];

/** The default, per D31. A column that says nothing means this. */
export const DEFAULT_REF_SHAPE: RefShape = 'url';

/**
 * Minimum column width each shape needs. The ColumnManager refuses a shape the
 * column cannot hold and says why (D7) — a `varchar(40)` cannot carry a URL,
 * and finding that out at save time is a data-loss bug on some engines and a
 * silent truncation on others.
 */
export const REF_MIN_WIDTH: Readonly<Record<RefShape, number>> = {
  // `file_` + 26 Crockford characters.
  id: 31,
  // A dated key with a prefix and an 80-char name part.
  key: 160,
  // An origin plus `/api/v1/files/<id>/content`, or a CDN base plus a key.
  url: 200,
};

export type ParsedRef =
  | { kind: 'id'; id: string }
  | { kind: 'key'; key: string; publicBaseUrl?: string }
  | { kind: 'external'; href: string };

/** The path shape every Adminium content URL has, whatever the origin. */
const CONTENT_PATH = /\/api\/v1\/files\/(file_[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26})\/content\/?$/;

/**
 * A destination this parser may recognise a public URL from. Only the enabled
 * ones are passed in: a disabled destination's base should classify as an
 * external link, because Adminium is no longer claiming to serve it.
 */
export interface RefDestination {
  id: string;
  publicBaseUrl?: string | null | undefined;
}

/** Trailing-slash-insensitive prefix test that will not match a sibling path. */
function baseMatches(value: string, base: string): string | null {
  const normalized = base.endsWith('/') ? base : `${base}/`;
  return value.startsWith(normalized) ? value.slice(normalized.length) : null;
}

/**
 * Classify a stored value.
 *
 * Order matters: a bare id is checked before anything URL-shaped because it is
 * unambiguous, and a public base is checked before the "external" fallback
 * because a CDN URL under a configured base IS one of ours.
 */
export function parseRef(value: string, destinations: readonly RefDestination[] = []): ParsedRef | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (isId(trimmed, 'file')) return { kind: 'id', id: trimmed };

  // An Adminium content URL from ANY origin: an instance that changed its
  // hostname, or a value written through a reverse proxy under another name,
  // still names a file this server can serve.
  const asContentUrl = CONTENT_PATH.exec(stripQuery(trimmed));
  if (asContentUrl !== null) return { kind: 'id', id: asContentUrl[1] as string };

  for (const destination of destinations) {
    const base = destination.publicBaseUrl;
    if (base === null || base === undefined || base === '') continue;
    const key = baseMatches(stripQuery(trimmed), base);
    if (key !== null && key.length > 0) return { kind: 'key', key, publicBaseUrl: base };
  }

  // A bare key: no scheme, no leading slash, at least one separator. This is
  // the shape a `key`-configured column stores, and it is checked LAST because
  // it is the loosest — anything with a scheme has already been handled.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !trimmed.startsWith('/') && trimmed.includes('/')) {
    return { kind: 'key', key: trimmed };
  }

  return { kind: 'external', href: trimmed };
}

function stripQuery(value: string): string {
  const cut = value.search(/[?#]/);
  return cut < 0 ? value : value.slice(0, cut);
}

export interface RefTarget {
  id: string;
  storageKey: string;
  /** The destination's public base, when it has one and the shape is `url`. */
  publicBaseUrl?: string | null | undefined;
}

/**
 * Mint the value to store in the user's column.
 *
 * `origin` is the instance's public origin, the one email links use
 * (`security/public-origin.ts`), so a `url` reference names this instance. A
 * destination with a `publicBaseUrl` wins over the instance origin, because
 * that is the whole point of configuring one: the link should work without
 * Adminium in the path.
 */
/**
 * Classify a column value that may hold MANY references.
 *
 * A `multiple` column stores a JSON array of references in the column's own
 * shape — `["file_01J…","file_01K…"]` — and a `text` column is what holds it,
 * so that every reader that already handles this column (the grid, the form,
 * a foreign app, a `SELECT`) keeps seeing a string.
 *
 * TOLERANT IN BOTH DIRECTIONS, for the same reason {@link parseRef} is:
 *
 *   - a value that is not a JSON array is read as ONE reference. That is what
 *     a column holds before it was made `multiple`, and what a foreign app
 *     writes when it puts a plain URL there.
 *   - an array element that is not one of ours stays `external` and is
 *     returned as such, so the reconciler passes over it exactly as it always
 *     has rather than trashing a link somebody else owns.
 *   - malformed JSON is not an error. `"[not json"` is a string in the
 *     customer's own column, and this function's job is to say what it names,
 *     not to judge it. It names nothing of ours.
 *
 * Never throws. The caller is a post-commit hook or a read path, and neither
 * has anywhere useful to put an exception.
 */
export function parseRefList(
  value: unknown,
  destinations: readonly RefDestination[] = [],
): ParsedRef[] {
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (trimmed.length === 0) return [];

  if (trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Not JSON after all — fall through and treat the whole string as one
      // value, which is what it is.
      const single = parseRef(trimmed, destinations);
      return single === null ? [] : [single];
    }
    if (!Array.isArray(parsed)) {
      const single = parseRef(trimmed, destinations);
      return single === null ? [] : [single];
    }
    const out: ParsedRef[] = [];
    for (const entry of parsed) {
      if (typeof entry !== 'string') continue;
      const ref = parseRef(entry, destinations);
      if (ref !== null) out.push(ref);
    }
    return out;
  }

  const single = parseRef(trimmed, destinations);
  return single === null ? [] : [single];
}

/**
 * The value to store in a `multiple` column.
 *
 * `null` for an empty list, never `"[]"`: absence is what a column that has
 * never held a file carries, and a form that removes the last attachment
 * should leave the row in that same state rather than in a second one that
 * means the same thing.
 */
export function formatRefList(refs: readonly string[]): string | null {
  return refs.length === 0 ? null : JSON.stringify(refs);
}

export function formatRef(shape: RefShape, target: RefTarget, origin: string): string {
  switch (shape) {
    case 'id':
      return target.id;
    case 'key':
      return target.storageKey;
    case 'url': {
      const base = target.publicBaseUrl;
      if (base !== null && base !== undefined && base !== '') {
        return `${base.replace(/\/+$/, '')}/${target.storageKey}`;
      }
      return `${origin.replace(/\/+$/, '')}/api/v1/files/${target.id}/content`;
    }
  }
}
