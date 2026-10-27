// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A PERSON'S DATA BY ADDRESS, against the whole server on SQLite, Postgres
 * and MySQL, through a CRM-shaped app installed by the real installer: its
 * contacts and enquiries are people, a quote keeps a copy of its recipient's
 * address and name (and is a contract the law keeps), an invoice points at
 * its contact (kept for tax), and the app has an outbox.
 *
 *  - Found by an address typed in another case: the contact, the enquiry,
 *    the quote's copies (by the address, and by the link to the contact),
 *    the outbox's mail, the consent rows and the do-not-email entry, and the
 *    sent invoice and its payment Adminium keeps. Nobody else is found.
 *  - Only under the privacy action: a rep, the built-in Admin, and an Admin
 *    role an older server built holding every other key are refused; the
 *    Super Admin and a role given the action may.
 *  - "Download everything": one JSON and one CSV per source, nothing of
 *    another person, for the person who asked alone; the audit log holds the
 *    counts and a keyed hash, never the address or the name.
 *  - "What stays" lists the sent invoice and its payment with their reasons.
 *  - The privacy notice's address is https only; a page a stranger sees reads
 *    the business name and the address without signing in.
 */
import { SYSTEM_ACTION_KEYS, filesRepo, keptPaymentsRepo, newId, packJson, permissionsRepo, privacyExportsRepo, rolesRepo } from '@adminium/meta';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createConsentService } from '../src/consent/index.js';
import type { FileStore } from '../src/files/store.js';
import { sweepPrivacyExports } from '../src/privacy/export.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, said, wholeServer, type Reply, type WholeServer } from './whole-server.helpers.js';

// The people word and the kept-by-law mark are read from the release to come.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.37' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });
const fk = (ref: string, references: string) => ({ ref, type: 'fk', references, nullable: true });

const MARTA = 'marta.kovac@cobaltlegal.example';
const TYPED = '  Marta.KOVAC@CobaltLegal.example ';

function crm(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'Sales CRM',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.crm.desc', fallback: 'A CRM.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.37', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'sales', label: { 'en-US': 'Sales' }, order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'companies', keyField: 'name', columns: [id, text('name', 80)] },
        { ref: 'contacts', keyField: 'name', columns: [id, text('name', 80), text('email', 254, { rules: { personal: true } }), fk('company_id', 'companies')] },
        { ref: 'enquiries', keyField: 'name', columns: [id, text('name', 80), text('email', 254, { rules: { personal: true } }), text('message', 400)] },
        { ref: 'quotes', keyField: 'number', keep: { law: 'contract' }, columns: [id, text('number', 20), text('to_email', 254), text('to_name', 80), fk('sent_to_contact_id', 'contacts'), { ref: 'total', type: 'int', nullable: true }] },
        { ref: 'invoices', keyField: 'number', keep: { law: 'tax' }, columns: [id, text('number', 20), fk('contact_id', 'contacts'), { ref: 'amount', type: 'int', nullable: true }] },
        {
          ref: 'messages',
          columns: [
            id,
            { ref: 'kind', type: 'enum', enum: ['quote-sent'] },
            { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
            text('to_address', 254),
            fk('contact_id', 'contacts'),
            fk('quote_id', 'quotes'),
            text('error', 200),
            { ref: 'sent_at', type: 'timestamptz', nullable: true },
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
        company: 'company_id',
        copies: [
          { table: 'quotes', column: 'to_email', holds: 'email', via: 'sent_to_contact_id' },
          { table: 'quotes', column: 'to_name', holds: 'name', via: 'sent_to_contact_id' },
        ],
      },
      { table: 'companies', kind: 'companies', name: 'name' },
      { table: 'enquiries', kind: 'people', email: 'email', name: 'name' },
    ],
    roles: [{ key: 'rep', name: 'Rep', permissions: ['table:@contacts:read', 'table:@contacts:read_pii', 'page:@crm-contacts:view'] }],
    pages: [{ ref: 'crm-contacts', template: 'page-crud', title: { key: 't.contacts', fallback: 'Contacts' }, nav: { group: 'sales', icon: 'list', order: 1 }, bindings: { rows: 'contacts' } }],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at' },
      links: { quote: 'quote_id' },
      recipient: { via: 'contact_id', table: 'contacts', email: 'email', name: 'name' },
      kinds: { 'quote-sent': 'crm-quote-sent' },
      classes: { 'quote-sent': 'service' },
      producers: [{ kind: 'quote-sent', link: 'quote_id', onCreate: { table: 'quotes' } }],
    },
    emailTemplates: [{ key: 'crm-quote-sent', name: 'Quote sent', locales: { 'en-US': { subject: 'Your quote {{quote.number}}', blocks: [{ block: 'email.text', data: { text: 'Hello {{recipient.name}}.' } }] } } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

interface FoundView {
  address: string;
  found: boolean;
  person: { name: string | null; company: string | null } | null;
  sources: { id: string; kind: string; group: string; table: string | null; keptByLaw: string | null; count: number; keys: string[] }[];
}

const dataOf = <T>(res: Reply): T => (res.json() as { data: T }).data;

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a person's data by address, on ${dialect}`, () => {
    let s: WholeServer;
    let invoiceDoc = '';
    let invoicePayment = '';
    const find = (who: string, address = TYPED) => s.send(who, 'POST', '/api/v1/privacy/find', { address });

    beforeAll(async () => {
      s = await wholeServer(dialect, crm(), { people: { rita: ['rep'], ann: [], olda: [], pia: [], pat: [] }, smtp: true });
      const roles = rolesRepo(s.meta);
      const grants = permissionsRepo(s.meta);
      // Ann holds the built-in Admin role, as an install seeds it.
      await roles.assignToUser(s.ids['ann']!, (await roles.findBySlug('admin'))!.id);
      // Olda's Admin role was built by an older server: every system key it knew, every table, and nothing new.
      const old = await roles.create({ slug: 'old-admin', name: 'Admin (older)' });
      for (const key of SYSTEM_ACTION_KEYS.filter((one) => one !== 'privacy.manage')) await grants.grant(old.id, 'system', key, { allowed: true });
      await grants.grant(old.id, 'table', '*/*', { read: true, read_pii: true, create: true, update: true, delete: true, export: true, import: true });
      await roles.assignToUser(s.ids['olda']!, old.id);
      // Pia and Pat answer access requests: the privacy action alone.
      const officer = await roles.create({ slug: 'privacy-officer', name: 'Privacy officer' });
      await grants.grant(officer.id, 'system', 'privacy.manage', { allowed: true });
      await roles.assignToUser(s.ids['pia']!, officer.id);
      await roles.assignToUser(s.ids['pat']!, officer.id);

      await s.rows(`INSERT INTO crm_companies (id, name) VALUES (1, 'Cobalt Legal'), (2, 'Other Ltd')`);
      await s.rows(`INSERT INTO crm_contacts (id, name, email, company_id) VALUES (1, 'Marta Kovac', '${MARTA}', 1), (2, 'Ben Other', 'ben@other.example', 2), (3, 'Xavier Near', 'x${MARTA}', 2)`);
      await s.rows(`INSERT INTO crm_enquiries (id, name, email, message) VALUES (1, 'Marta K', ' Marta.Kovac@CobaltLegal.example ', 'Showroom visit'), (2, 'Ben Other', 'ben@other.example', 'Desks')`);
      // Quote 1 carries her address in capitals, quote 3 only her name and the link to her; quote 2 is Ben's.
      await s.rows(
        `INSERT INTO crm_quotes (id, number, to_email, to_name, sent_to_contact_id, total) VALUES (1, 'Q-1', '${MARTA.toUpperCase()}', 'Marta Kovac', 1, 1200), (2, 'Q-2', 'ben@other.example', 'Ben Other', 2, 800), (3, 'Q-3', NULL, 'Marta Kovac', 1, 300)`,
      );
      await s.rows(`INSERT INTO crm_invoices (id, number, contact_id, amount) VALUES (1, 'INV-1', 1, 1200), (2, 'INV-2', 2, 800)`);
      await s.rows(`INSERT INTO crm_messages (id, kind, status, to_address, contact_id, quote_id) VALUES (1, 'quote-sent', 'sent', '${MARTA}', 1, 1), (2, 'quote-sent', 'sent', 'ben@other.example', 2, 2)`);

      // Her consent: a sign-up by address, a staff member's yes on her row; Ben's own; she is on the do-not-email list.
      const consent = createConsentService({ meta: s.meta, secret: TEST_SECRET });
      await consent.record({ address: MARTA, purpose: 'newsletter', state: 'yes', source: 'form', detail: 'Showroom form', ip: '81.2.69.160', userAgent: 'Firefox' });
      await consent.record({ person: { connectionId: s.connectionId, table: s.t('contacts'), key: '1' }, purpose: 'surveys', state: 'yes', source: 'staff', staff: { id: s.ids['owner']!, label: 'Owner' }, how: 'phone' });
      await consent.record({ address: 'ben@other.example', person: { connectionId: s.connectionId, table: s.t('contacts'), key: '2' }, purpose: 'newsletter', state: 'yes', source: 'form' });
      await consent.stop.add({ address: MARTA, reason: 'link' });

      // The invoice she was sent, as Adminium rendered it, and the payment it keeps for it; and Ben's.
      const doc = (rowKey: string) => ({
        id: newId('doc'), profileId: null, addOnKey: 'invoices', kind: 'invoice', connectionId: s.connectionId, entity: null, entityTable: s.t('invoices'), entityId: rowKey,
        subject: packJson({ fields: { number: `INV-${rowKey}` } }), number: `INV-${rowKey}`, fileId: null, htmlFileId: null, locale: 'en-US', format: 'pdf', status: 'rendered', error: null, delivery: 'sent', sentAt: 5,
        jobId: null, requestedBy: null, actorKind: 'system', claim: null, renderedAt: 5, voidedAt: null, voidReason: null, createdAt: 5, reuseKey: null,
      });
      const hers = doc('1');
      await s.meta.db.insertInto('adminium_documents').values([hers, doc('2')]).execute();
      invoiceDoc = hers.id;
      const pay = (rowKey: string) => keptPaymentsRepo(s.meta).insert({ payable: { kind: 'shape', connectionId: s.connectionId, tableName: s.t('invoices'), rowKey }, number: `INV-${rowKey}`, amount: '1200.00', currency: 'GBP', method: 'card', methodNote: null, provider: 'demo', mode: 'live', attemptId: null, approvalCode: null, cardLast4: '4242', note: null, paidOn: 10, recordedBy: 'system', recordedByUser: null });
      invoicePayment = (await pay('1'))!.id;
      await pay('2');
    }, 240_000);
    afterAll(async () => {
      await s?.close();
    });

    it('finds her by an address typed in another case, in every source, and nobody else', async () => {
      const res = await find('owner');
      expect(res.statusCode, res.body).toBe(200);
      const found = dataOf<FoundView>(res);
      expect(found).toMatchObject({ address: MARTA, found: true, person: { name: 'Marta Kovac', company: 'Cobalt Legal' } });
      const by = Object.fromEntries(found.sources.map((one) => [one.id, one]));
      expect(Object.keys(by).sort()).toEqual(['consent', 'copy-crm-contacts-quotes', 'documents', 'outbox-crm', 'payments', 'people-crm-contacts', 'people-crm-enquiries', 'stop-list'].sort());
      expect(by['people-crm-contacts']).toMatchObject({ kind: 'people', group: 'gave', table: s.t('contacts'), keys: ['1'], count: 1, keptByLaw: null });
      expect(by['people-crm-enquiries']).toMatchObject({ kind: 'people', keys: ['1'] });
      // The quote with her address in capitals, and the one that holds only her name and its link to her.
      expect(by['copy-crm-contacts-quotes']).toMatchObject({ kind: 'copy', table: s.t('quotes'), keptByLaw: 'contract', count: 2 });
      expect([...by['copy-crm-contacts-quotes']!.keys].sort()).toEqual(['1', '3']);
      expect(by['outbox-crm']).toMatchObject({ kind: 'outbox', group: 'held', keys: ['1'] });
      expect(by['consent']).toMatchObject({ kind: 'consent', group: 'agreed', count: 2 });
      expect(by['stop-list']).toMatchObject({ kind: 'stop-list', count: 1 });
      expect(by['documents']!.keys).toEqual([invoiceDoc]);
      expect(by['payments']!.keys).toEqual([invoicePayment]);
    });

    it('answers nothing found for an address nobody has, and refuses what is no address', async () => {
      const none = await find('owner', 'tomas.reidy@nordwind.example');
      expect(dataOf<FoundView>(none)).toEqual({ address: 'tomas.reidy@nordwind.example', found: false, person: null, sources: [] });
      expect(said(await find('owner', 'not an address'))).toBe('422 VALIDATION_FAILED');
    });

    it('refuses without the privacy action, even an Admin role an older server built, and lets the action through', async () => {
      for (const who of ['rita', 'ann', 'olda']) {
        expect(said(await find(who)), who).toBe('403 FORBIDDEN');
        expect(said(await s.send(who, 'POST', '/api/v1/privacy/exports', { address: TYPED })), who).toBe('403 FORBIDDEN');
        expect(said(await s.send(who, 'POST', '/api/v1/privacy/what-stays', { address: TYPED })), who).toBe('403 FORBIDDEN');
        expect(said(await s.get(who, '/api/v1/privacy/notice')), who).toBe('403 FORBIDDEN');
        expect(said(await s.send(who, 'PUT', '/api/v1/privacy/notice', { businessName: 'X', noticeUrl: null })), who).toBe('403 FORBIDDEN');
      }
      // The built-in Admin is not seeded with it.
      const admin = (await rolesRepo(s.meta).findBySlug('admin'))!;
      expect((await permissionsRepo(s.meta).listForRole(admin.id)).some((row) => row.resourceKind === 'system' && row.resourceRef === 'privacy.manage')).toBe(false);
      expect(said(await find('pia'))).toBe('ok');
    });

    it('downloads everything as one JSON and one CSV per source, nothing of anybody else, for the person who asked alone', async () => {
      const asked = await s.send('pia', 'POST', '/api/v1/privacy/exports', { address: TYPED });
      expect(asked.statusCode, asked.body).toBe(202);
      const exportId = dataOf<{ id: string; status: string }>(asked).id;
      expect(dataOf<{ status: string }>(asked).status).toBe('processing');
      await s.jobs();
      const ready = await s.get('pia', `/api/v1/privacy/exports/${exportId}`);
      expect(dataOf<{ status: string; counts: Record<string, number> }>(ready)).toMatchObject({ status: 'ready', counts: { 'people-crm-contacts': 1, 'copy-crm-contacts-quotes': 2, consent: 2 } });

      // Somebody else with the same action may not see it or take it.
      expect(said(await s.get('pat', `/api/v1/privacy/exports/${exportId}`))).toBe('404 NOT_FOUND');
      expect(said(await s.get('pat', `/api/v1/privacy/exports/${exportId}/download`))).toBe('404 NOT_FOUND');
      expect(said(await s.get('owner', `/api/v1/privacy/exports/${exportId}/download`))).toBe('404 NOT_FOUND');
      expect(dataOf<unknown[]>(await s.get('pat', '/api/v1/privacy/exports'))).toEqual([]);

      const file = await s.get('pia', `/api/v1/privacy/exports/${exportId}/download`);
      expect(file.statusCode).toBe(200);
      expect(file.headers['content-type']).toBe('application/zip');
      const zip = unzipSync(new Uint8Array(file.rawPayload));
      const sources = ['consent', 'copy-crm-contacts-quotes', 'documents', 'outbox-crm', 'payments', 'people-crm-contacts', 'people-crm-enquiries', 'stop-list'];
      expect(Object.keys(zip).sort()).toEqual(sources.flatMap((one) => [`${one}.csv`, `${one}.json`]).sort());
      const contacts = JSON.parse(strFromU8(zip['people-crm-contacts.json']!)) as Record<string, unknown>[];
      expect(contacts).toEqual([expect.objectContaining({ id: 1, name: 'Marta Kovac', email: MARTA })]);
      // A copy carries what holds her, not the rest of the business's quote.
      const quotes = JSON.parse(strFromU8(zip['copy-crm-contacts-quotes.json']!)) as Record<string, unknown>[];
      expect(quotes.map((row) => Object.keys(row).sort())).toEqual([['id', 'sent_to_contact_id', 'to_email', 'to_name'], ['id', 'sent_to_contact_id', 'to_email', 'to_name']]);
      expect(strFromU8(zip['consent.csv']!)).toContain('Showroom form');
      const everything = Object.values(zip).map((bytes) => strFromU8(bytes)).join('\n').toLowerCase();
      for (const other of ['ben@other.example', 'ben other', `x${MARTA}`, 'xavier', 'other ltd', 'inv-2', 'q-2']) expect(everything, other).not.toContain(other);

      // The audit log has the counts and a keyed hash, never her address or her name.
      const audit = await s.meta.db.selectFrom('adminium_audit_log').select(['action', 'changes']).where('action', 'like', 'privacy.%').execute();
      expect(audit.map((row) => row.action).sort()).toEqual(expect.arrayContaining(['privacy.export.complete', 'privacy.export.download', 'privacy.export.request', 'privacy.find']));
      const logged = JSON.stringify(audit.map((row) => ({ action: row.action, changes: typeof row.changes === 'string' ? (JSON.parse(row.changes) as unknown) : row.changes }))).toLowerCase();
      expect(logged).not.toContain('marta');
      expect(logged).not.toContain('kovac');
      expect(logged).toMatch(/"hash":"[0-9a-f]{64}"/);
    });

    it('writes nothing for a person who lost the action before the job ran, and deletes a download whose time is up', async () => {
      const asked = await s.send('pat', 'POST', '/api/v1/privacy/exports', { address: TYPED });
      expect(asked.statusCode, asked.body).toBe(202);
      const officer = (await rolesRepo(s.meta).findBySlug('privacy-officer'))!;
      await rolesRepo(s.meta).removeFromUser(s.ids['pat']!, officer.id);
      await s.jobs();
      const row = await privacyExportsRepo(s.meta).findById(dataOf<{ id: string }>(asked).id);
      expect(row).toMatchObject({ status: 'failed', error: 'not-allowed', fileId: null });

      const mine = dataOf<{ id: string; status: string }[]>(await s.get('pia', '/api/v1/privacy/exports'));
      const ready = mine.find((one) => one.status === 'ready')!;
      const fileId = (await privacyExportsRepo(s.meta).findById(ready.id))!.fileId!;
      await s.meta.db.updateTable('adminium_privacy_exports').set({ expiresAt: 1 }).where('id', '=', ready.id).execute();
      expect(said(await s.get('pia', `/api/v1/privacy/exports/${ready.id}/download`))).toBe('410 EXPORT_EXPIRED');
      // The bytes go through the file's own store; here the store only notes what it was asked to remove.
      const removed: string[] = [];
      const store = { remove: async (file: { storageKey: string }) => void removed.push(file.storageKey) } as unknown as FileStore;
      expect(await sweepPrivacyExports(s.meta, store)).toBe(1);
      expect(removed).toHaveLength(1);
      expect(await privacyExportsRepo(s.meta).findById(ready.id)).toMatchObject({ status: 'expired', fileId: null });
      expect(await filesRepo(s.meta).findById(fileId)).toBeNull();
    });

    it('lists what stays: the sent invoice and its payment, with their reasons', async () => {
      const res = await s.send('pia', 'POST', '/api/v1/privacy/what-stays', { address: TYPED });
      expect(res.statusCode, res.body).toBe(200);
      const { items } = dataOf<{ items: { kind: string; reason: string; count: number | null; table?: string; forever: boolean; keptDays: number | null }[] }>(res);
      expect(items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'documents', reason: 'issued-document', count: 1, forever: true }),
          expect.objectContaining({ kind: 'payments', reason: 'payment-records', count: 1, forever: true }),
          expect.objectContaining({ kind: 'app-rows', reason: 'tax', table: s.t('invoices'), count: 1 }),
          expect.objectContaining({ kind: 'app-rows', reason: 'contract', table: s.t('quotes'), count: 2 }),
          expect.objectContaining({ kind: 'exports', reason: 'kept-a-while', count: null, keptDays: 30 }),
          expect.objectContaining({ kind: 'do-not-email', reason: 'objection', forever: true }),
        ]),
      );
      const keeping = await s.get('pia', '/api/v1/privacy/keeping');
      expect(dataOf(keeping)).toEqual({ rows: [{ key: 'consent-history', fixed: true, keptFor: 'forever', options: [] }, { key: 'do-not-email', fixed: true, keptFor: 'forever', options: [] }] });
    });

    it('keeps the privacy notice: https only, read without signing in by the pages strangers see', async () => {
      const refused = await s.send('pia', 'PUT', '/api/v1/privacy/notice', { businessName: 'Meridian Workplace Ltd', noticeUrl: 'http://www.meridian.example/privacy' });
      expect(said(refused)).toBe('422 VALIDATION_FAILED');
      expect(said(await s.send('pia', 'PUT', '/api/v1/privacy/notice', { businessName: 'Meridian Workplace Ltd', noticeUrl: 'javascript:alert(1)' }))).toBe('422 VALIDATION_FAILED');
      const saved = await s.send('pia', 'PUT', '/api/v1/privacy/notice', { businessName: '  Meridian Workplace Ltd ', noticeUrl: 'https://www.meridian.example/privacy' });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(dataOf(saved)).toEqual({ businessName: 'Meridian Workplace Ltd', noticeUrl: 'https://www.meridian.example/privacy', ready: true, shownName: 'Meridian Workplace Ltd' });
      const open = await s.app.inject({ method: 'GET', url: '/api/v1/privacy/notice/public' });
      expect(open.statusCode).toBe(200);
      expect(dataOf(open)).toEqual({ businessName: 'Meridian Workplace Ltd', noticeUrl: 'https://www.meridian.example/privacy' });
      const cleared = await s.send('pia', 'PUT', '/api/v1/privacy/notice', { businessName: '', noticeUrl: null });
      expect(dataOf<{ ready: boolean }>(cleared).ready).toBe(false);

      // The postal address rides the marketing mail settings' grant.
      expect(said(await s.send('pia', 'PUT', '/api/v1/privacy/postal-address', { postalAddress: 'x' }))).toBe('403 FORBIDDEN');
      const postal = await s.send('owner', 'PUT', '/api/v1/privacy/postal-address', { postalAddress: ' 4 Wharf Lane, Leeds LS1 4BR ' });
      expect(dataOf(postal)).toEqual({ postalAddress: '4 Wharf Lane, Leeds LS1 4BR' });
    });
  });
}
