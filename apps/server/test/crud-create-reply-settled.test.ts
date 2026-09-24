// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CREATE REPLIES WITH THE ROW AS STORED, ITS OWN TOTALS SETTLED.
 *
 * A visit keeps `paid` (a total over its payments), `waived` (a total over its
 * write-offs) and `balance = fee − waived − paid` on its own row. A new visit
 * has no payments yet, so the settle that runs beside its INSERT writes
 * `paid = 0` and `balance = fee` at once. The INSERT's own `RETURNING` (or
 * MySQL's read-back) happens before that settle, and a reply built from it
 * said `paid: null, balance: null` about a row that stored 0 and 45 — and a
 * desk puts on screen what the reply says.
 *
 * Every create path is asked: a plain create (the write service), a create
 * with link rows, one row per value (`repeat`), and the write service's own
 * return, which other callers (automations, project code, the outbox) use.
 *
 * SQLite always runs; Postgres gates on a reachable `psql`, MySQL on
 * TEST_MYSQL_URL.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DatabaseModel } from '@adminium/engine';
import { overridesRepo, snapshotsRepo } from '@adminium/meta';

import { applyOverrides } from '../src/connections/effective-schema.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { createWriteService, type WriteTarget } from '../src/crud/write-service.js';
import {
  asUser,
  buildDataTestApp,
  createConnectionViaApi,
  introspectViaApi,
  pgAvailable,
  psql,
  type DataTestContext,
} from './connections-helpers.js';

const DDL = {
  sqlite: [
    `CREATE TABLE visits (id INTEGER PRIMARY KEY AUTOINCREMENT, note VARCHAR(40), fee DECIMAL(10,2) NOT NULL,
       waived DECIMAL(10,2), paid DECIMAL(10,2), balance DECIMAL(10,2))`,
    `CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, visit_id INTEGER NOT NULL REFERENCES visits(id), amount DECIMAL(10,2) NOT NULL)`,
    `CREATE TABLE write_offs (id INTEGER PRIMARY KEY AUTOINCREMENT, visit_id INTEGER NOT NULL REFERENCES visits(id), amount DECIMAL(10,2) NOT NULL)`,
    `CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(40) NOT NULL)`,
    `CREATE TABLE visit_tags (visit_id INTEGER NOT NULL REFERENCES visits(id), tag_id INTEGER NOT NULL REFERENCES tags(id),
       PRIMARY KEY (visit_id, tag_id))`,
    `INSERT INTO tags (name) VALUES ('new patient')`,
  ],
  postgres: [
    `CREATE TABLE visits (id serial PRIMARY KEY, note varchar(40), fee numeric(10,2) NOT NULL,
       waived numeric(10,2), paid numeric(10,2), balance numeric(10,2))`,
    `CREATE TABLE payments (id serial PRIMARY KEY, visit_id integer NOT NULL REFERENCES visits(id), amount numeric(10,2) NOT NULL)`,
    `CREATE TABLE write_offs (id serial PRIMARY KEY, visit_id integer NOT NULL REFERENCES visits(id), amount numeric(10,2) NOT NULL)`,
    `CREATE TABLE tags (id serial PRIMARY KEY, name varchar(40) NOT NULL)`,
    `CREATE TABLE visit_tags (visit_id integer NOT NULL REFERENCES visits(id), tag_id integer NOT NULL REFERENCES tags(id),
       PRIMARY KEY (visit_id, tag_id))`,
    `INSERT INTO tags (name) VALUES ('new patient')`,
  ],
  mysql: [
    `CREATE TABLE visits (id INT AUTO_INCREMENT PRIMARY KEY, note VARCHAR(40), fee DECIMAL(10,2) NOT NULL,
       waived DECIMAL(10,2), paid DECIMAL(10,2), balance DECIMAL(10,2))`,
    `CREATE TABLE payments (id INT AUTO_INCREMENT PRIMARY KEY, visit_id INT NOT NULL, amount DECIMAL(10,2) NOT NULL,
       FOREIGN KEY (visit_id) REFERENCES visits(id))`,
    `CREATE TABLE write_offs (id INT AUTO_INCREMENT PRIMARY KEY, visit_id INT NOT NULL, amount DECIMAL(10,2) NOT NULL,
       FOREIGN KEY (visit_id) REFERENCES visits(id))`,
    `CREATE TABLE tags (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(40) NOT NULL)`,
    `CREATE TABLE visit_tags (visit_id INT NOT NULL, tag_id INT NOT NULL, PRIMARY KEY (visit_id, tag_id),
       FOREIGN KEY (visit_id) REFERENCES visits(id), FOREIGN KEY (tag_id) REFERENCES tags(id))`,
    `INSERT INTO tags (name) VALUES ('new patient')`,
  ],
} as const;

interface Engine {
  t: DataTestContext;
  connId: string;
  /** The table ids as the snapshot names them, and as a data URL names them. */
  ids: { visits: string; payments: string; writeOffs: string };
  urls: { visits: string };
}

type Money = { fee: number | null; waived: number | null; paid: number | null; balance: number | null };

const money = (row: Record<string, unknown>): Money => {
  const n = (value: unknown) => (value === null || value === undefined ? null : Number(value));
  return { fee: n(row['fee']), waived: n(row['waived']), paid: n(row['paid']), balance: n(row['balance']) };
};

function suite(label: string, ready: boolean, setUp: () => Promise<Engine>, tearDown: () => Promise<void>) {
  describe.skipIf(!ready)(`a create's reply on ${label}`, () => {
    let e: Engine;
    let tagRelation: string;

    beforeAll(async () => {
      e = await setUp();
      const overrides = overridesRepo(e.t.meta);
      await overrides.create({
        connectionId: e.connId,
        op: 'column.rollup',
        tableName: e.ids.visits,
        columnName: 'paid',
        value: { from: e.ids.payments, via: 'visit_id', sum: 'amount', balance: { column: 'balance', of: 'fee', minus: ['waived'] } },
      });
      await overrides.create({
        connectionId: e.connId,
        op: 'column.rollup',
        tableName: e.ids.visits,
        columnName: 'waived',
        value: { from: e.ids.writeOffs, via: 'visit_id', sum: 'amount' },
      });
      const reply = await e.t.app.inject({
        method: 'GET',
        url: `/api/v1/connections/${e.connId}/schema`,
        headers: asUser(e.t.users.admin),
      });
      const model = reply.json<{ model: { relations: { id: string; through: unknown; from: { tableId: string } }[] } }>().model;
      const found = model.relations.find((r) => r.through !== null && r.from.tableId === e.ids.visits);
      if (found === undefined) throw new Error('no many-to-many relation from visits');
      tagRelation = found.id;
    });

    afterAll(async () => {
      await tearDown();
    });

    const post = (body: unknown) =>
      e.t.app.inject({
        method: 'POST',
        url: `/api/v1/data/${e.connId}/${e.urls.visits}`,
        headers: asUser(e.t.users.admin),
        payload: body as never,
      });

    const stored = async (id: unknown): Promise<Money> => {
      const reply = await e.t.app.inject({
        method: 'GET',
        url: `/api/v1/data/${e.connId}/${e.urls.visits}/${String(id)}`,
        headers: asUser(e.t.users.admin),
      });
      return money(reply.json<{ data: Record<string, unknown> }>().data);
    };

    const settled: Money = { fee: 45, waived: 0, paid: 0, balance: 45 };

    it('a plain create replies with its settled totals and balance, as stored', async () => {
      const reply = await post({ values: { note: 'knee check', fee: 45 } });
      expect(reply.statusCode, reply.body).toBe(201);
      const data = reply.json<{ data: Record<string, unknown> }>().data;
      expect(money(data)).toEqual(settled);
      expect(await stored(data['id'])).toEqual(settled);
    });

    it('a create with link rows replies with them too', async () => {
      const reply = await post({ values: { note: 'first visit', fee: 45 }, links: { [tagRelation]: [1] } });
      expect(reply.statusCode, reply.body).toBe(201);
      const data = reply.json<{ data: Record<string, unknown> }>().data;
      expect(money(data)).toEqual(settled);
      expect(await stored(data['id'])).toEqual(settled);
    });

    it('an edit with link rows replies with the balance its new fee left', async () => {
      const created = await post({ values: { note: 'follow-up', fee: 45 } });
      const id = created.json<{ data: Record<string, unknown> }>().data['id'];
      const reply = await e.t.app.inject({
        method: 'PATCH',
        url: `/api/v1/data/${e.connId}/${e.urls.visits}/${String(id)}`,
        headers: asUser(e.t.users.admin),
        payload: { values: { fee: 60 }, links: { [tagRelation]: [1] } },
      });
      expect(reply.statusCode, reply.body).toBe(200);
      const moved: Money = { fee: 60, waived: 0, paid: 0, balance: 60 };
      expect(money(reply.json<{ data: Record<string, unknown> }>().data)).toEqual(moved);
      expect(await stored(id)).toEqual(moved);
    });

    it('one row per value replies with the first row as stored', async () => {
      const reply = await post({ values: { fee: 45 }, repeat: { column: 'note', values: ['morning', 'evening'] } });
      expect(reply.statusCode, reply.body).toBe(201);
      const body = reply.json<{ data: Record<string, unknown>; created: number }>();
      expect(body.created).toBe(2);
      expect(body.data['note']).toBe('morning');
      expect(money(body.data)).toEqual(settled);
    });

    it('the write service returns the row as stored, for every caller that is not a route', async () => {
      const snapshot = await snapshotsRepo(e.t.meta).latest(e.connId);
      const active = await overridesRepo(e.t.meta).listForConnection(e.connId, { status: 'active' });
      const view = new SnapshotView(e.connId, applyOverrides(snapshot?.schema as DatabaseModel, active), new Map());
      const { db, dialect } = await e.t.manager.data(e.connId);
      const target: WriteTarget = { connectionId: e.connId, view, table: view.table(e.ids.visits), db, dialect };
      const row = await createWriteService().create({
        target,
        values: { note: 'from a rule', fee: 30 },
        context: { origin: 'automation', hops: 1, actor: null, request: null },
        announce: async () => {},
      });
      expect(money(row)).toEqual({ fee: 30, waived: 0, paid: 0, balance: 30 });
    });
  });
}

async function grantAll(t: DataTestContext, connId: string): Promise<void> {
  await t.grantTable(t.roles.admin, connId, '*', { read: true, create: true, update: true, delete: true });
}

// --- sqlite (always) ---------------------------------------------------------

{
  let dir: string | null = null;
  let t: DataTestContext | null = null;
  suite(
    'sqlite',
    true,
    async () => {
      dir = mkdtempSync(join(tmpdir(), 'adminium-settled-reply-'));
      const file = join(dir, 'clinic.db');
      const db = new BetterSqlite3(file);
      db.exec('PRAGMA foreign_keys = ON');
      for (const statement of DDL.sqlite) db.exec(statement);
      db.close();
      t = await buildDataTestApp();
      const connId = await createConnectionViaApi(t, `sqlite:${file}`, 'clinic', 'sqlite');
      await introspectViaApi(t, connId);
      await grantAll(t, connId);
      return {
        t,
        connId,
        ids: { visits: 'main.visits', payments: 'main.payments', writeOffs: 'main.write_offs' },
        urls: { visits: 'visits' },
      };
    },
    async () => {
      await t?.app.close();
      if (dir !== null) rmSync(dir, { recursive: true, force: true });
    },
  );
}

// --- postgres ----------------------------------------------------------------

{
  const database = `adminium_test_settled_${randomBytes(4).toString('hex')}`;
  let t: DataTestContext | null = null;
  let made = false;
  suite(
    'postgres',
    pgAvailable(),
    async () => {
      psql('postgres', `CREATE DATABASE ${database}`);
      made = true;
      for (const statement of DDL.postgres) psql(database, statement);
      const user = process.env.PGUSER ?? process.env.USER ?? 'postgres';
      t = await buildDataTestApp();
      const connId = await createConnectionViaApi(t, `postgres://${user}@127.0.0.1:5432/${database}`, 'clinic', 'postgres');
      await introspectViaApi(t, connId);
      await grantAll(t, connId);
      return {
        t,
        connId,
        ids: { visits: 'public.visits', payments: 'public.payments', writeOffs: 'public.write_offs' },
        urls: { visits: 'public.visits' },
      };
    },
    async () => {
      await t?.app.close();
      if (made) psql('postgres', `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    },
  );
}

// --- mysql -------------------------------------------------------------------

// `''` means absent: CI leaves this empty on a push, where mysql runs nightly.
const MYSQL_URL = process.env.TEST_MYSQL_URL || undefined;

{
  const database = `adminium_test_settled_${randomBytes(4).toString('hex')}`;
  let t: DataTestContext | null = null;
  let admin: import('mysql2/promise').Connection | null = null;
  suite(
    'mysql',
    MYSQL_URL !== undefined,
    async () => {
      const mysql = await import('mysql2/promise');
      admin = await mysql.createConnection(MYSQL_URL as string);
      await admin.query(`CREATE DATABASE \`${database}\``);
      await admin.query(`USE \`${database}\``);
      for (const statement of DDL.mysql) await admin.query(statement);
      t = await buildDataTestApp();
      const connId = await createConnectionViaApi(t, `${MYSQL_URL as string}/${database}`, 'clinic', 'mysql');
      await introspectViaApi(t, connId);
      await grantAll(t, connId);
      return {
        t,
        connId,
        ids: { visits: `${database}.visits`, payments: `${database}.payments`, writeOffs: `${database}.write_offs` },
        urls: { visits: `${database}.visits` },
      };
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
