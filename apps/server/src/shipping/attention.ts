// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH LABELS NEED A PERSON, and why.
 *
 * A booking's reasons are worked out from what is stored: nothing here calls a
 * carrier or reads a key. The first reason is the one a screen leads with.
 *
 * A test booking counts only while its purchase has no answer, because a test
 * number can repeat and is never tracked: it has no tracking reasons at all.
 */
import { SHIPPING_TRACK_FINAL_RANK, type ShippingBooking, type ShippingParcel } from '@adminium/meta';

import { BOOK_ANSWER_MS, isTestBooking, readsAs } from './bookings.js';
import { labelStateOf } from './labels.js';
import { REFRESH_OPEN_WINDOW_MS } from './refresh.js';

/** After this long with no change, an open parcel is listed as quiet. */
export const QUIET_PARCEL_MS = 7 * 24 * 60 * 60_000;

/** How long a refused refund stays on the list. The label is live again, so it is news and not a standing fault. */
export const REFUND_REFUSED_LISTED_MS = 14 * 24 * 60 * 60_000;

/** The most bookings one reading of the list looks through. */
export const ATTENTION_SCAN = 500;

/** Most pressing first. */
export const ATTENTION_REASONS = ['unknown', 'duplicates', 'refund-refused', 'refund-pending', 'label-owed', 'new-number', 'tracking-failed', 'returned', 'ambiguous', 'quiet'] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];

/** The moments the stored rows are judged against, all from one clock reading. */
export const attentionCutoffs = (now: number): { calledBefore: number; openSince: number; quietBefore: number; refusedSince: number } => ({
  calledBefore: now - BOOK_ANSWER_MS,
  openSince: now - REFRESH_OPEN_WINDOW_MS,
  quietBefore: now - QUIET_PARCEL_MS,
  refusedSince: now - REFUND_REFUSED_LISTED_MS,
});

/** Open as "Refresh open parcels" means it, so this list and that count agree. */
function isQuiet(booking: ShippingBooking, parcel: ShippingParcel | null, now: number): boolean {
  if (booking.tracking === null || booking.createdAt < now - REFRESH_OPEN_WINDOW_MS) return false;
  if ((parcel?.statusRank ?? -1) >= SHIPPING_TRACK_FINAL_RANK) return false;
  return now - (parcel?.statusAt ?? booking.createdAt) >= QUIET_PARCEL_MS;
}

/** Why this booking needs a person, most pressing first. Empty when it does not. */
export function attentionReasons(booking: ShippingBooking, parcel: ShippingParcel | null, now: number): AttentionReason[] {
  const state = readsAs(booking, now);
  if (isTestBooking(booking)) return state === 'unknown' ? ['unknown'] : [];
  const held = new Set<AttentionReason>();
  if (state === 'unknown') held.add('unknown');
  if (booking.duplicates > 0) held.add('duplicates');
  if (state === 'voiding') held.add('refund-pending');
  if (state === 'booked' && booking.voidState === 'refused' && (booking.voidSettledAt ?? 0) >= now - REFUND_REFUSED_LISTED_MS) held.add('refund-refused');
  if (state === 'booked') {
    if (labelStateOf(booking) === 'owed') held.add('label-owed');
    if (parcel?.numberChangedAt != null) held.add('new-number');
    if (parcel?.status === 'FAILURE') held.add('tracking-failed');
    if (parcel?.status === 'RETURNED') held.add('returned');
    if (parcel?.flag === 'ambiguous') held.add('ambiguous');
    if (isQuiet(booking, parcel, now)) held.add('quiet');
  }
  return ATTENTION_REASONS.filter((reason) => held.has(reason));
}
