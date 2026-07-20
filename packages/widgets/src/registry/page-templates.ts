/**
 * Page-template registry — the single source of truth for which page templates
 * `@adminium/widgets` can render (04-widget-registry.md §10; 09-generated-app.md
 * §7). The LLM allow-lists (`llm-allowlist.ts`) derive from this map, so a
 * template the runtime cannot mount can never be recommended to, or accepted
 * from, the model (06-llm-assist.md §5 decision 6). A Studio template picker
 * does not exist yet; when one is built it should consume this registry the
 * same way (see `descriptionKey` below for the i18n contract it must follow).
 *
 * The runtime ships fourteen templates (mirroring `builtinTemplates` in the
 * dashboard's `pages/templates.tsx`):
 *   - `page-crud`      — the per-table resource template, generated for EVERY
 *                        table, therefore renderable but never LLM-recommended.
 *   - `page-dashboard` — the widget-grid template.
 *   - the twelve M7 wave-2 templates. The nine data-shaped archetypes
 *     (`page-board` … `page-chat`) are recommendable — each is emittable by a
 *     §14 auto-trigger (`archetypes.ts`) and materializable from an accepted
 *     LLM suggestion (`composeRequestedArchetype`). The three tool surfaces
 *     (`page-builder`, `page-wizard`, `page-settings`) are renderable but NOT
 *     recommendable: they are platform/tool pages, not
 *     per-table archetypes, and the §8.3 materialization path cannot compose
 *     them (no `ARCHETYPE_NAV` placement), so an accepted suggestion could
 *     never become a working page.
 *
 * New templates register by appending a `PageTemplateDefinition` to
 * `pageTemplateDefinitions`; every list derived from this registry then grows
 * automatically — there is no parallel hand-maintained id list to keep in sync.
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
  /**
   * i18n key reserved for a future Studio template picker's label/tooltip,
   * following `templates.<camelCaseId>.description` (pinned by
   * `page-templates.test.ts`). NOT resolvable today: no locale catalog carries
   * these keys and nothing in the running app consumes them yet. A consumer
   * must therefore render `t(descriptionKey, humanize(id))`-style — key with a
   * humanized-id fallback, exactly how the dashboard `WidgetPalette` consumes
   * widget `descriptionKey`s — or add the catalog entries when it lands.
   */
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
  // M7 wave 2 — planning archetypes (09 §7.5/§7.6).
  { id: 'page-board', recommendable: true, descriptionKey: 'templates.pageBoard.description' },
  { id: 'page-calendar', recommendable: true, descriptionKey: 'templates.pageCalendar.description' },
  { id: 'page-scheduler', recommendable: true, descriptionKey: 'templates.pageScheduler.description' },
  // People / queues (09 §7.3/§7.4/§7.7).
  { id: 'page-directory', recommendable: true, descriptionKey: 'templates.pageDirectory.description' },
  {
    id: 'page-master-detail',
    recommendable: true,
    descriptionKey: 'templates.pageMasterDetail.description',
  },
  {
    id: 'page-queue-inbox',
    recommendable: true,
    descriptionKey: 'templates.pageQueueInbox.description',
  },
  // Logs / media / chat (09 §7.8/§7.9).
  { id: 'page-log-viewer', recommendable: true, descriptionKey: 'templates.pageLogViewer.description' },
  { id: 'page-files', recommendable: true, descriptionKey: 'templates.pageFiles.description' },
  { id: 'page-chat', recommendable: true, descriptionKey: 'templates.pageChat.description' },
  // Builder / wizard / settings (09 §7.11, §11.1, §8.2) — tool surfaces: the
  // LLM must never recommend them per table (see module docblock).
  { id: 'page-builder', recommendable: false, descriptionKey: 'templates.pageBuilder.description' },
  { id: 'page-wizard', recommendable: false, descriptionKey: 'templates.pageWizard.description' },
  { id: 'page-settings', recommendable: false, descriptionKey: 'templates.pageSettings.description' },
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
