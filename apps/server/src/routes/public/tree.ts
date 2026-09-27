// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The public door's half of a create with its child rows: what it checks of
 * the request before anything is read, how it names a refused row, the retry
 * key it keeps, and what a reply shows. The write itself is the write
 * service's (`writes.createTree`); the checks run inside it are
 * `public-api/tree-checks.ts`.
 */
import { createHmac, hkdfSync } from 'node:crypto';

import type { Dialect, LogicalType } from '@adminium/engine';

import { tableRulesFor } from '../../crud/column-rules.js';
import type { ResolvedTable, SnapshotView } from '../../crud/identifiers.js';
import type { Row } from '../../crud/mask.js';
import type { TreePath } from '../../crud/write-tree.js';
import { sameValue } from '../../crud/write-values.js';
import { resolveDefaults } from '../../public-api/generate.js';
import type { ScopeChild } from '../../public-api/scope.js';
import type { PublicTreeChildren } from './schema.js';

/** The most rows one create may carry below it, in all. */
export const TREE_MAX_ROWS = 200;

/**
 * A retry key as a browser mints one: 22 to 64 characters of base64url —
 * at least 128 bits. It is a bearer secret for the rows it made, so it is
 * never stored as sent (see {@link clientKeyHash}).
 */
export const CLIENT_KEY_FORMAT = /^[A-Za-z0-9_-]{22,64}$/;

/** The key a retry key is hashed under: its own derivation from the server's secret. */
export function clientKeySecret(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'adminium-public-client-key-v1', 'client-key', 32));
}

/**
 * What the retry-key column keeps: a keyed hash of the key, per connection
 * and table — 43 characters. A reader of the table (staff, an export, an
 * email's variables) learns nothing a retry could be made with.
 */
export function clientKeyHash(secret: Buffer, connectionId: string, table: string, value: string): string {
  return createHmac('sha256', secret).update(JSON.stringify([connectionId, table, value])).digest('base64url');
}

/** Where a refused row sits: the deepest list and index, and the whole path; nothing for the root. */
export function placeOf(at: TreePath): { child?: string; index?: number; path?: (string | number)[] } {
  if (at.length < 2) return {};
  const child = at[at.length - 2];
  const index = at[at.length - 1];
  return typeof child === 'string' && typeof index === 'number' ? { child, index, path: [...at] } : {};
}

/** A refusal of the request's shape, before anything is read: the list and why. */
export interface ShapeRefusal {
  child: string;
  reason: 'not-offered' | 'too-many' | 'too-few';
  /** For a list below a row: where that list sits (`['order_items', 3, 'order_item_modifiers']`). */
  path?: (string | number)[];
}

/**
 * The request's lists against the entry's: every list named is one it
 * declares, each between its least and its most per row it hangs from, rows
 * below a row only where declared, two hundred rows in all.
 */
export function treeShape(children: ReadonlyMap<string, ScopeChild>, sent: PublicTreeChildren | undefined): ShapeRefusal | null {
  let total = 0;
  const judge = (declared: Readonly<Record<string, Omit<ScopeChild, 'children'>>>, lists: Readonly<Record<string, readonly unknown[]>>): ShapeRefusal | null => {
    for (const name of Object.keys(lists)) if (declared[name] === undefined) return { child: name, reason: 'not-offered' };
    for (const [name, child] of Object.entries(declared)) {
      const rows = lists[name] ?? [];
      total += rows.length;
      if (rows.length > child.max) return { child: name, reason: 'too-many' };
      if (rows.length < (child.min ?? 0)) return { child: name, reason: 'too-few' };
    }
    return null;
  };
  const top = judge(Object.fromEntries(children), sent ?? {});
  if (top !== null) return top;
  for (const [name, rows] of Object.entries(sent ?? {})) {
    const child = children.get(name)!;
    for (const [index, row] of rows.entries()) {
      const below = judge(child.children ?? {}, row.children ?? {});
      if (below !== null) return { ...below, path: [name, index, below.child] };
    }
  }
  const first = [...children.keys()][0];
  if (total > TREE_MAX_ROWS) return { child: first ?? '', reason: 'too-many' };
  return null;
}

/**
 * A child row's values as the entry lets a guest write them: only its
 * writable columns, each within its listed values, then the entry's
 * defaults (which a guest cannot change). Null when a column is not the
 * guest's to write.
 */
export function childValues(
  child: Pick<ScopeChild, 'writable' | 'writableValues' | 'defaults'>,
  values: Readonly<Record<string, unknown>>,
  dialect: Dialect,
  columns: ReadonlyMap<string, { readonly logicalType: LogicalType }>,
): Row | null {
  const writable = new Set(child.writable);
  for (const [column, value] of Object.entries(values)) {
    if (!writable.has(column)) return null;
    const allowed = child.writableValues?.[column];
    if (allowed !== undefined && !allowed.some((listed) => sameValue(listed, value))) return null;
  }
  return { ...values, ...resolveDefaults(child.defaults ?? {}, dialect, new Date(), columns) };
}

/**
 * The columns a dry run never shows: keys and running numbers (the next
 * number is a count of sales), codes, and the retry key — only figures.
 */
export function hiddenInQuote(view: SnapshotView, table: ResolvedTable, also: readonly (string | null | undefined)[] = []): Set<string> {
  const rules = tableRulesFor({ view, table });
  return new Set([
    ...table.primaryKey,
    ...(rules?.numbered ?? []),
    ...(rules?.sequences ?? []).map((sequence) => sequence.column),
    ...(rules?.codes ?? []).map((code) => code.column),
    ...also.filter((column): column is string => typeof column === 'string'),
  ]);
}

/**
 * What a quote fills in for a guest's text the price does not read — a name,
 * an address, a note not typed yet — so a page can price before any details
 * exist. Only a column the entry requires, or the table cannot store empty,
 * that no formula, total or copy reads; the reply shows it empty.
 */
export function quotePlaceholders(view: SnapshotView, table: ResolvedTable, writable: Iterable<string>, requires: readonly string[], values: Row): Row {
  const rules = tableRulesFor({ view, table });
  const priced = new Set<string>([
    ...(rules?.formulas ?? []).flatMap((formula) => formula.reads),
    ...(rules?.rollupsInto ?? []).flatMap((rollup) => [rollup.via, rollup.sum, rollup.times, rollup.unlessSet, rollup.where?.column].filter((c): c is string => typeof c === 'string')),
    ...(rules?.copies ?? []).map((copy) => copy.via),
  ]);
  const needed = new Set([...requires, ...(rules?.checks ?? []).filter((check) => check.requiredByRule === true).map((check) => check.column)]);
  const out: Row = {};
  for (const column of writable) {
    const resolved = table.columns.get(column);
    const value = values[column];
    const empty = value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
    if (resolved === undefined || !resolved.textish || !empty || priced.has(column) || !needed.has(column)) continue;
    const check = rules?.checks.find((c) => c.column === column);
    const format = check?.validation?.format;
    const most = check?.validation?.maxLength;
    const text = format === 'email' ? 'quote@example.com' : format === 'url' ? 'https://example.com' : format === 'phone' ? '+15550100' : 'Quote';
    out[column] = most !== undefined && text.length > most ? text.slice(0, Math.max(1, most)) : text;
  }
  return out;
}

/** The places a money column keeps: its own scale, a formula's, else two (a currency's). */
export function placesOfColumn(view: SnapshotView, table: ResolvedTable, column: string): number {
  const rules = tableRulesFor({ view, table });
  const scale = rules?.scales?.find((entry) => entry.column === column)?.scale ?? rules?.formulas?.find((formula) => formula.column === column)?.scale;
  return typeof scale === 'number' ? scale : 2;
}
