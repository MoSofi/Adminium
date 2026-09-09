// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `/report-builder` search contract, in a leaf module: the router reads
 * it eagerly (a `validateSearch` runs before the page loads) and the page is
 * lazy — importing the page for it would pull the manager into the entry
 * chunk (43-report-builder.md §3.6; the invoice surface's `search.ts`).
 */
export interface ReportBuilderSearch {
  /** Which tab opens: templates (the comp's initial tab, 439) or reports. */
  kind?: 'template' | 'report' | undefined;
}

/** Unknown values fall away rather than fail the route. */
export function validateReportBuilderSearch(search: Record<string, unknown>): ReportBuilderSearch {
  return {
    ...(search['kind'] === 'template' || search['kind'] === 'report' ? { kind: search['kind'] } : {}),
  };
}
