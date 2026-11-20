// SPDX-License-Identifier: AGPL-3.0-only
/**
 * REVIEWS: WHAT THE ENGINE HOLDS OF A REVIEWS ADD-ON'S TWO TABLES.
 *
 * An add-on that declares `addOn.reviews` keeps the reviews customers leave
 * on an app's rows, and the totals of the published ones. The engine writes
 * every review (`routes/public/reviews.ts`) and keeps every total; a person
 * — any role, the Super Admin's included, an undo aside — only moves a
 * review's state, gives the reason it is hidden, and replies:
 *
 *  - a person's create of a review, or any write of a total, is refused;
 *    nobody deletes either (staff hide a review instead);
 *  - a person's change of a review touches `state`, `hide_reason` and
 *    `reply` and nothing else, one review at a time; a reply is stamped
 *    (`replied_at`) by the engine; a review is hidden only with a reason;
 *  - every change of a review's state, by anybody, moves the totals in the
 *    same transaction ({@link applyTotals}): a review that becomes published
 *    adds one to the count, its stars to the sum and one to its stars' bar,
 *    on the row of the thing reviewed and on the app's own row; one that
 *    stops being published takes them off. A waiting or hidden review is in
 *    no total. Stars, what is reviewed and the app never change after a
 *    review is taken, so the change is exact, and atomic on every engine
 *    with no lock to name.
 *
 * The totals of every app are worked out again from the published reviews
 * when the add-on is installed or updated ({@link recountTotals}).
 */
import { addOnReviewsSchema, isAddOnManifest, REVIEW_STAFF_COLUMNS, type AddOnReviews, type Manifest } from '@adminium/manifest';
import type { Dialect } from '@adminium/engine';
import { sql, type Kysely } from 'kysely';

import type { AddOnInstalls } from '../apps/table-ref.js';
import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { randomUUID } from 'node:crypto';
import { ForbiddenError, ValidationFailedError } from '../errors.js';

type Db = Kysely<SourceDatabase>;

/** An add-on's reviews block, typed; null when it declares none. */
export function reviewsOf(manifest: Manifest): AddOnReviews | null {
  if (!isAddOnManifest(manifest)) return null;
  const block = (manifest.addOn as { reviews?: unknown }).reviews;
  if (block === undefined) return null;
  const parsed = addOnReviewsSchema.safeParse(block);
  return parsed.success ? parsed.data : null;
}

/** One reviews add-on on one database: its key and its two tables' ids. */
export interface ReviewTables {
  connectionId: string;
  addOn: string;
  reviews: string;
  totals: string;
}

/** Every reviews add-on installed on a connection whose tables are both there. */
export function reviewTablesOn(installs: AddOnInstalls, connectionId: string): ReviewTables[] {
  const out: ReviewTables[] = [];
  for (const key of installs.keys?.(connectionId) ?? []) {
    const installed = installs.installed(connectionId, key);
    const block = installed === null ? null : reviewsOf(installed.manifest);
    if (installed === null || block === null) continue;
    const reviews = installs.tableOf(connectionId, key, block.reviews);
    const totals = installs.tableOf(connectionId, key, block.totals);
    if (reviews !== null && totals !== null) out.push({ connectionId, addOn: key, reviews, totals });
  }
  return out;
}

/** Whether a table is a reviews add-on's reviews, its totals, or neither. */
export function reviewTableKind(installs: AddOnInstalls, connectionId: string, tableId: string): { kind: 'reviews' | 'totals'; tables: ReviewTables } | null {
  for (const tables of reviewTablesOn(installs, connectionId)) {
    if (tables.reviews === tableId) return { kind: 'reviews', tables };
    if (tables.totals === tableId) return { kind: 'totals', tables };
  }
  return null;
}

/** What a person may write of a review: these columns, nothing else. */
const STAFF: ReadonlySet<string> = new Set(REVIEW_STAFF_COLUMNS);

/**
 * A person's change of a review, as the engine takes it: refused when it
 * writes anything but the state, the hide reason or the reply; with the
 * moment of a reply stamped. Returns the values to write.
 */
export function staffReviewValues(table: string, values: Row, now: Date): Row {
  const other = Object.keys(values).filter((column) => !STAFF.has(column));
  if (other.length > 0) {
    throw new ForbiddenError(`Only a review's state, the reason it is hidden and the reply can be changed. ${other.join(', ')} cannot.`, 'TABLE_FORBIDDEN', { table, reason: 'review-column', columns: other });
  }
  return 'reply' in values ? { ...values, replied_at: now.toISOString() } : values;
}

/** A person's create of a review, or a write of a total: refused, by name. */
export function refusePersonReviewWrite(table: string, kind: 'reviews' | 'totals', action: 'create' | 'bulk'): never {
  if (kind === 'totals') throw new ForbiddenError('Only Adminium writes these totals. You can read them.', 'TABLE_FORBIDDEN', { table, reason: 'adminium-writes' });
  throw new ForbiddenError(
    action === 'create' ? 'Reviews are left by customers. You can read and moderate them.' : 'Reviews are moderated one at a time.',
    'TABLE_FORBIDDEN',
    { table, reason: action === 'create' ? 'adminium-writes' : 'review-one-at-a-time' },
  );
}

/** A new row's key, when the table does not number its own: a UUID, as every key Adminium makes for an add-on's rows. */
export function keyOf(table: ResolvedTable): Row {
  const [key, ...more] = table.primaryKey;
  if (key === undefined || more.length > 0) return {};
  const type = table.columns.get(key)?.logicalType;
  return type === 'integer' || type === 'bigint' ? {} : { [key]: randomUUID() };
}

const published = (row: Row | null): row is Row => row !== null && row['state'] === 'published';
const starsOf = (row: Row): number | null => {
  const stars = Number(row['stars']);
  return Number.isInteger(stars) && stars >= 1 && stars <= 5 ? stars : null;
};

/**
 * One delta on one totals row: made first when it is not there (a published
 * review is the first of its thing), else added to, in ONE statement that
 * holds the row's lock on every engine.
 */
async function addTo(db: Db, dialect: Dialect, totals: ResolvedTable, key: { app: string; about_table: string; about_key: string }, sign: 1 | -1, stars: number): Promise<void> {
  const bars = { c1: 0, c2: 0, c3: 0, c4: 0, c5: 0 } as Record<string, number>;
  bars[`c${String(stars)}`] = sign;
  const values = { ...key, count: sign, sum: sign * stars, ...bars };
  // Postgres reads a bare column of the upsert as ambiguous (the row, or the one proposed): the row's, by the table's name.
  const current = (column: string) => (dialect === 'postgres' ? sql.ref(`${totals.name}.${column}`) : sql.ref(column));
  const increments = Object.fromEntries(['count', 'sum', 'c1', 'c2', 'c3', 'c4', 'c5'].map((column) => [column, sql`${current(column)} + ${sql.lit((values as unknown as Record<string, number>)[column] ?? 0)}`]));
  const insert = db.insertInto(totals.id as never).values({ ...keyOf(totals), ...values } as never);
  if (dialect === 'mysql') await insert.onDuplicateKeyUpdate(increments as never).execute();
  else await insert.onConflict((conflict) => conflict.columns(['app', 'about_table', 'about_key'] as never).doUpdateSet(increments as never)).execute();
}

/**
 * The totals a change of one review moves, written on `db` (the change's own
 * transaction). A review that becomes published is added to its thing's row
 * and the app's (`about` empty); one that stops being published is taken
 * off. The thing's row first, the app's last, on every change: two changes
 * at once take the rows' locks in one order.
 */
export async function applyTotals(db: Db, dialect: Dialect, totals: ResolvedTable, before: Row | null, after: Row | null): Promise<void> {
  const was = published(before);
  const is = published(after);
  if (was === is) return;
  const row = (is ? after : before) as Row;
  const stars = starsOf(row);
  if (stars === null) return;
  const sign: 1 | -1 = is ? 1 : -1;
  const app = String(row['app'] ?? '');
  await addTo(db, dialect, totals, { app, about_table: String(row['about_table'] ?? ''), about_key: String(row['about_key'] ?? '') }, sign, stars);
  await addTo(db, dialect, totals, { app, about_table: '', about_key: '' }, sign, stars);
}

/** A review moved to hidden carries its reason: refused otherwise, with the change. */
export function hiddenHasReason(table: string, after: Row | null): void {
  if (after === null || after['state'] !== 'hidden') return;
  const reason = after['hide_reason'];
  if (reason === null || reason === undefined || reason === '') {
    throw new ValidationFailedError('A review is hidden for one of the reasons given: choose one.', { table, field: 'hide_reason', reason: 'hide-reason-needed' });
  }
}

/**
 * Every total worked out again from the published reviews, in one
 * transaction: the rows of each thing and of each app as the reviews stand.
 * A repair, run when the add-on is installed or updated; it reads every
 * published review once.
 */
export async function recountTotals(db: Db, reviews: ResolvedTable, totals: ResolvedTable): Promise<void> {
  const rows = (await db
    .selectFrom(reviews.id as never)
    .select(['app', 'about_table', 'about_key', 'stars'] as never)
    .where('state' as never, '=', 'published' as never)
    .execute()) as Row[];
  const sums = new Map<string, { app: string; about_table: string; about_key: string; count: number; sum: number; c: number[] }>();
  const add = (app: string, about_table: string, about_key: string, stars: number) => {
    const key = JSON.stringify([app, about_table, about_key]);
    const at = sums.get(key) ?? { app, about_table, about_key, count: 0, sum: 0, c: [0, 0, 0, 0, 0] };
    at.count += 1;
    at.sum += stars;
    at.c[stars - 1]! += 1;
    sums.set(key, at);
  };
  for (const row of rows) {
    const stars = starsOf(row);
    if (stars === null) continue;
    const app = String(row['app'] ?? '');
    add(app, String(row['about_table'] ?? ''), String(row['about_key'] ?? ''), stars);
    add(app, '', '', stars);
  }
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom(totals.id as never).execute();
    for (const one of sums.values()) {
      await trx
        .insertInto(totals.id as never)
        .values({ ...keyOf(totals), app: one.app, about_table: one.about_table, about_key: one.about_key, count: one.count, sum: one.sum, c1: one.c[0], c2: one.c[1], c3: one.c[2], c4: one.c[3], c5: one.c[4] } as never)
        .execute();
    }
  });
}

/**
 * The name a review shows: the first name and the last name's first letter
 * ("Priya R."), the first name alone, or — when there is none — empty, which
 * every page draws as "A customer" in its reader's language. Never more than
 * 80 characters; never a name typed by the reviewer.
 */
export function shownNameOf(first: unknown, last: unknown): string {
  const clean = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '');
  const given = clean(first);
  const family = clean(last);
  const initial = family === '' ? '' : `${[...family][0]!.toLocaleUpperCase()}.`;
  const shown = given === '' ? '' : initial === '' ? given : `${given} ${initial}`;
  return [...shown].slice(0, 80).join('');
}

/** A whole name cut as {@link shownNameOf} cuts two: its first word, and its last word's initial. */
export function shownNameOfFull(full: unknown): string {
  const words = typeof full === 'string' ? full.trim().split(/\s+/).filter((word) => word !== '') : [];
  return shownNameOf(words[0] ?? '', words.length > 1 ? words[words.length - 1] : '');
}
