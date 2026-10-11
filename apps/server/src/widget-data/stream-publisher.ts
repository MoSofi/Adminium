// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Widget-data stream publisher. The single place server code fans a data
 * mutation out to the live stream widgets subscribed to
 * `widget-data:{connectionId}:{table.id}` — the CRUD write path and, for
 * data-producing jobs, the job-completion path.
 *
 * PII/secret gating (acceptance #5, "never stream a forbidden column"): both the
 * row AND the primary key are masked here with `unmasked = false`, so secret
 * columns are stripped and PII columns nulled regardless of any subscriber's
 * grants. The pk gets the same treatment as the row because a natural key can
 * itself be a PII column (e.g. email/phone as the primary key) — leaving it raw
 * would leak the exact value the row masking nulls out. A subscriber still had
 * to pass the table-read check to be on the channel (`authorizeChannel`), but
 * masking is the belt-and-braces guarantee since the channel is shared across
 * roles. Publishing with no subscribers is a silent no-op.
 */

import type { ResolvedTable } from '../crud/identifiers.js';
import { staffInstants } from '../crud/instants.js';
import { maskRow, type Row } from '../crud/mask.js';
import { widgetDataChannel, type FrameReach, type RealtimeHub } from '../realtime/hub.js';

export interface WidgetStreamMutation {
  connectionId: string;
  /** Resolved snapshot table (carries the masking metadata + the id). */
  table: ResolvedTable;
  /** Event type, e.g. `record.create` | `record.update` | `record.delete`. */
  type: string;
  /**
   * Primary key of the affected row, keyed by PK column name (a `Row`). Masked
   * before publish just like `row`, since a natural key can be a PII column.
   */
  pk?: Row | null | undefined;
  /** Affected row: the after-image for create/update, the pre-image for delete. */
  row?: Row | null | undefined;
  /**
   * The row as it was before an update, when the caller has it: a row that
   * changed hands is then told to the person it left (its key, and no row)
   * as well as to the one it went to.
   */
  before?: Row | null | undefined;
  /** Event timestamp (ms); defaults to the hub's `Date.now()`. */
  at?: number | undefined;
}

/**
 * Whose the written row is, for each subscriber's filter (`realtime/read-
 * frames.ts`): the staff columns people belong to a row of this table by,
 * and what they held before and after — read from the rows as they are
 * stored, before anything is masked for the wire.
 */
function reachOf(mutation: WidgetStreamMutation): FrameReach {
  const table = mutation.table.table as { columns?: readonly { name: string; staff?: true | undefined }[]; belongs?: readonly ({ column: string; person?: string } | { through: unknown } | { via: string })[]; private?: true } | undefined;
  const ways = table?.belongs ?? [];
  /*
   * As the test a query carries reads a way (`crud/row-limit.ts`), and no
   * looser: a plain way counts only while its column is there and is marked
   * as holding a staff member. A way that goes anywhere else, or that cannot
   * be read as written (a column dropped or unmarked since), leaves nothing
   * here to tell whose the row is — and then nobody is told a row at all.
   */
  const readable = ways.every((way) => 'column' in way && way.person === undefined && table?.columns?.some((column) => column.name === way.column && column.staff === true) === true);
  const columns = readable ? ways.map((way) => (way as { column: string }).column) : null;
  // An image that lacks one of the columns (a caller that handed over part of a row) is no image to judge by.
  const image = (row: Row | null | undefined): Record<string, unknown> | null =>
    columns === null || row === null || row === undefined || columns.some((column) => !(column in row)) ? null : Object.fromEntries(columns.map((column) => [column, row[column]]));
  const row = image(mutation.row);
  // A deleted row's frame carries the row as it was: that is both of its images.
  return { private: table?.private === true, columns, before: mutation.before === undefined ? (mutation.type === 'record.delete' ? row : null) : image(mutation.before), after: row };
}

/** What a frame that names no row says of its table, for a publisher with nothing but the table in hand (a file brought in). */
export function tableFrameReach(table: ResolvedTable): FrameReach {
  return { private: (table.table as { private?: true } | undefined)?.private === true, columns: null, before: null, after: null };
}

/**
 * Publish one widget-data stream event. The `row` is PII-masked before it
 * leaves the process; `delete` events (or callers with no row) publish
 * `row: null` and rely on `pk` for buffer removal client-side.
 */
export function publishWidgetDataStream(hub: RealtimeHub, mutation: WidgetStreamMutation): void {
  const channel = widgetDataChannel(mutation.connectionId, mutation.table.id);
  // A SQLite source's wall-time text as the instant it is (Postgres and MySQL hand over moments already).
  const row =
    mutation.row === null || mutation.row === undefined
      ? null
      : staffInstants(maskRow(mutation.row, mutation.table, false), mutation.table, 'sqlite');
  const pk =
    mutation.pk === null || mutation.pk === undefined
      ? null
      : maskRow(mutation.pk, mutation.table, false);
  hub.publish(channel, mutation.type, { type: mutation.type, pk, row }, mutation.at, reachOf(mutation));
}
