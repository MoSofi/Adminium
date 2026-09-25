// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ONE way every table a manifest names — at any depth — becomes the real table.
 *
 * An app names its tables by their short refs (`invoices`, `lines`), and an
 * install may give them real names of its own (`studio_invoices`) and ids in
 * the snapshot (`main.studio_invoices`). A rule, a document's states, an
 * outbox and a public entry name tables everywhere inside them: a rollup's
 * child; the child tables a state locks or a move counts; the rows a
 * fingerprint covers; a setting's row; each producer's table and the row a
 * sent message changes; the parent a visitor's rows are seen with. Each
 * writer used to map the ones it knew of by hand, and a nested one it missed
 * was stored by its short name — a query of a table that does not exist.
 *
 * The manifest's vocabulary names a table in exactly three ways, and this
 * walker knows all three, so a field added later in any of those forms is
 * mapped without anyone remembering to:
 *
 *  - a `table` property holding a ref (a setting `{table, column}`, a
 *    producer's `onCreate.table`, `onSent.table`, `visibleWith.table`,
 *    `lockedWhenReferencedBy[].table`, `hashOf.children[].table`, …);
 *  - a `children` OBJECT keyed by table refs (a state's children, a move's
 *    `requires.children`); a `children` ARRAY is a list of `{table}` entries
 *    and is walked like any other;
 *  - a rollup's `from` — the one ref not called `table`, passed as `refKeys`
 *    by the caller that holds a rollup (`from` elsewhere is a column or a
 *    fill's source).
 *
 * And it says which refs did not resolve, so each writer can refuse or skip
 * by name instead of storing a table that is not there (the live-model check).
 */

type Map = (ref: string) => string | undefined;

export interface MappedRefs<T> {
  value: T;
  /** Refs the map had no real table for, in the order met. */
  missing: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `value` with every table ref replaced by `map(ref)`. A ref the map has no
 * answer for is kept as it was and listed in `missing`.
 *
 * @param refKeys The properties holding a ref, beside `table` (a rollup's `from`).
 */
export function mapTableRefs<T>(value: T, map: Map, opts: { refKeys?: readonly string[] } = {}): MappedRefs<T> {
  const keys = new Set(['table', ...(opts.refKeys ?? [])]);
  const missing: string[] = [];
  const real = (ref: string): string => {
    const found = map(ref);
    if (found === undefined || found === '') {
      if (!missing.includes(ref)) missing.push(ref);
      return ref;
    }
    return found;
  };
  const walk = (node: unknown, top: boolean): unknown => {
    if (Array.isArray(node)) return node.map((item) => walk(item, false));
    if (!isRecord(node)) return node;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node)) {
      if (keys.has(key) && typeof child === 'string' && (key === 'table' || top)) out[key] = real(child);
      else if (key === 'children' && isRecord(child)) {
        out[key] = Object.fromEntries(Object.entries(child).map(([ref, rule]) => [real(ref), walk(rule, false)]));
      } else out[key] = walk(child, false);
    }
    return out;
  };
  return { value: walk(value, true) as T, missing };
}

/** Every table ref in `value`, the same three ways (no mapping). */
export function tableRefsIn(value: unknown, opts: { refKeys?: readonly string[] } = {}): string[] {
  const seen: string[] = [];
  mapTableRefs(value, (ref) => {
    if (!seen.includes(ref)) seen.push(ref);
    return ref;
  }, opts);
  return seen;
}
