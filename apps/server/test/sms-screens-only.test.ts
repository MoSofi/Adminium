// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A till's own roles and texts, on the whole server over SQLite, Postgres and
 * MySQL source databases.
 *
 * A cashier opens the app's screens and never the dashboard (screens-only).
 * Those screens show whether texts can go, a guest's standing, a box the
 * cashier ticks for the guest's yes, and a text sent to the guest. A cashier
 * whose app's role grants the record and its texts may do each of them; one
 * whose role does not is refused, as anyone else is, and the dashboard's own
 * texts routes stay closed to them all.
 */
import { settingsRepo } from '@adminium/meta';
import { SMS_WORDS_FLOOR } from '@adminium/manifest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createSmsAccountStore } from '../src/sms/account-store.js';
import { createSmsService } from '../src/sms/index.js';
import { TEST_SECRET } from './helpers.js';
import { stubProvider } from './sms-send.helpers.js';
import { LEGS, said, wholeServer, type WholeServer } from './whole-server.helpers.js';
import { twilioRepliesHeard } from './helpers/sms-heard.js';

vi.mock('../src/version.js', async (original) => ({ ...(await original<typeof import('../src/version.js')>()), APP_VERSION: SMS_WORDS_FLOOR }));

const FROM = '+14155550100';
const KEY = (n: number) => `${'t'.repeat(31)}${String(n)}`;
const WORDS = 'May we text you when your table is ready?';

function till(): Record<string, unknown> {
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'tillz',
    name: 'Till',
    version: '1.0.0',
    publisher: { id: 'adminium', name: 'Adminium' },
    license: 'AGPL-3.0-only',
    description: { key: 'd', fallback: 'A till.' },
    categories: ['operations'],
    compatibility: { minAdminiumVersion: SMS_WORDS_FLOOR, engines: ['postgres', 'mysql', 'sqlite'] },
    requiredSchema: {
      prefixed: true,
      tables: [
        {
          ref: 'guests',
          keyField: 'name',
          columns: [
            { ref: 'id', type: 'int', role: 'pk' },
            { ref: 'name', type: 'text', maxLength: 80 },
            { ref: 'phone', type: 'text', maxLength: 40, nullable: true, rules: { personal: true } },
          ],
        },
      ],
    },
    people: [{ table: 'guests', kind: 'people', name: 'name', phone: 'phone' }],
    roles: [
      // The cashier changes a guest and texts the app's people.
      { key: 'cashier', name: 'Cashier', screensOnly: true, permissions: ['app:@:staff', 'table:@guests:read', 'table:@guests:update', 'texts:@:reply'] },
      // The porter reads a guest, and nothing more.
      { key: 'porter', name: 'Porter', screensOnly: true, permissions: ['app:@:staff', 'table:@guests:read'] },
      // The greeter opens the screens with no grant on the guests.
      { key: 'greeter', name: 'Greeter', screensOnly: true, permissions: ['app:@:staff'] },
    ],
    pages: [{ ref: 'tillz-guests', template: 'page-crud', title: { key: 't', fallback: 'Guests' }, nav: { group: 'till', icon: 'home', order: 1 }, bindings: { rows: 'guests' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html' }],
  };
}

type StandingReply = { data: { app: string | null; ready: boolean; masked: string | null; service: { state: string; answer: { source: string; by: { label: string } | null } | null } } };

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`a till's screens-only roles and texts, on ${dialect}`, () => {
    let s: WholeServer;
    const provider = stubProvider('twilio', '', []);
    const name = () => s.t('guests').split('.').pop()!;
    const ask = (row: number) => ({ connection: s.connectionId, table: name(), row: String(row), column: 'phone' });
    const query = (row: number) => new URLSearchParams(ask(row)).toString();
    const yes = (row: number) => ({ ...ask(row), state: 'yes', how: 'in-person', wording: { text: WORDS, version: 'v1' } });

    beforeAll(async () => {
      vi.stubGlobal('fetch', provider.fetchStub);
      s = await wholeServer(dialect, till(), { people: { cara: ['cashier'], piet: ['porter'], gwen: ['greeter'] } });
      await s.rows(`insert into ${name()} (id, name, phone) values (1, 'Ines', '+4915123456789'), (2, 'Olaf', '+4915123456780')`);
      await textsCanGo(s);
    }, 240_000);

    afterAll(async () => {
      await s?.close();
      vi.unstubAllGlobals();
    });

    it('a cashier whose role grants the guest and its texts reads whether texts can go and the standing, records a yes, and sends', async () => {
      const ready = await s.get('cara', '/api/v1/texts/ready');
      expect(ready.statusCode, ready.body).toBe(200);
      expect(ready.json()).toEqual({ data: { ready: true } });

      const before = await s.get('cara', `/api/v1/texts/consent?${query(1)}`);
      expect(before.statusCode, before.body).toBe(200);
      expect((before.json() as StandingReply).data).toMatchObject({ app: 'tillz', ready: true, masked: '+49 ••• 789', service: { state: 'not-asked' } });

      const recorded = await s.send('cara', 'POST', '/api/v1/texts/consent', yes(1));
      expect(recorded.statusCode, recorded.body).toBe(200);
      expect((recorded.json() as StandingReply).data.service).toMatchObject({ state: 'yes', answer: { source: 'staff', by: { label: 'Cara' } } });

      const sent = await s.send('cara', 'POST', '/api/v1/texts/send', { ...ask(1), body: 'Your table is ready.', clientKey: KEY(1) });
      expect(sent.statusCode, sent.body).toBe(200);
      // Sent, or held to the end of the guest's quiet hours by the clock this runs at: never refused.
      expect(['queued', 'held']).toContain((sent.json() as { data: { result: { outcome: string } } }).data.result.outcome);
      // The number never comes back.
      expect(sent.body).not.toContain('5123456789');

      // Their app's conversations, which their role's `texts:@:reply` opens.
      const threads = await s.get('cara', '/api/v1/texts/threads');
      expect(threads.statusCode, threads.body).toBe(200);
    });

    it('a cashier whose role reads the guest only reads: no yes, no text, no conversations', async () => {
      expect(said(await s.get('piet', '/api/v1/texts/ready'))).toBe('ok');
      expect(said(await s.get('piet', `/api/v1/texts/consent?${query(2)}`))).toBe('ok');
      expect(said(await s.send('piet', 'POST', '/api/v1/texts/consent', yes(2)))).toBe('403 FORBIDDEN');
      expect(said(await s.send('piet', 'POST', '/api/v1/texts/send', { ...ask(2), body: 'Your table is ready.', clientKey: KEY(2) }))).toBe('403 FORBIDDEN');
      expect(said(await s.get('piet', '/api/v1/texts/threads'))).toBe('403 APP_SCREENS_ONLY');
    });

    it('a cashier whose role has no grant on the guests finds no guest there', async () => {
      expect(said(await s.get('gwen', `/api/v1/texts/consent?${query(2)}`))).toBe('404 NOT_FOUND');
      expect(said(await s.send('gwen', 'POST', '/api/v1/texts/consent', yes(2)))).toBe('404 NOT_FOUND');
      expect(said(await s.send('gwen', 'POST', '/api/v1/texts/send', { ...ask(2), body: 'Your table is ready.', clientKey: KEY(3) }))).toBe('404 NOT_FOUND');
    });

    it('keeps the dashboard\'s own texts routes closed to every screens-only role', async () => {
      for (const who of ['cara', 'piet', 'gwen']) {
        expect([who, said(await s.get(who, '/api/v1/texts/replies'))]).toEqual([who, '403 APP_SCREENS_ONLY']);
        expect([who, said(await s.send(who, 'PUT', '/api/v1/texts/replies/tillz', { replies: 'on' }))]).toEqual([who, '403 APP_SCREENS_ONLY']);
      }
    });
  });
}

/** Texts connected and given a sender, so they can go. */
async function textsCanGo(s: WholeServer): Promise<void> {
  await settingsRepo(s.meta).set('system.publicOrigin', 'https://till.lumen.example', { updatedBy: null });
  await twilioRepliesHeard(s.meta, { secret: TEST_SECRET, origin: 'https://till.lumen.example', accountSid: `AC${'cd'.repeat(16)}` });
  const sms = createSmsService({ store: createSmsAccountStore(s.meta), secret: TEST_SECRET, stopList: { isStopped: async () => false, recordProviderOptOut: async () => undefined } });
  await sms.connect({ provider: 'twilio', accountSid: `AC${'cd'.repeat(16)}`, authToken: 'made-up-token-for-these-tests' }, null);
  await sms.setSending({ sender: { kind: 'number', value: FROM }, defaultCountry: 'DE' }, null);
}
