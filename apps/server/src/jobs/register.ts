/**
 * One-call wiring for jobs + realtime (M2-T07): builds the hub, handler
 * registry (with the demo `noop-progress` handler), polling worker and croner
 * scheduler, registers `@fastify/websocket` + `GET /ws`, the SSE fallback and
 * the `routes/jobs` resource under `/api/v1`, and hooks start/drain into the
 * Fastify lifecycle.
 *
 * INTEGRATION POINT — `app.ts` (or the auth agent's extension hook) calls
 *
 *   await registerJobsAndRealtime(app, {
 *     meta,
 *     resolveUser: (req) => req.user ?? null,          // auth plugin
 *     can: (user, permission) => app.rbac.can(user, permission), // rbac plugin
 *   });
 *
 * AFTER the auth plugin is registered, so `resolveUser` can lean on
 * `request.user`. This module deliberately does not touch `app.ts` or
 * `plugins/auth.ts` (owned by the auth agent this wave).
 */

import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';

import { jobsRepo, type EnqueueJobInput, type Job, type MetaDb } from '@adminium/meta';

import { API_PREFIX } from '../routes/index.js';
import { jobOwnerId, jobsRoutes } from '../routes/jobs/index.js';
import { RealtimeHub } from '../realtime/hub.js';
import { registerSseRoute } from '../realtime/sse.js';
import { registerWsRoute, type RealtimeGatewayDeps } from '../realtime/ws.js';
import { createJobRegistry, registerNoopProgressHandler, type JobRegistry } from './registry.js';
import { JobScheduler } from './scheduler.js';
import { JobWorker } from './worker.js';

export interface JobsAndRealtimeOptions {
  meta: MetaDb;
  /** Session resolution — wire to the auth plugin's `request.user`. */
  resolveUser: RealtimeGatewayDeps['resolveUser'];
  /** RBAC check — wire to the rbac plugin. */
  can: RealtimeGatewayDeps['can'];
  /** Custom registry (tests/extensions); default: fresh + `noop-progress`. */
  registry?: JobRegistry | undefined;
  /** Worker tuning knobs. */
  worker?:
    | {
        concurrency?: number | undefined;
        pollIntervalMs?: number | undefined;
        workerId?: string | undefined;
        backoffBaseMs?: number | undefined;
        backoffMaxMs?: number | undefined;
      }
    | undefined;
  /** Start the worker poll loop on `onReady`; default true. */
  startWorker?: boolean | undefined;
  /** Start the scheduler on `onReady`; default true. */
  startScheduler?: boolean | undefined;
  /** Route mount prefix; default {@link API_PREFIX}. */
  apiPrefix?: string | undefined;
}

export interface JobsAndRealtime {
  hub: RealtimeHub;
  registry: JobRegistry;
  worker: JobWorker;
  scheduler: JobScheduler;
  /** Programmatic enqueue for other plugins (08 §2 `app.jobs.enqueue`). */
  enqueue(input: EnqueueJobInput): Promise<Job>;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Set by `registerJobsAndRealtime` (jobs/register.ts). */
    jobs: JobsAndRealtime;
    /** The realtime hub; publish server-side events here. */
    realtime: RealtimeHub;
  }
}

export async function registerJobsAndRealtime(
  app: FastifyInstance,
  opts: JobsAndRealtimeOptions,
): Promise<JobsAndRealtime> {
  const { meta } = opts;
  const jobs = jobsRepo(meta);

  let registry = opts.registry;
  if (registry === undefined) {
    registry = createJobRegistry();
    registerNoopProgressHandler(registry);
  }

  const hub = new RealtimeHub();
  const worker = new JobWorker({
    meta,
    registry,
    hub,
    logger: app.log,
    concurrency: opts.worker?.concurrency,
    pollIntervalMs: opts.worker?.pollIntervalMs,
    workerId: opts.worker?.workerId,
    backoffBaseMs: opts.worker?.backoffBaseMs,
    backoffMaxMs: opts.worker?.backoffMaxMs,
  });
  const scheduler = new JobScheduler({ jobs, logger: app.log });

  const gatewayDeps: RealtimeGatewayDeps = {
    hub,
    resolveUser: opts.resolveUser,
    can: opts.can,
    // Job owners may follow their own jobs:<id> channel (§3 topics table).
    getJobOwner: async (jobId) => jobOwnerId(await jobs.findById(jobId)),
  };

  await app.register(websocket, {
    options: { maxPayload: 64 * 1024 },
  });
  registerWsRoute(app, gatewayDeps);

  await app.register(
    async (api) => {
      registerSseRoute(api, gatewayDeps);
      await api.register(
        jobsRoutes({
          meta,
          registry,
          worker,
          hub,
          resolveUser: opts.resolveUser,
          can: opts.can,
        }),
      );
    },
    { prefix: opts.apiPrefix ?? API_PREFIX },
  );

  const facade: JobsAndRealtime = {
    hub,
    registry,
    worker,
    scheduler,
    enqueue: async (input) => await jobs.enqueue(input),
  };

  if (!app.hasDecorator('jobs')) app.decorate('jobs', facade);
  if (!app.hasDecorator('realtime')) app.decorate('realtime', hub);

  app.addHook('onReady', async () => {
    if (opts.startWorker ?? true) worker.start();
    if (opts.startScheduler ?? true) scheduler.start();
  });

  // Graceful shutdown (08 §6.10): stop ticking, drain in-flight jobs, drop
  // realtime subscriptions (WS sockets are closed by @fastify/websocket).
  app.addHook('onClose', async () => {
    scheduler.stop();
    await worker.stop();
    hub.close();
  });

  return facade;
}
