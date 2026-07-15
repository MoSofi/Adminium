/**
 * Realtime channel hub (08-server-api.md §3, M2-T07). In-process pub/sub that
 * both the WS gateway (`realtime/ws.ts`) and the SSE fallback
 * (`realtime/sse.ts`) attach to, and that the jobs worker publishes into.
 *
 * Wave-2 channels:
 * - `notifications:<userId>`             — own userId only
 * - `jobs:<jobId>`                       — job owner or `system:jobs:read`
 * - `config-changed`                     — any authenticated session
 * - `widget-data:<connectionId>:<table>` — table read permission (04 §5.3)
 *
 * Authorization runs at subscribe time (`authorizeChannel`), mirroring the
 * REST RBAC checks; publishing is server-internal and unchecked. Stream
 * payloads on `widget-data:*` are PII-masked at the publisher so a subscriber
 * who passes the table-read check still never receives a forbidden column.
 */

/** Minimal identity the realtime layer needs; the auth plugin supplies it. */
export interface RealtimeUser {
  id: string;
}

/** The wire shape of every server→client realtime event (§3 protocol). */
export interface RealtimeEvent {
  channel: string;
  type: string;
  data: unknown;
  /** ISO-8601 UTC. */
  ts: string;
}

/** A delivery sink — one per WS socket / SSE response per channel. */
export type RealtimeSink = (event: RealtimeEvent) => void;

/** Permission key guarding non-owner access to `jobs:<jobId>` channels. */
export const JOBS_READ_PERMISSION = 'system:jobs:read';

/** Permission key guarding job enqueue/cancel for non-owners. */
export const JOBS_MANAGE_PERMISSION = 'system:jobs:manage';

const MAX_CHANNEL_LENGTH = 200;

/** Parsed identity of a channel name; `null` for unknown/invalid names. */
export type ChannelDescriptor =
  | { kind: 'notifications'; userId: string }
  | { kind: 'jobs'; jobId: string }
  | { kind: 'config-changed' }
  | { kind: 'widget-data'; connectionId: string; table: string };

/** Prefix of the widget-data stream channels (04-widget-registry.md §5.3). */
export const WIDGET_DATA_CHANNEL_PREFIX = 'widget-data';

/** `widget-data:<connectionId>:<qualifiedTable>` — the stream channel name. */
export function widgetDataChannel(connectionId: string, table: string): string {
  return `${WIDGET_DATA_CHANNEL_PREFIX}:${connectionId}:${table}`;
}

/** RBAC permission gating a widget-data stream subscription (read on the table). */
export function widgetDataReadPermission(connectionId: string, table: string): string {
  return `table:${connectionId}:${table}:read`;
}

/** Parses a channel name into its §3 descriptor (`null` = unknown channel). */
export function parseChannel(channel: string): ChannelDescriptor | null {
  if (channel.length === 0 || channel.length > MAX_CHANNEL_LENGTH) return null;
  if (channel === 'config-changed') return { kind: 'config-changed' };
  const sep = channel.indexOf(':');
  if (sep <= 0) return null;
  const prefix = channel.slice(0, sep);
  const rest = channel.slice(sep + 1);
  if (rest.length === 0) return null;
  if (prefix === 'notifications') return { kind: 'notifications', userId: rest };
  if (prefix === 'jobs') return { kind: 'jobs', jobId: rest };
  if (prefix === WIDGET_DATA_CHANNEL_PREFIX) {
    // `widget-data:<connectionId>:<table>` — split off the connection id; the
    // rest is the qualified table id (`schema.name`, no colons).
    const sep2 = rest.indexOf(':');
    if (sep2 <= 0) return null;
    const connectionId = rest.slice(0, sep2);
    const table = rest.slice(sep2 + 1);
    if (table.length === 0) return null;
    return { kind: 'widget-data', connectionId, table };
  }
  return null;
}

/** What `authorizeChannel` needs from the auth/RBAC layer. */
export interface ChannelAuthDeps {
  /** RBAC check, e.g. `can(user, 'system:jobs:read')`. Wired by the integrator. */
  can(user: RealtimeUser, permission: string): Promise<boolean> | boolean;
  /**
   * Resolves the owning userId of a job (payload `userId` convention) so job
   * owners can follow their own `jobs:<jobId>` channel without the global
   * read permission. Optional — without it only `system:jobs:read` grants.
   */
  getJobOwner?(jobId: string): Promise<string | null> | string | null;
}

/**
 * Subscribe-time authorization (§3 topics table). Unknown channels are always
 * denied — deny-by-default, so a typo never becomes an open firehose.
 */
export async function authorizeChannel(
  user: RealtimeUser,
  channel: string,
  deps: ChannelAuthDeps,
): Promise<boolean> {
  const parsed = parseChannel(channel);
  if (parsed === null) return false;
  switch (parsed.kind) {
    case 'config-changed':
      return true; // any authenticated session
    case 'notifications':
      return parsed.userId === user.id;
    case 'jobs': {
      if (await deps.can(user, JOBS_READ_PERMISSION)) return true;
      if (deps.getJobOwner === undefined) return false;
      const owner = await deps.getJobOwner(parsed.jobId);
      return owner !== null && owner === user.id;
    }
    case 'widget-data':
      // Same gate as a widget-data query: read permission on the resolved
      // table (04 §5.3). PII/secret columns are stripped at publish time.
      return deps.can(user, widgetDataReadPermission(parsed.connectionId, parsed.table));
  }
}

/**
 * The in-process hub. Publishing with zero subscribers is a silent no-op; a
 * throwing sink never breaks fan-out to its siblings (it is dropped).
 */
export class RealtimeHub {
  private readonly channels = new Map<string, Set<RealtimeSink>>();

  /** Attach `sink` to `channel`; returns the matching unsubscribe function. */
  subscribe(channel: string, sink: RealtimeSink): () => void {
    let sinks = this.channels.get(channel);
    if (sinks === undefined) {
      sinks = new Set();
      this.channels.set(channel, sinks);
    }
    sinks.add(sink);
    return () => {
      const set = this.channels.get(channel);
      if (set === undefined) return;
      set.delete(sink);
      if (set.size === 0) this.channels.delete(channel);
    };
  }

  /** Build the §3 event frame and fan it out to current subscribers. */
  publish(channel: string, type: string, data: unknown, at: number = Date.now()): RealtimeEvent {
    const event: RealtimeEvent = { channel, type, data, ts: new Date(at).toISOString() };
    const sinks = this.channels.get(channel);
    if (sinks !== undefined) {
      for (const sink of [...sinks]) {
        try {
          sink(event);
        } catch {
          // A broken sink (e.g. socket torn down mid-send) must not starve
          // the other subscribers; drop it.
          sinks.delete(sink);
        }
      }
      if (sinks.size === 0) this.channels.delete(channel);
    }
    return event;
  }

  /** Current subscriber count for a channel (tests/metrics). */
  subscriberCount(channel: string): number {
    return this.channels.get(channel)?.size ?? 0;
  }

  /** Total distinct channels with at least one subscriber. */
  get channelCount(): number {
    return this.channels.size;
  }

  /** Drop every subscription (server shutdown). */
  close(): void {
    this.channels.clear();
  }
}
