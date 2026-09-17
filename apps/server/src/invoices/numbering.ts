// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Invoice numbers for the authored surface.
 *
 * The comp mints `'INV-' + (2051 + random)` on create (1382). Here a new
 * invoice takes `INV-` + (1001 + the number of invoices so far), stepped
 * forward past any number a row already carries — so two operators creating
 * at once, or a duplicate that kept its source's number verbatim (the comp
 * does, 1384), never mint the same one. A TEMPLATE carries the literal
 * placeholder {@link TEMPLATE_NUMBER}: a template's number is an example on
 * a design, never a minted one.
 *
 * This is the surface's own counter, not the render register's sequence:
 * a minted register number lands on the rendered document when that wave
 * ships; until then the authored number is what the sheet shows.
 */
import type { InvoiceDocumentsRepo } from '@adminium/meta';

export const TEMPLATE_NUMBER = 'INV-1000';
const FIRST = 1001;

export async function nextInvoiceNumber(repo: Pick<InvoiceDocumentsRepo, 'counts' | 'numberExists'>): Promise<string> {
  const { invoice } = await repo.counts();
  let n = FIRST + invoice;
  while (await repo.numberExists('invoice', `INV-${String(n)}`)) n += 1;
  return `INV-${String(n)}`;
}
