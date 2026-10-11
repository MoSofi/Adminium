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
import type { PermissionSet } from '../rbac/resolver.js';
import { mayBeRowLimited, rowLimitFor, type RowAction, type RowLimitContext, type RowTest } from './row-limit.js';
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
