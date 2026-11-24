// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sales CRM's "Send a text", on the whole server over SQLite, Postgres and
 * MySQL source databases: a text to the number on a contact, as a person whose
 * app role holds `texts:@:reply`, read under their row limits, through the
 * real send path and the real `sms.send` job. Only the provider is a stub,
 * written from its public documentation.
 */
import { apiKeysRepo, rolesRepo, settingsRepo } from '@adminium/meta';
import { SMS_WORDS_FLOOR } from '@adminium/manifest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { generateApiKey } from '../src/rbac/api-keys.js';
import { createSmsAccountStore } from '../src/sms/account-store.js';
import { createTextConsentService } from '../src/sms/consent/index.js';
import { createSmsService } from '../src/sms/index.js';
import { TEST_SECRET } from './helpers.js';
import { stubProvider } from './sms-send.helpers.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';

vi.mock('../src/version.js', async (original) => ({ ...(await original<typeof import('../src/version.js')>()), APP_VERSION: SMS_WORDS_FLOOR }));

const FROM = '+14155550100';
const RITA_CONTACT = '+4915123456789';
const DAN_CONTACT = '+4915123456780';
const KEY = (n: number) => `${'k'.repeat(31)}${String(n)}`;

function crm(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'crmx',
    name: 'Sales',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'Sales.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: SMS_WORDS_FLOOR, engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'contacts',
          keyField: 'name',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'name', type: 'text', maxLength: 80 },
            { ref: 'phone', type: 'text', maxLength: 40, nullable: true, rules: { personal: true } },
            { ref: 'owner_id', type: 'text', maxLength: 36, nullable: true, rules: { staff: true } },
          ],
          belongs: [{ column: 'owner_id', set: 'team' }],
        },
      ],
    },
    roles: [
      // A rep texts their own contacts.
      { key: 'rep', name: 'Rep', permissions: ['table:@contacts:read', 'texts:@:reply'], limits: { contacts: { rows: { read: { reach: 'own' } } } } },
      // The desk reads the app's conversations and answers none.
      { key: 'desk', name: 'Desk', permissions: ['table:@contacts:read', 'texts:@:read'] },
      { key: 'reader', name: 'Reader', permissions: ['table:@contacts:read'] },
    ],
    pages: [{ ref: 'crmx-contacts', template: 'page-crud', title: { key: 't', fallback: 'Contacts' }, nav: { group: 'sales', icon: 'home', order: 1 }, bindings: { rows: 'contacts' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`"Send a text" from a record, on ${dialect}`, () => {
    let s: WholeServer;
    const provider = stubProvider('twilio', '', []);
    const body = (row: number, clientKey: string, column = 'phone') => ({ connection: s.connectionId, table: s.t('contacts'), row: String(row), column, body: 'Your quote is ready.', clientKey });

    beforeAll(async () => {
      vi.stubGlobal('fetch', provider.fetchStub);
      s = await wholeServer(dialect, crm(), { people: { rita: ['rep'], dan: ['desk'], tom: ['reader'] } });
      // Before the public address: no reply can arrive, and the list says so.
      expect(((await s.get('owner', '/api/v1/texts/threads')).json() as { data: { replies: unknown } }).data.replies).toEqual({ canArrive: false, state: 'not-set' });
      // A public https address: replies can arrive, so a text from a number says "Reply STOP".
      await settingsRepo(s.meta).set('system.publicOrigin', 'https://crm.lumen.example', { updatedBy: null });
      // The business's own account, as Studio → Text messages saves it.
      const sms = createSmsService({ store: createSmsAccountStore(s.meta), secret: TEST_SECRET, stopList: { isStopped: async () => false, recordProviderOptOut: async () => undefined } });
      await sms.connect({ provider: 'twilio', accountSid: `AC${'ab'.repeat(16)}`, authToken: 'made-up-token-for-these-tests' }, null);
      await sms.setSending({ sender: { kind: 'number', value: FROM }, defaultCountry: 'DE' }, null);
      await s.rows(`insert into ${s.t('contacts').split('.').pop()!} (id, name, phone, owner_id) values (1, 'Ines', '0151 23456789', '${s.ids['rita']!}'), (2, 'Olaf', '${DAN_CONTACT}', '${s.ids['dan']!}')`);
      // Ines agreed to texts, at the desk.
      await createTextConsentService({ meta: s.meta, secret: TEST_SECRET }).record({ phone: RITA_CONTACT, purpose: 'text-service', state: 'yes', source: 'staff', staff: { id: s.ids['owner']!, label: 'Owner' }, wording: { text: 'May we text you about your quote?', version: 'v1' } });
    }, 240_000);

    afterAll(async () => {
      await s?.close();
      vi.unstubAllGlobals();
    });

    it('sends to the number on the rep\'s own contact, which the rep may not see, through the send path, into the app\'s thread', async () => {
      const sent = await s.send('rita', 'POST', '/api/v1/texts/send', body(1, KEY(1)));
      expect(sent.statusCode, sent.body).toBe(200);
      expect((sent.json() as { data: unknown }).data, sent.body).toMatchObject({ sentTo: null, result: { outcome: 'queued' } });
      await s.jobs();
      const post = provider.posts.find((one) => new URLSearchParams(one.body).get('To') === RITA_CONTACT);
      expect(new URLSearchParams(post!.body).get('Body')).toBe('Your quote is ready. Reply STOP to opt out.');
      const threads = await s.meta.db.selectFrom('adminium_text_threads').selectAll().execute();
      expect(threads).toHaveLength(1);
      expect(threads[0]).toMatchObject({ appKey: 'crmx', recordKey: '1', lastKind: 'text' });
      // The same key again sends nothing twice.
      expect((await s.send('rita', 'POST', '/api/v1/texts/send', body(1, KEY(1)))).statusCode).toBe(200);
      await s.jobs();
      expect(provider.posts.filter((one) => new URLSearchParams(one.body).get('To') === RITA_CONTACT)).toHaveLength(1);
    });

    it('a contact out of the rep\'s reach answers as one that is not there, and a column that is not a phone is refused', async () => {
      expect(said(await s.send('rita', 'POST', '/api/v1/texts/send', body(2, KEY(2))))).toBe('404 NOT_FOUND');
      expect(said(await s.send('rita', 'POST', '/api/v1/texts/send', body(1, KEY(3), 'name')))).toBe('422 VALIDATION_FAILED');
    });

    it('is refused to a role that only reads, or holds no texts right, and to an API key', async () => {
      expect(said(await s.send('dan', 'POST', '/api/v1/texts/send', body(2, KEY(4))))).toBe('403 FORBIDDEN');
      expect(said(await s.send('tom', 'POST', '/api/v1/texts/send', body(2, KEY(5))))).toBe('403 FORBIDDEN');
      const generated = generateApiKey();
      await apiKeysRepo(s.meta).create({ name: 'script', prefix: generated.prefix, tokenHash: generated.tokenHash, roleId: (await rolesRepo(s.meta).findBySlug('super-admin'))!.id });
      const byKey = await s.app.inject({ method: 'POST', url: '/api/v1/texts/send', headers: { authorization: `Bearer ${generated.key}` }, payload: body(1, KEY(6)) });
      // Refused before anything is read: an API key acts for nobody here.
      expect([401, 403], byKey.body).toContain(byKey.statusCode);
    });

    it('the send path refuses someone who never agreed, and the desk reads the app\'s conversation without answering it', async () => {
      const refused = await s.send('owner', 'POST', '/api/v1/texts/send', body(2, KEY(7)));
      expect((refused.json() as { data: unknown }).data).toMatchObject({ threadId: null, result: { outcome: 'refused', reason: 'no-consent' } });
      const list = await s.get('dan', '/api/v1/texts/threads');
      expect(list.statusCode, list.body).toBe(200);
      const [thread] = (list.json() as { data: { threads: { id: string; app: string; phone: string }[] } }).data.threads;
      expect(thread).toMatchObject({ app: 'crmx', phone: RITA_CONTACT });
      const detail = await s.get('dan', `/api/v1/texts/threads/${thread!.id}`);
      expect((detail.json() as { data: { canReply: unknown; items: { kind: string; body: string }[] } }).data).toMatchObject({ canReply: { ok: false, reason: 'not-allowed' }, items: [{ kind: 'text', body: 'Your quote is ready. Reply STOP to opt out.' }] });
      expect(said(await s.get('tom', '/api/v1/texts/threads'))).toBe('403 FORBIDDEN');
      const audit = JSON.stringify(await s.meta.db.selectFrom('adminium_audit_log').select(['action', 'changes']).execute());
      expect(audit).toContain('texts.record.texted');
      expect(audit).toContain('texts.thread.read');
      expect(audit).not.toContain(RITA_CONTACT);
      expect(audit).not.toContain('quote is ready');
    });
  });
}
