/**
 * Zod request/response schemas for `routes/connections/`
 * (08-server-api.md §2.4). DSNs never appear in replies — `dsnMasked` only.
 */

import { z } from 'zod';

export const connectionEngineSchema = z.enum(['postgres', 'mysql', 'sqlite']);

export const connectionRolesSchema = z.object({
  /** Schema-metadata-only role (01 §3); falls back to `data`. */
  introspect: z.string().min(1).optional(),
  /** CRUD role; falls back to `introspect`/`dsn`. */
  data: z.string().min(1).optional(),
});

export const connectionCreateBody = z.object({
  name: z.string().min(1).max(80),
  engine: connectionEngineSchema,
  /** Single-DSN shorthand ("use same credentials"). */
  dsn: z.string().min(1).optional(),
  /** Advanced split per the three-connection model. */
  roles: connectionRolesSchema.optional(),
  settings: z
    .object({
      includedTables: z.array(z.string()).optional(),
      intent: z.enum(['full-admin', 'read-only-analytics', 'crud', 'support-console']).optional(),
    })
    .optional(),
});
export type ConnectionCreateBody = z.infer<typeof connectionCreateBody>;

export const connectionIdParams = z.object({ id: z.string().min(1) });

export const connectionPatchBody = z.object({
  name: z.string().min(1).max(80).optional(),
  settings: connectionCreateBody.shape.settings,
});

export const connectionDeleteBody = z.object({
  /** Type-to-confirm contract: must match the connection name exactly. */
  confirmName: z.string(),
  force: z.boolean().optional(),
});

export const connectionTestBody = z.object({
  engine: connectionEngineSchema,
  dsn: z.string().min(1),
});

export const connectionTestReply = z.object({
  ok: z.boolean(),
  latencyMs: z.number(),
  serverVersion: z.string().nullable(),
  readOnly: z.boolean(),
  privileges: z
    .object({
      canReadSchema: z.boolean(),
      canRead: z.boolean(),
      canWrite: z.boolean(),
      canDDL: z.boolean(),
    })
    .nullable(),
  error: z
    .object({ code: z.string(), message: z.string(), hint: z.string().nullable() })
    .nullable(),
});
export type ConnectionTestReply = z.infer<typeof connectionTestReply>;

export const connectionDto = z.object({
  id: z.string(),
  name: z.string(),
  engine: z.string(),
  sourceKind: z.string(),
  /** Credentials stripped — `postgres://ava@db.acme.io:5432/prod`. */
  dsnMasked: z.string().nullable(),
  readOnly: z.boolean(),
  status: z.string(),
  lastTestedAt: z.number().nullable(),
  lastLatencyMs: z.number().nullable(),
  lastError: z.string().nullable(),
  /** Health-card snapshot age (§2.4). */
  snapshot: z
    .object({ id: z.string(), createdAt: z.number(), checksum: z.string() })
    .nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ConnectionDto = z.infer<typeof connectionDto>;

export const connectionReply = connectionDto;
export const connectionListReply = z.object({ connections: z.array(connectionDto) });

export const okReply = z.object({ ok: z.literal(true) });

export const introspectSyncReply = z.object({
  snapshotId: z.string(),
  noop: z.boolean(),
  proposedMasks: z.number(),
  checksum: z.string(),
});

export const jobAcceptedReply = z.object({ jobId: z.string() });
