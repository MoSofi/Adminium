// SPDX-License-Identifier: AGPL-3.0-only
/**
 * COLUMNS WITHHELD FROM ROWS READ THROUGH A PARENT (`withhold`) — and on
 * every other public read of the same table.
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
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { holds } from '../crud/state-conditions.js';
import type { PublicSessionContext } from './claim.js';
import type { CompiledResource, CompiledScope } from './scope.js';

export interface Withholding {
  /** The columns the read must fetch: the resource's own, and the columns a rule decides by when they are not among them. */
  expose: readonly string[];
  /** Every column a rule may withhold: never filtered, searched or sorted by, which would tell what it holds. */
  columns: ReadonlySet<string>;
  /**
   * Read the rows a rule's linked conditions look at (the order a ticket
   * belongs to), for these rows, before `apply`. Without it a linked
   * condition cannot be read, and the columns are withheld.
   */
  prepare: (db: Kysely<SourceDatabase>, rows: readonly Row[]) => Promise<void>;
  /** The row as the reader may see it: the withheld columns emptied, the columns fetched only to decide dropped. */
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
  /** The key the read comes through (its purpose): a rule's `when` declared on another key is that key's readers' alone. */
  readerKey?: string,
): Withholding {
  const own = resource.withhold ?? null;
  // An entry's own rule; else every rule declared on its table, whichever entry or key declared it.
  const rules: readonly WithholdRule[] = own !== null ? [{ ...own, ...(readerKey === undefined ? {} : { key: readerKey }) }] : declared !== undefined ? withholdRulesOf(declared, table.id) : [];
  if (rules.length === 0) return { expose: resource.expose, columns: new Set(), prepare: async () => {}, apply: (row) => row };
  const fetched = [...new Set(rules.flatMap(decidingColumns))].filter((column) => !resource.expose.includes(column) && table.columns.has(column));
  const readers = rules.map((rule) => (rule.unlessHolder === undefined ? null : readerOf(scope, session, view, table, rule.unlessHolder)));
  let linked: LinkedRows | undefined;
  return {
    expose: [...resource.expose, ...fetched],
    columns: new Set(rules.flatMap((rule) => rule.columns)),
    prepare: async (db, rows) => {
      linked = await linkedRowsOf(db, view, table, rules, rows);
    },
    apply: (row) => {
      const out: Row = { ...row };
      rules.forEach((rule, i) => {
        const holder = rule.unlessHolder === undefined ? undefined : row[rule.unlessHolder];
        const reader = readers[i];
        const heldElsewhere = rule.unlessHolder !== undefined && holder !== null && holder !== undefined && (reader === null || String(holder) !== String(reader));
        if (heldElsewhere || whenHolds(rule, row, readerKey, linked)) for (const column of rule.columns) if (column in out) out[column] = null;
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

export type { WithholdWhen } from './withhold-when.js';
import type { WithholdWhen } from './withhold-when.js';

/**
 * One `withhold` as declared: the columns; the link naming the row's holder
 * (withheld from anyone but the holder once one is set); and `when` (withheld
 * while it holds). `key`: the key the declaring entry is served through — a
 * `when` is its readers' alone (a pending friend's link), where a holder is
 * every reader's.
 */
export interface WithholdRule {
  columns: readonly string[];
  unlessHolder?: string | undefined;
  when?: WithholdWhen | undefined;
  key?: string | undefined;
  /**
   * Declared through a row's own link (a ticket's, offered to a friend): its
   * `when` is about whoever holds that link, so a reader of no key (a message
   * to an address, a document drawn for nobody) does not meet it.
   */
  ownLink?: true | undefined;
}

/** The rows linked conditions read, by the link column and then the linked key (as text). */
export type LinkedRows = ReadonlyMap<string, ReadonlyMap<string, Row>>;

/** The row's own columns a rule decides by: its holder link, the columns of its conditions, and the links its linked conditions follow. */
function decidingColumns(rule: WithholdRule): string[] {
  return [
    ...(rule.unlessHolder === undefined ? [] : [rule.unlessHolder]),
    ...(rule.when?.where ?? []).map((condition) => condition.column),
    ...(rule.when?.linked ?? []).map((link) => link.via),
  ];
}

/** The rows a table's rules decide by: every column the read must fetch to judge them. */
export function decidingColumnsOf(withholds: TableWithholds, table: string): string[] {
  return [...new Set(withholdRulesOf(withholds, table).flatMap(decidingColumns))];
}

/**
 * Whether a rule's `when` holds for a row, for a reader on `readerKey` (none:
 * a reader of no key — an email, a document mailed out — and every rule
 * applies). A condition that cannot be read — a link that is empty, a linked
 * row not read or gone — holds: a column is never shown on nothing.
 */
function whenHolds(rule: WithholdRule, row: Row, readerKey: string | undefined, linked: LinkedRows | undefined): boolean {
  const when = rule.when;
  if (when === undefined) return false;
  if (rule.key !== undefined && readerKey !== undefined && rule.key !== readerKey) return false;
  /*
   * A reader of no key (a message to an address, a document drawn for
   * nobody) meets every rule said of a row's state for its people (an order
   * not paid) — never one a row's own link says of whoever holds that link
   * (a pending friend): a paid buyer's own codes are theirs in the mail.
   */
  if (readerKey === undefined && rule.ownLink === true) return false;
  if (!(when.where ?? []).every((condition) => holds(condition, row))) return false;
  for (const link of when.linked ?? []) {
    const key = row[link.via];
    if (key === null || key === undefined) return true;
    // Not read (a door that reads no linked rows), or gone: withheld.
    const target = linked?.get(link.via)?.get(String(key));
    if (target === undefined) return true;
    if (!link.where.every((condition) => holds(condition, target))) return false;
  }
  return true;
}

/** The rows every rule's linked conditions look at, for these rows: one read per link. */
export async function linkedRowsOf(db: Kysely<SourceDatabase>, view: SnapshotView, table: ResolvedTable, rules: readonly WithholdRule[], rows: readonly Row[]): Promise<LinkedRows> {
  const out = new Map<string, Map<string, Row>>();
  const vias = [...new Set(rules.flatMap((rule) => (rule.when?.linked ?? []).map((link) => link.via)))];
  for (const via of vias) {
    const targetId = pointsTo(view, table, via);
    if (targetId === undefined) continue;
    let target: ResolvedTable;
    try {
      target = view.table(targetId);
    } catch {
      continue;
    }
    const key = target.primaryKey[0];
    const values = [...new Set(rows.map((row) => row[via]).filter((value) => value !== null && value !== undefined))];
    const found = new Map<string, Row>();
    if (key !== undefined && values.length > 0) {
      for (let at = 0; at < values.length; at += 500) {
        const read = (await db.selectFrom(target.id).selectAll().where(db.dynamic.ref(key), 'in', values.slice(at, at + 500) as never).execute()) as Row[];
        for (const one of read) found.set(String(one[key]), one);
      }
    }
    out.set(via, found);
  }
  return out;
}

/** Every `withhold` declared on a connection's tables, by table name (schema left off, which errs on the side of withholding). */
export type TableWithholds = ReadonlyMap<string, readonly WithholdRule[]>;

const bareName = (table: string): string => table.slice(table.lastIndexOf('.') + 1);

/** The rules declared on one table (by its id or name), or none. */
export function withholdRulesOf(withholds: TableWithholds, table: string): readonly WithholdRule[] {
  return withholds.get(bareName(table)) ?? [];
}

/** The columns a table's rules decide by (the holder link, the columns a `when` reads): what a read must fetch to decide. */
export function holderColumnsOf(withholds: TableWithholds, table: string): string[] {
  return decidingColumnsOf(withholds, table);
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
export function withheldColumns(
  view: SnapshotView,
  table: ResolvedTable,
  rules: readonly WithholdRule[],
  row: Row,
  reader: WithholdReader | null,
  /** The key the reader reads through, when there is one; the linked rows `when` reads, when read. */
  opts: { readerKey?: string | undefined; linked?: LinkedRows | undefined } = {},
): Set<string> {
  const out = new Set<string>();
  for (const rule of rules) {
    if (whenHolds(rule, row, opts.readerKey, opts.linked)) {
      for (const column of rule.columns) out.add(column);
      continue;
    }
    if (rule.unlessHolder === undefined) continue;
    const holder = row[rule.unlessHolder];
    if (holder === null || holder === undefined) continue;
    const theirs = reader !== null && reader.value !== null && reader.value !== undefined && pointsTo(view, table, rule.unlessHolder) === reader.table && String(holder) === String(reader.value);
    if (theirs) continue;
    for (const column of rule.columns) out.add(column);
  }
  return out;
}

/** The row with the columns withheld from `reader` emptied. */
export function blankWithheld(
  view: SnapshotView,
  table: ResolvedTable,
  rules: readonly WithholdRule[],
  row: Row,
  reader: WithholdReader | null,
  opts: { readerKey?: string | undefined; linked?: LinkedRows | undefined } = {},
): Row {
  const hidden = withheldColumns(view, table, rules, row, reader, opts);
  if (hidden.size === 0) return row;
  const out: Row = { ...row };
  for (const column of hidden) if (column in out) out[column] = null;
  return out;
}

/**
 * What a document drawn for a session withholds: the rules, the person (a
 * signed-in person, else nobody) and the key the session reads through — a
 * row's own link reads what that link reads.
 */
export function withholdFor(rules: TableWithholds, reader: WithholdReader | null, readerKey: string): { rules: TableWithholds; reader: WithholdReader | null; readerKey?: string } {
  // The door's own key, whoever reads through it: a row's own link reads what that link reads.
  return { rules, reader, readerKey };
}

/** The rules an entry list declares (endpoint definitions, a key's compiled resources, an app's manifest entries), by table name. */
export function collectWithholds(declared: Iterable<{ table: string; withhold: WithholdRule | null | undefined }>): Map<string, WithholdRule[]> {
  const out = new Map<string, WithholdRule[]>();
  const alike = (a: WithholdRule, b: WithholdRule) =>
    a.unlessHolder === b.unlessHolder && a.columns.join('\u0000') === b.columns.join('\u0000') && JSON.stringify(a.when ?? null) === JSON.stringify(b.when ?? null);
  for (const { table, withhold } of declared) {
    if (withhold === null || withhold === undefined) continue;
    const name = bareName(table);
    const list = out.get(name) ?? [];
    /*
     * A `when` said on a key, and the same said again with no key (a key's
     * scope written out from its endpoints): the key's. One said with no key
     * anywhere is every reader's.
     */
    const keyed = withhold.when === undefined ? undefined : withhold.key;
    // Already said: by the same key, by no key (every reader's), or — said again with no key — by a key.
    const twin = list.findIndex((rule) => alike(rule, withhold) && (rule.key === keyed || rule.key === undefined || keyed === undefined));
    if (twin >= 0) {
      // Said through a row's own link wherever it was said so: kept so.
      if (withhold.when !== undefined && withhold.ownLink === true && list[twin]!.ownLink !== true && (list[twin]!.key === undefined || list[twin]!.key === keyed)) {
        list[twin] = { ...list[twin]!, ...(keyed === undefined ? {} : { key: keyed }), ownLink: true };
      }
      out.set(name, list);
      continue;
    }
    {
      list.push({
        columns: [...withhold.columns],
        ...(withhold.unlessHolder === undefined ? {} : { unlessHolder: withhold.unlessHolder }),
        ...(withhold.when === undefined ? {} : { when: structuredClone(withhold.when) as WithholdWhen }),
        // Only a `when` is a key's own: a holder rule is every reader's.
        ...(withhold.when === undefined || withhold.key === undefined ? {} : { key: withhold.key }),
        ...(withhold.when === undefined || withhold.ownLink !== true ? {} : { ownLink: true as const }),
      });
    }
    out.set(name, list);
  }
  return out;
}
