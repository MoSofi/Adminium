// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A REFUND ON A LABEL: a request with a slow answer, and three ways it can end.
 *
 *  - The request is written BEFORE the carrier is called, and from then on the
 *    label must not be used. A process that dies there leaves a row that says so.
 *  - An unclear answer leaves it pending. The carrier's request repeats safely,
 *    so a check sends it again until the carrier has confirmed hearing it.
 *  - `refunded` frees the parcel's place. `refused` puts the label back in
 *    use, and is told to a person. Nothing but the carrier's word settles it.
 *
 * Every call to a carrier here comes from a person's press. A webhook can
 * settle a refund from what it says, and never calls back.
 */
import { cancelResultSchema, classifyBookFailure, type CancelResult } from '@adminium/add-on-contracts';
import { shippingBookingsRepo, shippingTrackingRepo, type ShippingAccount, type ShippingBooking, type ShippingVoidAnswer } from '@adminium/meta';

import { BOOK_ANSWER_MS, type BookingDeps } from './bookings.js';
import { cleanCarrierMessage, type ResolvedCarrier } from './carriers.js';
import { claimByOf, labelScanned } from './refund-view.js';
import { ShippingRefusal } from './refusals.js';

export type RefundDeps = Pick<BookingDeps, 'meta' | 'now' | 'enqueueApply' | 'log' | 'answerMs'>;

export type RefundOutcome = 'requested' | 'pending' | 'refunded' | 'refused' | 'no-answer' | 'other-account' | 'cannot-check' | 'not-open';

type Heard = { kind: 'answer'; result: CancelResult } | { kind: 'refused'; message: string } | { kind: 'unclear' };

/** Asks with a limit: a carrier that never answers leaves the refund pending, and never hangs a person's press. */
async function hear(deps: RefundDeps, resolved: ResolvedCarrier, ask: () => Promise<unknown>): Promise<Heard> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const answer = await Promise.race([
      ask(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('no answer')), deps.answerMs ?? BOOK_ANSWER_MS);
        timer.unref();
      }),
    ]);
    const parsed = cancelResultSchema.safeParse(answer);
    return parsed.success ? { kind: 'answer', result: parsed.data as CancelResult } : { kind: 'unclear' };
  } catch (error) {
    const failure = classifyBookFailure(error);
    if (failure.outcome !== 'refused') return { kind: 'unclear' };
    return { kind: 'refused', message: cleanCarrierMessage(failure.carrierMessage ?? '', resolved.scrub) };
  } finally {
    clearTimeout(timer);
  }
}

/** A refund's request, by the carrier's better method when it has one. A plain `cancel` that returns has done it. */
function sender(resolved: ResolvedCarrier, shipmentId: string): (() => Promise<unknown>) | null {
  const { carrier } = resolved;
  if (typeof carrier.requestCancel === 'function') return () => carrier.requestCancel!(shipmentId);
  if (typeof carrier.cancel === 'function') {
    return async () => {
      await carrier.cancel(shipmentId);
      return { state: 'refunded' } satisfies CancelResult;
    };
  }
  return null;
}

/** Writes down a final answer, or the carrier's "not yet". Answers what the booking now is. */
export async function settleRefund(deps: RefundDeps, id: string, state: CancelResult['state'], answer: ShippingVoidAnswer): Promise<ShippingBooking> {
  const repo = shippingBookingsRepo(deps.meta);
  const now = deps.now();
  if (state === 'refunded') {
    if (await repo.settleVoided(id, answer, now)) {
      try {
        // Takes the dead number off the order. `pickUpApplies` finds it again if the queue is down.
        await deps.enqueueApply(id);
      } catch {
        deps.log?.('a refunded label could not be queued for its next steps', { booking: id });
      }
    }
  } else if (state === 'refused') {
    const { holder } = await repo.settleVoidRefused(id, answer, now);
    if (holder !== null) {
      await repo.addDuplicate(holder.id, ['booked', 'calling', 'unknown'], now);
      deps.log?.('a refused refund left two paid labels on one parcel', { booking: id, holder: holder.id });
    }
  } else {
    await repo.voidHeard(id, state, answer, now);
  }
  return (await repo.byId(id))!;
}

const answerOf = (result: CancelResult, resolved: ResolvedCarrier): ShippingVoidAnswer => ({
  reference: result.reference,
  amount: result.amountDecimal,
  currency: result.currency?.toUpperCase(),
  message: result.carrierMessage === undefined ? undefined : cleanCarrierMessage(result.carrierMessage, resolved.scrub),
});

async function record(deps: RefundDeps, booking: ShippingBooking, heard: Heard, resolved: ResolvedCarrier): Promise<{ booking: ShippingBooking; outcome: RefundOutcome }> {
  if (heard.kind === 'unclear') {
    deps.log?.('a carrier gave no clear answer about a refund', { key: booking.carrierKey, booking: booking.id });
    return { booking: (await shippingBookingsRepo(deps.meta).byId(booking.id))!, outcome: 'no-answer' };
  }
  if (heard.kind === 'refused') {
    return { booking: await settleRefund(deps, booking.id, 'refused', heard.message === '' ? {} : { message: heard.message }), outcome: 'refused' };
  }
  return { booking: await settleRefund(deps, booking.id, heard.result.state, answerOf(heard.result, resolved)), outcome: heard.result.state };
}

/** A person asks for this label's money back. A second press reports the first one's state and asks nothing. */
export async function requestRefund(
  deps: RefundDeps,
  booking: ShippingBooking,
  resolved: ResolvedCarrier,
  account: Pick<ShippingAccount, 'fingerprint'>,
  by: string,
): Promise<{ booking: ShippingBooking; outcome: RefundOutcome }> {
  const repo = shippingBookingsRepo(deps.meta);
  if (booking.state === 'voiding') return { booking, outcome: booking.voidState === 'pending' ? 'pending' : 'requested' };
  if (booking.state === 'voided') return { booking, outcome: 'refunded' };
  if (booking.state !== 'booked') throw new ShippingRefusal('REFUND_NOT_OPEN', 'This booking has no label to refund.', { state: booking.state });
  if (booking.accountFingerprint !== account.fingerprint) throw new ShippingRefusal('REFUND_OTHER_ACCOUNT', 'This label was bought on another carrier account, so this key cannot refund it.', { booking: booking.id });
  const shipmentId = booking.carrierShipmentId;
  const send = shipmentId === null ? null : sender(resolved, shipmentId);
  if (send === null) throw new ShippingRefusal('REFUND_NOT_OFFERED', 'This carrier does not take refund requests through Adminium.', { carrier: booking.carrierKey });
  const claimBy = claimByOf(booking);
  if (deps.now() > claimBy) throw new ShippingRefusal('REFUND_TOO_LATE', 'The 30 days to claim have passed.', { claimBy });
  const parcel = await shippingTrackingRepo(deps.meta).parcel(booking.id);
  if (labelScanned(booking, parcel)) throw new ShippingRefusal('LABEL_SCANNED', 'The carrier has scanned this label, so a refund would be refused.', { booking: booking.id });

  if (!(await repo.askVoid(booking.id, by, deps.now()))) {
    const current = (await repo.byId(booking.id))!;
    if (current.state === 'voiding') return { booking: current, outcome: 'requested' };
    if (current.state === 'voided') return { booking: current, outcome: 'refunded' };
    throw new ShippingRefusal('REFUND_NOT_OPEN', 'This booking has no label to refund.', { state: current.state });
  }
  const asked = (await repo.byId(booking.id))!;
  const heard = await hear(deps, resolved, send);
  const written = await record(deps, asked, heard, resolved);
  // Asked and not confirmed: the label stays blocked and reads as requested.
  return heard.kind === 'unclear' ? { booking: written.booking, outcome: 'requested' } : written;
}

/** A person, or "Refresh open parcels", asks where a pending refund stands. */
export async function checkRefund(
  deps: RefundDeps,
  booking: ShippingBooking,
  resolved: ResolvedCarrier,
  account: Pick<ShippingAccount, 'fingerprint'>,
): Promise<{ booking: ShippingBooking; outcome: RefundOutcome }> {
  const current = (await shippingBookingsRepo(deps.meta).byId(booking.id)) ?? booking;
  if (current.state !== 'voiding' || current.carrierShipmentId === null) return { booking: current, outcome: 'not-open' };
  // Another account would truthfully know nothing about this refund.
  if (current.accountFingerprint !== account.fingerprint) return { booking: current, outcome: 'other-account' };
  const shipmentId = current.carrierShipmentId;
  // Never confirmed as heard: it may never have arrived, and sending it again is safe.
  const ask = current.voidHeardAt === null ? sender(resolved, shipmentId) : typeof resolved.carrier.cancelStatus === 'function' ? () => resolved.carrier.cancelStatus!(shipmentId) : null;
  if (ask === null) return { booking: current, outcome: 'cannot-check' };
  return record(deps, current, await hear(deps, resolved, ask), resolved);
}
