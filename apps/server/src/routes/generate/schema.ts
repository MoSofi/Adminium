/**
 * Zod request/response schemas for `routes/generate/` (M4-T08; the M5
 * `/regenerate` review flow from 05 §11 builds on the same shapes).
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
  /** Distinct nav groups the emitted pages landed in (09 §2.2 five-group set). */
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
    /** Human-edited generated pages left untouched (user delta wins, 04 §6.3). */
    skippedEdited: z.array(z.string()),
  }),
  /** `origin: 'llm'` seed rows expanded into envelopes this run (06 §8.3). */
  llmPagesMaterialized: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
  durationMs: z.number().nonnegative(),
});
export type GenerateReply = z.infer<typeof generateReply>;
