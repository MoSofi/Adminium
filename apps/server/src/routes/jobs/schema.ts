// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for the jobs resource (08-server-api.md §1.5 naming, §2.17
 * routes). Success envelope `{ data }`; the cursor list adds
 * `cursor: { next }` per §1.5.
 */
import { z } from 'zod';

export const jobStatus = z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled']);
export type JobStatusValue = z.infer<typeof jobStatus>;

/** In-process progress snapshot; `null` when this process has none. */
export const jobProgress = z
  .object({
    pct: z.number().int().min(0).max(100),
    step: z.string().nullish(),
    message: z.string().nullish(),
  })
  .nullable();

export const jobView = z.object({
  id: z.string(),
  kind: z.string(),
  status: jobStatus,
  priority: z.number().int(),
  runAt: z.number().int(),
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  progress: jobProgress,
  lastError: z.string().nullable(),
  createdAt: z.number().int(),
  startedAt: z.number().int().nullable(),
  finishedAt: z.number().int().nullable(),
});
export type JobView = z.infer<typeof jobView>;

export const jobsCreateBody = z.object({
  kind: z.string().min(1).max(60),
  payload: z.record(z.string(), z.unknown()).default({}),
  priority: z.number().int().min(-100).max(100).optional(),
  /** Epoch ms; defaults to now (immediate). */
  runAt: z.number().int().nonnegative().optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  dedupeKey: z.string().min(1).max(120).optional(),
});
export type JobsCreateBody = z.infer<typeof jobsCreateBody>;

/** 202 accepted envelope (§2 `jobAcceptedReply`). */
export const jobsCreateReply = z.object({
  data: z.object({ jobId: z.string(), status: jobStatus }),
});
export type JobsCreateReply = z.infer<typeof jobsCreateReply>;

export const jobsGetParams = z.object({ id: z.string().min(1) });
export type JobsGetParams = z.infer<typeof jobsGetParams>;

export const jobsGetReply = z.object({ data: jobView });
export type JobsGetReply = z.infer<typeof jobsGetReply>;

export const jobsListQuery = z.object({
  kind: z.string().min(1).max(60).optional(),
  status: jobStatus.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  /** Keyset cursor from a previous page's `cursor.next`. */
  cursor: z.string().max(200).optional(),
});
export type JobsListQuery = z.infer<typeof jobsListQuery>;

export const jobsListReply = z.object({
  data: z.array(jobView),
  cursor: z.object({ next: z.string().nullable() }),
});
export type JobsListReply = z.infer<typeof jobsListReply>;

export const jobsCancelReply = z.object({ data: jobView });
export type JobsCancelReply = z.infer<typeof jobsCancelReply>;
