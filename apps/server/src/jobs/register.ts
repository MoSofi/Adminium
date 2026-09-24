// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One-call wiring for jobs + realtime: builds the hub, handler registry (with
 * the demo `noop-progress` handler), polling worker and croner scheduler,
 * registers `@fastify/websocket` + `GET /ws`, the SSE fallback and the
 * `routes/jobs` resource under `/api/v1`, and hooks start/drain into the
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
import type { ConnectionManager } from '../connections/manager.js';
import type { DsnCrypto } from '@adminium/meta';

import type { FileStore } from '../files/store.js';
import { EMAIL_CAMPAIGN_RUN_KIND, registerEmailCampaignRunHandler } from './email-campaign-run.js';
import {
  EMAIL_SEND_JOB_KIND,
  registerEmailSendHandler,
  type EmailSendHandlerDeps,
} from './email-send.js';
import type { RenderDeps } from '../documents/render.js';
import { DOCUMENT_RENDER_KIND, registerDocumentRenderHandler } from './document-render.js';
import { EXPORT_RUN_KIND, registerExportRunHandler } from './export-run.js';
import { FILES_MIGRATE_KIND, registerFilesMigrateHandler } from './files-migrate.js';
import type { RecordWriteService } from '../crud/write-service.js';
import { IMPORT_RUN_KIND, registerImportRunHandler } from './import-run.js';
import type { WidgetDataCache } from '../widget-data/cache.js';
import {
  ASSISTANT_TURN_KIND,
  registerAssistantTurnHandler,
  type AssistantTurnDeps,
} from './assistant-turn.js';
import { LLM_RUN_KIND, registerLlmRunHandler, type ResolveRun } from './llm-run.js';
import { REPORT_RUN_KIND, registerReportRunHandler } from './report-run.js';
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
  /**
   * Wire the direct-API LLM enrichment runner (`llm-run` kind). When supplied,
   * the handler is registered on the registry (unless a custom registry already
   * carries it). `resolve` turns a run into a live provider client with the
   * decrypted key — build it with `createProviderResolver`
   * (`llm/provider-resolver.ts`).
   */
  llm?:
    | {
        resolve: ResolveRun;
      }
    | undefined;
  /**
   * Wire the `email.send` runner (`jobs/email-send.ts`). The secret is the
   * master `ADMINIUM_SECRET`: it opens the sealed job envelope AND the
   * `email.smtp.passEncrypted` setting. Omit it and no handler is registered —
   * an instance with no email layer simply never claims the kind, and
   * `enqueueEmail` never queues one either.
   */
  email?:
    | {
        secret: string;
        /** Transport factory override (tests inject a recorder). */
        createTransport?: EmailSendHandlerDeps['createTransport'];
        /**
         * The file store attachments and inline images are read through at
         * delivery. Absent keeps the pre-39 shape: a message with an
         * attachment then fails loudly rather than sending without it.
         */
        storage?: EmailSendHandlerDeps['storage'];
        /** A message sent for a row failed for good: tell the row. */
        onGiveUp?: EmailSendHandlerDeps['onGiveUp'];
      }
    | undefined;
  /**
   * Wire the data-io runners (`export-run` / `import-run`). When supplied,
   * both handlers are registered on the registry (unless a custom registry
   * already carries them). `manager`/`storage` are the same instances the
   * exports/imports routes receive in compose.
   */
  /**
   * Wire the `document.render` runner. Present ⇒ the queued render path
   * exists: `POST /documents/render`, a public request-shaped intent, and a
   * retry of either. The TRIGGERED path does not come through here — a
   * profile's trigger is an automation, and the render is a step inside that
   * rule's own run (D55).
   */
  documents?: RenderDeps | undefined;
  dataIo?:
    | {
        manager: ConnectionManager;
        storage: FileStore;
        /**
         * Storage-credential closures. Present ⇒ `files.migrate` is registered
         * too — it moves bytes between destinations and therefore needs to read
         * their credentials. Absent keeps the pre-37 shape, which is what every
         * test that predates this wave passes.
         */
        storageCrypto?: DsnCrypto | undefined;
        /** Where an import's rows go, with the project's hooks. */
        writes?: RecordWriteService | undefined;
        /** The widget-data result cache an import drops its table from. */
        widgetCache?: WidgetDataCache | undefined;
      }
    | undefined;
  /**
   * Wire the page assistant's turn runner (`assistant.turn`). `resolveClient`
   * must be the GUARDED resolver (`routes/llm/config-service.ts`), which
   * re-checks the stored base URL against the outbound guard as it dials;
   * `can` answers a system permission for the turn's own user, outside a
   * request. Absent ⇒ the kind is never claimed, and nothing enqueues one
   * either, because the routes are not registered without a provider layer.
   */
  assistant?:
    | {
        manager: ConnectionManager;
        resolveClient: AssistantTurnDeps['resolveClient'];
        can: AssistantTurnDeps['can'];
      }
    | undefined;
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
  /** Programmatic enqueue for other plugins (`app.jobs.enqueue`). */
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
  if (opts.llm !== undefined && !registry.has(LLM_RUN_KIND)) {
    registerLlmRunHandler(registry, { meta, resolve: opts.llm.resolve });
  }
  if (opts.email !== undefined && !registry.has(EMAIL_SEND_JOB_KIND)) {
    registerEmailSendHandler(registry, {
      meta,
      secret: opts.email.secret,
      ...(opts.email.createTransport === undefined
        ? {}
        : { createTransport: opts.email.createTransport }),
      ...(opts.email.storage === undefined ? {} : { storage: opts.email.storage }),
      ...(opts.email.onGiveUp === undefined ? {} : { onGiveUp: opts.email.onGiveUp }),
    });
  }

  const hub = new RealtimeHub();
  // The campaign runner rides the same `email` option: same secret,
  // same transport factory, same file store — plus the hub for the creator's
  // notice, which is why it registers after the hub exists.
  if (opts.email !== undefined && !registry.has(EMAIL_CAMPAIGN_RUN_KIND)) {
    registerEmailCampaignRunHandler(registry, {
      meta,
      secret: opts.email.secret,
      hub,
      ...(opts.email.createTransport === undefined ? {} : { createTransport: opts.email.createTransport }),
      ...(opts.email.storage === undefined ? {} : { storage: opts.email.storage }),
    });
  }
  if (opts.documents !== undefined && !registry.has(DOCUMENT_RENDER_KIND)) {
    registerDocumentRenderHandler(registry, opts.documents);
  }
  if (opts.assistant !== undefined && !registry.has(ASSISTANT_TURN_KIND)) {
    registerAssistantTurnHandler(registry, {
      meta,
      manager: opts.assistant.manager,
      resolveClient: opts.assistant.resolveClient,
      can: opts.assistant.can,
    });
  }
  if (opts.dataIo !== undefined) {
    const { manager, storage } = opts.dataIo;
    if (!registry.has(EXPORT_RUN_KIND)) {
      registerExportRunHandler(registry, { meta, manager, storage });
    }
    if (!registry.has(IMPORT_RUN_KIND)) {
      registerImportRunHandler(registry, {
        meta,
        manager,
        storage,
        hub,
        writes: opts.dataIo.writes,
        widgetCache: opts.dataIo.widgetCache,
      });
    }
    // report-run rides the SAME option: it drives the export-run handler
    // through this registry (jobs/report-run.ts), so it is only meaningful
    // where the data-io pipeline is wired.
    if (!registry.has(REPORT_RUN_KIND)) {
      registerReportRunHandler(registry, { meta, registry, hub });
    }
    // `files.migrate` is INTERNAL: only `POST /storage/migrate`
    // enqueues it, never the generic `POST /jobs`. Its payload names a source
    // and a target destination, and a `jobs.manage` holder hand-crafting one
    // would move an instance's bytes without holding `storage.manage`.
    if (opts.dataIo.storageCrypto !== undefined && !registry.has(FILES_MIGRATE_KIND)) {
      registerFilesMigrateHandler(registry, { meta, storage, storageCrypto: opts.dataIo.storageCrypto });
    }
  }
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
    // Job owners may follow their own jobs:<id> channel (topics table).
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

  // Graceful shutdown: stop ticking, drain in-flight jobs, drop
  // realtime subscriptions (WS sockets are closed by @fastify/websocket).
  app.addHook('onClose', async () => {
    scheduler.stop();
    await worker.stop();
    hub.close();
  });

  return facade;
}
