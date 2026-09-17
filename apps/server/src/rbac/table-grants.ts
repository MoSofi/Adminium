// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Per-table read checks for code that runs OUTSIDE a
 * request.
 *
 * A derived column is a fold over ANOTHER table, so computing one in a
 * background job asks the same question the read path asks on every request:
 * may this principal read the table being folded? Inside a request that is
 * `request.can(...)`; a job has no request, so it resolves the same permission
 * set through the same two functions the route guards use — the point being
 * that there is one answer to "may they read it", not two.
 *
 * WHY IT REFUSES WITHOUT A PRINCIPAL, and why that is the important half.
 * Exports and scheduled reports carry the requesting user; a job that somehow
 * carries none has nobody to check against, and the only safe answer is no.
 * The alternative — evaluating measures unchecked because "it is a system
 * job" — would compute totals over tables the artifact's recipient may not
 * read and write them into a file they can download. The blank cell is the
 * feature.
 */

import type { MetaDb } from '@adminium/meta';

import { permissionSetAllows, resolvePermissionSet } from './resolver.js';

/**
 * A `canReadTable` predicate for one principal on one connection, matching the
 * shape `resolveMeasures`/`resolveLookups` take.
 *
 * `userId === null` answers `false` for every table, forever. The permission
 * set is resolved ONCE and reused: a job folds the same relation for every row
 * of an export, and re-resolving per call would put a meta query inside that
 * loop.
 */
export async function canReadTableFor(
  meta: MetaDb,
  userId: string | null | undefined,
  connectionId: string,
): Promise<(tableId: string) => Promise<boolean>> {
  if (userId === null || userId === undefined || userId === '') {
    return () => Promise.resolve(false);
  }
  const set = await resolvePermissionSet(meta, { kind: 'user', id: userId, label: userId });
  return (tableId: string) =>
    Promise.resolve(permissionSetAllows(set, `table:${connectionId}:${tableId}:read`));
}
