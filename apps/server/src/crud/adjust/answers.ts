// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHO IS TOLD WHAT — pure.
 *
 * An add-on says why a typed code, or a reduction staff gave by hand, does
 * not stand. Staff hear the reason as given. A customer hears three of them
 * by name — the basket is under the code's minimum, the code is not for
 * these things, the code needs a signed-in customer — and every other one as
 * "not a valid code": whether a code exists, has been used up, has expired,
 * or belongs to somebody else is nobody's to learn by typing.
 *
 * The mapping is Adminium's, never the add-on's: an answer cannot make a
 * public door say more than this file lets it.
 */
import type { AdjustReason } from '@adminium/add-on-contracts';

import { AdjustRefusedError, ValidationFailedError } from '../../errors.js';

/** A code, or a reduction staff gave, the add-on refused. */
export interface RefusedCode {
  typed: string;
  reason: AdjustReason;
  params?: { amount?: string | undefined; max?: string | undefined; name?: string | undefined } | undefined;
}

/** The reasons a customer is told by name; every other one leaves as `unknown`. */
export const PUBLIC_ADJUST_REASONS: ReadonlySet<string> = new Set(['needs-minimum', 'not-for-these-items', 'needs-sign-in']);

/** The reason as a customer hears it. */
export const publicReason = (reason: string): string => (PUBLIC_ADJUST_REASONS.has(reason) ? reason : 'unknown');

const WORDS: Readonly<Record<string, string>> = {
  unknown: 'This is not a valid code.',
  'used-up': 'This code has been used up.',
  'needs-minimum': 'The order is under this code\'s minimum.',
  'not-for-these-items': 'This code is not for these items.',
  'needs-sign-in': 'This code needs a signed-in customer.',
  'needs-customer': 'This code needs a customer on the order.',
  'over-ceiling': 'This is more than you may take off.',
  expired: 'This code has expired.',
  inactive: 'This code is not active.',
  void: 'This code was voided.',
  'not-yet': 'This code cannot be used yet.',
  'over-limit': 'This customer has used this code as often as it allows.',
  frozen: 'This order\'s price stands: it cannot be changed any more.',
  'not-allowed': 'You may not change this reduction.',
  'refund-over': 'This is more than is left to give back.',
};

/** What a refusal of the price question says, in plain words (the door's own language is the dashboard's). */
export const adjustWords = (reason: string): string => WORDS[reason] ?? 'This could not be applied.';

/** Which codes row a refusal is about, beside the refusal and never in it: a write of many rows names the row with it. */
export interface RefusedAt {
  /** The table the code was typed into, and the row's key. */
  table: string;
  key: string;
}

export const refusedAt = (error: unknown): RefusedAt | undefined => (error as { adjustAt?: RefusedAt } | null | undefined)?.adjustAt;

/**
 * The refusal a save meets for a code, or a reduction, the add-on refused.
 * `column` is where it was typed (the reduction's own column, for what staff
 * gave). To staff and to the system: 409 `ADJUST_REFUSED` with the reason as
 * given. To a customer: the refusal of a value they typed, on that column,
 * with the reason they may hear — the shape every typed code's refusal has,
 * so a door names it, and counts it, as it does any other.
 */
export function refusalOf(origin: 'staff' | 'public' | 'system', entry: RefusedCode, column: string, at?: RefusedAt): Error {
  let error: Error;
  if (origin === 'public') {
    const code = publicReason(entry.reason);
    error = new ValidationFailedError('Some values were refused.', { fields: { [column]: { code, ...(code === 'needs-minimum' && entry.params?.amount !== undefined ? { amount: entry.params.amount } : {}) } } });
  } else {
    error = new AdjustRefusedError(adjustWords(entry.reason), {
      column,
      reason: entry.reason,
      ...(entry.params?.max === undefined ? {} : { max: entry.params.max }),
      ...(entry.params?.amount === undefined ? {} : { amount: entry.params.amount }),
      ...(entry.params?.name === undefined ? {} : { name: entry.params.name }),
    });
  }
  if (at !== undefined) Object.defineProperty(error, 'adjustAt', { value: at, enumerable: false });
  return error;
}
