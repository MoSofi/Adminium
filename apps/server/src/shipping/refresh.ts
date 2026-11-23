// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PERSON ASKS WHERE A PARCEL IS.
 *
 * Every call here starts from someone pressing Refresh, which is what the
 * carrier's terms allow without question. "Refresh open parcels" is the
 * same press over a budget: a fixed batch, a time limit, a cool-down per
 * install, and a stop at the carrier's first "too many requests".
 *
 * A test booking is never asked about: its number can repeat, so the answer
 * could be about someone else's sample.
 */
import { trackEventSchema } from '@adminium/add-on-contracts';
import { SHIPPING_TRACK_FINAL_RANK, SHIPPING_TRACK_RANKS, shippingBookingsRepo, shippingTrackingRepo, type MetaDb, type ShippingBooking, type ShippingTrackStatus } from '@adminium/meta';
import { z } from 'zod';

import { isTestBooking } from './bookings.js';
import type { ResolvedCarrier } from './carriers.js';
import type { RefundOutcome } from './refunds.js';
import { FUTURE_SKEW_MS } from './tracking.js';
import { trackStatusOf } from './tracking-readers.js';

/** One parcel, at most this often, whoever presses. */
export const REFRESH_PARCEL_COOL_MS = 60_000;
export const REFRESH_OPEN_COOL_MS = 5 * 60_000;
/** Carrier calls in one "Refresh open parcels". The press says how many are left. */
export const REFRESH_OPEN_BATCH = 25;
/** A person is waiting on the reply. */
export const REFRESH_OPEN_BUDGET_MS = 20_000;
export const REFRESH_OPEN_WINDOW_MS = 90 * 24 * 60 * 60_000;
/** How many open parcels one press looks through for the ones this person reaches, a page at a time. */
export const REFRESH_OPEN_SCAN = 1000;
const REFRESH_OPEN_PAGE = 100;
const MAX_EVENTS = 500;

export interface RefreshDeps {
  meta: MetaDb;
  now: () => number;
  log?: (message: string, fields: Record<string, unknown>) => void;
}

export type CarrierTrackAnswer = { kind: 'events'; best: { status: ShippingTrackStatus; at: number } | null } | { kind: 'no-answer' } | { kind: 'rate-limited' };

/** A carrier's "too many requests", read by its shape, because each add-on bundle has its own `CarrierError`. */
export function saysTooMany(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const fields = error as Record<string, unknown>;
  return fields['name'] === 'CarrierError' && typeof fields['code'] === 'string' && /rate.?limit|too.?many|429/i.test(fields['code']);
}

/** Asks the carrier once, and reads the furthest-along latest scan out of the answer. */
export async function askCarrierForTrack(resolved: ResolvedCarrier, booking: ShippingBooking, now: number): Promise<CarrierTrackAnswer> {
  let answer: unknown;
  try {
    answer = await resolved.carrier.track(booking.tracking!, booking.carrierToken === null ? {} : { carrierToken: booking.carrierToken });
  } catch (error) {
    return saysTooMany(error) ? { kind: 'rate-limited' } : { kind: 'no-answer' };
  }
  const parsed = z.array(trackEventSchema).max(MAX_EVENTS).safeParse(answer);
  if (!parsed.success) return { kind: 'no-answer' };
  let best: { status: ShippingTrackStatus; at: number } | null = null;
  for (const event of parsed.data) {
    const at = Date.parse(event.at);
    if (Number.isNaN(at) || at > now + FUTURE_SKEW_MS) continue;
    const status = trackStatusOf(event.status);
    const rank = SHIPPING_TRACK_RANKS[status];
    const bestRank = best === null ? -1 : SHIPPING_TRACK_RANKS[best.status];
    // Any real status beats UNKNOWN whatever its date: a scan the carrier did not name must not hide a delivery.
    const realOverUnknown = rank > SHIPPING_TRACK_RANKS.UNKNOWN && bestRank === SHIPPING_TRACK_RANKS.UNKNOWN;
    const unknownOverReal = rank === SHIPPING_TRACK_RANKS.UNKNOWN && bestRank > SHIPPING_TRACK_RANKS.UNKNOWN;
    if (best === null || realOverUnknown || (!unknownOverReal && (at > best.at || (at === best.at && rank > bestRank)))) best = { status, at };
  }
  return { kind: 'events', best };
}

export type RefreshOutcome = 'updated' | 'unchanged' | 'no-events' | 'recent' | 'test' | 'not-open' | 'other-account' | 'no-answer' | 'rate-limited';

/** One parcel, for one person's press. Writes "last checked" only when the carrier really answered. */
export async function refreshParcel(deps: RefreshDeps, given: ShippingBooking, resolved: ResolvedCarrier, accountFingerprint: string): Promise<RefreshOutcome> {
  if (isTestBooking(given)) return 'test';
  if ((given.state !== 'booked' && given.state !== 'voiding') || given.tracking === null) return 'not-open';
  if (given.accountFingerprint !== accountFingerprint) return 'other-account';
  const repo = shippingTrackingRepo(deps.meta);
  const now = deps.now();
  await repo.ensureParcel(given.id, given.carrierInstallId, now);
  if (!(await repo.claimTry(given.id, now, REFRESH_PARCEL_COOL_MS))) return 'recent';
  // The parcel first, then the booking: a number that changes after this cannot have its old status written on it.
  const before = await repo.parcel(given.id);
  const booking = await shippingBookingsRepo(deps.meta).byId(given.id);
  if (before === null || booking === null || (booking.state !== 'booked' && booking.state !== 'voiding') || booking.tracking === null) return 'not-open';
  const answer = await askCarrierForTrack(resolved, booking, now);
  if (answer.kind === 'rate-limited') return 'rate-limited';
  if (answer.kind === 'no-answer') {
    deps.log?.('a carrier could not say where a parcel is', { key: booking.carrierKey, booking: booking.id });
    return 'no-answer';
  }
  await repo.markChecked(booking.id, deps.now());
  // A flag stays while the number really is shared: an answer about it settles nothing.
  if (before.flag === 'ambiguous' && (await repo.liveBookedByTracking(booking.carrierInstallId, booking.tracking)).length <= 1) await repo.clearFlag(booking.id, deps.now());
  if (answer.best === null) return 'no-events';
  return (await repo.applyStatus(booking.id, answer.best.status, answer.best.at, deps.now(), before.numberChangedAt)) ? 'updated' : 'unchanged';
}

export interface RefreshOpenResult {
  outcome: 'done' | 'recent' | 'rate-limited';
  checked: number;
  updated: number;
  failed: number;
  /** Open parcels this person reaches, among those looked at, that this press did not get to. */
  remaining: number;
  /** True when there may be more open parcels than this press looked through. */
  more: boolean;
  /** The OLDEST check among the open parcels looked at, so stale ones never look fresh. */
  oldestCheckedAt: number | null;
  neverChecked: number;
  retryAt: number | null;
}

/** "Refresh open parcels": as many of the longest-untried as the budget allows. */
export async function refreshOpenParcels(
  deps: RefreshDeps,
  input: { carrierInstallId: string; installId: string; connectionId: string; resolved: ResolvedCarrier; accountFingerprint: string; reaches: (booking: ShippingBooking) => Promise<boolean>; checkRefund?: (booking: ShippingBooking) => Promise<RefundOutcome> },
): Promise<RefreshOpenResult> {
  const repo = shippingTrackingRepo(deps.meta);
  const bookings = shippingBookingsRepo(deps.meta);
  const asked = deps.now();
  const idle = (outcome: 'done' | 'recent', retryAt: number | null, more: boolean): RefreshOpenResult => ({ outcome, checked: 0, updated: 0, failed: 0, remaining: 0, more, oldestCheckedAt: null, neverChecked: 0, retryAt });

  // Before any order is read: a press during the cool-down costs nothing.
  const held = await repo.install(input.carrierInstallId);
  if (held?.refreshedAt != null && held.refreshedAt > asked - REFRESH_OPEN_COOL_MS) return idle('recent', held.refreshedAt + REFRESH_OPEN_COOL_MS, true);

  const scope = { carrierInstallId: input.carrierInstallId, connectionId: input.connectionId, installId: input.installId };
  const reached: ShippingBooking[] = [];
  let scanned = 0;
  let more = false;
  // All of them, not only a batch's worth: "last checked" must be the oldest of what this person has open.
  while (scanned < REFRESH_OPEN_SCAN) {
    const page = await repo.openParcels(scope, asked - REFRESH_OPEN_WINDOW_MS, REFRESH_OPEN_PAGE, scanned);
    for (const one of page) {
      const booking = await bookings.byId(one.bookingId);
      if (booking !== null && (await input.reaches(booking))) reached.push(booking);
    }
    scanned += page.length;
    if (page.length < REFRESH_OPEN_PAGE) break;
    more = scanned >= REFRESH_OPEN_SCAN;
  }
  // Someone with nothing to refresh must not spend the install's cool-down.
  if (reached.length === 0) return idle('done', null, more);

  const started = deps.now();
  if (!(await repo.claimRefresh(input.carrierInstallId, started, REFRESH_OPEN_COOL_MS))) {
    const now = await repo.install(input.carrierInstallId);
    return idle('recent', (now?.refreshedAt ?? started) + REFRESH_OPEN_COOL_MS, true);
  }

  let checked = 0;
  let updated = 0;
  let failed = 0;
  let calls = 0;
  let outcome: RefreshOpenResult['outcome'] = 'done';
  const answered = new Set<string>();
  for (const booking of reached) {
    if (calls >= REFRESH_OPEN_BATCH || deps.now() - started >= REFRESH_OPEN_BUDGET_MS) break;
    const result = await refreshParcel(deps, booking, input.resolved, input.accountFingerprint);
    if (result === 'recent' || result === 'test' || result === 'not-open' || result === 'other-account') continue;
    calls += 1;
    if (result === 'rate-limited') {
      outcome = 'rate-limited';
      break;
    }
    // A pending refund is asked about too, or a private install hears its answer only by opening each order (S3-F19).
    let refundMoved = false;
    if (booking.state === 'voiding' && input.checkRefund !== undefined && calls < REFRESH_OPEN_BATCH) {
      calls += 1;
      const said = await input.checkRefund(booking);
      if (said === 'no-answer') failed += 1;
      refundMoved = said === 'refunded' || said === 'refused';
    }
    if (result === 'no-answer') {
      failed += 1;
      if (refundMoved) updated += 1;
      continue;
    }
    checked += 1;
    answered.add(booking.id);
    if (result === 'updated' || refundMoved) updated += 1;
  }
  const parcels = await repo.parcels(reached.map((one) => one.id));
  const stillOpen = reached.filter((one) => (parcels.get(one.id)?.statusRank ?? -1) < SHIPPING_TRACK_FINAL_RANK).map((one) => one.id);
  const times = stillOpen.map((id) => parcels.get(id)?.checkedAt ?? null);
  const known = times.filter((at): at is number => at !== null);
  return {
    outcome,
    checked,
    updated,
    failed,
    remaining: stillOpen.filter((id) => !answered.has(id)).length,
    more,
    oldestCheckedAt: known.length === 0 ? null : Math.min(...known),
    neverChecked: times.length - known.length,
    retryAt: started + REFRESH_OPEN_COOL_MS,
  };
}
