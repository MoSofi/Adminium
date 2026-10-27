// SPDX-License-Identifier: AGPL-3.0-only
/**
 * CONSENT ON THE WRITE SIDE, against the whole server on SQLite, Postgres
 * and MySQL: a small CRM whose contacts declare `may_email` as the
 * newsletter's consent column (with its two strict stamps, who and when) and
 * an opt-out mark carried from a claimed enquiry.
 *
 *  - A staff member's tick of `may_email` writes one staff row in the consent
 *    log in the same save; taking it back writes a "no"; a save that changes
 *    nothing writes nothing; a file brought in writes an `import` row.
 *  - An unsubscribe (the mail door's one-click) writes the column through the
 *    column door: "by" empty, "when" the unsubscribe's, and no second log row;
 *    "Record consent" on the record page writes it as the staff member.
 *  - The opt-out mark is stamped by a staff member's create from a screen that
 *    showed the line (`optOut: {shown: true}`), and again when the address
 *    changes there; not by the same create without it, through an API key, a
 *    file brought in, a rule, or the sample loader; a file's line carrying one
 *    is refused. A contact made from a claimed enquiry takes the enquiry's
 *    mark, for the same address only.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { apiKeysRepo, consentLogRepo, rolesRepo, settingsRepo } from '@adminium/meta';

import { createConsentService } from '../src/consent/index.js';
import { mailLinkKeys } from '../src/email/link-keys.js';
import { makeUnsubscribeToken } from '../src/email/unsubscribe-token.js';
import { generateApiKey } from '../src/rbac/api-keys.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

// The people word and its consent column are read from the release to come.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.38' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const en = (text: string) => ({ 'en-US': text });
const strict = (set: string, on: unknown) => ({ stamp: { set, on, strict: true } });

function crm(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A small CRM.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.38', engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'enquiries',
          columns: [
            id,
            { ref: 'person', type: 'text', maxLength: 80 },
            { ref: 'email', type: 'text', maxLength: 254, nullable: true },
            { ref: 'opt_out_offered_at', type: 'timestamptz', nullable: true, rules: strict('now', 'create') },
          ],
        },
        {
          ref: 'contacts',
          columns: [
            id,
            { ref: 'name', type: 'text', maxLength: 80 },
            // Not personal here, so the rule below may write it: a rule's contact has an address, and still no mark.
            { ref: 'email', type: 'text', maxLength: 254, nullable: true, rules: { personal: false } },
            { ref: 'may_email', type: 'bool', default: false },
            { ref: 'may_email_by_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true, ...strict('user-id', { columns: ['may_email'] }) } },
            { ref: 'may_email_at', type: 'timestamptz', nullable: true, rules: strict('now', { columns: ['may_email'] }) },
            // Its own trigger is never fired: the screen that shows the line sets it.
            { ref: 'opt_out_offered_at', type: 'timestamptz', nullable: true, rules: strict('now', { columns: ['email', 'may_email'] }) },
          ],
        },
      ],
    },
    people: [
      {
        table: 'contacts',
        kind: 'people',
        email: 'email',
        name: 'name',
        consent: { column: 'may_email', purpose: 'newsletter' },
        optOutMark: { column: 'opt_out_offered_at', carryFrom: { table: 'enquiries', column: 'opt_out_offered_at' } },
      },
      { table: 'enquiries', kind: 'people', email: 'email', name: 'person', optOutMark: 'opt_out_offered_at' },
    ],
    roles: [
      {
        key: 'rep',
        name: 'Rep',
        permissions: ['table:@contacts:read', 'table:@contacts:read_pii', 'table:@contacts:create', 'table:@contacts:update', 'table:@contacts:import', 'table:@enquiries:read', 'table:@enquiries:read_pii', 'table:@enquiries:create', 'table:@enquiries:update'],
      },
      { key: 'clerk', name: 'Clerk', permissions: ['table:@contacts:read', 'table:@contacts:create'] },
    ],
    automations: [
      {
        key: 'enquiry-contact',
        name: en('An enquiry is made: a contact for it'),
        enabled: true,
        trigger: { kind: 'record', event: 'created', table: 'enquiries' },
        graph: {
          version: 1,
          nodes: [
            { id: 't', kind: 'trigger', title: 'When' },
            { id: 'make', kind: 'action', title: 'make', action: { kind: 'record.create', table: 'contacts', values: { name: 'Rule: {{record.person}}', email: '{{record.email}}' } } },
          ],
        },
      },
    ],
    sampleData: { file: 'seeds/crm.sample.json' },
    pages: [{ ref: 'crm-contacts', template: 'page-crud', title: { key: 't', fallback: 'Contacts' }, nav: { group: 'crm', icon: 'home', order: 1 }, bindings: { rows: 'contacts' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

const SAMPLE = {
  format: 'adminium.sample/1',
  app: 'crm',
  tables: [
    {
      ref: 'contacts',
      rows: [
        { name: 'Sample Sal', email: 'sal@sample.example', may_email: true },
        { name: 'Sample Mo', email: 'mo@sample.example', may_email: true, opt_out_offered_at: '2025-03-01T10:00:00Z' },
      ],
    },
  ],
};

const ms = (value: unknown): number => (value instanceof Date ? value.getTime() : Date.parse(String(value).replace(' ', 'T')));
const yes = (value: unknown): boolean => value === true || value === 1 || value === '1';
const recent = (value: unknown) => value !== null && value !== undefined && Math.abs(ms(value) - Date.now()) < 10 * 60_000;

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`consent on the write side [${dialect}]`, () => {
    let s: WholeServer;
    let contactsId = '';
    const data = (path: string) => `/api/v1/data/${s.connectionId}/${path}`;
    const contact = async (key: number) => (await s.rows(`select * from crm_contacts where id = ${String(key)}`))[0]!;
    const enquiry = async (key: number) => (await s.rows(`select * from crm_enquiries where id = ${String(key)}`))[0]!;
    /** The consent log's rows about one contact, oldest first. */
    const logOf = async (key: number) =>
      (await consentLogRepo(s.meta).history({ person: { connectionId: s.connectionId, table: contactsId, key: String(key) }, hashes: [] }, { limit: 50 })).reverse();
    const make = (who: string, values: Record<string, unknown>, optOut?: Record<string, unknown>) => s.send(who, 'POST', data(s.t('contacts')), { values, ...(optOut === undefined ? {} : { optOut }) });
    const bring = async (who: string, ref: string, csv: string, columns: { from: string; to: string }[]) => {
      const up = await s.app.inject({ method: 'POST', url: '/api/v1/imports/upload?filename=lines.csv', headers: { cookie: s.cookie[who]!, 'content-type': 'text/csv' }, payload: csv });
      expect(up.statusCode, up.body).toBe(201);
      const made = await s.send(who, 'POST', '/api/v1/imports', { fileId: (up.json() as { data: { fileId: string } }).data.fileId, connectionId: s.connectionId, table: s.t(ref), mapping: { columns }, options: { mode: 'insert' } });
      expect(made.statusCode, made.body).toBe(201);
      const importId = (made.json() as { data: { import: { id: string } } }).data.import.id;
      const preview = await s.get(who, `/api/v1/imports/${importId}/preview`);
      const run = await s.send(who, 'POST', `/api/v1/imports/${importId}/run`);
      expect(run.statusCode, run.body).toBeLessThan(300);
      await s.jobs();
      return (preview.json() as { data: { lines: { row: number; status: string; column?: string }[] } }).data.lines;
    };

    beforeAll(async () => {
      s = await wholeServer(dialect, crm(), { people: { rita: ['rep'], carl: ['clerk'] }, files: { 'seeds/crm.sample.json': JSON.stringify(SAMPLE) } });
      contactsId = s.t('contacts');
      // Rows here are made with their keys given; on Postgres a key left to the database counts from 1 regardless, so it starts past them.
      if (dialect === 'postgres') {
        for (const table of ['crm_contacts', 'crm_enquiries']) await s.rows(`select setval(pg_get_serial_sequence('${table}', 'id'), 5000)`);
      }
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('a staff tick of may_email writes one staff row in the log in the same save; taking it back writes a no', async () => {
      expect(said(await make('rita', { id: 1, name: 'Marta Kovac', email: 'marta@cobalt.example' }))).toBe('ok');
      // A new contact that may not be e-mailed: nobody was asked, nothing is written.
      expect(await logOf(1)).toEqual([]);
      expect(said(await s.change('rita', 'contacts', 1, { may_email: true }))).toBe('ok');
      const ticked = await logOf(1);
      expect(ticked.map((row) => [row.state, row.source, row.purpose, row.staffId, row.detail])).toEqual([['yes', 'staff', 'newsletter', s.ids['rita'], 'saved']]);
      // The row's own stamps say the same person.
      expect((await contact(1))['may_email_by_id']).toBe(s.ids['rita']);
      // A save that sends the same tick again changes nothing, and writes nothing.
      expect(said(await s.change('rita', 'contacts', 1, { may_email: true, name: 'Marta Kovac' }))).toBe('ok');
      expect(await logOf(1)).toHaveLength(1);
      expect(said(await s.change('owner', 'contacts', 1, { may_email: false }))).toBe('ok');
      expect((await logOf(1)).map((row) => [row.state, row.source, row.staffId])).toEqual([
        ['yes', 'staff', s.ids['rita']],
        ['no', 'staff', s.ids['owner']],
      ]);
      // A create that ticks it says so too.
      expect(said(await make('rita', { id: 2, name: 'Ben Okafor', email: 'ben@okafor.example', may_email: true }))).toBe('ok');
      expect((await logOf(2)).map((row) => [row.state, row.source])).toEqual([['yes', 'staff']]);
    });

    it('a file brought in with a yes writes an import row; a bulk edit is the staff member\'s', async () => {
      const lines = await bring('rita', 'contacts', 'Id,Name,Email,May email\n40,Ines Holt,ines@holt.example,yes\n41,Ola Berg,ola@berg.example,\n', [
        { from: 'Id', to: 'id' },
        { from: 'Name', to: 'name' },
        { from: 'Email', to: 'email' },
        { from: 'May email', to: 'may_email' },
      ]);
      expect(lines.map((line) => line.status)).toEqual(['new', 'new']);
      expect((await logOf(40)).map((row) => [row.state, row.source, row.staffId])).toEqual([['yes', 'import', null]]);
      expect(await logOf(41)).toEqual([]);
      expect(said(await s.send('rita', 'POST', data(`${contactsId}/bulk`), { action: 'update', ids: [41], values: { may_email: true } }))).toBe('ok');
      expect((await logOf(41)).map((row) => [row.state, row.source, row.staffId, row.detail])).toEqual([['yes', 'staff', s.ids['rita'], 'bulk']]);
    });

    it('an unsubscribe writes the column through the column door, by nobody, with no second log row', async () => {
      expect(said(await make('rita', { id: 3, name: 'Una Sub', email: 'Una.Sub@lists.example', may_email: true }))).toBe('ok');
      expect((await contact(3))['may_email_by_id']).toBe(s.ids['rita']);
      expect(await logOf(3)).toHaveLength(1);
      await settingsRepo(s.meta).set('system.publicOrigin', 'https://news.crm.example', { updatedBy: null });
      await settingsRepo(s.meta).set('system.instanceId', 'install-1', { updatedBy: null });
      const token = makeUnsubscribeToken(await mailLinkKeys(s.meta, TEST_SECRET).unsubscribe(), 'install-1', { address: 'una.sub@lists.example', purpose: 'newsletter' });
      const before = Date.now();
      const oneClick = await s.app.inject({ method: 'POST', url: `/m/u/${token}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'List-Unsubscribe=One-Click' });
      expect(oneClick.statusCode, oneClick.body).toBe(200);
      const row = await contact(3);
      expect(yes(row['may_email'])).toBe(false);
      // "By" is empty: nobody on the staff ticked it off; "when" is the unsubscribe's.
      expect(row['may_email_by_id']).toBeNull();
      expect(ms(row['may_email_at'])).toBeGreaterThanOrEqual(before - 2_000);
      // The door wrote the column directly: the log keeps the tick and the unsubscribe, and nothing more.
      const consent = createConsentService({ meta: s.meta, secret: TEST_SECRET });
      const all = await consent.history({ person: { connectionId: s.connectionId, table: contactsId, key: '3' }, address: 'una.sub@lists.example' });
      expect(all.map((event) => [event.state, event.source, event.staffId])).toEqual([
        ['no', 'unsubscribe', null],
        ['yes', 'staff', s.ids['rita']],
      ]);
      // The opt-out mark is never the door's to stamp, whatever its trigger names.
      expect(row['opt_out_offered_at']).toBeNull();
    });

    it('"Record consent" on the record page writes the column through the column door, as the staff member, with one log row', async () => {
      expect(said(await make('rita', { id: 4, name: 'Ria Record', email: 'ria@record.example' }))).toBe('ok');
      const recorded = await s.send('rita', 'POST', '/api/v1/consent/record-consent', { connectionId: s.connectionId, table: contactsId, recordId: '4', purpose: 'newsletter', how: 'phone', note: null });
      expect(recorded.statusCode, recorded.body).toBe(200);
      const row = await contact(4);
      expect(yes(row['may_email'])).toBe(true);
      expect(row['may_email_by_id']).toBe(s.ids['rita']);
      expect(recent(row['may_email_at'])).toBe(true);
      expect((await logOf(4)).map((event) => [event.state, event.source, event.how])).toEqual([['yes', 'staff', 'phone']]);
      // The panel finds the record's address by the column its app declares.
      const panel = await s.send('rita', 'POST', '/api/v1/consent/panel', { connectionId: s.connectionId, table: contactsId, recordId: '4' });
      expect((panel.json() as { data: { addressKnown: boolean } }).data.addressKnown).toBe(true);
    });

    it('marks a staff create from a screen that showed the line, and again when the address changes there', async () => {
      expect(said(await make('rita', { id: 10, name: 'Lina Line', email: 'lina@line.example' }, { shown: true }))).toBe('ok');
      const first = (await contact(10))['opt_out_offered_at'];
      expect(recent(first)).toBe(true);
      // A change that keeps the address keeps the mark as it was; one without the line leaves it too.
      expect(said(await s.send('rita', 'PATCH', data(`${contactsId}/10`), { values: { name: 'Lina L.' }, optOut: { shown: true } }))).toBe('ok');
      expect(ms((await contact(10))['opt_out_offered_at'])).toBe(ms(first));
      expect(said(await s.change('rita', 'contacts', 10, { email: 'lina@elsewhere.example' }))).toBe('ok');
      expect(ms((await contact(10))['opt_out_offered_at'])).toBe(ms(first));
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      expect(said(await s.send('rita', 'PATCH', data(`${contactsId}/10`), { values: { email: 'lina@third.example' }, optOut: { shown: true } }))).toBe('ok');
      expect(ms((await contact(10))['opt_out_offered_at'])).toBeGreaterThan(ms(first));
    });

    it('does not mark the same create without the line, with no address, or one that sends the mark itself', async () => {
      expect(said(await make('rita', { id: 11, name: 'Nils None', email: 'nils@none.example', opt_out_offered_at: '2020-01-01T09:00:00Z' }))).toBe('ok');
      expect((await contact(11))['opt_out_offered_at']).toBeNull();
      expect(said(await make('rita', { id: 12, name: 'Ada Address' }, { shown: true }))).toBe('ok');
      expect((await contact(12))['opt_out_offered_at']).toBeNull();
    });

    it('refuses the line through an API key, and never marks an API key\'s create', async () => {
      const rep = (await rolesRepo(s.meta).findBySlug('crm-rep'))!;
      const generated = generateApiKey();
      await apiKeysRepo(s.meta).create({ name: 'tablet', prefix: generated.prefix, tokenHash: generated.tokenHash, roleId: rep.id });
      const bearer = { authorization: `Bearer ${generated.key}` };
      const refused = await s.app.inject({ method: 'POST', url: data(contactsId), headers: bearer, payload: { values: { id: 13, name: 'Kim Key', email: 'kim@key.example' }, optOut: { shown: true } } });
      expect(refused.statusCode, refused.body).toBe(403);
      expect(await s.rows('select id from crm_contacts where id = 13')).toEqual([]);
      const plain = await s.app.inject({ method: 'POST', url: data(contactsId), headers: bearer, payload: { values: { id: 13, name: 'Kim Key', email: 'kim@key.example' } } });
      expect(plain.statusCode, plain.body).toBe(201);
      expect((await contact(13))['opt_out_offered_at']).toBeNull();
    });

    it('never marks a row brought in from a file, and refuses a line that carries a mark', async () => {
      const lines = await bring('rita', 'contacts', 'Id,Name,Email,Offered\n50,Fia File,fia@file.example,\n51,Gus Given,gus@file.example,2025-01-01T10:00:00Z\n', [
        { from: 'Id', to: 'id' },
        { from: 'Name', to: 'name' },
        { from: 'Email', to: 'email' },
        { from: 'Offered', to: 'opt_out_offered_at' },
      ]);
      expect(lines.map((line) => [line.status, line.column])).toEqual([
        ['new', undefined],
        ['refused', 'opt_out_offered_at'],
      ]);
      expect((await contact(50))['opt_out_offered_at']).toBeNull();
      expect(await s.rows('select id from crm_contacts where id = 51')).toEqual([]);
    });

    it('never marks a contact a rule makes, though the enquiry it is made from was marked by the line', async () => {
      const made = await s.send('rita', 'POST', data(s.t('enquiries')), { values: { id: 1, person: 'Rula Rule', email: 'rula@rule.example' }, optOut: { shown: true } });
      expect(said(made)).toBe('ok');
      expect(recent((await enquiry(1))['opt_out_offered_at'])).toBe(true);
      await s.jobs();
      const [ruled] = await s.rows("select * from crm_contacts where name = 'Rule: Rula Rule'");
      expect(ruled, 'the rule made its contact').toBeDefined();
      expect(ruled!['opt_out_offered_at']).toBeNull();
    });

    it('never marks a row the sample loader brings, and keeps the mark a sample row holds as history', async () => {
      const added = await s.send('owner', 'POST', '/api/v1/apps/crm/sample-data', {});
      expect(added.statusCode, added.body).toBe(200);
      await s.jobs();
      const [sal] = await s.rows("select * from crm_contacts where email = 'sal@sample.example'");
      const [mo] = await s.rows("select * from crm_contacts where email = 'mo@sample.example'");
      expect(sal!['opt_out_offered_at']).toBeNull();
      expect(ms(mo!['opt_out_offered_at'])).toBe(Date.parse('2025-03-01T10:00:00Z'));
      // A sample's yes is history, not a tick: the log says nothing of it (the first send's review asks).
      expect(await logOf(Number(sal!['id']))).toEqual([]);
    });

    it('a contact made from a claimed enquiry takes its mark, for the same address only', async () => {
      const made = await s.send('rita', 'POST', data(s.t('enquiries')), { values: { id: 2, person: 'Cora Claim', email: 'Cora@Claim.example' }, optOut: { shown: true } });
      expect(said(made)).toBe('ok');
      const offered = (await enquiry(2))['opt_out_offered_at'];
      expect(recent(offered)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 1_100));
      // The new-deal sheet makes the contact from the enquiry: the mark comes with her, as it was.
      expect(said(await make('rita', { id: 20, name: 'Cora Claim', email: 'cora@claim.example' }, { from: '2' }))).toBe('ok');
      expect(ms((await contact(20))['opt_out_offered_at'])).toBe(ms(offered));
      // Another address than the one the line was offered at: no mark comes with it.
      expect(said(await make('rita', { id: 21, name: 'Cora Other', email: 'cora@other.example' }, { from: '2' }))).toBe('ok');
      expect((await contact(21))['opt_out_offered_at']).toBeNull();
      // An enquiry with no mark carries none; the sheet that showed the line marks the contact now.
      await s.rows("insert into crm_enquiries (id, person, email) values (3, 'Dan Bare', 'dan@bare.example')");
      expect(said(await make('rita', { id: 22, name: 'Dan Bare', email: 'dan@bare.example' }, { from: '3' }))).toBe('ok');
      expect((await contact(22))['opt_out_offered_at']).toBeNull();
      expect(said(await make('rita', { id: 23, name: 'Dan Bare', email: 'dan@bare.example' }, { from: '3', shown: true }))).toBe('ok');
      expect(recent((await contact(23))['opt_out_offered_at'])).toBe(true);
      // An enquiry the person cannot read is none to carry from.
      expect((await make('carl', { id: 24, name: 'Cora Claim', email: 'cora@claim.example' }, { from: '2' })).statusCode).toBe(404);
    });
  });
}
