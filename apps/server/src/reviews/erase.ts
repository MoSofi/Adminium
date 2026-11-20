// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A FORGOTTEN PERSON'S REVIEWS: their stars and words stay, their name goes.
 *
 * A review keeps whose it is (`person_table`, `person_key`: the app's ref of
 * the people's table, and the person's key) for this alone. When a person is
 * forgotten — "delete my details" on the app's own pages, or an erasure
 * staff run — each of their reviews shows no name (every page draws "A
 * customer" in its reader's language), and no longer says whose it is. The
 * stars, the words and the totals stay: the words are about the product,
 * the name was the personal part.
 *
 * Matched on the person within each app that keeps their table, by that
 * app's ref for it: never across two apps that name their tables alike. For
 * "delete my details" and an erasure held to some apps, those apps alone.
 */
import { appTablesRepo, realTableOf, type MetaDb } from '@adminium/meta';
import type { Kysely } from 'kysely';

import type { AddOnInstalls } from '../apps/table-ref.js';
import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { reviewTablesOn } from './tables.js';

/**
 * The (app, ref) pairs a people's table is known by in reviews: each app that
 * keeps a record of the table, with its own ref for it. A review names its
 * person's table by the reviewing app's ref, so a person is matched only
 * within the apps that hold their table — two apps that each call their own
 * table "customers" never match each other's people.
 */
async function pairsOf(meta: MetaDb, view: SnapshotView, people: ResolvedTable): Promise<{ app: string; ref: string }[]> {
  const out: { app: string; ref: string }[] = [];
  for (const record of await appTablesRepo(meta).forConnection(view.connectionId)) {
    let id: string | null;
    try {
      id = view.table(realTableOf(record)).id;
    } catch {
      id = view.linkTable(realTableOf(record))?.id ?? null;
    }
    if (id === people.id && !out.some((pair) => pair.app === record.appKey && pair.ref === record.ref)) out.push({ app: record.appKey, ref: record.ref });
  }
  return out;
}

/** The condition "a review of this person": one of the pairs, and the key. */
function ofPerson<Q extends { where: (...args: never[]) => Q }>(query: Q, pairs: readonly { app: string; ref: string }[], key: string): Q {
  return (query.where as (factory: (eb: never) => unknown) => Q)((eb: never) => {
    const b = eb as unknown as { and: (parts: unknown[]) => unknown; or: (parts: unknown[]) => unknown; (column: string, op: string, value: unknown): unknown };
    return b.and([b('person_key', '=', key), b.or(pairs.map((pair) => b.and([b('app', '=', pair.app), b('person_table', '=', pair.ref)])))]);
  });
}

/**
 * Takes the name and the person off every review of one person, in every
 * reviews add-on of the database, on `db` (the forgetting's own handle).
 * `app`: only that app's reviews; null for every app. Returns how many.
 */
export async function forgetReviews(
  input: { meta: MetaDb; installs: AddOnInstalls; view: SnapshotView; db: Kysely<SourceDatabase> },
  person: { table: ResolvedTable; key: string; app: string | null },
): Promise<number> {
  const keepers = reviewTablesOn(input.installs, input.view.connectionId);
  if (keepers.length === 0) return 0;
  const pairs = (await pairsOf(input.meta, input.view, person.table)).filter((pair) => person.app === null || pair.app === person.app);
  if (pairs.length === 0) return 0;
  let count = 0;
  for (const keeper of keepers) {
    const reviews = input.view.linkTable(keeper.reviews);
    if (reviews === null) continue;
    const change = ofPerson(input.db.updateTable(reviews.id as never).set({ shown_name: '', person_table: null, person_key: null } as never) as never, pairs, person.key) as unknown as { executeTakeFirst: () => Promise<{ numUpdatedRows?: bigint }> };
    const result = await change.executeTakeFirst();
    count += Number(result.numUpdatedRows ?? 0);
  }
  return count;
}

/** One person's reviews in one reviews table, by key: what an erasure staff run blanks, and scrubs from the audit log. */
export interface PersonReviews {
  connectionId: string;
  /** The add-on that keeps them. */
  addOn: string;
  table: ResolvedTable;
  keys: string[];
}

/**
 * The reviews of these people (their rows on one database), found before
 * anything is blanked. `apps`: an erasure held to some apps finds those
 * apps' reviews only; null finds every app's.
 */
export async function findPersonReviews(
  input: { meta: MetaDb; installs: AddOnInstalls; view: SnapshotView; db: Kysely<SourceDatabase> },
  people: readonly { table: ResolvedTable; key: string }[],
  apps: readonly string[] | null,
): Promise<PersonReviews[]> {
  const out: PersonReviews[] = [];
  for (const keeper of reviewTablesOn(input.installs, input.view.connectionId)) {
    const reviews = input.view.linkTable(keeper.reviews);
    const key = reviews?.primaryKey[0];
    if (reviews === null || key === undefined || reviews.primaryKey.length !== 1) continue;
    const keys = new Set<string>();
    for (const person of people) {
      const pairs = (await pairsOf(input.meta, input.view, person.table)).filter((pair) => apps === null || apps.includes(pair.app));
      if (pairs.length === 0) continue;
      const read = ofPerson(input.db.selectFrom(reviews.id as never).select(key as never) as never, pairs, person.key) as unknown as { execute: () => Promise<Record<string, unknown>[]> };
      for (const row of await read.execute()) keys.add(String(row[key]));
    }
    if (keys.size > 0) out.push({ connectionId: input.view.connectionId, addOn: keeper.addOn, table: reviews, keys: [...keys] });
  }
  return out;
}

/** The found reviews, their name and person taken off; their stars and words kept. Returns how many. */
export async function blankReviews(db: Kysely<SourceDatabase>, found: PersonReviews): Promise<number> {
  const key = found.table.primaryKey[0]!;
  let count = 0;
  for (let at = 0; at < found.keys.length; at += 500) {
    const result = await db
      .updateTable(found.table.id as never)
      .set({ shown_name: '', person_table: null, person_key: null } as never)
      .where(key as never, 'in', found.keys.slice(at, at + 500) as never)
      .executeTakeFirst();
    count += Number(result.numUpdatedRows ?? 0);
  }
  return count;
}
