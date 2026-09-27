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

/**
 * The person a session is, as a withhold's reader: a signed-in person, on the
 * table the key signs people in as — never a row's own link (null).
 */
export function sessionReader(scope: CompiledScope, session: PublicSessionContext | null, view: SnapshotView): WithholdReader | null {
  const claim = scope.claim;
  if (session === null || session.kind === 'token' || claim === null || claim === undefined || claim.strategy === 'token') return null;
  const identity = scope.byRef.get(claim.ref);
  if (identity === undefined || session.grant.ref !== claim.ref) return null;
  try {
    return { table: view.table(identity.table).id, value: session.grant.value ?? null };
  } catch {
    return null;
  }
}

export function withholding(
  resource: CompiledResource,
  scope: CompiledScope,
  session: PublicSessionContext | null,
  view: SnapshotView,
  table: ResolvedTable,
  /** Every `withhold` declared on the connection: an entry read through a parent that declares none keeps what another entry withholds on its table. */
  declared?: TableWithholds,
): Withholding {
  const own = resource.withhold ?? null;
  const rules: readonly WithholdRule[] =
    own !== null ? [own] : resource.visibleWith !== null && resource.visibleWith !== undefined && declared !== undefined ? withholdRulesOf(declared, table.id) : [];
  if (rules.length === 0) return { expose: resource.expose, apply: (row) => row };
  const fetched = [...new Set(rules.map((rule) => rule.unlessHolder))].filter((column) => !resource.expose.includes(column));
  const readers = rules.map((rule) => readerOf(scope, session, view, table, rule.unlessHolder));
  return {
    expose: [...resource.expose, ...fetched],
    apply: (row) => {
      const out: Row = { ...row };
      rules.forEach((rule, i) => {
        const holder = row[rule.unlessHolder];
        const reader = readers[i];
        const theirs = holder === null || holder === undefined || (reader !== null && String(holder) === String(reader));
        if (!theirs) for (const column of rule.columns) if (column in out) out[column] = null;
      });
      for (const column of fetched) delete out[column];
      return out;
    },
  };
}

/*
 * ── The same rule wherever a row reaches its parent's reader ──────────────
 *
 * The public reads above apply an entry's own `withhold`. A row changes hands
 * on its own, though, and reaches the buyer by other ways than a read: a retry
 * of the create that made it answers the rows as they are now, an email to
 * the buyer prints its columns (a value, a list of rows, a QR code), and a
 * document of the order draws them. Each of those applies every `withhold` any
 * public entry declares on the row's table — whichever key or entry declared
 * it, so a rule written once holds everywhere — with the reader it has: the
 * person who made the order, the person an email goes to, the person a
 * document is drawn for.
 */

/** One `withhold` as declared: the columns, and the link naming the row's holder. */
export interface WithholdRule {
  columns: readonly string[];
  unlessHolder: string;
}

/** Every `withhold` declared on a connection's tables, by table name (schema left off, which errs on the side of withholding). */
export type TableWithholds = ReadonlyMap<string, readonly WithholdRule[]>;

const bareName = (table: string): string => table.slice(table.lastIndexOf('.') + 1);

/** The rules declared on one table (by its id or name), or none. */
export function withholdRulesOf(withholds: TableWithholds, table: string): readonly WithholdRule[] {
  return withholds.get(bareName(table)) ?? [];
}

/** The columns a table's rules name as the holder link: what a read must fetch to decide. */
export function holderColumnsOf(withholds: TableWithholds, table: string): string[] {
  return [...new Set(withholdRulesOf(withholds, table).map((rule) => rule.unlessHolder))];
}

/** Who reads a row, for a withhold: a person, as the table they are kept in and their key — or nobody (null). */
export interface WithholdReader {
  table: string;
  value: unknown;
}

/** The table a single-column link of `table` points at, or undefined. */
function pointsTo(view: SnapshotView, table: ResolvedTable, column: string): string | undefined {
  return view.model.relations.find((r) => r.through === null && r.from.tableId === table.id && r.from.columns.length === 1 && r.from.columns[0] === column)?.to.tableId;
}

/**
 * The columns of one row withheld from a reader: those of each rule whose
 * holder is set and is not the reader. A row nobody holds is its parent's
 * reader's; a reader who is nobody (null) — a row's own link, a message to an
 * address no person keeps — reads no held row's columns. A holder link that
 * points at another table than the reader's never names the reader.
 */
export function withheldColumns(view: SnapshotView, table: ResolvedTable, rules: readonly WithholdRule[], row: Row, reader: WithholdReader | null): Set<string> {
  const out = new Set<string>();
  for (const rule of rules) {
    const holder = row[rule.unlessHolder];
    if (holder === null || holder === undefined) continue;
    const theirs = reader !== null && reader.value !== null && reader.value !== undefined && pointsTo(view, table, rule.unlessHolder) === reader.table && String(holder) === String(reader.value);
    if (theirs) continue;
    for (const column of rule.columns) out.add(column);
  }
  return out;
}

/** The row with the columns withheld from `reader` emptied. */
export function blankWithheld(view: SnapshotView, table: ResolvedTable, rules: readonly WithholdRule[], row: Row, reader: WithholdReader | null): Row {
  const hidden = withheldColumns(view, table, rules, row, reader);
  if (hidden.size === 0) return row;
  const out: Row = { ...row };
  for (const column of hidden) if (column in out) out[column] = null;
  return out;
}

/** The rules an entry list declares (endpoint definitions, a key's compiled resources, an app's manifest entries), by table name. */
export function collectWithholds(declared: Iterable<{ table: string; withhold: WithholdRule | null | undefined }>): Map<string, WithholdRule[]> {
  const out = new Map<string, WithholdRule[]>();
  for (const { table, withhold } of declared) {
    if (withhold === null || withhold === undefined) continue;
    const name = bareName(table);
    const list = out.get(name) ?? [];
    if (!list.some((rule) => rule.unlessHolder === withhold.unlessHolder && rule.columns.join('\u0000') === withhold.columns.join('\u0000'))) {
      list.push({ columns: [...withhold.columns], unlessHolder: withhold.unlessHolder });
    }
    out.set(name, list);
  }
  return out;
}
