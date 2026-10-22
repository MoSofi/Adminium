// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A RULE RUN ABOUT A SAMPLE ROW.
 *
 * Sample people are staff who cannot sign in (status `sample`), and a rule
 * hands a row to nobody who cannot sign in: a person suspended, removed, or a
 * sample. On the sample itself that turned a sample job's sign-off into a
 * failed write, as its aftercare call must have an owner and the job's rep
 * is a sample person. So a rule's write may name a sample person when, and
 * only when, the row the run is about is a sample row: a real row is never
 * handed to somebody who does not exist.
 *
 * What such a run makes is sample too: each row it creates is entered in the
 * lists that name the row it ran from (`listRuleMadeRow`), so "Remove sample
 * data" takes it with them. A row a real person wrote is never entered.
 */
import type { User } from '@adminium/meta';

import { listRuleMadeRow, sampleListsNaming, type SampleList } from '../apps/sample-data.js';
import type { ResolvedTable } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import type { ActionContext } from './actions/types.js';

/** One look for each read of a run's record (a step reads the record again, and asks again). */
const looked = new WeakMap<object, Promise<SampleList[]>>();

/** The sample lists that name the row this run is about; none for a real row, a removed row or a run about no row. */
export function sampleListsOfRun(ctx: Pick<ActionContext, 'meta' | 'source'>): Promise<SampleList[]> {
  const source = ctx.source;
  if (source === null || source.removed === true) return Promise.resolve([]);
  let found = looked.get(source);
  if (found === undefined) {
    const pk = Object.fromEntries(source.table.primaryKey.map((column) => [column, source.row[column] ?? (source.record.pk as Row)[column]]));
    found = sampleListsNaming(ctx.meta, source.db, source.connectionId, source.table, pk).catch(() => []);
    looked.set(source, found);
  }
  return found;
}

/** Whether a rule's write may name this person: a sample person, on a run about a sample row. */
export async function mayNameSample(ctx: Pick<ActionContext, 'meta' | 'source'>, user: Pick<User, 'status'>): Promise<boolean> {
  if (user.status !== 'sample') return false;
  return (await sampleListsOfRun(ctx)).length > 0;
}

/** A row the run just made, entered as sample when the run is about a sample row. */
export async function listWhenSample(ctx: Pick<ActionContext, 'meta' | 'source' | 'now'>, table: ResolvedTable, row: Row): Promise<void> {
  const source = ctx.source;
  if (source === null) return;
  const lists = await sampleListsOfRun(ctx);
  if (lists.length === 0) return;
  const pk = Object.fromEntries(table.primaryKey.map((column) => [column, row[column]]));
  // The row is made either way: a list that cannot be written leaves it the operator's, as every rule-made row was before.
  await listRuleMadeRow(ctx.meta, { connectionId: source.connectionId, db: source.db, dialect: source.dialect, table }, pk, lists, ctx.now).catch(() => 0);
}
