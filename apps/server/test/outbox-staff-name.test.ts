// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AN APP'S E-MAIL NAMES THE PERSON A STAFF COLUMN NAMES (`{{visit.rep_id.name}}`),
 * against the whole server on SQLite, Postgres and MySQL, through an app
 * installed by the real installer:
 *
 *  - a visit's confirmation to the customer says who comes: the rep's name
 *    as the people list gives it, and nothing else of her (no address, no id);
 *  - the visit called off says who was coming, from the row as it was
 *    (`{{was.rep_id.name}}`);
 *  - a list's row names its person too (`{{row.rep_id.name}}`);
 *  - somebody the people list does not name (suspended, removed, an id that
 *    is nobody's) reads empty, so a block sent only with a name goes without
 *    it and the message still goes.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.28' }));

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, maxLength = 120, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });
const staff = (ref: string) => text(ref, 36, { rules: { staff: true } });
const link = (ref: string, references: string) => ({ ref, type: 'fk', references, nullable: true });

function crm(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crm',
    name: 'CRM',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.crm.desc', fallback: 'A CRM.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: '0.3.28', engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'sales', label: { 'en-US': 'Sales' }, order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [
        { ref: 'contacts', columns: [id, text('email', 254), text('name', 80)] },
        { ref: 'deals', columns: [id, text('name', 80), link('contact_id', 'contacts')] },
        { ref: 'site_visits', columns: [id, link('contact_id', 'contacts'), link('deal_id', 'deals'), staff('rep_id'), text('purpose', 80)] },
        {
          ref: 'messages',
          columns: [
            id,
            { ref: 'kind', type: 'enum', enum: ['visit-confirmed', 'visit-cancelled', 'deal-visits'] },
            { ref: 'status', type: 'enum', enum: ['queued', 'sent', 'failed', 'skipped'], default: 'queued' },
            text('to_address', 254),
            link('contact_id', 'contacts'),
            link('visit_id', 'site_visits'),
            link('deal_id', 'deals'),
            text('error', 200),
            { ref: 'sent_at', type: 'timestamptz', nullable: true },
            text('was', 1000),
          ],
        },
      ],
    },
    roles: [{ key: 'rep', name: 'Rep', permissions: ['table:@site_visits:read', 'table:@site_visits:create', 'table:@site_visits:delete', 'page:@crm-visits:view'] }],
    pages: [{ ref: 'crm-visits', template: 'page-crud', title: { key: 't.visits', fallback: 'Visits' }, nav: { group: 'sales', icon: 'list', order: 1 }, bindings: { rows: 'site_visits' } }],
    outbox: {
      table: 'messages',
      columns: { kind: 'kind', status: 'status', to: 'to_address', error: 'error', sentAt: 'sent_at', was: 'was' },
      links: { visit: 'visit_id', deal: 'deal_id' },
      recipient: { via: 'contact_id', table: 'contacts', email: 'email', name: 'name' },
      kinds: { 'visit-confirmed': 'crm-visit-confirmed', 'visit-cancelled': 'crm-visit-cancelled', 'deal-visits': 'crm-deal-visits' },
      producers: [
        { kind: 'visit-confirmed', link: 'visit_id', onCreate: { table: 'site_visits' } },
        { kind: 'visit-cancelled', link: 'visit_id', was: ['purpose', 'rep_id'], onDelete: { table: 'site_visits' } },
        { kind: 'deal-visits', link: 'deal_id', onChange: { table: 'deals', columns: ['name'], changed: true } },
      ],
    },
    emailTemplates: [
      {
        key: 'crm-visit-confirmed',
        name: 'Visit confirmed',
        locales: {
          'en-US': {
            subject: 'Your visit: {{visit.purpose}}',
            blocks: [
              { block: 'email.text', data: { text: 'Hello {{recipient.name}}, we will see you about {{visit.purpose}}.' } },
              { block: 'email.text', data: { text: 'Coming to you: {{visit.rep_id.name}}.', onlyWith: 'visit.rep_id.name' } },
            ],
          },
        },
      },
      {
        key: 'crm-visit-cancelled',
        name: 'Visit cancelled',
        locales: { 'en-US': { subject: 'Your visit is off', blocks: [{ block: 'email.text', data: { text: '{{was.rep_id.name}} will not come about {{was.purpose}}.' } }] } },
      },
      {
        key: 'crm-deal-visits',
        name: 'Your visits',
        locales: {
          'en-US': {
            subject: 'Your visits for {{deal.name}}',
            blocks: [{ block: 'email.rows', id: 'visits', data: { from: { link: 'deal', table: 'site_visits', via: 'deal_id', orderBy: 'id' }, row: { title: '{{row.purpose}} with {{row.rep_id.name}}' }, empty: 'No visits' } }],
          },
        },
      },
    ],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { desk: '/' } }],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`an app's e-mail names the person a staff column names, on ${dialect}`, () => {
    let s: WholeServer;
    const send = async () => {
      await s.app.outboxSender.sendApp('crm', Date.now());
      return s.emails();
    };
    const whole = (mail: { html: string; text: string; subject: string }) => `${mail.subject} ${mail.html} ${mail.text}`;

    beforeAll(async () => {
      s = await wholeServer(dialect, crm(), { people: { dana: ['rep'], lee: ['rep'] }, smtp: true });
      await s.rows(`INSERT INTO crm_contacts (id, email, name) VALUES (1, 'bo@harbour.dev', 'Bo Buyer')`);
      await s.rows(`INSERT INTO crm_deals (id, name, contact_id) VALUES (1, 'Harbour kitchen', 1)`);
      await s.meta.db.updateTable('adminium_users').set({ name: 'Dana Rep' }).where('id', '=', s.ids['dana']!).execute();
      await s.meta.db.updateTable('adminium_users').set({ name: 'Lee Gone' }).where('id', '=', s.ids['lee']!).execute();
      await s.emails();
    }, 180_000);
    afterAll(async () => {
      await s?.close();
    });

    it('a visit’s confirmation says who comes, by name, and nothing else of her', async () => {
      const made = await s.make('dana', 'site_visits', { contact_id: 1, deal_id: 1, rep_id: s.ids['dana'], purpose: 'Kitchen measure' });
      expect(said(made), made.body).toBe('ok');
      const mail = (await send()).filter((one) => one.templateKey === 'crm-visit-confirmed');
      expect(mail).toHaveLength(1);
      expect(mail[0]!.to).toBe('bo@harbour.dev');
      expect(mail[0]!.text).toContain('Coming to you: Dana Rep.');
      const [user] = await s.meta.db.selectFrom('adminium_users').select(['email']).where('id', '=', s.ids['dana']!).execute();
      expect(whole(mail[0]!)).not.toContain(user!.email);
      expect(whole(mail[0]!)).not.toContain(s.ids['dana']!);
    });

    it('a list’s row names its person, and the visit called off says who was coming', async () => {
      expect(said(await s.change('owner', 'deals', 1, { name: 'Harbour kitchen, phase 2' }))).toBe('ok');
      const listed = (await send()).filter((one) => one.templateKey === 'crm-deal-visits');
      expect(listed).toHaveLength(1);
      expect(listed[0]!.text).toContain('Kitchen measure with Dana Rep');
      const [visit] = await s.rows(`SELECT id FROM crm_site_visits WHERE purpose = 'Kitchen measure'`);
      expect(said(await s.send('dana', 'DELETE', `/api/v1/data/${s.connectionId}/${s.t('site_visits')}/${String(visit!['id'])}?confirm=true`))).toBe('ok');
      const off = (await send()).filter((one) => one.templateKey === 'crm-visit-cancelled');
      expect(off).toHaveLength(1);
      expect(off[0]!.text).toContain('Dana Rep will not come about Kitchen measure.');
    });

    it('somebody the people list does not name reads empty: the block that needs a name is left out, the message goes', async () => {
      // Lee is suspended after the visit is booked, before its mail goes.
      expect(said(await s.make('owner', 'site_visits', { contact_id: 1, rep_id: s.ids['lee'], purpose: 'Survey' }))).toBe('ok');
      await s.meta.db.updateTable('adminium_users').set({ status: 'suspended' }).where('id', '=', s.ids['lee']!).execute();
      // An id that is nobody's (written to the database by something else than Adminium).
      expect(said(await s.make('owner', 'site_visits', { contact_id: 1, rep_id: s.ids['dana'], purpose: 'Fitting' }))).toBe('ok');
      await s.rows(`UPDATE crm_site_visits SET rep_id = 'usr_nobody' WHERE purpose = 'Fitting'`);
      const mails = (await send()).filter((one) => one.templateKey === 'crm-visit-confirmed');
      expect(mails.map((one) => one.subject).sort()).toEqual(['Your visit: Fitting', 'Your visit: Survey']);
      for (const mail of mails) {
        expect(whole(mail)).not.toContain('Coming to you');
        expect(whole(mail)).not.toContain('Lee Gone');
        expect(whole(mail)).not.toContain('usr_nobody');
      }
      const failed = await s.rows(`SELECT status, error FROM crm_messages WHERE status <> 'sent'`);
      expect(failed).toEqual([]);
    });
  });
}
