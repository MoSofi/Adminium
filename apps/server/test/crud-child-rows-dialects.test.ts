// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CHILD ROWS, THROUGH THE ROUTES, ON EVERY ENGINE.
 *
 * An invoice with three lines is three rows of another table, written in the
 * same transaction as the invoice. What a unit test cannot say, and this can:
 * that the rows land on a real engine, that a save is a DIFF and not a
 * delete-and-reinsert, that the undo takes the children with the parent (and in
 * an order the foreign keys survive), that the CHILD table's own grants decide
 * — not the parent's — and that a refusal inside the transaction leaves nothing
 * behind.
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

import {
  asUser,
  buildDataTestApp,
  createConnectionViaApi,
  introspectViaApi,
  pgAvailable,
  psql,
  type DataTestContext,
} from './connections-helpers.js';

interface Mutation {
  data: Record<string, unknown>;
  undoToken: string | null;
}

const DDL = {
  sqlite: [
    `CREATE TABLE invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, who VARCHAR(40) NOT NULL)`,
    `CREATE TABLE invoice_lines (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       invoice_id INTEGER NOT NULL REFERENCES invoices(id),
       item VARCHAR(40) NOT NULL,
       qty INTEGER NOT NULL DEFAULT 1)`,
  ],
  postgres: [
    `CREATE TABLE invoices (id serial PRIMARY KEY, who varchar(40) NOT NULL)`,
    `CREATE TABLE invoice_lines (
       id serial PRIMARY KEY,
       invoice_id integer NOT NULL REFERENCES invoices(id),
       item varchar(40) NOT NULL,
       qty integer NOT NULL DEFAULT 1)`,
  ],
  mysql: [
    `CREATE TABLE invoices (id INT AUTO_INCREMENT PRIMARY KEY, who VARCHAR(40) NOT NULL)`,
    `CREATE TABLE invoice_lines (
       id INT AUTO_INCREMENT PRIMARY KEY,
       invoice_id INT NOT NULL,
       item VARCHAR(40) NOT NULL,
       qty INT NOT NULL DEFAULT 1,
       FOREIGN KEY (invoice_id) REFERENCES invoices(id))`,
  ],
} as const;

interface Engine {
  t: DataTestContext;
  connId: string;
  invoices: string;
  lines: string;
}

function suite(label: string, ready: boolean, setUp: () => Promise<Engine>, tearDown: () => Promise<void>) {
  describe.skipIf(!ready)(`child rows on ${label}`, () => {
    let e: Engine;
    let relation: string;

    beforeAll(async () => {
      e = await setUp();
      const reply = await e.t.app.inject({
        method: 'GET',
        url: `/api/v1/connections/${e.connId}/schema`,
        headers: asUser(e.t.users.admin),
      });
      const model = reply.json<{
        model: {
          tables: { id: string; name: string }[];
          relations: { id: string; through: unknown; from: { tableId: string }; to: { tableId: string } }[];
        };
      }>().model;
      const idOf = (name: string): string => {
        const found = model.tables.find((table) => table.name === name);
        if (found === undefined) throw new Error(`no table ${name}`);
        return found.id;
      };
      const found = model.relations.find(
        (r) => r.through === null && r.from.tableId.endsWith('invoice_lines'),
      );
      if (found === undefined) throw new Error('no 1:N relation onto invoices');
      relation = found.id;
      /*
       * The EDITOR may write invoices and READ the lines — and holds nothing
       * that writes them. That is the grant this feature has to notice: the
       * parent's context checks the parent, and a child write that trusted it
       * would write real rows into a table this caller was never given.
       */
      await e.t.grantTable(e.t.roles.editor, e.connId, idOf('invoices'), {
        read: true,
        create: true,
        update: true,
      });
      await e.t.grantTable(e.t.roles.editor, e.connId, idOf('invoice_lines'), { read: true });
    });

    afterAll(async () => {
      await tearDown();
    });

    const post = (body: unknown, user = e.t.users.admin) =>
      e.t.app.inject({
        method: 'POST',
        url: `/api/v1/data/${e.connId}/${e.invoices}`,
        headers: asUser(user),
        payload: body as never,
      });

    const patch = (id: unknown, body: unknown, user = e.t.users.admin) =>
      e.t.app.inject({
        method: 'PATCH',
        url: `/api/v1/data/${e.connId}/${e.invoices}/${String(id)}`,
        headers: asUser(user),
        payload: body as never,
      });

    const linesOf = async (invoiceId: unknown): Promise<Record<string, unknown>[]> => {
      const reply = await e.t.app.inject({
        method: 'GET',
        url: `/api/v1/data/${e.connId}/${e.lines}?limit=100&order=id.asc`,
        headers: asUser(e.t.users.admin),
      });
      return reply
        .json<{ data: Record<string, unknown>[] }>()
        .data.filter((row) => String(row['invoice_id']) === String(invoiceId));
    };

    it('writes the parent and its lines in one go', async () => {
      const reply = await post({
        values: { who: 'Initech' },
        children: {
          [relation]: [{ values: { item: 'Cable', qty: 2 } }, { values: { item: 'Case', qty: 1 } }],
        },
      });
      expect(reply.statusCode, reply.body).toBe(201);
      const id = reply.json<Mutation>().data['id'];
      const lines = await linesOf(id);
      expect(lines.map((row) => row['item'])).toEqual(['Cable', 'Case']);
      // The foreign key is the PARENT's business: the request never named it
      // and every row carries it.
      expect(lines.every((row) => String(row['invoice_id']) === String(id))).toBe(true);
    });

    it('fills a child column from its own default, not from the field', async () => {
      const reply = await post({
        values: { who: 'Umbrella' },
        children: { [relation]: [{ values: { item: 'Rain cover' } }] },
      });
      const lines = await linesOf(reply.json<Mutation>().data['id']);
      // A child row is a RECORD: its table's default applies exactly as it
      // would through the front door.
      expect(Number(lines[0]?.['qty'])).toBe(1);
    });

    it('saves a change as a DIFF: one update, one insert, one delete', async () => {
      const created = await post({
        values: { who: 'Acme' },
        children: {
          [relation]: [{ values: { item: 'Anvil', qty: 1 } }, { values: { item: 'Rope', qty: 3 } }],
        },
      });
      const id = created.json<Mutation>().data['id'];
      const before = await linesOf(id);
      const anvil = before[0] as Record<string, unknown>;

      const saved = await patch(id, {
        values: { who: 'Acme Ltd' },
        children: {
          [relation]: [
            { key: { id: anvil['id'] }, values: { item: 'Anvil', qty: 9 } },
            { values: { item: 'Springs', qty: 2 } },
          ],
        },
      });
      expect(saved.statusCode, saved.body).toBe(200);
      const after = await linesOf(id);
      expect(after.map((row) => row['item'])).toEqual(['Anvil', 'Springs']);
      // The kept row KEPT ITS ID. A delete-and-reinsert would have burned it,
      // and anything pointing at that line would now point at nothing.
      expect(String(after[0]?.['id'])).toBe(String(anvil['id']));
      expect(Number(after[0]?.['qty'])).toBe(9);
    });

    it('undoes the parent and its lines together', async () => {
      const created = await post({
        values: { who: 'Undo me' },
        children: { [relation]: [{ values: { item: 'One' } }, { values: { item: 'Two' } }] },
      });
      const id = created.json<Mutation>().data['id'];
      const token = created.json<Mutation>().undoToken;
      expect(token).not.toBeNull();
      expect(await linesOf(id)).toHaveLength(2);

      const undone = await e.t.app.inject({
        method: 'POST',
        url: `/api/v1/data/undo/${String(token)}`,
        headers: asUser(e.t.users.admin),
      });
      // The children go first or the parent's delete meets its own foreign
      // keys — on every engine that enforces them.
      expect(undone.statusCode, undone.body).toBe(200);
      expect(await linesOf(id)).toHaveLength(0);
    });

    it('restores a removed line when an edit is undone', async () => {
      const created = await post({
        values: { who: 'Keeper' },
        children: { [relation]: [{ values: { item: 'Kept' } }, { values: { item: 'Dropped' } }] },
      });
      const id = created.json<Mutation>().data['id'];
      const lines = await linesOf(id);
      const kept = lines[0] as Record<string, unknown>;

      const saved = await patch(id, {
        values: { who: 'Keeper' },
        children: { [relation]: [{ key: { id: kept['id'] }, values: { item: 'Kept' } }] },
      });
      expect(await linesOf(id)).toHaveLength(1);

      const token = saved.json<Mutation>().undoToken;
      const undone = await e.t.app.inject({
        method: 'POST',
        url: `/api/v1/data/undo/${String(token)}`,
        headers: asUser(e.t.users.admin),
      });
      expect(undone.statusCode, undone.body).toBe(200);
      // A removal is undone by writing the WHOLE row back; keys alone would
      // have made it unrecoverable the moment it was gone.
      expect((await linesOf(id)).map((row) => row['item']).sort()).toEqual(['Dropped', 'Kept']);
    });

    it('refuses a caller who may write the parent and not the lines', async () => {
      const reply = await post(
        { values: { who: 'Sneaky' }, children: { [relation]: [{ values: { item: 'Nope' } }] } },
        e.t.users.editor,
      );
      expect(reply.statusCode, reply.body).toBe(403);
      // …and the PARENT is not written either: one transaction, one outcome.
      const list = await e.t.app.inject({
        method: 'GET',
        url: `/api/v1/data/${e.connId}/${e.invoices}?limit=100`,
        headers: asUser(e.t.users.admin),
      });
      expect(list.json<{ data: Record<string, unknown>[] }>().data.some((row) => row['who'] === 'Sneaky')).toBe(
        false,
      );
    });

    it('refuses a relation that points the other way', async () => {
      const reply = await e.t.app.inject({
        method: 'POST',
        url: `/api/v1/data/${e.connId}/${e.lines}`,
        headers: asUser(e.t.users.admin),
        payload: { values: { item: 'Backwards', invoice_id: 1 }, children: { [relation]: [] } } as never,
      });
      expect(reply.statusCode).toBe(422);
      // The reason is the message: a field that silently disappears is a
      // feature nobody can debug.
      expect(reply.body).toContain('reference');
    });

    it('rolls the parent back when a line is refused', async () => {
      const reply = await post({
        values: { who: 'Doomed' },
        children: { [relation]: [{ values: { item: 'Fine' } }, { values: { qty: 2 } }] },
      });
      expect(reply.statusCode).toBeGreaterThanOrEqual(400);
      const list = await e.t.app.inject({
        method: 'GET',
        url: `/api/v1/data/${e.connId}/${e.invoices}?limit=100`,
        headers: asUser(e.t.users.admin),
      });
      expect(list.json<{ data: Record<string, unknown>[] }>().data.some((row) => row['who'] === 'Doomed')).toBe(
        false,
      );
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
      dir = mkdtempSync(join(tmpdir(), 'adminium-children-'));
      const file = join(dir, 'billing.db');
      const db = new BetterSqlite3(file);
      db.exec('PRAGMA foreign_keys = ON');
      for (const statement of DDL.sqlite) db.exec(statement);
      db.close();
      t = await buildDataTestApp();
      const connId = await createConnectionViaApi(t, `sqlite:${file}`, 'billing', 'sqlite');
      await introspectViaApi(t, connId);
      await grantAll(t, connId);
      return { t, connId, invoices: 'invoices', lines: 'invoice_lines' };
    },
    async () => {
      await t?.app.close();
      if (dir !== null) rmSync(dir, { recursive: true, force: true });
    },
  );
}

// --- postgres ----------------------------------------------------------------

{
  const database = `adminium_test_children_${randomBytes(4).toString('hex')}`;
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
      const connId = await createConnectionViaApi(
        t,
        `postgres://${user}@127.0.0.1:5432/${database}`,
        'billing',
        'postgres',
      );
      await introspectViaApi(t, connId);
      await grantAll(t, connId);
      return { t, connId, invoices: 'public.invoices', lines: 'public.invoice_lines' };
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
  const database = `adminium_test_children_${randomBytes(4).toString('hex')}`;
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
      const connId = await createConnectionViaApi(t, `${MYSQL_URL as string}/${database}`, 'billing', 'mysql');
      await introspectViaApi(t, connId);
      await grantAll(t, connId);
      return {
        t,
        connId,
        invoices: `${database}.invoices`,
        lines: `${database}.invoice_lines`,
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
