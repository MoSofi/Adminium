// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A companies table's `lead` word (the columns a company's number, website,
 * phone, address, activity, about and owner go in), as the app declares it
 * and as the owner's word on the table changes it.
 *
 * The app's word is read for the columns the table still has. The owner's
 * word is taken field by field, and only where it fits: a text field on a
 * text column, the country on a column exactly two wide (as the database
 * says, or as the app declares it where the database keeps no width), the
 * owner on a column the app declares as a staff member's. It is kept when
 * the table's e-mail sheet is saved, and on every engine it reads back the
 * same (the override's value is a JSON column: parsed on two engines, text
 * on the third).
 */
import { appTablesRepo, connectionsRepo, manifestsRepo, overridePatchSchema, overridesRepo, type MetaDb } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { declaredPeople, resolveDeclaredPeople, type PeopleModel, type PeopleSource } from '../src/people/declared.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const crypto = {
  encrypt: (v: string) => `enc:${Buffer.from(v, 'utf8').toString('base64')}`,
  decrypt: (v: string) => Buffer.from(v.slice(4), 'base64').toString('utf8'),
};

const LEAD = {
  number: 'company_number',
  website: 'website',
  phone: 'phone',
  address: { lines: 'address_lines', town: 'town', postalCode: 'postal_code', country: 'country' },
  activity: 'sector',
  about: 'about',
  owner: 'account_owner_id',
};

/** A companies table shaped like the CRM's, with the three columns the lead word needs. */
const APP = {
  key: 'crm',
  requiredSchema: {
    tables: [
      {
        ref: 'companies',
        keyField: 'name',
        columns: [
          { ref: 'name', type: 'text', maxLength: 160 },
          { ref: 'company_number', type: 'text', maxLength: 40 },
          { ref: 'website', type: 'text', maxLength: 200 },
          { ref: 'phone', type: 'text', maxLength: 40 },
          { ref: 'address_lines', type: 'text', maxLength: 300 },
          { ref: 'town', type: 'text', maxLength: 120 },
          { ref: 'postal_code', type: 'text', maxLength: 20 },
          { ref: 'country', type: 'text', maxLength: 2 },
          { ref: 'country_name', type: 'text', maxLength: 40 },
          { ref: 'sector', type: 'text', maxLength: 80 },
          { ref: 'about', type: 'text', maxLength: 1000 },
          { ref: 'notes', type: 'text', maxLength: 1000 },
          { ref: 'account_owner_id', type: 'text', maxLength: 64, rules: { staff: true } },
          { ref: 'second_owner_id', type: 'text', maxLength: 64, rules: { staff: true } },
          { ref: 'employees', type: 'int' },
        ],
      },
    ],
  },
  people: [{ table: 'companies', kind: 'companies', name: 'name', lead: LEAD }],
};

const text = (name: string, maxLength: number | null = null) => ({ name, logicalType: 'varchar', maxLength });
const MODEL: PeopleModel = {
  tables: [
    {
      id: 'public.crm_companies',
      name: 'crm_companies',
      schema: 'public',
      columns: [
        { name: 'id', logicalType: 'integer' },
        text('name', 160),
        text('company_number', 40),
        text('website', 200),
        text('phone', 40),
        text('address_lines', 300),
        text('town', 120),
        text('postal_code', 20),
        text('country', 2),
        text('country_name', 40),
        text('sector', 80),
        text('about', 1000),
        text('notes', 1000),
        text('account_owner_id', 64),
        text('second_owner_id', 64),
        { name: 'employees', logicalType: 'integer' },
      ],
    },
  ],
  defaultSchema: 'public',
};

function source(over: Partial<PeopleSource> = {}): PeopleSource {
  return {
    apps: [{ appKey: 'crm', connectionId: 'cnx_1', status: 'installed', document: APP }],
    records: [{ appKey: 'crm', connectionId: 'cnx_1', ref: 'companies', tableName: 'crm_companies', schemaName: 'public', owned: true, state: 'created' }],
    models: new Map([['cnx_1', MODEL]]),
    overrides: [],
    ...over,
  };
}

const override = (lead: Record<string, unknown>) => ({ connectionId: 'cnx_1', op: 'table.people' as never, tableName: 'public.crm_companies', value: { lead }, status: 'active' as const });

describe("a companies table's lead word", () => {
  it("reads the app's word for the columns the table has", () => {
    const [companies] = resolveDeclaredPeople(source());
    expect(companies?.lead).toEqual(LEAD);
    // A column the database no longer has reads as none.
    const fewer: PeopleModel = { tables: [{ ...MODEL.tables[0]!, columns: MODEL.tables[0]!.columns.filter((column) => column.name !== 'phone') }], defaultSchema: 'public' };
    expect(resolveDeclaredPeople(source({ models: new Map([['cnx_1', fewer]]) }))[0]?.lead?.phone).toBeUndefined();
  });

  it("takes the owner's word on it, field by field", () => {
    const [companies] = resolveDeclaredPeople(source({ overrides: [override({ about: 'notes', owner: 'second_owner_id', address: { town: 'address_lines' } })] }));
    expect(companies?.lead).toEqual({ ...LEAD, about: 'notes', owner: 'second_owner_id', address: { ...LEAD.address, town: 'address_lines' } });
  });

  it("refuses the owner's word where it does not fit, and keeps the app's", () => {
    const [companies] = resolveDeclaredPeople(
      source({
        overrides: [
          override({
            // Not two wide: an ISO country code only.
            address: { country: 'country_name' },
            // Not a staff member's column.
            owner: 'notes',
            // Not text.
            phone: 'employees',
            // Not there.
            website: 'homepage',
          }),
        ],
      }),
    );
    expect(companies?.lead).toEqual(LEAD);
  });

  it('is said of a companies table only, never of a people table', () => {
    const people = { ...APP, people: [{ table: 'companies', kind: 'people', email: 'website', name: 'name' }] };
    const [read] = resolveDeclaredPeople(source({ apps: [{ appKey: 'crm', connectionId: 'cnx_1', status: 'installed', document: people }], overrides: [override({ about: 'notes' })] }));
    expect(read?.lead).toBeUndefined();
  });

  it("is an override like any other: a lead map, and nothing else in it", () => {
    expect(overridePatchSchema.safeParse({ op: 'table.people', value: { lead: { about: 'notes' } } }).success).toBe(true);
    expect(overridePatchSchema.safeParse({ op: 'table.people', value: { lead: { address: { country: 'country' } } } }).success).toBe(true);
    expect(overridePatchSchema.safeParse({ op: 'table.people', value: { lead: {} } }).success).toBe(false);
    expect(overridePatchSchema.safeParse({ op: 'table.people', value: { lead: { fax: 'fax' } } }).success).toBe(false);
  });
});

for (const engine of META_ENGINES) {
  describe.skipIf(!engine.available)(`a companies table's lead word, read from the meta store [${engine.name}]`, () => {
    let handle: MetaHandle;
    let meta: MetaDb;
    let connectionId: string;

    beforeAll(async () => {
      handle = await engine.make();
      meta = handle.meta;
      connectionId = (await connectionsRepo(meta, crypto).create({ name: 'main', engine: 'postgres', introspectDsn: 'postgres://ro@localhost/app' })).id;
      const installed = await manifestsRepo(meta, crypto).install({ manifestKey: 'crm', version: '0.2.8', kind: 'app', source: 'file', document: APP, connectionId });
      await appTablesRepo(meta).record({ appKey: 'crm', manifestId: installed.row.id, connectionId, ref: 'companies', tableName: 'crm_companies', schemaName: 'public', owned: true, state: 'created' });
    }, 60_000);

    afterAll(async () => {
      await handle?.destroy();
    });

    const models = async (id: string) => (id === connectionId ? MODEL : null);

    it("reads the app's word, then the owner's", async () => {
      expect((await declaredPeople(meta, models))[0]?.lead).toEqual(LEAD);
      await overridesRepo(meta).create({ connectionId, op: 'table.people', tableName: 'public.crm_companies', columnName: null, value: { lead: { about: 'notes', address: { country: 'country' } } } });
      expect((await declaredPeople(meta, models))[0]?.lead).toEqual({ ...LEAD, about: 'notes' });
    });
  });
}
