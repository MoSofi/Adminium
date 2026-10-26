// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A CAMPAIGN TO THE PEOPLE OF A TABLE, against the whole server on SQLite,
 * Postgres and MySQL: a small CRM whose contacts declare their address,
 * name (first name: its first word), language, consent column (with its
 * stamps), customer column and opt-out mark, and whose guests declare only
 * an address.
 *
 *  - The picker lists the tables the sender reads, and says when they see the
 *    addresses masked; "existing customers" is offered only where the app
 *    declares the opt-out mark, and switched on only with the owner's tick,
 *    who and when kept.
 *  - A sender who sees the addresses masked, or not at all, who cannot read
 *    the table, a view with a search term, another person's private view, a
 *    view filtering by a column the sender's role hides: each refused by
 *    name, at the dialog and at the send.
 *  - The breakdown counts every row one way: consent, existing customers,
 *    the do-not-email list, not agreed, the first send's review, customers
 *    left out for want of the mark, sample rows, reserved domains, no
 *    address; a saved view narrows it.
 *  - The send writes the ledger the same way, marks the run marketing on
 *    the basis asked for, and fills each mail from the table's own columns
 *    and the first word of the name, in the row's own language.
 *  - The first send's review: "Confirm" and "Leave out" each write one row
 *    in the consent log in the reviewer's name, the column follows, and the
 *    next review no longer asks; a reviewer who may not change the table may
 *    not answer.
 *  - A sender who loses the right to see the addresses mid-run is refused at
 *    the next batch, and one who loses it before the run starts is refused
 *    at its first.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { consentLogRepo, emailRunsRepo, emailTemplatesRepo, pagesRepo, permissionsRepo, rolesRepo, settingsRepo, viewsRepo } from '@adminium/meta';

import { createConsentService } from '../src/consent/index.js';
import { createDkimKeys, createTxtLookup } from '../src/email/sender/index.js';
import { pageSourceTable } from '../src/routes/exports/source.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, said, wholeServer, type Reply, type WholeServer } from './whole-server.helpers.js';

// The people word and its columns are read from the release to come.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.37' }));

const ORIGIN = 'https://crm.meridian.example';
const POSTAL = 'Meridian Workplace Ltd, 4 Wharf Lane, Leeds LS1 4BR, United Kingdom';
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
            { ref: 'email', type: 'text', maxLength: 254, nullable: true, rules: { personal: true } },
            { ref: 'may_email', type: 'bool', default: false },
            { ref: 'may_email_by_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true, ...strict('user-id', { columns: ['may_email'] }) } },
            { ref: 'may_email_at', type: 'timestamptz', nullable: true, rules: strict('now', { columns: ['may_email'] }) },
            { ref: 'opt_out_offered_at', type: 'timestamptz', nullable: true, rules: strict('now', { columns: ['email'] }) },
            { ref: 'won_deals', type: 'int', default: 0 },
            { ref: 'lang', type: 'text', maxLength: 10, nullable: true },
            { ref: 'city', type: 'text', maxLength: 40, nullable: true },
          ],
        },
        // Who counts as a customer, but no screen that shows the opt-out line: never offered the basis.
        {
          ref: 'guests',
          columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'email', type: 'text', maxLength: 254, nullable: true, rules: { personal: true } }, { ref: 'stays', type: 'int', default: 0 }],
        },
      ],
    },
    people: [
      {
        table: 'contacts',
        kind: 'people',
        email: 'email',
        name: 'name',
        firstName: 'firstWordOfName',
        language: 'lang',
        consent: { column: 'may_email', purpose: 'newsletter' },
        customer: 'won_deals',
        optOutMark: 'opt_out_offered_at',
      },
      { table: 'guests', kind: 'people', email: 'email', name: 'name', customer: 'stays' },
    ],
    roles: [
      { key: 'marketer', name: 'Marketer', permissions: ['table:@contacts:read', 'table:@contacts:read_pii', 'table:@contacts:update', 'table:@guests:read', 'table:@guests:read_pii'] },
      { key: 'masked', name: 'Masked', permissions: ['table:@contacts:read'] },
      { key: 'reader', name: 'Reader', permissions: ['table:@contacts:read', 'table:@contacts:read_pii'] },
      { key: 'filterless', name: 'Filterless', permissions: ['table:@contacts:read', 'table:@contacts:read_pii'], limits: { contacts: { readable: ['name', 'email', 'city'] } } },
      { key: 'blindmail', name: 'Blind mail', permissions: ['table:@contacts:read', 'table:@contacts:read_pii'], limits: { contacts: { readable: ['name', 'city'] } } },
    ],
    sampleData: { file: 'seeds/crm.sample.json' },
    pages: [{ ref: 'crm-contacts', template: 'page-crud', title: { key: 't', fallback: 'Contacts' }, nav: { group: 'crm', icon: 'home', order: 1 }, bindings: { rows: 'contacts' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

const SAMPLE = {
  format: 'adminium.sample/1',
  app: 'crm',
  tables: [{ ref: 'contacts', rows: [{ name: 'Sal Sample', email: 'sal@samplecorp.dev', may_email: true, city: 'York' }] }],
};

interface Breakdown {
  rows: number;
  recipients: number;
  consent: number;
  existingCustomers: number;
  doNotEmail: number;
  notAgreed: number;
  awaitingReview: number;
  notMarked: number;
  sample: number;
  reservedDomain: number;
  noAddress: number;
}

const errorOf = (res: Reply) => (res.json() as { error: { code: string; message: string; details?: { reason?: string } } }).error;

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a campaign to a table's people [${dialect}]`, () => {
    let s: WholeServer;
    let contacts = '';
    let piiRole = '';
    let campaignNo = 0;
    const yes = dialect === 'postgres' ? 'true' : '1';
    const audience = (over: Record<string, unknown> = {}) => ({ kind: 'table', connectionId: s.connectionId, table: contacts, purpose: 'newsletter', ...over });
    const person = (key: number) => ({ connectionId: s.connectionId, table: contacts, key: String(key) });
    /** A campaign of its own for each send (a campaign sends one run at a time). */
    const campaign = async (subject = 'Hello {{first_name}} from {{city}}') => {
      campaignNo += 1;
      return (await emailTemplatesRepo(s.meta).create({ kind: 'campaign', key: `july-news-${String(campaignNo)}`, locale: 'en_US', name: 'July news', subject, blocks: [{ id: 'b1', block: 'email.text', data: { paras: ['Dear {{name}}'] } }, { id: 'b2', block: 'email.button', data: { label: 'Read on', url: 'https://meridian.example/news' } }] })).id;
    };
    const preview = (who: string, templateId: string, body: Record<string, unknown>) => s.send(who, 'POST', `/api/v1/email-templates/${templateId}/audience/preview`, body);
    const breakdown = async (who: string, over: Record<string, unknown> = {}) => {
      const res = await preview(who, await campaign(), { audience: audience(over) });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as { breakdown: Breakdown }).breakdown;
    };
    const sendRun = async (who: string, body: Record<string, unknown>, subject?: string) => s.send(who, 'POST', `/api/v1/email-templates/${await campaign(subject)}/send`, body);
    const ledger = async (runId: string) =>
      (await s.meta.db.selectFrom('adminium_email_sends').select(['address', 'name', 'language', 'personKey', 'state', 'reason']).where('runId', '=', runId).orderBy('seq', 'asc').execute()).map((row) => ({ ...row }));
    const views = async (name: string, config: unknown, userId: string | null) => {
      const page = (await pagesRepo(s.meta).listForConnection(s.connectionId)).find((one) => {
        const source = pageSourceTable(one.config);
        return source === contacts || source === 'crm_contacts' || source?.endsWith('.crm_contacts') === true;
      })!;
      return (await viewsRepo(s.meta).create({ pageId: page.id, userId, kind: 'filters', name, config })).id;
    };

    beforeAll(async () => {
      const dns = new Map<string, string[]>();
      const lookup = createTxtLookup({ cacheMs: 0, resolve: async (name) => (dns.get(name) ?? []).map((record) => [record]) });
      s = await wholeServer(dialect, crm(), {
        people: { mia: ['marketer'], max: ['masked'], nora: [], rita: ['reader'], hal: ['filterless'], ida: ['blindmail'], lou: ['masked'] },
        smtp: true,
        files: { 'seeds/crm.sample.json': JSON.stringify(SAMPLE) },
        compose: { marketingSeams: { lookup, postalAddress: async () => POSTAL } },
      });
      contacts = s.t('contacts');
      // Everyone here may send campaigns (the e-mail screens' grant); lou also sees the contacts' addresses, by a role of their own.
      const roles = rolesRepo(s.meta);
      const campaigns = await roles.create({ slug: 'campaigns', name: 'Campaigns' });
      await permissionsRepo(s.meta).grant(campaigns.id, 'system', 'settings.manage', { allowed: true });
      for (const who of ['mia', 'max', 'nora', 'rita', 'hal', 'ida', 'lou']) await roles.assignToUser(s.ids[who]!, campaigns.id);
      const pii = await roles.create({ slug: 'contacts-pii', name: 'Contacts in clear' });
      await permissionsRepo(s.meta).grant(pii.id, 'table', `${s.connectionId}/${contacts}`, { read: true, read_pii: true, create: false, update: false, delete: false, export: false, import: false });
      await roles.assignToUser(s.ids['lou']!, pii.id);
      piiRole = pii.id;

      // The sender is ready: a public address, a postal address, DMARC and Adminium's key at the From's domain.
      await settingsRepo(s.meta).set('system.publicOrigin', ORIGIN, { updatedBy: null });
      await settingsRepo(s.meta).set('system.instanceId', 'install-1', { updatedBy: null });
      await settingsRepo(s.meta).set('branding.appName', 'Meridian', { updatedBy: null });
      await settingsRepo(s.meta).set('email.smtp', { ...(await settingsRepo(s.meta).get('email.smtp'))!, from: 'Meridian <news@meridian.example>' }, { updatedBy: null });
      const key = await createDkimKeys({ meta: s.meta, secret: TEST_SECRET }).make('meridian.example');
      dns.set('_dmarc.meridian.example', ['v=DMARC1; p=quarantine']);
      dns.set(key.record.name, [key.record.value]);

      const rows: [number, string, string | null, { yes?: boolean; won?: number; marked?: boolean; lang?: string; city?: string }][] = [
        [1, 'Ana Agreed', 'ana@harbour.dev', { lang: 'de', city: 'Leeds' }],
        [2, 'Sam Stopped', 'sam@harbour.dev', {}],
        [3, 'Una Unasked', 'una@harbour.dev', {}],
        [4, 'Rex Review', 'rex@harbour.dev', { yes: true }],
        [5, 'Cal Customer', 'cal@harbour.dev', { won: 3, marked: true, city: 'Leeds' }],
        [6, 'Nik Notmarked', 'nik@harbour.dev', { won: 2 }],
        [7, 'Res Reserved', 'res@crm.example', {}],
        [8, 'Nul Noaddress', null, {}],
        [9, 'Neg Saidno', 'neg@harbour.dev', { won: 1, marked: true }],
        [10, 'Rae Review', 'rae@harbour.dev', { yes: true }],
        [11, 'Rio Reserved', 'rio@crm.example', { yes: true }],
        [12, 'Stu Stopped', 'stu@harbour.dev', { yes: true }],
      ];
      for (const [key, name, email, more] of rows) {
        const values = [
          String(key),
          `'${name}'`,
          email === null ? 'NULL' : `'${email}'`,
          more.yes === true ? yes : dialect === 'postgres' ? 'false' : '0',
          String(more.won ?? 0),
          more.marked === true ? "'2025-03-01 10:00:00'" : 'NULL',
          more.lang === undefined ? 'NULL' : `'${more.lang}'`,
          `'${more.city ?? 'York'}'`,
        ];
        await s.rows(`INSERT INTO crm_contacts (id, name, email, may_email, won_deals, opt_out_offered_at, lang, city) VALUES (${values.join(', ')})`);
      }
      if (dialect === 'postgres') await s.rows(`select setval(pg_get_serial_sequence('crm_contacts', 'id'), 5000)`);
      await s.rows(`INSERT INTO crm_guests (id, name, email) VALUES (1, 'Gus Guest', 'gus@harbour.dev')`);
      expect(said(await s.send('owner', 'POST', '/api/v1/apps/crm/sample-data', {}))).toBe('ok');
      await s.jobs();

      const log = createConsentService({ meta: s.meta, secret: TEST_SECRET });
      for (const key of [1, 2, 7]) await log.record({ person: person(key), purpose: 'newsletter', source: 'import', state: 'yes' });
      await log.record({ person: person(9), purpose: 'newsletter', source: 'import', state: 'no' });
      await log.stop.add({ address: 'sam@harbour.dev', reason: 'link' });
      await log.stop.add({ address: 'stu@harbour.dev', reason: 'link' });
      await s.emails();
    }, 240_000);
    afterAll(async () => {
      await s?.close();
    });

    it('lists the tables a sender reads, says when their addresses are masked, and offers existing customers only where the app declares the mark', async () => {
      const listed = async (who: string) => {
        const res = await s.get(who, '/api/v1/email-audience/tables');
        expect(res.statusCode, res.body).toBe(200);
        return (res.json() as { tables: { table: string; appName: string; label: string; addresses: string; consentPurpose: string | null; existingCustomers: { offered: boolean; on: boolean } }[] }).tables;
      };
      const mine = await listed('mia');
      expect(mine.map((one) => [one.table, one.appName, one.addresses, one.consentPurpose, one.existingCustomers.offered, one.existingCustomers.on]).sort()).toEqual(
        [
          [contacts, 'Sales CRM', 'readable', 'newsletter', true, false],
          [s.t('guests'), 'Sales CRM', 'readable', null, false, false],
        ].sort(),
      );
      expect((await listed('max')).map((one) => [one.table, one.addresses])).toEqual([[contacts, 'masked']]);
      expect((await listed('ida')).map((one) => [one.table, one.addresses])).toEqual([[contacts, 'hidden']]);
      // A table they cannot read is never listed.
      expect(await listed('nora')).toEqual([]);
    });

    it('switches existing customers on only with the tick, only where they are offered, and keeps who and when', async () => {
      const put = (who: string, body: Record<string, unknown>) => s.send(who, 'PUT', '/api/v1/email-audience/existing-customers', { connectionId: s.connectionId, ...body });
      expect(said(await put('mia', { table: contacts, on: true, optOutOffered: false }))).toBe('422 VALIDATION_FAILED');
      const guests = await put('mia', { table: s.t('guests'), on: true, optOutOffered: true });
      expect(said(guests)).toBe('409 AUDIENCE_REFUSED');
      expect(errorOf(guests).details?.reason).toBe('existing-customers-off');
      // Not to a sender who sees the addresses masked.
      expect(said(await put('max', { table: contacts, on: true, optOutOffered: true }))).toBe('403 AUDIENCE_REFUSED');
      const on = await put('mia', { table: contacts, on: true, optOutOffered: true });
      expect(on.statusCode, on.body).toBe(200);
      expect((on.json() as { existingCustomers: unknown }).existingCustomers).toMatchObject({ offered: true, on: true, by: { id: s.ids['mia'], name: 'Mia' } });
      const rows = await s.meta.db.selectFrom('adminium_schema_overrides').select(['createdBy', 'status']).where('op', '=', 'table.existingCustomers').execute();
      expect(rows).toEqual([{ createdBy: s.ids['mia'], status: 'active' }]);
      const audit = await s.meta.db.selectFrom('adminium_audit_log').select(['actorId']).where('action', '=', 'email-audience.existing-customers').execute();
      expect(audit.map((one) => one.actorId)).toEqual([s.ids['mia']]);
    });

    it('refuses by name a sender who sees the addresses masked or hidden, or cannot read the table, at the dialog and at the send', async () => {
      const templateId = await campaign();
      for (const [who, status, reason] of [
        ['max', 403, 'addresses-masked'],
        ['ida', 403, 'addresses-hidden'],
        ['nora', 403, 'cannot-read'],
      ] as const) {
        const shown = await preview(who, templateId, { audience: audience() });
        expect(shown.statusCode, shown.body).toBe(status);
        expect(errorOf(shown).details?.reason).toBe(reason);
        const sent = await s.send(who, 'POST', `/api/v1/email-templates/${templateId}/send`, { audience: audience() });
        expect(sent.statusCode, sent.body).toBe(status);
        expect(errorOf(sent).details?.reason).toBe(reason);
      }
      expect(errorOf(await preview('max', templateId, { audience: audience() })).message).toMatch(/^You can't see .+'s addresses, so you can't send to it\.$/);
      expect(errorOf(await preview('nora', templateId, { audience: audience() })).message).toMatch(/^You can no longer read .+, so you can't send to it\.$/);
      expect(await emailRunsRepo(s.meta).listByTemplate(templateId)).toEqual([]);
    });

    it('refuses a view with a search term, another person\'s private view, and a view filtering by a column the sender cannot read', async () => {
      const searched = await views('Searched', { search: 'ana' }, null);
      const maxs = await views('Max only', { filters: [{ column: 'city', op: 'eq', value: 'Leeds' }] }, s.ids['max']!);
      const byDeals = await views('Big customers', { filters: [{ column: 'won_deals', op: 'gt', value: 1 }] }, null);
      const templateId = await campaign();
      for (const [who, viewId, status, reason] of [
        ['mia', searched, 422, 'view-search'],
        ['mia', maxs, 404, 'view-gone'],
        ['hal', byDeals, 403, 'view-hidden-column'],
      ] as const) {
        const res = await preview(who, templateId, { audience: audience({ viewId }) });
        expect(res.statusCode, res.body).toBe(status);
        expect(errorOf(res).details?.reason).toBe(reason);
        const sent = await s.send(who, 'POST', `/api/v1/email-templates/${templateId}/send`, { audience: audience({ viewId }) });
        expect(errorOf(sent).details?.reason).toBe(reason);
      }
      // A view stands for its own table, never another.
      const elsewhere = await preview('mia', templateId, { audience: { ...audience({ viewId: byDeals }), table: s.t('guests') } });
      expect(elsewhere.statusCode, elsewhere.body).toBe(404);
      expect(errorOf(elsewhere).details?.reason).toBe('view-gone');
      // The "Only these" list: the shared ones and the sender's own, the searched one marked, never another person's.
      const listed = await s.get('mia', `/api/v1/email-audience/views?connectionId=${s.connectionId}&table=${encodeURIComponent(contacts)}`);
      expect(listed.statusCode, listed.body).toBe(200);
      const mine = (listed.json() as { views: { id: string; refused: string | null }[] }).views;
      expect(mine.find((one) => one.id === searched)?.refused).toBe('view-search');
      expect(mine.find((one) => one.id === byDeals)?.refused).toBeNull();
      expect(mine.some((one) => one.id === maxs)).toBe(false);
      // Existing customers asked of a table that does not offer them.
      const guests = await preview('mia', templateId, { audience: { ...audience(), table: s.t('guests'), existingCustomers: true } });
      expect(errorOf(guests).details?.reason).toBe('existing-customers-off');
      // A placeholder of a column the sender's role hides is one nobody's send fills.
      const hidden = await s.send('hal', 'POST', `/api/v1/email-templates/${await campaign('Hello {{first_name}}, {{won_deals}} deals')}/send`, { audience: audience() });
      expect(said(hidden)).toBe('422 PLACEHOLDER_UNFILLED');
    });

    it('counts every row one way, existing customers only when asked for and marked, and a saved view narrows it', async () => {
      expect(await breakdown('mia', { existingCustomers: true })).toEqual({
        rows: 13,
        recipients: 2,
        consent: 1,
        existingCustomers: 1,
        doNotEmail: 2,
        notAgreed: 2,
        awaitingReview: 2,
        notMarked: 1,
        sample: 1,
        reservedDomain: 2,
        noAddress: 1,
      });
      expect(await breakdown('mia')).toEqual({ rows: 13, recipients: 1, consent: 1, existingCustomers: 0, doNotEmail: 2, notAgreed: 4, awaitingReview: 2, notMarked: 0, sample: 1, reservedDomain: 2, noAddress: 1 });
      const leeds = await views('Leeds', { filters: [{ column: 'city', op: 'eq', value: 'Leeds' }] }, s.ids['mia']!);
      expect(await breakdown('mia', { viewId: leeds, existingCustomers: true })).toMatchObject({ rows: 2, recipients: 2, consent: 1, existingCustomers: 1 });
      const shown = await preview('mia', await campaign(), { audience: audience({ viewId: leeds, existingCustomers: true }), ratePerHour: 1 });
      expect(shown.json()).toMatchObject({ total: 2, skipped: 0, unfilled: [], estimateMinutes: 120 });
      expect((shown.json() as { variables: string[] }).variables).toEqual(expect.arrayContaining(['name', 'email', 'city', 'won_deals', 'lang']));
    });

    it('sends to the view\'s people on the basis asked for, each mail in their language and filled from their row', async () => {
      const leeds = await views('Leeds again', { filters: [{ column: 'city', op: 'eq', value: 'Leeds' }] }, null);
      const res = await sendRun('mia', { audience: audience({ viewId: leeds, existingCustomers: true }), trackClicks: true });
      expect(res.statusCode, res.body).toBe(202);
      const run = (res.json() as { run: { id: string; mailClass: string; basis: string; trackClicks: boolean } }).run;
      expect(run).toMatchObject({ mailClass: 'marketing', basis: 'existing-customers', trackClicks: true });
      await s.jobs();
      expect(await ledger(run.id)).toEqual([
        { address: 'ana@harbour.dev', name: 'Ana Agreed', language: 'de_DE', personKey: '1', state: 'sent', reason: null },
        { address: 'cal@harbour.dev', name: 'Cal Customer', language: 'en_US', personKey: '5', state: 'sent', reason: null },
      ]);
      const mails = await s.emails();
      expect(mails.map((mail) => [mail.to, mail.subject]).sort()).toEqual([
        ['ana@harbour.dev', 'Hello Ana from Leeds'],
        ['cal@harbour.dev', 'Hello Cal from Leeds'],
      ]);
      expect(mails.every((mail) => mail.html.includes(POSTAL))).toBe(true);
      // Clicks counted, as its sender asked: the link goes through a signed one of this server's.
      expect(mails.every((mail) => mail.html.includes(`${ORIGIN}/m/l/`) && !mail.html.includes('href="https://meridian.example/news"'))).toBe(true);
      expect((await emailRunsRepo(s.meta).findById(run.id))?.status).toBe('sent');
    });

    it('writes the whole table into the ledger the way the breakdown counts it', async () => {
      const res = await sendRun('mia', { audience: audience({ existingCustomers: true }) });
      expect(res.statusCode, res.body).toBe(202);
      const runId = (res.json() as { run: { id: string } }).run.id;
      await s.jobs();
      const rows = await ledger(runId);
      expect(rows.map((row) => `${row.address} ${row.state} ${row.reason ?? ''}`.trim()).sort()).toEqual(
        [
          'ana@harbour.dev sent',
          'cal@harbour.dev sent',
          'sam@harbour.dev skipped-stop do-not-email',
          'stu@harbour.dev skipped-stop do-not-email',
          'una@harbour.dev skipped-consent not-agreed',
          'neg@harbour.dev skipped-consent not-agreed',
          'rex@harbour.dev skipped-consent awaiting-review',
          'rae@harbour.dev skipped-consent awaiting-review',
          'nik@harbour.dev skipped-consent not-marked',
          'sal@samplecorp.dev skipped-consent sample',
          'res@crm.example skipped-consent reserved-domain',
          'rio@crm.example skipped-consent reserved-domain',
        ].sort(),
      );
      const mails = await s.emails();
      expect(mails.map((mail) => mail.to).sort()).toEqual(['ana@harbour.dev', 'cal@harbour.dev']);
      // Not asked for, no click is counted: the link goes where it says.
      expect(mails.every((mail) => mail.html.includes('href="https://meridian.example/news"') && !mail.html.includes('/m/l/'))).toBe(true);
    });

    it('a run whose owner switches existing customers off goes on for the people who agreed, and leaves its existing customers out', async () => {
      const leeds = await views('Leeds once more', { filters: [{ column: 'city', op: 'eq', value: 'Leeds' }] }, null);
      await s.meta.db.deleteFrom('adminium_email_send_counters').execute();
      const res = await sendRun('mia', { audience: audience({ viewId: leeds, existingCustomers: true }), ratePerHour: 1 });
      expect(res.statusCode, res.body).toBe(202);
      const runId = (res.json() as { run: { id: string } }).run.id;
      await s.jobs();
      expect((await s.emails()).map((mail) => mail.to)).toEqual(['ana@harbour.dev']);
      const switchTo = (on: boolean) => s.send('mia', 'PUT', '/api/v1/email-audience/existing-customers', { connectionId: s.connectionId, table: contacts, on, optOutOffered: on });
      expect(said(await switchTo(false))).toBe('ok');
      await s.meta.db.deleteFrom('adminium_email_send_counters').execute();
      await s.jobs({ all: true });
      expect(await s.emails()).toEqual([]);
      expect((await ledger(runId)).map((row) => `${row.address} ${row.state} ${row.reason ?? ''}`.trim())).toEqual(['ana@harbour.dev sent', 'cal@harbour.dev skipped-consent not-agreed']);
      expect((await emailRunsRepo(s.meta).findById(runId))?.status).toBe('sent');
      // Asked for again while off, it is refused by name.
      expect(errorOf(await preview('mia', await campaign(), { audience: audience({ existingCustomers: true }) })).details?.reason).toBe('existing-customers-off');
      expect(said(await switchTo(true))).toBe('ok');
    });

    it('the review: Confirm and Leave out each write one log row in the reviewer\'s name, the column follows, and it asks no more', async () => {
      const review = async (who: string) => {
        const res = await s.get(who, `/api/v1/email-audience/review?connectionId=${s.connectionId}&table=${encodeURIComponent(contacts)}`);
        expect(res.statusCode, res.body).toBe(200);
        return res.json() as { purpose: string; total: number; people: { key: string; name: string; address: string }[] };
      };
      const before = await review('mia');
      // Never a sample row, a reserved domain or an address on the do-not-email list.
      expect(before).toMatchObject({ purpose: 'newsletter', total: 2 });
      expect(before.people.map((one) => [one.key, one.name, one.address])).toEqual([
        ['4', 'Rex Review', 'rex@harbour.dev'],
        ['10', 'Rae Review', 'rae@harbour.dev'],
      ]);
      const answer = (who: string, key: string, what: string) => s.send(who, 'POST', '/api/v1/email-audience/review/answer', { connectionId: s.connectionId, table: contacts, key, answer: what });
      // A reviewer who may not change the table may not answer for its people.
      expect(said(await answer('rita', '4', 'confirm'))).toBe('403 TABLE_FORBIDDEN');
      expect(said(await answer('mia', '4', 'confirm'))).toBe('ok');
      expect(said(await answer('mia', '10', 'leave-out'))).toBe('ok');
      const logOf = async (key: number) => (await consentLogRepo(s.meta).history({ person: person(key), hashes: [] }, { limit: 10 })).map((row) => [row.state, row.source, row.detail, row.staffId]);
      expect(await logOf(4)).toEqual([['yes', 'review', 'before-records', s.ids['mia']]]);
      expect(await logOf(10)).toEqual([['no', 'review', 'send-review', s.ids['mia']]]);
      // The column follows the log: still ticked for the one confirmed, and no longer for the one left out.
      const [rex] = await s.rows('select may_email from crm_contacts where id = 4');
      const [rae] = await s.rows('select may_email from crm_contacts where id = 10');
      expect(rex!['may_email'] === true || Number(rex!['may_email']) === 1).toBe(true);
      expect(rae!['may_email'] === false || Number(rae!['may_email']) === 0).toBe(true);
      // The question ends once answered.
      expect(await review('mia')).toMatchObject({ total: 0, people: [] });
      expect(said(await answer('mia', '4', 'leave-out'))).toBe('409 NOT_IN_REVIEW');
      expect(await logOf(4)).toHaveLength(1);
      expect(await breakdown('mia')).toMatchObject({ consent: 2, awaitingReview: 0, notAgreed: 5 });
    });

    it('a sender who loses the right to see the addresses mid-run is refused at the next batch', async () => {
      // One an hour, in an hour nothing else was sent in: the first batch hands one message over, the next waits.
      await s.meta.db.deleteFrom('adminium_email_send_counters').execute();
      const res = await sendRun('lou', { audience: audience(), ratePerHour: 1 });
      expect(res.statusCode, res.body).toBe(202);
      const runId = (res.json() as { run: { id: string } }).run.id;
      await s.jobs();
      expect((await s.emails()).map((mail) => mail.to)).toEqual(['ana@harbour.dev']);
      await rolesRepo(s.meta).removeFromUser(s.ids['lou']!, piiRole);
      await s.jobs({ all: true });
      const run = await emailRunsRepo(s.meta).findById(runId);
      expect(run).toMatchObject({ status: 'failed', state: 'stopped' });
      expect(run?.failures.map((one) => one.error)).toEqual(['addresses-masked']);
      expect(await s.emails()).toEqual([]);
      expect((await ledger(runId)).filter((row) => row.state === 'queued').map((row) => row.address)).toEqual(['rex@harbour.dev']);
      await rolesRepo(s.meta).assignToUser(s.ids['lou']!, piiRole);
    });

    it('a sender who loses it before the run starts is refused at its first batch, and nobody is written down', async () => {
      const res = await sendRun('lou', { audience: audience() });
      expect(res.statusCode, res.body).toBe(202);
      const runId = (res.json() as { run: { id: string } }).run.id;
      await rolesRepo(s.meta).removeFromUser(s.ids['lou']!, piiRole);
      await s.jobs();
      const run = await emailRunsRepo(s.meta).findById(runId);
      expect(run).toMatchObject({ status: 'failed', total: 0 });
      expect(run?.failures.map((one) => one.error)).toEqual(['addresses-masked']);
      expect(await ledger(runId)).toEqual([]);
      expect(await s.emails()).toEqual([]);
    });
  });
}
