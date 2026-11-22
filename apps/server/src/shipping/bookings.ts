// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUYING A LABEL: once, from a person's request, and never by a job.
 *
 * A carrier's purchase is not idempotent: the same rate bought twice is two
 * paid labels. So the attempt is written first, moves to `calling` by one
 * guarded update right before the call, and anything that is not a clear
 * answer leaves it `unknown`, which holds the order's place:
 *
 *  - only an explicit refusal frees the order;
 *  - a timeout, a crash, a bad answer or an unclear error is `unknown`;
 *  - a `calling` row older than the longest wait reads as `unknown`, so a dead
 *    process needs no job to say so;
 *  - a look-up settles `unknown` only on a clear match. An empty answer proves
 *    nothing, and only someone who manages shipping may then release the
 *    order, after a quiet period, with an audit row;
 *  - before buying again after a release, every earlier rate of that parcel is
 *    looked up, so a purchase that turned up late takes its place back.
 *
 * Every carrier call here comes from a person's request.
 */
import {
  classifyBookFailure,
  recoveryResultSchema,
  shipmentSchema,
  type BookingDetails,
  type CarrierRefusal,
  type OrderRef,
  type Rate,
  type Shipment,
} from '@adminium/add-on-contracts';
import {
  SHIPPING_CARRIER_TEXT_WIDTH,
  SHIPPING_MONEY_WIDTH,
  appTablesRepo,
  realTableOf,
  shippingBookingsRepo,
  shippingRepo,
  shippingTrackingRepo,
  type MetaDb,
  type ShippingAccount,
  type ShippingBooking,
  type ShippingBookingFields,
  type ShippingBookingState,
  type ShippingSlot,
} from '@adminium/meta';

import type { PayableSources } from '../payments/payables.js';
import { CARRIER_HTTP_TIMEOUT_MS, cleanCarrierMessage, type ResolvedCarrier } from './carriers.js';
import { labelView, type LabelView } from './labels.js';
import { decimalAtMost } from './limits.js';
import { openRateHandle, sealRateHandle } from './quotes.js';
import { ShippingRefusal } from './refusals.js';
import { safeTrackingUrl } from './tracking-readers.js';

/** The longest a purchase waits for its answer. Past it, a `calling` row reads as unknown. */
export const BOOK_ANSWER_MS = 2 * CARRIER_HTTP_TIMEOUT_MS;
/** A `reserved` row this old was left by a process that died before calling: no call was made. */
export const RESERVED_STALE_MS = 60_000;
/** How long an unknown purchase must rest before a person may declare that no label exists. */
export const RELEASE_QUIET_MS = 15 * 60_000;

/** A label that turned up after another purchase took its place: both are paid. */
export const LATE_LABEL_REASON = 'late-label';

/** The hold on an order that shows a label nobody recorded here. */
export const FOREIGN_LABEL_REASON = 'label-on-order';

/** Crash injection for tests: each is called at the step it names, and a throw is the process dying there. */
export interface BookingFaults {
  beforeCall?: () => Promise<void> | void;
  afterCarrierAnswered?: () => Promise<void> | void;
  afterBooked?: () => Promise<void> | void;
}

export interface BookingDeps {
  meta: MetaDb;
  secret: string;
  now: () => number;
  /** Queues the repeatable steps after a purchase. */
  enqueueApply: (bookingId: string) => Promise<unknown>;
  log?: (message: string, fields: Record<string, unknown>) => void;
  answerMs?: number;
  faults?: BookingFaults;
}

export interface PurchaseInput {
  slot: ShippingSlot & { tableName: string };
  reference: string;
  resolved: ResolvedCarrier;
  account: Pick<ShippingAccount, 'mode' | 'fingerprint'>;
  quoteId: string;
  detailsHash: string;
  rate: Rate;
  details: BookingDetails;
  by: string;
  /** Set for someone bound by the daily limit. */
  counted: { day: string; dailyLabels: number } | null;
  /** Someone who manages shipping saw that an earlier attempt cannot be looked up, and means to buy anyway. */
  confirmEarlier?: boolean;
}

export interface BookingRefusal {
  code: string;
  reason: CarrierRefusal | null;
  carrierMessage: string;
}

/** The state a booking is really in: a `calling` row nobody is still waiting for is unknown. */
export function readsAs(booking: Pick<ShippingBooking, 'state' | 'calledAt' | 'updatedAt'>, now: number, answerMs: number = BOOK_ANSWER_MS): ShippingBookingState {
  if (booking.state === 'calling' && (booking.calledAt ?? booking.updatedAt) <= now - answerMs) return 'unknown';
  return booking.state;
}

/** When a person may declare that no label exists. */
export const releaseAfterOf = (booking: Pick<ShippingBooking, 'calledAt' | 'createdAt'>): number => (booking.calledAt ?? booking.createdAt) + RELEASE_QUIET_MS;

/** A label that must never reach an order or a customer. */
export const isTestBooking = (booking: Pick<ShippingBooking, 'mode'>): boolean => booking.mode === 'test';

export interface BookingView {
  id: string;
  state: ShippingBookingState;
  test: boolean;
  purpose: string;
  parcelNumber: number;
  carrier: string;
  service: string;
  tracking: string | null;
  carrierName: string | null;
  reason: string | null;
  duplicates: number;
  createdAt: number;
  calledAt: number | null;
  checkedAt: number | null;
  releaseAfter: number | null;
  applied: boolean;
  /** How its label file stands. Never where the file is. */
  label: LabelView;
  amount?: string;
  currency?: string;
  chargeDiffers?: boolean;
}

/** A booking as a screen is told it: no carrier handle, and no money for someone who cannot see it. */
export function bookingView(booking: ShippingBooking, now: number, pricesHidden: boolean): BookingView {
  const state = readsAs(booking, now);
  const amount = booking.amount ?? booking.quotedAmount;
  const currency = booking.currency ?? booking.quotedCurrency;
  return {
    id: booking.id,
    state,
    test: isTestBooking(booking),
    purpose: booking.purpose,
    parcelNumber: booking.parcelNumber,
    carrier: booking.carrierKey,
    service: booking.service,
    tracking: booking.tracking,
    carrierName: booking.carrierName,
    reason: booking.reason,
    duplicates: booking.duplicates,
    createdAt: booking.createdAt,
    calledAt: booking.calledAt,
    checkedAt: booking.checkedAt,
    releaseAfter: state === 'unknown' ? releaseAfterOf(booking) : null,
    applied: booking.appliedAt !== null,
    label: labelView(booking),
    ...(pricesHidden ? {} : { amount, currency, chargeDiffers: booking.chargeDiffers }),
  };
}

async function giveBackCount(deps: BookingDeps, id: string): Promise<void> {
  const repo = shippingBookingsRepo(deps.meta);
  const fresh = await repo.byId(id);
  // One run gives it back, however many reach this.
  if (fresh?.countedDay != null && (await repo.uncount(id, deps.now()))) await shippingRepo(deps.meta).releaseDayLabel(fresh.installId, fresh.countedDay);
}

/** A label given back that turned out to be paid: it counts again, whatever the limit, because it was bought. */
async function takeCountBack(deps: BookingDeps, id: string): Promise<void> {
  const repo = shippingBookingsRepo(deps.meta);
  const fresh = await repo.byId(id);
  if (fresh?.countedDay != null && (await repo.recount(id, deps.now()))) await shippingRepo(deps.meta).addDayLabel(fresh.installId, fresh.countedDay);
}

/** What a booking left by a dead process really is, written down. */
export async function settleStale(deps: BookingDeps, booking: ShippingBooking): Promise<ShippingBooking> {
  const repo = shippingBookingsRepo(deps.meta);
  const now = deps.now();
  if (booking.state === 'calling' && readsAs(booking, now, deps.answerMs ?? BOOK_ANSWER_MS) === 'unknown') {
    await repo.move(booking.id, ['calling'], 'unknown', { reason: 'no-answer' }, now);
    return (await repo.byId(booking.id))!;
  }
  if (booking.state === 'reserved' && booking.createdAt <= now - RESERVED_STALE_MS) {
    // No call was made: the move to `calling` comes before it, and this move stops a process that wakes up late.
    if (await repo.move(booking.id, ['reserved'], 'released', { reason: 'never-called' }, now)) await giveBackCount(deps, booking.id);
    return (await repo.byId(booking.id))!;
  }
  return booking;
}

function charged(rate: Rate): { amount: string | null; currency: string } {
  const amount = rate.amountDecimal ?? String(rate.amount);
  return { amount: /^\d+(\.\d+)?$/.test(amount) && amount.length <= SHIPPING_MONEY_WIDTH ? amount : null, currency: rate.currency.toUpperCase() };
}

/** The fields of a bought label, or null when they cannot be kept as they are. */
function fieldsOf(booking: ShippingBooking, shipment: Shipment, at: number): ShippingBookingFields | null {
  const fits = (value: string | undefined) => value === undefined || value.length <= SHIPPING_CARRIER_TEXT_WIDTH;
  if (!fits(shipment.id) || !fits(shipment.tracking) || !fits(shipment.carrier) || !fits(shipment.carrierToken)) return null;
  const { amount, currency } = charged(shipment.rate);
  const same = amount !== null && currency === booking.quotedCurrency && decimalAtMost(amount, booking.quotedAmount) && decimalAtMost(booking.quotedAmount, amount);
  return {
    carrierShipmentId: shipment.id,
    tracking: shipment.tracking,
    // `label_ref` is the file stored here (`labels.ts`). The carrier's own id for it may be a signed address, so it is not kept.
    carrierName: shipment.carrier ?? null,
    carrierToken: shipment.carrierToken ?? null,
    trackingUrl: safeTrackingUrl(shipment.trackingUrl),
    amount,
    currency: currency.length === 3 ? currency : null,
    chargeDiffers: !same,
    answeredAt: at,
    reason: null,
  };
}

type Heard = { kind: 'answer'; value: unknown } | { kind: 'threw'; error: unknown };

/**
 * A label the carrier says was bought. This is the truth whatever the row says
 * by now: a look-up may have read "not bought" and a person may have released
 * it. If its place is still free it takes it back. If another purchase holds
 * it, both are paid: the row keeps the label, and the holder is flagged for a
 * person to refund one.
 */
export async function recordBought(deps: BookingDeps, booking: ShippingBooking, fields: ShippingBookingFields, duplicates: number): Promise<ShippingBooking> {
  const repo = shippingBookingsRepo(deps.meta);
  const now = deps.now();
  // First, and only ever upwards: a count already recorded is a paid label someone still has to refund.
  await repo.raiseDuplicates(booking.id, duplicates, now);
  if (await repo.move(booking.id, ['calling', 'unknown'], 'booked', fields, now)) {
    await deps.faults?.afterBooked?.();
    await queueApply(deps, booking.id);
    return (await repo.byId(booking.id))!;
  }
  const current = (await repo.byId(booking.id))!;
  if (current.state !== 'refused' && current.state !== 'released') return current;
  if (await repo.reopenAsBooked(current.id, current, current.mode, fields, now)) {
    await takeCountBack(deps, current.id);
    await queueApply(deps, current.id);
    return (await repo.byId(current.id))!;
  }
  await repo.note(current.id, ['refused', 'released'], { ...fields, reason: LATE_LABEL_REASON }, now);
  await takeCountBack(deps, current.id);
  const holder = await repo.open(current, current.mode);
  if (holder !== null) await repo.addDuplicate(holder.id, ['booked', 'calling', 'unknown'], now);
  deps.log?.('a second paid label turned up for one parcel', { key: current.carrierKey, booking: current.id });
  return (await repo.byId(current.id))!;
}

/** Writes down what the carrier said. Anything but a clear yes or a clear no is unknown. */
async function recordAnswer(deps: BookingDeps, booking: ShippingBooking, heard: Heard, resolved: ResolvedCarrier): Promise<{ booking: ShippingBooking; refusal: BookingRefusal | null }> {
  const repo = shippingBookingsRepo(deps.meta);
  const now = deps.now();
  const reread = async () => (await repo.byId(booking.id))!;
  const unknown = async (reason: string) => {
    await repo.move(booking.id, ['calling'], 'unknown', { reason, answeredAt: now }, now);
    return { booking: await reread(), refusal: null };
  };

  if (heard.kind === 'threw') {
    const failure = classifyBookFailure(heard.error);
    if (failure.outcome !== 'refused') {
      deps.log?.('a carrier gave no clear answer to a purchase', { key: booking.carrierKey, booking: booking.id });
      return unknown('carrier-unclear');
    }
    const moved = await repo.move(booking.id, ['calling', 'unknown'], 'refused', { reason: failure.reason ?? 'refused', answeredAt: now }, now);
    if (moved) await giveBackCount(deps, booking.id);
    return {
      booking: await reread(),
      refusal: { code: cleanCarrierMessage(failure.code, resolved.scrub).slice(0, 80), reason: failure.reason ?? null, carrierMessage: cleanCarrierMessage(failure.carrierMessage ?? '', resolved.scrub) },
    };
  }

  const parsed = shipmentSchema.safeParse(heard.value);
  const fields = parsed.success ? fieldsOf(booking, parsed.data as Shipment, now) : null;
  if (fields === null) {
    deps.log?.('a carrier answered a purchase outside its contract', { key: booking.carrierKey, booking: booking.id });
    return unknown('bad-answer');
  }
  // A sample label on a key that says live: neither a real label nor a clear no, so a person looks at it.
  if (parsed.success && parsed.data.test === true && booking.mode === 'live') return unknown('test-on-live');
  return { booking: await recordBought(deps, booking, fields, 0), refusal: null };
}

/** A queue that is down costs nothing: the pickup finds a bought label with its steps not done. */
async function queueApply(deps: BookingDeps, id: string): Promise<void> {
  try {
    await deps.enqueueApply(id);
  } catch {
    deps.log?.('a bought label could not be queued for its next steps', { booking: id });
  }
}

/** Refused while something holds this parcel's place. */
function exists(booking: ShippingBooking, now: number, pricesHidden: boolean): ShippingRefusal {
  return new ShippingRefusal('BOOKING_EXISTS', 'This parcel already has a booking.', { booking: bookingView(booking, now, pricesHidden) });
}

/** Whether a look-up's answer is about the rates it was asked about. With no handle to compare, only a number already known can say so. */
function matchesHandle(shipment: Shipment, refs: readonly string[], tracking: string | null = null): boolean {
  if (refs.length > 0) return shipment.rate.ref !== undefined && refs.includes(shipment.rate.ref);
  return tracking === null || shipment.tracking === tracking;
}

const orderRefOf = (booking: Pick<ShippingBooking, 'reference' | 'purpose' | 'parcelNumber'>, rateRefs: string[]): OrderRef => ({
  reference: booking.reference,
  purpose: booking.purpose as NonNullable<OrderRef['purpose']>,
  parcel: booking.parcelNumber,
  ...(rateRefs.length === 0 ? {} : { rateRefs }),
});

/**
 * Before buying again after a release: did any earlier attempt on this parcel
 * go through after all? Answers the attempt that takes the place back. An
 * earlier attempt nobody can ask about (another account, a handle this server
 * cannot open, a carrier with no look-up) stops the purchase, unless someone
 * who manages shipping saw that and means to go on.
 */
async function lateLabel(deps: BookingDeps, reserved: ShippingBooking, resolved: ResolvedCarrier, confirmEarlier: boolean): Promise<ShippingBooking | null> {
  const repo = shippingBookingsRepo(deps.meta);
  const earlier = (await repo.forRow(reserved.connectionId, reserved.tableName, reserved.rowKey)).filter(
    (one) => one.id !== reserved.id && one.state === 'released' && one.calledAt !== null && one.purpose === reserved.purpose && one.parcelNumber === reserved.parcelNumber && one.mode === reserved.mode,
  );
  if (earlier.length === 0) return null;
  const recover = resolved.carrier.recover;
  const askable = earlier.flatMap((one) => {
    if (typeof recover !== 'function' || one.accountFingerprint !== reserved.accountFingerprint) return [];
    if (one.handleSealed === null) return [{ one, ref: null }];
    const opened = openRateHandle(deps.secret, one.handleSealed);
    return opened === null ? [] : [{ one, ref: opened.ref ?? null }];
  });
  if (askable.length < earlier.length && !confirmEarlier) {
    throw new ShippingRefusal('REBUY_UNCHECKED', 'An earlier attempt on this parcel cannot be looked up, so buying again could pay twice. Someone who manages shipping must confirm it.', { count: earlier.length - askable.length });
  }
  if (askable.length === 0 || typeof recover !== 'function') return null;
  const refs = askable.flatMap((entry) => (entry.ref === null ? [] : [entry.ref]));
  let parsed;
  try {
    parsed = recoveryResultSchema.safeParse(await recover.call(resolved.carrier, orderRefOf(reserved, refs)));
  } catch {
    throw new ShippingRefusal('CARRIER_UNAVAILABLE', 'The carrier could not say whether an earlier label went through, so nothing was bought.', { carrier: reserved.carrierKey });
  }
  if (!parsed.success) throw new ShippingRefusal('CARRIER_BAD_ANSWER', 'The carrier answered in a way Adminium does not understand.', { carrier: reserved.carrierKey });
  if (parsed.data.outcome !== 'found') return null;
  const shipment = parsed.data.shipment as Shipment;
  // With no handle to compare, a label cannot be pinned on this parcel, and nothing is bought over it.
  if (refs.length === 0 || !matchesHandle(shipment, refs) || (shipment.test === true) !== (reserved.mode === 'test')) {
    throw new ShippingRefusal('CARRIER_BAD_ANSWER', 'The carrier found a label that cannot be matched to this parcel, so nothing was bought.', { carrier: reserved.carrierKey });
  }
  const owner = askable.find((entry) => entry.ref === shipment.rate.ref)?.one;
  if (owner === undefined) throw new ShippingRefusal('CARRIER_BAD_ANSWER', 'The carrier found a label that cannot be matched to this parcel, so nothing was bought.', { carrier: reserved.carrierKey });
  const fields = fieldsOf(owner, shipment, deps.now());
  if (fields === null) throw new ShippingRefusal('CARRIER_BAD_ANSWER', 'The carrier answered in a way Adminium does not understand.', { carrier: reserved.carrierKey });
  await repo.raiseDuplicates(owner.id, parsed.data.duplicates?.length ?? 0, deps.now());
  if (!(await repo.takeBackSlot(reserved.id, owner.id, owner, owner.mode, fields, 'label-found', deps.now()))) {
    throw new ShippingRefusal('BOOKING_EXISTS', 'This parcel already has a booking.', {});
  }
  await giveBackCount(deps, reserved.id);
  await takeCountBack(deps, owner.id);
  await queueApply(deps, owner.id);
  return repo.byId(owner.id);
}

/**
 * The one purchase. Answers the booking, `booked` or `unknown`. A clear refusal
 * and anything that stopped it before the call are thrown as refusals.
 */
export async function buyLabel(deps: BookingDeps, input: PurchaseInput, pricesHidden: boolean): Promise<ShippingBooking> {
  const repo = shippingBookingsRepo(deps.meta);
  const { slot, resolved, account, rate } = input;
  const now = deps.now();

  const holder = await repo.open(slot, account.mode);
  if (holder !== null) {
    const settled = await settleStale(deps, holder);
    if (settled.openKey !== null) throw exists(settled, deps.now(), pricesHidden);
  }

  const handle = rate.ref === undefined && rate.carrierToken === undefined ? null : sealRateHandle(deps.secret, { ...(rate.ref === undefined ? {} : { ref: rate.ref }), ...(rate.carrierToken === undefined ? {} : { carrierToken: rate.carrierToken }) });
  const made = await repo.reserve(
    {
      ...slot,
      carrierInstallId: resolved.install.row.id,
      carrierKey: resolved.key,
      reference: input.reference,
      mode: account.mode,
      accountFingerprint: account.fingerprint,
      detailsHash: input.detailsHash,
      service: rate.service,
      rateCode: rate.code,
      handleSealed: handle,
      quotedAmount: rate.amountDecimal ?? String(rate.amount),
      quotedCurrency: rate.currency.toUpperCase(),
      createdBy: input.by,
      labelSize: input.details.labelSize ?? null,
    },
    now,
  );
  if (!made.ok) {
    if (made.holder !== null) throw exists(made.holder, deps.now(), pricesHidden);
    throw new ShippingRefusal('BOOKING_EXISTS', 'This parcel already has a booking.', {});
  }
  let booking = made.booking;

  const giveUp = async (reason: string) => {
    await repo.move(booking.id, ['reserved'], 'released', { reason }, deps.now());
    await giveBackCount(deps, booking.id);
  };

  if (input.counted !== null) {
    if (!(await shippingRepo(deps.meta).reserveDayLabel(slot.installId, input.counted.day, input.counted.dailyLabels))) {
      await giveUp('daily-limit');
      throw new ShippingRefusal('OWNER_BOOKS', 'The owner books this one.', { reason: 'daily-limit' });
    }
    await repo.markCounted(booking.id, input.counted.day, deps.now());
    booking = (await repo.byId(booking.id))!;
  }

  let found: ShippingBooking | null;
  try {
    found = await lateLabel(deps, booking, resolved, input.confirmEarlier === true);
  } catch (error) {
    await giveUp('look-up-failed');
    throw error;
  }
  if (found !== null) {
    throw new ShippingRefusal('ALREADY_BOUGHT', 'An earlier label for this parcel went through, so nothing was bought.', { booking: bookingView(found, deps.now(), pricesHidden) });
  }

  await deps.faults?.beforeCall?.();
  if (!(await repo.move(booking.id, ['reserved'], 'calling', { calledAt: deps.now() }, deps.now()))) {
    throw new ShippingRefusal('BOOKING_EXISTS', 'This parcel already has a booking.', {});
  }
  // A rate is bought from once: the quote goes before the call, so nothing can replay it.
  await shippingRepo(deps.meta).deleteQuote(input.quoteId);
  booking = (await repo.byId(booking.id))!;

  const order = orderRefOf(booking, []);
  const heard: Promise<Heard> = (async () => {
    try {
      return { kind: 'answer', value: await resolved.carrier.book(rate, order, input.details) } as const;
    } catch (error) {
      return { kind: 'threw', error } as const;
    }
  })();
  let timer: NodeJS.Timeout | undefined;
  const first = await Promise.race([
    heard,
    new Promise<'late'>((resolve) => {
      timer = setTimeout(() => resolve('late'), deps.answerMs ?? BOOK_ANSWER_MS);
      timer.unref();
    }),
  ]);
  clearTimeout(timer);

  if (first === 'late') {
    await repo.move(booking.id, ['calling'], 'unknown', { reason: 'no-answer' }, deps.now());
    const waiting = booking;
    // Whatever arrives afterwards is still the truth about this purchase.
    void heard
      .then((late) => recordAnswer(deps, waiting, late, resolved))
      .catch(() => deps.log?.('a late answer to a purchase could not be written down', { booking: waiting.id }));
    return (await repo.byId(booking.id))!;
  }

  await deps.faults?.afterCarrierAnswered?.();
  const answered = await recordAnswer(deps, booking, first, resolved);
  if (answered.refusal !== null) {
    throw new ShippingRefusal('CARRIER_REFUSED', 'The carrier refused this label. Nothing was charged.', {
      carrier: booking.carrierKey,
      booking: bookingView(answered.booking, deps.now(), pricesHidden),
      carrierCode: answered.refusal.code,
      reason: answered.refusal.reason,
      carrierMessage: answered.refusal.carrierMessage,
    });
  }
  return answered.booking;
}

export type LookUpOutcome = 'found' | 'not-bought' | 'no-match' | 'no-answer' | 'cannot-check' | 'other-account' | 'other-rate';

/**
 * A person asks the carrier what became of an unknown purchase. Settled only
 * on a clear match. Everything else leaves it unknown and says why.
 */
export async function lookUpBooking(deps: BookingDeps, booking: ShippingBooking, resolved: ResolvedCarrier, account: Pick<ShippingAccount, 'fingerprint'>): Promise<{ booking: ShippingBooking; outcome: LookUpOutcome }> {
  const repo = shippingBookingsRepo(deps.meta);
  const settled = await settleStale(deps, booking);
  if (settled.state !== 'unknown') throw new ShippingRefusal('BOOKING_NOT_UNKNOWN', 'This booking is not waiting for an answer.', { state: readsAs(settled, deps.now()) });
  const said = async (outcome: LookUpOutcome) => {
    await repo.note(settled.id, ['unknown'], { checkedAt: deps.now() }, deps.now());
    return { booking: (await repo.byId(settled.id))!, outcome };
  };
  // Another account would truthfully find nothing, and that must never read as "not bought".
  if (settled.accountFingerprint !== account.fingerprint) return said('other-account');
  const recover = resolved.carrier.recover;
  if (typeof recover !== 'function') return said('cannot-check');
  const handle = settled.handleSealed === null ? null : openRateHandle(deps.secret, settled.handleSealed);
  // Sealed under another secret: nothing could tell this parcel's label from another's.
  if (settled.handleSealed !== null && handle === null) return said('cannot-check');
  const refs = handle?.ref === undefined ? [] : [handle.ref];
  let answer: unknown;
  try {
    answer = await recover.call(resolved.carrier, orderRefOf(settled, refs));
  } catch {
    return said('no-answer');
  }
  const parsed = recoveryResultSchema.safeParse(answer);
  if (!parsed.success) return said('no-answer');
  if (parsed.data.outcome === 'no-match') return said('no-match');
  const now = deps.now();
  if (parsed.data.outcome === 'not-bought') {
    if (await repo.move(settled.id, ['unknown'], 'refused', { reason: 'not-bought', checkedAt: now, answeredAt: now }, now)) await giveBackCount(deps, settled.id);
    return { booking: (await repo.byId(settled.id))!, outcome: 'not-bought' };
  }
  const shipment = parsed.data.shipment as Shipment;
  if (!matchesHandle(shipment, refs, settled.tracking)) return said('other-rate');
  // A sample label is not this live purchase, and a live label is not this test one.
  if ((shipment.test === true) !== (settled.mode === 'test')) return said('other-account');
  const fields = fieldsOf(settled, shipment, now);
  if (fields === null) return said('no-answer');
  return { booking: await recordBought(deps, settled, { ...fields, checkedAt: now }, parsed.data.duplicates?.length ?? 0), outcome: 'found' };
}

/** A person who manages shipping declares that no label exists. Only after the quiet period, and never on a clear purchase. */
export async function releaseBooking(deps: BookingDeps, booking: ShippingBooking, by: string): Promise<ShippingBooking> {
  const repo = shippingBookingsRepo(deps.meta);
  const settled = await settleStale(deps, booking);
  if (settled.state !== 'unknown') throw new ShippingRefusal('BOOKING_NOT_UNKNOWN', 'Only a booking with no known result can be released.', { state: readsAs(settled, deps.now()) });
  const now = deps.now();
  const after = releaseAfterOf(settled);
  if (now < after) throw new ShippingRefusal('RELEASE_TOO_SOON', 'The carrier may still be working on this purchase. Try again later.', { releaseAfter: after });
  if (!(await repo.move(settled.id, ['unknown'], 'released', { releasedBy: by, releasedAt: now }, now))) {
    throw new ShippingRefusal('BOOKING_NOT_UNKNOWN', 'This booking has just been settled.', {});
  }
  await giveBackCount(deps, settled.id);
  return (await repo.byId(settled.id))!;
}

/** The carrier's own table for its copies of bought labels, on this database, if it keeps one. */
export async function carrierCopyTable(meta: MetaDb, sources: Pick<PayableSources, 'table'>, connectionId: string, carrierKey: string) {
  const record = await appTablesRepo(meta).find(connectionId, carrierKey, 'shipments');
  if (record === null) return null;
  return sources.table(connectionId, realTableOf(record));
}

/** Statuses of a carrier's copy that mean no live label stands behind it. */
const DEAD_COPY = ['cancelled', 'refused'];

/**
 * The number of a label the shop's own database shows and the booking table
 * does not know, or null. A restored backup can be older than the shop's data,
 * and a person may have typed a number in. Either way, buying now could pay
 * twice. A number someone has already looked at and released stops counting.
 */
export async function foreignLabelOn(
  meta: MetaDb,
  sources: Pick<PayableSources, 'table'>,
  order: { connectionId: string; tableName: string; rowKey: string; reference: string; carrierKey: string; tracking: string | null },
): Promise<string | null> {
  const all = await shippingBookingsRepo(meta).forRow(order.connectionId, order.tableName, order.rowKey);
  const known = new Set(all.flatMap((one) => (one.tracking !== null && (one.state === 'booked' || (one.state === 'released' && one.reason === FOREIGN_LABEL_REASON)) ? [one.tracking] : [])));
  // A number a booked label used to have is still that label: the order keeps showing it until staff act on the new one.
  const parcels = await shippingTrackingRepo(meta).parcels(all.filter((one) => one.state === 'booked').map((one) => one.id));
  for (const parcel of parcels.values()) for (const number of parcel.oldNumbers) known.add(number);
  if (order.tracking !== null && !known.has(order.tracking)) return order.tracking;
  const copies = await carrierCopyTable(meta, sources, order.connectionId, order.carrierKey);
  if (copies === null || !copies.table.columns.has('order_reference') || !copies.table.columns.has('status')) return null;
  const { db } = copies.target;
  const rows = await db
    .selectFrom(copies.table.id)
    .selectAll()
    .where((eb) => eb(db.dynamic.ref('order_reference'), '=', order.reference))
    .where((eb) => eb(db.dynamic.ref('status'), 'not in', DEAD_COPY))
    .limit(50)
    .execute();
  const ids = new Set(all.map((one) => one.id));
  for (const row of rows as Record<string, unknown>[]) {
    const number = row['tracking'] === null || row['tracking'] === undefined ? '' : String(row['tracking']);
    if (!ids.has(String(row['id'])) && !known.has(number)) return number.slice(0, SHIPPING_CARRIER_TEXT_WIDTH);
  }
  return null;
}
