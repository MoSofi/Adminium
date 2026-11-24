// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Studio → Texts beside the provider card: the limit and hours, Activity and
 * settling an unknown, the do-not-text list, and text templates. Under the
 * real grants: `sms.manage`, the desk's `privacy.people`, and neither.
 */
import BetterSqlite3 from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { apiKeysRepo, auditRepo, createSqliteMetaDb, firstRun, permissionsRepo, rolesRepo, settingsRepo, textTemplatesRepo, usersRepo, type MetaDb, type User } from '@adminium/meta';

import { errorEnvelope } from '../src/errors.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { generateApiKey } from '../src/rbac/api-keys.js';
import { PERMISSIONS } from '../src/rbac/permissions.js';
import { smsConsoleRoutes } from '../src/sms/console-routes.js';
import { createTextConsentService, type TextConsentService } from '../src/sms/consent/index.js';
import { createTextSendStore, type TextSendStore } from '../src/sms/send/index.js';
import type { SmsAccountView } from '../src/sms/service.js';

const SECRET = 'an-sms-console-test-secret-of-length';
const NOW = Date.UTC(2026, 6, 28, 13, 5);

describe('Texts console routes', () => {
  let meta: MetaDb;
  let app: FastifyInstance;
  let owner: User;
  let manager: User;
  let desk: User;
  let clerk: User;
  let managerRole: string;
  let consent: TextConsentService;
  let store: TextSendStore;
  let view: SmsAccountView | null;
  let deskApps: ReadonlySet<string> | null;

  beforeEach(async () => {
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const users = usersRepo(meta);
    const roles = rolesRepo(meta);
    owner = await users.create({ email: 'owner@adminium.test', name: 'Owen Tremayne', status: 'active' });
    await roles.assignToUser(owner.id, (await roles.findBySlug('super-admin'))!.id);
    const role = await roles.create({ slug: 'texts', name: 'Texts' });
    managerRole = role.id;
    await permissionsRepo(meta).grant(role.id, 'system', 'sms.manage', { allowed: true });
    manager = await users.create({ email: 'manager@adminium.test', name: 'Mo Manager', status: 'active' });
    await roles.assignToUser(manager.id, role.id);
    const deskRole = await roles.create({ slug: 'desk', name: 'Front desk' });
    await permissionsRepo(meta).grant(deskRole.id, 'system', 'privacy.people', { allowed: true });
    desk = await users.create({ email: 'desk@adminium.test', name: 'Maeve R.', status: 'active' });
    await roles.assignToUser(desk.id, deskRole.id);
    clerk = await users.create({ email: 'clerk@adminium.test', name: 'Tom Clerk', status: 'active' });
    await roles.assignToUser(clerk.id, (await roles.create({ slug: 'clerk', name: 'Clerk' })).id);

    consent = createTextConsentService({ meta, secret: SECRET, now: () => NOW });
    store = createTextSendStore(meta);
    view = null;
    deskApps = null;

    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error: { statusCode?: number; code?: string; message: string; details?: unknown }, request, reply) => {
      void reply.status(error.statusCode ?? 500).send(errorEnvelope(error.code ?? 'INTERNAL', error.message, request.id, error.details));
    });
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id !== 'string') return;
      const user = await usersRepo(meta).findById(id);
      if (user !== null) (request as unknown as { user: object }).user = { id: user.id, name: user.name, email: user.email };
    });
    await app.register(rbacPlugin, { meta });
    await app.register(
      async (api) =>
        api.register(
          smsConsoleRoutes({
            meta,
            service: { view: async () => view },
            consent,
            deliveries: store,
            texts: () => ({ resolveUnknown: (id, to) => store.resolveUnknown(id, to, NOW) }),
            manageGrant: PERMISSIONS.smsManage,
            peopleGrant: PERMISSIONS.privacyPeople,
            // The desk's reach, as `privacyScopeOf` gives it for an app's role.
            privacyScope: async (userId) => (userId === desk.id ? { manage: false, apps: deskApps } : null),
            now: () => NOW,
          }),
        ),
      { prefix: '/api/v1' },
    );
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await meta.db.destroy();
  });

  const call = (user: User | null, method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url: `/api/v1${url}`, headers: user === null ? {} : { 'x-test-user-id': user.id }, ...(payload === undefined ? {} : { payload }) });

  async function unknownDelivery(): Promise<string> {
    const { row } = await store.create({ claimHash: 'claim-1', messageHash: 'message-1', phone: null, phoneMasked: '+1 ••• 177', textClass: 'service', estimatedSegments: 1, encoding: 'gsm-7', createdAt: NOW - 60_000, reportTarget: { app: 'hotel', connectionId: 'c1', table: 'stays', pk: { id: 7 } } });
    const moved = await store.settle(row!.id, row!.version, { state: 'unknown', reason: 'timeout', at: NOW - 30_000, mayHaveGone: { at: NOW - 60_000, account: 'AC1' }, provider: 'twilio' });
    return moved!.id;
  }

  async function seedTemplate(): Promise<void> {
    const repo = textTemplatesRepo(meta);
    await repo.upsert('hotel-prearrival', 'en_US', { name: 'Before you arrive', body: '{{hotel}}: Hi {{name}}, we expect you on {{date}}.', enabled: true, managedBy: 'hotel', installId: 'i1', contentHash: null });
    await repo.upsert('hotel-prearrival', 'de_DE', { name: 'Vor Ihrer Ankunft', body: '{{hotel}}: Hallo {{name}}.', enabled: true, managedBy: 'hotel', installId: 'i1', contentHash: null });
  }

  describe('who may do what', () => {
    it('refuses everything to someone with neither grant, and to nobody', async () => {
      const routes: ['GET' | 'PUT' | 'POST' | 'DELETE', string, object | undefined][] = [
        ['GET', '/sms/sending-limits', undefined],
        ['PUT', '/sms/sending-limits', { dailyLimit: 600, serviceHours: { from: '08:00', to: '21:00' } }],
        ['GET', '/sms/deliveries', undefined],
        ['POST', '/sms/deliveries/x/settle', { answer: 'went' }],
        ['GET', '/sms/stop-list', undefined],
        ['POST', '/sms/stop-list/lookup', { phone: '+12075550169' }],
        ['POST', '/sms/stop-list', { phone: '+12075550169', asked: 'phone' }],
        ['DELETE', '/sms/stop-list/x', undefined],
        ['GET', '/sms/text-templates', undefined],
        ['PUT', '/sms/text-templates/k/en_US', { body: 'Hi' }],
      ];
      for (const [method, url, payload] of routes) {
        expect((await call(clerk, method, url, payload)).statusCode, `${method} ${url}`).toBe(403);
        expect((await call(null, method, url, payload)).statusCode, `${method} ${url}`).toBe(401);
      }
    });

    it('lets the desk read Activity, look up one number and record a stop, and nothing else', async () => {
      expect((await call(desk, 'GET', '/sms/deliveries')).statusCode).toBe(200);
      expect((await call(desk, 'POST', '/sms/stop-list/lookup', { phone: '+12075550169' })).statusCode).toBe(200);
      expect((await call(desk, 'POST', '/sms/stop-list', { phone: '+12075550169', asked: 'phone' })).statusCode).toBe(200);
      // The whole list holds every app's customers: never a desk's to page through.
      expect((await call(desk, 'GET', '/sms/stop-list')).statusCode).toBe(403);
      const id = await unknownDelivery();
      expect((await call(desk, 'POST', `/sms/deliveries/${id}/settle`, { answer: 'went' })).statusCode).toBe(403);
      expect((await call(desk, 'GET', '/sms/sending-limits')).statusCode).toBe(403);
      expect((await call(desk, 'GET', '/sms/text-templates')).statusCode).toBe(403);
    });

    it('refuses every change to an API key, even one holding the grant', async () => {
      const generated = generateApiKey();
      await apiKeysRepo(meta).create({ name: 'script', prefix: generated.prefix, tokenHash: generated.tokenHash, roleId: managerRole });
      const answer = await app.inject({ method: 'PUT', url: '/api/v1/sms/sending-limits', headers: { authorization: `Bearer ${generated.key}` }, payload: { dailyLimit: 9000, serviceHours: { from: '08:00', to: '21:00' } } });
      expect(answer.statusCode).toBe(403);
    });

    it('refuses an API key the stop list, a look-up and Activity, even one holding the grant', async () => {
      await consent.stop.add({ phone: '+12075550169', reason: 'text-stop', origin: '+15005550006' });
      const generated = generateApiKey();
      await apiKeysRepo(meta).create({ name: 'script', prefix: generated.prefix, tokenHash: generated.tokenHash, roleId: managerRole });
      const headers = { authorization: `Bearer ${generated.key}` };
      for (const [method, url, payload] of [['GET', '/sms/stop-list', undefined], ['GET', '/sms/deliveries', undefined], ['POST', '/sms/stop-list/lookup', { phone: '+12075550169' }]] as const) {
        const answer = await app.inject({ method, url: `/api/v1${url}`, headers, ...(payload === undefined ? {} : { payload }) });
        expect(answer.statusCode, url).toBe(403);
        expect(answer.body).not.toContain('2075550169');
      }
    });
  });

  describe('the daily limit and the hours', () => {
    it('reads the defaults until they are saved, then the saved ones, with today’s count', async () => {
      const first = (await call(manager, 'GET', '/sms/sending-limits')).json();
      expect(first.data).toMatchObject({ dailyLimit: 500, serviceHours: { from: '08:00', to: '21:00' }, usedToday: 0, warnAt: 400, dayZone: 'UTC' });
      const saved = await call(manager, 'PUT', '/sms/sending-limits', { dailyLimit: 250, serviceHours: { from: '09:30', to: '20:00' } });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().data).toMatchObject({ dailyLimit: 250, serviceHours: { from: '09:30', to: '20:00' }, warnAt: 200 });
      expect(await settingsRepo(meta).get('sms.sendPolicy')).toEqual({ dailyLimit: 250, serviceHours: { from: '09:30', to: '20:00' } });
      expect(JSON.stringify(await auditRepo(meta).list({ limit: 5 }))).toContain('sms.limits.saved');
    });

    it('refuses no limit, a limit past the most, and hours that start where they end', async () => {
      for (const body of [{ dailyLimit: 0, serviceHours: { from: '08:00', to: '21:00' } }, { dailyLimit: 100_001, serviceHours: { from: '08:00', to: '21:00' } }, { dailyLimit: 10, serviceHours: { from: '08:00', to: '08:00' } }, { dailyLimit: 10, serviceHours: { from: '8:00', to: '21:00' } }]) {
        expect((await call(manager, 'PUT', '/sms/sending-limits', body)).statusCode).toBe(400);
      }
    });
  });

  describe('Activity', () => {
    it('lists rows with no number and no words, newest first', async () => {
      await unknownDelivery();
      const answer = await call(manager, 'GET', '/sms/deliveries');
      expect(answer.statusCode).toBe(200);
      const rows = answer.json().data as Record<string, unknown>[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ phoneMasked: '+1 ••• 177', state: 'unknown', reason: 'timeout', provider: 'twilio', source: { app: 'hotel', table: 'stays' } });
      expect(answer.body).not.toContain('"pk"');
    });

    it('gives a desk only the texts of the apps its roles reach, and audits each read', async () => {
      for (const [n, app] of [[1, 'hotel'], [2, 'clinic'], [3, null]] as const) {
        await store.create({ claimHash: `claim-${n}`, messageHash: `message-${n}`, phone: null, phoneMasked: '+1 ••• 177', textClass: 'service', estimatedSegments: 1, encoding: 'gsm-7', createdAt: NOW - n * 1000, reportTarget: null, about: app === null ? null : { app, template: 'reminder' } });
      }
      expect(((await call(desk, 'GET', '/sms/deliveries')).json().data as unknown[]).length).toBe(3);
      deskApps = new Set(['hotel']);
      const scoped = (await call(desk, 'GET', '/sms/deliveries')).json().data as { id: string }[];
      expect(scoped).toHaveLength(1);
      deskApps = new Set();
      expect(((await call(desk, 'GET', '/sms/deliveries')).json().data as unknown[]).length).toBe(0);
      expect(((await call(manager, 'GET', '/sms/deliveries')).json().data as unknown[]).length).toBe(3);
      const audit = JSON.stringify(await auditRepo(meta).list({ limit: 20 }));
      expect(audit).toContain('sms.deliveries.read');
      expect(audit).toContain('"apps":["hotel"]');
    });

    it('lets sms.manage settle an unknown once, and says so when it is already settled', async () => {
      const id = await unknownDelivery();
      const settled = await call(manager, 'POST', `/sms/deliveries/${id}/settle`, { answer: 'not-sent' });
      expect(settled.statusCode).toBe(200);
      expect(settled.json().data.state).toBe('checked-not-sent');
      expect((await call(manager, 'POST', `/sms/deliveries/${id}/settle`, { answer: 'went' })).statusCode).toBe(409);
      expect((await call(manager, 'POST', '/sms/deliveries/nope/settle', { answer: 'went' })).statusCode).toBe(404);
      expect(JSON.stringify(await auditRepo(meta).list({ limit: 5 }))).toContain('sms.delivery.checked-not-sent');
    });
  });

  describe('the do-not-text list', () => {
    it('records a request made to the business, once, by the person signed in', async () => {
      const first = await call(desk, 'POST', '/sms/stop-list', { phone: '+1 207 555 0169', asked: 'email' });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ added: true, data: { phone: '+12075550169', reason: 'staff', origin: 'email', addedBy: 'Maeve R.' } });
      const again = await call(manager, 'POST', '/sms/stop-list', { phone: '+12075550169', asked: 'phone' });
      expect(again.json().added).toBe(false);
      expect(await consent.stop.has('+12075550169', null)).toBe(true);
      const list = (await call(manager, 'GET', '/sms/stop-list')).json();
      expect(list.data).toHaveLength(1);
    });

    it('audits a read of the list by its count and filter, never a number', async () => {
      await consent.stop.add({ phone: '+12075550169', reason: 'text-stop', origin: '+15005550006' });
      expect((await call(manager, 'GET', '/sms/stop-list?reason=text-stop')).statusCode).toBe(200);
      const rows = (await auditRepo(meta).list({ limit: 5 })).filter((row) => row.action === 'sms.stop-list.read');
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows)).toContain('"entries":1');
      expect(JSON.stringify(rows)).toContain('"reason":"text-stop"');
      expect(JSON.stringify(rows)).not.toContain('2075550169');
    });

    it('a desk looks up one number: its entry or none, each look-up audited by the mask', async () => {
      view = { defaultCountry: 'US' } as SmsAccountView;
      await consent.stop.add({ phone: '+12075550169', reason: 'text-stop', origin: '+15005550006' });
      await consent.stop.add({ phone: '+12075550170', reason: 'text-stop', origin: '+15005550006' });
      const found = await call(desk, 'POST', '/sms/stop-list/lookup', { phone: '(207) 555-0169' });
      expect(found.json()).toMatchObject({ data: { phone: '+12075550169', reason: 'text-stop' } });
      expect(found.body).not.toContain('2075550170');
      expect((await call(desk, 'POST', '/sms/stop-list/lookup', { phone: '+12075550199' })).json()).toEqual({ data: null });
      const rows = (await auditRepo(meta).list({ limit: 10 })).filter((row) => row.action === 'sms.stop.looked-up');
      expect(rows).toHaveLength(2);
      expect(JSON.stringify(rows)).toContain('+1 ••• 169');
      expect(JSON.stringify(rows)).not.toContain('2075550169');
    });

    it('reads a local number in the account’s country, and refuses one it cannot read', async () => {
      view = { defaultCountry: 'US' } as SmsAccountView;
      expect((await call(desk, 'POST', '/sms/stop-list', { phone: '(207) 555-0169', asked: 'in-person' })).json().data.phone).toBe('+12075550169');
      expect((await call(desk, 'POST', '/sms/stop-list', { phone: 'not a number', asked: 'phone' })).statusCode).toBe(422);
    });

    it('lets only the Super Admin take a number off', async () => {
      const id = (await call(desk, 'POST', '/sms/stop-list', { phone: '+12075550169', asked: 'phone' })).json().data.id as string;
      expect((await call(manager, 'DELETE', `/sms/stop-list/${id}`)).statusCode).toBe(403);
      expect((await call(owner, 'DELETE', `/sms/stop-list/${id}`)).statusCode).toBe(204);
      expect(await consent.stop.has('+12075550169', null)).toBe(false);
      expect((await call(owner, 'DELETE', `/sms/stop-list/${id}`)).statusCode).toBe(404);
    });
  });

  describe('text templates', () => {
    it('lists each template with its languages, and whether a provider is connected', async () => {
      await seedTemplate();
      const answer = (await call(manager, 'GET', '/sms/text-templates')).json();
      expect(answer.connected).toBe(false);
      expect(answer.data).toHaveLength(1);
      expect(answer.data[0]).toMatchObject({ key: 'hotel-prearrival', name: 'Before you arrive', app: 'hotel' });
      expect(answer.data[0].languages.map((one: { locale: string }) => one.locale)).toEqual(['de_DE', 'en_US']);
    });

    it('saves a language, and refuses words a text may not carry', async () => {
      await seedTemplate();
      const saved = await call(manager, 'PUT', '/sms/text-templates/hotel-prearrival/da_DK', { body: '{{hotel}}: Hej {{name}}.' });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().data.languages.find((one: { locale: string }) => one.locale === 'da_DK')).toMatchObject({ body: '{{hotel}}: Hej {{name}}.', enabled: true });
      const yes = await call(manager, 'PUT', '/sms/text-templates/hotel-prearrival/en_US', { body: 'Reply YES to confirm.' });
      expect(yes.statusCode).toBe(422);
      expect(yes.json().error.details.reason).toBe('asks-for-yes');
      const code = await call(manager, 'PUT', '/sms/text-templates/hotel-prearrival/en_US', { body: 'Your code is {{signInLink}}' });
      expect(code.json().error.details.reason).toBe('credential-in-template');
      expect((await call(manager, 'PUT', '/sms/text-templates/nope/en_US', { body: 'Hi' })).statusCode).toBe(404);
    });

    it('empties a language, but never US English', async () => {
      await seedTemplate();
      const emptied = await call(manager, 'DELETE', '/sms/text-templates/hotel-prearrival/de_DE');
      expect(emptied.statusCode).toBe(200);
      expect(emptied.json().data.languages.map((one: { locale: string }) => one.locale)).toEqual(['en_US']);
      expect((await call(manager, 'DELETE', '/sms/text-templates/hotel-prearrival/en_US')).statusCode).toBe(422);
    });
  });
});
