// SPDX-License-Identifier: AGPL-3.0-only
/**
 * React-query keys for the invoice documents. Everything hangs off
 * `['invoices']` so one invalidation after a mutation refreshes the
 * manager's list, its counts and any open detail together.
 */
import { queryOptions, type QueryClient } from '@tanstack/react-query';

import { invoicesApi, type InvoiceListParams } from './api.js';

export const INVOICES_KEY = ['invoices'] as const;

export function invoicesQuery(params: InvoiceListParams) {
  return queryOptions({
    queryKey: [...INVOICES_KEY, 'list', params] as const,
    queryFn: () => invoicesApi.list(params),
  });
}

export function invoiceQuery(id: string) {
  return queryOptions({
    queryKey: [...INVOICES_KEY, 'detail', id] as const,
    queryFn: () => invoicesApi.detail(id),
  });
}

export function invoiceStartersQuery() {
  return queryOptions({
    queryKey: [...INVOICES_KEY, 'starters'] as const,
    queryFn: () => invoicesApi.starters(),
    staleTime: 5 * 60_000,
  });
}

/** After any mutation: lists, counts and details all re-read. */
export function invalidateInvoices(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: INVOICES_KEY });
}
