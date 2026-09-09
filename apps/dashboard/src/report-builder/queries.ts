// SPDX-License-Identifier: AGPL-3.0-only
/**
 * React-query keys for the report documents (43-report-builder.md §3.1).
 * Everything hangs off `['report-documents']` so one invalidation after a
 * mutation refreshes the manager's list, its counts and any open detail
 * together. NOT `['reports']` — that key belongs to Scheduled Reports.
 */
import { queryOptions, type QueryClient } from '@tanstack/react-query';

import { reportBuilderApi, type ReportListParams } from './api.js';

export const REPORT_DOCUMENTS_KEY = ['report-documents'] as const;

export function reportDocumentsQuery(params: ReportListParams) {
  return queryOptions({
    queryKey: [...REPORT_DOCUMENTS_KEY, 'list', params] as const,
    queryFn: () => reportBuilderApi.list(params),
  });
}

export function reportDocumentQuery(id: string) {
  return queryOptions({
    queryKey: [...REPORT_DOCUMENTS_KEY, 'detail', id] as const,
    queryFn: () => reportBuilderApi.detail(id),
  });
}

export function reportStartersQuery() {
  return queryOptions({
    queryKey: [...REPORT_DOCUMENTS_KEY, 'starters'] as const,
    queryFn: () => reportBuilderApi.starters(),
    staleTime: 5 * 60_000,
  });
}

/** After any mutation: lists, counts and details all re-read. */
export function invalidateReportDocuments(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: REPORT_DOCUMENTS_KEY });
}
