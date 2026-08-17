/**
 * Envelope construction for user-authored pages (08-server-api.md §2.6).
 *
 * The Engine's builders — `buildCrudEnvelope`, `buildDashboardEnvelope`,
 * `composeRequestedArchetype` — all compose FROM a schema snapshot: they need a
 * classified `DatabaseModel` and they decide the page's widgets from it. That
 * is the right shape for generation and the wrong shape here, for two reasons:
 *
 * 1. `buildArchetypeEnvelope` returns `null` for any template outside the nine
 *    it has a nav placement for, so `page-crud`, `page-dashboard`,
 *    `page-builder`, `page-wizard` and `page-settings` cannot be built through
 *    it at all — a create route that used it would offer 14 templates and fail
 *    on 5.
 * 2. A hand-authored page has no table to compose from until the admin binds
 *    one, and "create a blank dashboard" must not be gated on a snapshot
 *    existing.
 *
 * So this builds the §6.1 FRAME — the fields the envelope schema requires — and
 * an empty per-template body the renderers already tolerate (every layout-
 * bearing template parses `config.layout` through `parseTemplateBody`, whose
 * failure mode is an empty layout, and `PageCrud` renders an empty grid from
 * `columns: []`). The admin then fills it via the dashboard builder or the
 * column editor, which is the same path a generated page's edits take.
 *
 * Deliberately NOT stamped: `config.generatedHash`. It is the generator's
 * marker, and `upsertGenerated` reads its absence as "freely overwritable"
 * (`isEditedEnvelope` treats a hashless document as untouched). A user page is
 * `origin: 'user'`, which `upsertGenerated` skips on origin alone, so the
 * absence is harmless there — but stamping a fake one would make a *later*
 * origin change silently destructive.
 */

import { templateKind } from '@adminium/engine';
import { pageEnvelopeSchema } from '@adminium/engine/config';

/** Lucide icon used when the caller picks none, per template family. */
const DEFAULT_ICONS: Record<string, string> = {
  'page-crud': 'table',
  'page-dashboard': 'layout-dashboard',
  'page-board': 'kanban',
  'page-calendar': 'calendar',
  'page-scheduler': 'calendar-clock',
  'page-directory': 'users',
  'page-master-detail': 'panels-top-left',
  'page-queue-inbox': 'inbox',
  'page-log-viewer': 'scroll-text',
  'page-files': 'folder',
  'page-chat': 'message-square',
  'page-builder': 'pen-tool',
  'page-wizard': 'wand-sparkles',
  'page-settings': 'settings',
};

export const DEFAULT_PAGE_ICON = 'file';

export function defaultIconFor(template: string): string {
  return DEFAULT_ICONS[template] ?? DEFAULT_PAGE_ICON;
}

export interface BuildUserPageInput {
  /** The row id this document will be stored under — the envelope embeds it. */
  id: string;
  slug: string;
  title: string;
  template: string;
  navGroup: string;
  navOrder: number;
  icon?: string | null;
  connectionId?: string | null;
  /** Qualified source table (`public.orders`), when the page binds one. */
  table?: string | null;
}

/**
 * The empty per-template body.
 *
 * `page-crud` is the one template whose body is not a layout: it stores
 * `columns[]` + form/detail descriptors (`CrudPageBody`), and `PageCrudBinding`
 * drops entries that fail `gridColumnSpecSchema` rather than throwing, so an
 * empty list renders an empty grid instead of an error card. Everything else
 * stores `{ templateVersion, toolbar, overlays, layout }`, which
 * `parseTemplateBody` reads.
 *
 * `templateVersion` is stamped as 1 rather than read from the template
 * manifest: it is advisory-only until per-template migrations land (04-T15),
 * and a hand-built page has not been composed against any manifest version.
 */
function emptyBodyFor(template: string): Record<string, unknown> {
  if (template === 'page-crud') {
    return {
      templateVersion: 1,
      columns: [],
      defaultSort: [],
      pageSize: 50,
      keyField: null,
      readOnly: true,
      detail: { template: 'page-record', tabsFromInboundFks: false, tabs: [] },
    };
  }
  return {
    templateVersion: 1,
    toolbar: [],
    overlays: [],
    layout: { version: 1, items: [] },
  };
}

export class InvalidPageEnvelopeError extends Error {
  override name = 'InvalidPageEnvelopeError';
  constructor(readonly issues: unknown) {
    super('composed page envelope failed validation');
  }
}

/**
 * Build and validate a §6.1 envelope for a new user-authored page.
 *
 * Validated here rather than trusted: this is the one place a document enters
 * `adminium_pages` without having gone through the Engine's own
 * `pageEnvelopeSchema.parse`, and the client never sees the envelope on
 * create — it sends fields. Throwing on a malformed frame keeps the
 * never-crash renderer contract (09 §3.1) an invariant of the store rather
 * than a hope.
 */
export function buildUserPageEnvelope(input: BuildUserPageInput): Record<string, unknown> {
  const envelope: Record<string, unknown> = {
    v: 1,
    kind: templateKind(input.template),
    id: input.id,
    template: input.template,
    // `nav.<slug>` matches what `buildNavTree` derives for every other page, so
    // a runtime translation authored for one applies to the other. The fallback
    // is the English the admin typed.
    title: { key: `nav.${input.slug}`, fallback: input.title },
    source: { connectionId: input.connectionId ?? null, table: input.table ?? null },
    nav: {
      group: input.navGroup,
      icon: input.icon ?? defaultIconFor(input.template),
      order: input.navOrder,
      slug: input.slug,
    },
    // Page access is carried by `page:<id>:view` / `:edit` grants in
    // `adminium_role_permissions`, not by this block — the envelope's `access`
    // is the declarative default a manifest would ship. `viewer` is the lowest
    // built-in role, matching what the generator emits.
    access: { minRole: 'viewer', permissions: [] },
    config: emptyBodyFor(input.template),
  };

  const parsed = pageEnvelopeSchema.safeParse(envelope);
  if (!parsed.success) throw new InvalidPageEnvelopeError(parsed.error.issues);
  return envelope;
}

/**
 * Rewrite a copied envelope for its new identity — the duplicate flow.
 *
 * Everything the page IS (template, body, source binding) is carried over
 * verbatim; everything that identifies WHICH page it is gets replaced. The
 * `generatedHash`, if the source was a generated page, is dropped: the copy is
 * not that generated page, and leaving the hash would make the copy look
 * byte-identical to a document `upsertGenerated` believes it owns.
 */
export function reidentifyEnvelope(
  stored: unknown,
  next: { id: string; slug: string; title: string; navOrder: number },
): Record<string, unknown> {
  const source = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>) : {};
  const body =
    typeof source['config'] === 'object' && source['config'] !== null
      ? { ...(source['config'] as Record<string, unknown>) }
      : {};
  delete body['generatedHash'];

  const nav =
    typeof source['nav'] === 'object' && source['nav'] !== null
      ? { ...(source['nav'] as Record<string, unknown>) }
      : {};
  const title =
    typeof source['title'] === 'object' && source['title'] !== null
      ? { ...(source['title'] as Record<string, unknown>) }
      : {};

  return {
    ...source,
    id: next.id,
    title: { ...title, key: `nav.${next.slug}`, fallback: next.title },
    nav: { ...nav, slug: next.slug, order: next.navOrder },
    config: body,
  };
}
