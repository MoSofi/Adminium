// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The SMS settings routes, registered here because `compose.ts` waits for the
 * merge. `sms.manage` joins the closed list of grants at merge too, so these
 * run on another grant no built-in role but the Super Admin holds. Provider
 * replies are stubs; no real provider is called.
 */
import BetterSqlite3 from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { apiKeysRepo, auditRepo, createSqliteMetaDb, firstRun, permissionsRepo, rolesRepo, usersRepo, type MetaDb, type User } from '@adminium/meta';

import { errorEnvelope } from '../src/errors.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { generateApiKey } from '../src/rbac/api-keys.js';
import { parsePermission } from '../src/rbac/permissions.js';
import { createSmsService, SMS_MANAGE_PERMISSION, smsRoutes, type SmsRoutesDeps } from '../src/sms/index.js';
import { memorySmsStore } from './helpers/sms-store.js';

const SECRET = 'an-sms-routes-test-secret-of-length';
const SID = `AC${'ab'.repeat(16)}`;
const TOKEN = 'made-up-token-for-these-tests';
const GRANT = 'system:payments:manage';
const NUMBER = '+447400123456';

const json = (status: number, value: unknown): Response => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

describe('SMS settings routes', () => {
  let meta: MetaDb;
  let app: FastifyInstance;
  let owner: User;
  let manager: User;
  let clerk: User;
  let managerRole: string;
  let calls: { url: string; method: string }[];
  let replies: string[];
  let store: ReturnType<typeof memorySmsStore>;
  let operatorAllowed: boolean;
  let networkFeatures: boolean;
  let origin: string | null;

  async function serve(extra: Partial<SmsRoutesDeps> = {}): Promise<FastifyInstance> {
    const server = Fastify({ logger: false });
    server.setValidatorCompiler(validatorCompiler);
    server.setSerializerCompiler(serializerCompiler);
    server.setErrorHandler((error: { statusCode?: number; code?: string; message: string; details?: unknown }, request, reply) => {
      void reply.status(error.statusCode ?? 500).send(errorEnvelope(error.code ?? 'INTERNAL', error.message, request.id, error.details));
    });
    server.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id !== 'string') return;
      const user = await usersRepo(meta).findById(id);
      if (user !== null) (request as unknown as { user: object }).user = { id: user.id, name: user.name, email: user.email };
    });
    server.addHook('onSend', async (_request, _reply, payload) => {
      if (typeof payload === 'string') replies.push(payload);
      return payload;
    });
    await server.register(rbacPlugin, { meta });
    const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET' });
      if ((init?.method ?? 'GET') === 'GET') return json(200, { sid: SID, friendly_name: 'owner@lumen.example', status: 'active', type: 'Full', auth_token: TOKEN });
      return json(201, { sid: `SM${'cd'.repeat(16)}`, status: 'queued', num_segments: '1' });
    }) as typeof fetch;
    const service = createSmsService({ store, secret: SECRET, fetch: fetchStub, stopList: { isStopped: async () => false, recordProviderOptOut: async () => undefined } });
    await server.register(
      async (api) =>
        api.register(
          smsRoutes({
            service,
            manageGrant: GRANT,
            operator: () => (operatorAllowed ? { allowed: true, reason: null } : { allowed: false, reason: 'trial-mode' }),
            get networkFeatures() {
              return networkFeatures;
            },
            desktop: false,
            trustProxy: true,
            publicOrigin: async () => origin,
            ...extra,
          }),
        ),
      { prefix: '/api/v1' },
    );
    await server.ready();
    return server;
  }

  beforeEach(async () => {
    calls = [];
    replies = [];
    store = memorySmsStore();
    operatorAllowed = true;
    networkFeatures = true;
    origin = 'https://crm.lumen.example';
    meta = createSqliteMetaDb({ database: new BetterSqlite3(':memory:') });
    await firstRun(meta);
    const users = usersRepo(meta);
    const roles = rolesRepo(meta);
    owner = await users.create({ email: 'owner@adminium.test', name: 'Mara Lind', status: 'active' });
    await roles.assignToUser(owner.id, (await roles.findBySlug('super-admin'))!.id);
    const role = await roles.create({ slug: 'texts', name: 'Texts' });
    managerRole = role.id;
    await permissionsRepo(meta).grant(role.id, 'system', 'payments.manage', { allowed: true });
    manager = await users.create({ email: 'manager@adminium.test', name: 'Mo Manager', status: 'active' });
    await roles.assignToUser(manager.id, role.id);
    clerk = await users.create({ email: 'clerk@adminium.test', name: 'Tom Clerk', status: 'active' });
    await roles.assignToUser(clerk.id, (await roles.create({ slug: 'clerk', name: 'Clerk' })).id);
    app = await serve();
  });

  afterEach(async () => {
    await app.close();
    await meta.db.destroy();
  });

  const call = (user: User | null, method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url: `/api/v1${url}`, headers: user === null ? {} : { 'x-test-user-id': user.id }, ...(payload === undefined ? {} : { payload }) });

  const connect = (user: User = manager) => call(user, 'PUT', '/sms/account', { provider: 'twilio', accountSid: SID, authToken: TOKEN });
  const setSender = (user: User = manager) => call(user, 'PUT', '/sms/sending', { sender: { kind: 'number', value: '+14155550100' }, defaultCountry: 'GB' });

  const ROUTES: ['GET' | 'PUT' | 'POST' | 'DELETE', string, object | undefined][] = [
    ['GET', '/sms/setup', undefined],
    ['PUT', '/sms/account', { provider: 'twilio', accountSid: SID, authToken: TOKEN }],
    ['PUT', '/sms/sending', { sender: { kind: 'number', value: '+14155550100' }, defaultCountry: null }],
    ['POST', '/sms/check', undefined],
    ['POST', '/sms/test', { to: NUMBER }],
    ['DELETE', '/sms/account', undefined],
  ];

  it('refuses every route to someone without the grant, and to nobody at all', async () => {
    for (const [method, url, payload] of ROUTES) {
      expect((await call(clerk, method, url, payload)).statusCode, `${method} ${url}`).toBe(403);
      expect((await call(null, method, url, payload)).statusCode, `${method} ${url}`).toBe(401);
    }
    expect(calls).toHaveLength(0);
    expect(store.row).toBeNull();
  });

  it('refuses every change to an API key, even one holding the grant', async () => {
    const generated = generateApiKey();
    await apiKeysRepo(meta).create({ name: 'script', prefix: generated.prefix, tokenHash: generated.tokenHash, roleId: managerRole });
    for (const [method, url, payload] of ROUTES) {
      const answer = await app.inject({ method, url: `/api/v1${url}`, headers: { authorization: `Bearer ${generated.key}` }, ...(payload === undefined ? {} : { payload }) });
      if (method === 'GET') expect(answer.statusCode).toBe(200);
      else expect(answer.statusCode, `${method} ${url}`).toBe(403);
    }
    expect(calls).toHaveLength(0);
    expect(store.row).toBeNull();
  });

  it('the Super Admin may do it too', async () => {
    expect((await connect(owner)).statusCode).toBe(200);
  });

  it('`sms.manage` cannot be registered until the grant exists, so the routes cannot go live unguarded', async () => {
    if (parsePermission(SMS_MANAGE_PERMISSION) !== null) return; // At merge the grant exists and this no longer applies.
    await expect(serve({ manageGrant: SMS_MANAGE_PERMISSION })).rejects.toThrow(/invalid permission/);
  });

  it('never gives a key back, in any reply or audit row', async () => {
    expect((await connect()).statusCode).toBe(200);
    expect((await setSender()).statusCode).toBe(200);
    expect((await call(manager, 'POST', '/sms/check')).statusCode).toBe(200);
    expect((await call(manager, 'POST', '/sms/test', { to: NUMBER })).statusCode).toBe(200);
    expect((await call(manager, 'GET', '/sms/setup')).statusCode).toBe(200);
    expect((await call(manager, 'DELETE', '/sms/account')).statusCode).toBe(204);
    const audit = JSON.stringify(await auditRepo(meta).list({ limit: 50 }));
    for (const text of [...replies, audit]) {
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain(SID);
      expect(text).not.toContain('enc:v1:');
      expect(text).not.toContain('owner@lumen');
    }
    expect(audit).not.toContain(NUMBER);
    for (const action of ['sms.account.connected', 'sms.sending.saved', 'sms.account.checked', 'sms.test.sent', 'sms.account.removed']) expect(audit).toContain(action);
  });

  it('does not repeat a refused paste in its reply', async () => {
    const answer = await call(manager, 'PUT', '/sms/account', { provider: 'twilio', accountSid: SID, authToken: 'a secret with spaces in it' });
    expect(answer.statusCode).toBe(422);
    expect(answer.json()).toMatchObject({ error: { details: { reason: 'HAS_SPACES', field: 'authToken' } } });
    expect(answer.body).not.toContain('a secret with spaces');
    expect(calls).toHaveLength(0);
  });

  it('does not repeat an oversized value in the validation error', async () => {
    const long = `${TOKEN}${'x'.repeat(2000)}`;
    const answer = await call(manager, 'PUT', '/sms/account', { provider: 'twilio', accountSid: SID, authToken: long });
    expect(answer.statusCode).toBeGreaterThanOrEqual(400);
    expect(answer.body).not.toContain(TOKEN);
    expect(calls).toHaveLength(0);
  });

  it('shows the masked account and how a timeout is treated', async () => {
    await connect();
    await setSender();
    const setup = (await call(manager, 'GET', '/sms/setup')).json() as { data: { repliesCanArrive: boolean; account: Record<string, unknown> } };
    expect(setup.data.repliesCanArrive).toBe(true);
    expect(setup.data.account).toMatchObject({ provider: 'twilio', accountName: 'ow•••le', accountHint: '…abab', timeoutRetry: 'never', senderTakesReplies: 'yes', defaultCountry: 'GB' });
  });

  it('audits a key that now belongs to another account', async () => {
    await connect();
    await store.write({ ...store.row!, sealedCredentials: 'enc:v1:AAAA' }, store.row!.revision);
    await connect();
    expect(JSON.stringify(await auditRepo(meta).list({ limit: 10 }))).toContain('sms.account.changed');
  });

  it('says plainly when replies cannot reach this server', async () => {
    origin = 'http://192.168.1.20:4600';
    const setup = (await call(manager, 'GET', '/sms/setup')).json() as { data: { repliesCanArrive: boolean; reachability: { state: string } } };
    expect(setup.data.repliesCanArrive).toBe(false);
    expect(setup.data.reachability.state).toBe('private-network');
  });

  it('refuses a provider call when the operator or the network says no', async () => {
    await connect();
    await setSender();
    calls = [];
    operatorAllowed = false;
    for (const [method, url, payload] of [['PUT', '/sms/account', ROUTES[1]![2]], ['POST', '/sms/check', undefined], ['POST', '/sms/test', { to: NUMBER }]] as const) {
      const answer = await call(manager, method, url, payload);
      expect(answer.statusCode, url).toBe(403);
      expect(answer.json()).toMatchObject({ error: { code: 'OFF_BY_OPERATOR', details: { question: 'smsProviders', reason: 'trial-mode' } } });
    }
    expect(((await call(manager, 'GET', '/sms/setup')).json() as { data: { reachability: { state: string } } }).data.reachability.state).toBe('operator-off');
    operatorAllowed = true;
    networkFeatures = false;
    for (const [method, url, payload] of [['PUT', '/sms/account', ROUTES[1]![2]], ['POST', '/sms/check', undefined], ['POST', '/sms/test', { to: NUMBER }]] as const) {
      const answer = await call(manager, method, url, payload);
      expect(answer.statusCode, url).toBe(422);
      expect(answer.json()).toMatchObject({ error: { details: { reason: 'network-off' } } });
    }
    expect(calls).toHaveLength(0);
  });

  it('sends a test text and says what happened, without the number in the audit', async () => {
    await connect();
    await setSender();
    const answer = await call(manager, 'POST', '/sms/test', { to: NUMBER });
    expect(answer.json()).toMatchObject({ data: { outcome: 'accepted', reason: null } });
    const china = await call(manager, 'POST', '/sms/test', { to: '+8613812345678' });
    expect(china.json()).toMatchObject({ data: { outcome: 'refused', reason: 'country-blocked-cn' } });
    expect(calls.filter((one) => one.method === 'POST')).toHaveLength(1);
    expect(JSON.stringify(await auditRepo(meta).list({ limit: 20 }))).toContain('+…56');
  });

  it('takes the test text\'s words from nowhere but the server', async () => {
    await connect();
    await setSender();
    expect((await call(manager, 'POST', '/sms/test', { to: NUMBER, body: 'Anything I like' })).statusCode).not.toBe(200);
    expect(calls.filter((one) => one.method === 'POST')).toHaveLength(0);
  });

  it('removes the account, and removing nothing is not an error', async () => {
    await connect();
    expect((await call(manager, 'DELETE', '/sms/account')).statusCode).toBe(204);
    expect(store.row).toBeNull();
    expect((await call(manager, 'DELETE', '/sms/account')).statusCode).toBe(204);
  });
});
