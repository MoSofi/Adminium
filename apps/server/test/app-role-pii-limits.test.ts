// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's own staff roles, signed in against the whole server on every
 * engine: a reception role that may see patients' personal columns and
 * nobody else's, and a clinician whose update on a visit may only move its
 * status along.
 *
 * Nothing is faked below the HTTP routes: the app is uploaded and installed
 * through its routes, people sign in with a password, and every read and
 * write goes through the data API a staff screen calls.
 */
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { afterEach, describe, expect, it } from 'vitest';
import { parseDatabaseModel } from '@adminium/engine';
import { AdapterRegistry, type AdapterProvider } from '@adminium/engine/adapter';
import {
  createFirstSuperAdmin,
  createSqliteMetaDb,
  firstRun,
  pagesRepo,
  permissionsRepo,
  rolesRepo,
  snapshotsRepo,
  usersRepo,
  type MetaDb,
  type TableActions,
} from '@adminium/meta';

import { sha512Integrity } from '../src/add-ons/store.js';
import type { AdminiumServer } from '../src/app.js';
import { composeServer } from '../src/compose.js';
import { runIntrospection } from '../src/connections/introspect.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { ConnectionManager } from '../src/connections/manager.js';
import { registerAdapters } from '../src/connections/register-adapters.js';
import { createApplyService } from '../src/llm/apply-service.js';
import { createRunService } from '../src/llm/run-service.js';
import { packageTarball } from './app-bundle-helpers.js';
import { adminPasswordHash, ADMIN_PASSWORD, sessionCookie } from './auth-helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

type Dialect = 'sqlite' | 'postgres' | 'mysql';
const POSTGRES_URL = process.env.TEST_POSTGRES_URL;
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;

const id = { ref: 'id', type: 'int', role: 'pk' };

/** A front desk: reception rings patients; a clinician moves a visit along. */
const MANIFEST = {
  kind: 'app',
  manifestVersion: 1,
  key: 'desk',
  name: 'Front Desk',
  version: '1.0.0',
  publisher: { id: 'adminium', name: 'Adminium' },
  license: 'AGPL-3.0-only',
  description: { key: 'd', fallback: 'A front desk.' },
  categories: ['operations'],
  compatibility: { minAdminiumVersion: '0.1.0' },
  requiredSchema: {
    prefixed: true,
    tables: [
      {
        ref: 'patients',
        columns: [
          id,
          { ref: 'name', type: 'text', maxLength: 80 },
          { ref: 'mobile', type: 'text', maxLength: 20, rules: { personal: true } },
          { ref: 'allergy_note', type: 'text', maxLength: 200, nullable: true, rules: { personal: true } },
        ],
      },
      {
        ref: 'appointments',
        columns: [
          id,
          { ref: 'patient_id', type: 'fk', references: 'patients' },
          { ref: 'status', type: 'enum', enum: ['booked', 'roomed', 'with_clinician', 'ready', 'cancelled'], default: 'booked' },
          { ref: 'note', type: 'text', maxLength: 200, nullable: true },
          // What the patient paid: personal, so a total over it is too.
          { ref: 'copay', type: 'int', nullable: true, rules: { personal: true } },
        ],
      },
    ],
  },
  pages: [
    {
      ref: 'desk-patients',
      template: 'page-crud',
      title: { key: 't', fallback: 'Patients' },
      nav: { group: 'library', icon: 'list', order: 1 },
      bindings: { rows: 'patients' },
    },
  ],
  roles: [
    {
      key: 'reception',
      name: 'Reception',
      permissions: [
        'table:@patients:read',
        'table:@patients:read_pii',
        'table:@appointments:read',
        'table:@appointments:update',
        'table:@appointments:export',
        'page:@desk-patients:view',
        'app:@:staff',
      ],
    },
    {
      key: 'clinician',
      name: 'Clinician',
      permissions: ['table:@patients:read', 'table:@appointments:read', 'table:@appointments:update', 'page:@desk-patients:view', 'app:@:staff'],
      limits: {
        appointments: { writable: ['status'], writableValues: { status: ['roomed', 'with_clinician', 'ready'] } },
      },
    },
    // A copy of the clinician is held to the clinician's limit.
    { key: 'locum', name: 'Locum', cloneFrom: 'clinician' },
    { key: 'manager', name: 'Manager', permissions: ['table:@appointments:read', 'table:@appointments:update'] },
    // Edits a patient, and moves the patient's visits along from the patient's form.
    {
      key: 'nurse',
      name: 'Nurse',
      permissions: ['table:@patients:read', 'table:@patients:update', 'table:@appointments:read', 'table:@appointments:update'],
      limits: { appointments: { writable: ['status'], writableValues: { status: ['roomed', 'with_clinician', 'ready'] } } },
    },
    // Personal columns of the visits table only: a lookup into patients stays masked.
    {
      key: 'scheduler',
      name: 'Scheduler',
      permissions: ['table:@patients:read', 'table:@appointments:read', 'table:@appointments:read_pii', 'table:@appointments:export'],
    },
  ],
  frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
};

interface Stack {
  app: AdminiumServer;
  meta: MetaDb;
  connectionId: string;
  run: (statement: string) => Promise<void>;
  rows: (statement: string) => Promise<Record<string, unknown>[]>;
  /** Snapshot ids of the app's tables, by ref. */
  table: { patients: string; appointments: string };
  /** The relation a patient's visits are written through, as child rows of the patient. */
  visitsRelation: string;
  /** Run whatever jobs are queued (an export). */
  runJobs: () => Promise<void>;
  close: () => Promise<void>;
}

let open: Stack | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});

async function sourceDatabase(dialect: Dialect, dataDir: string): Promise<{ dsn: string; drop: () => Promise<void> }> {
  const name = `adminium_rolepii_${randomBytes(4).toString('hex')}`;
  if (dialect === 'sqlite') {
    const file = join(dataDir, 'source.db');
    new BetterSqlite3(file).close();
    return { dsn: `sqlite:${file}`, drop: async () => undefined };
  }
  if (dialect === 'postgres') {
    const { Client } = await import('pg');
    const admin = new Client({ connectionString: POSTGRES_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const url = new URL(POSTGRES_URL as string);
    url.pathname = `/${name}`;
    return {
      dsn: url.toString(),
      drop: async () => {
        const again = new Client({ connectionString: POSTGRES_URL });
        await again.connect();
        await again.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        await again.end();
      },
    };
  }
  const mysql = await import('mysql2/promise');
  const admin = await mysql.createConnection(MYSQL_URL as string);
  await admin.query(`CREATE DATABASE \`${name}\``);
  await admin.end();
  const url = new URL(MYSQL_URL as string);
  url.pathname = `/${name}`;
  return {
    dsn: url.toString(),
    drop: async () => {
      const again = await mysql.createConnection(MYSQL_URL as string);
      await again.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await again.end();
    },
  };
}

/** Each sign-in from an address of its own: the login bucket allows five per address. */
let signIns = 0;
async function signIn(app: AdminiumServer, email: string): Promise<string> {
  signIns += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    remoteAddress: `10.0.${String(Math.floor(signIns / 250))}.${String(signIns % 250)}`,
    payload: { email, password: ADMIN_PASSWORD },
  });
  expect(res.statusCode, res.body).toBe(200);
  return sessionCookie(res.headers['set-cookie']);
}

/** The whole server over a fresh store and a fresh source database, with the app installed. */
async function stack(dialect: Dialect): Promise<Stack> {
  const dataDir = await mkdtemp(join(tmpdir(), 'app-role-pii-'));
  const meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
  await firstRun(meta);
  await createFirstSuperAdmin(meta, { email: 'owner@example.com', name: 'Owner', passwordHash: await adminPasswordHash() });
  const registry = new AdapterRegistry<AdapterProvider>();
  await registerAdapters(registry);
  const manager = new ConnectionManager({ meta, crypto: dsnCryptoFromSecret(TEST_SECRET), registry, metaDsn: null, blockLoopback: false });
  const source = await sourceDatabase(dialect, dataDir);
  const connection = await manager.connections.create({ name: 'Clinic', engine: dialect, introspectDsn: source.dsn, dataDsn: source.dsn });
  await runIntrospection({ manager, meta, connectionId: connection.id });

  const runService = createRunService({ meta });
  const composed = await composeServer({
    env: makeEnv({ HOST: '127.0.0.1', ADMINIUM_DATA_DIR: dataDir }),
    metaStore: { meta, url: 'sqlite::memory:', engine: 'sqlite', source: 'embedded', close: async () => Promise.resolve() },
    manager,
    runService,
    applyService: createApplyService({ meta, runService }),
    allowed: null,
    logger: false,
    telemetry: false,
  });
  const app = composed.app;
  await app.ready();
  await composed.jobs.worker.stop();
  composed.jobs.scheduler.stop();

  const owner = await signIn(app, 'owner@example.com');
  const tarball = packageTarball({
    'manifest.json': JSON.stringify(MANIFEST),
    'staff/index.html': '<!doctype html><html><body data-app="desk"></body></html>',
  });
  const staged = await app.inject({
    method: 'POST',
    url: `/api/v1/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`,
    headers: { cookie: owner, 'content-type': 'application/octet-stream' },
    payload: Buffer.from(tarball),
  });
  expect(staged.statusCode, staged.body).toBe(200);
  const installed = await app.inject({
    method: 'POST',
    url: '/api/v1/apps/install',
    headers: { cookie: owner },
    payload: { key: 'desk', version: '1.0.0', connectionId: connection.id },
  });
  expect(installed.statusCode, installed.body).toBe(200);

  const snapshot = await snapshotsRepo(meta).latest(connection.id);
  const model = parseDatabaseModel(snapshot!.schema);
  const idOf = (name: string) => model.tables.find((t) => t.name === name)!.id;
  const handle = await manager.data(connection.id);
  return {
    app,
    meta,
    connectionId: connection.id,
    run: async (statement) => {
      await sql.raw(statement).execute(handle.db);
    },
    rows: async (statement) => (await sql.raw<Record<string, unknown>>(statement).execute(handle.db)).rows,
    table: { patients: idOf('desk_patients'), appointments: idOf('desk_appointments') },
    runJobs: async () => {
      while ((await composed.jobs.worker.runOnce()) > 0);
    },
    visitsRelation: model.relations.find((r) => r.from.tableId === idOf('desk_appointments') && r.from.columns[0] === 'patient_id')!.id,
    close: async () => {
      await app.close();
      await manager.disposeAll().catch(() => undefined);
      await source.drop();
      await meta.db.destroy();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** Someone holding these roles (app roles by key, or built-in slugs), signed in. */
async function person(s: Stack, email: string, roles: string[]): Promise<string> {
  const user = await usersRepo(s.meta).create({ email, name: email.split('@')[0]!, passwordHash: await adminPasswordHash() });
  for (const key of roles) {
    const role = (await rolesRepo(s.meta).findBySlug(key)) ?? (await rolesRepo(s.meta).findBySlug(`desk-${key}`));
    expect(role, key).not.toBeNull();
    await rolesRepo(s.meta).assignToUser(user.id, role!.id);
  }
  return signIn(s.app, email);
}

async function seed(s: Stack): Promise<void> {
  await s.run(`INSERT INTO desk_patients (name, mobile, allergy_note) VALUES ('Nia Obi', '07700 900123', 'penicillin')`);
  await s.run(`INSERT INTO desk_appointments (patient_id, status, note, copay) VALUES (1, 'booked', 'first visit', 25)`);
}

const legs: [Dialect, boolean][] = [
  ['sqlite', true],
  ['postgres', POSTGRES_URL !== undefined],
  ['mysql', MYSQL_URL !== undefined],
];

for (const [dialect, available] of legs) {
  describe.skipIf(!available)(`an app's staff roles on ${dialect}`, () => {
    it('show a table’s personal columns to the role granted read_pii on THAT table, and to no one else', async () => {
      const s = (open = await stack(dialect));
      await seed(s);
      const base = `/api/v1/data/${s.connectionId}`;
      const read = (cookie: string, url: string) => s.app.inject({ method: 'GET', url: `${base}/${url}`, headers: { cookie } });
      const reception = await person(s, 'rita@example.com', ['reception']);
      const clinician = await person(s, 'carl@example.com', ['clinician']);
      const scheduler = await person(s, 'sam@example.com', ['scheduler']);
      const admin = await person(s, 'ada@example.com', ['admin']);
      const owner = await signIn(s.app, 'owner@example.com');
      const lookup = `${s.table.appointments}?lookup=${encodeURIComponent('patient_mobile:patient_id.mobile')}`;

      // Reception: the patients list, one patient, and a visit's lookup into patients, all in clear.
      for (const cookie of [reception, admin, owner]) {
        const list = await read(cookie, s.table.patients);
        expect(list.statusCode, list.body).toBe(200);
        expect(list.json().data[0]).toMatchObject({ mobile: '07700 900123', allergy_note: 'penicillin' });
        expect(list.json().data[0]._masked).toBeUndefined();
        const one = await read(cookie, `${s.table.patients}/1`);
        expect(one.json().data).toMatchObject({ mobile: '07700 900123' });
        const visits = await read(cookie, lookup);
        expect(visits.statusCode, visits.body).toBe(200);
        expect(visits.json().data[0]).toMatchObject({ patient_mobile: '07700 900123' });
      }

      // The clinician reads the same rows with the personal columns masked.
      const masked = (await read(clinician, s.table.patients)).json().data[0];
      expect(masked).toMatchObject({ name: 'Nia Obi', mobile: null, allergy_note: null });
      expect(masked._masked).toEqual(expect.arrayContaining(['mobile', 'allergy_note']));
      expect((await read(clinician, `${s.table.patients}/1`)).json().data).toMatchObject({ mobile: null });
      const clinicianVisit = (await read(clinician, lookup)).json().data[0];
      expect(clinicianVisit).toMatchObject({ patient_mobile: null });
      expect(clinicianVisit._masked).toContain('patient_mobile');

      // read_pii on the visits table does not reach into patients.
      const scheduled = await read(scheduler, lookup);
      expect(scheduled.statusCode, scheduled.body).toBe(200);
      expect(scheduled.json().data[0]).toMatchObject({ patient_mobile: null });
      expect(scheduled.json().data[0]._masked).toContain('patient_mobile');
      expect((await read(scheduler, s.table.patients)).json().data[0]).toMatchObject({ mobile: null });

      // The patients page tells its grid whether to offer the reveal: this table's answer.
      const page = (await pagesRepo(s.meta).findBySlug(s.connectionId, 'desk-patients'))!;
      const pageFor = async (cookie: string) => (await s.app.inject({ method: 'GET', url: `/api/v1/pages/${page.id}`, headers: { cookie } })).json();
      expect((await pageFor(reception)).canUnmask).toBe(true);
      expect((await pageFor(clinician)).canUnmask).toBe(false);

      // A total over a visit's personal column, listed with each patient: the visits table's grant decides.
      const paid = (cookie: string) =>
        read(
          cookie,
          `${s.table.patients}?select=id&compute=${encodeURIComponent(
            JSON.stringify({
              measures: [{ id: 'paid', table: s.table.appointments, fkColumn: 'patient_id', fn: 'sum', of: { terms: [{ sign: 'plus', factors: ['copay'] }] } }],
            }),
          )}`,
        );
      const summed = await paid(scheduler);
      expect(summed.statusCode, summed.body).toBe(200);
      expect(Number(summed.json().data[0].paid)).toBe(25);
      for (const cookie of [reception, clinician]) {
        const refused = (await paid(cookie)).json().data[0];
        expect(refused.paid).toBeNull();
        expect(refused._masked).toContain('paid');
      }

      // A dashboard card reads through the same per-table answer: its own columns, and its lookups.
      const sourceOf = (table: string) => ({ name: table.split('.').at(-1)!, ...(table.includes('.') ? { schema: table.split('.')[0] } : {}) });
      const card = (cookie: string, table: string, extra: Record<string, unknown>) =>
        s.app.inject({
          method: 'POST',
          url: '/api/v1/widget-data/query',
          headers: { cookie },
          payload: { descriptor: { connectionId: s.connectionId, source: sourceOf(table), shape: 'record-list', ...extra } },
        });
      const mobiles = await card(reception, s.table.patients, { select: ['id', 'mobile'] });
      expect(mobiles.statusCode, mobiles.body).toBe(200);
      expect(JSON.stringify(mobiles.json())).toContain('07700 900123');
      expect((await card(clinician, s.table.patients, { select: ['id', 'mobile'] })).json().error?.code).toBe('COLUMN_FORBIDDEN');
      const visitCard = (cookie: string) => card(cookie, s.table.appointments, { select: ['id'], lookups: ['patient_mobile:patient_id.mobile'] });
      expect(JSON.stringify((await visitCard(reception)).json())).toContain('07700 900123');
      const schedulerCard = await visitCard(scheduler);
      expect(schedulerCard.statusCode, schedulerCard.body).toBe(200);
      expect(JSON.stringify(schedulerCard.json())).not.toContain('07700 900123');

      // An export of the visits with the patient's mobile: its preview, and the file the job writes later.
      const source = {
        kind: 'table',
        table: s.table.appointments,
        columns: [
          { name: 'id', label: 'Visit' },
          { name: 'patient_mobile', label: 'Mobile', lookup: { path: ['patient_id'], select: 'mobile' } },
        ],
      };
      const exported = async (cookie: string) => {
        const preview = await s.app.inject({
          method: 'POST',
          url: '/api/v1/exports/preview',
          headers: { cookie },
          payload: { connectionId: s.connectionId, source, format: 'csv', sampleRows: 5 },
        });
        expect(preview.statusCode, preview.body).toBe(200);
        const requested = await s.app.inject({
          method: 'POST',
          url: '/api/v1/exports',
          headers: { cookie },
          payload: { connectionId: s.connectionId, source, format: 'csv' },
        });
        expect(requested.statusCode, requested.body).toBe(202);
        await s.runJobs();
        const file = await s.app.inject({ method: 'GET', url: `/api/v1/exports/${String(requested.json().data.id)}/download`, headers: { cookie } });
        expect(file.statusCode, file.body).toBe(200);
        return { preview: preview.json().data, file: file.body };
      };
      const shown = await exported(reception);
      expect(shown.preview.columns.find((c: { key: string }) => c.key === 'patient_mobile').masked).toBe(false);
      expect(shown.preview.rows[0]).toContain('07700 900123');
      expect(shown.file).toContain('07700 900123');
      const hidden = await exported(scheduler);
      expect(hidden.preview.columns.find((c: { key: string }) => c.key === 'patient_mobile').masked).toBe(true);
      expect(hidden.preview.rows[0]).not.toContain('07700 900123');
      expect(hidden.file).not.toContain('07700 900123');
    });

    it('hold a limited update to its columns and values, unless another role or an admin lifts it', async () => {
      const s = (open = await stack(dialect));
      await seed(s);
      const base = `/api/v1/data/${s.connectionId}/${s.table.appointments}`;
      const patch = (cookie: string, values: Record<string, unknown>) =>
        s.app.inject({ method: 'PATCH', url: `${base}/1`, headers: { cookie }, payload: { values } });
      const bulk = (cookie: string, values: Record<string, unknown>) =>
        s.app.inject({ method: 'POST', url: `${base}/bulk`, headers: { cookie }, payload: { action: 'update', ids: [1], values } });
      const status = async () => (await s.rows(`SELECT status FROM desk_appointments WHERE id = 1`))[0]!['status'];
      const clinician = await person(s, 'carl@example.com', ['clinician']);
      const locum = await person(s, 'lou@example.com', ['locum']);
      const both = await person(s, 'mona@example.com', ['clinician', 'manager']);
      const admin = await person(s, 'ada@example.com', ['admin']);
      const owner = await signIn(s.app, 'owner@example.com');

      // Moving the visit along is allowed, one row or several.
      expect((await patch(clinician, { status: 'roomed' })).statusCode).toBe(200);
      expect(await status()).toBe('roomed');
      expect((await bulk(clinician, { status: 'with_clinician' })).statusCode).toBe(200);
      expect(await status()).toBe('with_clinician');
      // A form that sends the row back whole saves, when only an allowed column moved.
      expect((await patch(clinician, { status: 'ready', patient_id: 1, note: 'first visit' })).statusCode).toBe(200);
      expect(await status()).toBe('ready');

      // Cancelling is refused, naming the column and the value, one row or several.
      const cancelled = await patch(clinician, { status: 'cancelled' });
      expect(cancelled.statusCode).toBe(403);
      expect(cancelled.json().error).toMatchObject({
        code: 'COLUMN_FORBIDDEN',
        details: { table: s.table.appointments, column: 'status', value: 'cancelled', reason: 'update-limit' },
      });
      expect((await bulk(clinician, { status: 'cancelled' })).statusCode).toBe(403);
      // Any other column is refused, alone or beside an allowed change.
      const rewritten = await patch(clinician, { note: 'moved to Friday' });
      expect(rewritten.statusCode).toBe(403);
      expect(rewritten.json().error.details).toMatchObject({ column: 'note', reason: 'update-limit' });
      expect((await patch(clinician, { status: 'roomed', note: 'x' })).statusCode).toBe(403);
      expect((await bulk(clinician, { note: 'x' })).statusCode).toBe(403);
      // A copy of the role is held to the same limit.
      expect((await patch(locum, { status: 'cancelled' })).statusCode).toBe(403);
      expect((await patch(locum, { status: 'roomed' })).statusCode).toBe(200);
      expect(await status()).toBe('roomed');
      expect((await s.rows(`SELECT note FROM desk_appointments WHERE id = 1`))[0]!['note']).toBe('first visit');

      // A visit changed as a child row of its patient is held to the visits table's limit.
      const nurse = await person(s, 'nell@example.com', ['nurse']);
      const throughPatient = (value: string) =>
        s.app.inject({
          method: 'PATCH',
          url: `/api/v1/data/${s.connectionId}/${s.table.patients}/1`,
          headers: { cookie: nurse },
          payload: {
            values: { name: 'Nia Obi' },
            children: { [s.visitsRelation]: [{ key: { id: 1 }, values: { status: value, note: 'first visit' } }] },
          },
        });
      const child = await throughPatient('cancelled');
      expect(child.statusCode, child.body).toBe(403);
      expect(child.json().error.details).toMatchObject({ column: 'status', value: 'cancelled', reason: 'update-limit' });
      expect(await status()).toBe('roomed');
      expect((await throughPatient('with_clinician')).statusCode).toBe(200);
      expect(await status()).toBe('with_clinician');

      // A second role with a plain update lifts the limit; so does an admin's.
      for (const [cookie, value] of [[both, 'cancelled'], [admin, 'booked'], [owner, 'cancelled']] as const) {
        const res = await patch(cookie, { status: value, note: `by ${value}` });
        expect(res.statusCode, res.body).toBe(200);
        expect(await status()).toBe(value);
      }
    });

    it('keep the limit through a save of the role in the permissions matrix', async () => {
      const s = (open = await stack(dialect));
      await seed(s);
      const owner = await signIn(s.app, 'owner@example.com');
      const role = (await rolesRepo(s.meta).findBySlug('desk-clinician'))!;
      const held = await s.app.inject({ method: 'GET', url: `/api/v1/roles/${role.id}/permissions`, headers: { cookie: owner } });
      const grants = held.json().grants as string[];
      expect(grants).toContain(`table:${s.connectionId}:${s.table.appointments}:update`);
      const saved = await s.app.inject({
        method: 'PUT',
        url: `/api/v1/roles/${role.id}/permissions`,
        headers: { cookie: owner },
        payload: { grants: [...grants, `table:${s.connectionId}:${s.table.patients}:export`] },
      });
      expect(saved.statusCode, saved.body).toBe(200);
      const row = await permissionsRepo(s.meta).find(role.id, 'table', `${s.connectionId}/${s.table.appointments}`);
      expect((row!.actions as TableActions).updateLimit).toEqual({
        writable: ['status'],
        writableValues: { status: ['roomed', 'with_clinician', 'ready'] },
      });
      const clinician = await person(s, 'carl@example.com', ['clinician']);
      const refused = await s.app.inject({
        method: 'PATCH',
        url: `/api/v1/data/${s.connectionId}/${s.table.appointments}/1`,
        headers: { cookie: clinician },
        payload: { values: { status: 'cancelled' } },
      });
      expect(refused.statusCode).toBe(403);
    });
  });
}
