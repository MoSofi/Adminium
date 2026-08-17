/** Zod request/response schemas for `routes/pages/` (08-server-api.md §2.6). */

import { PAGE_TEMPLATE_IDS } from '@adminium/engine';
import { pagePaddingSchema } from '@adminium/engine/config';
import { z } from 'zod';

import { pageLayoutSchema } from './layout-schema.js';

export const pageParams = z.object({ pageId: z.string().min(1) });

/**
 * The five fixed sidebar buckets (09 §2.2). Restated here rather than imported
 * from `routes/bootstrap/schema.ts` only because that module is the *reply*
 * contract; both derive from `NAV_GROUP_KEYS`, and `navGroupsMatchBootstrap`
 * in the route test pins them together so the duplicate cannot drift.
 * `buildNavTree` silently drops a row whose group is outside this set, so
 * accepting a free string here would let an admin create a page that renders
 * fine but never appears in the sidebar.
 */
export const pageNavGroup = z.enum(['workspace', 'library', 'planning', 'people', 'account']);

/**
 * Slugs are the `/p/$slug` URL segment and must match the envelope's
 * `nav.slug` rule (kebab-case, `packages/engine/src/config-schema/envelope.ts`).
 * Capped at 31 rather than the column's 120: `MAX_SLUG_LENGTH` in the Engine's
 * id allocator is 31, and a longer slug is one `pageIdFor` cannot represent if
 * the page is ever regenerated at this slug.
 */
export const pageSlug = z
  .string()
  .min(1)
  .max(31)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 'must be kebab-case');

/** Only templates the app can actually render — anything else is a dead card. */
export const pageTemplateId = z.enum(PAGE_TEMPLATE_IDS as unknown as [string, ...string[]]);

/** One row of `GET /pages` — the manager list projection. */
export const pageSummary = z.object({
  id: z.string(),
  connectionId: z.string().nullable(),
  slug: z.string(),
  type: z.string(),
  title: z.string(),
  icon: z.string().nullable(),
  navGroup: z.string().nullable(),
  navOrder: z.number().int(),
  origin: z.string(),
  manifestId: z.string().nullable(),
  isEnabled: z.boolean(),
  revision: z.number().int(),
  updatedAt: z.number().int(),
});

export const pageListReply = z.object({ data: z.array(pageSummary) });

export const pageCreateBody = z.object({
  slug: pageSlug,
  title: z.string().min(1).max(120),
  template: pageTemplateId,
  navGroup: pageNavGroup,
  icon: z.string().min(1).max(40).nullish(),
  /** Owning connection; null for a workspace-level page with no data source. */
  connectionId: z.string().min(1).nullish(),
  /** Qualified source table (`public.orders`) the page's widgets bind against. */
  table: z.string().min(1).nullish(),
  /** Page gutter override; omitted ⇒ the template's own default. */
  padding: pagePaddingSchema.nullish(),
});

/**
 * Every field optional — this is a partial. `icon` and `navGroup` accept an
 * explicit null to clear, which `.nullish()` allows and the repo distinguishes
 * from "absent" by checking `undefined`.
 */
export const pagePatchBody = z
  .object({
    slug: pageSlug.optional(),
    title: z.string().min(1).max(120).optional(),
    icon: z.string().min(1).max(40).nullish(),
    navGroup: pageNavGroup.nullish(),
    navOrder: z.number().int().min(0).optional(),
    isEnabled: z.boolean().optional(),
    /**
     * Retemplating and (re)binding a data source. Supplying any of these makes
     * the PATCH a RECOMPOSE: the page's body is rebuilt from the connection's
     * schema snapshot for the requested template+table, because the per-template
     * bodies are not interchangeable (a crud `columns[]` is not an archetype
     * `layout`). `table` accepts an explicit null to unbind.
     */
    template: pageTemplateId.optional(),
    connectionId: z.string().min(1).nullish(),
    table: z.string().min(1).nullish(),
    /**
     * Page gutter. An explicit null CLEARS the override, returning the page to
     * its template's default — which is why this is `.nullish()` and not
     * `.optional()`: "no override" and "not mentioned in this patch" are
     * different writes.
     */
    padding: pagePaddingSchema.nullish(),
    /** 08 §2.6 optimistic concurrency — the revision the client last read. */
    expectedRevision: z.number().int().min(1).optional(),
  })
  .refine(
    (body) =>
      Object.keys(body).some((key) => key !== 'expectedRevision'),
    { message: 'patch must change at least one field' },
  );

export const pageDuplicateBody = z.object({
  slug: pageSlug,
  title: z.string().min(1).max(120),
});

/**
 * Bulk sidebar reorder. One drag renumbers every sibling, so the client sends
 * the whole rail in its new order and the server renumbers densely from 0 per
 * group — `nav_order` is an `int` with no room to insert between neighbours.
 */
export const pageNavOrderBody = z.object({
  items: z
    .array(z.object({ pageId: z.string().min(1), navGroup: pageNavGroup }))
    .min(1)
    .max(400),
});

export const pageNavOrderReply = z.object({ data: z.object({ moved: z.number().int() }) });

/**
 * `PATCH /pages/:pageId/config` replaces the per-template config BODY. The
 * body is template-shaped and only partly typed anywhere (only `page-dashboard`
 * and the archetypes have a layout schema; `page-crud`'s `columns[]` has a
 * per-item schema and no body schema), so the transport stays a record and the
 * route validates what it can per template before writing.
 */
export const pageConfigPatchBody = z.object({
  config: z.record(z.string(), z.unknown()),
  expectedRevision: z.number().int().min(1).optional(),
});

export const pageMutationReply = z.object({ data: pageSummary });
export const okReply = z.object({ data: z.object({ ok: z.literal(true) }) });

/**
 * The stored envelope is returned verbatim (07-meta-store.md §3.17: the
 * envelope persists into `adminium_pages.config` unchanged) — the client
 * validates it against `pageEnvelopeSchema` after running config migrations,
 * so the transport schema stays permissive by design (never-crash, 09 §3.1).
 * On read the server resolves `config.layout` (per-user override wins over the
 * shared default, 04-widget-registry.md §6.3) before returning it.
 */
export const pageReply = z.object({
  data: z.unknown(),
  /** Whether the caller holds `page:<id>:edit` — the dashboard builder routes
   *  edits to the shared default (true) vs. a personal override (false). */
  canEditLayout: z.boolean(),
  /**
   * Present (true) only when the served layout is the caller's per-user
   * override AND the shared document's revision moved past the one stamped on
   * the override at PUT time — the page was regenerated (or its default
   * re-edited) out from under the override. The client can offer "Reset
   * layout" (DELETE /me/views/:pageId/layout) instead of leaving the user on
   * silently dead bindings.
   */
  layoutStale: z.boolean().optional(),
});

/**
 * `PATCH /pages/:pageId/layout` writes the SHARED default layout into
 * `adminium_pages.config.layout`. Body is a full `pageLayout` document
 * (04-widget-registry.md §6.1). Reply echoes the persisted layout.
 */
export const pageLayoutPatchBody = pageLayoutSchema;
export const pageLayoutReply = z.object({ data: z.object({ layout: pageLayoutSchema }) });
