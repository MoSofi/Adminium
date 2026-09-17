// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Page-template registry: PageRenderer resolves the envelope's `template` id
 * to a component. Resolution order:
 *
 * 1. explicit registrations (tests, manifest extension host later);
 * 2. built-in bindings for templates shipped in `@adminium/widgets`
 *    (`page-crud`, `page-dashboard`, and the twelve M7 wave-2 archetypes).
 *
 * Unknown / not-yet-shipped ids resolve to `null` and PageRenderer renders the
 * "unknown template" card — never a crash.
 *
 * The built-in bindings are dynamic imports, in a module that is loaded on
 * demand itself: `templateLoaders.ts` says why.
 */
import type * as TemplateLoaders from './templateLoaders.js';
import type { PageTemplateComponent } from './template-types.js';

export type {
  PageTemplateAdapters,
  PageTemplateComponent,
  PageTemplateProps,
} from './template-types.js';

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
const loaded = new Map<string, Promise<PageTemplateComponent | null>>();

let loaders: Promise<typeof TemplateLoaders> | null = null;

/** Start fetching the built-in templates' loaders; a failed fetch is tried again next time. */
export function preloadPageTemplates(): Promise<typeof TemplateLoaders> {
  loaders ??= import('./templateLoaders.js').catch((error: unknown) => {
    loaders = null;
    throw error;
  });
  return loaders;
}

export async function resolvePageTemplate(id: string): Promise<PageTemplateComponent | null> {
  const local = localRegistry.get(id);
  if (local !== undefined) return local;
  const pending = loaded.get(id) ?? preloadPageTemplates().then((builtins) => builtins.loadBuiltinTemplate(id));
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
