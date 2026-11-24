// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BACKGROUND TRACKING: BUILT, AND LOCKED OFF.
 *
 * Shippo's terms bar processes that run while nobody is logged in, and the
 * owner has not ruled on Shippo's reply. So `mayPoll` in `locks.ts`, a
 * literal in code, is the first thing asked: while it says no, no job is
 * registered, no schedule exists, no key is read, and a stored per-install
 * switch means nothing. Turning this on is a reviewed commit to that file.
 *
 * Its limits, for the day it is allowed (critique F11):
 *  - only parcels bought after the switch went on, and in the last 45 days:
 *    switching it on never back-fills old parcels;
 *  - stops at delivered or returned, or after 30 days with no change;
 *  - every 6 hours, or every 24 after 7 days with no change;
 *  - one job per install, a fixed batch, a monthly count, and a stop at the
 *    carrier's first "too many requests".
 */
import { SERVER_SCOPE, shippingBookingsRepo, shippingTrackingRepo, type ManifestsRepo, type MetaDb, type OpenParcel } from '@adminium/meta';
import { z } from 'zod';

import type { JobRegistry } from '../jobs/registry.js';
import { shippingCarrierFor, type ShippingCarrierDeps } from './carriers.js';
import { checkedAccount } from './keys.js';
import { anyCarrierMayPoll, mayPoll } from './locks.js';
import { askCarrierForTrack } from './refresh.js';

export const SHIPPING_POLL_JOB = 'shipping.poll';
export const SHIPPING_POLL_SCHEDULE = 'shipping.poll.enqueue';
const SHIPPING_POLL_CRON = '17 * * * *';

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
export const POLL_LIMITS = {
  windowMs: 45 * DAY,
  quietStopMs: 30 * DAY,
  quietAfterMs: 7 * DAY,
  everyMs: 6 * HOUR,
  quietEveryMs: 24 * HOUR,
  batch: 25,
  monthlyCalls: 2000,
} as const;

/** Whether this parcel is due a background check. Pure, so each limit can be proved. */
export function pollDue(parcel: OpenParcel, now: number, switchedOnAt: number): boolean {
  if (parcel.createdAt < switchedOnAt || parcel.createdAt < now - POLL_LIMITS.windowMs) return false;
  const quiet = now - (parcel.statusAt ?? parcel.createdAt);
  if (quiet >= POLL_LIMITS.quietStopMs) return false;
  const every = quiet >= POLL_LIMITS.quietAfterMs ? POLL_LIMITS.quietEveryMs : POLL_LIMITS.everyMs;
  const last = Math.max(parcel.polledAt ?? 0, parcel.checkedAt ?? 0);
  return now - last >= every;
}

export interface PollDeps {
  meta: MetaDb;
  manifests: Pick<ManifestsRepo, 'findById' | 'findInScope' | 'getCredential'>;
  secret: string;
  carrierDeps: ShippingCarrierDeps;
  now: () => number;
  log?: (message: string, fields: Record<string, unknown>) => void;
}

export type PollResult = { ran: false; reason: 'locked' | 'off' | 'not-found' | 'server-wide' } | { ran: true; calls: number; stopped: 'done' | 'rate-limited' | 'monthly-limit' };

/** One install's due parcels. The lock is asked first, before anything is read. */
export async function pollInstall(deps: PollDeps, carrierInstallId: string): Promise<PollResult> {
  const install = await deps.manifests.findById(carrierInstallId);
  if (install === null || install.row.kind !== 'add-on') return { ran: false, reason: 'not-found' };
  const key = install.row.manifestKey;
  if (!mayPoll(key)) return { ran: false, reason: 'locked' };
  const repo = shippingTrackingRepo(deps.meta);
  const state = await repo.install(carrierInstallId);
  if (state?.pollOnAt == null) return { ran: false, reason: 'off' };
  if (install.row.scopeKey === SERVER_SCOPE) return { ran: false, reason: 'server-wide' };

  const now = deps.now();
  const resolved = await shippingCarrierFor(deps.carrierDeps, key, install.row.scopeKey, new Date(now).toISOString().slice(0, 10));
  const account = await checkedAccount(deps.meta, deps.secret, resolved);
  const since = Math.max(state.pollOnAt, now - POLL_LIMITS.windowMs);
  const due = (await repo.openParcels({ carrierInstallId }, since, POLL_LIMITS.batch * 4)).filter((one) => pollDue(one, now, state.pollOnAt!)).slice(0, POLL_LIMITS.batch);
  const bookings = shippingBookingsRepo(deps.meta);
  const month = new Date(now).toISOString().slice(0, 7);
  let calls = 0;
  for (const one of due) {
    await repo.ensureParcel(one.bookingId, carrierInstallId, deps.now());
    // The parcel first, then the booking: a number that changes after this cannot have its old status written on it.
    const before = await repo.parcel(one.bookingId);
    const booking = await bookings.byId(one.bookingId);
    if (before === null || booking === null || booking.state !== 'booked' || booking.tracking === null || booking.accountFingerprint !== account.fingerprint) continue;
    if (!(await repo.takePollCall(carrierInstallId, month, POLL_LIMITS.monthlyCalls, deps.now()))) return { ran: true, calls, stopped: 'monthly-limit' };
    calls += 1;
    const answer = await askCarrierForTrack(resolved, booking, deps.now());
    if (answer.kind === 'rate-limited') return { ran: true, calls, stopped: 'rate-limited' };
    await repo.markPolled(booking.id, deps.now());
    if (answer.kind === 'events' && answer.best !== null) await repo.applyStatus(booking.id, answer.best.status, answer.best.at, deps.now(), before.numberChangedAt);
  }
  return { ran: true, calls, stopped: 'done' };
}

export interface PollingJobs {
  registry: JobRegistry;
  scheduler: { registerSchedule(name: string, cron: string, run: () => Promise<void>, options?: { jitterMs?: number }): unknown };
  enqueue: (input: { kind: string; payload: Record<string, unknown>; dedupeKey: string; maxAttempts: number }) => Promise<unknown>;
}

const payloadSchema = z.object({ carrierInstallId: z.string().min(1).max(64) }).strict();

/** Registers the job and its schedule only for a build in which a carrier may be polled. Answers whether it did. */
export function registerShippingPolling(jobs: PollingJobs, deps: PollDeps): boolean {
  if (!anyCarrierMayPoll()) return false;
  jobs.registry.registerJobHandler(SHIPPING_POLL_JOB, payloadSchema, async (payload) => pollInstall(deps, payload.carrierInstallId), { internal: true });
  jobs.scheduler.registerSchedule(
    SHIPPING_POLL_SCHEDULE,
    SHIPPING_POLL_CRON,
    async () => {
      const rows = await deps.meta.db.selectFrom('adminium_shipping_track_installs').select('carrierInstallId').where('pollOnAt', 'is not', null).execute();
      for (const row of rows) {
        await jobs.enqueue({ kind: SHIPPING_POLL_JOB, payload: { carrierInstallId: row.carrierInstallId }, dedupeKey: `${SHIPPING_POLL_JOB}:${row.carrierInstallId}`, maxAttempts: 1 }).catch(() => undefined);
      }
    },
    { jitterMs: 5 * 60_000 },
  );
  return true;
}
