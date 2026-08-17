// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Widget-data stream publisher (04-widget-registry.md §5.3). The single place
 * server code fans a data mutation out to the live stream widgets subscribed to
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
import { maskRow, type Row } from '../crud/mask.js';
import { widgetDataChannel, type RealtimeHub } from '../realtime/hub.js';

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
  /** Event timestamp (ms); defaults to the hub's `Date.now()`. */
  at?: number | undefined;
}

/**
 * Publish one widget-data stream event. The `row` is PII-masked before it
 * leaves the process; `delete` events (or callers with no row) publish
 * `row: null` and rely on `pk` for buffer removal client-side.
 */
export function publishWidgetDataStream(hub: RealtimeHub, mutation: WidgetStreamMutation): void {
  const channel = widgetDataChannel(mutation.connectionId, mutation.table.id);
  const row =
    mutation.row === null || mutation.row === undefined
      ? null
      : maskRow(mutation.row, mutation.table, false);
  const pk =
    mutation.pk === null || mutation.pk === undefined
      ? null
      : maskRow(mutation.pk, mutation.table, false);
  hub.publish(channel, mutation.type, { type: mutation.type, pk, row }, mutation.at);
}
