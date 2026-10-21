// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A designer invoice's Paid status follows its balance, both ways.
 *
 * An invoice made on the Invoices page keeps its payments in Adminium. Once it
 * has a live payment, the balance is in charge of one status: Paid when
 * nothing is left to pay, and back to Sent when a refund (or a refund that
 * failed after all) opens the balance again. The other statuses (Draft, Live,
 * Sent, Overdue) stay the person's to pick; Paid is never picked by hand.
 *
 * An invoice with no live payment keeps whatever status it has, Paid
 * included: one marked Paid by hand before payments were recorded is not
 * reopened by reading it. Test payments are kept apart and never count.
 *
 * TWO WRITERS, ONE ANSWER. A payment being recorded and a person saving the
 * document can cross: the save carries the status the editor last saw. Both
 * write and THEN derive the status from the balance as it stands, so
 * whichever runs last puts the right status down.
 */
import { compareAmounts, sameAmount, subtractAmounts } from '@adminium/add-on-contracts';
import { currencyScale } from '@adminium/manifest';
import { invoiceDocumentsRepo, keptPaymentsRepo, type InvoiceStatus, type MetaDb, type PayableRef } from '@adminium/meta';

import { resolvePayable, type PayableSources, type ResolvedPayable } from './payables.js';
import { isTestPayable } from './test-payables.js';

export interface DocumentStatusDeps {
  meta: MetaDb;
  sources: PayableSources;
  now?: () => number;
}

/** How a designer invoice's balance stands, as far as its status is concerned. */
export interface DocumentBalance {
  /** It has at least one live payment (refunded or not): the balance is in charge of Paid. */
  follows: boolean;
  /** Something was paid and nothing is left to pay. */
  settled: boolean;
  /** The currency its live payments were taken in; null when it has none. */
  paidIn: string | null;
}

export function documentRef(id: string): PayableRef {
  return { kind: 'document', connectionId: null, tableName: null, rowKey: id };
}

/** The status the balance puts down, given the one asked for and the one stored. Pure. */
export function statusAfter(stored: InvoiceStatus, asked: InvoiceStatus, balance: DocumentBalance): InvoiceStatus {
  // Paid is never picked by hand: asking for it keeps what is stored.
  const picked = asked === 'paid' && stored !== 'paid' ? stored : asked;
  if (!balance.follows) return picked;
  if (balance.settled) return 'paid';
  return picked === 'paid' ? 'sent' : picked;
}

function settledOf(payable: ResolvedPayable): boolean {
  if (payable.currency === '' || payable.refusal?.code === 'AMOUNT_UNCLEAR') return false;
  const scale = currencyScale(payable.currency);
  const paid = subtractAmounts(payable.total, payable.due, scale) ?? '0';
  return sameAmount(payable.due, '0') && compareAmounts(paid, '0') === 1;
}

/** The balance of a designer invoice; null when it is not one (a template, a test payable, gone). */
export async function documentBalance(deps: DocumentStatusDeps, id: string): Promise<DocumentBalance | null> {
  const ref = documentRef(id);
  if (isTestPayable(ref)) return null;
  const live = (await keptPaymentsRepo(deps.meta).forPayable(ref)).filter((row) => !row.voided && row.mode === 'live');
  const paidIn = live[0]?.currency ?? null;
  if (live.length === 0) return { follows: false, settled: false, paidIn: null };
  const payable = await resolvePayable(deps.sources, ref);
  if (payable === null) return null;
  // The invoice's currency is no longer the one it was paid in: its balance cannot be read, so it is not settled.
  return { follows: true, settled: payable.currency === paidIn && settledOf(payable), paidIn };
}

/**
 * Puts down the status the balance says, when it differs from the stored one.
 * Answers the status now stored; null when the payable is not a designer invoice.
 */
export async function followDocumentStatus(deps: DocumentStatusDeps, ref: PayableRef): Promise<InvoiceStatus | null> {
  if (ref.kind !== 'document' || isTestPayable(ref)) return null;
  const documents = invoiceDocumentsRepo(deps.meta);
  const row = await documents.findById(ref.rowKey);
  if (row === null || row.kind !== 'invoice') return null;
  const balance = await documentBalance(deps, row.id);
  if (balance === null) return row.status;
  const want = statusAfter(row.status, row.status, balance);
  if (want === row.status) return row.status;
  await documents.patch(row.id, { status: want }, (deps.now ?? Date.now)());
  return want;
}
