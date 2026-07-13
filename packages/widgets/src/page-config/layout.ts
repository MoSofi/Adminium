import { z } from 'zod';

/**
 * Dashboard grid layout (04-widget-registry.md §6.1).
 *
 * 12-column grid; heights are stored in half-row units of 40 px (an annex
 * height of 1.5 rows persists as h: 3).
 */
export const layoutItemSchema = z.object({
  i: z.string(), // widget instance id (nanoid)
  widget: z.string(), // registry id
  x: z.number().int().min(0).max(11),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(24), // half-units
  config: z.record(z.string(), z.unknown()),
});

export const pageLayoutSchema = z.object({
  // Internal layout-schema version, stored at config.layout.version — distinct
  // from the envelope's `v` persisted at config.v (01-architecture.md §6.1).
  version: z.literal(1),
  items: z.array(layoutItemSchema).max(60),
});

export type LayoutItem = z.infer<typeof layoutItemSchema>;
export type PageLayout = z.infer<typeof pageLayoutSchema>;
