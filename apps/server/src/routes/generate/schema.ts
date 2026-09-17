// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Zod request/response schemas for `routes/generate/` (the M5
 * `/regenerate` review flow builds on the same shapes).
 */

import { z } from 'zod';
import { generateIntentSchema } from '@adminium/engine';

export const generateParams = z.object({ id: z.string().min(1) });

/** Body is optional (POSTs without one arrive as null); a provided intent overrides the connection setting for this run. */
export const generateBody = z
  .object({ intent: generateIntentSchema.optional() })
  .nullish();

export const generateReply = z.object({
  /** Number of pages the generator now owns for this connection. */
  pages: z.number().int().nonnegative(),
  /** Distinct nav groups the emitted pages landed in (five-group set). */
  navGroups: z.array(z.string()),
  snapshotId: z.string(),
  /** True when generation had to run introspection first. */
  introspected: z.boolean(),
  intent: generateIntentSchema,
  result: z.object({
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    pruned: z.number().int().nonnegative(),
    preserved: z.array(z.string()),
    /** Human-edited generated pages left untouched (user delta wins). */
    skippedEdited: z.array(z.string()),
    /** Human-edited pages the generator dropped — kept instead of pruned (user delta wins extends to deletion). */
    keptEdited: z.array(z.string()),
  }),
  /** `origin: 'llm'` seed rows expanded into envelopes this run. */
  llmPagesMaterialized: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
  durationMs: z.number().nonnegative(),
});
export type GenerateReply = z.infer<typeof generateReply>;
