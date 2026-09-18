// SPDX-License-Identifier: AGPL-3.0-only
/** Zod request/response schemas for `routes/pages/`. */

import { PAGE_TEMPLATE_IDS } from '@adminium/engine';
import { pagePaddingSchema, pageWidthSchema } from '@adminium/engine/config';
import { z } from 'zod';

import { pageLayoutSchema } from './layout-schema.js';

export const pageParams = z.object({ pageId: z.string().min(1) });

/**
 * The five fixed sidebar buckets. Restated here rather than imported from
 * `routes/bootstrap/schema.ts` only because that module is the *reply*
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
  /**
   * Display name of the owning connection, resolved by the route — the manager
   * lists every source's pages in one flat list, so the id alone leaves "which
   * database is this Orders page from?" unanswerable. Null when the page has no
   * data source (a user/system/add-on page), and also when the id no longer
   * resolves, which the client renders as an unnamed source rather than as
   * "shared". Denormalized here rather than fetched client-side because
   * `GET /connections` rides `CONNECTIONS_MANAGE`, a permission a page manager
   * need not hold — the name would 403 for exactly the admin who is allowed on
   * this screen. Same annotation the bootstrap nav tree does for the sidebar.
   */
  connectionName: z.string().nullable(),
  /**
   * Whether the owning connection is PAUSED (`adminium_connections.disabledAt`).
   *
   * Not cosmetic, and not derivable from `isEnabled`: pausing a connection is
   * what `buildNavTree` reads to drop every one of its pages out of the nav
   * into the `pausedPages` bucket, so an `isEnabled: true` page on a paused
   * source is reachable from nothing and serves no data — "Live" is a lie about
   * it. False for a page with no data source, which has nothing to pause.
   */
  connectionPaused: z.boolean(),
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
  /** Content-column override; omitted ⇒ the template's own default. */
  width: pageWidthSchema.nullish(),
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
    /** Content column, on the same "null clears" contract as `padding`. */
    width: pageWidthSchema.nullish(),
    /** Optimistic concurrency — the revision the client last read. */
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

/** One column as the form reads it — shared by a table and by its children. */
const columnFactSchema = z.object({
  spec: z.record(z.string(), z.unknown()),
  ordinal: z.number(),
  writable: z.boolean(),
  filledBy: z.enum(['database', 'adminium']).nullable(),
  fill: z
    .object({
      kind: z.string(),
      onUpdate: z.boolean().optional(),
      implicit: z.boolean().optional(),
    })
    .optional(),
  required: z.boolean(),
  /* An admin's list, by key or by value. */
  options: z
    .union([
      z.object({ list: z.string() }),
      z.object({
        values: z.array(
          z.object({
            value: z.string(),
            label: z.string().optional(),
            tone: z.string().optional(),
            description: z.string().optional(),
          }),
        ),
      }),
    ])
    .optional(),
  validation: z
    .object({
      format: z.enum(['email', 'url', 'phone']).optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      minLength: z.number().optional(),
      maxLength: z.number().optional(),
    })
    .optional(),
});

/**
 * The stored envelope is returned verbatim (the envelope persists into
 * `adminium_pages.config` unchanged) — the client validates it against
 * `pageEnvelopeSchema` after running config migrations, so the transport
 * schema stays permissive by design (never-crash). On read the server resolves
 * `config.layout` (per-user override wins over the shared default) before
 * returning it.
 */
export const pageReply = z.object({
  data: z.unknown(),
  /** Whether the caller holds `page:<id>:edit` — the dashboard builder routes
   *  edits to the shared default (true) vs. a personal override (false). */
  canEditLayout: z.boolean(),
  /**
   * Per-caller write capabilities for the envelope's source table — the same
   * `table:<connectionId>:<table>:<create|update|delete>` grants the data
   * routes enforce, so the client only renders affordances that will not 403.
   * Present only for table-bound envelopes read under RBAC; absent means "not
   * computed" (the client keeps its permissive default), never "denied".
   */
  canCreate: z.boolean().optional(),
  canUpdate: z.boolean().optional(),
  canDelete: z.boolean().optional(),
  /**
   * Whether the caller may attach a file to a record of this
   * table.
   *
   * Stated separately from `canUpdate` even though it resolves from the same
   * grant, because the two diverge on a READ-ONLY source: the record cannot be
   * edited there and a SIDECAR file still can be attached, which is the whole
   * point of the sidecar mode. The panel reads this so it never offers a
   * dropzone the server would refuse.
   */
  canAttach: z.boolean().optional(),
  /**
   * Whether the caller holds the PII unmask permission (crud/mask.ts
   * UNMASK_PERMISSION — the same check the data routes run before sending
   * masked columns in clear). The grid renders PII cells with a reveal
   * affordance only when true; when false the server nulls those values
   * anyway, so the client's masked treatment is not just cosmetic. Absent
   * means "not computed" and the client keeps cells masked (closed default —
   * the opposite polarity of the write capabilities above, because a stray
   * reveal button on data the server DID send in clear would be a leak, not
   * a 403).
   */
  canUnmask: z.boolean().optional(),
  /**
   * The envelope's source table as it stands RIGHT NOW: every non-secret
   * column with the spec a regeneration would give it, its place in the
   * table's own order, who fills it in when nobody types a value, and whether
   * the dialog has to ask for one.
   *
   * Why live facts rather than the stored `config.columns[]`: that list was
   * frozen when the page was generated, regeneration skips a page anybody has
   * edited, and it is CAPPED at eight columns — so a column added since is
   * invisible to the form, and a table with fifteen optional columns can only
   * ever set about eight of them at create.
   *
   * Absent means "not computed" (no source table, no snapshot yet, a table the
   * snapshot does not address) and the client falls back to the stored spec,
   * the same polarity as the write capabilities above.
   */
  columnFacts: z
    .object({
      table: z.object({ labelSingular: z.string().nullable() }),
      /** Link relations this table can write through (a field of chips). */
      relations: z
        .array(
          z.object({
            relationId: z.string(),
            label: z.string(),
            targetTable: z.string(),
            targetKey: z.string(),
            /** The column a chip shows; absent ⇒ the key is the label. */
            targetName: z.string().optional(),
          }),
        )
        .optional(),
      /**
       * Tables whose rows this one can hold a LIST of — an invoice's lines.
       * The child's own columns ride along because a repeater edits real
       * columns; reading them from a second page's reply would make a
       * line-items field depend on a page existing for the child table.
       */
      children: z
        .array(
          z.object({
            relationId: z.string(),
            label: z.string(),
            childTable: z.string(),
            foreignColumn: z.string(),
            columns: z.array(columnFactSchema),
          }),
        )
        .optional(),
      columns: z.array(columnFactSchema),
    })
    .optional(),
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
 * `adminium_pages.config.layout`. Body is a full `pageLayout`
 * document. Reply echoes the persisted layout.
 */
export const pageLayoutPatchBody = pageLayoutSchema;
export const pageLayoutReply = z.object({ data: z.object({ layout: pageLayoutSchema }) });
