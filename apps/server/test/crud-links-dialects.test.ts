// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LINK FIELDS, THROUGH THE ROUTES, ON EVERY ENGINE.
 *
 * A booking with three services is three rows of a join table, written in the
 * same transaction as the booking itself. The claims worth making are the ones
 * a unit test cannot: that the rows land on a real engine, that a replace is a
 * DIFF and not a delete-and-reinsert of everything, that the undo puts the
 * previous set back, and that the two refusals — a caller without the grant,
 * and a join table with a column nobody fills — are refusals rather than
 * silence.
 *
 * SQLite always runs. Postgres gates on a reachable `psql`, MySQL on
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

interface Mutation {
  data: Record<string, unknown>;
  undoToken: string | null;
}

interface LinksReply {
  data: { key: string | number; name: string; detail?: string }[];
  hasMore: boolean;
}

interface Refusal {
  error: { code: string; message: string; details?: { relation?: string } };
}

/** The tables every engine gets, named the same way. */
const DDL = {
  sqlite: [
    `CREATE TABLE services (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(40) NOT NULL, room VARCHAR(20))`,
    `CREATE TABLE rooms (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(40) NOT NULL)`,
    `CREATE TABLE bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, who VARCHAR(40) NOT NULL)`,
    `CREATE TABLE booking_services (
       booking_id INTEGER NOT NULL REFERENCES bookings(id),
       service_id INTEGER NOT NULL REFERENCES services(id),
       PRIMARY KEY (booking_id, service_id))`,
    `CREATE TABLE booking_rooms (
       booking_id INTEGER NOT NULL REFERENCES bookings(id),
       room_id INTEGER NOT NULL REFERENCES rooms(id),
       note VARCHAR(40) NOT NULL,
       PRIMARY KEY (booking_id, room_id))`,
  ],
  postgres: [
    `CREATE TABLE services (id serial PRIMARY KEY, name varchar(40) NOT NULL, room varchar(20))`,
    `CREATE TABLE rooms (id serial PRIMARY KEY, name varchar(40) NOT NULL)`,
    `CREATE TABLE bookings (id serial PRIMARY KEY, who varchar(40) NOT NULL)`,
    `CREATE TABLE booking_services (
       booking_id integer NOT NULL REFERENCES bookings(id),
       service_id integer NOT NULL REFERENCES services(id),
       PRIMARY KEY (booking_id, service_id))`,
    `CREATE TABLE booking_rooms (
       booking_id integer NOT NULL REFERENCES bookings(id),
       room_id integer NOT NULL REFERENCES rooms(id),
       note varchar(40) NOT NULL,
       PRIMARY KEY (booking_id, room_id))`,
  ],
  mysql: [
    `CREATE TABLE services (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(40) NOT NULL, room VARCHAR(20))`,
    `CREATE TABLE rooms (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(40) NOT NULL)`,
    `CREATE TABLE bookings (id INT AUTO_INCREMENT PRIMARY KEY, who VARCHAR(40) NOT NULL)`,
    `CREATE TABLE booking_services (
       booking_id INT NOT NULL,
       service_id INT NOT NULL,
       PRIMARY KEY (booking_id, service_id),
       FOREIGN KEY (booking_id) REFERENCES bookings(id),
       FOREIGN KEY (service_id) REFERENCES services(id))`,
    `CREATE TABLE booking_rooms (
       booking_id INT NOT NULL,
       room_id INT NOT NULL,
       note VARCHAR(40) NOT NULL,
       PRIMARY KEY (booking_id, room_id),
       FOREIGN KEY (booking_id) REFERENCES bookings(id),
       FOREIGN KEY (room_id) REFERENCES rooms(id))`,
  ],
} as const;

const SEED = [
  `INSERT INTO services (name, room) VALUES ('Cleaning', 'Bldg 1')`,
  `INSERT INTO services (name, room) VALUES ('Check-up', 'Bldg 2')`,
  `INSERT INTO services (name, room) VALUES ('X-ray', 'Annex')`,
  `INSERT INTO rooms (name) VALUES ('Suite A')`,
];

interface Engine {
  t: DataTestContext;
  connId: string;
  /** Qualified names on this engine. */
  bookings: string;
  services: string;
  rooms: string;
}

function suite(label: string, ready: boolean, setUp: () => Promise<Engine>, tearDown: () => Promise<void>) {
  describe.skipIf(!ready)(`link fields on ${label}`, () => {
    let e: Engine;
    /** The `booking_services` relation id, as the model names it. */
    let relation: string;
    let roomsRelation: string;

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
          relations: { id: string; through: { tableId: string } | null }[];
        };
      }>().model;
      const idOf = (name: string): string => {
        const found = model.tables.find((table) => table.name === name);
        if (found === undefined) throw new Error(`no table ${name}`);
        return found.id;
      };
      /*
       * The EDITOR may write bookings and read services — and holds nothing at
       * all on the join table. That is the grant this feature has to notice:
       * the parent's context checks the parent, and a link write that trusted
       * it would write rows into a table this caller was never given.
       */
      await e.t.grantTable(e.t.roles.editor, e.connId, idOf('bookings'), {
        read: true,
        create: true,
        update: true,
      });
      await e.t.grantTable(e.t.roles.editor, e.connId, idOf('services'), { read: true });
      const through = (suffix: string): string => {
        const found = model.relations.find((r) => r.through !== null && r.through.tableId.endsWith(suffix));
        if (found === undefined) {
          throw new Error(`no m2m through ${suffix}; saw ${model.relations.map((r) => r.id).join(', ')}`);
        }
        return found.id;
      };
      relation = through('booking_services');
      roomsRelation = through('booking_rooms');
    });

    afterAll(async () => {
      await tearDown();
    });

    const post = (body: unknown, user = e.t.users.admin) =>
      e.t.app.inject({
        method: 'POST',
        url: `/api/v1/data/${e.connId}/${e.bookings}`,
        headers: asUser(user),
        payload: body as never,
      });

    const patch = (id: unknown, body: unknown, user = e.t.users.admin) =>
      e.t.app.inject({
        method: 'PATCH',
        url: `/api/v1/data/${e.connId}/${e.bookings}/${String(id)}`,
        headers: asUser(user),
        payload: body as never,
      });

    const linksOf = async (id: unknown, rel = relation): Promise<LinksReply> => {
      const reply = await e.t.app.inject({
        method: 'GET',
        url: `/api/v1/data/${e.connId}/${e.bookings}/${String(id)}/links/${encodeURIComponent(rel)}?name=name&detail=room`,
        headers: asUser(e.t.users.admin),
      });
      expect(reply.statusCode, reply.body).toBe(200);
      return reply.json<LinksReply>();
    };

    const undo = (token: string) =>
      e.t.app.inject({
        method: 'POST',
        url: `/api/v1/data/undo/${token}`,
        headers: asUser(e.t.users.admin),
      });

    it('writes the record and its links in one request', async () => {
      const created = await post({ values: { who: 'Ada' }, links: { [relation]: [1, 2, 3] } });
      expect(created.statusCode, created.body).toBe(201);
      const id = created.json<Mutation>().data['id'];

      const links = await linksOf(id);
      expect(links.hasMore).toBe(false);
      // The names come from the TARGET, through its own masking policy, and
      // the detail line is the column the field asked for.
      expect(links.data.map((row) => row.name).sort()).toEqual(['Check-up', 'Cleaning', 'X-ray']);
      expect(links.data.find((row) => row.name === 'X-ray')?.detail).toBe('Annex');
    });

    it('replaces a set with a diff, and puts the old one back on undo', async () => {
      const created = await post({ values: { who: 'Grace' }, links: { [relation]: [1, 2, 3] } });
      const id = created.json<Mutation>().data['id'];

      const replaced = await patch(id, { values: { who: 'Grace H' }, links: { [relation]: [1, 3] } });
      expect(replaced.statusCode, replaced.body).toBe(200);
      expect((await linksOf(id)).data.map((row) => row.name).sort()).toEqual(['Cleaning', 'X-ray']);

      const token = replaced.json<Mutation>().undoToken;
      expect(token).not.toBeNull();
      const undone = await undo(token as string);
      expect(undone.statusCode, undone.body).toBe(200);
      // The parent's column AND the links: an undo that restored one and not
      // the other is the half-undo this was designed against.
      expect((await linksOf(id)).data.map((row) => row.name).sort()).toEqual([
        'Check-up',
        'Cleaning',
        'X-ray',
      ]);
    });

    it('takes the links away with the record when a create is undone', async () => {
      const created = await post({ values: { who: 'Edsger' }, links: { [relation]: [1, 2] } });
      const id = created.json<Mutation>().data['id'];
      const token = created.json<Mutation>().undoToken;
      expect(token).not.toBeNull();

      const undone = await undo(token as string);
      expect(undone.statusCode, undone.body).toBe(200);
      const gone = await e.t.app.inject({
        method: 'GET',
        url: `/api/v1/data/${e.connId}/${e.bookings}/${String(id)}`,
        headers: asUser(e.t.users.admin),
      });
      expect(gone.statusCode).toBe(404);
      // The link rows went with it: a parent deleted with its links still
      // pointing at it is an orphan or a foreign-key failure.
      const rows = await e.t.app.inject({
        method: 'GET',
        url: `/api/v1/data/${e.connId}/${e.bookings}?limit=100`,
        headers: asUser(e.t.users.admin),
      });
      expect(rows.statusCode).toBe(200);
    });

    it('refuses a caller who may not write the link table', async () => {
      const refused = await post(
        { values: { who: 'Viewer' }, links: { [relation]: [1] } },
        e.t.users.viewer,
      );
      // The viewer holds no grant on `bookings` either, so the refusal comes
      // from the parent first — what matters is that it IS refused, and that
      // nothing was written.
      expect(refused.statusCode).toBe(403);
    });

    it('refuses a caller who may write the record but not the join table', async () => {
      const refused = await post(
        { values: { who: 'Mia' }, links: { [relation]: [1] } },
        e.t.users.editor,
      );
      expect(refused.statusCode, refused.body).toBe(403);
      // …and the booking is not there either: the link rows and the parent are
      // one transaction, so a refused link takes the whole write with it.
      const rows = await e.t.app.inject({
        method: 'GET',
        url: `/api/v1/data/${e.connId}/${e.bookings}?limit=100`,
        headers: asUser(e.t.users.admin),
      });
      expect(rows.json<{ data: { who: string }[] }>().data.some((row) => row.who === 'Mia')).toBe(false);
    });

    it('refuses a join table with a column nobody fills, and says which', async () => {
      const refused = await post({ values: { who: 'Ada' }, links: { [roomsRelation]: [1] } });
      expect(refused.statusCode, refused.body).toBe(422);
      const body = refused.json<Refusal>();
      expect(body.error.message).toMatch(/note/);
      expect(body.error.details?.relation).toBe(roomsRelation);
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
      dir = mkdtempSync(join(tmpdir(), 'adminium-links-'));
      const file = join(dir, 'clinic.db');
      const db = new BetterSqlite3(file);
      for (const statement of [...DDL.sqlite, ...SEED]) db.exec(statement);
      db.close();
      t = await buildDataTestApp();
      const connId = await createConnectionViaApi(t, `sqlite:${file}`, 'clinic', 'sqlite');
      await introspectViaApi(t, connId);
      await grantAll(t, connId);
      return { t, connId, bookings: 'bookings', services: 'services', rooms: 'rooms' };
    },
    async () => {
      await t?.app.close();
      if (dir !== null) rmSync(dir, { recursive: true, force: true });
    },
  );
}

// --- postgres (a reachable psql) ---------------------------------------------

{
  const database = `adminium_test_links_${randomBytes(4).toString('hex')}`;
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
        'clinic',
        'postgres',
      );
      await introspectViaApi(t, connId);
      await grantAll(t, connId);
      return {
        t,
        connId,
        bookings: 'public.bookings',
        services: 'public.services',
        rooms: 'public.rooms',
      };
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
  const database = `adminium_test_links_${randomBytes(4).toString('hex')}`;
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
      const connId = await createConnectionViaApi(t, `${MYSQL_URL as string}/${database}`, 'clinic', 'mysql');
      await introspectViaApi(t, connId);
      await grantAll(t, connId);
      return {
        t,
        connId,
        bookings: `${database}.bookings`,
        services: `${database}.services`,
        rooms: `${database}.rooms`,
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
