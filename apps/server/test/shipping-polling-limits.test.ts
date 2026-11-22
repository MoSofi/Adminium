// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE POLLER'S LIMITS, for the day its lock is opened.
 *
 * The lock is replaced in this file only, by a module mock: production code
 * has no way to turn it on. `shipping-tracking.test.ts` proves the real lock
 * stops everything.
 */
import { applyMigrations, createSqliteMetaDb, shippingBookingsRepo, shippingTrackingRepo, type MetaDb, type OpenParcel } from '@adminium/meta';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const carrierFake = vi.hoisted(() => ({ calls: [] as string[], answer: (async () => []) as (tracking: string) => Promise<unknown> }));

vi.mock('../src/shipping/locks.js', async (actual) => ({ ...(await actual<typeof import('../src/shipping/locks.js')>()), mayPoll: () => true, anyCarrierMayPoll: () => true }));
vi.mock('../src/shipping/keys.js', async (actual) => ({ ...(await actual<typeof import('../src/shipping/keys.js')>()), checkedAccount: async () => ({ fingerprint: 'f'.repeat(64) }) }));
vi.mock('../src/shipping/carriers.js', async (actual) => ({
  ...(await actual<typeof import('../src/shipping/carriers.js')>()),
  shippingCarrierFor: async () => ({
    key: 'shipping-shippo',
    install: { row: { id: 'mft_carrier' } },
    carrier: {
      track: async (tracking: string) => {
        carrierFake.calls.push(tracking);
        return carrierFake.answer(tracking);
      },
    },
  }),
}));

const { POLL_LIMITS, pollDue, pollInstall, registerShippingPolling } = await import('../src/shipping/polling.js');

const T0 = 1_780_000_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const INSTALL = 'mft_carrier';

const parcel = (over: Partial<OpenParcel> = {}): OpenParcel => ({ bookingId: 'shb_1', createdAt: T0 - DAY, rank: 20, statusAt: T0 - HOUR, checkedAt: null, polledAt: null, ...over });

describe('which parcels are due', () => {
  const on = T0 - 10 * DAY;

  it('never back-fills a parcel bought before polling was switched on', () => {
    expect(pollDue(parcel({ createdAt: on - 1 }), T0, on)).toBe(false);
    expect(pollDue(parcel({ createdAt: on }), T0, on)).toBe(true);
  });

  it('leaves parcels older than 45 days', () => {
    const long = T0 - 100 * DAY;
    expect(pollDue(parcel({ createdAt: T0 - POLL_LIMITS.windowMs - 1, statusAt: T0 - HOUR }), T0, long)).toBe(false);
    expect(pollDue(parcel({ createdAt: T0 - POLL_LIMITS.windowMs + 1, statusAt: T0 - HOUR }), T0, long)).toBe(true);
  });

  it('stops after 30 days with no change', () => {
    const long = T0 - 100 * DAY;
    expect(pollDue(parcel({ createdAt: T0 - 40 * DAY, statusAt: T0 - POLL_LIMITS.quietStopMs }), T0, long)).toBe(false);
    expect(pollDue(parcel({ createdAt: T0 - 40 * DAY, statusAt: T0 - POLL_LIMITS.quietStopMs + 1 }), T0, long)).toBe(true);
  });

  it('asks every 6 hours, or every 24 once 7 days have passed with no change', () => {
    expect(pollDue(parcel({ polledAt: T0 - 6 * HOUR + 1 }), T0, on)).toBe(false);
    expect(pollDue(parcel({ polledAt: T0 - 6 * HOUR }), T0, on)).toBe(true);
    const quiet = { createdAt: T0 - 9 * DAY, statusAt: T0 - 8 * DAY };
    expect(pollDue(parcel({ ...quiet, polledAt: T0 - 23 * HOUR }), T0, on)).toBe(false);
    expect(pollDue(parcel({ ...quiet, polledAt: T0 - 24 * HOUR }), T0, on)).toBe(true);
  });

  it('counts a person\'s Refresh as a check', () => {
    expect(pollDue(parcel({ checkedAt: T0 - HOUR }), T0, on)).toBe(false);
  });
});

describe('a run, with the lock opened for this test', () => {
  let meta: MetaDb;
  let clock = T0;
  let row = 0;

  const deps = () => ({
    meta,
    secret: 'a-test-secret-of-a-decent-length-for-hkdf',
    now: () => clock,
    manifests: { findById: async () => ({ row: { id: INSTALL, kind: 'add-on', manifestKey: 'shipping-shippo', scopeKey: 'conn_one' } }) as never, findInScope: async () => null, getCredential: async () => null },
    carrierDeps: {} as never,
  });

  async function booked(number: string, createdAt = clock): Promise<string> {
    row += 1;
    const made = await shippingBookingsRepo(meta).reserve(
      { installId: 'mft_shop', carrierInstallId: INSTALL, carrierKey: 'shipping-shippo', connectionId: 'conn_one', tableRef: 'orders', tableName: 'shop_orders', rowKey: String(row), purpose: 'outbound', parcelNumber: 1, reference: `MP-${String(row)}`, mode: 'live', accountFingerprint: 'f'.repeat(64), detailsHash: 'd'.repeat(64), service: 'Evri 48', rateCode: 'evri-48', handleSealed: null, quotedAmount: '3.10', quotedCurrency: 'GBP', createdBy: 'usr_1' },
      createdAt,
    );
    if (!made.ok) throw new Error('no booking');
    await shippingBookingsRepo(meta).move(made.booking.id, ['reserved'], 'calling', { calledAt: createdAt }, createdAt);
    await shippingBookingsRepo(meta).move(made.booking.id, ['calling'], 'booked', { tracking: number, answeredAt: createdAt }, createdAt);
    return made.booking.id;
  }

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await applyMigrations(meta.db, { dialect: meta.dialect });
    clock = T0;
    carrierFake.calls = [];
    carrierFake.answer = async () => [];
  });
  afterEach(async () => {
    await meta.db.destroy();
  });

  it('stays off until this install is switched on', async () => {
    await booked('TRK-OFF');
    expect(await pollInstall(deps(), INSTALL)).toEqual({ ran: false, reason: 'off' });
    expect(carrierFake.calls).toEqual([]);
  });

  it('never back-fills what was bought before the switch', async () => {
    await booked('TRK-BEFORE', T0 - DAY);
    await shippingTrackingRepo(meta).setPolling(INSTALL, true, T0 - HOUR);
    const after = await booked('TRK-AFTER', T0 - 30 * 60_000);
    clock = T0 + 7 * HOUR;
    expect(await pollInstall(deps(), INSTALL)).toEqual({ ran: true, calls: 1, stopped: 'done' });
    expect(carrierFake.calls).toEqual(['TRK-AFTER']);
    expect((await shippingTrackingRepo(meta).parcel(after))!.polledAt).toBe(clock);
    // A poll is not a person: "last checked" stays theirs.
    expect((await shippingTrackingRepo(meta).parcel(after))!.checkedAt).toBeNull();
  });

  it('takes a fixed batch, and does not ask again before it is due', async () => {
    await shippingTrackingRepo(meta).setPolling(INSTALL, true, T0 - HOUR);
    for (let n = 0; n < POLL_LIMITS.batch + 4; n += 1) await booked(`TRK-${String(n)}`);
    clock = T0 + 7 * HOUR;
    expect(await pollInstall(deps(), INSTALL)).toMatchObject({ calls: POLL_LIMITS.batch });
    expect(await pollInstall(deps(), INSTALL)).toMatchObject({ calls: 4 });
    expect(await pollInstall(deps(), INSTALL)).toMatchObject({ calls: 0 });
  });

  it('stops at the first "too many requests"', async () => {
    await shippingTrackingRepo(meta).setPolling(INSTALL, true, T0 - HOUR);
    for (let n = 0; n < 3; n += 1) await booked(`TRK-${String(n)}`);
    carrierFake.answer = async () => {
      throw Object.assign(new Error('slow'), { name: 'CarrierError', code: 'rate_limited', carrierMessage: 'Too many' });
    };
    clock = T0 + 7 * HOUR;
    expect(await pollInstall(deps(), INSTALL)).toEqual({ ran: true, calls: 1, stopped: 'rate-limited' });
    expect(carrierFake.calls).toHaveLength(1);
  });

  it('stops at the monthly allowance, and starts again next month', async () => {
    const repo = shippingTrackingRepo(meta);
    await repo.setPolling(INSTALL, true, T0 - HOUR);
    await booked('TRK-CAP');
    clock = T0 + 7 * HOUR;
    const month = new Date(clock).toISOString().slice(0, 7);
    await meta.db.updateTable('adminium_shipping_track_installs').set({ pollMonth: month, pollCalls: POLL_LIMITS.monthlyCalls }).where('carrierInstallId', '=', INSTALL).execute();
    expect(await pollInstall(deps(), INSTALL)).toEqual({ ran: true, calls: 0, stopped: 'monthly-limit' });
    expect(carrierFake.calls).toEqual([]);
    expect(await repo.takePollCall(INSTALL, '2099-01', POLL_LIMITS.monthlyCalls, clock)).toBe(true);
    expect((await repo.install(INSTALL))!.pollCalls).toBe(1);
  });

  it('registers one job and one schedule once a carrier is allowed', () => {
    const registered: string[] = [];
    const jobs = { registry: { registerJobHandler: (kind: string) => void registered.push(kind) }, scheduler: { registerSchedule: (name: string) => void registered.push(name) }, enqueue: async () => undefined } as never;
    expect(registerShippingPolling(jobs, deps() as never)).toBe(true);
    expect(registered).toEqual(['shipping.poll', 'shipping.poll.enqueue']);
  });
});
