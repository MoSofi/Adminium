// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

/**
 * The typed `config.detail` block of a `page-crud` body — the record-page
 * contract every generated crud page has stored since the body vocabulary was
 * written (`generate/crud-body.ts` emits `detail: { template: 'page-record',
 * tabsFromInboundFks, tabs[] }`).
 *
 * Lives in the page-config leaf for the same reason `gridColumnSpecSchema`
 * does: it is a stored config-body schema, not component code —
 * `@adminium/engine/config` re-exports it for the server's page validation,
 * and the dashboard's record binding parses through it.
 *
 * ABSENCE IS VALID: envelopes predating the block, hand-authored pages and
 * non-crud templates carry no `detail`; `parseCrudDetailConfig` answers
 * `null` for those and the record route falls back to the page's own
 * template. Parsing is tolerant — an invalid block degrades to `null`, never
 * to a render crash (never-crash rules).
 */

/** One related-record tab (inbound FK, live count pill). */
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
  /** Template id owning the `/p/$slug/r/$recordId` child route. */
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

// --- attachments ---------------------------

/**
 * The typed `config.attachments` block of a `page-crud` body — the SIDECAR
 * attachment mode.
 *
 * WHY A PAGE-LEVEL BLOCK AND NOT A COLUMN ONE. A sidecar attachment is linked
 * on Adminium's side only (`entity_connection_id` / `entity_table` /
 * `entity_id`), so it needs no column in the customer's table at all — which
 * is precisely what makes it work on a READ-ONLY source, and on a table the
 * operator does not want to alter. There is no column to hang it off, so it
 * hangs off the page.
 *
 * ABSENCE IS VALID and is what every page written before 37 carries: the
 * record page's Attachments panel does not render, exactly as before. The same
 * degradation rule as `detail` — an unreadable block answers `null` rather
 * than crashing a render.
 */
export const crudAttachmentsConfigSchema = z.object({
  /**
   * Present-and-true is the only enabled state. A block with `enabled: false`
   * is how an operator turns the panel off without losing the rest of its
   * configuration.
   */
  enabled: z.boolean(),
  /** Where new attachments go; absent = the workspace default. */
  destinationId: z.string().min(1).optional(),
  /** Narrows the workspace allowlist for this page. Never widens it. */
  accept: z.array(z.string().min(1).max(20)).max(20).optional(),
  /** A per-page cap, below the workspace's `files.maxBytes`. */
  maxBytes: z.number().int().min(1024).optional(),
  /** Refuse an upload past this many files on one record. */
  maxCount: z.number().int().min(1).max(500).optional(),
  /**
   * The table's own column that holds this page's
   * attachments.
   *
   * Present ⇒ COLUMN mode: the Attachments card created (or bound to) a column
   * on the customer's table, the files are that column's value, and the caps
   * that apply are the column block's. The record page's panel reads and
   * writes the column; the create dialog gets a real field, which the sidecar
   * never could — there is no record to attach to before Save.
   *
   * Absent ⇒ the sidecar, unchanged: files linked on Adminium's side, which is
   * the fallback for a connection whose schema Adminium cannot author (D2).
   */
  column: z.string().min(1).max(128).optional(),
});
export type CrudAttachmentsConfig = z.infer<typeof crudAttachmentsConfigSchema>;

/** The `attachments` block, or `null` when the page carries none. */
export function parseCrudAttachmentsConfig(
  config: Record<string, unknown>,
): CrudAttachmentsConfig | null {
  const raw = config['attachments'];
  if (raw === undefined || raw === null) return null;
  const parsed = crudAttachmentsConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
