// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT AN APP UPDATE CARRIES OVER ONCE (`people[].carry`), through the real
 * installer and the whole server, on SQLite, Postgres and MySQL.
 *
 * 0.1.0 keeps a CRM's contacts with an old "unsubscribed" moment, and a box
 * office's customers whose "news from the venue" tick lives only on their
 * orders. 0.1.1 declares both tables as people, with the carries:
 *
 *  - every contact whose `unsubscribed_at` holds a moment is put on the
 *    do-not-email list once (reason `old-mark`, dated by the moment);
 *  - each customer's newest confirmed order's answer becomes their `opt_in`,
 *    as a yes with no record (no log row, so the first send's review asks);
 *    an unconfirmed order's answer is none; a customer the log already holds
 *    an answer from keeps it; one with no address is left alone.
 *
 * 0.1.2 still declares the carries: its update carries nothing again. And a
 * carry run twice (an update finished again) adds the list's rows once.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { consentLogRepo, stopListRepo, type ConsentPerson } from '@adminium/meta';

import { sha512Integrity } from '../src/add-ons/store.js';
import { addedCarries, carryPeople } from '../src/apps/people-carry.js';
import { consentTableSource, createConsentService } from '../src/consent/index.js';
import { loadSnapshotView } from '../src/data-io/snapshot-view.js';
import type { Manifest } from '@adminium/manifest';
import { packageTarball } from './app-bundle-helpers.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.38' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
type Version = '0.1.0' | '0.1.1' | '0.1.2';

function app(version: Version): Record<string, unknown> {
  const declared = version !== '0.1.0';
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'box',
    name: 'Box office',
    version,
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A box office.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: declared ? '0.3.38' : '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'contacts',
          columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'email', type: 'text', maxLength: 254, nullable: true }, { ref: 'may_email', type: 'bool', default: false }, { ref: 'unsubscribed_at', type: 'timestamptz', nullable: true }],
        },
        {
          ref: 'customers',
          columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'email', type: 'text', maxLength: 254, nullable: true }, { ref: 'opt_in', type: 'bool', default: false }],
        },
        {
          ref: 'orders',
          columns: [id, { ref: 'customer_id', type: 'fk', references: 'customers' }, { ref: 'opt_in', type: 'bool', default: false }, { ref: 'confirmed_at', type: 'timestamptz', nullable: true }],
        },
      ],
    },
    ...(declared
      ? {
          people: [
            { table: 'contacts', kind: 'people', email: 'email', name: 'name', consent: { column: 'may_email', purpose: 'newsletter' }, carry: [{ stopList: { column: 'unsubscribed_at' } }] },
            {
              table: 'customers',
              kind: 'people',
              email: 'email',
              name: 'name',
              consent: { column: 'opt_in', purpose: 'newsletter' },
              carry: [{ consent: { from: 'orders', via: 'customer_id', column: 'opt_in', latest: 'confirmed_at' } }],
            },
          ],
        }
      : {}),
    pages: [{ ref: 'box-contacts', template: 'page-crud', title: { key: 't', fallback: 'Contacts' }, nav: { group: 'box', icon: 'list', order: 1 }, bindings: { rows: 'contacts' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

const yes = (value: unknown): boolean => value === true || value === 1 || value === '1';

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`an update carries the old marks over once [${dialect}]`, () => {
    let s: WholeServer;
    let customersId = '';
    const consent = () => createConsentService({ meta: s.meta, secret: TEST_SECRET, tables: consentTableSource({ meta: s.meta, manager: s.manager }) });
    const update = async (version: Version) => {
      const tarball = packageTarball({ 'manifest.json': JSON.stringify(app(version)), 'staff/index.html': '<!doctype html><html><body></body></html>' });
      const staged = await s.app.inject({ method: 'POST', url: `/api/v1/apps/upload?expectedSha512=${encodeURIComponent(sha512Integrity(tarball))}`, headers: { cookie: s.cookie['owner']!, 'content-type': 'application/octet-stream' }, payload: Buffer.from(tarball) });
      expect(staged.statusCode, staged.body).toBe(200);
      const updated = await s.send('owner', 'POST', '/api/v1/apps/box/update', {});
      expect(updated.statusCode, updated.body).toBe(200);
    };
    const optIn = async () => Object.fromEntries((await s.rows('select id, opt_in from box_customers order by id')).map((row) => [Number(row['id']), yes(row['opt_in'])]));
    const person = (key: number): ConsentPerson => ({ connectionId: s.connectionId, table: customersId, key: String(key) });

    beforeAll(async () => {
      s = await wholeServer(dialect, app('0.1.0'));
      customersId = s.t('customers');
      // Made on 0.1.0: two unsubscribed contacts (one twice over, by case), one not, one with no address.
      await s.rows(
        "insert into box_contacts (id, name, email, unsubscribed_at) values (1, 'Una', 'una@lists.example', '2024-05-01 10:00:00'), (2, 'Ben', 'ben@lists.example', null), (3, 'Cy', 'CY@Lists.example', '2024-06-01 10:00:00'), (4, 'Dee', null, '2024-07-01 10:00:00')",
      );
      await s.rows("insert into box_customers (id, name, email, opt_in) values (1, 'Ada', 'ada@fans.example', false), (2, 'Bo', 'bo@fans.example', false), (3, 'Cleo', 'cleo@fans.example', false), (4, 'Dov', null, false), (5, 'Eli', 'eli@fans.example', true)");
      await s.rows(
        [
          'insert into box_orders (id, customer_id, opt_in, confirmed_at) values',
          // Ada said yes on her newest confirmed order; her unconfirmed one after it says nothing.
          "(1, 1, false, '2024-01-01 10:00:00'), (2, 1, true, '2024-03-01 10:00:00'), (3, 1, false, null),",
          // Bo said yes, then no.
          "(4, 2, true, '2024-01-01 10:00:00'), (5, 2, false, '2024-02-01 10:00:00'),",
          // Cleo said yes, but has told the log otherwise since; Dov has no address; Eli said no last.
          "(6, 3, true, '2024-01-01 10:00:00'), (7, 4, true, '2024-01-01 10:00:00'), (8, 5, false, '2024-04-01 10:00:00')",
        ].join(' '),
      );
      await consent().withdraw({ person: person(3), address: 'cleo@fans.example', purpose: 'newsletter', source: 'unsubscribe' });
      await update('0.1.1');
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('puts every contact with an old unsubscribe moment on the do-not-email list, once, dated by it', async () => {
      const service = consent();
      expect(await service.stop.has('una@lists.example')).toBe(true);
      expect(await service.stop.has('cy@lists.example')).toBe(true);
      expect(await service.stop.has('ben@lists.example')).toBe(false);
      expect(await stopListRepo(s.meta).count('old-mark')).toBe(2);
      const una = (await service.stop.entryFor('una@lists.example'))!;
      expect([una.reason, una.origin]).toEqual(['old-mark', 'Box office']);
      // Dated by the old mark (within a day: each engine reads a moment kept with no zone on its own clock).
      expect(Math.abs(una.addedAt - Date.parse('2024-05-01T10:00:00Z'))).toBeLessThan(24 * 3_600_000);
    });

    it('gives each customer the newest confirmed answer, as a yes with no record; the log\'s own answer stands', async () => {
      // Ada yes (her newest confirmed), Bo no (his newest), Cleo kept as no (the log), Dov no address, Eli no (newest).
      expect(await optIn()).toEqual({ 1: true, 2: false, 3: false, 4: false, 5: false });
      // No row in the log for the carried yes: the first send's review asks about it.
      expect(await consentLogRepo(s.meta).history({ person: person(1), hashes: [] }, { limit: 5 })).toEqual([]);
    });

    it('an update that still declares the carries carries nothing again', async () => {
      await s.rows('update box_customers set opt_in = false where id = 1');
      await s.rows("insert into box_contacts (id, name, email, unsubscribed_at) values (5, 'Eve', 'eve@lists.example', '2024-08-01 10:00:00')");
      await update('0.1.2');
      expect(await stopListRepo(s.meta).count('old-mark')).toBe(2);
      expect((await optIn())[1]).toBe(false);
    });

    it('a carry run twice adds the list\'s rows once and sets the same answers', async () => {
      const steps = addedCarries(app('0.1.0'), app('0.1.1') as unknown as Manifest);
      expect(steps.map((step) => [step.entry.table, Object.keys(step.carry)[0]])).toEqual([
        ['contacts', 'stopList'],
        ['customers', 'consent'],
      ]);
      const { db, dialect: engine } = await s.manager.data(s.connectionId);
      const view = await loadSnapshotView(s.meta, s.connectionId, { lists: true });
      const run = () => carryPeople({ consent: consent(), manifest: app('0.1.1') as unknown as Manifest, steps, connectionId: s.connectionId, view, db, dialect: engine, names: { contacts: 'box_contacts', customers: 'box_customers', orders: 'box_orders' } });
      const first = await run();
      expect([first.stopListed, first.consented]).toEqual([1, 1]);
      const second = await run();
      expect([second.stopListed, second.consented]).toEqual([0, 0]);
      expect(await stopListRepo(s.meta).count('old-mark')).toBe(3);
      expect(await optIn()).toEqual({ 1: true, 2: false, 3: false, 4: false, 5: false });
    });
  });
}
