// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `page-wizard` binding (09-generated-app.md §4.1, §11.1): resolves the
 * seeded Import-wizard page (template `page-wizard`) to the real Import
 * Wizard flow — killing the "Unknown page template" card for the §2.2
 * universal utility page. When the envelope carries a source table, the
 * wizard starts with that target pre-resolved; source-less documents (the
 * common seeded shape — the wizard picks its own target) start at the
 * table picker.
 */
import { ImportWizardPage, type ImportTarget } from '../data-io/ImportWizardPage.js';
import type { PageTemplateProps } from './template-types.js';

export function PageWizardBinding({ page }: PageTemplateProps) {
  let initialTarget: ImportTarget | undefined;
  const table = page.source?.table;
  const connectionId = page.source?.connectionId;
  if (typeof table === 'string' && table.length > 0 && typeof connectionId === 'string') {
    initialTarget = { connectionId, table, columns: [] };
  }
  return <ImportWizardPage initialTarget={initialTarget} />;
}
