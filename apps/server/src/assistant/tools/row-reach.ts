// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Whose rows the assistant reads. A tool reads as the person the turn runs
 * as, outside a request: the rows a role of theirs holds them to are the
 * rows the assistant may tell them of, by a list, a sample or a total
 * (`crud/row-limit.ts`). Null for nearly everyone: nothing limits them. With
 * no person behind the turn, no row of any table.
 */
import type { EffectiveModel } from '../../connections/effective-schema.js';
import type { RowLimitContext } from '../../crud/row-limit.js';
import { rowLimitContextForUser } from '../../crud/row-limit-context.js';
import type { AssistantToolDeps } from '../types.js';

export function rowsForAsker(deps: Pick<AssistantToolDeps, 'meta' | 'userId'>, connectionId: string, model: EffectiveModel): Promise<RowLimitContext | null> {
  return rowLimitContextForUser(deps.meta, deps.userId, connectionId, model);
}
