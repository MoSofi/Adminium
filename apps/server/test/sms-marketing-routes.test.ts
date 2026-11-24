// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Texts → Marketing on the whole server, on SQLite, Postgres and
 * MySQL: who may reach the routes, what the preflight refuses and why, a
 * person's marketing yes recorded by staff, double opt-in by the mail's link
 * on the mail door's page and in person, a run made and started through the
 * real job queue, its numbers, and a cancel. The provider is a stub written
 * from Twilio's documentation, so no text can leave.
 */
import { SMS_WORDS_FLOOR } from '@adminium/manifest';
import { apiKeysRepo, auditRepo, permissionsRepo, rolesRepo, settingsRepo } from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { generateApiKey } from '../src/rbac/api-keys.js';
import { LEGS, said, wholeServer, type Reply, type WholeServer } from './whole-server.helpers.js';
import { stubProvider } from './sms-send.helpers.js';
import { twilioRepliesHeard } from './helpers/sms-heard.js';
import { TEST_SECRET } from './helpers.js';

vi.mock('../src/version.js', async (original) => ({ ...(await original<typeof import('../src/version.js')>()), APP_VERSION: SMS_WORDS_FLOOR }));
// What marketing does once the release offers it: the lock itself is `sms-marketing-lock.test.ts`.
vi.mock('../src/sms/marketing/availability.js', () => ({ TEXT_MARKETING_AVAILABLE: true }));

const ORIGIN = 'https://stays.example';
const GB_ANNA = '+447400123451';
const GB_BEN = '+447400123452';
const DE_DORA = '+4915123456701';
const DE_EMIL = '+4915123456702';
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
    roles: [{ key: 'clerk', name: 'Clerk', permissions: ['table:@guests:read', 'page:@stays-guests:view'] }],
    pages: [{ ref: 'stays-guests', template: 'page-crud', title: { key: 't.guests', fallback: 'Guests' }, nav: { group: 'stays', icon: 'list', order: 1 }, bindings: { rows: 'guests' } }],
    frontends: [{ side: 'staff', kind: 'spa', entry: 'index.html', routes: { stays: '/' } }],
  };
}

for (const [dialect, reachable] of LEGS) {
  describe.skipIf(!reachable)(`marketing texts on the whole server, on ${dialect}`, () => {
    let s: WholeServer;
    let bearer: Record<string, string> = {};
    const provider = stubProvider('twilio', 'unused');
    const keyOf: Record<string, string> = {};
    const table = () => s.t('guests');
    const who = (name: string) => ({ connectionId: s.connectionId, table: table(), key: keyOf[name]! });
    const data = (res: Reply) => (res.json() as { data: Record<string, unknown> }).data;

    beforeAll(async () => {
      vi.stubGlobal('fetch', provider.fetchStub);
      s = await wholeServer(dialect, app(), { people: { clerk: ['clerk'] }, smtp: true });
      await settingsRepo(s.meta).set('privacy.businessName', 'Wren House', { updatedBy: null });
      const roles = rolesRepo(s.meta);
      const scripted = await roles.create({ slug: 'scripted', name: 'Scripted' });
      await permissionsRepo(s.meta).grant(scripted.id, 'system', 'settings.manage', { allowed: true });
      const generated = generateApiKey();
      await apiKeysRepo(s.meta).create({ name: 'script', prefix: generated.prefix, tokenHash: generated.tokenHash, roleId: scripted.id });
      bearer = { authorization: `Bearer ${generated.key}` };
      for (const [name, mobile, email, language] of [
        ['Anna Fry', GB_ANNA, null, 'en'],
        ['Ben Ode', GB_BEN, null, 'en'],
        ['Dora Brandt', DE_DORA, 'dora@stays.example', 'de'],
        ['Emil Roth', DE_EMIL, null, 'de'],
      ] as const) {
        const made = await s.make('owner', 'guests', { name, mobile, email, language });
        expect(made.statusCode, made.body).toBeLessThan(300);
        keyOf[name.split(' ')[0]!] = String((made.json() as { data: { id: unknown } }).data.id);
      }
    }, 240_000);

    afterAll(async () => {
      await s?.close();
      vi.unstubAllGlobals();
    });

    it('the clerk, who may not send campaigns, and an API key are refused', async () => {
      expect(said(await s.get('clerk', '/api/v1/sms/marketing/setup'))).toBe('403 FORBIDDEN');
      expect(said(await s.send('clerk', 'POST', '/api/v1/sms/marketing/runs', { name: 'x', templateKey: 'stays-autumn', audience: { connectionId: s.connectionId, table: table() } }))).toBe('403 FORBIDDEN');
      expect(said(await s.send('clerk', 'POST', '/api/v1/sms/marketing/consent', { ...who('Anna'), how: 'in-person', wording: WORDING }))).toBe('403 FORBIDDEN');
      const res = await s.app.inject({ method: 'POST', url: '/api/v1/sms/marketing/runs', headers: bearer, payload: { name: 'x', templateKey: 'stays-autumn', audience: { connectionId: s.connectionId, table: table() } } });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { error: { details?: { reason?: string } } }).error.details?.reason).toBe('api-key');
    });

    it('with no provider and no public address, the preflight says both, and a run is refused', async () => {
      const setup = data(await s.get('owner', '/api/v1/sms/marketing/setup'));
      expect(setup['preflight']).toMatchObject({ ok: false, refusals: [{ reason: 'not-connected' }] });
      expect(setup['tables']).toEqual([expect.objectContaining({ table: table(), phones: 'readable', appKey: 'stays' })]);
      expect(setup['templates']).toEqual([{ key: 'stays-autumn', name: 'Autumn stays', languages: ['en_US'] }]);
      expect(setup['countries']).toEqual({ noReplies: ['AE', 'CN', 'EG', 'SA', 'TW'], blockedCallingCodes: ['86'], doubleOptIn: ['DE'] });

      expect(said(await s.send('owner', 'PUT', '/api/v1/sms/account', { provider: 'twilio', accountSid: `AC${'ab'.repeat(16)}`, authToken: 'made-up-token-for-these-tests' }))).toBe('ok');
      expect(said(await s.send('owner', 'PUT', '/api/v1/sms/sending', { sender: { kind: 'number', value: '+14155550100' }, defaultCountry: 'GB' }))).toBe('ok');
      const refused = await s.send('owner', 'POST', '/api/v1/sms/marketing/runs', { name: 'Autumn', templateKey: 'stays-autumn', audience: { connectionId: s.connectionId, table: table() } });
      expect(said(refused)).toBe('409 TEXT_RUN_REFUSED');
      expect((refused.json() as { error: { details: { refusals: { reason: string; detail: string }[] } } }).error.details.refusals).toEqual([{ reason: 'marketing-without-replies', detail: 'not-set' }]);
    });

    it('staff record a marketing yes in the words they gave; a German one is confirmed in person or by the mail’s link', async () => {
      await settingsRepo(s.meta).set('system.publicOrigin', ORIGIN, { updatedBy: null });
      // A signed reply has reached the address: marketing may go.
      await twilioRepliesHeard(s.meta, { secret: TEST_SECRET, origin: ORIGIN, accountSid: `AC${'ab'.repeat(16)}` });
      for (const name of ['Anna', 'Ben']) {
        const res = await s.send('owner', 'POST', '/api/v1/sms/marketing/consent', { ...who(name), how: 'in-person', wording: WORDING });
        expect(res.statusCode, res.body).toBe(200);
        expect(data(res)).toMatchObject({ state: 'yes', confirmed: true, needsConfirm: false, country: 'GB' });
        expect(res.body).not.toContain('123451');
      }

      const emil = data(await s.send('owner', 'POST', '/api/v1/sms/marketing/consent', { ...who('Emil'), how: 'paper', wording: WORDING }));
      expect(emil).toMatchObject({ state: 'yes', confirmed: false, needsConfirm: true, canEmail: false });
      expect(data(await s.send('owner', 'POST', '/api/v1/sms/marketing/consent/confirm-request', who('Emil')))).toEqual({ outcome: 'no-email' });
      expect(data(await s.send('owner', 'POST', '/api/v1/sms/marketing/consent/confirm-in-person', { ...who('Emil'), how: 'in-person' }))).toEqual({ outcome: 'confirmed' });

      // Dora has an address: recording her yes mails her the confirmation at once.
      const dora = data(await s.send('owner', 'POST', '/api/v1/sms/marketing/consent', { ...who('Dora'), how: 'phone', wording: WORDING }));
      expect(dora).toMatchObject({ state: 'yes', confirmed: false, needsConfirm: true, canEmail: true, asked: { state: 'waiting' } });
      const mail = (await s.emails()).find((one) => one.templateKey === 'text-marketing-confirm');
      expect(mail?.to).toBe('dora@stays.example');
      expect(mail!.text).not.toContain('123456701');
      const link = /https:\/\/stays\.example(\/m\/t\/[A-Za-z0-9_~-]+)/.exec(mail!.text)?.[1];
      expect(link).toBeDefined();

      // The page: a GET shows the masked number and changes nothing; the button confirms.
      const page = await s.app.inject({ method: 'GET', url: link! });
      expect(page.statusCode).toBe(200);
      expect(page.headers['content-security-policy']).toContain("default-src 'none'");
      expect(page.body).not.toContain('<script');
      expect(page.body).toContain('+49');
      expect(page.body).not.toContain('123456701');
      expect(page.body).not.toMatch(/\bYES\b/);
      expect(data(await s.get('owner', `/api/v1/sms/marketing/consent?connectionId=${s.connectionId}&table=${table()}&key=${keyOf['Dora']!}`))).toMatchObject({ confirmed: false });
      const pressed = await s.app.inject({ method: 'POST', url: link!, payload: 'act=confirm', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
      expect(pressed.statusCode).toBe(200);
      expect(pressed.body).toContain('Bestätigt');
      expect(data(await s.get('owner', `/api/v1/sms/marketing/consent?connectionId=${s.connectionId}&table=${table()}&key=${keyOf['Dora']!}`))).toMatchObject({ confirmed: true });
      expect((await s.app.inject({ method: 'GET', url: `${link!.slice(0, -3)}abc` })).statusCode).toBe(404);
    });

    it('a run reaches who agreed, through the job queue, and can be cancelled', async () => {
      const preview = data(await s.send('owner', 'POST', '/api/v1/sms/marketing/preview', { templateKey: 'stays-autumn', audience: { connectionId: s.connectionId, table: table() } }));
      expect(preview).toMatchObject({ people: 4, canSend: 4, preflight: { ok: true } });
      const who = data(await s.send('owner', 'POST', '/api/v1/sms/marketing/preview/people', { audience: { connectionId: s.connectionId, table: table() }, reason: 'ok' }));
      expect((who['people'] as unknown[]).length).toBe(4);
      expect(JSON.stringify(who)).not.toContain('123451');
      const seen = (await auditRepo(s.meta).list({ limit: 20 })).filter((row) => row.action === 'sms.marketing.people.read');
      expect(seen).toHaveLength(1);
      expect(JSON.stringify(seen)).not.toContain('123451');

      const made = await s.send('owner', 'POST', '/api/v1/sms/marketing/runs', { name: 'Autumn', templateKey: 'stays-autumn', audience: { connectionId: s.connectionId, table: table() } });
      expect(made.statusCode, made.body).toBe(202);
      const runId = String(data(made)['id']);
      await s.jobs();
      const run = data(await s.get('owner', `/api/v1/sms/marketing/runs/${runId}`));
      expect(run['status']).toBe('done');
      // Each text went, or waits for its hours: which depends on the clock this test runs at.
      const totals = run['totals'] as { people: number; sent: number; sending: number };
      expect(totals.people).toBe(4);
      expect(totals.sent + totals.sending).toBe(4);
      const people = await s.get('owner', `/api/v1/sms/marketing/runs/${runId}/people`);
      expect((people.json() as { data: { state: string }[] }).data.map((one) => one.state)).toEqual(['handed', 'handed', 'handed', 'handed']);
      expect(people.body).not.toContain('123451');
      expect(((await s.get('owner', '/api/v1/sms/marketing/runs')).json() as { data: { id: string; createdByName: string }[] }).data).toEqual([expect.objectContaining({ id: runId, createdByName: 'Owner' })]);

      const cancelled = await s.send('owner', 'POST', `/api/v1/sms/marketing/runs/${runId}/cancel`);
      expect(data(cancelled)['status']).toBe('cancelled');
      expect(said(await s.send('owner', 'POST', `/api/v1/sms/marketing/runs/${runId}/cancel`))).toBe('409 CONFLICT');
    });

    it('a sender name is refused with its reason, and a German yes a form recorded is mailed by the short job', async () => {
      expect(said(await s.send('owner', 'PUT', '/api/v1/sms/sending', { sender: { kind: 'name', value: 'WrenHouse' }, defaultCountry: 'GB' }))).toBe('ok');
      const preview = data(await s.send('owner', 'POST', '/api/v1/sms/marketing/preview', { templateKey: 'stays-autumn', audience: { connectionId: s.connectionId, table: table() } }));
      expect(preview['preflight']).toMatchObject({ ok: false, refusals: [{ reason: 'marketing-from-name', detail: 'name' }] });
      expect(said(await s.send('owner', 'POST', '/api/v1/sms/marketing/runs', { name: 'Autumn', templateKey: 'stays-autumn', audience: { connectionId: s.connectionId, table: table() } }))).toBe('409 TEXT_RUN_REFUSED');

      // The job a public form's box queues runs, and mails nobody: Dora has confirmed already.
      await s.meta.db.insertInto('adminium_jobs').values({ id: 'job_01JTEXTCONFIRMJOB000000000', kind: 'sms.marketing-confirm', payload: JSON.stringify(who('Dora')), status: 'pending', priority: 0, runAt: 0, attempts: 0, maxAttempts: 3, createdAt: Date.now() } as never).execute();
      await s.jobs();
      const done = await s.meta.db.selectFrom('adminium_jobs').select(['status', 'lastError']).where('id', '=', 'job_01JTEXTCONFIRMJOB000000000').executeTakeFirst();
      expect(done).toEqual({ status: 'succeeded', lastError: null });
      expect((await s.emails()).filter((one) => one.templateKey === 'text-marketing-confirm')).toEqual([]);
    });
  });
}
