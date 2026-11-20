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
 * Matched on the person, by any name their table is known by (its ref in
 * the app, and its name here), and — for "delete my details" and an erasure
 * held to one app — on that app too.
 */
import { appTablesRepo, realTableOf, type MetaDb } from '@adminium/meta';
import type { Kysely } from 'kysely';

import type { AddOnInstalls } from '../apps/table-ref.js';
import type { SourceDatabase } from '../connections/manager.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { reviewTablesOn } from './tables.js';

/** Every name a people's table is known by in reviews: the refs its apps give it, and its name here. */
async function namesOf(meta: MetaDb, view: SnapshotView, people: ResolvedTable): Promise<string[]> {
  const out = new Set<string>([people.name, people.id]);
  for (const record of await appTablesRepo(meta).forConnection(view.connectionId)) {
    let id: string | null;
    try {
      id = view.table(realTableOf(record)).id;
    } catch {
      id = view.linkTable(realTableOf(record))?.id ?? null;
    }
    if (id === people.id) out.add(record.ref);
  }
  return [...out];
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
  const names = await namesOf(input.meta, input.view, person.table);
  let count = 0;
  for (const keeper of keepers) {
    const reviews = input.view.linkTable(keeper.reviews);
    if (reviews === null) continue;
    let change = input.db
      .updateTable(reviews.id as never)
      .set({ shown_name: '', person_table: null, person_key: null } as never)
      .where('person_table' as never, 'in', names as never)
      .where('person_key' as never, '=', person.key as never);
    if (person.app !== null) change = change.where('app' as never, '=', person.app as never);
    const result = await change.executeTakeFirst();
    count += Number(result.numUpdatedRows ?? 0);
  }
  return count;
}

/** One person's reviews, as their data is listed and downloaded: what they wrote, about what, and when. */
export async function reviewsOfPerson(
  input: { meta: MetaDb; installs: AddOnInstalls; view: SnapshotView; db: Kysely<SourceDatabase> },
  person: { table: ResolvedTable; key: string },
): Promise<Record<string, unknown>[]> {
  const keepers = reviewTablesOn(input.installs, input.view.connectionId);
  if (keepers.length === 0) return [];
  const names = await namesOf(input.meta, input.view, person.table);
  const out: Record<string, unknown>[] = [];
  for (const keeper of keepers) {
    const reviews = input.view.linkTable(keeper.reviews);
    if (reviews === null) continue;
    const rows = (await input.db
      .selectFrom(reviews.id as never)
      .select(['app', 'about_name', 'stars', 'title', 'body', 'state', 'submitted_at', 'reply'] as never)
      .where('person_table' as never, 'in', names as never)
      .where('person_key' as never, '=', person.key as never)
      .execute()) as Record<string, unknown>[];
    out.push(...rows);
  }
  return out;
}

/** One person's reviews in one reviews table, by key: what an erasure staff run blanks, and scrubs from the audit log. */
export interface PersonReviews {
  connectionId: string;
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
      let read = input.db
        .selectFrom(reviews.id as never)
        .select(key as never)
        .where('person_table' as never, 'in', (await namesOf(input.meta, input.view, person.table)) as never)
        .where('person_key' as never, '=', person.key as never);
      if (apps !== null) read = read.where('app' as never, 'in', (apps.length === 0 ? [''] : apps) as never);
      for (const row of (await read.execute()) as Record<string, unknown>[]) keys.add(String(row[key]));
    }
    if (keys.size > 0) out.push({ connectionId: input.view.connectionId, table: reviews, keys: [...keys] });
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
