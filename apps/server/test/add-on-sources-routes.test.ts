// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An add-on's Sources, through its routes, on every engine this run can
 * reach, as the people the rules are about (never only as an admin).
 *
 *  - "Key not set" beside a saved key: two sources, one credential row, each
 *    read apart; a save is checked at once (accepted, refused).
 *  - A reader who may open the add-on's page sees the sources, and is refused
 *    a save, a removal, a Check and a switch; somebody who manages add-ons
 *    (not Super Admin) may do each. An API key may not.
 *  - The audit rows name the source and never hold the key.
 *  - The generic connect and disconnect refuse a sources add-on, and still
 *    refuse a payment service.
 */
import { auditRepo, manifestsRepo, permissionsRepo, rolesRepo, usersRepo, type InstalledManifest, type ManifestsRepo, type User } from '@adminium/meta';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addOnCredentialCryptoFromSecret } from '../src/add-ons/credential-crypto.js';
import type { AddOnRuntimeState } from '../src/add-ons/runtime.js';
import { createAddOnStore } from '../src/add-ons/store.js';
import { errorEnvelope } from '../src/errors.js';
import { sourceKey } from '../src/lead-sources/keys.js';
import type { LeadSourceContext } from '@adminium/add-on-contracts';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { matrixRowsFromGrants, PERMISSIONS } from '../src/rbac/permissions.js';
import { addOnRoutes } from '../src/routes/add-ons/index.js';
import { leadFinder } from '../../../packages/manifest/test/lead-finder-fixture.js';
import { META_ENGINES, type MetaHandle } from './meta-dialects.js';

const KEY = 'company-finder';
const REGISTER_KEY = 'test-key-companies-1';
const REFUSED_KEY = 'test-key-refused-9';
const SECRET = 'a-test-secret-that-is-long-enough-000';
const PAGE = 'company-finder-search';

/** The fixture with a page of its own, so a reader may open it. */
function withPage(): Record<string, unknown> {
  const doc = leadFinder() as { addOn: Record<string, unknown> };
  doc.addOn['hostApi'] = 1;
  doc.addOn['pages'] = [{ ref: PAGE, title: { key: 'company-finder.search', fallback: 'Find companies' }, icon: 'search', client: 'pages/search.js' }];
  return doc;
}

const runtime: AddOnRuntimeState = {
  providers: new Map([
    [
      'lead-source@1',
      [
        {
          addOnKey: KEY,
          contract: 'lead-source',
          version: 1,
          module: {
            // A refused key is refused in words that quote it, as a careless service might.
            createLeadSource: (context: LeadSourceContext) => ({
              checkKey: async () => (context.key === REFUSED_KEY ? { ok: false, code: 'KEY_REFUSED', message: `The key ${String(context.key)} is not known.` } : { ok: true, account: 'Kestrel Yard Architects' }),
            }),
          },
        },
      ],
    ],
  ]),
  slots: new Map(),
  conflicts: [],
  problems: [],
  deciders: new Map(),
};

describe.each(META_ENGINES)("an add-on's Sources — $name", (engine) => {
  let handle: MetaHandle;
  let app: FastifyInstance;
  let manifests: ManifestsRepo;
  let install: InstalledManifest;
  let dataDir: string;
  const people: Record<'manager' | 'reader' | 'stranger', User> = {} as never;

  const send = (who: User | null, method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, payload?: unknown, extra: Record<string, string> = {}) =>
    app.inject({ method, url: `/api/v1${url}`, headers: { ...(who === null ? {} : { 'x-test-user-id': who.id }), ...extra }, ...(payload === undefined ? {} : { payload: payload as never }) });
  const list = async (who: User) => {
    const res = await send(who, 'GET', `/add-ons/${KEY}/sources`);
    expect(res.statusCode, res.body).toBe(200);
    return res.json() as { canManage: boolean; sources: { id: string; needsKey: boolean; lastFour: string | null; verdict: string | null; on: boolean; dailyCap: number | null; usedToday: number; hosts: string[] }[] };
  };

  async function person(email: string, grants: string[]): Promise<User> {
    const user = await usersRepo(handle.meta).create({ email, name: email.split('@')[0]!, status: 'active' });
    const role = await rolesRepo(handle.meta).create({ slug: `${email.split('@')[0]!}-role`, name: email });
    for (const row of matrixRowsFromGrants(grants).rows) await permissionsRepo(handle.meta).grant(role.id, row.resourceKind, row.resourceRef, row.actions as never);
    await rolesRepo(handle.meta).assignToUser(user.id, role.id);
    return user;
  }

  beforeEach(async () => {
    if (!engine.available) return;
    handle = await engine.make();
    manifests = manifestsRepo(handle.meta, addOnCredentialCryptoFromSecret(SECRET));
    install = await manifests.install({ manifestKey: KEY, version: '1.0.0', kind: 'add-on', source: 'file', document: withPage() });
    people.manager = await person('mara@finder.example', [PERMISSIONS.manifestsManage]);
    people.reader = await person('tom@finder.example', [`page:${PAGE}:view`]);
    people.stranger = await person('ida@finder.example', []);
    dataDir = await mkdtemp(join(tmpdir(), 'add-on-sources-'));

    app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler((error: { statusCode?: number; code?: string; message: string; details?: unknown }, request, reply) => {
      void reply.status(error.statusCode ?? 500).send(errorEnvelope(error.code ?? 'INTERNAL', error.message, request.id, error.details));
    });
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (request) => {
      const id = request.headers['x-test-user-id'];
      if (typeof id === 'string') {
        const user = await usersRepo(handle.meta).findById(id);
        if (user !== null) (request as unknown as { user: object }).user = { id: user.id, name: user.name, email: user.email };
      }
    });
    await app.register(rbacPlugin, { meta: handle.meta });
    app.addHook('onRequest', async (request) => {
      if (request.headers['x-test-api-key'] !== undefined) (request as unknown as { apiKeyPrincipal: object }).apiKeyPrincipal = { id: 'key_1' };
    });
    app.decorate('requireAuth', (async (request: { user?: unknown }) => {
      if (request.user === null || request.user === undefined) throw Object.assign(new Error('Sign in.'), { statusCode: 401, code: 'UNAUTHENTICATED' });
    }) as never);
    await app.register(
      async (api) => {
        await api.register(addOnRoutes({ meta: handle.meta, store: createAddOnStore({ dataDir }), credentialCrypto: addOnCredentialCryptoFromSecret(SECRET), runtime: () => runtime }));
      },
      { prefix: '/api/v1' },
    );
    await app.ready();
  });

  afterEach(async () => {
    if (!engine.available) return;
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
    await handle.destroy();
  });

  it.skipIf(!engine.available)('reads "Key not set" beside a saved key, each source apart, and checks a save at once', async () => {
    const saved = await send(people.manager, 'PUT', `/add-ons/${KEY}/sources/companies-house/key`, { value: `  ${REGISTER_KEY}  ` });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ source: { id: 'companies-house', lastFour: 'es-1', verdict: 'accepted', on: true }, check: { verdict: 'accepted', account: 'Kestrel Yard Architects' } });

    const read = await list(people.manager);
    const byId = new Map(read.sources.map((one) => [one.id, one]));
    expect(byId.get('companies-house')).toMatchObject({ needsKey: true, lastFour: 'es-1', verdict: 'accepted', on: true, hosts: ['api.company-information.service.gov.uk'] });
    expect(byId.get('hunter')).toMatchObject({ needsKey: true, lastFour: null, verdict: null, on: false, dailyCap: 100 });
    expect(byId.get('france')).toMatchObject({ needsKey: false, on: true, dailyCap: null });
    expect(byId.get('website')).toMatchObject({ needsKey: false, hosts: [] });
    // One credential row holds the one key, under its source.
    const envelope = await manifests.getCredential(install.row.id);
    expect(sourceKey(envelope, 'companies-house')).toBe(REGISTER_KEY);
    expect(sourceKey(envelope, 'hunter')).toBeNull();
    // Nothing a reader is sent holds the key.
    expect(JSON.stringify(read)).not.toContain(REGISTER_KEY);
  });

  it.skipIf(!engine.available)('reads a refused key as refused, without its words quoting the key', async () => {
    const saved = await send(people.manager, 'PUT', `/add-ons/${KEY}/sources/hunter/key`, { value: REFUSED_KEY });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({ source: { verdict: 'refused' }, check: { verdict: 'refused', code: 'KEY_REFUSED' } });
    expect(saved.body).not.toContain(REFUSED_KEY);
  });

  it.skipIf(!engine.available)('lets a reader of its page see the sources, and refuses them every change', async () => {
    await send(people.manager, 'PUT', `/add-ons/${KEY}/sources/companies-house/key`, { value: REGISTER_KEY });
    const read = await list(people.reader);
    expect(read.canManage).toBe(false);
    expect(read.sources.find((one) => one.id === 'companies-house')).toMatchObject({ lastFour: 'es-1' });
    const tries = [
      send(people.reader, 'PUT', `/add-ons/${KEY}/sources/hunter/key`, { value: 'test-key-people-2' }),
      send(people.reader, 'DELETE', `/add-ons/${KEY}/sources/companies-house/key`),
      send(people.reader, 'POST', `/add-ons/${KEY}/sources/companies-house/check`),
      send(people.reader, 'PUT', `/add-ons/${KEY}/sources/companies-house`, { on: false }),
      send(people.reader, 'PUT', `/add-ons/${KEY}/sources/hunter`, { dailyCap: 500 }),
    ];
    for (const res of await Promise.all(tries)) expect(res.statusCode, res.body).toBe(403);
    // Nothing moved.
    expect((await list(people.manager)).sources.find((one) => one.id === 'companies-house')).toMatchObject({ lastFour: 'es-1', on: true });
    expect(sourceKey(await manifests.getCredential(install.row.id), 'hunter')).toBeNull();
    // Somebody with neither the settings nor the page sees nothing.
    expect((await send(people.stranger, 'GET', `/add-ons/${KEY}/sources`)).statusCode).toBe(403);
    expect((await send(null, 'GET', `/add-ons/${KEY}/sources`)).statusCode).toBe(401);
  });

  it.skipIf(!engine.available)('lets whoever manages add-ons remove, check and switch, but never with an API key', async () => {
    await send(people.manager, 'PUT', `/add-ons/${KEY}/sources/companies-house/key`, { value: REGISTER_KEY });
    const checked = await send(people.manager, 'POST', `/add-ons/${KEY}/sources/companies-house/check`);
    expect(checked.statusCode, checked.body).toBe(200);
    const capped = await send(people.manager, 'PUT', `/add-ons/${KEY}/sources/hunter`, { dailyCap: 40, personShare: 25 });
    expect(capped.json()).toMatchObject({ source: { id: 'hunter', dailyCap: 40, personShare: 25 } });
    // A paid source keeps a cap.
    expect((await send(people.manager, 'PUT', `/add-ons/${KEY}/sources/hunter`, { dailyCap: null })).statusCode).toBe(422);
    const off = await send(people.manager, 'PUT', `/add-ons/${KEY}/sources/france`, { on: false });
    expect(off.json()).toMatchObject({ source: { id: 'france', on: false } });
    const removed = await send(people.manager, 'DELETE', `/add-ons/${KEY}/sources/companies-house/key`);
    expect(removed.json()).toMatchObject({ source: { id: 'companies-house', lastFour: null, verdict: null } });
    expect(sourceKey(await manifests.getCredential(install.row.id), 'companies-house')).toBeNull();
    // No key to check, and the website takes none.
    expect((await send(people.manager, 'POST', `/add-ons/${KEY}/sources/companies-house/check`)).statusCode).toBe(422);
    expect((await send(people.manager, 'PUT', `/add-ons/${KEY}/sources/website/key`, { value: 'x-y-z-w' })).statusCode).toBe(422);
    expect((await send(people.manager, 'PUT', `/add-ons/${KEY}/sources/companies-house/key`, { value: REGISTER_KEY }, { 'x-test-api-key': '1' })).statusCode).toBe(403);
  });

  it.skipIf(!engine.available)('audits the source by name and never the key', async () => {
    await send(people.manager, 'PUT', `/add-ons/${KEY}/sources/companies-house/key`, { value: REGISTER_KEY });
    await send(people.manager, 'PUT', `/add-ons/${KEY}/sources/hunter/key`, { value: REFUSED_KEY });
    await send(people.manager, 'POST', `/add-ons/${KEY}/sources/companies-house/check`);
    await send(people.manager, 'DELETE', `/add-ons/${KEY}/sources/companies-house/key`);
    const rows = await auditRepo(handle.meta).list({ category: 'leads' });
    expect(rows.map((row) => row.action).sort()).toEqual(['leads.source.key.checked', 'leads.source.key.checked', 'leads.source.key.checked', 'leads.source.key.removed', 'leads.source.key.saved', 'leads.source.key.saved']);
    for (const row of rows) expect(JSON.stringify(row.changes)).toMatch(/"source":"(companies-house|hunter)"/);
    const everything = JSON.stringify(await auditRepo(handle.meta).list({ limit: 500 }));
    expect(everything).not.toContain(REGISTER_KEY);
    expect(everything).not.toContain(REFUSED_KEY);
  });

  it.skipIf(!engine.available)('refuses the generic connect and disconnect for a sources add-on, and still for a payment service', async () => {
    const connect = await send(people.manager, 'POST', `/add-ons/${KEY}/connect`, { credentials: { companies_house_key: REGISTER_KEY, hunter_key: 'test-key-people-2' } });
    expect(connect.statusCode, connect.body).toBe(422);
    expect(connect.json()).toMatchObject({ error: { details: { reason: 'sources' } } });
    expect(await manifests.getCredential(install.row.id)).toBeNull();
    const disconnect = await send(people.manager, 'DELETE', `/add-ons/${KEY}/connect`);
    expect(disconnect.json()).toMatchObject({ error: { details: { reason: 'sources' } } });

    await manifests.install({
      manifestKey: 'payments-stripe',
      version: '1.0.12',
      kind: 'add-on',
      source: 'file',
      document: {
        kind: 'add-on',
        manifestVersion: 1,
        key: 'payments-stripe',
        name: 'Card payments',
        version: '1.0.12',
        publisher: { id: 'adminium', name: 'Adminium', url: 'https://adminium.dev' },
        license: 'AGPL-3.0-only',
        description: { key: 'addon.payments-stripe.line', fallback: 'Connects to Stripe.' },
        categories: ['payments'],
        compatibility: { minAdminiumVersion: '0.3.30', requires: ['outbound-http'] },
        capabilities: ['outbound-http'],
        addOn: { attaches: [{ app: '*' }], provides: [{ contract: 'payment-provider', version: 1, server: 'dist/server.js' }], connect: { kind: 'api-key' }, network: { allow: ['api.stripe.com'] }, publicSettings: [] },
        settings: [{ key: 'secret_key', type: 'string', secret: true }],
      },
    });
    const paid = await send(people.manager, 'POST', `/add-ons/payments-stripe/connect`, { credentials: { secret_key: 'test-key-money-3' } });
    expect(paid.json()).toMatchObject({ error: { details: { reason: 'payments' } } });
  });
});
