// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHO LAST CHANGED ONE FIELD OF A RECORD, BY NAME.
 *
 * A fill refused because somebody changed a field since the sheet showed it
 * says who did ("Registered address was changed by Dana Whitlock after you
 * looked"). The record's own history says it: the newest change of the
 * record in the audit log (a person's, or a rule's) whose after-image holds
 * that column. A person is named by their display name (their e-mail when
 * they have none); a rule by its name. Nobody, when the change came from
 * outside Adminium (the database written directly) and the log holds none.
 *
 * Whoever may read the record may read its history (`GET …/history`), so
 * naming the changer to the person refused tells them nothing new.
 */
import { auditEntityKeyOf, usersRepo, type MetaDb } from '@adminium/meta';

import { parseJsonColumn } from '../routes/audit/index.js';

/** How far back the log is read for one record: a field changed further back is not "after you looked". */
const LOOK_BACK = 50;

export interface ChangedRecord {
  connectionId: string;
  /** The table's id in the snapshot. */
  tableId: string;
  /** The record's key (one-column keys: the value as the data routes take it). */
  key: string;
}

const isImage = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The name of whoever last changed `column` of the record, or null when the log names nobody. */
export async function lastChangerOf(meta: MetaDb, record: ChangedRecord, column: string): Promise<string | null> {
  const keys = auditEntityKeyOf({ table: record.tableId, pk: { key: record.key } });
  const rows = await meta.db
    .selectFrom('adminium_audit_log')
    .select(['actorKind', 'actorId', 'actorLabel', 'changes'])
    .where('connectionId', '=', record.connectionId)
    .where('entityTable', '=', keys.entityTable)
    .where('entityId', '=', keys.entityId)
    .where((eb) => eb.or([eb('category', '=', 'data'), eb.and([eb('category', '=', 'automation'), eb('action', '=', 'record.update')])]))
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .limit(LOOK_BACK)
    .execute();
  for (const row of rows) {
    const changes = parseJsonColumn(row.changes) as { before?: unknown; after?: unknown } | null;
    const after = changes?.after;
    if (!isImage(after) || !(column in after)) continue;
    // An after-image may hold the whole row: a change that left this column as it was is not its change.
    const before = changes?.before;
    if (isImage(before) && column in before && JSON.stringify(before[column]) === JSON.stringify(after[column])) continue;
    if (row.actorKind === 'user' && row.actorId !== null) {
      const user = await usersRepo(meta).findById(row.actorId);
      const name = user?.name?.trim();
      if (name !== undefined && name !== '') return name;
    }
    const label = row.actorLabel.trim();
    return label === '' ? null : label;
  }
  return null;
}
