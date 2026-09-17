// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The built-in page templates' loaders (09-generated-app.md §4.1), for
 * `resolvePageTemplate` in `templates.tsx`. Each template is wrapped in the
 * project scope (`project/scope.tsx`): the cells, cards and toasts of a
 * project's own code, which is how tables and dashboards find them
 * (49-developer-projects.md §6.3).
 *
 * ─── WHY THE BINDINGS ARE DYNAMIC IMPORTS ────────────────────────────────────
 *
 * `templates.tsx` is reached from `/p/$slug`, the app's main route, so everything
 * it imports is in the synchronously-loaded entry set by definition. Statically
 * importing all fourteen bindings pulled the whole of `@adminium/widgets` in
 * with them: 543 KiB minified, 24% of the entry chunk, plus most of the
 * `lucide-react` weight the templates' icons drag along — and a page renders
 * exactly ONE template, so thirteen of the fourteen were downloaded by every
 * user on every route and never executed.
 *
 * `chunk-budget.json` spent four raises in one day attributing the entry's
 * growth to the en-US i18n catalogue and naming 10-T06's namespace split as the
 * fix. Deleting the entire catalogue and rebuilding measures 48.7 KiB gz — real,
 * but a seventh of what this is, and nowhere near the 305 KiB gap to the v1.0
 * target. The templates were the actual weight.
 *
 * `resolvePageTemplate` was already async and `TemplateMount` already renders a
 * skeleton for its `resolving` phase, so nothing downstream changes: the
 * machinery for this was built and then fed a synchronous map.
 *
 * The thunks must be literal `import()` calls with static specifiers — Vite
 * cannot code-split a computed one, and a variable specifier silently collapses
 * back into the entry.
 *
 * ─── WHY THIS MAP IS A MODULE OF ITS OWN ─────────────────────────────────────
 *
 * In `templates.tsx` the map itself cost the entry chunk 2.1 KiB gz: each
 * `import()` there carries the list of files it preloads. Loaded on demand it
 * is one small chunk, which the page route starts fetching before the page
 * document arrives (`preloadPageTemplates`), so a page does not wait longer.
 */
import { withProjectScope } from '../project/scope.js';
import type { PageTemplateComponent } from './template-types.js';

type TemplateLoader = () => Promise<PageTemplateComponent>;

/** Templates with a first-class binding in this app, one chunk each. */
const builtinTemplates: Record<string, TemplateLoader> = {
  'page-crud': async () => (await import('./PageCrudBinding.js')).PageCrudBinding,
  // The record detail page (30-record-pages.md D1/D3) — resolved by
  // TemplateMount from the envelope's `config.detail.template` when the
  // `/r/$recordId` child route is active.
  'page-record': async () => (await import('./PageRecordBinding.js')).PageRecordBinding,
  'page-dashboard': async () => (await import('./PageDashboardBinding.js')).PageDashboardBinding,
  // M7 wave 2 — planning archetypes (09 §7.5/§7.6).
  'page-board': async () => (await import('./PageBoardBinding.js')).PageBoardBinding,
  'page-calendar': async () => (await import('./PageCalendarBinding.js')).PageCalendarBinding,
  'page-scheduler': async () => (await import('./PageSchedulerBinding.js')).PageSchedulerBinding,
  // People / queues (09 §7.3/§7.4/§7.7).
  'page-directory': async () => (await import('./PageDirectoryBinding.js')).PageDirectoryBinding,
  'page-master-detail': async () =>
    (await import('./PageMasterDetailBinding.js')).PageMasterDetailBinding,
  'page-queue-inbox': async () =>
    (await import('./PageQueueInboxBinding.js')).PageQueueInboxBinding,
  // Logs / media / chat (09 §7.8/§7.9).
  'page-log-viewer': async () => (await import('./PageLogViewerBinding.js')).PageLogViewerBinding,
  'page-files': async () => (await import('./PageFilesBinding.js')).PageFilesBinding,
  'page-chat': async () => (await import('./PageChatBinding.js')).PageChatBinding,
  // Builder / wizard / settings (09 §7.11, §11.1, §8.2).
  'page-builder': async () => (await import('./builders/index.js')).PageBuilderBinding,
  'page-wizard': async () => (await import('./PageWizardBinding.js')).PageWizardBinding,
  'page-settings': async () => (await import('./PageSettingsBinding.js')).PageSettingsBinding,
  // A page written by hand in the project folder, `pages/<slug>.tsx`
  // (49-developer-projects.md §6.3). The server writes these rows; Studio
  // cannot create one.
  'project-page': async () => (await import('../project/ProjectPageBinding.js')).ProjectPageBinding,
};

/** Every built-in template id, for tests and the surface-defaults table. */
export const BUILTIN_TEMPLATE_IDS = Object.keys(builtinTemplates);

/** A built-in template, inside the project scope; `null` for an id this build does not have. */
export async function loadBuiltinTemplate(id: string): Promise<PageTemplateComponent | null> {
  const loader = builtinTemplates[id];
  if (loader === undefined) return null;
  return withProjectScope(await loader());
}
