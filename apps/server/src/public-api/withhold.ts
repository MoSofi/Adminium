// SPDX-License-Identifier: AGPL-3.0-only
/**
 * COLUMNS WITHHELD FROM ROWS READ THROUGH A PARENT (`withhold`).
 *
 * A ticket sent to a friend is still a row of the buyer's order, so every
 * read of the order's tickets — the buyer's "My tickets", the order's own
 * link — would show it. Once the ticket has a holder who is not the reader,
 * the columns that are the holder's alone (its new code, the friend's
 * address) come back empty: the buyer sees "sent to Kai", never what gets Kai
 * in. The reader is the holder only when the session is a person's — signed
 * in, not a row's own link, which opens a row and names nobody — and the
 * holder column names that person. A row with no holder is its parent's
 * reader's, as it always was.
 *
 * Every door that answers such rows applies it: a list, one row, and the row
 * a change answers with.
 */
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import type { PublicSessionContext } from './claim.js';
import type { CompiledResource, CompiledScope } from './scope.js';

export interface Withholding {
  /** The columns the read must fetch: the resource's own, and the holder column when it is not one of them. */
  expose: readonly string[];
  /** The row as the reader may see it: the withheld columns emptied unless the reader holds it, the holder column dropped when it was fetched only to decide. */
  apply: (row: Row) => Row;
}

/**
 * The person a session is, for a withhold: a signed-in person's key — never a
 * row's own link — and only when the holder column points at the table the
 * key signs people in as (an order's key is never compared with a person's).
 */
function readerOf(scope: CompiledScope, session: PublicSessionContext | null, view: SnapshotView, table: ResolvedTable, holder: string): unknown {
  const claim = scope.claim;
  if (session === null || session.kind === 'token' || claim === null || claim === undefined || claim.strategy === 'token') return null;
  const identity = scope.byRef.get(claim.ref);
  if (identity === undefined || session.grant.ref !== claim.ref) return null;
  const points = view.model.relations.find((r) => r.through === null && r.from.tableId === table.id && r.from.columns.length === 1 && r.from.columns[0] === holder)?.to.tableId;
  let people: string | null = null;
  try {
    people = view.table(identity.table).id;
  } catch {
    people = null;
  }
  return points !== undefined && points === people ? (session.grant.value ?? null) : null;
}

export function withholding(resource: CompiledResource, scope: CompiledScope, session: PublicSessionContext | null, view: SnapshotView, table: ResolvedTable): Withholding {
  const rule = resource.withhold ?? null;
  if (rule === null) return { expose: resource.expose, apply: (row) => row };
  const fetched = !resource.expose.includes(rule.unlessHolder);
  const reader = readerOf(scope, session, view, table, rule.unlessHolder);
  return {
    expose: fetched ? [...resource.expose, rule.unlessHolder] : resource.expose,
    apply: (row) => {
      const holder = row[rule.unlessHolder];
      const theirs = holder === null || holder === undefined || (reader !== null && String(holder) === String(reader));
      const out: Row = { ...row };
      if (!theirs) for (const column of rule.columns) if (column in out) out[column] = null;
      if (fetched) delete out[rule.unlessHolder];
      return out;
    },
  };
}
