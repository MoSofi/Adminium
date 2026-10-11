// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whether a person reaches the rows a document is drawn from, when a role of
 * theirs holds them to some rows of a table (`crud/row-limit.ts`).
 *
 * TWO QUESTIONS, ONE ANSWER. The record a document is about is asked as a
 * record is: one out of the person's reach is a document that is not there.
 * And every OTHER table it reads — its lines, a statement's invoices — must
 * be one they read whole: a page drawn from every row cannot be cut down to
 * theirs, and one drawn from theirs alone would hand a customer a wrong
 * total. So it is whole, or it is not drawn.
 *
 * Asked the same way by every door: a render (as whoever asked for it), a
 * kept document (as whoever opens it), a job (as its requester, again).
 */
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { fetchVisible, type RowAction, type RowLimitContext } from '../crud/row-limit.js';
import { rowTestOf } from '../crud/row-limit-context.js';

/** The table's id as the model has it, from an id or a name a stored record kept. */
function idOf(view: SnapshotView, table: string): string {
  return view.linkTable(table)?.id ?? table;
}

/**
 * The first table a document reads BESIDE its own record's that this person
 * reads only in part, or null. A table the model has not is one: nothing
 * says whose its rows are.
 */
export function bodyReadInPart(rows: RowLimitContext | null, view: SnapshotView, head: string | null, reads: readonly string[]): string | null {
  if (rows === null) return null;
  const headId = head === null ? null : idOf(view, head);
  for (const table of reads) {
    const id = idOf(view, table);
    if (id !== headId && rowTestOf(rows, id, 'read') !== null) return table;
  }
  return null;
}

/**
 * Whether the person reaches the record a document is about, for `action`,
 * and reads whole every other table it reads. `db` is asked for only when a
 * row has to be looked at; with none to give, somebody held to some rows of
 * the record's table reaches no document of it.
 */
export async function documentRowsReached(input: {
  rows: RowLimitContext | null;
  view: SnapshotView;
  db: (() => Promise<Kysely<SourceDatabase>>) | undefined;
  /** The record's table (an id, or the name a stored document kept) and its key; a document about no record has neither. */
  head: string | null;
  pk: Row | null;
  reads: readonly string[];
  action: RowAction;
}): Promise<boolean> {
  const { rows, view } = input;
  if (rows === null) return true;
  const head = input.head === null ? null : view.linkTable(input.head);
  if (input.head !== null && head === null) return rowTestOf(rows, input.head, input.action) === null && bodyReadInPart(rows, view, input.head, input.reads) === null;
  if (head !== null && rowTestOf(rows, head.id, input.action) !== null) {
    if (input.db === undefined || input.pk === null) return false;
    // Only the key's own columns: nothing else a caller sent beside them names a column here.
    const pk: Row = {};
    for (const column of head.primaryKey) {
      if (input.pk[column] === undefined || input.pk[column] === null) return false;
      pk[column] = input.pk[column];
    }
    if (head.primaryKey.length === 0) return false;
    if ((await fetchVisible(rows, await input.db(), head, pk, input.action)) === undefined) return false;
  }
  return bodyReadInPart(rows, view, head?.id ?? null, input.reads) === null;
}
