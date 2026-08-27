// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

/**
 * The typed `config.detail` block of a `page-crud` body — the record-page
 * contract every generated crud page has stored since the body vocabulary was
 * written (30-record-pages.md §0.1: `generate/crud-body.ts` emits
 * `detail: { template: 'page-record', tabsFromInboundFks, tabs[] }`).
 *
 * Lives in the page-config leaf for the same reason `gridColumnSpecSchema`
 * does: it is a stored config-body schema, not component code —
 * `@adminium/engine/config` re-exports it for the server's page validation,
 * and the dashboard's record binding parses through it (30 D1/D3).
 *
 * ABSENCE IS VALID (30-T01): envelopes predating the block, hand-authored
 * pages and non-crud templates carry no `detail`; `parseCrudDetailConfig`
 * answers `null` for those and the record route falls back to the page's own
 * template. Parsing is tolerant — an invalid block degrades to `null`, never
 * to a render crash (09 §3.1 never-crash rules).
 */

/** One related-record tab (09 §7.1 — inbound FK, live count pill). */
export const crudDetailTabSchema = z.object({
  /** The referencing table's qualified id ("public.order_items"). */
  table: z.string().min(1),
  /**
   * Its FK column into this page's table. Generation always resolves one, but
   * the JSON round-trip drops `undefined` — tolerate absence (the tab then
   * shows its count without a filtered body).
   */
  fkColumn: z.string().min(1).optional(),
  /** Humanized label; consumers fall back to the table name when absent. */
  label: z.string().min(1).optional(),
});
export type CrudDetailTabConfig = z.infer<typeof crudDetailTabSchema>;

export const crudDetailConfigSchema = z.object({
  /** Template id owning the `/p/$slug/r/$recordId` child route (30 D1). */
  template: z.string().min(1),
  /** Provenance marker from generation — informational, never branched on. */
  tabsFromInboundFks: z.boolean().optional(),
  tabs: z.array(crudDetailTabSchema).default([]),
});
export type CrudDetailConfig = z.infer<typeof crudDetailConfigSchema>;

/**
 * The `detail` block of a page-crud config body, or `null` when the envelope
 * carries none (or carries one this build cannot read — same degradation).
 */
export function parseCrudDetailConfig(config: Record<string, unknown>): CrudDetailConfig | null {
  const raw = config['detail'];
  if (raw === undefined || raw === null) return null;
  const parsed = crudDetailConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
