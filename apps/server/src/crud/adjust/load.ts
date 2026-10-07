// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A PRICE QUESTION ASKS ABOUT — read before an add-on's code is asked
 * anything.
 *
 * The code that answers a price never touches the database. Adminium reads
 * for it: the order's lines as they are stored, the codes typed on the order
 * (each looked up in the add-on's own tables), the rows the add-on declares
 * it reads, its one settings row — and, only for a customer whose identity
 * was PROVED, which groups they are in and what they used before.
 *
 * Every function here only reads, on whatever handle it is given: the pool
 * before a transaction, the transaction inside one. Plain reads, never a
 * locking one: the order row itself is held by whoever calls. Values are
 * handed the same on every engine — a decimal as text, a yes/no as a boolean.
 */
import { ADJUST_CODES_MAX, ADJUST_LINES_MAX, ADJUST_OFFERS_MAX, type AdjustCode, type AdjustLine } from '@adminium/add-on-contracts';
import { ratioText, toRatio, type Adjuster } from '@adminium/manifest';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import type { SourceDatabase } from '../../connections/manager.js';
import type { ResolvedAdjuster } from '../../ledgers/registry.js';
import { canonicalCode, findByCode, plausibleCode, routeTypedCode, spellingOf, type CodeKind } from '../code-lookup.js';
import type { ResolvedTable, SnapshotView } from '../identifiers.js';
import { LEDGER_READ_ROWS, rowOut, type ScalarRow } from '../ledger-reads.js';
import type { Row } from '../mask.js';
import { booleanOf, sameValue } from '../write-values.js';
import { isLine, lineKey, type AdjustPart, type CompiledAdjust } from './rule.js';

type Db = Kysely<SourceDatabase>;

/** More than one price question may read or hand over: the save is refused `too-large`, whichever limit it was. */
export class AdjustTooLarge extends Error {
  override readonly name = 'AdjustTooLarge';
  constructor(readonly what: 'lines' | 'codes' | 'offers') {
    super(`a price question carries at most so many ${what}, and this order has more`);
  }
}

/** The most rows of an order's codes table that are read: the codes on it now, and those taken off it again. */
export const CODE_ROWS_MAX = ADJUST_CODES_MAX * 4;

const empty = (value: unknown): boolean => value === null || value === undefined || value === '';
const keyOf = (table: ResolvedTable, row: Row): string => table.primaryKey.map((column) => String(row[column])).join('/');

// ── the order and its lines ──────────────────────────────────────────────────

/** An order as it is stored, read plainly; undefined when it is not there. */
export async function loadOrder(db: Db, table: ResolvedTable, adjust: Pick<CompiledAdjust, 'key'>, key: unknown): Promise<Row | undefined> {
  return (await db.selectFrom(table.id as never).selectAll().where(sql.ref(adjust.key), '=', key as never).limit(1).executeTakeFirst()) as Row | undefined;
}

/** A row under an order that a part of the rule names: a line, or a row the part leaves out (a voided one). */
export interface LoadedLine {
  part: AdjustPart;
  table: ResolvedTable;
  row: Row;
  /** The line's key as the add-on is handed it. */
  key: string;
  /** False for a row the part's `unlessSet` or `only` leaves out: handed to nobody, and its reduction is none. */
  line: boolean;
}

/**
 * The rows of every part of an order: the order row itself for a part that is
 * the order, the child rows whose `via` names it for the others — oldest key
 * first, a part after the one before it. Rows a part leaves out are among
 * them, marked: a reduction they still carry is taken off again.
 */
export async function loadLines(db: Db, view: SnapshotView, adjust: CompiledAdjust, order: Row): Promise<LoadedLine[]> {
  const out: LoadedLine[] = [];
  let lines = 0;
  for (const part of adjust.parts) {
    const table = view.table(part.table);
    if (part.self) {
      out.push({ part, table, row: order, key: lineKey(part.index, order[adjust.key]), line: true });
      lines += 1;
      continue;
    }
    let query = db.selectFrom(table.id as never).selectAll().where(sql.ref(part.via!), '=', order[adjust.key] as never);
    for (const column of table.primaryKey) query = query.orderBy(sql.ref(column));
    // Past the most a question carries there is nothing to read: the save is refused — whatever the rows are. One more row than
    // was read may be a line, and a line never read would keep a reduction nobody worked out.
    const rows = (await query.limit(ADJUST_LINES_MAX + 1).execute()) as Row[];
    if (rows.length > ADJUST_LINES_MAX) throw new AdjustTooLarge('lines');
    for (const row of rows) {
      const line = isLine(part, row);
      if (line) lines += 1;
      out.push({ part, table, row, key: lineKey(part.index, keyOf(table, row)), line });
    }
    if (lines > ADJUST_LINES_MAX) throw new AdjustTooLarge('lines');
  }
  return out;
}

type Ratio = NonNullable<ReturnType<typeof toRatio>>;
const ZERO: Ratio = { n: 0n, d: 1n };
const times = (a: Ratio, b: Ratio): Ratio => ({ n: a.n * b.n, d: a.d * b.d });

/** How a table is named in rows another manifest keeps (`<maker>:<ref>`, or its id when nobody made it). */
export type RefOf = (tableId: string) => string;

/**
 * A line as the add-on is handed it: its price, quantity and amount as
 * decimal text at the order's places, and what it sells — each as a table's
 * stored name and a row's key (a tag as its own text, of no table).
 * `nights`: a stay's nights with their prices, when the part is priced so.
 */
export function adjustLineOf(input: { view: SnapshotView; line: LoadedLine; index: number; places: number; refOf: RefOf; nights?: readonly { date: string; rate: string }[] | undefined; kept?: boolean | undefined; quantity?: Ratio | undefined }): AdjustLine {
  const { line, places } = input;
  const { part, row, table } = line;
  const price = toRatio(row[part.price]) ?? ZERO;
  const stored = part.quantity === undefined ? { n: 1n, d: 1n } : (toRatio(row[part.quantity]) ?? ZERO);
  // A stay's quantity is its nights, and its price column already the whole stay's.
  const nights = part.nights === undefined ? undefined : input.nights;
  const quantity = input.quantity ?? (nights === undefined ? stored : { n: BigInt(nights.length), d: 1n });
  const worth = nights !== undefined || part.quantity === undefined ? price : times(price, quantity);
  // A row worth less than nothing (a correction keyed in as a line) is never reduced, and counts for nothing an offer adds up.
  const owed = worth.n * worth.d < 0n;
  const amount = owed ? ZERO : worth;
  const what: AdjustLine['what'] = [];
  for (const entry of part.what) {
    const value = row[entry.column];
    if (empty(value)) continue;
    if (entry.as === 'tag') {
      what.push({ as: 'tag', table: '', row: String(value) });
      continue;
    }
    const column = table.table.columns.find((candidate) => candidate.name === entry.column);
    const relation = input.view.model.relations.find((r) => r.through === null && r.from.tableId === table.id && r.from.columns.length === 1 && r.from.columns[0] === entry.column);
    // A link with no foreign key behind it (into an add-on's table) names its table by the link's own rule.
    const target = relation?.to.tableId ?? column?.addOnLink?.tableId ?? null;
    if (target === null) continue;
    what.push({ as: entry.as, table: input.refOf(target), row: String(value) });
  }
  // A whole number of things is written as one: `2`, never `2.000`.
  const whole = quantity.d === 1n || quantity.n % quantity.d === 0n;
  return {
    key: line.key,
    part: part.index,
    index: input.index,
    price: ratioText(price, places),
    quantity: whole ? String(quantity.n / quantity.d) : ratioText(quantity, 4).replace(/0+$/, ''),
    amount: ratioText(amount, places),
    what,
    excluded: owed || (part.excludes !== undefined && !empty(row[part.excludes])),
    paidBy: part.paidBy === undefined || empty(row[part.paidBy]) ? null : String(row[part.paidBy]),
    kept: input.kept ?? true,
    ...(nights === undefined ? {} : { nights: nights.map((night) => ({ date: night.date, price: ratioText(toRatio(night.rate) ?? ZERO, places) })) }),
  };
}

// ── the codes typed ──────────────────────────────────────────────────────────

/** A code typed on an order, looked up: the add-on's row it names, or none. */
export interface LoadedCode {
  /** As it was typed. */
  typed: string;
  /** Which of the add-on's tables the row came from; null when no row was found. */
  kind: 'code' | 'voucher' | null;
  /** The add-on's table the row is in, and the row. */
  table: ResolvedTable | null;
  found: Row | null;
  /** The row's key. */
  id: string | null;
  /** The row of the order's codes table the value was typed into; null for a code only tried. */
  row: Row | null;
}

type AdjustKind = CodeKind & { of: 'code' | 'voucher' | 'never' };

/** Whether a found row meets the conditions that make it a code at all. */
function meetsWhere(row: Row, where: readonly { column: string; eq?: unknown; in?: readonly unknown[] | undefined }[] | undefined): boolean {
  for (const condition of where ?? []) {
    const value = row[condition.column];
    const same = (wanted: unknown): boolean => sameValue(typeof wanted === 'boolean' ? booleanOf(value) : value, wanted);
    if (condition.eq !== undefined ? !same(condition.eq) : !(condition.in ?? []).some(same)) return false;
  }
  return true;
}

/**
 * Each typed value looked up in the add-on's own tables, in the order typed.
 * A value is routed the way every door routes one (`routeTypedCode`): one
 * that starts with a voucher's word is a voucher, looked up with the word cut
 * off; one that starts with another reserved word (a card's) is no reduction
 * at all; anything else is a discount code first and, when none is found and
 * it is as long as a voucher's code, a voucher — a scanned one carries no
 * word. Text that could not be a code makes no query. Two rows that fold
 * alike are no row.
 */
export async function findCodes(db: Db, adjuster: ResolvedAdjuster, typed: readonly string[]): Promise<LoadedCode[]> {
  if (typed.length > ADJUST_CODES_MAX) throw new AdjustTooLarge('codes');
  const { codes, vouchers } = adjuster.declared;
  const codesTable = adjuster.table(codes.table)!;
  const vouchersTable = adjuster.table(vouchers.table)!;
  const spelling = (table: ResolvedTable, column: string) => spellingOf(table.table.columns.find((candidate) => candidate.name === column));
  const word = (text: string): string => canonicalCode(text);
  const routed = new Set(vouchers.prefixes.map(word));
  const kinds: AdjustKind[] = [
    { of: 'code', spelling: spelling(codesTable, codes.column) },
    ...vouchers.prefixes.map((prefix) => ({ of: 'voucher' as const, prefix, spelling: spelling(vouchersTable, vouchers.column) })),
    // A reserved word that routes to nothing here (a card's): a value starting so is never a discount code, and no reduction.
    ...(codes.reserved ?? []).filter((reserved) => !routed.has(word(reserved))).map((reserved) => ({ of: 'never' as const, prefix: reserved, spelling: { kept: true as const } })),
  ];
  const out: LoadedCode[] = [];
  for (const value of typed) {
    const none: LoadedCode = { typed: value, kind: null, table: null, found: null, id: null, row: null };
    const canonical = canonicalCode(value);
    if (!plausibleCode(canonical)) {
      out.push(none);
      continue;
    }
    let hit: LoadedCode = none;
    // One look a table: a pack and a voucher share one, and are told apart by the row.
    const looked = new Set<string>();
    for (const { kind, needle } of routeTypedCode(canonical, kinds)) {
      // A word with nothing after it names no code.
      if (kind.of === 'never' || needle === '') continue;
      const table = kind.of === 'code' ? codesTable : vouchersTable;
      const once = `${table.id}\u0000${needle}`;
      if (looked.has(once)) continue;
      looked.add(once);
      const found = await findByCode(db, table.id, kind.of === 'code' ? codes.column : vouchers.column, kind.spelling, needle);
      if (found === null || (kind.of === 'code' && !meetsWhere(found, codes.where))) continue;
      hit = { typed: value, kind: kind.of, table, found, id: keyOf(table, found), row: null };
      break;
    }
    out.push(hit);
  }
  return out;
}

/**
 * The codes typed on a stored order — the rows of its codes table, oldest
 * first, but those marked removed — each looked up. A row with nothing typed
 * is no code.
 */
export async function loadCodes(db: Db, view: SnapshotView, adjust: CompiledAdjust, adjuster: ResolvedAdjuster, order: Row): Promise<LoadedCode[]> {
  const rule = adjust.codes;
  if (rule === undefined) return [];
  const table = view.table(rule.table);
  let query = db.selectFrom(table.id as never).selectAll().where(sql.ref(rule.via), '=', order[adjust.key] as never);
  for (const column of table.primaryKey) query = query.orderBy(sql.ref(column));
  // The rows kept as history (a code taken off again) are read with the others: past so many of them a code typed last would never be read.
  const every = (await query.limit(CODE_ROWS_MAX + 1).execute()) as Row[];
  if (every.length > CODE_ROWS_MAX) throw new AdjustTooLarge('codes');
  const rows = every.filter((row) => {
    const removed = rule.removed === undefined ? null : row[rule.removed];
    return !empty(row[rule.typed]) && (empty(removed) || booleanOf(removed) === false);
  });
  if (rows.length > ADJUST_CODES_MAX) throw new AdjustTooLarge('codes');
  const found = await findCodes(db, adjuster, rows.map((row) => String(row[rule.typed])));
  return found.map((code, index) => ({ ...code, row: rows[index]! }));
}

/** A looked-up code as the add-on is handed it: the row with every column the same on every engine. */
export function adjustCodeOf(adjuster: ResolvedAdjuster, code: LoadedCode): AdjustCode {
  if (code.found === null || code.table === null) return { typed: code.typed, kind: null, row: null };
  return { typed: code.typed, kind: code.kind, row: rowOut(code.table, code.found, adjuster.typesOf(code.table.id)) };
}

// ── what the add-on reads ────────────────────────────────────────────────────

export interface OfferReads {
  /** The keys of the code rows the typed codes found (`input.codes`). */
  codes: readonly string[];
  /** The moment the question is judged at (`now`). */
  now: string;
  settings: ScalarRow;
  /** Every row, whatever its condition: staff asking why an offer does not apply see the ended and the paused ones too. */
  everything?: boolean | undefined;
  /** Only these rows of the first read's table (an order priced again under what it already took). */
  only?: ReadonlySet<string> | undefined;
}

/**
 * The add-on's declared reads, in order, each a plain select of one of its
 * own tables: `where <key> in (…)` for each key (the moment, the typed codes'
 * rows, a setting, a column of an earlier read), its own conditions, by the
 * table's key, one row more than its limit. A key with nothing to look for
 * answers no row without asking the database. More rows than a question
 * carries, in one read or in all, is `too-large`.
 */
export async function loadOffers(db: Db, adjuster: ResolvedAdjuster, input: OfferReads): Promise<Record<string, ScalarRow[]>> {
  const out: Record<string, ScalarRow[]> = {};
  let total = 0;
  const reads: Adjuster['offers'] = adjuster.declared.offers;
  const first = reads[0]?.table;
  const values = (from: string): unknown[] => {
    if (from === 'now') return [input.now];
    if (from === 'input.codes') return [...input.codes];
    const [head, name] = from.split('.') as [string, string | undefined];
    if (head === 'setting') return [name === undefined ? null : (input.settings[name] ?? null)];
    return (out[head] ?? []).map((row) => (name === undefined ? null : (row[name] ?? null)));
  };
  for (const read of reads) {
    const table = adjuster.table(read.table);
    if (table === null) throw new Error(`the adjuster reads "${read.table}", which is not one of its tables here`);
    const limit = Math.min(read.limit ?? LEDGER_READ_ROWS, ADJUST_OFFERS_MAX);
    let query = db.selectFrom(table.id as never).selectAll();
    let nothing = false;
    for (const by of read.by) {
      const wanted = [...new Set((Array.isArray(by.from) ? by.from : [by.from]).flatMap(values).filter((value) => !empty(value)))];
      if (wanted.length === 0) nothing = true;
      else query = query.where(sql.ref(by.column), 'in', wanted as never);
    }
    if (input.everything !== true) {
      for (const where of read.where ?? []) {
        query = where.eq !== undefined ? query.where(sql.ref(where.column), '=', where.eq as never) : query.where(sql.ref(where.column), 'in', (where.in ?? []) as never);
      }
    }
    // Priced again under what the order took: of the first table read, only those rows.
    if (input.only !== undefined && read.table === first) {
      const key = table.primaryKey[0] ?? 'id';
      if (input.only.size === 0) nothing = true;
      else query = query.where(sql.ref(key), 'in', [...input.only] as never);
    }
    for (const column of table.primaryKey) query = query.orderBy(sql.ref(column));
    const rows = nothing ? [] : ((await query.limit(limit + 1).execute()) as Row[]);
    total += rows.length;
    if (rows.length > limit || total > ADJUST_OFFERS_MAX) throw new AdjustTooLarge('offers');
    const declared = adjuster.typesOf(table.id);
    out[read.as] = rows.map((row) => rowOut(table, row, declared));
  }
  return out;
}

// ── who is buying ────────────────────────────────────────────────────────────

/** What is known of a customer whose identity was proved. */
export interface PersonFacts {
  key: string;
  groups: string[];
  /** Their earlier orders of the same table. */
  orders: number;
  /** How often they used each offer, by the offer's key. */
  uses: Record<string, number>;
}

/**
 * The facts about the customer of an order — ONLY when the order says its
 * customer was proved and names one. Otherwise null, and not one statement
 * is issued: an address somebody typed is never looked for, so what is
 * issued for an unknown buyer is the same whoever they claim to be.
 *
 * `keyOf` turns the customer's address into the key the add-on's own rows
 * hold; no address is ever compared in a statement, and none reaches the
 * add-on. `own`: the rows this order's own open round holds, by offer — what
 * the order itself took does not count against it.
 */
export async function loadPerson(
  db: Db,
  view: SnapshotView,
  adjust: CompiledAdjust,
  adjuster: ResolvedAdjuster,
  order: Row,
  input: { orderTable: ResolvedTable; keyOf: (address: string) => string; own?: Readonly<Record<string, number>> | undefined },
): Promise<PersonFacts | null> {
  const customer = adjust.rule.order.customer;
  const person = adjuster.declared.person;
  if (customer === undefined) return null;
  const link = order[customer.link];
  if (booleanOf(order[customer.proved]) !== true || empty(link)) return null;
  const relation = view.model.relations.find((r) => r.through === null && r.from.tableId === input.orderTable.id && r.from.columns.length === 1 && r.from.columns[0] === customer.link && r.to.columns.length === 1);
  if (relation === undefined) return null;
  const people = view.table(relation.to.tableId);
  const found = (await db.selectFrom(people.id as never).select(sql.ref(customer.address).as('address')).where(sql.ref(relation.to.columns[0]!), '=', link as never).limit(1).executeTakeFirst()) as { address?: unknown } | undefined;
  // A customer with no address is somebody, and nobody the add-on's rows could name.
  if (found === undefined || empty(found.address)) return null;
  const key = input.keyOf(String(found.address));
  const facts: PersonFacts = { key, groups: [], orders: 0, uses: {} };
  if (person !== undefined) {
    const groups = adjuster.table(person.groups.table)!;
    const members = (await db.selectFrom(groups.id as never).select(sql.ref(person.groups.group).as('group')).where(sql.ref(person.groups.member), '=', key as never).limit(ADJUST_OFFERS_MAX).execute()) as { group?: unknown }[];
    facts.groups = [...new Set(members.filter((row) => !empty(row.group)).map((row) => String(row.group)))].sort();
    const uses = adjuster.table(person.uses.table)!;
    const used = (await db
      .selectFrom(uses.id as never)
      .select([sql.ref(person.uses.offer).as('offer'), sql<number>`count(*)`.as('n')])
      .where(sql.ref(person.uses.customer), '=', key as never)
      .where(sql.ref(person.uses.state), 'in', person.uses.counted as never)
      .groupBy(sql.ref(person.uses.offer))
      .execute()) as { offer?: unknown; n?: unknown }[];
    for (const row of used) {
      if (empty(row.offer)) continue;
      const offer = String(row.offer);
      const left = Number(row.n) - (input.own?.[offer] ?? 0);
      if (left > 0) facts.uses[offer] = left;
    }
  }
  if (person?.orders === true) {
    // Their other rows of the order's table — those the rule says stand, when it says which.
    let query = db
      .selectFrom(input.orderTable.id as never)
      .select(sql<number>`count(*)`.as('n'))
      .where(sql.ref(customer.link), '=', link as never)
      .where(sql.ref(adjust.key), '<>', order[adjust.key] as never);
    if (customer.counts !== undefined) query = query.where(sql.ref(customer.counts.column), 'in', customer.counts.in as never);
    facts.orders = Number(((await query.executeTakeFirst()) as { n?: unknown } | undefined)?.n ?? 0);
  }
  return facts;
}
