/**
 * Page-template registry — the single source of truth for which page templates
 * `@adminium/widgets` can render (04-widget-registry.md §10; 09-generated-app.md
 * §7). The LLM allow-lists (`llm-allowlist.ts`) and Studio's template picker
 * derive from this map, so a template the runtime cannot mount can never be
 * recommended to, or accepted from, the model (06-llm-assist.md §5 decision 6).
 *
 * Today the runtime ships two templates:
 *   - `page-crud`      — the per-table resource template, generated for EVERY
 *                        table, therefore renderable but never LLM-recommended.
 *   - `page-dashboard` — the widget-grid template.
 *
 * Richer M7 templates (`page-board`, `page-queue-inbox`, `page-directory`, …)
 * register by appending a `PageTemplateDefinition` to `pageTemplateDefinitions`;
 * every list derived from this registry then grows automatically — there is no
 * parallel hand-maintained id list to keep in sync.
 *
 * Metadata only: the heavy React template components live under
 * `src/templates/*` and mount through the dashboard PageRenderer, never here, so
 * this module (and the allow-lists that read it) stay lightweight and
 * browser-safe.
 */

export interface PageTemplateDefinition {
  /** kebab-case template id — matches the stored `page.template` value. */
  id: string;
  /**
   * Whether the LLM may *recommend* this template for a user table. `page-crud`
   * is always generated for every table, so it is renderable but never
   * recommendable (06-llm-assist.md §5 decision 6 — "page-crud is always
   * generated and must not be recommended"). All other templates are
   * recommendable candidates the model ranks per table.
   */
  recommendable: boolean;
  /** i18n key for the Studio template-picker label + info tooltip. */
  descriptionKey: string;
}

/**
 * Registry id of the per-table CRUD template. Mirrors `PAGE_CRUD_TEMPLATE_ID`
 * exported by `templates/page-crud` (a regression test in
 * `page-templates.test.ts` pins the two together so they cannot drift) — kept
 * as a literal here so the lightweight registry never imports the heavy
 * component module.
 */
export const PAGE_CRUD_TEMPLATE_ID = 'page-crud';

/** Registry id of the dashboard widget-grid template. */
export const PAGE_DASHBOARD_TEMPLATE_ID = 'page-dashboard';

/**
 * Every page template the runtime ships today, in nav/importance order. Append
 * here when a new template component lands; the allow-lists follow automatically.
 */
export const pageTemplateDefinitions: readonly PageTemplateDefinition[] = [
  { id: PAGE_CRUD_TEMPLATE_ID, recommendable: false, descriptionKey: 'templates.pageCrud.description' },
  {
    id: PAGE_DASHBOARD_TEMPLATE_ID,
    recommendable: true,
    descriptionKey: 'templates.pageDashboard.description',
  },
];

export class DuplicatePageTemplateIdError extends Error {
  constructor(readonly templateId: string) {
    super(`Duplicate page-template id: '${templateId}' — page-template ids are unique`);
    this.name = 'DuplicatePageTemplateIdError';
  }
}

/** Build an id→definition map; duplicate ids throw at module init. */
export function buildPageTemplateRegistry(
  definitions: readonly PageTemplateDefinition[],
): ReadonlyMap<string, PageTemplateDefinition> {
  const map = new Map<string, PageTemplateDefinition>();
  for (const definition of definitions) {
    if (map.has(definition.id)) throw new DuplicatePageTemplateIdError(definition.id);
    map.set(definition.id, definition);
  }
  return map;
}

export const pageTemplateRegistry: ReadonlyMap<string, PageTemplateDefinition> =
  buildPageTemplateRegistry(pageTemplateDefinitions);

export function getPageTemplate(id: string): PageTemplateDefinition | undefined {
  return pageTemplateRegistry.get(id);
}
