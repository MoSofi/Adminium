// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE COLUMN DOOR — a consent-log event mirrored into the yes/no column an
 * app declares for one purpose (the CRM's `may_email`), with that column's
 * stamps (`may_email_by_id`, `may_email_at`), as the system.
 *
 * The log is the record and the column follows it. A change that comes from
 * the log (an unsubscribe, a bounce, the first-send review) is written here,
 * and not through a person's save, for one reason: the strict stamps. A save
 * drops any value sent for a strict stamp and stamps the writer instead, and a
 * system writer is nobody, so a save would leave the stamp naming whoever
 * ticked the box last: an unsubscribe would read "ticked by Dana". Here the
 * stamps say what the log says:
 *
 *  - who (`user-id`, `user-name`): the event's staff member for a staff or a
 *    review event, and empty for any other source (a link, a relay, a bounce);
 *  - when (`now`, `today`): the event's own time.
 *
 * Only the stamps that a change of this column fires are written (as the
 * save's own rule decides it, `stampFires`); a stamp of any other kind is
 * left as it is, and so is a column the target says to keep (the table's
 * opt-out mark: only a screen that showed the line sets it). One UPDATE writes the column and its stamps together, and an
 * audit entry says who (the staff member, or the system), what, and the log
 * event's source. A row whose column already says so is left alone, stamps
 * and all: re-sending a value stamps nothing, as a save would.
 */
import type { Kysely } from 'kysely';
import type { Dialect } from '@adminium/engine';
import { auditRepo, connectionTenantConfig, type ConsentEvent, type MetaDb } from '@adminium/meta';

import type { SourceDatabase } from '../connections/manager.js';
import { tableRulesFor, type ColumnStamp } from '../crud/column-rules.js';
import { stampFires } from '../crud/decide.js';
import type { ResolvedTable, SnapshotView } from '../crud/identifiers.js';
import { instantFor, renderNow } from '../crud/instants.js';
import type { Row } from '../crud/mask.js';
import { fetchByPk } from '../crud/records.js';
import { venueClock } from '../crud/venue-time.js';
import { bindWriteValue, booleanOf } from '../crud/write-values.js';
import { ValidationFailedError } from '../errors.js';
import { pkOfRowKey } from '../payments/payables.js';
import type { ApplyColumnResult, ConsentColumnTarget } from './types.js';

/** A source table as this door reaches it. */
export interface ConsentTableSource {
  table(connectionId: string, table: string): Promise<{ view: SnapshotView; table: ResolvedTable; db: Kysely<SourceDatabase>; dialect: Dialect } | null>;
}

/** Sources whose stamp names a person: a staff member wrote the event. */
const STAFF_SOURCES: ReadonlySet<string> = new Set(['staff', 'review']);

const NUMBER_TYPES: ReadonlySet<string> = new Set(['integer', 'bigint', 'decimal', 'float', 'smallint']);

export async function applyConsentToColumn(meta: MetaDb, source: ConsentTableSource, target: ConsentColumnTarget, event: ConsentEvent): Promise<ApplyColumnResult> {
  if (event.state === 'replied') throw new ValidationFailedError('A "replied" event is mirrored into no column.');
  const found = await source.table(target.connectionId, target.table);
  if (found === null) return 'missing';
  const { table, db, dialect, view } = found;
  const column = table.columns.get(target.column);
  if (column === undefined) throw new ValidationFailedError(`The table has no column "${target.column}".`, { field: 'column' });
  const numeric = NUMBER_TYPES.has(column.logicalType);
  if (column.logicalType !== 'boolean' && !numeric) throw new ValidationFailedError(`"${target.column}" is not a yes/no column.`, { field: 'column' });
  const pk = pkOfRowKey(table, target.key);
  if (pk === null) return 'missing';
  const before = await fetchByPk(db, table, pk);
  if (before === undefined) return 'missing';

  const yes = event.state === 'yes';
  if (booleanOf(before[target.column]) === yes) return 'unchanged';
  // As the column keeps a yes: a boolean on Postgres, 1 or 0 in a number column and on the two engines without one.
  const stored = !numeric && dialect === 'postgres' ? yes : yes ? 1 : 0;
  const values: Row = { [target.column]: stored };

  const staff = STAFF_SOURCES.has(event.source) ? { id: event.staffId, label: event.staffLabel } : { id: null, label: null };
  const at = new Date(event.at);
  let zone: string | null = null;
  const stamped: Record<string, unknown> = {};
  const stamps = (tableRulesFor({ view, table })?.stamps ?? []).filter((stamp: ColumnStamp) => stamp.column !== target.column && !(target.keep ?? []).includes(stamp.column) && stampFires(stamp, 'update', { [target.column]: yes }, before));
  for (const stamp of stamps) {
    const set = stamp.set;
    let value: unknown;
    if (set === 'user-id') value = staff.id;
    else if (set === 'user-name') value = staff.label;
    else if (set === 'now') value = renderNow({ logicalType: stamp.logicalType }, at) ?? instantFor(at);
    else if (set === 'today') value = venueClock(at, (zone ??= (await connectionTenantConfig(meta, target.connectionId))?.timezone ?? 'UTC')).day;
    else continue;
    const into = table.columns.get(stamp.column);
    if (into === undefined) continue;
    stamped[stamp.column] = value;
    values[stamp.column] = value === null ? null : bindWriteValue(into, value, dialect);
  }

  let update = db.updateTable(table.id).set(values as never);
  for (const [name, value] of Object.entries(pk)) update = update.where(db.dynamic.ref(name), '=', value as never);
  await update.execute();

  // An event with no id was never logged: a stranger's yes put back to no while only the do-not-email list stood.
  await auditRepo(meta).append({
    actorKind: staff.id !== null ? 'user' : 'system',
    actorId: staff.id,
    actorLabel: staff.label ?? 'Adminium',
    category: 'data',
    action: 'record.update',
    connectionId: target.connectionId,
    entity: { connectionId: target.connectionId, table: table.id, pk, label: target.key },
    changes: {
      before: { [target.column]: booleanOf(before[target.column]), ...Object.fromEntries(Object.keys(stamped).map((name) => [name, before[name] ?? null])) },
      after: { [target.column]: yes, ...stamped, consentSource: event.source, consentEvent: event.id === '' ? null : event.id },
    },
  });
  return 'written';
}
