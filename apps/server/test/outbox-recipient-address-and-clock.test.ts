// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP'S EMAIL: WHERE IT GOES, AND WHOSE CLOCK IT READS.
 *
 * Two things the sender does with a queued outbox row, on every engine:
 *
 *  - A row that names no address — one a desk queued by hand, linking a
 *    patient whose email the desk's role may not read — is sent where its
 *    recipient link says (the patient, else what the visit it links carries
 *    for a first visit), and the address is written into the row once it is
 *    sent. A row that names its own address keeps it; one whose recipient has
 *    none is still "No email on file".
 *  - A recipient whose language is not one of Adminium's gets the nearest
 *    template (`en-GB` → the `en_US` email), but its times read their own
 *    way: "09:30", not "9:30 AM".
 *
 * SQLite always runs; Postgres gates on a reachable `psql`, MySQL on
 * TEST_MYSQL_URL.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import BetterSqlite3 from 'better-sqlite3';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DatabaseModel } from '@adminium/engine';
import type { Outbox } from '@adminium/manifest';
import { emailTemplatesRepo, overridesRepo, settingsRepo, snapshotsRepo } from '@adminium/meta';

import { encryptSecret, decryptSecret } from '../src/config/secrets.js';
import { applyOverrides } from '../src/connections/effective-schema.js';
import { SnapshotView } from '../src/crud/identifiers.js';
import { createWriteService } from '../src/crud/write-service.js';
import { normalizeWriteValue } from '../src/crud/write-values.js';
import { emailSecretKey } from '../src/email/config.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import { formatTag } from '../src/i18n/bcp47.js';
import { createOutboxSender } from '../src/outbox/sender.js';
import { buildDataTestApp, createConnectionViaApi, introspectViaApi, pgAvailable, psql, type DataTestContext } from './connections-helpers.js';
import { TEST_SECRET } from './helpers.js';

const DDL = {
  sqlite: [
    `CREATE TABLE patients (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(80) NOT NULL, email VARCHAR(120), language VARCHAR(12))`,
    `CREATE TABLE appointments (id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id INTEGER REFERENCES patients(id), starts_at DATETIME NOT NULL,
       new_name VARCHAR(80), new_email VARCHAR(120), new_language VARCHAR(12))`,
    `CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, kind VARCHAR(20) NOT NULL, status VARCHAR(10) NOT NULL, to_address VARCHAR(120),
       language VARCHAR(12), patient_id INTEGER REFERENCES patients(id), appointment_id INTEGER REFERENCES appointments(id), error VARCHAR(120), sent_at DATETIME)`,
  ],
  postgres: [
    `CREATE TABLE patients (id serial PRIMARY KEY, name varchar(80) NOT NULL, email varchar(120), language varchar(12))`,
    `CREATE TABLE appointments (id serial PRIMARY KEY, patient_id integer REFERENCES patients(id), starts_at timestamptz NOT NULL,
       new_name varchar(80), new_email varchar(120), new_language varchar(12))`,
    `CREATE TABLE messages (id serial PRIMARY KEY, kind varchar(20) NOT NULL, status varchar(10) NOT NULL, to_address varchar(120),
       language varchar(12), patient_id integer REFERENCES patients(id), appointment_id integer REFERENCES appointments(id), error varchar(120), sent_at timestamptz)`,
  ],
  mysql: [
    `CREATE TABLE patients (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(80) NOT NULL, email VARCHAR(120), language VARCHAR(12))`,
    `CREATE TABLE appointments (id INT AUTO_INCREMENT PRIMARY KEY, patient_id INT, starts_at DATETIME NOT NULL,
       new_name VARCHAR(80), new_email VARCHAR(120), new_language VARCHAR(12), FOREIGN KEY (patient_id) REFERENCES patients(id))`,
    `CREATE TABLE messages (id INT AUTO_INCREMENT PRIMARY KEY, kind VARCHAR(20) NOT NULL, status VARCHAR(10) NOT NULL, to_address VARCHAR(120),
       language VARCHAR(12), patient_id INT, appointment_id INT, error VARCHAR(120), sent_at DATETIME,
       FOREIGN KEY (patient_id) REFERENCES patients(id), FOREIGN KEY (appointment_id) REFERENCES appointments(id))`,
  ],
} as const;

/** 08:30 UTC on a September day: 09:30 in London (summer time). */
const VISIT = '2026-09-25 08:30:00';
/** The day before, mid-morning in London. */
const NOW = Date.parse('2026-09-24T10:00:00Z');

interface Engine {
  t: DataTestContext;
  connId: string;
  /** A table's id as the snapshot names it. */
  id: (name: string) => string;
  /** A timestamp literal the engine keeps as that UTC instant. */
  instant: (utc: string) => string;
}

function suite(label: string, ready: boolean, setUp: () => Promise<Engine>, tearDown: () => Promise<void>) {
  describe.skipIf(!ready)(`an app's email on ${label}`, () => {
    let e: Engine;
    let run: (statement: string) => Promise<void>;
    let rows: (statement: string) => Promise<Record<string, unknown>[]>;
    let send: () => Promise<number>;

    beforeAll(async () => {
      e = await setUp();
      const { t, connId } = e;
      const { db } = await t.manager.data(connId);
      run = async (statement) => {
        await sql.raw(statement).execute(db);
      };
      rows = async (statement) => (await sql.raw<Record<string, unknown>>(statement).execute(db)).rows;
      await t.meta.db.updateTable('adminium_connections').set({ timezone: 'Europe/London', currency: 'GBP' }).where('id', '=', connId).execute();
      await settingsRepo(t.meta).set('email.smtp', {
        host: 'localhost',
        port: 587,
        user: 'postmaster',
        passEncrypted: encryptSecret('hunter2', emailSecretKey(TEST_SECRET)),
        from: 'Clinic <no-reply@clinic.dev>',
        secure: false,
      } as never);
      const blocks = [{ id: 'b1', block: 'email.text', data: { text: 'Hi {{recipient.first_name}}, see you {{appointment.starts_at.relative_day}} at {{appointment.starts_at.time}}.' } }];
      await emailTemplatesRepo(t.meta).upsert('clinic-reminder', 'en_US', { name: 'Reminder', subject: 'See you at {{appointment.starts_at.time}}', blocks, enabled: true });
      await emailTemplatesRepo(t.meta).upsert('clinic-reminder', 'de_DE', { name: 'Erinnerung', subject: 'Bis {{appointment.starts_at.time}}', blocks, enabled: true });

      const definition: Outbox = {
        table: e.id('messages'),
        columns: { kind: 'kind', status: 'status', to: 'to_address', language: 'language', error: 'error', sentAt: 'sent_at' },
        links: { appointment: 'appointment_id', patient: 'patient_id' },
        recipient: {
          via: 'patient_id',
          table: e.id('patients'),
          email: 'email',
          name: 'name',
          language: 'language',
          fallback: { via: 'appointment_id', email: 'new_email', name: 'new_name', language: 'new_language' },
        },
        kinds: { reminder: 'clinic-reminder' },
      };
      const viewFor = async () => {
        const snapshot = await snapshotsRepo(t.meta).latest(connId);
        const active = await overridesRepo(t.meta).listForConnection(connId, { status: 'active' });
        return new SnapshotView(connId, applyOverrides(snapshot?.schema as DatabaseModel, active), new Map());
      };
      const sender = createOutboxSender({
        meta: t.meta,
        manager: t.manager,
        viewFor,
        writes: createWriteService(),
        live: async () => [{ appKey: 'clinic', connectionId: connId, definition, row: {} as never }],
        secret: TEST_SECRET,
      });
      send = () => sender.sendApp('clinic', NOW);
    });

    afterAll(async () => {
      await tearDown();
    });

    /** Every email queued, newest last, as the mail job will send it. */
    const mail = async () =>
      (await e.t.meta.db.selectFrom('adminium_jobs').selectAll().where('kind', '=', 'email.send').orderBy('createdAt').execute()).map((job) => {
        const payload = (typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload) as { locale: string; envelope: string };
        const envelope = JSON.parse(decryptSecret(payload.envelope, emailEnvelopeKey(TEST_SECRET))) as { to: string; subject: string; text: string };
        return { locale: payload.locale, to: envelope.to, subject: envelope.subject, text: envelope.text };
      });
    const idOf = async (statement: string) => Number((await rows(statement))[0]!['id']);
    const message = async (id: number) => {
      const [row] = await rows(`SELECT status, to_address, language, error, sent_at FROM messages WHERE id = ${String(id)}`);
      return { status: row!['status'], to: row!['to_address'] ?? null, language: row!['language'] ?? null, error: row!['error'] ?? null, sent: row!['sent_at'] !== null };
    };
    const queue = async (values: { to?: string; language?: string; patient?: number; visit?: number }) => {
      const q = (value: string | number | undefined) => (value === undefined ? 'NULL' : typeof value === 'number' ? String(value) : `'${value}'`);
      await run(
        `INSERT INTO messages (kind, status, to_address, language, patient_id, appointment_id) VALUES ('reminder', 'queued', ${q(values.to)}, ${q(values.language)}, ${q(values.patient)}, ${q(values.visit)})`,
      );
      return idOf('SELECT max(id) AS id FROM messages');
    };

    it('sends a row that names no address where its recipient link says, and writes the address in', async () => {
      await run(`INSERT INTO patients (name, email, language) VALUES ('Grace Hopper', 'grace@patients.clinic.dev', 'en-GB')`);
      await run(`INSERT INTO patients (name, email) VALUES ('Nobody Known', NULL)`);
      await run(`INSERT INTO patients (name, email) VALUES ('Rex Sample', 'rex@example.com')`);
      const grace = await idOf(`SELECT id FROM patients WHERE name = 'Grace Hopper'`);
      const nobody = await idOf(`SELECT id FROM patients WHERE name = 'Nobody Known'`);
      const rex = await idOf(`SELECT id FROM patients WHERE name = 'Rex Sample'`);
      await run(`INSERT INTO appointments (patient_id, starts_at) VALUES (${String(grace)}, ${e.instant(VISIT)})`);
      const visit = await idOf(`SELECT max(id) AS id FROM appointments`);
      // A first visit: nobody on file, the details on the visit.
      await run(`INSERT INTO appointments (starts_at, new_name, new_email, new_language) VALUES (${e.instant(VISIT)}, 'Dan Newman', 'dan@new.clinic.dev', 'de')`);
      const first = await idOf(`SELECT max(id) AS id FROM appointments`);

      // The desk's "Send now" for Grace: the patient linked, the address left to the sender.
      const forGrace = await queue({ patient: grace, visit });
      // A row that names its own address keeps it, whoever it links.
      const ownAddress = await queue({ to: 'front-desk@clinic.dev', language: 'en-GB', patient: grace, visit });
      // Nobody on file: what the visit carries.
      const forFirst = await queue({ visit: first });
      // Linked, and nothing on file anywhere.
      const noEmail = await queue({ patient: nobody });
      // Linked to an address on a reserved domain.
      const reserved = await queue({ patient: rex });

      expect(await send()).toBe(5);
      expect(await message(forGrace)).toEqual({ status: 'sent', to: 'grace@patients.clinic.dev', language: 'en-GB', error: null, sent: true });
      expect(await message(ownAddress)).toEqual({ status: 'sent', to: 'front-desk@clinic.dev', language: 'en-GB', error: null, sent: true });
      expect(await message(forFirst)).toEqual({ status: 'sent', to: 'dan@new.clinic.dev', language: 'de', error: null, sent: true });
      expect(await message(noEmail)).toEqual({ status: 'skipped', to: null, language: null, error: 'No email on file', sent: false });
      expect(await message(reserved)).toEqual({ status: 'skipped', to: null, language: null, error: 'A reserved address (for examples and tests)', sent: false });

      const sent = await mail();
      expect(sent.map((m) => [m.to, m.locale])).toEqual([
        ['grace@patients.clinic.dev', 'en_US'],
        ['front-desk@clinic.dev', 'en_US'],
        ['dan@new.clinic.dev', 'de_DE'],
      ]);
      // Grace's email in the nearest template language, on her own clock.
      expect(sent[0]!.subject).toBe('See you at 09:30');
      expect(sent[0]!.text).toContain('Hi Grace, see you tomorrow at 09:30.');
      expect(sent[0]!.text).not.toContain('AM');
      expect(sent[1]!.subject).toBe('See you at 09:30');
      // Dan's in German, looked up with his address.
      expect(sent[2]!.subject).toBe('Bis 09:30');
    });

    it('reads an American recipient’s time the American way, from the same template', async () => {
      await run(`INSERT INTO patients (name, email, language) VALUES ('Ada Byron', 'ada@patients.clinic.dev', 'en-US')`);
      const ada = await idOf(`SELECT id FROM patients WHERE name = 'Ada Byron'`);
      await run(`INSERT INTO appointments (patient_id, starts_at) VALUES (${String(ada)}, ${e.instant(VISIT)})`);
      const visit = await idOf(`SELECT max(id) AS id FROM appointments`);
      await queue({ patient: ada, visit });
      expect(await send()).toBe(1);
      expect((await mail()).at(-1)).toMatchObject({ to: 'ada@patients.clinic.dev', locale: 'en_US', subject: 'See you at 9:30 AM' });
    });
  });
}

describe('formatTag', () => {
  it('keeps the recipient’s own tag in the language the text is written in', () => {
    expect(formatTag('en-GB', 'en_US')).toBe('en-GB');
    expect(formatTag('en_GB', 'en_US')).toBe('en-GB');
    expect(formatTag('fr-CA', 'fr_FR')).toBe('fr-CA');
    // An Accept-Language list: its first tag in that language.
    expect(formatTag('ja, en-AU;q=0.8, en;q=0.5', 'en_US')).toBe('en-AU');
  });

  it('falls back to the text’s own language for another language, nothing, or a tag that is not one', () => {
    expect(formatTag('ja', 'en_US')).toBe('en-US');
    expect(formatTag(null, 'de_DE')).toBe('de-DE');
    expect(formatTag('en-@@', 'en_US')).toBe('en-US');
  });
});

/** A zone-less column keeps an instant as this server's wall clock, as every write through Adminium spells it. */
const wallClock = (utc: string): string => `'${String(normalizeWriteValue({ logicalType: 'timestamp' } as never, `${utc.replace(' ', 'T')}Z`))}'`;

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
      dir = mkdtempSync(join(tmpdir(), 'adminium-outbox-address-'));
      const file = join(dir, 'clinic.db');
      const db = new BetterSqlite3(file);
      for (const statement of DDL.sqlite) db.exec(statement);
      db.close();
      t = await buildDataTestApp();
      const connId = await createConnectionViaApi(t, `sqlite:${file}`, 'clinic', 'sqlite');
      await introspectViaApi(t, connId);
      await grantAll(t, connId);
      return { t, connId, id: (name) => `main.${name}`, instant: wallClock };
    },
    async () => {
      await t?.app.close();
      if (dir !== null) rmSync(dir, { recursive: true, force: true });
    },
  );
}

// --- postgres ----------------------------------------------------------------

{
  const database = `adminium_test_outbox_${randomBytes(4).toString('hex')}`;
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
      return { t, connId, id: (name) => `public.${name}`, instant: (utc) => `'${utc}+00:00'` };
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
  const database = `adminium_test_outbox_${randomBytes(4).toString('hex')}`;
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
      return { t, connId, id: (name) => `${database}.${name}`, instant: wallClock };
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
