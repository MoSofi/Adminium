// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /words/:addOn/:wordsId` — what staff are told of the rows a screen
 * shows, in an add-on's stock words.
 */
import { z } from 'zod';

export const staffWordsParams = z.object({
  addOn: z.string().min(1).max(80),
  wordsId: z.string().min(1).max(40),
});

export const staffWordsQuery = z
  .object({
    /** The table the rows are of, by its stored name (`pos:menu_items`): a rename keeps it. */
    table: z.string().min(1).max(200),
    /** The rows asked about, comma-separated: sixty at most. */
    ids: z.string().min(1).max(4000),
    /** The day asked about; today when absent. */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();

/**
 * One row asked about. `state` and `left` are what a customer may be told;
 * the rest only a caller who reads the add-on's stock tables is given: the
 * exact figure, when more is expected, the batch a use would take and when
 * it expires, whether stock or the day's portions bind, the line that runs
 * out first, and whether that batch expires soon.
 */
export const staffWordsLine = z.object({
  id: z.string(),
  state: z.enum(['in', 'low', 'out']),
  left: z.number().int().optional(),
  exact: z.string().optional(),
  after: z.string().optional(),
  batch: z.string().optional(),
  expires: z.string().optional(),
  cause: z.enum(['stock', 'portions']).optional(),
  first: z.object({ item: z.string().max(80), unit: z.string().max(80) }).optional(),
  soon: z.literal(true).optional(),
});
export type StaffWordsLine = z.infer<typeof staffWordsLine>;

export const staffWordsReply = z.object({ data: z.array(staffWordsLine) });
