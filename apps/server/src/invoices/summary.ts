// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The card facts (34-invoices-add-on.md §3.9 "denormalised columns"): what
 * the manager's card and row read without decoding the body, written by the
 * server on every save so the list never opens 70 fields per row. The shape
 * is `invoiceSummarySchema` in `@adminium/meta` and `InvoiceSummaryFacts` in
 * the dashboard's `api.ts`, exactly.
 */
import type { InvoiceSummary } from '@adminium/meta';

import type { InvoiceBody } from './document.js';
import { totalsOf } from './money.js';

export function summaryOf(body: InvoiceBody): InvoiceSummary {
  return {
    number: body.number,
    customerName: body.customerName,
    title: body.title,
    logoText: body.logoText,
    logoIcon: body.logoIcon,
    accent: body.accent,
    currency: body.currency,
    cents: body.cents,
    totalMinor: totalsOf(body).total,
    itemCount: body.items.length,
  };
}
