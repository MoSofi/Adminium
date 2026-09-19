// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The four host pages, by their context key.
 *
 * The runner resolves an adapter once and then branches on nothing: every
 * difference between the pages — what it is called, which tools it offers,
 * what a document looks like, what a valid draft is, what the diff compares —
 * lives behind {@link AssistantContextAdapter}.
 */

import type { AssistantContextKey } from '@adminium/meta';

import { emailContext } from './email.js';
import { invoiceTemplateContext, invoicesContext } from './invoice.js';
import { reportContext } from './report.js';
import type { AssistantContextAdapter } from '../types.js';

const ADAPTERS: Readonly<Record<AssistantContextKey, AssistantContextAdapter>> = Object.freeze({
  email: emailContext,
  'invoice-template': invoiceTemplateContext,
  invoices: invoicesContext,
  report: reportContext,
});

export function contextAdapter(context: AssistantContextKey): AssistantContextAdapter {
  return ADAPTERS[context];
}

export { emailContext, invoiceTemplateContext, invoicesContext, reportContext };
