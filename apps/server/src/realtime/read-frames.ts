// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The live frames of a table as ONE subscriber reads it. A `widget-data`
 * frame carries the written row (personal and secret columns already taken
 * out for everyone); a subscriber whose role reads that table only in part
 * gets it with the other columns taken out too.
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
import { permissionSetAllows, resolvePermissionSet } from '../rbac/resolver.js';
import { readLimitOf } from '../rbac/read-limits.js';
import { parseChannel, widgetDataReadPermission, type RealtimeEvent, type RealtimeUser } from './hub.js';

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
      if (readLimitOf(permissions, parsed.connectionId, parsed.table) === null) return event;
      const data = event.data as { row?: Row | null } | null;
      if (data === null || typeof data !== 'object' || data.row === null || data.row === undefined) return event;
      const view = readViewOf(await loadSnapshotView(meta, parsed.connectionId), permissions);
      return { ...event, data: { ...data, row: readableImage(view, parsed.table, data.row) } };
    };
  };
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
