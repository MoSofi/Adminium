// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `/invoices` — the manager (34-invoices-add-on.md §3.9, 34-T48). The
 * route's search carries what a link can ask for: `kind` picks the tab
 * (templates by default, the comp's initial state, 1044).
 */
import { useSearch } from '@tanstack/react-router';

import { InvoiceManager } from './manager/Manager.js';
import type { InvoicesSearch } from './search.js';

export function InvoicesPage() {
  const search = useSearch({ strict: false }) as InvoicesSearch;
  return <InvoiceManager initialTab={search.kind ?? 'template'} />;
}
