// SPDX-License-Identifier: AGPL-3.0-only
/**
 * THE OWNER'S CASE, DRIVEN THROUGH THE ROUTES, ON EVERY ENGINE.
 *
 * On 2026-09-17 adding a patient failed. The table's `created_at` was NOT NULL
 * with no database default: the form hid the column, the server put nothing
 * there, and the database's refusal arrived as HTTP 500 with no column named.
 * This file is that table, on SQLite, PostgreSQL and MySQL, through the same
 * `POST /data/:conn/:table` the dashboard calls.
 *
 * Four things are asked of each engine:
 *
 *   1. a create with only the name in it → 201, with a stored time;
 *   2. `updated_at` moves on a PATCH, and comes BACK on an undo — the undo
 *      entry records the filled column because the fill reached
 *      `UpdateOutcome.values`;
 *   3. a value the column's CHECK does not allow → 422 naming the column,
 *      never a 500;
 *   4. a required value left out → 422 naming the column.
 *
 * SQLite always runs. Postgres gates on a reachable `psql`, MySQL on
 * TEST_MYSQL_URL — the discipline the rest of this suite uses, and the reason
 * a green local run is not the same as a green CI run.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  asUser,
  buildDataTestApp,
  createConnectionViaApi,
  introspectViaApi,
  pgAvailable,
  psql,
  type DataTestContext,
} from './connections-helpers.js';

interface Refusal {
  error: { code: string; message: string; details?: { fields?: Record<string, { code: string }>; code?: string } };
}

interface Mutation {
  data: Record<string, unknown>;
  undoToken: string | null;
}

/** Every engine is asked the same four questions. */
function suite(
  label: string,
  ready: boolean,
  setUp: () => Promise<{ t: DataTestContext; connId: string; table: string }>,
  tearDown: () => Promise<void>,
) {
  describe.skipIf(!ready)(`column fills on ${label}`, () => {
    let t: DataTestContext;
    let connId: string;
    let table: string;

    beforeAll(async () => {
      ({ t, connId, table } = await setUp());
    });

    afterAll(async () => {
      await tearDown();
    });

    const url = () => `/api/v1/data/${connId}/${table}`;

    const create = async (values: Record<string, unknown>) =>
      t.app.inject({ method: 'POST', url: url(), headers: asUser(t.users.admin), payload: { values } });

    it('takes a row with nothing but a name, and stores a created_at', async () => {
      const res = await create({ full_name: 'Ada Lovelace' });
      expect(res.statusCode, res.body).toBe(201);
      const body = res.json() as Mutation;
      const stored = body.data['created_at'];
      expect(stored, 'created_at was filled').not.toBeNull();
      const at = new Date(String(stored)).getTime();
      expect(Number.isNaN(at)).toBe(false);
      expect(Math.abs(at - Date.now())).toBeLessThan(5 * 60_000);
    });

    it('moves updated_at on a PATCH and puts it back on an undo', async () => {
      const created = (await create({ full_name: 'Grace Hopper' })).json() as Mutation;
      const id = created.data['id'];
      const was = String(created.data['updated_at']);
      // A second of daylight between the two writes, so "moved" is observable
      // on an engine whose column has whole-second resolution.
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const patched = await t.app.inject({
        method: 'PATCH',
        url: `${url()}/${String(id)}`,
        headers: asUser(t.users.admin),
        payload: { values: { full_name: 'Grace B. Hopper' } },
      });
      expect(patched.statusCode, patched.body).toBe(200);
      const after = patched.json() as Mutation;
      expect(String(after.data['updated_at'])).not.toBe(was);
      expect(after.undoToken).not.toBeNull();

      const undone = await t.app.inject({
        method: 'POST',
        url: `/api/v1/data/undo/${String(after.undoToken)}`,
        headers: asUser(t.users.admin),
      });
      expect(undone.statusCode, undone.body).toBe(200);
      const back = await t.app.inject({
        method: 'GET',
        url: `${url()}/${String(id)}`,
        headers: asUser(t.users.admin),
      });
      const row = (back.json() as { data: Record<string, unknown> }).data;
      expect(row['full_name']).toBe('Grace Hopper');
      // The point of C1: the undo entry knew about `updated_at` only because
      // the fill reached the outcome the PATCH route reads its columns from.
      expect(String(row['updated_at'])).toBe(was);
    });

    it('names the column when a value the CHECK forbids is sent', async () => {
      const res = await create({ full_name: 'Ada', status: 'wibble' });
      expect(res.statusCode, res.body).toBe(422);
      const body = res.json() as Refusal;
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect(body.error.details?.fields?.['status']?.code).toBe('not-allowed');
    });

    it('names the column for a CHECK only the database can judge', async () => {
      /*
       * `status IN (…)` is parsed out of the DDL and lands in the snapshot as
       * an allowed-value list, so `column-rules.ts` refuses a bad one before
       * the statement runs. `age >= 0` is not a value list and nothing here
       * models it — the refusal comes from the engine itself and
       * `crud/db-errors.ts` has to find the column from the constraint.
       */
      const res = await create({ full_name: 'Ada', age: -5 });
      expect(res.statusCode, res.body).toBe(422);
      const body = res.json() as Refusal;
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect(body.error.details?.fields?.['age']?.code).toBe('not-allowed');
    });

    it('names the column when a required value is left out', async () => {
      const res = await t.app.inject({
        method: 'POST',
        url: url(),
        headers: asUser(t.users.admin),
        payload: { values: { status: 'new' } },
      });
      expect(res.statusCode, res.body).toBe(422);
      const body = res.json() as Refusal;
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect(body.error.details?.fields?.['full_name']?.code).toBe('required');
    });
  });
}

async function grantAll(t: DataTestContext, connId: string): Promise<void> {
  await t.grantTable(t.roles.admin, connId, '*', {
    read: true,
    create: true,
    update: true,
    delete: true,
  });
}

// --- sqlite (always) ---------------------------------------------------------

{
  let dir: string | null = null;
  let t: DataTestContext | null = null;
  suite(
    'sqlite',
    true,
    async () => {
      dir = mkdtempSync(join(tmpdir(), 'adminium-fills-'));
      const file = join(dir, 'clinic.db');
      const db = new BetterSqlite3(file);
      db.exec(`CREATE TABLE patients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        full_name VARCHAR(80) NOT NULL,
        status VARCHAR(10) CHECK (status IN ('new','seen')),
        age INTEGER CONSTRAINT patients_age_ck CHECK (age >= 0),
        created_at TIMESTAMP NOT NULL,
        updated_at TIMESTAMP NOT NULL
      )`);
      db.close();
      t = await buildDataTestApp();
      const connId = await createConnectionViaApi(t, `sqlite:${file}`, 'clinic', 'sqlite');
      await introspectViaApi(t, connId);
      await grantAll(t, connId);
      return { t, connId, table: 'patients' };
    },
    async () => {
      await t?.app.close();
      if (dir !== null) rmSync(dir, { recursive: true, force: true });
    },
  );
}

// --- postgres (a reachable psql) ---------------------------------------------

{
  const database = `adminium_test_fills_${randomBytes(4).toString('hex')}`;
  let t: DataTestContext | null = null;
  let made = false;
  suite(
    'postgres',
    pgAvailable(),
    async () => {
      psql('postgres', `CREATE DATABASE ${database}`);
      made = true;
      psql(
        database,
        `CREATE TABLE patients (
          id serial PRIMARY KEY,
          full_name varchar(80) NOT NULL,
          status varchar(10) CHECK (status IN ('new','seen')),
          age integer CONSTRAINT patients_age_ck CHECK (age >= 0),
          created_at timestamptz NOT NULL,
          updated_at timestamptz NOT NULL
        )`,
      );
      const user = process.env.PGUSER ?? process.env.USER ?? 'postgres';
      t = await buildDataTestApp();
      const connId = await createConnectionViaApi(
        t,
        `postgres://${user}@127.0.0.1:5432/${database}`,
        'clinic',
        'postgres',
      );
      await introspectViaApi(t, connId);
      await grantAll(t, connId);
      return { t, connId, table: 'public.patients' };
    },
    async () => {
      await t?.app.close();
      if (made) psql('postgres', `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    },
  );
}

// --- mysql (TEST_MYSQL_URL) --------------------------------------------------

// `''` means absent: CI leaves this empty on a push, where mysql runs nightly.
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;

{
  const database = `adminium_test_fills_${randomBytes(4).toString('hex')}`;
  let t: DataTestContext | null = null;
  let admin: import('mysql2/promise').Connection | null = null;
  suite(
    'mysql',
    MYSQL_URL !== undefined,
    async () => {
      const mysql = await import('mysql2/promise');
      admin = await mysql.createConnection(MYSQL_URL as string);
      await admin.query(`CREATE DATABASE \`${database}\``);
      await admin.query(`CREATE TABLE \`${database}\`.patients (
        id INT AUTO_INCREMENT PRIMARY KEY,
        full_name VARCHAR(80) NOT NULL,
        status VARCHAR(10),
        age INT,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        CONSTRAINT patients_status_ck CHECK (status IN ('new','seen')),
        CONSTRAINT patients_age_ck CHECK (age >= 0)
      )`);
      t = await buildDataTestApp();
      const connId = await createConnectionViaApi(t, `${MYSQL_URL as string}/${database}`, 'clinic', 'mysql');
      await introspectViaApi(t, connId);
      await grantAll(t, connId);
      return { t, connId, table: `${database}.patients` };
    },
    async () => {
      await t?.app.close();
      if (admin !== null) {
        await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
        await admin.end();
      }
    },
  );
}
