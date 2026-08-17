// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Wire schemas for the desktop capability grant table (11-electron.md §12).
 *
 * The grant identity `{ manifestId, capabilityId }` is the body of both POST
 * (consent) and DELETE (revoke) — one shape, so a form that can grant can revoke
 * the same thing. `capabilityId` is the closed host vocabulary (`catalog.ts`),
 * NOT a free string: a grant for a capability this build has no provider for
 * would be a dead row that the consent UI could offer and the host could never
 * honour, so an unknown id is a 422 here rather than a persisted lie.
 */
import { z } from 'zod';

import { capabilityGrantSchema } from '@adminium/meta';

import { capabilityIdSchema } from '../../capabilities/catalog.js';

/** The identity written by consent / removed by revoke. */
export const capabilityGrantRefBody = z.strictObject({
  /** The installed micro-SaaS manifest's id (reverse-DNS; §12 / 13-marketplace.md). */
  manifestId: z.string().min(1).max(200),
  capabilityId: capabilityIdSchema,
});
export type CapabilityGrantRefBody = z.infer<typeof capabilityGrantRefBody>;

export const capabilityGrantsListReply = z.object({
  data: z.object({ grants: z.array(capabilityGrantSchema) }),
});
export type CapabilityGrantsListReply = z.infer<typeof capabilityGrantsListReply>;

export const capabilityGrantReply = z.object({
  data: z.object({ grant: capabilityGrantSchema }),
});
export type CapabilityGrantReply = z.infer<typeof capabilityGrantReply>;

export const capabilityRevokeReply = z.object({
  /** `removed: false` when there was no such grant — revoke is idempotent, not an error. */
  data: z.object({ removed: z.boolean() }),
});
export type CapabilityRevokeReply = z.infer<typeof capabilityRevokeReply>;
