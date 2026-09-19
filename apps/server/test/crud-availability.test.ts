// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHICH INSTANTS ARE TAKEN, THROUGH THE ROUTE, ON EVERY ENGINE.
 *
 * The claims worth making here are the ones that decide whether a calendar
 * lies: that the answer is DISTINCT (two bookings of one slot are one taken
 * slot, not two), that the window is half-open so a month never eats the first
 * instant of the next, that the record being EDITED is not counted against
 * itself, and that the three refusals — a column with no days, a masked
 * column, a table this caller cannot read — are refusals and not empty sets.
 * An empty `taken` is indistinguishable from "everything is free", which is
 * the failure this endpoint exists to prevent.
 *
 * SQLite always runs; Postgres gates on a reachable `psql`, MySQL on
 * TEST_MYSQL_URL — the discipline the rest of this suite uses.
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

interface Reply {
  taken: string[];
  capped: boolean;
}

const DDL = {
  sqlite: [
    `CREATE TABLE bookings (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       starts_at TIMESTAMP NOT NULL,
       room VARCHAR(20) NOT NULL,
       who VARCHAR(40) NOT NULL)`,
  ],
  postgres: [
    `CREATE TABLE bookings (
       id serial PRIMARY KEY,
       starts_at timestamp NOT NULL,
       room varchar(20) NOT NULL,
       who varchar(40) NOT NULL)`,
  ],
  mysql: [
    `CREATE TABLE bookings (
       id INT AUTO_INCREMENT PRIMARY KEY,
       starts_at DATETIME NOT NULL,
       room VARCHAR(20) NOT NULL,
       who VARCHAR(40) NOT NULL)`,
  ],
} as const;

/**
 * Two rows on ONE slot (the distinct claim), one on another, one in a second
 * room (the resource claim), and one in the following month (the window).
 */
const SEED = [
  `INSERT INTO bookings (starts_at, room, who) VALUES ('2026-09-17 09:00:00', 'A', 'Ada')`,
  `INSERT INTO bookings (starts_at, room, who) VALUES ('2026-09-17 09:00:00', 'A', 'Grace')`,
  `INSERT INTO bookings (starts_at, room, who) VALUES ('2026-09-17 10:30:00', 'A', 'Alan')`,
  `INSERT INTO bookings (starts_at, room, who) VALUES ('2026-09-18 09:00:00', 'B', 'Edsger')`,
  `INSERT INTO bookings (starts_at, room, who) VALUES ('2026-10-01 09:00:00', 'A', 'Barbara')`,
];

interface Engine {
  t: DataTestContext;
  connId: string;
  bookings: string;
}

const SEPTEMBER = { from: '2026-09-01T00:00', to: '2026-10-01T00:00' };

function suite(label: string, ready: boolean, setUp: () => Promise<Engine>, tearDown: () => Promise<void>) {
  describe.skipIf(!ready)(`availability on ${label}`, () => {
    let e: Engine;

    beforeAll(async () => {
      e = await setUp();
    });
    afterAll(async () => {
      await tearDown();
    });

    const read = (query: Record<string, string>, user?: 'editor') => {
      const search = new URLSearchParams(query).toString();
      return e.t.app.inject({
        method: 'GET',
        url: `/api/v1/data/${e.connId}/${e.bookings}/availability?${search}`,
        headers: asUser(user === 'editor' ? e.t.users.editor : e.t.users.admin),
      });
    };

    it('answers the DISTINCT instants in the window', async () => {
      const reply = await read({ column: 'starts_at', ...SEPTEMBER });
      expect(reply.statusCode, reply.body).toBe(200);
      const body = reply.json<Reply>();
      expect(body.capped).toBe(false);
      // Two rows hold 09:00 on the 17th; that is ONE taken slot. A count would
      // have said two, and a calendar cannot draw "twice taken".
      expect([...body.taken].sort()).toEqual([
        '2026-09-17T09:00',
        '2026-09-17T10:30',
        '2026-09-18T09:00',
      ]);
    });

    it('closes the window at the bottom and opens it at the top', async () => {
      // `to` is EXCLUSIVE: October's first booking belongs to October, and a
      // month that ate it would strike out a day in the wrong grid.
      const reply = await read({ column: 'starts_at', from: '2026-09-17T09:00', to: '2026-09-17T10:30' });
      expect(reply.json<Reply>().taken).toEqual(['2026-09-17T09:00']);
    });

    it('scopes the question to one resource', async () => {
      const reply = await read({
        column: 'starts_at',
        ...SEPTEMBER,
        resource: 'room',
        resourceValue: 'B',
      });
      expect(reply.json<Reply>().taken).toEqual(['2026-09-18T09:00']);
    });

    it('does not count the record being edited against itself', async () => {
      const all = await read({ column: 'starts_at', ...SEPTEMBER });
      expect(all.json<Reply>().taken).toContain('2026-09-17T10:30');
      // Row 3 is the only holder of 10:30. Editing it must leave 10:30 free,
      // or the one slot the booking already has is the one it cannot keep.
      const editing = await read({ column: 'starts_at', ...SEPTEMBER, exclude: '3' });
      expect(editing.json<Reply>().taken).not.toContain('2026-09-17T10:30');
      // …and a slot two rows hold is still taken when one of them steps out.
      const shared = await read({ column: 'starts_at', ...SEPTEMBER, exclude: '1' });
      expect(shared.json<Reply>().taken).toContain('2026-09-17T09:00');
    });

    it('refuses a column with no days in it', async () => {
      const reply = await read({ column: 'who', ...SEPTEMBER });
      expect(reply.statusCode).toBe(422);
      expect(reply.body).toContain('who');
    });

    it('refuses a column the table does not have', async () => {
      const reply = await read({ column: 'nope', ...SEPTEMBER });
      expect(reply.statusCode).toBe(422);
    });

    it('refuses a caller with no read grant on the table', async () => {
      const reply = await read({ column: 'starts_at', ...SEPTEMBER }, 'editor');
      expect(reply.statusCode).toBe(403);
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
      dir = mkdtempSync(join(tmpdir(), 'adminium-avail-'));
      const file = join(dir, 'diary.db');
      const db = new BetterSqlite3(file);
      for (const statement of [...DDL.sqlite, ...SEED]) db.exec(statement);
      db.close();
      t = await buildDataTestApp();
      const connId = await createConnectionViaApi(t, `sqlite:${file}`, 'diary', 'sqlite');
      await introspectViaApi(t, connId);
      await grantAll(t, connId);
      return { t, connId, bookings: 'bookings' };
    },
    async () => {
      await t?.app.close();
      if (dir !== null) rmSync(dir, { recursive: true, force: true });
    },
  );
}

// --- postgres (a reachable psql) ---------------------------------------------

{
  const database = `adminium_test_avail_${randomBytes(4).toString('hex')}`;
  let t: DataTestContext | null = null;
  let made = false;
  suite(
    'postgres',
    pgAvailable(),
    async () => {
      psql('postgres', `CREATE DATABASE ${database}`);
      made = true;
      for (const statement of [...DDL.postgres, ...SEED]) psql(database, statement);
      const user = process.env.PGUSER ?? process.env.USER ?? 'postgres';
      t = await buildDataTestApp();
      const connId = await createConnectionViaApi(
        t,
        `postgres://${user}@127.0.0.1:5432/${database}`,
        'diary',
        'postgres',
      );
      await introspectViaApi(t, connId);
      await grantAll(t, connId);
      return { t, connId, bookings: 'public.bookings' };
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
  const database = `adminium_test_avail_${randomBytes(4).toString('hex')}`;
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
      for (const statement of [...DDL.mysql, ...SEED]) await admin.query(statement);
      t = await buildDataTestApp();
      const connId = await createConnectionViaApi(t, `${MYSQL_URL as string}/${database}`, 'diary', 'mysql');
      await introspectViaApi(t, connId);
      await grantAll(t, connId);
      return { t, connId, bookings: `${database}.bookings` };
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
