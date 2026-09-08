// SPDX-License-Identifier: AGPL-3.0-only
/**
 * React-query keys for the email documents (39-email-templates-and-
 * campaigns.md §3.6). Everything hangs off `['email-templates']` so one
 * invalidation after a mutation refreshes the manager's list, its counts and
 * any open detail together — a rename on a card is visible in the editor's
 * language menu without a second round of bookkeeping.
 */
import { queryOptions, type QueryClient } from '@tanstack/react-query';

import { emailApi, type EmailListParams } from './api.js';

export const EMAIL_DOCUMENTS_KEY = ['email-templates'] as const;

export function emailDocumentsQuery(params: EmailListParams) {
  return queryOptions({
    queryKey: [...EMAIL_DOCUMENTS_KEY, 'list', params] as const,
    queryFn: () => emailApi.list(params),
  });
}

export function emailDocumentQuery(id: string) {
  return queryOptions({
    queryKey: [...EMAIL_DOCUMENTS_KEY, 'detail', id] as const,
    queryFn: () => emailApi.detail(id),
  });
}

export function emailStartersQuery() {
  return queryOptions({
    queryKey: [...EMAIL_DOCUMENTS_KEY, 'starters'] as const,
    queryFn: () => emailApi.starters(),
    staleTime: 5 * 60_000,
  });
}

export function emailSavedBlocksQuery() {
  return queryOptions({
    queryKey: [...EMAIL_DOCUMENTS_KEY, 'blocks'] as const,
    queryFn: () => emailApi.savedBlocks(),
  });
}

export function emailRunsQuery(id: string) {
  return queryOptions({
    queryKey: [...EMAIL_DOCUMENTS_KEY, 'runs', id] as const,
    queryFn: () => emailApi.runs(id),
  });
}

/** After any mutation: lists, counts, details and runs all re-read. */
export function invalidateEmailDocuments(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: EMAIL_DOCUMENTS_KEY });
}
