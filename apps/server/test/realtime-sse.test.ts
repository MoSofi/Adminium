// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SSE fallback `GET /api/v1/events` (08-server-api.md §3, M2-T07): auth +
 * channel authorization via inject, and a real-HTTP streaming test that
 * watches a noop-progress job end-to-end (worker → hub → SSE frames).
 */
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NOOP_PROGRESS_KIND } from '../src/jobs/registry.js';
import { registerSseRoute, SSE_RETRY_MS } from '../src/realtime/sse.js';
import type { RealtimeGatewayDeps } from '../src/realtime/ws.js';
import { jobOwnerId } from '../src/routes/jobs/index.js';
import {
  buildBareApp,
  makeJobsContext,
  makeStubAuth,
  until,
  type BareApp,
  type JobsTestContext,
  type StubAuth,
} from './jobs-helpers.js';

const OWNER = 'user_owner';
const OTHER = 'user_other';

let app: BareApp;
let ctx: JobsTestContext;
let auth: StubAuth;

beforeEach(async () => {
  ctx = await makeJobsContext();
  auth = makeStubAuth();
  const deps: RealtimeGatewayDeps = {
    hub: ctx.hub,
    resolveUser: auth.resolveUser,
    can: auth.can,
    getJobOwner: async (jobId) => jobOwnerId(await ctx.jobs.findById(jobId)),
  };
  app = buildBareApp();
  await app.register(
    async (api) => {
      registerSseRoute(api, deps, { keepAliveMs: 40 });
    },
    { prefix: '/api/v1' },
  );
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/v1/events — auth and validation (inject)', () => {
  it('401 without a session', async () => {
    const res = await app.inject({ url: '/api/v1/events?channels=config-changed' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('422 without any channel', async () => {
    const res = await app.inject({ url: '/api/v1/events', headers: auth.as(OWNER) });
    expect(res.statusCode).toBe(422);
  });

  it("403 for another user's notifications channel", async () => {
    const res = await app.inject({
      url: `/api/v1/events?channels=notifications:${OWNER}`,
      headers: auth.as(OTHER),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    expect(res.json().error.details.channel).toBe(`notifications:${OWNER}`);
  });

  it('403 for a jobs channel when neither owner nor reader', async () => {
    const job = await ctx.jobs.enqueue(
      { kind: NOOP_PROGRESS_KIND, payload: { steps: 1, userId: OWNER } },
      ctx.clock.now(),
    );
    const res = await app.inject({
      url: `/api/v1/events?channels=jobs:${job.id}`,
      headers: auth.as(OTHER),
    });
    expect(res.statusCode).toBe(403);
  });

  it('403 for unknown channel names (deny-by-default)', async () => {
    const res = await app.inject({
      url: '/api/v1/events?channels=firehose:everything',
      headers: auth.as(OWNER),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/v1/events — streaming (real HTTP)', () => {
  it('streams job progress end-to-end with retry hint and keep-alives', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;

    const job = await ctx.jobs.enqueue(
      { kind: NOOP_PROGRESS_KIND, payload: { steps: 2, userId: OWNER } },
      ctx.clock.now(),
    );

    const controller = new AbortController();
    const res = await fetch(
      `http://127.0.0.1:${port}/api/v1/events?channels=jobs:${job.id},notifications:${OWNER}`,
      { headers: auth.as(OWNER), signal: controller.signal },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    let buffer = '';
    const reader = res.body?.getReader();
    if (reader === undefined) throw new Error('no response stream');
    const decoder = new TextDecoder();
    const pump = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }
    })().catch(() => {
      // aborted at the end of the test
    });

    // Retry hint arrives before any event.
    await until(() => buffer.includes(`retry: ${SSE_RETRY_MS}`));
    // Keep-alive comments flow while the stream idles (40 ms cadence).
    await until(() => buffer.includes(': keep-alive'));

    // Run the job; its progress + completion must arrive as SSE frames.
    await ctx.worker.runOnce();
    await until(() => buffer.includes('event: completed'));

    const dataLines = buffer
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice('data: '.length)) as {
        channel: string;
        type: string;
        data: { pct?: number };
        ts: string;
      });
    const progress = dataLines.filter((frame) => frame.type === 'progress');
    expect(progress.map((frame) => frame.data.pct)).toEqual([0, 50, 100]);
    expect(progress.every((frame) => frame.channel === `jobs:${job.id}`)).toBe(true);
    expect(buffer).toContain('event: progress');
    expect(dataLines.at(-1)?.type).toBe('completed');

    // A cross-channel publish reaches the same stream.
    ctx.hub.publish(`notifications:${OWNER}`, 'created', { id: 'ntf_1' });
    await until(() => buffer.includes('event: created'));

    controller.abort();
    await pump;
    // Server side detaches its hub subscriptions on close.
    await until(() => ctx.hub.subscriberCount(`jobs:${job.id}`) === 0);
    expect(ctx.hub.subscriberCount(`notifications:${OWNER}`)).toBe(0);
  });
});
