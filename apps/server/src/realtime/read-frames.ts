// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The live frames of a table as ONE subscriber reads it. A `widget-data`
 * frame carries the written row (personal and secret columns already taken
 * out for everyone); a subscriber whose role reads that table only in part
 * gets it with the other columns taken out too, decided when they subscribe
 * (as the channel's own check is). Everyone else gets the frame as it is.
 */
import type { MetaDb } from '@adminium/meta';

import { readableImage, readViewOf } from '../crud/read-view.js';
import type { Row } from '../crud/mask.js';
import { loadSnapshotView } from '../data-io/snapshot-view.js';
import { readLimitOf } from '../rbac/read-limits.js';
import { resolvePermissionSet } from '../rbac/resolver.js';
import { parseChannel, type RealtimeEvent, type RealtimeUser } from './hub.js';

/** A subscriber's frames of a channel, or null to send them as they are. */
export type FrameFor = (user: RealtimeUser, channel: string) => Promise<((event: RealtimeEvent) => RealtimeEvent) | null>;

export function readLimitedFrames(meta: MetaDb): FrameFor {
  return async (user, channel) => {
    const parsed = parseChannel(channel);
    if (parsed?.kind !== 'widget-data') return null;
    const permissions = await resolvePermissionSet(meta, { kind: 'user', id: user.id, label: user.id });
    if (readLimitOf(permissions, parsed.connectionId, parsed.table) === null) return null;
    const view = readViewOf(await loadSnapshotView(meta, parsed.connectionId), permissions);
    return (event) => {
      const data = event.data as { row?: Row | null } | null;
      if (data === null || typeof data !== 'object' || data.row === null || data.row === undefined) return event;
      return { ...event, data: { ...data, row: readableImage(view, parsed.table, data.row) } };
    };
  };
}
