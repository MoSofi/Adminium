// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A LEDGER'S REFUSAL, IN THE READER'S OWN LANGUAGE.
 *
 * A save that hands a row to an add-on's ledger (stock, a gift card) can be
 * refused for a reason the add-on or Adminium names: there is not enough
 * left, the code is not valid, the row still holds something. The server
 * answers the reason as a word and a sentence in English; every screen that
 * shows a failed save shows that sentence. Here the word is turned into a
 * sentence of the reader's language, once, where the dashboard's saves come
 * back — so no screen has to know the reasons.
 *
 * Each reason is its own literal key: a key built from the word would be one
 * no check could hold against the eight bundles.
 */
import { ApiError } from '../app/api.js';
import { t } from '../i18n/t.js';

/** The sentence for a reason a ledger refused with, or null for a word this build does not know. */
export function ledgerRefusalText(reason: unknown): string | null {
  switch (reason) {
    case 'out-of-stock':
      return t('errors:POSTING_REASON.out-of-stock', 'There is not enough of this left.');
    case 'expired':
      return t('errors:POSTING_REASON.expired', 'This has expired.');
    case 'needs-batch':
      return t('errors:POSTING_REASON.needs-batch', 'Choose which batch this comes from.');
    case 'not-valid':
      return t('errors:POSTING_REASON.not-valid', 'This code is not valid.');
    case 'inactive':
      return t('errors:POSTING_REASON.inactive', 'This is not active yet.');
    case 'void':
      return t('errors:POSTING_REASON.void', 'This has been cancelled.');
    case 'empty':
      return t('errors:POSTING_REASON.empty', 'Nothing is left on this.');
    case 'used-up':
      return t('errors:POSTING_REASON.used-up', 'This has been used up.');
    case 'over-limit':
      return t('errors:POSTING_REASON.over-limit', 'This would go over a limit.');
    case 'needs-customer':
      return t('errors:POSTING_REASON.needs-customer', 'This needs a customer whose address is confirmed.');
    case 'refund-over':
      return t('errors:POSTING_REASON.refund-over', 'This is more than was paid this way.');
    case 'not-allowed':
      return t('errors:POSTING_REASON.not-allowed', 'This is not allowed here.');
    case 'mapped-changed':
      return t('errors:POSTING_REASON.mapped-changed', 'This row still holds something: put it back first, then change it.');
    case 'receipt-open':
      return t('errors:POSTING_REASON.receipt-open', 'This still holds something: put it back first.');
    case 'one-at-a-time':
      return t('errors:POSTING_REASON.one-at-a-time', 'These rows are saved one at a time.');
    case 'add-on-unavailable':
      return t('errors:POSTING_REASON.add-on-unavailable', 'The add-on this depends on cannot be asked right now, so this cannot be saved.');
    case 'planner-failed':
      return t('errors:POSTING_REASON.planner-failed', 'The add-on this depends on did not answer as it should, so nothing was saved.');
    case 'too-large':
      return t('errors:POSTING_REASON.too-large', 'This is more than can be saved in one go.');
    case 'hooked':
      return t('errors:POSTING_REASON.hooked', 'Project code changes a table the add-on keeps, so nothing can be recorded there during a save.');
    case 'guarded':
      return t('errors:POSTING_REASON.guarded', 'A table the add-on keeps has a lock of its own, so nothing can be recorded there during a save.');
    case 'card-pays-card':
      return t('errors:POSTING_REASON.card-pays-card', 'This cannot be paid for this way.');
    default:
      return null;
  }
}

/**
 * The sentence for a reason a price was refused with — a code that does not
 * stand, a reduction by hand past its giver's limit, an order whose price
 * stands — or null for a word this build does not know. `details` carries
 * the figure a sentence names: the spend a code needs, the most that may be
 * taken off.
 */
export function adjustRefusalText(reason: unknown, details: { amount?: unknown; max?: unknown } = {}): string | null {
  const amount = typeof details.amount === 'string' ? details.amount : '';
  const max = typeof details.max === 'string' ? details.max : '';
  switch (reason) {
    case 'unknown':
      return t('errors:ADJUST_REASON.unknown', 'No code like this is on offer here.');
    case 'used-up':
      return t('errors:ADJUST_REASON.used-up', 'This code has been used as many times as it can be.');
    case 'needs-minimum':
      return t('errors:ADJUST_REASON.needs-minimum', 'This code needs a spend of {amount} or more.', { amount });
    case 'not-for-these-items':
      return t('errors:ADJUST_REASON.not-for-these-items', 'This code is not for anything on this order.');
    case 'needs-sign-in':
      return t('errors:ADJUST_REASON.needs-sign-in', 'This code is for a signed-in customer.');
    case 'needs-customer':
      return t('errors:ADJUST_REASON.needs-customer', 'Name the customer first: this code is kept for one use each.');
    case 'over-ceiling':
      return t('errors:ADJUST_REASON.over-ceiling', 'This is more than you may take off. The most is {max}.', { max });
    case 'expired':
      return t('errors:ADJUST_REASON.expired', 'This code has expired.');
    case 'inactive':
      return t('errors:ADJUST_REASON.inactive', 'This code is not active.');
    case 'void':
      return t('errors:ADJUST_REASON.void', 'This code was voided.');
    case 'not-yet':
      return t('errors:ADJUST_REASON.not-yet', 'This code cannot be used yet.');
    case 'over-limit':
      return t('errors:ADJUST_REASON.over-limit', 'This customer has used this code as often as it allows.');
    case 'frozen':
      return t('errors:ADJUST_REASON.frozen', 'This order’s price stands: it cannot be changed any more.');
    case 'not-allowed':
      return t('errors:ADJUST_REASON.not-allowed', 'You may not change this.');
    case 'refund-over':
      return t('errors:ADJUST_REASON.refund-over', 'This is more than is left to give back.');
    default:
      return null;
  }
}

/**
 * A failed save as the reader is told it: a ledger's refusal with its
 * sentence in their language (and what is left, when the server said), any
 * other error as it came. The code, the status and the details are kept, so
 * whatever routes on them still does.
 */
export function inReadersWords(error: unknown): unknown {
  if (error instanceof ApiError && error.code === 'ADJUST_REFUSED') {
    const told = (error.details ?? {}) as { reason?: unknown; amount?: unknown; max?: unknown };
    const words = adjustRefusalText(told.reason, told) ?? t('errors:ADJUST_REFUSED', 'This could not be applied to the price.');
    return new ApiError(error.status, error.code, words, error.requestId, error.details);
  }
  if (!(error instanceof ApiError) || error.code !== 'POSTING_REFUSED') return error;
  const details = (error.details ?? {}) as { reason?: unknown };
  const said = ledgerRefusalText(details.reason) ?? t('errors:POSTING_REFUSED', 'This could not be saved: the add-on that keeps its records refused it.');
  return new ApiError(error.status, error.code, said, error.requestId, error.details);
}
