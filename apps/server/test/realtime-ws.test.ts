// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WebSocket gateway `GET /ws` (08-server-api.md §3, M2-T07): pre-handshake
 * auth, subscribe/unsubscribe protocol, per-channel authorization (foreign
 * user denial), the 64-channel cap, ping/pong, and hub cleanup on close.
 *
 * `@fastify/websocket` (and its `ws` client) are declared by this wave's
 * integration (the auth agent owns apps/server/package.json), so the suite
 * self-skips until the packages are installed and auto-activates afterwards.
 */
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { registerWsRoute, WS_MAX_CHANNELS } from '../src/realtime/ws.js';
import { jobOwnerId } from '../src/routes/jobs/index.js';
import { NOOP_PROGRESS_KIND } from '../src/jobs/registry.js';
import {
  buildBareApp,
  makeJobsContext,
  makeStubAuth,
  until,
  type BareApp,
} from './jobs-helpers.js';

const websocketPlugin = await import('@fastify/websocket').then(
  (m) => m.default,
  () => null,
);
const wsLib = await import('ws').then(
  (m) => m,
  () => null,
);

const OWNER = 'user_owner';
const OTHER = 'user_other';

describe.skipIf(websocketPlugin === null || wsLib === null)('GET /ws', () => {
  if (websocketPlugin === null || wsLib === null) return;
  const WebSocketClient = wsLib.WebSocket;

  let apps: BareApp[] = [];
  let sockets: InstanceType<typeof WebSocketClient>[] = [];

  afterEach(async () => {
    for (const socket of sockets) socket.terminate();
    sockets = [];
    await Promise.all(apps.map(async (app) => app.close()));
    apps = [];
  });

  async function makeGateway() {
    const ctx = await makeJobsContext();
    const auth = makeStubAuth();
    const app = buildBareApp();
    await app.register(websocketPlugin!);
    registerWsRoute(app, {
      hub: ctx.hub,
      resolveUser: auth.resolveUser,
      can: auth.can,
      getJobOwner: async (jobId) => jobOwnerId(await ctx.jobs.findById(jobId)),
      heartbeatIntervalMs: 60_000, // out of the way for protocol tests
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    apps.push(app);
    const { port } = app.server.address() as AddressInfo;
    return { ctx, auth, app, port };
  }

  interface Frame {
    op?: string;
    code?: string;
    channel?: string;
    type?: string;
    data?: unknown;
    ts?: string;
  }

  function connect(port: number, headers: Record<string, string>) {
    const socket = new WebSocketClient(`ws://127.0.0.1:${port}/ws`, { headers });
    // ws emits 'error' on handshake rejection/teardown; without a listener Node
    // treats it as an unhandled 'error' event and crashes the run.
    socket.on('error', () => {});
    sockets.push(socket);
    const frames: Frame[] = [];
    const waiters: ((frame: Frame) => void)[] = [];
    socket.on('message', (raw) => {
      const frame = JSON.parse(String(raw)) as Frame;
      const waiter = waiters.shift();
      if (waiter !== undefined) waiter(frame);
      else frames.push(frame);
    });
    const next = async (): Promise<Frame> => {
      const queued = frames.shift();
      if (queued !== undefined) return queued;
      return await new Promise<Frame>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no frame within 2s')), 2_000);
        waiters.push((frame) => {
          clearTimeout(timer);
          resolve(frame);
        });
      });
    };
    const send = (frame: unknown): void => socket.send(JSON.stringify(frame));
    const opened = new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return { socket, next, send, opened, pending: frames };
  }

  it('rejects unauthenticated upgrades pre-handshake with 401', async () => {
    const { port } = await makeGateway();
    const socket = new WebSocketClient(`ws://127.0.0.1:${port}/ws`);
    socket.on('error', () => {}); // rejection path always emits 'error' after unexpected-response
    sockets.push(socket);
    const status = await new Promise<number>((resolve, reject) => {
      socket.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      socket.once('open', () => reject(new Error('handshake unexpectedly succeeded')));
    });
    expect(status).toBe(401);
  });

  it('subscribe → event fan-out → unsubscribe; ping/pong; bad frames', async () => {
    const { ctx, auth, port } = await makeGateway();
    const client = connect(port, auth.as(OWNER));
    await client.opened;

    // Own notifications channel is allowed.
    client.send({ op: 'subscribe', channel: `notifications:${OWNER}` });
    expect(await client.next()).toEqual({ op: 'subscribed', channel: `notifications:${OWNER}` });

    ctx.hub.publish(`notifications:${OWNER}`, 'created', { id: 'ntf_1' }, 2_000_000_000_000);
    expect(await client.next()).toEqual({
      channel: `notifications:${OWNER}`,
      type: 'created',
      data: { id: 'ntf_1' },
      ts: new Date(2_000_000_000_000).toISOString(),
    });

    // Unsubscribe stops delivery — the following ping's pong must be the
    // very next frame (no stray event in between).
    client.send({ op: 'unsubscribe', channel: `notifications:${OWNER}` });
    expect(await client.next()).toEqual({
      op: 'unsubscribed',
      channel: `notifications:${OWNER}`,
    });
    ctx.hub.publish(`notifications:${OWNER}`, 'created', { id: 'ntf_2' });
    client.send({ op: 'ping' });
    expect(await client.next()).toEqual({ op: 'pong' });

    // Malformed frames answer with protocol errors, not disconnects.
    client.socket.send('not json');
    expect((await client.next()).code).toBe('VALIDATION_FAILED');
    client.send({ op: 'shout', channel: 'config-changed' });
    expect((await client.next()).code).toBe('VALIDATION_FAILED');
    client.send({ op: 'subscribe' });
    expect((await client.next()).code).toBe('VALIDATION_FAILED');
  });

  it("denies another user's notifications channel and unknown channels", async () => {
    const { auth, port } = await makeGateway();
    const client = connect(port, auth.as(OTHER));
    await client.opened;

    client.send({ op: 'subscribe', channel: `notifications:${OWNER}` });
    expect(await client.next()).toEqual({
      op: 'error',
      code: 'FORBIDDEN',
      channel: `notifications:${OWNER}`,
    });

    client.send({ op: 'sub', channel: 'firehose:everything' });
    expect(await client.next()).toEqual({
      op: 'error',
      code: 'FORBIDDEN',
      channel: 'firehose:everything',
    });
  });

  it('lets the job owner follow jobs:<id>, denies foreign users', async () => {
    const { ctx, auth, port } = await makeGateway();
    const job = await ctx.jobs.enqueue(
      { kind: NOOP_PROGRESS_KIND, payload: { steps: 2, userId: OWNER } },
      ctx.clock.now(),
    );

    const owner = connect(port, auth.as(OWNER));
    await owner.opened;
    owner.send({ op: 'subscribe', channel: `jobs:${job.id}` });
    expect(await owner.next()).toEqual({ op: 'subscribed', channel: `jobs:${job.id}` });

    const other = connect(port, auth.as(OTHER));
    await other.opened;
    other.send({ op: 'subscribe', channel: `jobs:${job.id}` });
    expect((await other.next()).code).toBe('FORBIDDEN');

    // Non-owner with system:jobs:read may follow.
    auth.grant(OTHER, 'system:jobs:read');
    other.send({ op: 'subscribe', channel: `jobs:${job.id}` });
    expect(await other.next()).toEqual({ op: 'subscribed', channel: `jobs:${job.id}` });

    // Worker progress reaches the owner's socket end-to-end.
    await ctx.worker.runOnce();
    const first = await owner.next();
    expect(first.type).toBe('progress');
    let last = first;
    while (last.type !== 'completed') last = await owner.next();
    expect(last.channel).toBe(`jobs:${job.id}`);
  });

  it('caps subscriptions at 64 channels per socket', async () => {
    const { auth, port } = await makeGateway();
    auth.grant(OWNER, 'system:jobs:read');
    const client = connect(port, auth.as(OWNER));
    await client.opened;

    for (let i = 0; i < WS_MAX_CHANNELS; i += 1) {
      client.send({ op: 'subscribe', channel: `jobs:job_${i}` });
      expect((await client.next()).op).toBe('subscribed');
    }
    client.send({ op: 'subscribe', channel: 'jobs:job_overflow' });
    expect(await client.next()).toEqual({
      op: 'error',
      code: 'LIMIT_EXCEEDED',
      channel: 'jobs:job_overflow',
    });

    // Re-subscribing an existing channel is idempotent, not a limit hit.
    client.send({ op: 'subscribe', channel: 'jobs:job_0' });
    expect((await client.next()).op).toBe('subscribed');
  });

  it('drops hub subscriptions when the socket closes', async () => {
    const { ctx, auth, port } = await makeGateway();
    const client = connect(port, auth.as(OWNER));
    await client.opened;
    client.send({ op: 'subscribe', channel: `notifications:${OWNER}` });
    await client.next();
    expect(ctx.hub.subscriberCount(`notifications:${OWNER}`)).toBe(1);

    client.socket.close();
    await until(() => ctx.hub.subscriberCount(`notifications:${OWNER}`) === 0);
    expect(ctx.hub.channelCount).toBe(0);
  });
});
