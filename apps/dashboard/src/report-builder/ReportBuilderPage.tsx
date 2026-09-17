// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/report-builder` — the manager. The route's search carries what a link
 * can ask for: `kind` picks the tab (templates by default, the comp's
 * initial state, 439).
 */
import { useSearch } from '@tanstack/react-router';

import { ReportManager } from './manager/Manager.js';
import type { ReportBuilderSearch } from './search.js';

export function ReportBuilderPage() {
  const search = useSearch({ strict: false }) as ReportBuilderSearch;
  return <ReportManager initialTab={search.kind ?? 'template'} />;
}
