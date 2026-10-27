// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WHAT STOPS A CAMPAIGN TO A TABLE'S PEOPLE BEFORE IT IS MADE, and what a
 * mail service's notice marks after it went, against the whole server on
 * SQLite, Postgres and MySQL, as a marketer (the campaigns' grant and the
 * contacts' addresses in clear, not the Admin).
 *
 *  - The sender's checks are in the audience preview: every refusal a
 *    marketing send would meet now (no postal address, a free-mail From, no
 *    public address; DNS unchecked, no DMARC, no aligned key), in the
 *    dialog's order. The send answers 409 `SENDER_REFUSED` with the same
 *    codes and makes nothing: no run, no ledger row, no job.
 *  - A send to the workspace's own people is not marketing mail: no
 *    refusals, and it goes.
 *  - Once the sender is ready the preview lists none and the send goes; a
 *    notice that names a campaign mail's Message-ID marks its row of the
 *    send log, and the summary counts it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { emailSendsRepo, emailTemplatesRepo, permissionsRepo, rolesRepo, settingsRepo } from '@adminium/meta';

import { campaignMessageId } from '../src/email/message-id.js';
import { createNoticeEndpoints } from '../src/email/notices/endpoints.js';
import { createDkimKeys, createTxtLookup } from '../src/email/sender/index.js';
import { TEST_SECRET } from './helpers.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', () => ({ APP_VERSION: '0.3.37' }));

const ORIGIN = 'https://crm.meridian.example';
const POSTAL = 'Meridian Workplace Ltd, 4 Wharf Lane, Leeds LS1 4BR, United Kingdom';
const id = { ref: 'id', type: 'int', role: 'pk' };

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
          columns: [id, { ref: 'name', type: 'text', maxLength: 80 }, { ref: 'email', type: 'text', maxLength: 254, nullable: true, rules: { personal: true } }],
        },
      ],
    },
    people: [{ table: 'contacts', kind: 'people', email: 'email', name: 'name' }],
    roles: [{ key: 'marketer', name: 'Marketer', permissions: ['table:@contacts:read', 'table:@contacts:read_pii'] }],
    pages: [{ ref: 'crm-contacts', template: 'page-crud', title: { key: 't', fallback: 'Contacts' }, nav: { group: 'crm', icon: 'home', order: 1 }, bindings: { rows: 'contacts' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

interface Preview {
  total: number;
  refusals?: string[];
  breakdown?: { recipients: number };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`what stops a campaign to a table, and what a notice marks [${dialect}]`, () => {
    let s: WholeServer;
    let contacts = '';
    let postal: string | null = null;
    const dns = new Map<string, string[]>();
    let campaignNo = 0;
    const audience = () => ({ kind: 'table', connectionId: s.connectionId, table: contacts, purpose: 'newsletter' });
    const campaign = async () => {
      campaignNo += 1;
      return (await emailTemplatesRepo(s.meta).create({ kind: 'campaign', key: `news-${String(campaignNo)}`, locale: 'en_US', name: 'July news', subject: 'Hello {{first_name}}', blocks: [{ id: 'b1', block: 'email.text', data: { paras: ['Dear {{name}}'] } }] })).id;
    };
    const preview = async (templateId: string, body: Record<string, unknown>): Promise<Preview> => {
      const res = await s.send('mia', 'POST', `/api/v1/email-templates/${templateId}/audience/preview`, body);
      expect(res.statusCode, res.body).toBe(200);
      return res.json() as Preview;
    };
    const setFrom = async (from: string) => {
      await settingsRepo(s.meta).set('email.smtp', { ...(await settingsRepo(s.meta).get('email.smtp'))!, from }, { updatedBy: null });
    };
    const made = async (templateId: string) => ({
      runs: (await s.meta.db.selectFrom('adminium_email_runs').select('id').where('templateId', '=', templateId).execute()).length,
      sends: Number((await s.meta.db.selectFrom('adminium_email_sends').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst())?.n ?? 0),
      jobs: (await s.meta.db.selectFrom('adminium_jobs').select('payload').where('kind', '=', 'email.campaign-run').execute()).filter((row) => JSON.stringify(row.payload).includes(templateId)).length,
    });

    beforeAll(async () => {
      const lookup = createTxtLookup({ cacheMs: 0, resolve: async (name) => (dns.get(name) ?? []).map((record) => [record]) });
      s = await wholeServer(dialect, crm(), {
        people: { mia: ['marketer'] },
        smtp: true,
        compose: { marketingSeams: { lookup, postalAddress: async () => postal } },
      });
      contacts = s.t('contacts');
      // The campaigns' grant, given to a role of its own: mia is a marketer, not the Admin.
      const roles = rolesRepo(s.meta);
      const campaigns = await roles.create({ slug: 'campaigns', name: 'Campaigns' });
      await permissionsRepo(s.meta).grant(campaigns.id, 'system', 'settings.manage', { allowed: true });
      await roles.assignToUser(s.ids['mia']!, campaigns.id);
      await settingsRepo(s.meta).set('system.instanceId', 'install-1', { updatedBy: null });
      await s.rows(`INSERT INTO crm_contacts (id, name, email) VALUES (1, 'Ana Agreed', 'ana@harbour.dev'), (2, 'Cal Complains', 'cal@harbour.dev')`);
      // Both said yes to the newsletter.
      const { createConsentService } = await import('../src/consent/index.js');
      const log = createConsentService({ meta: s.meta, secret: TEST_SECRET });
      for (const key of ['1', '2']) await log.record({ person: { connectionId: s.connectionId, table: contacts, key }, purpose: 'newsletter', source: 'import', state: 'yes' });
    }, 240_000);
    afterAll(async () => {
      await s?.close();
    });

    it('lists every refusal in the preview, and the send answers 409 with the same codes and makes nothing', async () => {
      // No postal address, a free mailbox as the From, no public address.
      await setFrom('Meridian <meridian.news@gmail.com>');
      const templateId = await campaign();
      const shown = await preview(templateId, { audience: audience() });
      expect(shown.refusals).toEqual(['no-postal-address', 'free-mail-from', 'no-public-address']);
      // The breakdown is still there: the dialog shows who would get it beside what stops it.
      expect(shown.breakdown?.recipients).toBe(2);
      const refused = await s.send('mia', 'POST', `/api/v1/email-templates/${templateId}/send`, { audience: audience() });
      expect(said(refused)).toBe('409 SENDER_REFUSED');
      expect((refused.json() as { error: { details: { refusals: string[] } } }).error.details.refusals).toEqual(['no-postal-address', 'free-mail-from', 'no-public-address']);
      expect(await made(templateId)).toEqual({ runs: 0, sends: 0, jobs: 0 });
      // Scheduled for later, the same: nothing is made that the first batch would only stop.
      expect(said(await s.send('mia', 'POST', `/api/v1/email-templates/${templateId}/send`, { audience: audience(), scheduleAt: Date.now() + 3_600_000 }))).toBe('409 SENDER_REFUSED');
      expect(await made(templateId)).toEqual({ runs: 0, sends: 0, jobs: 0 });

      // Its own domain with no DMARC yet, the postal address and the public address set: one refusal left.
      postal = POSTAL;
      await settingsRepo(s.meta).set('system.publicOrigin', ORIGIN, { updatedBy: null });
      await setFrom('Meridian <news@meridian.example>');
      expect((await preview(templateId, { audience: audience() })).refusals).toEqual(['no-dmarc']);
      const one = await s.send('mia', 'POST', `/api/v1/email-templates/${templateId}/send`, { audience: audience() });
      expect(said(one)).toBe('409 SENDER_REFUSED');
      expect((one.json() as { error: { details: { refusals: string[] } } }).error.details.refusals).toEqual(['no-dmarc']);
      // DMARC, but no key of Adminium's published: not aligned.
      dns.set('_dmarc.meridian.example', ['v=DMARC1; p=quarantine']);
      expect((await preview(templateId, { audience: audience() })).refusals).toEqual(['not-aligned']);
      expect(await made(templateId)).toEqual({ runs: 0, sends: 0, jobs: 0 });
    });

    it('a send to the workspace’s own people is not marketing mail: no refusals, and it goes', async () => {
      await setFrom('Meridian <meridian.news@gmail.com>');
      const templateId = await campaign();
      const shown = await preview(templateId, { audience: { kind: 'users' } });
      expect(shown.refusals).toBeUndefined();
      expect(said(await s.send('mia', 'POST', `/api/v1/email-templates/${templateId}/send`, { audience: { kind: 'users' } }))).toBe('ok');
    });

    it('once the sender is ready it goes; a notice naming a mail’s Message-ID marks its row, and the summary counts it', async () => {
      postal = POSTAL;
      await settingsRepo(s.meta).set('system.publicOrigin', ORIGIN, { updatedBy: null });
      await setFrom('Meridian <news@meridian.example>');
      const key = await createDkimKeys({ meta: s.meta, secret: TEST_SECRET }).make('meridian.example');
      dns.set('_dmarc.meridian.example', ['v=DMARC1; p=quarantine']);
      dns.set(key.record.name, [key.record.value]);
      const templateId = await campaign();
      expect((await preview(templateId, { audience: audience() })).refusals).toEqual([]);
      const sent = await s.send('mia', 'POST', `/api/v1/email-templates/${templateId}/send`, { audience: audience() });
      expect(said(sent)).toBe('ok');
      const runId = (sent.json() as { run: { id: string } }).run.id;
      await s.jobs();
      const rows = await emailSendsRepo(s.meta).list(runId, { limit: 10 });
      expect(rows.map((row) => [row.address, row.state])).toEqual([
        ['ana@harbour.dev', 'sent'],
        ['cal@harbour.dev', 'sent'],
      ]);

      // The bounce card's "Another service": a bounce for Ana's mail and a spam report for Cal's, each naming its Message-ID.
      const other = (await createNoticeEndpoints({ meta: s.meta, secret: TEST_SECRET }).open('other'))!;
      const messageOf = (address: string) => campaignMessageId(rows.find((row) => row.address === address)!.id, 'news@meridian.example');
      const notice = await s.app.inject({
        method: 'POST',
        url: `/api/v1/email/notices/other/${other.token}`,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          events: [
            { address: 'ana@harbour.dev', kind: 'bounce', messageId: messageOf('ana@harbour.dev') },
            { address: 'cal@harbour.dev', kind: 'complaint', messageId: messageOf('cal@harbour.dev') },
          ],
        }),
      });
      expect(notice.statusCode, notice.body).toBe(200);
      const log = await s.get('mia', `/api/v1/email-runs/${runId}/log`);
      expect(log.statusCode, log.body).toBe(200);
      const body = log.json() as { summary: Record<string, number>; rows: { address: string; state: string; reason: string | null }[] };
      expect(body.summary).toMatchObject({ total: 2, sent: 0, bounced: 1, spam: 1 });
      expect(body.rows.map((row) => [row.address, row.state, row.reason])).toEqual([
        ['ana@harbour.dev', 'bounced', 'notice:other'],
        ['cal@harbour.dev', 'spam', 'notice:other'],
      ]);
      // And both addresses are on the do-not-email list, as every notice did before.
      const list = await s.get('mia', '/api/v1/consent/stop-list');
      expect(list.statusCode, list.body).toBe(200);
      expect(JSON.stringify(list.json())).toContain('cal@harbour.dev');
    });
  });
}
