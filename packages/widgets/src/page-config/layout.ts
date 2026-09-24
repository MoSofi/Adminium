// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

/**
 * Dashboard grid layout.
 *
 * 12-column grid; heights are stored in half-row units of 40 px (an annex
 * height of 1.5 rows persists as h: 3).
 */
/** Max stored height in 40 px half-units. Exported so the grid track clamps
 *  against the same number the schema validates — it used to hand-copy it. */
export const MAX_H = 24;

export const layoutItemSchema = z.object({
  i: z.string(), // widget instance id (nanoid)
  widget: z.string(), // registry id
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(MAX_H), // half-units
  config: z.record(z.string(), z.unknown()),
});

export const pageLayoutSchema = z.object({
  // Internal layout-schema version, stored at config.layout.version — distinct
  // from the envelope's `v` persisted at config.v.
  version: z.literal(1),
  items: z.array(layoutItemSchema).max(60),
  /**
   * The page's own controls. `day` draws Today / Yesterday / This week / Pick
   * a day and hands the choice to every widget as the `day` param, which a
   * descriptor's `window.param` follows.
   */
  toolbar: z
    .object({
      day: z.boolean().optional(),
      /**
       * One link at the end of the page's controls ("Open the desk"): a route
       * the host opens, its label, and the label in the other languages the
       * page is read in.
       */
      link: z
        .object({
          label: z.string().min(1).max(60),
          labels: z.record(z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/), z.string().min(1).max(60)).optional(),
          href: z.string().min(1).max(300),
          icon: z.enum(['arrow-right', 'clipboard-list', 'external-link']).optional(),
        })
        .strict()
        .optional(),
    })
    .optional(),
});

export type LayoutItem = z.infer<typeof layoutItemSchema>;
export type PageLayout = z.infer<typeof pageLayoutSchema>;
