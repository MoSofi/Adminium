// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A statement: one client row and a period, read as its own thing.
 *
 * Every other document is a row and its lines. A statement is not: it is the
 * documents issued to one client (invoices) and the payments that client
 * made, over a period, with what was owed when the period opened and a
 * balance after every entry. That is a read with a period filter, an opening
 * balance and a running sum — so it is a function here, driven by the
 * profile's two sources, rather than a field a mapping could express.
 *
 * ─── THE PERIOD IS ONE OF THREE WORDS, NEVER A DATE ────────────────────────
 *
 * `all`, `year` (from the first of January) and `12m` (the last twelve
 * months), worked out on the connection's own clock. A caller never sends a
 * date: a statement is something a client asks for through a public key, and
 * a free date range is an unbounded query shape handed to a stranger.
 *
 * ─── MONEY IS ADDED AS DECIMAL TEXT ────────────────────────────────────────
 *
 * The drivers hand a decimal back as text (`"12.5000"` from Postgres and
 * MySQL) or a number (SQLite). Balances are summed as scaled integers from
 * that text — never as floats — and handed on as decimal text, which the
 * subject then turns into the currency's minor units exactly once.
 */
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import type { SnapshotView } from '../crud/identifiers.js';

export const STATEMENT_PERIODS = ['all', 'year', '12m'] as const;
export type StatementPeriod = (typeof STATEMENT_PERIODS)[number];

/** One of the rows a statement lists, as the profile names it (real table id). */
export interface StatementSource {
  table: string;
  /** The column of `table` that points at the client row. */
  via: string;
  date: string;
  amount: string;
  number?: string | undefined;
  /** Only rows whose column holds one of these (sent invoices, not drafts). */
  where?: { column: string; in: readonly (string | number | boolean)[] } | undefined;
  /** A row whose column is true (or set) is left out: a voided payment. */
  unless?: string | undefined;
}

export interface StatementSources {
  documents: StatementSource;
  payments: StatementSource;
}

/** The most rows one statement reads from each source; past it, the render fails rather than lies. */
export const STATEMENT_MAX_ROWS = 20_000;
const PAGE = 500;
/** Decimals every amount is summed at; more than any currency or column here keeps. */
const SUM_SCALE = 6;

/**
 * A narrowing a public reader brings for one table: given the table's rows
 * query, the same query with that reader's own filter ANDed in. Null: the
 * table is read whole (a staff render, read with its own grants).
 */
export type Narrowing = (tableId: string) => ((query: unknown) => unknown) | null;

export class StatementTooLargeError extends Error {
  constructor(table: string) {
    super(`the statement lists more than ${String(STATEMENT_MAX_ROWS)} rows of ${table}`);
    this.name = 'StatementTooLargeError';
  }
}

/** Today on a clock, as `YYYY-MM-DD`. */
export function dayOn(at: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
}

/**
 * The first and last day a period covers, on the connection's clock. `from`
 * is null for `all`: everything up to today, and nothing owed before it.
 */
export function periodBounds(period: StatementPeriod, today: string): { from: string | null; to: string } {
  if (period === 'all') return { from: null, to: today };
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  if (period === 'year') return { from: `${String(y)}-01-01`, to: today };
  // Twelve months back, the day after: 2026-09-25 → 2025-09-26. Computed on
  // the calendar, not by subtracting days, so a leap year changes nothing.
  const back = new Date(Date.UTC(y - 1, m - 1, d + 1));
  return { from: back.toISOString().slice(0, 10), to: today };
}

/**
 * A driver's date as `YYYY-MM-DD`. Postgres and MySQL hand a `date` back as
 * a JavaScript Date at LOCAL midnight, so it is read with the local getters;
 * a timestamp keeps its day on the same terms. SQLite hands back the text.
 */
export function dayOf(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${String(value.getFullYear())}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

/** Decimal text (or a number) → an integer at `SUM_SCALE` decimals; null when it is not one. */
export function scaled(value: unknown): bigint | null {
  if (value === null || value === undefined || value === '') return null;
  const text = (typeof value === 'number' ? value.toFixed(SUM_SCALE) : String(value)).trim();
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (match === null) return null;
  const [, sign, whole = '', frac = ''] = match;
  if (whole === '' && frac === '') return null;
  const digits = BigInt((whole === '' ? '0' : whole) + (frac + '0'.repeat(SUM_SCALE)).slice(0, SUM_SCALE));
  return sign === '-' ? -digits : digits;
}

/** A scaled integer back to plain decimal text, trailing zeros trimmed. */
export function unscaled(value: bigint): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(SUM_SCALE + 1, '0');
  const whole = digits.slice(0, -SUM_SCALE);
  const frac = digits.slice(-SUM_SCALE).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac === '' ? '' : `.${frac}`}`;
}

/**
 * A linked row's balance as it stood right after THIS row — a receipt's
 * "balance left" (see `app-profiles.ts`): the linked row's `of`, less its
 * `minus` columns, less this table's rows for it that its rollup counts, in
 * (date, key) order up to and including this one.
 */
export interface BalanceAfter {
  /** The slot's foreign key and column, as the mapping names them. */
  via: string;
  column: string;
  of: string;
  minus?: readonly string[] | undefined;
  sum: string;
  times?: string | undefined;
  where?: { column: string; eq: string | number | boolean } | undefined;
  unlessSet?: string | undefined;
  /** This table's day the rows are ordered by (a payment's `paid_on`); else by key alone. */
  date?: string | undefined;
}

/**
 * Whether a row stays in a list that leaves rows out by their own columns: a
 * statement's sources, and a document's child list. `where` keeps only a row
 * whose column holds one of its values; `unless` drops a row whose column is
 * set.
 */
export function keptBy(
  row: Readonly<Record<string, unknown>>,
  filter: { where?: { column: string; in: readonly (string | number | boolean)[] } | undefined; unless?: string | undefined },
): boolean {
  if (filter.where !== undefined && !filter.where.in.some((value) => sameValue(row[filter.where!.column], value))) return false;
  return filter.unless === undefined || !isSet(row[filter.unless]);
}

/** Whether a row's `unless` column leaves it out: true, 1, or any other value set. */
function isSet(value: unknown): boolean {
  if (value === null || value === undefined || value === '' || value === false || value === 0) return false;
  if (typeof value === 'string' && (value === '0' || value.toLowerCase() === 'false')) return false;
  return true;
}

/** A stored value against one of a `where` list's values, across the drivers' spellings of a bool. */
function sameValue(stored: unknown, wanted: string | number | boolean): boolean {
  if (typeof wanted === 'boolean') return isSet(stored) === wanted;
  return String(stored) === String(wanted);
}

interface Entry {
  date: string;
  kind: 'document' | 'payment';
  number: string;
  amount: bigint;
  key: string;
}

/** Every row of one source that points at the client, read in pages. */
async function readSource(
  db: Kysely<SourceDatabase>,
  view: SnapshotView,
  source: StatementSource,
  clientKey: unknown,
  kind: Entry['kind'],
  narrow?: Narrowing,
): Promise<Entry[]> {
  const table = view.table(source.table);
  // Every column named must be a column of the table the snapshot knows:
  // `view.table` refuses an unknown table, and this refuses an unknown column.
  const wanted = [source.via, source.date, source.amount, source.number, source.unless, source.where?.column].filter(
    (column): column is string => column !== undefined,
  );
  for (const column of wanted) {
    if (!table.columns.has(column)) throw new Error(`${table.name} has no column ${column}`);
  }
  const keyColumn = table.primaryKey[0];
  const columns = [...new Set([...wanted, ...table.primaryKey])];
  const out: Entry[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let query = db
      .selectFrom(table.id as never)
      .select(columns as never)
      .where(source.via as never, '=', clientKey as never);
    const narrowing = narrow?.(table.id) ?? null;
    if (narrowing !== null) query = narrowing(query) as typeof query;
    query = query.orderBy(source.date as never, 'asc');
    for (const pk of table.primaryKey) query = query.orderBy(pk as never, 'asc');
    const rows = (await query.limit(PAGE).offset(offset).execute()) as Record<string, unknown>[];
    for (const row of rows) {
      if (!keptBy(row, source)) continue;
      const date = dayOf(row[source.date]);
      const amount = scaled(row[source.amount]);
      // A row with no date or no amount has no place on a statement: it is a
      // draft the app has not dated, or an amount nobody has entered yet.
      if (date === null || amount === null) continue;
      out.push({
        date,
        kind,
        number: source.number === undefined ? '' : String(row[source.number] ?? ''),
        amount,
        key: keyColumn === undefined ? '' : String(row[keyColumn]),
      });
    }
    if (offset + rows.length > STATEMENT_MAX_ROWS) throw new StatementTooLargeError(table.name);
    if (rows.length < PAGE) break;
  }
  return out;
}

export interface StatementRead {
  /** Scalar slots, as decimal text or days: the subject coerces them. */
  fields: {
    period: StatementPeriod;
    periodFrom: string;
    periodTo: string;
    openingBalance: string;
    documentsTotal: string;
    paymentsTotal: string;
    closingBalance: string;
  };
  /** `entries`: one row per document or payment in the period, oldest first, with the balance after it. */
  collections: {
    entries: { date: string; kind: 'document' | 'payment'; number: string; amount: string; balance: string }[];
  };
}

/**
 * Read one client's statement for a period.
 *
 * The opening balance is every document before the period less every
 * payment before it; each entry in the period then moves the balance — a
 * document up, a payment down — and a document comes before a payment made
 * the same day, so a same-day payment never shows the client in credit.
 */
export async function readStatement(input: {
  db: Kysely<SourceDatabase>;
  view: SnapshotView;
  sources: StatementSources;
  /** The client row's key value, which both sources' `via` columns hold. */
  clientKey: unknown;
  period: StatementPeriod;
  /** Today on the connection's clock. */
  today: string;
  /** What a public reader may see of each source (see {@link Narrowing}). */
  narrow?: Narrowing | undefined;
}): Promise<StatementRead> {
  const { from, to } = periodBounds(input.period, input.today);
  const entries = [
    ...(await readSource(input.db, input.view, input.sources.documents, input.clientKey, 'document', input.narrow)),
    ...(await readSource(input.db, input.view, input.sources.payments, input.clientKey, 'payment', input.narrow)),
  ].filter((entry) => entry.date <= to);

  let opening = 0n;
  const inPeriod: Entry[] = [];
  for (const entry of entries) {
    if (from !== null && entry.date < from) opening += entry.kind === 'document' ? entry.amount : -entry.amount;
    else inPeriod.push(entry);
  }
  inPeriod.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.kind === b.kind ? 0 : a.kind === 'document' ? -1 : 1) ||
      a.key.localeCompare(b.key, 'en', { numeric: true }),
  );

  let balance = opening;
  let documents = 0n;
  let payments = 0n;
  const rows = inPeriod.map((entry) => {
    if (entry.kind === 'document') {
      balance += entry.amount;
      documents += entry.amount;
    } else {
      balance -= entry.amount;
      payments += entry.amount;
    }
    return { date: entry.date, kind: entry.kind, number: entry.number, amount: unscaled(entry.amount), balance: unscaled(balance) };
  });

  return {
    fields: {
      period: input.period,
      periodFrom: from ?? '',
      periodTo: to,
      openingBalance: unscaled(opening),
      documentsTotal: unscaled(documents),
      paymentsTotal: unscaled(payments),
      closingBalance: unscaled(balance),
    },
    collections: { entries: rows },
  };
}
