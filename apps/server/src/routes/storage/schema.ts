// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod schemas for storage destinations (37-files-and-storage.md Appendix C,
 * D2, D16, 37-T12).
 *
 * THE SECRET IS ASYMMETRIC AND THAT IS THE POINT. It goes IN on create and on
 * an explicit replace; it never comes back out. Reads carry `hasSecret: true`
 * and nothing more, so a route that renders a destination cannot serialize a
 * credential by accident and an editor cannot round-trip one it never saw.
 */

import { z } from 'zod';
import {
  localDestinationConfigSchema,
  s3DestinationConfigSchema,
  storageDestinationStatusSchema,
  storageDriverSchema,
  webdavDestinationConfigSchema,
} from '@adminium/meta';

export const destinationIdParams = z.object({ id: z.string().min(1) });

/** Per driver, so the wrong config for a driver is a 422 and not a stored lie. */
export const destinationSecret = z.union([
  z.object({ accessKeyId: z.string().min(1).max(200), secretAccessKey: z.string().min(1).max(400), sessionToken: z.string().max(4096).optional() }),
  z.object({ username: z.string().min(1).max(200), password: z.string().min(1).max(400) }),
]);

export const destinationCreateBody = z.object({
  name: z.string().min(1).max(80),
  driver: storageDriverSchema,
  config: z.union([localDestinationConfigSchema, s3DestinationConfigSchema, webdavDestinationConfigSchema]),
  secret: destinationSecret.optional(),
  /** Make it the default in the same transaction that creates it. */
  makeDefault: z.boolean().optional(),
});

export const destinationPatchBody = z.object({
  name: z.string().min(1).max(80).optional(),
  config: z.union([localDestinationConfigSchema, s3DestinationConfigSchema, webdavDestinationConfigSchema]).optional(),
  /**
   * Omitted keeps the stored credential; `null` clears it. The editor sends a
   * value only when the operator typed a new one (D16), so "keep" is the
   * common case and needs no round trip.
   */
  secret: destinationSecret.nullable().optional(),
  disabled: z.boolean().optional(),
});

export const destinationView = z.object({
  id: z.string(),
  name: z.string(),
  driver: storageDriverSchema,
  config: z.union([localDestinationConfigSchema, s3DestinationConfigSchema, webdavDestinationConfigSchema]),
  /** True when a credential is stored. The credential itself never appears. */
  hasSecret: z.boolean(),
  isDefault: z.boolean(),
  status: storageDestinationStatusSchema,
  lastTestedAt: z.number().nullable(),
  lastError: z.string().nullable(),
  disabled: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** Live rows pointing here — what makes a delete refusal explicable. */
  fileCount: z.number(),
});
export type DestinationView = z.infer<typeof destinationView>;

export const destinationReply = z.object({ data: destinationView });
export const destinationsListReply = z.object({ data: z.array(destinationView) });

/**
 * The Test button. A FAILURE IS A 200, not a 4xx: "I could not reach your
 * bucket" is a successful answer to "can you reach my bucket", and an error
 * status would make the dashboard's error boundary swallow the provider's
 * message — which is the only part the operator can act on.
 */
export const destinationTestReply = z.object({
  data: z.union([
    z.object({ ok: z.literal(true), latencyMs: z.number() }),
    z.object({ ok: z.literal(false), error: z.string() }),
  ]),
});

/** Test a draft before it is saved — the first-configuration path. */
export const destinationTestDraftBody = z.object({
  driver: storageDriverSchema,
  config: z.union([localDestinationConfigSchema, s3DestinationConfigSchema, webdavDestinationConfigSchema]),
  secret: destinationSecret.optional(),
});

export const storageMigrateBody = z.object({
  /** `null` is this server's disk — how "move everything off the box" is said. */
  from: z.string().min(1).nullable(),
  to: z.string().min(1).nullable(),
  kinds: z.array(z.string().min(1).max(20)).max(10).optional(),
});
export const storageMigrateReply = z.object({ data: z.object({ jobId: z.string() }) });
