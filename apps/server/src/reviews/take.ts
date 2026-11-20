// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TAKING A REVIEW: one row a customer may review, read through the session
 * that reaches it, and the review written beside it by Adminium.
 *
 * Everything but the stars and the words comes from the server: the app
 * (the key's), the row reviewed (its table's ref and key), what it is about
 * (its link, and the thing's name copied), the name shown (the person's own,
 * cut to "Priya R."), and whose review it is (the person the row's claim
 * reaches, for erasure). The browser cannot name any of them.
 *
 * In ONE transaction:
 *  1. the row is read again and locked (Postgres, MySQL; SQLite writes one at
 *     a time) — nothing else of the order or the person is locked;
 *  2. a row already stamped is DONE (asked first: a reviewed line whose order
 *     was later cancelled is still "done", never "not yet");
 *  3. the `when` value is read along its links; outside `in` it is NOT_YET;
 *  4. what it is about, and the person, are read along their links; with no
 *     thing, no person, a person who is not the session's, or one who asked
 *     to be forgotten, it is REFUSED;
 *  5. the review is inserted, waiting; the unique set (app, row) refuses a
 *     second one as DONE;
 *  6. the row is stamped while its stamp is empty; none stamped is DONE.
 * Two sends at once: one inserts and stamps, the other meets the unique set
 * or the stamp, and is DONE. Nothing a refusal read is kept.
 */
import type { Dialect } from '@adminium/engine';
import { pathOf, type Review } from '@adminium/manifest';
import type { Kysely } from 'kysely';

import type { SourceDatabase } from '../connections/manager.js';
import { isUniqueViolation } from '../crud/decided-columns.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import { fetchByPk } from '../crud/records.js';
import { bindWriteValue } from '../crud/write-values.js';
import { withNamedLocks } from '../crud/capacity/locks.js';
import { relatedTarget } from '../automations/related.js';
import { yesNo } from '../automations/yes-no.js';
import { keyOf, shownNameOf, shownNameOfFull } from './tables.js';

type Db = Kysely<SourceDatabase>;

/** What the customer sent, already judged: whole stars 1–5, and words in the review text rule. */
export interface ReviewSent {
  stars: number;
  title: string | null;
  body: string | null;
}

export type TakeOutcome =
  | { kind: 'taken'; reviewedAt: string; before: Row; after: Row }
  | { kind: 'done' }
  | { kind: 'not-yet' }
  | { kind: 'refused' }
  | { kind: 'busy' };

class Stop extends Error {
  constructor(readonly outcome: Exclude<TakeOutcome, { kind: 'taken' }>) {
    super(outcome.kind);
  }
}

/** One value along a path: links followed row by row (plain reads), then the last column. With `ends: 'row'`, the row the links reach. */
async function follow(db: Db, view: SnapshotView, from: ResolvedTable, row: Row, path: readonly string[], ends: 'column' | 'row'): Promise<{ table: ResolvedTable; row: Row; value: unknown } | null> {
  let table = from;
  let at: Row = row;
  const links = ends === 'column' ? path.slice(0, -1) : path;
  for (const link of links) {
    const target = relatedTarget(view, table, link);
    const value = at[link];
    if (target === null || value === null || value === undefined || value === '') return null;
    const next = (await fetchByPk(db, target.table, { [target.key]: value })) ?? null;
    if (next === null) return null;
    table = target.table;
    at = next;
  }
  return { table, row: at, value: ends === 'column' ? at[path[path.length - 1]!] : undefined };
}

/** Whether a value is one of a list as a manifest writes it: text by its text, a yes or no by itself, a number by its value. */
function oneOf(value: unknown, list: readonly (string | number | boolean)[]): boolean {
  return list.some((candidate) => {
    if (typeof candidate === 'boolean') return yesNo(value) === candidate;
    if (typeof candidate === 'number') return Number(value) === candidate;
    return value !== null && value !== undefined && String(value) === candidate;
  });
}

const textOf = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

export interface TakeInput {
  db: Db;
  dialect: Dialect;
  view: SnapshotView;
  /** The reviewed table, and the row's key. */
  table: ResolvedTable;
  pk: Row;
  /** The app's word, and its tables' refs as its manifest names them. */
  app: string;
  word: Review;
  tableRef: string;
  refOf: (table: ResolvedTable) => string;
  /** The keeper's reviews table. */
  reviews: ResolvedTable;
  /** The person the session is, when the session is a person's own sign-in on the people's table: their key must be the one reached. */
  sessionPerson: { table: string; key: string } | null;
  /** A column of the people's table that is set once a person asked to be forgotten. */
  forgottenStamp: string | null;
  sent: ReviewSent;
  now: Date;
}

/** The review taken, or why not: see the header. */
export async function takeReview(input: TakeInput): Promise<TakeOutcome> {
  const { db, dialect, view, table, pk, word, reviews, sent, now } = input;
  const stamp = table.columns.get(word.stamp);
  if (stamp === undefined) return { kind: 'refused' };
  try {
    return await withNamedLocks({ db, dialect }, [], async (trx) => {
      let read = trx.selectFrom(table.id).selectAll();
      for (const [column, value] of Object.entries(pk)) read = read.where(trx.dynamic.ref(column), '=', value as never);
      const row = ((await (dialect === 'sqlite' ? read : read.forUpdate()).executeTakeFirst()) as Row | undefined) ?? null;
      if (row === null) throw new Stop({ kind: 'refused' });
      const stamped = row[word.stamp];
      if (stamped !== null && stamped !== undefined && stamped !== '') throw new Stop({ kind: 'done' });

      const when = await follow(trx, view, table, row, word.when.path, 'column');
      if (when === null || !oneOf(when.value, word.when.in)) throw new Stop({ kind: 'not-yet' });

      // What it is about: the link, and the thing's name (and second line) as they stand now.
      const aboutKey = row[word.about.link];
      const about = relatedTarget(view, table, word.about.link);
      if (about === null || aboutKey === null || aboutKey === undefined || aboutKey === '') throw new Stop({ kind: 'refused' });
      const name = await follow(trx, view, table, row, pathOf(word.about.name), 'column');
      const detail = word.about.detail === undefined ? null : await follow(trx, view, table, row, pathOf(word.about.detail), 'column');

      // Whose review it is: the person the row's claim reaches — the session's own, when it signed in as a person.
      const person = await follow(trx, view, table, row, word.person, 'row');
      if (person === null || person.table.primaryKey.length !== 1) throw new Stop({ kind: 'refused' });
      const personKey = textOf(person.row[person.table.primaryKey[0]!]);
      if (input.sessionPerson !== null && (input.sessionPerson.table !== person.table.id || input.sessionPerson.key !== personKey)) throw new Stop({ kind: 'refused' });
      if (input.forgottenStamp !== null) {
        const forgotten = person.row[input.forgottenStamp];
        if (forgotten !== null && forgotten !== undefined && forgotten !== '') throw new Stop({ kind: 'refused' });
      }
      const shown = 'full' in word.shownName ? shownNameOfFull(person.row[word.shownName.full]) : shownNameOf(person.row[word.shownName.first], word.shownName.last === undefined ? '' : person.row[word.shownName.last]);

      const at = now.toISOString();
      const column = (name: string) => reviews.columns.get(name);
      const moment = (name: string) => {
        const resolved = column(name);
        return resolved === undefined ? at : bindWriteValue(resolved, at, dialect);
      };
      const subjectKey = textOf(row[table.primaryKey[0]!]);
      const values: Row = {
        ...keyOf(reviews),
        app: input.app,
        subject_table: input.tableRef,
        subject_key: subjectKey,
        about_table: input.refOf(about.table),
        about_key: textOf(aboutKey),
        about_name: [...textOf(name?.value)].slice(0, 200).join(''),
        about_detail: detail === null || detail.value === null || detail.value === undefined ? null : [...textOf(detail.value)].slice(0, 200).join(''),
        stars: sent.stars,
        title: sent.title,
        body: sent.body,
        shown_name: shown,
        state: 'waiting',
        submitted_at: moment('submitted_at'),
        person_table: input.refOf(person.table),
        person_key: personKey,
      };
      try {
        await trx.insertInto(reviews.id).values(values as never).execute();
      } catch (error) {
        if (isUniqueViolation(error)) throw new Stop({ kind: 'done' });
        throw error;
      }
      let stampIt = trx.updateTable(table.id).set({ [word.stamp]: bindWriteValue(stamp, at, dialect) } as never);
      for (const [key, value] of Object.entries(pk)) stampIt = stampIt.where(trx.dynamic.ref(key), '=', value as never);
      const result = await stampIt.where(trx.dynamic.ref(word.stamp), 'is', null).executeTakeFirst();
      if (Number(result.numUpdatedRows ?? 0) === 0) throw new Stop({ kind: 'done' });
      const after = ((await fetchByPk(trx, table, pk)) ?? { ...row, [word.stamp]: at }) as Row;
      return { kind: 'taken' as const, reviewedAt: at, before: row, after };
    });
  } catch (error) {
    if (error instanceof Stop) return error.outcome;
    throw error;
  }
}

/** The name a review would show for this row's person, as `takeReview` would cut it; null when the row reaches nobody. */
export async function shownNameFor(db: Db, view: SnapshotView, table: ResolvedTable, row: Row, word: Review): Promise<string | null> {
  const person = await follow(db, view, table, row, word.person, 'row');
  if (person === null) return null;
  return 'full' in word.shownName ? shownNameOfFull(person.row[word.shownName.full]) : shownNameOf(person.row[word.shownName.first], word.shownName.last === undefined ? '' : person.row[word.shownName.last]);
}

/** Whether a row may be reviewed now: not stamped, and its `when` holds. */
export async function reviewOpen(db: Db, view: SnapshotView, table: ResolvedTable, row: Row, word: Review): Promise<boolean> {
  const stamped = row[word.stamp];
  if (stamped !== null && stamped !== undefined && stamped !== '') return false;
  const when = await follow(db, view, table, row, word.when.path, 'column');
  return when !== null && oneOf(when.value, word.when.in);
}

/** For a refusal of a database in use (two writers at once): the run is told to try again. */
export function lostToAnother(error: unknown): boolean {
  const code = (error as { code?: unknown; errno?: unknown } | null)?.code;
  const errno = (error as { errno?: unknown } | null)?.errno;
  return code === 'SQLITE_BUSY' || code === '40P01' || code === '40001' || errno === 1213 || code === 'ER_LOCK_DEADLOCK';
}

