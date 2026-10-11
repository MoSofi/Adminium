// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The live frames of a table as ONE subscriber reads it. A `widget-data`
 * frame carries the written row (personal and secret columns already taken
 * out for everyone); a subscriber whose role reads that table only in part
 * gets it with the other columns taken out too.
 *
 * And a subscriber whose role reaches only some ROWS of the table gets the
 * frames of those rows and no others (`forRowsReached`).
 *
 * Judged for every frame, as the subscriber's roles are NOW: a limit an
 * operator tightens (or a role taken away) holds from the next frame on, not
 * from the next time the screen subscribes. The frames of one subscription
 * keep their order.
 */
import type { MetaDb } from '@adminium/meta';

import { readableImage, readViewOf } from '../crud/read-view.js';
import type { Row } from '../crud/mask.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { permissionSetAllows, resolvePermissionSet, type PermissionSet } from '../rbac/resolver.js';
import { rowReachesOf, type RowReach } from '../rbac/row-limits.js';
import { readLimitOf } from '../rbac/read-limits.js';
import { frameReachOf, parseChannel, widgetDataReadPermission, type RealtimeEvent, type RealtimeUser } from './hub.js';

/** A subscriber's frame of a channel as they may read it now; null: not theirs any more (not sent). */
export type FrameFilter = (event: RealtimeEvent) => Promise<RealtimeEvent | null>;

/** A subscriber's frames of a channel, or null to send them as they are (a channel that carries no row). */
export type FrameFor = (user: RealtimeUser, channel: string) => Promise<FrameFilter | null>;

export function readLimitedFrames(meta: MetaDb): FrameFor {
  return async (user, channel) => {
    const parsed = parseChannel(channel);
    if (parsed?.kind !== 'widget-data') return null;
    return async (event) => {
      const permissions = await resolvePermissionSet(meta, { kind: 'user', id: user.id, label: user.id });
      // A table they may no longer read: nothing of it.
      if (!permissionSetAllows(permissions, widgetDataReadPermission(parsed.connectionId, parsed.table))) return null;
      // Whose the row is: a subscriber held to some rows of the table gets the frames of theirs, and nothing of anybody else's.
      const shown = forRowsReached(event, permissions, user, parsed.connectionId, parsed.table);
      if (shown === null) return null;
      if (readLimitOf(permissions, parsed.connectionId, parsed.table) === null) return shown;
      const data = shown.data as { row?: Row | null } | null;
      if (data === null || typeof data !== 'object' || data.row === null || data.row === undefined) return shown;
      const view = readViewOf(await loadSnapshotView(meta, parsed.connectionId), permissions);
      return { ...shown, data: { ...data, row: readableImage(view, parsed.table, data.row) } };
    };
  };
}

/**
 * "Something of this table changed": no key, no row, no count. What a screen
 * needs to look again, and nothing a row could be told from. Marked
 * `changed`, so the screen waits a moment and asks once for a burst of them
 * (`apps/dashboard/src/api/realtime.ts`): there is one for every write of a
 * busy table, by anybody.
 */
const bare = (event: RealtimeEvent): RealtimeEvent => ({ ...event, data: { type: event.type, pk: null, row: null, changed: true } });

/**
 * A table's frame as a subscriber gets it when a role holds them to some of
 * its rows (`crud/row-limit.ts`); as it is for everybody else.
 *
 *  - The row is theirs now: the frame.
 *  - It was theirs and is not any more (handed to a colleague): its key and
 *    no row, so their screen lets go of it.
 *  - It is not theirs and was not: NOTHING. Not a key, not a "something
 *    changed": a colleague's work is not announced to them.
 *  - Whose it is cannot be told from the row alone — the table's people are
 *    found through a person's row, a listing or a parent, or the limit holds
 *    only while a column has some value, or the frame names no row (an undo,
 *    a file brought in): a bare "this table changed", for the screen to ask
 *    again through the door that does know.
 */
function forRowsReached(event: RealtimeEvent, permissions: PermissionSet, user: RealtimeUser, connectionId: string, table: string): RealtimeEvent | null {
  const reach = frameReachOf(event);
  // Private: their own rows, for everybody. Else what their roles say, which for nearly everyone is nothing.
  const reaches: readonly RowReach[] | null = reach?.private === true ? [{ reach: 'own' }] : rowReachesOf(permissions, connectionId, table, 'read');
  if (reaches === null) return event;
  const data = event.data as { pk?: unknown; row?: unknown } | null;
  const named = data !== null && typeof data === 'object' && ((data.pk !== null && data.pk !== undefined) || (data.row !== null && data.row !== undefined));
  if (reach === undefined || reach.columns === null || !named || reaches.some((one) => one.while !== undefined || one.reach === 'all')) return bare(event);
  // A frame about a row that came with no image of it (a file hung on a record): nothing to judge by.
  if (reach.after === null && reach.before === null) return bare(event);
  const columns = reach.columns;
  const led = permissions.reach?.ledIds ?? [];
  const holds = (image: Readonly<Record<string, unknown>> | null): boolean => {
    if (image === null || columns.length === 0) return false;
    const people = columns.map((column) => image[column]).filter((value): value is string => typeof value === 'string' && value !== '');
    return reaches.some((one) => (one.unowned === true && people.length === 0) || people.includes(user.id) || (one.reach === 'team' && people.some((person) => led.includes(person))));
  };
  if (holds(reach.after)) return event;
  if (holds(reach.before)) return { ...event, data: { type: event.type, pk: (data as { pk?: unknown }).pk ?? null, row: null } };
  return null;
}

/**
 * A sink that sends each frame through `filter` in the order they came: one
 * frame's check never overtakes the one before it. A filter that fails drops
 * that frame (a screen refetches on the next one).
 */
export function orderedSink(filter: FrameFilter | null, send: (event: RealtimeEvent) => void): (event: RealtimeEvent) => void {
  if (filter === null) return send;
  let chain: Promise<void> = Promise.resolve();
  return (event) => {
    chain = chain.then(async () => {
      const shown = await filter(event).catch(() => null);
      if (shown !== null) send(shown);
    });
  };
}
