// SPDX-License-Identifier: AGPL-3.0-only
/**
 * HANDING A PERSON'S ROWS TO SOMEBODY ELSE.
 *
 * Done when a person is suspended or removed, and at no other time: while
 * they are here their rows are theirs, and a manager who wants one moves it
 * through the table's own hand-over button, which is judged and recorded
 * row by row. Here the rows move in bulk, so what may be done is narrow:
 *
 *  - only the columns that decide whose a row is (`crud/rows-naming.ts`);
 *  - only to somebody who is here (active) and whose roles read every table
 *    a row of which would become theirs: nobody is given rows they cannot open;
 *  - never a private table's rows;
 *  - one audit entry per table, with how many rows moved and to whom. Taking
 *    them yourself is allowed, and reads in the log as exactly that.
 */
import { usersRepo, type MetaDb, type User } from '@adminium/meta';

import type { ConnectionManager } from '../connections/manager.js';
import { handRowsOver, tablesHandedOver, type RowsHandedOver } from '../crud/rows-naming.js';
import { ConflictError, NotFoundError, ValidationFailedError } from '../errors.js';
import { permissionSetAllows, resolvePermissionSet } from './resolver.js';

export interface HandOverAudit {
  action: 'user.rows.hand-over';
  changes: { before: { userId: string }; after: { to: string; connectionId: string; table: string; column: string; rows: number } };
}

export async function handOverRows(
  deps: { meta: MetaDb; manager: ConnectionManager },
  input: { from: User; toId: string; audit: (entry: HandOverAudit) => Promise<void> },
): Promise<RowsHandedOver> {
  const { meta, manager } = deps;
  const { from } = input;
  const to = await usersRepo(meta).findById(input.toId);
  if (to === null) throw new NotFoundError('User not found.', { userId: input.toId });
  if (to.id === from.id) throw new ValidationFailedError('Hand the rows to somebody else.', { fields: { to: { code: 'same-person' } } });
  // Somebody who is here: not suspended, not yet arrived, and not a sample person, who can open nothing.
  if (to.status !== 'active') throw new ConflictError('That person cannot be given rows now.', 'CONFLICT', { reason: 'NOT_ACTIVE' });
  const permissions = await resolvePermissionSet(meta, { kind: 'user', id: to.id, label: to.email });
  const closed = (await tablesHandedOver(meta, manager, from.id)).filter((table) => !permissionSetAllows(permissions, `table:${table.connectionId}:${table.tableId}:read`));
  if (closed.length > 0) {
    throw new ConflictError(`${to.name} holds no role that reads ${closed.map((table) => table.tableLabel).join(', ')}. Give them one first, or hand the rows to somebody who does.`, 'CONFLICT', {
      reason: 'TAKER_CANNOT_READ',
      tables: closed.map((table) => ({ connectionId: table.connectionId, table: table.tableId, label: table.tableLabel })),
    });
  }
  const moved = await handRowsOver(meta, manager, from.id, to.id);
  for (const one of moved.named) {
    await input.audit({ action: 'user.rows.hand-over', changes: { before: { userId: from.id }, after: { to: to.id, connectionId: one.connectionId, table: one.tableId, column: one.column, rows: one.rows } } });
  }
  return moved;
}
