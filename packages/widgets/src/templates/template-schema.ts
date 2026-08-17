// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Page-template manifest schema — 04-widget-registry.md §10, reproduced verbatim.
 *
 * A page template is **layout + slot constraints**, nothing more: it never names
 * a concrete widget instance or a binding. `composeTemplate` (`./compose.ts`)
 * turns a manifest + a ranked candidate list into the in-memory intermediate the
 * Engine wraps into the standard page envelope (01-architecture.md §6.1).
 *
 * The manifests themselves ship as checked-in JSON (`page-*.json`) so the
 * marketplace can add `x-<vendor>-page-*` templates under the identical schema
 * without a code change (04 §10, §9). `./manifests.ts` parses them at module
 * init — the parse applies the `required` / `fallback` defaults declared below,
 * which is why every consumer works with `PageTemplate` (parsed output) rather
 * than the raw JSON input type.
 *
 * SCHEMA FIDELITY: the object below is a verbatim transcription of the §10
 * listing. Deliberately no extra `.refine()`s, no `.strict()`, no added fields —
 * the doc is the contract, and drifting from it here would silently invalidate
 * third-party manifests written against the published spec. Constraints the doc
 * does not encode (e.g. "a slot with an empty `accepts` can never be filled")
 * are enforced by `./crosscheck.ts` as *lint over shipped manifests*, not by
 * tightening the published schema.
 */
import { z } from 'zod';

import { dataShapeSchema } from '../page-config/data-shapes.js';

/** How an unfilled **optional** slot degrades (04 §10). */
export const slotFallbackSchema = z.enum(['omit', 'empty-state']);
export type SlotFallback = z.infer<typeof slotFallbackSchema>;

/** Tiling direction for a repeating slot (04 §10). */
export const slotRepeatFlowSchema = z.enum(['row', 'column']);
export type SlotRepeatFlow = z.infer<typeof slotRepeatFlowSchema>;

/**
 * What a slot will accept. `shapes` matches by **data contract** (04 §3);
 * `widgets` matches by **explicit registry-id allowlist**. Both may be present —
 * a candidate matching *either* is accepted (04 §10: "candidate must match by
 * contract… or by explicit id allowlist").
 */
export const slotAcceptsSchema = z.object({
  shapes: z.array(dataShapeSchema).optional(), // candidate must match by contract…
  widgets: z.array(z.string()).optional(), // …or by explicit id allowlist
});
export type SlotAccepts = z.infer<typeof slotAcceptsSchema>;

/**
 * Slot geometry on the 12-column grid. `h` is in **40 px half-units** (04 §6.1)
 * — the same convention `pageLayoutSchema` stores, so `area` copies straight
 * into a layout item. For a repeating slot this is the geometry of *one*
 * instance; `repeat.flow` tiles the rest.
 */
export const slotAreaSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});
export type SlotArea = z.infer<typeof slotAreaSchema>;

export const slotRepeatSchema = z.object({
  max: z.number().int(),
  flow: slotRepeatFlowSchema,
});
export type SlotRepeat = z.infer<typeof slotRepeatSchema>;

export const templateSlotSchema = z.object({
  slot: z.string(), // 'kpi-row', 'hero-chart', 'grid-secondary', …
  accepts: slotAcceptsSchema,
  area: slotAreaSchema,
  repeat: slotRepeatSchema.optional(),
  required: z.boolean().default(false),
  fallback: slotFallbackSchema.default('omit'),
});
export type TemplateSlot = z.infer<typeof templateSlotSchema>;

/**
 * Page chrome the template hosts outside the widget grid. These are widget ids,
 * not slots — they take no candidate and are emitted as-is, so `composeTemplate`
 * filters them against the live registry before returning (an id whose family
 * has not shipped yet would otherwise render as `widget-missing`).
 */
export const templateChromeSchema = z.object({
  toolbar: z.array(z.string()).optional(), // widget ids: 'filter-chip-bar', 'date-range-picker', …
  overlays: z.array(z.string()).optional(), // 'modal-wizard', 'toast-stack', …
});
export type TemplateChrome = z.infer<typeof templateChromeSchema>;

export const pageTemplateSchema = z.object({
  id: z.string().regex(/^page-[a-z-]+$/),
  version: z.number().int(),
  titleKey: z.string(),
  slots: z.array(templateSlotSchema),
  chrome: templateChromeSchema.optional(),
});

/** A parsed manifest — `required`/`fallback` defaults applied. */
export type PageTemplate = z.infer<typeof pageTemplateSchema>;

/** The raw JSON shape a manifest author writes (defaults still optional). */
export type PageTemplateInput = z.input<typeof pageTemplateSchema>;

export class InvalidPageTemplateError extends Error {
  constructor(
    readonly templateId: string,
    readonly issues: readonly z.core.$ZodIssue[],
  ) {
    const detail = issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ');
    super(`Invalid page-template manifest '${templateId}': ${detail}`);
    this.name = 'InvalidPageTemplateError';
  }
}

/**
 * Parse one manifest, throwing `InvalidPageTemplateError` on failure. Used by
 * `manifests.ts` at module init (a malformed checked-in manifest is a build
 * error, caught by the CI gate in `manifests.test.ts`) and by the marketplace
 * installer for `x-<vendor>-page-*` templates.
 */
export function parsePageTemplate(input: unknown): PageTemplate {
  const result = pageTemplateSchema.safeParse(input);
  if (result.success) return result.data;
  const id =
    typeof input === 'object' && input !== null && typeof (input as { id?: unknown }).id === 'string'
      ? (input as { id: string }).id
      : '<unknown>';
  throw new InvalidPageTemplateError(id, result.error.issues);
}

/** Does this slot accept more than one instance? */
export function slotCapacity(slot: TemplateSlot): number {
  return slot.repeat === undefined ? 1 : Math.max(0, slot.repeat.max);
}
