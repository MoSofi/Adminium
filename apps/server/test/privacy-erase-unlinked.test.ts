// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ERASING A PERSON WHOSE COPIES HAVE NO LINK BACK, on SQLite, Postgres and
 * MySQL, through a point-of-sale-shaped app installed by the real installer:
 * table bookings kept with a name, a mobile and maybe an address, and no
 * link to the customer (a booking is taken on the phone, before anyone is a
 * customer); a ticket whose receipt went to them; deposits the law keeps.
 *
 *  - A booking with their address loses every copy of theirs on it (the
 *    name and the mobile too, not the address alone) and their request
 *    marked personal; the staff's own note stays.
 *  - A booking with no address, taken under their number written another
 *    way, is found by the number and erased the same.
 *  - Another person's booking that holds their number loses the number
 *    alone. A booking with a number that only shares a few digits stays.
 *  - A deposit the law keeps is left whole, found by their number, and
 *    "What stays" counts it; "What goes" counts every booking above, and the
 *    search finds them too.
 */
import { permissionsRepo, rolesRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LEGS, said, wholeServer, type Reply, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.38' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 80, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });
const fk = (ref: string, references: string) => ({ ref, type: 'fk', references, nullable: true });
const en = (value: string) => ({ 'en-US': value });

const MARTA = 'marta.kovac@cobaltlegal.example';
const BEN = 'ben@other.example';

function pos(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'pos',
    name: 'Point of Sale',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.pos.desc', fallback: 'A till.' },
    categories: ['hospitality'],
    compatibility: { minAdminiumVersion: '0.3.38', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'floor', label: en('Floor'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'customers', keyField: 'name', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, text('mobile', 32, { rules: { personal: true } }), text('email', 254, { unique: true, rules: { personal: true } })] },
        {
          ref: 'reservations',
          keyField: 'code',
          columns: [
            id,
            text('code', 12),
            // NOT NULL, as the app has it: an erased one reads "Erased person".
            { ref: 'name', type: 'text', maxLength: 80 },
            text('mobile', 32),
            text('email', 254),
            { ref: 'party_size', type: 'int', default: 2 },
            text('guest_request', 280, { rules: { personal: true } }),
            text('staff_note', 280, { rules: { personal: false } }),
          ],
        },
        { ref: 'tickets', columns: [id, fk('customer_id', 'customers'), text('receipt_to', 254), { ref: 'total', type: 'int', nullable: true }] },
        { ref: 'deposits', keep: { law: 'tax' }, columns: [id, text('payer_name'), text('payer_mobile', 32), { ref: 'amount', type: 'int', nullable: true }] },
      ],
    },
    people: [
      {
        table: 'customers',
        kind: 'people',
        email: 'email',
        name: 'name',
        copies: [
          { table: 'reservations', column: 'name', holds: 'name' },
          { table: 'reservations', column: 'email', holds: 'email' },
          { table: 'reservations', column: 'mobile', holds: 'phone' },
          { table: 'tickets', column: 'receipt_to', holds: 'email', via: 'customer_id' },
          { table: 'deposits', column: 'payer_name', holds: 'name' },
          { table: 'deposits', column: 'payer_mobile', holds: 'phone' },
        ],
      },
    ],
    pages: [{ ref: 'pos-customers', template: 'page-crud', title: { key: 't.customers', fallback: 'Customers' }, nav: { group: 'floor', icon: 'list', order: 1 }, bindings: { rows: 'customers' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

const dataOf = <T>(res: Reply): T => (res.json() as { data: T }).data;

interface Preview {
  found: boolean;
  goes: { kind: string; count: number; table?: string }[];
  stays: { kind: string; reason: string; count: number | null; table?: string }[];
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`erasing a person whose copies have no link back, on ${dialect}`, () => {
    let s: WholeServer;
    const before: Record<string, Record<string, unknown>> = {};
    const one = async (ref: string, key: number) => (await s.rows(`SELECT * FROM pos_${ref} WHERE id = ${String(key)}`))[0]!;

    beforeAll(async () => {
      s = await wholeServer(dialect, pos(), { people: { pia: [] } });
      const officer = await rolesRepo(s.meta).create({ slug: 'privacy-officer', name: 'Privacy officer' });
      await permissionsRepo(s.meta).grant(officer.id, 'system', 'privacy.manage', { allowed: true });
      await rolesRepo(s.meta).assignToUser(s.ids['pia']!, officer.id);

      await s.rows(`INSERT INTO pos_customers (id, name, mobile, email) VALUES (1, 'Marta Kovac', '07700 900123', '${MARTA}'), (2, 'Ben Other', '07700 900456', '${BEN}')`);
      await s.rows(
        `INSERT INTO pos_reservations (id, code, name, mobile, email, party_size, guest_request, staff_note) VALUES ` +
          `(1, 'R-1', 'Marta Kovac', '07700900123', '${MARTA}', 4, 'Window seat, nut allergy', 'Regular'), ` +
          `(2, 'R-2', 'Marta', '+44 7700 900123', NULL, 2, 'Birthday cake', 'Took it on the phone'), ` +
          `(3, 'R-3', 'Ben Other', '07700 900456', '${BEN}', 2, 'High chair', NULL), ` +
          `(4, 'R-4', 'Ben Other', '07700 900123', '${BEN}', 6, 'Quiet table', NULL), ` +
          `(5, 'R-5', 'Walk-in', NULL, NULL, 2, NULL, NULL), ` +
          `(6, 'R-6', 'Ola Near', '+48 900 123', NULL, 2, 'Terrace', NULL)`,
      );
      await s.rows(`INSERT INTO pos_tickets (id, customer_id, receipt_to, total) VALUES (1, 1, '${MARTA}', 4200), (2, 2, '${BEN}', 1800)`);
      await s.rows(`INSERT INTO pos_deposits (id, payer_name, payer_mobile, amount) VALUES (1, 'Marta K', '+447700900123', 2000), (2, 'Ben Other', '07700 900456', 1000)`);
      for (const [ref, key] of [['reservations', 1], ['reservations', 2], ['reservations', 3], ['reservations', 4], ['reservations', 5], ['reservations', 6], ['tickets', 2], ['deposits', 1], ['deposits', 2]] as const) before[`${ref}:${String(key)}`] = await one(ref, key);
    }, 240_000);
    afterAll(async () => {
      await s?.close();
    });

    it('finds her bookings by the address and by her number alone, and the deposit the law keeps', async () => {
      const res = await s.send('pia', 'POST', '/api/v1/privacy/find', { address: MARTA });
      expect(res.statusCode, res.body).toBe(200);
      const found = dataOf<{ sources: { kind: string; table: string | null; keptByLaw: string | null; keys: string[] }[] }>(res);
      const copies = Object.fromEntries(found.sources.filter((one) => one.kind === 'copy').map((one) => [one.table, { keys: [...one.keys].sort(), law: one.keptByLaw }]));
      expect(copies[s.t('reservations')]).toEqual({ keys: ['1', '2', '4'], law: null });
      expect(copies[s.t('deposits')]).toEqual({ keys: ['1'], law: 'tax' });
      expect(copies[s.t('tickets')]).toEqual({ keys: ['1'], law: null });
    });

    it('counts every booking of hers in what goes, and the kept deposit in what stays', async () => {
      const res = await s.send('pia', 'POST', '/api/v1/privacy/erase/preview', { address: MARTA });
      expect(res.statusCode, res.body).toBe(200);
      const view = dataOf<Preview>(res);
      const goes = Object.fromEntries(view.goes.map((item) => [item.table ?? item.kind, item.count]));
      expect(goes).toMatchObject({ [s.t('customers')]: 1, [s.t('reservations')]: 3, [s.t('tickets')]: 1 });
      expect(goes[s.t('deposits')]).toBeUndefined();
      expect(view.stays).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'app-rows', reason: 'tax', table: s.t('deposits'), count: 1 })]));
    });

    it('erases every copy of hers on a booking, by the address or by her number, and leaves the rest', async () => {
      const res = await s.send('pia', 'POST', '/api/v1/privacy/erase', { address: MARTA, confirm: MARTA });
      expect(res.statusCode, res.body).toBe(200);
      expect(dataOf<{ counts: Record<string, number> }>(res).counts).toMatchObject({ 'people-pos-customers': 1, 'copy-pos-customers-reservations': 3, 'copy-pos-customers-tickets': 1 });

      expect(await one('customers', 1)).toMatchObject({ id: 1, name: 'Erased person', mobile: null, email: null });
      // By her address: the name and the mobile go with it, and her request; the staff's note and the party stay.
      expect(await one('reservations', 1)).toEqual({ ...before['reservations:1'], name: 'Erased person', mobile: null, email: null, guest_request: null });
      // No address, no link: found by her number written another way.
      expect(await one('reservations', 2)).toEqual({ ...before['reservations:2'], name: 'Erased person', mobile: null, guest_request: null });
      // Ben's booking under her number: the number goes, his name, address and request stay.
      expect(await one('reservations', 4)).toEqual({ ...before['reservations:4'], mobile: null });
      for (const key of [3, 5, 6]) expect(await one('reservations', key)).toEqual(before[`reservations:${String(key)}`]);
      expect((await one('tickets', 1))['receipt_to']).toBeNull();
      expect(await one('tickets', 2)).toEqual(before['tickets:2']);
      // The law's deposit is untouched, her copies on it included.
      expect(await one('deposits', 1)).toEqual(before['deposits:1']);
      expect(await one('deposits', 2)).toEqual(before['deposits:2']);
    });

    it('finds nothing more to erase the second time', async () => {
      const view = dataOf<Preview>(await s.send('pia', 'POST', '/api/v1/privacy/erase/preview', { address: MARTA }));
      expect(view.goes.filter((item) => item.table !== undefined)).toEqual([]);
      expect(said(await s.send('pia', 'POST', '/api/v1/privacy/erase', { address: MARTA, confirm: MARTA }))).toBe('ok');
      expect(await one('reservations', 4)).toEqual({ ...before['reservations:4'], mobile: null });
    });
  });
}
