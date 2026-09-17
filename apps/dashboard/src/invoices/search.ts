// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The `/invoices` search contract, in a leaf module: the router reads it
 * eagerly (a `validateSearch` runs before the page loads) and the page is
 * lazy — importing the page for it would pull the manager into the entry
 * chunk (the email surface's `search.ts`).
 */
export interface InvoicesSearch {
  /** Which tab opens: templates (the comp's initial tab, 1044) or invoices. */
  kind?: 'template' | 'invoice' | undefined;
}

/** Unknown values fall away rather than fail the route. */
export function validateInvoicesSearch(search: Record<string, unknown>): InvoicesSearch {
  return {
    ...(search['kind'] === 'template' || search['kind'] === 'invoice' ? { kind: search['kind'] } : {}),
  };
}
