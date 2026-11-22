// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CARRIER'S WEBHOOK, and what Adminium does with what it says.
 *
 * ─── THE RECEIVER ONLY RECEIVES ─────────────────────────────────────────────
 *
 * Each carrier install has its own address, with 256 random bits in it that
 * are stored only as a keyed hash. A wrong token and an unknown install read
 * the same (404). The event is stored once and followed by a job, because
 * Shippo waits three seconds and retries only 408, 429 and 5xx: a store that
 * failed answers 503, so the event comes again.
 *
 * ─── AN EVENT IS A CLAIM ────────────────────────────────────────────────────
 *
 *  - It never causes a call back to the carrier (the carrier's terms, Q15).
 *  - It is matched inside this install only, and never on a test booking,
 *    because test tracking numbers repeat.
 *  - A status moves forward only (`applyStatus`), so a late or repeated event
 *    changes nothing.
 *  - It can settle an unknown purchase as bought, on a matching rate handle.
 *    It can **never** free a parcel's place: only a person's look-up or
 *    release does, or a forged event could cause a second paid label.
 *  - A number that matches two bookings moves neither, and flags both.
 *  - A new number is saved and raises an action for staff. Nothing here sends
 *    a mail, moves an order's status or touches money.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';

import { shippingBookingsRepo, shippingTrackingRepo, type ManifestsRepo, type MetaDb, type ShippingBooking, type ShippingParcel, type ShippingTrackEvent, type ShippingTrackStatus } from '@adminium/meta';
import { z } from 'zod';

import { deriveKey } from '../config/secrets.js';
import type { JobRegistry } from '../jobs/registry.js';
import { normalizePublicOrigin } from '../security/public-origin.js';
import { recordBought, type BookingDeps } from './bookings.js';
import { sameHash } from './fingerprint.js';
import { openRateHandle } from './quotes.js';
import { sameHostUrl, trackingReaderFor } from './tracking-readers.js';

export const SHIPPING_TRACK_JOB = 'shipping.track';
export const SHIPPING_TRACK_PICKUP_NAME = 'shipping.track.pickup';
export const SHIPPING_TRACK_PICKUP_CRON = '*/5 * * * *';
const TRACK_MAX_ATTEMPTS = 6;
const PICKUP_AFTER_MS = 2 * 60_000;
const PICKUP_BATCH = 500;
/** An event can outrun the write of the booking it is about, so one with no match is kept this long and tried again. */
export const UNMATCHED_KEEP_MS = 60 * 60_000;
const UNMATCHED_RETAIN_MS = 24 * 60 * 60_000;
const DONE_RETAIN_MS = 30 * 24 * 60 * 60_000;
/** A status dated further ahead than this is refused: it would otherwise block every real one after it. */
export const FUTURE_SKEW_MS = 24 * 60 * 60_000;
/** The most events one install may have waiting. Past it the carrier is told to come back. */
export const MAX_WAITING_EVENTS = 2000;
/** Shippo refuses a webhook address longer than this. */
export const WEBHOOK_ADDRESS_MAX = 200;

export type TrackDeps = Pick<BookingDeps, 'meta' | 'secret' | 'now' | 'enqueueApply' | 'log'>;
type Enqueue = (input: { kind: string; payload: Record<string, unknown>; dedupeKey: string; maxAttempts: number }) => Promise<unknown>;

// ── The token ───────────────────────────────────────────────────────────────

const tokenKeyOf = (secret: string) => deriveKey(secret, 'adminium:shipping-webhook:v1', 'token');

/** Keyed, and bound to the install: a hash copied to another install's row opens nothing. */
export function webhookTokenHash(secret: string, installId: string, token: string): string {
  return createHmac('sha256', tokenKeyOf(secret)).update(JSON.stringify([installId, token])).digest('hex');
}

/** A new token, with what is stored of it. The token itself is shown once and kept nowhere. */
export function newWebhookToken(secret: string, installId: string): { token: string; hash: string; hint: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: webhookTokenHash(secret, installId, token), hint: token.slice(-4) };
}

export const webhookPath = (installId: string): string => `/api/v1/shipping/webhook/${encodeURIComponent(installId)}`;

/** The full address, or null when this server has no public `https` address, or one too long for Shippo. */
export function webhookAddress(publicOrigin: unknown, installId: string, token: string): string | null {
  if (typeof publicOrigin !== 'string' || publicOrigin === '') return null;
  const origin = normalizePublicOrigin(publicOrigin);
  if (origin === null || !origin.startsWith('https://')) return null;
  const address = `${origin.replace(/\/$/, '')}${webhookPath(installId)}?token=${token}`;
  return address.length > WEBHOOK_ADDRESS_MAX ? null : address;
}

/** The same address with its token masked: what every later visit shows. */
export function maskedWebhookAddress(publicOrigin: unknown, installId: string, hint: string): string | null {
  if (typeof publicOrigin !== 'string' || publicOrigin === '') return null;
  const origin = normalizePublicOrigin(publicOrigin);
  return origin === null ? null : `${origin.replace(/\/$/, '')}${webhookPath(installId)}?token=••••${hint}`;
}

// ── Receiving ───────────────────────────────────────────────────────────────

export interface TrackingWebhookDeps {
  meta: MetaDb;
  manifests: Pick<ManifestsRepo, 'findById'>;
  secret: string;
  enqueue: Enqueue;
  now?: () => number;
}

export type TrackingWebhookOutcome = { status: 200 } | { status: 400 } | { status: 404 } | { status: 503 };

const NO_TOKEN_HASH = '0'.repeat(64);

const eventHash = (installId: string, event: { kind: string; tracking: string | null; transactionId: string | null; status: string; at: number | null }) =>
  createHash('sha256').update(JSON.stringify([installId, event.kind, event.tracking, event.transactionId, event.status, event.at])).digest('hex');

/** Verifies one delivery and stores it once. Calls no carrier. */
export async function receiveTrackingWebhook(deps: TrackingWebhookDeps, input: { installId: string; token: string; rawBody: string }): Promise<TrackingWebhookOutcome> {
  const now = deps.now ?? Date.now;
  const repo = shippingTrackingRepo(deps.meta);
  let row;
  try {
    row = await repo.install(input.installId);
  } catch {
    return { status: 503 };
  }
  // Compared whether or not the install exists, so the time taken says nothing about which ids are real.
  const matches = sameHash(webhookTokenHash(deps.secret, input.installId, input.token), row?.tokenHash ?? NO_TOKEN_HASH);
  if (row === null || row.tokenHash === null || !matches) {
    if (row !== null) await repo.badToken(input.installId, now()).catch(() => undefined);
    return { status: 404 };
  }

  let install;
  try {
    install = await deps.manifests.findById(input.installId);
  } catch {
    return { status: 503 };
  }
  if (install === null || install.row.kind !== 'add-on') return { status: 404 };
  const reader = trackingReaderFor(install.row.manifestKey);
  if (reader === null) return { status: 404 };

  let body: unknown;
  try {
    body = JSON.parse(input.rawBody);
  } catch {
    return { status: 400 };
  }
  const heard = reader(body);
  if (heard === null) return { status: 400 };

  try {
    if (heard.kind !== 'ignored' && heard.live) {
      if ((await repo.waitingCount(input.installId)) >= MAX_WAITING_EVENTS) return { status: 503 };
      const stored = {
        carrierInstallId: input.installId,
        kind: heard.kind,
        tracking: heard.tracking,
        transactionId: heard.transactionId,
        rateRef: heard.kind === 'transaction' ? heard.rateRef : null,
        status: heard.status,
        statusAt: heard.at,
        trackingUrl: heard.kind === 'transaction' ? heard.trackingUrl : null,
      };
      const id = await repo.storeEvent({ ...stored, dedupeHash: eventHash(input.installId, heard) }, now());
      if (id !== null) {
        // A queue that is down costs nothing: the pickup finds the event still waiting.
        await deps.enqueue({ kind: SHIPPING_TRACK_JOB, payload: { eventId: id }, dedupeKey: `${SHIPPING_TRACK_JOB}:${id}`, maxAttempts: TRACK_MAX_ATTEMPTS }).catch(() => undefined);
      }
    }
    // Test and ignored events still prove that the webhook reaches this server.
    await repo.heard(input.installId, now());
  } catch {
    return { status: 503 };
  }
  return { status: 200 };
}

// ── Following an event ──────────────────────────────────────────────────────

export type TrackOutcome = 'applied' | 'stale' | 'no-match' | 'ambiguous' | 'old-number' | 'new-number' | 'same' | 'settled' | 'ignored' | 'bad-date';

async function flagAll(deps: TrackDeps, ids: readonly string[], carrierInstallId: string): Promise<'ambiguous'> {
  const repo = shippingTrackingRepo(deps.meta);
  for (const id of ids) await repo.flag(id, carrierInstallId, 'ambiguous', deps.now());
  deps.log?.('a tracking event matched more than one booking, so none was moved', { carrierInstallId, count: ids.length });
  return 'ambiguous';
}

async function followTrack(deps: TrackDeps, event: ShippingTrackEvent): Promise<TrackOutcome> {
  const repo = shippingTrackingRepo(deps.meta);
  const install = event.carrierInstallId;
  const tracking = event.tracking;
  if (tracking === null || event.statusAt === null) return 'ignored';
  let ids = event.transactionId === null ? [] : await repo.liveBookedByShipment(install, event.transactionId);
  if (ids.length === 0) ids = await repo.liveBookedByTracking(install, tracking);
  if (ids.length === 0) return 'no-match';
  if (ids.length > 1) return flagAll(deps, ids, install);
  const booking = await shippingBookingsRepo(deps.meta).byId(ids[0]!);
  if (booking === null) return 'no-match';
  // Another label that happens to show this number.
  if (event.transactionId !== null && booking.carrierShipmentId !== null && booking.carrierShipmentId !== event.transactionId) return 'no-match';
  if (booking.tracking !== tracking) {
    const known = await repo.parcel(booking.id);
    // A number this label used to have is finished with. One it has not had yet may be about to arrive, so the event waits.
    return known?.oldNumbers.includes(tracking) === true ? 'old-number' : 'no-match';
  }
  await repo.ensureParcel(booking.id, install, deps.now());
  return (await repo.applyStatus(booking.id, event.status as ShippingTrackStatus, event.statusAt, deps.now())) ? 'applied' : 'stale';
}

/** The unknown purchase this rate belongs to, if exactly one does. */
async function unknownWithRate(deps: TrackDeps, carrierInstallId: string, rateRef: string): Promise<{ booking: ShippingBooking; carrierToken: string | null }[]> {
  const bookings = shippingBookingsRepo(deps.meta);
  const found: { booking: ShippingBooking; carrierToken: string | null }[] = [];
  for (const id of await shippingTrackingRepo(deps.meta).liveUnknown(carrierInstallId, 200)) {
    const booking = await bookings.byId(id);
    if (booking?.handleSealed == null) continue;
    const handle = openRateHandle(deps.secret, booking.handleSealed);
    if (handle?.ref === rateRef) found.push({ booking, carrierToken: handle.carrierToken ?? null });
  }
  return found;
}

async function followTransaction(deps: TrackDeps, event: ShippingTrackEvent): Promise<TrackOutcome> {
  const repo = shippingTrackingRepo(deps.meta);
  const bookings = shippingBookingsRepo(deps.meta);
  const install = event.carrierInstallId;
  // Only a success says anything here. A failed or refunded transaction never frees a parcel's place.
  if (event.status !== 'SUCCESS' || event.transactionId === null) return 'ignored';

  const booked = await repo.liveBookedByShipment(install, event.transactionId);
  if (booked.length > 1) return flagAll(deps, booked, install);
  if (booked.length === 1) {
    const booking = await bookings.byId(booked[0]!);
    if (booking === null) return 'no-match';
    if (event.tracking === null || event.tracking === booking.tracking) return 'same';
    // Without the carrier's own time, nothing says this is newer than the number the label has.
    if (event.statusAt === null) return 'ignored';
    const changed = await repo.changeNumber({
      bookingId: booking.id,
      carrierInstallId: install,
      from: booking.tracking,
      to: event.tracking,
      trackingUrl: sameHostUrl(event.trackingUrl, booking.trackingUrl),
      carrierAt: event.statusAt,
      at: deps.now(),
    });
    if (changed === 'older') return 'old-number';
    // Another event moved the booking under this one: it waits, and is read again against the new number.
    return changed === 'moved' ? 'no-match' : 'new-number';
  }

  if (event.rateRef === null || event.tracking === null) return 'no-match';
  const unknown = await unknownWithRate(deps, install, event.rateRef);
  if (unknown.length === 0) return 'no-match';
  if (unknown.length > 1) return flagAll(deps, unknown.map((one) => one.booking.id), install);
  const { booking, carrierToken } = unknown[0]!;
  // The event does not say what was charged, so the quote is not shown as the confirmed charge. It names no further labels: any already counted stay counted.
  await recordBought(deps, booking, { carrierShipmentId: event.transactionId, tracking: event.tracking, trackingUrl: event.trackingUrl, carrierToken, chargeDiffers: true, answeredAt: deps.now(), reason: null }, 0);
  return 'settled';
}

/** Follows one stored event. Calls no carrier, sends no mail, and is safe to run twice. */
export async function followTrackEvent(deps: TrackDeps, id: string): Promise<TrackOutcome | 'waiting' | 'done'> {
  const repo = shippingTrackingRepo(deps.meta);
  const event = await repo.event(id);
  if (event === null || event.state === 'done') return 'done';
  const now = deps.now();
  let outcome: TrackOutcome;
  if (event.statusAt !== null && event.statusAt > now + FUTURE_SKEW_MS) outcome = 'bad-date';
  else outcome = event.kind === 'track' ? await followTrack(deps, event) : await followTransaction(deps, event);
  if (outcome === 'no-match' && now - event.receivedAt < UNMATCHED_KEEP_MS) return 'waiting';
  await repo.finishEvent(id, outcome, now);
  return outcome;
}

/** Events a crash or a full queue left waiting, and those whose booking may now exist. Calls no carrier. */
export async function pickUpTrackEvents(deps: TrackDeps): Promise<number> {
  const repo = shippingTrackingRepo(deps.meta);
  const now = deps.now();
  let followed = 0;
  for (const event of await repo.waitingEvents(now - PICKUP_AFTER_MS, PICKUP_BATCH)) {
    try {
      await followTrackEvent(deps, event.id);
      followed += 1;
    } catch {
      deps.log?.('a tracking event could not be followed', { event: event.id });
    }
  }
  await repo.pruneEvents(now - DONE_RETAIN_MS, now - UNMATCHED_RETAIN_MS);
  return followed;
}

const payloadSchema = z.object({ eventId: z.string().min(1).max(64) }).strict();

export interface TrackingJobs {
  registry: JobRegistry;
  scheduler: { registerSchedule(name: string, cron: string, run: () => Promise<void>, options?: { jitterMs?: number }): unknown };
}

/** The job that follows a stored event and its pickup. Neither calls a carrier. */
export function registerShippingTracking(jobs: TrackingJobs, deps: TrackDeps): void {
  jobs.registry.registerJobHandler(SHIPPING_TRACK_JOB, payloadSchema, async (payload) => ({ outcome: await followTrackEvent(deps, payload.eventId) }), { internal: true });
  jobs.scheduler.registerSchedule(
    SHIPPING_TRACK_PICKUP_NAME,
    SHIPPING_TRACK_PICKUP_CRON,
    async () => {
      await pickUpTrackEvents(deps);
    },
    { jitterMs: 30_000 },
  );
}

// ── What a screen is told ───────────────────────────────────────────────────

export interface TrackView {
  status: ShippingTrackStatus | null;
  statusAt: number | null;
  /** When a person's Refresh last got an answer. Never a webhook's time. */
  checkedAt: number | null;
  flag: string | null;
  newNumber: boolean;
}

export function trackViewOf(parcel: ShippingParcel | null | undefined): TrackView | null {
  if (parcel === null || parcel === undefined) return null;
  return { status: parcel.status, statusAt: parcel.statusAt, checkedAt: parcel.checkedAt, flag: parcel.flag, newNumber: parcel.numberChangedAt !== null };
}
