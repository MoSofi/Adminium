// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A refund on a label, on all three databases: written before the call, a
 * repeat asks nothing, and each of the three endings does what it must.
 */
import { randomBytes } from 'node:crypto';

import type { CancelResult, Rate, Shipment } from '@adminium/add-on-contracts';
import { CarrierError } from '@adminium/add-on-contracts';
import { applyMigrations, createMysqlMetaDb, createPostgresMetaDb, createSqliteMetaDb, postgresInt8AsNumber, shippingBookingsRepo, shippingTrackingRepo, type MetaDb, type ShippingBooking, type ShippingSlot } from '@adminium/meta';
import BetterSqlite3 from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { attentionCutoffs, attentionReasons } from '../src/shipping/attention.js';
import { bookingView, buyLabel, type BookingDeps, type PurchaseInput } from '../src/shipping/bookings.js';
import type { ResolvedCarrier } from '../src/shipping/carriers.js';
import { addWorkingDays, claimByOf, refundView } from '../src/shipping/refund-view.js';
import { checkRefund, requestRefund, settleRefund } from '../src/shipping/refunds.js';
import { ShippingRefusal } from '../src/shipping/refusals.js';

type Dialect = 'sqlite' | 'postgres' | 'mysql';
const LEGS: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', Boolean(process.env['TEST_POSTGRES_URL'])],
  ['mysql', Boolean(process.env['TEST_MYSQL_URL'])],
];

const FINGERPRINT = 'f'.repeat(64);
const T0 = Date.UTC(2026, 7, 17, 10);
const DAY = 24 * 60 * 60_000;
const RATE: Rate = { code: 'evri-48', service: 'Evri 48', amount: 3.1, amountDecimal: '3.10', currency: 'GBP', ref: 'rate-1', carrierToken: 'evri' };
const SHIPMENT: Shipment = { id: 'tx_1', tracking: 'TRK-1', labelFileId: 'file-1', rate: RATE, carrier: 'Evri', carrierToken: 'evri' };

async function metaOn(dialect: Dialect): Promise<{ meta: MetaDb; destroy: () => Promise<void> }> {
  const database = `adminium_ship_refund_${randomBytes(4).toString('hex')}`;
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
    const meta = createPostgresMetaDb({ pool: new pg.Pool({ connectionString: url.toString(), max: 4, types: postgresInt8AsNumber(pg as unknown as Record<string, unknown>) }) });
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
  const meta = createMysqlMetaDb({ pool: createPool({ uri: url.toString(), connectionLimit: 4 }) });
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

describe('the dates a refund shows', () => {
  it('counts 14 working days from the request, and 30 days to the end of the last day', () => {
    expect(new Date(addWorkingDays(Date.UTC(2026, 7, 18, 9), 14)).toISOString().slice(0, 10)).toBe('2026-09-07');
    expect(new Date(claimByOf({ answeredAt: T0, createdAt: T0 })).toISOString()).toBe('2026-09-16T23:59:59.999Z');
  });
});

describe.each(LEGS)('a refund on a label, with the booking table on %s', (dialect, available) => {
  let db: { meta: MetaDb; destroy: () => Promise<void> };
  let clock = T0;
  let row = 0;
  let queued: string[] = [];
  let asks = 0;
  let statusAsks = 0;
  let answer: () => Promise<CancelResult>;
  let status: () => Promise<CancelResult>;
  let deps: BookingDeps;

  const repo = () => shippingBookingsRepo(db.meta);
  const resolved = (over: Record<string, unknown> = {}): ResolvedCarrier =>
    ({
      key: 'carrier-one',
      install: { row: { id: 'mft_carrier' } },
      scrub: (text: string) => text.replace('SECRET', '[hidden]'),
      carrier: {
        key: 'carrier-one',
        book: async () => ({ ...SHIPMENT, id: `tx_${row}`, tracking: `TRK-${row}` }),
        cancel: async () => undefined,
        requestCancel: async () => {
          asks += 1;
          return answer();
        },
        cancelStatus: async () => {
          statusAsks += 1;
          return status();
        },
        ...over,
      },
    }) as unknown as ResolvedCarrier;
  const account = { mode: 'live' as const, fingerprint: FINGERPRINT };
  const slotOf = (rowKey: string): ShippingSlot & { tableName: string } => ({ installId: 'mft_shop', connectionId: 'conn_one', tableRef: 'orders', tableName: 'shop_orders', rowKey, purpose: 'outbound', parcelNumber: 1 });
  const input = (slot: ShippingSlot & { tableName: string }, over: Partial<PurchaseInput> = {}): PurchaseInput => ({
    slot,
    reference: `NL-${slot.rowKey}`,
    resolved: resolved(),
    account,
    quoteId: 'shq_none',
    detailsHash: 'd'.repeat(64),
    rate: RATE,
    details: { parcel: { weightKg: 1, lengthCm: 1, widthCm: 1, heightCm: 1, contents: 'Books' }, from: { name: 'a', lines: ['b'], city: 'c', postcode: 'd', country: 'GB' }, to: { name: 'e', lines: ['f'], city: 'g', postcode: 'h', country: 'GB' } },
    by: 'usr_packer',
    counted: null,
    ...over,
  });
  const bought = async (): Promise<ShippingBooking> => {
    row += 1;
    return buyLabel(deps, input(slotOf(String(row))), false);
  };
  const codeOf = async (work: Promise<unknown>): Promise<string> => {
    try {
      await work;
      return 'no refusal';
    } catch (error) {
      if (error instanceof ShippingRefusal) return error.code;
      throw error;
    }
  };

  beforeAll(async () => {
    if (available) db = await metaOn(dialect);
  }, 120_000);
  afterAll(async () => {
    if (available) await db.destroy();
  });
  beforeEach(() => {
    clock = T0;
    queued = [];
    asks = 0;
    statusAsks = 0;
    answer = async () => ({ state: 'pending' });
    status = async () => ({ state: 'pending' });
    if (available) {
      deps = {
        meta: db.meta,
        secret: 'a-test-secret-of-a-decent-length-for-hkdf',
        now: () => clock,
        enqueueApply: async (id) => {
          queued.push(id);
        },
      };
    }
  });

  it.skipIf(!available)('holds the parcel and blocks the label while pending, and a second press asks nothing', async () => {
    const label = await bought();
    clock += DAY;
    const first = await requestRefund(deps, label, resolved(), account, 'usr_owner');
    expect(first).toMatchObject({ outcome: 'pending', booking: { state: 'voiding', voidState: 'pending', voidBy: 'usr_owner', voidAskedAt: clock } });
    expect(first.booking.openKey).not.toBeNull();
    expect(bookingView(first.booking, clock, false).label.state).toBe('none');
    const again = await requestRefund(deps, first.booking, resolved(), account, 'usr_other');
    expect(again.outcome).toBe('pending');
    expect(asks).toBe(1);
    expect(await codeOf(buyLabel(deps, input(slotOf(String(row))), false))).toBe('BOOKING_EXISTS');
  });

  it.skipIf(!available)('a refund that lands frees the parcel, moves the keeping clock and queues the tidy-up', async () => {
    const label = await bought();
    await repo().note(label.id, ['booked'], { appliedAt: clock }, clock);
    answer = async () => ({ state: 'refunded', amountDecimal: '3.10', currency: 'gbp' });
    clock += DAY * 8;
    const done = await requestRefund(deps, (await repo().byId(label.id))!, resolved(), account, 'usr_owner');
    expect(done).toMatchObject({ outcome: 'refunded', booking: { state: 'voided', openKey: null, voidState: 'refunded', voidAmount: '3.10', voidCurrency: 'GBP', labelClockAt: clock, voidSettledAt: clock } });
    expect(queued).toContain(label.id);
    // Still owed its tidy-up until the job has run, so a queue that was down finds it.
    expect((await repo().unapplied(clock + 1)).some((one) => one.id === label.id)).toBe(true);
  });

  it.skipIf(!available)('a refused refund puts the label back, keeps its reason, and does not offer a scanned label again', async () => {
    const label = await bought();
    answer = async () => ({ state: 'refused', carrierMessage: 'Label was scanned by the carrier. SECRET' });
    clock += DAY;
    const done = await requestRefund(deps, label, resolved(), account, 'usr_owner');
    expect(done).toMatchObject({ outcome: 'refused', booking: { state: 'booked', voidState: 'refused', labelClockAt: clock } });
    expect(done.booking.openKey).not.toBeNull();
    expect(done.booking.voidMessage).toBe('Label was scanned by the carrier. [hidden]');
    const view = refundView(done.booking, null, clock, false)!;
    expect(view).toMatchObject({ state: 'refused', scanned: true, canRequest: false });
    expect(refundView(done.booking, null, clock, true)!.message).toBeNull();
    expect(bookingView(done.booking, clock, false).label.state).not.toBe('none');
    expect(await codeOf(requestRefund(deps, done.booking, resolved(), account, 'usr_owner'))).toBe('LABEL_SCANNED');
    expect(attentionReasons(done.booking, null, clock)).toContain('refund-refused');
    expect(attentionReasons(done.booking, null, clock + 15 * DAY)).not.toContain('refund-refused');
  });

  it.skipIf(!available)('a clear refusal thrown by the carrier is a refusal too', async () => {
    const label = await bought();
    answer = async () => {
      throw new CarrierError({ code: 'refund_refused', carrierMessage: 'Too old for this carrier', outcome: 'refused' });
    };
    expect(await requestRefund(deps, label, resolved(), account, 'usr_owner')).toMatchObject({ outcome: 'refused', booking: { state: 'booked', voidState: 'refused' } });
  });

  it.skipIf(!available)('a lost answer stays requested, and the check sends it again until it is heard', async () => {
    const label = await bought();
    answer = async () => {
      throw new Error('socket hang up');
    };
    const first = await requestRefund(deps, label, resolved(), account, 'usr_owner');
    expect(first).toMatchObject({ outcome: 'requested', booking: { state: 'voiding', voidState: 'requested', voidHeardAt: null } });
    expect(refundView(first.booking, null, clock, false)!.unconfirmed).toBe(true);
    expect((await checkRefund(deps, first.booking, resolved(), account)).outcome).toBe('no-answer');
    expect(asks).toBe(2);
    answer = async () => ({ state: 'pending', reference: 'rf_1' });
    const heard = await checkRefund(deps, first.booking, resolved(), account);
    expect(heard).toMatchObject({ outcome: 'pending', booking: { voidReference: 'rf_1' } });
    expect(heard.booking.voidHeardAt).not.toBeNull();
    expect(asks).toBe(3);
    status = async () => ({ state: 'refunded' });
    expect((await checkRefund(deps, heard.booking, resolved(), account)).booking.state).toBe('voided');
    expect(asks).toBe(3);
    expect(statusAsks).toBe(1);
  });

  it.skipIf(!available)('a check on another account says so and settles nothing', async () => {
    const label = await bought();
    const asked = await requestRefund(deps, label, resolved(), account, 'usr_owner');
    expect((await checkRefund(deps, asked.booking, resolved(), { fingerprint: 'e'.repeat(64) })).outcome).toBe('other-account');
    expect(statusAsks).toBe(0);
    expect((await repo().byId(label.id))!.state).toBe('voiding');
  });

  it.skipIf(!available)('refuses past the claim date, on a scan, and on another account, before asking the carrier', async () => {
    const late = await bought();
    clock = claimByOf(late) + 1;
    expect(await codeOf(requestRefund(deps, late, resolved(), account, 'usr_owner'))).toBe('REFUND_TOO_LATE');
    clock = T0;
    const scanned = await bought();
    await shippingTrackingRepo(db.meta).ensureParcel(scanned.id, scanned.carrierInstallId, clock);
    await shippingTrackingRepo(db.meta).applyStatus(scanned.id, 'TRANSIT', clock, clock, null);
    expect(await codeOf(requestRefund(deps, scanned, resolved(), account, 'usr_owner'))).toBe('LABEL_SCANNED');
    const other = await bought();
    expect(await codeOf(requestRefund(deps, other, resolved(), { fingerprint: 'e'.repeat(64) }, 'usr_owner'))).toBe('REFUND_OTHER_ACCOUNT');
    expect(asks).toBe(0);
    expect((await repo().byId(other.id))!.state).toBe('booked');
  });

  it.skipIf(!available)('booking a replacement needs the confirm, and a later refusal counts both labels as paid', async () => {
    const label = await bought();
    const asked = await requestRefund(deps, label, resolved(), account, 'usr_owner');
    const slot = slotOf(String(row));
    expect(await codeOf(buyLabel(deps, input(slot), false))).toBe('BOOKING_EXISTS');
    const replacement = await buyLabel(deps, input(slot, { replaceRefunding: true }), false);
    expect(replacement.state).toBe('booked');
    expect((await repo().byId(asked.booking.id))!).toMatchObject({ state: 'voiding', openKey: null });
    const refused = await settleRefund(deps, asked.booking.id, 'refused', { message: 'Label was used' });
    expect(refused).toMatchObject({ state: 'booked', openKey: null, voidState: 'refused' });
    expect((await repo().byId(replacement.id))!.duplicates).toBe(1);
  });

  it.skipIf(!available)('a refused refund takes its place back when nothing replaced it', async () => {
    const label = await bought();
    const asked = await requestRefund(deps, label, resolved(), account, 'usr_owner');
    await repo().letGoForReplacement(asked.booking.id, clock);
    const refused = await settleRefund(deps, asked.booking.id, 'refused', {});
    expect(refused.openKey).not.toBeNull();
  });

  it.skipIf(!available)('a pending refund keeps the carrier key in place and is listed for a person', async () => {
    const label = await bought();
    const asked = await requestRefund(deps, label, resolved(), account, 'usr_owner');
    expect((await repo().unresolved('mft_carrier')).some((one) => one.id === label.id)).toBe(true);
    expect(attentionReasons(asked.booking, null, clock)).toContain('refund-pending');
    const ids = await shippingTrackingRepo(db.meta).attentionIds({ connectionId: 'conn_one', installId: 'mft_shop', ...attentionCutoffs(clock) }, 500);
    expect(ids).toContain(label.id);
    const open = await shippingTrackingRepo(db.meta).openParcels({ carrierInstallId: 'mft_carrier' }, clock - DAY, 500);
    expect(open.some((one) => one.bookingId === label.id)).toBe(true);
    await settleRefund(deps, label.id, 'refunded', {});
  });
});
