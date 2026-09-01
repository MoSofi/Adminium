// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared jobs/realtime test harness (not collected — no .test suffix).
 *
 * Builds an in-memory better-sqlite3 meta store (firstRun-bootstrapped), a
 * fresh handler registry + hub + worker with an injectable clock, and a bare
 * Fastify app (zod compilers + AppError envelope) that deliberately does NOT
 * go through `buildServer` — the auth plugin's native deps (argon2) and the
 * realtime deps (croner/@fastify/websocket) install at wave integration, and
 * these tests must run on the worker/hub/route modules alone.
 *
 * Auth is stubbed the same way as rbac-helpers.ts: an `x-test-user-id` header
 * names the acting user; permissions come from an in-memory grant map wired
 * into the injected `can` dependency (the integrator wires the real rbac
 * plugin there instead).
 */
import BetterSqlite3 from 'better-sqlite3';
import { fastify, type FastifyError, type FastifyRequest } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { createSqliteMetaDb, firstRun, jobsRepo, type JobsRepo, type MetaDb } from '@adminium/meta';

import { AppError, errorEnvelope } from '../src/errors.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import {
  createJobRegistry,
  registerNoopProgressHandler,
  type JobRegistry,
} from '../src/jobs/registry.js';
import { JobWorker } from '../src/jobs/worker.js';
import { RealtimeHub, type RealtimeEvent, type RealtimeUser } from '../src/realtime/hub.js';

/** Deterministic, manually-advanced clock for backoff assertions. */
export interface TestClock {
  now(): number;
  advance(ms: number): void;
}

/**
 * Default start is ahead of wall-clock time so rows enqueued with a real
 * `Date.now()` (e.g. through the routes) are already due on the fake clock.
 */
export function makeClock(start = 2_000_000_000_000): TestClock {
  let at = start;
  return {
    now: () => at,
    advance(ms: number) {
      at += ms;
    },
  };
}

export interface JobsTestContext {
  meta: MetaDb;
  jobs: JobsRepo;
  registry: JobRegistry;
  hub: RealtimeHub;
  worker: JobWorker;
  clock: TestClock;
}

export interface MakeJobsContextOptions {
  /** Custom registry; default: fresh registry with `noop-progress`. */
  registry?: JobRegistry;
  concurrency?: number;
  workerId?: string;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
}

/** In-memory meta + registry + hub + one worker, sharing a fake clock. */
export async function makeJobsContext(opts: MakeJobsContextOptions = {}): Promise<JobsTestContext> {
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);

  let registry = opts.registry;
  if (registry === undefined) {
    registry = createJobRegistry();
    registerNoopProgressHandler(registry);
  }

  const hub = new RealtimeHub();
  const clock = makeClock();
  const worker = new JobWorker({
    meta,
    registry,
    hub,
    now: clock.now,
    workerId: opts.workerId ?? 'test-host:1',
    concurrency: opts.concurrency,
    backoffBaseMs: opts.backoffBaseMs,
    backoffMaxMs: opts.backoffMaxMs,
  });

  return { meta, jobs: jobsRepo(meta), registry, hub, worker, clock };
}

/** Collects every event published on `channel` (call `stop()` to detach). */
export function collectChannel(
  hub: RealtimeHub,
  channel: string,
): { events: RealtimeEvent[]; stop: () => void } {
  const events: RealtimeEvent[] = [];
  const stop = hub.subscribe(channel, (event) => events.push(event));
  return { events, stop };
}

/** Polls `condition` until it holds (or the timeout elapses — then throws). */
export async function until(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('until(): condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- stub auth/rbac ------------------------------------------------------------------

/** Header naming the acting user (mirrors rbac-helpers.ts). */
export const TEST_USER_HEADER = 'x-test-user-id';

export interface StubAuth {
  /** Grant a permission string (e.g. `system:jobs:read`) to a user id. */
  grant(userId: string, ...permissions: string[]): void;
  resolveUser(request: FastifyRequest): RealtimeUser | null;
  can(user: RealtimeUser, permission: string): boolean;
  /** Inject headers for the given user id. */
  as(userId: string): Record<string, string>;
}

export function makeStubAuth(): StubAuth {
  const grants = new Map<string, Set<string>>();
  return {
    grant(userId, ...permissions) {
      const set = grants.get(userId) ?? new Set<string>();
      for (const permission of permissions) set.add(permission);
      grants.set(userId, set);
    },
    resolveUser(request) {
      const id = request.headers[TEST_USER_HEADER];
      return typeof id === 'string' && id.length > 0 ? { id } : null;
    },
    can(user, permission) {
      return grants.get(user.id)?.has(permission) ?? false;
    },
    as(userId) {
      return { [TEST_USER_HEADER]: userId };
    },
  };
}

// --- bare app ------------------------------------------------------------------------

/**
 * Minimal Fastify instance with the zod compilers and an AppError → §1.4
 * envelope handler (a scoped stand-in for `buildServer`, which currently
 * pulls in the auth agent's not-yet-installed native deps).
 */
export function buildBareApp() {
  const app = fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const requestId = String(request.id);
    if (error instanceof AppError) {
      void reply
        .status(error.statusCode)
        .send(errorEnvelope(error.code, error.message, requestId, error.details));
      return;
    }
    if (Array.isArray((error as { validation?: unknown[] }).validation)) {
      void reply
        .status(422)
        .send(errorEnvelope('VALIDATION_FAILED', error.message, requestId));
      return;
    }
    void reply.status(500).send(errorEnvelope('INTERNAL', error.message, requestId));
  });
  return app;
}

export type BareApp = ReturnType<typeof buildBareApp>;

/**
 * The rbac plugin plus a stub session hook, in the order `compose.ts` wires
 * them — register this BEFORE `jobsRoutes` on a bare app.
 *
 * The jobs routes take their own injected `resolveUser`/`can` and must stay
 * independently mountable, but their audit rows go through `app.rbac.audit`,
 * which resolves the actor from `request.user` (compose passes
 * `resolveUser: (req) => req.user`). A harness that wants the rows therefore
 * has to supply both halves: the decorator, and something to stamp on it.
 */
export async function withRbacAudit(app: BareApp, meta: MetaDb): Promise<void> {
  app.addHook('onRequest', async (request) => {
    const id = request.headers[TEST_USER_HEADER];
    if (typeof id === 'string' && id.length > 0) {
      (request as unknown as { user: { id: string; name: string } }).user = { id, name: id };
    }
  });
  await app.register(rbacPlugin, { meta });
}
