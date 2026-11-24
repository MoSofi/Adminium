// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An app's own staff pages and texts consent, on the whole server over
 * SQLite, Postgres and MySQL source databases:
 *
 *  - "Send a text" takes the table by its name, or (for an app's page that
 *    sends `X-Adminium-Install`) by the app's own name for it, as well as by
 *    its id.
 *  - Whether texts can go at all is a plain flag.
 *  - A desk role that may change the row (and holds no texts right) records a
 *    service yes the person gave in person, with its words and version; it is
 *    read back with how and by whom, and the send path then sends. A role that
 *    only reads may not record one. A STOP reads as stopped, lifted by START.
 *  - A staff change of a box's column on the record page records the staff
 *    member's yes in the box's declared words, or their no; a change that
 *    leaves the column alone records nothing.
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
import { twilioRepliesHeard } from './helpers/sms-heard.js';

vi.mock('../src/version.js', async (original) => ({ ...(await original<typeof import('../src/version.js')>()), APP_VERSION: SMS_WORDS_FLOOR }));

const FROM = '+14155550100';
const INES = '+4915123456789';
const OLAF = '+4915123456780';
const KEY = (n: number) => `${'q'.repeat(31)}${String(n)}`;
const WORDS = 'May we text you about your quote?';

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
            { ref: 'may_text', type: 'bool', default: false },
          ],
        },
      ],
    },
    people: [{ table: 'contacts', kind: 'people', name: 'name', phone: 'phone' }],
    publicAccess: [
      {
        table: 'contacts',
        methods: ['POST'],
        select: ['id'],
        writable: ['name', 'phone', 'may_text'],
        anonymous: { perKeyHour: 20 },
        textConsent: { column: 'may_text', phone: 'phone', class: 'service', wording: { version: 1, text: { 'en-US': WORDS } } },
      },
    ],
    roles: [
      // The rep texts the app's people.
      { key: 'rep', name: 'Rep', permissions: ['table:@contacts:read', 'texts:@:reply'] },
      // The desk changes contacts and texts nobody.
      { key: 'desk', name: 'Desk', permissions: ['table:@contacts:read', 'table:@contacts:update'] },
      { key: 'reader', name: 'Reader', permissions: ['table:@contacts:read'] },
    ],
    pages: [{ ref: 'crmx-contacts', template: 'page-crud', title: { key: 't', fallback: 'Contacts' }, nav: { group: 'sales', icon: 'home', order: 1 }, bindings: { rows: 'contacts' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

type Standing = { state: string; answer: { source: string; how: string | null; by: { label: string } | null; wordingVersion: string | null } | null };
type StandingReply = { data: { table: string; app: string | null; ready: boolean; masked: string | null; service: Standing; marketing: Standing; stopped: { liftBy: string } | null } };

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`an app's staff pages and texts consent, on ${dialect}`, () => {
    let s: WholeServer;
    const provider = stubProvider('twilio', '', []);
    const name = () => s.t('contacts').split('.').pop()!;
    const ask = (row: number) => ({ connection: s.connectionId, table: name(), row: String(row), column: 'phone' });
    const query = (row: number) => new URLSearchParams(ask(row)).toString();
    const standing = async (who: string, row: number) => {
      const res = await s.get(who, `/api/v1/texts/consent?${query(row)}`);
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as StandingReply).data;
    };

    beforeAll(async () => {
      vi.stubGlobal('fetch', provider.fetchStub);
      s = await wholeServer(dialect, crm(), { people: { rita: ['rep'], dana: ['desk'], tom: ['reader'] } });
      await s.rows(`insert into ${name()} (id, name, phone) values (1, 'Ines', '0151 23456789'), (2, 'Olaf', '${OLAF}'), (3, 'Mara', null)`);
    }, 240_000);

    afterAll(async () => {
      await s?.close();
      vi.unstubAllGlobals();
    });

    it('says texts cannot go until a provider and a sender are set, as a plain flag', async () => {
      const before = await s.get('tom', '/api/v1/texts/ready');
      expect(before.json()).toEqual({ data: { ready: false } });
      await settingsRepo(s.meta).set('system.publicOrigin', 'https://crm.lumen.example', { updatedBy: null });
      await twilioRepliesHeard(s.meta, { secret: TEST_SECRET, origin: 'https://crm.lumen.example', accountSid: `AC${'ab'.repeat(16)}` });
      const sms = createSmsService({ store: createSmsAccountStore(s.meta), secret: TEST_SECRET, stopList: { isStopped: async () => false, recordProviderOptOut: async () => undefined } });
      await sms.connect({ provider: 'twilio', accountSid: `AC${'ab'.repeat(16)}`, authToken: 'made-up-token-for-these-tests' }, null);
      expect((await s.get('tom', '/api/v1/texts/ready')).json()).toEqual({ data: { ready: false } });
      await sms.setSending({ sender: { kind: 'number', value: FROM }, defaultCountry: 'DE' }, null);
      const after = await s.get('tom', '/api/v1/texts/ready');
      expect(after.json()).toEqual({ data: { ready: true } });
      // Nothing of the account.
      expect(after.body).not.toContain(FROM);
    });

    it('"Send a text" takes the table by its name, and an app\'s page by the app\'s own name for it', async () => {
      const byName = await s.send('rita', 'POST', '/api/v1/texts/send', { ...ask(1), body: 'Your quote is ready.', clientKey: KEY(1) });
      expect(byName.statusCode, byName.body).toBe(200);
      expect((byName.json() as { data: unknown }).data).toMatchObject({ result: { outcome: 'refused', reason: 'no-consent' } });
      const install = (await s.meta.db.selectFrom('adminium_manifests').select('id').where('manifestKey', '=', 'crmx').where('scopeKey', '=', s.connectionId).executeTakeFirstOrThrow()).id;
      const byRef = await s.app.inject({
        method: 'POST',
        url: '/api/v1/texts/send',
        headers: { cookie: s.cookie['rita']!, 'x-adminium-install': install },
        payload: { ...ask(1), table: 'contacts', body: 'Your quote is ready.', clientKey: KEY(2) },
      });
      expect(byRef.statusCode, byRef.body).toBe(200);
      // By its id, as before.
      expect((await s.send('rita', 'POST', '/api/v1/texts/send', { ...ask(1), table: s.t('contacts'), body: 'Your quote is ready.', clientKey: KEY(3) })).statusCode).toBe(200);
      // A name no table has answers as a record that is not there.
      expect(said(await s.send('rita', 'POST', '/api/v1/texts/send', { ...ask(1), table: 'no_such_table', body: 'Hi', clientKey: KEY(4) }))).toBe('404 NOT_FOUND');
    });

    it('the desk records a service yes given in person, with its words; it reads back as theirs, and the text then goes', async () => {
      const before = await standing('tom', 1);
      expect(before).toMatchObject({ app: 'crmx', ready: true, masked: '+49 ••• 789', service: { state: 'not-asked' }, stopped: null });
      // A role that only reads may not.
      const refused = await s.send('tom', 'POST', '/api/v1/texts/consent', { ...ask(1), state: 'yes', how: 'in-person', wording: { text: WORDS, version: 'v1' } });
      expect(said(refused)).toBe('403 FORBIDDEN');
      // A yes keeps its words.
      expect(said(await s.send('dana', 'POST', '/api/v1/texts/consent', { ...ask(1), state: 'yes', how: 'in-person' }))).toBe('422 VALIDATION_FAILED');
      const recorded = await s.send('dana', 'POST', '/api/v1/texts/consent', { ...ask(1), state: 'yes', how: 'in-person', wording: { text: WORDS, version: 'v1' } });
      expect(recorded.statusCode, recorded.body).toBe(200);
      expect((recorded.json() as StandingReply).data.service).toMatchObject({ state: 'yes', answer: { source: 'staff', how: 'in-person', by: { label: 'Dana' }, wordingVersion: 'v1' } });
      // Read back over HTTP, by anyone who reads the record.
      expect((await standing('tom', 1)).service).toMatchObject({ state: 'yes', answer: { how: 'in-person', wordingVersion: 'v1' } });
      expect((await standing('tom', 1)).marketing).toMatchObject({ state: 'not-asked' });
      const sent = await s.send('rita', 'POST', '/api/v1/texts/send', { ...ask(1), body: 'Your quote is ready.', clientKey: KEY(5) });
      expect((sent.json() as { data: unknown }).data).toMatchObject({ result: { outcome: 'queued' } });
      const audit = JSON.stringify(await s.meta.db.selectFrom('adminium_audit_log').select(['action', 'changes']).execute());
      expect(audit).toContain('texts.consent.recorded');
      expect(audit).not.toContain(INES);
      // A record with no number has nothing to say yes for.
      expect((await standing('tom', 3)).service.state).toBe('no-phone');
      expect(said(await s.send('dana', 'POST', '/api/v1/texts/consent', { ...ask(3), state: 'yes', how: 'phone', wording: { text: WORDS, version: 'v1' } }))).toBe('422 VALIDATION_FAILED');
      // An API key records nothing.
      const generated = generateApiKey();
      await apiKeysRepo(s.meta).create({ name: 'script', prefix: generated.prefix, tokenHash: generated.tokenHash, roleId: (await rolesRepo(s.meta).findBySlug('super-admin'))!.id });
      const byKey = await s.app.inject({ method: 'POST', url: '/api/v1/texts/consent', headers: { authorization: `Bearer ${generated.key}` }, payload: { ...ask(1), state: 'no', how: 'phone' } });
      expect([401, 403], byKey.body).toContain(byKey.statusCode);
    });

    it('a STOP reads as stopped, lifted only by their START, whatever a yes says', async () => {
      const consent = createTextConsentService({ meta: s.meta, secret: TEST_SECRET });
      await consent.stop.add({ phone: INES, reason: 'text-stop' });
      const stopped = await standing('rita', 1);
      expect(stopped).toMatchObject({ service: { state: 'stopped' }, marketing: { state: 'stopped' }, stopped: { liftBy: 'start' } });
      await s.send('dana', 'POST', '/api/v1/texts/consent', { ...ask(1), state: 'yes', how: 'in-person', wording: { text: WORDS, version: 'v1' } });
      expect((await standing('rita', 1)).service.state).toBe('stopped');
    });

    it('a staff tick of the box on the record page records their yes in the box\'s words; unticking records a no; another change nothing', async () => {
      const consent = createTextConsentService({ meta: s.meta, secret: TEST_SECRET });
      const events = async () => consent.history({ phone: OLAF, country: 'DE' });
      expect((await s.change('dana', 'contacts', 2, { may_text: true })).statusCode).toBe(200);
      expect((await standing('tom', 2)).service).toMatchObject({ state: 'yes', answer: { source: 'staff', by: { label: 'Dana' }, wordingVersion: 'v1 en-US' } });
      expect((await consent.standing({ phone: OLAF, country: 'DE' }, 'text-service')).event).toMatchObject({ wording: WORDS, staffLabel: 'Dana' });
      const ticked = (await events()).length;
      expect((await s.change('dana', 'contacts', 2, { name: 'Olaf B.' })).statusCode).toBe(200);
      expect(await events()).toHaveLength(ticked);
      expect((await s.change('dana', 'contacts', 2, { may_text: false })).statusCode).toBe(200);
      expect((await standing('tom', 2)).service).toMatchObject({ state: 'no', answer: { source: 'staff' } });
      expect(await events()).toHaveLength(ticked + 1);
    });
  });
}
