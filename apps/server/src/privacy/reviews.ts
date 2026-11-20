// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PERSON'S REVIEWS, IN THEIR DATA: the reviews a reviews add-on keeps that
 * one of their people rows left (`sources.ts` finds them, `export.ts`
 * downloads them, `erase.ts` takes their name off them).
 *
 * A review names its person by the reviewing app's ref of the people's
 * table and the person's key (`reviews/erase.ts`), so they are found through
 * the people rows the search found, within the apps that keep that table —
 * and, for a search held to some apps, those apps alone. What the download
 * writes of each is what they wrote and what became of it: the app, what it
 * is about, the stars, the title and words, the name it shows, its state, the
 * shop's reply and when it was sent. Never another person's.
 */
import type { MetaDb } from '@adminium/meta';
import type { Kysely } from 'kysely';

import type { AddOnInstalls } from '../apps/table-ref.js';
import type { ConnectionManager, SourceDatabase } from '../connections/manager.js';
import type { Row } from '../crud/mask.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { findPersonReviews, type PersonReviews } from '../reviews/erase.js';
import type { AppScope } from './scope.js';
import type { FoundSource } from './types.js';

/** What a review's line in the download shows. */
const SHOWN = ['app', 'about_name', 'about_detail', 'stars', 'title', 'body', 'shown_name', 'state', 'reply', 'replied_at', 'submitted_at'] as const;

export interface ReviewFindDeps {
  meta: MetaDb;
  manager: Pick<ConnectionManager, 'data'>;
  reviewInstalls?: (() => Promise<AddOnInstalls>) | undefined;
}

/** Their reviews, one reviews table at a time: what an erasure blanks, found before it does. */
export async function findReviewsOf(deps: ReviewFindDeps, people: readonly { connectionId: string; table: string; key: string }[], apps: AppScope): Promise<{ db: Kysely<SourceDatabase>; found: PersonReviews }[]> {
  if (deps.reviewInstalls === undefined || people.length === 0) return [];
  const installs = await deps.reviewInstalls();
  const out: { db: Kysely<SourceDatabase>; found: PersonReviews }[] = [];
  for (const connectionId of [...new Set(people.map((one) => one.connectionId))]) {
    const view = await loadSnapshotView(deps.meta, connectionId);
    const { db } = await deps.manager.data(connectionId);
    const theirs = people.flatMap((one) => {
      if (one.connectionId !== connectionId) return [];
      const table = view.linkTable(one.table);
      return table === null ? [] : [{ table, key: one.key }];
    });
    const handle = db as Kysely<SourceDatabase>;
    for (const found of await findPersonReviews({ meta: deps.meta, installs, view, db: handle }, theirs, apps === null ? null : [...apps])) out.push({ db: handle, found });
  }
  return out;
}

/** Their reviews as sources of their data, with the rows the download writes. */
export async function reviewSources(deps: ReviewFindDeps, people: readonly { connectionId: string; table: string; key: string }[], apps: AppScope, most: number): Promise<FoundSource[]> {
  const out: FoundSource[] = [];
  for (const { db, found } of await findReviewsOf(deps, people, apps)) {
    const key = found.table.primaryKey[0]!;
    const keys = found.keys.slice(0, most);
    const rows = (await db
      .selectFrom(found.table.id as never)
      .select([key, ...SHOWN].filter((column) => found.table.columns.has(column)) as never)
      .where(key as never, 'in', keys as never)
      .execute()) as Row[];
    out.push({
      id: `reviews-${found.table.name}`,
      kind: 'reviews',
      group: 'gave',
      connectionId: found.connectionId,
      table: found.table.id,
      app: found.addOn,
      ref: null,
      label: found.table.table.label ?? found.table.name,
      keptByLaw: null,
      count: found.keys.length,
      keys: rows.map((row) => String(row[key])),
      rows: rows.map((row) => Object.fromEntries(SHOWN.filter((column) => column in row).map((column) => [column, row[column] instanceof Date ? (row[column] as Date).toISOString() : row[column]]))),
    });
  }
  return out;
}
