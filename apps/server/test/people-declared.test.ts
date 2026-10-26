// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The people tables of an install, as its owner left them (people/declared.ts),
 * and the new words' first server answers: a rule's e-mail keeps its class
 * when it is installed, and the owner's word on a people table is an override
 * like any other.
 *
 * The resolver is pure and driven here with plain inputs. The loader reads
 * the apps, their table records and the owner's overrides from the meta
 * store, so it runs on SQLite, Postgres and MySQL (an override's value is a
 * JSON column: parsed on two engines, text on the third).
 */
import { appTablesRepo, automationGraphSchema, connectionsRepo, manifestsRepo, overridePatchSchema, overridesRepo, type MetaDb } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { boundNode, type Binding } from '../src/apps/manifest-automations.js';
import { declaredPeople, resolveDeclaredPeople, type PeopleModel, type PeopleSource } from '../src/people/declared.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const crypto = {
  encrypt: (v: string) => `enc:${Buffer.from(v, 'utf8').toString('base64')}`,
  decrypt: (v: string) => Buffer.from(v.slice(4), 'base64').toString('utf8'),
};

/** The CRM's people, as K6 will declare them (a few copies). */
const CRM = {
  key: 'crm',
  requiredSchema: {
    tables: [
      { ref: 'contacts', keyField: 'name' },
      { ref: 'companies', keyField: 'name' },
      { ref: 'quotes', keyField: 'number' },
      { ref: 'sign_offs', keyField: 'signer_name' },
    ],
  },
  people: [
    {
      table: 'contacts',
      kind: 'people',
      email: 'email',
      company: 'company_id',
      firstName: 'firstWordOfName',
      consent: { column: 'may_email', purpose: 'newsletter' },
      customer: 'won_deals',
      optOutMark: 'opt_out_offered_at',
      copies: [
        { table: 'quotes', column: 'to_email', holds: 'email', via: 'sent_to_contact_id' },
        { table: 'sign_offs', column: 'signer_name', holds: 'name' },
      ],
    },
    { table: 'companies', kind: 'companies' },
  ],
};

const text = (name: string) => ({ name, logicalType: 'text' });
const MODEL: PeopleModel = {
  tables: [
    { id: 'public.crm_contacts', name: 'crm_contacts', schema: 'public', columns: [{ name: 'id', logicalType: 'integer' }, text('email'), text('work_email'), text('name'), { name: 'company_id', logicalType: 'integer' }, { name: 'may_email', logicalType: 'boolean' }, { name: 'won_deals', logicalType: 'integer' }, { name: 'opt_out_offered_at', logicalType: 'timestamptz' }] },
    { id: 'public.crm_companies', name: 'crm_companies', schema: 'public', columns: [{ name: 'id', logicalType: 'integer' }, text('name')] },
    { id: 'public.crm_quotes', name: 'crm_quotes', schema: 'public', columns: [{ name: 'id', logicalType: 'integer' }, text('to_email'), { name: 'sent_to_contact_id', logicalType: 'integer' }] },
    { id: 'public.crm_sign_offs', name: 'crm_sign_offs', schema: 'public', columns: [{ name: 'id', logicalType: 'integer' }, text('signer_name')] },
  ],
};

const record = (ref: string, state: string = 'created', appKey = 'crm', connectionId = 'cnx_1') => ({ appKey, connectionId, ref, tableName: `crm_${ref}`, schemaName: 'public', owned: state === 'created', state: state as never });

function source(over: Partial<PeopleSource> = {}): PeopleSource {
  return {
    apps: [{ appKey: 'crm', connectionId: 'cnx_1', status: 'installed', document: CRM }],
    records: ['contacts', 'companies', 'quotes', 'sign_offs'].map((ref) => record(ref)),
    models: new Map([['cnx_1', MODEL]]),
    overrides: [],
    ...over,
  };
}

const override = (value: Record<string, unknown>, status: 'active' | 'disabled' = 'active', tableName = 'public.crm_contacts') => ({ connectionId: 'cnx_1', op: 'table.people' as never, tableName, value, status });

describe('the people tables, resolved', () => {
  it('reads each declared table by its real id, with its columns, copies and consent', () => {
    const [contacts, companies] = resolveDeclaredPeople(source());
    expect(contacts).toEqual({
      connectionId: 'cnx_1',
      appKey: 'crm',
      appStatus: 'installed',
      ref: 'contacts',
      table: 'public.crm_contacts',
      kind: 'people',
      email: 'email',
      name: 'name',
      firstName: 'firstWordOfName',
      language: null,
      company: 'company_id',
      consent: { column: 'may_email', purpose: 'newsletter' },
      copies: [
        { table: 'public.crm_quotes', ref: 'quotes', column: 'to_email', holds: 'email', via: 'sent_to_contact_id' },
        { table: 'public.crm_sign_offs', ref: 'sign_offs', column: 'signer_name', holds: 'name', via: null },
      ],
      customer: 'won_deals',
      optOutMark: 'opt_out_offered_at',
      optOutMarkFrom: null,
      canEmail: true,
    });
    // A company with no address: named by its keyField, never mailed.
    expect(companies).toMatchObject({ table: 'public.crm_companies', kind: 'companies', email: null, name: 'name', canEmail: false });
  });

  it('takes the owner\'s word: another column for the address, and campaigns switched off', () => {
    const renamed = resolveDeclaredPeople(source({ overrides: [override({ email: 'work_email' })] }))[0];
    expect(renamed?.email).toBe('work_email');
    expect(renamed?.canEmail).toBe(true);
    // A later word wins; a switched-off row is no word at all.
    const off = resolveDeclaredPeople(source({ overrides: [override({ canEmail: false }), override({ email: 'name' }), override({ canEmail: true }, 'disabled')] }))[0];
    expect(off?.canEmail).toBe(false);
    expect(off?.email).toBe('name');
    // A column the table does not have, or one that holds no text, is not taken.
    expect(resolveDeclaredPeople(source({ overrides: [override({ email: 'nope' })] }))[0]?.email).toBe('email');
    expect(resolveDeclaredPeople(source({ overrides: [override({ email: 'may_email' })] }))[0]?.email).toBe('email');
    // A word on another table changes nothing here.
    expect(resolveDeclaredPeople(source({ overrides: [override({ canEmail: false }, 'active', 'public.crm_companies')] }))[0]?.canEmail).toBe(true);
  });

  it('drops the tables of an app that was uninstalled, and a copy kept on a table the app let go', () => {
    // Uninstalled: the manifest row is gone; the records stay, released.
    const gone = source({ apps: [], records: ['contacts', 'companies', 'quotes', 'sign_offs'].map((ref) => record(ref, 'released')) });
    expect(resolveDeclaredPeople(gone)).toEqual([]);
    // Installed, but its quotes were dropped (a part left out): the copy there goes, the person stays.
    const partly = source({ records: [record('contacts'), record('companies'), record('quotes', 'dropped'), record('sign_offs')] });
    expect(resolveDeclaredPeople(partly)[0]?.copies.map((copy) => copy.ref)).toEqual(['sign_offs']);
    // An app still being installed declares nothing yet.
    expect(resolveDeclaredPeople(source({ apps: [{ appKey: 'crm', connectionId: 'cnx_1', status: 'installing', document: CRM }] }))).toEqual([]);
    // A database with no snapshot declares nothing.
    expect(resolveDeclaredPeople(source({ models: new Map() }))).toEqual([]);
  });

  it('a column the database no longer has reads as none, and a table with no address is never mailed', () => {
    const model: PeopleModel = { tables: MODEL.tables.map((table) => (table.id === 'public.crm_contacts' ? { ...table, columns: table.columns.filter((column) => column.name !== 'email' && column.name !== 'may_email') } : table)) };
    const [contacts] = resolveDeclaredPeople(source({ models: new Map([['cnx_1', model]]) }));
    expect(contacts?.email).toBeNull();
    expect(contacts?.consent).toBeNull();
    expect(contacts?.canEmail).toBe(false);
    // The owner can name another one.
    expect(resolveDeclaredPeople(source({ models: new Map([['cnx_1', model]]), overrides: [override({ email: 'work_email' })] }))[0]?.canEmail).toBe(true);
  });

  it('reads the mark carried from the row a person is made from, while that table is held', () => {
    const marked = { ...CRM, people: [{ ...CRM.people[0], optOutMark: { column: 'opt_out_offered_at', carryFrom: { table: 'sign_offs', column: 'signer_name' } } }] };
    const [contacts] = resolveDeclaredPeople(source({ apps: [{ appKey: 'crm', connectionId: 'cnx_1', status: 'installed', document: marked }] }));
    expect(contacts?.optOutMark).toBe('opt_out_offered_at');
    expect(contacts?.optOutMarkFrom).toEqual({ table: 'public.crm_sign_offs', ref: 'sign_offs', column: 'signer_name' });
    const dropped = resolveDeclaredPeople(source({ apps: [{ appKey: 'crm', connectionId: 'cnx_1', status: 'installed', document: marked }], records: [record('contacts'), record('companies'), record('quotes'), record('sign_offs', 'dropped')] }));
    expect(dropped[0]?.optOutMarkFrom).toBeNull();
  });

  it('a table two apps declare is declared once, by the app that made it', () => {
    const other = { key: 'aaa', people: [{ table: 'contacts', kind: 'people', email: 'work_email' }], requiredSchema: { tables: [{ ref: 'contacts', keyField: 'name' }] } };
    const both = source({
      apps: [{ appKey: 'crm', connectionId: 'cnx_1', status: 'installed', document: CRM }, { appKey: 'aaa', connectionId: 'cnx_1', status: 'installed', document: other }],
      records: [...['contacts', 'companies', 'quotes', 'sign_offs'].map((ref) => record(ref)), { ...record('contacts', 'shared', 'aaa'), owned: false }],
    });
    const found = resolveDeclaredPeople(both).filter((entry) => entry.table === 'public.crm_contacts');
    expect(found).toHaveLength(1);
    expect(found[0]?.appKey).toBe('crm');
  });
});

describe('a rule\'s e-mail keeps its class when it is installed', () => {
  const binding: Binding = { connectionId: 'cnx_1', realId: (ref) => `public.crm_${ref}`, roleId: (key) => `rol_${key}`, timezone: 'UTC', language: 'en-US' };
  const mail = (to: Record<string, unknown>, more: Record<string, unknown> = {}) => ({ id: 'mail', kind: 'action', title: 'Mail', action: { kind: 'email', templateKey: 'crm-note', to, ...more } });

  it('is stored on a mail to the record\'s address, and refused on a mail to staff or to typed addresses', () => {
    const bound = boundNode(mail({ kind: 'field', column: 'email' }, { class: 'marketing' }), binding);
    const graph = automationGraphSchema.parse({ version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, bound] });
    expect((graph.nodes[1] as { action: { class?: string } }).action.class).toBe('marketing');
    for (const to of [{ kind: 'staff', column: 'owner_id' }, { kind: 'fixed', addresses: ['a@example.com'] }]) {
      expect(automationGraphSchema.safeParse({ version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, mail(to, { class: 'service' })] }).success).toBe(false);
      expect(automationGraphSchema.safeParse({ version: 1, nodes: [{ id: 't', kind: 'trigger', title: 'When' }, mail(to)] }).success).toBe(true);
    }
  });
});

describe('the owner\'s word on a people table', () => {
  it('says canEmail, email or name, and nothing else', () => {
    expect(overridePatchSchema.safeParse({ op: 'table.people', value: { canEmail: false } }).success).toBe(true);
    expect(overridePatchSchema.safeParse({ op: 'table.people', value: { email: 'work_email', name: 'full_name' } }).success).toBe(true);
    expect(overridePatchSchema.safeParse({ op: 'table.people', value: {} }).success).toBe(false);
    expect(overridePatchSchema.safeParse({ op: 'table.people', value: { consent: 'x' } }).success).toBe(false);
  });
});

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`the people tables, read from the meta store [${engine.name}]`, () => {
    let handle: MetaHandle;
    let meta: MetaDb;
    let connectionId: string;

    beforeAll(async () => {
      handle = await engine.make();
      meta = handle.meta;
      connectionId = (await connectionsRepo(meta, crypto).create({ name: 'main', engine: 'postgres', introspectDsn: 'postgres://ro@localhost/app' })).id;
      const installed = await manifestsRepo(meta, crypto).install({ manifestKey: 'crm', version: '0.2.3', kind: 'app', source: 'file', document: CRM, connectionId });
      for (const ref of ['contacts', 'companies', 'quotes', 'sign_offs']) {
        await appTablesRepo(meta).record({ appKey: 'crm', manifestId: installed.row.id, connectionId, ref, tableName: `crm_${ref}`, schemaName: 'public', owned: true, state: 'created' });
      }
    }, 60_000);

    afterAll(async () => {
      await handle?.destroy();
    });

    const models = async (id: string) => (id === connectionId ? MODEL : null);

    it('reads the app\'s declaration, then the owner\'s renamed address column', async () => {
      const before = await declaredPeople(meta, models);
      expect(before.map((entry) => [entry.table, entry.email, entry.canEmail])).toEqual([
        ['public.crm_contacts', 'email', true],
        ['public.crm_companies', null, false],
      ]);
      await overridesRepo(meta).create({ connectionId, op: 'table.people', tableName: 'public.crm_contacts', columnName: null, value: { email: 'work_email' } });
      const after = await declaredPeople(meta, models);
      expect(after[0]?.email).toBe('work_email');
      expect(after[0]?.copies.map((copy) => copy.table)).toEqual(['public.crm_quotes', 'public.crm_sign_offs']);
    });

    it('drops the app\'s tables once it is uninstalled', async () => {
      const installed = await manifestsRepo(meta, crypto).list('app');
      await manifestsRepo(meta, crypto).uninstall(installed[0]!.row.id);
      expect(await declaredPeople(meta, models)).toEqual([]);
    });
  });
}
