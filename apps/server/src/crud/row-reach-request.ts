// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The questions a route OUTSIDE the data routes asks about the rows its
 * caller reaches (`row-limit.ts`): a route that hands out something made
 * from a table's rows — a file, an audit entry, a count, a document — and
 * has no row in hand to test.
 *
 * WHOLE OR NOT AT ALL. Such a thing was made from every row somebody could
 * read when it was made, and cannot be cut down to the caller's rows after
 * the fact. So the question is one: does anything limit which rows of that
 * table THIS person reads? If it does, the thing is not theirs to be given
 * unless they are the one it was made for.
 */
import type { MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';

import type { EffectiveModel } from '../connections/effective-schema.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import type { RowLimitContext } from './row-limit.js';
import { rowLimitContextOf, rowTestOf } from './row-limit-context.js';

/** What it takes to ask which rows this request's caller reaches; null for nearly everyone. */
export async function rowsForRequest(meta: MetaDb, request: FastifyRequest, connectionId: string, model: Pick<EffectiveModel, 'tables' | 'relations' | 'dialect'>): Promise<RowLimitContext | null> {
  // A server mounted with no permission resolver limits nobody (a test's bare routes).
  if (!request.server.hasDecorator('rbac') || typeof (request.server.rbac as { resolve?: unknown }).resolve !== 'function') return null;
  return rowLimitContextOf(meta, await request.server.rbac.resolve(request), connectionId, model);
}

/**
 * Whether nothing limits which rows of a table this request's caller reads.
 * `table` is the table's id, or the name a stored record kept of it. A table
 * that is gone, or a connection with no snapshot, answers no: nothing says
 * whose the rows were.
 */
export async function requestReadsWhole(meta: MetaDb, request: FastifyRequest, connectionId: string, table: string, asked?: Map<string, boolean>): Promise<boolean> {
  const key = `${connectionId}|${table}`;
  const known = asked?.get(key);
  if (known !== undefined) return known;
  let answer = false;
  try {
    const view = await loadSnapshotView(meta, connectionId);
    answer = rowTestOf(await rowsForRequest(meta, request, connectionId, view.model), view.table(table).id, 'read') === null;
  } catch {
    answer = false;
  }
  asked?.set(key, answer);
  return answer;
}
