/**
 * RealtimeHub + channel grammar + subscribe-time authorization
 * (08-server-api.md §3, M2-T07).
 */
import { describe, expect, it } from 'vitest';

import {
  authorizeChannel,
  JOBS_READ_PERMISSION,
  parseChannel,
  RealtimeHub,
  type RealtimeEvent,
} from '../src/realtime/hub.js';

describe('parseChannel', () => {
  it('parses the wave-2 channel names', () => {
    expect(parseChannel('config-changed')).toEqual({ kind: 'config-changed' });
    expect(parseChannel('notifications:user_1')).toEqual({
      kind: 'notifications',
      userId: 'user_1',
    });
    expect(parseChannel('jobs:job_01H')).toEqual({ kind: 'jobs', jobId: 'job_01H' });
  });

  it('rejects unknown, malformed, and oversized names', () => {
    expect(parseChannel('')).toBeNull();
    expect(parseChannel('presence:global')).toBeNull(); // not a wave-2 channel
    expect(parseChannel('notifications:')).toBeNull();
    expect(parseChannel(':user_1')).toBeNull();
    expect(parseChannel('jobs')).toBeNull();
    expect(parseChannel(`jobs:${'x'.repeat(300)}`)).toBeNull();
  });
});

describe('authorizeChannel', () => {
  const never = { can: () => false };

  it('config-changed: any authenticated session', async () => {
    expect(await authorizeChannel({ id: 'user_1' }, 'config-changed', never)).toBe(true);
  });

  it('notifications: own userId only', async () => {
    expect(await authorizeChannel({ id: 'user_1' }, 'notifications:user_1', never)).toBe(true);
    expect(await authorizeChannel({ id: 'user_2' }, 'notifications:user_1', never)).toBe(false);
  });

  it('jobs: grants via system:jobs:read', async () => {
    const deps = {
      can: (_u: { id: string }, permission: string) => permission === JOBS_READ_PERMISSION,
    };
    expect(await authorizeChannel({ id: 'user_1' }, 'jobs:job_1', deps)).toBe(true);
  });

  it('jobs: grants the job owner, denies everyone else', async () => {
    const deps = { can: () => false, getJobOwner: () => 'user_owner' };
    expect(await authorizeChannel({ id: 'user_owner' }, 'jobs:job_1', deps)).toBe(true);
    expect(await authorizeChannel({ id: 'user_other' }, 'jobs:job_1', deps)).toBe(false);
    // Without an owner resolver, only the permission grants.
    expect(await authorizeChannel({ id: 'user_owner' }, 'jobs:job_1', never)).toBe(false);
  });

  it('unknown channels are deny-by-default', async () => {
    const always = { can: () => true };
    expect(await authorizeChannel({ id: 'user_1' }, 'table:conn_1:public.orders', always)).toBe(
      false,
    );
  });
});

describe('RealtimeHub', () => {
  it('fans out to subscribers and honors unsubscribe', () => {
    const hub = new RealtimeHub();
    const seenA: RealtimeEvent[] = [];
    const seenB: RealtimeEvent[] = [];
    const offA = hub.subscribe('jobs:job_1', (e) => seenA.push(e));
    hub.subscribe('jobs:job_1', (e) => seenB.push(e));

    const event = hub.publish('jobs:job_1', 'progress', { pct: 10 }, 1_750_000_000_000);
    expect(event).toEqual({
      channel: 'jobs:job_1',
      type: 'progress',
      data: { pct: 10 },
      ts: new Date(1_750_000_000_000).toISOString(),
    });
    expect(seenA).toHaveLength(1);
    expect(seenB).toHaveLength(1);

    offA();
    hub.publish('jobs:job_1', 'progress', { pct: 20 });
    expect(seenA).toHaveLength(1);
    expect(seenB).toHaveLength(2);
    expect(hub.subscriberCount('jobs:job_1')).toBe(1);
  });

  it('publishing to a channel with no subscribers is a no-op', () => {
    const hub = new RealtimeHub();
    expect(() => hub.publish('jobs:none', 'completed', {})).not.toThrow();
    expect(hub.channelCount).toBe(0);
  });

  it('a throwing sink is dropped without starving siblings', () => {
    const hub = new RealtimeHub();
    const seen: RealtimeEvent[] = [];
    hub.subscribe('config-changed', () => {
      throw new Error('broken socket');
    });
    hub.subscribe('config-changed', (e) => seen.push(e));

    hub.publish('config-changed', 'changed', {});
    expect(seen).toHaveLength(1);
    expect(hub.subscriberCount('config-changed')).toBe(1); // broken sink removed

    hub.publish('config-changed', 'changed', {});
    expect(seen).toHaveLength(2);
  });

  it('close() drops every subscription', () => {
    const hub = new RealtimeHub();
    const seen: RealtimeEvent[] = [];
    hub.subscribe('notifications:user_1', (e) => seen.push(e));
    hub.close();
    hub.publish('notifications:user_1', 'created', {});
    expect(seen).toHaveLength(0);
    expect(hub.channelCount).toBe(0);
  });
});
