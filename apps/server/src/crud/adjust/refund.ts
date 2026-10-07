// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT A RETURN GIVES BACK — pure.
 *
 * A refund is never "the returned thing's share of the order". It is the
 * difference between what the order cost and what it would cost with the
 * returned things gone, priced again under the offers it had: one mug back
 * from a discounted order gives back what the order is now smaller by; one
 * tote of a two-for-one pair gives back nothing, because the pair is gone and
 * the tote kept is paid in full.
 *
 * Here that difference is shared out over the refund rows a save makes, in
 * the order they were made: each takes what is left, as far as the payment it
 * gives back to took and has not already given back; the tax goes with it in
 * proportion, rounded down, and the row that takes the rest takes the rest of
 * the tax. Nothing is read and nothing is written.
 */
import { ratioText, toRatio } from '@adminium/manifest';

type Ratio = NonNullable<ReturnType<typeof toRatio>>;
const ZERO: Ratio = { n: 0n, d: 1n };
const sub = (a: Ratio, b: Ratio): Ratio => ({ n: a.n * b.d - b.n * a.d, d: a.d * b.d });
const add = (a: Ratio, b: Ratio): Ratio => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
const less = (a: Ratio, b: Ratio): boolean => a.n * b.d < b.n * a.d;
const least = (a: Ratio, b: Ratio): Ratio => (less(a, b) ? a : b);
const none = (a: Ratio): boolean => a.n * a.d <= 0n;
/** Cut down to so many decimals: a share is never said as more than it is. */
const floor = (value: Ratio, places: number): Ratio => {
  const factor = 10n ** BigInt(places);
  return { n: (value.n * factor) / value.d, d: factor };
};

/** A refund row whose amount is still to be decided. */
export interface RefundAsked {
  key: string;
  /** The payment it gives back to, when it names one. */
  against: string | null;
  /** Whether it returns any line: a row that returns nothing and gets nothing is refused. */
  returns: boolean;
}

export interface RefundDecided {
  key: string;
  amount: string;
  tax: string;
}

export interface RefundShares {
  rows: RefundDecided[];
  /** The first row that returns nothing and would be given nothing, with the most it could have had. */
  over?: { key: string; max: string };
}

/**
 * Each asked row's amount and tax. `refundable` / `taxRefundable`: what the
 * order is smaller by, less what earlier refunds already gave back (never
 * less than nothing). `payments`: what each payment took and has given back
 * so far, by key; a row against a payment nobody listed is held to nothing
 * but what is left.
 */
export function refundShares(input: { refundable: Ratio; taxRefundable: Ratio; rows: readonly RefundAsked[]; payments: ReadonlyMap<string, { took: Ratio; givenBack: Ratio }>; places: number }): RefundShares {
  const { places } = input;
  let left = none(input.refundable) ? ZERO : floor(input.refundable, places);
  let taxLeft = none(input.taxRefundable) ? ZERO : floor(input.taxRefundable, places);
  const given = new Map<string, Ratio>();
  const rows: RefundDecided[] = [];
  let over: RefundShares['over'];
  for (const row of input.rows) {
    const payment = row.against === null ? undefined : input.payments.get(row.against);
    const room = payment === undefined ? null : sub(sub(payment.took, payment.givenBack), given.get(row.against!) ?? ZERO);
    const most = room === null ? left : least(left, none(room) ? ZERO : floor(room, places));
    const amount = none(most) ? ZERO : most;
    if (none(amount) && !row.returns) over ??= { key: row.key, max: ratioText(amount, places) };
    // The row that takes all that is left takes all the tax that is left; any other, its share of it, rounded down.
    const whole = !less(amount, left);
    const share = none(amount) ? ZERO : whole ? taxLeft : floor({ n: taxLeft.n * amount.n * left.d, d: taxLeft.d * amount.d * left.n }, places);
    // (The tax given back is part of what is given back: never more than it.)
    const tax = least(share, amount);
    rows.push({ key: row.key, amount: ratioText(amount, places), tax: ratioText(tax, places) });
    left = sub(left, amount);
    taxLeft = sub(taxLeft, tax);
    if (row.against !== null) given.set(row.against, add(given.get(row.against) ?? ZERO, amount));
  }
  return { rows, ...(over === undefined ? {} : { over }) };
}
