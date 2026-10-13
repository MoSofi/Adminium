// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The app's section of the sidebar and where a record opens: a page kept off
 * the sidebar (`nav.offRail`), an entry that is not a page (`navLinks`), and a
 * table's address on the staff side (`frontends[].records`). What the check
 * accepts, every address it refuses, the release each word asks for, and what
 * goes with a part that is left out.
 */
import { describe, expect, it } from 'vitest';

import { installFloorWords, isRecordAddress, isSidePath, recordAddressOf, staffRecordAddresses, validateManifest, withoutModules, WORD_FLOORS } from '../src/index.js';

type Doc = Record<string, unknown>;
const id = { ref: 'id', type: 'int', role: 'pk' };
const en = (text: string) => ({ 'en-US': text });
const page = (ref: string, table: string, more: Doc = {}) => ({ ref, template: 'page-crud', title: { key: `t.${ref}`, fallback: ref }, nav: { group: 'selling', icon: 'list', order: 1 }, bindings: { rows: table }, ...more });

function app(change: (m: Doc) => void = () => undefined, floor = '0.3.28'): Doc {
  const m: Doc = {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'MIT',
    description: { key: 'd', fallback: 'A CRM' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: floor },
    modules: [
      { id: 'selling', label: en('Selling'), default: 'always' },
      { id: 'jobs', label: en('Jobs on site'), default: 'off' },
    ],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'deals', module: 'selling', columns: [id, { ref: 'name', type: 'text', maxLength: 80 }] },
        { ref: 'jobs', module: 'jobs', columns: [id, { ref: 'deal_id', type: 'fk', references: 'deals' }] },
      ],
    },
    navGroups: [{ key: 'selling', label: en('Selling'), order: 1 }, { key: 'setup', label: en('Set up'), order: 2 }],
    pages: [page('crm-deals', 'deals', { module: 'selling' }), page('crm-jobs', 'jobs', { module: 'jobs', nav: { group: 'selling', icon: 'hammer', order: 2, offRail: true } })],
    navLinks: [
      { ref: 'rules', label: en('Rules'), nav: { group: 'setup', icon: 'workflow', order: 1 }, to: { screen: 'automations' } },
      { ref: 'emails', label: { 'en-US': 'Emails', 'de-DE': 'E-Mails' }, nav: { group: 'setup', icon: 'mail', order: 2 }, to: { screen: 'email-templates' } },
      { ref: 'sample-data', label: en('Sample data'), nav: { group: 'setup', icon: 'database', order: 3 }, to: { screen: 'settings' } },
      { ref: 'approvals', label: en('Approvals'), nav: { group: 'selling', icon: 'check', order: 3 }, to: { side: 'staff', path: '/approvals' } },
      { ref: 'job-board', label: en('Job board'), nav: { group: 'selling', icon: 'hammer', order: 4 }, to: { side: 'staff' }, module: 'jobs' },
    ],
    frontends: [
      { side: 'staff', kind: 'spa', entry: 'index.html', placement: 'external', records: { deals: '/deals/{id}', jobs: '/jobs/{id}/sheet' } },
      { side: 'customer', kind: 'spa', entry: 'index.html' },
    ],
  };
  change(m);
  return m;
}

const messages = (m: Doc): string[] => {
  const result = validateManifest(m);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`);
};
const staff = (m: Doc) => (m['frontends'] as Doc[])[0]!;

describe('the three words', () => {
  it('are accepted as written', () => {
    expect(messages(app())).toEqual([]);
  });

  it('each ask for the release that reads it', () => {
    const found = installFloorWords(app());
    expect(found).toContainEqual({ word: 'frontend.records', path: 'frontends.0.records' });
    expect(found).toContainEqual({ word: 'nav.offRail', path: 'pages.1.nav.offRail' });
    expect(found).toContainEqual({ word: 'navLinks', path: 'navLinks' });
    for (const word of ['frontend.records', 'nav.offRail', 'navLinks'] as const) expect(WORD_FLOORS[word]).toBe('0.3.28');
    const old = messages(app(undefined, '0.3.26')).join('\n');
    expect(old).toContain('"frontend.records" is read by Adminium 0.3.28 and later');
    expect(old).toContain('"nav.offRail" is read by Adminium 0.3.28 and later');
    expect(old).toContain('"navLinks" is read by Adminium 0.3.28 and later');
  });
});

describe('where a record opens', () => {
  it('is a path under the side with one {id}', () => {
    for (const good of ['/deals/{id}', '/{id}', '/a/b-c/{id}/sheet', '/quotes.v2/{id}', '/x_y/~z/{id}']) expect(isRecordAddress(good), good).toBe(true);
  });

  it('is never an address of anywhere else', () => {
    const bad = [
      'deals/{id}', // no leading slash: relative to wherever the reader is
      '//evil.example/{id}', // another host
      '/\\evil.example/{id}', // a browser reads "\" as "/"
      'https://evil.example/{id}',
      'javascript:alert(1)//{id}',
      '/deals/../../apps/other/staff/{id}', // out of the side
      '/./{id}',
      '/.hidden/{id}',
      '/deals/{id}?next=//evil.example',
      '/deals/{id}#x',
      '/deals/%2e%2e/{id}',
      '/deals/{id}/',
      '/deals//{id}',
      '/deals/{id}/{id}', // one record, one id
      '/deals', // no id: every record at one address
      '/deals/x{id}', // the id is a whole segment
      '/deals/{pk}',
      '/de als/{id}',
      '/deals/{id}\n',
      '',
      `/${'a'.repeat(200)}/{id}`,
    ];
    for (const address of bad) {
      expect(isRecordAddress(address), address).toBe(false);
      expect(messages(app((m) => (staff(m)['records'] = { deals: address }))).join('\n'), address).toContain('frontends.0.records.deals');
    }
  });

  it('keeps the id to its one segment, whatever it holds', () => {
    expect(recordAddressOf('/deals/{id}', '12')).toBe('/deals/12');
    expect(recordAddressOf('/deals/{id}/sheet', '../../x')).toBe('/deals/..%2F..%2Fx/sheet');
    expect(recordAddressOf('/deals/{id}', '//evil.example')).toBe('/deals/%2F%2Fevil.example');
    expect(recordAddressOf('/deals/{id}', '[1,"a?b#c"]')).toBe('/deals/%5B1%2C%22a%3Fb%23c%22%5D');
    expect(recordAddressOf('/deals/{id}', '')).toBeNull();
    // A stored address that is not one answers nothing, so the caller keeps the dashboard's page.
    expect(recordAddressOf('//evil.example/{id}', '1')).toBeNull();
    expect(recordAddressOf(undefined, '1')).toBeNull();
  });

  it('is the staff side\'s alone, for a table the app has', () => {
    const onCustomer = messages(app((m) => ((m['frontends'] as Doc[])[1]!['records'] = { deals: '/deals/{id}' })));
    expect(onCustomer.join('\n')).toContain('frontends.1.records: only the staff side says where a record opens');
    const noTable = messages(app((m) => (staff(m)['records'] = { ghosts: '/ghosts/{id}' })));
    expect(noTable.join('\n')).toContain('frontends.0.records.ghosts: the app has no table "ghosts"');
    expect(messages(app((m) => (staff(m)['records'] = {}))).join('\n')).toContain('name at least one table');
  });

  it('is read off the plain document, and only what is an address', () => {
    expect(staffRecordAddresses(app())).toEqual({ deals: '/deals/{id}', jobs: '/jobs/{id}/sheet' });
    expect(staffRecordAddresses({ frontends: [{ side: 'staff', records: { deals: '//evil.example/{id}', jobs: '/jobs/{id}' } }] })).toEqual({ jobs: '/jobs/{id}' });
    expect(staffRecordAddresses({ frontends: [{ side: 'customer', records: { deals: '/deals/{id}' } }] })).toEqual({});
    expect(staffRecordAddresses(null)).toEqual({});
  });

  it('goes with a table that is not made', () => {
    const without = withoutModules(app(), ['jobs']);
    expect(staff(without)['records']).toEqual({ deals: '/deals/{id}' });
    const none = withoutModules(app((m) => (staff(m)['records'] = { jobs: '/jobs/{id}' })), ['jobs']);
    expect(staff(none)).not.toHaveProperty('records');
  });
});

describe('a page kept off the sidebar', () => {
  it('says so with `true` and nothing else', () => {
    const pages = (m: Doc) => m['pages'] as { nav: Doc }[];
    expect(messages(app((m) => (pages(m)[1]!.nav['offRail'] = false))).join('\n')).toContain('pages.1.nav.offRail');
    expect(messages(app((m) => (pages(m)[1]!.nav['hidden'] = true))).join('\n')).toContain('pages.1.nav');
  });
});

describe('an entry of the section that is not a page', () => {
  const links = (m: Doc) => m['navLinks'] as Doc[];

  it('opens one of a closed list of places, never an address', () => {
    for (const to of [{ url: 'https://evil.example' }, { href: '/settings/roles' }, { screen: 'roles' }, { screen: 'automations', app: 'other' }, { side: 'customer' }, { side: 'staff', path: '//evil.example' }, { side: 'staff', path: '/a/../b' }, { side: 'staff', path: '/a?b=1' }, { side: 'staff', path: 'javascript:alert(1)' }, { side: 'staff', path: '/deals/{id}' }, 'https://evil.example']) {
      expect(messages(app((m) => (links(m)[0]!['to'] = to))).join('\n'), JSON.stringify(to)).toContain('navLinks.0.to');
    }
    expect(isSidePath('/approvals')).toBe(true);
    expect(isSidePath('/')).toBe(false);
  });

  it('is named once, sits in a part that exists, and needs the side it opens', () => {
    expect(messages(app((m) => (links(m)[1]!['ref'] = 'rules'))).join('\n')).toContain('navLinks.1.ref: "rules" is named twice');
    expect(messages(app((m) => (links(m)[4]!['module'] = 'nope'))).join('\n')).toContain('navLinks.4.module');
    const noStaff = messages(app((m) => {
      m['frontends'] = [{ side: 'customer', kind: 'spa', entry: 'index.html' }];
    }));
    expect(noStaff.join('\n')).toContain('navLinks.3.to.side: the app declares no staff side to open');
    expect(messages(app((m) => (links(m)[0]!['label'] = { 'de-DE': 'Regeln' }))).join('\n')).toContain('navLinks.0.label');
    expect(messages(app((m) => (links(m)[0]!['nav'] = { group: 'setup', icon: 'x', order: 1, offRail: true }))).join('\n')).toContain('navLinks.0.nav');
  });

  it('goes with its part', () => {
    const without = withoutModules(app(), ['jobs']);
    expect((without['navLinks'] as Doc[]).map((link) => link['ref'])).toEqual(['rules', 'emails', 'sample-data', 'approvals']);
  });
});
