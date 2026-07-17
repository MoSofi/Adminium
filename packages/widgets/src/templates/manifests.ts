/**
 * The shipped page-template manifests (04-widget-registry.md §10).
 *
 * The `page-*.json` files beside this module are the source of truth — this
 * module only imports and parses them, so the JSON stays the artifact the
 * marketplace installer, the docs, and third-party `x-<vendor>-page-*` templates
 * are written against (04 §9/§10). Parsing here (rather than at each call site)
 * is what applies the schema's `required: false` / `fallback: 'omit'` defaults,
 * so every consumer sees a fully-resolved `PageTemplate`.
 *
 * A malformed manifest throws at module init. That is deliberate: these files
 * are checked in, `manifests.test.ts` is the CI gate (acceptance #16), and a
 * template the runtime cannot parse must never reach page generation.
 *
 * COVERAGE: 12 of the 23 §14 archetypes ship today — the two the M4 generator
 * already emits (`page-crud`, `page-dashboard`, whose components live under
 * `templates/page-crud/` and `templates/page-dashboard/`; the manifests here
 * *describe* those compositions) plus the nine M7 archetypes, plus the M7 Wave-4
 * `page-builder` (TRACK BUILDER) — the archetype the §13 document vocabulary is
 * built for, which is why it lands with `document-canvas` rather than waiting on
 * the families its optional rails reference. The remaining eleven
 * (`page-settings`, `page-wizard`, `page-status`, `page-billing`, `page-api`,
 * `page-kb-docs`, `page-auth`, `page-system-state`, `page-marketing`,
 * `page-hub-home`, `page-onboarding-checklist`) land with the families they are
 * built from.
 *
 * `page-dashboard` VERSION 2 (04 §10): v2 raises the chart-slot heights
 * (`hero-chart`/`breakdown`/`grid-secondary`) from h6 to h8 and re-stacks the
 * rows below, matching the bespoke generator's CHART_HEIGHT=8 so migrating
 * generated dashboards onto `composeTemplate` preserves their shipped
 * geometry. No `migrations/` folder ships with the bump: nothing in the
 * runtime consumes per-template migrations yet (H5 regenerates untouched
 * pages in place, which re-composes against the current manifest), and 04 §10
 * says migrations arrive with their first consumer, not speculatively.
 *
 * `page-crud` IS A TYPED-BODY TEMPLATE (09-generated-app.md §3.3): its stored
 * config carries `columns[]`/`defaultSort`/`form`/`detail` (composed by
 * `../generate/crud-body.ts`), NOT a `config.layout`, and `PageCrud.tsx` never
 * reads slots. The slot list in `page-crud.json` is therefore *descriptive* —
 * it records the §10 composition the hand-built template implements (grid +
 * pagination + detail rails), keeping the manifest inside the published §10
 * schema, which deliberately has no typed-body marker (see the SCHEMA FIDELITY
 * note in `./template-schema.ts`). Do not feed `page-crud` through
 * `composeTemplate` expecting the renderer to honour the result.
 */
import pageBoard from './page-board.json' with { type: 'json' };
import pageBuilder from './page-builder.json' with { type: 'json' };
import pageCalendar from './page-calendar.json' with { type: 'json' };
import pageChat from './page-chat.json' with { type: 'json' };
import pageCrud from './page-crud.json' with { type: 'json' };
import pageDashboard from './page-dashboard.json' with { type: 'json' };
import pageDirectory from './page-directory.json' with { type: 'json' };
import pageFiles from './page-files.json' with { type: 'json' };
import pageLogViewer from './page-log-viewer.json' with { type: 'json' };
import pageMasterDetail from './page-master-detail.json' with { type: 'json' };
import pageQueueInbox from './page-queue-inbox.json' with { type: 'json' };
import pageScheduler from './page-scheduler.json' with { type: 'json' };
import { parsePageTemplate, type PageTemplate } from './template-schema.js';

/**
 * Raw manifest JSON, in nav/importance order. Typed `unknown` on purpose —
 * `parsePageTemplate` is the only thing that may assert their shape, so a JSON
 * edit that violates the schema fails the parse instead of silently widening a
 * TypeScript inference.
 */
const MANIFEST_JSON: readonly unknown[] = [
  pageCrud,
  pageDashboard,
  pageMasterDetail,
  pageQueueInbox,
  pageBoard,
  pageCalendar,
  pageScheduler,
  pageDirectory,
  pageLogViewer,
  pageFiles,
  pageChat,
  pageBuilder,
];

export class DuplicatePageTemplateManifestError extends Error {
  constructor(readonly templateId: string) {
    super(`Duplicate page-template manifest id: '${templateId}' — template ids are unique (04 §10)`);
    this.name = 'DuplicatePageTemplateManifestError';
  }
}

/** Parse + index manifests; duplicate ids throw. Exported for marketplace bundles. */
export function buildTemplateManifests(raw: readonly unknown[]): ReadonlyMap<string, PageTemplate> {
  const map = new Map<string, PageTemplate>();
  for (const input of raw) {
    const manifest = parsePageTemplate(input);
    if (map.has(manifest.id)) throw new DuplicatePageTemplateManifestError(manifest.id);
    map.set(manifest.id, manifest);
  }
  return map;
}

/** Every shipped manifest, keyed by template id. */
export const pageTemplateManifests: ReadonlyMap<string, PageTemplate> =
  buildTemplateManifests(MANIFEST_JSON);

/** Shipped template ids, in manifest order. */
export const PAGE_TEMPLATE_IDS: readonly string[] = [...pageTemplateManifests.keys()];

export function getPageTemplateManifest(id: string): PageTemplate | undefined {
  return pageTemplateManifests.get(id);
}
