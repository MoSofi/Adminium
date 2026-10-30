// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ERASING A PERSON IN PLACE, against the whole server on SQLite, Postgres
 * and MySQL, through a CRM-shaped app installed by the real installer: a
 * contact with a deal, a quote that was sent (and is locked), a signed
 * sign-off, showroom visits whose removed rows are kept, an invoice the law
 * keeps, mail in the app's outbox, a campaign send, consent rows and a file.
 *
 *  - Only under the privacy action, by a signed-in person: a rep, the
 *    built-in Admin, an Admin role an older server built, and an API key
 *    given the action are refused; a privacy officer with no table grant at
 *    all erases every row (no role reach stands in the way).
 *  - The preview counts what goes and lists what stays; the erasure is
 *    confirmed by the address typed again.
 *  - Every link to the contact stays whole: the deal and the contact still
 *    open. The person's copies on the sent quote are blanked and nothing else
 *    on it changes (its state, total, sent time, and a copy that follows the
 *    contact). The sign-off keeps its signing. The invoice is untouched.
 *  - A NOT NULL name reads "Erased person"; a unique address that may not be
 *    empty gets a value of its own, never shared by two erased people.
 *  - No rule fires (a rule on a contact's change notifies and mails).
 *  - No name or address of theirs is left in the audit log or the removed-row
 *    history; the entries stay. Their own public write loses where it came
 *    from. Another person's entries are untouched.
 *  - A campaign run's failure list loses her entries, and a send's reason or
 *    a mail job's last error that names her is emptied.
 *  - The address is still stopped, by a hash with no display address; the
 *    erasure's own audit entry holds counts and the keyed hash alone.
 *  - A link in mail sent before the erasure only ever says "you're
 *    unsubscribed", and neither shows nor logs the address.
 */
import { Writable } from 'node:stream';

import { SYSTEM_ACTION_KEYS, apiKeysRepo, auditRepo, consentLogRepo, emailRunsRepo, emailSendsRepo, emailTemplatesRepo, filesRepo, jobsRepo, permissionsRepo, privacyExportsRepo, rolesRepo, settingsRepo } from '@adminium/meta';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { encryptSecret } from '../src/config/secrets.js';
import { createConsentService } from '../src/consent/index.js';
import { emailEnvelopeKey } from '../src/email/send.js';
import type { RecordWriteEvent } from '../src/crud/after-record-write.js';
import { mailLinkKeys } from '../src/email/link-keys.js';
import { makeUnsubscribeToken } from '../src/email/unsubscribe-token.js';
import type { FileStore } from '../src/files/store.js';
import { erasePerson } from '../src/privacy/erase.js';
import { generateApiKey } from '../src/rbac/api-keys.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, said, wholeServer, type Reply, type WholeServer } from './whole-server.helpers.js';

// The people word and the kept-by-law mark are read from the release to come.
vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.38' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 80, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });
const fk = (ref: string, references: string) => ({ ref, type: 'fk', references, nullable: true });
const strict = (set: string, on: unknown) => ({ stamp: { set, on, strict: true } });
const en = (value: string) => ({ 'en-US': value });

const MARTA = 'marta.kovac@cobaltlegal.example';
const TYPED = '  Marta.KOVAC@CobaltLegal.example ';
const NINA = 'nina.berg@fjord.example';

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
    compatibility: { minAdminiumVersion: '0.3.38', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'sales', label: en('Sales'), order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'companies', keyField: 'name', columns: [id, text('name')] },
        {
          ref: 'contacts',
          keyField: 'name',
          columns: [
            id,
            // NOT NULL: an erased name reads "Erased person".
            { ref: 'name', type: 'text', maxLength: 80 },
            text('email', 254, { unique: true, rules: { personal: true } }),
            text('phone', 40, { rules: { personal: true } }),
            text('job_title', 80, { rules: { personal: true } }),
            // The business's own reference: not theirs, so it stays.
            text('reference', 20, { unique: true, rules: { personal: false } }),
            fk('company_id', 'companies'),
            { ref: 'may_email', type: 'bool', default: false },
            { ref: 'may_email_by_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true, ...strict('user-id', { columns: ['may_email'] }) } },
            { ref: 'may_email_at', type: 'timestamptz', nullable: true, rules: strict('now', { columns: ['may_email'] }) },
            { ref: 'opt_out_offered_at', type: 'timestamptz', nullable: true, rules: strict('now', { columns: ['email', 'may_email'] }) },
          ],
        },
        // An address that may not be empty, and unique: an erased one gets a value of its own.
        { ref: 'enquiries', keyField: 'name', columns: [id, text('name'), { ref: 'email', type: 'text', maxLength: 254, unique: true, rules: { personal: true } }, text('message', 400)] },
        { ref: 'deals', keyField: 'title', columns: [id, text('title'), fk('contact_id', 'contacts'), { ref: 'amount', type: 'int', nullable: true }] },
        {
          ref: 'quotes',
          keyField: 'number',
          states: { column: 'status', initial: 'draft', moves: { draft: ['sent'] }, lock: { when: ['sent'] } },
          columns: [
            id,
            text('number', 20),
            { ref: 'status', type: 'enum', enum: ['draft', 'sent'], default: 'draft' },
            fk('sent_to_contact_id', 'contacts'),
            text('to_email', 254, { rules: { personal: true } }),
            text('to_name'),
            fk('accepted_by_id', 'contacts'),
            text('accepted_name'),
            // A copy that follows the contact, not declared but marked personal: it goes with her where nobody else is on the quote.
            text('to_phone', 40, { rules: { personal: true, copy: { via: 'sent_to_contact_id', from: 'phone', mode: 'always', follow: true } } }),
            { ref: 'total', type: 'int', nullable: true },
            { ref: 'sent_at', type: 'timestamptz', nullable: true },
          ],
        },
        { ref: 'sign_offs', columns: [id, fk('quote_id', 'quotes'), fk('contact_id', 'contacts'), text('signer_name'), { ref: 'signed_at', type: 'timestamptz', nullable: true }] },
        // A remark marked personal: their own words on a copy table go with them.
        { ref: 'visits', removal: { history: true }, columns: [id, fk('contact_id', 'contacts'), text('visitor_name'), text('day', 10), text('remark', 200, { rules: { personal: true } })] },
        // Leads, often never linked to a contact (a portal's enquiries): found by the address, or by a phone number alone.
        { ref: 'leads', columns: [id, fk('contact_id', 'contacts'), text('name'), text('email', 254), text('phone', 40), text('notes', 400, { rules: { personal: true } }), text('source', 20)] },
        { ref: 'invoices', keyField: 'number', keep: { law: 'tax' }, columns: [id, text('number', 20), fk('contact_id', 'contacts'), text('bill_to_name'), { ref: 'amount', type: 'int', nullable: true }] },
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
        consent: { column: 'may_email', purpose: 'newsletter' },
        optOutMark: 'opt_out_offered_at',
        copies: [
          { table: 'quotes', column: 'to_email', holds: 'email', via: 'sent_to_contact_id' },
          { table: 'quotes', column: 'to_name', holds: 'name', via: 'sent_to_contact_id' },
          { table: 'quotes', column: 'accepted_name', holds: 'name', via: 'accepted_by_id' },
          { table: 'sign_offs', column: 'signer_name', holds: 'name', via: 'contact_id' },
          { table: 'visits', column: 'visitor_name', holds: 'name', via: 'contact_id' },
          { table: 'invoices', column: 'bill_to_name', holds: 'name', via: 'contact_id' },
          { table: 'leads', column: 'name', holds: 'name', via: 'contact_id' },
          { table: 'leads', column: 'email', holds: 'email', via: 'contact_id' },
          { table: 'leads', column: 'phone', holds: 'phone', via: 'contact_id' },
        ],
      },
      { table: 'companies', kind: 'companies', name: 'name' },
      { table: 'enquiries', kind: 'people', email: 'email', name: 'name' },
    ],
    roles: [
      {
        key: 'rep',
        name: 'Rep',
        permissions: ['table:@contacts:read', 'table:@contacts:read_pii', 'table:@contacts:update', 'table:@deals:read', 'table:@quotes:read', 'page:@crm-contacts:view'],
      },
    ],
    automations: [
      {
        key: 'contact-changed',
        name: en('A contact changes: tell the reps'),
        enabled: true,
        trigger: { kind: 'record', event: 'updated', table: 'contacts' },
        graph: {
          version: 1,
          nodes: [
            { id: 't', kind: 'trigger', title: 'When' },
            { id: 'tell', kind: 'action', title: 'tell', action: { kind: 'notification', to: { roles: ['rep'] }, title: en('Changed: {{record.name}}') } },
          ],
        },
      },
    ],
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

const dataOf = <T>(res: Reply): T => (res.json() as { data: T }).data;
const yes = (value: unknown) => value === true || value === 1 || value === '1';
const ms = (value: unknown): number => (value instanceof Date ? value.getTime() : Date.parse(String(value).replace(' ', 'T')));
/** A stored JSON value as text, in lower case, whichever engine handed it back. */
const textOf = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value ?? null)).toLowerCase();

interface Preview {
  address: string;
  found: boolean;
  goes: { kind: string; count: number; table?: string }[];
  stays: { kind: string; reason: string; count: number | null; table?: string }[];
  left: unknown[];
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`erasing a person in place, on ${dialect}`, () => {
    let s: WholeServer;
    const lines: string[] = [];
    let token = '';
    let bearer: Record<string, string> = {};
    const before: Record<string, Record<string, unknown>> = {};
    const one = async (ref: string, key: number) => (await s.rows(`SELECT * FROM crm_${ref} WHERE id = ${String(key)}`))[0]!;
    const preview = (who: string, address = TYPED) => s.send(who, 'POST', '/api/v1/privacy/erase/preview', { address });
    const erase = (who: string, address = TYPED, confirm = address) => s.send(who, 'POST', '/api/v1/privacy/erase', { address, confirm });
    const notificationsFor = async (who: string) => (await s.meta.db.selectFrom('adminium_notifications').select('id').where('userId', '=', s.ids[who]!).execute()).length;
    const runs = async () => (await s.meta.db.selectFrom('adminium_automation_runs').select('id').execute()).length;

    beforeAll(async () => {
      const logger = pino({ level: 'trace' }, new Writable({ write: (chunk, _encoding, done) => void (lines.push(String(chunk)), done()) }));
      s = await wholeServer(dialect, crm(), { people: { rita: ['rep'], ann: [], olda: [], pia: [] }, smtp: true, compose: { logger } });
      const roles = rolesRepo(s.meta);
      const grants = permissionsRepo(s.meta);
      await roles.assignToUser(s.ids['ann']!, (await roles.findBySlug('admin'))!.id);
      // An Admin role an older server built: every system key it knew, every table, and nothing new.
      const old = await roles.create({ slug: 'old-admin', name: 'Admin (older)' });
      for (const key of SYSTEM_ACTION_KEYS.filter((one) => one !== 'privacy.manage')) await grants.grant(old.id, 'system', key, { allowed: true });
      await grants.grant(old.id, 'table', '*/*', { read: true, read_pii: true, create: true, update: true, delete: true, export: true, import: true });
      await roles.assignToUser(s.ids['olda']!, old.id);
      // Pia answers access requests: the privacy action alone, no table at all.
      const officer = await roles.create({ slug: 'privacy-officer', name: 'Privacy officer' });
      await grants.grant(officer.id, 'system', 'privacy.manage', { allowed: true });
      await roles.assignToUser(s.ids['pia']!, officer.id);
      const generated = generateApiKey();
      await apiKeysRepo(s.meta).create({ name: 'script', prefix: generated.prefix, tokenHash: generated.tokenHash, roleId: officer.id });
      bearer = { authorization: `Bearer ${generated.key}` };

      const settings = settingsRepo(s.meta);
      await settings.set('system.publicOrigin', 'https://crm.meridian.example', { updatedBy: null });
      const install = String(await settings.get('system.instanceId'));
      token = makeUnsubscribeToken(await mailLinkKeys(s.meta, TEST_SECRET).unsubscribe(), install, { address: MARTA, purpose: 'newsletter' });

      await s.rows(`INSERT INTO crm_companies (id, name) VALUES (1, 'Cobalt Legal'), (2, 'Other Ltd')`);
      const truth = dialect === 'postgres' ? 'true' : '1';
      await s.rows(
        `INSERT INTO crm_contacts (id, name, email, phone, job_title, reference, company_id, may_email, may_email_by_id, may_email_at, opt_out_offered_at) VALUES ` +
          `(1, 'Marta Kovac', '${MARTA}', '+44 20 7946 0001', 'Counsel', 'C-001', 1, ${truth}, '${s.ids['owner']!}', '2026-09-01 10:00:00', '2026-09-01 10:00:00'), ` +
          `(2, 'Ben Other', 'ben@other.example', '+44 20 7946 0002', 'Buyer', 'C-002', 2, ${truth}, NULL, NULL, NULL), ` +
          `(3, 'Xavier Near', 'x${MARTA}', NULL, NULL, 'C-003', 2, ${truth}, NULL, NULL, NULL), ` +
          `(4, 'Nina Berg', '${NINA}', NULL, NULL, 'C-004', 2, ${truth}, NULL, NULL, NULL)`,
      );
      await s.rows(`INSERT INTO crm_enquiries (id, name, email, message) VALUES (1, 'Marta K', ' Marta.Kovac@CobaltLegal.example ', 'Showroom visit'), (2, 'Ben Other', 'ben@other.example', 'Desks'), (3, 'Nina', '${NINA}', 'Chairs')`);
      await s.rows(`INSERT INTO crm_deals (id, title, contact_id, amount) VALUES (1, 'Cobalt fit-out', 1, 5000), (2, 'Other desks', 2, 900)`);
      await s.rows(
        `INSERT INTO crm_quotes (id, number, status, sent_to_contact_id, to_email, to_name, accepted_by_id, accepted_name, to_phone, total, sent_at) VALUES ` +
          `(1, 'Q-1', 'draft', 1, '${MARTA.toUpperCase()}', 'Marta Kovac', 1, 'Marta Kovac', '+44 20 7946 0001', 1100, NULL), ` +
          `(2, 'Q-2', 'sent', 2, 'ben@other.example', 'Ben Other', NULL, NULL, '+44 20 7946 0002', 800, '2026-09-02 09:00:00'), ` +
          // Sent to Ben, accepted by her: only her copy on it is hers.
          `(3, 'Q-3', 'sent', 2, 'ben@other.example', 'Ben Other', 1, 'Marta Kovac', '+44 20 7946 0002', 500, '2026-09-04 09:00:00')`,
      );
      await s.rows(`INSERT INTO crm_sign_offs (id, quote_id, contact_id, signer_name, signed_at) VALUES (1, 1, 1, 'Marta Kovac', '2026-09-05 12:00:00'), (2, 2, 2, 'Ben Other', '2026-09-05 12:00:00')`);
      await s.rows(`INSERT INTO crm_visits (id, contact_id, visitor_name, day, remark) VALUES (1, 1, 'Marta Kovac', '2026-08-01', NULL), (2, 1, 'Marta Kovac', '2026-08-15', 'Needs step-free access'), (3, 2, 'Ben Other', '2026-08-15', 'Brought samples')`);
      await s.rows(
        `INSERT INTO crm_leads (id, contact_id, name, email, phone, notes, source) VALUES ` +
          // Hers by the address, never linked to her contact.
          `(1, NULL, 'Marta K.', '${MARTA}', '+44 20 7946 0001', 'Wants ten desks', 'web'), ` +
          // Hers by her number alone, written another way: no address, no link.
          `(2, NULL, 'M. Kovac', NULL, '020 7946 0001', 'Called about chairs', 'phone'), ` +
          `(3, 2, 'Ben Other', 'ben@other.example', '+44 20 7946 0002', 'Ben wants lamps', 'web'), ` +
          // Ben's lead, given her number: only her number on it goes.
          `(4, 2, 'Ben Other', 'ben@other.example', '+44 20 7946 0001', 'Ben, call back on the office line', 'phone'), ` +
          // Somebody else's, with a number that only shares a few digits with hers.
          `(5, NULL, 'Ola Near', NULL, '+48 7946 0001', 'Near miss', 'phone')`,
      );
      await s.rows(`INSERT INTO crm_invoices (id, number, contact_id, bill_to_name, amount) VALUES (1, 'INV-1', 1, 'Marta Kovac', 1200)`);
      await s.rows(
        `INSERT INTO crm_messages (id, kind, status, to_address, contact_id, quote_id, error) VALUES ` +
          `(1, 'quote-sent', 'sent', '${MARTA}', 1, 1, NULL), (2, 'quote-sent', 'queued', '${MARTA}', 1, 1, NULL), (3, 'quote-sent', 'queued', 'ben@other.example', 2, 2, NULL)`,
      );

      // Staff history, through the real routes: an edit of hers (the audit log keeps her name in clear), the quote edited and
      // then sent, and one of her visits removed (its row is kept, with her name).
      expect(said(await s.change('owner', 'contacts', 1, { job_title: 'Senior counsel' }))).toBe('ok');
      expect(said(await s.change('owner', 'quotes', 1, { total: 1200 }))).toBe('ok');
      await s.rows(`UPDATE crm_quotes SET status = 'sent', sent_at = '2026-09-03 09:00:00' WHERE id = 1`);
      expect(said(await s.send('owner', 'DELETE', `/api/v1/data/${s.connectionId}/${s.t('visits')}/1`))).toBe('ok');
      // Her own write through a public page, as the public door audits it; and two entries naming addresses in text.
      const audit = auditRepo(s.meta);
      await audit.append({ actorKind: 'api-key', actorLabel: 'public:key_1', category: 'data', action: 'public.record.update', connectionId: s.connectionId, entity: { connectionId: s.connectionId, table: s.t('contacts'), pk: { id: 1 }, label: '1' }, changes: { after: { name: 'Marta Kovac', phone: '+44 20 7946 0001', claimed: true } }, ip: '81.2.69.160', userAgent: 'Firefox/140' });
      await audit.append({ actorKind: 'user', actorId: s.ids['owner']!, actorLabel: 'Owner', category: 'settings', action: 'note.add', changes: { after: { note: `Wrote to ${MARTA} about the visit.` } } });
      await audit.append({ actorKind: 'user', actorId: s.ids['owner']!, actorLabel: 'Owner', category: 'settings', action: 'note.add', changes: { after: { note: `Wrote to x${MARTA} about desks.` } } });

      // Her consent: a sign-up by address, a staff member's yes on her row. Nina is on the do-not-email list already.
      const consent = createConsentService({ meta: s.meta, secret: TEST_SECRET });
      await consent.record({ address: MARTA, purpose: 'newsletter', state: 'yes', source: 'form', detail: 'Showroom form', ip: '81.2.69.160', userAgent: 'Firefox' });
      await consent.record({ person: { connectionId: s.connectionId, table: s.t('contacts'), key: '1' }, purpose: 'surveys', state: 'yes', source: 'staff', staff: { id: s.ids['owner']!, label: 'Owner' }, how: 'phone' });
      await consent.record({ address: 'ben@other.example', person: { connectionId: s.connectionId, table: s.t('contacts'), key: '2' }, purpose: 'newsletter', state: 'yes', source: 'form' });
      await consent.stop.add({ address: NINA, reason: 'link' });

      // A campaign send to her, one waiting, and Ben's.
      const template = await emailTemplatesRepo(s.meta).create({ kind: 'campaign', key: 'july', locale: 'en_US', name: 'July', subject: 'July', blocks: [] });
      const run = await emailRunsRepo(s.meta).create({ templateId: template.id, audience: { kind: 'users' }, scheduledAt: 1 });
      await emailSendsRepo(s.meta).write(
        run.id,
        [
          { address: MARTA, name: 'Marta Kovac', connectionId: s.connectionId, personTable: s.t('contacts'), personKey: '1' },
          { address: 'ben@other.example', name: 'Ben Other', connectionId: s.connectionId, personTable: s.t('contacts'), personKey: '2' },
        ],
        1,
      );
      await s.meta.db.updateTable('adminium_email_sends').set({ state: 'sent', sentAt: 5 }).where('runId', '=', run.id).where('seq', '=', 1).execute();
      // The run's failure list, and the relay's words in a send's reason and a mail job's last error, name her.
      await emailRunsRepo(s.meta).noteFailure(run.id, { to: MARTA, error: `550 5.1.1 <${MARTA}>: mailbox unavailable` });
      await emailRunsRepo(s.meta).noteFailure(run.id, { to: 'ben@other.example', error: `452 4.2.2 mailbox full (forwarding to ${MARTA})` });
      await emailRunsRepo(s.meta).noteFailure(run.id, { to: 'ben@other.example', error: '452 4.2.2 mailbox full' });
      await emailRunsRepo(s.meta).noteFailure(run.id, { to: '', error: 'no-dmarc' });
      await s.meta.db.updateTable('adminium_email_sends').set({ reason: `550 5.1.1 <${MARTA}>: mailbox unavailable` }).where('runId', '=', run.id).where('seq', '=', 1).execute();
      const sealed = encryptSecret(JSON.stringify({ to: 'ben@other.example', subject: 'July', html: '<p>July</p>', text: 'July' }), emailEnvelopeKey(TEST_SECRET));
      const mailJob = await jobsRepo(s.meta).enqueue({ kind: 'email.send', payload: { v: 1, templateKey: 'july', locale: 'en_US', envelope: sealed }, runAt: Number.MAX_SAFE_INTEGER });
      await s.meta.db.updateTable('adminium_jobs').set({ status: 'failed', lastError: `550 5.1.1 <${MARTA}>: mailbox unavailable` }).where('id', '=', mailJob.id).execute();

      // A file on her contact row.
      await filesRepo(s.meta).create({ filename: 'passport.pdf', mime: 'application/pdf', sizeBytes: 1, sha256: 'a'.repeat(64), kind: 'upload', uploadedBy: s.ids['owner']!, entity: { connectionId: s.connectionId, table: s.t('contacts'), pk: { id: 1 }, label: '1' } });

      // Her data, downloaded before ("Download everything"): it goes with her.
      expect(said(await s.send('pia', 'POST', '/api/v1/privacy/exports', { address: TYPED }))).toBe('ok');

      // The rule is live: a staff change of Ben tells the reps.
      const told = await notificationsFor('rita');
      expect(said(await s.change('owner', 'contacts', 2, { job_title: 'Head buyer' }))).toBe('ok');
      await s.jobs();
      expect(await notificationsFor('rita')).toBeGreaterThan(told);
      await s.emails();

      for (const [ref, key] of [['quotes', 1], ['quotes', 2], ['quotes', 3], ['sign_offs', 1], ['invoices', 1], ['deals', 1], ['contacts', 2], ['enquiries', 2], ['visits', 3], ['leads', 2], ['leads', 3], ['leads', 4], ['leads', 5]] as const) before[`${ref}:${String(key)}`] = await one(ref, key);
    }, 240_000);
    afterAll(async () => {
      await s?.close();
    });

    it('refuses without the privacy action, and an API key even with it', async () => {
      for (const who of ['rita', 'ann', 'olda']) {
        expect(said(await preview(who)), who).toBe('403 FORBIDDEN');
        expect(said(await erase(who)), who).toBe('403 FORBIDDEN');
      }
      const keyed = await s.app.inject({ method: 'POST', url: '/api/v1/privacy/erase', headers: bearer, payload: { address: TYPED, confirm: TYPED } });
      expect(said(keyed)).toBe('403 FORBIDDEN');
      expect((await one('contacts', 1))['name']).toBe('Marta Kovac');
    });

    it('previews what goes and what stays, and refuses an erasure the address typed again does not confirm', async () => {
      const res = await preview('pia');
      expect(res.statusCode, res.body).toBe(200);
      const view = dataOf<Preview>(res);
      expect(view.found).toBe(true);
      const goes = Object.fromEntries(view.goes.map((item) => [item.table ?? item.kind, item.count]));
      expect(goes).toMatchObject({ [s.t('contacts')]: 1, [s.t('enquiries')]: 1, [s.t('quotes')]: 2, [s.t('sign_offs')]: 1, [s.t('visits')]: 1, [s.t('leads')]: 3, [s.t('messages')]: 2, consent: 2, 'campaign-mail': 1, files: 1 });
      // The invoice is the law's: it stays, and is never in "what goes".
      expect(goes[s.t('invoices')]).toBeUndefined();
      expect(view.stays).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'app-rows', reason: 'tax', table: s.t('invoices') }), expect.objectContaining({ kind: 'do-not-email', reason: 'objection' })]));
      // A campaign's failure list loses her entries: it is not among what stays.
      expect(view.stays.map((item) => item.kind)).not.toContain('campaign-failures');
      expect(view.left).toEqual([]);

      const wrong = await erase('pia', TYPED, 'marta.kovac@cobaltlegal.example.org');
      expect(said(wrong)).toBe('409 CONFLICT');
      expect(wrong.body.toLowerCase()).not.toContain('marta');
      expect((await one('contacts', 1))['name']).toBe('Marta Kovac');
    });

    it('erases her in place: every link whole, the sent quote blanked and nothing else on it, no rule fired', async () => {
      const told = await notificationsFor('rita');
      const started = await runs();
      const res = await erase('pia', TYPED, MARTA.toUpperCase());
      expect(res.statusCode, res.body).toBe(200);
      const done = dataOf<{ counts: Record<string, number>; left: unknown[]; filesFailed: number }>(res);
      expect(done.counts).toMatchObject({ 'people-crm-contacts': 1, 'people-crm-enquiries': 1, 'outbox-crm': 2, consent: 2, 'campaign-mail': 1, 'campaign-failures': 1, 'mail-errors': 2, files: 1, downloads: 1, 'stop-list': 1 });
      expect(done.filesFailed).toBe(0);

      // Her contact: the row and its links kept, her fields emptied, strict stamps included; a NOT NULL name reads "Erased person".
      const contact = await one('contacts', 1);
      expect(contact).toMatchObject({ id: 1, name: 'Erased person', email: null, phone: null, job_title: null, reference: 'C-001', company_id: 1, may_email_by_id: null, may_email_at: null, opt_out_offered_at: null });
      expect(yes(contact['may_email'])).toBe(false);
      // The unique address that may not be empty: a value of its own, on a domain nothing is ever sent to.
      const enquiry = await one('enquiries', 1);
      expect(enquiry['name']).toBeNull();
      expect(String(enquiry['email'])).toMatch(/^erased-[0-9a-f]{12}@erased\.invalid$/);
      expect(enquiry['message']).toBe('Showroom visit');

      // Every link to her stays whole: the deal and the contact still open.
      expect(await one('deals', 1)).toEqual(before['deals:1']);
      expect(said(await s.get('owner', `/api/v1/data/${s.connectionId}/${s.t('deals')}/1`))).toBe('ok');
      expect(said(await s.get('owner', `/api/v1/data/${s.connectionId}/${s.t('contacts')}/1`))).toBe('ok');

      // The sent quote: her copies blanked, and nothing else (its state, total, sent time, and the copy that follows the contact).
      const quote = await one('quotes', 1);
      // Her number, marked personal, goes too: nobody else is on this quote.
      expect(quote).toEqual({ ...before['quotes:1'], to_email: null, to_name: null, accepted_name: null, to_phone: null });
      expect(ms(quote['sent_at'])).toBe(ms(before['quotes:1']!['sent_at']));
      expect(await one('quotes', 2)).toEqual(before['quotes:2']);
      // Ben's quote she accepted: her copy goes, his stay (his number marked personal on it included).
      expect(await one('quotes', 3)).toEqual({ ...before['quotes:3'], accepted_name: null });
      // The signed sign-off keeps its signing; her name goes.
      expect(await one('sign_offs', 1)).toEqual({ ...before['sign_offs:1'], signer_name: null });
      // Her visit left; the removed one's row is kept below.
      expect(await one('visits', 2)).toMatchObject({ visitor_name: null, remark: null, day: '2026-08-15', contact_id: 1 });
      expect(await one('visits', 3)).toEqual(before['visits:3']);
      // Her leads: the one by her address loses every copy and her words; the source stays.
      expect(await one('leads', 1)).toEqual({ id: 1, contact_id: null, name: null, email: null, phone: null, notes: null, source: 'web' });
      // The one by her number alone loses the number alone: a number may be shared.
      expect(await one('leads', 2)).toEqual({ ...before['leads:2'], phone: null });
      // Ben's: his own untouched; the one given her number loses the number alone.
      expect(await one('leads', 3)).toEqual(before['leads:3']);
      expect(await one('leads', 4)).toEqual({ ...before['leads:4'], phone: null });
      expect(await one('leads', 5)).toEqual(before['leads:5']);
      // The law's invoice is untouched, her name on it included.
      expect(await one('invoices', 1)).toEqual(before['invoices:1']);
      // Ben is untouched.
      expect(await one('contacts', 2)).toEqual(before['contacts:2']);
      expect(await one('enquiries', 2)).toEqual(before['enquiries:2']);

      // Her mail: the sent one keeps being sent, the waiting one is skipped; neither holds her address.
      expect(await one('messages', 1)).toMatchObject({ status: 'sent', to_address: null, contact_id: 1 });
      expect(await one('messages', 2)).toMatchObject({ status: 'skipped', to_address: null, error: 'No email on file' });
      expect(await one('messages', 3)).toMatchObject({ status: 'queued', to_address: 'ben@other.example' });

      // No rule fired: nobody told, no run, no mail.
      await s.jobs();
      expect(await notificationsFor('rita')).toBe(told);
      expect(await runs()).toBe(started);
      expect((await s.emails()).filter((mail) => mail.to.toLowerCase().includes('marta'))).toEqual([]);
    });

    it('leaves no name or address of hers in the audit log or the removed-row history; the entries stay', async () => {
      const entries = await s.meta.db.selectFrom('adminium_audit_log').select(['id', 'action', 'changes', 'entity', 'ip', 'userAgent', 'actorLabel']).execute();
      const all = entries.map((row) => `${textOf(row.changes)} ${textOf(row.entity)}`).join('\n');
      for (const word of ['marta', 'kovac', '7946 0001', 'counsel']) expect(entries.filter((row) => `${textOf(row.changes)} ${textOf(row.entity)}`.includes(word) && !textOf(row.changes).includes(`x${MARTA}`)).map((row) => row.action), word).toEqual([]);
      // The entries themselves stay: her edit, the quote's, the visit's removal, her public write; another person's stays as it was.
      expect(entries.filter((row) => row.action === 'record.update').length).toBeGreaterThanOrEqual(2);
      expect(entries.some((row) => row.action === 'record.delete')).toBe(true);
      const publicWrite = entries.find((row) => row.action === 'public.record.update')!;
      expect(publicWrite).toMatchObject({ ip: null, userAgent: null });
      expect(entries.filter((row) => row.action === 'note.add').map((row) => textOf(row.changes)).join(' ')).toContain(`x${MARTA}`);
      expect(all).toContain('ben other');

      const removed = await s.meta.db.selectFrom('adminium_removed_rows').select(['image', 'entityId']).execute();
      expect(removed.length).toBeGreaterThan(0);
      expect(removed.map((row) => textOf(row.image)).join('\n')).not.toContain('marta');
    });

    it('keeps her stopped by a hash alone, deletes her consent, empties her campaign send, and audits counts and the hash only', async () => {
      const consent = createConsentService({ meta: s.meta, secret: TEST_SECRET });
      expect(await consent.stop.has(MARTA)).toBe(true);
      const entry = (await consent.stop.entryFor(MARTA))!;
      expect(entry).toMatchObject({ address: null, reason: 'erased' });
      const raw = await s.meta.db.selectFrom('adminium_stop_list').selectAll().execute();
      expect(raw.map((row) => textOf(row)).join('\n')).not.toContain('marta');
      // Nina's own entry keeps her address: only the erased one goes to a hash.
      expect((await consent.stop.entryFor(NINA))!.address).toBe(NINA);

      expect(await consent.history({ address: MARTA })).toEqual([]);
      expect(await consent.history({ person: { connectionId: s.connectionId, table: s.t('contacts'), key: '1' } })).toEqual([]);
      expect(await consentLogRepo(s.meta).history({ person: { connectionId: s.connectionId, table: s.t('contacts'), key: '2' }, hashes: [] }, { limit: 10 })).toHaveLength(1);

      const sends = await s.meta.db.selectFrom('adminium_email_sends').select(['address', 'name', 'state', 'personKey', 'reason']).orderBy('seq').execute();
      expect(sends[0]).toEqual({ address: '', name: '', state: 'sent', personKey: '1', reason: null });
      // The run's failure list: her entry gone, Ben's that named her emptied of it, the rest as they were.
      const [run] = await s.meta.db.selectFrom('adminium_email_runs').select(['id']).execute();
      expect((await emailRunsRepo(s.meta).findById(run!.id))?.failures).toEqual([
        { to: 'ben@other.example', error: '' },
        { to: 'ben@other.example', error: '452 4.2.2 mailbox full' },
        { to: '', error: 'no-dmarc' },
      ]);
      const mailJobs = await s.meta.db.selectFrom('adminium_jobs').select(['lastError']).where('kind', '=', 'email.send').execute();
      expect(mailJobs.map((job) => job.lastError ?? '').join('\n')).not.toContain('marta');
      expect(sends[1]).toMatchObject({ address: 'ben@other.example', name: 'Ben Other' });
      expect(await s.meta.db.selectFrom('adminium_files').select('id').where('filename', '=', 'passport.pdf').execute()).toEqual([]);
      // Her download went too, its file with it.
      expect(await privacyExportsRepo(s.meta).listFor(s.ids['pia']!)).toEqual([]);
      expect(await s.meta.db.selectFrom('adminium_files').select('id').where('kind', '=', 'export').execute()).toEqual([]);

      const erased = (await s.meta.db.selectFrom('adminium_audit_log').select(['changes', 'actorId']).where('action', '=', 'privacy.erase').execute())[0]!;
      expect(erased.actorId).toBe(s.ids['pia']);
      const changes = (typeof erased.changes === 'string' ? JSON.parse(erased.changes) : erased.changes) as { after: { address: { hash: string; version: number }; counts: Record<string, number> } };
      expect(changes.after.address.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(changes.after.counts['people-crm-contacts']).toBe(1);
      expect(Object.keys(changes.after).sort()).toEqual(['address', 'counts', 'filesFailed', 'left']);
      expect(textOf(erased.changes)).not.toContain('marta');
    });

    it('a link in mail sent before only ever says she is unsubscribed, and neither shows nor logs the address', async () => {
      lines.length = 0;
      const stops = (await s.meta.db.selectFrom('adminium_stop_list').select('id').execute()).length;
      const page = await s.app.inject({ method: 'GET', url: `/m/u/${token}`, headers: { accept: 'text/html' } });
      expect(page.statusCode).toBe(200);
      expect(page.body).not.toContain('name="act"');
      for (const act of ['one', 'all']) {
        const pressed = await s.app.inject({ method: 'POST', url: `/m/u/${token}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: `act=${act}` });
        expect(pressed.statusCode).toBe(200);
        expect(pressed.body.toLowerCase()).not.toContain('marta');
      }
      const oneClick = await s.app.inject({ method: 'POST', url: `/m/u/${token}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'List-Unsubscribe=One-Click' });
      expect(oneClick.statusCode).toBe(200);
      expect(page.body.toLowerCase()).not.toContain('marta');
      // Nothing written: no list entry, no consent row naming her again.
      expect((await s.meta.db.selectFrom('adminium_stop_list').select('id').execute()).length).toBe(stops);
      expect(await createConsentService({ meta: s.meta, secret: TEST_SECRET }).history({ address: MARTA })).toEqual([]);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join('\n').toLowerCase()).not.toContain('marta');
    });

    it('erases a real address that happens to start with "erased-": only the erasure\'s own value reads as done', async () => {
      await s.rows(`INSERT INTO crm_enquiries (id, name, email, message) VALUES (4, 'Bob', 'erased-bob@example.com', 'Lamps')`);
      const res = await erase('pia', 'erased-bob@example.com');
      expect(res.statusCode, res.body).toBe(200);
      expect(dataOf<{ counts: Record<string, number> }>(res).counts['people-crm-enquiries']).toBe(1);
      const [row] = await s.rows(`SELECT name, email FROM crm_enquiries WHERE id = 4`);
      expect(String(row!['email'])).toMatch(/^erased-[0-9a-f]{12}@erased\.invalid$/);
      expect(String(row!['name'])).not.toBe('Bob');
    });

    it('erases a second person with her own unique value, and finds nothing more to do the second time', async () => {
      const nina = await erase('pia', NINA);
      expect(nina.statusCode, nina.body).toBe(200);
      const enquiries = await s.rows(`SELECT email FROM crm_enquiries WHERE id IN (1, 3) ORDER BY id`);
      expect(String(enquiries[1]!['email'])).toMatch(/@erased\.invalid$/);
      // She was on the list already: her entry stays, by its hash alone.
      expect(await createConsentService({ meta: s.meta, secret: TEST_SECRET }).stop.entryFor(NINA)).toMatchObject({ address: null, reason: 'link' });
      expect(enquiries[0]!['email']).not.toBe(enquiries[1]!['email']);

      const again = await erase('pia', TYPED);
      expect(again.statusCode, again.body).toBe(200);
      const counts = dataOf<{ counts: Record<string, number> }>(again).counts;
      expect(counts['people-crm-contacts'] ?? 0).toBe(0);
      expect(counts['consent']).toBe(0);
      expect(dataOf<Preview>(await preview('pia')).goes).toEqual([]);
    });

    it('tells the public door each of their rows lost its address, so their sessions and sign-in links end', async () => {
      const told: RecordWriteEvent[] = [];
      const storage = { remove: async () => undefined, driverFor: async () => ({ remove: async () => undefined }) } as unknown as FileStore;
      await erasePerson({ meta: s.meta, manager: s.manager, consent: createConsentService({ meta: s.meta, secret: TEST_SECRET }), storage, secret: TEST_SECRET, signIns: async (event) => void told.push(event) }, `x${MARTA}`);
      expect(told).toHaveLength(1);
      expect(told[0]).toMatchObject({ connectionId: s.connectionId, action: 'delete', after: null, entity: { table: s.t('contacts'), pk: { id: 3 } } });
      expect(told[0]!.before!['email']).toBe(`x${MARTA}`);
      expect((await one('contacts', 3))['email']).toBeNull();
    });
  });
}
