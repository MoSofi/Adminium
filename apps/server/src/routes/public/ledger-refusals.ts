// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A CUSTOMER IS TOLD WHEN A LEDGER SAYS NO.
 *
 * Staff are told the ledger, the rule, the reason, what is left and of
 * what. A customer is told one of two things, and nothing else:
 *
 *  - a stock ledger's own no (not enough, expired, a batch needed), or its
 *    cap: OUT OF STOCK — with how many are left only where the owner chose
 *    to show it, and never of what;
 *  - a value ledger's own no (a card not valid, inactive, void, expired,
 *    empty, used up, over its limit, not this customer's): THE CARD WAS
 *    REFUSED — always the one answer `not-valid`, whichever it was, so a
 *    guess learns nothing about a card that exists.
 *
 * Everything else — a plan that failed, an add-on that cannot be asked, a
 * rule that takes one row at a time, an open posting — is a refusal with no
 * name: none of it is the customer's to know.
 *
 * Pure.
 */
import { MISSES } from './code-guesses.js';
import { AppError, POSTING_ENGINE_REASONS } from '../../errors.js';

const ENGINE: ReadonlySet<string> = new Set(POSTING_ENGINE_REASONS);

export type PublicLedgerRefusal =
  | { code: 'PUBLIC_OUT_OF_STOCK'; params: { path?: (string | number)[]; child?: string; index?: number; left?: string } }
  | { code: 'PUBLIC_CARD_REFUSED'; params: { reason: 'not-valid' } }
  | { code: null };

/** A row's place in a create with child rows, as a customer is told it. */
function placeOf(path: unknown): { path?: (string | number)[]; child?: string; index?: number } {
  if (!Array.isArray(path) || path.length === 0) return {};
  const [child, index] = path as (string | number)[];
  return { path: path as (string | number)[], ...(typeof child === 'string' ? { child } : {}), ...(typeof index === 'number' ? { index } : {}) };
}

/** A staff refusal of a ledger as a customer hears it; null when the error is not one. */
export function publicLedgerRefusal(error: unknown): PublicLedgerRefusal | null {
  if (!(error instanceof AppError) || error.code !== 'POSTING_REFUSED') return null;
  const details = (error.details ?? {}) as { reason?: unknown; family?: unknown; path?: unknown; shown?: unknown };
  const reason = typeof details.reason === 'string' ? details.reason : '';
  if (reason === '' || ENGINE.has(reason)) return { code: null };
  if (details.family === 'stock') {
    // What is left, as the owner chose to show it: worked out where the refusal was made, never here.
    const left = (error as { publicLeft?: unknown }).publicLeft;
    return { code: 'PUBLIC_OUT_OF_STOCK', params: { ...placeOf(details.path), ...(typeof left === 'string' ? { left } : {}) } };
  }
  if (details.family === 'value') return { code: 'PUBLIC_CARD_REFUSED', params: { reason: 'not-valid' } };
  return { code: null };
}

/**
 * A code typed where a card's code goes (`cardInputs`) that named nothing,
 * or something used up: answered as a card that is not valid is, word for
 * word and with no place. One answer for both, so a stranger typing codes
 * never learns which of them are cards. Null for any other refusal.
 */
export function cardMiss(named: { column?: string | undefined; reason: string } | null, cards: ReadonlySet<string> | undefined): Extract<PublicLedgerRefusal, { code: 'PUBLIC_CARD_REFUSED' }> | null {
  if (named === null || named.column === undefined || cards?.has(named.column) !== true || !MISSES.has(named.reason)) return null;
  return { code: 'PUBLIC_CARD_REFUSED', params: { reason: 'not-valid' } };
}

/** What a public quote says of each ledger: whether it would go through, and — refused — only what a save would tell a customer. */
export function publicPostings(
  outcomes: readonly { ledger: string; quote?: { state: 'ok' | 'refused' | 'unavailable'; reason?: string; line?: number; path?: (string | number)[]; left?: string } | undefined; family?: 'stock' | 'value' | undefined; publicLeft?: string | undefined }[] | undefined,
): { ledger: string; state: 'ok' | 'refused' | 'unavailable'; reason?: 'out-of-stock' | 'not-valid'; path?: (string | number)[]; line?: number; left?: string }[] | undefined {
  const quoted = (outcomes ?? []).filter((call) => call.quote !== undefined);
  if (quoted.length === 0) return undefined;
  return quoted.map((call) => {
    const quote = call.quote!;
    if (quote.state !== 'refused') return { ledger: call.ledger, state: quote.state };
    const named = quote.reason !== undefined && !ENGINE.has(quote.reason) ? (call.family === 'stock' ? ('out-of-stock' as const) : call.family === 'value' ? ('not-valid' as const) : undefined) : undefined;
    return {
      ledger: call.ledger,
      state: 'refused' as const,
      ...(named === undefined ? {} : { reason: named }),
      ...(named !== 'out-of-stock' || quote.path === undefined ? {} : { path: quote.path }),
      ...(named !== 'out-of-stock' || quote.line === undefined ? {} : { line: quote.line }),
      ...(named !== 'out-of-stock' || call.publicLeft === undefined ? {} : { left: call.publicLeft }),
    };
  });
}
