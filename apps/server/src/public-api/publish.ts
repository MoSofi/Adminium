// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FAN A PUBLIC WRITE OUT TO THE WIDGET-DATA STREAM.
 *
 * ── THE GAP THIS CLOSES ─────────────────────────────────────────────────
 *
 * `routes/data` has published every write to `widget-data:<cnx>:<table>`
 * since; this route published nothing at all. So a dashboard page bound to a
 * table an anonymous visitor can write to only ever learned about that write
 * on its next refetch — the operator's own chat inbox goes quiet while
 * somebody is typing into it, and a request row a customer just raised sits
 * unseen until somebody reloads. It is owed with or without an add-on: the
 * public surface has been able to create rows since 28 shipped.
 *
 * ── WHY IT IS SAFE TO PUBLISH A STRANGER'S ROW TO A STAFF CHANNEL ───────
 *
 * The channel is the SAME one `routes/data` uses and is gated by exactly
 * `table:<cnx>:<table>:read` (`realtime/hub.ts`) — a subscriber had to hold
 * the grant that lets them read the table anyway. And the shared publisher
 * masks both the row and the primary key with `unmasked = false`, so a
 * secret column is stripped and a PII column nulled no matter who is
 * listening. Nothing crosses here that a `GET` by the same subscriber would
 * not already have returned.
 *
 * ── AND WHY NOT THE `table:` CHANNEL AS WELL ────────────────────────────
 *
 * `routes/data` publishes to both, and this publishes to one. `table:*` is
 * the dashboard's cache-invalidation fan-out and is publish-only —
 * `parseChannel` has no case for it, so every subscription to it is denied
 * and an event published there reaches no browser. Adding it would be
 * writing into a socket nothing reads.
 *
 * Guarded on a null hub because a compose without jobs has no realtime
 * decorator at all, which is the shape several test topologies use.
 *
 * A MODULE AND NOT A CLOSURE, for the reason `values.ts` is: there is no
 * end-to-end harness for a public write anywhere in this suite — it would need
 * a composed server, a registered data connection, a compiled scope and a
 * minted key — so a helper defined inside the route plugin would ship with no
 * test at all. Here the decisions it makes (which channel, which row, what
 * happens with no hub) are checked directly against a real `RealtimeHub`.
 */
import type { ResolvedTable } from '../crud/identifiers.js';
import type { Row } from '../crud/mask.js';
import type { RealtimeHub } from '../realtime/hub.js';
import { publishWidgetDataStream } from '../widget-data/stream-publisher.js';

export interface PublicWriteEvent {
  connectionId: string;
  table: ResolvedTable;
  action: 'create' | 'update';
  /** Primary key of the row just written. Masked by the shared publisher. */
  pk: Row | null;
  /**
   * The row as STORED, not as projected back to the caller.
   *
   * What the anonymous caller gets is narrowed to the scope's `expose`, because
   * a create must not return more than a read of the same row would. The
   * stream's subscribers are signed-in staff holding a table-read grant, and
   * narrowing THEIR frame to a customer scope's `expose` would hand the
   * dashboard a half-row it would have to refetch to complete.
   */
  row: Row | null;
}

/** `hub` is null on a compose with no jobs — several test topologies. */
export function publishPublicWrite(hub: RealtimeHub | null, event: PublicWriteEvent): void {
  if (hub === null) return;
  publishWidgetDataStream(hub, {
    connectionId: event.connectionId,
    table: event.table,
    type: `record.${event.action}`,
    pk: event.pk,
    row: event.row,
  });
}
