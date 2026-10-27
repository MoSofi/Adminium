// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PEOPLE TABLE'S E-MAIL SHEET ("E-mail settings for Contacts"), against
 * the whole server on SQLite, Postgres and MySQL, as the marketer it is for:
 *
 *  - the sheet shows the declared e-mail and name columns, the text columns
 *    to pick from (which may hold the address: those seen in clear), who
 *    counts as a customer, and the existing-customers switch only where the
 *    app declares the opt-out mark;
 *  - "Can be e-mailed from campaigns" off takes the table out of the send
 *    dialog's list, while the sheet still opens (to switch it back on), and
 *    on brings it back; each change is the owner's word, kept with who;
 *  - another address column must be a text column seen in clear;
 *  - a person without the campaigns' grant, or who cannot read the table, or
 *    sees its addresses masked, is refused.
 *
 * And the owner's word itself, on every engine's meta store: a new row in
 * their name, the earlier one disabled, and the JSON read back as the table's
 * declaration takes it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { connectionsRepo, overridesRepo, permissionsRepo, rolesRepo, usersRepo } from '@adminium/meta';

import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { TEST_SECRET } from './helpers.js';

import { setPeopleTableWord } from '../src/email/people-table-settings.js';
import type { PeopleTableAccess } from '../src/email/audience-table.js';
import { resolveDeclaredPeople } from '../src/people/declared.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

// The people word and its columns are read from the release to come.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.37' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const strict = (set: string, on: unknown) => ({ stamp: { set, on, strict: true } });

function crm(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'Sales CRM',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A small CRM.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.37', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'contacts',
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 80 },
            { ref: 'nickname', type: 'text', maxLength: 40, nullable: true },
            { ref: 'email', type: 'text', maxLength: 254, nullable: true, rules: { personal: true } },
            { ref: 'work_email', type: 'text', maxLength: 254, nullable: true, rules: { personal: true } },
            { ref: 'opt_out_offered_at', type: 'timestamptz', nullable: true, rules: strict('now', { columns: ['email'] }) },
            { ref: 'won_deals', type: 'int', default: 0 },
          ],
        },
        { ref: 'guests', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'email', type: 'text', maxLength: 254, nullable: true, rules: { personal: true } }, { ref: 'stays', type: 'int', default: 0 }] },
      ],
    },
    people: [
      { table: 'contacts', kind: 'people', email: 'email', name: 'name', customer: 'won_deals', optOutMark: 'opt_out_offered_at' },
      { table: 'guests', kind: 'people', email: 'email', name: 'name', customer: 'stays' },
    ],
    roles: [
      { key: 'marketer', name: 'Marketer', permissions: ['table:@contacts:read', 'table:@contacts:read_pii', 'table:@guests:read', 'table:@guests:read_pii'] },
      { key: 'masked', name: 'Masked', permissions: ['table:@contacts:read'] },
    ],
    pages: [{ ref: 'crm-contacts', template: 'page-crud', title: { key: 't', fallback: 'Contacts' }, nav: { group: 'crm', icon: 'home', order: 1 }, bindings: { rows: 'contacts' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

interface Sheet {
  table: string;
  label: string;
  appName: string;
  canEmail: boolean;
  email: string;
  name: string | null;
  columns: { name: string; address: boolean }[];
  customer: { column: string } | null;
  existingCustomers: { offered: boolean; on: boolean };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a people table's e-mail sheet [${dialect}]`, () => {
    let s: WholeServer;
    let contacts = '';
    let guests = '';
    const sheetOf = async (who: string, table: string) => s.get(who, `/api/v1/email-audience/table-settings?connectionId=${encodeURIComponent(s.connectionId)}&table=${encodeURIComponent(table)}`);
    const put = (who: string, table: string, body: Record<string, unknown>) => s.send(who, 'PUT', '/api/v1/email-audience/table-settings', { connectionId: s.connectionId, table, ...body });
    const picker = async (who: string) => ((await s.get(who, '/api/v1/email-audience/tables')).json() as { tables: { table: string }[] }).tables.map((one) => one.table).sort();

    beforeAll(async () => {
      s = await wholeServer(dialect, crm(), { people: { mia: ['marketer'], max: ['masked'], nora: [], sid: ['marketer'] } });
      contacts = s.t('contacts');
      guests = s.t('guests');
      // The campaigns' grant for all but sid, who reads the tables and may not send.
      const roles = rolesRepo(s.meta);
      const campaigns = await roles.create({ slug: 'campaigns', name: 'Campaigns' });
      await permissionsRepo(s.meta).grant(campaigns.id, 'system', 'settings.manage', { allowed: true });
      for (const who of ['mia', 'max', 'nora']) await roles.assignToUser(s.ids[who]!, campaigns.id);
    }, 240_000);
    afterAll(async () => {
      await s?.close();
    });

    it('shows the declared columns, the columns to pick from, and existing customers only where the app declares the mark', async () => {
      const res = await sheetOf('mia', contacts);
      expect(res.statusCode, res.body).toBe(200);
      const sheet = (res.json() as { sheet: Sheet }).sheet;
      expect(sheet).toMatchObject({ table: contacts, appName: 'Sales CRM', canEmail: true, email: 'email', name: 'name', customer: { column: 'won_deals' }, existingCustomers: { offered: true, on: false } });
      expect(sheet.columns.map((one) => [one.name, one.address])).toEqual([
        ['name', true],
        ['nickname', true],
        ['email', true],
        ['work_email', true],
      ]);
      const guest = (((await sheetOf('mia', guests)).json()) as { sheet: Sheet }).sheet;
      expect(guest.existingCustomers.offered).toBe(false);
    });

    it('takes a table out of the send dialog\'s list and back, keeping who did it, while the sheet still opens', async () => {
      expect(await picker('mia')).toEqual([contacts, guests].sort());
      const off = await put('mia', guests, { canEmail: false, email: 'email', name: 'name' });
      expect(off.statusCode, off.body).toBe(200);
      expect((off.json() as { sheet: Sheet }).sheet.canEmail).toBe(false);
      expect(await picker('mia')).toEqual([contacts]);
      const listed = (await s.get('mia', '/api/v1/email-audience/people-tables')).json() as { tables: { table: string; canEmail: boolean; appName: string }[] };
      expect(listed.tables.map((one) => [one.table, one.canEmail, one.appName]).sort()).toEqual([
        [contacts, true, 'Sales CRM'],
        [guests, false, 'Sales CRM'],
      ].sort());
      expect(((await sheetOf('mia', guests)).json() as { sheet: Sheet }).sheet.canEmail).toBe(false);

      const on = await put('mia', guests, { canEmail: true, email: 'email', name: 'name' });
      expect(on.statusCode, on.body).toBe(200);
      expect(await picker('mia')).toEqual([contacts, guests].sort());
      const rows = await s.meta.db.selectFrom('adminium_schema_overrides').select(['status', 'createdBy']).where('op', '=', 'table.people').where('tableName', '=', guests).execute();
      expect(rows.filter((row) => row.status === 'active')).toEqual([{ status: 'active', createdBy: s.ids['mia'] }]);
      expect(rows.length).toBe(2);
      // Saving what is already there writes nothing.
      expect(said(await put('mia', guests, { canEmail: true, email: 'email', name: 'name' }))).toBe('ok');
      expect((await s.meta.db.selectFrom('adminium_schema_overrides').select('id').where('op', '=', 'table.people').where('tableName', '=', guests).execute()).length).toBe(2);
      const audit = await s.meta.db.selectFrom('adminium_audit_log').select(['actorId']).where('action', '=', 'email-audience.table-settings').execute();
      expect(audit.map((one) => one.actorId)).toEqual([s.ids['mia'], s.ids['mia']]);
    });

    it('names another address or name column only from the table\'s text columns', async () => {
      expect(said(await put('mia', contacts, { canEmail: true, email: 'won_deals', name: null }))).toBe('422 VALIDATION_FAILED');
      expect(said(await put('mia', contacts, { canEmail: true, email: 'email', name: 'no_such_column' }))).toBe('422 VALIDATION_FAILED');
      const moved = await put('mia', contacts, { canEmail: true, email: 'work_email', name: 'nickname' });
      expect(moved.statusCode, moved.body).toBe(200);
      expect((moved.json() as { sheet: Sheet }).sheet).toMatchObject({ email: 'work_email', name: 'nickname' });
      const back = await put('mia', contacts, { canEmail: true, email: 'email', name: 'name' });
      expect((back.json() as { sheet: Sheet }).sheet).toMatchObject({ email: 'email', name: 'name' });
    });

    it('refuses a person without the campaigns\' grant, one who cannot read the table, and one who sees its addresses masked', async () => {
      expect(said(await sheetOf('sid', contacts))).toBe('403 FORBIDDEN');
      expect(said(await put('sid', contacts, { canEmail: false, email: 'email', name: 'name' }))).toBe('403 FORBIDDEN');
      expect(said(await sheetOf('nora', contacts))).toBe('403 AUDIENCE_REFUSED');
      expect(said(await put('nora', contacts, { canEmail: false, email: 'email', name: 'name' }))).toBe('403 AUDIENCE_REFUSED');
      expect(said(await sheetOf('max', contacts))).toBe('403 AUDIENCE_REFUSED');
      expect(said(await put('max', contacts, { canEmail: false, email: 'email', name: 'name' }))).toBe('403 AUDIENCE_REFUSED');
      expect(((await s.get('nora', '/api/v1/email-audience/people-tables')).json() as { tables: unknown[] }).tables).toEqual([]);
      expect(await picker('mia')).toEqual([contacts, guests].sort());
    });
  });
}

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`the owner's word on a people table [${engine.name}]`, () => {
    let handle: MetaHandle;
    beforeAll(async () => {
      handle = await engine.make();
    });
    afterAll(async () => {
      await handle.destroy();
    });

    it('keeps one active row in the owner\'s name, the earlier one disabled, read back as the declaration takes it', async () => {
      const column = (name: string) => ({ name, logicalType: 'text', secret: false, masked: false, isPrimaryKey: false });
      const conn = (await connectionsRepo(handle.meta, dsnCryptoFromSecret(TEST_SECRET)).create({ name: 'Shop', engine: 'sqlite', introspectDsn: 'sqlite::memory:' })).id;
      const userA = (await usersRepo(handle.meta).create({ email: 'a@owner.test', name: 'A' })).id;
      const userB = (await usersRepo(handle.meta).create({ email: 'b@owner.test', name: 'B' })).id;
      const declared = { connectionId: conn, table: 'public.crm_contacts', canEmail: true, email: 'email', name: 'name' };
      const access = {
        declared,
        wholeTable: { id: 'public.crm_contacts' },
        table: { columns: new Map(['name', 'email', 'work_email'].map((name) => [name, column(name)])), table: { columns: [] } },
        canReadPii: true,
      } as unknown as PeopleTableAccess;
      const long = 'w'.repeat(128);
      (access.table.columns as Map<string, unknown>).set(long, column(long));

      expect(await setPeopleTableWord(handle.meta, access, { canEmail: false, email: 'email', name: null, by: userA }, 1000)).toBe(true);
      expect(await setPeopleTableWord(handle.meta, access, { canEmail: true, email: long, name: 'name', by: userB }, 2000)).toBe(true);
      const rows = await overridesRepo(handle.meta).listForConnection(conn);
      expect(rows.map((row) => [row.op, row.status, row.createdBy]).sort()).toEqual([
        ['table.people', 'active', userB],
        ['table.people', 'disabled', userA],
      ]);
      const active = rows.find((row) => row.status === 'active')!;
      expect(active.value).toEqual({ canEmail: true, email: long, name: 'name' });

      // The declaration reads it as the owner's word.
      const [table] = resolveDeclaredPeople({
        apps: [{ appKey: 'crm', connectionId: conn, status: 'installed', document: { people: [{ table: 'contacts', kind: 'people', email: 'email', name: 'name' }] } }],
        records: [{ appKey: 'crm', connectionId: conn, ref: 'contacts', tableName: 'crm_contacts', schemaName: 'public', owned: true, state: 'created' }],
        models: new Map([[conn, { tables: [{ id: 'public.crm_contacts', name: 'crm_contacts', schema: 'public', columns: [{ name: 'name', logicalType: 'text' }, { name: 'email', logicalType: 'text' }, { name: long, logicalType: 'text' }] }] }]]),
        overrides: rows,
      });
      expect(table).toMatchObject({ email: long, name: 'name', canEmail: true });
    });
  });
}
