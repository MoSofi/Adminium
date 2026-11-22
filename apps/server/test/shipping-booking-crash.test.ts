// SPDX-License-Identifier: AGPL-3.0-only
/**
 * BUYING A LABEL ONCE, with the booking table itself on SQLite, Postgres and
 * MySQL and a carrier that counts every purchase. Each crash point leaves a
 * row that says what may have happened, and none of them ever buys twice:
 *
 *   before the call · during it · answered but not written · written but not
 *   queued · a second press · two presses at once · a restart.
 *
 * What the carrier then says settles it only on a clear match. An empty answer
 * never frees an order: only a person does, after a quiet period.
 */
import { randomBytes } from 'node:crypto';

import type { Rate, Shipment } from '@adminium/add-on-contracts';
import {
  applyMigrations,
  createMysqlMetaDb,
  createPostgresMetaDb,
  createSqliteMetaDb,
  postgresInt8AsNumber,
  shippingBookingsRepo,
  shippingRepo,
  type MetaDb,
  type ShippingBooking,
  type ShippingKeyMode,
  type ShippingSlot,
} from '@adminium/meta';
import BetterSqlite3 from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { commitRows, rowsOf, sanitizeDump } from '../src/archive/policy.js';
import { pickUpApplies } from '../src/shipping/apply.js';
import { BOOK_ANSWER_MS, LATE_LABEL_REASON, RELEASE_QUIET_MS, RESERVED_STALE_MS, bookingView, buyLabel, lookUpBooking, readsAs, releaseBooking, settleStale, type BookingDeps, type PurchaseInput } from '../src/shipping/bookings.js';
import type { ResolvedCarrier } from '../src/shipping/carriers.js';
import { openRateHandle } from '../src/shipping/quotes.js';
import { ShippingRefusal } from '../src/shipping/refusals.js';

type Dialect = 'sqlite' | 'postgres' | 'mysql';
const LEGS: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', Boolean(process.env['TEST_POSTGRES_URL'])],
  ['mysql', Boolean(process.env['TEST_MYSQL_URL'])],
];

const SECRET = 'a-test-secret-of-a-decent-length-for-hkdf';
const FINGERPRINT = 'f'.repeat(64);
const OTHER_ACCOUNT = 'e'.repeat(64);
const T0 = 1_780_000_000_000;
const DAY = '2026-11-22';
const RATE: Rate = { code: 'evri-48', service: 'Evri 48', amount: 3.1, amountDecimal: '3.10', currency: 'GBP', ref: 'rate-handle-1', carrierToken: 'evri' };
const SHIPMENT: Shipment = { id: 'tx_1', tracking: 'TRK-1', labelFileId: 'file-1', rate: RATE, carrier: 'Evri', carrierToken: 'evri' };

async function metaOn(dialect: Dialect): Promise<{ meta: MetaDb; destroy: () => Promise<void> }> {
  const database = `adminium_ship_crash_${randomBytes(4).toString('hex')}`;
  if (dialect === 'sqlite') {
    const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await applyMigrations(meta.db, { dialect: meta.dialect });
    return { meta, destroy: () => meta.db.destroy() };
  }
  if (dialect === 'postgres') {
    const { default: pg } = await import('pg');
    const base = process.env['TEST_POSTGRES_URL'] as string;
    const admin = new pg.Client({ connectionString: base });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    await admin.end();
    const url = new URL(base);
    url.pathname = `/${database}`;
    const meta = createPostgresMetaDb({ pool: new pg.Pool({ connectionString: url.toString(), max: 6, types: postgresInt8AsNumber(pg as unknown as Record<string, unknown>) }) });
    await applyMigrations(meta.db, { dialect: meta.dialect });
    return {
      meta,
      destroy: async () => {
        await meta.db.destroy();
        const drop = new pg.Client({ connectionString: base });
        await drop.connect();
        await drop.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
        await drop.end();
      },
    };
  }
  const mysql = await import('mysql2/promise');
  const base = process.env['TEST_MYSQL_URL'] as string;
  const admin = await mysql.createConnection({ uri: base });
  await admin.query(`CREATE DATABASE \`${database}\``);
  await admin.end();
  const url = new URL(base);
  url.pathname = `/${database}`;
  const { createPool } = await import('mysql2');
  const meta = createMysqlMetaDb({ pool: createPool({ uri: url.toString(), connectionLimit: 6 }) });
  await applyMigrations(meta.db, { dialect: meta.dialect });
  return {
    meta,
    destroy: async () => {
      await meta.db.destroy();
      const drop = await mysql.createConnection({ uri: base });
      await drop.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await drop.end();
    },
  };
}

type Slot = ShippingSlot & { tableName: string };

const crash = () => {
  throw new Error('the process died here');
};

describe.each(LEGS)('buying a label once, with the booking table on %s', (dialect, available) => {
  let db: { meta: MetaDb; destroy: () => Promise<void> };
  let clock = T0;
  let rowNumber = 0;
  let purchases = 0;
  let queued: string[] = [];
  let book: () => Promise<unknown>;
  let recover: ((order: { rateRefs?: string[] }) => Promise<unknown>) | undefined;
  let asked: { rateRefs?: string[] }[] = [];
  let deps: BookingDeps;

  const repo = () => shippingBookingsRepo(db.meta);
  const nextSlot = (over: Partial<Slot> = {}): Slot => {
    rowNumber += 1;
    return { installId: 'mft_shop', connectionId: 'conn_one', tableRef: 'orders', tableName: 'shop_orders', rowKey: String(rowNumber), purpose: 'outbound', parcelNumber: 1, ...over };
  };
  const resolved = (): ResolvedCarrier =>
    ({
      key: 'carrier-one',
      install: { row: { id: 'mft_carrier' } },
      scrub: (text: string) => text,
      keyHash: () => 'h'.repeat(64),
      accountFingerprint: () => FINGERPRINT,
      keyHint: 'abcd',
      carrier: {
        key: 'carrier-one',
        book: async () => {
          purchases += 1;
          return book();
        },
        ...(recover === undefined
          ? {}
          : {
              recover: async (order: { rateRefs?: string[] }) => {
                asked.push(order);
                return recover!(order);
              },
            }),
      },
    }) as unknown as ResolvedCarrier;
  const input = (slot: Slot, over: Partial<PurchaseInput> = {}): PurchaseInput => ({
    slot,
    reference: `MP-${slot.rowKey}`,
    resolved: resolved(),
    account: { mode: 'live', fingerprint: FINGERPRINT },
    quoteId: 'shq_none',
    detailsHash: 'd'.repeat(64),
    rate: RATE,
    details: { parcel: { weightKg: 1, lengthCm: 1, widthCm: 1, heightCm: 1, contents: 'Books' }, from: { name: 'a', lines: ['b'], city: 'c', postcode: 'd', country: 'GB' }, to: { name: 'e', lines: ['f'], city: 'g', postcode: 'h', country: 'GB' } },
    by: 'usr_packer',
    counted: null,
    ...over,
  });
  const buy = (slot: Slot, over: Partial<PurchaseInput> = {}) => buyLabel(deps, input(slot, over), false);
  const codeOf = async (work: Promise<unknown>): Promise<string> => {
    try {
      await work;
      return 'no refusal';
    } catch (error) {
      if (error instanceof ShippingRefusal) return error.code;
      throw error;
    }
  };
  const only = async (slot: Slot): Promise<ShippingBooking> => {
    const all = await repo().forRow(slot.connectionId, slot.tableName, slot.rowKey);
    expect(all).toHaveLength(1);
    return all[0]!;
  };

  beforeAll(async () => {
    if (available) db = await metaOn(dialect);
  }, 120_000);
  afterAll(async () => {
    if (available) await db.destroy();
  });
  beforeEach(() => {
    clock += 3_600_000;
    purchases = 0;
    queued = [];
    asked = [];
    book = async () => SHIPMENT;
    recover = undefined;
    if (available) deps = { meta: db.meta, secret: SECRET, now: () => clock, enqueueApply: async (id) => void queued.push(id), faults: {} };
  });

  // ── The crash points ────────────────────────────────────────────────────

  it.skipIf(!available)('crash before the call: nothing was bought, the place is held briefly, then free', async () => {
    const slot = nextSlot();
    deps.faults = { beforeCall: crash };
    await expect(buy(slot)).rejects.toThrow('the process died here');
    expect(purchases).toBe(0);
    expect((await only(slot)).state).toBe('reserved');

    deps.faults = {};
    expect(await codeOf(buy(slot))).toBe('BOOKING_EXISTS');
    expect(purchases).toBe(0);

    clock += RESERVED_STALE_MS;
    const bought = await buy(slot);
    expect(bought.state).toBe('booked');
    expect(purchases).toBe(1);
    const all = await repo().forRow(slot.connectionId, slot.tableName, slot.rowKey);
    expect(all.map((one) => [one.state, one.reason])).toEqual([['released', 'never-called'], ['booked', null]]);
  });

  it.skipIf(!available)('a process that wakes after its reservation was given up does not buy', async () => {
    const slot = nextSlot();
    let wake: () => void = () => undefined;
    const paused = new Promise<void>((resolve) => {
      wake = resolve;
    });
    let reachedCall: () => void = () => undefined;
    const atCall = new Promise<void>((resolve) => {
      reachedCall = resolve;
    });
    deps.faults = {
      beforeCall: async () => {
        reachedCall();
        await paused;
      },
    };
    const sleeping = codeOf(buy(slot));
    await atCall;
    deps.faults = {};
    clock += RESERVED_STALE_MS;
    expect((await buy(slot)).state).toBe('booked');
    wake();
    expect(await sleeping).toBe('BOOKING_EXISTS');
    expect(purchases).toBe(1);
  });

  it.skipIf(!available)('crash during the call: the row reads as unknown once nobody can be waiting, and blocks a rebook', async () => {
    const slot = nextSlot();
    const made = await repo().reserve({ ...slot, carrierInstallId: 'mft_carrier', carrierKey: 'carrier-one', reference: 'MP-X', mode: 'live', accountFingerprint: FINGERPRINT, detailsHash: 'd'.repeat(64), service: 'Evri', rateCode: 'evri', handleSealed: null, quotedAmount: '3.10', quotedCurrency: 'GBP', createdBy: null }, clock);
    if (!made.ok) throw new Error('not reserved');
    expect(await repo().move(made.booking.id, ['reserved'], 'calling', { calledAt: clock }, clock)).toBe(true);

    expect(await codeOf(buy(slot))).toBe('BOOKING_EXISTS');
    expect(readsAs((await only(slot)), clock + BOOK_ANSWER_MS - 1)).toBe('calling');
    clock += BOOK_ANSWER_MS;
    expect(readsAs((await only(slot)), clock)).toBe('unknown');
    expect(await codeOf(buy(slot))).toBe('BOOKING_EXISTS');
    expect(await only(slot)).toMatchObject({ state: 'unknown', reason: 'no-answer' });
    expect(purchases).toBe(0);
  });

  it.skipIf(!available)('crash after the carrier answered, before our write: never bought again, and a look-up finds it', async () => {
    const slot = nextSlot();
    deps.faults = { afterCarrierAnswered: crash };
    await expect(buy(slot)).rejects.toThrow('the process died here');
    expect(purchases).toBe(1);
    expect((await only(slot)).state).toBe('calling');

    deps.faults = {};
    clock += BOOK_ANSWER_MS;
    expect(await codeOf(buy(slot))).toBe('BOOKING_EXISTS');
    expect(purchases).toBe(1);

    recover = async () => ({ outcome: 'found', shipment: SHIPMENT });
    const looked = await lookUpBooking(deps, await only(slot), resolved(), { fingerprint: FINGERPRINT });
    expect(looked.outcome).toBe('found');
    expect(looked.booking).toMatchObject({ state: 'booked', tracking: 'TRK-1', carrierShipmentId: 'tx_1' });
    expect(asked[0]!.rateRefs).toEqual(['rate-handle-1']);
    expect(queued).toEqual([looked.booking.id]);
    expect(purchases).toBe(1);
  });

  it.skipIf(!available)('crash after the booking is written, before its next steps are queued: the pickup finds it', async () => {
    const slot = nextSlot();
    deps.faults = { afterBooked: crash };
    await expect(buy(slot)).rejects.toThrow('the process died here');
    const booking = await only(slot);
    expect(booking).toMatchObject({ state: 'booked', appliedAt: null });
    expect(queued).toEqual([]);

    const picked: string[] = [];
    await pickUpApplies(db.meta, async (job) => picked.push(String(job.payload['bookingId'])), clock + 3 * 60_000);
    expect(picked).toContain(booking.id);
    expect(purchases).toBe(1);
  });

  it.skipIf(!available)('a queue that is down costs nothing: the label is bought, and the pickup does the rest', async () => {
    const slot = nextSlot();
    deps.enqueueApply = async () => {
      throw new Error('queue down');
    };
    expect((await buy(slot)).state).toBe('booked');
  });

  it.skipIf(!available)('a restart in the middle changes nothing: another process sees the same row and buys nothing', async () => {
    const slot = nextSlot();
    deps.faults = { afterCarrierAnswered: crash };
    await expect(buy(slot)).rejects.toThrow();
    // A new process: new deps, the same database.
    const restarted: BookingDeps = { meta: db.meta, secret: SECRET, now: () => clock + BOOK_ANSWER_MS, enqueueApply: async () => undefined };
    expect(await codeOf(buyLabel(restarted, input(slot), false))).toBe('BOOKING_EXISTS');
    expect((await only(slot)).state).toBe('unknown');
    expect(purchases).toBe(1);
  });

  // ── Presses ─────────────────────────────────────────────────────────────

  it.skipIf(!available)('a second press, and a reload that presses again, buy nothing', async () => {
    const slot = nextSlot();
    const first = await buy(slot);
    expect(await codeOf(buy(slot))).toBe('BOOKING_EXISTS');
    expect(await codeOf(buy(slot))).toBe('BOOKING_EXISTS');
    expect(purchases).toBe(1);
    expect((await only(slot)).id).toBe(first.id);
  });

  it.skipIf(!available)('eight presses at once make one purchase', async () => {
    const slot = nextSlot();
    book = async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return SHIPMENT;
    };
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => codeOf(buy(slot))));
    expect(outcomes.filter((one) => one === 'no refusal')).toHaveLength(1);
    expect(outcomes.filter((one) => one === 'BOOKING_EXISTS')).toHaveLength(7);
    expect(purchases).toBe(1);
  });

  it.skipIf(!available)('a second carrier cannot book a parcel the first holds', async () => {
    const slot = nextSlot();
    await buy(slot);
    const other = { ...resolved(), key: 'carrier-two' } as ResolvedCarrier;
    expect(await codeOf(buy(slot, { resolved: other }))).toBe('BOOKING_EXISTS');
    expect(purchases).toBe(1);
  });

  it.skipIf(!available)('parcels and purposes each have their own place; a test label never holds the live one\'s', async () => {
    const slot = nextSlot();
    await buy(slot);
    await buy({ ...slot, parcelNumber: 2 });
    await buy({ ...slot, purpose: 'return' });
    const test = await buy(slot, { account: { mode: 'test' as ShippingKeyMode, fingerprint: FINGERPRINT } });
    expect(test.mode).toBe('test');
    expect(purchases).toBe(4);
    expect(await codeOf(buy(slot, { account: { mode: 'test', fingerprint: FINGERPRINT } }))).toBe('BOOKING_EXISTS');
  });

  // ── What the carrier said ───────────────────────────────────────────────

  it.skipIf(!available)('a timed-out purchase is unknown and blocks a rebook, and an answer that arrives late is still believed', async () => {
    const slot = nextSlot();
    let answer: (value: unknown) => void = () => undefined;
    book = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    deps.answerMs = 15;
    const timedOut = await buy(slot);
    expect(timedOut).toMatchObject({ state: 'unknown', reason: 'no-answer' });
    expect(await codeOf(buy(slot))).toBe('BOOKING_EXISTS');
    expect(purchases).toBe(1);

    answer(SHIPMENT);
    await expect.poll(async () => (await only(slot)).state, { timeout: 5000 }).toBe('booked');
    expect(queued).toEqual([timedOut.id]);
  });

  it.skipIf(!available)('only a clear refusal frees the order, and gives the day\'s count back', async () => {
    const slot = nextSlot();
    book = async () => {
      throw { name: 'CarrierError', code: 'BAD_POSTCODE', carrierMessage: 'No such postcode', outcome: 'refused', reason: 'address' };
    };
    const code = await codeOf(buy(slot, { counted: { day: DAY, dailyLabels: 5 } }));
    expect(code).toBe('CARRIER_REFUSED');
    expect(await only(slot)).toMatchObject({ state: 'refused', reason: 'address', openKey: null, countHeld: false });
    expect(await shippingRepo(db.meta).dayLabels('mft_shop', DAY)).toBe(0);
    book = async () => SHIPMENT;
    expect((await buy(slot)).state).toBe('booked');
  });

  it.skipIf(!available)('anything else is unknown: a bare error, a carrier error that does not say, and a bad answer', async () => {
    for (const failure of [
      async () => {
        throw new Error('socket hang up');
      },
      async () => {
        throw { name: 'CarrierError', code: 'E500', carrierMessage: 'Try later', retryable: true };
      },
      async () => ({ id: 'tx' }),
      async () => 'nonsense',
      async () => ({ ...SHIPMENT, tracking: 'x'.repeat(192) }),
    ]) {
      const slot = nextSlot();
      book = failure;
      const made = await buy(slot, { counted: { day: DAY, dailyLabels: 1000 } });
      expect(made.state).toBe('unknown');
      expect(made.openKey).not.toBeNull();
      // Maybe paid for, so it still counts.
      expect(made.countedDay).toBe(DAY);
      expect(await codeOf(buy(slot))).toBe('BOOKING_EXISTS');
    }
  });

  it.skipIf(!available)('keeps what was charged, and flags a charge that differs from the quote', async () => {
    const same = await buy(nextSlot());
    expect(same).toMatchObject({ amount: '3.10', currency: 'GBP', chargeDiffers: false });
    book = async () => ({ ...SHIPMENT, rate: { ...RATE, amount: 3.1, amountDecimal: '3.1' } });
    expect((await buy(nextSlot())).chargeDiffers).toBe(false);
    book = async () => ({ ...SHIPMENT, rate: { ...RATE, amount: 4.2, amountDecimal: '4.20' } });
    expect(await buy(nextSlot())).toMatchObject({ amount: '4.20', chargeDiffers: true });
    book = async () => ({ ...SHIPMENT, rate: { ...RATE, currency: 'USD' } });
    expect((await buy(nextSlot())).chargeDiffers).toBe(true);
  });

  it.skipIf(!available)('a live purchase the carrier marks as a sample is for a person to look at, and a release frees it', async () => {
    const slot = nextSlot();
    book = async () => ({ ...SHIPMENT, test: true });
    const made = await buy(slot);
    expect(made).toMatchObject({ state: 'unknown', mode: 'live', reason: 'test-on-live', tracking: null });
    expect(await codeOf(buy(slot))).toBe('BOOKING_EXISTS');
    clock += RELEASE_QUIET_MS;
    expect((await releaseBooking(deps, made, 'usr_owner')).openKey).toBeNull();
  });

  it.skipIf(!available)('a success that arrives after the row was read as not bought takes its place back and counts again', async () => {
    const slot = nextSlot();
    const day = '2026-11-26';
    let answer: (value: unknown) => void = () => undefined;
    book = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    deps.answerMs = 15;
    const made = await buy(slot, { counted: { day, dailyLabels: 3 } });
    recover = async () => ({ outcome: 'not-bought' });
    expect((await lookUpBooking(deps, made, resolved(), { fingerprint: FINGERPRINT })).booking.state).toBe('refused');
    expect(await shippingRepo(db.meta).dayLabels('mft_shop', day)).toBe(0);
    answer(SHIPMENT);
    await expect.poll(async () => (await only(slot)).state, { timeout: 5000 }).toBe('booked');
    expect((await repo().open(slot, 'live'))?.id).toBe(made.id);
    expect(await shippingRepo(db.meta).dayLabels('mft_shop', day)).toBe(1);
    expect(queued).toContain(made.id);
  });

  it.skipIf(!available)('a success that arrives after someone bought again keeps both labels, and flags the holder for a refund', async () => {
    const slot = nextSlot();
    let answer: (value: unknown) => void = () => undefined;
    book = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    deps.answerMs = 15;
    const first = await buy(slot);
    recover = async () => ({ outcome: 'not-bought' });
    await lookUpBooking(deps, first, resolved(), { fingerprint: FINGERPRINT });
    delete deps.answerMs;
    book = async () => ({ ...SHIPMENT, id: 'tx_2', tracking: 'TRK-2' });
    const second = await buy(slot);
    answer(SHIPMENT);
    await expect.poll(async () => (await repo().byId(first.id))?.reason, { timeout: 5000 }).toBe(LATE_LABEL_REASON);
    expect(await repo().byId(first.id)).toMatchObject({ state: 'refused', tracking: 'TRK-1' });
    expect(await repo().byId(second.id)).toMatchObject({ state: 'booked', duplicates: 1 });
  });

  it.skipIf(!available)('keeps the carrier\'s handle sealed, and out of every view', async () => {
    const booking = await buy(nextSlot());
    expect(booking.handleSealed).not.toContain('rate-handle-1');
    expect(openRateHandle(SECRET, booking.handleSealed!)).toEqual({ ref: 'rate-handle-1', carrierToken: 'evri' });
    expect(openRateHandle('another-secret-of-a-decent-length-here', booking.handleSealed!)).toBeNull();
    const shown = JSON.stringify(bookingView(booking, clock, false));
    for (const hidden of ['rate-handle-1', 'tx_1', 'file-1', FINGERPRINT]) expect(shown).not.toContain(hidden);
    const priceless = bookingView(booking, clock, true);
    for (const field of ['amount', 'currency', 'chargeDiffers']) expect(priceless).not.toHaveProperty(field);
  });

  // ── Settling an unknown purchase ────────────────────────────────────────

  async function unknownBooking(): Promise<{ slot: Slot; booking: ShippingBooking }> {
    const slot = nextSlot();
    book = async () => {
      throw new Error('no answer');
    };
    const booking = await buy(slot);
    expect(booking.state).toBe('unknown');
    book = async () => SHIPMENT;
    purchases = 0;
    return { slot, booking };
  }

  it.skipIf(!available)('settles only on a clear match, and says why when it cannot', async () => {
    const cases: [() => Promise<unknown>, string][] = [
      [async () => ({ outcome: 'no-match' }), 'no-match'],
      [async () => ({ outcome: 'found', shipment: { ...SHIPMENT, rate: { ...RATE, ref: 'another-rate' } } }), 'other-rate'],
      [async () => ({ outcome: 'found', shipment: { ...SHIPMENT, test: true } }), 'other-account'],
      [async () => ({ outcome: 'surprise' }), 'no-answer'],
      [
        async () => {
          throw new Error('503');
        },
        'no-answer',
      ],
    ];
    for (const [answer, expected] of cases) {
      const { slot, booking } = await unknownBooking();
      recover = answer;
      const looked = await lookUpBooking(deps, booking, resolved(), { fingerprint: FINGERPRINT });
      expect(looked.outcome, expected).toBe(expected);
      expect(looked.booking.state).toBe('unknown');
      expect(looked.booking.checkedAt).toBe(clock);
      expect(await codeOf(buy(slot))).toBe('BOOKING_EXISTS');
    }
  });

  it.skipIf(!available)('never asks another account, which would truthfully find nothing', async () => {
    const { booking } = await unknownBooking();
    recover = async () => ({ outcome: 'not-bought' });
    const looked = await lookUpBooking(deps, booking, resolved(), { fingerprint: OTHER_ACCOUNT });
    expect(looked.outcome).toBe('other-account');
    expect(looked.booking.state).toBe('unknown');
    expect(asked).toEqual([]);
  });

  it.skipIf(!available)('a carrier with no look-up leaves it for a person', async () => {
    const { booking } = await unknownBooking();
    expect((await lookUpBooking(deps, booking, resolved(), { fingerprint: FINGERPRINT })).outcome).toBe('cannot-check');
  });

  it.skipIf(!available)('frees the order on the carrier\'s clear "not bought", and counts further labels for a person to refund', async () => {
    const free = await unknownBooking();
    recover = async () => ({ outcome: 'not-bought' });
    expect(await lookUpBooking(deps, free.booking, resolved(), { fingerprint: FINGERPRINT })).toMatchObject({ outcome: 'not-bought', booking: { state: 'refused', openKey: null } });

    const twice = await unknownBooking();
    recover = async () => ({ outcome: 'found', shipment: SHIPMENT, duplicates: [{ ...SHIPMENT, id: 'tx_2', tracking: 'TRK-2' }] });
    expect(await lookUpBooking(deps, twice.booking, resolved(), { fingerprint: FINGERPRINT })).toMatchObject({ outcome: 'found', booking: { state: 'booked', duplicates: 1 } });
  });

  it.skipIf(!available)('a person may release only after the quiet period, and only an unknown purchase', async () => {
    const { slot, booking } = await unknownBooking();
    expect(await codeOf(releaseBooking(deps, booking, 'usr_owner'))).toBe('RELEASE_TOO_SOON');
    clock += RELEASE_QUIET_MS - 1;
    expect(await codeOf(releaseBooking(deps, booking, 'usr_owner'))).toBe('RELEASE_TOO_SOON');
    clock += 1;
    const released = await releaseBooking(deps, booking, 'usr_owner');
    expect(released).toMatchObject({ state: 'released', releasedBy: 'usr_owner', releasedAt: clock, openKey: null });
    expect(await codeOf(releaseBooking(deps, released, 'usr_owner'))).toBe('BOOKING_NOT_UNKNOWN');
    const bought = await buy(nextSlot());
    expect(await codeOf(releaseBooking(deps, bought, 'usr_owner'))).toBe('BOOKING_NOT_UNKNOWN');
    expect((await repo().byId(booking.id))?.rowKey).toBe(slot.rowKey);
  });

  it.skipIf(!available)('before buying again after a release, looks up every earlier rate; a late label takes its place back', async () => {
    const { slot, booking } = await unknownBooking();
    clock += RELEASE_QUIET_MS;
    await releaseBooking(deps, booking, 'usr_owner');
    recover = async () => ({ outcome: 'found', shipment: SHIPMENT });
    expect(await codeOf(buy(slot, { rate: { ...RATE, ref: 'rate-handle-2' } }))).toBe('ALREADY_BOUGHT');
    expect(purchases).toBe(0);
    expect(asked[0]!.rateRefs).toEqual(['rate-handle-1']);
    expect(await repo().byId(booking.id)).toMatchObject({ state: 'booked', tracking: 'TRK-1' });
    expect(await repo().open(slot, 'live')).toMatchObject({ id: booking.id });
    expect(queued).toContain(booking.id);
  });

  it.skipIf(!available)('refuses to buy over an earlier attempt nobody can look up, unless someone who manages shipping confirms', async () => {
    for (const earlier of ['no-recover', 'other-account', 'unreadable'] as const) {
      const { slot, booking } = await unknownBooking();
      clock += RELEASE_QUIET_MS;
      await releaseBooking(deps, booking, 'usr_owner');
      if (earlier === 'other-account') await db.meta.db.updateTable('adminium_shipping_bookings').set({ accountFingerprint: OTHER_ACCOUNT }).where('id', '=', booking.id).execute();
      if (earlier === 'unreadable') await db.meta.db.updateTable('adminium_shipping_bookings').set({ handleSealed: 'enc:v1:not-a-sealed-value' }).where('id', '=', booking.id).execute();
      recover = earlier === 'no-recover' ? undefined : async () => ({ outcome: 'no-match' });
      expect(await codeOf(buy(slot)), earlier).toBe('REBUY_UNCHECKED');
      expect(purchases).toBe(0);
      expect((await repo().open(slot, 'live'))).toBeNull();
      expect((await buy(slot, { confirmEarlier: true })).state, earlier).toBe('booked');
      expect(purchases).toBe(1);
    }
  });

  it.skipIf(!available)('a handle this server cannot open never lets a look-up settle a booking', async () => {
    const { booking } = await unknownBooking();
    await db.meta.db.updateTable('adminium_shipping_bookings').set({ handleSealed: 'enc:v1:not-a-sealed-value' }).where('id', '=', booking.id).execute();
    recover = async () => ({ outcome: 'found', shipment: { ...SHIPMENT, id: 'tx_another_parcel' } });
    const looked = await lookUpBooking(deps, (await repo().byId(booking.id))!, resolved(), { fingerprint: FINGERPRINT });
    expect(looked.outcome).toBe('cannot-check');
    expect(looked.booking.state).toBe('unknown');
    expect(asked).toEqual([]);
  });

  it.skipIf(!available)('a label that turned up counts against its day again', async () => {
    const day = '2026-11-27';
    const slot = nextSlot();
    book = async () => {
      throw new Error('no answer');
    };
    const made = await buy(slot, { counted: { day, dailyLabels: 3 } });
    book = async () => SHIPMENT;
    clock += RELEASE_QUIET_MS;
    await releaseBooking(deps, made, 'usr_owner');
    expect(await shippingRepo(db.meta).dayLabels('mft_shop', day)).toBe(0);
    recover = async () => ({ outcome: 'found', shipment: SHIPMENT });
    expect(await codeOf(buy(slot, { counted: { day, dailyLabels: 3 } }))).toBe('ALREADY_BOUGHT');
    expect(await shippingRepo(db.meta).dayLabels('mft_shop', day)).toBe(1);
  });

  it.skipIf(!available)('buys again after a release when the look-up finds nothing, and not when it cannot look', async () => {
    const { slot, booking } = await unknownBooking();
    clock += RELEASE_QUIET_MS;
    await releaseBooking(deps, booking, 'usr_owner');
    recover = async () => {
      throw new Error('503');
    };
    expect(await codeOf(buy(slot))).toBe('CARRIER_UNAVAILABLE');
    expect(purchases).toBe(0);
    recover = async () => ({ outcome: 'no-match' });
    expect((await buy(slot)).state).toBe('booked');
    expect(purchases).toBe(1);
  });

  // ── The day's count ─────────────────────────────────────────────────────

  it.skipIf(!available)('stops at the daily limit under many presses on different orders, and gives back a release', async () => {
    const day = '2026-11-23';
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => codeOf(buy(nextSlot(), { counted: { day, dailyLabels: 3 } }))));
    expect(outcomes.filter((one) => one === 'no refusal')).toHaveLength(3);
    expect(outcomes.filter((one) => one === 'OWNER_BOOKS')).toHaveLength(3);
    expect(purchases).toBe(3);
    expect(await shippingRepo(db.meta).dayLabels('mft_shop', day)).toBe(3);

    const dayTwo = '2026-11-24';
    book = async () => {
      throw new Error('no answer');
    };
    const unknown = await buy(nextSlot(), { counted: { day: dayTwo, dailyLabels: 3 } });
    expect(await shippingRepo(db.meta).dayLabels('mft_shop', dayTwo)).toBe(1);
    clock += RELEASE_QUIET_MS;
    await releaseBooking(deps, unknown, 'usr_owner');
    expect(await shippingRepo(db.meta).dayLabels('mft_shop', dayTwo)).toBe(0);
  });

  it.skipIf(!available)('settling a stale row twice gives the count back once', async () => {
    const day = '2026-11-25';
    const slot = nextSlot();
    deps.faults = { beforeCall: crash };
    await expect(buy(slot, { counted: { day, dailyLabels: 3 } })).rejects.toThrow();
    deps.faults = {};
    expect(await shippingRepo(db.meta).dayLabels('mft_shop', day)).toBe(1);
    const stale = await only(slot);
    clock += RESERVED_STALE_MS;
    await Promise.all([settleStale(deps, stale), settleStale(deps, stale)]);
    expect(await shippingRepo(db.meta).dayLabels('mft_shop', day)).toBe(0);
  });
});

describe('a backup restored', () => {
  const dump = (rows: Record<string, unknown>[], columns: string[], table: string) => {
    const made = { table, columns, kinds: {}, rows: [] as unknown[][] } as unknown as Parameters<typeof commitRows>[0];
    commitRows(made, rows);
    return made;
  };

  it('turns every purchase in flight into unknown, and drops queued shipping jobs', () => {
    const bookings = dump(
      [
        { id: 'a', state: 'reserved', reason: null },
        { id: 'b', state: 'calling', reason: null },
        { id: 'c', state: 'booked', reason: null },
        { id: 'd', state: 'refused', reason: 'address' },
        { id: 'e', state: 'unknown', reason: 'no-answer' },
      ],
      ['id', 'state', 'reason'],
      'adminium_shipping_bookings',
    );
    const jobs = dump(
      [
        { id: 'j1', kind: 'shipping.apply' },
        { id: 'j2', kind: 'payments.record' },
      ],
      ['id', 'kind'],
      'adminium_jobs',
    );
    const tables = new Map([
      ['adminium_shipping_bookings', bookings],
      ['adminium_jobs', jobs],
    ]);
    sanitizeDump(tables as never, { kind: 'full', dialect: 'sqlite', keepApiKeys: true });
    expect(rowsOf(bookings).map((row) => [row['id'], row['state'], row['reason']])).toEqual([
      ['a', 'unknown', 'restored'],
      ['b', 'unknown', 'restored'],
      ['c', 'booked', null],
      ['d', 'refused', 'address'],
      ['e', 'unknown', 'no-answer'],
    ]);
    expect(rowsOf(jobs).map((row) => row['kind'])).toEqual(['payments.record']);
  });
});
