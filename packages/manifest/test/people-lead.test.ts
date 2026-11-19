// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A company's details in the declaration: the `lead` word on a `companies`
 * entry of `people`, which says where a found company's number, website,
 * phone, address, activity, about and owner go. A CRM-shaped companies table
 * with its three new columns passes; a lead on a people table, a country
 * column wider than 2, an owner that holds no staff member, and a text column
 * with no width are each refused; and the word needs Adminium 0.3.66.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, validateManifest, WORD_FLOORS } from '../src/index.js';

type Doc = Record<string, unknown>;

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength: number | undefined, more: Doc = {}): Doc => ({ ref, type: 'text', ...(maxLength === undefined ? {} : { maxLength }), nullable: true, ...more });

/** The CRM's `companies` declaration over its details (its K11 shape). */
const LEAD: Doc = {
  number: 'company_number',
  website: 'website',
  phone: 'phone',
  address: { lines: 'address_lines', town: 'town', region: 'region', postalCode: 'postal_code', country: 'country' },
  activity: 'sector',
  about: 'about',
  owner: 'account_owner_id',
};

/** A small CRM: companies shaped like the CRM's, with `company_number`, `phone` and `about`, and their contacts. */
function crm(lead: Doc | null = LEAD, floor = '0.3.66'): Doc & { requiredSchema: { tables: { ref: string; columns: Doc[] }[] }; people: Doc[] } {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A CRM.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: floor },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'companies',
          keyField: 'name',
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 160 },
            text('customer_no', 40, { unique: true, rules: { normalize: 'code' } }),
            text('company_number', 40, { rules: { normalize: 'code' } }),
            text('sector', 80),
            text('address_lines', 400),
            text('town', 120),
            text('region', 120),
            text('postal_code', 20),
            text('country', 2),
            text('website', 200),
            text('phone', 40),
            text('about', 1000),
            text('notes', undefined),
            text('account_owner_id', 36, { rules: { staff: true } }),
          ],
          indexes: [['company_number']],
        },
        {
          ref: 'contacts',
          keyField: 'name',
          columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, text('email', 254), { ref: 'company_id', type: 'fk', references: 'companies', nullable: true }],
        },
      ],
    },
    people: [
      { table: 'contacts', kind: 'people', email: 'email', name: 'name', company: 'company_id' },
      { table: 'companies', kind: 'companies', name: 'name', ...(lead === null ? {} : { lead }) },
    ],
    pages: [{ ref: 'crm-companies', template: 'page-crud', title: { key: 't', fallback: 'Companies' }, nav: { group: 'library', icon: 'list', order: 1 }, bindings: { rows: 'companies' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

const issuesOf = (doc: unknown): string[] => {
  const result = validateManifest(doc);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};
const withLead = (lead: Doc) => issuesOf(crm(lead)).join('\n');
const companies = (doc: ReturnType<typeof crm>) => doc.requiredSchema.tables[0]!;

describe('a company\'s details in the declaration', () => {
  it('passes the CRM\'s own declaration, over a companies table with its three new columns', () => {
    expect(issuesOf(crm())).toEqual([]);
    const result = validateManifest(crm());
    expect(result.ok && result.manifest.kind === 'app' && result.manifest.people?.[1]?.lead).toEqual(LEAD);
    // Every key is optional.
    expect(withLead({})).toBe('');
    expect(withLead({ number: 'company_number' })).toBe('');
  });

  it('is refused on a table of people', () => {
    const doc = crm();
    doc.people[0]!['lead'] = { phone: 'name' };
    expect(issuesOf(doc)).toContain('people.0.lead: a company\'s details ("lead") are said on a companies entry, not on a table of people');
  });

  it('refuses a country column wider than 2', () => {
    const doc = crm();
    const country = companies(doc).columns.find((column) => column['ref'] === 'country')!;
    country['maxLength'] = 40;
    expect(issuesOf(doc)).toContain('people.1.lead.address.country: "companies.country" holds a country as its two-letter code (ISO 3166-1 alpha-2): make it exactly 2 wide (maxLength 2)');
    // A country named by a column with no width at all, too.
    expect(withLead({ address: { country: 'notes' } })).toContain('"companies.notes" holds a country as its two-letter code');
  });

  it('refuses an owner on a column that holds no staff member', () => {
    expect(withLead({ owner: 'website' })).toContain('people.1.lead.owner: "companies.website" is set to the staff member who adds a company: make it a column that holds a staff member (rules.staff)');
    expect(withLead({ owner: 'id' })).toContain('people.1.lead.owner: "companies.id" is not a column that holds a staff member');
  });

  it('refuses a text column with no width, a column of another kind, a missing column, and a column twice', () => {
    expect(withLead({ about: 'notes' })).toContain('people.1.lead.about: "companies.notes" takes what a source found, cut to its width: give it a maxLength');
    expect(withLead({ number: 'id' })).toContain('people.1.lead.number: "companies.id" is not a text column');
    expect(withLead({ phone: 'fax' })).toContain('people.1.lead.phone: "companies" has no column "fax"');
    expect(withLead({ phone: 'phone', about: 'phone' })).toContain('people.1.lead.about: "companies.phone" holds the phone already: each detail goes in a column of its own');
    expect(withLead({ address: { town: 'town', city: 'town' } })).toContain('Unrecognized key');
  });

  it('needs Adminium 0.3.66', () => {
    expect(WORD_FLOORS['people.lead']).toBe('0.3.66');
    expect(installFloorWords(crm())).toContainEqual({ word: 'people.lead', path: 'people.1.lead' });
    expect(issuesOf(crm(LEAD, '0.3.65'))).toContain('people.1.lead: "people.lead" is read by Adminium 0.3.66 and later, and compatibility.minAdminiumVersion is 0.3.65: set it to 0.3.66 or later');
    // Without the word, the same app is fine at the older floor.
    expect(issuesOf(crm(null, '0.3.65'))).toEqual([]);
  });
});
