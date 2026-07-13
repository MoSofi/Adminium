/**
 * Zod schemas for `routes/schema/` (08-server-api.md §2.5).
 * Model payloads are engine-owned JSON and pass through opaquely.
 */

import { z } from 'zod';

export const schemaConnParams = z.object({ id: z.string().min(1) });
export const snapshotParams = z.object({ id: z.string().min(1), snapshotId: z.string().min(1) });

export const schemaGetQuery = z.object({
  /** `raw=true` returns the untouched introspection result (§2.5). */
  raw: z.coerce.boolean().optional(),
});

export const schemaReply = z.object({
  connectionId: z.string(),
  snapshotId: z.string(),
  checksum: z.string(),
  createdAt: z.number(),
  source: z.string(),
  /** DatabaseModel (raw) or EffectiveModel (overrides applied). */
  model: z.unknown(),
  /** Number of active override ops applied (0 when raw). */
  appliedOverrides: z.number(),
});

export const snapshotListReply = z.object({
  snapshots: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      engineVersion: z.string().nullable(),
      checksum: z.string(),
      isActive: z.boolean(),
      createdAt: z.number(),
      createdBy: z.string().nullable(),
    }),
  ),
});

export const schemaDiffQuery = z.object({
  /** Defaults: previous vs latest (§2.5). */
  from: z.string().optional(),
  to: z.string().optional(),
});

export const schemaDiffReply = z.object({
  from: z.string().nullable(),
  to: z.string().nullable(),
  diff: z.unknown(),
});

export const overrideDto = z.object({
  id: z.string(),
  op: z.string(),
  tableName: z.string(),
  columnName: z.string().nullable(),
  value: z.record(z.string(), z.unknown()),
  origin: z.string(),
  status: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const overridesReply = z.object({ overrides: z.array(overrideDto) });

export const overridePutItem = z.object({
  op: z.string().min(1),
  tableName: z.string().min(1),
  columnName: z.string().min(1).nullish(),
  value: z.record(z.string(), z.unknown()),
  status: z.enum(['active', 'disabled']).optional(),
});

export const overridesPutBody = z.object({ overrides: z.array(overridePutItem).max(500) });
export type OverridesPutBody = z.infer<typeof overridesPutBody>;
