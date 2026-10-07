// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A MONEY CODE, AND A DOCUMENT THAT PRINTS ONE.
 *
 * A money code is a code that is worth something to whoever holds it — a
 * gift card's, a voucher's: a code column of which another column of the same
 * table keeps the last four (`codeLast4.of`), because the rest is not shown
 * again. A money-code document is one that prints such a column — from its
 * own row, from a row it links to, from the rows listed under it, or as the
 * number it is filed by. It is drawn when asked and kept nowhere: no register
 * row, no stored bytes — the register would otherwise hold every code it
 * ever printed, for ever.
 *
 * Read from the tables as they stand (the rules an install or an owner
 * stored on them): what a column is, is said in one place.
 */
import type { DocumentProfile } from '@adminium/meta';

import type { EffectiveTable } from '../connections/effective-schema.js';
import type { SnapshotView } from '../crud/identifiers.js';
import { mappedColumns, type ProfileMapping } from './subject.js';

/** The money codes of one table: each code column another column keeps the last four of. */
export function moneyCodeColumns(table: Pick<EffectiveTable, 'columns'> | undefined): string[] {
  if (table === undefined) return [];
  const codes = new Set(table.columns.filter((column) => column.code !== undefined).map((column) => column.name));
  const out = new Set<string>();
  for (const column of table.columns) {
    const of = column.codeLast4?.of;
    if (of !== undefined && codes.has(of)) out.add(of);
  }
  return [...out];
}

/** The table a link column of `tableId` points at, as the document pipeline reads it. */
function linkedTable(view: SnapshotView, tableId: string, column: string): string | undefined {
  const best = view.model.relations
    .filter((relation) => relation.through === null && relation.from.tableId === tableId && relation.from.columns.length === 1 && relation.from.columns[0] === column && relation.to.columns.length === 1)
    .sort((a, b) => b.confidence - a.confidence)[0];
  if (best !== undefined) return best.to.tableId;
  return view.model.tables.find((table) => table.id === tableId)?.columns.find((candidate) => candidate.name === column)?.references?.tableId;
}

/**
 * The money code a profile prints, or null — whichever way the mapping
 * reaches it: a slot of its own row, a column of a linked row, a column of the
 * rows listed under it (or the names below those), or the column its
 * documents are numbered by. Read from the mapping, never from the kind's name.
 */
export function moneyCodeOf(view: SnapshotView, profile: Pick<DocumentProfile, 'table' | 'mapping' | 'options'>): { table: string; column: string } | null {
  const printed = mappedColumns(profile.mapping as ProfileMapping, profile.table, (ref) => linkedTable(view, profile.table, ref));
  const numbered = (profile.options as { numberColumn?: unknown } | null)?.numberColumn;
  if (typeof numbered === 'string' && numbered !== '') printed.push({ table: profile.table, column: numbered });
  const codes = new Map<string, Set<string>>();
  for (const one of printed) {
    let known = codes.get(one.table);
    if (known === undefined) codes.set(one.table, (known = new Set(moneyCodeColumns(view.model.tables.find((table) => table.id === one.table)))));
    if (known.has(one.column)) return one;
  }
  return null;
}
