// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A child read by its parent's link, with the link written on ANOTHER key of
 * the same connection.
 *
 * A proposal names the terms its client reads through it. One key may never
 * both read the terms that way and let the client change which terms the
 * proposal names — the scope compiler refuses that inside a key. But a
 * session belongs to one key, and a person can sign in on two: the app's
 * own, and one an operator made by hand. Re-pointed through one, the terms
 * are read through the other. So whichever of the two keys is saved second
 * is refused — a key made in Studio, an endpoint an operator's key grants, a
 * hand-written scope and a key on it, and an app's own key at install — and
 * a server key, which no person holds, is not.
 */
import { validateManifest, type Manifest } from '@adminium/manifest';
import {
  appTablesRepo,
  connectionTenantConfig,
  publicEndpointsRepo,
  publicKeysRepo,
  rolesRepo,
  usersRepo,
  type PublicKey,
} from '@adminium/meta';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildServer, type AdminiumServer } from '../src/app.js';
import { installPublicAccess } from '../src/apps/manifest-public.js';
import { dsnCryptoFromSecret } from '../src/connections/crypto.js';
import { rbacPlugin } from '../src/plugins/rbac.js';
import { createEndpointService, EndpointSaveRefused, KeyCreateRefused, type EndpointService } from '../src/public-api/endpoint-service.js';
import { parseDefinition, type PublicEndpointDefinition } from '../src/public-api/endpoint.js';
import { generatePublishableKey, sealPublishableKey } from '../src/public-api/keys.js';
import { createPublicViews } from '../src/public-api/runtime.js';
import { LINK_WRITTEN_BY_ANOTHER_KEY, linkWrittenByAnotherKeyIssues } from '../src/public-api/scope.js';
import { publicAdminRoutes } from '../src/routes/public-admin/index.js';
import { installInvoicing, invoicingManifest, LEGS, type InvoicingHarness } from './invoicing-install.helpers.js';
import { makeEnv, TEST_SECRET } from './helpers.js';

const id = { ref: 'id', type: 'int', role: 'pk' };
const text = (ref: string, nullable = false) => ({ ref, type: 'text', maxLength: 120, ...(nullable ? { nullable: true } : {}) });
const fk = (ref: string, references: string, nullable = false) => ({ ref, type: 'fk', references, ...(nullable ? { nullable: true } : {}) });

/** An app whose key reads a proposal's terms through the proposal, and never lets the client change which. */
const manifest = {
  ...invoicingManifest([
    { ref: 'clients', columns: [id, { ...text('email'), unique: true }, text('name')] },
    { ref: 'terms_versions', columns: [id, text('title')] },
    { ref: 'proposals', columns: [id, fk('client_id', 'clients'), fk('terms_version_id', 'terms_versions', true), text('signed_name', true)] },
  ]),
  publicAccess: [
    { table: 'clients', methods: ['GET'], select: ['name'], claim: { match: ['email', 'name'] } },
    { table: 'proposals', methods: ['GET', 'PATCH'], select: ['id', 'terms_version_id', 'signed_name'], claimedBy: { table: 'clients', column: 'client_id' }, writable: ['signed_name'] },
    { table: 'terms_versions', methods: ['GET'], select: ['id', 'title'], visibleWith: { table: 'proposals', via: 'terms_version_id' } },
  ],
};

describe('the parent-link rule across keys', () => {
  const reader = {
    version: 1,
    side: 'customer',
    claim: { strategy: 'lookup', ref: 'clients', match: ['id'] },
    resources: [
      { ref: 'clients', table: 'public.clients', actions: ['read'], expose: ['id'], claim: { column: 'id' } },
      { ref: 'proposals', table: 'public.proposals', actions: ['read'], expose: ['id'], claim: { column: 'client_id', ref: 'clients' } },
      { ref: 'terms', table: 'public.terms', actions: ['read'], expose: ['id'], visibleWith: { ref: 'proposals', localColumn: 'id', foreignColumn: 'terms_version_id' } },
    ],
  };
  const writer = (door: Record<string, unknown>) => ({
    version: 1,
    side: 'customer',
    resources: [{ ref: 'repoint', table: 'public.proposals', actions: ['read', 'update'], expose: ['id'], ...door }],
  });
  const codes = (document: unknown, other: unknown) => linkWrittenByAnotherKeyIssues(document, [{ name: 'Other', document: other }]).map((i) => i.code);

  it('refuses a door on another key that writes the link, from either side', () => {
    const repoint = writer({ writable: ['terms_version_id'] });
    expect(codes(reader, repoint)).toEqual([LINK_WRITTEN_BY_ANOTHER_KEY]);
    expect(codes(repoint, reader)).toEqual([LINK_WRITTEN_BY_ANOTHER_KEY]);
    const [issue] = linkWrittenByAnotherKeyIssues(reader, [{ name: 'Operator', document: repoint }]);
    expect(issue).toMatchObject({ ref: 'terms', column: 'terms_version_id' });
    expect(issue!.message).toContain('"repoint" on the key "Operator"');
  });

  it('counts a chosen value, a default and a create as writing it, and the table however it is spelled', () => {
    expect(codes(reader, writer({ writable: ['signed_name'], writableValues: { terms_version_id: [2] } }))).toEqual([LINK_WRITTEN_BY_ANOTHER_KEY]);
    expect(codes(reader, writer({ actions: ['create'], writable: ['signed_name'], defaults: { terms_version_id: 2 } }))).toEqual([LINK_WRITTEN_BY_ANOTHER_KEY]);
    expect(codes(reader, writer({ table: 'proposals', writable: ['terms_version_id'] }))).toEqual([LINK_WRITTEN_BY_ANOTHER_KEY]);
  });

  it('lets through a door that only reads, one that writes other columns, and a document that does not parse', () => {
    expect(codes(reader, writer({ actions: ['read'], writable: ['terms_version_id'] }))).toEqual([]);
    expect(codes(reader, writer({ writable: ['signed_name'] }))).toEqual([]);
    expect(codes(reader, { resources: 'nothing' })).toEqual([]);
    expect(codes(reader, reader)).toEqual([]);
  });
});

describe.each(LEGS)('a link one key writes and another key reads by — %s', (dialect, available) => {
  let h: InvoicingHarness & { reply: Record<string, unknown> };
  let service: EndpointService;
  let admin: AdminiumServer;
  let asOwner: Record<string, string>;
  let appKey: PublicKey;
  const t = (short: string) => h.real(short);
  const crypto = dsnCryptoFromSecret(TEST_SECRET);

  const secret = (kind: 'browser' | 'server' = 'browser') => {
    const made = generatePublishableKey(kind);
    return { prefix: made.prefix, tokenHash: made.tokenHash, tokenEncrypted: sealPublishableKey(crypto, made.token) };
  };
  const endpoint = async (ref: string, writable: string[]): Promise<PublicEndpointDefinition> => {
    const view = (await createPublicViews(h.meta).viewFor(h.connectionId))!;
    return {
      path: `/${ref}`,
      source: view.table(t('proposals')).id,
      methods: ['GET', 'PATCH'],
      select: ['id', 'terms_version_id', 'signed_name'],
      filters: [],
      pagination: { default_limit: 50, max_limit: 200, order: 'id.asc' },
      auth: { role: 'authenticated' },
      rate_limit: { requests: 60, window: '1m' },
      response: { shape: 'object', envelope: 'data' },
      writable,
      claim: { column: 'client_id', ref: `${t('clients')}_claimed` },
    };
  };
  const operatorKey = (name: string, door: string, kind: 'browser' | 'server' = 'browser') =>
    service.createKey({
      connectionId: h.connectionId,
      name,
      access: [
        { ref: `${t('clients')}_claimed`, methods: ['GET'] },
        { ref: door, methods: ['GET', 'PATCH'] },
      ],
      secret: secret(kind),
      origins: [],
      kind,
    });
  const refusal = async (made: Promise<unknown>) => {
    try {
      await made;
    } catch (error) {
      return error;
    }
    throw new Error('it was not refused');
  };

  beforeAll(async () => {
    if (!available) return;
    h = await installInvoicing(dialect, manifest);
    const views = createPublicViews(h.meta);
    service = createEndpointService({ meta: h.meta, viewFor: views.viewFor, tenantConfigOf: async (cid) => (await connectionTenantConfig(h.meta, cid)) ?? undefined });
    appKey = (await publicKeysRepo(h.meta).findById((h.reply['publicAccess'] as { keyId: string }).keyId))!;
    // Stored, and granted by no key yet: nothing is judged until a key serves it.
    await service.saveEndpoint({ connectionId: h.connectionId, ref: 'repoint', origin: 'custom', definition: await endpoint('repoint', ['terms_version_id']) });
    await service.saveEndpoint({ connectionId: h.connectionId, ref: 'sign', origin: 'custom', definition: await endpoint('sign', ['signed_name']) });

    // Studio's own routes, as the owner.
    const owner = (await usersRepo(h.meta).findByEmail('owner@test'))!;
    await rolesRepo(h.meta).assignToUser(owner.id, (await rolesRepo(h.meta).findBySlug('super-admin'))!.id);
    asOwner = { 'x-test-user-id': owner.id };
    admin = await buildServer({ env: makeEnv(), logger: false });
    admin.addHook('onRequest', async (request) => {
      if (request.headers['x-test-user-id'] === owner.id) {
        (request as unknown as { user: { id: string; name: string; email: string } }).user = { id: owner.id, name: owner.name, email: owner.email };
      }
    });
    await admin.register(rbacPlugin, { meta: h.meta });
    await admin.register(async (api) => api.register(publicAdminRoutes({ meta: h.meta, env: makeEnv(), crypto, service })), { prefix: '/api/v1' });
    await admin.ready();
  }, 120_000);

  afterAll(async () => {
    if (!available) return;
    await admin.close();
    await h.close();
  });

  const detailsOf = (res: { json: () => unknown }) =>
    (res.json() as { error: { details: { issues: { code: string; message: string }[]; keys?: { name: string }[] } } }).error.details;

  it.skipIf(!available)('refuses a key made in Studio whose door re-points the proposal the app’s key reads terms by', async () => {
    const error = await refusal(operatorKey('Operator', 'repoint'));
    expect(error).toBeInstanceOf(KeyCreateRefused);
    const [issue] = (error as KeyCreateRefused).issues;
    expect(issue).toMatchObject({ code: LINK_WRITTEN_BY_ANOTHER_KEY, ref: 'repoint', column: 'terms_version_id' });
    expect(issue!.message).toContain(`on the key "${appKey.name}"`);

    // What the key sheet shows: a sentence, not a code.
    const res = await admin.inject({
      method: 'POST',
      url: '/api/v1/public-keys',
      headers: asOwner,
      payload: { name: 'Operator', connectionId: h.connectionId, access: [{ ref: `${t('clients')}_claimed`, methods: ['GET'] }, { ref: 'repoint', methods: ['GET', 'PATCH'] }] },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect(detailsOf(res).issues[0]!.message).toMatch(/^"terms_version_id" is the link .* so "repoint" may not write it/);
  });

  it.skipIf(!available)('refuses an endpoint save that makes a live key’s door write the link', async () => {
    const { key } = await operatorKey('Signing', 'sign');
    const error = await refusal(service.saveEndpoint({ connectionId: h.connectionId, ref: 'sign', definition: await endpoint('sign', ['signed_name', 'terms_version_id']) }));
    expect(error).toBeInstanceOf(EndpointSaveRefused);
    expect((error as EndpointSaveRefused).keys.map((k) => k.id)).toEqual([key.id]);
    expect((error as EndpointSaveRefused).issues.map((i) => i.code)).toEqual([LINK_WRITTEN_BY_ANOTHER_KEY]);
    // Nothing was stored.
    const stored = parseDefinition((await publicEndpointsRepo(h.meta).findByRef(h.connectionId, 'sign'))!.definition);
    expect(stored.ok && stored.definition.writable).toEqual(['signed_name']);

    // The builder's own route says the key and the reason.
    const res = await admin.inject({
      method: 'PUT',
      url: `/api/v1/public-endpoints/${h.connectionId}/sign`,
      headers: asOwner,
      payload: { definition: JSON.stringify(await endpoint('sign', ['signed_name', 'terms_version_id'])) },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect(detailsOf(res).keys?.map((k) => k.name)).toEqual(['Signing']);
    expect(detailsOf(res).issues[0]!.message).toContain(`on the key "${appKey.name}"`);
  });

  it.skipIf(!available)('lets a server key write it: no person signs in on one', async () => {
    const { key } = await operatorKey('Backend', 'repoint', 'server');
    expect(key.kind).toBe('server');
    // And a browser key reading terms by the proposal is still made beside it.
    const { key: reader } = await service.createKey({
      connectionId: h.connectionId,
      name: 'Second portal',
      access: [
        { ref: `${t('clients')}_claimed`, methods: ['GET'] },
        { ref: `${t('proposals')}_claimed`, methods: ['GET'] },
        { ref: `${t('terms_versions')}_claimed`, methods: ['GET'] },
      ],
      secret: secret(),
      origins: [],
      kind: 'browser',
    });
    expect(reader.revokedAt).toBeNull();
    await publicKeysRepo(h.meta).revoke(reader.id);
  });

  it.skipIf(!available)('refuses a key on a hand-written scope that writes it, and a scope document that comes to', async () => {
    const view = (await createPublicViews(h.meta).viewFor(h.connectionId))!;
    const document = (writable: string[]) =>
      JSON.stringify({
        version: 1,
        side: 'customer',
        claim: { strategy: 'lookup', ref: 'c', match: ['email', 'name'] },
        resources: [
          { ref: 'c', table: view.table(t('clients')).id, actions: ['read'], expose: ['name'], claim: { column: 'id' } },
          { ref: 'p', table: view.table(t('proposals')).id, actions: ['read', 'update'], expose: ['id', 'terms_version_id'], writable, claim: { column: 'client_id', ref: 'c' } },
        ],
      });
    const scope = async (writable: string[]) => {
      const res = await admin.inject({ method: 'POST', url: '/api/v1/public-scopes', headers: asOwner, payload: { connectionId: h.connectionId, side: 'customer', name: 'Hand-written', document: document(writable) } });
      expect(res.statusCode, res.body).toBe(201);
      return (res.json() as { scopes: { id: string }[] }).scopes[0]!.id;
    };
    const keyOn = (scopeId: string) => admin.inject({ method: 'POST', url: '/api/v1/public-keys', headers: asOwner, payload: { name: 'On a scope', scopeId } });

    const repointing = await keyOn(await scope(['terms_version_id']));
    expect(repointing.statusCode, repointing.body).toBe(422);
    expect(detailsOf(repointing).issues.map((i) => i.code)).toEqual([LINK_WRITTEN_BY_ANOTHER_KEY]);

    const signing = await scope(['signed_name']);
    expect((await keyOn(signing)).statusCode).toBe(201);
    const edited = await admin.inject({ method: 'PATCH', url: `/api/v1/public-scopes/${signing}`, headers: asOwner, payload: { document: document(['signed_name', 'terms_version_id']) } });
    expect(edited.statusCode, edited.body).toBe(422);
    expect(detailsOf(edited).issues[0]!.message).toContain(`on the key "${appKey.name}"`);
  });

  it.skipIf(!available)('stops the app’s own key at install, in words, beside an operator’s key that already writes it', async () => {
    // The app's key gone, an operator's key that re-points is made; then the app makes its key again.
    await publicKeysRepo(h.meta).revoke(appKey.id);
    const { key } = await operatorKey('Operator', 'repoint');
    const parsed = validateManifest(manifest);
    if (!parsed.ok) throw new Error('the manifest is valid');
    const error = await refusal(
      installPublicAccess({
        service,
        meta: h.meta,
        crypto,
        manifest: parsed.manifest as Manifest,
        connectionId: h.connectionId,
        names: await appTablesRepo(h.meta).realNames(h.connectionId, 'studio'),
        view: (await createPublicViews(h.meta).viewFor(h.connectionId))!,
        appName: 'Studio',
        actorId: null,
        livePurposes: new Set(),
      }),
    );
    expect(error).not.toBeInstanceOf(KeyCreateRefused);
    expect((error as Error).message).toMatch(/^The public access this app asks for cannot be made: "terms_version_id" is the link .* on the key "Operator"/);
    expect((await publicKeysRepo(h.meta).listManagedBy('studio')).filter((k) => k.revokedAt === null)).toEqual([]);
    expect(key.revokedAt).toBeNull();
  });
});
