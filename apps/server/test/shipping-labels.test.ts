// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A BOUGHT LABEL'S FILE, on SQLite, Postgres and MySQL, with a carrier that
 * counts every fetch and a store held in memory:
 *
 *  - it is stored as its own file kind, attached to the order, and the carrier's
 *    id or address for it is never kept;
 *  - a failed fetch leaves it owed, says nothing of the carrier, and a retry works;
 *  - only the format it claims to be is stored, and two fetches keep one file;
 *  - the size asked for and the size got are both said;
 *  - 90 days after delivery, or after the last state of one never delivered, the
 *    file goes for good, and the booking and tracking number stay;
 *  - an erased person's labels go, and show in the search and in what stays;
 *  - a carrier's key never reaches a host that only serves files.
 */
import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';

import type { ShipmentDocumentFile, ShippingHttpClient } from '@adminium/add-on-contracts';
import {
  DAY_MS,
  applyMigrations,
  createMysqlMetaDb,
  createPostgresMetaDb,
  createSqliteMetaDb,
  filesRepo,
  postgresInt8AsNumber,
  shippingBookingsRepo,
  shippingRepo,
  usersRepo,
  type MetaDb,
  type ShippingBooking,
} from '@adminium/meta';
import BetterSqlite3 from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FileNotFoundError } from '../src/files/drivers/driver.js';
import type { FileStore } from '../src/files/store.js';
import { findInMeta } from '../src/privacy/meta-sources.js';
import type { PersonFound } from '../src/privacy/sources.js';
import { whatStays } from '../src/privacy/what-stays.js';
import { withKeyOffFileHosts, type ResolvedCarrier } from '../src/shipping/carriers.js';
import {
  DEFAULT_LABEL_SIZE,
  LABEL_KEEP_MS,
  LABEL_MAX_BYTES,
  LABEL_REFETCH_MS,
  checkedFormat,
  eraseLabelsOfRows,
  fetchDocument,
  firstFetch,
  labelSizeOf,
  labelView,
  pdfPageSize,
  storedDocument,
  sweepLabelFiles,
  type LabelDeps,
} from '../src/shipping/labels.js';
import { ShippingRefusal } from '../src/shipping/refusals.js';

type Dialect = 'sqlite' | 'postgres' | 'mysql';
const LEGS: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', Boolean(process.env['TEST_POSTGRES_URL'])],
  ['mysql', Boolean(process.env['TEST_MYSQL_URL'])],
];

const T0 = 1_780_000_000_000;
const CARRIER_WORDS = 'https://deliver.goshippo.com/signed-address-do-not-show?Signature=abc';
const pdf = (box = '0 0 297.64 419.53') => new Uint8Array(Buffer.from(`%PDF-1.4\n1 0 obj <</Type/Page/MediaBox [${box}]>> endobj\n`, 'latin1'));
const LABEL: ShipmentDocumentFile = { kind: 'label', mediaType: 'application/pdf', bytes: pdf() };

async function metaOn(dialect: Dialect): Promise<{ meta: MetaDb; destroy: () => Promise<void> }> {
  const database = `adminium_ship_labels_${randomBytes(4).toString('hex')}`;
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
    const meta = createPostgresMetaDb({ pool: new pg.Pool({ connectionString: url.toString(), max: 4, types: postgresInt8AsNumber(pg as unknown as Parameters<typeof postgresInt8AsNumber>[0]) }) });
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

/** Bytes in memory, under the file's id. */
function memoryStore(): { store: FileStore; held: Map<string, Buffer>; failing: Set<string>; unreadable: { value: boolean } } {
  const held = new Map<string, Buffer>();
  const failing = new Set<string>();
  const unreadable = { value: false };
  const store = {
    write: async (input: { id: string; bytes: Buffer | string }) => {
      const bytes = Buffer.from(input.bytes as Buffer);
      held.set(input.id, bytes);
      return { storageKey: input.id, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), destinationId: null, storage: 'local' };
    },
    head: async (file: { storageKey: string }) => {
      const bytes = held.get(file.storageKey);
      return bytes === undefined ? null : { sizeBytes: bytes.length };
    },
    read: async (file: { storageKey: string }) => Readable.from(held.get(file.storageKey)!),
    open: async (file: { storageKey: string }) => {
      if (unreadable.value) throw new Error('the store is down');
      const bytes = held.get(file.storageKey);
      if (bytes === undefined) throw new FileNotFoundError('no such file');
      return { stream: Readable.from(bytes), sizeBytes: bytes.length };
    },
    remove: async (file: { storageKey: string }) => {
      if (failing.has(file.storageKey)) throw new Error('the disk said no');
      held.delete(file.storageKey);
    },
  } as unknown as FileStore;
  return { store, held, failing, unreadable };
}

const refusal = async (work: Promise<unknown>): Promise<ShippingRefusal> => {
  const error = await work.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ShippingRefusal);
  return error as ShippingRefusal;
};

describe('what a label file is', () => {
  it('takes only the format it claims to be', () => {
    expect(checkedFormat('application/pdf', pdf())).toEqual({ mime: 'application/pdf', extension: 'pdf' });
    expect(checkedFormat('Application/PDF; charset=binary', pdf())).toEqual({ mime: 'application/pdf', extension: 'pdf' });
    expect(checkedFormat('image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toEqual({ mime: 'image/png', extension: 'png' });
    expect(checkedFormat('application/pdf', new TextEncoder().encode('<script>alert(1)</script>'))).toBeNull();
    expect(checkedFormat('text/html', pdf())).toBeNull();
    expect(checkedFormat('image/svg+xml', new TextEncoder().encode('<svg/>'))).toBeNull();
    expect(checkedFormat('application/pdf', new Uint8Array([0x25]))).toBeNull();
  });

  it('reads the page size, either way up, and says when it cannot', () => {
    expect(pdfPageSize(pdf('0 0 595.28 841.89'))).toBe('a4');
    expect(pdfPageSize(pdf('0 0 595 842'))).toBe('a4');
    expect(pdfPageSize(pdf('0 0 419.53 297.64'))).toBe('a6');
    expect(pdfPageSize(pdf('0 0 288 432'))).toBe('4x6');
    expect(pdfPageSize(pdf('0 0 100 100'))).toBe('other');
    expect(pdfPageSize(new TextEncoder().encode('%PDF-1.7 compressed'))).toBeNull();
  });

  it('says a carrier answered with another size only when both are known', () => {
    const base = { state: 'booked', labelRef: 'f', customsRef: null, labelGoneAt: null } as const;
    expect(labelView({ ...base, labelSize: 'a4', labelSizeGot: 'a6' }).sizeDiffers).toBe(true);
    expect(labelView({ ...base, labelSize: 'a4', labelSizeGot: 'a4' }).sizeDiffers).toBe(false);
    expect(labelView({ ...base, labelSize: 'a4', labelSizeGot: null }).sizeDiffers).toBe(false);
  });

  it('hands out a label only while it is plainly booked: a state added later is refused', () => {
    const base = { labelRef: 'f', customsRef: null, labelSize: null, labelSizeGot: null, labelGoneAt: null };
    expect(labelView({ ...base, state: 'booked' }).state).toBe('ready');
    for (const state of ['reserved', 'calling', 'refused', 'unknown', 'released', 'void-requested'] as never[]) {
      expect(labelView({ ...base, state }).state, String(state)).toBe('none');
    }
    expect(labelView({ ...base, state: 'booked', labelRef: null }).state).toBe('owed');
    expect(labelView({ ...base, state: 'booked', labelGoneAt: 1 }).state).toBe('gone');
  });
});

describe('a carrier\'s key and a file host', () => {
  const KEY = 'shippo_test_key_value';
  const seen: { url: string; init: Parameters<ShippingHttpClient>[1] }[] = [];
  const http: ShippingHttpClient = async (url, init) => {
    seen.push({ url, init });
    return { status: 200, headers: { get: () => null }, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const guarded = withKeyOffFileHosts(http, 'shipping-shippo', [KEY]);
  beforeEach(() => {
    seen.length = 0;
  });

  it('sends a bare GET to the file host, whatever the carrier\'s code put on it', async () => {
    await guarded('https://deliver.goshippo.com/label.pdf?Expires=1', { method: 'POST', headers: { Authorization: `ShippoToken ${KEY}`, 'X-Key': KEY, Accept: 'application/pdf' }, body: KEY });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.init).toEqual({ method: 'GET', headers: { accept: 'application/pdf' } });
    expect(JSON.stringify(seen)).not.toContain(KEY);
  });

  it('refuses a file address that holds the key, plainly or escaped', async () => {
    await expect(guarded(`https://deliver.goshippo.com/label.pdf?token=${KEY}`)).rejects.toThrow('may not hold');
    await expect(guarded(`https://deliver.goshippo.com/label.pdf?token=${KEY.replace('_', '%5F')}`)).rejects.toThrow('may not hold');
    expect(seen).toEqual([]);
  });

  it('leaves the API host\'s request alone, and a carrier with no file host', async () => {
    const init = { method: 'GET', headers: { Authorization: `ShippoToken ${KEY}` } };
    await guarded('https://api.goshippo.com/transactions/1', init);
    expect(seen[0]!.init).toEqual(init);
    expect(withKeyOffFileHosts(http, 'shipping-dhl', [KEY])).toBe(http);
  });
});

describe.each(LEGS)('a label\'s file on %s', (dialect, available) => {
  let meta: MetaDb;
  let destroy: () => Promise<void>;
  let memory: ReturnType<typeof memoryStore>;
  let clock = T0;
  let serial = 0;
  let answer: () => unknown;
  let fetches = 0;
  let by = '';
  const logs: unknown[] = [];

  const deps = (): LabelDeps => ({ meta, storage: memory.store, now: () => clock, log: (message, fields) => logs.push({ message, fields }) });
  const resolved = (fetcher = true): ResolvedCarrier =>
    ({
      key: 'shipping-shippo',
      carrier: {
        key: 'shipping-shippo',
        ...(fetcher
          ? {
              fetchDocument: async () => {
                fetches += 1;
                return answer();
              },
            }
          : {}),
      },
    }) as unknown as ResolvedCarrier;
  const repo = () => shippingBookingsRepo(meta);

  /** A bought label, on its own order. */
  async function bought(over: { rowKey?: string; table?: string; mode?: 'live' | 'test'; size?: string } = {}): Promise<ShippingBooking> {
    serial += 1;
    const rowKey = over.rowKey ?? `r${String(serial)}`;
    const made = await repo().reserve(
      {
        installId: 'inst',
        carrierInstallId: 'carrier',
        carrierKey: 'shipping-shippo',
        connectionId: 'conn',
        tableRef: 'orders',
        tableName: over.table ?? 'shop_orders',
        rowKey,
        purpose: 'outbound',
        parcelNumber: serial,
        reference: `ORD-${String(serial)}`,
        mode: over.mode ?? 'live',
        accountFingerprint: 'f'.repeat(64),
        detailsHash: 'd'.repeat(64),
        service: 'Evri 48',
        rateCode: 'evri-48',
        handleSealed: null,
        quotedAmount: '3.10',
        quotedCurrency: 'GBP',
        createdBy: 'user',
        labelSize: over.size ?? 'a4',
      },
      clock,
    );
    if (!made.ok) throw new Error('no slot');
    await repo().move(made.booking.id, ['reserved'], 'booked', { carrierShipmentId: `tx_${String(serial)}`, tracking: `TRK-${String(serial)}`, answeredAt: clock }, clock);
    return (await repo().byId(made.booking.id))!;
  }
  const fileCount = async () => Number((await meta.db.selectFrom('adminium_files').select((eb) => eb.fn.countAll().as('n')).where('kind', '=', 'ship-label').executeTakeFirstOrThrow()).n);

  beforeAll(async () => {
    if (!available) return;
    ({ meta, destroy } = await metaOn(dialect));
    by = (await usersRepo(meta).create({ email: 'packer@labels.example', name: 'Packer', passwordHash: 'not-a-real-hash' })).id;
  }, 120_000);
  afterAll(async () => {
    if (available) await destroy();
  });
  beforeEach(async () => {
    if (!available) return;
    clock = T0;
    fetches = 0;
    logs.length = 0;
    answer = () => LABEL;
    memory = memoryStore();
    await meta.db.deleteFrom('adminium_shipping_bookings').execute();
    await meta.db.deleteFrom('adminium_files').execute();
  });

  it.skipIf(!available)('stores it as its own kind, attached to the order, and keeps no address for it', async () => {
    const booking = await bought({ rowKey: '42' });
    const after = await fetchDocument(deps(), booking, resolved(), { pk: { id: 42 } }, 'label', by);
    expect(after.labelRef).not.toBeNull();
    expect(after.labelSizeGot).toBe('a6');
    expect(labelView(after)).toMatchObject({ state: 'ready', size: 'a4', sizeGot: 'a6', sizeDiffers: true });
    const file = (await filesRepo(meta).findById(after.labelRef!))!;
    expect(file).toMatchObject({ kind: 'ship-label', mime: 'application/pdf', entityConnectionId: 'conn', entityTable: 'shop_orders', entityId: '42', uploadedBy: by });
    expect(file.filename).toBe(`label-${booking.id}.pdf`);
    expect(file.attachedAt).not.toBeNull();
    expect(memory.held.get(file.id)).toEqual(Buffer.from(LABEL.bytes));
    expect(JSON.stringify(after)).not.toContain('goshippo');
  });

  it.skipIf(!available)('marks a sample label in its file name', async () => {
    const after = await fetchDocument(deps(), await bought({ mode: 'test' }), resolved(), { pk: { id: 1 } }, 'label', by);
    expect((await filesRepo(meta).findById(after.labelRef!))!.filename).toMatch(/-sample\.pdf$/);
  });

  it.skipIf(!available)('holds a customs invoice beside the label', async () => {
    const booking = await bought();
    await fetchDocument(deps(), booking, resolved(), { pk: { id: 1 } }, 'label', by);
    answer = () => ({ kind: 'customs-invoice', mediaType: 'application/pdf', bytes: pdf('0 0 595 842') });
    const after = await fetchDocument(deps(), (await repo().byId(booking.id))!, resolved(), { pk: { id: 1 } }, 'customs-invoice', by);
    expect(after.customsRef).not.toBeNull();
    expect(after.customsRef).not.toBe(after.labelRef);
    // The invoice's page is not the label's size.
    expect(after.labelSizeGot).toBe('a6');
    expect(labelView(after).customsInvoice).toBe(true);
  });

  it.skipIf(!available)('a fetch that fails leaves the label owed, says nothing of the carrier, and a retry works', async () => {
    const booking = await bought();
    for (const bad of [
      () => {
        throw new Error(`failed at ${CARRIER_WORDS}`);
      },
      () => ({ kind: 'label', mediaType: 'application/pdf', bytes: new TextEncoder().encode('<html>not a label</html>') }),
      () => ({ kind: 'customs-invoice', mediaType: 'application/pdf', bytes: pdf() }),
      () => ({ kind: 'label', mediaType: 'application/pdf', bytes: new Uint8Array(LABEL_MAX_BYTES + 1).fill(0x25) }),
      () => 'not a file',
    ]) {
      answer = bad;
      const refused = await refusal(fetchDocument(deps(), booking, resolved(), { pk: { id: 1 } }, 'label', by));
      expect(refused.code).toBe('LABEL_FETCH_FAILED');
      expect(JSON.stringify({ message: refused.message, details: refused.details })).not.toContain('goshippo');
    }
    expect(JSON.stringify(logs)).not.toContain('goshippo');
    expect(await fileCount()).toBe(0);
    expect(memory.held.size).toBe(0);
    const owed = (await repo().byId(booking.id))!;
    expect(owed.state).toBe('booked');
    expect(labelView(owed).state).toBe('owed');
    expect((await refusal(storedDocument(deps(), owed, 'label'))).code).toBe('LABEL_OWED');
    answer = () => LABEL;
    expect(labelView(await fetchDocument(deps(), owed, resolved(), { pk: { id: 1 } }, 'label', by)).state).toBe('ready');
  });

  it.skipIf(!available)('the fetch after a purchase never throws', async () => {
    const booking = await bought();
    answer = () => {
      throw new Error('down');
    };
    expect((await firstFetch(deps(), booking, resolved(), { pk: { id: 1 } }, by)).state).toBe('booked');
    const slow = new Promise(() => undefined);
    answer = () => slow;
    expect((await firstFetch(deps(), booking, resolved(), { pk: { id: 1 } }, by, 5)).id).toBe(booking.id);
  });

  it.skipIf(!available)('says plainly when a carrier cannot hand the file over, or no longer keeps it', async () => {
    const booking = await bought();
    expect((await refusal(fetchDocument(deps(), booking, resolved(false), { pk: { id: 1 } }, 'label', by))).code).toBe('LABEL_NOT_OFFERED');
    clock = T0 + LABEL_REFETCH_MS + 1;
    expect((await refusal(fetchDocument(deps(), booking, resolved(), { pk: { id: 1 } }, 'label', by))).code).toBe('LABEL_EXPIRED');
    expect(fetches).toBe(0);
  });

  it.skipIf(!available)('two fetches at once end with one file', async () => {
    const booking = await bought();
    const results = await Promise.all([fetchDocument(deps(), booking, resolved(), { pk: { id: 1 } }, 'label', by), fetchDocument(deps(), booking, resolved(), { pk: { id: 1 } }, 'label', by)]);
    expect(fetches).toBe(2);
    expect(await fileCount()).toBe(1);
    expect(memory.held.size).toBe(1);
    const final = (await repo().byId(booking.id))!;
    expect(results.every((one) => one.labelRef === final.labelRef)).toBe(true);
    expect(memory.held.has(final.labelRef!)).toBe(true);
  });

  it.skipIf(!available)('does not fetch again what it already holds', async () => {
    const after = await fetchDocument(deps(), await bought(), resolved(), { pk: { id: 1 } }, 'label', by);
    fetches = 0;
    expect((await fetchDocument(deps(), after, resolved(), { pk: { id: 1 } }, 'label', by)).labelRef).toBe(after.labelRef);
    expect(fetches).toBe(0);
  });

  it.skipIf(!available)('bytes lost from the disk make the label owed again, and a retry brings it back', async () => {
    const after = await fetchDocument(deps(), await bought(), resolved(), { pk: { id: 1 } }, 'label', by);
    memory.held.delete(after.labelRef!);
    expect((await refusal(storedDocument(deps(), after, 'label'))).code).toBe('LABEL_OWED');
    const owed = (await repo().byId(after.id))!;
    expect(owed.labelRef).toBeNull();
    expect(await filesRepo(meta).findById(after.labelRef!)).toBeNull();
    expect(labelView(await fetchDocument(deps(), owed, resolved(), { pk: { id: 1 } }, 'label', by)).state).toBe('ready');
  });

  it.skipIf(!available)('a store that cannot answer changes nothing: the label is not dropped', async () => {
    const after = await fetchDocument(deps(), await bought(), resolved(), { pk: { id: 1 } }, 'label', by);
    memory.unreadable.value = true;
    expect((await refusal(storedDocument(deps(), after, 'label'))).code).toBe('LABEL_UNREADABLE');
    expect((await repo().byId(after.id))!.labelRef).toBe(after.labelRef);
    expect(memory.held.has(after.labelRef!)).toBe(true);
    expect(await filesRepo(meta).findById(after.labelRef!)).not.toBeNull();
  });

  it.skipIf(!available)('refuses a label on a booking that is no longer plainly booked', async () => {
    const after = await fetchDocument(deps(), await bought(), resolved(), { pk: { id: 1 } }, 'label', by);
    await repo().move(after.id, ['booked'], 'released', { reason: 'test' }, clock);
    const released = (await repo().byId(after.id))!;
    expect((await refusal(storedDocument(deps(), released, 'label'))).code).toBe('LABEL_NOT_AVAILABLE');
    expect((await refusal(fetchDocument(deps(), released, resolved(), { pk: { id: 1 } }, 'label', by))).code).toBe('LABEL_NOT_AVAILABLE');
  });

  it.skipIf(!available)('a fetch that lands on a booking moved on removes its own copy', async () => {
    const booking = await bought();
    answer = async () => {
      await repo().move(booking.id, ['booked'], 'released', { reason: 'test' }, clock);
      return LABEL;
    };
    await fetchDocument(deps(), booking, resolved(), { pk: { id: 1 } }, 'label', by);
    expect(await fileCount()).toBe(0);
    expect(memory.held.size).toBe(0);
  });

  it.skipIf(!available)('asks for A4 until a shop chooses, then for what it chose', async () => {
    expect(await labelSizeOf(meta, 'size-shop')).toBe(DEFAULT_LABEL_SIZE);
    await shippingRepo(meta).setActiveCarrier('size-shop', 'shipping-shippo', by, clock);
    await shippingRepo(meta).setLabelSize('size-shop', '4x6', by, clock);
    expect(await labelSizeOf(meta, 'size-shop')).toBe('4x6');
    // Saving another setting leaves it.
    await shippingRepo(meta).setActiveCarrier('size-shop', 'shipping-dhl', by, clock);
    expect((await shippingRepo(meta).settings('size-shop'))?.labelSize).toBe('4x6');
  });

  // ── 90 days ───────────────────────────────────────────────────────────────

  it.skipIf(!available)('deletes a label 90 days after delivery, and not a moment before', async () => {
    const booking = await fetchDocument(deps(), await bought(), resolved(), { pk: { id: 1 } }, 'label', by);
    const delivered = T0 + 10 * DAY_MS;
    await repo().noteLabelClock(booking.id, delivered);
    clock = delivered + LABEL_KEEP_MS;
    expect((await sweepLabelFiles(deps())).deleted).toBe(0);
    expect(memory.held.size).toBe(1);
    clock += 1;
    expect(await sweepLabelFiles(deps())).toMatchObject({ deleted: 1, failed: 0 });
    expect(memory.held.size).toBe(0);
    expect(await fileCount()).toBe(0);
    const gone = (await repo().byId(booking.id))!;
    expect(gone).toMatchObject({ state: 'booked', labelRef: null, labelGoneWhy: 'kept-90', tracking: booking.tracking, carrierShipmentId: booking.carrierShipmentId });
    expect(gone.labelGoneAt).toBe(clock);
    expect(labelView(gone).state).toBe('gone');
  });

  it.skipIf(!available)('a label never handed over goes 90 days after its purchase', async () => {
    const booking = await fetchDocument(deps(), await bought(), resolved(), { pk: { id: 1 } }, 'label', by);
    clock = T0 + LABEL_KEEP_MS + 1;
    expect((await sweepLabelFiles(deps())).deleted).toBe(1);
    expect((await repo().byId(booking.id))!.labelGoneWhy).toBe('kept-90');
  });

  it.skipIf(!available)('a parcel still moving keeps its label, and an old event cannot shorten the time', async () => {
    const booking = await fetchDocument(deps(), await bought(), resolved(), { pk: { id: 1 } }, 'label', by);
    const lastEvent = T0 + 80 * DAY_MS;
    await repo().noteLabelClock(booking.id, lastEvent);
    await repo().noteLabelClock(booking.id, T0 + DAY_MS);
    expect((await repo().byId(booking.id))!.labelClockAt).toBe(lastEvent);
    clock = T0 + LABEL_KEEP_MS + 1;
    expect((await sweepLabelFiles(deps())).deleted).toBe(0);
    clock = lastEvent + LABEL_KEEP_MS + 1;
    expect((await sweepLabelFiles(deps())).deleted).toBe(1);
  });

  it.skipIf(!available)('a refunded or released label goes too, and an owed one can never be fetched afterwards', async () => {
    const refunded = await fetchDocument(deps(), await bought(), resolved(), { pk: { id: 1 } }, 'label', by);
    await repo().move(refunded.id, ['booked'], 'released', { reason: 'refund' }, clock);
    const owed = await bought();
    clock = T0 + LABEL_KEEP_MS + 1;
    expect((await sweepLabelFiles(deps())).deleted).toBe(1);
    const stillOwed = (await repo().byId(owed.id))!;
    expect(stillOwed.labelGoneWhy).toBe('kept-90');
    expect((await refusal(fetchDocument(deps(), stillOwed, resolved(), { pk: { id: 1 } }, 'label', by))).code).toBe('LABEL_GONE');
    expect(fetches).toBe(1);
  });

  it.skipIf(!available)('nothing fetches a deleted label back, even a fetch that was already running', async () => {
    const booking = await bought();
    answer = async () => {
      await repo().markLabelGone(booking.id, 'erased', clock);
      return LABEL;
    };
    const after = await fetchDocument(deps(), booking, resolved(), { pk: { id: 1 } }, 'label', by);
    expect(after.labelRef).toBeNull();
    expect(await fileCount()).toBe(0);
    expect(memory.held.size).toBe(0);
  });

  it.skipIf(!available)('a removal that fails is tried again by the next sweep', async () => {
    const booking = await fetchDocument(deps(), await bought(), resolved(), { pk: { id: 1 } }, 'label', by);
    memory.failing.add(booking.labelRef!);
    clock = T0 + LABEL_KEEP_MS + 1;
    expect(await sweepLabelFiles(deps())).toMatchObject({ deleted: 0, failed: 1 });
    expect((await repo().byId(booking.id))!.labelRef).toBeNull();
    memory.failing.clear();
    clock += 2 * DAY_MS;
    expect(await sweepLabelFiles(deps())).toMatchObject({ orphans: 1, failed: 0 });
    expect(memory.held.size).toBe(0);
    expect(await fileCount()).toBe(0);
  });

  it.skipIf(!available)('leaves a file just stored and not yet recorded, and takes one left behind', async () => {
    const id = 'file_left_behind';
    await memory.store.write({ id, kind: 'ship-label', filename: 'x.pdf', mime: 'application/pdf', bytes: Buffer.from(pdf()) });
    await filesRepo(meta).create({ id, filename: 'x.pdf', mime: 'application/pdf', sizeBytes: 1, sha256: '0'.repeat(64), kind: 'ship-label', storageKey: id, attachedAt: clock }, clock);
    clock += DAY_MS - 1;
    expect((await sweepLabelFiles(deps())).orphans).toBe(0);
    clock += 2;
    expect((await sweepLabelFiles(deps())).orphans).toBe(1);
    expect(memory.held.size).toBe(0);
  });

  // ── Erasure ───────────────────────────────────────────────────────────────

  it.skipIf(!available)('an erased person\'s labels go, the booking stays, and nothing can fetch them back', async () => {
    const theirs = await fetchDocument(deps(), await bought({ rowKey: '7' }), resolved(), { pk: { id: 7 } }, 'label', by);
    const other = await fetchDocument(deps(), await bought({ rowKey: '8' }), resolved(), { pk: { id: 8 } }, 'label', by);
    const sameKeyOtherTable = await fetchDocument(deps(), await bought({ rowKey: '7', table: 'other_orders' }), resolved(), { pk: { id: 7 } }, 'label', by);
    expect(await eraseLabelsOfRows({ meta, storage: memory.store }, [{ connectionId: 'conn', table: 'shop_orders', key: '7' }], clock)).toEqual({ deleted: 1, failed: 0 });
    const gone = (await repo().byId(theirs.id))!;
    expect(gone).toMatchObject({ labelRef: null, labelGoneWhy: 'erased', tracking: theirs.tracking });
    expect(memory.held.has(theirs.labelRef!)).toBe(false);
    expect((await repo().byId(other.id))!.labelRef).toBe(other.labelRef);
    expect((await repo().byId(sameKeyOtherTable.id))!.labelRef).toBe(sameKeyOtherTable.labelRef);
    expect((await refusal(fetchDocument(deps(), gone, resolved(), { pk: { id: 7 } }, 'label', by))).code).toBe('LABEL_GONE');
    expect((await refusal(storedDocument(deps(), gone, 'label'))).code).toBe('LABEL_GONE');
  });

  it.skipIf(!available)('an erasure also stops a label still owed from ever being fetched', async () => {
    const owed = await bought({ rowKey: '9' });
    await eraseLabelsOfRows({ meta, storage: memory.store }, [{ connectionId: 'conn', table: 'shop_orders', key: '9' }], clock);
    expect((await repo().byId(owed.id))!.labelGoneWhy).toBe('erased');
  });

  it.skipIf(!available)('an erasure closes a purchase still under way, so its label can never be fetched', async () => {
    serial += 1;
    const made = await repo().reserve(
      { installId: 'inst', carrierInstallId: 'carrier', carrierKey: 'shipping-shippo', connectionId: 'conn', tableRef: 'orders', tableName: 'shop_orders', rowKey: '77', purpose: 'outbound', parcelNumber: serial, reference: 'ORD', mode: 'live', accountFingerprint: 'f'.repeat(64), detailsHash: 'd'.repeat(64), service: 'Evri 48', rateCode: 'evri-48', handleSealed: null, quotedAmount: '3.10', quotedCurrency: 'GBP', createdBy: by },
      clock,
    );
    if (!made.ok) throw new Error('no slot');
    await repo().move(made.booking.id, ['reserved'], 'calling', { calledAt: clock }, clock);
    await eraseLabelsOfRows({ meta, storage: memory.store }, [{ connectionId: 'conn', table: 'shop_orders', key: '77' }], clock);
    // The carrier's answer lands afterwards.
    await repo().move(made.booking.id, ['calling'], 'booked', { carrierShipmentId: 'tx_late', tracking: 'TRK-LATE', answeredAt: clock }, clock);
    const landed = (await repo().byId(made.booking.id))!;
    expect(labelView(landed).state).toBe('gone');
    expect((await refusal(fetchDocument(deps(), landed, resolved(), { pk: { id: 77 } }, 'label', by))).code).toBe('LABEL_GONE');
    expect(fetches).toBe(0);
  });

  it.skipIf(!available)('files that keep refusing do not stand in front of the orphans after them', async () => {
    for (let at = 0; at < 205; at += 1) {
      const id = `file_orphan_${String(at).padStart(3, '0')}`;
      await memory.store.write({ id, kind: 'ship-label', filename: 'x.pdf', mime: 'application/pdf', bytes: Buffer.from('x') });
      await filesRepo(meta).create({ id, filename: 'x.pdf', mime: 'application/pdf', sizeBytes: 1, sha256: '0'.repeat(64), kind: 'ship-label', storageKey: id, attachedAt: clock }, clock);
      if (at < 200) memory.failing.add(id);
    }
    clock += 2 * DAY_MS;
    expect(await sweepLabelFiles(deps())).toMatchObject({ orphans: 5, failed: 200 });
  }, 60_000);

  it.skipIf(!available)('the person\'s data lists their parcels once, and says what stays', async () => {
    const booking = await fetchDocument(deps(), await bought({ rowKey: '11' }), resolved(), { pk: { id: 11 } }, 'label', by);
    await bought({ rowKey: '12' });
    const rows = [{ connectionId: 'conn', table: 'shop_orders', tableName: 'orders', key: '11' }];
    const sources = await findInMeta(meta, 'ada@example.test', rows);
    const parcels = sources.find((one) => one.kind === 'shipping-labels')!;
    expect(parcels.keys).toEqual([booking.id]);
    expect(parcels.rows[0]).toMatchObject({ tracking: booking.tracking, labelHeld: true, state: 'booked' });
    expect(JSON.stringify(parcels.rows)).not.toContain(booking.labelRef!);
    // A label is listed here alone, never again as a file on their row.
    expect(sources.find((one) => one.kind === 'files')).toBeUndefined();

    const stays = await whatStays(meta, { address: 'ada@example.test', person: null, sources, lawLinked: [], parcelRows: [] } as PersonFound);
    expect(stays).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'shipping-bookings', reason: 'carrier-records', count: 1, forever: true })]));

    // An order that points at them by a key alone is listed too, and nothing else of it.
    const linked = await bought({ rowKey: '13' });
    const viaKey = await findInMeta(meta, 'ada@example.test', [], { parcelRows: [{ connectionId: 'conn', table: 'shop_orders', tableName: 'orders', key: '13' }] });
    expect(viaKey.find((one) => one.kind === 'shipping-labels')!.keys).toEqual([linked.id]);

    const narrowed = await findInMeta(meta, 'ada@example.test', [], { byAddress: false });
    expect(narrowed.find((one) => one.kind === 'shipping-labels')).toBeUndefined();
  });
});
