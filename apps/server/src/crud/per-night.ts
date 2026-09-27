// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PRICE — a column worked out night by night (`rules.perNight`): a stay's
 * room total, from the rate of the row its foreign key points at and the
 * adjustment rows that match each night (a weekend, a season).
 *
 *     FILL → RESOLVE → DECIDE → before hooks → PRICE → FORMULA → CHECK → statement
 *
 * It runs just before FORMULA, because formulas read the price (a subtotal,
 * the tax, the total). On a create it always runs; on a change only when the
 * change writes the dates or the rate's link — so rates edited later never
 * re-price a stored stay, and the dry run always prices fresh. An import
 * brings in history: a figure it gives is kept, one it leaves out is worked
 * out. Inside the change's transaction the price is worked out again from
 * the row as held, so a stay whose dates another writer just moved is never
 * stored with the price of the dates it no longer has.
 *
 * The nights are computed, never stored: this module also answers them for a
 * dry run, the desk's nightly lines and a folio's (with a stale guard: when
 * the rates changed since the stay was priced, one line equal to the stored
 * figure, so a document never prints lines that disagree with its total).
 *
 * Pure arithmetic lives in the manifest (`nightlyRates`): calendar days,
 * inclusive seasons, one rounding per night, the nights added up.
 */
import type { Kysely } from 'kysely';
import { dayNumberOf, nightlyRates, NightlyRuleUnreadable, PER_NIGHT_MAX, ratioText, toRatio, type Night } from '@adminium/manifest';

import { ConflictError } from '../errors.js';
import type { SourceDatabase } from '../connections/manager.js';
import { attachPriceIssues, type ColumnPerNight, type TableRules } from './column-rules.js';
import { placesFor } from './formulas.js';
import type { Row } from './mask.js';
import { sameValue } from './write-values.js';
import type { WriteAction, WriteOrigin } from './write-context.js';

type Db = Kysely<SourceDatabase>;

const has = (values: Row, column: string) => Object.prototype.hasOwnProperty.call(values, column);
const empty = (value: unknown) => value === null || value === undefined || value === '';

/** The same day, however each side spells it (a driver's date, a text day); else the same value. */
const sameDay = (a: unknown, b: unknown): boolean => {
  const [x, y] = [dayNumberOf(a), dayNumberOf(b)];
  return x === null || y === null ? sameValue(a, b) : x === y;
};

/**
 * Whether a change moves what the price is worked out from: its dates, or its
 * rate's link. Given the row as stored, only a value that differs from it —
 * a whole-row send that repeats the dates (a note changed) prices nothing
 * again, whatever the rates are today.
 */
export function repricedBy(rule: ColumnPerNight, values: Row, stored?: Row | null): boolean {
  const moves = (column: string, same: (a: unknown, b: unknown) => boolean) => has(values, column) && (stored === undefined || stored === null || !same(values[column], stored[column]));
  return moves(rule.from, sameDay) || moves(rule.to, sameDay) || moves(rule.rate.via, sameValue);
}

/** A price's nights as read: the rate row it read (with the columns asked for), the nights, and their total. */
export interface Priced {
  /** The total at the column's places, or null when a date, the link or the rate is empty. */
  total: string | null;
  nights: Night[];
  /** The row the rate was read from, with every column asked for. */
  rateRow: Row | null;
  /** More nights than one stay is priced for. */
  tooLong: boolean;
}

/**
 * The nights of `row` priced now, from the rate row and the adjustment rows
 * as they are, read on `db` (the write's transaction when there is one).
 * `extra` are more columns of the rate row to read (a document's
 * `room_type_id.name`). Throws 409 `NIGHTLY_RATE_UNREADABLE` for an
 * adjustment of this rate that cannot be read: a price is refused, never
 * worked out without a rule the operator wrote.
 */
export async function priceNights(db: Db, rule: ColumnPerNight, row: Row, places: number, extra: readonly string[] = []): Promise<Priced> {
  const none: Priced = { total: null, nights: [], rateRow: null, tooLong: false };
  const link = row[rule.rate.via];
  const first = dayNumberOf(row[rule.from]);
  const last = dayNumberOf(row[rule.to]);
  if (first !== null && last !== null && last - first > PER_NIGHT_MAX) return { ...none, tooLong: true };
  if (empty(link) || first === null || last === null || last <= first) return none;
  const columns = [...new Set([rule.rate.key, rule.rate.column, ...extra])];
  const rateRow = ((await db
    .selectFrom(rule.rate.table)
    .select(columns as never)
    .where((eb) => eb(db.dynamic.ref(rule.rate.key), '=', link))
    .executeTakeFirst()) ?? null) as Row | null;
  if (rateRow === null) return none;
  const adjust = rule.adjust;
  let rows: Row[] = [];
  if (adjust !== undefined) {
    const read = [adjust.key, adjust.add, adjust.name, adjust.via, adjust.weekdays, adjust.from, adjust.to, adjust.where?.column].filter(
      (column): column is string => column !== undefined,
    );
    let query = db.selectFrom(adjust.table).select([...new Set(read)] as never);
    // A rule of another rate is never read: only this rate's, and those for every rate.
    if (adjust.via !== undefined) query = query.where((eb) => eb.or([eb(db.dynamic.ref(adjust.via!), 'is', null), eb(db.dynamic.ref(adjust.via!), '=', link)]));
    rows = ((await query.orderBy(adjust.key as never).execute()) as Row[]).filter(
      (candidate) => adjust.where === undefined || sameValue(candidate[adjust.where.column], adjust.where.eq),
    );
  }
  try {
    const priced = nightlyRates({
      from: row[rule.from],
      to: row[rule.to],
      base: rateRow[rule.rate.column],
      scale: places,
      adjustments: rows.map((candidate) => ({
        add: candidate[adjust!.add],
        name: String(candidate[adjust!.name] ?? ''),
        typeMatch: adjust!.via === undefined || empty(candidate[adjust!.via]) || sameValue(candidate[adjust!.via], link),
        weekdays: adjust!.weekdays === undefined ? null : candidate[adjust!.weekdays],
        from: adjust!.from === undefined ? null : candidate[adjust!.from],
        to: adjust!.to === undefined ? null : candidate[adjust!.to],
      })),
    });
    return priced === null ? { ...none, rateRow } : { total: priced.total, nights: priced.nights, rateRow, tooLong: false };
  } catch (error) {
    if (!(error instanceof NightlyRuleUnreadable)) throw error;
    const unreadable = rows[error.index]!;
    const column = { weekdays: adjust!.weekdays, from: adjust!.from, to: adjust!.to, add: adjust!.add }[error.column] ?? error.column;
    throw new ConflictError('A rate rule this price reads cannot be read, so the price is not worked out. Correct the rule first.', 'NIGHTLY_RATE_UNREADABLE', {
      table: adjust!.table,
      key: unreadable[adjust!.key] ?? null,
      column,
    });
  }
}

/**
 * PRICE: the write's values with the price by the night worked out, over the
 * stored row (a change) with the values over it — or the same object when
 * there is nothing to price.
 * A stay too long to price leaves the column empty and its `to` refused at
 * CHECK (`out-of-range`).
 */
export async function priceValues(
  rules: TableRules | null,
  action: WriteAction,
  db: Db,
  values: Row,
  stored: Row | null,
  opts: {
    origin?: WriteOrigin | undefined;
    currency: () => Promise<string | null>;
    /**
     * Price whenever the change names the dates or the rate, moved or not: a
     * change priced first against a row read before it is held, which decides
     * again against the row as held (`update`).
     */
    named?: true | undefined;
  },
): Promise<Row> {
  const rule = rules?.perNight;
  if (rule === undefined || action === 'delete') return values;
  // History keeps the figure it was charged at.
  if (opts.origin === 'import' && has(values, rule.column) && !empty(values[rule.column])) return values;
  if (action === 'update' && (stored === null || !repricedBy(rule, values, opts.named === true ? undefined : stored))) return values;
  const row = { ...(stored ?? {}), ...values };
  const places = placesFor(rule.scale, row, rules?.currencyColumn, rule.scale === 'currency' ? await opts.currency() : null);
  const priced = await priceNights(db, rule, row, places);
  const out: Row = { ...values, [rule.column]: priced.total };
  if (priced.tooLong) attachPriceIssues(out, { [rule.to]: { code: 'out-of-range' } });
  return out;
}

/** One line of a stay's nights as the desk and a document show them: a night (qty 1), or the one stale line. */
export interface NightLine {
  date: string;
  /** The night's rate; null on the stale line. */
  rate: string | null;
  base: string | null;
  tags: string[];
  qty: string;
  amount: string | null;
  /** The rate row's columns a document asked for (`room_type_id.name`). */
  columns: Row;
}

/** The nights of a stored row, for the desk and a folio, with the stale guard. */
export interface StoredNights {
  lines: NightLine[];
  /** The stored figure and what the nights add up to now differ: the rates changed after the stay was priced. */
  stale: boolean;
  total: string | null;
}

/**
 * A stored row's nights, priced from the rates as they are now: one line per
 * night, with `extra` columns of the rate row beside each. When they no
 * longer add up to the stored figure (the rates changed after the stay was
 * priced), ONE line instead — the first night's date, the nights' count as
 * its quantity, no rate, the stored figure as its amount — so no document
 * prints lines that disagree with its total.
 */
export async function storedNights(db: Db, rules: TableRules, row: Row, currency: string | null, extra: readonly string[] = []): Promise<StoredNights> {
  const rule = rules.perNight!;
  const places = placesFor(rule.scale, row, rules.currencyColumn, currency);
  const stored = row[rule.column];
  const priced = await priceNights(db, rule, row, places, extra);
  const storedText = toRatio(stored) === null ? null : ratioText(toRatio(stored)!, places);
  const columns = (rateRow: Row | null) => Object.fromEntries(extra.map((column) => [column, rateRow?.[column] ?? null]));
  const same = priced.total !== null && storedText !== null && priced.total === storedText;
  if (same) {
    return {
      lines: priced.nights.map((night) => ({ ...night, qty: '1', amount: night.rate, columns: columns(priced.rateRow) })),
      stale: false,
      total: storedText,
    };
  }
  if (storedText === null) return { lines: [], stale: false, total: null };
  const from = dayNumberOf(row[rule.from]);
  const to = dayNumberOf(row[rule.to]);
  const count = from === null || to === null || to <= from ? 1 : to - from;
  const date = from === null ? '' : new Date(from * 86_400_000).toISOString().slice(0, 10);
  return {
    lines: [{ date, rate: null, base: null, tags: [], qty: String(count), amount: storedText, columns: columns(priced.rateRow) }],
    stale: true,
    total: storedText,
  };
}

/**
 * The nights a quote's row is priced for, as a dry run answers them
 * (`[{date, rate, base, tags}]`: `base` is the rate before the night's
 * adjustments, so a raised night shows what it was), or undefined when its table prices nothing by the
 * night — or when the caller is not shown the priced column (`shown`): the
 * nights are that column, line by line. Priced from the rates as they are,
 * as the quote's own price was.
 */
export async function quoteNights(
  db: Db,
  rules: TableRules | null,
  row: Row,
  currency: () => Promise<string | null>,
  shown: (column: string) => boolean,
): Promise<{ date: string; rate: string; base: string; tags: string[] }[] | undefined> {
  const rule = rules?.perNight;
  if (rule === undefined || !shown(rule.column)) return undefined;
  const places = placesFor(rule.scale, row, rules?.currencyColumn, rule.scale === 'currency' ? await currency() : null);
  const priced = await priceNights(db, rule, row, places);
  return priced.nights.map(({ date, rate, base, tags }) => ({ date, rate, base, tags }));
}
