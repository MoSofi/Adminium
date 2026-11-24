// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Marketing texts are locked in this release (`sms/marketing/availability.ts`),
 * on SQLite, Postgres and MySQL: the preflight names the lock first, a run
 * cannot be made, and recording a German yes mails no confirmation. The
 * unlocked behaviour is `sms-marketing-routes.test.ts`.
 */
import { SMS_WORDS_FLOOR } from '@adminium/manifest';
import { settingsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { TEXT_MARKETING_AVAILABLE } from '../src/sms/marketing/availability.js';
import { preflight } from '../src/sms/marketing/preflight.js';
import { LEGS, wholeServer, type Reply, type WholeServer } from './whole-server.helpers.js';
import { stubProvider } from './sms-send.helpers.js';

vi.mock('../src/version.js', async (original) => ({ ...(await original<typeof import('../src/version.js')>()), APP_VERSION: SMS_WORDS_FLOOR }));

const DE_DORA = '+4915123456701';
const WORDING = { text: 'Text me offers from Wren House.', version: 'v1' };

function app(): Record<string, unknown> {
  const id = { ref: 'id', type: 'int', role: 'pk' };
  const text = (ref: string, maxLength = 120, more: Record<string, unknown> = {}) => ({ ref, type: 'text', maxLength, nullable: true, ...more });
  return {
    kind: 'app',
    manifestVersion: 1,
    key: 'stays',
    name: 'Stays',
    version: '0.1.0',
    publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
    license: 'AGPL-3.0-only',
    description: { key: 'mft.stays.desc', fallback: 'A small hotel.' },
    categories: ['crm'],
    compatibility: { minAdminiumVersion: SMS_WORDS_FLOOR, engines: ['postgres', 'mysql', 'sqlite'] },
    navGroups: [{ key: 'stays', label: { 'en-US': 'Stays' }, order: 1 }],
    requiredSchema: {
      prefixed: true,
      tables: [{ ref: 'guests', keyField: 'name', columns: [id, text('name'), text('mobile', 32, { rules: { personal: true } }), text('email', 254, { rules: { personal: true } }), text('language', 8)] }],
    },
    people: [{ table: 'guests', kind: 'people', phone: 'mobile', email: 'email', name: 'name', language: 'language' }],
    textTemplates: [{ key: 'stays-autumn', name: 'Autumn stays', locales: { 'en-US': { body: '{{business}}: Hi {{first_name}}, autumn stays are 15% off.' } } }],
    pages: [{ ref: 'stays-guests', template: 'page-crud', title: { key: 't.guests', fallback: 'Guests' }, nav: { group: 'stays', icon: 'list', order: 1 }, bindings: { rows: 'guests' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { stays: '/' } }],
  };
}

describe('the marketing lock', () => {
  it('is on in this release', () => {
    expect(TEXT_MARKETING_AVAILABLE).toBe(false);
  });

  it('comes first in the preflight, whatever else is right', async () => {
    const checked = await preflight({
      sms: { view: async () => ({ keyReadable: true, sender: { kind: 'number', value: '+447400000000' } }) } as never,
      replyReach: async () => ({ state: 'ready', canReceiveStop: true }),
      operator: () => ({ allowed: true }),
    });
    expect(checked.ok).toBe(false);
    expect(checked.refusals).toEqual([{ reason: 'marketing-not-yet-available', detail: null }]);
  });
});

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`locked marketing texts on the whole server, on ${dialect}`, () => {
    let s: WholeServer;
    let dora = '';
    const provider = stubProvider('twilio', 'unused');
    const table = () => s.t('guests');
    const data = (res: Reply) => (res.json() as { data: Record<string, unknown> }).data;

    beforeAll(async () => {
      vi.stubGlobal('fetch', provider.fetchStub);
      s = await wholeServer(dialect, app(), { smtp: true });
      await settingsRepo(s.meta).set('privacy.businessName', 'Wren House', { updatedBy: null });
      await settingsRepo(s.meta).set('system.publicOrigin', 'https://stays.example', { updatedBy: null });
      const made = await s.make('owner', 'guests', { name: 'Dora Brandt', mobile: DE_DORA, email: 'dora@stays.example', language: 'de' });
      expect(made.statusCode, made.body).toBeLessThan(300);
      dora = String((made.json() as { data: { id: unknown } }).data.id);
    }, 240_000);

    afterAll(async () => {
      await s?.close();
      vi.unstubAllGlobals();
    });

    it('the setup names the lock, and a run is refused with it', async () => {
      const setup = data(await s.get('owner', '/api/v1/sms/marketing/setup'));
      expect((setup['preflight'] as { refusals: { reason: string }[] }).refusals[0]).toEqual({ reason: 'marketing-not-yet-available', detail: null });
      const made = await s.send('owner', 'POST', '/api/v1/sms/marketing/runs', { name: 'Autumn', templateKey: 'stays-autumn', audience: { connectionId: s.connectionId, table: table() } });
      expect(made.statusCode).toBeGreaterThanOrEqual(400);
      expect(made.body).toContain('marketing-not-yet-available');
    });

    it('a German yes is kept, and no confirmation mail goes', async () => {
      const person = { connectionId: s.connectionId, table: table(), key: dora };
      const res = await s.send('owner', 'POST', '/api/v1/sms/marketing/consent', { ...person, how: 'phone', wording: WORDING });
      expect(res.statusCode, res.body).toBe(200);
      expect(data(res)).toMatchObject({ state: 'yes', confirmed: false, needsConfirm: true });
      expect(data(await s.send('owner', 'POST', '/api/v1/sms/marketing/consent/confirm-request', person))).toEqual({ outcome: 'not-yet-available' });
      await s.jobs();
      expect((await s.emails()).filter((one) => one.templateKey === 'text-marketing-confirm')).toEqual([]);
      expect(provider.posts).toEqual([]);
    });
  });
}
