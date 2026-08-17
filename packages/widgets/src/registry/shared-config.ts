// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

import { queryDescriptorSchema } from '../page-config/index.js';

/**
 * Shared config carried by every widget (04-widget-registry.md §2.1, verbatim;
 * annex "Conventions" — the annex field `dataSource` is implemented as
 * `binding`, see 04 Open decisions #1). Every widget's `configSchema` is an
 * `.extend()` of this schema.
 */
export const widgetSharedConfigSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  icon: z.string().optional(), // lucide-react icon name
  href: z.string().optional(), // drill-through route
  binding: queryDescriptorSchema.optional(), // 04 §5; absent → demoData(seed)
  refreshInterval: z.number().int().min(5).max(86_400).optional(), // seconds
  emptyState: z
    .object({
      icon: z.string().optional(),
      titleKey: z.string().optional(),
      bodyKey: z.string().optional(),
    })
    .optional(),
  permissions: z.array(z.string()).optional(), // role ids that may see this instance
  tone: z.enum(['accent', 'pos', 'warn', 'danger', 'info', 'muted']).optional(),
  /**
   * Edge-to-edge body: drop the card's `--widget-pad` gutter for this instance.
   * Opt-in by design — the padded card IS the design, and an unpadded chart is
   * a deliberate choice for a full-bleed map or heat grid, never a default.
   * `.default(false)` (not `.optional()`) so the config drawer renders it as a
   * switch that reads OFF rather than an indeterminate blank.
   */
  bleed: z.boolean().default(false),
  format: z
    .object({
      locale: z.string().optional(), // per-widget override, else app locale
      currency: z.string().optional(),
      number: z.enum(['plain', 'compact', 'percent']).optional(),
      date: z.enum(['relative', 'short', 'long']).optional(),
      /**
       * Reference clock (epoch ms) for relative timestamps. Widgets that render
       * "3h ago"-style times use it as `now` when set, else the wall clock —
       * pinning it makes demo/VRT captures byte-deterministic (04-T17).
       */
      referenceTime: z.number().int().optional(),
    })
    .optional(),
  testId: z.string().optional(),
});

export type WidgetSharedConfig = z.infer<typeof widgetSharedConfigSchema>;
