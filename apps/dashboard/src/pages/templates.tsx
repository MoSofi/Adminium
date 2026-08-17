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
 */
import { PageBoardBinding } from './PageBoardBinding.js';
import { PageBuilderBinding } from './builders/index.js';
import { PageCalendarBinding } from './PageCalendarBinding.js';
import { PageChatBinding } from './PageChatBinding.js';
import { PageCrudBinding } from './PageCrudBinding.js';
import { PageDashboardBinding } from './PageDashboardBinding.js';
import { PageDirectoryBinding } from './PageDirectoryBinding.js';
import { PageFilesBinding } from './PageFilesBinding.js';
import { PageLogViewerBinding } from './PageLogViewerBinding.js';
import { PageMasterDetailBinding } from './PageMasterDetailBinding.js';
import { PageQueueInboxBinding } from './PageQueueInboxBinding.js';
import { PageSchedulerBinding } from './PageSchedulerBinding.js';
import { PageSettingsBinding } from './PageSettingsBinding.js';
import { PageWizardBinding } from './PageWizardBinding.js';
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
  // M7 wave 2 — planning archetypes (09 §7.5/§7.6).
  'page-board': PageBoardBinding,
  'page-calendar': PageCalendarBinding,
  'page-scheduler': PageSchedulerBinding,
  // People / queues (09 §7.3/§7.4/§7.7).
  'page-directory': PageDirectoryBinding,
  'page-master-detail': PageMasterDetailBinding,
  'page-queue-inbox': PageQueueInboxBinding,
  // Logs / media / chat (09 §7.8/§7.9).
  'page-log-viewer': PageLogViewerBinding,
  'page-files': PageFilesBinding,
  'page-chat': PageChatBinding,
  // Builder / wizard / settings (09 §7.11, §11.1, §8.2).
  'page-builder': PageBuilderBinding,
  'page-wizard': PageWizardBinding,
  'page-settings': PageSettingsBinding,
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
