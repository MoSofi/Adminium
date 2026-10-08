// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT AN ORDER TOOK OFF, AS A LIST PRINTS IT — pure.
 *
 * An add-on keeps one row for each thing applied to each line: a code that
 * took a little off five lines is five rows, each with its name in every
 * language it was kept in. A screen is told them grouped (`replies.ts`). A
 * list drawn outside a screen — the rows of an email — reads the stored rows
 * themselves, so here they are put the same way: one row for each offer,
 * code or voucher, its amounts added, its name in the reader's language.
 *
 * The first row of each group is kept as it is, but for those two columns:
 * every other column a template names reads as that row's.
 */
import { ratioText, toRatio } from '@adminium/manifest';

import type { Row } from '../mask.js';
import { nameIn } from './replies.js';

/** Where an add-on says its applied rows keep each part (`addOn.adjuster.applied.columns`). */
export interface ListedColumns {
  offer: string;
  code: string;
  voucher: string;
  name: string;
  kind: string;
  amount: string;
}

/** The columns of a declaration, when it names every one a list needs. */
export function listedColumnsOf(declared: unknown): ListedColumns | null {
  const columns = (declared as { columns?: Record<string, unknown> } | null | undefined)?.columns;
  if (columns === null || typeof columns !== 'object') return null;
  const names = ['offer', 'code', 'voucher', 'name', 'kind', 'amount'] as const;
  if (names.some((name) => typeof columns[name] !== 'string')) return null;
  return Object.fromEntries(names.map((name) => [name, columns[name] as string])) as unknown as ListedColumns;
}

/** A stored name: every language it was kept in (an engine that keeps json as text hands the text back), or the one name. */
function storedName(stored: unknown): string | Record<string, string> {
  if (stored !== null && typeof stored === 'object' && !Array.isArray(stored)) return Object.fromEntries(Object.entries(stored as Record<string, unknown>).map(([locale, name]) => [locale, String(name ?? '')]));
  if (typeof stored !== 'string') return '';
  if (stored.startsWith('{') || stored.startsWith('"')) {
    try {
      return storedName(JSON.parse(stored));
    } catch {
      return stored;
    }
  }
  return stored;
}

const decimals = (value: unknown): number => {
  const text = String(value ?? '');
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
};

/** The stored rows of one order, oldest first, as a list prints them. */
export function listedReductions(rows: readonly Row[], columns: ListedColumns, locale: string): Row[] {
  const groups = new Map<string, { first: Row; sum: { n: bigint; d: bigint }; places: number }>();
  for (const row of rows) {
    const id = JSON.stringify([String(row[columns.kind] ?? ''), row[columns.offer] ?? null, row[columns.code] ?? null, row[columns.voucher] ?? null].map((part) => (part === null ? null : String(part))));
    const amount = toRatio(row[columns.amount]) ?? { n: 0n, d: 1n };
    const group = groups.get(id);
    if (group === undefined) groups.set(id, { first: row, sum: amount, places: decimals(row[columns.amount]) });
    else {
      group.sum = { n: group.sum.n * amount.d + amount.n * group.sum.d, d: group.sum.d * amount.d };
      group.places = Math.max(group.places, decimals(row[columns.amount]));
    }
  }
  return [...groups.values()].map(({ first, sum, places }) => ({ ...first, [columns.name]: nameIn(storedName(first[columns.name]), locale), [columns.amount]: ratioText(sum, places) }));
}
