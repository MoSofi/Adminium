// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN OPERATOR'S MYSQL `TIMESTAMP`, ON A SERVER WHOSE ZONE IS NOT UTC.
 *
 * A `TIMESTAMP` column holds an instant but speaks its SESSION's zone, and
 * Adminium's connections used to take whatever zone the database server
 * handed them. So: an ISO instant written through the API was refused outright
 * (MySQL's strict mode takes no `T` and no `Z`); an instant compared with one
 * — "still ahead", a booking window, a dashboard filter — was read in the
 * server's zone, off by its offset; and a value read back came out shifted by
 * the server's offset less this process's.
 *
 * Every connection here starts in UTC−4 (a listener on the driver's pool runs
 * `SET time_zone = '-04:00'` before anything else), the way it would against a
 * server configured that way. The adapter must put it back in UTC. The table
 * has a real `TIMESTAMP(3)` beside a `DATETIME(3)`: the second keeps
 * Adminium's zone-less convention — this process's own wall clock — and must
 * not move.
 *
 * Nothing asserted depends on this process's zone, so the file means the same
 * under any TZ. Run it under a few to see that it does:
 *
 *   TZ=Europe/Berlin TEST_MYSQL_URL=mysql://root@127.0.0.1:3306 npx vitest run test/mysql-timestamp-instants.test.ts
 *   TZ=America/New_York … ; TZ=UTC …
 *
 * Gated on TEST_MYSQL_URL (`''` counts as absent), like every MySQL leg here.
 */
import { randomBytes } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DatabaseModel } from '@adminium/engine';
import type { Outbox } from '@adminium/manifest';
import { emailTemplatesRepo, overridesRepo, settingsRepo, snapshotsRepo } from '@adminium/meta';

import { decryptSecret, encryptSecret } from '../src/config/secrets.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { compileFilter, type RecordFilter } from '../src/crud/filters.js';
import { SnapshotView, type ResolvedTable } from '../src/crud/identifiers.js';
import { fetchByPk } from '../src/crud/records.js';
import { createWriteService, insertRow, updateRows } from '../src/crud/write-service.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { createOutboxSender } from '../src/outbox/sender.js';
import { resolveDefaults } from '../src/public-api/generate.js';
import { afterNow, aheadWithin, fromToday } from '../src/public-api/relative-filters.js';
import { asChecked } from './checked.js';
import { asUser, buildDataTestApp, createConnectionViaApi, introspectViaApi, type DataTestContext } from './connections-helpers.js';
import { TEST_SECRET } from './helpers.js';

const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;

/** The zone every connection starts in before the adapter has its say. */
const SERVER_ZONE = '-04:00';

/** "Now", for every question asked here: 23:00 UTC, 19:00 in the server's zone. */
const NOW = new Date('2026-07-27T23:00:00.000Z');

/** Seeded instants, written with an explicit UTC session so they are the truth. */
const TRUTH = {
  early: '2026-07-27 21:30:00.000',
  middle: '2026-07-27 22:30:00.000',
  late: '2026-07-27 23:30:00.000',
} as const;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** This process's wall clock for an instant, as a `DATETIME(3)` spells it back. */
function localWall(at: Date): string {
  return (
    `${pad(at.getFullYear(), 4)}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ` +
    `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}`
  );
}

/**
 * The driver the adapter's query engine uses (its own copy under pnpm), with
 * every pool it makes starting its connections in {@link SERVER_ZONE}. The
 * listener is PREPENDED, so it runs before anything the adapter adds.
 */
type CreatePool = (...args: unknown[]) => EventEmitter & { end(cb?: () => void): void };
const adapterMysql = createRequire(new URL('../../../packages/adapter-mysql/package.json', import.meta.url))('mysql2') as {
  createPool: CreatePool;
};
const realCreatePool = adapterMysql.createPool;

function startInServerZone(): void {
  adapterMysql.createPool = (...args: unknown[]) => {
    const pool = realCreatePool.apply(adapterMysql, args);
    pool.prependListener('connection', (connection: { query(sql: string, cb: (error: Error | null) => void): void }) => {
      connection.query(`SET time_zone = '${SERVER_ZONE}'`, () => {});
    });
    return pool;
  };
}

describe.skipIf(MYSQL_URL === undefined)(`a MySQL TIMESTAMP on a server in UTC${SERVER_ZONE}`, () => {
  const database = `adminium_test_tsz_${randomBytes(4).toString('hex')}`;
  const tableId = `${database}.bookings`;
  const url = `bookings`;
  let admin: import('mysql2/promise').Connection;
  let t: DataTestContext;
  let connId: string;
  let table: ResolvedTable;
  let view: SnapshotView;
  const ids: Record<keyof typeof TRUTH, number> = { early: 0, middle: 0, late: 0 };

  const raw = async <R>(statement: string, params: unknown[] = []): Promise<R[]> => {
    const [rows] = await admin.query(statement, params);
    return rows as R[];
  };

  /** What the column holds, independent of any session zone. */
  const storedEpoch = async (id: number): Promise<number | null> => {
    const [row] = await raw<{ at: string | null }>(`SELECT UNIX_TIMESTAMP(starts_at) * 1000 AS at FROM \`${database}\`.bookings WHERE id = ?`, [id]);
    return row?.at === null || row?.at === undefined ? null : Number(row.at);
  };
  const storedWall = async (id: number): Promise<string | null> => {
    const [row] = await raw<{ wall: string | null }>(`SELECT CAST(noted_at AS CHAR) AS wall FROM \`${database}\`.bookings WHERE id = ?`, [id]);
    return row?.wall ?? null;
  };

  const data = async () => (await t.manager.data(connId)).db;

  /** The ids a filter answers, among the seeded rows — through the same compiler every route uses. */
  const matching = async (filter: RecordFilter): Promise<number[]> => {
    const db = await data();
    const rows = await db
      .selectFrom(tableId)
      .select('id' as never)
      .where((eb) => compileFilter(eb as never, { view, table, canReadPii: true, dynamic: db.dynamic, dialect: 'mysql' }, filter))
      .where('id' as never, 'in', Object.values(ids) as never)
      .orderBy('id' as never)
      .execute();
    return (rows as { id: number }[]).map((row) => row.id);
  };

  beforeAll(async () => {
    startInServerZone();
    const mysql = await import('mysql2/promise');
    admin = await mysql.createConnection(MYSQL_URL as string);
    await admin.query(`SET time_zone = '+00:00'`);
    await admin.query(`CREATE DATABASE \`${database}\``);
    await admin.query(
      `CREATE TABLE \`${database}\`.bookings (id INT AUTO_INCREMENT PRIMARY KEY, label VARCHAR(40) NOT NULL,
         starts_at TIMESTAMP(3) NULL, noted_at DATETIME(3) NULL)`,
    );
    // An app's outbox over the same clock: when a message is due, when it went.
    await admin.query(`CREATE TABLE \`${database}\`.patients (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(80) NOT NULL, email VARCHAR(120))`);
    await admin.query(
      `CREATE TABLE \`${database}\`.messages (id INT AUTO_INCREMENT PRIMARY KEY, kind VARCHAR(20) NOT NULL, status VARCHAR(10) NOT NULL,
         to_address VARCHAR(120), patient_id INT, booking_id INT, error VARCHAR(120), due_at TIMESTAMP(3) NULL, sent_at TIMESTAMP(3) NULL)`,
    );
    for (const key of Object.keys(TRUTH) as (keyof typeof TRUTH)[]) {
      const [result] = await admin.query(`INSERT INTO \`${database}\`.bookings (label, starts_at) VALUES (?, ?)`, [`truth ${key}`, TRUTH[key]]);
      ids[key] = (result as { insertId: number }).insertId;
    }
    t = await buildDataTestApp();
    connId = await createConnectionViaApi(t, `${MYSQL_URL as string}/${database}`, 'bookings', 'mysql');
    await introspectViaApi(t, connId);
    await t.grantTable(t.roles.admin, connId, '*', { read: true, create: true, update: true, delete: true });
    const snapshot = await snapshotsRepo(t.meta).latest(connId);
    const active = await overridesRepo(t.meta).listForConnection(connId, { status: 'active' });
    view = new SnapshotView(connId, applyOverrides(snapshot?.schema as DatabaseModel, active), new Map());
    table = view.table(tableId);
  });

  afterAll(async () => {
    adapterMysql.createPool = realCreatePool;
    await t?.app.close();
    await admin?.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin?.end();
  });

  it('reads the table the way this suite depends on', () => {
    // An instant column and a zone-less one: what introspection makes of them.
    expect(table.columns.get('starts_at')?.logicalType).toBe('timestamptz');
    expect(table.columns.get('noted_at')?.logicalType).toBe('timestamp');
  });

  it("starts a connection in the server's zone, and the adapter puts it in UTC", async () => {
    // The control: a pool of the same driver, without the adapter, stays where it started.
    const bare = realCreatePool === adapterMysql.createPool ? null : adapterMysql.createPool({ uri: MYSQL_URL, connectionLimit: 1 });
    expect(bare).not.toBeNull();
    const zoneOfBare = await new Promise<string>((resolve, reject) => {
      (bare as unknown as { query(sql: string, cb: (e: Error | null, rows: { tz: string }[]) => void): void }).query(
        'SELECT @@session.time_zone AS tz',
        (error, rows) => (error === null ? resolve(rows[0]!.tz) : reject(error)),
      );
    });
    await new Promise<void>((resolve) => bare!.end(() => resolve()));
    expect(zoneOfBare).toBe(SERVER_ZONE);

    const { rows } = await sql<{ tz: string }>`SELECT @@session.time_zone AS tz`.execute(await data());
    expect(rows[0]?.tz).toBe('+00:00');
  });

  it('reads a stored TIMESTAMP back as the instant it holds', async () => {
    const row = await fetchByPk(await data(), table, { id: ids.middle });
    expect((row?.['starts_at'] as Date).toISOString()).toBe('2026-07-27T22:30:00.000Z');
  });

  it('writes an ISO instant from the API, and it reads back as the same instant', async () => {
    const reply = await t.app.inject({
      method: 'POST',
      url: `/api/v1/data/${connId}/${database}.${url}`,
      headers: asUser(t.users.admin),
      payload: { values: { label: 'from the api', starts_at: '2026-07-27T23:00:00.000Z', noted_at: '2026-07-27T23:00:00.000Z' } },
    });
    expect(reply.statusCode, reply.body).toBe(201);
    const created = reply.json<{ data: Record<string, unknown> }>().data;
    expect(created['starts_at']).toBe('2026-07-27T23:00:00.000Z');
    expect(created['noted_at']).toBe('2026-07-27T23:00:00.000Z');
    const id = Number(created['id']);
    expect(await storedEpoch(id)).toBe(NOW.getTime());
    // The zone-less column keeps this process's wall clock, as it always has.
    expect(await storedWall(id)).toBe(localWall(NOW));

    const read = await t.app.inject({ method: 'GET', url: `/api/v1/data/${connId}/${database}.${url}/${id}`, headers: asUser(t.users.admin) });
    expect(read.json<{ data: Record<string, unknown> }>().data).toMatchObject({
      starts_at: '2026-07-27T23:00:00.000Z',
      noted_at: '2026-07-27T23:00:00.000Z',
    });
  });

  it('answers a dashboard filter on an instant against the instant', async () => {
    const where = (filter: RecordFilter) =>
      t.app.inject({
        method: 'GET',
        url: `/api/v1/data/${connId}/${database}.${url}?where=${encodeURIComponent(JSON.stringify({ and: [{ column: 'label', op: 'like', value: 'truth %' }, filter] }))}&order=id.asc`,
        headers: asUser(t.users.admin),
      });
    const labels = async (filter: RecordFilter) => {
      const reply = await where(filter);
      expect(reply.statusCode, reply.body).toBe(200);
      return reply.json<{ data: { label: string }[] }>().data.map((row) => row.label);
    };
    expect(await labels({ column: 'starts_at', op: 'lt', value: '2026-07-27T23:00:00.000Z' })).toEqual(['truth early', 'truth middle']);
    expect(await labels({ column: 'starts_at', op: 'gte', value: '2026-07-27T22:00:00.000Z' })).toEqual(['truth middle', 'truth late']);
    expect(await labels({ column: 'starts_at', op: 'between', value: ['2026-07-27T22:00:00Z', '2026-07-28T01:00:00+02:00'] })).toEqual(['truth middle']);
  });

  it('answers "still ahead", a time window and "from today" against the instant', async () => {
    expect(await matching(afterNow(table, 'starts_at', NOW))).toEqual([ids.late]);
    expect(await matching(aheadWithin(table, 'starts_at', 15, NOW))).toEqual([ids.early, ids.middle]);
    expect(await matching(aheadWithin(table, 'starts_at', 15, NOW, 'beyond'))).toEqual([ids.late]);
    // 01:00 on the 28th in Berlin: today began at 22:00 UTC.
    expect(await matching(fromToday(table, 'starts_at', 'Europe/Berlin', NOW))).toEqual([ids.middle, ids.late]);
  });

  it('holds an UPDATE to a time window in its own WHERE, as a guest write does', async () => {
    // Inside an UPDATE, strict mode refuses an ISO bound outright rather than warning.
    const db = await data();
    const within = (query: never) =>
      (query as { where: (build: (eb: never) => unknown) => never }).where((eb) =>
        compileFilter(eb, { view, table, canReadPii: true, dynamic: db.dynamic, dialect: 'mysql' }, aheadWithin(table, 'starts_at', 15, NOW)),
      );
    expect(await updateRows(db, 'mysql', table, asChecked({ label: 'truth early' }), { id: ids.early }, within as never)).toBe(1);
    expect(await updateRows(db, 'mysql', table, asChecked({ label: 'truth late' }), { id: ids.late }, within as never)).toBe(0);
  });

  it('writes `$generate: now` as the instant, and as this server’s wall clock in a zone-less column', async () => {
    const at = new Date('2026-07-27T23:45:06.789Z');
    const values = resolveDefaults({ label: 'generated', starts_at: { $generate: 'now' }, noted_at: { $generate: 'now' } }, 'mysql', at, table.columns);
    const stored = await insertRow(await data(), 'mysql', table, asChecked(values));
    const id = Number(stored['id']);
    expect(await storedEpoch(id)).toBe(at.getTime());
    expect(await storedWall(id)).toBe(localWall(at));
    expect((stored['starts_at'] as Date).toISOString()).toBe(at.toISOString());
    expect((stored['noted_at'] as Date).toISOString()).toBe(at.toISOString());
  });

  it('puts the instant back on an undo, which writes the Date it read', async () => {
    const edit = await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/data/${connId}/${database}.${url}/${ids.middle}`,
      headers: asUser(t.users.admin),
      payload: { values: { starts_at: '2026-08-01T09:15:00.000Z' } },
    });
    expect(edit.statusCode, edit.body).toBe(200);
    expect(await storedEpoch(ids.middle)).toBe(Date.parse('2026-08-01T09:15:00.000Z'));
    const token = edit.json<{ undoToken: string }>().undoToken;
    const undo = await t.app.inject({ method: 'POST', url: `/api/v1/data/undo/${token}`, headers: asUser(t.users.admin) });
    expect(undo.statusCode, undo.body).toBe(200);
    expect(await storedEpoch(ids.middle)).toBe(Date.parse('2026-07-27T22:30:00.000Z'));
  });
  it("sends an app's email only once it is due, and stamps when it went", async () => {
    await admin.query(`INSERT INTO \`${database}\`.patients (name, email) VALUES ('Grace Hopper', 'grace@patients.clinic.dev')`);
    const [[grace]] = (await admin.query(`SELECT id FROM \`${database}\`.patients WHERE name = 'Grace Hopper'`)) as unknown as [{ id: number }[]];
    const queue = async (due: string) => {
      const [result] = await admin.query(
        `INSERT INTO \`${database}\`.messages (kind, status, patient_id, booking_id, due_at) VALUES ('reminder', 'queued', ?, ?, ?)`,
        [grace!.id, ids.middle, due],
      );
      return (result as { insertId: number }).insertId;
    };
    // An hour before now, and an hour after: in UTC−4 the second read as three hours ago.
    const ready = await queue('2026-07-27 22:00:00.000');
    const later = await queue('2026-07-28 00:00:00.000');

    await t.meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London' }).where('id', '=', connId).execute();
    await settingsRepo(t.meta).set('email.smtp', {
      host: 'localhost',
      port: 587,
      user: 'postmaster',
      passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)),
      from: 'Clinic <no-reply@clinic.dev>',
      secure: false,
    } as never);
    await emailTemplatesRepo(t.meta).upsert('clinic-reminder', 'en_US', {
      name: 'Reminder',
      subject: 'See you at {{booking.starts_at.time}}',
      blocks: [{ id: 'b1', block: 'email.text', data: { text: 'See you at {{booking.starts_at.time}}.' } }],
      enabled: true,
    });
    const definition: Outbox = {
      table: `${database}.messages`,
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', due: 'due_at', sentAt: 'sent_at' },
      links: { booking: 'booking_id', patient: 'patient_id' },
      recipient: { via: 'patient_id', table: `${database}.patients`, email: 'email', name: 'name' },
      kinds: { reminder: 'clinic-reminder' },
    };
    const sender = createOutboxSender({
      meta: t.meta,
      manager: t.manager,
      viewFor: async () => view,
      writes: createWriteService(),
      live: async () => [{ appKey: 'clinic', connectionId: connId, definition, row: {} as never }],
      secret: TEST_SECRET,
    });
    expect(await sender.sendApp('clinic', NOW.getTime())).toBe(1);

    const [sent, waiting] = await raw<{ status: string; went: string | null }>(
      `SELECT status, UNIX_TIMESTAMP(sent_at) * 1000 AS went FROM \`${database}\`.messages WHERE id IN (?, ?) ORDER BY id`,
      [ready, later],
    );
    expect(sent).toMatchObject({ status: 'sent' });
    expect(Number(sent!.went)).toBe(NOW.getTime());
    expect(waiting).toMatchObject({ status: 'queued', went: null });

    // The booking's time, read from its TIMESTAMP, on the venue's clock: 22:30 UTC is 23:30 in London.
    const job = await t.meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').executeTakeFirstOrThrow();
    const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { envelope: string };
    const envelope = JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { subject: string };
    expect(envelope.subject).toMatch(/^See you at (23:30|11:30\s?PM)$/);
  });
});
