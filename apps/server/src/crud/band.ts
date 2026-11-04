// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE BAND A NUMBER FALLS IN (`column.band`) — a link Adminium fills with the
 * row of a band table a number of the row is placed in: a line's quantity
 * among its product's price breaks, an order's weight among the delivery
 * bands.
 *
 * The pick: of the band rows within the rule's `scope` (the same product as
 * the line) whose `min` is at most the number, the one with the greatest
 * `min`. None — a product with no breaks, a number below every band, an
 * empty number, a scope column left empty — leaves the link empty, and a
 * formula reading what is copied through it says what that means
 * (`coalesce`: "multiplier 1", "delivery to quote"). A picked row with a
 * `max` the number is past is OVER: the write is refused (`refuse`, the
 * default) with `out-of-range` on the number's column, or the link is left
 * empty (`empty`: a parcel too heavy for any band, quoted by hand).
 *
 * WHEN it is picked follows from what the number is:
 *
 *  - a column the write itself sets (typed, defaulted, copied): in RESOLVE,
 *    beside the copies (`decided-columns.ts`), before every copy that reads
 *    through the link — so the copied price and the formulas after it see
 *    the band in the same write, a quote included;
 *  - a formula of the row: after the row's formulas, which are then worked
 *    out again over what is copied through the link (`write-service.ts`,
 *    FORMULA);
 *  - a total of child rows, or a formula over one (an order's weight): in
 *    the row's SETTLE (`settleParent`), after the totals and the formulas
 *    over them, then the copies through the link again and the formulas over
 *    those — on every write that moves the total, a quote included.
 *
 * Nobody else writes the link: a writer's value for it is dropped (an import
 * and an undo keep theirs, as history), and no public entry may list it.
 */
import { ratioText, toRatio } from '@adminium/manifest';
import type { Dialect } from '@adminium/engine';
import { sql, type Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import { ValidationFailedError } from '../errors.js';
import type { ColumnBand, TableRules } from './column-rules.js';
import { evaluateAll, touchedFormulas } from './formulas.js';
import type { Row } from './mask.js';

type Db = Kysely<SourceDatabase>;

/** A `column.band` rule, compiled against the model (kept with the other compiled rules). */
export type { ColumnBand } from './column-rules.js';

/** What the pick gives: the band row's key (null for none), or `over` for a number past the top of its band. */
export type BandPick = { link: unknown } | { over: true };

/** The number as an exact SQL literal (digits, a point and a sign only), or null for no number. */
function numberLiteral(value: unknown): string | null {
  const ratio = toRatio(value);
  if (ratio === null) return null;
  const text = ratioText(ratio, 12).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  // Only digits, a sign and a point reach the statement.
  return /^-?\d+(\.\d+)?$/.test(text) ? text : null;
}

/** Whether `a` is greater than `b`, exactly, as numbers. */
function greater(a: unknown, b: unknown): boolean {
  const x = toRatio(a);
  const y = toRatio(b);
  if (x === null || y === null) return false;
  return x.n * y.d > y.n * x.d;
}

/**
 * The band `row` falls in. `row` is the row as it will stand: the stored row
 * with the write's values over it. Read on the write's own handle, so a
 * quote reads what the save reads.
 */
export async function pickBand(db: Db, band: ColumnBand, row: Readonly<Row>): Promise<BandPick> {
  const literal = numberLiteral(row[band.value]);
  if (literal === null) return { link: null };
  const scope: { column: string; value: unknown }[] = [];
  for (const pair of band.scope) {
    const value = row[pair.equals];
    // A row with nothing to scope by (a line with no product yet) is in no band.
    if (value === null || value === undefined) return { link: null };
    scope.push({ column: pair.column, value });
  }
  // The number is compared in the database as an exact literal: a decimal on Postgres and MySQL, whatever the bound's own type.
  let query = db
    .selectFrom(band.table as never)
    .select([sql<unknown>`${sql.ref(band.key)}`.as('key'), ...(band.max === undefined ? [] : [sql<unknown>`${sql.ref(band.max)}`.as('max')])])
    .where(sql<boolean>`${sql.ref(band.min)} <= ${sql.raw(literal)}`);
  for (const part of scope) query = query.where((eb) => eb(db.dynamic.ref(part.column), '=', part.value as never));
  const found = (await query
    .orderBy(sql.ref(band.min), 'desc')
    .orderBy(sql.ref(band.key), 'asc')
    .limit(1)
    .executeTakeFirst()) as { key?: unknown; max?: unknown } | undefined;
  if (found === undefined) return { link: null };
  const max = found.max;
  if (band.max !== undefined && max !== null && max !== undefined && greater(row[band.value], max)) return { over: true };
  return { link: found.key ?? null };
}

/**
 * The refusal of a number past the top of its band: `out-of-range` on the
 * number's column, with the reason a public door tells a guest by (an
 * order too heavy for any delivery band is about the guest's own order, as a
 * booking out of range is).
 */
export function overRefusal(band: Pick<ColumnBand, 'value'>): ValidationFailedError {
  return new ValidationFailedError('Some values were refused.', { fields: { [band.value]: { code: 'out-of-range' } }, column: band.value, reason: 'BAND_OUT_OF_RANGE' });
}

/** The link a pick leaves, or the refusal it is. */
export function linkOf(band: ColumnBand, pick: BandPick): unknown {
  if ('link' in pick) return pick.link;
  if (band.over === 'empty') return null;
  throw overRefusal(band);
}

/**
 * The columns copied through each band link, read for `link` (null when the
 * link is empty: what was copied through it goes with it). One read per band
 * row, shared by the copies.
 */
export async function copiedThrough(db: Db, band: ColumnBand, link: unknown): Promise<Row> {
  const out: Row = {};
  if (band.copies.length === 0) return out;
  if (link === null || link === undefined) {
    for (const copy of band.copies) out[copy.column] = null;
    return out;
  }
  const columns = [...new Set(band.copies.map((copy) => copy.from))];
  const found = (await db
    .selectFrom(band.table as never)
    .select(columns.map((column) => sql<unknown>`${sql.ref(column)}`.as(column)))
    .where((eb) => eb(db.dynamic.ref(band.key), '=', link as never))
    .executeTakeFirst()) as Row | undefined;
  for (const copy of band.copies) out[copy.column] = found?.[copy.from] ?? null;
  return out;
}

/** Whether a write's values move a band: a create, or a change of the number or a scope column. */
export function bandMoved(band: Pick<ColumnBand, 'value' | 'scope'>, action: 'create' | 'update', values: Row): boolean {
  if (action === 'create') return true;
  const has = (column: string) => Object.prototype.hasOwnProperty.call(values, column);
  return has(band.value) || band.scope.some((pair) => has(pair.equals));
}

/** Whether two values of a link name the same row: a key reads as a number from one door and as text from another. */
const sameLink = (a: unknown, b: unknown): boolean =>
  a === null || a === undefined || b === null || b === undefined ? (a ?? null) === (b ?? null) : String(a) === String(b);

const has = (values: Row, column: string) => Object.prototype.hasOwnProperty.call(values, column);

/**
 * FORMULA, the bands over a formula of the row: picked from the row as the
 * write leaves it (the stored row under the worked-out values), on a create
 * and whenever the number or a scope moves; what is copied through the link
 * taken again, and the formulas that read it worked out again. `values` are
 * the write's values after the formulas; the same object when nothing moves.
 * A total's band whose number is a formula is picked here too, for a write
 * of the row itself; its settle picks it when the total moves.
 */
export async function bandsAfterFormulas(
  db: Db,
  rules: Pick<TableRules, 'bands' | 'formulas' | 'currencyColumn'>,
  action: 'create' | 'update',
  values: Row,
  stored: Row | null,
  connectionCurrency: () => Promise<string | null>,
): Promise<Row> {
  const formulaColumns = new Set((rules.formulas ?? []).map((formula) => formula.column));
  const bands = (rules.bands ?? []).filter((band) => band.when !== 'resolve' && formulaColumns.has(band.value));
  if (bands.length === 0 || (action === 'update' && stored === null)) return values;
  let out: Row | null = null;
  const moved: string[] = [];
  for (const band of bands) {
    const current = out ?? values;
    if (!bandMoved(band, action, current)) continue;
    const row = { ...(stored ?? {}), ...current };
    const link = linkOf(band, await pickBand(db, band, row));
    if (action === 'update' && sameLink(stored?.[band.column], link)) continue;
    out ??= { ...values };
    out[band.column] = link;
    moved.push(band.column);
    const copied = await copiedThrough(db, band, link);
    for (const copy of band.copies) {
      // A copy that only fills what the writer left out keeps a value the writer gave.
      if (copy.mode === 'default' && has(values, copy.column)) continue;
      out[copy.column] = copied[copy.column];
      moved.push(copy.column);
    }
  }
  if (out === null) return values;
  const again = touchedFormulas(rules.formulas ?? [], moved).filter((formula) => !bands.some((band) => band.value === formula.column));
  if (again.length === 0) return out;
  const reads = again.some((formula) => formula.scale === 'currency');
  return { ...out, ...evaluateAll(again, { ...(stored ?? {}), ...out }, rules.currencyColumn, reads ? await connectionCurrency() : null) };
}

/**
 * SETTLE, the bands over a total: each picked again from the row as now
 * stored (its totals and the formulas over them just written), and — where
 * the link moves — the link and what is copied through it written in one
 * statement. The columns it moved, for the formulas over them to be worked
 * out again; none when no band moved.
 */
export async function settleBands(db: Db, dialect: Dialect, table: string, keyColumn: string, bands: readonly ColumnBand[], key: unknown): Promise<string[]> {
  if (bands.length === 0) return [];
  // Read holding the row, as the settle's formulas read it: on MySQL that is also what reads past the transaction's snapshot.
  let query = db
    .selectFrom(table as never)
    .selectAll()
    .where((eb) => eb(db.dynamic.ref(keyColumn), '=', key as never));
  if (dialect !== 'sqlite') query = dialect === 'postgres' ? query.forNoKeyUpdate() : query.forUpdate();
  const stored = (await query.executeTakeFirst()) as Row | undefined;
  if (stored === undefined) return [];
  const set: Row = {};
  for (const band of bands) {
    const link = linkOf(band, await pickBand(db, band, { ...stored, ...set }));
    if (sameLink(stored[band.column], link)) continue;
    set[band.column] = link;
    Object.assign(set, await copiedThrough(db, band, link));
  }
  const moved = Object.keys(set);
  if (moved.length === 0) return [];
  await db
    .updateTable(table as never)
    .set(set as never)
    .where((eb) => eb(db.dynamic.ref(keyColumn), '=', key as never))
    .execute();
  return moved;
}
