// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TRACKING, with the real tables on SQLite, Postgres and MySQL.
 *
 * A webhook is a claim from whoever holds an address. These tests prove what
 * such a claim cannot do: move a parcel backwards, touch another install's or
 * a test booking, free a paid parcel's place, or cause a carrier call.
 */
import { randomBytes } from 'node:crypto';

import type { TrackEvent } from '@adminium/add-on-contracts';
import {
  applyMigrations,
  createMysqlMetaDb,
  createPostgresMetaDb,
  createSqliteMetaDb,
  postgresInt8AsNumber,
  shippingBookingsRepo,
  shippingTrackingRepo,
  type MetaDb,
  type ShippingBooking,
  type ShippingKeyMode,
} from '@adminium/meta';
import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { foreignLabelOn } from '../src/shipping/bookings.js';
import type { ResolvedCarrier } from '../src/shipping/carriers.js';
import { BACKGROUND_CARRIER_CALLS_ENABLED, POLLING_ALLOWED, anyCarrierMayPoll, mayPoll } from '../src/shipping/locks.js';
import { pollInstall, registerShippingPolling, type PollDeps, type PollingJobs } from '../src/shipping/polling.js';
import { sealRateHandle } from '../src/shipping/quotes.js';
import { REFRESH_OPEN_BATCH, REFRESH_OPEN_COOL_MS, REFRESH_PARCEL_COOL_MS, refreshOpenParcels, refreshParcel } from '../src/shipping/refresh.js';
import {
  MAX_WAITING_EVENTS,
  UNMATCHED_KEEP_MS,
  followTrackEvent,
  maskedWebhookAddress,
  newWebhookToken,
  pickUpTrackEvents,
  receiveTrackingWebhook,
  webhookAddress,
  webhookTokenHash,
  type TrackDeps,
  type TrackingWebhookDeps,
} from '../src/shipping/tracking.js';
import { safeTrackingUrl, sameHostUrl, trackStatusOf, trackingReaderFor } from '../src/shipping/tracking-readers.js';

type Dialect = 'sqlite' | 'postgres' | 'mysql';
const LEGS: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', Boolean(process.env['TEST_POSTGRES_URL'])],
  ['mysql', Boolean(process.env['TEST_MYSQL_URL'])],
];

const SECRET = 'a-test-secret-of-a-decent-length-for-hkdf';
const FINGERPRINT = 'f'.repeat(64);
const T0 = 1_780_000_000_000;
const HOUR = 3_600_000;
const INSTALL = 'mft_shippo_one';
const OTHER_INSTALL = 'mft_shippo_two';
const iso = (at: number) => new Date(at).toISOString();

async function metaOn(dialect: Dialect): Promise<{ meta: MetaDb; destroy: () => Promise<void> }> {
  const database = `adminium_ship_track_${randomBytes(4).toString('hex')}`;
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
    const pool = new pg.Pool({ connectionString: url.toString(), max: 6, types: postgresInt8AsNumber(pg as unknown as Record<string, unknown>) });
    // The teardown drops the database WITH (FORCE), which ends a connection a poll or a pickup still holds with
    // 57P01. That ending is expected here; unheard, it would surface as an unhandled error and fail the run.
    const ended = (error: Error & { code?: string }) => {
      if (error.code !== '57P01') throw error;
    };
    pool.on('error', ended);
    pool.on('connect', (client) => client.on('error', ended));
    const meta = createPostgresMetaDb({ pool });
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

const trackBody = (tracking: string, status: string, at: number, over: Record<string, unknown> = {}, top: Record<string, unknown> = {}) =>
  JSON.stringify({
    event: 'track_updated',
    test: false,
    ...top,
    data: {
      carrier: 'evri',
      tracking_number: tracking,
      address_to: { name: 'Ada Quill', street1: '12 Kiln Lane', phone: '+44 7700 900123', email: 'ada@quill.example' },
      tracking_status: { status, status_date: iso(at), status_details: 'Left with Ada Quill at 12 Kiln Lane', location: { city: 'Leeds', zip: 'LS1 4AB' } },
      ...over,
    },
  });

const transactionBody = (id: string, over: Record<string, unknown> = {}, event = 'transaction_updated') =>
  JSON.stringify({ event, test: false, data: { object_id: id, status: 'SUCCESS', tracking_number: 'NEW-1', rate: 'rate-handle-1', object_updated: iso(T0), label_url: 'https://deliver.goshippo.com/signed-label.pdf?Signature=do-not-keep', ...over } });

describe.each(LEGS)('a parcel\'s tracking on %s', (dialect, available) => {
  let db: { meta: MetaDb; destroy: () => Promise<void> };
  let clock = T0;
  let rowNumber = 0;
  let queued: { kind: string; payload: Record<string, unknown> }[] = [];
  let applied: string[] = [];
  let token = '';
  let trackCalls: string[] = [];
  let track: (tracking: string) => Promise<TrackEvent[]>;

  const tracking = () => shippingTrackingRepo(db.meta);
  const bookings = () => shippingBookingsRepo(db.meta);
  const deps = (): TrackDeps => ({ meta: db.meta, secret: SECRET, now: () => clock, enqueueApply: async (id) => void applied.push(id) });
  const hook = (): TrackingWebhookDeps => ({
    meta: db.meta,
    secret: SECRET,
    now: () => clock,
    manifests: { findById: async (id: string) => (id === INSTALL || id === OTHER_INSTALL ? ({ row: { id, kind: 'add-on', manifestKey: 'shipping-shippo' } } as never) : null) },
    enqueue: async (input) => void queued.push(input),
  });
  const carrier = (): ResolvedCarrier =>
    ({
      key: 'shipping-shippo',
      install: { row: { id: INSTALL } },
      carrier: {
        track: async (number: string) => {
          trackCalls.push(number);
          return track(number);
        },
      },
      scrub: (text: string) => text,
    }) as unknown as ResolvedCarrier;

  async function booked(number: string, over: { install?: string; mode?: ShippingKeyMode; state?: 'booked' | 'unknown'; shipment?: string | null; ref?: string; createdAt?: number; url?: string | null } = {}): Promise<ShippingBooking> {
    rowNumber += 1;
    const made = await bookings().reserve(
      {
        installId: 'mft_shop',
        carrierInstallId: over.install ?? INSTALL,
        carrierKey: 'shipping-shippo',
        connectionId: 'conn_one',
        tableRef: 'orders',
        tableName: 'shop_orders',
        rowKey: String(rowNumber),
        purpose: 'outbound',
        parcelNumber: 1,
        reference: `MP-${String(rowNumber)}`,
        mode: over.mode ?? 'live',
        accountFingerprint: FINGERPRINT,
        detailsHash: 'd'.repeat(64),
        service: 'Evri 48',
        rateCode: 'evri-48',
        handleSealed: sealRateHandle(SECRET, { ref: over.ref ?? `rate-${String(rowNumber)}` }),
        quotedAmount: '3.10',
        quotedCurrency: 'GBP',
        createdBy: 'usr_1',
        ...(over.state === 'unknown' ? { state: 'unknown' as const, reason: 'no-answer' } : {}),
      },
      over.createdAt ?? clock,
    );
    if (!made.ok) throw new Error('no booking');
    if (over.state !== 'unknown') {
      await bookings().move(made.booking.id, ['reserved'], 'calling', { calledAt: clock }, clock);
      const shipment = over.shipment === undefined ? `tx-${String(rowNumber)}` : over.shipment;
      await bookings().move(made.booking.id, ['calling'], 'booked', { tracking: number, carrierShipmentId: shipment, trackingUrl: over.url === undefined ? 'https://www.evri.com/track/parcel/1' : over.url, answeredAt: clock }, clock);
    }
    return (await bookings().byId(made.booking.id))!;
  }

  const send = (rawBody: string, installId = INSTALL, sent = token) => receiveTrackingWebhook(hook(), { installId, token: sent, rawBody });
  /** Delivers and follows it, as the job would. */
  async function deliver(rawBody: string, installId = INSTALL, sent = token): Promise<unknown> {
    const before = queued.length;
    expect((await send(rawBody, installId, sent)).status).toBe(200);
    const job = queued[before];
    return job === undefined ? 'nothing stored' : followTrackEvent(deps(), job.payload['eventId'] as string);
  }
  const statusOf = async (id: string) => (await tracking().parcel(id))?.status ?? null;

  beforeAll(async () => {
    if (available) db = await metaOn(dialect);
  }, 120_000);
  afterAll(async () => {
    if (available) await db.destroy();
  });
  beforeEach(async () => {
    if (!available) return;
    clock = T0;
    queued = [];
    applied = [];
    trackCalls = [];
    track = async () => [];
    for (const table of ['adminium_shipping_track_events', 'adminium_shipping_parcels', 'adminium_shipping_track_installs', 'adminium_shipping_bookings'] as const) await db.meta.db.deleteFrom(table).execute();
    const made = newWebhookToken(SECRET, INSTALL);
    token = made.token;
    await tracking().setToken(INSTALL, made.hash, made.hint, clock);
  });

  // ── The door ─────────────────────────────────────────────────────────────

  it.skipIf(!available)('keeps only a keyed hash of the token, bound to its install', async () => {
    const row = await tracking().install(INSTALL);
    expect(token).toHaveLength(43);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row!.tokenHash).toBe(webhookTokenHash(SECRET, INSTALL, token));
    expect(webhookTokenHash(SECRET, OTHER_INSTALL, token)).not.toBe(row!.tokenHash);
    expect(webhookTokenHash('another-secret-of-a-decent-length-here', INSTALL, token)).not.toBe(row!.tokenHash);
  });

  it.skipIf(!available)('answers a wrong token, no token, an unknown install and a token from another install the same way', async () => {
    const number = await booked('TRK-DOOR');
    const body = trackBody('TRK-DOOR', 'DELIVERED', T0);
    const other = newWebhookToken(SECRET, OTHER_INSTALL);
    await tracking().setToken(OTHER_INSTALL, other.hash, other.hint, clock);
    for (const [install, sent] of [[INSTALL, 'wrong'], [INSTALL, ''], ['mft_nobody', token], [INSTALL, other.token]] as const) {
      expect((await send(body, install, sent)).status).toBe(404);
    }
    expect(queued).toEqual([]);
    expect(await statusOf(number.id)).toBeNull();
    expect((await tracking().install(INSTALL))!.lastAt).toBeNull();
    expect((await tracking().install(INSTALL))!.lastBadAt).toBe(T0);
  });

  it.skipIf(!available)('stops answering to an old token the moment a new one is made, and to none once it is cleared', async () => {
    const old = token;
    const next = newWebhookToken(SECRET, INSTALL);
    await tracking().setToken(INSTALL, next.hash, next.hint, clock);
    expect((await send(trackBody('X', 'TRANSIT', T0), INSTALL, old)).status).toBe(404);
    expect((await send(trackBody('X', 'TRANSIT', T0), INSTALL, next.token)).status).toBe(200);
    await tracking().clearToken(INSTALL, clock);
    expect((await send(trackBody('X', 'TRANSIT', T0 + 1), INSTALL, next.token)).status).toBe(404);
  });

  it.skipIf(!available)('builds an https address under Shippo\'s 200 characters, masks it afterwards, and refuses a server with no public one', () => {
    const address = webhookAddress('https://shop.example.com', INSTALL, token)!;
    expect(address).toBe(`https://shop.example.com/api/v1/shipping/webhook/${INSTALL}?token=${token}`);
    expect(address.length).toBeLessThan(200);
    const masked = maskedWebhookAddress('https://shop.example.com', INSTALL, token.slice(-4))!;
    expect(masked).not.toContain(token);
    expect(masked).toContain(`••••${token.slice(-4)}`);
    expect(webhookAddress('http://shop.example.com', INSTALL, token)).toBeNull();
    expect(webhookAddress(null, INSTALL, token)).toBeNull();
    expect(webhookAddress(`https://${'a'.repeat(160)}.example.com`, INSTALL, token)).toBeNull();
  });

  it.skipIf(!available)('refuses a body that is not an event, and counts one it does not use as proof the webhook works', async () => {
    expect((await send('not json')).status).toBe(400);
    expect((await send(JSON.stringify({ hello: 1 }))).status).toBe(400);
    expect((await tracking().install(INSTALL))!.lastAt).toBeNull();
    expect((await send(JSON.stringify({ event: 'batch_created', test: false, data: {} }))).status).toBe(200);
    expect(queued).toEqual([]);
    expect((await tracking().install(INSTALL))!.firstAt).toBe(T0);
  });

  it.skipIf(!available)('stores no address, name, signed link or carrier words from the payload', async () => {
    await booked('TRK-PII');
    await send(trackBody('TRK-PII', 'TRANSIT', T0));
    await send(transactionBody('tx-pii'));
    const rows = await db.meta.db.selectFrom('adminium_shipping_track_events').selectAll().execute();
    expect(rows).toHaveLength(2);
    const stored = JSON.stringify(rows);
    for (const secret of ['Ada', 'Kiln', '7700', 'quill', 'Leeds', 'LS1', 'Signature', 'signed-label']) expect(stored).not.toContain(secret);
  });

  it.skipIf(!available)('tells the carrier to come back when too many events are waiting, and when one cannot be stored', async () => {
    const rows = Array.from({ length: MAX_WAITING_EVENTS }, (_, n) => ({ id: `ste_${String(n)}`, carrierInstallId: INSTALL, dedupeHash: String(n).padStart(64, '0'), kind: 'track', tracking: 'T', transactionId: null, rateRef: null, status: 'TRANSIT', statusAt: T0, trackingUrl: null, state: 'waiting', receivedAt: T0 }));
    for (let at = 0; at < rows.length; at += 200) await db.meta.db.insertInto('adminium_shipping_track_events').values(rows.slice(at, at + 200)).execute();
    expect((await send(trackBody('T', 'TRANSIT', T0 + 5))).status).toBe(503);
    await db.meta.db.deleteFrom('adminium_shipping_track_events').execute();

    const broken = await metaOn('sqlite');
    try {
      const made = newWebhookToken(SECRET, INSTALL);
      await shippingTrackingRepo(broken.meta).setToken(INSTALL, made.hash, made.hint, clock);
      await sql`DROP TABLE adminium_shipping_track_events`.execute(broken.meta.db);
      expect((await receiveTrackingWebhook({ ...hook(), meta: broken.meta }, { installId: INSTALL, token: made.token, rawBody: trackBody('T', 'TRANSIT', T0) })).status).toBe(503);
    } finally {
      await broken.destroy();
    }
  });

  it.skipIf(!available)('still answers 200 with the queue down, and the pickup follows the event', async () => {
    const parcel = await booked('TRK-QUEUE');
    const down: TrackingWebhookDeps = { ...hook(), enqueue: async () => { throw new Error('queue down'); } };
    expect((await receiveTrackingWebhook(down, { installId: INSTALL, token, rawBody: trackBody('TRK-QUEUE', 'TRANSIT', T0) })).status).toBe(200);
    expect(await statusOf(parcel.id)).toBeNull();
    clock += 3 * 60_000;
    expect(await pickUpTrackEvents(deps())).toBe(1);
    expect(await statusOf(parcel.id)).toBe('TRANSIT');
  });

  // ── Dedupe and order ─────────────────────────────────────────────────────

  it.skipIf(!available)('stores one delivery once, however many times it arrives, even at the same moment', async () => {
    await booked('TRK-TWICE');
    const body = trackBody('TRK-TWICE', 'TRANSIT', T0);
    const answers = await Promise.all(Array.from({ length: 6 }, () => send(body)));
    expect(answers.every((one) => one.status === 200)).toBe(true);
    expect(await db.meta.db.selectFrom('adminium_shipping_track_events').select('id').execute()).toHaveLength(1);
    expect(queued).toHaveLength(1);
  });

  it.skipIf(!available)('following one event twice does the work once', async () => {
    const parcel = await booked('TRK-JOB');
    await send(trackBody('TRK-JOB', 'TRANSIT', T0));
    const id = queued[0]!.payload['eventId'] as string;
    expect(await followTrackEvent(deps(), id)).toBe('applied');
    expect(await followTrackEvent(deps(), id)).toBe('done');
    expect(await statusOf(parcel.id)).toBe('TRANSIT');
  });

  it.skipIf(!available)('never lets a late scan overwrite a delivered parcel', async () => {
    const parcel = await booked('TRK-LATE');
    expect(await deliver(trackBody('TRK-LATE', 'DELIVERED', T0 + 5 * HOUR))).toBe('applied');
    expect(await deliver(trackBody('TRK-LATE', 'TRANSIT', T0 + HOUR))).toBe('stale');
    expect(await deliver(trackBody('TRK-LATE', 'TRANSIT', T0 + 9 * HOUR))).toBe('stale');
    expect(await deliver(trackBody('TRK-LATE', 'FAILURE', T0 + 9 * HOUR))).toBe('stale');
    expect(await statusOf(parcel.id)).toBe('DELIVERED');
    expect((await tracking().parcel(parcel.id))!.statusAt).toBe(T0 + 5 * HOUR);
  });

  it.skipIf(!available)('ends at the same status whatever order the events arrive in', async () => {
    const events: [string, number][] = [['PRE_TRANSIT', T0], ['TRANSIT', T0 + HOUR], ['FAILURE', T0 + 2 * HOUR], ['TRANSIT', T0 + 3 * HOUR], ['DELIVERED', T0 + 4 * HOUR]];
    for (const order of [[0, 1, 2, 3, 4], [4, 3, 2, 1, 0], [2, 4, 0, 3, 1], [3, 0, 4, 1, 2]]) {
      const number = `TRK-ORDER-${order.join('')}`;
      const parcel = await booked(number);
      for (const index of order) await deliver(trackBody(number, events[index]![0], events[index]![1]));
      expect(await statusOf(parcel.id), order.join()).toBe('DELIVERED');
      expect((await tracking().parcel(parcel.id))!.statusAt).toBe(T0 + 4 * HOUR);
    }
  });

  it.skipIf(!available)('lets a parcel go back out after a failed delivery, and never back to before it was moving', async () => {
    const parcel = await booked('TRK-FAIL');
    await deliver(trackBody('TRK-FAIL', 'TRANSIT', T0));
    await deliver(trackBody('TRK-FAIL', 'FAILURE', T0 + HOUR));
    expect(await deliver(trackBody('TRK-FAIL', 'TRANSIT', T0 + 2 * HOUR))).toBe('applied');
    expect(await deliver(trackBody('TRK-FAIL', 'PRE_TRANSIT', T0 + 3 * HOUR))).toBe('stale');
    expect(await statusOf(parcel.id)).toBe('TRANSIT');
  });

  it.skipIf(!available)('settles two events racing on one parcel at the furthest one', async () => {
    const parcel = await booked('TRK-RACE');
    await tracking().ensureParcel(parcel.id, INSTALL, clock);
    await Promise.all([tracking().applyStatus(parcel.id, 'TRANSIT', T0 + HOUR, clock), tracking().applyStatus(parcel.id, 'DELIVERED', T0 + 2 * HOUR, clock), tracking().applyStatus(parcel.id, 'PRE_TRANSIT', T0, clock)]);
    expect(await statusOf(parcel.id)).toBe('DELIVERED');
  });

  it.skipIf(!available)('does not let a status the carrier invented replace a real one', async () => {
    const parcel = await booked('TRK-ODD');
    await deliver(trackBody('TRK-ODD', 'TRANSIT', T0));
    expect(await deliver(trackBody('TRK-ODD', 'SOMETHING_NEW', T0 + HOUR))).toBe('stale');
    expect(await statusOf(parcel.id)).toBe('TRANSIT');
  });

  it.skipIf(!available)('lets a real status replace UNKNOWN, whatever its date', async () => {
    const parcel = await booked('TRK-UNK');
    expect(await deliver(trackBody('TRK-UNK', 'UNKNOWN', T0 + 5 * HOUR))).toBe('applied');
    expect(await deliver(trackBody('TRK-UNK', 'DELIVERED', T0 + 3 * HOUR))).toBe('applied');
    expect(await statusOf(parcel.id)).toBe('DELIVERED');
  });

  it.skipIf(!available)('refuses a status dated in the future, which would otherwise block every real one after it', async () => {
    const parcel = await booked('TRK-FUTURE');
    expect(await deliver(trackBody('TRK-FUTURE', 'DELIVERED', T0 + 48 * HOUR))).toBe('bad-date');
    expect(await statusOf(parcel.id)).toBeNull();
    expect(await deliver(trackBody('TRK-FUTURE', 'TRANSIT', T0))).toBe('applied');
  });

  // ── Whose parcel ─────────────────────────────────────────────────────────

  it.skipIf(!available)('skips test events and never touches a test booking, because test numbers repeat', async () => {
    const sample = await booked('SHIPPO_DELIVERED', { mode: 'test' });
    expect(await deliver(trackBody('SHIPPO_DELIVERED', 'DELIVERED', T0, {}, { test: true }))).toBe('nothing stored');
    // A live claim on a number only a test booking holds.
    expect(await deliver(trackBody('SHIPPO_DELIVERED', 'DELIVERED', T0 + 1))).toBe('waiting');
    expect(await statusOf(sample.id)).toBeNull();
    expect((await tracking().install(INSTALL))!.lastAt).toBe(T0);
  });

  it.skipIf(!available)('reads an event that does not plainly say it is live as a test event', async () => {
    const parcel = await booked('TRK-MODE');
    const { test: _test, ...withoutFlag } = JSON.parse(trackBody('TRK-MODE', 'DELIVERED', T0)) as Record<string, unknown>;
    expect(await deliver(JSON.stringify(withoutFlag))).toBe('nothing stored');
    expect(await deliver(trackBody('TRK-MODE', 'DELIVERED', T0, { test: true }))).toBe('nothing stored');
    // A flag that is not exactly false anywhere is not a live event.
    expect(await deliver(trackBody('TRK-MODE', 'DELIVERED', T0 + 1, { test: false }, { test: 'true' }))).toBe('nothing stored');
    expect(await statusOf(parcel.id)).toBeNull();
  });

  it.skipIf(!available)('matches inside its own install only', async () => {
    const other = newWebhookToken(SECRET, OTHER_INSTALL);
    await tracking().setToken(OTHER_INSTALL, other.hash, other.hint, clock);
    const mine = await booked('TRK-SHARED');
    const theirs = await booked('TRK-SHARED', { install: OTHER_INSTALL });
    expect(await deliver(trackBody('TRK-SHARED', 'DELIVERED', T0), OTHER_INSTALL, other.token)).toBe('applied');
    expect(await statusOf(theirs.id)).toBe('DELIVERED');
    expect(await statusOf(mine.id)).toBeNull();
  });

  it.skipIf(!available)('moves neither booking when one number matches two, and flags both', async () => {
    const one = await booked('TRK-DUP', { shipment: null });
    const two = await booked('TRK-DUP', { shipment: null });
    expect(await deliver(trackBody('TRK-DUP', 'DELIVERED', T0))).toBe('ambiguous');
    for (const id of [one.id, two.id]) {
      expect((await tracking().parcel(id))).toMatchObject({ status: null, flag: 'ambiguous' });
    }
  });

  it.skipIf(!available)('prefers the transaction id, and refuses a number that another label is claiming', async () => {
    const first = await booked('TRK-TXN', { shipment: 'tx-a' });
    const second = await booked('TRK-TXN', { shipment: 'tx-b' });
    expect(await deliver(trackBody('TRK-TXN', 'TRANSIT', T0, { transaction: 'tx-b' }))).toBe('applied');
    expect(await statusOf(second.id)).toBe('TRANSIT');
    expect(await statusOf(first.id)).toBeNull();
    const lone = await booked('TRK-LONE', { shipment: 'tx-c' });
    expect(await deliver(trackBody('TRK-LONE', 'TRANSIT', T0, { transaction: 'tx-other' }))).toBe('waiting');
    expect(await statusOf(lone.id)).toBeNull();
  });

  it.skipIf(!available)('keeps an event that outran its booking, applies it once the booking exists, and drops it after an hour', async () => {
    await send(trackBody('TRK-EARLY', 'TRANSIT', T0));
    await send(trackBody('TRK-NEVER', 'TRANSIT', T0));
    const [early] = queued;
    expect(await followTrackEvent(deps(), early!.payload['eventId'] as string)).toBe('waiting');
    const parcel = await booked('TRK-EARLY');
    clock += 3 * 60_000;
    await pickUpTrackEvents(deps());
    expect(await statusOf(parcel.id)).toBe('TRANSIT');
    clock = T0 + UNMATCHED_KEEP_MS + 60_000;
    await pickUpTrackEvents(deps());
    const rows = await db.meta.db.selectFrom('adminium_shipping_track_events').select(['tracking', 'state', 'outcome']).execute();
    expect(rows.find((row) => row.tracking === 'TRK-NEVER')).toMatchObject({ state: 'done', outcome: 'no-match' });
    clock += 25 * HOUR;
    await pickUpTrackEvents(deps());
    expect((await db.meta.db.selectFrom('adminium_shipping_track_events').select('tracking').execute()).map((row) => row.tracking)).not.toContain('TRK-NEVER');
  });

  // ── Purchases ────────────────────────────────────────────────────────────

  it.skipIf(!available)('settles an unknown purchase from a matching transaction, with no call to the carrier', async () => {
    const pending = await booked('', { state: 'unknown', ref: 'rate-handle-1' });
    expect(await deliver(transactionBody('tx-found', { tracking_url_provider: 'https://www.evri.com/track/parcel/NEW-1' }))).toBe('settled');
    const after = (await bookings().byId(pending.id))!;
    expect(after).toMatchObject({ state: 'booked', carrierShipmentId: 'tx-found', tracking: 'NEW-1', trackingUrl: 'https://www.evri.com/track/parcel/NEW-1', reason: null });
    expect(after.openKey).not.toBeNull();
    expect(applied).toEqual([pending.id]);
    expect(trackCalls).toEqual([]);
  });

  it.skipIf(!available)('keeps duplicates already found, does not call the quote the charge, and keeps the carrier token', async () => {
    const pending = await booked('', { state: 'unknown', ref: 'rate-handle-1' });
    const sealed = sealRateHandle(SECRET, { ref: 'rate-handle-1', carrierToken: 'evri' });
    await db.meta.db.updateTable('adminium_shipping_bookings').set({ handleSealed: sealed, duplicates: 1 }).where('id', '=', pending.id).execute();
    expect(await deliver(transactionBody('tx-dup'))).toBe('settled');
    expect(await bookings().byId(pending.id)).toMatchObject({ state: 'booked', duplicates: 1, chargeDiffers: true, amount: null, carrierToken: 'evri' });
  });

  it.skipIf(!available)('never frees a parcel\'s place on a webhook\'s word', async () => {
    const pending = await booked('', { state: 'unknown', ref: 'rate-handle-1' });
    for (const status of ['ERROR', 'REFUNDED', 'REFUNDPENDING', 'QUEUED']) {
      expect(await deliver(transactionBody(`tx-${status}`, { status }))).toBe('ignored');
    }
    const after = (await bookings().byId(pending.id))!;
    expect(after.state).toBe('unknown');
    expect(after.openKey).toBe(pending.openKey);
  });

  it.skipIf(!available)('leaves an unknown purchase alone on another rate, a test transaction, or a rate two purchases share', async () => {
    const pending = await booked('', { state: 'unknown', ref: 'rate-handle-1' });
    expect(await deliver(transactionBody('tx-1', { rate: 'someone-elses-rate' }))).toBe('waiting');
    expect(await deliver(JSON.stringify({ ...JSON.parse(transactionBody('tx-2')), test: true }))).toBe('nothing stored');
    expect((await bookings().byId(pending.id))!.state).toBe('unknown');
    const twin = await booked('', { state: 'unknown', ref: 'rate-handle-1' });
    expect(await deliver(transactionBody('tx-3'))).toBe('ambiguous');
    expect((await bookings().byId(pending.id))!.state).toBe('unknown');
    expect((await bookings().byId(twin.id))!.state).toBe('unknown');
    expect((await tracking().parcel(pending.id))!.flag).toBe('ambiguous');
  });

  it.skipIf(!available)('saves a changed number for staff to act on, sends nothing, and still knows the old one', async () => {
    const parcel = await booked('OLD-1', { shipment: 'tx-num' });
    await deliver(trackBody('OLD-1', 'DELIVERED', T0));
    expect(await deliver(transactionBody('tx-num', { tracking_number: 'NEW-2', tracking_url_provider: 'https://www.evri.com/track/parcel/NEW-2', object_updated: iso(T0 + 1) }))).toBe('new-number');
    const after = (await bookings().byId(parcel.id))!;
    expect(after).toMatchObject({ state: 'booked', tracking: 'NEW-2', trackingUrl: 'https://www.evri.com/track/parcel/NEW-2' });
    // The old label's "delivered" says nothing about the new one.
    expect(await tracking().parcel(parcel.id)).toMatchObject({ status: null, statusRank: -1, oldNumbers: ['OLD-1'] });
    expect((await tracking().parcel(parcel.id))!.numberChangedAt).toBe(T0);
    expect(queued.every((one) => one.kind === 'shipping.track')).toBe(true);
    expect(applied).toEqual([]);
    // The order still shows the old number. That is this label, not one nobody recorded.
    const order = { connectionId: 'conn_one', tableName: 'shop_orders', rowKey: parcel.rowKey, reference: parcel.reference, carrierKey: 'shipping-shippo' };
    const sources = { table: async () => null } as never;
    expect(await foreignLabelOn(db.meta, sources, { ...order, tracking: 'OLD-1' })).toBeNull();
    expect(await foreignLabelOn(db.meta, sources, { ...order, tracking: 'TYPED-IN' })).toBe('TYPED-IN');
    // A late event about the old number, or a late copy of the old transaction, changes nothing.
    expect(await deliver(trackBody('OLD-1', 'TRANSIT', T0 + 2, { transaction: 'tx-num' }))).toBe('old-number');
    expect(await deliver(transactionBody('tx-num', { tracking_number: 'OLD-1', object_updated: iso(T0 - 5) }))).toBe('old-number');
    expect((await bookings().byId(parcel.id))!.tracking).toBe('NEW-2');
  });

  it.skipIf(!available)('holds a scan that arrives before its number change, and applies it after', async () => {
    const parcel = await booked('OLD-E', { shipment: 'tx-early' });
    expect(await deliver(trackBody('NEW-E', 'TRANSIT', T0, { transaction: 'tx-early' }))).toBe('waiting');
    expect(await deliver(transactionBody('tx-early', { tracking_number: 'NEW-E', object_updated: iso(T0 + 1) }))).toBe('new-number');
    clock += 3 * 60_000;
    await pickUpTrackEvents(deps());
    expect(await statusOf(parcel.id)).toBe('TRANSIT');
  });

  it.skipIf(!available)('does not let a late copy of an earlier number change put it back', async () => {
    const parcel = await booked('NUM-A', { shipment: 'tx-order' });
    expect(await deliver(transactionBody('tx-order', { tracking_number: 'NUM-C', object_updated: iso(T0 + 2 * HOUR) }))).toBe('new-number');
    await deliver(trackBody('NUM-C', 'DELIVERED', T0 + 3 * HOUR));
    expect(await deliver(transactionBody('tx-order', { tracking_number: 'NUM-B', object_updated: iso(T0 + HOUR) }))).toBe('old-number');
    expect((await bookings().byId(parcel.id))!.tracking).toBe('NUM-C');
    expect(await statusOf(parcel.id)).toBe('DELIVERED');
    // With no carrier time, nothing says it is newer.
    const { object_updated: _time, ...noTime } = JSON.parse(transactionBody('tx-order', { tracking_number: 'NUM-D' })).data as Record<string, unknown>;
    expect(await deliver(JSON.stringify({ event: 'transaction_updated', test: false, data: noTime }))).toBe('ignored');
    expect((await bookings().byId(parcel.id))!.tracking).toBe('NUM-C');
  });

  it.skipIf(!available)('two number changes at once end on the later one', async () => {
    const parcel = await booked('RACE-A', { shipment: 'tx-two' });
    await Promise.all([
      tracking().changeNumber({ bookingId: parcel.id, carrierInstallId: INSTALL, from: 'RACE-A', to: 'RACE-B', trackingUrl: null, carrierAt: T0 + 1, at: clock }),
      tracking().changeNumber({ bookingId: parcel.id, carrierInstallId: INSTALL, from: 'RACE-A', to: 'RACE-C', trackingUrl: null, carrierAt: T0 + 2, at: clock }),
    ]);
    // Whichever lost is told, and is read again by the pickup against the number that won.
    const after = (await bookings().byId(parcel.id))!.tracking!;
    expect(['RACE-B', 'RACE-C']).toContain(after);
    if (after === 'RACE-B') await tracking().changeNumber({ bookingId: parcel.id, carrierInstallId: INSTALL, from: 'RACE-B', to: 'RACE-C', trackingUrl: null, carrierAt: T0 + 2, at: clock });
    expect((await bookings().byId(parcel.id))!.tracking).toBe('RACE-C');
  });

  it.skipIf(!available)('drops a new number\'s link when it points somewhere other than the label\'s own carrier', async () => {
    const parcel = await booked('OLD-3', { shipment: 'tx-link' });
    await deliver(transactionBody('tx-link', { tracking_number: 'NEW-3', tracking_url_provider: 'https://evil.example.net/phish' }));
    expect((await bookings().byId(parcel.id))!).toMatchObject({ tracking: 'NEW-3', trackingUrl: null });
  });

  // ── A person's Refresh ───────────────────────────────────────────────────

  it.skipIf(!available)('never asks the carrier about a test booking', async () => {
    const sample = await booked('SHIPPO_TRANSIT', { mode: 'test' });
    expect(await refreshParcel(deps(), sample, carrier(), FINGERPRINT)).toBe('test');
    expect(trackCalls).toEqual([]);
    expect(await tracking().parcel(sample.id)).toBeNull();
  });

  it.skipIf(!available)('refreshes one parcel, writes when it checked, and leaves the webhook\'s health alone', async () => {
    const parcel = await booked('TRK-R1');
    track = async () => [
      { at: iso(T0 - 2 * HOUR), status: 'TRANSIT', description: 'Left the depot' },
      { at: iso(T0 - HOUR), status: 'DELIVERED', description: 'Delivered' },
      { at: iso(T0 - 3 * HOUR), status: 'PRE_TRANSIT', description: 'Label made' },
    ];
    expect(await refreshParcel(deps(), parcel, carrier(), FINGERPRINT)).toBe('updated');
    expect(await tracking().parcel(parcel.id)).toMatchObject({ status: 'DELIVERED', statusAt: T0 - HOUR, checkedAt: T0 });
    expect((await tracking().install(INSTALL))!.lastAt).toBeNull();
  });

  it.skipIf(!available)('holds one parcel to one call a minute, whoever presses', async () => {
    const parcel = await booked('TRK-R2');
    expect(await refreshParcel(deps(), parcel, carrier(), FINGERPRINT)).toBe('no-events');
    expect(await refreshParcel(deps(), parcel, carrier(), FINGERPRINT)).toBe('recent');
    expect(trackCalls).toHaveLength(1);
    clock += REFRESH_PARCEL_COOL_MS;
    expect(await refreshParcel(deps(), parcel, carrier(), FINGERPRINT)).toBe('no-events');
    expect(trackCalls).toHaveLength(2);
  });

  it.skipIf(!available)('does not say "checked" when the carrier gave no real answer', async () => {
    const parcel = await booked('TRK-R3');
    track = async () => { throw new Error('down'); };
    expect(await refreshParcel(deps(), parcel, carrier(), FINGERPRINT)).toBe('no-answer');
    expect((await tracking().parcel(parcel.id))!.checkedAt).toBeNull();
    clock += REFRESH_PARCEL_COOL_MS;
    track = async () => [{ at: 'not a date', status: 'x', description: 'y', extra: 1 }] as never;
    expect(await refreshParcel(deps(), parcel, carrier(), FINGERPRINT)).toBe('no-answer');
    expect((await tracking().parcel(parcel.id))!.checkedAt).toBeNull();
  });

  it.skipIf(!available)('does not ask with another account\'s key, and asks nothing for a label not bought', async () => {
    const parcel = await booked('TRK-R4');
    expect(await refreshParcel(deps(), parcel, carrier(), 'e'.repeat(64))).toBe('other-account');
    const pending = await booked('', { state: 'unknown' });
    expect(await refreshParcel(deps(), pending, carrier(), FINGERPRINT)).toBe('not-open');
    expect(trackCalls).toEqual([]);
  });

  it.skipIf(!available)('clears an ambiguous flag only once the number is no longer shared', async () => {
    const parcel = await booked('TRK-R5');
    const twin = await booked('TRK-R5');
    await tracking().flag(parcel.id, INSTALL, 'ambiguous', clock);
    await refreshParcel(deps(), parcel, carrier(), FINGERPRINT);
    expect((await tracking().parcel(parcel.id))!.flag).toBe('ambiguous');
    await bookings().move(twin.id, ['booked'], 'released', {}, clock);
    clock += REFRESH_PARCEL_COOL_MS;
    await refreshParcel(deps(), parcel, carrier(), FINGERPRINT);
    expect((await tracking().parcel(parcel.id))!.flag).toBeNull();
  });

  it.skipIf(!available)('does not write an answer about the old number onto the new one', async () => {
    const parcel = await booked('OLD-R', { shipment: 'tx-race' });
    track = async () => {
      await deliver(transactionBody('tx-race', { tracking_number: 'NEW-R', object_updated: iso(T0 + 1) }));
      return [{ at: iso(T0 - HOUR), status: 'DELIVERED', description: 'Delivered' }];
    };
    expect(await refreshParcel(deps(), parcel, carrier(), FINGERPRINT)).toBe('unchanged');
    expect(trackCalls).toEqual(['OLD-R']);
    expect(await tracking().parcel(parcel.id)).toMatchObject({ status: null, statusRank: -1 });
    expect((await bookings().byId(parcel.id))!.tracking).toBe('NEW-R');
  });

  it.skipIf(!available)('finds a delivery behind a later scan the carrier did not name', async () => {
    const parcel = await booked('TRK-INFO');
    track = async () => [{ at: iso(T0 - 2 * HOUR), status: 'DELIVERED', description: 'Delivered' }, { at: iso(T0 - HOUR), status: 'INFO', description: 'A note' }];
    expect(await refreshParcel(deps(), parcel, carrier(), FINGERPRINT)).toBe('updated');
    expect(await statusOf(parcel.id)).toBe('DELIVERED');
  });

  // ── Refresh open parcels ─────────────────────────────────────────────────

  const refreshAll = (reaches: (booking: ShippingBooking) => Promise<boolean> = async () => true) =>
    refreshOpenParcels(deps(), { carrierInstallId: INSTALL, installId: 'mft_shop', connectionId: 'conn_one', resolved: carrier(), accountFingerprint: FINGERPRINT, reaches });

  it.skipIf(!available)('takes the longest-unchecked first, stops at its batch, says what is left and shows the OLDEST check', async () => {
    const all: ShippingBooking[] = [];
    for (let n = 0; n < REFRESH_OPEN_BATCH + 3; n += 1) all.push(await booked(`TRK-B${String(n)}`));
    const sample = await booked('TRK-SAMPLE', { mode: 'test' });
    const first = await refreshAll();
    expect(first).toMatchObject({ outcome: 'done', checked: REFRESH_OPEN_BATCH, remaining: 3, more: false, neverChecked: 3, oldestCheckedAt: T0 });
    expect(trackCalls).toHaveLength(REFRESH_OPEN_BATCH);
    expect(trackCalls).not.toContain(sample.tracking);

    clock += REFRESH_OPEN_COOL_MS;
    trackCalls = [];
    const second = await refreshAll();
    expect(trackCalls.slice(0, 3).sort()).toEqual(all.slice(-3).map((one) => one.tracking!).sort());
    // Three were not reached this time and were last checked at T0: the list must not read as fresher than that.
    expect(second).toMatchObject({ checked: REFRESH_OPEN_BATCH, remaining: 3, more: false, neverChecked: 0, oldestCheckedAt: T0 });
  });

  it.skipIf(!available)('does not let parcels the carrier keeps failing on hold the front of the line', async () => {
    const stuck: ShippingBooking[] = [];
    for (let n = 0; n < REFRESH_OPEN_BATCH; n += 1) stuck.push(await booked(`TRK-STUCK${String(n)}`));
    const healthy = await booked('TRK-HEALTHY');
    track = async (number) => {
      if (number.startsWith('TRK-STUCK')) throw new Error('down');
      return [];
    };
    expect(await refreshAll()).toMatchObject({ failed: REFRESH_OPEN_BATCH, checked: 0 });
    clock += REFRESH_OPEN_COOL_MS;
    trackCalls = [];
    await refreshAll();
    expect(trackCalls[0]).toBe(healthy.tracking);
  });

  it.skipIf(!available)('does not spend the cool-down for someone with nothing to refresh, and finds parcels past the first page', async () => {
    const all: ShippingBooking[] = [];
    for (let n = 0; n < 105; n += 1) all.push(await booked(`TRK-P${String(n)}`));
    const last = all[all.length - 1]!;
    expect(await refreshAll(async () => false)).toMatchObject({ outcome: 'done', checked: 0, more: false });
    expect((await tracking().install(INSTALL))!.refreshedAt).toBeNull();
    expect(await refreshAll(async (booking) => booking.id === last.id)).toMatchObject({ outcome: 'done', checked: 1, more: false });
    expect(trackCalls).toEqual([last.tracking]);
  });

  it.skipIf(!available)('runs once per cool-down for an install', async () => {
    await booked('TRK-C1');
    expect((await refreshAll()).outcome).toBe('done');
    trackCalls = [];
    const again = await refreshAll();
    expect(again).toMatchObject({ outcome: 'recent', checked: 0, retryAt: T0 + REFRESH_OPEN_COOL_MS });
    expect(trackCalls).toEqual([]);
  });

  it.skipIf(!available)('stops at the carrier\'s first "too many requests"', async () => {
    for (let n = 0; n < 5; n += 1) await booked(`TRK-L${String(n)}`);
    track = async () => {
      throw Object.assign(new Error('slow down'), { name: 'CarrierError', code: 'rate_limited', carrierMessage: 'Too many' });
    };
    expect(await refreshAll()).toMatchObject({ outcome: 'rate-limited', checked: 0 });
    expect(trackCalls).toHaveLength(1);
  });

  it.skipIf(!available)('asks only about parcels this person reaches, and counts only those', async () => {
    const mine = await booked('TRK-MINE');
    await booked('TRK-THEIRS');
    const result = await refreshAll(async (booking) => booking.id === mine.id);
    expect(trackCalls).toEqual(['TRK-MINE']);
    expect(result).toMatchObject({ checked: 1, remaining: 0, neverChecked: 0 });
  });

  it.skipIf(!available)('leaves out delivered parcels and old ones', async () => {
    const done = await booked('TRK-DONE');
    await tracking().ensureParcel(done.id, INSTALL, clock);
    await tracking().applyStatus(done.id, 'DELIVERED', T0 - HOUR, clock);
    await booked('TRK-ANCIENT', { createdAt: T0 - 91 * 24 * HOUR });
    await booked('TRK-OPEN');
    await refreshAll();
    expect(trackCalls).toEqual(['TRK-OPEN']);
  });

  // ── The lock ─────────────────────────────────────────────────────────────

  it.skipIf(!available)('cannot poll while its lock is off, even with a stored switch and a due parcel', async () => {
    expect(BACKGROUND_CARRIER_CALLS_ENABLED).toBe(false);
    expect(POLLING_ALLOWED['shipping-shippo']).toBe(false);
    expect(mayPoll('shipping-shippo')).toBe(false);
    expect(mayPoll('constructor')).toBe(false);
    expect(anyCarrierMayPoll()).toBe(false);

    await booked('TRK-POLL');
    await tracking().setPolling(INSTALL, true, clock - 1);
    let keyRead = 0;
    const poll: PollDeps = {
      meta: db.meta,
      secret: SECRET,
      now: () => clock + 7 * HOUR,
      manifests: {
        findById: async () => ({ row: { id: INSTALL, kind: 'add-on', manifestKey: 'shipping-shippo', scopeKey: 'conn_one' } }) as never,
        findInScope: async () => { keyRead += 1; return null; },
        getCredential: async () => { keyRead += 1; return null; },
      },
      carrierDeps: { runtime: () => { keyRead += 1; return null; }, manifests: { findInScope: async () => { keyRead += 1; return null; }, getCredential: async () => { keyRead += 1; return null; } }, httpFor: () => { throw new Error('never'); } },
    };
    expect(await pollInstall(poll, INSTALL)).toEqual({ ran: false, reason: 'locked' });
    expect(keyRead).toBe(0);
    expect(trackCalls).toEqual([]);
  });

  it.skipIf(!available)('registers no job and no schedule while the lock is off', () => {
    const registered: string[] = [];
    const jobs = {
      registry: { registerJobHandler: (kind: string) => void registered.push(kind) },
      scheduler: { registerSchedule: (name: string) => void registered.push(name) },
      enqueue: async () => registered.push('enqueued'),
    } as unknown as PollingJobs;
    expect(registerShippingPolling(jobs, {} as PollDeps)).toBe(false);
    expect(registered).toEqual([]);
  });
});

describe('what a carrier\'s event can carry', () => {
  it('reads Shippo\'s statuses, and treats anything else as unknown', () => {
    expect(trackStatusOf('delivered')).toBe('DELIVERED');
    expect(trackStatusOf('in transit')).toBe('TRANSIT');
    expect(trackStatusOf('PRE_TRANSIT')).toBe('PRE_TRANSIT');
    expect(trackStatusOf('constructor')).toBe('UNKNOWN');
    expect(trackStatusOf('')).toBe('UNKNOWN');
  });

  it('has a reader only for a carrier with a webhook', () => {
    expect(trackingReaderFor('shipping-shippo')).not.toBeNull();
    expect(trackingReaderFor('shipping-dhl')).toBeNull();
    expect(trackingReaderFor('constructor')).toBeNull();
  });

  it.each([
    ['http://www.evri.com/track'],
    ['https://user:pass@www.evri.com/track'],
    ['https://www.evri.com:8443/track'],
    ['https://127.0.0.1/track'],
    ['https://[::1]/track'],
    ['https://2130706433/track'],
    ['https://localhost/track'],
    ['https://printer.local/track'],
    ['https://admin.internal/track'],
    ['javascript:alert(1)'],
    ['not a url'],
    [`https://www.evri.com/${'a'.repeat(520)}`],
    [42],
    [null],
  ])('refuses %s as a tracking link', (value) => {
    expect(safeTrackingUrl(value)).toBeNull();
  });

  it('keeps a real carrier page, and a new one only on the same host', () => {
    expect(safeTrackingUrl('https://www.evri.com/track/parcel/1')).toBe('https://www.evri.com/track/parcel/1');
    expect(sameHostUrl('https://www.evri.com/a', 'https://www.evri.com/b')).toBe('https://www.evri.com/a');
    expect(sameHostUrl('https://evil.example.net/a', 'https://www.evri.com/b')).toBeNull();
    expect(sameHostUrl('https://www.evri.com/a', null)).toBeNull();
  });
});
