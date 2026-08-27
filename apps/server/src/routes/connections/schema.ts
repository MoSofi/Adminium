// SPDX-License-Identifier: AGPL-3.0-only
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

/**
 * IANA zone. Validated as a shape here and canonicalised downstream — a
 * `Region/City` name, never an abbreviation: "BST" resolves to Asia/Dhaka and
 * "EST" to a zone that never observes daylight saving.
 */
const tenantTimezone = z.string().min(1).max(64);
/** ISO-4217, upper case. */
const tenantCurrency = z.string().length(3).regex(/^[A-Z]{3}$/, 'must be an ISO-4217 code');

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
  /*
   * Explicitly nullable, not merely optional: an operator must be able to
   * UNSET a zone they set by mistake. Omitted leaves it alone; `null` clears
   * it, and clearing it is what makes every scope over this connection refuse
   * until one is set again — which is the correct loud failure, not a
   * regression.
   */
  timezone: tenantTimezone.nullable().optional(),
  currency: tenantCurrency.nullable().optional(),
  /**
   * Pause (`true`) or resume (`false`) the source — meta wave 0019.
   *
   * A boolean rather than a timestamp: the caller knows WHETHER, the repo
   * decides WHEN. Idempotent, and omitted leaves the pause exactly as it is,
   * so a rename never resumes a connection by accident.
   */
  disabled: z.boolean().optional(),
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
  /** Remediation copy for `lastError`, from the adapter (05 §3). */
  lastErrorHint: z.string().nullable(),
  /**
   * Tenant configuration (28-T34). Carried on the connection because it
   * describes the BUSINESS, and a hosted surface — which has no scope and no
   * key — can reach it here and nowhere else.
   */
  timezone: z.string().nullable(),
  /**
   * Who chose `timezone` (0018): `operator`, `host` when the server seeded its
   * own zone so a hosted surface had something to render, or null for no claim.
   * Studio needs it to keep a guess from reading as a decision.
   */
  timezoneSource: z.enum(['host', 'operator']).nullable(),
  currency: z.string().nullable(),
  /**
   * Paused by an operator (meta wave 0019) — Adminium opens no connection to
   * this source until it is resumed. Reported ALONGSIDE `status` rather than
   * folded into it: `status` is what the last probe saw, and a card that says
   * "paused, and it was failing when you paused it" is the honest one.
   */
  disabled: z.boolean(),
  /** When it was paused; null while it is serving. */
  disabledAt: z.number().nullable(),
  /** Health-card snapshot age (§2.4). */
  snapshot: z
    .object({ id: z.string(), createdAt: z.number(), checksum: z.string() })
    .nullable(),
  /** Included tables (settings allowlist, else the latest snapshot's model). */
  tableCount: z.number().int().nullable(),
  /** Generated pages owned by this connection (M5-T05 hub cards). */
  pageCount: z.number().int(),
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
