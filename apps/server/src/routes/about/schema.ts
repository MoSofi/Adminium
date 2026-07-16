/**
 * Zod schemas for the About resource (M10-T04; 01-architecture.md §9.3 — the
 * AGPL §13 source offer is satisfied by linking the public repo from the
 * instance's About screen).
 */
import { z } from 'zod';

import { metaDialect } from '../system/schema.js';

export const aboutReply = z.object({
  data: z.object({
    /** Running build, from apps/server/package.json. */
    version: z.string(),
    /** SPDX id — AGPL-3.0-only. */
    license: z.string(),
    /** The AGPL §13 source offer: where this instance's source lives. */
    sourceUrl: z.string(),
    /** Full licence text (repo LICENSE). */
    licenseUrl: z.string(),
    /** Which engine backs the meta store (07-meta-store.md). */
    metaEngine: metaDialect,
    node: z.string(),
    /** Current preferences, so About can explain (and link to) both switches. */
    telemetry: z.object({ enabled: z.boolean() }),
    updates: z.object({ checkEnabled: z.boolean() }),
  }),
});
export type AboutReply = z.infer<typeof aboutReply>;

/**
 * `GET /about/update-check`. `disabled` is a first-class, un-alarming outcome:
 * the instance opted out and made no outbound call (M10-T04).
 */
export const aboutUpdateCheckReply = z.object({
  data: z.discriminatedUnion('status', [
    z.object({ status: z.literal('disabled') }),
    z.object({ status: z.literal('current'), current: z.string() }),
    z.object({ status: z.literal('unknown'), current: z.string() }),
    z.object({
      status: z.literal('update-available'),
      current: z.string(),
      latest: z.string(),
      url: z.string(),
    }),
  ]),
});
export type AboutUpdateCheckReply = z.infer<typeof aboutUpdateCheckReply>;
