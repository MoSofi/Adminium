/**
 * Page-template registry (09-generated-app.md §4.1): PageRenderer resolves the
 * envelope's `template` id to a component. Resolution order:
 *
 * 1. explicit registrations (tests, manifest extension host later);
 * 2. built-in bindings for templates shipped in `@adminium/widgets`
 *    (`page-crud`, `page-dashboard`).
 *
 * Unknown / not-yet-shipped ids resolve to `null` and PageRenderer renders the
 * "unknown template" card — never a crash (§3.1).
 */
import { PageCrudBinding } from './PageCrudBinding.js';
import { PageDashboardBinding } from './PageDashboardBinding.js';
import type { PageTemplateComponent } from './template-types.js';

export type {
  PageTemplateAdapters,
  PageTemplateComponent,
  PageTemplateProps,
} from './template-types.js';

/** Templates with a first-class binding in this app. */
const builtinTemplates: Record<string, PageTemplateComponent> = {
  'page-crud': PageCrudBinding,
  'page-dashboard': PageDashboardBinding,
};

const localRegistry = new Map<string, PageTemplateComponent>();

/** Explicit registration wins over built-ins. Returns an unregister handle. */
export function registerPageTemplate(id: string, component: PageTemplateComponent): () => void {
  localRegistry.set(id, component);
  return () => {
    if (localRegistry.get(id) === component) localRegistry.delete(id);
  };
}

export async function resolvePageTemplate(id: string): Promise<PageTemplateComponent | null> {
  const local = localRegistry.get(id);
  if (local !== undefined) return local;
  return builtinTemplates[id] ?? null;
}
