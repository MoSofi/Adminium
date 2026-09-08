// SPDX-License-Identifier: AGPL-3.0-only
import { z } from 'zod';

/**
 * The typed `config.labels` block of a `page-crud` body — per-page overrides
 * for the template's own chrome, written by the Studio page editor.
 *
 * The template already accepts these as the `labels` prop (`PageCrudLabels`);
 * what was missing was a way to STORE one. "New row" is the database framing
 * the template defaults to, and it is correct for a table nobody has named —
 * but on a page an admin has called Invoices it is the one string on screen
 * still talking about rows. This block is where "Add invoice" lives.
 *
 * Lives in the page-config leaf for the same reason `crudDetailConfigSchema`
 * does: it is a stored config-body schema, not component code —
 * `@adminium/engine/config` re-exports it and the dashboard's crud binding
 * parses through it.
 *
 * ABSENCE IS THE NORM, not a migration gap: generation emits no `labels`
 * (`generate/crud-body.ts`), so every page starts with none and the template
 * keeps resolving `ui:templates.crud.*` — which is what makes the default
 * translate in all 8 locales. An override is a single untranslated string the
 * admin typed, so it is only ever written when they type one, and clearing the
 * field removes the key rather than storing `''` (an empty label would render
 * an unreadable button, and `?? t(…)` cannot fall back from a string that is
 * present but blank).
 *
 * Parsing is tolerant, per the never-crash rules (09 §3.1): a malformed block
 * degrades to `null` and the page renders its defaults.
 */

/**
 * Capped at 60: this is a toolbar button that sits beside search and the view
 * switcher, and the same string renders again inside the empty state's action.
 * Longer than a short verb phrase and it either wraps or pushes the toolbar
 * controls off a narrow viewport. The Studio field enforces the same number so
 * the admin is stopped at the input rather than silently truncated on read.
 */
export const CRUD_LABEL_MAX_LENGTH = 60;

const overrideLabel = z.string().trim().min(1).max(CRUD_LABEL_MAX_LENGTH);

export const crudLabelsConfigSchema = z.object({
  /**
   * Header CTA, and the same action in the empty state. Overrides
   * `ui:templates.crud.newRow` ("New row") for this page only.
   */
  newRow: overrideLabel.optional(),
});
export type CrudLabelsConfig = z.infer<typeof crudLabelsConfigSchema>;

/**
 * The `labels` block of a page-crud config body, or `null` when the page
 * carries none (or carries one this build cannot read — same degradation).
 *
 * Answers `null` rather than `{}` for an empty block so a caller can spread the
 * result conditionally and leave the template's `labels` prop undefined, which
 * is the shape its `labels?.x ?? t(…)` chain is written against.
 */
export function parseCrudLabels(config: Record<string, unknown>): CrudLabelsConfig | null {
  const raw = config['labels'];
  if (raw === undefined || raw === null) return null;
  const parsed = crudLabelsConfigSchema.safeParse(raw);
  if (!parsed.success) return null;
  return Object.keys(parsed.data).length === 0 ? null : parsed.data;
}
