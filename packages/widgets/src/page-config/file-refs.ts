// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reading and writing a file column's stored value,
 * browser-side.
 *
 * A `multiple` column stores a JSON array of references in a `text` column:
 * `["file_01J…","file_01K…"]`. This is the half of that grammar the RENDERER
 * needs — split a stored value into the references it names, and join a list
 * back into a value to submit.
 *
 * ─── Why this is not imported from the server ──────────────────────────────
 *
 * `apps/server/src/files/refs.ts` owns the authoritative grammar, and this
 * package may not import it (the matrix: a browser chunk must not pull server
 * code). It is also a DIFFERENT job. The server CLASSIFIES each entry — is it
 * our id, our key, or somebody else's link — because it has to decide what to
 * attach and what to leave alone. Nothing here can classify anything: the
 * browser has no destination list and no file table. It has strings, and it
 * hands them to the host's `resolve` adapter, which answers `null` for every
 * value that is not ours.
 *
 * So this file is deliberately small and deliberately dumb. Change it together
 * with the server's, and keep the tolerance identical: the two disagreeing
 * about what a value NAMES is the failure mode, and it is silent.
 *
 * ─── Tolerance, which is the whole contract ────────────────────────────────
 *
 * A value that is not a JSON array reads as ONE reference. That is what a
 * column holds before it was made `multiple`, and what a foreign app writes
 * when it puts a plain URL there — neither is an error, and neither may be
 * dropped. Malformed JSON is likewise a string somebody put in their own
 * column: it names itself, and nothing here throws.
 */

/**
 * The references a stored column value names, in order.
 *
 * Empty for `null`, `undefined`, `''` and `'[]'` — every spelling of "no
 * files". Duplicates are preserved: the value is the customer's and this is
 * not the place to decide two identical entries were a mistake.
 */
export function parseRefList(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (trimmed === '') return [];

  if (trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Not JSON after all — one reference, which is what the string is.
      return [trimmed];
    }
    if (!Array.isArray(parsed)) return [trimmed];
    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
  }

  return [trimmed];
}

/**
 * The value to submit for a `multiple` column.
 *
 * `null` for an empty list, never `'[]'`: absence is what a column that never
 * held a file carries, and removing the last attachment should land the row in
 * that same state rather than in a second one that means the same thing. The
 * server's `formatRefList` makes the same choice for the same reason.
 */
export function formatRefList(refs: readonly string[]): string | null {
  return refs.length === 0 ? null : JSON.stringify(refs);
}
