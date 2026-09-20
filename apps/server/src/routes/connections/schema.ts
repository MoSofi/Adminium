// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod request/response schemas for `routes/connections/`.
 * DSNs never appear in replies — `dsnMasked` only.
 */

import { z } from 'zod';

export const connectionEngineSchema = z.enum(['postgres', 'mysql', 'sqlite']);

export const connectionRolesSchema = z.object({
  /** Schema-metadata-only role; falls back to `data`. */
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
  /** Remediation copy for `lastError`, from the adapter. */
  lastErrorHint: z.string().nullable(),
  /**
   * Tenant configuration. Carried on the connection because it describes the
   * BUSINESS, and a hosted surface — which has no scope and no key — can
   * reach it here and nowhere else.
   */
  timezone: z.string().nullable(),
  /**
   * Who chose `timezone` (0018): `operator`, `host` when the server seeded its
   * own zone so a hosted surface had something to render, or null for no claim.
   * Studio needs it to keep a guess from reading as a decision.
   */
  timezoneSource: z.enum(['host', 'operator']).nullable(),
  /**
   * THIS SERVER's own zone — never the connection's, and never stored.
   *
   * A hosted surface has to render a date even when `timezone` is null, and
   * before this it substituted UTC on its own. That was a guess made in six
   * app repos, invisible here, and wrong everywhere the server is not in UTC:
   * a Berlin deployment with an unconfigured connection rendered its own
   * business's evenings an hour early and called it "UTC" on a badge.
   *
   * Reported SEPARATELY from `timezone` rather than substituted into it,
   * because this endpoint is also the one Studio edits a connection through.
   * Folding the guess into the stored field would show an operator a zone the
   * database does not hold, and a save would then persist it as their own
   * decision — exactly the over-claim migration 0018 refused to backfill.
   *
   * Consumers use it only as the fallback when `timezone` is null, and report
   * the result as the `host` source: a real zone that nobody chose.
   */
  serverTimezone: z.string(),
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
  /**
   * Whether this connection's SCHEMA can be authored, and why not.
   *
   * Derived server-side from the same function the DDL routes refuse with, so
   * Studio can leave the Design surface out entirely instead of offering a
   * button whose only possible outcome is a 403. `reason` is the refusal's own
   * code — the UI renders a sentence for it, it does not re-derive the rule.
   */
  schemaAuthoring: z.object({
    authorable: z.boolean(),
    reason: z
      .enum(['NO_LIVE_DATABASE', 'READ_ONLY_ROLE', 'NO_DDL_PRIVILEGE', 'READ_ONLY_INTENT'])
      .nullable(),
  }),
  /** Health-card snapshot age. */
  snapshot: z
    .object({ id: z.string(), createdAt: z.number(), checksum: z.string() })
    .nullable(),
  /** Included tables (settings allowlist, else the latest snapshot's model). */
  tableCount: z.number().int().nullable(),
  /** Generated pages owned by this connection (hub cards). */
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
