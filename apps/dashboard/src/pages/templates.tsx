// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Page-template registry (09-generated-app.md §4.1): PageRenderer resolves the
 * envelope's `template` id to a component. Resolution order:
 *
 * 1. explicit registrations (tests, manifest extension host later);
 * 2. built-in bindings for templates shipped in `@adminium/widgets`
 *    (`page-crud`, `page-dashboard`, and the twelve M7 wave-2 archetypes).
 *
 * Unknown / not-yet-shipped ids resolve to `null` and PageRenderer renders the
 * "unknown template" card — never a crash (§3.1).
 *
 * ─── WHY THE BINDINGS ARE DYNAMIC IMPORTS ────────────────────────────────────
 *
 * This module is reached from `/p/$slug`, the app's main route, so everything it
 * imports is in the synchronously-loaded entry set by definition. Statically
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
 */
import type { PageTemplateComponent } from './template-types.js';

export type {
  PageTemplateAdapters,
  PageTemplateComponent,
  PageTemplateProps,
} from './template-types.js';

type TemplateLoader = () => Promise<PageTemplateComponent>;

/** Templates with a first-class binding in this app, one chunk each. */
const builtinTemplates: Record<string, TemplateLoader> = {
  'page-crud': async () => (await import('./PageCrudBinding.js')).PageCrudBinding,
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
};

/** Every built-in template id, for tests and the surface-defaults table. */
export const BUILTIN_TEMPLATE_IDS = Object.keys(builtinTemplates);

const localRegistry = new Map<string, PageTemplateComponent>();

/** Explicit registration wins over built-ins. Returns an unregister handle. */
export function registerPageTemplate(id: string, component: PageTemplateComponent): () => void {
  localRegistry.set(id, component);
  return () => {
    if (localRegistry.get(id) === component) localRegistry.delete(id);
  };
}

/**
 * Resolved loaders are memoized: `TemplateMount` re-resolves on every
 * `page.template` change, and without this a navigation back to a template
 * would re-enter the module graph. Vite dedupes the network fetch, but not the
 * promise churn or the `resolving` skeleton it puts on screen.
 */
const loaded = new Map<string, Promise<PageTemplateComponent>>();

export async function resolvePageTemplate(id: string): Promise<PageTemplateComponent | null> {
  const local = localRegistry.get(id);
  if (local !== undefined) return local;
  const loader = builtinTemplates[id];
  if (loader === undefined) return null;
  const pending = loaded.get(id) ?? loader();
  loaded.set(id, pending);
  try {
    return await pending;
  } catch (error) {
    // A failed chunk must not poison the id forever — the next attempt (the
    // error card's Retry, or a re-navigation) should refetch.
    loaded.delete(id);
    throw error;
  }
}
