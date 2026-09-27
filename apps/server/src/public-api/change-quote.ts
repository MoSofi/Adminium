// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE ROWS BELOW A CHANGED ROW, AS A QUOTE OF THE CHANGE WOULD LEAVE THEM.
 *
 * A guest moving their stay's dates is shown the new nights and their price
 * (`quoteNights`) — and the extras that follow the stay's nights and guests
 * ("Breakfast · 2 people × 3 nights $96.00"), as the change would leave
 * them. The follow is worked out with plain reads, as the quote works out the
 * row's own totals: nothing is held, nothing written.
 *
 * Which rows: those of every entry on the same key read with this row's
 * table as their parent (`visibleWith`), linked to this row; each shown as
 * that entry shows it — its columns, and what it withholds from this reader.
 */
import type { Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';

import type { SourceDatabase } from '../connections/manager.js';
import type { TableRules } from '../crud/column-rules.js';
import { followChanged } from '../crud/follow.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { compileFilter, type RecordFilter } from '../crud/filters.js';
import { maskRow, type Row } from '../crud/mask.js';
import type { PublicSessionContext } from './claim.js';
import type { CompiledResource, CompiledScope } from './scope.js';
import { withholding, type TableWithholds } from './withhold.js';

/** The most rows below one row a quote shows. */
const ROWS_MAX = 200;

export async function quoteChildren(input: {
  db: Kysely<SourceDatabase>;
  dialect: Dialect;
  view: SnapshotView;
  scope: CompiledScope;
  session: PublicSessionContext | null;
  readerKey: string;
  /** The entry the change is quoted through, and its table. */
  resource: CompiledResource;
  table: ResolvedTable;
  rules: TableRules | null;
  before: Row;
  after: Row;
  currency: () => Promise<string | null>;
  withholds: () => Promise<TableWithholds>;
  /** How a row's instants are written for a caller elsewhere. */
  spell: (row: Row, table: ResolvedTable) => Row;
  /** Whether this session reads an entry's personal columns in clear (its own rows, verified). */
  unmasked: (resource: CompiledResource) => boolean;
  /**
   * The rows of a child entry this session's list of it would show: its
   * filters and its claim, as the list reads them — or null when the session
   * could not list it at all (its level, a code it needs). Never more.
   */
  readable: (resource: CompiledResource, table: ResolvedTable) => { predicate: RecordFilter | null } | null;
}): Promise<Record<string, { data: Row }[]> | undefined> {
  const { db, view } = input;
  // The entries this row's table is a parent to, on this key.
  const parents = new Set([...input.scope.byRef.values()].filter((r) => r.table === input.resource.table).map((r) => r.ref));
  const children = [...input.scope.byRef.values()].filter((r) => r.visibleWith !== null && r.visibleWith !== undefined && parents.has(r.visibleWith.ref) && r.actions.has('read'));
  if (children.length === 0) return undefined;
  // The rows the change moves: every row a copy follows, as it would be.
  const followed = await followChanged({ db, dialect: input.dialect, view, rules: input.rules, before: input.before, after: input.after, currency: input.currency, hold: false, write: async () => {} });
  const out: Record<string, { data: Row }[]> = {};
  for (const child of children) {
    let own: ResolvedTable;
    try {
      own = view.table(child.table);
    } catch {
      continue;
    }
    const link = child.visibleWith!;
    const key = input.after[link.foreignColumn];
    if (key === null || key === undefined || !own.columns.has(link.localColumn)) continue;
    // Only what the guest's own list of these rows shows: a row it filters out is no row of the quote either.
    const readable = input.readable(child, own);
    if (readable === null) continue;
    let query = db.selectFrom(own.id).selectAll().where(db.dynamic.ref(link.localColumn), '=', key as never);
    const predicate = readable.predicate;
    if (predicate !== null) {
      query = query.where((eb) => compileFilter(eb as never, { view, table: own, canReadPii: false, dynamic: db.dynamic, dialect: input.dialect }, predicate) as never);
    }
    for (const column of own.primaryKey) query = query.orderBy(column as never);
    const stored = (await query.limit(ROWS_MAX).execute()) as Row[];
    const moved = new Map<string, Row>();
    for (const group of followed) {
      if (group.table.id !== own.id) continue;
      for (const row of group.rows) moved.set(JSON.stringify(own.primaryKey.map((c) => row.record[c])), row.record);
    }
    const rows = stored.map((row) => moved.get(JSON.stringify(own.primaryKey.map((c) => row[c]))) ?? row);
    const withheld = withholding(child, input.scope, input.session, view, own, (child.withhold ?? null) === null ? await input.withholds() : undefined, input.readerKey);
    await withheld.prepare(db, rows);
    out[child.ref] = rows.map((row) => {
      // Personal columns as the entry's own reads show them, secrets never.
      const masked = maskRow(Object.fromEntries(withheld.expose.map((column) => [column, row[column]])), own, input.unmasked(child));
      delete masked['_masked'];
      return { data: input.spell(withheld.apply(masked), own) };
    });
  }
  return out;
}
