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
 * table THIS person reaches? If it does, the thing is not theirs to be given
 * unless they are the one it was made for.
 *
 * NEARLY EVERYONE PAYS NOTHING. Nobody is limited unless a grant of theirs
 * carries a row limit or the connection has a private table; both are known
 * without loading a schema, so for everybody else no schema is loaded, and
 * the answer is the one they always got. For the others it is loaded once
 * per request and connection.
 *
 * IT FAILS CLOSED, for them alone: somebody who could be limited, asked
 * about a schema that cannot be read or a table it has not, reaches nothing.
 */
import type { MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';

import type { EffectiveModel } from '../connections/effective-schema.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import type { SnapshotView } from './identifiers.js';
import type { RowAction, RowLimitContext } from './row-limit.js';
import { rowLimitContextOf, rowTestOf } from './row-limit-context.js';

/** A server mounted with no permission resolver limits nobody (a test's bare routes). */
function resolves(request: FastifyRequest): boolean {
  return request.server.hasDecorator('rbac') && typeof (request.server.rbac as { resolve?: unknown }).resolve === 'function';
}

/** What it takes to ask which rows this request's caller reaches, for a caller with the model in hand; null for nearly everyone. */
export async function rowsForRequest(meta: MetaDb, request: FastifyRequest, connectionId: string, model: Pick<EffectiveModel, 'tables' | 'relations' | 'dialect'>): Promise<RowLimitContext | null> {
  if (!resolves(request)) return null;
  return rowLimitContextOf(meta, await request.server.rbac.resolve(request), connectionId, model);
}

/** A caller something could limit, with the schema their rows are judged by. */
export interface RequestReach {
  view: SnapshotView;
  rows: RowLimitContext;
}

const asked = new WeakMap<FastifyRequest, Map<string, Promise<RequestReach | 'unreadable' | null>>>();

/**
 * The same for a caller with NO model in hand. Null: nothing limits this
 * person on the connection (and no schema was loaded to find that out).
 * `'unreadable'`: something could, and the schema that would say which rows
 * cannot be read — the caller treats them as reaching nothing.
 */
export function reachOfRequest(meta: MetaDb, request: FastifyRequest, connectionId: string): Promise<RequestReach | 'unreadable' | null> {
  let known = asked.get(request);
  if (known === undefined) asked.set(request, (known = new Map()));
  const before = known.get(connectionId);
  if (before !== undefined) return before;
  const answer = (async (): Promise<RequestReach | 'unreadable' | null> => {
    if (!resolves(request)) return null;
    const set = await request.server.rbac.resolve(request);
    if (set.rowLimits === undefined) {
      // No grant of theirs holds them to rows: only a private table could, and that is one small question.
      const marked = await meta.db.selectFrom('adminium_schema_overrides').select('id').where('connectionId', '=', connectionId).where('op', '=', 'table.private' as never).where('status', '=', 'active').limit(1).executeTakeFirst();
      if (marked === undefined) return null;
    }
    let view: SnapshotView;
    try {
      view = await loadSnapshotView(meta, connectionId);
    } catch {
      return 'unreadable';
    }
    const rows = await rowLimitContextOf(meta, set, connectionId, view.model);
    return rows === null ? null : { view, rows };
  })();
  known.set(connectionId, answer);
  return answer;
}

/**
 * Whether nothing limits which rows of a table this request's caller reaches
 * for `action`. `table` is the table's id, or the name a stored record kept
 * of it. Somebody nothing could limit is never asked about the table at all:
 * one that is gone, renamed or left out of the schema since is still theirs.
 */
export async function requestReadsWhole(meta: MetaDb, request: FastifyRequest, connectionId: string, table: string, action: RowAction = 'read'): Promise<boolean> {
  const reach = await reachOfRequest(meta, request, connectionId);
  if (reach === null) return true;
  if (reach === 'unreadable') return false;
  const found = reach.view.linkTable(table) ?? reach.view.linkTable(reach.view.model.tables.find((one) => one.name === table)?.id ?? '');
  return found !== null && rowTestOf(reach.rows, found.id, action) === null;
}
