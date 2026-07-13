/**
 * Jobs routes (08-server-api.md §2.17, M2-T07), mounted under `/api/v1`:
 *
 * - `POST /jobs`            — enqueue by kind (`system:jobs:manage`)
 * - `GET  /jobs/:id`        — status + progress (owner or `system:jobs:read`)
 * - `GET  /jobs`            — keyset list (`system:jobs:read`)
 * - `POST /jobs/:id/cancel` — cooperative cancel (owner or `system:jobs:manage`)
 *
 * "Owner" is the `payload.userId` convention; `POST /jobs` stamps it with the
 * enqueuing user. Progress comes from the in-process worker (01 §5 model).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ZodError } from 'zod';

import { jobsRepo, type Job, type MetaDb } from '@adminium/meta';

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationFailedError,
} from '../../errors.js';
import type { JobRegistry } from '../../jobs/registry.js';
import { jobChannel, type JobWorker } from '../../jobs/worker.js';
import {
  JOBS_MANAGE_PERMISSION,
  JOBS_READ_PERMISSION,
  type RealtimeHub,
  type RealtimeUser,
} from '../../realtime/hub.js';
import type { RealtimeGatewayDeps } from '../../realtime/ws.js';
import {
  jobsCancelReply,
  jobsCreateBody,
  jobsCreateReply,
  jobsGetParams,
  jobsGetReply,
  jobsListQuery,
  jobsListReply,
  jobStatus,
  type JobView,
} from './schema.js';

export interface JobsRoutesDeps {
  meta: MetaDb;
  registry: JobRegistry;
  worker: JobWorker;
  hub: RealtimeHub;
  resolveUser: RealtimeGatewayDeps['resolveUser'];
  can: RealtimeGatewayDeps['can'];
}

/** Owner convention: `payload.userId` names the enqueuing user. */
export function jobOwnerId(job: Pick<Job, 'payload'> | null): string | null {
  if (job === null) return null;
  const userId = job.payload['userId'];
  return typeof userId === 'string' && userId.length > 0 ? userId : null;
}

const CURSOR_SEP = '.';

function encodeCursor(createdAt: number, id: string): string {
  return Buffer.from(`${createdAt}${CURSOR_SEP}${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: number; id: string } {
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  const sep = text.indexOf(CURSOR_SEP);
  const createdAt = sep > 0 ? Number(text.slice(0, sep)) : Number.NaN;
  const id = sep > 0 ? text.slice(sep + 1) : '';
  if (!Number.isSafeInteger(createdAt) || id.length === 0) {
    throw new ValidationFailedError('malformed cursor');
  }
  return { createdAt, id };
}

export function jobsRoutes(deps: JobsRoutesDeps): FastifyPluginAsyncZod {
  const { meta, registry, worker, hub } = deps;
  const jobs = jobsRepo(meta);

  const requireUser = async (request: Parameters<typeof deps.resolveUser>[0]): Promise<RealtimeUser> => {
    const user = await deps.resolveUser(request);
    if (user === null) throw new UnauthorizedError();
    return user;
  };

  interface JobViewSource {
    id: string;
    kind: string;
    status: string;
    priority: number;
    runAt: number;
    attempts: number;
    maxAttempts: number;
    lastError: string | null;
    createdAt: number;
    startedAt: number | null;
    finishedAt: number | null;
  }

  const toView = (job: JobViewSource): JobView => {
    const progress =
      worker.getProgress(job.id) ?? (job.status === 'succeeded' ? { pct: 100 } : null);
    return {
      id: job.id,
      kind: job.kind,
      status: jobStatus.parse(job.status),
      priority: job.priority,
      runAt: job.runAt,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      progress,
      lastError: job.lastError,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    };
  };

  /** Owner of the job, or holder of `permission`. */
  const canAccessJob = async (
    user: RealtimeUser,
    job: Job,
    permission: string,
  ): Promise<boolean> => {
    if (jobOwnerId(job) === user.id) return true;
    return await deps.can(user, permission);
  };

  return async (app) => {
    app.post(
      '/jobs',
      { schema: { body: jobsCreateBody, response: { 202: jobsCreateReply } } },
      async (request, reply) => {
        const user = await requireUser(request);
        if (!(await deps.can(user, JOBS_MANAGE_PERMISSION))) {
          throw new ForbiddenError(`Enqueueing jobs requires ${JOBS_MANAGE_PERMISSION}.`);
        }
        const body = request.body;
        const entry = registry.get(body.kind);
        if (entry === undefined) {
          throw new ValidationFailedError(`Unknown job kind "${body.kind}".`, {
            kind: body.kind,
            known: registry.kinds(),
          });
        }
        // Stamp the owner (client-supplied userId is overridden — owners are
        // never spoofable), then check the payload against the handler's
        // schema now — a payload that can never run should fail at enqueue.
        const payload = { ...body.payload, userId: user.id };
        try {
          entry.schema.parse(payload);
        } catch (err) {
          if (err instanceof ZodError) {
            throw new ValidationFailedError(`Invalid payload for job kind "${body.kind}".`, {
              issues: err.issues.map((issue) => ({
                path: issue.path.map(String).join('.'),
                message: issue.message,
                code: issue.code,
              })),
            });
          }
          throw err;
        }
        const job = await jobs.enqueue({
          kind: body.kind,
          payload,
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.runAt !== undefined ? { runAt: body.runAt } : {}),
          ...(body.maxAttempts !== undefined ? { maxAttempts: body.maxAttempts } : {}),
          ...(body.dedupeKey !== undefined ? { dedupeKey: body.dedupeKey } : {}),
        });
        return reply
          .status(202)
          .send({ data: { jobId: job.id, status: jobStatus.parse(job.status) } });
      },
    );

    app.get(
      '/jobs/:id',
      { schema: { params: jobsGetParams, response: { 200: jobsGetReply } } },
      async (request) => {
        const user = await requireUser(request);
        const job = await jobs.findById(request.params.id);
        if (job === null) throw new NotFoundError(`Job ${request.params.id} not found.`);
        if (!(await canAccessJob(user, job, JOBS_READ_PERMISSION))) {
          throw new ForbiddenError('You do not have access to this job.');
        }
        return { data: toView(job) };
      },
    );

    app.get(
      '/jobs',
      { schema: { querystring: jobsListQuery, response: { 200: jobsListReply } } },
      async (request) => {
        const user = await requireUser(request);
        if (!(await deps.can(user, JOBS_READ_PERMISSION))) {
          throw new ForbiddenError(`Listing jobs requires ${JOBS_READ_PERMISSION}.`);
        }
        const { kind, status, limit, cursor } = request.query;

        let query = meta.db.selectFrom('adminium_jobs').selectAll();
        if (kind !== undefined) query = query.where('kind', '=', kind);
        if (status !== undefined) query = query.where('status', '=', status);
        if (cursor !== undefined) {
          const after = decodeCursor(cursor);
          query = query.where((eb) =>
            eb.or([
              eb('createdAt', '<', after.createdAt),
              eb.and([eb('createdAt', '=', after.createdAt), eb('id', '<', after.id)]),
            ]),
          );
        }
        // Keyset order: newest first, id as the tiebreaker (§1.5 cursor lists).
        const rows = await query
          .orderBy('createdAt', 'desc')
          .orderBy('id', 'desc')
          .limit(limit + 1)
          .execute();

        const page = rows.slice(0, limit);
        const views = page.map((row) => toView(row));
        const last = page.at(-1);
        const next =
          rows.length > limit && last !== undefined ? encodeCursor(last.createdAt, last.id) : null;
        return { data: views, cursor: { next } };
      },
    );

    app.post(
      '/jobs/:id/cancel',
      { schema: { params: jobsGetParams, response: { 200: jobsCancelReply } } },
      async (request) => {
        const user = await requireUser(request);
        const job = await jobs.findById(request.params.id);
        if (job === null) throw new NotFoundError(`Job ${request.params.id} not found.`);
        if (!(await canAccessJob(user, job, JOBS_MANAGE_PERMISSION))) {
          throw new ForbiddenError('You cannot cancel this job.');
        }
        if (job.status === 'pending') {
          const cancelled = await jobs.cancel(job.id);
          if (cancelled) {
            hub.publish(jobChannel(job.id), 'cancelled', { jobId: job.id, kind: job.kind });
          }
        } else if (job.status === 'running') {
          // Cooperative (§2.17): the in-process worker aborts the run's
          // signal; the handler notices between batches and the worker
          // records the terminal state.
          worker.requestCancel(job.id);
        } else {
          throw new ConflictError(`Job is already ${job.status}.`);
        }
        const updated = await jobs.findById(job.id);
        if (updated === null) throw new NotFoundError(`Job ${job.id} not found.`);
        return { data: toView(updated) };
      },
    );
  };
}
