// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHO MAY SEE A DRAFT AT A STRANGER'S DOOR (`?preview=1`).
 *
 * A preview draws a draft (a form's, a landing page's) and its pictures for
 * whoever builds it: a signed-in person (the dashboard's own session on this
 * host, never a key) who may read the add-on's table that holds it, WHOLE. A
 * role held to some of the table's rows (a row limit on read) is refused, as
 * the staff reads of the same add-on refuse it (`routes/landing`): a preview
 * names its row by slug or key, so a row past the limit would otherwise be
 * read whole, draft and pictures included.
 */
import type { MetaDb } from '@adminium/meta';
import type { FastifyRequest } from 'fastify';

import { isRowLimited } from '../../crud/row-limit.js';
import { rowLimitContextOf } from '../../crud/row-limit-context.js';
import { loadSnapshotView } from '../../data-io/snapshot-view.js';

/** Whether the request's signed-in person may preview a draft held in `tableId` on `connectionId` (see the header). */
export async function mayPreview(meta: MetaDb, request: FastifyRequest, connectionId: string, tableId: string): Promise<boolean> {
  if (request.user === null || request.user === undefined || request.session === null || request.session === undefined) return false;
  if (!(await request.can(`table:${connectionId}:${tableId}:read`))) return false;
  const set = await request.server.rbac.resolve(request);
  if (set.superAdmin === true) return true;
  const view = await loadSnapshotView(meta, connectionId, { forOthers: true }).catch(() => null);
  const context = view === null ? null : await rowLimitContextOf(meta, set, connectionId, view.model);
  return !(context !== null && isRowLimited(context, tableId, 'read'));
}
