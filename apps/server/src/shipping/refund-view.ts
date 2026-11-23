// SPDX-License-Identifier: AGPL-3.0-only
/**
 * HOW A LABEL'S REFUND STANDS, worked out from what is stored. Nothing here
 * calls a carrier.
 *
 *  - The last day to claim is 30 days from the purchase, the shorter of the
 *    limits in Shippo's terms and docs, to the end of that day in UTC.
 *  - "Expected by" is 14 working days from the REQUEST. It is an expectation:
 *    a carrier can take longer, and no screen may promise it.
 *  - A label the carrier has scanned is not offered a refund: it would only be
 *    refused again.
 */
import type { ShippingBooking, ShippingParcel, ShippingVoidState } from '@adminium/meta';

export const REFUND_CLAIM_DAYS = 30;
export const REFUND_WORKING_DAYS = 14;
const DAY_MS = 24 * 60 * 60_000;

/** The tracking statuses that mean a carrier has had the parcel in its hands. */
const SCANNED: ReadonlySet<string> = new Set(['TRANSIT', 'FAILURE', 'RETURNED', 'DELIVERED']);

/** The end of the last UTC day a refund can be claimed on. */
export function claimByOf(booking: Pick<ShippingBooking, 'answeredAt' | 'createdAt'>): number {
  const bought = new Date(booking.answeredAt ?? booking.createdAt);
  return Date.UTC(bought.getUTCFullYear(), bought.getUTCMonth(), bought.getUTCDate() + REFUND_CLAIM_DAYS + 1) - 1;
}

/** Monday to Friday in UTC. Public holidays differ per carrier and are not guessed at. */
export function addWorkingDays(from: number, days: number): number {
  let at = from;
  for (let left = days; left > 0; ) {
    at += DAY_MS;
    const weekday = new Date(at).getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return at;
}

/** Whether the carrier has scanned this label, by its tracking or by what it said when it refused. */
export function labelScanned(booking: Pick<ShippingBooking, 'voidState' | 'voidMessage'>, parcel: Pick<ShippingParcel, 'status'> | null | undefined): boolean {
  if (parcel?.status != null && SCANNED.has(parcel.status)) return true;
  return booking.voidState === 'refused' && booking.voidMessage !== null && /\bscan/i.test(booking.voidMessage);
}

export interface RefundView {
  state: ShippingVoidState | null;
  askedAt: number | null;
  settledAt: number | null;
  /** The last time the carrier answered about it. */
  heardAt: number | null;
  /** Asked for, and the carrier has not confirmed it heard: the next check sends it again. */
  unconfirmed: boolean;
  expectedBy: number | null;
  claimBy: number;
  tooLate: boolean;
  scanned: boolean;
  /** Whether a request can be made now. The route asks the same questions again. */
  canRequest: boolean;
  /** The carrier's own words on a refusal. Never for someone who cannot see money. */
  message: string | null;
  /** Only what the carrier reported, never for a test label or someone who cannot see money. */
  amount?: string;
  currency?: string;
}

/** Null for an attempt that never became a label. */
export function refundView(booking: ShippingBooking, parcel: Pick<ShippingParcel, 'status'> | null | undefined, now: number, pricesHidden: boolean): RefundView | null {
  if (booking.state !== 'booked' && booking.state !== 'voiding' && booking.state !== 'voided') return null;
  const claimBy = claimByOf(booking);
  const tooLate = now > claimBy;
  const scanned = labelScanned(booking, parcel);
  const showMoney = !pricesHidden && booking.mode !== 'test' && booking.voidAmount !== null && booking.voidCurrency !== null;
  return {
    state: booking.voidState,
    askedAt: booking.voidAskedAt,
    settledAt: booking.voidSettledAt,
    heardAt: booking.voidHeardAt,
    unconfirmed: booking.state === 'voiding' && booking.voidHeardAt === null,
    expectedBy: booking.state === 'voiding' && booking.voidAskedAt !== null ? addWorkingDays(booking.voidAskedAt, REFUND_WORKING_DAYS) : null,
    claimBy,
    tooLate,
    scanned,
    canRequest: booking.state === 'booked' && booking.carrierShipmentId !== null && !tooLate && !scanned,
    message: pricesHidden ? null : booking.voidMessage,
    ...(showMoney ? { amount: booking.voidAmount!, currency: booking.voidCurrency! } : {}),
  };
}
