// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What a request or a job needs in hand to ask which rows a person reaches
 * (`row-limit.ts`): their permission set, the whole model, and the business's
 * calendar day. Null for nearly everyone — no grant of theirs carries a row
 * limit and the connection has no private table — and then nothing more is
 * read: no clock, no zone, no test.
 */
import { connectionTenantConfig, type MetaDb } from '@adminium/meta';

import type { EffectiveModel } from '../connections/effective-schema.js';
import { resolvePermissionSet, type PermissionSet } from '../rbac/resolver.js';
import { assertNotPrivate, mayBeRowLimited, rowLimitFor, type RowAction, type RowLimitContext, type RowTest } from './row-limit.js';
import { venueClock } from './venue-time.js';

export async function rowLimitContextOf(
  meta: MetaDb,
  set: Pick<PermissionSet, 'superAdmin' | 'rowLimits' | 'reach'>,
  connectionId: string,
  model: Pick<EffectiveModel, 'tables' | 'relations' | 'dialect'>,
  now: Date = new Date(),
): Promise<RowLimitContext | null> {
  if (!mayBeRowLimited(set, model)) return null;
  // A dated listing (cover for a colleague) counts by the business's day, as a stamp's "today" does.
  const zone = (await connectionTenantConfig(meta, connectionId))?.timezone ?? 'UTC';
  return { set, connectionId, model, today: venueClock(now, zone).day };
}

/** The test for one table and action, or null when the person reaches every row (or nothing can limit them). */
export function rowTestOf(rows: RowLimitContext | null, tableId: string, action: RowAction): RowTest | null {
  return rows === null ? null : rowLimitFor(rows, tableId, action);
}

/**
 * Hold a read's lookups and measures to the rows their reader reaches: each
 * table a lookup hops through, and each table a measure folds, gets that
 * table's own test inside its subquery. Without it a list of a person's own
 * deals would still add up every colleague's quotes beside them.
 */
export function limitProjections<L extends { hops: { refTable: { id: string }; rowTest?: RowTest | null | undefined }[] }, M extends { refTable: { id: string }; rowTest?: RowTest | null | undefined }>(
  rows: RowLimitContext | null,
  lookups: readonly L[],
  measures: readonly M[],
): void {
  if (rows === null) return;
  for (const lookup of lookups) for (const hop of lookup.hops) hop.rowTest = rowLimitFor(rows, hop.refTable.id, 'read');
  for (const measure of measures) measure.rowTest = rowLimitFor(rows, measure.refTable.id, 'read');
}

/**
 * The same for a read made OUTSIDE a request, as a person named by their id:
 * a job that runs for whoever asked, the assistant answering somebody. Their
 * permission set is resolved now, so a limit put on them since they asked
 * holds. With no person at all the read reaches no row.
 */
export async function rowLimitContextForUser(
  meta: MetaDb,
  userId: string | null | undefined,
  connectionId: string,
  model: Pick<EffectiveModel, 'tables' | 'relations' | 'dialect'>,
  now: Date = new Date(),
): Promise<RowLimitContext | null> {
  if (userId === null || userId === undefined) return { set: { superAdmin: false }, connectionId, model, today: venueClock(now, 'UTC').day, nobody: true };
  return rowLimitContextOf(meta, await resolvePermissionSet(meta, { kind: 'user', id: userId, label: '' }), connectionId, model, now);
}

/**
 * A file out of a table holds no value looked up from a private table and no
 * figure folded from one: the requester's own rows there are theirs on the
 * screen, and a file is not the screen (`assertNotPrivate`).
 */
export function assertNoPrivateProjection(lookups: readonly { hops: { refTable: object }[] }[], measures: readonly { refTable: object }[]): void {
  for (const lookup of lookups) for (const hop of lookup.hops) assertNotPrivate(hop.refTable as never, 'no file holds its values');
  for (const measure of measures) assertNotPrivate(measure.refTable as never, 'no file holds its figures');
}
